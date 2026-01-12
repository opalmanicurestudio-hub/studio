

'use client';

import { AppHeaderClient } from '@/components/shared/AppHeaderClient';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus } from 'lucide-react';
import { appointments as initialAppointments, clients, services, type Appointment, events as initialEvents, type Event, type EventChecklistItem } from '@/lib/data';
import { billInstances as allBillInstances, billDefinitions, type Bill, type Transaction, type BillInstance } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { AppointmentCard } from '@/components/planner/AppointmentCard';
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { BillDueDateCard } from '@/components/planner/BillDueDateCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EventCard } from '@/components/planner/EventCard';
import { RescheduleDialog } from '@/components/planner/RescheduleDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';


const TimeIndicator = () => {
    const [top, setTop] = useState(0);
    const START_HOUR = 0; // Starts from midnight

    useEffect(() => {
        const updatePosition = () => {
            const now = new Date();
            const startOfDayWithOffset = setHours(startOfDay(now), START_HOUR);
            const minutesFromStart = differenceInMinutes(now, startOfDayWithOffset);
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
    onReschedule,
}: { 
    date: Date; 
    appointments: Appointment[]; 
    events: Event[]; 
    billInstances: (BillInstance & { definition: Bill })[];
    onCompleteClick: (apt: Appointment) => void; 
    onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void; 
    onDeleteAppointment: (appointmentId: string) => void; 
    onPrintReceipt: (data: ReceiptData) => void; 
    onEditAppointment: (appointment: Appointment) => void; 
    onEditEvent: (event: Event) => void;
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    dailyTransactions: Transaction[] | null;
    onAddTransaction: (transaction: any) => void;
    onReschedule: (appointment: Appointment) => void;
}) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const START_HOUR = 0; // Start at midnight
    
    useEffect(() => {
        if (isToday(date) && viewportRef.current) {
            const now = new Date();
            const startOfDayWithOffset = setHours(startOfDay(now), START_HOUR);
            const minutesFromStart = differenceInMinutes(now, startOfDayWithOffset);
            
            if (minutesFromStart > 0) {
                const scrollPosition = minutesFromStart * (160 / 60); // 160px per hour
                viewportRef.current.scrollTo({
                    top: scrollPosition - viewportRef.current.clientHeight / 2,
                    behavior: 'smooth',
                });
            }
        }
    }, [date, viewportRef.current]);
    
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

    const hours = Array.from({ length: 24 - START_HOUR }, (_, i) => i + START_HOUR);
    const [tmhr, setTmhr] = useState(0);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        const storedTmhr = localStorage.getItem('tmhr');
        setTmhr(parseFloat(storedTmhr || '50'));
      }
    }, []);

    const renderItem = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        
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
            
            if (top < 0) return null; // Don't render items before the start hour

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
                        onReschedule={onReschedule}
                    />
                </div>
            );
        } else { // item.itemType === 'event'
             const minutesFromStart = differenceInMinutes(item.startTime, dayStart);
             if (minutesFromStart < 0) return null;

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
            <Accordion type="single" collapsible className="w-full border-b px-4">
                <AccordionItem value="item-1" className="border-b-0">
                    <AccordionTrigger className="p-0 py-4 font-semibold text-sm hover:no-underline">
                        Daily Financial Summary
                    </AccordionTrigger>
                    <AccordionContent>
                         <div className="pb-4 grid grid-cols-3 gap-2">
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
            

            <ScrollArea className="flex-1" viewportRef={viewportRef}>
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

const WeeklyKpiSheet = ({ open, onOpenChange, kpis, isMobile }: { open: boolean, onOpenChange: (open: boolean) => void, kpis: any, isMobile: boolean }) => {
    const DialogOrSheet = isMobile ? Sheet : Dialog;
    const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogOrSheet open={open} onOpenChange={onOpenChange}>
            <DialogOrSheetContent side={isMobile ? "bottom" : undefined} className={cn(isMobile && "h-[90vh] flex flex-col")}>
                <SheetHeader className="p-6">
                    <SheetTitle>Weekly KPIs</SheetTitle>
                    <SheetDescription>Your financial performance for this week.</SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Actual Revenue</CardTitle>
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-primary">${kpis.weeklyRevenue.toFixed(2)}</div>
                            <p className="text-xs text-muted-foreground">From completed appointments</p>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Projected Revenue</CardTitle>
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">${kpis.projectedRevenue.toFixed(2)}</div>
                            <p className="text-xs text-muted-foreground">Includes upcoming confirmed appointments</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Weekly Break-Even</CardTitle>
                            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-destructive">${kpis.weeklyBreakEven.toFixed(2)}</div>
                            <p className="text-xs text-muted-foreground">Est. costs you need to cover this week</p>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-primary">${kpis.weeklyNetProfit.toFixed(2)}</div>
                             <p className="text-xs text-muted-foreground">Revenue minus cost of services</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Absorbed Costs</CardTitle>
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-orange-500">${kpis.absorbedCosts.toFixed(2)}</div>
                            <p className="text-xs text-muted-foreground">Extra costs you didn't bill to clients.</p>
                        </CardContent>
                    </Card>
                </div>
                 <SheetFooter className="p-6">
                    <Button onClick={() => onOpenChange(false)} className="w-full">Close</Button>
                </SheetFooter>
            </DialogOrSheetContent>
        </DialogOrSheet>
    )
}

const BillsDueSheet = ({ open, onOpenChange, billInstances, isMobile, onLogPaymentClick }: { open: boolean, onOpenChange: (open: boolean) => void, billInstances: (BillInstance & { definition: Bill })[], isMobile: boolean, onLogPaymentClick: (instance: BillInstance & { definition: Bill }) => void }) => {
    const DialogOrSheet = isMobile ? Sheet : Dialog;
    const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogOrSheet open={open} onOpenChange={onOpenChange}>
            <DialogOrSheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[50vh] flex flex-col" : "sm:max-w-lg")}>
                 <SheetHeader className="p-6 pb-2">
                    <SheetTitle>Bills Due Today</SheetTitle>
                    <SheetDescription>A list of all recurring expenses due on this date.</SheetDescription>
                </SheetHeader>
                <div className="flex-1 p-6 overflow-hidden">
                    {billInstances.length > 0 ? (
                        <ScrollArea className="h-full -mr-6 pr-6">
                             <div className="space-y-4">
                                {billInstances.map(instance => (
                                    <BillDueDateCard key={instance.id} instance={instance} onLogPaymentClick={onLogPaymentClick} />
                                ))}
                            </div>
                        </ScrollArea>
                    ) : (
                        <div className="text-center text-muted-foreground h-full flex flex-col items-center justify-center">
                            No bills are due today.
                        </div>
                    )}
                </div>
                 <SheetFooter className="p-6 pt-2">
                    <Button onClick={() => onOpenChange(false)} className="w-full">Close</Button>
                </SheetFooter>
            </DialogOrSheetContent>
        </DialogOrSheet>
    )
}


export default function PlannerPage() {
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [isClient, setIsClient] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [events, setEvents] = useState<Event[]>(initialEvents);
  
  const { inventory, setInventory, addStockCorrection } = useInventory();
  
  const { firestore, user } = useFirebase();
  const tenantId = 'tenant-abc'; // Replace with dynamic tenant ID

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);
  const [isBillsSheetOpen, setIsBillsSheetOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: Bill }) | null>(null);
  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const weekStart = useMemo(() => {
    return startOfWeek(currentDate, { weekStartsOn: 0 });
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = weekStart;
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekStart]);

  const transactionsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
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
    return allBillInstances
        .filter(instance => format(parseISO(instance.dueDate), 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd'))
        .map(instance => {
            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
            return { ...instance, definition: definition! };
        })
        .filter(item => item.definition);
  }, [currentDate]);

  const weeklyKpis = useMemo(() => {
    const start = weekStart;
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
  }, [currentDate, appointments, weekStart]);


  const handleCompleteClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsCheckoutOpen(true);
  };

  const handleEditClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsEditAppointmentOpen(true);
  };
  
   const handleRescheduleClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsRescheduleOpen(true);
  };
  
  const handleEditEventClick = (event: Event) => {
    setSelectedEvent(event);
    setIsEditEventOpen(true);
  }
  
  const handleLogPaymentClick = (instance: BillInstance & { definition: Bill }) => {
    setSelectedBill(instance);
  };

  const handleLogPaymentConfirm = (paymentData: { amount: number; date: Date; paymentMethod: string; paymentMethodIdentifier?: string; notes?: string, receiptUrl?: string; }) => {
    if (!selectedBill) return;

    // This part should be moved to a backend function ideally
    // For now, we simulate the update on the client
    const updatedBillInstances = allBillInstances.map(instance => {
        if (instance.id === selectedBill.id) {
            const newAmountPaid = instance.amountPaid + paymentData.amount;
            const newAmountDue = instance.amountDue - paymentData.amount;
            let newStatus: BillInstance['status'] = newAmountDue <= 0 ? 'paid' : 'partially-paid';
            return { ...instance, amountPaid: newAmountPaid, amountDue: newAmountDue, status: newStatus };
        }
        return instance;
    });
    // Here you would set the state for billInstances if it were managed here
    // setBillInstances(updatedBillInstances);

    const newTransaction: Omit<Transaction, 'id'> = {
        date: paymentData.date.toISOString(),
        description: `Payment for ${selectedBill.definition.name}`,
        clientOrVendor: selectedBill.definition.name,
        type: 'payment',
        context: selectedBill.definition.context,
        category: selectedBill.definition.category,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod,
        paymentMethodIdentifier: paymentData.paymentMethodIdentifier,
        hasReceipt: !!paymentData.receiptUrl,
        receiptUrl: paymentData.receiptUrl
    };
    
    if (firestore && user) {
        const transactionRef = collection(firestore, 'tenants', tenantId, 'transactions');
        addDocumentNonBlocking(transactionRef, newTransaction);
    }
    
    toast({
        title: "Payment Logged",
        description: `A payment of $${paymentData.amount.toFixed(2)} has been logged for ${selectedBill.definition.name}.`
    })

    setSelectedBill(null);
  };

  const handleCheckout = (updatedInventory: any, newCorrections: any, receiptData: Omit<ReceiptData, 'business'>) => {
    if (!selectedAppointment) return;

    const completedAppointment: Appointment = { 
        ...selectedAppointment, 
        status: 'completed' as const,
        absorbedCost: receiptData.payment.method === 'Cash' && receiptData.tip > 0 ? 0 : (receiptData.payment.amountTendered || 0)
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
    handlePrintReceipt(receiptData);
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
    setIsRescheduleOpen(false);
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

  const handleNextWeek = () => {
    setCurrentDate(addWeeks(currentDate, 1));
  };
  const handlePrevWeek = () => {
    setCurrentDate(subWeeks(currentDate, 1));
  };
  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleDayClick = (day: Date) => {
    setCurrentDate(day);
  }
  
  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setCurrentDate(date);
    }
  };

  const selectedAppointmentData = useMemo(() => {
    if (!selectedAppointment) return null;
    const client = clients.find(c => c.id === selectedAppointment.clientId);
    const service = services.find(s => s.id === selectedAppointment.serviceId);
    return { appointment: selectedAppointment, client, service };
  }, [selectedAppointment]);
  
  const handlePrintReceipt = (receiptData: Omit<ReceiptData, 'business'>) => {
    setReceiptToPrint({
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        ...receiptData
    });
  }

  const appointmentsForDay = appointments
      .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd'))
      .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
  const eventsForDay = events
      .filter(evt => format(evt.startTime, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd'))
      .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
  
  if (!isClient) {
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
      
      <div className="flex flex-col gap-4 p-4 border-b">
        <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">{format(currentDate, 'MMMM yyyy')}</h2>
             <div className="flex items-center gap-2">
                 <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsKpiSheetOpen(true)}>
                    <BarChart className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 relative" onClick={() => setIsBillsSheetOpen(true)}>
                    <BellRing className={cn("h-4 w-4", billInstances.length > 0 && "text-primary animate-pulse")} />
                        {billInstances.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="default" size="icon" className="h-8 w-8">
                            <Plus className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setIsAddAppointmentOpen(true)}>Add Appointment</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsAddEventOpen(true)}>Add Event</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
         <div className="flex items-center justify-start gap-2">
            <Button variant="outline" onClick={handlePrevWeek} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
            <Button variant="outline" onClick={handleNextWeek} size="icon" className="h-8 w-8"><ChevronRight /></Button>
            <Button variant="outline" onClick={handleToday} className="h-8">Today</Button>
        </div>
      </div>
      
      <div className="flex items-center gap-2 p-2 border-b bg-background">
        <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex items-center gap-2">
                {weekDays.map((day, index) => (
                    <Button 
                        key={index} 
                        variant={isSameDay(day, currentDate) ? 'secondary' : 'ghost'}
                        className={cn(
                            "h-14 flex-1 flex-col py-1 min-w-[50px] md:min-w-[120px]",
                            isToday(day) && !isSameDay(day, currentDate) && "text-primary"
                        )}
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
              onReschedule={handleRescheduleClick}
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
        {selectedAppointment && (
            <RescheduleDialog
                open={isRescheduleOpen}
                onOpenChange={setIsRescheduleOpen}
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
        <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={weeklyKpis} isMobile={!!isMobile} />
        <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={billInstances} isMobile={!!isMobile} onLogPaymentClick={handleLogPaymentClick}/>
        
        {selectedBill && (
            <LogPaymentDialog
                open={!!selectedBill}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setSelectedBill(null);
                    }
                }}
                billInstance={selectedBill}
                onConfirm={handleLogPaymentConfirm}
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
