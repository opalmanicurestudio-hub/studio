

'use client';

import { AppHeaderClient } from '@/components/shared/AppHeaderClient';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square } from 'lucide-react';
import { appointments as initialAppointments, services, type Appointment, events as initialEvents, type Event, type EventChecklistItem, type StockCorrection, type Staff, type AppointmentCheckoutState } from '@/lib/data';
import { type Bill, type Transaction, type BillInstance, type BillDefinition } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { CompleteAppointmentDialog, type CheckoutData } from '@/components/planner/CompleteAppointmentDialog';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
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
import { PrintTicket, type TicketData } from '@/components/planner/PrintTicket';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, query, where, Timestamp, doc } from 'firebase/firestore';
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
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';


const DayTimeline = ({ 
    date, 
    staff,
    itemsByStaff,
    onCompleteClick, 
    onUpdateStatus, 
    onDeleteAppointment, 
    onPrintReceipt, 
    onPrintTicket,
    onEditAppointment,
    onEditEvent,
    onChecklistItemToggle,
    onUpdateEvent,
    dailyTransactions,
    onAddTransaction,
    onReschedule,
    onOpenPickingList,
    onStartService,
    onFinishService,
    onBookNewForClient,
}: { 
    date: Date; 
    staff: Staff[];
    itemsByStaff: Map<string, (Appointment | Event)[]>;
    onCompleteClick: (apt: Appointment) => void; 
    onUpdateStatus: (appointmentId: string, status: Appointment['status']) => void; 
    onDeleteAppointment: (appointmentId: string) => void; 
    onPrintReceipt: (data: ReceiptData) => void; 
    onPrintTicket: (data: TicketData) => void;
    onEditAppointment: (appointment: Appointment) => void; 
    onEditEvent: (event: Event) => void;
    onChecklistItemToggle: (eventId: string, checklistItemId: string, completed: boolean) => void;
    onUpdateEvent: (updatedEvent: Event) => void;
    dailyTransactions: Transaction[] | null;
    onAddTransaction: (transaction: any) => void;
    onReschedule: (appointment: Appointment) => void;
    onOpenPickingList: () => void;
    onStartService: (appointmentId: string) => void;
    onFinishService: (appointment: Appointment) => void;
    onBookNewForClient: (clientId: string) => void;
}) => {
    const START_HOUR = 0; // Start at midnight
    const hours = Array.from({ length: 24 - START_HOUR }, (_, i) => i + START_HOUR);
    const [tmhr, setTmhr] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const { walkIns, clients } = useInventory();

    useEffect(() => {
      if (typeof window !== 'undefined') {
        const storedTmhr = localStorage.getItem('tmhr');
        setTmhr(parseFloat(storedTmhr || '50'));
      }
    }, []);

    const staffSchedules = useMemo(() => {
        return staff.map(staffMember => {
            const staffItems = itemsByStaff.get(staffMember.id) || [];
            
            let layoutInfo = staffItems.map(item => ({
                ...item,
                layout: { cols: 0, col: 0 }
            }));
            
            function positionCluster(cluster: any[]) {
                cluster.sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
                const columns: any[][] = [];

                for(const item of cluster) {
                    let placed = false;
                    for (let i = 0; i < columns.length; i++) {
                        const col = columns[i];
                        if (col[col.length-1].endTime <= item.startTime) {
                            col.push(item);
                            item.layout.col = i;
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        columns.push([item]);
                        item.layout.col = columns.length - 1;
                        item.layout.col = columns.length - 1;
                    }
                }
                for (const item of cluster) {
                    item.layout.cols = columns.length;
                }
            }
            
            let lastEventEnd: Date | null = null;
            let currentCluster: any[] = [];
            for (const item of layoutInfo) {
                if (lastEventEnd !== null && item.startTime >= lastEventEnd) {
                    positionCluster(currentCluster);
                    currentCluster = [];
                }
                currentCluster.push(item);
                lastEventEnd = new Date(Math.max(lastEventEnd?.getTime() || 0, item.endTime.getTime()));
            }

            if (currentCluster.length > 0) {
                positionCluster(currentCluster);
            }
            
            const positionedItems = layoutInfo.map(item => ({
                ...item,
                layout: {
                    width: `${100 / item.layout.cols}%`,
                    left: `${(100 / item.layout.cols) * item.layout.col}%`,
                }
            }));

            return { staffMember, positionedItems };
        });
    }, [staff, itemsByStaff]);

    const renderAppointment = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        let client = clients.find(c => c.id === item.clientId);
        const service = services.find(s => s.id === item.serviceId);

        if (!client && item.isWalkIn) {
            const walkIn = walkIns.find(w => `apt-walkin-${w.id}` === item.id);
            if (walkIn) {
                client = {
                    id: item.clientId,
                    name: walkIn.customerName,
                    email: walkIn.customerEmail || '',
                    phone: walkIn.customerPhone || '',
                    avatarUrl: '',
                    lifetimeValue: 0,
                    lastAppointment: walkIn.checkInTime,
                    birthday: walkIn.customerBirthday,
                };
            }
        }
        
        if (!client || !service) return null;

        const padBefore = service.padBefore || 0;
        const totalDuration = service.duration + padBefore + (service.padAfter || 0);
        
        const actualStartTime = subMinutes(item.startTime, padBefore);
        const minutesFromStart = differenceInMinutes(actualStartTime, dayStart);
        
        if (minutesFromStart < 0) return null;

        const top = minutesFromStart * (160/60);
        const height = totalDuration * (160/60);
        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };
       
        return (
            <div key={item.id} className="absolute pr-2 z-10" style={style}>
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
                    onPrintTicket={onPrintTicket}
                    onEdit={onEditAppointment}
                    onReschedule={onReschedule}
                    onStartService={onStartService}
                    onFinishService={onFinishService}
                    onBookNewForClient={onBookNewForClient}
                />
            </div>
        );
    };

    const renderEvent = (item: any) => {
        const dayStart = setHours(startOfDay(date), START_HOUR);
        const minutesFromStart = differenceInMinutes(item.startTime, dayStart);
        
        if (minutesFromStart < 0) return null;

        const duration = differenceInMinutes(item.endTime, item.startTime);
        const height = duration * (160/60);
        const top = minutesFromStart * (160/60);

        const style = { top: `${top}px`, height: `${height}px`, width: `calc(${item.layout.width} - 0.5rem)`, left: item.layout.left };

        const eventTransactions = dailyTransactions?.filter(t => t.relatedEventId === item.id) || [];

        return (
             <div key={item.id} className="absolute pr-2 z-10" style={style}>
                <EventCard
                    event={item}
                    transactions={eventTransactions}
                    onChecklistItemToggle={onChecklistItemToggle}
                    onUpdateEvent={onUpdateEvent}
                    onEditEvent={onEditEvent}
                    onAddTransaction={onAddTransaction}
                />
            </div>
        )
    };

    const TimeIndicator = () => {
        const [top, setTop] = useState(0);

        useEffect(() => {
            const updatePosition = () => {
                const now = new Date();
                const minutesFromStart = differenceInMinutes(now, startOfDay(now));
                setTop(minutesFromStart * (160 / 60)); // 160px is h-40
            };

            updatePosition();
            const interval = setInterval(updatePosition, 60000);
            return () => clearInterval(interval);
        }, []);

        if (top === 0) return null;

        return (
            <div className="absolute w-full flex items-center z-20" style={{ top: `${top}px` }}>
                <div className="h-2 w-2 rounded-full bg-red-500 -ml-1"></div>
                <div className="h-px w-full bg-red-500"></div>
            </div>
        );
    };

    useEffect(() => {
        if (isToday(date) && scrollContainerRef.current) {
            const now = new Date();
            const minutesFromStart = differenceInMinutes(now, startOfDay(now));
            const scrollPosition = (minutesFromStart * (160/60)) - (scrollContainerRef.current.clientHeight / 4);

            scrollContainerRef.current.scrollTo({
                top: Math.max(0, scrollPosition),
                behavior: 'smooth'
            });
        }
    }, [date, staff]); // Rerun when date or staff changes

    return (
        <div className="flex-1 relative overflow-auto" ref={scrollContainerRef}>
            <div className="grid grid-cols-[auto,1fr] min-w-max">
                
                <div className="sticky top-0 z-30 bg-background h-14 border-b border-r grid" style={{ width: isMobile ? '40px' : '48px' }} />
                <div className="sticky top-0 z-20 grid col-start-2 bg-background" style={{ gridTemplateColumns: `repeat(${staff.length}, minmax(${isMobile ? 250 : 250}, 1fr))` }}>
                    {staff.map(staffMember => (
                        <div key={staffMember.id} className="p-2 h-14 border-b border-r text-center flex items-center justify-center">
                            {!isMobile && (
                                <div className="flex items-center justify-center gap-2 h-full">
                                    <Avatar className="w-6 h-6"><AvatarImage src={staffMember.avatarUrl} /><AvatarFallback>{staffMember.name.charAt(0)}</AvatarFallback></Avatar>
                                    <p className="font-semibold text-sm truncate">{staffMember.name}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                
                {/* Time labels column */}
                <div className={cn("sticky left-0 z-10 bg-background", isMobile ? "w-10" : "w-12")}>
                    {hours.map(hour => (
                        <div key={hour} className="h-40 border-r border-b text-right pr-2 pt-1 flex justify-end">
                            <span className="text-xs text-muted-foreground -mt-2.5">{format(new Date(0, 0, 0, hour), 'ha')}</span>
                        </div>
                    ))}
                </div>

                {/* Main content grid */}
                <div className="col-start-2 grid relative" style={{ gridTemplateColumns: `repeat(${staff.length}, minmax(${isMobile ? 250 : 250}, 1fr))` }}>
                    {staffSchedules.map(({ staffMember, positionedItems }) => (
                        <div key={staffMember.id} className="relative border-r">
                            {/* Grid lines */}
                            {hours.map(hour => (
                                <div key={hour} className="h-40 border-b border-dashed" />
                            ))}
                            {/* Items */}
                            {positionedItems.map(item => {
                                if ((item as any).itemType === 'appointment') {
                                    return renderAppointment(item);
                                } else if ((item as any).itemType === 'event') {
                                    return renderEvent(item);
                                }
                                return null;
                            })}
                        </div>
                    ))}

                    {isToday(date) && <TimeIndicator />}
                </div>
            </div>
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

const BillsDueSheet = ({ open, onOpenChange, billInstances, isMobile, onLogPaymentClick }: { open: boolean, onOpenChange: (open: boolean) => void, billInstances: (BillInstance & { definition: BillDefinition })[], isMobile: boolean, onLogPaymentClick: (instance: BillInstance & { definition: BillDefinition }) => void }) => {
    const DialogOrSheet = isMobile ? Sheet : Dialog;
    const DialogOrSheetContent = isMobile ? SheetContent : DialogContent;

    return (
        <DialogOrSheet open={open} onOpenChange={onOpenChange}>
            <DialogOrSheetContent side={isMobile ? "bottom" : "right"} className={cn(isMobile ? "h-[50vh] flex flex-col" : "sm:max-w-lg")}>
                 <SheetHeader className="p-6 pb-2">
                    <SheetTitle>Bills Due Today</SheetTitle>
                    <SheetDescription>A list of all recurring expenses due on this date.</SheetDescription>
                </SheetHeader>
                <div className={cn("p-6", isMobile ? "flex-1 overflow-y-auto" : "max-h-[70vh] overflow-y-auto")}>
                    {billInstances.length > 0 ? (
                        <div className="space-y-4">
                            {billInstances.map(instance => (
                                <BillDueDateCard key={instance.id} instance={instance} onLogPaymentClick={onLogPaymentClick} />
                            ))}
                        </div>
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
  const [events, setEvents] = useState<Event[]>(initialEvents);
  
  const { 
    inventory, 
    billDefinitions: mockDefinitions, 
    billInstances: mockInstances,
    staff,
    appointments, 
    setAppointments,
    activityLogs, 
    setActivityLogs,
    addStockCorrection,
    setTransactions,
    clients,
    setClients,
    walkIns,
  } = useInventory();
  
  const { firestore, user, isUserLoading } = useFirebase();
  const tenantId = 'tenant-abc'; // Replace with dynamic tenant ID
  
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);
  const [isBillsSheetOpen, setIsBillsSheetOpen] = useState(false);
  const [isPickingListOpen, setIsPickingListOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<TicketData | null>(null);
  
  const [mobileSelectedStaffId, setMobileSelectedStaffId] = useState<string>('');

  const [startConfirmAppointment, setStartConfirmAppointment] = useState<Appointment | null>(null);
  const [finishConfirmAppointment, setFinishConfirmAppointment] = useState<Appointment | null>(null);

  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);
  const [initialClientIdForNewApt, setInitialClientIdForNewApt] = useState<string>('');


  const finishDialogDuration = useMemo(() => {
    if (!finishConfirmAppointment?.actualStartTime) return null;
    const startTime = parseISO(finishConfirmAppointment.actualStartTime);
    const duration = differenceInMinutes(new Date(), startTime);
    return duration;
  }, [finishConfirmAppointment]);


  useEffect(() => {
    if (staff && staff.length > 0 && !mobileSelectedStaffId) {
      setMobileSelectedStaffId(staff[0].id);
    }
  }, [staff, mobileSelectedStaffId]);

  // --- Data Fetching ---
  const billDefinitionsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'bills');
  }, [firestore, user, isUserLoading, tenantId]);

  const billInstancesQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    return collection(firestore, 'tenants', tenantId, 'billInstances');
  }, [firestore, user, isUserLoading, tenantId]);

  const { data: fetchedBillDefinitions } = useCollection<BillDefinition>(billDefinitionsQuery);
  const { data: fetchedBillInstances } = useCollection<BillInstance>(billInstancesQuery);
  
  const billDefinitions = useMemo(() => (fetchedBillDefinitions && fetchedBillDefinitions.length > 0) ? fetchedBillDefinitions : mockDefinitions, [fetchedBillDefinitions, mockDefinitions]);
  const billInstances = useMemo(() => (fetchedBillInstances && fetchedBillInstances.length > 0) ? fetchedBillInstances : mockInstances, [fetchedBillInstances, mockInstances]);


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

  const dailyBillInstances = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    
    const today = startOfDay(currentDate);

    return billInstances
        .filter(instance => {
            const dueDate = startOfDay(parseISO(instance.dueDate));
            return (isEqual(dueDate, today) || isBefore(dueDate, today)) && instance.status !== 'paid';
        })
        .map(instance => {
            const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
            return { ...instance, definition: definition! };
        })
        .filter(item => item.definition)
        .sort((a,b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime());
    }, [currentDate, billInstances, billDefinitions]);


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
  }, [currentDate, appointments, weekStart, billDefinitions, services]);
  
  const itemsByStaff = useMemo(() => {
    const map = new Map<string, (Appointment | Event & { itemType: string })[]>();
    staff.forEach(s => map.set(s.id, []));

    // Process appointments
    appointments
      .filter(apt => isSameDay(apt.startTime, currentDate))
      .forEach(apt => {
        const staffId = apt.staffId || staff[0]?.id;
        if (staffId && map.has(staffId)) {
          map.get(staffId)!.push({ ...apt, itemType: 'appointment' });
        }
      });

    // Process events
    events
      .filter(evt => isSameDay(evt.startTime, currentDate))
      .forEach(evt => {
          if (evt.staffId && map.has(evt.staffId)) {
              // Event with specific staff
              map.get(evt.staffId)!.push({ ...evt, itemType: 'event' });
          } else if (evt.type === 'blocked' && !evt.staffId) {
              // Block all staff
              staff.forEach(s => {
                  map.get(s.id)!.push({ ...evt, itemType: 'event' });
              });
          } else {
              // Personal/Business event for the owner (first staff member)
              const ownerId = staff[0]?.id;
              if (ownerId) {
                  map.get(ownerId)!.push({ ...evt, itemType: 'event' });
              }
          }
      });

    map.forEach(items => {
        items.sort((a,b) => a.startTime.getTime() - b.startTime.getTime())
    });

    return map;
  }, [currentDate, appointments, events, staff]);

  const staffToDisplay = useMemo(() => {
    if (isMobile) {
        if (!mobileSelectedStaffId) return [];
        const selected = staff.find(s => s.id === mobileSelectedStaffId);
        return selected ? [selected] : [];
    }
    return staff;
  }, [isMobile, mobileSelectedStaffId, staff]);

  const itemsToDisplay = useMemo(() => {
      if (isMobile) {
          if (!mobileSelectedStaffId || !itemsByStaff.has(mobileSelectedStaffId)) return new Map();
          return new Map([[mobileSelectedStaffId, itemsByStaff.get(mobileSelectedStaffId)!]]);
      }
      return itemsByStaff;
  }, [isMobile, mobileSelectedStaffId, itemsByStaff]);


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
  
  const handleLogPaymentClick = (instance: BillInstance & { definition: BillDefinition }) => {
    setSelectedBill(instance);
  };

  const handleLogPaymentConfirm = (paymentData: { amount: number; date: Date; paymentMethod: string; paymentMethodIdentifier?: string; notes?: string, receiptUrl?: string; }) => {
    if (!selectedBill || !firestore || !user) return;

    const billInstanceRef = doc(firestore, 'tenants', tenantId, 'billInstances', selectedBill.id);
    const newAmountPaid = selectedBill.amountPaid + paymentData.amount;
    const newAmountDue = selectedBill.amountDue - paymentData.amount;
    const newStatus: BillInstance['status'] = newAmountDue <= 0 ? 'paid' : 'partially-paid';
    
    updateDocumentNonBlocking(billInstanceRef, {
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        status: newStatus
    });

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
        relatedBillInstanceId: selectedBill.id,
    };
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, newTransaction);
    
    toast({
        title: "Payment Logged",
        description: `A payment of $${paymentData.amount.toFixed(2)} has been logged for ${selectedBill.definition.name}.`
    })

    setSelectedBill(null);
    if (isBillsSheetOpen) {
        setIsBillsSheetOpen(false);
    }
  };

  const handleCheckout = (data: CheckoutData) => {
    if (!selectedAppointment) return;
    
    const {
      serviceStaffOverrides,
      tipAllocations,
      retailItems,
      addOns,
      absorbedCost,
      receiptData,
      newCorrections,
      incident,
      redeemedOffer
    } = data;

    const allPerformedServices = [services.find(s => s.id === selectedAppointment.serviceId), ...addOns].filter((s): s is Service => !!s);
    
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');

    // 1. Service Revenue Transactions
    allPerformedServices.forEach(service => {
        const staffId = serviceStaffOverrides[service.id] || selectedAppointment.staffId;
        const newTransaction: Omit<Transaction, 'id'> = {
            date: new Date().toISOString(),
            description: `Service: ${service.name}`,
            clientOrVendor: clients.find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
            type: 'income',
            context: 'Business',
            category: 'Service Revenue',
            amount: redeemedOffer ? 0 : service.price,
            paymentMethod: receiptData.payment.method,
            hasReceipt: true,
            staffId: staffId,
        };
        addDocumentNonBlocking(transactionsRef, newTransaction);
    });

    // 2. Tip Transactions
    Object.entries(tipAllocations).forEach(([staffId, tipAmount]) => {
        if (tipAmount > 0) {
            const newTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Tip for Appointment #${selectedAppointment.id.slice(-4)}`,
                clientOrVendor: clients.find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
                type: 'income',
                context: 'Business',
                category: 'Tips',
                amount: tipAmount,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: staffId,
                tipAmount: tipAmount,
            };
            addDocumentNonBlocking(transactionsRef, newTransaction);
        }
    });

    // 3. Retail Transactions
    if (retailItems.length > 0) {
        const retailTotal = retailItems.reduce((acc, item) => {
            const product = inventory.find(p => p.id === item.id);
            const price = product?.costPerUnit ? product.costPerUnit * 1.75 : 0;
            return acc + (item.quantity * price);
        }, 0);
        if (retailTotal > 0) {
            const newTransaction: Omit<Transaction, 'id'> = {
                date: new Date().toISOString(),
                description: `Retail Sale (${retailItems.length} items)`,
                clientOrVendor: clients.find(c => c.id === selectedAppointment.clientId)?.name || 'N/A',
                type: 'income',
                context: 'Business',
                category: 'Retail',
                amount: retailTotal,
                paymentMethod: receiptData.payment.method,
                hasReceipt: true,
                staffId: selectedAppointment.staffId, // Or assign to a specific staff
            };
            addDocumentNonBlocking(transactionsRef, newTransaction);
        }
    }
    
    // 4. Update stock corrections
    newCorrections.forEach(addStockCorrection);
    
    // 5. Update appointment
    const completedAppointment: Appointment = { 
        ...selectedAppointment, 
        status: 'completed' as const,
        absorbedCost: absorbedCost,
        incident: incident,
    };
    setAppointments(prev => prev.map(apt => apt.id === selectedAppointment.id ? completedAppointment : apt));

    // 6. Update client packages
    if (redeemedOffer?.type === 'package') {
        const clientToUpdate = clients.find(c => c.id === selectedAppointment.clientId);
        if (clientToUpdate) {
            const updatedPackages = clientToUpdate.activePackages?.map(p => {
                if (p.packageId === redeemedOffer.id) {
                    return { ...p, sessionsRemaining: p.sessionsRemaining - 1 };
                }
                return p;
            }).filter(p => p.sessionsRemaining > 0);

            const updatedClient = { ...clientToUpdate, activePackages: updatedPackages };
            setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
        }
    }
    
    // No toast here; the dialog transitions to the rebooking prompt
    
    // This is handled by the rebooking prompt now
    // setIsCheckoutOpen(false); 
    // setSelectedAppointment(null);
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
    setInitialClientIdForNewApt('');
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

  const handleRebook = (appointment: Appointment) => {
      setIsCheckoutOpen(false);
      setSelectedAppointment(null); // Clear appointment from checkout
      setAppointmentToRebook(appointment);
      setIsAddAppointmentOpen(true);
  }

  const handleBookNewAppointmentForClient = (clientId: string) => {
    setAppointmentToRebook(null);
    setInitialClientIdForNewApt(clientId);
    setIsAddAppointmentOpen(true);
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
  
  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    setAppointments(prev =>
      prev.map(apt =>
        apt.id === appointmentId
          ? {
              ...apt,
              status: 'ready_for_checkout',
              checkoutState,
            }
          : apt
      )
    );
    setIsCheckoutOpen(false);
    setSelectedAppointment(null);
    toast({
      title: 'Sent to Front Desk',
      description: "Client is ready for checkout.",
    });
  };

  const handleUpdateStatus = (appointmentId: string, status: Appointment['status']) => {
    setAppointments(prev => prev.map(apt => apt.id === appointmentId ? { ...apt, status } : apt));
    toast({
        title: "Status Updated",
        description: `Appointment status changed to ${status}.`
    });
  };

  const handleStartService = (appointmentId: string) => {
    const appointmentToStart = appointments.find(apt => apt.id === appointmentId);
    if (appointmentToStart) {
        setStartConfirmAppointment(appointmentToStart);
    }
  };

  const confirmStartService = () => {
    if (!startConfirmAppointment) return;
    setAppointments(prev => prev.map(apt => 
      apt.id === startConfirmAppointment.id 
        ? { ...apt, status: 'servicing', actualStartTime: new Date().toISOString() } 
        : apt
    ));
    toast({
        title: "Service Started",
        description: "The appointment is now marked as 'In Service'."
    });
    setStartConfirmAppointment(null);
  };

  const handleFinishService = (appointment: Appointment) => {
     setFinishConfirmAppointment(appointment);
  };

  const confirmFinishService = () => {
    if (!finishConfirmAppointment || !finishConfirmAppointment.actualStartTime) return;
    
    const endTime = new Date();
    const updatedAppointment: Appointment = { 
        ...finishConfirmAppointment, 
        status: 'ready_for_checkout',
        actualEndTime: endTime.toISOString() 
    };

    setAppointments(prev => prev.map(apt => 
      apt.id === finishConfirmAppointment.id 
        ? updatedAppointment
        : apt
    ));

    const startTime = parseISO(finishConfirmAppointment.actualStartTime);
    const duration = differenceInMinutes(endTime, startTime);

    toast({
        title: "Service Finished",
        description: `The service took ${duration} minutes. Client is ready for checkout.`
    });

    setFinishConfirmAppointment(null);
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

  const handleJumpTo = (weeks: number) => {
    setCurrentDate(prevDate => addWeeks(prevDate, weeks));
  };
  
  const handleToday = () => {
    setCurrentDate(new Date());
  };

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
  }, [selectedAppointment, clients, services]);
  
  const handlePrintReceipt = (receiptData: Omit<ReceiptData, 'business'>) => {
    setReceiptToPrint({
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        ...receiptData
    });
  };

  const handlePrintTicket = (ticketData: Omit<TicketData, 'business'>) => {
    setTicketToPrint({
        business: { name: 'ClarityFlow Salon', phone: '555-123-4567' },
        ...ticketData
    });
  }

  const appointmentsForDay = appointments
      .filter(apt => format(apt.startTime, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd'))
      .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
  const eventsForDay = events
      .filter(evt => format(evt.startTime, 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd'))
      .sort((a,b) => a.startTime.getTime() - b.startTime.getTime());
  
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
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
      
      <div className="p-4 border-b space-y-4">
        <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-semibold">{format(currentDate, 'MMMM yyyy')}</h2>
            </div>

            {/* Mobile: date nav under month/year */}
             <div className="md:hidden flex items-center gap-2">
                <Button variant="outline" onClick={() => setCurrentDate(subWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                <Button variant="outline" onClick={() => setCurrentDate(addWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                <Button variant="outline" onClick={handleToday} className="h-8">Today</Button>
                <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8"><CalendarIcon className="h-4 w-4" /><span className="sr-only">Jump To...</span></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleJumpTo(2)}>+ 2 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(4)}>+ 4 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(6)}>+ 6 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(8)}>+ 8 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(10)}>+ 10 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(12)}>+ 12 Weeks</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleJumpTo(-2)}>- 2 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-4)}>- 4 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-6)}>- 6 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-8)}>- 8 Weeks</DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleJumpTo(-10)}>- 10 Weeks</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleJumpTo(-12)}>- 12 Weeks</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>

        <div className="md:hidden flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="w-4 h-4" /><span className="sr-only">Weekly KPIs</span></Button></TooltipTrigger><TooltipContent><p>Weekly KPIs</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="relative" onClick={() => setIsBillsSheetOpen(true)}>
                        <BellRing className={cn("h-4 w-4", dailyBillInstances.length > 0 && "text-primary animate-pulse")} />
                        {dailyBillInstances.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />}
                        <span className="sr-only">Bills Due Today</span>
                    </Button>
                </TooltipTrigger><TooltipContent><p>Bills Due Today</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsPickingListOpen(true)}><List className="w-4 h-4" /><span className="sr-only">Picking List</span></Button></TooltipTrigger><TooltipContent><p>Picking List</p></TooltipContent></Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setIsAddEventOpen(true)}>
                <span className="md:hidden">+ Event</span>
                <span className="hidden md:inline">Add Event</span>
            </Button>
            <Button size="sm" onClick={() => setIsAddAppointmentOpen(true)}>
                <span className="md:hidden">+ Appointment</span>
                <span className="hidden md:inline">Add Appointment</span>
            </Button>
          </div>
        </div>

        <div className="hidden md:block space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setCurrentDate(subWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                    <Button variant="outline" onClick={() => setCurrentDate(addWeeks(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                    <Button variant="outline" onClick={handleToday} className="h-8">Today</Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-8 w-8"><CalendarIcon className="h-4 w-4" /><span className="sr-only">Jump To...</span></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleJumpTo(2)}>+ 2 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(4)}>+ 4 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(6)}>+ 6 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(8)}>+ 8 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(10)}>+ 10 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(12)}>+ 12 Weeks</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleJumpTo(-2)}>- 2 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-4)}>- 4 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-6)}>- 6 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-8)}>- 8 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-10)}>- 10 Weeks</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleJumpTo(-12)}>- 12 Weeks</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
             <div className="flex items-center justify-end gap-2">
                <TooltipProvider>
                    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="w-4 h-4" /><span className="sr-only">Weekly KPIs</span></Button></TooltipTrigger><TooltipContent><p>Weekly KPIs</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="relative" onClick={() => setIsBillsSheetOpen(true)}>
                            <BellRing className={cn("h-4 w-4", dailyBillInstances.length > 0 && "text-primary animate-pulse")} />
                            {dailyBillInstances.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />}
                            <span className="sr-only">Bills Due Today</span>
                        </Button>
                    </TooltipTrigger><TooltipContent><p>Bills Due Today</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => setIsPickingListOpen(true)}><List className="w-4 h-4" /><span className="sr-only">Picking List</span></Button></TooltipTrigger><TooltipContent><p>Picking List</p></TooltipContent></Tooltip>
                </TooltipProvider>
                <Button size="sm" onClick={() => setIsAddEventOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Event</Button>
                <Button size="sm" onClick={() => setIsAddAppointmentOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Add Appointment</Button>
            </div>
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
                        onClick={() => handleDateSelect(day)}
                    >
                        <span className="text-xs">{format(day, 'EEE')}</span>
                        <span className="text-lg font-bold">{format(day, 'd')}</span>
                    </Button>
                ))}
            </div>
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <main className="flex-1 flex flex-col min-h-0">
          {isMobile && staff.length > 1 && (
            <div className="p-4 border-b">
              <Label htmlFor="staff-selector">Viewing Schedule For</Label>
              <Select value={mobileSelectedStaffId} onValueChange={setMobileSelectedStaffId}>
                <SelectTrigger id="staff-selector" className="mt-1">
                  <SelectValue placeholder="Select a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DayTimeline 
              date={currentDate} 
              staff={staffToDisplay}
              itemsByStaff={itemsToDisplay}
              onCompleteClick={handleCompleteClick} 
              onUpdateStatus={onUpdateStatus}
              onDeleteAppointment={handleDeleteAppointment} 
              onPrintReceipt={handlePrintReceipt}
              onPrintTicket={handlePrintTicket}
              onEditAppointment={handleEditClick}
              onEditEvent={handleEditEventClick}
              onChecklistItemToggle={handleChecklistItemToggle}
              onUpdateEvent={handleUpdateEvent}
              dailyTransactions={dailyTransactions}
              onAddTransaction={handleAddTransaction}
              onReschedule={handleRescheduleClick}
              onOpenPickingList={() => setIsPickingListOpen(true)}
              onStartService={handleStartService}
              onFinishService={confirmFinishService}
              onBookNewForClient={handleBookNewAppointmentForClient}
          />
      </main>
      {selectedAppointmentData && (
        <CompleteAppointmentDialog
            open={isCheckoutOpen}
            onOpenChange={(isOpen) => {
              if(!isOpen) setSelectedAppointment(null);
              setIsCheckoutOpen(isOpen);
            }}
            appointmentData={selectedAppointmentData}
            onConfirmCheckout={handleCheckout}
            onSendToFrontDesk={handleSendToFrontDesk}
            onRebook={handleRebook}
        />
      )}
      <AddAppointmentDialog 
        open={isAddAppointmentOpen}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                setAppointmentToRebook(null);
                setInitialClientIdForNewApt('');
            }
            setIsAddAppointmentOpen(isOpen);
        }}
        clients={clients}
        services={services}
        staff={staff}
        appointments={appointments}
        onConfirm={handleAddAppointment}
        initialClientId={appointmentToRebook ? appointmentToRebook.clientId : initialClientIdForNewApt}
        appointmentToRebook={appointmentToRebook}
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
        appointments={appointments}
        events={events}
        staff={staff}
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
        <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={dailyBillInstances} isMobile={!!isMobile} onLogPaymentClick={handleLogPaymentClick}/>
        
        <PickingListDialog
            open={isPickingListOpen}
            onOpenChange={setIsPickingListOpen}
            appointments={appointmentsForDay}
        />
        
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
      
      <Dialog open={!!ticketToPrint} onOpenChange={(open) => !open && setTicketToPrint(null)}>
        <DialogContent className="max-w-md print-content">
          <DialogHeader className="print:hidden">
            <DialogTitle>Appointment Ticket</DialogTitle>
          </DialogHeader>
          <div id="ticket-area-dialog">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setTicketToPrint(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <AlertDialog open={!!startConfirmAppointment} onOpenChange={(open) => !open && setStartConfirmAppointment(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Start Service?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will mark the appointment as &quot;In Service&quot; and log the current time as the actual start time.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmStartService}>Start Service</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!finishConfirmAppointment} onOpenChange={(open) => !open && setFinishConfirmAppointment(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Finish Service?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {finishDialogDuration !== null ?
                        `This will end the service. Total elapsed time: ${finishDialogDuration} minutes. ` : ''
                        }
                        The appointment status will be set to "Ready for Checkout".
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmFinishService}>Finish &amp; Await Checkout</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <div id="print-ticket-area" className="hidden">
            {ticketToPrint && <PrintTicket data={ticketToPrint} />}
        </div>
    </div>
  );
}

    