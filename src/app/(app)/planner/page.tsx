
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, MoreHorizontal, CheckCircle, Printer, BellRing, TrendingUp, DollarSign, BarChart, AlertTriangle, Calendar as CalendarIcon, Plus, List, FileText as TicketIcon, Edit, Users, User, Play, Square, QrCode, Globe, Building, HardHat, Repeat, Link as LinkIcon, Car, Check, X, CreditCard, ShieldCheck } from 'lucide-react';
import { type Event, type Staff, type Appointment, type AppointmentCheckoutState, type Resource, type Membership } from '@/lib/data';
import { type BillInstance, type BillDefinition, type Transaction } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, getHours, getMinutes, differenceInMinutes, isPast, isToday, setHours, startOfDay, startOfMonth, endOfMonth, endOfDay, getDate, parseISO, addMinutes, subMinutes, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isBefore, isEqual, areIntervalsOverlapping, addMonths, differenceInHours } from 'date-fns';
import React, { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
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
import { PrintReceipt, type ReceiptData } from '@/components/planner/PrintReceipt';
import { PrintTicket, type TicketData } from '@/components/planner/PrintTicket';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { useFirebase, useCollection, useDoc, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, errorEmitter, useUser } from '@/firebase';
import { collection, query, where, Timestamp, doc, setDoc, arrayUnion, increment, writeBatch, addDoc } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import Link from 'next/link';
import { RadioGroup, RadioGroupGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { FloatingActionButton } from '@/components/planner/FloatingActionButton';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { type Client, type Service } from '@/lib/data';
import { nanoid } from 'nanoid';
import { Textarea } from '@/components/ui/textarea';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';


function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const { user } = useUser();
  const { selectedTenant, role } = useTenant();
  const { firestore } = useFirebase();
  const tenantId = selectedTenant?.id;
  const router = useRouter();
  
  const { 
      inventory, clients, services, staff: allStaff, appointments: appointmentsFromInventory, events: eventsFromInventory, walkIns, billDefinitions, billInstances, transactions, memberships, isLoading
  } = useInventory();

  const [tmhr, setTmhr] = useState(0);
  useEffect(() => { setTmhr(selectedTenant?.tmhr || 50); }, [selectedTenant]);

  const { data: checkIns } = useCollection<Partial<Appointment>>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, 'appointmentCheckIns'), where('tenantId', '==', tenantId)), [firestore, tenantId]));
  
  const appointments = useMemo(() => {
    if (!appointmentsFromInventory) return [];
    if (!checkIns) return appointmentsFromInventory;
    const checkInMap = new Map(checkIns.map(ci => [ci.checkInToken, ci]));
    return appointmentsFromInventory.map(apt => {
        const ci = apt.checkInToken ? checkInMap.get(apt.checkInToken) : null;
        const shouldOverrideStatus = apt.status === 'confirmed' || apt.status === 'deposit_pending';
        return ci ? { 
            ...apt, 
            checkInStatus: ci.checkInStatus || apt.checkInStatus, 
            lateTimeMinutes: ci.lateTimeMinutes ?? apt.lateTimeMinutes, 
            status: (shouldOverrideStatus && ci.status) ? ci.status : apt.status 
        } : apt;
    });
  }, [appointmentsFromInventory, checkIns]);
  
  const events = eventsFromInventory || [];
  
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isTechnicianReviewOpen, setIsTechnicianReviewOpen] = useState(false);
  const [isAddAppointmentOpen, setIsAddAppointmentOpen] = useState(false);
  const [isEditAppointmentOpen, setIsEditAppointmentOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [isKpiSheetOpen, setIsKpiSheetOpen] = useState(false);
  const [isBillsSheetOpen, setIsBillsSheetOpen] = useState(false);
  const [isPickingListOpen, setIsPickingListOpen] = useState(false);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  const [clientForNewApt, setClientForNewApt] = useState<Client | null>(null);
  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);

  const { toast } = useToast();
    
  const [receiptToPrint, setReceiptToPrint] = useState<ReceiptData | null>(null);
  const [ticketToPrint, setTicketToPrint] = useState<TicketData | null>(null);
  const [mobileSelectedColumnId, setMobileSelectedColumnId] = useState<string>('');
  const [activeView, setActiveView] = useState<'staff' | 'resources'>(viewParam === 'resources' ? 'resources' : 'staff');
    
  const { data: scheduleProfilesData } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]));
  const { data: resources } = useCollection<Resource>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'resources'), [firestore, tenantId]));
  const publicScheduleProfile = useMemo(() => scheduleProfilesData?.find(p => p.isActive), [scheduleProfilesData]);

  const staff = useMemo(() => (role === 'staff' && user) ? (allStaff || []).filter(s => s.id === user.uid) : (allStaff || []), [allStaff, role, user]);
  
  useEffect(() => { 
    if (activeView === 'staff' && staff?.length > 0 && !mobileSelectedColumnId) {
        setMobileSelectedColumnId(staff[0].id); 
    } else if (activeView === 'resources' && resources?.length > 0 && !mobileSelectedColumnId) {
        setMobileSelectedColumnId(resources[0].id);
    }
  }, [staff, resources, activeView, mobileSelectedColumnId]);

  const handleViewChange = (v: 'staff' | 'resources') => {
      setActiveView(v);
      if (v === 'staff' && staff?.length > 0) {
          setMobileSelectedColumnId(staff[0].id);
      } else if (v === 'resources' && resources?.length > 0) {
          setMobileSelectedColumnId(resources[0].id);
      }
  };

  const onMobileColumnChange = (id: string) => {
      setMobileSelectedColumnId(id);
  };

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 0 }), i)), [currentDate]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, (Appointment | Event)[]>();
    const cols = activeView === 'staff' ? staff : resources;
    (cols || []).forEach(c => map.set(c.id, []));
    appointments?.filter(a => isSameDay(a.startTime, currentDate)).forEach(a => {
        if (activeView === 'staff') { if (a.staffId && map.has(a.staffId)) map.get(a.staffId)!.push({ ...a, itemType: 'appointment' } as any); }
        else { (a.requiredResourceIds || []).forEach(rid => { if (map.has(rid)) map.get(rid)!.push({ ...a, itemType: 'appointment' } as any); }); }
    });
    map.forEach(items => items.sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
    return map;
  }, [currentDate, appointments, events, staff, resources, activeView]);

  const billsDue = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    return billInstances.map(instance => {
      const definition = billDefinitions.find(def => def.id === instance.billDefinitionId);
      return { ...instance, definition: definition! };
    }).filter(item => 
        item.definition && 
        item.status !== 'paid' && 
        (item.status === 'overdue' || isBefore(parseISO(item.dueDate), addDays(new Date(), 1)))
    );
  }, [billInstances, billDefinitions]);

  const kpis = useMemo(() => {
    if (!appointments || !transactions) return { weeklyRevenue: 0, projectedRevenue: 0, weeklyBreakEven: 0, weeklyNetProfit: 0, absorbedCosts: 0 };
    
    const start = startOfWeek(currentDate);
    const end = endOfDay(addDays(start, 6));

    const weekTransactions = transactions.filter(t => t.date >= start && t.date <= end && t.type === 'income' && t.category === 'Service Revenue');
    const weeklyRevenue = weekTransactions.reduce((acc, t) => acc + t.amount, 0);

    return {
        weeklyRevenue,
        projectedRevenue: weeklyRevenue * 1.2,
        weeklyBreakEven: 1500,
        weeklyNetProfit: weeklyRevenue - 1500,
        absorbedCosts: 120,
    };
  }, [currentDate, appointments, transactions]);

  const handleScan = useCallback((data: string) => {
    if (!appointments) return;
    const raw = data.trim();
    if (raw.startsWith('clarityflow://checkout/')) {
        const id = raw.split('/').pop();
        const apt = appointments.find(a => a.id === id);
        if (apt) {
            setSelectedAppointment(apt);
            setIsDetailsOpen(true);
            if (apt.status === 'ready_for_checkout') {
                toast({ title: "Ticket Scanned", description: "This client is ready for checkout. Opening details." });
            }
        } else {
            toast({ variant: 'destructive', title: 'Appointment Not Found' });
        }
    }
  }, [appointments, toast]);

  const handleUpdateStatus = (id: string, status: Appointment['status']) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
    updateDocumentNonBlocking(appointmentRef, { status });
    
    const apt = appointments?.find(a => a.id === id);
    if (apt?.checkInToken) {
        updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status });
    }

    toast({ title: "Status Updated", description: `Appointment status changed to ${status}.` });
  };

  const handleCancelAppointment = (id: string) => {
    handleUpdateStatus(id, 'cancelled');
  };

  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    
    const batch = writeBatch(firestore);
    batch.update(appointmentRef, {
        status: 'ready_for_checkout',
        checkoutState,
        actualEndTime: new Date().toISOString(),
    });
    
    const appointment = appointments?.find(a => a.id === appointmentId);
    if (appointment?.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
        batch.update(checkInRef, { status: 'ready_for_checkout' });
    }

    if (appointment?.staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId);
        batch.update(staffDocRef, { status: 'idle' });
    }

    batch.commit().then(() => {
        toast({
            title: "Service Finished",
            description: "The appointment has been sent to the front desk for checkout."
        });
        setIsTechnicianReviewOpen(false);
        setIsDetailsOpen(false);
    });
  };

  const handleAddAppointment = async (data: any) => {
    if (!firestore || !tenantId) return;
    const id = nanoid();
    const token = nanoid(16);
    const apt = { ...data, id, tenantId, checkInToken: token, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString(), source: 'manual' };
    await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), apt, {});
    await setDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), apt, {});
    setIsAddAppointmentOpen(false);
    toast({ title: "Appointment Booked" });
  };

  const handleFinishService = (apt: Appointment) => {
      setSelectedAppointment(apt);
      setIsTechnicianReviewOpen(true);
  };

  const handleStartService = (id: string) => {
    if (!firestore || !tenantId) return;
    const now = new Date().toISOString();
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
    
    const batch = writeBatch(firestore);
    batch.update(appointmentRef, { status: 'servicing', actualStartTime: now });
    
    const apt = appointments?.find(a => a.id === id);
    if (apt?.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', apt.checkInToken);
        batch.update(checkInRef, { status: 'servicing' });
    }

    if (apt?.staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', apt.staffId);
        batch.update(staffDocRef, { status: 'busy' });
    }

    batch.commit();
  };

  const handleAddEvent = (data: any) => {
    if (!firestore || !tenantId) return;
    const id = nanoid();
    const event = { ...data, id, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString() };
    setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'events', id), event, {});
    setIsAddEventOpen(false);
    toast({ title: "Event Added" });
  };

  const handleLogPaymentConfirm = (paymentData: any) => {
    if (!selectedBill || !firestore || !user || !tenantId) return;
    
    const billInstanceRef = doc(firestore, 'tenants', tenantId, 'billInstances', selectedBill.id);
    const newAmountPaid = (selectedBill.amountPaid || 0) + paymentData.amount;
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
        hasReceipt: !!paymentData.receiptUrl,
        receiptUrl: paymentData.receiptUrl,
        relatedBillInstanceId: selectedBill.id,
    };
    const transactionsRef = collection(firestore, 'tenants', tenantId, 'transactions');
    addDocumentNonBlocking(transactionsRef, newTransaction);
    
    toast({
        title: "Payment Logged",
        description: `A payment of $${paymentData.amount.toFixed(2)} has been logged for ${selectedBill.definition.name}.`
    })

    setSelectedBill(null);
  };

  const handleOverrideConfirm = async (staffId: string, reason: string) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
    const checkInRef = selectedAppointment.checkInToken ? doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken) : null;

    const updates = {
        status: 'confirmed',
        checkInStatus: 'pending',
        overrideReason: reason,
        overriddenBy: staffId,
        cancellationFeeWaived: true,
    };

    updateDocumentNonBlocking(appointmentRef, updates);
    if (checkInRef) updateDocumentNonBlocking(checkInRef, updates);

    toast({ title: "Override Complete", description: "The appointment has been restored." });
    setIsOverrideOpen(false);
    setIsDetailsOpen(false);
  };

  return (
    <div className="flex h-screen w-full flex-col">
      <AppHeader />
      <div className="p-4 border-b">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setCurrentDate(subDays(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronLeft /></Button>
                        <Button variant="outline" onClick={() => setCurrentDate(addDays(currentDate, 1))} size="icon" className="h-8 w-8"><ChevronRight /></Button>
                        <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-8">Today</Button>
                        <Separator orientation="vertical" className="h-6" />
                        <RadioGroup value={activeView} onValueChange={(v: any) => handleViewChange(v)} className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
                            <Label htmlFor="staff-view" className="flex items-center justify-center rounded-sm p-1 cursor-pointer transition-colors peer-data-[state=checked]:bg-background"><User className="h-3.5 w-3.5" /><RadioGroupItem value="staff" id="staff-view" className="sr-only" /></Label>
                            <Label htmlFor="res-view" className="flex items-center justify-center rounded-sm p-1 cursor-pointer transition-colors peer-data-[state=checked]:bg-background"><Building className="h-3.5 w-3.5" /><RadioGroupItem value="resources" id="res-view" className="sr-only" /></Label>
                        </RadioGroup>
                    </div>
                    <div className="flex items-center gap-2">
                        {(role === 'owner' || role === 'admin') && (
                            <div className="flex items-center gap-2 mr-2">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="outline" size="icon" className="relative h-8 w-8" onClick={() => setIsBillsSheetOpen(true)}>
                                                <CreditCard className="h-4 w-4" />
                                                {billsDue.length > 0 && (
                                                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                                                        {billsDue.length}
                                                    </span>
                                                )}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Bills Due</p></TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsKpiSheetOpen(true)}>
                                                <BarChart className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Weekly Stats</p></TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        )}
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIsScannerOpen(true)}><QrCode className="h-4 w-4" /></Button>
                        <Button size="sm" className="hidden lg:flex h-8" onClick={() => { setClientForNewApt(null); setIsAddAppointmentOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add Appointment</Button>
                    </div>
                </div>
                <ScrollArea className="w-full">
                    <div className="flex w-full px-4 md:px-0">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => setCurrentDate(day)} className={cn("flex-1 py-2 text-center md:p-3 transition-colors hover:bg-muted/50 rounded-md", isSameDay(day, currentDate) && "bg-muted")}>
                                <p className={cn("text-xs", isSameDay(day, currentDate) ? "text-primary font-bold" : "text-muted-foreground")}>{format(day, 'EEE')}</p>
                                <p className={cn("text-lg md:text-2xl font-bold mt-1", !isSameDay(day, currentDate) && "text-muted-foreground")}>{format(day, 'd')}</p>
                            </button>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </div>
      </div>
      
      <main className="flex-1 flex flex-col min-h-0">
            <DayTimeline 
                date={currentDate} 
                columns={activeView === 'staff' ? staff : resources || []} 
                itemsByColumn={itemsByColumn}
                showColumnHeader={activeView === 'resources'} isMobile={isMobile || false} activeView={activeView}
                allStaff={allStaff || []} 
                mobileSelectedColumnId={mobileSelectedColumnId} 
                onMobileColumnChange={onMobileColumnChange}
                onCompleteClick={a => router.push(`/pos?checkout_id=${a.id}`)} onUpdateStatus={handleUpdateStatus} onDeleteAppointment={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
                onPrintReceipt={setReceiptToPrint} onPrintTicket={setTicketToPrint} onEditAppointment={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
                onEditEvent={e => { setSelectedEvent(e); setIsEditEventOpen(true); }} onChecklistItemToggle={() => {}} onUpdateEvent={() => {}}
                dailyTransactions={transactions?.filter(t => isSameDay(new Date(t.date), currentDate)) || []} allTransactions={transactions || []} onAddTransaction={() => {}}
                onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }} onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
                onStartService={handleStartService}
                onFinishService={handleFinishService} onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
                onDeleteEvent={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id))} onViewDetails={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
                walkIns={walkIns} clients={clients} services={services} resources={resources || []} publicScheduleProfile={publicScheduleProfile}
            />
      </main>

      <AppointmentDetailsSheet 
        open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment}
        client={clients?.find(c => c.id === selectedAppointment?.clientId) || null}
        service={services?.find(s => s.id === selectedAppointment?.serviceId) || null}
        tmhr={tmhr} transactions={transactions || []}
        onStartService={handleStartService}
        onFinishService={handleFinishService}
        onEdit={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
        onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
        onCancel={handleCancelAppointment}
        onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }}
        onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
        onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
        onPrintTicket={setTicketToPrint}
        onOverride={() => setIsOverrideOpen(true)}
      />

      <OverrideCancellationDialog 
        open={isOverrideOpen}
        onOpenChange={setIsOverrideOpen}
        staff={allStaff || []}
        onConfirm={handleOverrideConfirm}
      />

      <TechnicianReviewDialog 
        open={isTechnicianReviewOpen}
        onOpenChange={setIsTechnicianReviewOpen}
        appointmentData={{
            appointment: selectedAppointment!,
            client: clients?.find(c => c.id === selectedAppointment?.clientId)!,
            service: services?.find(s => s.id === selectedAppointment?.serviceId)!
        }}
        staff={allStaff || []}
        onSendToFrontDesk={handleSendToFrontDesk}
      />

      <AddAppointmentDialog open={isAddAppointmentOpen} onOpenChange={setIsAddAppointmentOpen} onConfirm={handleAddAppointment} client={clientForNewApt} appointmentToRebook={appointmentToRebook} memberships={memberships || []} />
      <AddEventDialog open={isAddEventOpen} onOpenChange={setIsAddEventOpen} onConfirm={handleAddEvent} staff={allStaff || []} />
      {selectedAppointment && <EditAppointmentDialog open={isEditAppointmentOpen} onOpenChange={setIsEditAppointmentOpen} appointment={selectedAppointment} clients={clients || []} services={services || []} appointments={appointments || []} onConfirm={a => updateDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', a.id), a)} />}
      
      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="p-4"><DialogTitle>Scan Ticket</DialogTitle></DialogHeader>
          <div className="p-4 relative"><div id="qr-reader-planner" className="w-full aspect-square rounded-md bg-muted" /><div className="absolute inset-4 flex items-center justify-center pointer-events-none"><div className="w-2/3 h-2/3 border-4 border-primary/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" /></div></div>
          <DialogFooter className="p-4 pt-0"><Button variant="outline" onClick={() => setIsScannerOpen(false)} type="button">Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <FloatingActionButton 
        onNewAppointmentClick={() => { setClientForNewApt(null); setIsAddAppointmentOpen(true); }}
        onNewEventClick={() => setIsAddEventOpen(true)}
      />

      <BillsDueSheet 
        open={isBillsSheetOpen} 
        onOpenChange={setIsBillsSheetOpen} 
        billInstances={billsDue as any} 
        isMobile={isMobile || false} 
        onLogPaymentClick={(instance) => {
            setSelectedBill(instance as any);
            setIsBillsSheetOpen(false);
        }}
      />

      <WeeklyKpiSheet 
        open={isKpiSheetOpen} 
        onOpenChange={setIsKpiSheetOpen} 
        kpis={kpis} 
        isMobile={isMobile || false} 
      />

      {selectedBill && (
        <LogPaymentDialog
            open={!!selectedBill}
            onOpenChange={(isOpen) => !isOpen && setSelectedBill(null)}
            billInstance={selectedBill}
            onConfirm={handleLogPaymentConfirm}
        />
      )}
    </div>
  );
}

export default function PlannerPageWrapper() { return <Suspense fallback={<div className="flex h-screen w-full flex-col"><AppHeader /><div className="flex items-center justify-center flex-1"><Loader className="h-8 w-8 animate-spin" /></div></div>}><PlannerPageContent /></Suspense> }
