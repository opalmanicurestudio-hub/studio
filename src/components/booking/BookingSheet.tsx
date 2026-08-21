'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, Award, Ban, Calendar, CalendarCheck, Check, CheckCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, CreditCard, FileImage, FileSignature, Fingerprint, Flame, Info, ListChecks, Loader, Lock, Mail, MapPin, MessageSquare, Phone, RefreshCw, ShieldCheck, Sparkles, Star, User, Users, Wallet, X as XIcon, Zap } from 'lucide-react';
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
import { Checkbox } from '../ui/checkbox';
import { useSmartAvailability } from '@/hooks/useSmartAvailability';
import { pickStaffForSlot } from '@/lib/availability';
import { resolveBookingPlan } from '@/lib/deposit-policy';

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
  // Deliberately left unrefined. `methods.trigger([...])` in handleNextStep
  // validates named fields only and would never run a schema-level .refine(),
  // so the consent/phone pairing rule is enforced there instead.
  smsConsent:  z.boolean().optional(),
});
type BookingFormData = z.infer<typeof bookingSchema>;

// The exact wording that is shown to the guest AND stored on the appointment.
// Defined once so the record of what they agreed to can never drift from what
// they actually read on screen.
export const smsConsentWording = (studioName?: string | null) =>
  `I agree to receive appointment reminders and confirmations by text from ${studioName || 'this studio'} at the mobile number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not required to book.`;

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
  /**
   * The studio's MARKETING events, rendered on the public page. This is NOT
   * calendar occupancy — pass that as `calendarEvents` below.
   */
  events:         Event[];
  scheduleProfiles: any[];
  services:       Service[];
  consentForms:   ConsentForm[];
  tenant:         Tenant | null;
  /**
   * Availability context. All optional: omit one and that constraint simply
   * isn't applied, so an older caller or a preview still works. But every one
   * of these IS enforced by the booking route, so a caller that leaves them
   * out will offer times the server then refuses.
   */
  shifts?:          any[];
  staffBlocks?:     any[];
  dayOffBlocks?:    any[];
  resources?:       any[];
  tickets?:         any[];
  maintenancePlans?: any[];
  /** Real calendar occupancy — what the engine treats as `events`. */
  calendarEvents?:  any[];
  /** What the SERVER made of the booking. Absent = an older caller, in
   *  which case the sheet keeps its original confirmed wording. */
  bookingOutcome?: { status: string; notice: string; depositCents: number } | null;
  /** 'page' renders the flow as an ordinary page instead of a floating panel.
   *
   * Every mobile failure this component had came from being a floating box:
   * fixed positioning defeated by transformed ancestors, heights computed
   * against a viewport that changes as the URL bar collapses, a footer that
   * had to be kept on screen by arithmetic. A page has none of those
   * problems, because the browser is already very good at laying out pages.
   * Sticky bars in normal document flow simply work. */
  variant?: 'overlay' | 'page';
  onConfirm: (
    formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'> & { depositAmount?: number; depositStatus?: string },
    signedForms: { formId: string; formTitle: string; formData: Record<string, any> }[],
    setBookingStep: (step: string) => void
  ) => Promise<ConfirmResult> | void;
}

// ─── Component ────────────────────────────────────────────────────────────────
/* Step names the client would use, not the ones the code uses. "dateTime" is
 * a variable; "Pick a time" is what the person is doing. The header shows this
 * so someone who put their phone down mid-booking knows where they are. */
const STEP_TITLES: Record<string, string> = {
  staff: 'Choose who',
  dateTime: 'Pick a time',
  details: 'Your details',
  consents: 'Before we start',
  checkout: 'Pay your deposit',
  summary: 'Check and confirm',
  confirmation: 'Done',
};

export const BookingSheet: React.FC<BookingSheetProps> = ({
  open, onOpenChange, service, staff, pricingTiers, initialStaffId,
  appointments, events, scheduleProfiles, services, consentForms, tenant, onConfirm,
  shifts, staffBlocks, dayOffBlocks, resources, tickets, maintenancePlans, calendarEvents,
  bookingOutcome,
  variant = 'overlay',
}) => {
  const asPage = variant === 'page';
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

  const dateKey = useMemo(() => format(date, 'yyyy-MM-dd'), [date]);

  // Slot generation runs through the SAME engine the booking route uses to
  // verify. This replaces a hand-rolled scan that knew about staff hours,
  // appointments and 'blocked' events only — it had no idea about the
  // published shift roster, approved days off, chair capacity, urgent
  // maintenance or staff holds, all of which the route enforces. That gap is
  // why guests could tap a time and get refused.
  const availability = useSmartAvailability({
    date: dateKey,
    serviceId: service?.id || '',
    staffId: selectedStaffId,
    tierId: selectedStaffId === 'any' && selectedTierId !== 'any' ? selectedTierId : undefined,
    allAppointments: appointments || [],
    allServices: services || [],
    allStaff: qualifiedStaff,
    // The engine's `events` means calendar occupancy. `events` on this
    // component is the studio's MARKETING events shown on the page, which is a
    // different thing entirely — passing those would be meaningless at best.
    events: calendarEvents || [],
    scheduleProfiles,
    tenant,
    shifts, staffBlocks, dayOffBlocks, resources, tickets, maintenancePlans,
    // Deliberately NOT set: ignoreHeuristics, ignoreShifts, ignoreResources.
    // Those are front-desk overrides. A guest booking themselves gets the
    // studio's real rules, including lead time from the tenant doc.
  });

  const timeSlots = availability.times;

  const hotSlotMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const t of availability.hotTimes) m.set(t, true);
    return m;
  }, [availability.hotTimes]);

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

  /**
   * A DEPOSIT EXISTING IS NOT THE SAME AS A DEPOSIT BEING DUE NOW.
   *
   * This used to route into checkout whenever the service had a deposit, which
   * is right for a shop taking money at booking and wrong for every other
   * timing. In approval mode the plan says chargeTiming: 'on_approval' — the
   * deposit is taken WHEN THE STUDIO ACCEPTS — and the client was charged at
   * booking anyway. They paid for an appointment the studio had not yet agreed
   * to, and would have had to be refunded if it were declined.
   *
   * The plan decides now. Money is collected here only when the plan says
   * at_booking; on_approval and on_penalty book without payment, and the
   * decide route charges the card or sends a pay link at the moment it
   * becomes real.
   */
  const chargeDueNow = useMemo(() => {
    if (depositAmount <= 0) return false;
    /* No plan resolvable (a service or tenant we could not read) → fall back
     * to the old behaviour rather than silently skipping a payment the shop
     * expects. */
    if (!tenant || !service) return true;
    try {
      return resolveBookingPlan({ tenant, service, price: price || 0 } as any).chargeTiming === 'at_booking';
    } catch {
      return true;
    }
  }, [depositAmount, tenant, service, price]);

  /**
   * A CARD IS REQUIRED, SO IT IS COLLECTED — not stamped and hoped for.
   *
   * requireCardOnFile used to write requiresCardOnFile onto the appointment
   * and collect nothing. A card only ever arrived as a side effect of paying
   * a deposit, so the two timings that take no money at booking produced
   * bookings with no card at all, and accepting one could only send a pay
   * link. When the shop says a card is required, the flow now asks for one —
   * in setup mode, so the issuer authorises it and nothing is charged.
   *
   * Never both screens: paying already vaults the card.
   */
  const cardSetupDueNow = useMemo(() => {
    if (chargeDueNow) return false;
    if (!tenant || !service) return false;
    try {
      return resolveBookingPlan({ tenant, service, price: price || 0 } as any).requiresCardOnFile === true;
    } catch {
      return false;
    }
  }, [chargeDueNow, tenant, service, price]);

  const steps = useMemo(() => {
    const flow = ['staff', 'dateTime', 'details'];
    if (requiredForms.length > 0) flow.push('consents');
    flow.push(chargeDueNow || cardSetupDueNow ? 'checkout' : 'summary');
    flow.push('confirmation');
    return flow;
  }, [requiredForms.length, chargeDueNow, cardSetupDueNow]);

  /* The pinned bars are measured rather than estimated. Their height changes
   * with the safe-area inset, the step rail, and how long the service name
   * wraps — a hardcoded padding would be wrong on some phones and clip the
   * first or last control. ResizeObserver keeps the body's clearance exact. */
  const headerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* Portalling needs document, which does not exist during SSR. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = steps[currentStepIndex];

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const sync = () => {
      panel.style.setProperty('--sheet-header-h', `${headerRef.current?.offsetHeight ?? 108}px`);
      panel.style.setProperty('--sheet-footer-h', `${footerRef.current?.offsetHeight ?? 104}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (headerRef.current) ro.observe(headerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    window.addEventListener('resize', sync);
    return () => { ro.disconnect(); window.removeEventListener('resize', sync); };
  }, [open, currentStep, steps.length]);
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
      // The engine's rotation, not a local sort. The old code here ordered by
      // `lastServedTimestamp` — a field nothing in the codebase ever writes —
      // so every candidate compared equal and 'Any Available' silently handed
      // every online booking to whoever happened to be first in the array.
      const pick = pickStaffForSlot({
        date: dateKey,
        time: selectedTime,
        serviceId: service.id,
        staffId: 'any',
        tierId: selectedTierId !== 'any' ? selectedTierId : undefined,
        services: services || [],
        staff: qualifiedStaff,
        appointments: appointments || [],
        events: calendarEvents || [],
        scheduleProfiles,
        tenant,
        shifts, staffBlocks, dayOffBlocks, resources, tickets, maintenancePlans,
      });
      if (!pick.ok) {
        return { error: pick.error || 'No professionals are available for this window. Please pick another time.' };
      }
      finalStaffId = pick.staffId;
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
        depositStatus: chargeDueNow ? 'pending' : 'none',
        // Written-out proof of consent. Storing the wording alongside the flag
        // is the part that actually matters if the carrier ever asks how the
        // number was collected.
        smsConsent:       !!formValues.smsConsent,
        smsConsentAt:     formValues.smsConsent ? new Date().toISOString() : undefined,
        smsConsentSource: formValues.smsConsent ? 'public_booking_sheet' : undefined,
        smsConsentText:   formValues.smsConsent ? smsConsentWording(tenant?.name) : undefined,
      },
    };
  }, [service, selectedTime, dateKey, date, selectedStaffId, selectedTierId, qualifiedStaff, services, appointments, calendarEvents, scheduleProfiles, tenant, shifts, staffBlocks, dayOffBlocks, resources, tickets, maintenancePlans, methods, requiredForms, formAnswers, inspirationPhotoUrl, depositAmount]);

  /**
   * WHAT PRESSING THE BUTTON WILL ACTUALLY DO.
   *
   * The same resolver the booking route runs, run here so the client is told
   * before they commit rather than after. Until this existed the flow asked
   * for a decision and only explained it on the confirmation screen — a shop
   * requiring a card on file collected the slot first and mentioned the card
   * afterwards, which is exactly the order that produces a dead card and an
   * argument.
   *
   * The client record is unknown at this point on a public booking, and the
   * only thing it can change is to make the plan STRICTER (a poor history
   * forces the deposit up front). So this can under-promise and never
   * over-promise, and the server's own notice still shows at the end.
   */
  const bookingPreview = useMemo(() => {
    if (!tenant || !service) return null;
    try {
      return resolveBookingPlan({ tenant, service, price: price || 0 } as any);
    } catch {
      return null;
    }
  }, [tenant, service, price]);

  const previewLines = useMemo(() => {
    if (!bookingPreview) return [] as string[];
    const out: string[] = [];
    const money = `$${(Number(bookingPreview.depositCents || 0) / 100).toFixed(2)}`;

    if (bookingPreview.status === 'requested') {
      out.push('This sends a request. The studio confirms before it is booked.');
    }
    if (Number(bookingPreview.depositCents || 0) > 0) {
      if (bookingPreview.chargeTiming === 'at_booking') {
        out.push(`${money} is taken now and comes off your final total.`);
      } else if (bookingPreview.chargeTiming === 'on_approval') {
        out.push(`${money} is taken only once the studio accepts.`);
      } else if (bookingPreview.chargeTiming === 'on_penalty') {
        out.push(`Nothing is taken now. ${money} only applies if you no-show or cancel late.`);
      }
    }
    if (bookingPreview.requiresCardOnFile) {
      out.push('A card is kept on file. You will add it right after booking — nothing is charged to it today.');
    }
    return out;
  }, [bookingPreview]);

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
      // Consent without a number to text is a dead record — and worse, it looks
      // like permission the studio does not actually have.
      const consentPhone = (watch('clientPhone') || '').replace(/\D/g, '');
      if (watch('smsConsent') && consentPhone.length < 10) {
        toast({
          variant: 'destructive',
          title: 'Mobile number needed',
          description: 'Add the mobile number you want texts sent to, or uncheck text reminders.',
        });
        return;
      }
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

  /* ── ONE CHROME, TWO SHELLS ───────────────────────────────────────────────
   * The header, body and action bar are written once. Where they live is the
   * only difference between the two variants:
   *
   *   page     ordinary document flow. Sticky bars, browser-managed
   *            scrolling, nothing fixed, no portal, no height arithmetic.
   *            Immune to transformed ancestors and to the iOS URL bar.
   *   overlay  the floating panel, portalled to <body> so `fixed` is
   *            viewport-relative rather than trapped inside an animated
   *            section.
   *
   * Page mode exists because every mobile failure this flow had came from
   * being a floating box on a phone. A page is what phones are for. */
  /* ── WHY THIS IS A FUNCTION AND NOT A COMPONENT ───────────────────────────
   * This was `const Shell: React.FC = ({children}) => ...`, declared inside
   * the render body. A component defined during render is a BRAND NEW
   * component type on every render, so React cannot match it to the previous
   * tree — it unmounts everything inside and mounts it again. In a form, that
   * means the focused input is destroyed and recreated after every keystroke,
   * which is felt as being able to type only one character at a time.
   *
   * A plain function that returns elements has no such identity: the elements
   * it returns are reconciled normally, and the inputs keep their focus. */
  const wrapInShell = (children: React.ReactNode) => {
    if (asPage) {
      return (
        <div
          ref={panelRef}
          style={{
            fontFamily: bodyFont,
            backgroundColor: 'hsl(var(--background, 240 6% 97%))',
            color: 'hsl(var(--foreground, 240 10% 4%))',
          }}
          className="min-h-[100dvh] w-full"
        >
          {children}
        </div>
      );
    }
    return createPortal(
      <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Book an appointment">
        <div className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} aria-hidden="true" />
        <div
          ref={panelRef}
          style={{
            fontFamily: bodyFont,
            backgroundColor: 'hsl(var(--background, 240 6% 97%))',
            color: 'hsl(var(--foreground, 240 10% 4%))',
          }}
          className="absolute top-0 bottom-0 left-0 right-0 sm:left-auto sm:w-full sm:max-w-md sm:border-l sm:shadow-2xl overflow-hidden"
        >
          {children}
        </div>
      </div>,
      document.body,
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    /* ── NO MODAL PRIMITIVE ───────────────────────────────────────────────
     * This was a Radix Sheet. Three separate attempts to make it behave on a
     * phone failed, and each failure came from the primitive rather than from
     * this component: a `side` variant chosen by a JS hook that is undefined
     * on first render, a bottom variant shipping no height, `inset-x-0
     * bottom-0` fighting whatever height we set, a transform-based slide
     * animation, and a portal whose stacking we do not control.
     *
     * None of that machinery earns its place here. A booking panel is a fixed
     * box pinned to four edges with a scrolling middle. So that is what this
     * is now — one div, no variants, no portal, no transform. There is
     * nothing left to be undefined on first render and nothing to fight over
     * the height.
     *
     * Everything inside is unchanged; only the container is different. */
    !open || (!asPage && !mounted) ? null : (
    wrapInShell(<>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          ref={headerRef}
          className={cn(
            'z-20 border-b bg-background/95 backdrop-blur-xl text-left px-4 pb-3',
            // Sticky in a page, pinned in a panel. Sticky needs no measuring.
            asPage ? 'sticky top-0' : 'absolute top-0 left-0 right-0',
          )}
          style={{ paddingTop: 'max(0.875rem, env(safe-area-inset-top))' }}
        >
          {/* Back lives up here, not in the footer. It is a secondary action
              and it was competing with the primary one for the only reachable
              row on the screen. Moving it frees the footer for a single
              full-width target. */}
          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && currentStep !== 'confirmation' ? (
              <button
                type="button"
                onClick={handlePrevStep}
                aria-label="Go back a step"
                className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:scale-95"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <span className="w-1" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                {service?.name || 'Booking'}
              </p>
              <h2 style={{ fontFamily: headingFont }} className="truncate text-base font-black uppercase tracking-tighter leading-tight">
                {STEP_TITLES[currentStep] || 'Book'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close booking"
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:scale-95"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {/* A rail of segments rather than a percentage bar: a percentage
              tells you how far along you are, a rail tells you how much is
              left and what it is called. Only shown while there are steps
              left to take. */}
          {currentStep !== 'confirmation' && (
            <div className="mt-2.5 flex items-center gap-1.5" aria-hidden="true">
              {steps.slice(0, -1).map((st, i) => (
                <span
                  key={st}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors duration-300',
                    i < currentStepIndex ? 'bg-primary'
                      : i === currentStepIndex ? 'bg-primary/50'
                        : 'bg-muted'
                  )}
                />
              ))}
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            Step {currentStepIndex + 1} of {steps.length - 1}: {STEP_TITLES[currentStep]}
          </p>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────
         * Absolutely filling the panel and scrolling itself. The generous
         * bottom padding is not decoration: it guarantees the last control in
         * any step can be scrolled clear of the pinned footer, so nothing is
         * ever hidden behind the button that acts on it.
         *
         * A plain div rather than ScrollArea — the custom scroller adds a
         * wrapper whose height it wants to compute, and computed heights are
         * exactly what kept breaking this panel. Native overflow needs no
         * measurement and gets momentum scrolling on iOS for free. */}
        <div
          className={cn(
            'text-left',
            asPage
              // Page: just content. The browser scrolls the document; there
              // is nothing to size and nothing to keep in view by hand.
              ? ''
              : 'absolute inset-0 overflow-y-auto overscroll-contain',
          )}
          style={asPage ? undefined : ({ paddingTop: 'var(--sheet-header-h, 7.5rem)', paddingBottom: 'var(--sheet-footer-h, 6.5rem)', WebkitOverflowScrolling: 'touch' } as React.CSSProperties)}
        >
          <div className="px-4 pt-2 pb-2 space-y-5 text-left">
            {/* ── NO EXIT ANIMATION BETWEEN STEPS ────────────────────────
             * This was <AnimatePresence mode="wait">. That mode holds the
             * NEW step off the screen until the OLD one has finished exiting,
             * so any interruption — a step changed programmatically, a
             * re-render mid-exit, a device that throttles animation — leaves
             * the body showing nothing at all while the header and footer
             * carry on as normal. A blank panel with a working button is
             * exactly that failure.
             *
             * The fade was worth very little and could cost the whole screen.
             * Steps now swap instantly; each still fades IN on mount, which
             * needs no coordination and cannot strand the view. */}
            <React.Fragment>

              {/* Confirmation */}
              {currentStep === 'confirmation' ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 space-y-7" key="confirmation">
                  <div className="w-20 h-20 bg-green-500/10 flex items-center justify-center mx-auto shadow-xl shadow-green-500/5 rotate-6" style={{ borderRadius: r3 }}>
                    <CheckCircle2 className="w-10 h-10 text-green-500 -rotate-6" />
                  </div>
                  <div className="space-y-2">
                    {/* THE SCREEN MUST MATCH WHAT THE SERVER WROTE. A shop in
                        approval mode has not booked anything yet, and telling
                        the client "you're all set" would be the single most
                        damaging lie in the whole flow. */}
                    <h2 style={{ fontFamily: headingFont }} className="text-2xl font-black uppercase tracking-tighter">
                      {bookingOutcome?.status === 'requested' ? 'Request Sent'
                        : bookingOutcome?.status === 'pending_payment' ? 'Almost There'
                          : "You're All Set!"}
                    </h2>
                    <p className="text-muted-foreground text-sm font-medium max-w-sm mx-auto leading-relaxed">
                      {bookingOutcome?.status === 'requested'
                        ? <>Your request for <strong className="text-foreground">{service?.name}</strong> is with the studio. It is not booked yet — you will hear back shortly.</>
                        : bookingOutcome?.status === 'pending_payment'
                          ? <>Your time for <strong className="text-foreground">{service?.name}</strong> is held. Check your email to finish and lock it in.</>
                          : <>Your appointment for <strong className="text-foreground">{service?.name}</strong> is confirmed. We&apos;ve sent the details to your email.</>}
                    </p>
                    {bookingOutcome?.notice && (
                      <p className="mx-auto max-w-sm rounded-2xl border-2 border-dashed px-3 py-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
                        {bookingOutcome.notice}
                      </p>
                    )}
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
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={currentStep} className="space-y-8">

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
                                /* Choosing a time IS the decision — the extra
                                 * Continue tap afterwards added nothing, and
                                 * on a small screen where the button sits far
                                 * from the slot you just tapped it reads as
                                 * "nothing happened". The brief pause lets the
                                 * selected state register before the step
                                 * changes, so the tap still feels acknowledged
                                 * rather than teleporting you. */
                                onClick={() => {
                                  setSelectedTime(time);
                                  window.setTimeout(() => {
                                    setCurrentStepIndex((i) => Math.min(i + 1, steps.length - 1));
                                  }, 180);
                                }}
                                style={{ borderRadius: r }}
                                className={cn(
                                  'h-12 font-black uppercase text-[10px] tracking-widest border-2 transition-all relative overflow-hidden active:scale-95',
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
                          <Controller
                            name="smsConsent"
                            control={methods.control}
                            render={({ field }) => (
                              <div style={{ borderRadius: r2 }} className="flex items-start gap-3 border-2 border-dashed bg-muted/5 p-3">
                                <Checkbox
                                  id="sms-consent"
                                  checked={!!field.value}
                                  onCheckedChange={v => field.onChange(v === true)}
                                  className="mt-0.5 shrink-0"
                                />
                                <Label htmlFor="sms-consent" className="cursor-pointer text-[11px] font-medium leading-relaxed text-muted-foreground">
                                  {smsConsentWording(tenant?.name)}
                                </Label>
                              </div>
                            )}
                          />
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
                          <ImageUpload onImageUploaded={setInspirationPhotoUrl} initialImage={inspirationPhotoUrl} tenantId={tenant?.id} storageFolder="booking-inspiration" />
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

                      {previewLines.length > 0 && (
                        <div style={{ borderRadius: r2 }} className="border-2 border-dashed p-4 space-y-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">What happens next</p>
                          {previewLines.map((line, i) => (
                            <p key={i} className="text-[11px] font-bold leading-relaxed text-foreground">{line}</p>
                          ))}
                        </div>
                      )}
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
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                              {cardSetupDueNow ? 'Card On File Required' : 'Deposit Due Today'}
                            </span>
                            <span style={{ fontFamily: headingFont }} className="text-2xl font-black text-primary tracking-tighter">${depositAmount.toFixed(2)}</span>
                          </div>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight opacity-60">
                            {cardSetupDueNow
                              ? 'Nothing is charged today — your card is only kept on file'
                              : 'Applied to your final total at checkout'}
                          </p>
                        </CardContent>
                      </Card>

                      {previewLines.length > 0 && (
                        <div style={{ borderRadius: r2 }} className="border-2 border-dashed p-4 space-y-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">What happens next</p>
                          {previewLines.map((line, i) => (
                            <p key={i} className="text-[11px] font-bold leading-relaxed text-foreground">{line}</p>
                          ))}
                        </div>
                      )}

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
            </React.Fragment>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        {currentStep !== 'confirmation' && currentStep !== 'checkout' && (
          <div
            ref={footerRef}
            className={cn(
              'z-20 px-4 pt-3 border-t bg-background/95 backdrop-blur-xl shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]',
              asPage ? 'sticky bottom-0' : 'absolute bottom-0 left-0 right-0',
            )}
            /* Safe-area padding: without it the primary button sits under the
               iPhone home indicator and reads as unresponsive. */
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            {/* One full-width target, 56px tall. The previous version split
                this row between Back and Continue, which made the primary
                action a fraction of the only comfortably reachable strip on a
                phone. Back now lives in the header. */}
            <Button
              onClick={handleNextStep}
              disabled={currentStep === 'details' && (!!existingClientWithBalance || !!bannedClient || isResolvingIdentity)}
              style={{ borderRadius: r3, fontFamily: headingFont }}
              className="group h-[52px] w-full font-black uppercase tracking-widest text-[11px] shadow-lg shadow-primary/20 transition-all active:scale-[0.99]"
            >
              {/* The button names what happens next, and keeps that name all
                  the way through the flow. */}
              {currentStep === 'summary' ? 'Confirm booking'
                : currentStep === 'staff' ? 'Choose a time'
                  : currentStep === 'dateTime' ? (selectedTime ? 'Add your details' : 'Pick a time above')
                    : currentStep === 'consents' ? 'Agree and continue'
                      : 'Continue'}
              <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        )}

        {currentStep === 'checkout' && (
          <div
            ref={footerRef}
            className={cn(
              'z-20 px-4 pt-3 border-t bg-background/95 backdrop-blur-xl shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]',
              asPage ? 'sticky bottom-0' : 'absolute bottom-0 left-0 right-0',
            )}
            /* Safe-area padding: without it the primary button sits under the
               iPhone home indicator and reads as unresponsive. */
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <Button
              variant="ghost"
              onClick={handlePrevStep}
              style={{ borderRadius: r3 }}
              className="w-full h-11 font-black uppercase tracking-tighter text-[10px] text-muted-foreground"
            >
              ← Back to Details
            </Button>
          </div>
        )}
    </>)
    )
  );
};
