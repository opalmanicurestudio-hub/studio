'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useFirebase } from '@/firebase';
import {
  doc, collection, query, where, getDocs, addDoc,
  onSnapshot, deleteDoc,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, ChevronRight, ChevronLeft, AlertTriangle,
  Utensils, Loader, Check, FileText, MapPin, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (v: any): Date => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v === 'string') return parseISO(v);
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return new Date(v);
};

// ─── ALLERGY / DIETARY OPTIONS ────────────────────────────────────────────────
// Note: NOT exported — export type on a use client page confuses the Next.js bundler
type AllergySeverity = 'preference' | 'intolerance' | 'critical';

type AllergyOption = {
  id: string;
  label: string;
  emoji: string;
  severity: AllergySeverity;
  hint?: string;
};

const ALLERGY_OPTIONS: AllergyOption[] = [
  { id: 'peanuts',    label: 'Peanuts',    emoji: '🥜', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'nuts',       label: 'Tree Nuts',  emoji: '🌰', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'shellfish',  label: 'Shellfish',  emoji: '🦐', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'fish',       label: 'Fish',       emoji: '🐟', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'eggs',       label: 'Eggs',       emoji: '🥚', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'gluten',     label: 'Gluten',     emoji: '🌾', severity: 'intolerance', hint: 'Celiac or intolerance' },
  { id: 'dairy',      label: 'Dairy',      emoji: '🥛', severity: 'intolerance', hint: 'Lactose intolerance' },
  { id: 'soy',        label: 'Soy',        emoji: '🫘', severity: 'intolerance', hint: 'Soy intolerance' },
  { id: 'vegan',      label: 'Vegan',      emoji: '🌿', severity: 'preference' },
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🥦', severity: 'preference' },
  { id: 'kosher',     label: 'Kosher',     emoji: '✡️',  severity: 'preference' },
  { id: 'halal',      label: 'Halal',      emoji: '☪️',  severity: 'preference' },
];

const SEVERITY_CONFIG = {
  critical:    { label: 'Critical Allergy',   bg: 'bg-red-50',   border: 'border-red-300',   text: 'text-red-800',   badge: 'bg-red-100 text-red-800 border-red-300' },
  intolerance: { label: 'Intolerance',        bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800 border-amber-300' },
  preference:  { label: 'Dietary Preference', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
};

// ─── STEP DOTS ────────────────────────────────────────────────────────────────
const StepDots = ({ total, current }: { total: number; current: number }) => (
  <div className="flex items-center justify-center gap-2">
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} className={cn(
        'h-1.5 rounded-full transition-all duration-500',
        i === current ? 'w-6 bg-slate-900' : i < current ? 'w-3 bg-slate-900 opacity-40' : 'w-3 bg-slate-200'
      )} />
    ))}
  </div>
);

// ─── MEAL OPTION CARD ─────────────────────────────────────────────────────────
const MealOptionCard = ({ option, selected, onSelect }: { option: any; selected: boolean; onSelect: () => void }) => (
  <motion.button whileTap={{ scale: 0.97 }} onClick={onSelect}
    className={cn(
      'relative w-full text-left p-5 rounded-2xl border-2 transition-all duration-200',
      selected ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-white hover:border-slate-300'
    )}>
    {selected && (
      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white flex items-center justify-center">
        <Check className="w-3.5 h-3.5 text-slate-900" />
      </div>
    )}
    {option.imageUrl && (
      <div className="relative w-full h-32 rounded-xl overflow-hidden mb-3">
        <Image src={option.imageUrl} alt={option.name} fill className="object-cover" />
      </div>
    )}
    <p className={cn('font-black uppercase tracking-tight text-base leading-tight', selected ? 'text-white' : 'text-slate-900')}>
      {option.name}
    </p>
    {option.description && (
      <p className={cn('text-[11px] mt-1.5 leading-relaxed', selected ? 'text-white/70' : 'text-slate-500')}>
        {option.description}
      </p>
    )}
    <div className="flex flex-wrap gap-1.5 mt-2">
      {option.isVegan && (
        <span className={cn('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border',
          selected ? 'bg-white/20 border-white/30 text-white' : 'bg-emerald-50 border-emerald-200 text-emerald-700')}>
          🌿 Vegan
        </span>
      )}
      {option.isGlutenFree && (
        <span className={cn('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border',
          selected ? 'bg-white/20 border-white/30 text-white' : 'bg-amber-50 border-amber-200 text-amber-700')}>
          🌾 GF
        </span>
      )}
    </div>
  </motion.button>
);

// ─── LOADING FALLBACK ─────────────────────────────────────────────────────────
const PageLoader = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center">
    <Loader className="w-8 h-8 animate-spin text-slate-300" />
  </div>
);

// ─── INNER PAGE (uses useSearchParams — must be inside Suspense) ──────────────
type Step = 'pin' | 'identity' | 'meal' | 'allergies' | 'confirm' | 'done';

function EventGuestOrderPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { firestore } = useFirebase();

  const tenantId = params.tenantId as string;
  const eventId  = params.eventId  as string;

  const prefillTable = searchParams.get('table') || '';
  const prefillSeat  = searchParams.get('seat')  || '';

  // ── Live data ─────────────────────────────────────────────────────────────
  const [event, setEvent]         = useState<any>(null);
  const [tenant, setTenant]       = useState<any>(null);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(doc(firestore, `tenants/${tenantId}`), (snap) => {
      setTenant(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }));

    unsubs.push(onSnapshot(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), (snap) => {
      setEvent(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setDataLoading(false);
    }));

    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/eventMenuItems`), where('eventId', '==', eventId)),
      (snap) => setMenuItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    ));

    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, eventId]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [step, setStep]               = useState<Step>('pin');
  const [pinEntry, setPinEntry]       = useState('');
  const [pinError, setPinError]       = useState(false);
  const [guestName, setGuestName]     = useState('');
  const [guestEmail, setGuestEmail]   = useState('');
  const [guestPhone, setGuestPhone]   = useState('');
  const [tableNumber, setTableNumber] = useState(prefillTable);
  const [seatNumber, setSeatNumber]   = useState(prefillSeat);

  const [selectedMealId, setSelectedMealId] = useState<string | null>(null);
  const [selectedCourseSelections, setSelectedCourseSelections] = useState<Record<string, string>>({});
  const [currentCourseIdx, setCurrentCourseIdx] = useState(0);

  const [selectedAllergies, setSelectedAllergies] = useState<{ id: string; label: string; severity: AllergySeverity }[]>([]);
  const [allergyNote, setAllergyNote]   = useState('');
  const [guestNote, setGuestNote]       = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError]   = useState('');

  const [alreadyOrdered, setAlreadyOrdered] = useState(false);
  const [existingOrder, setExistingOrder]   = useState<any>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const requiresPin = !!(event?.accessPin);

  const isEventOpen = useMemo(() => {
    if (!event) return false;
    if (event.orderingDeadline && new Date() > safeDate(event.orderingDeadline)) return false;
    return ['open', 'published', 'upcoming', 'active'].includes(event.status);
  }, [event]);

  const courses: any[] = useMemo(() => event?.courses || [], [event]);
  const hasCourses = courses.length > 0;

  // ── Auto-skip PIN ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (event && step === 'pin' && !requiresPin) setStep('identity');
  }, [event, requiresPin, step]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handlePinSubmit = () => {
    if (pinEntry === String(event?.accessPin)) {
      setPinError(false);
      setStep('identity');
    } else {
      setPinError(true);
      setPinEntry('');
    }
  };

  const checkDuplicate = async (): Promise<boolean> => {
    if (!guestEmail.trim() || !firestore) return false;
    const snap = await getDocs(query(
      collection(firestore, `tenants/${tenantId}/eventGuests`),
      where('email', '==', guestEmail.toLowerCase().trim()),
      where('eventId', '==', eventId)
    ));
    if (!snap.empty) {
      setExistingOrder({ id: snap.docs[0].id, ...snap.docs[0].data() });
      return true;
    }
    return false;
  };

  const handleIdentityNext = async () => {
    if (!guestName.trim()) { setSubmitError('Please enter your name.'); return; }
    if (!tableNumber.trim()) { setSubmitError('Please enter your table number.'); return; }
    setSubmitError('');
    if (guestEmail.trim()) {
      const isDup = await checkDuplicate();
      if (isDup) { setAlreadyOrdered(true); return; }
    }
    setStep('meal');
  };

  const handleSubmit = async () => {
    if (isSubmitting || !firestore) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      if (event?.orderingDeadline && new Date() > safeDate(event.orderingDeadline)) {
        setSubmitError('Sorry — the order window for this event has closed.');
        return;
      }

      let mealChoiceId: string | null = null;
      let mealChoiceName: string | null = null;

      if (hasCourses) {
        const missing = courses.filter((c: any) => !selectedCourseSelections[c.id]);
        if (missing.length > 0) {
          setSubmitError(`Please select all courses: ${missing.map((c: any) => c.name).join(', ')}`);
          return;
        }
        const firstCourse = courses[0];
        mealChoiceId = selectedCourseSelections[firstCourse?.id] || null;
        const firstItem = mealChoiceId ? menuItems.find(m => m.id === mealChoiceId) : null;
        mealChoiceName = firstItem?.name || null;
      } else {
        if (!selectedMealId) { setSubmitError('Please select your meal.'); return; }
        mealChoiceId = selectedMealId;
        mealChoiceName = menuItems.find(m => m.id === mealChoiceId)?.name || null;
      }

      await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
        id: nanoid(),
        eventId,
        tenantId,
        name: guestName.trim(),
        email: guestEmail.toLowerCase().trim() || null,
        phone: guestPhone.trim() || null,
        tableNumber: tableNumber.trim(),
        seatNumber: seatNumber.trim() || null,
        mealChoiceId,
        mealChoiceName,
        courseSelections: hasCourses ? selectedCourseSelections : null,
        allergies: selectedAllergies,
        allergyNote: allergyNote.trim() || null,
        hasCriticalAllergy: selectedAllergies.some(a => a.severity === 'critical'),
        guestNote: guestNote.trim() || null,
        submittedAt: new Date().toISOString(),
        checkedIn: false,
        source: 'self_register',
        status: 'submitted',
      });

      setStep('done');
    } catch (e) {
      console.error(e);
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (dataLoading || !event || !tenant) return <PageLoader />;

  const eventDisplayName = event.title || event.name || 'Event';
  const logoUrl = tenant.kioskSettings?.logoUrl || tenant.bookingPageSettings?.logoUrl;
  const primaryColor = tenant.kioskSettings?.primaryColor || tenant.bookingPageSettings?.primaryColor;
  const btnStyle = primaryColor ? { backgroundColor: primaryColor, color: '#fff' } : undefined;

  // ── Already ordered ───────────────────────────────────────────────────────
  if (alreadyOrdered && existingOrder) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-xl p-8 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Already Submitted</h2>
            <p className="text-slate-500 text-sm mt-2">
              We already have your order for this event, {existingOrder.name?.split(' ')[0]}.
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your Selection</p>
            <p className="font-black text-slate-900">{existingOrder.mealChoiceName || 'Multi-course selection'}</p>
            {existingOrder.allergies?.length > 0 && (
              <p className="text-xs text-amber-600">
                ⚠ {existingOrder.allergies.map((a: any) => typeof a === 'object' ? a.label : a).join(', ')}
              </p>
            )}
            <p className="text-[9px] text-slate-400">
              Table {existingOrder.tableNumber}{existingOrder.seatNumber ? ` · Seat ${existingOrder.seatNumber}` : ''}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Need to make changes? Contact your host.</p>
            <button
              onClick={async () => {
                if (!firestore || !existingOrder) return;
                const confirmed = window.confirm('Cancel your order for this event? This cannot be undone.');
                if (!confirmed) return;
                await deleteDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, existingOrder.id));
                setAlreadyOrdered(false);
                setExistingOrder(null);
              }}
              className="text-xs text-red-400 font-bold hover:text-red-600 transition-colors underline"
            >
              Cancel my order
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Event closed ──────────────────────────────────────────────────────────
  if (!isEventOpen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-xl p-8 text-center space-y-6">
          {logoUrl && (
            <div className="relative w-16 h-16 mx-auto rounded-2xl overflow-hidden">
              <Image src={logoUrl} alt={tenant.name || ''} fill className="object-cover" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{eventDisplayName}</h1>
            <p className="text-slate-500 text-sm mt-2">Pre-orders for this event are now closed.</p>
            {event.orderingDeadline && (
              <p className="text-xs text-slate-400 mt-1">
                Deadline was {format(safeDate(event.orderingDeadline), 'MMM d at h:mm a')}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Step helpers ──────────────────────────────────────────────────────────
  const totalSteps = 4;
  const stepIndex: Record<Step, number> = {
    pin: 0, identity: 0, meal: 1, allergies: 2, confirm: 3, done: 4,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-6 space-y-2">
          {logoUrl && (
            <div className="relative w-14 h-14 mx-auto rounded-2xl overflow-hidden shadow-md">
              <Image src={logoUrl} alt={tenant.name || ''} fill className="object-cover" />
            </div>
          )}
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{eventDisplayName}</h1>
          {event.date && (
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              {format(safeDate(event.date), 'EEEE, MMMM d')}
              {event.time && ` · ${event.time}`}
            </p>
          )}
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-xl overflow-hidden">
          {step !== 'pin' && step !== 'done' && (
            <div className="p-6 border-b border-slate-100">
              <StepDots total={totalSteps} current={stepIndex[step]} />
            </div>
          )}

          <AnimatePresence mode="wait">

            {/* ── PIN GATE ── */}
            {step === 'pin' && requiresPin && (
              <motion.div key="pin" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-6">
                <div className="space-y-1 text-center">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Private Event</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Enter Access PIN</h2>
                  <p className="text-sm text-slate-500">This event requires a PIN to access the order form.</p>
                </div>
                <div className="space-y-3">
                  <input
                    type="password" inputMode="numeric" maxLength={6} value={pinEntry}
                    onChange={e => { setPinEntry(e.target.value.replace(/\D/g, '')); setPinError(false); }}
                    onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
                    placeholder="Enter PIN"
                    className={cn(
                      'w-full h-14 rounded-2xl border-2 px-4 text-center text-2xl font-black tracking-[0.5em] outline-none transition-all',
                      pinError ? 'border-red-400 bg-red-50 text-red-800' : 'border-slate-200 focus:border-slate-400'
                    )}
                    autoFocus
                  />
                  {pinError && <p className="text-center text-sm font-bold text-red-500">Incorrect PIN. Please try again.</p>}
                </div>
                <button onClick={handlePinSubmit} disabled={!pinEntry} style={pinEntry ? btnStyle : undefined}
                  className={cn('w-full h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2',
                    pinEntry ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ── STEP 1: Identity ── */}
            {step === 'identity' && (
              <motion.div key="identity" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 1 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Info</h2>
                  <p className="text-sm text-slate-500">So we can personalize your place setting.</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <User className="w-3 h-3" /> Full Name *
                    </label>
                    <input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Your full name"
                      className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 font-bold text-slate-900 outline-none focus:border-slate-400 transition-all" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3" /> Table *
                      </label>
                      <input value={tableNumber} onChange={e => setTableNumber(e.target.value)} placeholder="e.g. 4"
                        className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 font-bold text-slate-900 text-center outline-none focus:border-slate-400 transition-all" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Seat (optional)</label>
                      <input value={seatNumber} onChange={e => setSeatNumber(e.target.value)} placeholder="e.g. A"
                        className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 font-bold text-slate-900 text-center outline-none focus:border-slate-400 transition-all" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Email (optional, for confirmation)</label>
                    <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="your@email.com"
                      className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 font-bold text-slate-900 outline-none focus:border-slate-400 transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Phone (optional)</label>
                    <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} placeholder="(555) 000-0000"
                      className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 font-bold text-slate-900 outline-none focus:border-slate-400 transition-all" />
                  </div>
                </div>
                {submitError && <p className="text-red-500 text-sm font-bold">{submitError}</p>}
                <button onClick={handleIdentityNext} style={btnStyle}
                  className={cn('w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2', !btnStyle && 'bg-slate-900 text-white')}>
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ── STEP 2: Meal — single course ── */}
            {step === 'meal' && !hasCourses && (
              <motion.div key="meal-single" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 2 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Meal</h2>
                  {event.menuNote && <p className="text-sm text-slate-500">{event.menuNote}</p>}
                </div>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {menuItems.map(item => (
                    <MealOptionCard key={item.id} option={item}
                      selected={selectedMealId === item.id}
                      onSelect={() => setSelectedMealId(item.id)} />
                  ))}
                  {menuItems.length === 0 && (
                    <div className="p-8 text-center text-slate-400 border-2 border-dashed rounded-2xl">
                      <Utensils className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm font-bold">Menu not yet configured</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('identity')} className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (!selectedMealId) { setSubmitError('Please select a meal.'); return; } setSubmitError(''); setStep('allergies'); }}
                    style={selectedMealId ? btnStyle : undefined}
                    className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2',
                      selectedMealId ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
                    Continue <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                {submitError && <p className="text-red-500 text-sm font-bold">{submitError}</p>}
              </motion.div>
            )}

            {/* ── STEP 2+: Multi-course ── */}
            {step === 'meal' && hasCourses && (() => {
              const course = courses[currentCourseIdx];
              if (!course) return null;
              const isLast = currentCourseIdx === courses.length - 1;
              const hasSelection = !!selectedCourseSelections[course.id];
              return (
                <motion.div key={`course-${course.id}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                  <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                      Course {currentCourseIdx + 1} of {courses.length}
                    </p>
                    <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{course.name}</h2>
                    {course.note && <p className="text-sm text-slate-500">{course.note}</p>}
                  </div>
                  <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                    {(course.options || []).map((option: any) => (
                      <MealOptionCard key={option.id} option={option}
                        selected={selectedCourseSelections[course.id] === option.id}
                        onSelect={() => setSelectedCourseSelections(prev => ({ ...prev, [course.id]: option.id }))} />
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => currentCourseIdx === 0 ? setStep('identity') : setCurrentCourseIdx(i => i - 1)}
                      className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (!hasSelection) { setSubmitError(`Please select ${course.name}.`); return; }
                        setSubmitError('');
                        if (!isLast) setCurrentCourseIdx(i => i + 1);
                        else setStep('allergies');
                      }}
                      style={hasSelection ? btnStyle : undefined}
                      className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2',
                        hasSelection ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
                      {isLast ? 'Continue' : `Next: ${courses[currentCourseIdx + 1]?.name || 'Course'}`} <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  {submitError && <p className="text-red-500 text-sm font-bold">{submitError}</p>}
                </motion.div>
              );
            })()}

            {/* ── STEP 3: Allergies ── */}
            {step === 'allergies' && (
              <motion.div key="allergies" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 3 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Allergies & Dietary</h2>
                  <p className="text-sm text-slate-500">Select all that apply. Goes directly to the kitchen.</p>
                </div>

                {(['critical', 'intolerance', 'preference'] as AllergySeverity[]).map(severity => {
                  const cfg = SEVERITY_CONFIG[severity];
                  const opts = ALLERGY_OPTIONS.filter(o => o.severity === severity);
                  return (
                    <div key={severity} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border', cfg.badge)}>
                          {severity === 'critical' ? '⚠ ' : ''}{cfg.label}
                        </span>
                        {severity === 'critical' && (
                          <span className="text-[9px] text-red-500 font-bold">Kitchen will be notified immediately</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {opts.map(opt => {
                          const selected = selectedAllergies.some(a => a.id === opt.id);
                          return (
                            <button key={opt.id}
                              onClick={() => setSelectedAllergies(prev =>
                                prev.some(a => a.id === opt.id)
                                  ? prev.filter(a => a.id !== opt.id)
                                  : [...prev, { id: opt.id, label: opt.label, severity: opt.severity }]
                              )}
                              className={cn('flex items-center gap-2 p-3 rounded-xl border-2 text-left transition-all',
                                selected ? cn(cfg.bg, cfg.border) : 'border-slate-200 hover:border-slate-300'
                              )}>
                              <span className="text-lg">{opt.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <p className={cn('text-[10px] font-black uppercase tracking-tight', selected ? cfg.text : 'text-slate-700')}>
                                  {opt.label}
                                </p>
                                {opt.hint && <p className="text-[8px] text-slate-400 font-bold truncate">{opt.hint}</p>}
                              </div>
                              {selected && <Check className={cn('w-3 h-3 ml-auto shrink-0', cfg.text)} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Additional notes (optional)</label>
                  <textarea value={allergyNote} onChange={e => setAllergyNote(e.target.value)} rows={2}
                    placeholder="e.g. Severe nut allergy — please ensure no cross-contamination"
                    className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 transition-all resize-none" />
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setStep('meal')} className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setStep('confirm')} style={btnStyle}
                    className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2', !btnStyle && 'bg-slate-900 text-white')}>
                    Review Order <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── STEP 4: Confirm ── */}
            {step === 'confirm' && (
              <motion.div key="confirm" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 4 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Confirm Order</h2>
                </div>

                <div className="space-y-3">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</p>
                    <p className="font-black text-slate-900">{guestName}</p>
                    {guestPhone && <p className="text-xs text-slate-500">{guestPhone}</p>}
                    <p className="text-xs text-slate-500">
                      Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}
                    </p>
                  </div>

                  {!hasCourses && selectedMealId && (
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Meal</p>
                      <p className="font-black text-slate-900">{menuItems.find(m => m.id === selectedMealId)?.name}</p>
                    </div>
                  )}

                  {hasCourses && (
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Courses</p>
                      {courses.map((course: any) => {
                        const selOption = (course.options || []).find((o: any) => o.id === selectedCourseSelections[course.id]);
                        return (
                          <div key={course.id} className="flex justify-between">
                            <p className="text-xs font-bold text-slate-500 uppercase">{course.name}</p>
                            <p className="text-xs font-black text-slate-900">{selOption?.name || '—'}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(selectedAllergies.length > 0 || allergyNote) && (
                    <div className={cn('p-4 rounded-2xl border space-y-2',
                      selectedAllergies.some(a => a.severity === 'critical') ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                    )}>
                      {selectedAllergies.some(a => a.severity === 'critical') && (
                        <p className="text-[9px] font-black uppercase tracking-widest text-red-600">⚠ Critical Allergy — Kitchen Will Be Notified</p>
                      )}
                      {(['critical', 'intolerance', 'preference'] as AllergySeverity[]).map(severity => {
                        const items = selectedAllergies.filter(a => a.severity === severity);
                        if (!items.length) return null;
                        const cfg = SEVERITY_CONFIG[severity];
                        return (
                          <div key={severity}>
                            <p className={cn('text-[9px] font-black uppercase tracking-widest', cfg.text)}>{cfg.label}</p>
                            <p className={cn('font-bold text-sm mt-0.5', cfg.text)}>{items.map(a => a.label).join(', ')}</p>
                          </div>
                        );
                      })}
                      {allergyNote && <p className="text-xs text-amber-700 italic">{allergyNote}</p>}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-3 h-3" /> Note to host (optional)
                    </label>
                    <textarea value={guestNote} onChange={e => setGuestNote(e.target.value)} rows={2}
                      placeholder="Anything else we should know?"
                      className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 resize-none" />
                  </div>
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-2 border-slate-300 cursor-pointer shrink-0" />
                  <span className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    I confirm the allergy and dietary information above is accurate. I understand this information will be shared with kitchen staff to ensure my safety.
                  </span>
                </label>

                {submitError && <p className="text-red-500 text-sm font-bold">{submitError}</p>}

                <div className="flex gap-3">
                  <button onClick={() => setStep('allergies')} className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={handleSubmit} disabled={isSubmitting || !consentGiven}
                    style={consentGiven ? btnStyle : undefined}
                    className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-50',
                      consentGiven ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
                    {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : 'Submit Order →'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── DONE ── */}
            {step === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="p-8 text-center space-y-6">
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 140 }}
                  className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </motion.div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Order Received</h2>
                  <p className="text-slate-500 text-sm">
                    Thank you, {guestName.split(' ')[0]}! We have your selection for {eventDisplayName}.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}
                  </p>
                  {!hasCourses && selectedMealId && (
                    <p className="font-black text-slate-900">{menuItems.find(m => m.id === selectedMealId)?.name}</p>
                  )}
                  {selectedAllergies.length > 0 && (
                    <p className="text-xs text-amber-600 font-bold">⚠ {selectedAllergies.map(a => a.label).join(', ')}</p>
                  )}
                </div>
                <p className="text-xs text-slate-400">You're all set. See you at the event!</p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── DEFAULT EXPORT — Suspense required for useSearchParams in Next.js 15 ─────
export default function EventGuestOrderPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <EventGuestOrderPageInner />
    </Suspense>
  );
}