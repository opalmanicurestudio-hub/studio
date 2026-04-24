'use client';

/**
 * useInquiryPrefill
 * ─────────────────────────────────────────────────────────────────────────────
 * Wire this into QuoteGeneratorPage (quotes/new/page.tsx).
 * Reads ?from={requestId} from the URL and populates ALL form fields.
 *
 * ADD TO quotes/new/page.tsx:
 *
 *   import { Suspense } from 'react';
 *   import { useInquiryPrefill } from '@/hooks/useInquiryPrefill';
 *
 *   // Inside SettingsPageImpl / QuoteGeneratorPage, after all useState declarations:
 *   const { prefilling } = useInquiryPrefill({
 *     tenantId,
 *     firestore,
 *     setClientId,
 *     setEventName,
 *     setEventStartDate,
 *     setEventLocation,
 *     setTotalHours,
 *     setLineItems,
 *     setNotes,
 *     setRoundTripDistance,   // from travel section
 *     setDepositAmountValue,  // from financial terms
 *     setDepositType,
 *   });
 *
 *   // Show overlay while loading:
 *   if (prefilling) return (
 *     <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
 *       <Loader className="w-10 h-10 animate-spin text-primary" />
 *       <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">
 *         Loading inquiry data...
 *       </p>
 *     </div>
 *   );
 *
 * WRAP IN SUSPENSE because useSearchParams requires it in Next.js 15:
 *   export default function QuoteNewPage() {
 *     return (
 *       <Suspense fallback={<div>Loading...</div>}>
 *         <QuoteGeneratorPage />
 *       </Suspense>
 *     );
 *   }
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    doc, getDoc, collection, getDocs, query, where, addDoc, updateDoc,
} from 'firebase/firestore';
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

    // ── Required setters (match QuoteGeneratorPage state) ──────────────────
    setClientId:       (id: string) => void;
    setEventName:      (name: string) => void;
    setEventStartDate: (date: Date | undefined) => void;
    setEventLocation:  (loc: { street: string; city: string; state: string; zip: string; country: string }) => void;
    setTotalHours:     (hours: number) => void;
    setLineItems:      (items: LineItem[]) => void;
    setNotes:          (notes: string) => void;

    // ── Optional setters — pass if your form has these ─────────────────────
    setRoundTripDistance?:  (miles: number) => void;    // travel section
    setDepositAmountValue?: (amount: number) => void;   // financial terms
    setDepositType?:        (type: 'percentage' | 'flat') => void;
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
    setRoundTripDistance,
    setDepositAmountValue,
    setDepositType,
}: PrefillOptions) => {
    const searchParams = useSearchParams();
    const { toast }    = useToast();
    const [prefilling, setPrefilling] = useState(false);
    const [inquiry,    setInquiry]    = useState<any | null>(null);

    const fromId = searchParams.get('from');

    useEffect(() => {
        if (!fromId || !tenantId || !firestore) return;

        const run = async () => {
            setPrefilling(true);
            try {
                // ── 1. Load inquiry document ───────────────────────────────
                const snap = await getDoc(
                    doc(firestore, `tenants/${tenantId}/quoteRequests`, fromId)
                );
                if (!snap.exists()) {
                    toast({
                        variant: 'destructive',
                        title: 'Inquiry not found',
                        description: 'Could not load this inquiry. It may have been deleted.',
                    });
                    return;
                }
                const req = { id: snap.id, ...snap.data() } as any;
                setInquiry(req);

                // ── 2. Find or auto-create the client ──────────────────────
                let resolvedClientId = '';
                if (req.email) {
                    const clientsSnap = await getDocs(
                        query(
                            collection(firestore, `tenants/${tenantId}/clients`),
                            where('email', '==', req.email.toLowerCase().trim())
                        )
                    );
                    if (!clientsSnap.empty) {
                        resolvedClientId = clientsSnap.docs[0].id;
                    } else {
                        // Auto-create client from inquiry contact info
                        const newClientId = nanoid();
                        await addDoc(collection(firestore, `tenants/${tenantId}/clients`), {
                            id:          newClientId,
                            name:        req.fullName || `${req.firstName || ''} ${req.lastName || ''}`.trim(),
                            email:       req.email.toLowerCase().trim(),
                            phone:       req.phone || '',
                            status:      'active',
                            source:      'inquiry_form',
                            notes:       req.specialRequests || '',
                            createdAt:   new Date().toISOString(),
                            lifetimeValue: 0,
                        });
                        resolvedClientId = newClientId;
                        toast({
                            title: 'Client auto-created',
                            description: `${req.fullName || req.firstName} has been added to your client roster.`,
                        });
                    }
                    setClientId(resolvedClientId);
                }

                // ── 3. Event name ──────────────────────────────────────────
                const eventTypeLabel = req.eventType
                    ? req.eventType.charAt(0).toUpperCase() + req.eventType.slice(1)
                    : 'Event';
                setEventName(
                    req.eventName ||
                    `${req.firstName || req.fullName?.split(' ')[0] || 'Client'}'s ${eventTypeLabel}`
                );

                // ── 4. Event date ──────────────────────────────────────────
                if (req.eventDate) {
                    const [y, m, d] = req.eventDate.split('-').map(Number);
                    setEventStartDate(new Date(y, m - 1, d));
                }

                // ── 5. Location — FIX: use full address fields ─────────────
                if (req.venueStreet || req.venueCity || req.venueName) {
                    setEventLocation({
                        street:  req.venueStreet || req.venueName || '',
                        city:    req.venueCity   || '',
                        state:   req.venueState  || '',
                        zip:     req.venueZip    || '',
                        country: '',
                    });
                }

                // ── 6. Hours from selected services ────────────────────────
                if (req.estimatedHours) {
                    setTotalHours(req.estimatedHours);
                }

                // ── 7. Line items — use party size as quantity ─────────────
                if (req.interestedServices?.length > 0) {
                    const qty = req.partySize && req.partySize > 1 ? req.partySize : 1;
                    const items: LineItem[] = req.interestedServices.map((svc: any) => ({
                        id:          svc.id || nanoid(),
                        name:        svc.name,
                        description: svc.description || '',
                        price:       svc.price  || 0,
                        cost:        svc.cost   || 0,
                        quantity:    qty,
                    }));
                    setLineItems(items);
                }

                // ── 8. Travel mileage ──────────────────────────────────────
                if (req.estimatedMiles && setRoundTripDistance) {
                    setRoundTripDistance(req.estimatedMiles);
                }

                // ── 9. Deposit from "ready to deposit" flag ────────────────
                if (req.readyToDeposit && setDepositAmountValue && setDepositType) {
                    setDepositType('percentage');
                    setDepositAmountValue(20); // default 20% retainer
                }

                // ── 10. Notes — compile everything the owner needs to see ──
                const parts: string[] = [];
                parts.push(`=== INQUIRY FROM ${(req.fullName || req.firstName || 'Client').toUpperCase()} ===`);
                parts.push(`Event: ${req.eventType || 'N/A'} · ${req.guestCount || '?'} guests · ${req.partySize || '?'} needing services`);
                if (req.budgetRange)     parts.push(`Budget: ${req.budgetRange}`);
                if (req.timeline)        parts.push(`Timeline: ${req.timeline}`);
                if (req.venueType)       parts.push(`Location type: ${req.venueType}`);
                if (req.eventLocation)   parts.push(`Venue: ${req.eventLocation}`);
                if (req.estimatedMiles)  parts.push(`Travel: ~${req.estimatedMiles} mi round trip · est. $${req.estimatedTravelCost}`);
                if (req.startTime)       parts.push(`Start time: ${req.startTime}${req.endTime ? ` → ${req.endTime}` : ''}`);
                if (req.specialRequests) parts.push(`\nClient notes:\n${req.specialRequests}`);
                if (req.customServiceNote) parts.push(`\nCustom service request:\n${req.customServiceNote}`);
                if (req.referralSource)  parts.push(`Referred by: ${req.referralSource}${req.referralCode ? ` (code: ${req.referralCode})` : ''}`);
                if (req.readyToDeposit)  parts.push('✓ Client indicated they are ready to make a deposit.');
                if (req.bestDays?.length > 0 || req.bestTimeSlot) {
                    parts.push(`Best time to reach: ${[req.bestDays?.join(', '), req.bestTimeSlot].filter(Boolean).join(' · ')}`);
                }
                if (req.inspirationImages?.length > 0) {
                    parts.push(`\nInspiration images (${req.inspirationImages.length}):\n${req.inspirationImages.join('\n')}`);
                }
                setNotes(parts.join('\n'));

                // ── 11. Mark inquiry as quoted ─────────────────────────────
                await updateDoc(
                    doc(firestore, `tenants/${tenantId}/quoteRequests`, fromId),
                    { status: 'quoted', quotedAt: new Date().toISOString() }
                );

                toast({
                    title: '✨ Quote pre-filled',
                    description: `All details loaded from ${req.fullName || req.firstName}'s inquiry. Review and adjust before sending.`,
                });

            } catch (e) {
                console.error('Prefill error:', e);
                toast({
                    variant: 'destructive',
                    title: 'Pre-fill failed',
                    description: 'Something went wrong loading the inquiry. Check the console.',
                });
            } finally {
                setPrefilling(false);
            }
        };

        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromId, tenantId]);

    return { prefilling, inquiry, fromId };
};

export default useInquiryPrefill;