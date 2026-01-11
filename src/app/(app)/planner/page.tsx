

'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer } from 'lucide-react';
import { appointments as initialAppointments, clients, services, type Appointment, events as initialEvents, type Event, type EventChecklistItem, bills as billDefinitions, type Bill } from '@/lib/data';
import { billInstances as allBillInstances } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO } from 'date-fns';
import React, { useState, useMemo, useEffect } from 'react';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
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
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { type Transaction, type BillInstance } from '@/lib/financial-data';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { BillDueDateCard } from '@/components/planner/BillDueDateCard';

const TimeIndicator = () => {
    const [top, setTop] = useState(0);

    useEffect(() => {
        const updatePosition = () => {
            const now = new Date();
            const dayStart = setHours(startOfDay(now), 8);
            const minutesFromStart = differenceInMinutes(now, dayStart);
            // Each hour is 96px (h-24). 96px / 60 minutes = 1.6px per minute.
            const newTop = minutesFromStart * 1.6;
            if (newTop >= 0) { // Only show if after 8 AM
                setTop(newTop);
            }
        };

        updatePosition(); // Initial position
        const interval = setInterval(updatePosition, 60000); // Update every minute

        return () => clearInterval(interval);
    }, []);

    if (top === 0) return null;

    return (
        <div className="absolute w-full flex items-center z-10" style={{ top: `${top}px` }}>
            <div className="h-2 w-2 rounded-full bg-red-500 -ml-1"></div>
            <div className="h-px w-full bg-red-500"></div>
        </div>
    );
};


const DayTimeline = ({ 
    date, 
    appointments, 
    events,
    billInstances,
    onCompleteClick, 
    onUpdateStatus, 
    onDeleteAppointment, 
    onPrintReceipt, 
    onEditAppointment,
    onEditEvent,
    onChecklistItemToggle,
    onUpdateEvent,
    dailyTransactions,
    onAddTransaction,
}: { 
    date: Date; 
    appointments: Appointment[]; 
    events: Event[]; 
    billInstances: (BillInstance & { definition: Bill })[];
    onCompleteClick: (apt: Appointment) => void; 
    onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void; 
    onDeleteAppointment: (appointmentId: string) => void; 
    onPrintReceipt: (appointment: Appointment) => void; 
    onEditAppointment: (appointment: Appointment) => void; 
    onEditEvent: (event: Event) => void;
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    dailyTransactions: Transaction[] | null;
    onAddTransaction: (transaction: any) => void;
}) => {
    const dailyTotals = useMemo(() => {
        const appointmentRevenue = appointments
            .filter(apt => apt.status === 'completed')
            .reduce((acc, apt) => {
                const service = services.find(s => s.id === apt.serviceId);
                return acc + (service?.price || 0);
            }, 0);

        const costs = dailyTransactions?.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0) || 0;
        
        const appointmentCosts = appointments
            .filter(apt => apt.status === 'completed')
            .reduce((acc, apt) => {
                const service = services.find(s => s.id === apt.serviceId);
                return acc + (service?.cost || 0);
            }, 0);
        
        const totalCosts = costs + appointmentCosts;
        const netProfit = appointmentRevenue - totalCosts;

        return {
            revenue: appointmentRevenue,
            costs: totalCosts,
            net: netProfit,
        };
    }, [appointments, dailyTransactions]);

    const allItems = useMemo(() => {
        return [...appointments.map(a => ({...a, itemType: 'appointment'})), ...events.map(e => ({...e, itemType: 'event'}))]
            .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
    }, [appointments, events]);

    const hours = Array.from({ length: 15 }, (_, i) => i + 8); // 8 AM to 10 PM
    const [tmhr, setTmhr] = useState(0);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        const storedTmhr = localStorage.getItem('tmhr');
        setTmhr(parseFloat(storedTmhr || '50'));
      }
    }, []);

    const renderItem = (item: any) => {
        const top = (getHours(item.startTime) - 8 + getMinutes(item.startTime) / 60) * 96;
        const height = differenceInMinutes(item.endTime, item.startTime) / 60 * 96;
        const style = { top: `${top}px`, height: `${height}px` };

        if (item.itemType === 'appointment') {
            const client = clients.find(c => c.id === item.clientId);
            const service = services.find(s => s.id === item.serviceId);
            if (!client || !service) return null;
           
            return (
                <div key={item.id} className="absolute w-full" style={style}>
                    <AppointmentCard
                        appointment={item}
                        client={client}
                        service={service}
                        tmhr={tmhr}
                        style={{ height: '100%'}}
                        onUpdateStatus={onUpdateStatus}
                        onDelete={onDeleteAppointment}
                        onCompleteClick={onCompleteClick}
                        onPrintReceipt={onPrintReceipt}
                        onEdit={onEditAppointment}
                    />
                </div>
            );
        } else { // item.itemType === 'event'
             const eventTransactions = dailyTransactions?.filter(t => t.relatedEventId === item.id) || [];
             return (
                 <div key={item.id} className="absolute w-full px-2" style={style}>
                    <EventCard 
                        event={item}
                        transactions={eventTransactions}
                        onChecklistItemToggle={onChecklistItemToggle}
                        onUpdateEvent={onUpdateEvent}
                        onEditEvent={onEditEvent}
                        onAddTransaction={onAddTransaction}
                    />
                </div>
            );
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b">
                <Accordion type="single" collapsible className="w-full" defaultValue="summary">
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
             {billInstances.length > 0 && (
                 <div className="border-b">
                     <h4 className="text-sm font-semibold mb-2 px-4 pt-4">Bills Due Today</h4>
                    <Carousel
                        opts={{
                            align: "start",
                        }}
                        className="w-full -ml-4"
                        >
                        <CarouselContent>
                            {billInstances.map(instance => (
                            <CarouselItem key={instance.id} className="pl-4 basis-full md:basis-1/2 lg:basis-1/3">
                                <div className="p-1">
                                    <BillDueDateCard instance={instance} />
                                </div>
                            </CarouselItem>
                            ))}
                        </CarouselContent>
                    </Carousel>
                </div>
            )}
            <ScrollArea className="flex-1" style={{ height: 'calc(100vh - 230px)' }}>
                <div className="relative grid grid-cols-[auto,1fr] p-4">
                    {/* Time labels */}
                    <div className="flex flex-col text-right pr-4">
                        {hours.map(hour => (
                            <div key={hour} className="h-24 -mt-2.5">
                                <span className="text-xs text-muted-foreground">{format(new Date(0, 0, 0, hour), 'ha')}</span>
                            </div>
                        ))}
                    </div>
                     {/* Calendar grid */}
                    <div className="relative">
                        {hours.map(hour => (
                           <div key={hour} className="h-24 border-t border-dashed"></div>
                        ))}

                        {isToday(date) && <TimeIndicator />}

                        {allItems.map(renderItem)}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
};

export default function PlannerPage() {
  const [isClient, setIsClient] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const billInstances = allBillInstances;

  const { inventory, setInventory, addStockCorrection } = useInventory();
  
  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc'; // Replace with dynamic tenant ID

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const { toast } = useToast();
  
  const [api, setApi] = useState<CarouselApi>()
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  
  const currentVisibleDate = useMemo(() => {
    if (!currentDate) return new Date();
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return addDays(start, currentDayIndex);
  }, [currentDate, currentDayIndex]);


  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    const dayStart = startOfDay(currentVisibleDate);
    const dayEnd = endOfDay(currentVisibleDate);
    return query(
        collection(firestore, 'tenants', tenantId, 'transactions'),
        where('date', '>=', Timestamp.fromDate(dayStart)),
        where('date', '<=', Timestamp.fromDate(dayEnd))
    );
  }, [firestore, user, currentVisibleDate, tenantId]);

  const { data: dailyTransactions, isLoading: transactionsLoading } = useCollection<Transaction>(transactionsQuery);


  useEffect(() => {
    const today = new Date();
    const start = startOfWeek(today, { weekStartsOn: 0 });
    const todayIndex = Array.from({ length: 7 }, (_, i) => addDays(start, i)).findIndex(d => format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd'));
    
    setCurrentDate(today);
    setCurrentDayIndex(todayIndex >= 0 ? todayIndex : 0);
    setIsClient(true);
  }, []);

  const weekDays = useMemo(() => {
    if (!currentDate) return [];
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

  const handleEditClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsEditAppointmentOpen(true);
  };
  
  const handleEditEventClick = (event: Event) => {
    setSelectedEvent(event);
    setIsEditEventOpen(true);
  }

  const handleCheckout = (updatedInventory: any, newCorrections: any) => {
    if (!selectedAppointment) return;

    const completedAppointment = { ...selectedAppointment, status: 'completed' as const };
    setAppointments(prev => prev.map(apt => apt.id === selectedAppointment.id ? completedAppointment : apt));
    setInventory(updatedInventory);
    newCorrections.forEach(addStockCorrection);
    
    toast({
        title: "Appointment Completed",
        description: `Inventory levels have been updated and ${newCorrections.length} stock correction(s) logged.`
    });
    setIsCheckoutOpen(false); 
    setSelectedAppointment(null);
    handlePrintReceipt(completedAppointment);
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

  const handleUpdateAppointment = (updatedAppointment: Appointment) => {
    setAppointments(prev => prev.map(apt => apt.id === updatedAppointment.id ? updatedAppointment : apt));
    toast({
        title: "Appointment Updated",
        description: `The appointment has been successfully updated.`
    })
    setIsEditAppointmentOpen(false);
  };

  const handleAddEvent = (newEvent: Omit<Event, 'id'>) => {
    const newEventWithId = { ...newEvent, id: `evt-${Date.now()}` };
    if (newEvent.cost && newEvent.cost > 0 && newEvent.type !== 'blocked') {
        const newTransaction = {
            description: `Expense for: ${newEvent.title}`,
            clientOrVendor: 'N/A',
            type: 'expense' as const,
            context: newEvent.type === 'business' ? 'Business' : 'Personal',
            category: newEvent.type === 'business' ? 'Business Travel' : 'Personal Travel',
            amount: newEvent.cost,
            paymentMethod: 'Unknown',
            hasReceipt: false,
            relatedEventId: newEventWithId.id
        };
        handleAddTransaction(newTransaction)
    }

    setEvents(prev => [...prev, newEventWithId].sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
    toast({
        title: "Event Added",
        description: `"${newEvent.title}" has been added to your calendar.`
    });
    setIsAddEventOpen(false);
  };

    const handleUpdateEvent = (updatedEvent: Event) => {
        setEvents(prev => prev.map(e => e.id === updatedEvent.id ? updatedEvent : e));
        toast({
            title: "Event Updated",
            description: `"${updatedEvent.title}" has been updated.`
        });
        setIsEditEventOpen(false);
    }
    
    const handleAddTransaction = (transaction: Omit<Transaction, 'id' | 'date'>) => {
        if (!firestore || !user) {
            toast({
                variant: 'destructive',
                title: 'Authentication Error',
                description: 'You must be logged in to log an expense.',
            });
            return;
        }
        const transactionRef = collection(firestore, 'tenants', tenantId, 'transactions');
        const newTransaction = {
            ...transaction,
            date: Timestamp.fromDate(currentVisibleDate),
        };
        addDocumentNonBlocking(transactionRef, newTransaction);
        toast({
            title: "Expense Logged",
            description: `An expense of $${transaction.amount.toFixed(2)} for "${transaction.description}" has been recorded in your ledger.`
        });
    }

  const handleUpdateStatus = (appointmentId: string, status: Appointment['status']) => {
    if (status === 'completed') {
        const appointmentToComplete = appointments.find(apt => apt.id === appointmentId);
        if (appointmentToComplete) {
            handleCompleteClick(appointmentToComplete);
        }
    } else {
        setAppointments(prev => prev.map(apt => apt.id === appointmentId ? { ...apt, status } : apt));
        toast({
            title: "Status Updated",
            description: `Appointment status changed to ${status}.`
        });
    }
  };

  const handleDeleteAppointment = (appointmentId: string) => {
    setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
     toast({
        variant: "destructive",
        title: "Appointment Deleted",
        description: `The appointment has been removed from your calendar.`
    });
  };
  
  const handleChecklistItemToggle = (eventId: string, checklistItemId: string, completed: boolean) => {
      setEvents(prevEvents => prevEvents.map(event => {
          if (event.id === eventId) {
              const updatedChecklist = event.checklist?.map(item => 
                  item.id === checklistItemId ? { ...item, completed } : item
              );
              return { ...event, checklist: updatedChecklist };
          }
          return event;
      }));
  };

  const handleNextWeek = () => {
    if (currentDate) {
        setCurrentDate(addDays(currentDate, 7));
    }
  };
  const handlePrevWeek = () => {
    if (currentDate) {
      setCurrentDate(subDays(currentDate, 7));
    }
  };
  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    const start = startOfWeek(today, { weekStartsOn: 0 });
    const todayIndex = Array.from({ length: 7 }, (_, i) => addDays(start, i)).findIndex(d => format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd'));
    if (api && todayIndex >= 0) {
        api.scrollTo(todayIndex);
    }
  };


  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment) return null;
    const client = clients.find(c => c.id === selectedAppointment.clientId);
    const service = services.find(s => s.id === selectedAppointment.serviceId);
    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment]);
  
  const handlePrintReceipt = (appointment: Appointment) => {
    const client = clients.find(c => c.id === appointment.clientId);
    const service = services.find(s => s.id === appointment.serviceId);
    if (!client || !service) return;

    const subtotal = service.price;
    const mockTax = subtotal * 0.07;
    const total = subtotal + mockTax;

    const receiptData: ReceiptData = {
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        clientName: client.name,
        date: appointment.endTime,
        items: [{ name: service.name, quantity: 1, price: service.price }],
        subtotal: subtotal,
        tax: mockTax,
        total: total,
        payment: { // Assuming cash for simplicity, this would need to be stored
            method: 'Cash',
            amountTendered: total,
            changeDue: 0,
        }
    };
    setReceiptToPrint(receiptData);
  }

  
  if (!isClient || !currentDate) {
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
    <div className="flex h-screen w-full flex-col overflow-hidden">
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
      
      {/* Day navigation for desktop */}
      <div className="hidden md:flex items-center justify-between gap-2 p-2 border-b bg-muted/50">
        {weekDays.map((day, index) => (
            <Button 
                key={index} 
                variant={currentDayIndex === index ? 'secondary' : 'ghost'}
                className="flex-1 flex-col h-auto py-2"
                onClick={() => api?.scrollTo(index)}
            >
                <span className="text-xs">{format(day, 'EEE')}</span>
                <span className="text-lg font-bold">{format(day, 'd')}</span>
            </Button>
        ))}
      </div>

      <main className="flex-1 overflow-hidden">
         <Carousel setApi={setApi} className="h-full w-full" opts={{startIndex: currentDayIndex, align: 'start' }}>
            <CarouselContent className="h-full">
                 {weekDays.map((date, index) => {
                    const appointmentsForDay = appointments
                        .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                        .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                    const eventsForDay = events
                        .filter(evt => format(evt.startTime, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                        .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                     const billsForDay = billInstances
                        .filter(instance => format(parseISO(instance.dueDate), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
                        .map(instance => {
                            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
                            return { ...instance, definition: definition! };
                        })
                        .filter(item => item.definition);
                    return (
                        <CarouselItem key={index} className="h-full basis-full">
                            <DayTimeline 
                                date={date} 
                                appointments={appointmentsForDay} 
                                events={eventsForDay} 
                                billInstances={billsForDay}
                                onCompleteClick={handleCompleteClick} 
                                onUpdateStatus={handleUpdateStatus} 
                                onDeleteAppointment={handleDeleteAppointment} 
                                onPrintReceipt={handlePrintReceipt} 
                                onEditAppointment={handleEditClick}
                                onEditEvent={handleEditEventClick}
                                onChecklistItemToggle={handleChecklistItemToggle}
                                onUpdateEvent={handleUpdateEvent}
                                dailyTransactions={dailyTransactions}
                                onAddTransaction={handleAddTransaction}
                            />
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
            onConfirmCheckout={handleCheckout}
        />
      )}
      <AddAppointmentDialog 
        open={isAddAppointmentOpen}
        onOpenChange={setIsAddAppointmentOpen}
        clients={clients}
        services={services}
        appointments={appointments}
        onConfirm={handleAddAppointment}
      />
       {selectedAppointment && (
        <EditAppointmentDialog 
            open={isEditAppointmentOpen}
            onOpenChange={setIsEditAppointmentOpen}
            appointment={selectedAppointment}
            clients={clients}
            services={services}
            appointments={appointments}
            onConfirm={handleUpdateAppointment}
        />
       )}
      <AddEventDialog 
        open={isAddEventOpen}
        onOpenChange={setIsAddEventOpen}
        onConfirm={handleAddEvent}
      />
       {selectedEvent && (
        <EditEventDialog
            open={isEditEventOpen}
            onOpenChange={setIsEditEventOpen}
            event={selectedEvent}
            onConfirm={handleUpdateEvent}
        />
       )}
      <Dialog open={!!receiptToPrint} onOpenChange={(open) => !open && setReceiptToPrint(null)}>
        <DialogContent className="max-w-sm print-content">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          <div id="receipt-area">
            {receiptToPrint && <PrintReceipt data={receiptToPrint} />}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setReceiptToPrint(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}




