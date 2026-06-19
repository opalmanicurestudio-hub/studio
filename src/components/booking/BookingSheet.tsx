'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type Service,
  type Staff,
  type Appointment,
  type Event,
  type Tenant,
  type ConsentForm,
  type PricingTier,
  type Client,
  getServicePrice,
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import {
  Clock, Calendar, ChevronLeft, ChevronRight, User, Mail, Phone,
  CheckCircle, FileSignature, ShieldCheck, CreditCard, Award, Star,
  Info, ListChecks, ChevronDown, MapPin, Wallet, AlertTriangle, ArrowDown,
  Fingerprint, CalendarCheck, CheckCircle2, Zap, Check, Loader, Lock,
  ArrowRight, Sparkles, Users, FileImage, Flame, MessageSquare, Ban,
  RefreshCw,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn, safeNumber } from '@/lib/utils';
import { computeDepositCents } from '@/lib/deposit-policy';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/card';
import {
  startOfWeek, addDays, isSameDay, format, setHours, setMinutes,
  startOfDay, areIntervalsOverlapping, addMinutes, isBefore, isToday,
  parseISO, subWeeks, addWeeks, eachDayOfInterval, differenceInMinutes,
  subMinutes, differenceInHours,
} from 'date-fns';
import { nanoid } from 'nanoid';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PhoneInput } from '../ui/phone-input';
import { useToast } from '@/hooks/use-toast';
import { FormFieldRenderer } from '../consents/FormFieldRenderer';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useIsMobile } from '@/hooks/use-mobile';
import { ImageUpload } from '../shared/ImageUpload';
import { Textarea } from '../ui/textarea';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
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
};

// ─── Theme-aware style helpers ────────────────────────────────────────────────
const useThemeStyles = () => {
  const headingFont = 'var(--booking-heading-font, system-ui, sans-serif)';
  const bodyFont    = 'var(--booking-body-font, system-ui, sans-serif)';
  const r  = 'var(--radius)';
  const r2 = 'calc(var(--radius) * 2)';
  const r3 = 'calc(var(--radius) * 2.5)';
  return { headingFont, bodyFont, r, r2, r3 };
};

// ─── Staff card ───────────────────────────────────────────────────────────────
const StaffSelectionCard = ({
  staff, isSelected, disabled, r,
}: {
  staff: Staff | { id: string; name: string; avatarUrl: string };
  isSelected: boolean;
  disabled?: boolean;
  r: string;
}) => {
  const isAnyStaff = staff.id === 'any';
  return (
    <label htmlFor={`staff-sheet-${staff.id}`} className={cn('block cursor-pointer', disabled && 'cursor-not-allowed opacity-50')}>
      <div
        style={{ borderRadius: r }}
        className={cn(
          'relative transition-all duration-300 border-2 p-3 flex flex-col items-center gap-2',
          isSelected ? 'border-primary bg-primary/5 ring-4 ring-primary/10 shadow-xl' : 'bg-background border-border hover:border-primary/30',
          disabled && 'bg-muted/5 border-dashed',
        )}
      >
        <Avatar className={cn('w-12 h-12 border-4 shadow-sm transition-transform duration-500', isSelected ? 'border-primary scale-110' : 'border-background')}>
          {staff.avatarUrl ? <AvatarImage src={staff.avatarUrl} className="object-cover" /> : null}
          <AvatarFallback className="text-muted-foreground bg-muted">
            {isAnyStaff ? <Users className="w-6 h-6 md:w-7 md:h-7" /> : staff.name.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <p className="font-black uppercase tracking-tight text-[9px] text-center truncate w-full">{staff.name}</p>
        <RadioGroupItem value={staff.id} id={`staff-sheet-${staff.id}`} className="sr-only" disabled={disabled} />
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 bg-primary text-white rounded-full p-0.5">
            <Check className="w-3 h-3" />
          </div>
        )}
      </div>
    </label>
  );
};

// ─── Schema ───────────────────────────────────────────────────────────────────
const bookingSchema = z.object({
  clientName:  z.string().min(1, 'Name is required.'),
  clientEmail: z.string().email('Invalid email address.'),
  clientPhone: z.string().optional(),
  notes:       z.string().optional(),
});
type BookingFormData = z.infer<typeof bookingSchema>;

// ─── onConfirm result type ─────────────────────────────────────────────────────
type ConfirmResult =
  | { requiresPayment: false }
  | { requiresPayment: true; clientSecret: string; stripeAccountId?: string }
  | { requiresPayment: true; error: string }
  | void;

// ─── Props ────────────────────────────────────────────────────────────────────
interface BookingSheetProps {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  service:        Service;
  staff:          Staff[];
  pricingTiers:   PricingTier[];
  initialStaffId?: string;
  appointments:   Appointment[];
  events:         Event[];
  scheduleProfiles: any[];
  services:       Service[];
  consentForms:   ConsentForm[];
  tenant:         Tenant | null;
  onConfirm: (
    formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'> & { depositAmount?: number; depositStatus?: string },
    signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
    setBookingStep: (step: string) => void
  ) => Promise<ConfirmResult> | void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export const BookingSheet: React.FC<BookingSheetProps> = ({
  open, onOpenChange, service, staff, pricingTiers, initialStaffId,
  appointments, events, scheduleProfiles, services, consentForms, tenant, onConfirm,
}) => {
  const isMobile = useIsMobile();
  const { headingFont, bodyFont, r, r2, r3 } = useThemeStyles();

  const [selectedStaffId,      setSelectedStaffId]      = useState(initialStaffId || 'any');
  const [selectedTierId,       setSelectedTierId]        = useState<string>('any');
  const [date,                 setDate]                  = useState(new Date());
  const [selectedTime,         setSelectedTime]          = useState<string | null>(null);
  const [formAnswers,          setFormAnswers]           = useState<Record<string, Record<string, any>>>({});
  const [bookedStaffId,        setBookedStaffId]         = useState<string | null>(null);
  const [inspirationPhotoUrl,  setInspirationPhotoUrl]   = useState<string>('');
  const { toast }     = useToast();
  const { firestore } = useFirebase();

  const methods = useForm<BookingFormData>({ resolver: zodResolver(bookingSchema) });
  const { handleSubmit, watch } = methods;
  const clientEmail = watch('clientEmail');
  const clientPhone = watch('clientPhone');

  const [existingClientWithBalance, setExistingClientWithBalance] = useState<Client | null>(null);
  const [bannedClient,              setBannedClient]              = useState<Client | null>(null);
  const [matchedClient,             setMatchedClient]             = useState<Client | null>(null);
  const [isResolvingIdentity,       setIsResolvingIdentity]       = useState(false);

  // ── Embedded checkout state ───────────────────────────────────────────────
  const [depositClientSecret,    setDepositClientSecret]    = useState<string | null>(null);
  const [depositStripeAccountId, setDepositStripeAccountId] = useState<string | null>(null);
  const [depositLoading,         setDepositLoading]         = useState(false);
  const [depositError,           setDepositError]           = useState<string | null>(null);
  const embeddedMountRef         = useRef<HTMLDivElement>(null);
  const embeddedCheckoutRef      = useRef<any>(null);

  const resolveIdentity = useCallback(async (email?: string, phone?: string) => {
    if (!firestore || !tenant || (!email && !phone)) return;
    setIsResolvingIdentity(true);
    try {
      const clientsRef = collection(firestore, 'tenants', tenant.id, 'clients');
      const matchPromises = [];
      if (email) matchPromises.push(getDocs(query(clientsRef, where('email', '==', email.toLowerCase().trim()))));
      if (phone) matchPromises.push(getDocs(query(clientsRef, where('phone', '==', phone))));
      const snapshots  = await Promise.all(matchPromises);
      const allDocs    = snapshots.flatMap(s => s.docs);
      if (allDocs.length > 0) {
        const clientData = allDocs[0].data() as Client;
        setMatchedClient(clientData);
        if (clientData.status === 'banned') { setBannedClient(clientData); setExistingClientWithBalance(null); }
        else if (clientData.outstandingBalance && clientData.outstandingBalance > 0) { setExistingClientWithBalance(clientData); setBannedClient(null); }
        else { setBannedClient(null); setExistingClientWithBalance(null); }
      } else { setBannedClient(null); setExistingClientWithBalance(null); setMatchedClient(null); }
    } catch (e) { console.error('Identity resolution failed', e); }
    finally { setIsResolvingIdentity(false); }
  }, [firestore, tenant]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((clientEmail && clientEmail.includes('@')) || (clientPhone && clientPhone.length > 5)) {
        resolveIdentity(clientEmail, clientPhone);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [clientEmail, clientPhone, resolveIdentity]);

  const qualifiedStaff = useMemo(() => {
    if (!service?.requiredSkills || service.requiredSkills.length === 0) return staff;
    return staff.filter(s => service.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
  }, [service, staff]);

  const availableTiersForService = useMemo(() => {
    if (!service.serviceTiers || service.serviceTiers.length === 0 || !pricingTiers) return [];
    const tiersWithStaff = new Set(qualifiedStaff.map(s => s.pricingTierId).filter(Boolean));
    return service.serviceTiers
      .filter(st => tiersWithStaff.has(st.tierId))
      .map(st => ({ ...st, name: pricingTiers.find(pt => pt.id === st.tierId)?.name || 'Tier' }));
  }, [service, qualifiedStaff, pricingTiers]);

  const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 0 }), [date]);
  const weekDays  = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);

  const activeDaySchedule = useMemo(() => {
    const dayName = format(date, 'eeee').toLowerCase();
    return publicScheduleProfile?.week?.[dayName] || null;
  }, [date, publicScheduleProfile]);

  const { timeSlots, hotSlotMap } = useMemo(() => {
    if (!service || !date || !publicScheduleProfile || !staff || !services) return { timeSlots: [], hotSlotMap: new Map() };
    const bookingInterval = publicScheduleProfile.bookingSlotInterval || 15;
    const dayName = format(date, 'eeee').toLowerCase();

    let staffMembersToCheck = selectedStaffId === 'any' ? qualifiedStaff : qualifiedStaff.filter(s => s.id === selectedStaffId);
    if (selectedStaffId === 'any' && selectedTierId !== 'any') {
      staffMembersToCheck = staffMembersToCheck.filter(s => s.pricingTierId === selectedTierId);
    }

    const options: Set<string> = new Set();
    const hSlots = new Map<string, boolean>();
    const isTightScheduling = !!tenant?.tightSchedulingEnabled;
    const isMorningAnchor   = !!tenant?.morningAnchorEnabled;
    const isFlashYield      = !!tenant?.flashYieldEnabled;

    staffMembersToCheck.forEach(staffMember => {
      let workingHours;
      const staffDaySchedule = staffMember?.availability?.week?.[dayName as keyof typeof staffMember.availability.week];
      if (staffDaySchedule?.enabled) workingHours = staffDaySchedule;
      else if (staffDaySchedule && !staffDaySchedule.enabled) return;
      else workingHours = publicScheduleProfile?.week?.[dayName];
      if (!workingHours || !workingHours.enabled) return;

      const dayStartWithBusinessHours = timeStringToDate(workingHours.start, date);
      const dayEndWithBusinessHours   = timeStringToDate(workingHours.end, date);
      const busyIntervals: { start: Date; end: Date; padBefore: number; padAfter: number }[] = [];
      const dayCancelledSlots: { start: Date; end: Date }[] = [];

      appointments.filter(apt => isSameDay(apt.startTime, date) && apt.staffId === staffMember.id).forEach(apt => {
        if (apt.status === 'cancelled') {
          if (isFlashYield) {
            const hoursSinceCancellation = differenceInHours(new Date(), safeDate(apt.startTime));
            if (Math.abs(hoursSinceCancellation) < 48) dayCancelledSlots.push({ start: safeDate(apt.startTime), end: safeDate(apt.endTime) });
          }
          return;
        }
        const aptService = services.find(s => s.id === apt.serviceId);
        busyIntervals.push({ start: apt.startTime, end: apt.endTime, padBefore: aptService?.padBefore || 0, padAfter: aptService?.padAfter || 0 });
      });

      events.filter(evt => isSameDay(evt.startTime, date) && evt.type === 'blocked' && (!evt.staffId || evt.staffId === 'all' || evt.staffId === staffMember.id)).forEach(evt => {
        busyIntervals.push({ start: evt.startTime, end: evt.endTime, padBefore: 0, padAfter: 0 });
      });

      let currentTime = dayStartWithBusinessHours;
      const now = new Date();
      if (isToday(date)) {
        const minSinceStart = (now.getHours() * 60) + now.getMinutes();
        const busStartMin   = (currentTime.getHours() * 60) + currentTime.getMinutes();
        const skip = Math.ceil((minSinceStart - busStartMin) / bookingInterval);
        if (skip > 0) currentTime = addMinutes(dayStartWithBusinessHours, skip * bookingInterval);
      }

      while (currentTime < dayEndWithBusinessHours) {
        const totalServiceDuration = service.duration + (service.padBefore || 0) + (service.padAfter || 0);
        const potentialEnd = addMinutes(currentTime, totalServiceDuration);
        if (potentialEnd > dayEndWithBusinessHours) break;

        const isOverlapping = busyIntervals.some(interval => {
          const intervalStartWithPad = subMinutes(interval.start, interval.padBefore);
          const intervalEndWithPad   = addMinutes(interval.end, interval.padAfter);
          return areIntervalsOverlapping({ start: currentTime, end: potentialEnd }, { start: intervalStartWithPad, end: intervalEndWithPad }, { inclusive: false });
        });

        const isStaffActiveForSameDay = !isToday(date) || (staffMember.active && !staffMember.onBreak);

        if (!isOverlapping && isStaffActiveForSameDay) {
          const timeStr         = format(currentTime, 'HH:mm');
          const isStartOfDaySlot = isSameDay(currentTime, dayStartWithBusinessHours) && currentTime.getTime() === dayStartWithBusinessHours.getTime();
          const isDayEmpty       = busyIntervals.length === 0;
          const isHotSlot        = dayCancelledSlots.some(cs => isSameDay(currentTime, cs.start) && format(currentTime, 'HH:mm') === format(cs.start, 'HH:mm'));

          let allowed = true;
          if (!isHotSlot) {
            if (isMorningAnchor && isDayEmpty && !isStartOfDaySlot) allowed = false;
            if (allowed && isTightScheduling && !isDayEmpty) {
              const startsAtAnotherEnd = busyIntervals.some(interval => Math.abs(differenceInMinutes(currentTime, addMinutes(interval.end, interval.padAfter))) < 1);
              const endsAtAnotherStart = busyIntervals.some(interval => Math.abs(differenceInMinutes(potentialEnd, subMinutes(interval.start, interval.padBefore))) < 1);
              if (!isStartOfDaySlot && !startsAtAnotherEnd && !endsAtAnotherStart) allowed = false;
            }
          }

          if (allowed) { options.add(timeStr); if (isHotSlot) hSlots.set(timeStr, true); }
        }
        currentTime = addMinutes(currentTime, bookingInterval);
      }
    });
    return { timeSlots: Array.from(options).sort(), hotSlotMap: hSlots };
  }, [date, selectedStaffId, selectedTierId, qualifiedStaff, service, staff, appointments, events, publicScheduleProfile, services, tenant]);

  const requiredForms = useMemo(() => {
    if (!service || !consentForms) return [];
    return consentForms.filter(form => service.requiredFormIds?.includes(form.id));
  }, [service, consentForms]);

  const { price, priceRange } = useMemo(() => {
    if (!service.serviceTiers || service.serviceTiers.length === 0) return { price: service.price, priceRange: null };
    if (selectedStaffId && selectedStaffId !== 'any') {
      const staffMember = staff.find(s => s.id === selectedStaffId);
      const tierPricing = service.serviceTiers.find(t => t.tierId === staffMember?.pricingTierId);
      if (tierPricing) return { price: tierPricing.price, priceRange: null };
    }
    if (selectedStaffId === 'any' && selectedTierId !== 'any') {
      const tierPricing = service.serviceTiers.find(t => t.tierId === selectedTierId);
      if (tierPricing) return { price: tierPricing.price, priceRange: null };
    }
    const prices   = service.serviceTiers.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice === maxPrice) return { price: minPrice, priceRange: null };
    return { price: minPrice, priceRange: { min: minPrice, max: maxPrice } };
  }, [service, selectedStaffId, selectedTierId, staff]);

  const depositAmount = useMemo(() => {
    const poorHistory = !!(matchedClient && (safeNumber(matchedClient.noShowCount) + safeNumber(matchedClient.cancellationCount)) > 2);
    const cents = computeDepositCents({
      service,
      price,
      depositsLive: !!tenant?.depositsLive,
      poorHistory,
      guardianActive: tenant?.guardianProtocolEnabled !== false,
    });
    return cents / 100;
  }, [service, price, matchedClient, tenant]);

  // ── Streamlined step flow ───────────────────────────────────────────────────
  // Deposit bookings get ONE combined review+payment screen ('checkout')
  // instead of a separate summary step followed by a separate payment step.
  const steps = useMemo(() => {
    const flow = ['staff', 'dateTime', 'details'];
    if (requiredForms.length > 0) flow.push('consents');
    flow.push(depositAmount > 0 ? 'checkout' : 'summary');
    flow.push('confirmation');
    return flow;
  }, [requiredForms.length, depositAmount]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = steps[currentStepIndex];
  const progress    = useMemo(() => ((currentStepIndex) / (steps.length - 1)) * 100, [currentStepIndex, steps.length]);

  useEffect(() => {
    if (open) {
      if (initialStaffId) { setSelectedStaffId(initialStaffId); setCurrentStepIndex(1); }
      else { setSelectedStaffId('any'); setCurrentStepIndex(0); }
      setSelectedTime(null); setSelectedTierId('any'); setDate(new Date());
      methods.reset(); setFormAnswers({});
      setBookedStaffId(null); setInspirationPhotoUrl('');
      setDepositClientSecret(null); setDepositStripeAccountId(null);
      setDepositLoading(false); setDepositError(null);
    }
  }, [open, initialStaffId, methods]);

  // ── Shared booking-payload builder ──────────────────────────────────────────
  const resolveBookingPayload = useCallback(():
    | { error: string }
    | {
        finalStaffId: string;
        clientData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string };
        signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[];
        appointmentDetails: any;
      }
    | null => {
    if (!service || !selectedTime) return null;
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
    const endDateTime   = addMinutes(startDateTime, service.duration);

    let finalStaffId = selectedStaffId;
    if (finalStaffId === 'any') {
      const available = qualifiedStaff.filter(s => {
        if (selectedTierId !== 'any' && s.pricingTierId !== selectedTierId) return false;
        if (isToday(startDateTime) && !s.active) return false;
        const day   = format(startDateTime, 'eeee').toLowerCase();
        const sched = s.availability?.week?.[day as keyof typeof s.availability.week] || publicScheduleProfile?.week?.[day];
        if (!sched?.enabled) return false;
        const openT  = timeStringToDate(sched.start, startDateTime);
        const closeT = timeStringToDate(sched.end, startDateTime);
        if (startDateTime < openT || endDateTime > closeT) return false;
        if (appointments.some(apt => apt.staffId === s.id && apt.status !== 'cancelled' && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: apt.startTime, end: apt.endTime }, { inclusive: false }))) return false;
        if (events.some(evt => evt.type === 'blocked' && (!evt.staffId || evt.staffId === 'all' || evt.staffId === s.id) && areIntervalsOverlapping({ start: startDateTime, end: endDateTime }, { start: evt.startTime, end: evt.endTime }, { inclusive: false }))) return false;
        return true;
      });
      if (available.length === 0) return { error: 'No professionals are available for this window. Please pick another time.' };
      available.sort((a, b) => (a.lastServedTimestamp ? new Date(a.lastServedTimestamp).getTime() : 0) - (b.lastServedTimestamp ? new Date(b.lastServedTimestamp).getTime() : 0));
      finalStaffId = available[0].id;
    }

    const formValues   = methods.getValues();
    const clientData   = { clientName: formValues.clientName, clientEmail: formValues.clientEmail, clientPhone: formValues.clientPhone, notes: formValues.notes };
    const signedForms  = requiredForms.map(form => ({ formId: form.id, formTitle: form.title, formData: formAnswers[form.id] || {} }));

    return {
      finalStaffId,
      clientData,
      signedForms,
      appointmentDetails: {
        serviceId: service.id, staffId: finalStaffId,
        startTime: startDateTime.toISOString(), endTime: endDateTime.toISOString(),
        status: 'confirmed', isWalkIn: false, source: 'online',
        inspirationPhotoUrl: inspirationPhotoUrl || undefined, notes: formValues.notes,
        depositAmount,
        depositStatus: depositAmount > 0 ? 'pending' : 'none',
      },
    };
  }, [service, selectedTime, date, selectedStaffId, selectedTierId, qualifiedStaff, publicScheduleProfile, appointments, events, methods, requiredForms, formAnswers, inspirationPhotoUrl, depositAmount]);

  // ── No-deposit finalize (used at the 'summary' step) ────────────────────────
  const handleConfirmBooking = () => {
    const payload = resolveBookingPayload();
    if (!payload) return;
    if ('error' in payload) { toast({ variant: 'destructive', title: 'No staff available', description: payload.error }); return; }
    setBookedStaffId(payload.finalStaffId);
    onConfirm(payload.clientData, payload.appointmentDetails, payload.signedForms, (s: string) => setCurrentStepIndex(steps.indexOf(s)));
  };

  // ── Deposit checkout init (used at the 'checkout' step) ─────────────────────
  const initiateCheckout = useCallback(async () => {
    setDepositLoading(true);
    setDepositError(null);
    const payload = resolveBookingPayload();
    if (!payload) { setDepositLoading(false); return; }
    if ('error' in payload) { setDepositError(payload.error); setDepositLoading(false); return; }
    setBookedStaffId(payload.finalStaffId);
    try {
      const result = await onConfirm(payload.clientData, payload.appointmentDetails, payload.signedForms, () => {});
      if (result && 'requiresPayment' in result && result.requiresPayment) {
        if ('clientSecret' in result && result.clientSecret) {
          setDepositClientSecret(result.clientSecret);
          setDepositStripeAccountId(result.stripeAccountId || null);
        } else if ('error' in result) {
          setDepositError(result.error);
        }
      } else {
        setCurrentStepIndex(steps.indexOf('confirmation'));
      }
    } catch (e) {
      console.error(e);
      setDepositError('Something went wrong starting checkout. Please try again.');
    } finally {
      setDepositLoading(false);
    }
  }, [resolveBookingPayload, onConfirm, steps]);

  useEffect(() => {
    if (currentStep === 'checkout' && !depositClientSecret && !depositLoading && !depositError) {
      initiateCheckout();
    }
  }, [currentStep, depositClientSecret, depositLoading, depositError, initiateCheckout]);

  useEffect(() => {
    if (!depositClientSecret || !tenant?.id) return;
    let cancelled = false;
    let instance: any;

    const mount = async () => {
      if (!(window as any).Stripe) {
        await new Promise<void>((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://js.stripe.com/v3/';
          s.onload = () => resolve();
          document.head.appendChild(s);
        });
      }
      if (cancelled) return;

      const keyRes = await fetch('/api/stripe/publishable-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const { publishableKey, stripeAccountId } = await keyRes.json();
      if (!publishableKey) throw new Error('Missing Stripe publishable key');
      if (cancelled) return;

      const stripe = (window as any).Stripe(publishableKey, {
        stripeAccount: stripeAccountId || depositStripeAccountId || undefined,
      });
      instance = await stripe.initEmbeddedCheckout({
        clientSecret: depositClientSecret,
        onComplete: () => {
          setCurrentStepIndex(steps.indexOf('confirmation'));
        },
      });
      if (cancelled) { instance.destroy(); return; }
      embeddedCheckoutRef.current = instance;
      if (embeddedMountRef.current) instance.mount(embeddedMountRef.current);
    };

    mount().catch((e) => {
      console.error('[embedded-checkout]', e);
      if (!cancelled) setDepositError('Could not load secure checkout. Please try again.');
    });

    return () => {
      cancelled = true;
      try { embeddedCheckoutRef.current?.destroy(); } catch {}
      embeddedCheckoutRef.current = null;
    };
  }, [depositClientSecret, depositStripeAccountId, tenant?.id, steps]);

  const handleNextStep = async () => {
    if (currentStep === 'dateTime' && !selectedTime) { toast({ variant: 'destructive', title: 'Please select a time.' }); return; }
    if (currentStep === 'details') {
      const valid = await methods.trigger(['clientName', 'clientEmail']);
      if (!valid) return;
      await resolveIdentity(watch('clientEmail'), watch('clientPhone'));
      if (bannedClient || existingClientWithBalance) return;
      const dayAccess = activeDaySchedule?.accessTier || 'all';
      if (dayAccess === 'members') {
        const isClientMember        = !!(matchedClient?.activeMembershipId || matchedClient?.subscription);
        const isClientPackageHolder = (matchedClient?.activePackages?.length || 0) > 0;
        if (!isClientMember && !isClientPackageHolder) { toast({ variant: 'destructive', title: 'Access Restricted', description: 'This day is reserved for Club Members and Package holders.' }); return; }
      } else if (dayAccess === 'returning') {
        if (!matchedClient) { toast({ variant: 'destructive', title: 'Priority Access Only', description: 'This day is reserved for returning guests.' }); return; }
      }
    }
    if (currentStep === 'consents') {
      const allCompleted = requiredForms.every(form => {
        const answers = formAnswers[form.id] || {};
        return (form.fields || []).every(f => {
          if (f.type === 'heading' || f.type === 'paragraph') return true;
          const ans = answers[f.id];
          return ans !== undefined && ans !== null && ans !== '';
        });
      });
      if (!allCompleted) { toast({ variant: 'destructive', title: 'Incomplete Forms', description: 'Please fill out all required fields and sign all forms.' }); return; }
    }
    if (currentStep === 'summary') { handleConfirmBooking(); return; }
    setCurrentStepIndex(currentStepIndex + 1);
  };

  const handlePrevStep = () => { if (currentStepIndex > 0) setCurrentStepIndex(currentStepIndex - 1); };

  const handleStaffSelect = (staffId: string) => {
    if (initialStaffId) return;
    setSelectedStaffId(staffId);
    if (staffId !== 'any') { setCurrentStepIndex(1); setSelectedTime(null); }
  };

  const bookedStaff   = useMemo(() => staff.find(s => s.id === bookedStaffId), [staff, bookedStaffId]);
  const selectedStaff = useMemo(() => staff.find(s => s.id === selectedStaffId), [staff, selectedStaffId]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        style={{ fontFamily: bodyFont }}
        className={cn(
          isMobile ? 'h-[100dvh] w-full rounded-none border-0' : 'sm:max-w-md border-l-0 sm:border-l',
          'flex flex-col p-0 bg-background overflow-hidden shadow-2xl'
        )}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <SheetHeader className="border-b bg-muted/5 flex-shrink-0 text-left p-5 pb-4">
          <div className="flex items-center gap-2.5 mb-1 text-left">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Booking</span>
          </div>
          <SheetTitle style={{ fontFamily: headingFont }} className="text-xl font-black uppercase tracking-tighter text-left">
            Reserve Session
          </SheetTitle>
          {currentStep !== 'confirmation' && (
            <div className="pt-4">
              <Progress value={progress} className="h-1 rounded-full bg-muted" />
            </div>
          )}
        </SheetHeader>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <ScrollArea className="flex-1 text-left">
          <div className="p-5 space-y-8 pb-24 text-left">
            <AnimatePresence mode="wait">

              {/* Confirmation */}
              {currentStep === 'confirmation' ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 space-y-7" key="confirmation">
                  <div className="w-20 h-20 bg-green-500/10 flex items-center justify-center mx-auto shadow-xl shadow-green-500/5 rotate-6" style={{ borderRadius: r3 }}>
                    <CheckCircle2 className="w-10 h-10 text-green-500 -rotate-6" />
                  </div>
                  <div className="space-y-2">
                    <h2 style={{ fontFamily: headingFont }} className="text-2xl font-black uppercase tracking-tighter">You're All Set!</h2>
                    <p className="text-muted-foreground text-sm font-medium max-w-sm mx-auto leading-relaxed">
                      Your appointment for <strong className="text-foreground">{service?.name}</strong> is confirmed. We've sent the details to your email.
                    </p>
                  </div>
                  <div className="grid gap-4 max-sm mx-auto text-left">
                    {bookedStaff && (
                      <div className="p-5 border-2 bg-card/50 backdrop-blur-sm shadow-lg flex flex-col items-center gap-3" style={{ borderRadius: r3 }}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-primary">Your Professional</p>
                        <Avatar className="w-16 h-16 border-4 border-background shadow-xl">
                          <AvatarImage src={bookedStaff.avatarUrl} className="object-cover" />
                          <AvatarFallback>{bookedStaff.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="text-center">
                          <p style={{ fontFamily: headingFont }} className="font-black text-base uppercase tracking-tight">{bookedStaff.name}</p>
                        </div>
                      </div>
                    )}
                    <div className="p-5 border-2 bg-muted/20 text-left shadow-inner space-y-3" style={{ borderRadius: r3 }}>
                      <div className="flex items-start gap-3">
                        <Calendar className="w-4 h-4 mt-0.5 text-primary opacity-40" />
                        <div className="space-y-0.5 text-left">
                          <p style={{ fontFamily: headingFont }} className="font-black uppercase text-xs">{format(date, 'EEEE, MMM d, yyyy')}</p>
                          <p className="text-xs font-bold text-primary">{selectedTime ? format(timeStringToDate(selectedTime, new Date()), 'h:mm a') : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 pt-3 border-t border-dashed">
                        <MapPin className="w-4 h-4 mt-0.5 text-primary opacity-40" />
                        <div className="space-y-0.5 text-left">
                          <p style={{ fontFamily: headingFont }} className="font-black uppercase text-xs">{tenant?.name || 'Studio'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Button style={{ borderRadius: r2 }} className="w-full h-12 text-sm font-black uppercase tracking-widest shadow-xl shadow-primary/20" variant="outline" onClick={() => onOpenChange(false)}>Finish</Button>
                </motion.div>

              ) : (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} key={currentStep} className="space-y-8">

                  {/* Active service card — compact, shown on every step except checkout (room is tight there) */}
                  {currentStep !== 'checkout' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-1.5">
                          <Zap className="w-3 h-3" />Selection
                        </h3>
                        {currentStep !== 'staff' && (
                          <Button variant="ghost" size="sm" onClick={() => setCurrentStepIndex(0)} className="h-auto p-0 text-[9px] font-black uppercase tracking-widest underline decoration-2 underline-offset-4">Change</Button>
                        )}
                      </div>
                      <Card style={{ borderRadius: r3 }} className="overflow-hidden border-2 bg-card/50 backdrop-blur-xl shadow-lg shadow-primary/5">
                        <CardContent className="p-4 flex gap-4 items-center">
                          <div className="relative w-14 h-14 overflow-hidden bg-muted shadow-inner shrink-0" style={{ borderRadius: r }}>
                            <Image src={service?.imageUrl || `https://picsum.photos/seed/${service?.id}/200/200`} alt={service?.name} fill className="object-cover" />
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p style={{ fontFamily: headingFont }} className="font-black text-base uppercase tracking-tighter leading-none mb-1.5 truncate">{service?.name}</p>
                            <div className="flex items-center gap-4">
                              <span className="text-[10px] font-bold text-muted-foreground">{service?.duration} min</span>
                              <span className="text-xs font-black text-primary">{priceRange ? `From $${priceRange.min}` : `$${price?.toFixed(2)}`}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* ── Step: Staff ──────────────────────────────────────── */}
                  {currentStep === 'staff' && (
                    <div className="space-y-6">
                      <div className="space-y-1 text-left">
                        <h3 style={{ fontFamily: headingFont }} className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                          <Users className="w-4 h-4 text-primary" />Select Provider
                        </h3>
                      </div>
                      <RadioGroup onValueChange={handleStaffSelect} value={selectedStaffId} className="grid grid-cols-3 gap-2.5">
                        <StaffSelectionCard staff={{ id: 'any', name: 'Any Available', avatarUrl: '' }} isSelected={selectedStaffId === 'any'} disabled={!!initialStaffId} r={r2} />
                        {qualifiedStaff.map(s => (
                          <StaffSelectionCard key={s.id} staff={s} isSelected={selectedStaffId === s.id} disabled={!!initialStaffId && s.id !== initialStaffId} r={r2} />
                        ))}
                      </RadioGroup>
                      {selectedStaffId === 'any' && availableTiersForService.length > 0 && (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-6 border-t border-dashed text-left">
                          <h4 style={{ fontFamily: headingFont }} className="font-black uppercase tracking-tight text-xs text-left">Tiered Preference</h4>
                          <RadioGroup value={selectedTierId} onValueChange={setSelectedTierId} className="grid grid-cols-1 gap-2">
                            <label htmlFor="tier-any" style={{ borderRadius: r2 }} className="flex items-center justify-between p-3.5 border-2 cursor-pointer transition-all hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                              <div className="flex items-center gap-2.5">
                                <RadioGroupItem value="any" id="tier-any" />
                                <span className="text-xs font-black uppercase tracking-tight">First Available</span>
                              </div>
                            </label>
                            {availableTiersForService.map(tier => (
                              <label key={tier.tierId} htmlFor={`tier-${tier.tierId}`} style={{ borderRadius: r2 }} className="flex items-center justify-between p-3.5 border-2 cursor-pointer transition-all hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                <div className="flex items-center gap-2.5">
                                  <RadioGroupItem value={tier.tierId} id={`tier-${tier.tierId}`} />
                                  <span className="text-xs font-black uppercase tracking-tight">{tier.name}</span>
                                </div>
                                <span className="font-black text-primary text-sm tracking-tighter">${tier.price.toFixed(2)}</span>
                              </label>
                            ))}
                          </RadioGroup>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* ── Step: Date & Time ────────────────────────────────── */}
                  {currentStep === 'dateTime' && (
                    <div className="space-y-6 text-left">
                      <h3 style={{ fontFamily: headingFont }} className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-primary" />Timing
                      </h3>
                      {activeDaySchedule?.accessTier && activeDaySchedule.accessTier !== 'all' && (
                        <Alert style={{ borderRadius: r2 }} className="bg-indigo-50 border-indigo-200 p-4 border-2 shadow-sm text-left">
                          <Award className="h-4 w-4 text-indigo-600" />
                          <AlertTitle className="text-xs font-black uppercase tracking-tight mb-1 text-indigo-700">Priority Access Only</AlertTitle>
                          <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left text-indigo-600">
                            Reserved for {activeDaySchedule.accessTier === 'members' ? 'Members & Package Holders' : 'Returning Guests'}.
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="p-5 border-2 bg-muted/10 space-y-6 shadow-inner text-center" style={{ borderRadius: r3 }}>
                        <div className="flex items-center justify-between">
                          <Button variant="outline" size="icon" className="h-8 w-8 rounded-full bg-background shadow-sm border-none" onClick={() => setDate(prev => addDays(prev, -7))}>
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span style={{ fontFamily: headingFont }} className="font-black uppercase tracking-widest text-xs">{format(weekStart, 'MMMM yyyy')}</span>
                          <Button variant="outline" size="icon" className="h-8 w-8 rounded-full bg-background shadow-sm border-none" onClick={() => setDate(prev => addDays(prev, 7))}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {weekDays.map(day => (
                            <button
                              key={day.toString()}
                              onClick={() => setDate(day)}
                              disabled={isBefore(day, startOfDay(new Date())) && !isToday(day)}
                              style={{ borderRadius: r }}
                              className={cn(
                                'flex flex-col items-center justify-center p-2 border-2 transition-all aspect-square',
                                isSameDay(day, date) ? 'bg-primary text-primary-foreground border-primary shadow-lg scale-105' : 'bg-background border-transparent hover:border-primary/30',
                                (isBefore(day, startOfDay(new Date())) && !isToday(day)) && 'opacity-20 cursor-not-allowed'
                              )}
                              type="button"
                            >
                              <span className="text-[8px] uppercase font-black opacity-60 mb-0.5">{format(day, 'EEE')}</span>
                              <span className="font-black text-sm tracking-tighter">{format(day, 'd')}</span>
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-2 pt-6 border-t border-dashed">
                          {timeSlots.map(time => {
                            const isHotSlot = hotSlotMap.get(time);
                            return (
                              <Button
                                key={time}
                                variant={selectedTime === time ? 'default' : 'outline'}
                                onClick={() => setSelectedTime(time)}
                                style={{ borderRadius: r }}
                                className={cn(
                                  'h-11 font-black uppercase text-[10px] tracking-widest border-2 transition-all relative overflow-hidden',
                                  selectedTime === time ? 'shadow-lg shadow-primary/20' : 'bg-background',
                                  isHotSlot && 'border-amber-500/50 bg-amber-500/5 text-amber-700'
                                )}
                              >
                                {isHotSlot && <div className="absolute top-0 right-0 p-0.5 bg-amber-500 rounded-bl-md shadow-sm"><Flame className="w-2 h-2 text-white" /></div>}
                                {format(timeStringToDate(time, new Date()), 'h:mm a')}
                              </Button>
                            );
                          })}
                          {timeSlots.length === 0 && (
                            <div style={{ borderRadius: r2 }} className="col-span-full text-center py-8 px-4 border-2 border-dashed">
                              <Clock className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1.5" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">No availability for this preference</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Step: Details ────────────────────────────────────── */}
                  {currentStep === 'details' && (
                    <FormProvider {...methods}>
                      <form id="booking-details-form" onSubmit={handleSubmit(handleNextStep)} className="space-y-7 text-left">
                        <h3 style={{ fontFamily: headingFont }} className="text-base font-black uppercase tracking-tight flex items-center gap-2 text-left">
                          <User className="w-4 h-4 text-primary" />Guest Profile
                        </h3>
                        <div className="space-y-4 text-left">
                          <div className="space-y-2">
                            <Label htmlFor="name" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Full Name</Label>
                            <Input id="name" {...methods.register('clientName')} style={{ borderRadius: r2 }} className="h-11 border-2 font-bold shadow-inner" placeholder="Enter your full name" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="email" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Email</Label>
                            <Input id="email" type="email" {...methods.register('clientEmail')} style={{ borderRadius: r2 }} className="h-11 border-2 font-bold shadow-inner" placeholder="jane@example.com" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mobile</Label>
                            <PhoneInput name="clientPhone" label="" className="h-11 kiosk-phone-input" />
                          </div>
                          <div className="space-y-2 pt-3 border-t border-dashed">
                            <Label htmlFor="booking-notes" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
                              <MessageSquare className="w-3 h-3 opacity-40" />Notes (optional)
                            </Label>
                            <Textarea id="booking-notes" {...methods.register('notes')} style={{ borderRadius: r2 }} className="border-2 bg-muted/5 min-h-[72px] p-3 text-sm font-medium leading-relaxed" placeholder="Any specific requests..." />
                          </div>
                        </div>
                        <div className="space-y-2 pt-3 border-t border-dashed text-left">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
                            <FileImage className="w-3 h-3 opacity-40" />Inspiration photo (optional)
                          </Label>
                          <ImageUpload onImageUploaded={setInspirationPhotoUrl} initialImage={inspirationPhotoUrl} />
                        </div>
                        <AnimatePresence>
                          {isResolvingIdentity && (
                            <motion.div key="resolving" className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-primary animate-pulse">
                              <Loader className="w-3 h-3 animate-spin" /> Verifying...
                            </motion.div>
                          )}
                          {bannedClient && (
                            <motion.div key="banned" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                              <Alert variant="destructive" style={{ borderRadius: r2 }} className="bg-destructive/10 border-destructive shadow-lg border-4 p-4 text-left">
                                <Ban className="h-5 w-5" />
                                <AlertTitle className="text-xs font-black uppercase tracking-tight mb-1">Check-in Restricted</AlertTitle>
                                <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left">
                                  {bannedClient.banMessage || 'Your account is currently restricted. Please see the front desk.'}
                                </AlertDescription>
                              </Alert>
                            </motion.div>
                          )}
                          {existingClientWithBalance && !bannedClient && (
                            <motion.div key="balance" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                              <Alert variant="destructive" style={{ borderRadius: r2 }} className="bg-destructive/5 border-destructive/20 border-2 p-4 shadow-lg text-left">
                                <Wallet className="h-5 w-5" />
                                <AlertTitle className="text-xs font-black uppercase tracking-tight mb-1">Balance Detected</AlertTitle>
                                <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 uppercase text-left">
                                  Account balance of <strong>${existingClientWithBalance.outstandingBalance?.toFixed(2)}</strong> found. Please settle at the desk.
                                </AlertDescription>
                              </Alert>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </form>
                    </FormProvider>
                  )}

                  {/* ── Step: Consents ───────────────────────────────────── */}
                  {currentStep === 'consents' && (
                    <div className="space-y-7 text-left">
                      <h3 style={{ fontFamily: headingFont }} className="text-base font-black uppercase tracking-tight flex items-center gap-2 text-left">
                        <FileSignature className="w-4 h-4 text-primary" />Agreements
                      </h3>
                      <div className="space-y-8">
                        {requiredForms.map(form => (
                          <div key={form.id} style={{ borderRadius: r3 }} className="space-y-6 p-6 border-2 border-card/50 bg-card/60 backdrop-blur-2xl shadow-xl">
                            <div style={{ fontFamily: headingFont }} className="flex items-center gap-3 text-lg font-black uppercase tracking-tighter pb-3 border-b border-dashed">
                              <ListChecks className="w-5 h-5 text-primary" />{form.title}
                            </div>
                            <div className="space-y-7">
                              {form.fields?.map(field => (
                                <FormFieldRenderer
                                  key={field.id}
                                  field={field}
                                  value={formAnswers[form.id]?.[field.id]}
                                  onChange={(val) => setFormAnswers(prev => ({ ...prev, [form.id]: { ...(prev[form.id] || {}), [field.id]: val } }))}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Step: Summary (no-deposit path only) ─────────────── */}
                  {currentStep === 'summary' && (
                    <div className="space-y-6 text-left">
                      <h3 style={{ fontFamily: headingFont }} className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-primary" />Review
                      </h3>
                      <Card style={{ borderRadius: r3 }} className="bg-primary/5 border-primary/20 overflow-hidden shadow-xl border-2">
                        <CardContent className="p-6 space-y-4 text-left">
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Professional</span>
                            <span style={{ fontFamily: headingFont }} className="font-black text-xs uppercase tracking-tight truncate">{selectedStaffId === 'any' ? 'First Available' : selectedStaff?.name}</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Schedule</span>
                            <span style={{ fontFamily: headingFont }} className="font-black text-xs uppercase tracking-tight truncate">{format(date, 'MMM d, yyyy')} · {selectedTime ? format(timeStringToDate(selectedTime, new Date()), 'h:mm a') : ''}</span>
                          </div>
                          <Separator className="bg-primary/10 border-dashed" />
                          <div className="flex justify-between items-center text-xl font-black uppercase tracking-tighter text-left">
                            <span style={{ fontFamily: headingFont }}>Total</span>
                            <span style={{ fontFamily: headingFont }}>${price?.toFixed(2)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* ── Step: Checkout (deposit required — review + embedded payment combined) ── */}
                  {currentStep === 'checkout' && (
                    <div className="space-y-5 text-left">
                      <h3 style={{ fontFamily: headingFont }} className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-primary" />Secure Your Spot
                      </h3>

                      <Card style={{ borderRadius: r3 }} className="bg-primary/5 border-primary/20 overflow-hidden shadow-lg border-2">
                        <CardContent className="p-5 space-y-3 text-left">
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Schedule</span>
                            <span style={{ fontFamily: headingFont }} className="font-black text-[11px] uppercase tracking-tight truncate">{format(date, 'MMM d, yyyy')} · {selectedTime ? format(timeStringToDate(selectedTime, new Date()), 'h:mm a') : ''}</span>
                          </div>
                          <Separator className="bg-primary/10 border-dashed" />
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Deposit Due Today</span>
                            <span style={{ fontFamily: headingFont }} className="text-2xl font-black text-primary tracking-tighter">${depositAmount.toFixed(2)}</span>
                          </div>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60">Applied to your final total at checkout</p>
                        </CardContent>
                      </Card>

                      {depositError ? (
                        <Alert variant="destructive" style={{ borderRadius: r2 }} className="p-5 border-2">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle className="text-xs font-black uppercase tracking-tight mb-1">Couldn't start checkout</AlertTitle>
                          <AlertDescription className="text-[10px] font-bold leading-relaxed opacity-80 mb-3">{depositError}</AlertDescription>
                          <Button onClick={initiateCheckout} disabled={depositLoading} size="sm" className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest">
                            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', depositLoading && 'animate-spin')} /> Try Again
                          </Button>
                        </Alert>
                      ) : (
                        <div className="rounded-2xl border-2 bg-white shadow-inner overflow-hidden relative" style={{ minHeight: 320 }}>
                          {(depositLoading || !depositClientSecret) && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-white z-10">
                              <Loader className="w-5 h-5 animate-spin text-primary" />
                              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Preparing secure checkout…</p>
                            </div>
                          )}
                          <div ref={embeddedMountRef} />
                        </div>
                      )}

                      <div className="flex items-center gap-2.5 p-3 bg-muted/20 text-[10px] text-muted-foreground font-medium italic rounded-xl">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        Payments are processed securely by Stripe. Card details are never stored on our servers.
                      </div>
                    </div>
                  )}

                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        {currentStep !== 'confirmation' && currentStep !== 'checkout' && (
          <SheetFooter className="p-4 border-t bg-background/80 backdrop-blur-xl flex-shrink-0 z-20 shadow-xl">
            <div className="flex w-full gap-3">
              {currentStepIndex > 0 && (
                <Button
                  variant="ghost"
                  onClick={handlePrevStep}
                  style={{ borderRadius: r3 }}
                  className="flex-1 h-12 font-black uppercase tracking-tighter text-[10px] text-muted-foreground"
                >
                  Back
                </Button>
              )}
              <Button
                onClick={handleNextStep}
                disabled={currentStep === 'details' && (!!existingClientWithBalance || !!bannedClient || isResolvingIdentity)}
                style={{ borderRadius: r3, fontFamily: headingFont }}
                className={cn(
                  'h-12 font-black uppercase tracking-widest text-[11px] shadow-xl shadow-primary/30 group transition-all',
                  currentStepIndex === 0 ? 'w-full' : 'flex-[2.5]'
                )}
              >
                {currentStep === 'summary' ? 'Finalize Booking' : 'Continue'}
                <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </SheetFooter>
        )}

        {currentStep === 'checkout' && (
          <SheetFooter className="p-4 border-t bg-background/80 backdrop-blur-xl flex-shrink-0 z-20 shadow-xl">
            <Button
              variant="ghost"
              onClick={handlePrevStep}
              style={{ borderRadius: r3 }}
              className="w-full h-11 font-black uppercase tracking-tighter text-[10px] text-muted-foreground"
            >
              ← Back to Details
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};