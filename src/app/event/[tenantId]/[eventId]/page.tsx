'use client';
/**
 * /event/[tenantId]/[eventId]/page.tsx
 *
 * Phase 1 — Pre-Event Order Collection
 * Shareable link, no auth required.
 * Guest enters name + seat, chooses meal, flags allergies.
 * Writes to: tenants/{tenantId}/events/{eventId}/guestOrders/{orderId}
 */

import React, { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, Loader, AlertTriangle, Utensils, User, MapPin, FileText, CheckCircle2 } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const safeDate = (v: any) => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v === 'string') return parseISO(v);
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return new Date(v);
};

// ─── COMMON ALLERGY / DIETARY FLAGS ──────────────────────────────────────────
const ALLERGY_OPTIONS = [
  { id: 'gluten',    label: 'Gluten Free',   emoji: '🌾' },
  { id: 'dairy',     label: 'Dairy Free',    emoji: '🥛' },
  { id: 'nuts',      label: 'Tree Nuts',     emoji: '🥜' },
  { id: 'peanuts',   label: 'Peanuts',       emoji: '🥜' },
  { id: 'shellfish', label: 'Shellfish',     emoji: '🦐' },
  { id: 'fish',      label: 'Fish',          emoji: '🐟' },
  { id: 'eggs',      label: 'Eggs',          emoji: '🥚' },
  { id: 'soy',       label: 'Soy',           emoji: '🫘' },
  { id: 'vegan',     label: 'Vegan',         emoji: '🌿' },
  { id: 'vegetarian',label: 'Vegetarian',    emoji: '🥦' },
  { id: 'kosher',    label: 'Kosher',        emoji: '✡️' },
  { id: 'halal',     label: 'Halal',         emoji: '☪️' },
];

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

// ─── MEAL OPTION CARD ────────────────────────────────────────────────────────
const MealOptionCard = ({ option, selected, onSelect }: { option: any; selected: boolean; onSelect: () => void }) => (
  <motion.button whileTap={{ scale: 0.97 }} onClick={onSelect}
    className={cn(
      'relative w-full text-left p-5 rounded-2xl border-2 transition-all duration-200',
      selected ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-white hover:border-slate-300'
    )}>
    {selected && <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white flex items-center justify-center"><Check className="w-3.5 h-3.5 text-slate-900" /></div>}
    {option.imageUrl && (
      <div className="relative w-full h-32 rounded-xl overflow-hidden mb-3">
        <Image src={option.imageUrl} alt={option.name} fill className="object-cover" />
      </div>
    )}
    <p className={cn('font-black uppercase tracking-tight text-base leading-tight', selected ? 'text-white' : 'text-slate-900')}>{option.name}</p>
    {option.description && <p className={cn('text-[11px] mt-1.5 leading-relaxed', selected ? 'text-white/70' : 'text-slate-500')}>{option.description}</p>}
    {option.allergyFlags?.length > 0 && (
      <div className="flex flex-wrap gap-1 mt-2">
        {option.allergyFlags.map((flag: string) => (
          <span key={flag} className={cn('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full', selected ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-700 border border-amber-200')}>{flag}</span>
        ))}
      </div>
    )}
  </motion.button>
);

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
type Step = 'identity' | 'meal' | 'allergies' | 'confirm' | 'done';

export default function EventGuestOrderPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const eventId  = params.eventId  as string;
  const { firestore } = useFirebase();
  const { toast }    = useToast();

  const eventRef = useMemoFirebase(
    () => doc(firestore, `tenants/${tenantId}/studioEvents/${eventId}`),
    [firestore, tenantId, eventId]
  );
  const { data: event } = useDoc<any>(eventRef);

  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const { data: tenant } = useDoc<any>(tenantRef);

  // ── Form state ──
  const [step, setStep]                 = useState<Step>('identity');
  const [guestName, setGuestName]       = useState('');
  const [guestEmail, setGuestEmail]     = useState('');
  const [guestPhone, setGuestPhone]     = useState('');
  const [tableNumber, setTableNumber]   = useState('');
  const [seatNumber, setSeatNumber]     = useState('');
  const [selectedMealId, setSelectedMealId] = useState<string | null>(null);
  const [selectedCourseSelections, setSelectedCourseSelections] = useState<Record<string, string>>({});
  const [currentCourseIdx, setCurrentCourseIdx] = useState(0);
  const [selectedAllergies, setSelectedAllergies] = useState<string[]>([]);
  const [allergyNote, setAllergyNote]   = useState('');
  const [guestNote, setGuestNote]       = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingOrder, setExistingOrder] = useState<any>(null);
  const [alreadyOrdered, setAlreadyOrdered] = useState(false);

  const isEventOpen = useMemo(() => {
    if (!event) return false;
    if (event.orderingDeadline) return new Date() < safeDate(event.orderingDeadline);
    return event.status === 'open' || event.status === 'published';
  }, [event]);

  // ── Courses (multi-course events have per-course choices) ──────────────────
  const courses = useMemo(() => event?.courses || [], [event]);
  const hasCourses = courses.length > 0;

  // ── Steps: identity → meal(s) → allergies → confirm ──────────────────────
  const totalSteps = hasCourses ? courses.length + 3 : 4; // identity + each course + allergies + confirm
  const currentStepNum = {
    identity: 0,
    meal: 1,
    allergies: hasCourses ? courses.length + 1 : 2,
    confirm: hasCourses ? courses.length + 2 : 3,
    done: hasCourses ? courses.length + 3 : 4,
  }[step];

  // ── Check for duplicate order ─────────────────────────────────────────────
  const checkDuplicate = async (name: string, email: string) => {
    if (!firestore || !tenantId || !eventId) return false;
    const q = query(
      collection(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`),
      where('guestEmail', '==', email.toLowerCase().trim())
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      setExistingOrder({ id: snap.docs[0].id, ...snap.docs[0].data() });
      return true;
    }
    return false;
  };

  const handleIdentityNext = async () => {
    if (!guestName.trim()) return toast({ variant: 'destructive', title: 'Name required' });
    if (!tableNumber.trim()) return toast({ variant: 'destructive', title: 'Table number required' });
    if (guestEmail.trim()) {
      const isDuplicate = await checkDuplicate(guestName, guestEmail);
      if (isDuplicate) { setAlreadyOrdered(true); return; }
    }
    setStep('meal');
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!firestore || !tenantId || !eventId) return;

    // Validate all course selections if multi-course
    if (hasCourses) {
      const missing = courses.filter((c: any) => !selectedCourseSelections[c.id]);
      if (missing.length > 0) {
        toast({ variant: 'destructive', title: 'Please select all courses', description: `Missing: ${missing.map((c: any) => c.name).join(', ')}` });
        return;
      }
    } else if (!selectedMealId) {
      toast({ variant: 'destructive', title: 'Please select your meal' });
      return;
    }

    setIsSubmitting(true);
    try {
      const orderId = nanoid();
      await addDoc(
        collection(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`),
        {
          id: orderId,
          guestName: guestName.trim(),
          guestEmail: guestEmail.toLowerCase().trim() || null,
          guestPhone: guestPhone.trim() || null,
          tableNumber: tableNumber.trim(),
          seatNumber: seatNumber.trim() || null,
          // Single-course events
          mealId: selectedMealId || null,
          mealName: event?.menuItems?.find((m: any) => m.id === selectedMealId)?.name || null,
          // Multi-course events
          courseSelections: hasCourses ? selectedCourseSelections : null,
          // Allergies
          allergies: selectedAllergies,
          allergyNote: allergyNote.trim() || null,
          guestNote: guestNote.trim() || null,
          // Metadata
          submittedAt: new Date().toISOString(),
          status: 'submitted',       // → confirmed → served
          firedAt: null,             // set when course is fired
          kdsTicketId: null,         // set when pushed to KDS
          eventId,
          tenantId,
        }
      );
      setStep('done');
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Submission failed', description: 'Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!event || !tenant) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader className="w-8 h-8 animate-spin text-slate-300" />
    </div>
  );

  const logoUrl = tenant.kioskSettings?.logoUrl || tenant.bookingPageSettings?.logoUrl;
  const primaryColor = tenant.kioskSettings?.primaryColor || tenant.bookingPageSettings?.primaryColor;
  const btnStyle = primaryColor ? { backgroundColor: primaryColor, color: '#fff' } : undefined;

  // ── Already ordered ────────────────────────────────────────────────────────
  if (alreadyOrdered && existingOrder) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-xl p-8 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Already Submitted</h2>
            <p className="text-slate-500 text-sm mt-2">We already have your order for this event, {existingOrder.guestName?.split(' ')[0]}.</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your Selection</p>
            <p className="font-black text-slate-900">{existingOrder.mealName || 'Multi-course selection'}</p>
            {existingOrder.allergies?.length > 0 && (
              <p className="text-xs text-amber-600">⚠ {existingOrder.allergies.join(', ')}</p>
            )}
            <p className="text-[9px] text-slate-400">Table {existingOrder.tableNumber}{existingOrder.seatNumber ? ` · Seat ${existingOrder.seatNumber}` : ''}</p>
          </div>
          <p className="text-xs text-slate-400">Need to make changes? Contact your host.</p>
        </div>
      </div>
    );
  }

  // ── Closed ─────────────────────────────────────────────────────────────────
  if (!isEventOpen) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-xl p-8 text-center space-y-6">
          {logoUrl && <div className="relative w-16 h-16 mx-auto rounded-2xl overflow-hidden"><Image src={logoUrl} alt={tenant.name} fill className="object-cover" /></div>}
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{event.name}</h1>
            <p className="text-slate-500 text-sm mt-2">Pre-orders for this event are now closed.</p>
            {event.orderingDeadline && <p className="text-xs text-slate-400 mt-1">Deadline was {format(safeDate(event.orderingDeadline), 'MMM d at h:mm a')}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-6 space-y-2">
          {logoUrl && (
            <div className="relative w-14 h-14 mx-auto rounded-2xl overflow-hidden shadow-md">
              <Image src={logoUrl} alt={tenant.name} fill className="object-cover" />
            </div>
          )}
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{event.name}</h1>
          {event.date && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{format(safeDate(event.date), 'EEEE, MMMM d · h:mm a')}</p>}
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <StepDots total={4} current={Math.min(currentStepNum, 3)} />
          </div>

          <AnimatePresence mode="wait">

            {/* ── STEP 1: Identity ── */}
            {step === 'identity' && (
              <motion.div key="identity" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 1 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Info</h2>
                  <p className="text-sm text-slate-500">So we can personalize your place setting</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><User className="w-3 h-3" /> Full Name *</label>
                    <input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Your full name"
                      className="w-full h-12 rounded-xl border-2 border-slate-200 px-4 font-bold text-slate-900 outline-none focus:border-slate-400 transition-all" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Table *</label>
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
                <button onClick={handleIdentityNext} style={btnStyle}
                  className={cn('w-full h-13 py-4 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2', !btnStyle && 'bg-slate-900 text-white')}>
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ── STEP 2: Meal selection (single-course) ── */}
            {step === 'meal' && !hasCourses && (
              <motion.div key="meal" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 2 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Meal</h2>
                  {event.menuNote && <p className="text-sm text-slate-500">{event.menuNote}</p>}
                </div>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {(event.menuItems || []).map((item: any) => (
                    <MealOptionCard key={item.id} option={item} selected={selectedMealId === item.id} onSelect={() => setSelectedMealId(item.id)} />
                  ))}
                  {(!event.menuItems || event.menuItems.length === 0) && (
                    <div className="p-8 text-center text-slate-400 border-2 border-dashed rounded-2xl">
                      <Utensils className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm font-bold">Menu not yet configured</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('identity')} className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500 hover:border-slate-300 transition-all">←</button>
                  <button onClick={() => { if (!selectedMealId) { toast({ variant: 'destructive', title: 'Please select a meal' }); return; } setStep('allergies'); }} style={selectedMealId ? btnStyle : undefined}
                    className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2', selectedMealId ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
                    Continue <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── STEP 2+: Course-by-course selection (paginated, one course at a time) ── */}
            {step === 'meal' && hasCourses && (() => {
              const course = courses[currentCourseIdx];
              if (!course) return null;
              const isLast = currentCourseIdx === courses.length - 1;
              const hasSelection = !!selectedCourseSelections[course.id];
              return (
                <motion.div key={`course-${course.id}-${currentCourseIdx}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                  <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Course {currentCourseIdx + 1} of {courses.length}</p>
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
                      onClick={() => {
                        if (currentCourseIdx === 0) setStep('identity');
                        else setCurrentCourseIdx(i => i - 1);
                      }}
                      className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500 hover:border-slate-300 transition-all">←</button>
                    <button
                      onClick={() => {
                        if (!hasSelection) { toast({ variant: 'destructive', title: `Please select ${course.name}` }); return; }
                        if (!isLast) setCurrentCourseIdx(i => i + 1);
                        else setStep('allergies');
                      }}
                      style={hasSelection ? btnStyle : undefined}
                      className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2',
                        hasSelection ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
                      {isLast ? 'Continue' : `Next: ${courses[currentCourseIdx + 1]?.name || 'Course'}`} <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })()}

            {/* ── STEP 3: Allergies ── */}
            {step === 'allergies' && (
              <motion.div key="allergies" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Step 3 of 4</p>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Allergies & Dietary</h2>
                  <p className="text-sm text-slate-500">Select all that apply. This will be visible on your ticket.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {ALLERGY_OPTIONS.map(opt => (
                    <button key={opt.id} onClick={() => setSelectedAllergies(prev => prev.includes(opt.id) ? prev.filter(a => a !== opt.id) : [...prev, opt.id])}
                      className={cn('flex items-center gap-2 p-3 rounded-xl border-2 text-left transition-all',
                        selectedAllergies.includes(opt.id) ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-slate-300')}>
                      <span className="text-lg">{opt.emoji}</span>
                      <span className={cn('text-[10px] font-black uppercase tracking-tight', selectedAllergies.includes(opt.id) ? 'text-amber-800' : 'text-slate-700')}>{opt.label}</span>
                      {selectedAllergies.includes(opt.id) && <Check className="w-3 h-3 text-amber-600 ml-auto" />}
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Additional notes (optional)</label>
                  <textarea value={allergyNote} onChange={e => setAllergyNote(e.target.value)} rows={2} placeholder="e.g. Severe nut allergy — please ensure no cross-contamination"
                    className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 transition-all resize-none" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('meal')} className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500">←</button>
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
                  {/* Guest summary */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest</p>
                    <p className="font-black text-slate-900">{guestName}</p>
                    {guestPhone && <p className="text-xs text-slate-500">{guestPhone}</p>}
                    <p className="text-xs text-slate-500">Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}</p>
                  </div>
                  {/* Meal summary */}
                  {!hasCourses && selectedMealId && (
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Meal</p>
                      <p className="font-black text-slate-900">{event.menuItems?.find((m: any) => m.id === selectedMealId)?.name}</p>
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
                  {/* Allergy summary */}
                  {(selectedAllergies.length > 0 || allergyNote) && (
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">⚠ Dietary Requirements</p>
                      {selectedAllergies.length > 0 && <p className="font-bold text-amber-800 text-sm">{selectedAllergies.map(a => ALLERGY_OPTIONS.find(o => o.id === a)?.label).filter(Boolean).join(', ')}</p>}
                      {allergyNote && <p className="text-xs text-amber-700">{allergyNote}</p>}
                    </div>
                  )}
                  {/* Optional note */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><FileText className="w-3 h-3" /> Note to host (optional)</label>
                    <textarea value={guestNote} onChange={e => setGuestNote(e.target.value)} rows={2} placeholder="Anything else we should know?"
                      className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 resize-none" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('allergies')} className="h-12 px-5 rounded-2xl border-2 border-slate-200 font-black text-slate-500">←</button>
                  <button onClick={handleSubmit} disabled={isSubmitting} style={btnStyle}
                    className={cn('flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-50', !btnStyle && 'bg-slate-900 text-white')}>
                    {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : 'Submit Order →'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── DONE ── */}
            {step === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="p-8 text-center space-y-6">
                <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 12, stiffness: 140 }}
                  className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </motion.div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Order Received</h2>
                  <p className="text-slate-500 text-sm">Thank you, {guestName.split(' ')[0]}! We have your selection for {event.name}.</p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}</p>
                  {!hasCourses && <p className="font-black text-slate-900">{event.menuItems?.find((m: any) => m.id === selectedMealId)?.name}</p>}
                  {selectedAllergies.length > 0 && <p className="text-xs text-amber-600 font-bold">⚠ {selectedAllergies.map(a => ALLERGY_OPTIONS.find(o => o.id === a)?.label).filter(Boolean).join(', ')}</p>}
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