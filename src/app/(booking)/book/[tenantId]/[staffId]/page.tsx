

'use client';

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs } from 'firebase/firestore';
import { type Staff, type Service, Appointment, Event, ConsentForm, Tenant, Client } from '@/lib/data';
import { Loader, ArrowLeft, Clock, DollarSign, BookOpen } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { BookingSheet } from '@/components/booking/BookingSheet';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';
import { setDocumentNonBlocking } from '@/firebase';

export default function StaffDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as string;
  const staffId = params.staffId as string;
  
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch staff member
  const staffDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/staff/${staffId}`), [firestore, tenantId, staffId]);
  const { data: staffMember, isLoading: staffLoading } = useDoc<Staff>(staffDocRef);

  // Fetch all services
  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const { data: allServices, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  
  // Other data needed for BookingSheet
  const appointmentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
  const eventsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]);
  const consentFormsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);

  const { data: appointments, isLoading: appointmentsLoading } = useCollection(appointmentsQuery);
  const { data: events, isLoading: eventsLoading } = useCollection(eventsQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection(scheduleProfilesQuery);
  const { data: consentForms, isLoading: consentFormsLoading } = useCollection(consentFormsQuery);
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  const allStaffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const { data: staff, isLoading: allStaffLoading } = useCollection(allStaffQuery);


  // Filter services offered by this staff member
  const staffServices = useMemo(() => {
    if (!staffMember || !allServices) return [];
    return allServices.filter(service => staffMember.services?.includes(service.id) && !service.isPrivate);
  }, [staffMember, allServices]);

  const handleServiceSelect = (service: Service) => {
    setSelectedService(service);
    setIsSheetOpen(true);
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

  const isLoading = staffLoading || servicesLoading || appointmentsLoading || eventsLoading || scheduleProfilesLoading || consentFormsLoading || tenantLoading || allStaffLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader className="h-8 w-8 animate-spin" />
        <p className="text-muted-foreground">Loading staff profile...</p>
      </div>
    );
  }

  if (!staffMember) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Staff Member Not Found</h2>
        <p className="text-muted-foreground mt-2">The profile you're looking for doesn't exist.</p>
        <Button asChild className="mt-6">
            <Link href={`/book/${tenantId}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Booking
            </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-12">
        <Button variant="outline" asChild>
            <Link href={`/book/${tenantId}#team`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Team
            </Link>
        </Button>

      <section className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
        <Avatar className="w-40 h-40 text-5xl">
          <AvatarImage src={staffMember.avatarUrl} />
          <AvatarFallback>{staffMember.name.substring(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight">{staffMember.name}</h1>
          {staffMember.specialties && staffMember.specialties.length > 0 && (
            <p className="text-xl font-medium text-primary">{staffMember.specialties.join(' / ')}</p>
          )}
          <p className="text-muted-foreground max-w-xl">{staffMember.bio || 'A passionate professional dedicated to their craft and clients.'}</p>
        </div>
      </section>

      <Separator />

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Services by {staffMember.name.split(' ')[0]}</CardTitle>
            <CardDescription>Select a service below to start your booking.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {staffServices.length > 0 ? staffServices.map(service => (
              <div key={service.id} className="p-4 border rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-muted/50 transition-colors">
                <div className="space-y-1">
                  <h4 className="font-semibold">{service.name}</h4>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Clock className="w-4 h-4"/>{service.duration} min</span>
                    <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4"/>{service.price.toFixed(2)}</span>
                  </div>
                </div>
                <Button onClick={() => handleServiceSelect(service)}>
                  <BookOpen className="mr-2 h-4 w-4" /> Book Now
                </Button>
              </div>
            )) : (
              <p className="text-center text-muted-foreground py-8">This staff member doesn't have any public services assigned.</p>
            )}
          </CardContent>
        </Card>
      </section>
      
      {selectedService && staff && (
        <BookingSheet 
            open={isSheetOpen}
            onOpenChange={setIsSheetOpen}
            service={selectedService}
            staff={staff}
            appointments={appointments || []}
            events={events || []}
            scheduleProfiles={scheduleProfiles || []}
            services={allServices || []}
            consentForms={consentForms || []}
            tenant={tenant}
            onConfirm={handleConfirmBooking}
        />
      )}
    </div>
  );
}
