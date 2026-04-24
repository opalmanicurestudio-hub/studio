'use client';

/**
 * useInquiryPrefill
 * ─────────────────────────────────────────────────────────────────────────────
 * Add this to the top of QuoteGeneratorPage (quotes/new/page.tsx).
 *
 * Usage:
 *   const { prefilling } = useInquiryPrefill({
 *     tenantId,
 *     firestore,
 *     setClientId,         // from the form state
 *     setEventName,
 *     setEventStartDate,
 *     setEventLocation,
 *     setTotalHours,
 *     setLineItems,        // pre-populate services the client asked for
 *     setNotes,
 *     onClientLookup,      // optional: called with {name, email, phone} to find/create client
 *   });
 *
 * If ?from=<requestId> is in the URL, this hook:
 * 1. Loads the quoteRequest document
 * 2. Looks up (or creates) the client by email
 * 3. Sets all matching form fields
 * 4. Marks the request as status:'quoted'
 * 5. Returns prefilling=true while loading so you can show a spinner
 */

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { doc, getDoc, collection, getDocs, query, where, addDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

type LineItem = {
    id: string;
    name: string;
    description: string;
    price: number;
    cost: number;
    quantity: number;
};

interface PrefillOptions {
    tenantId: string | undefined;
    firestore: any;

    // Form state setters — pass these from your QuoteGeneratorPage state
    setClientId:       (id: string) => void;
    setEventName:      (name: string) => void;
    setEventStartDate: (date: Date | undefined) => void;
    setEventLocation:  (loc: { street: string; city: string; state: string; zip: string; country: string }) => void;
    setTotalHours:     (hours: number) => void;
    setLineItems:      (items: LineItem[]) => void;
    setNotes:          (notes: string) => void;

    // Optional: called with raw contact info so caller can handle client creation
    onClientResolved?: (clientId: string, isNew: boolean) => void;
}

export const useInquiryPrefill = ({
    tenantId,
    firestore,
    setClientId,
    setEventName,
    setEventStartDate,
    setEventLocation,
    setTotalHours,
    setLineItems,
    setNotes,
    onClientResolved,
}: PrefillOptions) => {
    const searchParams = useSearchParams();
    const { toast }    = useToast();
    const [prefilling, setPrefilling] = useState(false);
    const [inquiry,    setInquiry]    = useState<any | null>(null);

    const fromId = searchParams.get('from');

    useEffect(() => {
        if (!fromId || !tenantId || !firestore) return;

        const prefill = async () => {
            setPrefilling(true);
            try {
                // 1. Load the inquiry
                const reqSnap = await getDoc(doc(firestore, `tenants/${tenantId}/quoteRequests`, fromId));
                if (!reqSnap.exists()) {
                    toast({ variant: 'destructive', title: 'Inquiry not found', description: 'Could not load the inquiry data.' });
                    return;
                }
                const req = { id: reqSnap.id, ...reqSnap.data() } as any;
                setInquiry(req);

                // 2. Find or create the client by email
                let resolvedClientId = '';
                if (req.email) {
                    const clientsSnap = await getDocs(
                        query(
                            collection(firestore, `tenants/${tenantId}/clients`),
                            where('email', '==', req.email.toLowerCase().trim())
                        )
                    );

                    if (!clientsSnap.empty) {
                        // Client exists — use them
                        resolvedClientId = clientsSnap.docs[0].id;
                        onClientResolved?.(resolvedClientId, false);
                    } else {
                        // Create a new client record from the inquiry contact info
                        const newClientId = nanoid();
                        const newClient = {
                            id:        newClientId,
                            name:      req.fullName || `${req.firstName || ''} ${req.lastName || ''}`.trim(),
                            email:     req.email.toLowerCase().trim(),
                            phone:     req.phone || '',
                            createdAt: new Date().toISOString(),
                            source:    'inquiry_form',
                            notes:     req.specialRequests || '',
                        };
                        await addDoc(collection(firestore, `tenants/${tenantId}/clients`), { ...newClient });
                        resolvedClientId = newClientId;
                        onClientResolved?.(resolvedClientId, true);
                        toast({
                            title: 'New Client Created',
                            description: `${newClient.name} has been added to your client roster from this inquiry.`,
                        });
                    }
                    setClientId(resolvedClientId);
                }

                // 3. Pre-fill event name
                const derivedEventName = req.eventName ||
                    `${req.firstName || ''}'s ${
                        req.eventType
                            ? req.eventType.charAt(0).toUpperCase() + req.eventType.slice(1)
                            : 'Event'
                    }`;
                setEventName(derivedEventName);

                // 4. Pre-fill event date
                if (req.eventDate) {
                    // Parse YYYY-MM-DD safely without timezone shift
                    const [y, m, d] = req.eventDate.split('-').map(Number);
                    setEventStartDate(new Date(y, m - 1, d));
                }

                // 5. Pre-fill location
                if (req.venueName || req.venueCity || req.venueState) {
                    setEventLocation({
                        street:  req.venueName || '',
                        city:    req.venueCity || '',
                        state:   req.venueState || '',
                        zip:     '',
                        country: '',
                    });
                }

                // 6. Pre-fill total hours from selected services
                if (req.estimatedHours) {
                    setTotalHours(req.estimatedHours);
                }

                // 7. Pre-fill line items from interested services
                if (req.interestedServices?.length > 0) {
                    const prefillItems: LineItem[] = req.interestedServices.map((svc: any) => ({
                        id:          svc.id || nanoid(),
                        name:        svc.name,
                        description: svc.description || '',
                        price:       svc.price || 0,
                        cost:        svc.cost || 0,
                        quantity:    req.partySize && req.partySize > 1 ? req.partySize : 1,
                    }));
                    setLineItems(prefillItems);
                }

                // 8. Pre-fill notes with all inquiry context
                const notesParts: string[] = [];
                if (req.specialRequests)    notesParts.push(`Client notes: ${req.specialRequests}`);
                if (req.customServiceNote)  notesParts.push(`Requested services: ${req.customServiceNote}`);
                if (req.inspirationLinks)   notesParts.push(`Inspiration: ${req.inspirationLinks}`);
                if (req.travelDetails)      notesParts.push(`Travel: ${req.travelDetails}`);
                if (req.budgetRange)        notesParts.push(`Budget: ${req.budgetRange}`);
                if (req.readyToDeposit)     notesParts.push('Client indicated they are ready to make a deposit.');
                if (req.referralSource)     notesParts.push(`Referred by: ${req.referralSource}`);
                if (notesParts.length > 0) {
                    setNotes(notesParts.join('\n\n'));
                }

                // 9. Mark the inquiry as quoted
                await updateDoc(doc(firestore, `tenants/${tenantId}/quoteRequests`, fromId), {
                    status:   'quoted',
                    quotedAt: new Date().toISOString(),
                });

                toast({
                    title: '✨ Quote Pre-filled',
                    description: `Loaded from ${req.fullName || req.firstName}'s inquiry. Review and adjust before sending.`,
                });

            } catch (e) {
                console.error('Prefill error:', e);
                toast({
                    variant: 'destructive',
                    title: 'Could not pre-fill',
                    description: 'The inquiry data could not be loaded. Fill in manually.',
                });
            } finally {
                setPrefilling(false);
            }
        };

        prefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromId, tenantId]);

    return { prefilling, inquiry, fromId };
};

export default useInquiryPrefill;