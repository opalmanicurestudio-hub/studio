
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader } from 'lucide-react';
import { appointments as initialAppointments, clients, services, type Appointment } from '@/lib/data';
import { format, addDays, subDays, startOfWeek } from 'date-fns';
import { useState, useMemo, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog } from '@/components/planner/CompleteAppointmentDialog';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import { ScrollArea } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { Badge } from '@/components/ui/badge';

const AppointmentItem = ({ appointment, onCompleteClick }: { appointment: Appointment; onCompleteClick: (apt: Appointment) => void; }) => {
    const client = clients.find(c => c.id === appointment.clientId);
    const service = services.find(s => s.id === appointment.serviceId);

    if (!client || !service) return null;

    const statusStyles = {
        confirmed: 'border-l-4 border-blue-500',
        completed: 'border-l-4 border-green-500',
        canceled: 'border-l-4 border-red-500 opacity-70',
        deposit_pending: 'border-l-4 border-pink-500',
    };
    
    return (
        <div className={cn("p-4 rounded-lg bg-card border flex flex-col gap-3", statusStyles[appointment.status])}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                        <AvatarImage src={client.avatarUrl} alt={client.name} />
                        <AvatarFallback>{client.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-semibold text-sm">{client.name}</p>
                        <p className="text-xs text-muted-foreground">{service.name}</p>
                    </div>
                </div>
                 <Badge variant={appointment.status === 'completed' ? 'default' : 'secondary'} className="capitalize shrink-0">{appointment.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
                {format(appointment.startTime, 'h:mm a')} - {format(appointment.endTime, 'h:mm a')}
            </div>
            {appointment.status === 'confirmed' && (
                <div className="flex gap-2 pt-2 border-t -mb-1 -mx-2 px-2">
                    <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground">Cancel</Button>
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => onCompleteClick(appointment)}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Complete
                    </Button>
                </div>
            )}
        </div>
    );
};

const DayTimeline = ({ date, appointments, onCompleteClick }: { date: Date; appointments: Appointment[]; onCompleteClick: (apt: Appointment) => void; }) => {
    const dailyTotals = useMemo(() => {
        return appointments
        .filter(apt => apt.status === 'completed')
        .reduce(
            (acc, apt) => {
            const service = services.find(s => s.id === apt.serviceId);
            if (service) {
                acc.revenue += service.price;
                acc.costs += service.cost;
                acc.net += service.profit;
            }
            return acc;
            },
            { revenue: 0, costs: 0, net: 0 }
        );
    }, [appointments]);

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-4">
                    {appointments.length > 0 ? (
                        appointments.map(apt => (
                            <AppointmentItem key={apt.id} appointment={apt} onCompleteClick={onCompleteClick} />
                        ))
                    ) : (
                        <div className="text-center pt-20 text-muted-foreground text-sm space-y-4">
                            <p>No appointments scheduled for this day.</p>
                            <Button variant="secondary">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Appointment
                            </Button>
                        </div>
                    )}
                </div>
            </div>
             {appointments.length > 0 && (
                <div className="p-2 border-t bg-background">
                    <div className="grid grid-cols-3 gap-2 w-full text-center">
                        <div className="rounded-md bg-green-500/10 p-2">
                            <p className="text-xs text-green-800/80 dark:text-green-400/80">Revenue</p>
                            <p className="font-bold text-sm text-green-800 dark:text-green-400">${dailyTotals.revenue.toFixed(2)}</p>
                        </div>
                        <div className="rounded-md bg-red-500/10 p-2">
                            <p className="text-xs text-red-800/80 dark:text-red-400/80">Costs</p>
                            <p className="font-bold text-sm text-red-800 dark:text-red-400">${dailyTotals.costs.toFixed(2)}</p>
                        </div>
                        <div className="rounded-md bg-blue-500/10 p-2">
                            <p className="text-xs text-blue-800/80 dark:text-blue-400/80">Net Profit</p>
                            <p className="font-bold text-sm text-blue-800 dark:text-blue-400">${dailyTotals.net.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default function PlannerPage() {
  const [isClient, setIsClient] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState(initialAppointments);
  const { inventory, setInventory, addStockCorrection } = useInventory();

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const { toast } = useToast();
  
  const [api, setApi] = useState<CarouselApi>()
  const [currentDayIndex, setCurrentDayIndex] = useState(0);

  useEffect(() => {
    // This effect runs only on the client, after hydration
    setIsClient(true);
    setCurrentDate(new Date());
    setCurrentDayIndex(new Date().getDay()); // Set initial day index
  }, []);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);
  
  useEffect(() => {
    if (!api) return;
    
    const handleSelect = () => {
        setCurrentDayIndex(api.selectedScrollSnap())
    }
    api.on("select", handleSelect)
    
    return () => {
      api.off("select", handleSelect)
    }
  }, [api])


  const handleCompleteClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsCheckoutOpen(true);
  };

  const handleCheckout = (updatedInventory: any, newCorrections: any) => {
    if (!selectedAppointment) return;

    setAppointments(prev => prev.map(apt => apt.id === selectedAppointment.id ? { ...apt, status: 'completed' } : apt));
    setInventory(updatedInventory);
    newCorrections.forEach(addStockCorrection);
    
    toast({
        title: "Appointment Completed",
        description: `Inventory levels have been updated and ${newCorrections.length} stock correction(s) logged.`
    });
    setIsCheckoutOpen(false);
    setSelectedAppointment(null);
  };
  
  const handleAddAppointment = (newAppointment: Omit<Appointment, 'id'>) => {
    const newAptWithId = { ...newAppointment, id: `apt-${Date.now()}` };
    setAppointments(prev => [...prev, newAptWithId].sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
    toast({
        title: "Appointment Booked",
        description: `Appointment with ${clients.find(c => c.id === newAppointment.clientId)?.name} has been added.`
    })
    setIsAddAppointmentOpen(false);
  };

  const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const handlePrevWeek = () => setCurrentDate(subDays(currentDate, 7));
  const handleToday = () => setCurrentDate(new Date());

  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment) return null;
    const client = clients.find(c => c.id === selectedAppointment.clientId);
    const service = services.find(s => s.id === selectedAppointment.serviceId);
    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment]);
  
  const currentVisibleDate = weekDays[currentDayIndex];
  
  if (!isClient) {
    return (
      <div className="flex h-full w-full flex-col">
        <AppHeader title="Planner" />
        <div className="flex items-center justify-center flex-1">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <AppHeader title="Planner" />
      <div className="flex items-center justify-between gap-4 p-4 border-b">
          <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handlePrevWeek}><ChevronLeft /></Button>
              <Button variant="outline" size="icon" onClick={handleNextWeek}><ChevronRight /></Button>
              <Button variant="outline" onClick={handleToday}>Today</Button>
          </div>
           <div className='text-center'>
               <p className='font-semibold'>{format(currentVisibleDate, 'EEEE, LLL d')}</p>
               <p className='text-xs text-muted-foreground'>{format(startOfWeek(currentDate, { weekStartsOn: 0 }), 'MMMM yyyy')}</p>
           </div>
          <Button onClick={() => setIsAddAppointmentOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add
          </Button>
      </div>
      <main className="flex-1 relative">
         <Carousel setApi={setApi} className="h-full w-full" opts={{startIndex: currentDayIndex}}>
            <CarouselContent className="h-full">
                 {weekDays.map((date, index) => {
                    const appointmentsForDay = appointments
                        .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                        .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                    return (
                        <CarouselItem key={index} className="h-full basis-full">
                            <DayTimeline date={date} appointments={appointmentsForDay} onCompleteClick={handleCompleteClick} />
                        </CarouselItem>
                    )
                 })}
            </CarouselContent>
        </Carousel>
      </main>
      {selectedAppointmentData && (
        <CompleteAppointmentDialog
            open={isCheckoutOpen}
            onOpenChange={setIsCheckoutOpen}
            appointmentData={selectedAppointmentData}
            inventory={inventory}
            onConfirmCheckout={handleCheckout}
        />
      )}
      <AddAppointmentDialog 
        open={isAddAppointmentOpen}
        onOpenChange={setIsAddAppointmentOpen}
        clients={clients}
        services={services}
        onConfirm={handleAddAppointment}
      />
    </div>
  );
}
