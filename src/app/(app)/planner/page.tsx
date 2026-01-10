
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, MoreHorizontal, DollarSign } from 'lucide-react';
import { appointments as initialAppointments, clients, services, type Appointment, events as initialEvents, type Event } from '@/lib/data';
import { format, addDays, subDays, startOfWeek, setHours, setMinutes, startOfDay } from 'date-fns';
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
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import { EventCard } from '@/components/planner/EventCard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

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

const DayTimeline = ({ date, appointments, events, onCompleteClick }: { date: Date; appointments: Appointment[]; events: Event[]; onCompleteClick: (apt: Appointment) => void; }) => {
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

    const allItems = useMemo(() => {
        return [...appointments.map(a => ({...a, itemType: 'appointment'})), ...events.map(e => ({...e, itemType: 'event'}))]
            .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
    }, [appointments, events]);

    return (
        <div className="flex flex-col h-full">
            {appointments.length > 0 && (
                <div className="p-4 border-b">
                    <Accordion type="single" collapsible>
                        <AccordionItem value="summary" className='border-0'>
                            <AccordionTrigger className='p-0 hover:no-underline text-sm font-medium'>
                                Daily Summary
                            </AccordionTrigger>
                            <AccordionContent className='pt-4'>
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
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>
            )}
            <ScrollArea className="flex-1">
                 <div className="p-4 space-y-4">
                    {allItems.length > 0 ? (
                        allItems.map(item => (
                            item.itemType === 'appointment' ? 
                            <AppointmentItem key={item.id} appointment={item as Appointment} onCompleteClick={onCompleteClick} /> :
                            <EventCard key={item.id} event={item as Event} />
                        ))
                    ) : (
                        <div className="text-center pt-20 text-muted-foreground text-sm space-y-4">
                            <p>No appointments or events scheduled for this day.</p>
                            <Button variant="secondary">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Appointment
                            </Button>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};

export default function PlannerPage() {
  const [isClient, setIsClient] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const { inventory, setInventory, addStockCorrection } = useInventory();

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const { toast } = useToast();
  
  const [api, setApi] = useState<CarouselApi>()
  const [currentDayIndex, setCurrentDayIndex] = useState(0);

  useEffect(() => {
    // This effect runs only on the client, after hydration
    setIsClient(true);
    const today = new Date();
    
    // Make appointment and event dates relative to today
    const todayAppointments = initialAppointments.map((apt, index) => {
        const daysToAdd = index - 3; // Spread appointments around today
        const newDate = addDays(today, daysToAdd);
        return {
            ...apt,
            startTime: setMinutes(setHours(startOfDay(newDate), apt.startTime.getHours()), apt.startTime.getMinutes()),
            endTime: setMinutes(setHours(startOfDay(newDate), apt.endTime.getHours()), apt.endTime.getMinutes()),
        }
    });

    const todayEvents = initialEvents.map((evt, index) => {
       const daysToAdd = index - 1;
       const newDate = addDays(today, daysToAdd);
       return {
            ...evt,
            startTime: setMinutes(setHours(startOfDay(newDate), evt.startTime.getHours()), evt.startTime.getMinutes()),
            endTime: setMinutes(setHours(startOfDay(newDate), evt.endTime.getHours()), evt.endTime.getMinutes()),
       }
    })

    setAppointments(todayAppointments);
    setEvents(todayEvents);
    setCurrentDate(today);

    // Find today's index in the initial week view
    const start = startOfWeek(today, { weekStartsOn: 0 });
    const todayIndex = Array.from({ length: 7 }, (_, i) => addDays(start, i)).findIndex(d => format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd'));
    setCurrentDayIndex(todayIndex);
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

  const handleAddEvent = (newEvent: Omit<Event, 'id'>) => {
    const newEventWithId = { ...newEvent, id: `evt-${Date.now()}` };
    setEvents(prev => [...prev, newEventWithId].sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
    toast({
        title: "Event Added",
        description: `"${newEvent.title}" has been added to your calendar.`
    })
    setIsAddEventOpen(false);
  };

  const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const handlePrevWeek = () => setCurrentDate(subDays(currentDate, 7));
  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    const start = startOfWeek(today, { weekStartsOn: 0 });
    const todayIndex = Array.from({ length: 7 }, (_, i) => addDays(start, i)).findIndex(d => format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd'));
    if (api) {
        api.scrollTo(todayIndex);
    }
  };


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
    <div className="flex h-[100dvh] w-full flex-col">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setIsAddAppointmentOpen(true)}>Add Appointment</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsAddEventOpen(true)}>Add Event</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
      <main className="flex-1 overflow-hidden">
         <Carousel setApi={setApi} className="h-full w-full" opts={{startIndex: currentDayIndex}}>
            <CarouselContent className="h-full">
                 {weekDays.map((date, index) => {
                    const appointmentsForDay = appointments
                        .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                        .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                    const eventsForDay = events
                        .filter(evt => format(evt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                        .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                    return (
                        <CarouselItem key={index} className="h-full basis-full">
                            <DayTimeline date={date} appointments={appointmentsForDay} events={eventsForDay} onCompleteClick={handleCompleteClick} />
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
      <AddEventDialog 
        open={isAddEventOpen}
        onOpenChange={setIsAddEventOpen}
        onConfirm={handleAddEvent}
      />
    </div>
  );
}
