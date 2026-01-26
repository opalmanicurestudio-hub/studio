

'use client';

import React, { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useCollection, useMemoFirebase, useDoc, addDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase';
import { collection, doc, query, where, getDocs } from 'firebase/firestore';
import { type Service, type Staff, type Tenant, type Appointment, type Event, type ConsentForm, type Client } from '@/lib/data';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { Clock, DollarSign, Loader, Scissors, Palette, Droplet } from 'lucide-react';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { isSameDay, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"


const getCategoryIcon = (category?: string) => {
    switch(category?.toLowerCase()) {
        case 'hair': return <Scissors className="w-8 h-8 text-primary/70" />;
        case 'color': return <Palette className="w-8 h-8 text-primary/70" />;
        case 'skincare': return <Droplet className="w-8 h-8 text-primary/70" />;
        default: return <Scissors className="w-8 h-8 text-primary/70" />;
    }
}

const ServiceCard = ({ service, onSelect }: { service: Service, onSelect: () => void }) => {
    return (
      <div 
          className="cursor-pointer group"
          onClick={onSelect}
      >
        <Card className="overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
            <CardContent className="p-0">
            <div className="relative aspect-[4/3] w-full bg-muted/30 flex items-center justify-center">
                {service.imageUrl ? (
                    <Image
                    src={service.imageUrl}
                    alt={service.name}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    getCategoryIcon(service.category)
                )}
            </div>
            <div className="p-4 space-y-2">
                <h3 className="font-semibold truncate">{service.name}</h3>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span>{service.duration} min</span>
                    </div>
                    <div className="flex items-center gap-2 font-medium text-foreground">
                        <DollarSign className="w-4 h-4" />
                        <span>{service.price.toFixed(2)}</span>
                    </div>
                </div>
            </div>
            </CardContent>
        </Card>
      </div>
    );
};


export default function BookingPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const servicesByCategory = useMemo(() => {
    if (!services) return {};
    return services
        .filter(s => !s.isPrivate && s.type !== 'addon')
        .reduce((acc, service) => {
            const category = service.category || 'Other Services';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(service);
            return acc;
        }, {} as Record<string, Service[]>);
  }, [services]);

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
       <header className="mb-8 text-center">
          <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
            <ClarityFlowLogo />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{tenant?.name || 'ClarityFlow Salon'}</h1>
          <p className="text-muted-foreground">Select a service to begin booking</p>
        </header>
        
        <div className="space-y-12">
          {Object.keys(servicesByCategory).sort().map(category => (
            <div key={category}>
                <h2 className="text-2xl font-bold mb-4">{category}</h2>
                 <Carousel
                    opts={{
                        align: "start",
                        dragFree: true,
                    }}
                    className="w-full"
                    >
                    <CarouselContent>
                        {servicesByCategory[category].map((service) => (
                        <CarouselItem key={service.id} className="basis-full sm:basis-1/2 md:basis-1/3">
                            <ServiceCard service={service} onSelect={() => handleServiceSelect(service)} />
                        </CarouselItem>
                        ))}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex" />
                    <CarouselNext className="hidden sm:flex" />
                </Carousel>
            </div>
          ))}
        </div>

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
    </div>
  );
}
