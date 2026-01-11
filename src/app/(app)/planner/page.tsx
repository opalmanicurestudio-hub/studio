

'use client';

import { AppHeaderClient } from '@/components/shared/AppHeaderClient';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle } from 'lucide-react';
import { appointments as initialAppointments, clients, services, type Appointment, events as initialEvents, type Event, type EventChecklistItem } from '@/lib/data';
import { billInstances as allBillInstances, billDefinitions, type Bill } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval } from 'date-fns';
import React, { useState, useMemo, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog } from '@/components/planner/CompleteAppointmentDialog';
import { useInventory } from '@/context/InventoryContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { type Transaction, type BillInstance } from '@/lib/financial-data';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { BillDueDateCard } from '@/components/planner/BillDueDateCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EventCard } from '@/components/planner/EventCard';


const TimeIndicator = () => {
    const [top, setTop] = useState(0);

    useEffect(() => {
        const updatePosition = () => {
            const now = new Date();
            const dayStart = setHours(startOfDay(now), 8);
            const minutesFromStart = differenceInMinutes(now, dayStart);
            const newTop = minutesFromStart * (160 / 60); // 160px is h-40
            if (newTop >= 0) {
                setTop(newTop);
            }
        };

        updatePosition();
        const interval = setInterval(updatePosition, 60000);

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
        const dayStart = setHours(startOfDay(date), 8);
        
        if (item.itemType === 'appointment') {
            const service = services.find(s => s.id === item.serviceId);
            if (!service) return null;

            const padBefore = service.padBefore || 0;
            const padAfter = service.padAfter || 0;
            const totalDuration = service.duration + padBefore + padAfter;
            
            const actualStartTime = subMinutes(item.startTime, padBefore);
            const minutesFromStart = differenceInMinutes(actualStartTime, dayStart);
            
            const top = minutesFromStart * (160/60);
            const height = totalDuration * (160/60);

            const style = { top: `${top}px`, height: `${height}px` };

            const client = clients.find(c => c.id === item.clientId);
            if (!client) return null;
           
            return (
                <div key={item.id} className="absolute w-full pr-2" style={style}>
                    <AppointmentCard
                        appointment={item}
                        client={client}
                        service={service}
                        style={{ height: '100%'}}
                        tmhr={tmhr}
                        onUpdateStatus={onUpdateStatus}
                        onDelete={onDeleteAppointment}
                        onCompleteClick={onCompleteClick}
                        onPrintReceipt={onPrintReceipt}
                        onEdit={onEditAppointment}
                    />
                </div>
            );
        } else { // item.itemType === 'event'
             const minutesFromStart = differenceInMinutes(item.startTime, dayStart);
             const top = minutesFromStart * (160/60);
             const height = differenceInMinutes(item.endTime, item.startTime) * (160/60);
             const style = { top: `${top}px`, height: `${height}px` };

             const eventTransactions = dailyTransactions?.filter(t => t.relatedEventId === item.id) || [];
             return (
                 <div key={item.id} className="absolute w-full pr-2" style={style}>
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
            <Accordion type="single" collapsible className="w-full border-b">
                <AccordionItem value="item-1">
                    <AccordionTrigger className="p-4 font-semibold text-sm">
                        Daily Financial Summary
                    </AccordionTrigger>
                    <AccordionContent>
                         <div className="p-4 pt-0 grid grid-cols-3 gap-2">
                            <div className="rounded-md bg-green-500/10 p-2 text-center">
                                <p className="text-xs text-green-800/80 dark:text-green-400/80">Revenue</p>
                                <p className="font-bold text-lg text-green-800 dark:text-green-400">${dailyTotals.revenue.toFixed(2)}</p>
                            </div>
                            <div className="rounded-md bg-red-500/10 p-2 text-center">
                                <p className="text-xs text-red-800/80 dark:text-red-400/80">Costs</p>
                                <p className="font-bold text-lg text-red-800 dark:text-red-400">${dailyTotals.costs.toFixed(2)}</p>
                            </div>
                            <div className="rounded-md bg-blue-500/10 p-2 text-center">
                                <p className="text-xs text-blue-800/80 dark:text-blue-400/80">Net Profit</p>
                                <p className="font-bold text-lg text-blue-800 dark:text-blue-400">${dailyTotals.net.toFixed(2)}</p>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
            

            <ScrollArea className="flex-1">
                <div className="grid grid-cols-[auto,1fr] p-4">
                    {/* Time labels */}
                    <div className="flex flex-col text-right pr-4">
                        {hours.map(hour => (
                            <div key={hour} className="h-40 flex items-start">
                                <span className="text-xs text-muted-foreground">{format(new Date(0, 0, 0, hour), 'ha')}</span>
                            </div>
                        ))}
                    </div>
                     {/* Calendar grid */}
                    <div className="relative">
                        {hours.map(hour => (
                           <div key={hour} className="h-40 border-t border-dashed"></div>
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
  const isMobile = useIsMobile();
  const [isClient, setIsClient] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [events, setEvents] = useState<Event[]>(initialEvents);
  
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
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);

  useEffect(() => {
    setCurrentDate(new Date());
    setIsClient(true);
  }, []);

  const weekDays = useMemo(() => {
    if (!currentDate) return [];
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !currentDate) return null;
    const dayStart = startOfDay(currentDate);
    const dayEnd = endOfDay(currentDate);
    return query(
        collection(firestore, 'tenants', tenantId, 'transactions'),
        where('date', '>=', Timestamp.fromDate(dayStart)),
        where('date', '<=', Timestamp.fromDate(dayEnd))
    );
  }, [firestore, user, currentDate, tenantId]);

  const { data: dailyTransactions, isLoading: transactionsLoading } = useCollection<Transaction>(transactionsQuery);

  const billInstances = useMemo(() => {
    if (!currentDate) return [];
    return allBillInstances
        .filter(instance => format(parseISO(instance.dueDate), 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd'))
        .map(instance => {
            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
            return { ...instance, definition: definition! };
        })
        .filter(item => item.definition);
  }, [currentDate]);

  const weeklyKpis = useMemo(() => {
    if (!currentDate) return { weeklyRevenue: 0, projectedRevenue: 0, weeklyBreakEven: 0, weeklyNetProfit: 0, absorbedCosts: 0 };
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    const end = endOfDay(addDays(start, 6));
    const weekInterval = { start, end };
    
    const appointmentsInWeek = appointments.filter(apt => 
        apt.startTime >= weekInterval.start && apt.startTime <= weekInterval.end
    );

    const completedAppointments = appointmentsInWeek.filter(apt => apt.status === 'completed');
    const confirmedAppointments = appointmentsInWeek.filter(apt => apt.status === 'confirmed');

    const weeklyRevenue = completedAppointments.reduce((acc, apt) => {
        const service = services.find(s => s.id === apt.serviceId);
        return acc + (service?.price || 0);
    }, 0);
    
    const projectedRevenue = weeklyRevenue + confirmedAppointments.reduce((acc, apt) => {
        const service = services.find(s => s.id === apt.serviceId);
        return acc + (service?.price || 0);
    }, 0);
    
    const weeklyCosts = completedAppointments.reduce((acc, apt) => {
        const service = services.find(s => s.id === apt.serviceId);
        return acc + (service?.cost || 0);
    }, 0);
    
    const monthlyCosts = billDefinitions.reduce((acc, bill) => {
        if (bill.billingCycle === 'monthly') return acc + bill.amount;
        if (bill.billingCycle === 'weekly') return acc + (bill.amount * 4);
        if (bill.billingCycle === 'quarterly') return acc + (bill.amount / 3);
        if (bill.billingCycle === 'annually') return acc + (bill.amount / 12);
        return acc;
    }, 0);

    const absorbedCosts = completedAppointments.reduce((acc, apt) => acc + (apt.absorbedCost || 0), 0);

    return {
        weeklyRevenue: weeklyRevenue,
        projectedRevenue: projectedRevenue,
        weeklyBreakEven: monthlyCosts / 4,
        weeklyNetProfit: weeklyRevenue - weeklyCosts,
        absorbedCosts: absorbedCosts,
    }
  }, [currentDate, appointments]);


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

  const handleCheckout = (updatedInventory: any, newCorrections: any, absorbedCost: number) => {
    if (!selectedAppointment) return;

    const completedAppointment: Appointment = { 
        ...selectedAppointment, 
        status: 'completed' as const,
        absorbedCost: absorbedCost
    };
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
    const newAptWithId = { ...newAppointment, id: `apt-${Date.now()}`, absorbedCost: 0 };
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
        if (!firestore || !user || !currentDate) {
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
            date: Timestamp.fromDate(currentDate),
        };
        addDocumentNonBlocking(transactionRef, newTransaction);
        toast({
            title: "Expense Logged",
            description: `An expense of $${transaction.amount.toFixed(2)} for "${transaction.description}" has been recorded in your ledger.`
        });
    }

  const handleUpdateStatus = (appointmentId: string, status: Appointment['status']) => {
    setAppointments(prev => prev.map(apt => apt.id === appointmentId ? { ...apt, status } : apt));
    toast({
        title: "Status Updated",
        description: `Appointment status changed to ${status}.`
    });
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

  const handleNextDay = () => {
    if (currentDate) setCurrentDate(addDays(currentDate, 1));
  };
  const handlePrevDay = () => {
    if (currentDate) setCurrentDate(subDays(currentDate, 1));
  };
  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleDayClick = (day: Date) => {
    setCurrentDate(day);
  }

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

  const appointmentsForDay = appointments
      .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(currentDate || new Date(), 'yyyy-MM-dd'))
      .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
  const eventsForDay = events
      .filter(evt => format(evt.startTime, 'yyyy-MM-dd') === format(currentDate || new Date(), 'yyyy-MM-dd'))
      .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
  
  if (!isClient || !currentDate) {
    return (
      <div className="flex h-screen w-full flex-col">
        <AppHeaderClient title="Planner" />
        <div className="flex items-center justify-center flex-1">
          <Loader className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeaderClient title="Planner" />
      
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 border-b">
          <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handlePrevDay}><ChevronLeft /></Button>
              <Button variant="outline" size="icon" onClick={handleNextDay}><ChevronRight /></Button>
              <Button variant="outline" onClick={handleToday}>Today</Button>
          </div>
          <div className="flex-1 text-center">
              <p className='text-lg font-semibold'>{format(currentDate, 'EEEE, LLL d')}</p>
          </div>
          <div className="flex items-center gap-2">
               <Dialog>
                   <DialogTrigger asChild>
                      <Button variant="outline"><BarChart className="w-4 h-4 mr-2" /> KPIs</Button>
                  </DialogTrigger>
                   <DialogContent className="max-w-4xl">
                      <DialogHeader>
                          <DialogTitle>This Week's Financials</DialogTitle>
                          <DialogDescription>A summary of your performance for the week of {format(startOfWeek(currentDate, { weekStartsOn: 0 }), 'MMM d')}.</DialogDescription>
                      </DialogHeader>
                       <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-4">
                          <Card>
                              <CardHeader className="pb-2">
                                  <CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="w-4 h-4"/>Revenue</CardTitle>
                              </CardHeader>
                              <CardContent>
                                  <p className="text-2xl font-bold">${weeklyKpis.weeklyRevenue.toFixed(2)}</p>
                                  <p className='text-xs text-muted-foreground'>From completed appointments.</p>
                              </CardContent>
                          </Card>
                          <Card>
                              <CardHeader className="pb-2">
                                  <CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="w-4 h-4"/>Projected</CardTitle>
                              </CardHeader>
                              <CardContent>
                                  <p className="text-2xl font-bold">${weeklyKpis.projectedRevenue.toFixed(2)}</p>
                                  <p className='text-xs text-muted-foreground'>Includes confirmed bookings.</p>
                              </CardContent>
                          </Card>
                           <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium">Break-Even</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-bold text-destructive">${weeklyKpis.weeklyBreakEven.toFixed(2)}</p>
                                    <p className='text-xs text-muted-foreground'>Your weekly cost target.</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>Absorbed Costs</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-bold text-amber-500">${weeklyKpis.absorbedCosts.toFixed(2)}</p>
                                    <p className='text-xs text-muted-foreground'>Uncharged extra time/product.</p>
                                </CardContent>
                            </Card>
                            <Card className="col-span-full">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium">Net Profit / Loss</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className={cn("text-3xl font-bold", weeklyKpis.weeklyNetProfit >= 0 ? "text-green-500" : "text-destructive")}>${weeklyKpis.weeklyNetProfit.toFixed(2)}</p>
                                    <p className='text-xs text-muted-foreground'>Revenue minus service costs.</p>
                                </CardContent>
                            </Card>
                      </div>
                  </DialogContent>
               </Dialog>
              {billInstances.length > 0 && (
                  <Dialog>
                      <DialogTrigger asChild>
                          <Button variant="outline" className="relative">
                              Bills Due
                              <BellRing className="h-4 w-4 text-primary animate-pulse ml-2" />
                          </Button>
                      </DialogTrigger>
                      <DialogContent>
                          <DialogHeader>
                              <DialogTitle>Bills Due Today</DialogTitle>
                              <DialogDescription>{billInstances.length} bill(s) require attention.</DialogDescription>
                          </DialogHeader>
                          <ScrollArea className="w-full">
                              <div className="flex w-max space-x-4 pb-4">
                                  {billInstances.map(instance => (
                                      <div key={instance.id} className="w-80">
                                          <BillDueDateCard instance={instance} />
                                      </div>
                                  ))}
                              </div>
                              <ScrollBar orientation="horizontal" />
                          </ScrollArea>
                      </DialogContent>
                  </Dialog>
              )}
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
      </div>
      
      {!isMobile && (
      <div className="flex items-center justify-between gap-2 p-2 border-b bg-muted/50">
        <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex items-center justify-between gap-2">
                {weekDays.map((day, index) => (
                    <Button 
                        key={index} 
                        variant={isToday(day) && format(day, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd') ? 'default' : format(day, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd') ? 'secondary' : 'ghost'}
                        className="flex-1 flex-col h-auto py-1"
                        onClick={() => handleDayClick(day)}
                    >
                        <span className="text-xs">{format(day, 'EEE')}</span>
                        <span className="text-lg font-bold">{format(day, 'd')}</span>
                    </Button>
                ))}
            </div>
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
      )}

      <main className="flex-1 min-h-0">
          <DayTimeline 
              date={currentDate} 
              appointments={appointmentsForDay} 
              events={eventsForDay} 
              billInstances={billInstances}
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



