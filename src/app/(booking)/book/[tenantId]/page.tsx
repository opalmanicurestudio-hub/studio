'use client';

import React, { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { type Service, type Staff, type Tenant, type Appointment, type Event } from '@/lib/data';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { Clock, DollarSign, Loader } from 'lucide-react';
import { BookingSheet } from '@/components/booking/BookingSheet';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { isSameDay, parseISO } from 'date-fns';

const ServiceCard = ({ service, onSelect }: { service: Service, onSelect: () => void }) => {
  return (
    <Card 
        className="cursor-pointer group transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
        onClick={onSelect}
    >
      <CardContent className="p-0">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg">
          <Image
            src={service.imageUrl || 'https://picsum.photos/seed/1/400/300'}
            alt={service.name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            data-ai-hint="manicure nails"
          />
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
  );
};


export default function BookingPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { firestore } = useFirebase();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Fetch Tenant, Services, and Staff data
  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const scheduleProfilesQuery = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]);
  const allAppointmentsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/appointments`), [firestore, tenantId]);
  const allEventsQuery = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/events`), [firestore, tenantId]);
  
  const { data: tenant, isLoading: tenantLoading } = useDoc<Tenant>(tenantDocRef);
  const { data: services, isLoading: servicesLoading } = useCollection<Service>(servicesQuery);
  const { data: staff, isLoading: staffLoading } = useCollection<Staff>(staffQuery);
  const { data: scheduleProfiles, isLoading: scheduleProfilesLoading } = useCollection<any>(scheduleProfilesQuery);
  const { data: appointmentsFromDB, isLoading: appointmentsLoading } = useCollection<Appointment>(allAppointmentsQuery);
  const { data: eventsFromDB, isLoading: eventsLoading } = useCollection<Event>(allEventsQuery);
  
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
  
  const isLoading = tenantLoading || servicesLoading || staffLoading || scheduleProfilesLoading || appointmentsLoading || eventsLoading;

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
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {(services || []).filter(s => !s.isPrivate && s.type !== 'addon').map(service => (
                <ServiceCard key={service.id} service={service} onSelect={() => handleServiceSelect(service)} />
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
            />
        )}
    </div>
  );
}
