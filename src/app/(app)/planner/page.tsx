'use client';

import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Loader, Clock, BarChart, Calendar as CalendarIcon, User, Building, QrCode, Sparkles, CreditCard, AlertTriangle, Square, Undo2, ArrowRight } from 'lucide-react';
import { type Appointment, type Event, type Staff, type Resource, type Membership, type AppointmentCheckoutState, Service, type Client, type Package, type Redemption, type CustomFormula } from '@/lib/data';
import { format, addDays, subDays, startOfWeek, endOfDay, differenceInDays, isPast, isToday, startOfDay, isSameDay, subWeeks, addWeeks, eachDayOfInterval, parseISO, addMinutes, addMonths, subMonths, subMinutes } from 'date-fns';
import { query, where, collection, doc, writeBatch, increment, arrayUnion, deleteField } from 'firebase/firestore';
import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn, safeNumber } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddAppointmentDialog } from '@/components/planner/AddAppointmentDialog';
import { EditAppointmentDialog } from '@/components/planner/EditAppointmentDialog';
import { Badge } from '@/components/ui/badge';
import { AddEventDialog } from '@/components/planner/EventsDialog';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
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
import { RescheduleDialog } from '@/components/planner/RescheduleDialog';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { nanoid } from 'nanoid';
import { type Transaction, type BillDefinition } from '@/lib/financial-data';
import { DebugErrorBoundary } from '@/components/shared/DebugErrorBoundary';
import { RescheduleAppointmentDialog } from '@/components/planner/RescheduleAppointmentDialog';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') {
        try { return parseISO(val); } catch { return new Date(val); }
    }
    if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
    return new Date(val);
};

const sanitizeForFirestore = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
};

function PlannerPageContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');

  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  const { user: currentUser } = useUser();
  const { selectedTenant, role, isLoading: isTenantLoading } = useTenant();
  const { firestore } = useFirebase();
  const tenantId = selectedTenant?.id;
  const router = useRouter();

  const {
      inventory, clients, services, staff: allStaff, appointments, events: eventsFromInventory,
      walkIns, billDefinitions, billInstances, transactions, memberships, packages, isLoading
  } = useInventory();

  const [tmhr, setTmhr] = useState(0);
  useEffect(() => { setTmhr(selectedTenant?.tmhr || 50); }, [selectedTenant]);

  const events = eventsFromInventory || [];

  const studioEventsQ = useMemoFirebase(
    () => !firestore || !tenantId ? null :
      query(collection(firestore, `tenants/${tenantId}/studioEvents`),
        where('status', 'in', ['draft', 'upcoming', 'active', 'completed'])
      ),
    [firestore, tenantId]
  );
  const { data: studioEventsRaw } = useCollection<any>(studioEventsQ);

  const studioEventsToday = useMemo(() => {
    if (!studioEventsRaw) return [];
    return studioEventsRaw.filter(e => {
      const d = e.date ? safeDate(e.date) : e.startTime ? safeDate(e.startTime) : null;
      return d && isSameDay(d, currentDate);
    });
  }, [studioEventsRaw, currentDate]);

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
  const [selectedBill, setSelectedBill] = useState<any | null>(null);
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
    if (role === 'staff' && currentUser) return (allStaff || []).filter(s => s.id === currentUser.uid);
    return (allStaff || []);
  }, [allStaff, role, currentUser]);

  const columns = useMemo(() => {
    let cols: any[] = activeView === 'staff' ? (staff || []) : (resourcesData || []);
    if (role === 'owner' || role === 'admin') cols = [{ id: 'business', name: 'Studio', isBusiness: true }, ...cols];
    return cols;
  }, [activeView, staff, resourcesData, role]);

  useEffect(() => {
    if (columns.length > 0 && !mobileSelectedColumnId) setMobileSelectedColumnId(columns[0].id);
  }, [columns, mobileSelectedColumnId]);

  useEffect(() => {
    const rebookAptId = searchParams.get('rebook_apt_id');
    if (rebookAptId && appointments && appointments.length > 0) {
      const apt = appointments.find((a: Appointment) => a.id === rebookAptId);
      if (apt) {
        setAppointmentToRebook(apt);
        setClientForNewApt(null);
        setIsAddAppointmentOpen(true);
        router.replace('/planner');
      }
    }
  }, [searchParams, appointments, router]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 0 }), i)), [currentDate]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, (Appointment | Event | any)[]>();
    (columns || []).forEach(c => map.set(c.id, []));
    const targetDateStart = startOfDay(currentDate);

    appointments?.filter(a => isSameDay(safeDate(a.startTime), targetDateStart)).forEach(a => {
        if (activeView === 'staff') {
            const involvedIds = new Set<string>();
            if (a.staffId) involvedIds.add(a.staffId);
            if (a.checkoutState?.serviceStaffOverrides) {
                Object.values(a.checkoutState.serviceStaffOverrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
            }
            Array.from(involvedIds).forEach(sid => {
                if (map.has(sid)) map.get(sid)!.push({ ...a, itemType: 'appointment', isSecondary: sid !== a.staffId } as any);
            });
        } else {
            (a.requiredResourceIds || []).forEach(rid => { if (map.has(rid)) map.get(rid)!.push({ ...a, itemType: 'appointment' } as any); });
        }
    });

    if (map.has('business')) {
        billInstances?.filter(i => isSameDay(safeDate(i.dueDate), targetDateStart)).forEach(i => {
            const def = billDefinitions.find(d => d.id === i.billDefinitionId);
            map.get('business')!.push({ ...i, definition: def, itemType: 'bill' } as any);
        });

        studioEventsToday.forEach(se => {
            let startTime: string;
            if (se.startTime) {
                startTime = typeof se.startTime === 'string' ? se.startTime : safeDate(se.startTime).toISOString();
            } else if (se.date && se.time) {
                try {
                    const d = safeDate(se.date);
                    const [timePart, meridian] = se.time.split(' ');
                    const [h, m] = timePart.split(':').map(Number);
                    let hours = h;
                    if (meridian?.toUpperCase() === 'PM' && h !== 12) hours += 12;
                    if (meridian?.toUpperCase() === 'AM' && h === 12) hours = 0;
                    d.setHours(hours, m || 0, 0, 0);
                    startTime = d.toISOString();
                } catch {
                    const d = safeDate(se.date);
                    d.setHours(9, 0, 0, 0);
                    startTime = d.toISOString();
                }
            } else {
                const d = safeDate(se.date || new Date());
                d.setHours(9, 0, 0, 0);
                startTime = d.toISOString();
            }

            let endTime: string;
            if (se.endTime) {
                endTime = typeof se.endTime === 'string' ? se.endTime : safeDate(se.endTime).toISOString();
            } else {
                endTime = addMinutes(safeDate(startTime), (se.durationMinutes || 180)).toISOString();
            }

            map.get('business')!.push({
                ...se,
                itemType:    'studio_event',
                startTime,
                endTime,
                id:          se.id,
                title:       se.title || se.name || 'Event',
                status:      se.status,
                guestCount:  se.guestCount || 0,
                isStudioEvent: true,
            } as any);
        });
    }

    events?.filter(e => isSameDay(safeDate(e.startTime), targetDateStart)).forEach(e => {
        const targetStaffIds = e.staffIds || [];
        const isGlobal = targetStaffIds.length === 0 || targetStaffIds.includes('all');
        if (isGlobal) {
            if (map.has('business')) map.get('business')!.push({ ...e, itemType: 'event' } as any);
            if (e.type === 'blocked' && activeView === 'staff') {
                columns.forEach(col => {
                    if (col.id !== 'business' && map.has(col.id)) map.get(col.id)!.push({ ...e, itemType: 'event', isSecondary: true } as any);
                });
            }
        } else if (activeView === 'staff') {
            targetStaffIds.forEach(sid => { if (map.has(sid)) map.get(sid)!.push({ ...e, itemType: 'event' } as any); });
        }
    });

    map.forEach(items => items.sort((a, b) => safeDate(a.startTime || a.dueDate).getTime() - safeDate(b.startTime || b.dueDate).getTime()));
    return map;
  }, [currentDate, appointments, columns, activeView, billInstances, billDefinitions, events, studioEventsToday]);

  const kpis = useMemo(() => {
    if (!transactions || !appointments || !services || !selectedTenant) return { weeklyRevenue: 0, projectedRevenue: 0, weeklyBreakEven: 0, weeklyNetProfit: 0, absorbedCosts: 0 };
    const start = startOfWeek(currentDate);
    const end = endOfDay(addDays(start, 6));
    const weeklyTransactions = transactions.filter(t => { const d = safeDate(t.date); return d >= start && d <= end; });
    const revenue = weeklyTransactions.filter(t => t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail')).reduce((acc, t) => acc + t.amount, 0);
    const absorbed = weeklyTransactions.filter(t => t.type === 'expense' && t.category === 'Discounts').reduce((acc, t) => acc + t.amount, 0);
    const waivedTotal = (appointments || []).filter(a => { const d = safeDate(a.startTime); return d >= start && d <= end && a.cancellationFeeWaived; }).reduce((acc, a) => acc + (a.cancellationFeeApplied || 0), 0);
    const projected = (appointments || []).filter(a => { const d = safeDate(a.startTime); return d >= start && d <= end && (a.status === 'confirmed' || a.status === 'deposit_pending'); }).reduce((acc, a) => { const svc = services.find(s => s.id === a.serviceId); return acc + (svc?.price || 0); }, 0);
    const weeklyBreakEven = ((selectedTenant.tmhr || 50) * 160 / 30.44) * 7;
    return { weeklyRevenue: revenue, projectedRevenue: projected, weeklyBreakEven, weeklyNetProfit: revenue - weeklyBreakEven, absorbedCosts: absorbed + waivedTotal };
  }, [transactions, appointments, services, currentDate, selectedTenant]);

  // ── Stuck appointments: servicing or ready_for_checkout from a previous day ──
  const stuckAppointments = useMemo(() => {
    if (!appointments) return [];
    return appointments.filter(a =>
      ['servicing', 'ready_for_checkout'].includes(a.status) &&
      !isSameDay(safeDate(a.startTime), currentDate)
    );
  }, [appointments, currentDate]);

  const handleUpdateStatus = (id: string, isWalkIn: boolean, status: string, lateMinutes?: number) => {
    if (!firestore || !tenantId || !selectedTenant) return;
    const docRef = isWalkIn ? doc(firestore, 'tenants', tenantId, 'walkIns', id) : doc(firestore, 'tenants', tenantId, 'appointments', id);
    const tmhrValue = selectedTenant.tmhr || 50;
    const premium = selectedTenant.lateInconveniencePremium || 0;

    if (status === 'running_late' && lateMinutes && !isWalkIn) {
        const apt = appointments?.find(a => a.id === id);
        if (apt) {
            const grace = selectedTenant.lateArrivalGracePeriod || 15;
            const autoCancel = selectedTenant.autoCancelLateArrivals === true;
            const primarySvc = services?.find(s => s.id === apt.serviceId);
            const addOns = (apt.addOnIds || []).map(aid => services?.find(s => s.id === aid)).filter(Boolean) as Service[];
            const totalDur = (primarySvc?.duration || 0) + addOns.reduce((sum, a) => sum + a.duration, 0);
            const totalPadding = (primarySvc?.padBefore || 0) + (primarySvc?.padAfter || 0);
            const fullSessionBlock = totalDur + totalPadding;
            const staffId = apt.staffId;
            let clash = null;

            if (staffId) {
                const theoreticalStart = addMinutes(safeDate(apt.startTime), lateMinutes);
                const theoreticalEnd = addMinutes(theoreticalStart, fullSessionBlock);
                const nextApt = (appointments || []).filter(a => a.staffId === staffId && a.id !== apt.id && (a.status === 'confirmed' || a.status === 'deposit_pending') && safeDate(a.startTime) > safeDate(apt.startTime)).sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];
                if (nextApt) {
                    const nextService = services?.find(s => s.id === nextApt.serviceId);
                    const nextStartWithPad = subMinutes(safeDate(nextApt.startTime), nextService?.padBefore || 0);
                    if (theoreticalEnd > nextStartWithPad) clash = { nextApt, clashTime: format(nextStartWithPad, 'h:mm a') };
                }
            }

            if ((lateMinutes > grace && autoCancel) || clash) {
                const cancelReason = clash ? 'clash' : 'late';
                const overheadRecovery = (fullSessionBlock / 60) * tmhrValue;
                const materialRecovery = (primarySvc?.cost || 0) + addOns.reduce((sum, a) => sum + (a.cost || 0), 0);
                const fee = Number((overheadRecovery + materialRecovery).toFixed(2));
                const batch = writeBatch(firestore);
                batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'auto_cancelled', status: 'cancelled', lateTimeMinutes: lateMinutes, cancellationReason: cancelReason, cancellationFeeApplied: fee }));
                if (fee > 0 && apt.clientId) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Profitable Auto-Cancel: ${clash ? 'Clash with next session' : 'Beyond grace period'} (${fullSessionBlock}m session block)` })) });
                batch.commit().then(() => toast({ variant: "destructive", title: clash ? "Conflict: Auto-Cancelled" : "Late: Auto-Cancelled", description: clash ? `Session block overlaps with session at ${clash.clashTime}.` : `Arrival of +${lateMinutes}m is beyond grace.` }));
                return;
            } else if (lateMinutes > grace) {
                const timeLostCost = (lateMinutes / 60) * tmhrValue;
                const fee = Number((timeLostCost + premium).toFixed(2));
                const batch = writeBatch(firestore);
                batch.update(docRef, sanitizeForFirestore({ checkInStatus: 'running_late', lateTimeMinutes: lateMinutes }));
                if (apt.clientId && fee > 0) batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { outstandingBalance: increment(fee), unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: apt.id, appointmentDate: safeDate(apt.startTime).toISOString(), feeAmount: fee, reason: `Dynamic Late Penalty: +${lateMinutes}m (Foundation Recovery + Premium)` })) });
                batch.commit().then(() => toast({ title: "Status Updated: Fee Applied", description: `Client accommodated with a $${fee.toFixed(2)} penalty.` }));
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
    const currentClient = clients.find(c => c.id === selectedAppointment.clientId);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    batch.update(appointmentRef, sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, cancellationFeeApplied: data.feeAmount, cancellationPaymentStatus: data.paymentMethod === 'card_on_file' ? 'paid' : (data.paymentMethod === 'waived' ? 'waived' : 'unpaid') }));
    if (selectedAppointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), sanitizeForFirestore({ status: 'cancelled', cancellationReason: data.reason, tenantId }));

    if (data.chargeFee && data.feeAmount > 0) {
        if (data.paymentMethod === 'card_on_file') {
            batch.set(doc(collection(firestore, `tenants/${tenantId}/transactions`)), sanitizeForFirestore({ date: now, description: `Cancellation Fee: ${selectedAppointment.clientName}`, clientOrVendor: selectedAppointment.clientName || 'Client', clientId: selectedAppointment.clientId, type: 'income', context: 'Business', category: 'Cancellation Fee', amount: data.feeAmount, paymentMethod: 'Card on File', hasReceipt: false, appointmentId: selectedAppointment.id, staffId: selectedAppointment.staffId }));
        } else if (data.paymentMethod === 'add_to_balance') {
            batch.update(clientRef, { unpaidFees: arrayUnion(sanitizeForFirestore({ feeId: nanoid(), appointmentId: selectedAppointment.id, appointmentDate: safeDate(selectedAppointment.startTime).toISOString(), feeAmount: data.feeAmount, reason: `Late Cancellation: ${data.reason.replace('_', ' ')}`, staffId: selectedAppointment.staffId })), outstandingBalance: increment(data.feeAmount) });
        }
    }

    if (currentClient && (data.reason === 'late' || data.reason === 'no-show' || data.reason === 'client_request')) {
        const isLateOrNoShow = data.reason === 'late' || data.reason === 'no-show';
        if (currentClient.activeMembershipId) {
            const membership = memberships.find(m => m.id === currentClient.activeMembershipId);
            const shouldForfeit = (data.reason === 'no-show' && membership?.forfeitOnNoShow) || (data.reason === 'late' && membership?.forfeitOnLateCancel);
            if (shouldForfeit) {
                const perkId = selectedAppointment.serviceId;
                const currentUsage = currentClient.subscription?.perkUsage || {};
                batch.update(clientRef, { 'subscription.perkUsage': { ...currentUsage, [perkId]: (currentUsage[perkId] || 0) + 1 }, 'subscription.perkLastUsed': now });
                const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${currentClient.id}/redemptions`));
                batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: currentClient.id, type: 'membership', offeringId: membership!.id, offeringName: membership!.name, serviceId: selectedAppointment.serviceId, serviceName: services.find(s => s.id === selectedAppointment.serviceId)?.name || 'Service', date: now, staffId: currentUser?.uid, isForfeit: true }));
            }
        }
        const activePack = currentClient.activePackages?.find(p => { const pkgDef = packages.find(pkg => pkg.id === p.packageId); return pkgDef?.serviceId === selectedAppointment.serviceId; });
        if (activePack && isLateOrNoShow) {
            const nextPackages = currentClient.activePackages!.map(p => p.packageId === activePack.packageId ? { ...p, sessionsRemaining: p.sessionsRemaining - 1 } : p).filter(p => p.sessionsRemaining > 0);
            batch.update(clientRef, { activePackages: nextPackages });
            const redemptionRef = doc(collection(firestore, `tenants/${tenantId}/clients/${currentClient.id}/redemptions`));
            const pkgDef = packages.find(pkg => pkg.id === activePack.packageId);
            batch.set(redemptionRef, sanitizeForFirestore({ id: redemptionRef.id, clientId: currentClient.id, type: 'package', offeringId: activePack.packageId, offeringName: pkgDef?.name || 'Package', serviceId: selectedAppointment.serviceId, serviceName: services.find(s => s.id === selectedAppointment.serviceId)?.name || 'Service', date: now, staffId: currentUser?.uid, isForfeit: true }));
        }
    }

    try {
        await batch.commit();
        toast({ title: "Policy Enforced", description: "Appointment voided and logic reconciled." });
    } catch (e) {
        toast({ variant: 'destructive', title: "Process Error" });
    }
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

  const handleUpdateAppointment = (apt: Appointment) => {
    if (!firestore || !tenantId) return;
    updateDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', apt.id), apt);
    if (apt.checkInToken) updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { ...apt, tenantId });
    setIsEditAppointmentOpen(false);
    setIsRescheduleOpen(false);
    toast({ title: "Session Updated" });
  };

  const handleRescheduleConfirm = async (data: any) => {
    if (!firestore || !tenantId) return;
    const { applyFee, feeAmount, paymentMethod, ...aptData } = data;
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', aptData.id);
    const updates: any = { startTime: aptData.startTime, endTime: aptData.endTime };
    if (applyFee && feeAmount > 0) {
        if (paymentMethod === 'add_to_session') {
            updates['checkoutState.additionalCharge'] = increment(feeAmount);
        } else {
            const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(txnRef, sanitizeForFirestore({ id: txnRef.id, date: now, description: `Reschedule Protocol Fee: ${aptData.clientName}`, clientOrVendor: aptData.clientName || 'Client', clientId: aptData.clientId, type: 'income', context: 'Business', category: 'Adjustment Fee', amount: feeAmount, paymentMethod: paymentMethod === 'card_on_file' ? 'Card on File' : 'Credit Card (Mobile)', hasReceipt: false, appointmentId: aptData.id, staffId: aptData.staffId }));
        }
    }
    batch.update(appointmentRef, sanitizeForFirestore(updates));
    try {
        await batch.commit();
        toast({ title: "Protocol Synchronized", description: applyFee ? `Session shifted with a $${feeAmount.toFixed(2)} adjustment applied.` : "Session shifted successfully." });
        setIsRescheduleOpen(false);
        setIsDetailsOpen(false);
    } catch (e) {
        toast({ variant: 'destructive', title: "Process Error" });
    }
  };

  const handleOverrideConfirm = async (staffId: string, reason: string) => {
    if (!selectedAppointment || !firestore || !tenantId) return;
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id), { status: 'confirmed', checkInStatus: 'pending', overrideReason: reason, overriddenBy: staffId, cancellationReason: deleteField() as any, cancellationFeeApplied: 0 });
    if (selectedAppointment.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken), { status: 'confirmed', checkInStatus: 'pending', tenantId });
    try {
        await batch.commit();
        setIsOverrideOpen(false);
        setIsDetailsOpen(false);
        toast({ title: "Cancellation Overridden" });
    } catch (e) {
        toast({ variant: 'destructive', title: "Override Failed" });
    }
  };

  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId) return;
    const apt = (appointments || []).find(a => a.id === appointmentId);
    if (!apt) return;
    const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];
    const completedIds = checkoutState.completedServiceIds || [];
    const allComplete = completedIds.length >= allPartIds.length;
    const batch = writeBatch(firestore);
    const sanitizedCheckoutState = sanitizeForFirestore(checkoutState);

    if (checkoutState.saveAsCustomFormula && checkoutState.customFormulaName && apt.clientId) {
        const newFormula: CustomFormula = { id: nanoid(), name: checkoutState.customFormulaName, date: new Date().toISOString(), items: checkoutState.formula || [], notes: checkoutState.reviewNotes };
        batch.update(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId), { customFormulas: arrayUnion(sanitizeForFirestore(newFormula)) });
    }

    if (allComplete) {
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), sanitizeForFirestore({ status: 'ready_for_checkout', checkoutState: sanitizedCheckoutState, actualEndTime: new Date().toISOString() }));
        if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), sanitizeForFirestore({ status: 'ready_for_checkout', tenantId }));
        const involvedIds = new Set<string>();
        if (apt.staffId) involvedIds.add(apt.staffId);
        if (checkoutState.serviceStaffOverrides) Object.values(checkoutState.serviceStaffOverrides).forEach((id: any) => { if (id && typeof id === 'string') involvedIds.add(id); });
        involvedIds.forEach(sid => batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true }));
    } else {
        batch.update(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), sanitizeForFirestore({ checkoutState: sanitizedCheckoutState }));
        const overrides = checkoutState.serviceStaffOverrides || {};
        const involvedStaffIdsSet = new Set<string>();
        if (apt.staffId) involvedStaffIdsSet.add(apt.staffId);
        Object.values(overrides).forEach((id: any) => { if (id && typeof id === 'string') involvedStaffIdsSet.add(id); });
        involvedStaffIdsSet.forEach(sid => {
            const hasRemainingParts = allPartIds.some(pid => { if (completedIds.includes(pid)) return false; return (overrides[pid] === sid || (pid === apt.serviceId && apt.staffId === sid && !overrides[pid])); });
            if (!hasRemainingParts) batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true });
        });
        const nextPartId = allPartIds.find(id => !completedIds.includes(id) && !(checkoutState.concurrentServiceIds || []).includes(id));
        const nextStaffId = overrides[nextPartId || ''] || (nextPartId === apt.serviceId ? apt.staffId : null);
        if (nextStaffId) batch.set(doc(firestore, 'tenants', tenantId, 'staff', nextStaffId), { status: 'busy' }, { merge: true });
    }

    batch.commit().then(() => { toast({ title: allComplete ? "Service Finished" : "Part Completed", description: allComplete ? "Ready for checkout." : "Hand-off confirmed." }); setIsTechnicianReviewOpen(false); setIsDetailsOpen(false); });
  };

  const billInstancesWithDefinitions = useMemo(() => {
    if (!billInstances || !billDefinitions) return [];
    const today = startOfDay(new Date());
    return billInstances.filter(i => { const d = safeDate(i.dueDate); return i.status !== 'paid' && (isPast(d) || isToday(d) || differenceInDays(d, today) <= 7); }).map(instance => { const definition = billDefinitions.find(def => def.id === instance.billDefinitionId); return definition ? { ...instance, definition } : null; }).filter((i): i is any => i !== null);
  }, [billInstances, billDefinitions]);

  if (isLoading) return <div className="flex h-screen w-full items-center justify-center bg-background"><Loader className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      <AppHeader />
      <div className="p-3 sm:p-4 md:py-3 md:px-8 border-b bg-white/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto space-y-4 text-left">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Studio Planner</h1>
              <p className="hidden sm:block text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Synchronized studio agenda</p>
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

          {studioEventsToday.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              {studioEventsToday.map(se => (
                <button
                  key={se.id}
                  onClick={() => router.push(`/events/${se.id}/manifest`)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-xl border-2 whitespace-nowrap shrink-0 transition-all hover:scale-105',
                    se.status === 'active'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : se.status === 'completed'
                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                        : 'bg-violet-50 border-violet-200 text-violet-800'
                  )}
                >
                  {se.status === 'active' && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    {se.title || se.name}
                  </span>
                  {se.status === 'active' && (
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Live →</span>
                  )}
                  {se.status !== 'active' && se.time && (
                    <span className="text-[9px] font-bold opacity-60">{se.time}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-2 sm:gap-3 p-1 sm:py-1 bg-muted/30 rounded-2xl sm:rounded-3xl border-2 border-muted shadow-inner w-full md:w-auto overflow-x-auto scrollbar-hide justify-between sm:justify-start">
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl hover:bg-white shadow-sm shrink-0" onClick={() => setCurrentDate(subDays(currentDate, 1))}><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5"/></Button>
              <div className="px-2 sm:px-2 text-center min-w-[110px] sm:min-w-[140px]">
                <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-primary leading-none mb-0.5 sm:mb-1">{format(currentDate, 'MMMM yyyy')}</p>
                <p className="text-sm sm:text-base font-black text-slate-900 leading-none truncate">{format(currentDate, 'EEEE, do')}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl hover:bg-white shadow-sm shrink-0" onClick={() => setCurrentDate(addDays(currentDate, 1))}><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5"/></Button>
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
              {weekDays.map(day => {
                const hasStudioEvent = studioEventsRaw?.some(se => {
                  const d = se.date ? safeDate(se.date) : se.startTime ? safeDate(se.startTime) : null;
                  return d && isSameDay(d, day);
                });
                return (
                  <button key={day.toISOString()} onClick={() => setCurrentDate(day)} className={cn("flex-1 py-2 sm:py-2 min-w-[48px] sm:min-w-[80px] rounded-2xl sm:rounded-3xl transition-all border-2 sm:border-2 flex flex-col items-center gap-0.5 sm:gap-1", isSameDay(day, currentDate) ? "bg-primary border-primary shadow-2xl shadow-primary/20 -translate-y-0.5 sm:-translate-y-1" : "bg-muted/50 border-transparent hover:bg-muted hover:scale-105")}>
                    <p className={cn("text-[8px] sm:text-[10px] font-black uppercase tracking-widest", isSameDay(day, currentDate) ? "text-white/60" : "text-muted-foreground/60")}>{format(day, 'EEE')}</p>
                    <p className={cn("text-base sm:text-2xl font-black tracking-tighter", isSameDay(day, currentDate) ? "text-white" : "text-slate-900")}>{format(day, 'd')}</p>
                    {hasStudioEvent && (
                      <span className={cn('w-1.5 h-1.5 rounded-full', isSameDay(day, currentDate) ? 'bg-white/60' : 'bg-violet-400')} />
                    )}
                  </button>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" className="hidden" />
          </ScrollArea>
        </div>
      </div>

      {/* ── Stuck appointments banner ── */}
      {stuckAppointments.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-b-2 border-amber-200">
          <div className="max-w-7xl mx-auto space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" />
              {stuckAppointments.length} session{stuckAppointments.length > 1 ? 's' : ''} need attention
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {stuckAppointments.map(apt => {
                const svc = services?.find(s => s.id === apt.serviceId);
                return (
                  <button
                    key={apt.id}
                    onClick={() => { setSelectedAppointment(apt); setIsDetailsOpen(true); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border-2 border-amber-300 shrink-0 hover:bg-amber-50 transition-all active:scale-95"
                  >
                    <div className={cn('w-2 h-2 rounded-full shrink-0',
                      apt.status === 'servicing' ? 'bg-primary animate-pulse' : 'bg-emerald-500')} />
                    <div className="text-left">
                      <p className="font-black uppercase text-[10px] text-slate-800">{apt.clientName || 'Guest'}</p>
                      <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">
                        {svc?.name || 'Service'} · {format(safeDate(apt.startTime), 'MMM d, h:mm a')}
                      </p>
                    </div>
                    <Badge className={cn('font-black text-[8px] uppercase border-none shrink-0',
                      apt.status === 'servicing' ? 'bg-primary/10 text-primary' : 'bg-emerald-100 text-emerald-700')}>
                      {apt.status === 'servicing' ? 'In Service' : 'Checkout'}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col min-h-0 bg-slate-50/50">
        <DayTimeline
          date={currentDate} columns={columns} itemsByColumn={itemsByColumn}
          showColumnHeader={activeView === 'resources'} isMobile={isMobile || false} activeView={activeView}
          allStaff={allStaff || []} mobileSelectedColumnId={mobileSelectedColumnId} onMobileColumnChange={onMobileColumnChange}
          onCompleteClick={a => router.push(`/pos?checkout_id=${a.id}`)} onUpdateStatus={handleUpdateStatus}
          onDeleteAppointment={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
          onPrintReceipt={() => {}} onPrintTicket={() => {}}
          onEditAppointment={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
          onEditEvent={e => { setSelectedEvent(e); setIsEditEventOpen(true); }} onChecklistItemToggle={() => {}} onChecklistItemToggleCallback={() => {}} onUpdateEvent={() => {}}
          dailyTransactions={transactions?.filter(t => isSameDay(safeDate(t.date), currentDate)) || []} allTransactions={transactions || []} onAddTransaction={() => {}}
          onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }}
          onRebook={a => { setAppointmentToRebook(a); setClientForNewApt(null); setIsAddAppointmentOpen(true); }}
          onStartService={handleStartService} onFinishService={handleFinishService}
          onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setAppointmentToRebook(null); setIsAddAppointmentOpen(true); }}
          onDeleteEvent={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id))}
          onDeleteAppointmentFromDB={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
          onViewDetails={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
          walkIns={walkIns} clients={clients} services={services} resources={resourcesData || []}
        />
      </main>

      <DebugErrorBoundary>
        <AppointmentDetailsSheet
          open={isDetailsOpen} onOpenChange={setIsDetailsOpen} appointment={selectedAppointment}
          client={clients?.find(c => c.id === selectedAppointment?.clientId) || null}
          service={services?.find(s => s.id === selectedAppointment?.serviceId) || null}
          tmhr={tmhr} transactions={transactions || []}
          onStartService={handleStartService} onFinishService={handleFinishService}
          onEdit={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
          onDelete={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'appointments', id))}
          onCancel={id => { setSelectedAppointment(appointments.find(a => a.id === id) || null); setIsCancelDialogOpen(true); }}
          onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }}
          onRebook={a => { setAppointmentToRebook(a); setClientForNewApt(null); setIsAddAppointmentOpen(true); }}
          onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setAppointmentToRebook(null); setIsAddAppointmentOpen(true); }}
          onPrintTicket={() => {}} onOverride={handleOverrideConfirm}
          onWaiveFee={(id: string, aut: any, res: string) => {
            if (!firestore || !tenantId) return;
            const apt = (appointments || []).find(a => a.id === id);
            if (!apt) return;
            const batch = writeBatch(firestore);
            batch.update(doc(firestore, `tenants/${tenantId}/appointments`, id), { cancellationFeeWaived: true, waivedBy: aut.id, waivedReason: res, waivedAt: new Date().toISOString() });
            batch.update(doc(firestore, `tenants/${tenantId}/clients`, apt.clientId), { outstandingBalance: increment(-(apt.cancellationFeeApplied || 0)) });
            batch.commit().then(() => toast({ title: "Fee Absorbed" }));
          }}
        />
      </DebugErrorBoundary>

      <OverrideCancellationDialog open={isOverrideOpen} onOpenChange={setIsOverrideOpen} staff={allStaff || []} onConfirm={handleOverrideConfirm} />

      {selectedAppointment && (
        <EditAppointmentDialog open={isEditAppointmentOpen} onOpenChange={setIsEditAppointmentOpen} appointment={selectedAppointment} clients={clients || []} services={services || []} appointments={appointments} onConfirm={handleUpdateAppointment} />
      )}

      {selectedAppointment && (
        <RescheduleDialog open={isRescheduleOpen} onOpenChange={setIsRescheduleOpen} appointment={selectedAppointment} clients={clients || []} services={services || []} appointments={appointments || []} onConfirm={handleRescheduleConfirm} />
      )}

      {selectedAppointment && <CancelAppointmentDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} appointment={selectedAppointment} tenant={selectedTenant} onConfirm={handleConfirmCancellation} />}
      {selectedAppointment && <TechnicianReviewDialog open={isTechnicianReviewOpen} onOpenChange={setIsTechnicianReviewOpen} appointmentData={{ appointment: selectedAppointment, client: (clients || []).find(c => c.id === selectedAppointment.clientId), service: (services || []).find(s => s.id === selectedAppointment.serviceId) }} staff={allStaff || []} onSendToFrontDesk={handleSendToFrontDesk} />}

      <AddAppointmentDialog
        open={isAddAppointmentOpen}
        onOpenChange={(val: boolean) => { setIsAddAppointmentOpen(val); if (!val) { setClientForNewApt(null); setAppointmentToRebook(null); } }}
        onConfirm={async (data: any) => {
          if (!firestore || !tenantId) return;
          const id = nanoid();
          const token = nanoid(16);
          const apt = { ...data, id, tenantId, checkInToken: token, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString(), source: 'manual' };
          await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'appointments', id), apt, {});
          await setDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', token), apt, {});
          setIsAddAppointmentOpen(false);
          toast({ title: "Booked" });
        }}
        client={clientForNewApt}
        appointmentToRebook={appointmentToRebook}
        memberships={memberships || []}
      />

      <AddEventDialog
        open={isAddEventOpen}
        onOpenChange={setIsAddEventOpen}
        onConfirm={async (data: any) => {
          if (!firestore || !tenantId) return;
          const id = nanoid();
          await setDocumentNonBlocking(doc(firestore, 'tenants', tenantId, 'events', id), { ...data, id, tenantId, startTime: data.startTime.toISOString(), endTime: data.endTime.toISOString() }, {});
          setIsAddEventOpen(false);
          toast({ title: "Event Added" });
        }}
        staff={allStaff || []}
      />

      <FloatingActionButton onNewAppointmentClick={() => { setClientForNewApt(null); setAppointmentToRebook(null); setIsAddAppointmentOpen(true); }} onNewEventClick={() => setIsAddEventOpen(true)} />
      <BillsDueSheet open={isBillsSheetOpen} onOpenChange={setIsBillsSheetOpen} billInstances={billInstancesWithDefinitions} isMobile={isMobile || false} onLogPaymentClick={(instance: any) => { setSelectedBill(instance); setIsBillsSheetOpen(false); }} />
      <WeeklyKpiSheet open={isKpiSheetOpen} onOpenChange={setIsKpiSheetOpen} kpis={kpis} isMobile={isMobile || false} />
      {selectedBill && <LogPaymentDialog open={!!selectedBill} onOpenChange={(isOpen) => !isOpen && setSelectedBill(null)} billInstance={selectedBill} onConfirm={() => {}} />}
    </div>
  );
}

export default function PlannerPageWrapper() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background"><Loader className="h-8 w-8 animate-spin text-primary" /></div>}>
      <DebugErrorBoundary>
        <PlannerPageContent />
      </DebugErrorBoundary>
    </Suspense>
  );
}
