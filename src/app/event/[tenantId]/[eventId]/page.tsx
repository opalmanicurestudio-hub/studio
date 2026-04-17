'use client';
/**
 * /event/[tenantId]/[eventId]/page.tsx
 * Pre-event guest order collection — immersive, brand-driven, personalized.
 * Aesthetic: editorial luxury. Dark canvas. Brand color as accent.
 * Typography: Cormorant Garamond display + DM Sans body.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { Check, ChevronRight, Loader, AlertTriangle, Utensils, MapPin, FileText, CheckCircle2, ArrowLeft, Lock } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';

// ─── Google Fonts ─────────────────────────────────────────────────────────────
// Load in layout or _document: Cormorant Garamond + DM Sans
// <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;700&display=swap" rel="stylesheet" />

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (v: any) => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v === 'string') return parseISO(v);
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return new Date(v);
};

const firstName = (name: string) => name.trim().split(' ')[0];

// ─── ALLERGY OPTIONS ──────────────────────────────────────────────────────────
type AllergySeverity = 'preference' | 'intolerance' | 'critical';
type AllergyObj = { id: string; label: string; emoji: string; severity: AllergySeverity; hint?: string };

const ALLERGY_OPTIONS: AllergyObj[] = [
  { id: 'peanuts',    label: 'Peanuts',      emoji: '🥜', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'nuts',       label: 'Tree Nuts',    emoji: '🌰', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'shellfish',  label: 'Shellfish',    emoji: '🦐', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'fish',       label: 'Fish',         emoji: '🐟', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'eggs',       label: 'Eggs',         emoji: '🥚', severity: 'critical',    hint: 'Anaphylaxis risk' },
  { id: 'gluten',     label: 'Gluten',       emoji: '🌾', severity: 'intolerance', hint: 'Celiac or intolerance' },
  { id: 'dairy',      label: 'Dairy',        emoji: '🥛', severity: 'intolerance', hint: 'Lactose intolerance' },
  { id: 'soy',        label: 'Soy',          emoji: '🫘', severity: 'intolerance', hint: 'Soy intolerance' },
  { id: 'vegan',      label: 'Vegan',        emoji: '🌿', severity: 'preference' },
  { id: 'vegetarian', label: 'Vegetarian',   emoji: '🥦', severity: 'preference' },
  { id: 'kosher',     label: 'Kosher',       emoji: '✡️',  severity: 'preference' },
  { id: 'halal',      label: 'Halal',        emoji: '☪️',  severity: 'preference' },
];

const SEVERITY_CONFIG = {
  critical:    { ring: 'ring-red-400',    bg: 'bg-red-950/40',   text: 'text-red-300',   badge: 'text-red-400 border-red-400/30 bg-red-400/10' },
  intolerance: { ring: 'ring-amber-400',  bg: 'bg-amber-950/40', text: 'text-amber-300', badge: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  preference:  { ring: 'ring-white/20',   bg: 'bg-white/5',      text: 'text-white/60',  badge: 'text-white/50 border-white/10 bg-white/5' },
};

// ─── AMBIENT GRADIENT ─────────────────────────────────────────────────────────
const AmbientBg = ({ hex }: { hex?: string }) => (
  <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
    <div className="absolute inset-0 bg-[#0a0a0b]" />
    {/* Grain texture */}
    <div className="absolute inset-0 opacity-[0.035]"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`, backgroundSize: '128px 128px' }} />
    {/* Brand color ambient */}
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2 }}
      className="absolute -top-1/4 -left-1/4 w-3/4 h-3/4 rounded-full blur-[120px] opacity-20"
      style={{ backgroundColor: hex || '#c9a96e' }} />
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2, delay: 0.5 }}
      className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full blur-[100px] opacity-10"
      style={{ backgroundColor: hex || '#c9a96e' }} />
  </div>
);

// ─── STEP INDICATOR ───────────────────────────────────────────────────────────
const StepIndicator = ({ steps, current, hex }: { steps: string[]; current: number; hex?: string }) => (
  <div className="flex items-center gap-0">
    {steps.map((label, i) => (
      <React.Fragment key={i}>
        <div className="flex flex-col items-center gap-1">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all duration-500',
            i < current  ? 'bg-white/20 text-white/60' :
            i === current ? 'text-black font-black' : 'bg-white/5 text-white/20'
          )} style={i === current ? { backgroundColor: hex || '#c9a96e' } : {}}>
            {i < current ? <Check className="w-3 h-3" /> : i + 1}
          </div>
          <span className={cn('text-[7px] font-bold uppercase tracking-widest transition-all',
            i === current ? 'text-white/60' : 'text-white/20')}>
            {label}
          </span>
        </div>
        {i < steps.length - 1 && (
          <div className={cn('h-px flex-1 mx-2 mb-4 transition-all duration-700',
            i < current ? 'bg-white/20' : 'bg-white/5')} style={{ width: '2rem' }} />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ─── MEAL CARD ────────────────────────────────────────────────────────────────
const MealCard = ({ option, selected, onSelect, hex }: {
  option: any; selected: boolean; onSelect: () => void; hex?: string;
}) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-30, 30], [4, -4]);
  const rotateY = useTransform(x, [-30, 30], [-4, 4]);
  const ref = useRef<HTMLButtonElement>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top - rect.height / 2);
  };

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { x.set(0); y.set(0); }}
      whileTap={{ scale: 0.97 }}
      onClick={onSelect}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      className={cn(
        'relative w-full text-left rounded-2xl overflow-hidden border transition-all duration-300',
        selected
          ? 'border-transparent shadow-2xl'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
      )}
      style={{ perspective: '800px', ...(selected ? { borderColor: hex || '#c9a96e' } : {}) }}>
      {/* Selected glow */}
      {selected && (
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${hex || '#c9a96e'}, transparent 70%)` }} />
      )}

      {option.imageUrl ? (
        <div className="relative w-full h-40 overflow-hidden">
          <Image src={option.imageUrl} alt={option.name} fill className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          {selected && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-xl">
              <Check className="w-3.5 h-3.5 text-black" />
            </motion.div>
          )}
          <div className="absolute bottom-3 left-4 right-4">
            <p className="font-['Cormorant_Garamond'] text-xl font-semibold text-white leading-tight">{option.name}</p>
          </div>
        </div>
      ) : (
        <div className="p-5 flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="font-['Cormorant_Garamond'] text-xl font-semibold text-white leading-tight">{option.name}</p>
            {option.description && (
              <p className="text-[11px] text-white/40 mt-1 leading-relaxed font-['DM_Sans']">{option.description}</p>
            )}
          </div>
          {selected && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
              className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-black" />
            </motion.div>
          )}
        </div>
      )}

      {option.imageUrl && option.description && (
        <p className="px-4 pb-4 text-[11px] text-white/40 leading-relaxed font-['DM_Sans']">{option.description}</p>
      )}

      {/* Allergy flags */}
      {option.allergyFlags?.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-3">
          {option.allergyFlags.map((flag: string) => (
            <span key={flag} className="text-[8px] font-bold uppercase px-2 py-0.5 rounded-full border border-white/10 text-white/30">
              {flag}
            </span>
          ))}
        </div>
      )}
    </motion.button>
  );
};

// ─── ALLERGY TOGGLE ───────────────────────────────────────────────────────────
const AllergyToggle = ({ opt, selected, onToggle }: {
  opt: AllergyObj; selected: boolean; onToggle: () => void;
}) => {
  const cfg = SEVERITY_CONFIG[opt.severity];
  return (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onToggle}
      className={cn(
        'flex items-center gap-2.5 p-3 rounded-xl border transition-all duration-200 text-left',
        selected ? cn('border ring-1', cfg.ring, cfg.bg) : 'border-white/8 bg-white/[0.02] hover:border-white/15'
      )}>
      <span className="text-base leading-none">{opt.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[11px] font-bold uppercase tracking-wide font-[\'DM_Sans\']',
          selected ? cfg.text : 'text-white/50')}>
          {opt.label}
        </p>
        {opt.hint && <p className="text-[9px] text-white/25 mt-0.5">{opt.hint}</p>}
      </div>
      {selected && <Check className={cn('w-3 h-3 shrink-0', cfg.text)} />}
    </motion.button>
  );
};

// ─── PIN GATE ─────────────────────────────────────────────────────────────────
const PinGate = ({ logoUrl, studioName, eventName, onSubmit, error, hex }: {
  logoUrl?: string; studioName?: string; eventName?: string;
  onSubmit: (pin: string) => void; error: boolean; hex?: string;
}) => {
  const [pin, setPin] = useState('');
  return (
    <motion.div key="pin" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm mx-auto text-center space-y-8 px-6 py-12">
      {logoUrl && (
        <div className="relative w-16 h-16 mx-auto rounded-2xl overflow-hidden">
          <Image src={logoUrl} alt={studioName || ''} fill className="object-cover" />
        </div>
      )}
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-white/30 font-['DM_Sans'] mb-2">Private Event</p>
        <h1 className="font-['Cormorant_Garamond'] text-4xl font-light text-white italic">{eventName}</h1>
      </div>
      <div className="space-y-3">
        <input
          type="password" inputMode="numeric" maxLength={6} value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key === 'Enter' && pin && onSubmit(pin)}
          placeholder="Access PIN"
          className={cn(
            'w-full h-14 rounded-2xl bg-white/5 border px-5 text-center text-2xl font-bold tracking-[0.5em] text-white outline-none transition-all font-[\'DM_Sans\']',
            error ? 'border-red-500/50 bg-red-950/20 text-red-300' : 'border-white/10 focus:border-white/25'
          )}
          autoFocus
        />
        {error && <p className="text-red-400 text-xs font-bold uppercase tracking-widest">Incorrect PIN</p>}
      </div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => pin && onSubmit(pin)}
        disabled={!pin}
        className="w-full h-13 py-4 rounded-2xl font-bold uppercase tracking-widest text-sm disabled:opacity-30 transition-all font-['DM_Sans']"
        style={{ backgroundColor: hex || '#c9a96e', color: '#0a0a0b' }}>
        Enter →
      </motion.button>
    </motion.div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
type Step = 'pin' | 'identity' | 'meal' | 'allergies' | 'confirm' | 'done';

export default function EventGuestOrderPage() {
  const params    = useParams();
  const tenantId  = params.tenantId as string;
  const eventId   = params.eventId  as string;
  const { firestore } = useFirebase();
  const { toast }     = useToast();

  const eventRef  = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/studioEvents/${eventId}`), [firestore, tenantId, eventId]);
  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const { data: event }  = useDoc<any>(eventRef);
  const { data: tenant } = useDoc<any>(tenantRef);

  // ── Theming from tenant ───────────────────────────────────────────────────
  const brandHex  = tenant?.kioskSettings?.primaryColor || tenant?.bookingPageSettings?.primaryColor || '#c9a96e';
  const logoUrl   = tenant?.kioskSettings?.logoUrl || tenant?.bookingPageSettings?.logoUrl;
  const studioName = tenant?.name || 'Studio';

  // ── Form state ────────────────────────────────────────────────────────────
  const [step, setStep]                   = useState<Step>('pin');
  const [pinEntry, setPinEntry]           = useState('');
  const [pinError, setPinError]           = useState(false);
  const [guestName, setGuestName]         = useState('');
  const [guestEmail, setGuestEmail]       = useState('');
  const [guestPhone, setGuestPhone]       = useState('');
  const [tableNumber, setTableNumber]     = useState('');
  const [seatNumber, setSeatNumber]       = useState('');
  const [selectedMealId, setSelectedMealId] = useState<string | null>(null);
  const [selectedCourseSelections, setSelectedCourseSelections] = useState<Record<string, string>>({});
  const [currentCourseIdx, setCurrentCourseIdx] = useState(0);
  const [selectedAllergies, setSelectedAllergies] = useState<AllergyObj[]>([]);
  const [allergyNote, setAllergyNote]     = useState('');
  const [guestNote, setGuestNote]         = useState('');
  const [consentGiven, setConsentGiven]   = useState(false);
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [existingOrder, setExistingOrder] = useState<any>(null);
  const [alreadyOrdered, setAlreadyOrdered] = useState(false);

  const requiresPin = !!(event?.accessPin);

  const isEventOpen = useMemo(() => {
    if (!event) return false;
    if (event.orderingDeadline && new Date() > safeDate(event.orderingDeadline)) return false;
    return ['open', 'published', 'upcoming', 'active'].includes(event.status);
  }, [event]);

  const courses: any[]  = useMemo(() => event?.courses || [], [event]);
  const hasCourses      = courses.length > 0;
  const eventDisplayName = event?.title || event?.name || 'Event';

  // Auto-skip pin if not required
  useEffect(() => {
    if (event && step === 'pin' && !requiresPin) setStep('identity');
  }, [event, requiresPin, step]);

  const handlePinSubmit = (pin: string) => {
    if (pin === String(event?.accessPin)) { setPinError(false); setStep('identity'); }
    else { setPinError(true); setPinEntry(''); }
  };

  const checkDuplicate = async () => {
    if (!guestEmail.trim() || !firestore) return false;
    const snap = await getDocs(query(
      collection(firestore, `tenants/${tenantId}/eventGuests`),
      where('email', '==', guestEmail.toLowerCase().trim()),
      where('eventId', '==', eventId)
    ));
    if (!snap.empty) { setExistingOrder({ id: snap.docs[0].id, ...snap.docs[0].data() }); return true; }
    return false;
  };

  const handleIdentityNext = async () => {
    if (!guestName.trim()) { toast({ variant: 'destructive', title: 'Please enter your name' }); return; }
    if (!tableNumber.trim()) { toast({ variant: 'destructive', title: 'Please enter your table number' }); return; }
    if (guestEmail.trim() && await checkDuplicate()) { setAlreadyOrdered(true); return; }
    setStep('meal');
  };

  const handleSubmit = async () => {
    if (isSubmitting || !firestore) return;
    if (!selectedMealId && !hasCourses) { toast({ variant: 'destructive', title: 'Please select your meal' }); return; }
    setIsSubmitting(true);
    try {
      // Late deadline check
      if (event?.orderingDeadline && new Date() > safeDate(event.orderingDeadline)) {
        toast({ variant: 'destructive', title: 'Sorry — orders for this event have closed' }); return;
      }
      await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
        id: nanoid(),
        eventId, tenantId,
        name: guestName.trim(),
        email: guestEmail.toLowerCase().trim() || null,
        phone: guestPhone.trim() || null,
        tableNumber: tableNumber.trim(),
        seatNumber: seatNumber.trim() || null,
        mealChoiceId: selectedMealId || null,
        mealChoiceName: (event?.menuItems || []).find((m: any) => m.id === selectedMealId)?.name || null,
        courseSelections: hasCourses ? selectedCourseSelections : null,
        allergies: selectedAllergies,
        allergyNote: allergyNote.trim() || null,
        hasCriticalAllergy: selectedAllergies.some(a => a.severity === 'critical'),
        guestNote: guestNote.trim() || null,
        submittedAt: new Date().toISOString(),
        checkedIn: false, source: 'self_register', status: 'submitted',
      });
      setStep('done');
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Something went wrong — please try again' });
    } finally { setIsSubmitting(false); }
  };

  // Steps config
  const stepLabels = hasCourses
    ? ['You', ...courses.map((c: any) => c.name), 'Dietary', 'Confirm']
    : ['You', 'Menu', 'Dietary', 'Confirm'];

  const stepIndex: Record<Step, number> = {
    pin: -1, identity: 0, meal: 1,
    allergies: hasCourses ? courses.length + 1 : 2,
    confirm: hasCourses ? courses.length + 2 : 3,
    done: hasCourses ? courses.length + 3 : 4,
  };

  if (!event || !tenant) return (
    <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2, repeat: Infinity }}>
        <Utensils className="w-6 h-6 text-white/20" />
      </motion.div>
    </div>
  );

  // ── Already ordered ────────────────────────────────────────────────────────
  if (alreadyOrdered && existingOrder) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
        <AmbientBg hex={brandHex} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-6 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-950/40 border border-amber-400/20 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <div>
            <h2 className="font-['Cormorant_Garamond'] text-4xl font-light text-white italic">
              Already Reserved
            </h2>
            <p className="text-white/40 text-sm mt-2 font-['DM_Sans']">
              We have your order, {firstName(existingOrder.name)}.
            </p>
          </div>
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/8 text-left space-y-2">
            <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">Your Selection</p>
            <p className="font-['Cormorant_Garamond'] text-xl text-white">{existingOrder.mealChoiceName || 'Multi-course selection'}</p>
            {existingOrder.allergies?.length > 0 && (
              <p className="text-xs text-amber-400/70 font-['DM_Sans']">
                ⚠ {existingOrder.allergies.map((a: any) => typeof a === 'object' ? a.label : a).join(', ')}
              </p>
            )}
            <p className="text-[9px] text-white/25 font-['DM_Sans']">
              Table {existingOrder.tableNumber}{existingOrder.seatNumber ? ` · Seat ${existingOrder.seatNumber}` : ''}
            </p>
          </div>
          <p className="text-xs text-white/25 font-['DM_Sans']">Need to make a change? Contact your host.</p>
        </motion.div>
      </div>
    );
  }

  // ── Event closed ──────────────────────────────────────────────────────────
  if (!isEventOpen && step !== 'done') {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
        <AmbientBg hex={brandHex} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-6 text-center">
          {logoUrl && <div className="relative w-16 h-16 mx-auto rounded-2xl overflow-hidden"><Image src={logoUrl} alt={studioName} fill className="object-cover" /></div>}
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25 font-['DM_Sans'] mb-2">{studioName}</p>
            <h1 className="font-['Cormorant_Garamond'] text-4xl font-light text-white italic">{eventDisplayName}</h1>
            <p className="text-white/40 text-sm mt-3 font-['DM_Sans']">Pre-orders are now closed.</p>
            {event.orderingDeadline && (
              <p className="text-white/20 text-xs mt-1 font-['DM_Sans']">
                Deadline was {format(safeDate(event.orderingDeadline), 'MMM d at h:mm a')}
              </p>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] font-['DM_Sans']">
      <AmbientBg hex={brandHex} />

      {/* ── HEADER ── */}
      {step !== 'pin' && step !== 'done' && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="sticky top-0 z-20 px-6 pt-6 pb-4 bg-gradient-to-b from-[#0a0a0b] to-transparent">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {logoUrl && (
                  <div className="relative w-8 h-8 rounded-lg overflow-hidden">
                    <Image src={logoUrl} alt={studioName} fill className="object-cover" />
                  </div>
                )}
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">{studioName}</p>
                  <p className="font-['Cormorant_Garamond'] text-sm text-white/60 italic">{eventDisplayName}</p>
                </div>
              </div>
              {guestName && (
                <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                  className="text-right">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-white/20">Welcome</p>
                  <p className="font-['Cormorant_Garamond'] text-base text-white/70 italic">{firstName(guestName)}</p>
                </motion.div>
              )}
            </div>
            <StepIndicator steps={stepLabels} current={stepIndex[step] ?? 0} hex={brandHex} />
          </div>
        </motion.div>
      )}

      <div className="max-w-lg mx-auto px-6 pb-16">
        <AnimatePresence mode="wait">

          {/* ── PIN ── */}
          {step === 'pin' && requiresPin && (
            <PinGate key="pin"
              logoUrl={logoUrl} studioName={studioName} eventName={eventDisplayName}
              onSubmit={handlePinSubmit} error={pinError} hex={brandHex} />
          )}

          {/* ── IDENTITY ── */}
          {step === 'identity' && (
            <motion.div key="identity" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              className="pt-4 space-y-8">
              <div className="space-y-1">
                <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">Step 1</p>
                <h2 className="font-['Cormorant_Garamond'] text-5xl font-light text-white leading-none italic">
                  Tell us about<br />yourself
                </h2>
                <p className="text-white/30 text-sm pt-1">We'll use this to personalize your evening.</p>
              </div>

              <div className="space-y-3">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">Full Name *</label>
                  <input value={guestName} onChange={e => setGuestName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full h-13 py-4 rounded-xl bg-white/[0.04] border border-white/8 px-4 text-white font-medium outline-none focus:border-white/20 transition-all placeholder:text-white/15" />
                </div>
                {/* Table + Seat */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25 flex items-center gap-1.5">
                      <MapPin className="w-2.5 h-2.5" /> Table *
                    </label>
                    <input value={tableNumber} onChange={e => setTableNumber(e.target.value)}
                      placeholder="e.g. 4"
                      className="w-full h-13 py-4 rounded-xl bg-white/[0.04] border border-white/8 px-4 text-white font-medium text-center outline-none focus:border-white/20 transition-all placeholder:text-white/15" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">Seat</label>
                    <input value={seatNumber} onChange={e => setSeatNumber(e.target.value)}
                      placeholder="optional"
                      className="w-full h-13 py-4 rounded-xl bg-white/[0.04] border border-white/8 px-4 text-white font-medium text-center outline-none focus:border-white/20 transition-all placeholder:text-white/15" />
                  </div>
                </div>
                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">Email</label>
                  <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)}
                    placeholder="For confirmation (optional)"
                    className="w-full h-13 py-4 rounded-xl bg-white/[0.04] border border-white/8 px-4 text-white font-medium outline-none focus:border-white/20 transition-all placeholder:text-white/15" />
                </div>
                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">Phone</label>
                  <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                    placeholder="(555) 000-0000 (optional)"
                    className="w-full h-13 py-4 rounded-xl bg-white/[0.04] border border-white/8 px-4 text-white font-medium outline-none focus:border-white/20 transition-all placeholder:text-white/15" />
                </div>
              </div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={handleIdentityNext}
                className="w-full h-14 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: brandHex, color: '#0a0a0b' }}>
                Continue <ChevronRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}

          {/* ── MEAL (single course) ── */}
          {step === 'meal' && !hasCourses && (
            <motion.div key="meal" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              className="pt-4 space-y-8">
              <div className="space-y-1">
                <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">Your Menu</p>
                <h2 className="font-['Cormorant_Garamond'] text-5xl font-light text-white leading-none italic">
                  {guestName ? `${firstName(guestName)},` : ''}<br />
                  What will you have?
                </h2>
                {event.menuNote && <p className="text-white/30 text-sm pt-1">{event.menuNote}</p>}
              </div>

              <div className="space-y-3">
                {(event?.menuItems || []).map((item: any) => (
                  <MealCard key={item.id} option={item}
                    selected={selectedMealId === item.id}
                    onSelect={() => setSelectedMealId(item.id)}
                    hex={brandHex} />
                ))}
                {(!event?.menuItems || event.menuItems.length === 0) && (
                  <div className="p-10 text-center border border-white/8 rounded-2xl">
                    <Utensils className="w-8 h-8 mx-auto mb-3 text-white/10" />
                    <p className="text-white/20 text-sm">Menu not yet configured</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('identity')}
                  className="h-14 px-5 rounded-xl bg-white/5 border border-white/8 text-white/40 hover:text-white/60 transition-all">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={() => { if (!selectedMealId) { toast({ variant: 'destructive', title: 'Please select your meal' }); return; } setStep('allergies'); }}
                  disabled={!selectedMealId}
                  className="flex-1 h-14 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-30 transition-all"
                  style={selectedMealId ? { backgroundColor: brandHex, color: '#0a0a0b' } : {}}>
                  Continue <ChevronRight className="w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── MULTI-COURSE ── */}
          {step === 'meal' && hasCourses && (() => {
            const course = courses[currentCourseIdx];
            if (!course) return null;
            const isLast     = currentCourseIdx === courses.length - 1;
            const hasSelection = !!selectedCourseSelections[course.id];
            return (
              <motion.div key={`course-${course.id}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
                className="pt-4 space-y-8">
                <div className="space-y-1">
                  <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">
                    Course {currentCourseIdx + 1} of {courses.length}
                  </p>
                  <h2 className="font-['Cormorant_Garamond'] text-5xl font-light text-white leading-none italic">
                    {course.name}
                  </h2>
                  {course.note && <p className="text-white/30 text-sm pt-1">{course.note}</p>}
                </div>
                <div className="space-y-3">
                  {(course.options || []).map((option: any) => (
                    <MealCard key={option.id} option={option}
                      selected={selectedCourseSelections[course.id] === option.id}
                      onSelect={() => setSelectedCourseSelections(prev => ({ ...prev, [course.id]: option.id }))}
                      hex={brandHex} />
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => { if (currentCourseIdx === 0) setStep('identity'); else setCurrentCourseIdx(i => i - 1); }}
                    className="h-14 px-5 rounded-xl bg-white/5 border border-white/8 text-white/40 hover:text-white/60 transition-all">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      if (!hasSelection) { toast({ variant: 'destructive', title: `Please select ${course.name}` }); return; }
                      if (!isLast) setCurrentCourseIdx(i => i + 1);
                      else setStep('allergies');
                    }}
                    disabled={!hasSelection}
                    className="flex-1 h-14 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-30 transition-all"
                    style={hasSelection ? { backgroundColor: brandHex, color: '#0a0a0b' } : {}}>
                    {isLast ? 'Continue' : `Next: ${courses[currentCourseIdx + 1]?.name || 'Next'}`} <ChevronRight className="w-4 h-4" />
                  </motion.button>
                </div>
              </motion.div>
            );
          })()}

          {/* ── ALLERGIES ── */}
          {step === 'allergies' && (
            <motion.div key="allergies" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              className="pt-4 space-y-8">
              <div className="space-y-1">
                <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">Dietary & Allergies</p>
                <h2 className="font-['Cormorant_Garamond'] text-5xl font-light text-white leading-none italic">
                  Any dietary<br />needs?
                </h2>
                <p className="text-white/30 text-sm pt-1">Our kitchen takes this seriously. Select all that apply.</p>
              </div>

              {(['critical', 'intolerance', 'preference'] as AllergySeverity[]).map(severity => {
                const cfg  = SEVERITY_CONFIG[severity];
                const opts = ALLERGY_OPTIONS.filter(o => o.severity === severity);
                const sectionLabel = severity === 'critical' ? 'Critical Allergies' : severity === 'intolerance' ? 'Intolerances' : 'Dietary Preferences';
                return (
                  <div key={severity} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[8px] font-bold uppercase tracking-[0.25em] px-2 py-0.5 rounded-full border', cfg.badge)}>
                        {severity === 'critical' ? '⚠ ' : ''}{sectionLabel}
                      </span>
                      {severity === 'critical' && (
                        <span className="text-[8px] text-red-400/60 font-bold">Kitchen notified immediately</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {opts.map(opt => (
                        <AllergyToggle key={opt.id} opt={opt}
                          selected={selectedAllergies.some(a => a.id === opt.id)}
                          onToggle={() => setSelectedAllergies(prev =>
                            prev.some(a => a.id === opt.id)
                              ? prev.filter(a => a.id !== opt.id)
                              : [...prev, opt]
                          )} />
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25">Additional Notes</label>
                <textarea value={allergyNote} onChange={e => setAllergyNote(e.target.value)} rows={2}
                  placeholder="Anything the kitchen should know…"
                  className="w-full rounded-xl bg-white/[0.04] border border-white/8 px-4 py-3 text-sm text-white outline-none focus:border-white/20 transition-all resize-none placeholder:text-white/15" />
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('meal')}
                  className="h-14 px-5 rounded-xl bg-white/5 border border-white/8 text-white/40 hover:text-white/60 transition-all">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep('confirm')}
                  className="flex-1 h-14 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2"
                  style={{ backgroundColor: brandHex, color: '#0a0a0b' }}>
                  Review Order <ChevronRight className="w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── CONFIRM ── */}
          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              className="pt-4 space-y-6">
              <div className="space-y-1">
                <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">Almost Done</p>
                <h2 className="font-['Cormorant_Garamond'] text-5xl font-light text-white leading-none italic">
                  Confirm your<br />reservation
                </h2>
              </div>

              {/* Summary card */}
              <div className="rounded-2xl overflow-hidden border border-white/8 bg-white/[0.02] divide-y divide-white/5">
                {/* Guest */}
                <div className="p-5 space-y-0.5">
                  <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/20">Guest</p>
                  <p className="font-['Cormorant_Garamond'] text-2xl text-white">{guestName}</p>
                  <p className="text-xs text-white/25">
                    Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}
                    {guestEmail ? ` · ${guestEmail}` : ''}
                  </p>
                </div>
                {/* Meal */}
                {!hasCourses && selectedMealId && (
                  <div className="p-5 space-y-0.5">
                    <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/20">Selection</p>
                    <p className="font-['Cormorant_Garamond'] text-xl text-white">
                      {(event?.menuItems || []).find((m: any) => m.id === selectedMealId)?.name}
                    </p>
                  </div>
                )}
                {hasCourses && (
                  <div className="p-5 space-y-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/20">Courses</p>
                    {courses.map((course: any) => {
                      const sel = (course.options || []).find((o: any) => o.id === selectedCourseSelections[course.id]);
                      return (
                        <div key={course.id} className="flex justify-between items-baseline">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">{course.name}</p>
                          <p className="font-['Cormorant_Garamond'] text-base text-white">{sel?.name || '—'}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Allergies */}
                {selectedAllergies.length > 0 && (
                  <div className="p-5 space-y-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-amber-400/50">Dietary Flags</p>
                    {selectedAllergies.some(a => a.severity === 'critical') && (
                      <p className="text-[8px] font-bold uppercase tracking-widest text-red-400">⚠ Critical — Kitchen will be notified</p>
                    )}
                    <p className="text-sm text-white/50 font-['Cormorant_Garamond']">
                      {selectedAllergies.map(a => a.label).join(', ')}
                    </p>
                    {allergyNote && <p className="text-xs text-white/25 italic">{allergyNote}</p>}
                  </div>
                )}
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <label className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/25 flex items-center gap-1.5">
                  <FileText className="w-2.5 h-2.5" /> Note to host
                </label>
                <textarea value={guestNote} onChange={e => setGuestNote(e.target.value)} rows={2}
                  placeholder="Anything else we should know? (optional)"
                  className="w-full rounded-xl bg-white/[0.04] border border-white/8 px-4 py-3 text-sm text-white outline-none focus:border-white/20 transition-all resize-none placeholder:text-white/15" />
              </div>

              {/* Consent */}
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="mt-0.5 relative">
                  <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} className="sr-only" />
                  <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                    consentGiven ? 'border-transparent' : 'border-white/15 bg-white/5')}
                    style={consentGiven ? { backgroundColor: brandHex } : {}}>
                    {consentGiven && <Check className="w-3 h-3 text-black" />}
                  </div>
                </div>
                <span className="text-[10px] text-white/30 leading-relaxed">
                  I confirm the dietary information above is accurate. I understand it will be shared with kitchen staff for my safety.
                </span>
              </label>

              <div className="flex gap-3">
                <button onClick={() => setStep('allergies')}
                  className="h-14 px-5 rounded-xl bg-white/5 border border-white/8 text-white/40 hover:text-white/60 transition-all">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleSubmit}
                  disabled={isSubmitting || !consentGiven}
                  className="flex-1 h-14 rounded-xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-30 transition-all"
                  style={consentGiven ? { backgroundColor: brandHex, color: '#0a0a0b' } : {}}>
                  {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : 'Submit Reservation →'}
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="min-h-screen flex items-center justify-center px-6 py-20">
              <div className="text-center space-y-8 max-w-xs mx-auto">
                {/* Animated checkmark */}
                <motion.div
                  initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 120 }}
                  className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center"
                  style={{ backgroundColor: brandHex }}>
                  <Check className="w-10 h-10 text-black" strokeWidth={2.5} />
                </motion.div>

                <div className="space-y-3">
                  <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                    className="text-[8px] font-bold uppercase tracking-[0.35em] text-white/25">
                    {studioName}
                  </motion.p>
                  <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                    className="font-['Cormorant_Garamond'] text-5xl font-light text-white italic leading-tight">
                    We'll see you<br />there, {firstName(guestName)}.
                  </motion.h2>
                  <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                    className="text-white/35 text-sm">
                    Your reservation for {eventDisplayName} is confirmed.
                  </motion.p>
                </div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                  className="p-5 rounded-2xl bg-white/[0.03] border border-white/8 text-left space-y-2">
                  <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-white/20">Your Details</p>
                  <p className="font-['Cormorant_Garamond'] text-lg text-white/70">
                    Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}
                  </p>
                  {!hasCourses && selectedMealId && (
                    <p className="text-white/40 text-sm">
                      {(event?.menuItems || []).find((m: any) => m.id === selectedMealId)?.name}
                    </p>
                  )}
                  {selectedAllergies.length > 0 && (
                    <p className="text-xs" style={{ color: `${brandHex}99` }}>
                      ⚠ {selectedAllergies.map(a => a.label).join(', ')}
                    </p>
                  )}
                </motion.div>

                {event.date && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
                    className="text-white/15 text-xs uppercase tracking-widest">
                    {format(safeDate(event.date), 'EEEE, MMMM d')}
                    {event.time && ` at ${event.time}`}
                  </motion.p>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}