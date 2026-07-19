'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Card, CardContent } from '../ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  Calendar as CalendarIcon, 
  PlusCircle, 
  ChevronLeft, 
  ChevronRight, 
  User, 
  Award, 
  Clock, 
  Users, 
  Sparkles, 
  ArrowRight, 
  Check, 
  Search,
  ShieldCheck,
  CreditCard,
  Zap,
  Landmark,
  Wallet,
  CheckCircle2,
  Repeat,
  Info,
  Unlock,
  UserPlus,
  Loader,
  Smartphone,
  Mail,
  Cake,
  Star,
  FileImage,
  Workflow
} from 'lucide-react';
import { cn, safeNumber } from '@/lib/utils';
import { computeDepositCents } from '@/lib/deposit-policy';
import { type Client, type Service, type Appointment, type Staff, type PricingTier } from '@/lib/data';
import { format, setHours, setMinutes, startOfDay, areIntervalsOverlapping, addMinutes, startOfWeek, addDays, subWeeks, addWeeks, eachDayOfInterval, isSameDay, isBefore, isToday, parseISO, endOfDay, subMinutes, differenceInMinutes } from 'date-fns';
import { nanoid } from 'nanoid';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { Switch } from '../ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { collection, doc, writeBatch, increment, arrayUnion, query, where, getDocs } from 'firebase/firestore';
import { Badge } from '../ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PhoneInput } from '../ui/phone-input';
import { ImageUpload } from '../shared/ImageUpload';

const safeDate = (val: any): Date => {
    let d: Date;
    if (!val) d = new Date();
    else if (val instanceof Date) d = val;
    else if (typeof val === 'string') {
        try { d = parseISO(val); } catch { d = new Date(val); }
    }
    else if (typeof val === 'object' && 'seconds' in val) d = new Date(val.seconds * 1000);
    else d = new Date(val);
    // Never return an Invalid Date — date-fns format() and
    // areIntervalsOverlapping() THROW on them and crash the whole page.
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
};

const timeStringToDate = (timeStr: string, date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (!timeStr) return d;
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    d.setHours(hours, minutes);
    return d;
}

/**
 * Recursively removes any keys with undefined values from an object.
 * Firestore does not support undefined values in payloads.
 */
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

type Step = 'details' | 'timing' | 'deposit' | 'success';

export const AddAppointmentDialog: React.FC<any> = ({ open, onOpenChange, client: initialClient, appointmentToRebook }) => {
  const isMobile = useIsMobile();
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { selectedTenant, role } = useTenant();
  const { services, staff, pricingTiers, clients, scheduleProfiles, appointments: appointmentsFromDB, events: eventsFromDB } = useInventory();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const [step, setStep] = useState<Step>('details');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [checkInToken, setCheckInToken] = useState('');
  const [inspirationPhotoUrl, setInspirationPhotoUrl] = useState('');
  const [showAllSlots, setShowAllSlots] = useState(false);

  const methods = useForm({
    defaultValues: {
        clientId: '',
        newClientName: '',
        newClientEmail: '',
        newClientPhone: '',
        serviceId: '',
        staffId: 'any',
        selectedTierId: 'any',
        date: new Date(),
        startTime: '',
        addOnIds: [] as string[],
        overrideBusinessHours: false,
        paymentMethod: 'card_on_file',
    }
  });

  const { register, control, watch, reset, setValue, trigger, handleSubmit } = methods;

  useEffect(() => {
    if (open) {
        setStep('details');
        setIsSubmitting(false);
        setAssignedStaffId(null);
        setClientSearch('');
        setCheckInToken('');
        setInspirationPhotoUrl('');
        setShowAllSlots(selectedTenant?.tightSchedulingEnabled === false);
        
        const staffDefault = (role === 'staff' && user) ? user.uid : (appointmentToRebook ? (appointmentToRebook.staffId || 'any') : 'any');
        reset({
            clientId: initialClient?.id || appointmentToRebook?.clientId || '',
            newClientName: '',
            newClientEmail: '',
            newClientPhone: '',
            serviceId: appointmentToRebook ? appointmentToRebook.serviceId : '',
            staffId: staffDefault,
            selectedTierId: 'any',
            date: appointmentToRebook ? safeDate(appointmentToRebook.startTime) : new Date(),
            startTime: appointmentToRebook ? (() => { try { return format(safeDate(appointmentToRebook.startTime), 'HH:mm'); } catch { return ''; } })() : '',
            addOnIds: appointmentToRebook ? (appointmentToRebook.addOnIds || []) : [],
            overrideBusinessHours: false,
            paymentMethod: 'card_on_file',
        });
    }
  }, [open, initialClient, appointmentToRebook, reset, role, user, selectedTenant]);

  const watchClientId = watch('clientId');
  const watchServiceId = watch('serviceId');
  const watchStaffId = watch('staffId');
  const watchDate = watch('date');
  const watchStartTime = watch('startTime');
  const watchTierId = watch('selectedTierId');
  const watchOverride = watch('overrideBusinessHours');

  const selectedClient = useMemo(() => clients?.find(c => c.id === watchClientId), [clients, watchClientId]);
  const selectedService = useMemo(() => services?.find(s => s.id === watchServiceId), [services, watchServiceId]);
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

  const qualifiedStaff = useMemo(() => {
    if (!selectedService?.requiredSkills || selectedService.requiredSkills.length === 0) return staff || [];
    return (staff || []).filter(s => selectedService.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
  }, [selectedService, staff]);

  const availableTiersForService = useMemo(() => {
    if (!selectedService?.serviceTiers || selectedService.serviceTiers.length === 0 || !pricingTiers) return [];
    const tiersWithStaff = new Set(qualifiedStaff.map(s => s.pricingTierId).filter(Boolean));
    return selectedService.serviceTiers
        .filter(st => tiersWithStaff.has(st.tierId))
        .map(st => ({
            ...st,
            name: pricingTiers.find(pt => pt.id === st.tierId)?.name || 'Tier'
        }));
  }, [selectedService, qualifiedStaff, pricingTiers]);
  
  const weekStart = useMemo(() => startOfWeek(watchDate, { weekStartsOn: 0 }), [watchDate]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);

  const timeSlots = useMemo(() => {
    if (!selectedService || !watchDate || !publicScheduleProfile || !staff || !services || !appointmentsFromDB) return [];
    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(watchDate, 'eeee').toLowerCase();
    
    let staffToAudit = watchStaffId === 'any' ? qualifiedStaff : qualifiedStaff.filter(s => s.id === watchStaffId);
    if (watchStaffId === 'any' && watchTierId !== 'any') {
        staffToAudit = staffToAudit.filter(s => s.pricingTierId === watchTierId);
    }

    const options: Set<string> = new Set();
    const isTightScheduling = !!selectedTenant?.tightSchedulingEnabled && !showAllSlots;
    const isMorningAnchor = !!selectedTenant?.morningAnchorEnabled && !showAllSlots;

    staffToAudit.forEach(staffMember => {
        let workingHours;
        const staffDaySchedule = staffMember?.availability?.week?.[dayName as keyof typeof staffMember.availability.week];
        if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
        else if (staffDaySchedule && !staffDaySchedule.enabled && !watchOverride) return;
        else workingHours = publicScheduleProfile?.week?.[dayName];
        
        const dayStartWithBusinessHours = watchOverride ? startOfDay(watchDate) : timeStringToDate(workingHours?.start || '09:00 AM', watchDate);
        const dayEndWithBusinessHours = watchOverride ? endOfDay(watchDate) : timeStringToDate(workingHours?.end || '05:00 PM', watchDate);
        
        if (!watchOverride && (!workingHours || !workingHours.enabled)) return;

        const busyIntervals: { start: Date, end: Date, padBefore: number, padAfter: number }[] = [];
        appointmentsFromDB.filter(apt => isSameDay(safeDate(apt.startTime), watchDate) && apt.staffId === staffMember.id && apt.status !== 'cancelled').forEach(apt => {
            const aptService = services.find(s => s.id === apt.serviceId);
            const bStart = safeDate(apt.startTime), bEnd = safeDate(apt.endTime);
            if (bStart > bEnd) return; // malformed window — never crash the grid over it
            busyIntervals.push({ start: bStart, end: bEnd, padBefore: aptService?.padBefore || 0, padAfter: aptService?.padAfter || 0 });
        });

        (eventsFromDB || []).filter(evt => isSameDay(safeDate(evt.startTime), watchDate) && evt.type === 'blocked' && (!evt.staffIds || evt.staffIds.includes('all') || evt.staffIds.includes(staffMember.id))).forEach(evt => {
            const eStart = safeDate(evt.startTime), eEnd = safeDate(evt.endTime);
            if (eStart > eEnd) return;
            busyIntervals.push({ start: eStart, end: eEnd, padBefore: 0, padAfter: 0 });
        });

        let currentTime = dayStartWithBusinessHours;
        const now = new Date();
        if (isToday(watchDate)) {
            const minSinceStart = (now.getHours() * 60) + now.getMinutes();
            const busStartMin = (dayStartWithBusinessHours.getHours() * 60) + dayStartWithBusinessHours.getMinutes();
            const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
            if (skip > 0) currentTime = addMinutes(dayStartWithBusinessHours, skip * bookingInterval);
        }
        
        while (currentTime < dayEndWithBusinessHours) {
            const totalServiceDuration = selectedService.duration + (selectedService.padBefore || 0) + (selectedService.padAfter || 0);
            const potentialEnd = addMinutes(currentTime, totalServiceDuration);
            if (potentialEnd > dayEndWithBusinessHours) break;

            const isOverlapping = busyIntervals.some((interval) => {
                const intervalStartWithPad = subMinutes(interval.start, interval.padBefore);
                const intervalEndWithPad = addMinutes(interval.end, interval.padAfter);
                return areIntervalsOverlapping(
                    { start: currentTime, end: potentialEnd }, 
                    { start: intervalStartWithPad, end: intervalEndWithPad }, 
                    { inclusive: false }
                );
            });

            if (!isOverlapping && (watchOverride || (!isToday(watchDate) || (staffMember.active && !staffMember.onBreak)))) {
                const isStartOfDaySlot = isSameDay(currentTime, dayStartWithBusinessHours) && currentTime.getTime() === dayStartWithBusinessHours.getTime();
                const isDayEmpty = busyIntervals.length === 0;

                let allowed = true;

                if (!watchOverride) {
                    if (isMorningAnchor && isDayEmpty && !isStartOfDaySlot) {
                        allowed = false;
                    }

                    if (allowed && isTightScheduling && !isDayEmpty) {
                        const startsAtAnotherEnd = busyIntervals.some(interval => {
                            const prevEndWithPad = addMinutes(interval.end, interval.padAfter);
                            return Math.abs(differenceInMinutes(currentTime, prevEndWithPad)) < 1;
                        });
                        const endsAtAnotherStart = busyIntervals.some(interval => {
                            const nextStartWithPad = subMinutes(interval.start, interval.padBefore);
                            return Math.abs(differenceInMinutes(potentialEnd, nextStartWithPad)) < 1;
                        });
                        
                        if (!isStartOfDaySlot && !startsAtAnotherEnd && !endsAtAnotherStart) {
                            allowed = false;
                        }
                    }
                }

                if (allowed) {
                    options.add(format(currentTime, 'HH:mm'));
                }
            }
            currentTime = addMinutes(currentTime, bookingInterval);
        }
    });
    return Array.from(options).sort();
  }, [watchDate, watchStaffId, watchTierId, qualifiedStaff, selectedService, staff, appointmentsFromDB, eventsFromDB, publicScheduleProfile, services, watchOverride, selectedTenant, showAllSlots]);

 const depositDetails = useMemo(() => {
    if (!selectedService) return null;

    const poorHistory     = !!(selectedClient && (safeNumber(selectedClient.noShowCount) + safeNumber(selectedClient.cancellationCount)) > 2);
    const guardianActive  = selectedTenant?.guardianProtocolEnabled !== false;
    const isGuardianForced = guardianActive && poorHistory && selectedService.depositType === 'none';

    const cents = computeDepositCents({
      service: selectedService,
      price: selectedService.price,
      depositsLive: !!selectedTenant?.depositsLive,
      poorHistory,
      guardianActive,
    });
    if (cents <= 0) return null;

    return { amount: cents / 100, type: selectedService.depositType, isGuardianForced };
  }, [selectedService, selectedClient, selectedTenant]);

  const steps = useMemo(() => {
    const flow: Step[] = ['details', 'timing'];
    if (depositDetails) flow.push('deposit');
    flow.push('success');
    return flow;
  }, [depositDetails]);

  const currentStepIndex = steps.indexOf(step);

  const handleNext = async () => {
    if (step === 'details') {
        const isNew = watchClientId === 'new';
        const fieldsToValidate: any[] = isNew ? ['newClientName', 'newClientEmail', 'serviceId'] : ['clientId', 'serviceId'];
        const valid = await trigger(fieldsToValidate);
        if (valid) setStep('timing');
    } else if (step === 'timing') {
        if (!watchStartTime) return toast({ variant: 'destructive', title: 'Pick a time', description: 'Choose an open slot to continue.' });
        if (depositDetails) setStep('deposit');
        else finalizeBooking();
    } else if (step === 'deposit') {
        finalizeBooking();
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setStep(steps[currentStepIndex - 1]);
    }
  };

  const finalizeBooking = async () => {
    setIsSubmitting(true);
    const data = methods.getValues();
    const [hours, minutes] = data.startTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(data.date), hours), minutes);
    const endDateTime = addMinutes(startDateTime, selectedService!.duration);

    // ── v13: try the shared booking engine first — server-side transaction,
    // shared fairness rotation, no double-booking. Remote-payment bookings
    // (status deposit_pending) and any API failure fall through to the
    // legacy direct write below, unchanged.
    const remotePay = depositDetails && data.paymentMethod === 'none';
    if (!remotePay) {
      try {
        const res = await fetch('/api/appointments/book', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId, source: 'pos_add_appointment',
            serviceId: data.serviceId,
            staffId: data.staffId || 'any',
            startTime: startDateTime.toISOString(),
            client: data.clientId === 'new'
              ? { name: data.newClientName, email: data.newClientEmail, phone: data.newClientPhone }
              : { id: data.clientId },
            depositCents: depositDetails ? Math.round(depositDetails.amount * 100) : 0,
            inspirationPhotoUrl: inspirationPhotoUrl || undefined,
          }),
        });
        if (res.status === 409) {
          const out = await res.json().catch(() => ({}));
          toast({ variant: 'destructive', title: 'That time was just taken', description: out?.error || 'Pick another slot.' });
          setStep('timing');
          setIsSubmitting(false);
          return;
        }
        if (res.ok) {
          const out = await res.json().catch(() => null);
          if (out?.ok) {
            setAssignedStaffId(out.staffId);
            setCheckInToken(out.checkInToken);
            if (depositDetails && data.paymentMethod !== 'none') {
              try {
                const b2 = writeBatch(firestore!);
                const txnRef2 = doc(collection(firestore!, `tenants/${tenantId}/transactions`));
                b2.set(txnRef2, sanitizeForFirestore({
                  id: txnRef2.id,
                  date: new Date().toISOString(),
                  description: `Retainer: ${selectedService?.name}`,
                  clientOrVendor: selectedClient?.name || data.newClientName,
                  clientId: out.clientId || undefined,
                  type: 'income', context: 'Business', category: 'Retainers',
                  amount: depositDetails.amount,
                  paymentMethod: data.paymentMethod === 'card_on_file' ? 'Vault' : 'Manual Entry',
                  appointmentId: out.appointmentId,
                  staffId: out.staffId,
                }));
                await b2.commit();
              } catch { /* booking exists — retainer can be logged from the ledger */ }
            }
            setStep('success');
            setIsSubmitting(false);
            return;
          }
        }
      } catch { /* fall through to the legacy write */ }
    }

    const batch = writeBatch(firestore!);
    const now = new Date().toISOString();
    
    let finalClientId = data.clientId;
    let finalClientName = selectedClient?.name || data.newClientName;

    if (finalClientId === 'new') {
        const newClientRef = doc(collection(firestore!, `tenants/${tenantId}/clients`));
        finalClientId = newClientRef.id;
        batch.set(newClientRef, sanitizeForFirestore({
            id: finalClientId,
            name: data.newClientName,
            email: data.newClientEmail,
            phone: data.newClientPhone,
            avatarUrl: `https://picsum.photos/seed/${finalClientId}/100`,
            lifetimeValue: 0,
            lastAppointment: now,
            status: 'active'
        }));
    }

    let finalStaffId = data.staffId;
    if (finalStaffId === 'any') {
        const candidates = qualifiedStaff.filter(s => {
            const dayName = format(startDateTime, 'eeee').toLowerCase();
            const sDaySched = s.availability?.week?.[dayName as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[dayName];
            if (!data.overrideBusinessHours) {
                if (!sDaySched?.enabled) return false;
                const openT = timeStringToDate(sDaySched.start, startDateTime);
                const closeT = timeStringToDate(sDaySched.end, startDateTime);
                if (startDateTime < openT || endDateTime > closeT) return false;
            }
            return !appointmentsFromDB?.some(apt => apt.staffId === s.id && apt.status !== 'cancelled' && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: safeDate(apt.startTime), end: safeDate(apt.endTime) }, { inclusive: false }));
        });
        if (candidates.length > 0) {
            const fairKey = (s: any) => {
                const v = s.lastBookingAssignedAt || s.lastServedTimestamp;
                return v ? safeDate(v).getTime() : 0;
            };
            candidates.sort((a, b) => fairKey(a) - fairKey(b));
            finalStaffId = candidates[0].id;
        } else {
            setIsSubmitting(false);
            return toast({ variant: 'destructive', title: 'No one available', description: 'No providers are free at that time — try another slot.' });
        }
    }

    setAssignedStaffId(finalStaffId);
    
    const aptId = nanoid();
    const token = nanoid(16);
    setCheckInToken(token);
    const aptRef = doc(firestore!, `tenants/${tenantId}/appointments`, aptId);
    const checkInRef = doc(firestore!, 'appointmentCheckIns', token);

    const isRemotePayment = depositDetails && data.paymentMethod === 'none';

    const depositCentsForApt = depositDetails ? Math.round(depositDetails.amount * 100) : 0;
    const payload = {
        id: aptId,
        tenantId,
        clientId: finalClientId,
        clientName: finalClientName,
        serviceId: data.serviceId,
        staffId: finalStaffId,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        status: isRemotePayment ? 'deposit_pending' : 'confirmed',
        source: 'manual',
        checkInToken: token,
        checkInStatus: 'pending',
        depositAmountCents: depositCentsForApt,
        depositStatus: depositDetails ? 'pending' : 'none',
        inspirationPhotoUrl: inspirationPhotoUrl || undefined
    };

    batch.set(aptRef, sanitizeForFirestore(payload));
    batch.set(checkInRef, sanitizeForFirestore(payload));

    // v11 — same fairness ledger QuickBook uses, so "Smart Rotation" here and
    // "First available" there rotate through ONE shared queue, not two.
    if (data.staffId === 'any' && finalStaffId) {
        batch.set(doc(firestore!, `tenants/${tenantId}/staff`, finalStaffId),
            { lastBookingAssignedAt: now }, { merge: true });
    }

    if (depositDetails && data.paymentMethod !== 'none') {
        const txnRef = doc(collection(firestore!, `tenants/${tenantId}/transactions`));
        batch.set(txnRef, sanitizeForFirestore({
            id: txnRef.id,
            date: now,
            description: `Retainer: ${selectedService?.name}`,
            clientOrVendor: finalClientName,
            clientId: finalClientId,
            type: 'income',
            context: 'Business',
            category: 'Retainers',
            amount: depositDetails.amount,
            paymentMethod: data.paymentMethod === 'card_on_file' ? 'Vault' : 'Manual Entry',
            appointmentId: aptId,
            staffId: finalStaffId
        }));
    }

    try {
        await batch.commit();
        setStep('success');
        if (isRemotePayment) {
            toast({ title: 'Payment link ready', description: 'Send the check-in link so they can pay the deposit.' });
        }
    } catch (e) {
        toast({ variant: 'destructive', title: 'Booking failed', description: 'Nothing was saved — try again.' });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    if (checkInToken) {
        const link = `${window.location.origin}/check-in/${checkInToken}`;
        navigator.clipboard.writeText(link);
        toast({ title: 'Link copied' });
    }
  };

  // v10 — live "Booking so far" line for the summary rail (desktop) and
  // the compact strip above the footer (mobile). Lucide icons only.
  const SummaryLine = ({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) => (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-dashed border-border/60 last:border-0">
        <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className={cn('text-[13px] font-semibold truncate', !value && 'text-muted-foreground/40 font-normal')}>{value || 'Not chosen yet'}</p>
        </div>
    </div>
  );

  const STEP_LABELS: Record<string, string> = {
    details: 'Client & service', timing: 'Provider & time', deposit: 'Deposit',
  };

  const SelectionHeader = ({ icon: Icon, title, stepNum }: { icon: any, title: string, stepNum: number }) => (
    <div className="flex items-center gap-3 mb-6 text-left">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Icon className="w-4 h-4" />
        </div>
        <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step {stepNum}</p>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
        </div>
    </div>
  );

  const filteredClients = useMemo(() => {
      if (!clients) return [];
      if (!clientSearch.trim()) return clients.slice(0, 10);
      const s = clientSearch.toLowerCase();
      return clients.filter(c => (c.name || '').toLowerCase().includes(s) || (c.email && c.email.toLowerCase().includes(s)) || (c.phone && c.phone.includes(s)));
  }, [clients, clientSearch]);

  const currentAssignedPro = useMemo(() => staff?.find(s => s.id === assignedStaffId), [staff, assignedStaffId]);

  return (
    <FormProvider {...methods}>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("p-0 border-none bg-background flex flex-col shadow-3xl overflow-hidden", isMobile ? "h-[92dvh] rounded-t-[2.5rem]" : "sm:max-w-3xl max-h-[95dvh]")}>
        <SheetHeader className={cn("p-8 pb-6 border-b bg-muted/5 flex-shrink-0 text-left", isMobile ? "p-6" : "p-8 pb-6")}>
            <div className="flex items-center gap-3 mb-2 text-left">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Front desk booking</span>
            </div>
            <SheetTitle className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900 leading-none">New Appointment</SheetTitle>
            {step !== 'success' && (
                <div className="pt-5 flex gap-1.5">
                    {steps.filter(s => s !== 'success').map((s, i) => {
                        const done = i < currentStepIndex;
                        const active = s === step;
                        return (
                            <button key={s} type="button" onClick={() => { if (done) setStep(s); }}
                                className={cn('flex-1 text-left min-w-0', done ? 'cursor-pointer' : 'cursor-default')}>
                                <div className={cn('h-1 rounded-full mb-1.5 transition-colors', (done || active) ? 'bg-primary' : 'bg-muted')} />
                                <p className={cn('text-[10px] font-medium truncate', active ? 'text-primary' : done ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{STEP_LABELS[s]}</p>
                            </button>
                        );
                    })}
                </div>
            )}
        </SheetHeader>

        <div className="flex-1 flex min-h-0">
        <ScrollArea className="flex-1 min-w-0">
            <div className="p-5 md:p-8 pb-28">
                <AnimatePresence mode="wait">
                    {step === 'details' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="details" className="space-y-10">
                            <SelectionHeader icon={User} title="Client & Service" stepNum={1} />
                            <div className="space-y-8 text-left">
                                <div className="space-y-3">
                                    <Label className="text-[11px] font-medium text-muted-foreground ml-1">Client</Label>
                                    <Controller
                                        name="clientId"
                                        control={control}
                                        render={({ field }) => (
                                            <div className="space-y-4">
                                                <div className="relative">
                                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-40" />
                                                    <Input 
                                                        placeholder="Search by name, email, or phone…" 
                                                        value={clientSearch}
                                                        onChange={e => setClientSearch(e.target.value)}
                                                        className="h-12 pl-11 rounded-xl border font-medium text-sm"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 gap-2">
                                                    <button 
                                                        type="button"
                                                        onClick={() => { field.onChange('new'); setClientSearch(''); }}
                                                        className={cn(
                                                            "flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left",
                                                            field.value === 'new' ? "border-primary bg-primary/5 shadow-md" : "border-dashed hover:border-primary/20"
                                                        )}
                                                    >
                                                        <div className="p-3 bg-muted rounded-xl shadow-inner"><UserPlus className="w-5 h-5 text-muted-foreground" /></div>
                                                        <span className="font-semibold text-sm">New client</span>
                                                    </button>
                                                    {filteredClients.map(c => {
                                                        const isSel = field.value === c.id;
                                                        const isClientMember = !!(c.activeMembershipId || c.subscription);
                                                        const hasPkg = (c.activePackages?.length || 0) > 0;
                                                        const hasDebt = (c.outstandingBalance || 0) > 0;
                                                        return (
                                                            <button 
                                                                key={c.id}
                                                                type="button"
                                                                onClick={() => { field.onChange(c.id); setClientSearch(''); }}
                                                                className={cn(
                                                                    "flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left",
                                                                    isSel ? "border-primary bg-primary/5 shadow-md" : "border-transparent bg-muted/10 hover:bg-muted/20"
                                                                )}
                                                            >
                                                                <div className="relative shrink-0">
                                                                    <Avatar className="h-10 w-10 border shadow-sm rounded-xl">
                                                                        <AvatarImage src={c.avatarUrl} className="object-cover" />
                                                                        <AvatarFallback className="font-black text-xs">{(c.name || 'G')[0]}</AvatarFallback>
                                                                    </Avatar>
                                                                    {isClientMember && <div className="absolute -top-1 -right-1 bg-indigo-600 text-white p-0.5 rounded shadow-sm border border-background"><Award className="w-2.5 h-2.5" /></div>}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="font-semibold text-sm truncate leading-none text-left">{c.name}</p>
                                                                        {hasPkg && <Badge className="bg-teal-50 text-teal-700 border border-teal-200 text-[9px] h-4 px-1.5 font-medium">Package</Badge>}
                                                                        {hasDebt && <Badge className="bg-red-50 text-red-600 border border-red-200 text-[9px] h-4 px-1.5 font-medium">Owes balance</Badge>}
                                                                        {!!c.cardOnFile?.token && <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] h-4 px-1.5 font-medium"><CreditCard className="w-2.5 h-2.5 mr-0.5" />Card</Badge>}
                                                                    </div>
                                                                    <p className="text-xs text-muted-foreground truncate text-left">{c.email || c.phone || 'No contact on file'}</p>
                                                                </div>
                                                                {isSel && <Check className="w-5 h-5 text-primary" />}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    />
                                </div>

                                {/* v10 — everything worth knowing about this client, visible at selection */}
                                {selectedClient && (
                                    <div className="flex flex-wrap items-center gap-1.5 p-3 rounded-xl bg-muted/20 border border-dashed">
                                        {selectedClient.activeMembershipId && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5"><Award className="w-2.5 h-2.5" /> Member</span>
                                        )}
                                        {(selectedClient.activePackages || []).map((p: any) => (
                                            <span key={p.packageId} className="inline-flex items-center gap-1 text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5"><Sparkles className="w-2.5 h-2.5" /> {p.sessionsRemaining} package visit{p.sessionsRemaining === 1 ? '' : 's'} left</span>
                                        ))}
                                        {!!selectedClient.cardOnFile?.token && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CreditCard className="w-2.5 h-2.5" /> {selectedClient.cardOnFile.brand} •••• {selectedClient.cardOnFile.last4}</span>
                                        )}
                                        {(selectedClient.outstandingBalance || 0) > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Owes ${safeNumber(selectedClient.outstandingBalance).toFixed(2)}</span>
                                        )}
                                        {(safeNumber(selectedClient.noShowCount) + safeNumber(selectedClient.cancellationCount)) > 2 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><ShieldCheck className="w-2.5 h-2.5" /> Deposit protected</span>
                                        )}
                                    </div>
                                )}

                                {watchClientId === 'new' && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-5 p-5 rounded-2xl border bg-muted/5 overflow-hidden">
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] font-medium text-muted-foreground ml-1">Full name</Label>
                                            <Input {...register('newClientName')} placeholder="Alexandra Smith" className="h-11 rounded-lg border text-sm bg-white" />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <Label className="text-[11px] font-medium text-muted-foreground ml-1">Email</Label>
                                                <Input type="email" {...register('newClientEmail')} placeholder="alex@example.com" className="h-11 rounded-lg border text-sm bg-white" />
                                            </div>
                                            <div className="space-y-1.5 kiosk-phone-input text-left">
                                                <Label className="text-[11px] font-medium text-muted-foreground ml-1">Mobile</Label>
                                                <PhoneInput name="newClientPhone" label="" className="h-12" />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                <div className="space-y-3">
                                    <Label className="text-[11px] font-medium text-muted-foreground ml-1">Service</Label>
                                    <Controller
                                        name="serviceId"
                                        control={control}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger id="service-add-apt" className="h-12 rounded-xl border bg-white font-medium text-sm">
                                                    <SelectValue placeholder="Select a service…" />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-2 shadow-2xl">
                                                    {(services || []).filter(s => s.type === 'service').map(s => <SelectItem key={s.id} value={s.id} className="text-sm">{s.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>

                                <div className="space-y-4 pt-4 border-t border-dashed">
                                    <Label className="text-[11px] font-medium text-muted-foreground ml-1 flex items-center gap-2">
                                        <FileImage className="w-3.5 h-3.5 opacity-40" /> Inspiration photo (optional)
                                    </Label>
                                    <ImageUpload onImageUploaded={setInspirationPhotoUrl} initialImage={inspirationPhotoUrl} />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'timing' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="timing" className="space-y-10">
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                    <SelectionHeader icon={Clock} title="Provider & Time" stepNum={2} />
                                    <div className="flex items-center gap-3 p-2 bg-muted/20 rounded-xl border-2 border-transparent">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex items-center gap-2">
                                                        <Unlock className={cn("w-3.5 h-3.5 transition-colors", watchOverride ? "text-primary" : "text-muted-foreground opacity-40")} />
                                                        <Switch checked={watchOverride} onCheckedChange={(val) => setValue('overrideBusinessHours', val)} />
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent className="font-black uppercase text-[9px] tracking-widest border-2">Override Business Hours</TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </div>
                                {/* v13 — provider strip, in-file and crash-proof. Shows what an
                                    operator actually needs: today's load and who's off that day.
                                    Only staff QUALIFIED for the chosen service appear. */}
                                <div className="space-y-2">
                                    <Label className="text-[11px] font-medium text-muted-foreground ml-1">Provider</Label>
                                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                                        <button type="button" onClick={() => setValue('staffId', 'any')}
                                            className={cn('flex flex-col items-center gap-1.5 min-w-[86px] p-3 rounded-2xl border-2 transition-all shrink-0',
                                                watchStaffId === 'any' ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/10 hover:bg-muted/20')}>
                                            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Zap className="w-4 h-4" /></div>
                                            <p className="text-[11px] font-semibold leading-none">First available</p>
                                            <p className="text-[9px] text-muted-foreground">fair rotation</p>
                                        </button>
                                        {qualifiedStaff.map(s => {
                                            const dayLoad = (appointmentsFromDB || []).filter(a => a.staffId === s.id && a.status !== 'cancelled' && isSameDay(safeDate(a.startTime), watchDate)).length;
                                            const dow2 = format(watchDate, 'eeee').toLowerCase();
                                            const sched = s?.availability?.week?.[dow2 as keyof typeof s.availability.week] ?? (publicScheduleProfile?.week as any)?.[dow2];
                                            const offToday = sched ? sched.enabled === false : false;
                                            const sel = watchStaffId === s.id;
                                            return (
                                                <button key={s.id} type="button" onClick={() => setValue('staffId', s.id)}
                                                    className={cn('flex flex-col items-center gap-1.5 min-w-[86px] p-3 rounded-2xl border-2 transition-all shrink-0',
                                                        sel ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/10 hover:bg-muted/20',
                                                        offToday && !sel && 'opacity-50')}>
                                                    <Avatar className="w-10 h-10 rounded-xl border">
                                                        <AvatarImage src={s.avatarUrl} className="object-cover" />
                                                        <AvatarFallback className="text-xs font-semibold">{(s.name || 'S')[0]}</AvatarFallback>
                                                    </Avatar>
                                                    <p className="text-[11px] font-semibold leading-none truncate max-w-[78px]">{(s.name || 'Staff').split(' ')[0]}</p>
                                                    <p className={cn('text-[9px]', offToday ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                                                        {offToday ? 'off this day' : `${dayLoad} today`}
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {qualifiedStaff.length === 0 && (
                                        <p className="text-[11px] text-amber-600 px-1">No one is certified for this service — check the service's required skills.</p>
                                    )}
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-primary/20 bg-primary/5 shadow-inner">
                                    <div className="space-y-0.5 text-left">
                                        <Label className="text-xs font-semibold text-primary flex items-center gap-2">
                                            <Workflow className="w-3.5 h-3.5" /> Smart slots
                                        </Label>
                                        <p className="text-[11px] text-primary/70">Hides times that would strand unbookable gaps</p>
                                    </div>
                                    <Switch checked={!showAllSlots} onCheckedChange={(val) => setShowAllSlots(!val)} className="data-[state=checked]:bg-primary" />
                                </div>
                            </div>
                            <div className="rounded-2xl border bg-muted/10 p-5 space-y-6 text-center">
                                <div className="flex items-center justify-between">
                                    <Button variant="outline" size="icon" onClick={() => setValue('date', subWeeks(watchDate, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronLeft className="w-5 h-5" /></Button>
                                    <span className="font-semibold text-sm">{format(watchDate, 'MMMM yyyy')}</span>
                                    <Button variant="outline" size="icon" onClick={() => setValue('date', addWeeks(watchDate, 1))} type="button" className="h-10 w-10 rounded-full bg-background shadow-md border-none"><ChevronRight className="w-5 h-5" /></Button>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {weekDays.map(day => {
                                        const dow = format(day, 'eeee').toLowerCase();
                                        const openThatDay = !!(publicScheduleProfile?.week as any)?.[dow]?.enabled;
                                        const past = isBefore(day, startOfDay(new Date())) && !isToday(day);
                                        const sel = isSameDay(day, watchDate);
                                        return (
                                            <button key={day.toISOString()} onClick={() => setValue('date', day)} disabled={past}
                                                className={cn("flex flex-col items-center justify-center p-1.5 sm:p-2 rounded-xl border transition-all aspect-square",
                                                    sel ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-background border-transparent hover:border-primary/30",
                                                    past && "opacity-25 cursor-not-allowed",
                                                    !openThatDay && !sel && !past && "opacity-45")}
                                                type="button">
                                                <span className="text-[10px] uppercase font-medium opacity-60">{format(day, 'E')}</span>
                                                <span className="font-semibold text-base sm:text-lg tracking-tight">{format(day, 'd')}</span>
                                                <span className={cn("w-1 h-1 rounded-full mt-0.5", sel ? "bg-primary-foreground" : openThatDay ? "bg-emerald-500" : "bg-transparent")} />
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="pt-5 border-t border-dashed space-y-1 text-left">
                                    {([['Morning', (t: string) => t < '12:00'], ['Afternoon', (t: string) => t >= '12:00' && t < '17:00'], ['Evening', (t: string) => t >= '17:00']] as [string, (t: string) => boolean][]).map(([groupLabel, test]) => {
                                        const group = timeSlots.filter(test);
                                        if (group.length === 0) return null;
                                        return (
                                            <div key={groupLabel}>
                                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mt-4 mb-2">{groupLabel}</p>
                                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                    {group.map(time => (
                                                        <Button key={time} variant={watchStartTime === time ? 'default' : 'outline'} onClick={() => setValue('startTime', time)} className={cn("h-11 font-semibold text-sm rounded-xl border transition-all", watchStartTime === time ? "shadow-md" : "bg-background")}>
                                                            {format(timeStringToDate(time, new Date()), 'h:mm a')}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {timeSlots.length === 0 && <div className="py-10 text-xs font-medium text-muted-foreground/60 border border-dashed rounded-2xl text-center">No openings this day — try another date</div>}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 'deposit' && depositDetails && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} key="deposit" className="space-y-10">
                            <SelectionHeader icon={CreditCard} title="Deposit" stepNum={3} />
                            <div className="p-8 rounded-2xl bg-primary/5 border border-primary/15 text-center space-y-3">
                                <p className="text-[11px] font-medium uppercase tracking-wider text-primary/70">Deposit due to book</p>
                                <p className="text-4xl font-semibold text-primary tracking-tight font-mono">${depositDetails.amount.toFixed(2)}</p>
                                <div className="pt-4 border-t border-primary/10">
                                    <Badge variant="outline" className="bg-white border text-primary font-medium text-[10px] h-6 px-3 capitalize">{depositDetails.type || 'standard'} deposit</Badge>
                                </div>
                            </div>
                            <div className="space-y-4 text-left">
                                <Label className="text-[11px] font-medium text-muted-foreground ml-1">How will they pay the deposit?</Label>
                                <Controller
                                    name="paymentMethod"
                                    control={control}
                                    render={({ field }) => (
                                        <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-1 gap-3">
                                            <label htmlFor="pay-vault" className={cn("flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/5", !selectedClient?.cardOnFile?.token && "opacity-40 grayscale grayscale-[0.5]")}>
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="card_on_file" id="pay-vault" disabled={!selectedClient?.cardOnFile?.token}/>
                                                    <div className="space-y-0.5 text-left">
                                                        <span className="text-sm font-semibold text-slate-900">Card on file</span>
                                                        <p className="text-xs text-muted-foreground">{selectedClient?.cardOnFile?.token ? `${selectedClient?.cardOnFile?.brand} •••• ${selectedClient?.cardOnFile?.last4}` : 'No card saved yet'}</p>
                                                    </div>
                                                </div>
                                                <ShieldCheck className={cn("w-5 h-5", selectedClient?.cardOnFile?.token ? "text-primary" : "text-slate-300")} />
                                            </label>
                                            <label htmlFor="pay-terminal" className="flex items-center justify-between p-5 rounded-2xl border-2 cursor-pointer transition-all hover:bg-muted/5 border-border">
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="terminal" id="pay-terminal" />
                                                    <div className="space-y-0.5 text-left">
                                                        <span className="text-sm font-semibold text-slate-900">New card at terminal</span>
                                                        <p className="text-xs text-muted-foreground">Run a new card right now</p>
                                                    </div>
                                                </div>
                                                <Zap className="w-5 h-5 text-primary" />
                                            </label>
                                            <label htmlFor="pay-pending" className="flex items-center justify-between p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all hover:bg-muted/5">
                                                <div className="flex items-center gap-4">
                                                    <RadioGroupItem value="none" id="pay-pending" />
                                                    <div className="space-y-0.5 text-left">
                                                        <span className="text-sm font-semibold text-slate-900">Send payment link</span>
                                                        <p className="text-xs text-muted-foreground">They pay from their phone before the visit</p>
                                                    </div>
                                                </div>
                                                <Smartphone className="w-5 h-5 text-muted-foreground opacity-40" />
                                            </label>
                                        </RadioGroup>
                                    )}
                                />
                            </div>
                        </motion.div>
                    )}

                    {step === 'success' && (
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} key="success" className="text-center py-12 space-y-12">
                            <div className="w-24 h-24 bg-green-500/10 rounded-3xl flex items-center justify-center mx-auto">
                                <CheckCircle2 className="w-12 h-12 text-green-500" />
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Booked!</h2>
                                <p className="text-muted-foreground font-medium max-w-xs mx-auto leading-relaxed text-center">The appointment is on the calendar and ready to go.</p>
                            </div>
                            
                            <div className="grid gap-4 max-w-sm mx-auto">
                                <Card className="p-5 rounded-2xl border bg-white shadow-sm flex flex-col items-center gap-3 text-left">
                                    <p className="text-[11px] font-medium uppercase tracking-wider text-primary/70">Their provider</p>
                                    <div className="flex items-center gap-4 w-full">
                                        <Avatar className="w-16 h-16 border-4 border-background shadow-xl rounded-2xl">
                                            <AvatarImage src={currentAssignedPro?.avatarUrl} className="object-cover" />
                                            <AvatarFallback className="bg-primary/10 text-primary font-black uppercase">{(currentAssignedPro?.name || 'S')[0]}</AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-lg leading-none mb-1 truncate text-left">{currentAssignedPro?.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60 text-left">{currentAssignedPro?.role}</p>
                                        </div>
                                    </div>
                                </Card>
                                <Card className="p-5 rounded-2xl border border-dashed bg-muted/10 space-y-4 text-left">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Details</p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <CalendarIcon className="w-5 h-5 text-primary opacity-40" />
                                        <div className="space-y-0.5">
                                            <p className="font-black uppercase text-xs">{format(watchDate, 'EEEE, MMM d')}</p>
                                            <p className="text-sm font-black text-primary tracking-tighter font-mono">{format(timeStringToDate(watchStartTime, new Date()), 'h:mm a')}</p>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/50 flex items-center gap-4">
                                        <Sparkles className="w-5 h-5 text-primary opacity-40" />
                                        <p className="font-black uppercase text-xs truncate">{selectedService?.name}</p>
                                    </div>
                                    <div className="pt-4 border-t border-white/50 space-y-3">
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-primary/70">Check-in link</p>
                                        <Button variant="outline" size="sm" onClick={handleCopyLink} className="w-full h-10 rounded-lg border font-medium text-xs bg-white shadow-sm">
                                            <PlusCircle className="w-3.5 h-3.5 mr-2" /> Copy check-in link
                                        </Button>
                                        <div className="p-3 bg-white/50 rounded-xl border-2 border-dashed border-primary/10 flex items-start gap-2">
                                            <Info className="w-3.5 h-3.5 text-primary opacity-40 mt-0.5" />
                                            <p className="text-[11px] text-slate-500 leading-snug">The link was queued to send by text and email — copy it here if they need it right away.</p>
                                        </div>
                                    </div>
                                </Card>
                            </div>
                            
                            <Button className="w-full h-12 text-sm font-semibold rounded-xl shadow-lg shadow-primary/10 transition-all active:scale-[0.98]" onClick={() => onOpenChange(false)}>Done</Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </ScrollArea>

        {/* v10 — desktop summary rail: follows the booking through every step */}
        {step !== 'success' && (
        <aside className="hidden md:flex w-[248px] shrink-0 border-l bg-muted/5 flex-col p-5 overflow-y-auto">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Booking so far</p>
            <SummaryLine icon={User} label="Client"
                value={watchClientId === 'new' ? (watch('newClientName') || 'New client') : selectedClient?.name} />
            <SummaryLine icon={Sparkles} label="Service" value={selectedService?.name} />
            <SummaryLine icon={CalendarIcon} label="Day"
                value={watchDate ? format(watchDate, 'EEE, MMM d') : undefined} />
            <SummaryLine icon={Clock} label="Time"
                value={watchStartTime ? format(timeStringToDate(watchStartTime, new Date()), 'h:mm a') : undefined} />
            <SummaryLine icon={Users} label="Provider"
                value={watchStaffId === 'any' ? 'First available' : (staff || []).find(s => s.id === watchStaffId)?.name} />
            {depositDetails && (
                <SummaryLine icon={ShieldCheck} label="Deposit" value={`$${depositDetails.amount.toFixed(2)}`} />
            )}
            {selectedService?.price != null && (
                <div className="mt-auto pt-4 border-t flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Total</span>
                    <span className="text-base font-semibold">${safeNumber(selectedService.price).toFixed(2)}</span>
                </div>
            )}
        </aside>
        )}
        </div>
        
        {step !== 'success' && (
            <SheetFooter className={cn("p-4 md:p-6 border-t bg-background/80 backdrop-blur-xl flex-shrink-0 z-20")}>
                <div className="w-full space-y-2">
                <div className="md:hidden flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                    <User className="w-3 h-3 shrink-0 opacity-50" />
                    <span className="truncate">
                        {[watchClientId === 'new' ? (watch('newClientName') || 'New client') : selectedClient?.name,
                          selectedService?.name,
                          watchStartTime ? `${format(watchDate, 'EEE d')} · ${format(timeStringToDate(watchStartTime, new Date()), 'h:mm a')}` : null]
                          .filter(Boolean).join('  ·  ') || 'Start by picking a client'}
                    </span>
                </div>
                <div className="flex w-full gap-3">
                    {currentStepIndex > 0 && (
                        <Button variant="ghost" onClick={handlePrevStep} className="flex-1 h-12 md:h-14 rounded-xl font-medium text-sm text-slate-500">
                            Back
                        </Button>
                    )}
                    <Button 
                        onClick={handleNext} 
                        disabled={isSubmitting || (step === 'details' && (!watchClientId || !watchServiceId))}
                        className={cn(
                            "h-12 md:h-14 font-semibold text-sm rounded-xl shadow-md shadow-primary/20 group transition-all",
                            currentStepIndex === 0 ? "w-full" : "flex-[2.5]"
                        )}
                    >
                        {isSubmitting ? (
                            <Loader className="animate-spin h-5 w-5" />
                        ) : (
                            <>
                                {step === 'details' ? 'Next: Provider & time' :
                                 step === 'timing' && depositDetails ? 'Next: Deposit' :
                                 'Book Appointment'}
                                <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                            </>
                        )}
                    </Button>
                </div>
                </div>
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
    </FormProvider>
  );
};
