
'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, BarChart, Calendar as CalendarIcon, User, Building, QrCode, Sparkles, CreditCard, AlertTriangle } from 'lucide-react';
import { type Appointment, type Event, type Staff, type Resource, type Membership, type AppointmentCheckoutState } from '@/lib/data';
import { type BillInstance, type BillDefinition, type Transaction } from '@/lib/financial-data';
import { format, addDays, subDays, startOfWeek, endOfDay, differenceInDays, isPast, isToday, startOfDay, isSameDay, subWeeks, addWeeks, eachDayOfInterval, parseISO, addMinutes, addMonths, subMinutes } from 'date-fns';
import { query, where, collection, doc, writeBatch, increment, arrayUnion } from 'firebase/firestore';
import React, { useState, useMemo, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/AddEventDialog';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useFirebase, useCollection, useMemoFirebase, deleteDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
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

const involvedStaffIds = (apt: Appointment, st: AppointmentCheckoutState) => {
    const ids = new Set<string>();
    if (apt.staffId) ids.add(apt.staffId);
    if (st.serviceStaffOverrides) {
        Object.values(st.serviceStaffOverrides).forEach((id: any) => {
            if (id && typeof id === 'string') ids.add(id);
        });
    }
    return Array.from(ids);
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
    
  const onMobileColumnChange = useCallback((id: string) => {
    setMobileSelectedColumnId(id);
  }, []);

  const { data: scheduleProfilesData } = useCollection<any>(useMemoFirebase(() => !firestore || !tenantId ? null : query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where("isPublic", "==", true)), [firestore, tenantId]));
  const { data: resourcesData } = useCollection<Resource>(useMemoFirebase(() => !firestore || !tenantId ? null : collection(firestore, 'tenants', tenantId, 'resources'), [firestore, tenantId]));
  const publicScheduleProfile = useMemo(() => scheduleProfilesData?.find(p => p.isActive), [scheduleProfilesData]);

  const staff = useMemo(() => {
    if (role === 'staff' && currentUser) {
        return (allStaff || []).filter(s => s.id === currentUser.uid);
    }
    return (allStaff || []);
  }, [allStaff, role, currentUser]);
  
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
        if (activeView === 'staff') { 
            const involvedIds = involvedStaffIds(a, a.checkoutState || {} as any);
            involvedIds.forEach(sid => {
                if (map.has(sid)) {
                    map.get(sid)!.push({ ...a, itemType: 'appointment', isSecondary: sid !== a.staffId } as any);
                }
            });
        }
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

  const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
    if (!firestore || !tenantId || !selectedTenant) return;
    const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
    
    if (status === 'running_late' && lateMinutes && !isWalkIn) {
        const apt = appointments?.find(a => a.id === id);
        if (apt) {
            const grace = selectedTenant.lateArrivalGracePeriod || 15;
            const overGrace = lateMinutes > grace;
            const autoCancel = selectedTenant.autoCancelLateArrivals === true;

            const staffId = apt.staffId;
            let clash = null;
            if (staffId) {
                const currentService = services?.find(s => s.id === apt.serviceId);
                const currentDuration = currentService?.duration || 0;
                const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes);
                const theoreticalEnd = addMinutes(theoreticalStart, currentDuration + (currentService?.padAfter || 0));

                const nextApt = (appointments || [])
                    .filter(a => a.staffId === staffId && a.id !== apt.id && a.status === 'confirmed' && safeDate(a.startTime) > safeDate(apt.startTime))
                    .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];

                if (nextApt) {
                    const nextService = services?.find(s => s.id === nextApt.serviceId);
                    const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0);
                    if (theoreticalEnd > nextStartWithPad) {
                        clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') };
                    }
                }
            }

            if ((overGrace && autoCancel) || clash) {
                const reason = clash ? 'clash' : 'late';
                const fee = selectedTenant.cancellationFee || 0;
                const batch = writeBatch(firestore);
                batch.update(docRef, { checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: reason, cancellationFeeApplied: fee });
                if (fee > 0 && apt.clientId) {
                    batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Auto-Cancelled: ${clash ? 'Clash with next session' : 'Beyond grace period'}` }) });
                }
                batch.commit().then(() => {
                    toast({ variant: "destructive", title: clash ? "Conflict: Auto-Cancelled" : "Late: Auto-Cancelled", description: clash ? `Arriving +${lateMinutes}m overlaps with session at ${clash.clashTime}.` : `Arrival of +${lateMinutes}m is beyond the ${grace}m grace period.` });
                });
                return;
            }
        }
    }

    const updates: any = { checkInStatus: status };
    if (lateMinutes !== undefined) updates.lateTimeMinutes = lateMinutes;
    updateDocumentNonBlocking(docRef, updates);
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
    batch.set(doc(collection(firestore, 'tenants', tenantId, 'transactions')), { date: paymentData.date.toISOString(), description: `Payment for ${selectedBill.definition.name}`, clientOrVendor: selectedBill.definition.name, type: 'payment', context: 'Business', category: selectedBill.definition.category, amount: paymentData.amount, paymentMethod: paymentData.paymentMethod, hasReceipt: !!paymentData.receiptUrl, receiptUrl: paymentData.receiptUrl, relatedBillInstanceId: finalInstanceId });
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

  const handleUpdateAppointment = (apt: Appointment) => {
      if (!firestore || !tenantId) return;
      const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', apt.id);
      updateDocumentNonBlocking(appointmentRef, apt);
      if (apt.checkInToken) updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { ...apt, tenantId });
      setIsEditAppointmentOpen(false);
      toast({ title: "Session Updated" });
  };

  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    
    const apt = appointments?.find(a => a.id === appointmentId);
    if (!apt) return;

    const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];
    const completedIds = checkoutState.completedServiceIds || [];
    const allComplete = completedIds.length >= allPartIds.length;

    const batch = writeBatch(firestore);
    
    if (allComplete) {
        batch.update(appointmentRef, {
            status: 'ready_for_checkout',
            checkoutState,
            actualEndTime: new Date().toISOString(),
        });
        if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout', tenantId });
        
        const involvedIds = new Set<string>();
        if (apt.staffId) involvedIds.add(apt.staffId);
        if (checkoutState.serviceStaffOverrides) {
            Object.values(checkoutState.serviceStaffOverrides).forEach((id: any) => {
                if (id && typeof id === 'string') involvedIds.add(id);
            });
        }
        involvedIds.forEach(sid => {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true });
        });
    } else {
        batch.update(appointmentRef, { checkoutState });
        
        const overrides = checkoutState.serviceStaffOverrides || {};
        const involvedStaffIdsSet = new Set<string>();
        if (apt.staffId) involvedStaffIdsSet.add(apt.staffId);
        Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedStaffIdsSet.add(id); });

        involvedStaffIdsSet.forEach(sid => {
            const hasRemainingParts = allPartIds.some(pid => {
                const isPartComplete = completedIds.includes(pid);
                if (isPartComplete) return false;
                const assignedToPart = overrides[pid] === sid || (pid === apt.serviceId && apt.staffId === sid && !overrides[pid]);
                return assignedToPart;
            });

            if (!hasRemainingParts) {
                batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true });
            }
        });

        const nextPartId = allPartIds.find(id => !completedIds.includes(id) && !(checkoutState.concurrentServiceIds || []).includes(id));
        const nextStaffId = overrides[nextPartId || ''] || (nextPartId === apt.serviceId ? apt.staffId : null);
        if (nextStaffId) {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', nextStaffId), { status: 'busy' }, { merge: true });
        }
    }

    batch.commit().then(() => {
        toast({
            title: allComplete ? "Service Finished" : "Part Completed",
            description: allComplete ? "The appointment has been sent to the front desk for checkout." : "Your part is done. Hand-off complete."
        });
        setIsTechnicianReviewOpen(false);
        setIsDetailsOpen(false);
    });
};

  if (isLoading) return <div className="flex h-screen w-full items-center justify-center bg-background"><Loader className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      <AppHeader />
      <div className="p-3 sm:p-4 md:p-8 border-b bg-white/50 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto space-y-6 sm:space-y-10">
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                        <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Studio Planner</h1>
                        <p className="hidden sm:block text-[10px] sm:text-xs text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">Synchronized studio agenda</p>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                        {(role === 'owner' || role === 'admin') && (
                            <div className="flex gap-1.5 sm:gap-2">
                                <Button variant="outline" size="icon" className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsBillsSheetOpen(true)}>
                                    <CreditCard className="h-4 w-4 sm:h-5 sm:w-5" />
                                    {billInstancesWithDefinitions.length > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-destructive text-[8px] sm:text-[10px] font-black text-white shadow-lg border-2 border-white">{billInstancesWithDefinitions.length}</span>}
                                </Button>
                                <Button variant="outline" size="icon" className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsKpiSheetOpen(true)}><BarChart className="h-4 w-4 sm:h-5 sm:w-5" /></Button>
                            </div>
                        )}
                        <Button variant="outline" size="icon" className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border-2" onClick={() => setIsScannerOpen(true)}><QrCode className="h-4 w-4 sm:h-5 sm:w-5" /></Button>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
                    <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-muted/30 rounded-2xl sm:rounded-3xl border-2 border-muted shadow-inner w-full md:w-auto overflow-x-auto scrollbar-hide justify-between sm:justify-start">
                        <Button variant="ghost" onClick={() => setCurrentDate(subDays(currentDate, 1))} size="icon" className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl hover:bg-white shadow-sm shrink-0"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5"/></Button>
                        <div className="px-2 sm:px-4 text-center min-w-[110px] sm:min-w-[140px]">
                            <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-primary leading-none mb-0.5 sm:mb-1">{format(currentDate, 'MMMM yyyy')}</p>
                            <p className="text-sm sm:text-lg font-black text-slate-900 leading-none truncate">{format(currentDate, 'EEEE, do')}</p>
                        </div>
                        <Button variant="ghost" onClick={() => setCurrentDate(addDays(currentDate, 1))} size="icon" className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl hover:bg-white shadow-sm shrink-0"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5"/></Button>
                        <Button variant="outline" onClick={() => setCurrentDate(new Date())} className="h-8 sm:h-10 px-2 sm:px-4 rounded-xl sm:rounded-2xl text-[8px] sm:text-[10px] font-black uppercase tracking-widest border-2 border-white shadow-sm bg-white/50 shrink-0">Today</Button>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto md:justify-end">
                        <RadioGroup value={activeView} onValueChange={(v: any) => setActiveView(v)} className="flex gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-muted/30 rounded-xl sm:rounded-2xl border-2 border-muted shadow-inner w-full md:w-auto justify-center">
                            <Label htmlFor="staff-v" className={cn("flex items-center justify-center gap-1.5 sm:gap-2 h-8 sm:h-10 px-2 sm:px-4 rounded-lg sm:rounded-xl cursor-pointer font-black text-[8px] sm:text-[10px] uppercase tracking-widest transition-all flex-1", activeView === 'staff' ? "bg-white text-primary shadow-md" : "text-muted-foreground hover:bg-white/50")}><User className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> Providers <RadioGroupItem value="staff" id="staff-v" className="sr-only" /></Label>
                            <Label htmlFor="res-v" className={cn("flex items-center justify-center gap-1.5 sm:gap-2 h-8 sm:h-10 px-2 sm:px-4 rounded-lg sm:rounded-xl cursor-pointer font-black text-[8px] sm:text-[10px] uppercase tracking-widest transition-all flex-1", activeView === 'resources' ? "bg-white text-primary shadow-md" : "text-muted-foreground hover:bg-white/50")}><Building className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> Resources <RadioGroupItem value="resources" id="res-v" className="sr-only" /></Label>
                        </RadioGroup>
                    </div>
                </div>

                <ScrollArea className="w-full">
                    <div className="flex w-full gap-1.5 sm:gap-2 px-1 pb-2">
                        {weekDays.map(day => (
                            <button key={day.toISOString()} onClick={() => setCurrentDate(day)} className={cn("flex-1 py-2 sm:py-4 min-w-[48px] sm:min-w-[80px] rounded-2xl sm:rounded-3xl transition-all border-2 sm:border-4 flex flex-col items-center gap-0.5 sm:gap-1", isSameDay(day, currentDate) ? "bg-primary border-primary shadow-2xl shadow-primary/20 -translate-y-0.5 sm:-translate-y-1" : "bg-muted/50 border-transparent hover:bg-muted hover:scale-105")}>
                                <p className={cn("text-[8px] sm:text-[10px] font-black uppercase tracking-widest", isSameDay(day, currentDate) ? "text-white/60" : "text-muted-foreground/60")}>{format(day, 'EEE')}</p>
                                <p className={cn("text-base sm:text-2xl font-black tracking-tighter", isSameDay(day, currentDate) ? "text-white" : "text-slate-900")}>{format(day, 'd')}</p>
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
                allStaff={allStaff || []} mobileSelectedColumnId={mobileSelectedColumnId} onMobileColumnChange={onMobileColumnChange}
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
            if (!firestore || !tenantId) return;
            const batch = writeBatch(firestore);
            const apt = appointments.find(a=>a.id===id);
            if(!apt) return;
            batch.update(doc(firestore, `tenants/${tenantId}/appointments`, id), { cancellationFeeWaived: true, waivedBy: aut.id, waivedReason: res, waivedAt: new Date().toISOString() });
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, apt.clientId), { outstandingBalance: increment(-(apt.cancellationFeeApplied||0)) });
            batch.commit().then(() => toast({ title: "Fee Absorbed" }));
        }}
      />

      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={allStaff || []} onConfirm={handleOverrideConfirm} />
      
      {selectedAppointment && (
          <EditAppointmentDialog 
            open={isEditAppointmentOpen} 
            onOpenChange={setIsEditAppointmentOpen} 
            appointment={selectedAppointment} 
            clients={clients || []} 
            services={services || []} 
            appointments={appointments} 
            onConfirm={handleUpdateAppointment} 
          />
      )}

      {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={handleConfirmCancellation} />}
      {selectedAppointment && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: selectedAppointment, client: clients?.find(c => c.id === selectedAppointment.clientId), service: services?.find(s => s.id === selectedAppointment.serviceId) }} staff={allStaff || []} onSendToFrontDesk={handleSendToFrontDesk} />}

      <AddAppointmentDialog open={isAddAppointmentOpen} onOpenChange={setIsAddAppointmentOpen} onConfirm={async (data) => {
          if (!firestore || !tenantId) return;
          const id = nanoid();
          const token = nanoid(16);
          const apt = { ...data, id, tenantId, checkInToken: token, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString(), source: 'manual' };
          await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), apt, {});
          await setDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), apt, {});
          setIsAddAppointmentOpen(false); toast({ title: "Booked" });
      }} client={clientForNewApt} appointmentToRebook={appointmentToRebook} memberships={memberships || []} />
      <AddEventDialog open={isAddEventOpen} onOpenChange={setIsAddEventOpen} onConfirm={async (data) => {
          if (!firestore || !tenantId) return;
          const id = nanoid();
          await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'events', id), { ...data, id, tenantId, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString() }, {});
          setIsAddEventOpen(false); toast({ title: "Event Added" });
      }} staff={allStaff || []} />
      <FloatingActionButton onNewAppointmentClick={() => { setClientForNewApt(null); setIsAddAppointmentOpen(true); }} onNewEventClick={() => setIsAddEventOpen(true)} />
      <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={billInstancesWithDefinitions} isMobile={isMobile || false} onLogPaymentClick={(instance) => { setSelectedBill(instance as any); setIsBillsSheetOpen(false); }} />
      <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={kpis} isMobile={isMobile || false} />
      {selectedBill && <LogPaymentDialog open={!!selectedBill} onOpenChange={(isOpen) => !isOpen && setSelectedBill(null)} billInstance={selectedBill} onConfirm={handleLogPaymentConfirm} />}
    </div>
  );
}

export default function PlannerPageWrapper() { return <Suspense fallback={<div>Loading...</div>}><PlannerPageContent /></Suspense> }
