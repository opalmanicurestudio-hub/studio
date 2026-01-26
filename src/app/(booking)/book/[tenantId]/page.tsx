

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useCollection, useMemoFirebase, useDoc, addDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, query, where, getDocs } from 'firebase/firestore';
import { type Service, type Staff, type Tenant, type Appointment, type Event, type ConsentForm, type Client, memberships, packages, type Membership, type Package } from '@/lib/data';
import { Loader, ArrowDown } from 'lucide-react';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { isSameDay, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import { AnimatePresence, motion } from 'framer-motion';

import { BookingHeader } from '@/components/booking/BookingHeader';
import { BookingGallery } from '@/components/booking/BookingGallery';
import { BookingServices } from '@/components/booking/BookingServices';
import { BookingTeam } from '@/components/booking/BookingTeam';
import { BookingReviews } from '@/components/booking/BookingReviews';
import { BookingPolicies } from '@/components/booking/BookingPolicies';
import { Button } from '@/components/ui/button';
import { BookingFAQ } from '@/components/booking/BookingFAQ';
import { BookingContact } from '@/components/booking/BookingContact';
import { BookingWelcome } from '@/components/booking/BookingWelcome';
import { BookingMemberships } from '@/components/booking/BookingMemberships';
import { BookingPackages } from '@/components/booking/BookingPackages';
import { PurchaseSheet } from '@/components/booking/PurchaseSheet';

export default function BookingPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as string;
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [entered, setEntered] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [itemToPurchase, setItemToPurchase] = useState<Membership | Package | null>(null);
  const [purchaseType, setPurchaseType] = useState<'membership' | 'package' | null>(null);
  const [isPurchaseSheetOpen, setIsPurchaseSheetOpen] = useState(false);

  // Fetch Tenant, Services, and Staff data
  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]);
  const allAppointmentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
  const allEventsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
  const consentFormsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
  const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(allAppointmentsQuery);
  const { data: eventsFromDB, isLoading: eventsLoading } = useCollection<Event>(allEventsQuery);
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection<ConsentForm>(consentFormsQuery);
  
  const appointments = useMemo(() => {
    if (!appointmentsFromDB) return [];
    return appointmentsFromDB.map(apt => ({
      ...apt,
      startTime: (apt.startTime as any)?.toDate ? (apt.startTime as any).toDate() : parseISO(apt.startTime as any),
      endTime: (apt.endTime as any)?.toDate ? (apt.endTime as any).toDate() : parseISO(apt.endTime as any),
    }));
  }, [appointmentsFromDB]);

  const events = useMemo(() => {
    if (!eventsFromDB) return [];
    return eventsFromDB.map(evt => ({
        ...evt,
        startTime: (evt.startTime as any)?.toDate ? (evt.startTime as any).toDate() : parseISO(evt.startTime as any),
        endTime: (evt.endTime as any)?.toDate ? (evt.endTime as any).toDate() : parseISO(evt.endTime as any),
    }));
  }, [eventsFromDB]);

  const handleServiceSelect = (service: Service) => {
    setSelectedService(service);
    setIsSheetOpen(true);
  };

  const handlePurchase = (item: Membership | Package, type: 'membership' | 'package') => {
    setItemToPurchase(item);
    setPurchaseType(type);
    setIsPurchaseSheetOpen(true);
  };
  
  const handleConfirmBooking = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'>,
    setBookingStep: (step: string) => void
  ) => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
        const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
        const q = query(clientsRef, where("email", "==", formData.clientEmail.toLowerCase()));
        const querySnapshot = await getDocs(q);

        let clientId: string;
        let clientName: string = formData.clientName;

        if (querySnapshot.empty) {
            const newClientRef = doc(clientsRef);
            clientId = newClientRef.id;
            const newClient: Omit<Client, 'id'> = {
                name: formData.clientName,
                email: formData.clientEmail,
                phone: formData.clientPhone || '',
                avatarUrl: `https://picsum.photos/seed/${clientId}/100/100`,
                lifetimeValue: 0,
                lastAppointment: new Date().toISOString(),
                status: 'active',
            };
            await setDocumentNonBlocking(newClientRef, { ...newClient, id: clientId });
            toast({ title: "Welcome!", description: "A new client profile has been created for you." });
        } else {
            const existingClientDoc = querySnapshot.docs[0];
            clientId = existingClientDoc.id;
            clientName = existingClientDoc.data().name;
        }

        const appointmentRef = collection(firestore, `tenants/${tenantId}/appointments`);
        const newAppointmentId = nanoid();
        const checkInToken = nanoid(16);

        const newAppointment = {
            ...appointmentDetails,
            id: newAppointmentId,
            clientId: clientId,
            clientName: clientName,
            clientEmail: formData.clientEmail,
            clientPhone: formData.clientPhone,
            checkInToken: checkInToken,
        };

        await setDocumentNonBlocking(doc(appointmentRef, newAppointmentId), newAppointment);

        const checkInDocRef = doc(firestore, 'appointmentCheckIns', checkInToken);
        await setDocumentNonBlocking(checkInDocRef, newAppointment);
        
        toast({
          title: 'Booking Confirmed!',
          description: `Your appointment is all set.`,
        });
        setBookingStep('confirmation');

    } catch (error) {
        console.error("Booking error:", error);
        toast({ variant: 'destructive', title: "Booking Failed", description: "Could not save your appointment. Please try again." });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleConfirmPurchase = async (formData: { clientName: string; clientEmail: string; clientPhone?: string }, item: Membership | Package, type: 'membership' | 'package') => {
    if (!firestore) return;
    setIsSubmitting(true);
    try {
      const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
      const q = query(clientsRef, where("email", "==", formData.clientEmail.toLowerCase()));
      const querySnapshot = await getDocs(q);

      let clientId: string;
      let client: Client;

      if (querySnapshot.empty) {
        const newClientRef = doc(clientsRef);
        clientId = newClientRef.id;
        const newClientData: Omit<Client, 'id'> = {
            name: formData.clientName,
            email: formData.clientEmail,
            phone: formData.clientPhone || '',
            avatarUrl: `https://picsum.photos/seed/${clientId}/100/100`,
            lifetimeValue: item.price,
            lastAppointment: new Date().toISOString(),
            status: 'active',
        };
        client = { ...newClientData, id: clientId };
        await setDocumentNonBlocking(newClientRef, client);
        toast({ title: "Welcome!", description: "A new client profile has been created for you." });
      } else {
        const existingClientDoc = querySnapshot.docs[0];
        clientId = existingClientDoc.id;
        client = existingClientDoc.data() as Client;
        const clientDocRef = doc(firestore, 'tenants', tenantId, 'clients', clientId);
        await updateDocumentNonBlocking(clientDocRef, { lifetimeValue: (client.lifetimeValue || 0) + item.price });
      }
      
      const clientDocRef = doc(firestore, 'tenants', tenantId, 'clients', clientId);

      if (type === 'membership') {
          await updateDocumentNonBlocking(clientDocRef, { activeMembershipId: item.id });
      } else { // package
          const existingPackages = client.activePackages || [];
          const newPackage = {
              packageId: item.id,
              sessionsRemaining: (item as Package).sessions
          };
          await updateDocumentNonBlocking(clientDocRef, { activePackages: [...existingPackages, newPackage] });
      }

      const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
      const newTransaction = {
          date: new Date().toISOString(),
          description: `Purchase: ${item.name}`,
          clientOrVendor: client.name,
          type: 'income' as const,
          context: 'Business' as const,
          category: type === 'membership' ? 'Membership Sales' : 'Package Sales',
          amount: item.price,
          paymentMethod: 'Card Online',
          hasReceipt: true,
      };
      await addDocumentNonBlocking(transactionsRef, newTransaction);


      toast({
        title: 'Purchase Successful!',
        description: `Your ${type} is now active.`,
      });
      setIsPurchaseSheetOpen(false);

    } catch (error) {
        console.error("Purchase error:", error);
        toast({ variant: 'destructive', title: "Purchase Failed", description: "Could not complete your purchase. Please try again." });
    } finally {
        setIsSubmitting(false);
    }
  };


  const isLoading = tenantLoading || servicesLoading || staffLoading || scheduleProfilesLoading || appointmentsLoading || eventsLoading || consentFormsLoading;

  if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <Loader className="h-8 w-8 animate-spin" />
            <p className="text-muted-foreground">Loading booking page...</p>
        </div>
      )
  }

  return (
    <div className="w-full">
        <AnimatePresence>
            {!entered && (
                <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.5 }}
                    className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center text-center p-4"
                >
                    <BookingHeader tenant={tenant} />
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5, duration: 0.5 }}
                    >
                        <Button size="lg" onClick={() => setEntered(true)}>
                            Book Now
                        </Button>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1, duration: 1 }}
                        className="absolute bottom-10"
                    >
                        <ArrowDown className="w-6 h-6 animate-bounce text-muted-foreground" />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

        <AnimatePresence>
        {entered && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="space-y-20"
            >
                <BookingHeader tenant={tenant} />
                <BookingWelcome tenant={tenant} />
                <BookingServices services={services || []} onServiceSelect={handleServiceSelect} />
                <BookingMemberships memberships={memberships || []} onPurchase={(item) => handlePurchase(item, 'membership')} />
                <BookingPackages packages={packages || []} services={services || []} onPurchase={(item) => handlePurchase(item, 'package')} />
                <BookingTeam tenantId={tenantId} staff={staff || []} />
                <BookingFAQ />
                <BookingReviews />
                <BookingGallery />
                <BookingContact tenant={tenant} />
                <BookingPolicies tenant={tenant} />
            </motion.div>
        )}
        </AnimatePresence>
      

        {selectedService && (
            <BookingSheet 
                open={isSheetOpen}
                onOpenChange={setIsSheetOpen}
                service={selectedService}
                staff={staff || []}
                appointments={appointments || []}
                events={events || []}
                scheduleProfiles={scheduleProfiles || []}
                services={services || []}
                consentForms={consentForms || []}
                tenant={tenant || null}
                onConfirm={handleConfirmBooking}
            />
        )}
        {itemToPurchase && purchaseType && (
            <PurchaseSheet
                open={isPurchaseSheetOpen}
                onOpenChange={setIsPurchaseSheetOpen}
                item={itemToPurchase}
                type={purchaseType}
                onConfirm={handleConfirmPurchase}
            />
        )}
    </div>
  );
}
