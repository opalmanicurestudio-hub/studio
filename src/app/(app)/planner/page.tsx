
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
  DropdownMenuSeparator,
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
import { collection, query, where, Timestamp, doc, setDoc, arrayUnion, increment, writeBatch, addDoc, deleteField } from 'firebase/firestore';
import { EditEventDialog } from '@/components/planner/EditEventDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DayTimeline } from '@/components/planner/DayTimeline';
import { WeeklyKpiSheet } from '@/components/planner/WeeklyKpiSheet';
import { BillsDueSheet } from '@/components/planner/BillsDueSheet';
import { Html5Qrcode } from 'html5-qrcode';
import { TechnicianReviewDialog } from '@/components/planner/TechnicianReviewDialog';
import Link from 'next/link';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { FloatingActionButton } from '@/components/planner/FloatingActionButton';
import { AppointmentDetailsSheet } from '@/components/planner/AppointmentDetailsSheet';
import { LogPaymentDialog } from '@/components/bills/LogPaymentDialog';
import { PickingListDialog } from '@/components/planner/PickingListDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { type Client, type Service } from '@/lib/data';
import { nanoid } from 'nanoid';
import { Textarea } from '@/components/ui/textarea';
import { OverrideCancellationDialog } from '@/components/planner/OverrideCancellationDialog';
import { CancelAppointmentDialog } from '@/components/planner/CancelAppointmentDialog';

const safeDate = (val: any): Date => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return parseISO(val);
    if (typeof val?.toDate === 'function') return val.toDate();
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
  const [isPickingListOpen, setIsPickingListOpen] = useState(false);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
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

  const staff = useMemo(() => (role === 'staff' && currentUser) ? (allStaff || []).filter(s => s.id === currentUser.uid) : (allStaff || []), [allStaff, role, currentUser]);
  
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
    appointments?.filter(a => isSameDay(safeDate(a.startTime), currentDate)).forEach(a => {
        if (activeView === 'staff') { if (a.staffId && map.has(a.staffId)) map.get(a.staffId)!.push({ ...a, itemType: 'appointment' } as any); }
        else { (a.requiredResourceIds || []).forEach(rid => { if (map.has(rid)) map.get(rid)!.push({ ...a, itemType: 'appointment' } as any); }); }
    });
    map.forEach(items => items.sort((a,b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime()));
    return map;
  }, [currentDate, appointments, staff, resources, activeView]);

  const kpis = useMemo(() => {
    if (!transactions || !appointments || !services || !selectedTenant) {
      return { weeklyRevenue: 0, projectedRevenue: 0, weeklyBreakEven: 0, weeklyNetProfit: 0, absorbedCosts: 0 };
    }

    const start = startOfWeek(currentDate);
    const end = endOfDay(addDays(start, 6));

    const weeklyTransactions = transactions.filter(t => {
      const d = safeDate(t.date);
      return d >= start && d <= end;
    });

    const revenue = weeklyTransactions
      .filter(t => t.type === 'income' && (t.category === 'Service Revenue' || t.category === 'Retail'))
      .reduce((acc, t) => acc + t.amount, 0);

    const absorbed = weeklyTransactions
      .filter(t => t.type === 'expense' && t.category === 'Discounts')
      .reduce((acc, t) => acc + t.amount, 0);
    
    const waivedTotal = appointments
        .filter(a => {
            const d = safeDate(a.startTime);
            return d >= start && d <= end && a.cancellationFeeWaived;
        })
        .reduce((acc, a) => acc + (a.cancellationFeeApplied || 0), 0);

    const projected = appointments
      .filter(a => {
        const d = safeDate(a.startTime);
        return d >= start && d <= end && (a.status === 'confirmed' || a.status === 'deposit_pending');
      })
      .reduce((acc, a) => {
        const svc = services.find(s => s.id === a.serviceId);
        return acc + (svc?.price || 0);
      }, 0);

    const monthlyOverhead = selectedTenant.tmhr ? selectedTenant.tmhr * 160 : 2000; 
    const weeklyBreakEven = (monthlyOverhead / 30.44) * 7;

    return {
      weeklyRevenue: revenue,
      projectedRevenue: projected,
      weeklyBreakEven,
      weeklyNetProfit: revenue - weeklyBreakEven,
      absorbedCosts: absorbed + waivedTotal,
    };
  }, [transactions, appointments, services, currentDate, selectedTenant]);

  const handleUpdateStatus = (id: string, status: Appointment['status']) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
    updateDocumentNonBlocking(appointmentRef, { status });
    
    const apt = appointments?.find(a => a.id === id);
    if (apt?.checkInToken) {
        updateDocumentNonBlocking(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status, tenantId });
    }

    toast({ title: "Status Updated", description: `Appointment status changed to ${status}.` });
  };

  const handleCancelAppointment = (id: string) => {
    const apt = appointments.find(a => a.id === id);
    if (apt) {
        setSelectedAppointment(apt);
        setIsCancelDialogOpen(true);
    }
  };

  const handleConfirmCancellation = async (data: { 
    reason: string; 
    chargeFee: boolean; 
    feeAmount: number;
    paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived';
  }) => {
    if (!selectedAppointment || !firestore || !tenantId) return;

    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', selectedAppointment.id);
    const clientRef = doc(firestore, 'tenants', tenantId, 'clients', selectedAppointment.clientId);

    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    batch.update(appointmentRef, {
        status: 'cancelled',
        cancellationReason: data.reason,
        cancellationFeeApplied: data.feeAmount,
        cancellationPaymentStatus: data.paymentMethod === 'card_on_file' ? 'paid' : (data.paymentMethod === 'waived' ? 'waived' : 'unpaid')
    });

    if (selectedAppointment.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', selectedAppointment.checkInToken);
        batch.update(checkInRef, { 
            status: 'cancelled', 
            cancellationReason: data.reason,
            tenantId: tenantId
        });
    }

    if (data.chargeFee && data.feeAmount > 0) {
        if (data.paymentMethod === 'card_on_file') {
            const transactionRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
            batch.set(transactionRef, {
                date: now,
                description: `Cancellation Fee: ${selectedAppointment.clientName} (#${selectedAppointment.id.slice(-6).toUpperCase()})`,
                clientOrVendor: selectedAppointment.clientName || 'Client',
                clientId: selectedAppointment.clientId,
                type: 'income',
                context: 'Business',
                category: 'Cancellation Fee',
                amount: data.feeAmount,
                paymentMethod: 'Card on File',
                hasReceipt: false,
                appointmentId: selectedAppointment.id,
                staffId: selectedAppointment.staffId,
            });
            toast({ title: "Card Charged Successfully" });
        } else if (data.paymentMethod === 'add_to_balance') {
            const feeId = nanoid();
            const feeEntry = {
                feeId,
                appointmentId: selectedAppointment.id,
                appointmentDate: safeDate(selectedAppointment.startTime).toISOString(),
                feeAmount: data.feeAmount,
                reason: `Late Cancellation: ${data.reason.replace('_', ' ')}`,
                staffId: selectedAppointment.staffId,
            };
            batch.update(clientRef, {
                unpaidFees: arrayUnion(feeEntry),
                outstandingBalance: increment(data.feeAmount)
            });
            toast({ title: "Fee Added to Balance" });
        }
    }

    try {
        await batch.commit();
        setIsCancelDialogOpen(false);
        setIsDetailsOpen(false);
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to process cancellation.' });
    }
  };

  const handleSendToFrontDesk = (appointmentId: string, checkoutState: AppointmentCheckoutState) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', appointmentId);
    
    const apt = appointments?.find(a => a.id === appointmentId);
    if (!apt) return;

    const totalServicesCount = 1 + (apt.addOnIds || []).length;
    const completedIds = checkoutState.completedServiceIds || [];
    const allComplete = completedIds.length >= totalServicesCount;

    const batch = writeBatch(firestore);
    
    if (allComplete) {
        batch.update(appointmentRef, {
            status: 'ready_for_checkout',
            checkoutState,
            actualEndTime: new Date().toISOString(),
        });
        if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { status: 'ready_for_checkout', tenantId });
        
        // AUTO-IDLE: Mark ALL involved staff as idle when the whole appointment is done
        const involvedIds = new Set<string>();
        if (apt.staffId) involvedIds.add(apt.staffId);
        if (checkoutState.serviceStaffOverrides) {
            Object.values(checkoutState.serviceStaffOverrides).forEach(id => involvedIds.add(id));
        }
        involvedIds.forEach(sid => {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', sid), { status: 'idle' }, { merge: true });
        });
    } else {
        batch.update(appointmentRef, { checkoutState });
        
        // AUTO-IDLE: Mark staff member who just completed their part as idle
        if (currentUser) {
            batch.set(doc(firestore, 'tenants', tenantId, 'staff', currentUser.uid), { status: 'idle' }, { merge: true });
        }

        // Mark NEXT sequential technician as busy on hand-off
        const allPartIds = [apt.serviceId, ...(apt.addOnIds || [])];
        const nextPartId = allPartIds.find(id => !completedIds.includes(id) && !(checkoutState.concurrentServiceIds || []).includes(id));
        const nextStaffId = checkoutState.serviceStaffOverrides?.[nextPartId || ''];
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
    if (!firestore || !tenantId || !appointments) return;
    const now = new Date().toISOString();
    const appointment = appointments.find(a => a.id === id);
    if (!appointment) return;

    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
    const batch = writeBatch(firestore);
    batch.update(appointmentRef, { status: 'servicing', actualStartTime: now });
    
    if (appointment.checkInToken) {
        const checkInRef = doc(firestore, 'appointmentCheckIns', appointment.checkInToken);
        batch.update(checkInRef, { status: 'servicing', tenantId });
    }

    if (appointment.staffId) {
        const staffDocRef = doc(firestore, 'tenants', tenantId, 'staff', appointment.staffId);
        batch.set(staffDocRef, { status: 'busy' }, { merge: true });
    }

    // Mark all concurrent technicians as busy immediately
    const concurrentIds = appointment.checkoutState?.concurrentServiceIds || [];
    const overrides = appointment.checkoutState?.serviceStaffOverrides || {};
    concurrentIds.forEach(svcId => {
        const assignedStaffId = overrides[svcId];
        if (assignedStaffId) {
            const assistantRef = doc(firestore, 'tenants', tenantId, 'staff', assignedStaffId);
            batch.set(assistantRef, { status: 'busy' }, { merge: true });
        }
    });

    if (appointment.isWalkIn) {
        const walkInId = id.replace('apt-walkin-', '');
        batch.update(doc(firestore, 'tenants', tenantId, 'walkIns', walkInId), { status: 'servicing', serviceStartTime: now });
    }

    batch.commit();
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
    if (checkInRef) updateDocumentNonBlocking(checkInRef, { ...updates, tenantId });

    toast({ title: "Override Complete", description: "The appointment has been restored." });
    setIsOverrideOpen(false);
    setIsDetailsOpen(false);
  };

  const handleWaiveFee = async (id: string, authorizer: Staff, reason: string) => {
    if (!firestore || !tenantId) return;
    const appointmentRef = doc(firestore, 'tenants', tenantId, 'appointments', id);
    const apt = appointments.find(a => a.id === id);
    if (!apt || !apt.clientId) return;

    const clientRef = doc(firestore, 'tenants', tenantId, 'clients', apt.clientId);
    const clientData = clients?.find(c => c.id === apt.clientId);
    if (!clientData) return;

    const feeAmount = apt.cancellationFeeApplied || 0;
    const newUnpaidFees = (clientData.unpaidFees || []).filter(f => f.appointmentId !== id);
    const newBalance = Math.max(0, (clientData.outstandingBalance || 0) - feeAmount);

    const waiverEntry = {
        feeId: nanoid(),
        appointmentId: id,
        appointmentDate: safeDate(apt.startTime).toISOString(),
        feeAmount: feeAmount,
        reason: reason,
        waivedBy: authorizer.id,
        waivedByName: authorizer.name,
        waivedAt: new Date().toISOString()
    };

    const batch = writeBatch(firestore);
    batch.update(appointmentRef, { 
        cancellationFeeWaived: true,
        waivedBy: authorizer.id,
        waivedReason: reason,
        waivedAt: waiverEntry.waivedAt
    });
    batch.update(clientRef, {
        unpaidFees: newUnpaidFees,
        outstandingBalance: newBalance,
        waivedFees: arrayUnion(waiverEntry)
    });

    try {
        await batch.commit();
        toast({ title: "Fee Waived", description: `Fee of $${feeAmount.toFixed(2)} absorbed. Authorized by ${authorizer.name}.` });
    } catch (e) {
        console.error(e);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not waive fee.' });
    }
  };

  const handleLogPaymentConfirm = (paymentData: any) => {
    if (!selectedBill || !firestore || !tenantId) return;
    
    const billInstanceRef = doc(firestore, 'tenants', tenantId, 'billInstances', selectedBill.id);
    const newAmountPaid = selectedBill.amountPaid + paymentData.amount;
    const newAmountDue = selectedBill.amountDue - paymentData.amount;
    const newStatus: any = newAmountDue <= 0 ? 'paid' : 'partially-paid';
    
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
    });

    setSelectedBill(null);
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
                                                {billInstances.filter(i => i.status !== 'paid').length > 0 && (
                                                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                                                        {billInstances.filter(i => i.status !== 'paid').length}
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
                <ScrollArea>
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
                onPrintReceipt={() => {}} onPrintTicket={() => {}} onEditAppointment={a => { setSelectedAppointment(a); setIsEditAppointmentOpen(true); }}
                onEditEvent={e => { setSelectedEvent(e); setIsEditEventOpen(true); }} onChecklistItemToggle={() => {}} onUpdateEvent={() => {}}
                dailyTransactions={transactions?.filter(t => isSameDay(safeDate(t.date), currentDate)) || []} allTransactions={transactions || []} onAddTransaction={() => {}}
                onReschedule={a => { setSelectedAppointment(a); setIsRescheduleOpen(true); }} onRebook={a => { setAppointmentToRebook(a); setIsAddAppointmentOpen(true); }}
                onStartService={handleStartService}
                onFinishService={handleFinishService} onBookNewForClient={id => { setClientForNewApt(clients?.find(c => c.id === id) || null); setIsAddAppointmentOpen(true); }}
                onDeleteEvent={id => deleteDocumentNonBlocking(doc(firestore!, 'tenants', tenantId!, 'events', id))} onViewDetails={a => { setSelectedAppointment(a); setIsDetailsOpen(true); }}
                walkIns={walkIns} clients={clients} services={services} resources={resources || []}
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
        onPrintTicket={() => {}}
        onOverride={() => setIsOverrideOpen(true)}
        onWaiveFee={handleWaiveFee}
      />

      <OverrideCancellationDialog 
        open={isOverrideOpen}
        onOpenChange={setIsOverrideOpen}
        staff={allStaff || []}
        onConfirm={handleOverrideConfirm}
      />

      {selectedAppointment && (
        <CancelAppointmentDialog
            open={isCancelDialogOpen}
            onOpenChange={setIsCancelDialogOpen}
            appointment={selectedAppointment}
            tenant={selectedTenant}
            onConfirm={handleConfirmCancellation}
        />
      )}

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
      <AddEventDialog open={isAddEventOpen} onOpenChange={setIsAddEventOpen} onConfirm={() => {}} staff={allStaff || []} />
      
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
        billInstances={billInstances as any} 
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
