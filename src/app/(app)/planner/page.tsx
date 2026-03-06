
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, BarChart, Calendar as CalendarIcon, User, Building, QrCode, Sparkles, CreditCard } from 'lucide-react';
import { type Appointment, type Event, type Staff, type Resource, type Membership, type AppointmentCheckoutState } from '@/lib/data';
import { type BillInstance, type BillDefinition, type Transaction } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, endOfDay, differenceInDays, isPast, isToday, startOfDay, isSameDay, subWeeks, addWeeks, eachDayOfInterval, parseISO } from 'date-fns';
import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useFirebase, useCollection, useMemoFirebase, deleteDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
import { collection, doc, writeBatch, query, where, increment, arrayUnion } from 'firebase/firestore';
import { useIsMobile } from '@/hooks/use-mobile';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { FloatingActionButton } from '@/components/planner/FloatingActionButton';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const { user: currentUser } = useUser();
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
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedBill, setSelectedBill] = useState<(BillInstance & { definition: BillDefinition }) | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  const [clientForNewApt, setClientForNewApt] = useState<Client | null>(null);
  const [appointmentToRebook, setAppointmentToRebook] = useState<Appointment | null>(null);

  const { toast } = useToast();
  const [mobileSelectedColumnId, setMobileSelectedColumnId] = useState<string>('');
  const [activeView, setActiveView] = useState<'staff' | 'resources'>(viewParam === 'resources' ? 'resources' : 'staff');
    
  const { data: scheduleProfilesData } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]));
  const { data: resourcesData } = useCollection<Resource>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'resources'), [firestore, tenantId]));
  const publicScheduleProfile = useMemo(() => scheduleProfilesData?.find(p => p.isActive), [scheduleProfilesData]);

  const staff = useMemo(() => (role === 'staff' && currentUser) ? (allStaff || []).filter(s => s.id === currentUser.uid) : (allStaff || []), [allStaff, role, currentUser]);
  
  const columns = useMemo(() => {
    let cols: any[] = activeView === 'staff' ? (staff || []) : (resourcesData || []);
    if (role === 'owner' || role === 'admin') {
        cols = [{ id: 'business', name: 'Studio', isBusiness: true }, ...cols];
    }
    return cols;
  }, [activeView, staff, resourcesData, role]);

  useEffect(() => { 
    if (columns.length > 0 && !mobileSelectedColumnId) {
        setMobileSelectedColumnId(columns[0].id); 
    }
  }, [columns, mobileSelectedColumnId]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 0 }), i)), [currentDate]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, (Appointment | Event | BillInstance)[]>();
    (columns || []).forEach(c => map.set(c.id, []));
    
    appointments?.filter(a => isSameDay(safeDate(a.startTime), currentDate)).forEach(a => {
        if (activeView === 'staff') { if (a.staffId && map.has(a.staffId)) map.get(a.staffId)!.push({ ...a, itemType: 'appointment' } as any); }
        else { (a.requiredResourceIds || []).forEach(rid => { if (map.has(rid)) map.get(rid)!.push({ ...a, itemType: 'appointment' } as any); }); }
    });

    if (map.has('business')) {
        billInstances?.filter(i => isSameDay(safeDate(i.dueDate), currentDate)).forEach(i => {
            const def = billDefinitions.find(d => d.id === i.billDefinitionId);
            map.get('business')!.push({ ...i, definition: def, itemType: 'bill' } as any);
        });
    }

    events?.filter(e => isSameDay(safeDate(e.startTime), currentDate)).forEach(e => {
        const targetStaffIds = e.staffIds || [];
        const isGlobal = targetStaffIds.length === 0 || targetStaffIds.includes('all');
        
        if (isGlobal) {
            if (map.has('business')) map.get('business')!.push({ ...e, itemType: 'event' } as any);
            if (e.type === 'blocked' && activeView === 'staff') {
                columns.forEach(col => {
                    if (col.id !== 'business' && map.has(col.id)) {
                        map.get(col.id)!.push({ ...e, itemType: 'event', isSecondary: true } as any);
                    }
                });
            }
        } else if (activeView === 'staff') {
            targetStaffIds.forEach(sid => {
                if (map.has(sid)) map.get(sid)!.push({ ...e, itemType: 'event' } as any);
            });
        }
    });

    map.forEach(items => items.sort((a,b) => safeDate(a.startTime || a.dueDate).getTime() - safeDate(b.startTime || b.dueDate).getTime()));
    return map;
  }, [currentDate, appointments, columns, activeView, billInstances, billDefinitions, events]);

  const kpis = useMemo(() => {
    if (!transactions || !appointments || !services || !selectedTenant) {
      return { weeklyRevenue: 0, projectedRevenue: 0, weeklyBreakEven: 0, weeklyNetProfit: 0, absorbedCosts: 0 };
    }
    const start = startOfWeek(currentDate);
    const end = endOfDay(addDays(start, 6));
    const weeklyTransactions = transactions.filter(t => { const d = safeDate(t.date); return d >= start && d <= end; });
    const revenue = weeklyTransactions.filter(t => t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail')).reduce((acc, t) => acc + t.amount, 0);
    const absorbed = weeklyTransactions.filter(t => t.type === 'expense' && t.category === 'Discounts').reduce((acc, t) => acc + t.amount, 0);
    const waivedTotal = appointments.filter(a => { const d = safeDate(a.startTime); return d >= start && d <= end && a.cancellationFeeWaived; }).reduce((acc, a) => acc + (a.cancellationFeeApplied || 0), 0);
    const projected = appointments.filter(a => { const d = safeDate(a.startTime); return d >= start && d <= end && (a.status === 'confirmed' || a.status === 'deposit_pending'); }).reduce((acc, a) => { const svc = services.find(s => s.id === a.serviceId); return acc + (svc?.price || 0); }, 0);
    const weeklyBreakEven = ((selectedTenant.tmhr || 50) * 160 / 30.44) * 7;
    return { weeklyRevenue: revenue, projectedRevenue: projected, weeklyBreakEven, weeklyNetProfit: revenue - weeklyBreakEven, absorbedCosts: absorbed + waivedTotal };
  }, [transactions, appointments, services, currentDate, selectedTenant]);

  const billInstancesWithDefinitions = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    const today = startOfDay(new Date());
    return billInstances.filter(i => { const d = safeDate(i.dueDate); return i.status !== 'paid' && (isPast(d) || isToday(d) || differenceInDays(d, today) <= 7); })
        .map(instance => { const definition = billDefinitions.find(def => def.id === instance.billDefinitionId); return definition ? { ...instance, definition } : null; }).filter((i): i is any => i !== null);
  }, [billInstances, billDefinitions]);

  const handleUpdateStatus = (id: string, status: Appointment['status']) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
    updateDocumentNonBlocking(appointmentRef, { status });
    const apt = appointments?.find(a => a.id === id);
    if (apt?.checkInToken) updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status, tenantId });
    toast({ title: "Status Updated" });
  };

  const handleConfirmCancellation = async (data: any) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
    const clientRef = doc(firestore, 'tenants', tenantId, 'clients', selectedAppointment.clientId);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    batch.update(appointmentRef, { status: 'cancelled', cancellationReason: data.reason, cancellationFeeApplied: data.feeAmount, cancellationPaymentStatus: data.paymentMethod === 'card_on_file' ? 'paid' : (data.paymentMethod === 'waived' ? 'waived' : 'unpaid') });
    if (selectedAppointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), { status: 'cancelled', cancellationReason: data.reason, tenantId });
    if (data.chargeFee && data.feeAmount > 0) {
        if (data.paymentMethod === 'card_on_file') batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), { date: now, description: `Cancellation Fee: ${selectedAppointment.clientName}`, clientOrVendor: selectedAppointment.clientName || 'Client', clientId: selectedAppointment.clientId, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: data.feeAmount, paymentMethod: 'Card on File', hasReceipt: false, appointmentId: selectedAppointment.id, staffId: selectedAppointment.staffId });
        else if (data.paymentMethod === 'add_to_balance') batch.update(clientRef, { unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: selectedAppointment.id, appointmentDate: safeDate(selectedAppointment.startTime).toISOString(), feeAmount: data.feeAmount, reason: `Late Cancellation: ${data.reason.replace('_', ' ')}`, staffId: selectedAppointment.staffId }), outstandingBalance: increment(data.feeAmount) });
    }
    await batch.commit();
    setIsCancelDialogOpen(false);
    setIsDetailsOpen(false);
  };

  const handleStartService = (id: string) => {
    if (!firestore || !tenantId || !appointments) return;
    const now = new Date().toISOString();
    const appointment = appointments.find(a => a.id === id);
    if (!appointment) return;
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'appointments', id), { status: 'servicing', actualStartTime: now });
    if (appointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', appointment.checkInToken), { status: 'servicing', tenantId });
    if (appointment.staffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId), { status: 'busy' }, { merge: true });
    batch.commit();
  };

  const handleFinishService = (apt: Appointment) => { setSelectedAppointment(apt); setIsTechnicianReviewOpen(true); };

  const handleLogPaymentConfirm = (paymentData: any) => {
    if (!selectedBill || !firestore || !tenantId) return;
    const isVirtual = selectedBill.id.startsWith('virtual-');
    const newAmountPaid = selectedBill.amountPaid + paymentData.amount;
    const newAmountDue = selectedBill.amountDue - paymentData.amount;
    const newStatus = newAmountDue <= 0 ? 'paid' : 'partially-paid';
    const batch = writeBatch(firestore);
    const finalInstanceId = isVirtual ? doc(collection(firestore, 'tenants', tenantId, 'billInstances')).id : selectedBill.id;
    if (isVirtual) batch.set(doc(firestore, 'tenants', tenantId, 'billInstances', finalInstanceId), { id: finalInstanceId, billDefinitionId: selectedBill.billDefinitionId, dueDate: selectedBill.dueDate, amountDue: newAmountDue, amountPaid: newAmountPaid, status: newStatus });
    else batch.update(doc(firestore, 'tenants', tenantId, 'billInstances', finalInstanceId), { amountPaid: newAmountPaid, amountDue: newAmountDue, status: newStatus });
    batch.set(doc(collection(firestore, 'tenants', tenantId, 'transactions')), { date: paymentData.date.toISOString(), description: `Payment for ${selectedBill.definition.name}`, clientOrVendor: selectedBill.definition.name, type: 'payment', context: selectedBill.definition.context, category: selectedBill.definition.category, amount: paymentData.amount, paymentMethod: paymentData.paymentMethod, hasReceipt: !!paymentData.receiptUrl, receiptUrl: paymentData.receiptUrl, relatedBillInstanceId: finalInstanceId });
    batch.commit().then(() => { toast({ title: "Payment Logged" }); });
    setSelectedBill(null);
  };

  const handleOverrideConfirm = async (staffId: string, reason: string) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    const updates = { status: 'confirmed', checkInStatus: 'pending', overrideReason: reason, overriddenBy: staffId, cancellationFeeWaived: true };
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id), updates);
    if (selectedAppointment.checkInToken) updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), { ...updates, tenantId });
    toast({ title: "Override Complete" });
    setIsOverrideOpen(false);
    setIsDetailsOpen(false);
  };

  if (isLoading) return <div className="flex h-screen w-full items-center justify-center bg-background"><Loader className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex h-screen w-full flex-col bg-white">
      <AppHeader />
      <div className="p-4 md:p-8 border-b bg-white/50 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="space-y-1">
                        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Studio Planner</h1>
                        <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Synchronized studio agenda</p>
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        {(role === 'owner' || role === 'admin') && (
                            <div className="flex gap-2 mr-2">
                                <Button variant="outline" size="icon" className="relative h-12 w-12 rounded-2xl border-2" onClick={() => setIsBillsSheetOpen(true)}>
                                    <CreditCard className="h-5 w-5" />
                                    {billInstancesWithDefinitions.length > 0 && <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-black text-white shadow-lg border-2 border-white">{billInstancesWithDefinitions.length}</span>}
                                </Button>
                                <Button variant="outline" size="icon" className="h-12 w-12 rounded-2xl border-2" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="h-5 w-5" /></Button>
                            </div>
                        )}
                        <Button variant="outline" size="icon" className="h-12 w-12 rounded-2xl border-2" onClick={() => setIsScannerOpen(true)}><QrCode className="h-5 w-5" /></Button>
                        <Button size="lg" className="flex-1 md:flex-none h-14 px-8 rounded-2xl shadow-xl font-black uppercase tracking-widest text-[10px] shadow-primary/20" onClick={() => { setClientForNewApt(null); setIsAddAppointmentOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>New Session</Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-3xl border-2 border-muted shadow-inner max-w-fit">
                        <Button variant="ghost" onClick={() => setCurrentDate(subDays(currentDate, 1))} size="icon" className="h-10 w-10 rounded-2xl hover:bg-white shadow-sm"><ChevronLeft className="w-5 h-5"/></Button>
                        <div className="px-4 text-center min-w-[140px]">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary leading-none mb-1">{format(currentDate, 'MMMM yyyy')}</p>
                            <p className="text-lg font-black text-slate-900 leading-none">{format(currentDate, 'EEEE, do')}</p>
                        </div>
                        <Button variant="ghost" onClick={() => setCurrentDate(addDays(currentDate, 1))} size="icon" className="h-10 w-10 rounded-2xl hover:bg-white shadow-sm"><ChevronRight className="w-5 h-5"/></Button>
                        <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-10 px-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 border-white shadow-sm bg-white/50">Today</Button>
                    </div>

                    <div className="flex items-center gap-4 md:justify-end">
                        <RadioGroup value={activeView} onValueChange={(v: any) => setActiveView(v)} className="flex gap-2 p-2 bg-muted/30 rounded-2xl border-2 border-muted shadow-inner">
                            <Label htmlFor="staff-v" className={cn("flex items-center gap-2 h-10 px-4 rounded-xl cursor-pointer font-black text-[10px] uppercase tracking-widest transition-all", activeView === 'staff' ? "bg-white text-primary shadow-md" : "text-muted-foreground hover:bg-white/50")}><User className="w-3.5 h-3.5" /> Providers <RadioGroupItem value="staff" id="staff-v" className="sr-only" /></Label>
                            <Label htmlFor="res-v" className={cn("flex items-center gap-2 h-10 px-4 rounded-xl cursor-pointer font-black text-[10px] uppercase tracking-widest transition-all", activeView === 'resources' ? "bg-white text-primary shadow-md" : "text-muted-foreground hover:bg-white/50")}><Building className="w-3.5 h-3.5" /> Resources <RadioGroupItem value="resources" id="res-v" className="sr-only" /></Label>
                        </RadioGroup>
                    </div>
                </div>

                <ScrollArea className="w-full">
                    <div className="flex w-full gap-2 px-1">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => setCurrentDate(day)} className={cn("flex-1 py-4 min-w-[80px] rounded-3xl transition-all border-4 flex flex-col items-center gap-1", isSameDay(day, currentDate) ? "bg-primary border-primary shadow-2xl shadow-primary/20 -translate-y-1" : "bg-muted/50 border-transparent hover:bg-muted hover:scale-105")}>
                                <p className={cn("text-[10px] font-black uppercase tracking-widest", isSameDay(day, currentDate) ? "text-white/60" : "text-muted-foreground/60")}>{format(day, 'EEE')}</p>
                                <p className={cn("text-2xl font-black tracking-tighter", isSameDay(day, currentDate) ? "text-white" : "text-slate-900")}>{format(day, 'd')}</p>
                            </button>
                        ))}
                    </div>
                    <ScrollBar orientation="horizontal" className="hidden" />
                </ScrollArea>
            </div>
      </div>
      
      <main className="flex-1 flex flex-col min-h-0 bg-slate-50/50">
            <DayTimeline 
                date={currentDate} columns={columns} itemsByColumn={itemsByColumn}
                showColumnHeader={activeView === 'resources'} isMobile={isMobile || false} activeView={activeView}
                allStaff={allStaff || []} mobileSelectedColumnId={mobileSelectedColumnId} onMobileColumnChange={setMobileSelectedColumnId}
                onCompleteClick={a => router.push(`/pos?checkout_id=${a.id}`)} onUpdateStatus={handleUpdateStatus} onDeleteAppointment={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
                onPrintReceipt={() => {}} onPrintTicket={() => {}} onEditAppointment={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
                onEditEvent={e => { setSelectedEvent(e); setIsEditEventOpen(true); }} onChecklistItemToggle={() => {}} onUpdateEvent={() => {}}
                dailyTransactions={transactions?.filter(t => isSameDay(safeDate(t.date), currentDate)) || []} allTransactions={transactions || []} onAddTransaction={() => {}}
                onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }} onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
                onStartService={handleStartService} onFinishService={handleFinishService} onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
                onDeleteEvent={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id))} onViewDetails={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
                walkIns={walkIns} clients={clients} services={services} resources={resourcesData || []}
            />
      </main>

      <AppointmentDetailsSheet 
        open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment}
        client={clients?.find(c => c.id === selectedAppointment?.clientId) || null}
        service={services?.find(s => s.id === selectedAppointment?.serviceId) || null}
        tmhr={tmhr} transactions={transactions || []}
        onStartService={handleStartService} onFinishService={handleFinishService}
        onEdit={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
        onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
        onCancel={id => { setSelectedAppointment(appointments.find(a=>a.id===id)||null); setIsCancelDialogOpen(true); }}
        onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }}
        onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
        onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
        onPrintTicket={() => {}} onOverride={() => setIsOverrideOpen(true)}
        onWaiveFee={(id, aut, res) => {
            const batch = writeBatch(firestore!);
            const apt = appointments.find(a=>a.id===id);
            if(!apt) return;
            batch.update(doc(firestore!, `tenants/${tenantId}/appointments`, id), { cancellationFeeWaived: true, waivedBy: aut.id, waivedReason: res, waivedAt: new Date().toISOString() });
            batch.update(doc(firestore!, `tenants/${tenantId}/clients`, apt.clientId), { outstandingBalance: increment(-(apt.cancellationFeeApplied||0)) });
            batch.commit().then(() => toast({ title: "Fee Absorbed" }));
        }}
      />

      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={allStaff || []} onConfirm={handleOverrideConfirm} />
      {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={handleConfirmCancellation} />}
      {selectedAppointment && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: selectedAppointment, client: clients?.find(c => c.id === selectedAppointment.clientId), service: services?.find(s => s.id === selectedAppointment.serviceId) }} staff={allStaff || []} onSendToFrontDesk={(aid, st) => {
          const appointmentRef = doc(firestore!, 'tenants', tenantId!, 'appointments', aid);
          const allPartIds = [selectedAppointment.serviceId, ...(selectedAppointment.addOnIds || [])];
          const allDone = (st.completedServiceIds || []).length >= allPartIds.length;
          const batch = writeBatch(firestore!);
          batch.update(appointmentRef, { status: allDone ? 'ready_for_checkout' : 'servicing', checkoutState: st, actualEndTime: allDone ? new Date().toISOString() : null });
          involvedStaffIds(selectedAppointment, st).forEach(sid => batch.set(doc(firestore!, 'tenants', tenantId!, 'staff', sid), { status: 'idle' }, { merge: true }));
          batch.commit().then(() => { toast({ title: allDone ? "Sent to Desk" : "Part Complete" }); setIsTechnicianReviewOpen(false); setIsDetailsOpen(false); });
      }} />}

      <AddAppointmentDialog open={isAddAppointmentOpen} onOpenChange={setIsAddAppointmentOpen} onConfirm={async (data) => {
          const id = nanoid();
          const token = nanoid(16);
          const apt = { ...data, id, tenantId, checkInToken: token, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString(), source: 'manual' };
          await setDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id), apt, {});
          await setDocumentNonBlocking(doc(firestore!, 'appointmentCheckIns', token), apt, {});
          setIsAddAppointmentOpen(false); toast({ title: "Booked" });
      }} client={clientForNewApt} appointmentToRebook={appointmentToRebook} memberships={memberships || []} />
      <AddEventDialog open={isAddEventOpen} onOpenChange={setIsAddEventOpen} onConfirm={async (data) => {
          const id = nanoid();
          await setDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id), { ...data, id, tenantId, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString() }, {});
          setIsAddEventOpen(false); toast({ title: "Event Added" });
      }} staff={allStaff || []} />
      <FloatingActionButton onNewAppointmentClick={() => { setClientForNewApt(null); setIsAddAppointmentOpen(true); }} onNewEventClick={() => setIsAddEventOpen(true)} />
      <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={billInstancesWithDefinitions} isMobile={isMobile || false} onLogPaymentClick={(instance) => { setSelectedBill(instance as any); setIsBillsSheetOpen(false); }} />
      <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={kpis} isMobile={isMobile || false} />
      {selectedBill && <LogPaymentDialog open={!!selectedBill} onOpenChange={(isOpen) => !isOpen && setSelectedBill(null)} billInstance={selectedBill} onConfirm={handleLogPaymentConfirm} />}
    </div>
  );
}

const involvedStaffIds = (apt: Appointment, st: AppointmentCheckoutState) => {
    const ids = new Set<string>();
    if (apt.staffId) ids.add(apt.staffId);
    if (st.serviceStaffOverrides) Object.values(st.serviceStaffOverrides).forEach(id => ids.add(id));
    return Array.from(ids);
};

export default function PlannerPageWrapper() { return <Suspense fallback={<div className="flex h-screen w-full flex-col"><AppHeader /><div className="flex items-center justify-center flex-1"><Loader className="h-8 w-8 animate-spin" /></div></div>}><PlannerPageContent /></Suspense> }
