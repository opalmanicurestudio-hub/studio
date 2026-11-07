'use client';
// src/components/booking/BookingSheet.tsx — THE BOOKING FLOW'S LOGIC, for every way in: the booking page, a link to
// one service, a reschedule, a renter's own page and the client portal. StudioFlow draws it; this file decides it:
// open times from the server, who takes "Anyone", the price and what's due today, identity checks, forms, the exact
// consent wording, card on file, payment, and what the server made of the booking.

import { emptyParty, partyHasMore, type Party } from '@/components/booking/PartyBuilder';
import { groupPolicy } from '@/lib/group-policy';
import { placeOptionsOf } from '@/lib/service-place';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { type Service, type Staff, type Appointment, type Event, type Tenant, type ConsentForm, type PricingTier, type Client } from '@/lib/data';
import { computeDepositCents, isPoorHistory, resolveBookingPlan } from '@/lib/deposit-policy';
import { format, setHours, setMinutes, startOfDay, addMinutes } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formsAskedFor, formRulesOf, formsRuleOf, asksInspirationPhotos } from '@/lib/forms';
import { formLeft, guardianSigns, FORM_META, type Guardian } from '@/lib/forms';
import { StudioFlow, type FlowLook } from './StudioFlow';
import { DepositGiftCard } from '@/components/gift/DepositGiftCard';
import type { InspoPhoto } from './PhotoMarkup';
import { useFirebase } from '@/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useServerAvailability, pickProvider } from '@/hooks/useServerAvailability';
import { brandColor, studioPage } from '@/lib/studio-page';
import { privacyOf } from '@/lib/health-privacy';

// ─── Schema ───────────────────────────────────────────────────────────────────
const bookingSchema = z.object({
  clientName:  z.string().trim().min(1, 'Add your name.'),
  clientEmail: z.string().trim().email('Add an email we can send your booking to.'),
  clientPhone: z.string().optional(),
  notes:       z.string().optional(),
  // Deliberately left unrefined. `methods.trigger([...])` in handleNextStep
  // validates named fields only and would never run a schema-level .refine(),
  // so the consent/phone pairing rule is enforced there instead.
  smsConsent:  z.boolean().optional(),
  smsMarketing: z.boolean().optional(),
  referrerFirst: z.string().max(40).optional(),
  referrerPhone: z.string().max(30).optional(),
  friendCode: z.string().max(20).optional(),
});
type BookingFormData = z.infer<typeof bookingSchema>;

// The exact wording that is shown to the guest AND stored on the appointment.
// Defined once so the record of what they agreed to can never drift from what
// they actually read on screen.
export const smsConsentWording = (studioName?: string | null) =>
  `I agree to receive appointment reminders and confirmations by text from ${studioName || 'this studio'} at the mobile number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not required to book.`;

// Marketing is a SEPARATE yes. The reminders consent above does not cover
// offers or "we miss you" texts, and US carriers / the TCPA treat the two
// differently — so it's its own switch, off by default, with its own words.
export const smsMarketingWording = (studioName?: string | null) =>
  `Also text me occasional offers, openings and check-ins from ${studioName || 'this studio'}. Up to 4 a month. Message and data rates may apply. Reply STOP to opt out. Not required to book.`;

// ─── onConfirm result type ─────────────────────────────────────────────────────
type ConfirmResult =
  | { requiresPayment: false }
  | { requiresPayment: true; clientSecret: string; stripeAccountId?: string }
  | { requiresPayment: true; error: string }
  | void;

// ─── The client this device knows ─────────────────────────────────────────────
// What they booked with last time on this device, so a returning client finds their details filled in ("Welcome
// back, Dana"). Kept on the device only, never by a business that keeps things discreet, forgotten after a year and
// a half, and forgotten at once by "Not you?".
type KnownClient = { name: string; email: string; phone: string; sms: boolean; at: string };
const knownKey = (tenantId: string) => `cf.me.${tenantId}`;
function readKnown(tenantId: string): KnownClient | null {
  try {
    const v = JSON.parse(localStorage.getItem(knownKey(tenantId)) || 'null');
    if (v && typeof v.email === 'string' && v.email.includes('@') && typeof v.name === 'string' && Date.now() - Date.parse(v.at || '') < 548 * 86400000) return v;
    if (v) localStorage.removeItem(knownKey(tenantId));
  } catch { /* storage blocked: nothing known */ }
  return null;
}
/** A saved number the way the phone field takes it ('+15125550148'): US numbers as 10 or 11 digits, others as saved with +. */
const phoneForField = (raw: any): string => { const s = String(raw || '').trim(); const d = s.replace(/\D/g, '');
  return s.startsWith('+') && d.length >= 8 ? `+${d}` : d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : ''; };
const firstName = (name: string) => { const f = String(name || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 40); return f ? f[0].toUpperCase() + f.slice(1) : ''; };

// ─── Props ────────────────────────────────────────────────────────────────────
interface BookingSheetProps {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  service:        Service;
  staff:          Staff[];
  pricingTiers:   PricingTier[];
  /** Who the client chose before opening ("Book with Maya"): chosen to start with, and they can change it. */
  initialStaffId?: string;
  /**
   * The provider is the page. On a renter's own booking link there is nobody
   * to choose between, so who does it can't change and the time step says who.
   */
  lockedStaffId?: string;
  /** Client details to start the form with — a returning client rescheduling from their email. */
  prefillClient?: { clientName?: string | null; clientEmail?: string | null; clientPhone?: string | null } | null;
  /** A time already chosen (a time an assistant held for this client): opens straight on the details step. */
  initialSlot?: { date: string; time: string; staffId?: string | null } | null;
  /** The business — from the page's web address (sturdier than the loaded record). */
  tenantId?: string;
  /** The visit being moved (client reschedule) — said at the top of the time step. */
  rescheduleOf?: { serviceName?: string | null; startTime?: string | null } | null;
  /** A line about a time held for the client (an assistant's hold), shown at the top. */
  holdNote?: string | null;
  /** The color and mood the sheet comes in: the page's own. Unset: the business's. */
  look?: FlowLook | null;
  /** Whether this way in can send guests, extra services and who recommended them (the client portal can't yet). */
  partyOk?: boolean;
  /** The client stepped back from paying a deposit: let the time their booking was holding go. */
  onReleaseHold?: () => Promise<'released' | 'paid' | 'kept' | void> | void;
  /** The booking is made (booked, sent, or paid): whatever the page kept about a held booking is done with. */
  onSettled?: () => void;
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
  /** Availability context, kept for callers that still pass it; open times come from the server. */
  shifts?:          any[];
  staffBlocks?:     any[];
  dayOffBlocks?:    any[];
  resources?:       any[];
  tickets?:         any[];
  maintenancePlans?: any[];
  calendarEvents?:  any[];
  /** What the SERVER made of the booking. Absent = an older caller, in
   *  which case the sheet keeps its original confirmed wording. */
  bookingOutcome?: { status: string; notice: string; depositCents: number; cardOnFile?: boolean; verify?: { tenantId: string; apptId: string; k: string } | null; prepUrl?: string | null; visitUrl?: string | null; earlier?: boolean; stillNeeded?: string[] } | null;
  onConfirm: (
    formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string },
    appointmentDetails: Omit<Appointment, 'id' | 'clientId' | 'clientName' | 'clientEmail' | 'clientPhone'> & { depositAmount?: number; depositStatus?: string },
    signedForms: SignedFormOut[],
    setBookingStep: (step: string) => void
  ) => Promise<ConfirmResult> | void;
}

export type FlowNote = { tone: 'info' | 'warn'; text: string; about?: 'forms' } | null;
/** A form finished in the sheet, as it's sent with the booking. */
export type SignedFormOut = { formId: string; formTitle: string; formData: Record<string, any>; signedName?: string; acknowledged?: true; guardian?: { name: string; relationship: string; confirmed: true } };

// ─── Component ────────────────────────────────────────────────────────────────
export const BookingSheet: React.FC<BookingSheetProps> = ({
  open, onOpenChange, service, staff, pricingTiers, initialStaffId, lockedStaffId, prefillClient, initialSlot = null,
  scheduleProfiles, services, consentForms, tenant, onConfirm, tenantId: tenantIdProp, rescheduleOf = null, holdNote = null, look = null, partyOk = true, onReleaseHold, onSettled,
  bookingOutcome,
}) => {
  const tid = String(tenantIdProp || (tenant as any)?.id || '');
  const discreet = privacyOf(tenant).discreet;

  const [selectedStaffId,      setSelectedStaffId]      = useState(lockedStaffId || initialStaffId || 'any');
  const [selectedTierId,       setSelectedTierId]        = useState<string>('any');
  const [date,                 setDate]                  = useState(new Date());
  const [selectedTime,         setSelectedTime]          = useState<string | null>(null);
  // ADD-ONS the client can add to this visit (the service's "offered with it" list) — chosen on the service step; they
  // lengthen the visit (availability accounts for them) and add to the price.
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  // Guests and more services (online groups) — sent as one request when anything's added.
  const [party, setParty] = useState<Party>(emptyParty);
  const groupPol = useMemo(() => groupPolicy(tenant), [tenant]);
  const addOns = useMemo(() => ((service as any)?.compatibleAddOnIds || []).map((id: string) => (services || []).find((x: any) => x.id === id)).filter((x: any) => x && x.status !== 'archived'), [service, services]);
  // A different visit length means different open times: the time is chosen again.
  const toggleAddOn = (id: string) => { setAddOnIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); setSelectedTime(null); };
  useEffect(() => { setAddOnIds([]); }, [service?.id]);
  const addOnTotal = addOns.filter((a: any) => addOnIds.includes(a.id)).reduce((n: number, a: any) => n + (Number(a.price) || 0), 0);
  const addOnMinutes = addOns.filter((a: any) => addOnIds.includes(a.id)).reduce((n: number, a: any) => n + (Number(a.duration) || 0), 0);
  const [formAnswers,          setFormAnswers]           = useState<Record<string, Record<string, any>>>({});
  // Forms (board FormsBook): signing for someone under 18, by form; and whether they're done now or later, from the
  // visit link (the server asks there for anything not done here: lib/forms, api/appointments/book).
  const [guardians,            setGuardians]             = useState<Record<string, Guardian>>({});
  const [formsWhen,            setFormsWhen]             = useState<'now' | 'later'>('now');
  const [bookedStaffId,        setBookedStaffId]         = useState<string | null>(null);
  // Up to 4 marked-up photos, each with a note (PhotoMarkup).
  const [inspoPhotos,          setInspoPhotos]           = useState<InspoPhoto[]>([]);
  // What to tell the client on the step they're on: a check that didn't pass, or what the server said.
  const [flowNote, setFlowNote] = useState<FlowNote>(null);
  // Who this device knows (their first name), while their details are the ones filled in.
  const [known, setKnown] = useState<string | null>(null);
  const { firestore } = useFirebase();

  const methods = useForm<BookingFormData>({ resolver: zodResolver(bookingSchema) });
  // Where it happens — when the service lets clients choose (in person / video call / phone / at their place).
  const placeOpts = placeOptionsOf(service);
  const [placeChoice, setPlaceChoice] = React.useState<string>(placeOpts[0]);
  React.useEffect(() => { setPlaceChoice(placeOptionsOf(service)[0]); }, [service?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { watch } = methods;
  const clientEmail = watch('clientEmail');
  const clientPhone = watch('clientPhone');

  const [existingClientWithBalance, setExistingClientWithBalance] = useState<Client | null>(null);
  const [bannedClient,              setBannedClient]              = useState<Client | null>(null);
  const [matchedClient,             setMatchedClient]             = useState<Client | null>(null);
  const [isResolvingIdentity,       setIsResolvingIdentity]       = useState(false);

  // ── Payment, opened on the review step once the booking holds the time ─────
  const [depositClientSecret,    setDepositClientSecret]    = useState<string | null>(null);
  const [depositApptId, setDepositApptId] = useState<string | null>(null);   // the held visit — a gift card can pay its deposit instead
  const [depositStripeAccountId, setDepositStripeAccountId] = useState<string | null>(null);
  const [depositError,           setDepositError]           = useState<string | null>(null);
  // Try again after the card form failed to load → reload the form only (never re-book).
  const [mountTry,               setMountTry]               = useState(0);
  const embeddedMountRef         = useRef<HTMLDivElement>(null);
  const embeddedCheckoutRef      = useRef<any>(null);
  // Paid (by card or a gift card) on this screen: the booked screen says booked, not "almost there".
  const [paid, setPaid] = useState(false);
  const resetPay = () => { setDepositClientSecret(null); setDepositStripeAccountId(null); setDepositApptId(null); setDepositError(null); };

  // What the lookup found, handed back too, so the check right after it reads this answer rather than the last one.
  type Found = { matched: Client | null; banned: Client | null; balance: Client | null };
  const resolveIdentity = async (email?: string, phone?: string): Promise<Found | null> => {
    if (!firestore || !tenant || (!email && !phone)) return null;
    const mine = ++lookupSeq.current;   // only the latest lookup's answer counts
    setIsResolvingIdentity(true);
    try {
      const clientsRef = collection(firestore, 'tenants', tenant.id, 'clients');
      const matchPromises = [];
      if (email) matchPromises.push(getDocs(query(clientsRef, where('email', '==', email.toLowerCase().trim()))));
      if (phone) matchPromises.push(getDocs(query(clientsRef, where('phone', '==', phone))));
      const snapshots  = await Promise.all(matchPromises);
      const allDocs    = snapshots.flatMap(s => s.docs).filter(d => !(d.data() as any)?.ownerRenterId);
      if (allDocs.length > 0) {
        const clientData = allDocs[0].data() as Client;
        const banned = clientData.status === 'banned' ? clientData : null;
        const balance = !banned && clientData.outstandingBalance && clientData.outstandingBalance > 0 ? clientData : null;
        if (mine === lookupSeq.current) { setMatchedClient(clientData); setBannedClient(banned); setExistingClientWithBalance(balance); }
        return { matched: clientData, banned, balance };
      }
      if (mine === lookupSeq.current) { setBannedClient(null); setExistingClientWithBalance(null); setMatchedClient(null); }
      return { matched: null, banned: null, balance: null };
    } catch (e) {
      // Couldn't look (the server checks again when booking): no old warning is left standing.
      if (mine === lookupSeq.current) { setBannedClient(null); setExistingClientWithBalance(null); }
      return null;
    }
    finally { if (mine === lookupSeq.current) setIsResolvingIdentity(false); }
  };
  const resolveRef = useRef(resolveIdentity); resolveRef.current = resolveIdentity;
  const lookupSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((clientEmail && clientEmail.includes('@')) || (clientPhone && clientPhone.length > 5)) {
        void resolveRef.current(clientEmail, clientPhone);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [clientEmail, clientPhone, firestore, (tenant as any)?.id]);

  const qualifiedStaff = useMemo(() => {
    if (!service?.requiredSkills || service.requiredSkills.length === 0) return staff;
    return staff.filter(s => service.requiredSkills!.every(skill => (s.skillSet || []).includes(skill)));
  }, [service, staff]);

  const availableTiersForService = useMemo(() => {
    if (!service.serviceTiers || service.serviceTiers.length === 0 || !pricingTiers) return [];
    const tiersWithStaff = new Set(qualifiedStaff.map(s => s.pricingTierId).filter(Boolean));
    return service.serviceTiers
      .filter(st => tiersWithStaff.has(st.tierId))
      .map(st => ({ ...st, id: st.tierId, name: pricingTiers.find(pt => pt.id === st.tierId)?.name || 'Tier' }));
  }, [service, qualifiedStaff, pricingTiers]);

  const publicScheduleProfile = useMemo(() => scheduleProfiles?.find(p => p.isActive), [scheduleProfiles]);
  const activeDaySchedule = useMemo(() => {
    const dayName = format(date, 'eeee').toLowerCase();
    return publicScheduleProfile?.week?.[dayName] || null;
  }, [date, publicScheduleProfile]);

  const dateKey = useMemo(() => format(date, 'yyyy-MM-dd'), [date]);

  // Open times come from the SERVER, worked out with the same engine the booking route verifies with — the browser
  // never receives other people's appointments, shifts or days off.
  // A returning client whose visits usually run longer: once the booking engine says so, show only times that fit.
  const [clientExtra, setClientExtra] = useState(0);
  // A charge for their usual extra time: shown, agreed, then booked — never added silently.
  const [extraOffer, setExtraOffer] = useState<{ minutes: number; cents: number; text: string } | null>(null); const [acceptExtraCents, setAcceptExtraCents] = useState(0);
  const providerId = (service as any)?.renterProviderId || null;
  const currentStepRef = useRef<string>('');
  const availability = useServerAvailability({
    tenantId: tid,
    date: dateKey,
    serviceId: service?.id || '',
    staffId: selectedStaffId,
    tierId: selectedStaffId === 'any' && selectedTierId !== 'any' ? selectedTierId : undefined,
    providerId,
    addOnIds,
    extraMinutes: clientExtra,
  });
  // "Anyone": ask the server who takes the chosen time, as soon as it's tapped (for the visit as chosen, add-ons and
  // their usual extra time included).
  const [anyPick, setAnyPick] = useState<{ key: string; staffId?: string; error?: string } | null>(null);
  const anyPickRef = useRef<{ key: string; staffId?: string; error?: string } | null>(null);
  useEffect(() => { anyPickRef.current = anyPick; }, [anyPick]);
  const pickKey = `${dateKey}|${selectedTime}|${service?.id || ''}|${selectedTierId}|${addOnIds.join(',')}|${clientExtra}`;
  const pickInput = () => ({ tenantId: tid, date: dateKey, time: String(selectedTime || ''), serviceId: service.id, tierId: selectedTierId !== 'any' ? selectedTierId : undefined, providerId, addOnIds, extraMinutes: clientExtra });
  /** "Anyone": make sure the server's pick for THIS time is in hand before
   *  booking — if it hasn't arrived yet (slow connection), ask now and wait. */
  const ensureAnyPick = async () => {
    if (selectedStaffId !== 'any' || !selectedTime || !service?.id || !tid) return;
    const cur = anyPickRef.current; if (cur && cur.key === pickKey && (cur.staffId || cur.error)) return;
    const r = await pickProvider(pickInput());
    const next = r.ok ? { key: pickKey, staffId: r.staffId } : { key: pickKey, error: r.error };
    anyPickRef.current = next; setAnyPick(next);
  };
  useEffect(() => {
    if (selectedStaffId !== 'any' || !selectedTime || !service?.id || !tid) { setAnyPick(null); return; }
    let live = true; setAnyPick({ key: pickKey });
    void pickProvider(pickInput()).then((r) => { if (live) setAnyPick(r.ok ? { key: pickKey, staffId: r.staffId } : { key: pickKey, error: r.error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, selectedStaffId]);

  const timeSlots = availability.times;
  // While choosing: a time that isn't open on the day as now loaded (another day, a longer visit) is chosen again.
  useEffect(() => {
    if (availability.loading || !selectedTime || (currentStepRef.current !== 'dateTime' && currentStepRef.current !== 'service')) return;
    if (!availability.times.includes(selectedTime)) setSelectedTime(null);
  }, [availability.loading, availability.times]); // eslint-disable-line react-hooks/exhaustive-deps
  const hotSlotMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const t of availability.hotTimes) m.set(t, true);
    return m;
  }, [availability.hotTimes]);

  // The forms this visit asks for: the service's and any chosen add-on's (lib/forms formsAskedFor).
  const requiredForms = useMemo(() => {
    if (!service || !consentForms) return [];
    const ids = formsAskedFor({}, [service, ...addOns.filter((a: any) => addOnIds.includes(a.id))]);
    return ids.map((id) => consentForms.find((f) => f.id === id)).filter(Boolean) as ConsentForm[];
  }, [service, consentForms, addOns, addOnIds]);
  const guardianAsk = formRulesOf(tenant).guardian;
  const formDone = (form: ConsentForm) => formLeft(form, formAnswers[form.id] || {}, guardians[form.id] || null, guardianAsk) === 0;

  const { price, priceRange } = useMemo(() => {
    if (!service.serviceTiers || service.serviceTiers.length === 0) return { price: (Number(service.price) || 0) + addOnTotal, priceRange: null };
    if (selectedStaffId && selectedStaffId !== 'any') {
      const staffMember = staff.find(s => s.id === selectedStaffId);
      const tierPricing = service.serviceTiers.find(t => t.tierId === staffMember?.pricingTierId);
      if (tierPricing) return { price: tierPricing.price + addOnTotal, priceRange: null };
    }
    if (selectedStaffId === 'any' && selectedTierId !== 'any') {
      const tierPricing = service.serviceTiers.find(t => t.tierId === selectedTierId);
      if (tierPricing) return { price: tierPricing.price + addOnTotal, priceRange: null };
    }
    const prices   = service.serviceTiers.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice === maxPrice) return { price: minPrice + addOnTotal, priceRange: null };
    return { price: minPrice + addOnTotal, priceRange: { min: minPrice + addOnTotal, max: maxPrice + addOnTotal } };
  }, [service, selectedStaffId, selectedTierId, staff, addOnTotal]);

  const depositAmount = useMemo(() => {
    const poorHistory = isPoorHistory(matchedClient, tenant);
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
   * The plan decides now. Money is collected here only when the plan says
   * at_booking; on_approval and on_penalty book without payment, and the
   * decide route charges the card or sends a pay link at the moment it
   * becomes real.
   */
  const bookingPreview = useMemo(() => {
    if (!tenant || !service) return null;
    try {
      return resolveBookingPlan({ tenant, service, price: price || 0 } as any);
    } catch {
      return null;
    }
  }, [tenant, service, price]);
  const chargeDueNow = useMemo(() => {
    if (depositAmount <= 0) return false;
    /* No plan resolvable (a service or tenant we could not read) → fall back
     * to the old behaviour rather than silently skipping a payment the shop
     * expects. */
    if (!tenant || !service || !bookingPreview) return true;
    return bookingPreview.chargeTiming === 'at_booking';
  }, [depositAmount, tenant, service, bookingPreview]);
  /**
   * A CARD IS REQUIRED, SO IT IS COLLECTED — in setup mode, so the issuer
   * authorizes it and nothing is charged. Never both: paying already keeps the card.
   */
  const cardSetupDueNow = !chargeDueNow && bookingPreview?.requiresCardOnFile === true;

  // What happens to the money, in the client's words (said on the review step).
  const previewLines = useMemo(() => {
    if (!bookingPreview) return [] as string[];
    const out: string[] = [];
    const amount = Number(bookingPreview.depositCents || 0) / 100;
    const money = `$${amount % 1 ? amount.toFixed(2) : amount}`;
    if (bookingPreview.status === 'requested') out.push(`This sends a request. ${(tenant as any)?.name || 'The business'} confirms before it’s booked.`);
    if (amount > 0) {
      if (bookingPreview.chargeTiming === 'on_approval') out.push(`The ${money} deposit is taken only once your request is accepted.`);
      else if (bookingPreview.chargeTiming === 'on_penalty') out.push(`Nothing is taken now. ${money} applies only if you miss the visit or cancel late.`);
    }
    if (bookingPreview.requiresCardOnFile && bookingPreview.chargeTiming !== 'at_booking') out.push('You’ll add a card when you book. Nothing is charged to it today.');
    return out;
  }, [bookingPreview, tenant]);

  // ── The steps ───────────────────────────────────────────────────────────────
  // The service step shows only when there's something to choose on it (add-ons, where to meet); a reschedule moves
  // the visit it already is. Paying happens on the review step, once the booking holds the time.
  const serviceStep = !rescheduleOf && (addOns.length > 0 || placeOpts.length > 1);
  const steps = useMemo(() => [...(serviceStep ? ['service'] : []), 'dateTime', 'details', 'review', 'confirmation'], [serviceStep]);
  // The step is kept by its name, so the booked screen stays the booked screen even if the list of steps changes
  // underneath it (a reschedule finishing, the menu changing while the sheet is open).
  const [stepName, setStepName] = useState<string>(steps[0]);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const currentStep = steps.includes(stepName) ? stepName : steps[0];
  const currentStepIndex = steps.indexOf(currentStep);
  const stepsRef = useRef(steps); stepsRef.current = steps; currentStepRef.current = currentStep;
  const goTo = (name: string) => { if (stepsRef.current.includes(name)) { setDirection('fwd'); setFlowNote(null); setStepName(name); } };
  const goToRef = useRef(goTo); goToRef.current = goTo;

  useEffect(() => {
    if (!open) return;
    setSelectedStaffId(lockedStaffId || initialStaffId || 'any');
    setSelectedTierId('any'); setSelectedTime(null); setDate(new Date()); setDirection('fwd'); setStepName(steps[0]);
    setAddOnIds([]); setClientExtra(0); setPaid(false); setMatchedClient(null); setBannedClient(null); setExistingClientWithBalance(null);
    // Their details: a reschedule's or an assistant's hold first, else what this device used last time.
    const me = !prefillClient && tid && !discreet ? readKnown(tid) : null;
    setKnown(me ? firstName(me.name) || null : null);
    // A client this device knows starts at "Later": the visit link asks only for what isn't already on file. A service
    // whose forms are due when they book (Settings › Forms and documents) asks for them here, every time.
    setFormsWhen(me && formsRuleOf(service).due !== 'booking' ? 'later' : 'now');
    methods.reset(prefillClient ? { clientName: prefillClient.clientName || '', clientEmail: prefillClient.clientEmail || '', clientPhone: phoneForField(prefillClient.clientPhone) } as any
      : me ? { clientName: me.name, clientEmail: me.email, clientPhone: phoneForField(me.phone) } as any : undefined);   // consent is always theirs to give on this booking
    setFormAnswers({}); setGuardians({}); setBookedStaffId(null); setInspoPhotos([]); setParty(emptyParty);
    resetPay(); setFlowNote(null); setExtraOffer(null); setAcceptExtraCents(0);
    if (initialSlot && /^\d{4}-\d{2}-\d{2}$/.test(initialSlot.date)) { const [y, m, d] = initialSlot.date.split('-').map(Number);
      setSelectedStaffId(lockedStaffId || initialSlot.staffId || 'any'); setDate(new Date(y, m - 1, d)); setSelectedTime(initialSlot.time); setStepName('details'); }
    // The page passes a fresh copy of its details on every render: this runs when the sheet opens, or what it opens on changes.
  }, [open, initialStaffId, lockedStaffId, methods, initialSlot?.date, initialSlot?.time, initialSlot?.staffId]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** "Not you?": forget this device's client and clear what was filled in. */
  const forgetMe = () => {
    try { localStorage.removeItem(knownKey(tid)); localStorage.removeItem(`cf.lastVisit.${tid}`); } catch { /* none */ }
    setKnown(null); setFormsWhen('now'); methods.reset({ clientName: '', clientEmail: '', clientPhone: '', smsConsent: false, smsMarketing: false, notes: methods.getValues('notes') || '' } as any);
    setMatchedClient(null); setBannedClient(null); setExistingClientWithBalance(null);
  };

  // ── What gets booked ─────────────────────────────────────────────────────────
  // A plain function, read when the client books, so it always has everything they chose.
  const resolveBookingPayload = ():
    | { error: string }
    | {
        finalStaffId: string;
        clientData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string };
        signedForms: SignedFormOut[];
        appointmentDetails: any;
      }
    | null => {
    if (!service || !selectedTime) return null;
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const startDateTime = setMinutes(setHours(startOfDay(date), hours), minutes);
    const endDateTime   = addMinutes(startDateTime, (Number(service.duration) || 0) + addOnMinutes + clientExtra);

    let finalStaffId = selectedStaffId;
    if (finalStaffId === 'any') {
      // Chosen by the server when the time was tapped (the engine's rotation); the booking route re-checks it.
      const ap = anyPickRef.current;
      if (!ap || ap.key !== pickKey || (!ap.staffId && !ap.error)) {
        return { error: 'Still matching you with someone for that time. Tap again in a moment.' };
      }
      if (!ap.staffId) return { error: ap.error || 'Nobody is free for that time anymore. Please choose another.' };
      finalStaffId = ap.staffId;
    }

    const formValues   = methods.getValues();
    const clientData   = { clientName: String(formValues.clientName || '').trim(), clientEmail: String(formValues.clientEmail || '').trim(), clientPhone: formValues.clientPhone, notes: formValues.notes };
    // Only finished forms are sent (the rest are asked on the visit link): the answers, the name it was signed in, "I've
    // read this", and the guardian who completed it for someone under 18, with their consent. The server checks each
    // one again (lib/forms sentFormDone) before it counts.
    const signedForms: SignedFormOut[] = requiredForms.filter(formDone).map(form => {
      const a = formAnswers[form.id] || {}; const g = guardians[form.id];
      const formData = Object.fromEntries(Object.entries(a).filter(([k]) => !FORM_META.has(k)));
      const signedName = String(a.__signedName || '').trim();
      return { formId: form.id, formTitle: form.title, formData, ...(signedName ? { signedName } : {}), ...(a.__read === true ? { acknowledged: true as const } : {}),
        ...(guardianSigns(form, g, guardianAsk) && g?.consent === true ? { guardian: { name: g.name.trim(), relationship: g.relationship.trim(), confirmed: true } } : {}) }; });

    return {
      finalStaffId,
      clientData,
      signedForms,
      appointmentDetails: {
        serviceId: service.id, serviceName: service.name, staffId: finalStaffId, addOnIds, ...(partyHasMore(party) ? { party } : {}), ...(acceptExtraCents > 0 ? { acceptExtraCents } : {}),
        ...(placeOpts.length > 1 ? { place: placeChoice } : {}),
        startTime: startDateTime.toISOString(), endTime: endDateTime.toISOString(),
        status: 'confirmed', isWalkIn: false, source: 'online',
        inspirationPhotoUrl: inspoPhotos[0]?.url || undefined, notes: formValues.notes,
        ...(inspoPhotos.length ? { inspirationPhotos: inspoPhotos.map(({ url, note }) => ({ url, note })) } : {}),
        depositAmount,
        depositStatus: chargeDueNow ? 'pending' : 'none',
        // Written-out proof of consent. Storing the wording alongside the flag
        // is the part that actually matters if the carrier ever asks how the
        // number was collected.
        smsConsent:       !!formValues.smsConsent,
        smsConsentAt:     formValues.smsConsent ? new Date().toISOString() : undefined,
        smsConsentSource: formValues.smsConsent ? 'public_booking_sheet' : undefined,
        smsConsentText:   formValues.smsConsent ? smsConsentWording(tenant?.name) : undefined,
        smsMarketing:     !!formValues.smsMarketing,
        smsMarketingText: formValues.smsMarketing ? smsMarketingWording(tenant?.name) : undefined,
        // Who recommended them (no link used): both have to match one client on the server, or nothing happens.
        ...(String(formValues.friendCode || '').replace(/[^A-Za-z0-9]/g, '').length >= 3 ? { referralTypedCode: String(formValues.friendCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16) } : {}),
        ...(String(formValues.referrerFirst || '').trim() && String(formValues.referrerPhone || '').replace(/\D/g, '').length >= 10 ? { referredBy: { firstName: String(formValues.referrerFirst).trim().slice(0, 40), phone: String(formValues.referrerPhone).slice(0, 30) } } : {}),
      },
    };
  };

  // ── Booking it ───────────────────────────────────────────────────────────────
  // One button on the review step. The server decides what the booking becomes; when money or a card is due, the
  // secure form opens right there for THAT booking, and anything the server needs first is said in its own words.
  const [confirming, setConfirming] = useState(false);
  const submit = async () => {
    if (confirming || leavingRef.current) return;
    setFlowNote(null); setDepositError(null); setConfirming(true);
    try {
      await ensureAnyPick();
      const payload = resolveBookingPayload();
      if (!payload) return;
      if ('error' in payload) { setFlowNote({ tone: 'warn', text: payload.error }); return; }
      setBookedStaffId(payload.finalStaffId);
      const result: any = await onConfirm(payload.clientData, payload.appointmentDetails, payload.signedForms, (s: string) => goToRef.current(s === 'checkout' ? 'review' : s));
      if (result && result.clientSecret) {
        setDepositClientSecret(result.clientSecret);
        setDepositStripeAccountId(result.stripeAccountId || null); setDepositApptId(result.appointmentId || null);
        return;
      }
      if (result?.code === 'confirm_extra') { setExtraOffer({ minutes: Number(result.extraMinutes) || 0, cents: Number(result.extraCents) || 0, text: String(result.error || '') }); return; }
      if (result?.code === 'needs_longer') {
        setClientExtra(Number(result.extraMinutes) || 0); setSelectedTime(null); setDirection('back'); setStepName('dateTime');
        setFlowNote({ tone: 'info', text: String(result.error || 'Your visits usually take a little longer, so here are the times that fit.') });
        return;
      }
      if (result && result.error) { setFlowNote({ tone: 'warn', text: String(result.error) }); return; }
      goToRef.current('confirmation');
    } catch (e: any) {
      setFlowNote({ tone: 'warn', text: e?.message ? `That didn’t go through: ${String(e.message).slice(0, 160)}` : 'That didn’t go through. Please try again.' });
    } finally { setConfirming(false); }
  };
  // After they agree to the extra-time charge, book again — with their agreement to that exact amount attached.
  const [rebookTick, setRebookTick] = useState(0);
  useEffect(() => { if (rebookTick) void submit(); }, [rebookTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!depositClientSecret || !tid) return;
    let stopped = false;
    let instance: any;

    const mount = async () => {
      if (!(window as any).Stripe) {
        // Never wait forever: a blocked or failed script used to leave the client
        // on "Opening secure payment…" indefinitely.
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://js.stripe.com/v3/';
          const t = setTimeout(() => reject(new Error('The secure payment form took too long to load. Check your connection and try again.')), 15000);
          s.onload = () => { clearTimeout(t); resolve(); };
          s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('The secure payment form couldn’t load. Check your connection or any content blocker, then try again.')); };
          document.head.appendChild(s);
        });
      }
      if (stopped) return;

      const keyRes = await fetch('/api/stripe/publishable-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tid }),
      });
      const { publishableKey, stripeAccountId } = await keyRes.json();
      if (!publishableKey) throw new Error('Online payments aren’t set up for this business yet.');
      if (!(window as any).Stripe) throw new Error('The secure payment form didn’t load. Check your connection or any content blocker.');
      if (stopped) return;

      const stripe = (window as any).Stripe(publishableKey, {
        // The account the PAYMENT was created on comes first (a renter's own
        // account for their deposits); the business's account otherwise.
        stripeAccount: depositStripeAccountId || stripeAccountId || undefined,
      });
      instance = await stripe.initEmbeddedCheckout({
        clientSecret: depositClientSecret,
        onComplete: () => { setPaid(true); goToRef.current('confirmation'); },
      });
      if (stopped) { instance.destroy(); return; }
      embeddedCheckoutRef.current = instance;
      // The payment form can appear a moment after the details arrive — wait
      // for its box (up to 2s) so the card form is never silently skipped.
      for (let i = 0; i < 40 && !embeddedMountRef.current && !stopped; i++) await new Promise((r) => setTimeout(r, 50));
      if (stopped) { try { instance.destroy(); } catch {} return; }
      if (embeddedMountRef.current) instance.mount(embeddedMountRef.current);
      else setDepositError('The secure payment form couldn’t open. Please try again.');
    };

    mount().catch((e) => {
      console.error('[embedded-checkout]', e);
      // Say WHY, so a screenshot tells the business exactly what went wrong.
      if (!stopped) setDepositError(`The secure payment form couldn’t open. ${String(e?.message || e || '').slice(0, 160)}`.trim());
    });

    return () => {
      stopped = true;
      try { embeddedCheckoutRef.current?.destroy(); } catch {}
      embeddedCheckoutRef.current = null;
    };
  }, [depositClientSecret, depositStripeAccountId, tid, mountTry]);


  const handleNextStep = async () => {
    setFlowNote(null);
    if (currentStep === 'dateTime' && !selectedTime) { setFlowNote({ tone: 'warn', text: 'Choose a time to go on.' }); return; }
    if (currentStep === 'details') {
      const valid = await methods.trigger(['clientName', 'clientEmail'], { shouldFocus: true });
      if (!valid) return;
      // Consent without a number to text is a dead record — and worse, it looks
      // like permission the studio does not actually have.
      const consentPhone = (watch('clientPhone') || '').replace(/\D/g, '');
      if (watch('smsConsent') && consentPhone.length < 10) { setFlowNote({ tone: 'warn', text: 'Add the mobile number for your reminders, or turn text reminders off.' }); return; }
      if (watch('smsMarketing') && consentPhone.length < 10) { setFlowNote({ tone: 'warn', text: 'Add the mobile number for news and offers, or turn them off.' }); return; }
      const found = await resolveIdentity(watch('clientEmail'), watch('clientPhone'));
      const who = found ? found.matched : matchedClient;
      if (found ? found.banned || found.balance : bannedClient || existingClientWithBalance) return;
      const dayAccess = activeDaySchedule?.accessTier || 'all';
      if (dayAccess === 'members') {
        const isClientMember        = !!(who?.activeMembershipId || who?.subscription);
        const isClientPackageHolder = (who?.activePackages?.length || 0) > 0;
        if (!isClientMember && !isClientPackageHolder) { setFlowNote({ tone: 'warn', text: 'That day is kept for members and package holders. Please choose another day.' }); return; }
      } else if (dayAccess === 'returning') {
        if (!who) { setFlowNote({ tone: 'warn', text: 'That day is kept for returning clients. Please choose another day.' }); return; }
      }
      // Doing them now: every form finished. Later: nothing stops here; the visit link asks.
      const toBook = formsRuleOf(service).due === 'booking';
      const unanswered = formsWhen === 'now' || toBook ? requiredForms.find((f) => !formDone(f)) : null;
      if (unanswered) { setFlowNote({ tone: 'warn', text: toBook ? `Finish ${unanswered.title || 'the form'} to book. It’s needed before booking.` : `Finish ${unanswered.title || 'the form'}, or choose “Later, from my visit link”.`, about: 'forms' }); return; }
    }
    if (currentStep === 'review') { void submit(); return; }
    setDirection('fwd');
    setStepName(steps[Math.min(currentStepIndex + 1, steps.length - 1)]);
  };

  // Stepping back. Never while a booking is on its way (its answer would land on the wrong step). From paying a
  // deposit: the time the booking was holding is let go first, so whatever they change can be booked. Once a booking
  // is made and only a card is left to add, there's no going back to make it again.
  const [leaving, setLeaving] = useState(false); const leavingRef = useRef(false); leavingRef.current = leaving;
  const payKindCard = !!depositClientSecret && (bookingOutcome ? bookingOutcome.status !== 'pending_payment' && !!bookingOutcome.cardOnFile : cardSetupDueNow);
  const canGoBack = currentStepIndex > 0 && currentStep !== 'confirmation' && !confirming && !leaving && !payKindCard;
  const handlePrevStep = async () => {
    if (!canGoBack) return;
    const to = steps[Math.max(0, currentStepIndex - 1)];
    if (currentStep === 'review') {
      // The payment form goes first, so nothing more can be paid on it while the time is let go.
      resetPay(); setExtraOffer(null); setLeaving(true); leavingRef.current = true;
      let said: any = null;
      try { said = await onReleaseHold?.(); } catch { /* it's let go on its own shortly */ } finally { setLeaving(false); leavingRef.current = false; }
      resetPay();
      // Paid in that very moment (by card or gift card): it's booked.
      if (said === 'paid') { setPaid(true); goToRef.current('confirmation'); return; }
      if (currentStepRef.current !== 'review') return;
    }
    setFlowNote(null); setDirection('back'); setStepName(to);
  };
  // Closing the sheet while a deposit form is open lets the held time go too (unless it was paid, or only a card was left).
  const closeSheet = (o: boolean) => {
    if (!o && currentStep === 'review' && !paid && !payKindCard) void onReleaseHold?.();   // nothing held: nothing happens
    onOpenChange(o);
  };

  const handleStaffSelect = (staffId: string) => {
    if (lockedStaffId) return;
    setSelectedStaffId(staffId);
    setSelectedTime(null);
  };

  const bookedStaff   = useMemo(() => staff.find(s => s.id === bookedStaffId), [staff, bookedStaffId]);
  const selectedStaff = useMemo(() => staff.find(s => s.id === selectedStaffId), [staff, selectedStaffId]);

  // Booked: the page is done with any held booking, and this device remembers the details for next time (never for a
  // business that keeps things discreet).
  useEffect(() => { if (currentStep === 'confirmation') onSettled?.(); }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (currentStep !== 'confirmation' || !tid || discreet) return;
    const v = methods.getValues(); const email = String(v.clientEmail || '').trim(); if (!email.includes('@')) return;
    try { localStorage.setItem(knownKey(tid), JSON.stringify({ name: String(v.clientName || '').trim().slice(0, 80), email: email.slice(0, 120), phone: String(v.clientPhone || '').slice(0, 30), sms: !!v.smsConsent, at: new Date().toISOString() })); } catch { /* private browsing: nothing kept */ }
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const flowLook: FlowLook = look || { accent: brandColor(tenant), mood: studioPage(tenant).mood };

  if (!open) return null;
  return <StudioFlow c={{
    look: flowLook, holdNote,
    service, tenant, tenantId: tid, steps, currentStep, currentStepIndex, direction, handleNextStep, handlePrevStep, canGoBack, leaving, goTo, onOpenChange: closeSheet, partyOk, paid,
    qualifiedStaff, lockedStaffId, selectedStaffId, handleStaffSelect, selectedStaff, bookedStaff, availableTiersForService, selectedTierId, setSelectedTierId,
    clientExtra, party, setParty, groupPol, allServices: services, date, setDate, selectedTime, setSelectedTime, timeSlots, hotSlotMap, availability, addOns, addOnIds, toggleAddOn, addOnMinutes,
    placeOpts, placeChoice, setPlaceChoice, activeDaySchedule,
    methods, smsConsentWording, smsMarketingWording, isResolvingIdentity, bannedClient, existingClientWithBalance, known, forgetMe,
    requiredForms, formsToBook: formsRuleOf(service).due === 'booking', asksPhotos: asksInspirationPhotos(service), formAnswers, setFormAnswers, inspoPhotos, setInspoPhotos, guardians, setGuardians, guardianAsk, formsWhen, setFormsWhen: (w: 'now' | 'later') => { setFormsWhen(w); setFlowNote(null); }, formDone,
    price, priceRange, previewLines, bookingPreview, chargeDueNow, cardSetupDueNow, confirming, depositAmount, bookingOutcome, flowNote, setFlowNote,
    extraOffer, acceptExtra: () => { if (!extraOffer) return; setAcceptExtraCents(extraOffer.cents); setExtraOffer(null); setRebookTick((t) => t + 1); },
    declineExtra: () => { setExtraOffer(null); setAcceptExtraCents(0); setSelectedTime(null); setDirection('back'); setStepName('dateTime'); },
    pay: {
      secret: depositClientSecret, error: depositError, mountRef: embeddedMountRef,
      retry: () => { if (leavingRef.current) return; setDepositError(null); if (depositClientSecret) setMountTry((n) => n + 1); else void submit(); },
      gift: depositApptId && !providerId ? <DepositGiftCard tenantId={tid} appointmentId={depositApptId} studio onPaid={() => { setPaid(true); goToRef.current('confirmation'); }} /> : null,
    },
    rescheduleOf, providerId,
  }} />;
};
