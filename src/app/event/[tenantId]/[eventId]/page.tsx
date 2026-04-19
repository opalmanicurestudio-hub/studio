'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, Loader, AlertTriangle, Utensils,
  ArrowLeft, Leaf, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';

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

// ─── STEP INDICATOR ───────────────────────────────────────────────────────────
const StepDots = ({ total, current }: { total: number; current: number }) => (
  <div className="flex items-center gap-1.5">
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} className={cn(
        'rounded-full transition-all duration-300',
        i === current ? 'w-6 h-2 bg-primary' :
        i < current  ? 'w-2 h-2 bg-primary/30' :
        'w-2 h-2 bg-slate-200'
      )} />
    ))}
  </div>
);

// ─── MEAL OPTION CARD ─────────────────────────────────────────────────────────
const MealOptionCard = ({ option, selected, onSelect }: {
  option: any; selected: boolean; onSelect: () => void;
}) => (
  <button onClick={onSelect}
    className={cn(
      'w-full text-left rounded-2xl border-2 overflow-hidden transition-all duration-200 active:scale-[0.98]',
      selected ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'border-slate-200 bg-white hover:border-slate-300'
    )}>
    {option.imageUrl && (
      <div className="relative w-full h-36 sm:h-44 overflow-hidden">
        <img src={option.imageUrl} alt={option.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        {selected && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg">
            <Check className="w-3.5 h-3.5 text-white" />
          </motion.div>
        )}
      </div>
    )}
    <div className="p-4 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-black text-slate-900 text-base leading-tight">{option.name}</p>
        {option.description && (
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{option.description}</p>
        )}
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {option.isVegan      && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide bg-emerald-50 border border-emerald-200 text-emerald-700"><Leaf className="w-2 h-2" />Vegan</span>}
          {option.isGlutenFree && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide bg-blue-50 border border-blue-200 text-blue-700">GF</span>}
        </div>
      </div>
      {!option.imageUrl && (
        <div className={cn('w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
          selected ? 'border-primary bg-primary' : 'border-slate-300')}>
          {selected && <Check className="w-3 h-3 text-white" />}
        </div>
      )}
    </div>
  </button>
);

// ─── ALLERGY CHIP ─────────────────────────────────────────────────────────────
const AllergyChip = ({ opt, selected, onToggle }: {
  opt: AllergyObj; selected: boolean; onToggle: () => void;
}) => {
  const styles = {
    critical:    { active: 'border-red-400 bg-red-50 text-red-800',    inactive: 'border-slate-200 bg-white text-slate-600 hover:border-red-200' },
    intolerance: { active: 'border-amber-400 bg-amber-50 text-amber-800', inactive: 'border-slate-200 bg-white text-slate-600 hover:border-amber-200' },
    preference:  { active: 'border-emerald-400 bg-emerald-50 text-emerald-800', inactive: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300' },
  };
  const s = styles[opt.severity];
  return (
    <button onClick={onToggle}
      className={cn(
        'flex items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150 active:scale-[0.97] text-left w-full',
        selected ? s.active : s.inactive
      )}>
      <span className="text-lg leading-none shrink-0">{opt.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black uppercase tracking-wide leading-none">{opt.label}</p>
        {opt.hint && <p className="text-[9px] mt-0.5 opacity-60">{opt.hint}</p>}
      </div>
      {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
    </button>
  );
};

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
const ProgressBar = ({ value }: { value: number }) => (
  <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
    <motion.div className="h-full bg-primary rounded-full" initial={{ width: 0 }}
      animate={{ width: `${value}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
  </div>
);

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
type Step = 'identity' | 'course' | 'allergies' | 'confirm' | 'done';

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

  const studioName       = tenant?.name || 'Studio';
  const eventDisplayName = event?.title || event?.name || 'Event';

  // ── Form state ────────────────────────────────────────────────────────────
  const [step, setStep]               = useState<Step>('identity');
  const [guestName, setGuestName]     = useState('');
  const [guestEmail, setGuestEmail]   = useState('');
  const [guestPhone, setGuestPhone]   = useState('');
  const [selectedCourseSelections, setSelectedCourseSelections] = useState<Record<string, string>>({});
  const [currentCourseIdx, setCurrentCourseIdx] = useState(0);
  const [selectedAllergies, setSelectedAllergies] = useState<AllergyObj[]>([]);
  const [allergyNote, setAllergyNote] = useState('');
  const [guestNote, setGuestNote]     = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alreadyOrdered, setAlreadyOrdered] = useState(false);
  const [existingOrder, setExistingOrder]   = useState<any>(null);

  const courses: any[]  = useMemo(() => event?.courses || [], [event]);
  const hasCourses      = courses.length > 0;
  const menuItems: any[] = useMemo(() => event?.menuItems || [], [event]);

  const isEventOpen = useMemo(() => {
    if (!event) return false;
    if (event.orderingDeadline && new Date() > safeDate(event.orderingDeadline)) return false;
    return ['open', 'published', 'upcoming', 'active'].includes(event.status);
  }, [event]);

  // Total steps for progress: identity + courses (or 1 meal) + allergies + confirm
  const totalStepCount = hasCourses ? 2 + courses.length + 1 : 4;
  const currentStepIndex = useMemo(() => {
    if (step === 'identity')  return 0;
    if (step === 'course')    return 1 + currentCourseIdx;
    if (step === 'allergies') return hasCourses ? 1 + courses.length : 2;
    if (step === 'confirm')   return hasCourses ? 2 + courses.length : 3;
    return totalStepCount;
  }, [step, currentCourseIdx, hasCourses, courses.length, totalStepCount]);

  const progressValue = (currentStepIndex / (totalStepCount - 1)) * 100;

  const checkDuplicate = async () => {
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
    if (!guestName.trim()) { toast({ variant: 'destructive', title: 'Please enter your name' }); return; }
    if (guestEmail.trim() && await checkDuplicate()) { setAlreadyOrdered(true); return; }
    setStep('course');
    setCurrentCourseIdx(0);
  };

  const handleCourseNext = () => {
    const course = courses[currentCourseIdx];
    if (!course) return;
    if (!selectedCourseSelections[course.id] && !hasCourses) {
      toast({ variant: 'destructive', title: 'Please make a selection' }); return;
    }
    if (hasCourses && !selectedCourseSelections[course.id]) {
      toast({ variant: 'destructive', title: `Please select your ${course.name}` }); return;
    }
    if (currentCourseIdx < courses.length - 1) {
      setCurrentCourseIdx(i => i + 1);
    } else {
      setStep('allergies');
    }
  };

  const handleMealNext = () => {
    const anySelected = Object.keys(selectedCourseSelections).length > 0 || menuItems.length === 0;
    if (!anySelected) { toast({ variant: 'destructive', title: 'Please select your meal' }); return; }
    setStep('allergies');
  };

  const handleSubmit = async () => {
    if (isSubmitting || !firestore) return;
    setIsSubmitting(true);
    try {
      if (event?.orderingDeadline && new Date() > safeDate(event.orderingDeadline)) {
        toast({ variant: 'destructive', title: 'Orders for this event have closed' }); return;
      }
      // For single-course events, get the single selected meal
      const singleMealId = !hasCourses ? Object.values(selectedCourseSelections)[0] || null : null;
      const singleMeal   = menuItems.find((m: any) => m.id === singleMealId);

      await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
        id: nanoid(), eventId, tenantId,
        name:          guestName.trim(),
        email:         guestEmail.toLowerCase().trim() || null,
        phone:         guestPhone.trim() || null,
        tableNumber:   null,
        seatNumber:    null,
        mealChoiceId:  singleMealId,
        mealChoiceName: singleMeal?.name || null,
        courseSelections: hasCourses ? selectedCourseSelections : null,
        allergies:     selectedAllergies,
        allergyNote:   allergyNote.trim() || null,
        hasCriticalAllergy: selectedAllergies.some(a => a.severity === 'critical'),
        guestNote:     guestNote.trim() || null,
        submittedAt:   new Date().toISOString(),
        checkedIn: false, source: 'self_register', status: 'submitted',
      });
      setStep('done');
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Something went wrong — please try again' });
    } finally { setIsSubmitting(false); }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!event || !tenant) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <Loader className="w-6 h-6 animate-spin text-slate-300" />
    </div>
  );

  // ── Already ordered ────────────────────────────────────────────────────────
  if (alreadyOrdered && existingOrder) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-amber-500" />
        </div>
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Already Reserved</h2>
          <p className="text-slate-500 text-sm mt-1">We already have your order, {firstName(existingOrder.name)}.</p>
        </div>
        <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your Selection</p>
          <p className="font-black text-slate-900">{existingOrder.mealChoiceName || 'Multi-course selection'}</p>
          {existingOrder.allergies?.length > 0 && (
            <p className="text-[11px] text-amber-600 font-bold">
              ⚠ {existingOrder.allergies.map((a: any) => typeof a === 'object' ? a.label : a).join(', ')}
            </p>
          )}
        </div>
        <p className="text-xs text-slate-400">Need to make a change? Contact your host.</p>
      </motion.div>
    </div>
  );

  // ── Event closed ──────────────────────────────────────────────────────────
  if (!isEventOpen && step !== 'done') return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-4 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-50 border-2 border-slate-200 flex items-center justify-center">
          <Utensils className="w-7 h-7 text-slate-300" />
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">{studioName}</p>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{eventDisplayName}</h2>
          <p className="text-slate-500 text-sm mt-2">Pre-orders are now closed.</p>
          {event.orderingDeadline && (
            <p className="text-slate-400 text-xs mt-1">
              Deadline was {format(safeDate(event.orderingDeadline), 'MMM d at h:mm a')}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm space-y-6 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 120 }}
          className="w-16 h-16 mx-auto rounded-2xl bg-primary flex items-center justify-center">
          <Check className="w-8 h-8 text-white" strokeWidth={2.5} />
        </motion.div>
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{studioName}</p>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">
            You're confirmed,<br />{firstName(guestName)}.
          </h2>
          <p className="text-slate-500 text-sm">Your reservation for {eventDisplayName} has been received.</p>
        </div>
        <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your Details</p>
          <p className="font-black text-slate-900">{guestName}</p>
          {guestEmail && <p className="text-[11px] text-slate-500">{guestEmail}</p>}
          {selectedAllergies.length > 0 && (
            <p className="text-[11px] text-amber-600 font-bold">
              ⚠ {selectedAllergies.map(a => a.label).join(', ')}
            </p>
          )}
        </div>
        {event.date && (
          <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">
            {format(safeDate(event.date), 'EEEE, MMMM d')}
            {event.time && ` · ${event.time}`}
          </p>
        )}
      </motion.div>
    </div>
  );

  // ── Main flow ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">

      {/* ── HEADER ── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-100 px-4 py-3">
        <div className="max-w-lg mx-auto space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{studioName}</p>
              <p className="font-black text-sm text-slate-900 uppercase tracking-tight">{eventDisplayName}</p>
            </div>
            {guestName && step !== 'identity' && (
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {firstName(guestName)}
              </span>
            )}
          </div>
          <ProgressBar value={progressValue} />
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="max-w-lg mx-auto px-4 pb-16">
        <AnimatePresence mode="wait">

          {/* ── IDENTITY ── */}
          {step === 'identity' && (
            <motion.div key="identity" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="pt-8 space-y-6">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Step 1</p>
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">Your details</h1>
                <p className="text-slate-500 text-sm mt-1">We'll use this to personalise your experience.</p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Full Name *</label>
                  <input value={guestName} onChange={e => setGuestName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 text-slate-900 font-bold outline-none focus:border-primary transition-colors placeholder:text-slate-300 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Email</label>
                  <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)}
                    placeholder="For your confirmation (optional)"
                    className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 text-slate-900 font-bold outline-none focus:border-primary transition-colors placeholder:text-slate-300 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Phone</label>
                  <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                    placeholder="(555) 000-0000 (optional)"
                    className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 text-slate-900 font-bold outline-none focus:border-primary transition-colors placeholder:text-slate-300 text-sm" />
                </div>
              </div>

              <button onClick={handleIdentityNext}
                className="w-full h-12 rounded-xl bg-primary text-white font-black uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* ── COURSE / MEAL SELECTION ── */}
          {step === 'course' && (() => {
            if (hasCourses) {
              const course = courses[currentCourseIdx];
              if (!course) return null;
              const isLast = currentCourseIdx === courses.length - 1;
              const hasSelection = !!selectedCourseSelections[course.id];
              return (
                <motion.div key={`course-${course.id}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="pt-8 space-y-6">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                      Course {currentCourseIdx + 1} of {courses.length}
                    </p>
                    <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">{course.name}</h1>
                    {course.note && <p className="text-slate-500 text-sm mt-1">{course.note}</p>}
                  </div>
                  <div className="space-y-3">
                    {(course.options || []).map((option: any) => (
                      <MealOptionCard key={option.id} option={option}
                        selected={selectedCourseSelections[course.id] === option.id}
                        onSelect={() => setSelectedCourseSelections(prev => ({ ...prev, [course.id]: option.id }))} />
                    ))}
                    {(!course.options || course.options.length === 0) && (
                      <div className="p-10 text-center border-2 border-dashed border-slate-200 rounded-2xl">
                        <Utensils className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                        <p className="text-slate-400 text-sm font-bold">No options for this course yet</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => {
                      if (currentCourseIdx === 0) setStep('identity');
                      else setCurrentCourseIdx(i => i - 1);
                    }} className="h-12 px-4 rounded-xl border-2 border-slate-200 text-slate-400 hover:border-slate-300 transition-colors">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button onClick={handleCourseNext} disabled={!hasSelection}
                      className="flex-1 h-12 rounded-xl bg-primary text-white font-black uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all">
                      {isLast ? 'Continue' : `Next: ${courses[currentCourseIdx + 1]?.name || 'Next'}`}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            }

            // Single meal selection
            return (
              <motion.div key="meal" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                className="pt-8 space-y-6">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Step 2</p>
                  <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">Choose your meal</h1>
                  {event.menuNote && <p className="text-slate-500 text-sm mt-1">{event.menuNote}</p>}
                </div>
                <div className="space-y-3">
                  {menuItems.map((item: any) => (
                    <MealOptionCard key={item.id} option={item}
                      selected={selectedCourseSelections['single'] === item.id}
                      onSelect={() => setSelectedCourseSelections({ single: item.id })} />
                  ))}
                  {menuItems.length === 0 && (
                    <div className="p-10 text-center border-2 border-dashed border-slate-200 rounded-2xl">
                      <Utensils className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                      <p className="text-slate-400 text-sm font-bold">Menu not yet configured</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('identity')}
                    className="h-12 px-4 rounded-xl border-2 border-slate-200 text-slate-400 hover:border-slate-300 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button onClick={handleMealNext} disabled={!selectedCourseSelections['single']}
                    className="flex-1 h-12 rounded-xl bg-primary text-white font-black uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all">
                    Continue <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            );
          })()}

          {/* ── ALLERGIES ── */}
          {step === 'allergies' && (
            <motion.div key="allergies" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="pt-8 space-y-6">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Almost there</p>
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">Dietary needs?</h1>
                <p className="text-slate-500 text-sm mt-1">Select all that apply. Our kitchen takes this seriously.</p>
              </div>

              {(['critical', 'intolerance', 'preference'] as AllergySeverity[]).map(severity => {
                const opts = ALLERGY_OPTIONS.filter(o => o.severity === severity);
                const labels = { critical: 'Allergies', intolerance: 'Intolerances', preference: 'Dietary Preferences' };
                const colors = { critical: 'text-red-600', intolerance: 'text-amber-600', preference: 'text-emerald-600' };
                return (
                  <div key={severity} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-[9px] font-black uppercase tracking-widest', colors[severity])}>
                        {severity === 'critical' && '⚠ '}{labels[severity]}
                      </p>
                      {severity === 'critical' && (
                        <span className="text-[9px] text-slate-400 font-bold">Kitchen notified immediately</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {opts.map(opt => (
                        <AllergyChip key={opt.id} opt={opt}
                          selected={selectedAllergies.some(a => a.id === opt.id)}
                          onToggle={() => setSelectedAllergies(prev =>
                            prev.some(a => a.id === opt.id) ? prev.filter(a => a.id !== opt.id) : [...prev, opt]
                          )} />
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Additional notes</label>
                <textarea value={allergyNote} onChange={e => setAllergyNote(e.target.value)} rows={2}
                  placeholder="Anything the kitchen should know…"
                  className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-primary transition-colors resize-none placeholder:text-slate-300 font-medium" />
              </div>

              <div className="flex gap-3">
                <button onClick={() => {
                  if (hasCourses) { setStep('course'); setCurrentCourseIdx(courses.length - 1); }
                  else setStep('course');
                }} className="h-12 px-4 rounded-xl border-2 border-slate-200 text-slate-400 hover:border-slate-300 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setStep('confirm')}
                  className="flex-1 h-12 rounded-xl bg-primary text-white font-black uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                  Review <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── CONFIRM ── */}
          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="pt-8 space-y-6">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Almost done</p>
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-tight">Confirm your reservation</h1>
              </div>

              {/* Summary */}
              <div className="rounded-2xl border-2 border-slate-200 overflow-hidden divide-y divide-slate-100">
                {/* Guest */}
                <div className="p-4 space-y-0.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</p>
                  <p className="font-black text-slate-900">{guestName}</p>
                  {guestEmail && <p className="text-[11px] text-slate-500">{guestEmail}</p>}
                </div>

                {/* Meal / Courses */}
                {!hasCourses && selectedCourseSelections['single'] && (
                  <div className="p-4 space-y-0.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Meal</p>
                    <p className="font-black text-slate-900">
                      {menuItems.find((m: any) => m.id === selectedCourseSelections['single'])?.name}
                    </p>
                  </div>
                )}
                {hasCourses && (
                  <div className="p-4 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your Courses</p>
                    {courses.map((course: any) => {
                      const sel = (course.options || []).find((o: any) => o.id === selectedCourseSelections[course.id]);
                      return (
                        <div key={course.id} className="flex items-baseline justify-between gap-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">{course.name}</p>
                          <p className="font-bold text-slate-900 text-sm text-right">{sel?.name || <span className="text-slate-300 italic">—</span>}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Allergies */}
                {selectedAllergies.length > 0 && (
                  <div className="p-4 space-y-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">Dietary Flags</p>
                    {selectedAllergies.some(a => a.severity === 'critical') && (
                      <p className="text-[9px] font-black uppercase tracking-widest text-red-500">⚠ Critical — Kitchen will be notified</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {selectedAllergies.map(a => (
                        <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase border border-slate-200 bg-slate-50 text-slate-600">
                          {a.emoji} {a.label}
                        </span>
                      ))}
                    </div>
                    {allergyNote && <p className="text-[11px] text-slate-400 italic mt-1">{allergyNote}</p>}
                  </div>
                )}
              </div>

              {/* Note to host */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Note to host (optional)</label>
                <textarea value={guestNote} onChange={e => setGuestNote(e.target.value)} rows={2}
                  placeholder="Anything else we should know?"
                  className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-primary transition-colors resize-none placeholder:text-slate-300 font-medium" />
              </div>

              {/* Consent */}
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="mt-0.5 relative shrink-0">
                  <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)} className="sr-only" />
                  <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                    consentGiven ? 'border-primary bg-primary' : 'border-slate-300 bg-white')}>
                    {consentGiven && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  I confirm my dietary information is accurate and understand it will be shared with kitchen staff.
                </p>
              </label>

              <div className="flex gap-3">
                <button onClick={() => setStep('allergies')}
                  className="h-12 px-4 rounded-xl border-2 border-slate-200 text-slate-400 hover:border-slate-300 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button onClick={handleSubmit} disabled={isSubmitting || !consentGiven}
                  className="flex-1 h-12 rounded-xl bg-primary text-white font-black uppercase text-[11px] tracking-widest flex items-center justify-center gap-2 disabled:opacity-30 active:scale-[0.98] transition-all">
                  {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : 'Submit Reservation →'}
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}