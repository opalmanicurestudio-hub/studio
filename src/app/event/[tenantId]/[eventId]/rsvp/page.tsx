// src/app/event/[tenantId]/[eventId]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — no auth required
// Guest RSVP + meal preference submission
// Shareable link: /event/{tenantId}/{eventId}?seat=A4&table=3
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ChevronRight, ChevronLeft, AlertTriangle, Utensils, User, Loader, Leaf, Wheat, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { ALLERGY_OPTIONS, DIETARY_OPTIONS, type EventMenuItem } from '@/lib/event-types';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));

// ─── ALLERGY BADGE ────────────────────────────────────────────────────────────
const AllergyBadge = ({ label }: { label: string }) => (
  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-black uppercase tracking-wide text-amber-700">
    <AlertTriangle className="w-2.5 h-2.5" />{label}
  </span>
);

// ─── MENU ITEM CARD ───────────────────────────────────────────────────────────
const MenuItemCard = ({
  item, selected, onSelect,
}: { item: EventMenuItem; selected: boolean; onSelect: () => void }) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    onClick={onSelect}
    className={cn(
      'w-full text-left p-5 rounded-2xl border-2 transition-all duration-200 space-y-2',
      selected
        ? 'border-slate-900 bg-slate-900 text-white shadow-xl'
        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <p className={cn('font-black text-base tracking-tight leading-tight', selected ? 'text-white' : 'text-slate-900')}>
        {item.name}
      </p>
      <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all',
        selected ? 'border-white bg-white' : 'border-slate-300')}>
        {selected && <CheckCircle2 className="w-3.5 h-3.5 text-slate-900" />}
      </div>
    </div>
    {item.description && (
      <p className={cn('text-[11px] leading-relaxed', selected ? 'text-white/70' : 'text-slate-500')}>
        {item.description}
      </p>
    )}
    <div className="flex items-center gap-2 flex-wrap">
      {item.isVegan && (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border',
          selected ? 'border-white/30 text-white/80' : 'border-emerald-200 text-emerald-700 bg-emerald-50')}>
          <Leaf className="w-2 h-2" />Vegan
        </span>
      )}
      {item.isGlutenFree && (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border',
          selected ? 'border-white/30 text-white/80' : 'border-amber-200 text-amber-700 bg-amber-50')}>
          <Wheat className="w-2 h-2" />GF
        </span>
      )}
      {item.isDairyFree && (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border',
          selected ? 'border-white/30 text-white/80' : 'border-blue-200 text-blue-700 bg-blue-50')}>
          <Info className="w-2 h-2" />DF
        </span>
      )}
    </div>
  </motion.button>
);

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function EventRSVPPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { firestore } = useFirebase();
  const tenantId = params.tenantId as string;
  const eventId  = params.eventId  as string;

  // Pre-fill seat/table from URL params (QR codes carry these)
  const prefillSeat  = searchParams.get('seat')  || '';
  const prefillTable = searchParams.get('table') || '';

  // ── Data ──
  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const eventRef  = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}/studioEvents/${eventId}`), [firestore, tenantId, eventId]);
  const menuQ     = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/eventMenuItems`), where('eventId', '==', eventId)), [firestore, tenantId, eventId]);

  const { data: tenant } = useDoc<any>(tenantRef);
  const { data: event }  = useDoc<any>(eventRef);
  const { data: menuItems } = useCollection<EventMenuItem>(menuQ);

  // ── Form state ──
  type Step = 'identity' | 'menu' | 'allergies' | 'confirm' | 'done';
  const [step, setStep]           = useState<Step>('identity');
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [seatNumber, setSeat]     = useState(prefillSeat);
  const [tableNumber, setTable]   = useState(prefillTable);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]         = useState('');

  // Multi-course selections: courseNumber → menuItemId
  const [courseSelections, setCourseSelections] = useState<Record<number, string>>({});
  const [selectedAllergies, setSelectedAllergies]   = useState<string[]>([]);
  const [selectedDietary, setSelectedDietary]       = useState<string[]>([]);
  const [customAllergyNote, setCustomAllergyNote]   = useState('');
  const [guestNotes, setGuestNotes]                 = useState('');

  // Group menu items by course number
  const menuByCourse = useMemo(() => {
    const grouped: Record<number, EventMenuItem[]> = {};
    (menuItems || []).forEach(item => {
      if (!grouped[item.courseNumber]) grouped[item.courseNumber] = [];
      grouped[item.courseNumber].push(item);
    });
    return grouped;
  }, [menuItems]);

  const courseNumbers = useMemo(() => Object.keys(menuByCourse).map(Number).sort(), [menuByCourse]);
  const courseLabels: Record<number, string> = { 1: 'Starter', 2: 'Main Course', 3: 'Dessert' };

  const allSelectionsMade = courseNumbers.every(c => !!courseSelections[c]);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (courseNumbers.length > 0 && !allSelectionsMade) { setError('Please make a selection for each course.'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const batch = writeBatch(firestore);
      const guestId = nanoid();
      const checkInToken = nanoid(16);

      // Build primary mealChoiceId from first course (for single-course events)
      const primaryCourse = courseNumbers[0] || 1;
      const mealChoiceId  = courseSelections[primaryCourse] || null;
      const mealItem      = mealChoiceId ? (menuItems || []).find(m => m.id === mealChoiceId) : null;

      // ── DEADLINE CHECK ────────────────────────────────────────────────────
      if (event.orderingDeadline) {
        const deadline = safeDate(event.orderingDeadline);
        if (new Date() > deadline) {
          setError('Sorry — the order window for this event has closed.');
          setIsSubmitting(false);
          return;
        }
      }

      // ── DUPLICATE CHECK by email ──────────────────────────────────────────
      if (email.trim()) {
        const { getDocs, query: fbQuery, where: fbWhere } = await import('firebase/firestore');
        const dupSnap = await getDocs(fbQuery(
          collection(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`),
          fbWhere('email', '==', email.trim().toLowerCase())
        ));
        if (!dupSnap.empty) {
          setError('A submission with this email already exists for this event.');
          setIsSubmitting(false);
          return;
        }
      }

      // ── WRITE to guestOrders subcollection (feeds EventManifest + Course Fire) ──
      batch.set(doc(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`, guestId), {
        id: guestId,
        eventId,
        tenantId,
        name: name.trim(),
        email: email.trim().toLowerCase() || null,
        seatNumber: seatNumber.trim() || null,
        tableNumber: tableNumber.trim() || null,
        mealChoiceId,
        mealChoiceName: mealItem?.name || null,
        courseSelections,
        allergies: selectedAllergies,
        dietaryRestrictions: selectedDietary,
        notes: [guestNotes, customAllergyNote].filter(Boolean).join(' | ') || null,
        submittedAt: new Date().toISOString(),
        checkInToken,
        checkedIn: false,
        firedAt: null,    // set by Course Fire in EventManifest
        source: 'guest_rsvp',
      });

      await batch.commit();
      setStep('done');
    } catch (e) {
      console.error(e);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading ──
  if (!tenant || !event) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );

  const eventDate = event.startTime ? format(safeDate(event.startTime), "EEEE, MMMM d 'at' h:mm a") : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          {tenant.bookingPageSettings?.logoUrl && (
            <div className="w-9 h-9 rounded-xl overflow-hidden border border-slate-200 shrink-0">
              <Image src={tenant.bookingPageSettings.logoUrl} alt={tenant.name} width={36} height={36} className="object-cover w-full h-full" />
            </div>
          )}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tenant.name}</p>
            <h1 className="text-sm font-black uppercase tracking-tight text-slate-900 leading-tight">{event.title}</h1>
          </div>
          {eventDate && <p className="ml-auto text-[10px] font-bold text-slate-400 text-right hidden sm:block">{eventDate}</p>}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <AnimatePresence mode="wait">

          {/* ── STEP: IDENTITY ── */}
          {step === 'identity' && (
            <motion.div key="identity" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Guest Details</h2>
                <p className="text-sm text-slate-500 mt-1">Tell us a little about yourself before the event.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Full Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                    className="w-full h-14 rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg font-bold outline-none focus:border-slate-400 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email (optional)</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="For your order confirmation"
                    className="w-full h-12 rounded-2xl border-2 border-slate-200 bg-white px-4 font-bold outline-none focus:border-slate-400 transition-colors" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Table #</label>
                    <input value={tableNumber} onChange={e => setTable(e.target.value)} placeholder="e.g. 3"
                      className="w-full h-12 rounded-2xl border-2 border-slate-200 bg-white px-4 font-bold text-center outline-none focus:border-slate-400 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Seat #</label>
                    <input value={seatNumber} onChange={e => setSeat(e.target.value)} placeholder="e.g. A4"
                      className="w-full h-12 rounded-2xl border-2 border-slate-200 bg-white px-4 font-bold text-center outline-none focus:border-slate-400 transition-colors" />
                  </div>
                </div>
              </div>

              {error && <p className="text-red-500 text-sm font-bold">{error}</p>}

              <button onClick={() => { if (!name.trim()) { setError('Please enter your name.'); return; } setError(''); setStep(courseNumbers.length > 0 ? 'menu' : 'allergies'); }}
                className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* ── STEP: MENU SELECTION ── */}
          {step === 'menu' && (
            <motion.div key="menu" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-8">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Your Menu</h2>
                <p className="text-sm text-slate-500 mt-1">Please select your preference for each course.</p>
              </div>

              {courseNumbers.map(courseNum => (
                <div key={courseNum} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Utensils className="w-4 h-4 text-slate-400" />
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                      Course {courseNum} — {courseLabels[courseNum] || `Course ${courseNum}`}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {menuByCourse[courseNum].map(item => (
                      <MenuItemCard key={item.id} item={item}
                        selected={courseSelections[courseNum] === item.id}
                        onSelect={() => setCourseSelections(prev => ({ ...prev, [courseNum]: item.id }))} />
                    ))}
                  </div>
                </div>
              ))}

              {error && <p className="text-red-500 text-sm font-bold">{error}</p>}

              <div className="flex gap-3">
                <button onClick={() => setStep('identity')} className="h-14 px-5 rounded-2xl border-2 border-slate-200 font-black uppercase text-sm text-slate-500 hover:border-slate-300 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => { if (!allSelectionsMade) { setError('Please select an option for each course.'); return; } setError(''); setStep('allergies'); }}
                  className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP: ALLERGIES + DIETARY ── */}
          {step === 'allergies' && (
            <motion.div key="allergies" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Dietary Info</h2>
                <p className="text-sm text-slate-500 mt-1">This goes directly to our kitchen. Select all that apply.</p>
              </div>

              {/* Allergies */}
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />Allergies
                </p>
                <div className="flex flex-wrap gap-2">
                  {ALLERGY_OPTIONS.map(opt => (
                    <button key={opt} onClick={() => setSelectedAllergies(prev => prev.includes(opt) ? prev.filter(a => a !== opt) : [...prev, opt])}
                      className={cn('px-3 py-2 rounded-xl border-2 text-[11px] font-black uppercase tracking-wide transition-all',
                        selectedAllergies.includes(opt) ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dietary preferences */}
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Leaf className="w-3 h-3 text-emerald-500" />Dietary Requirements
                </p>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_OPTIONS.map(opt => (
                    <button key={opt} onClick={() => setSelectedDietary(prev => prev.includes(opt) ? prev.filter(a => a !== opt) : [...prev, opt])}
                      className={cn('px-3 py-2 rounded-xl border-2 text-[11px] font-black uppercase tracking-wide transition-all',
                        selectedDietary.includes(opt) ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom note */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Additional allergy or dietary note</label>
                <textarea value={customAllergyNote} onChange={e => setCustomAllergyNote(e.target.value)} rows={3}
                  placeholder="e.g. severe tree nut allergy, separate prep required"
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white p-4 font-medium text-sm resize-none outline-none focus:border-slate-400 transition-colors" />
              </div>

              {/* Notes for kitchen */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Any other notes for the evening?</label>
                <textarea value={guestNotes} onChange={e => setGuestNotes(e.target.value)} rows={2}
                  placeholder="e.g. celebrating a birthday, accessibility needs"
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white p-4 font-medium text-sm resize-none outline-none focus:border-slate-400 transition-colors" />
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(courseNumbers.length > 0 ? 'menu' : 'identity')}
                  className="h-14 px-5 rounded-2xl border-2 border-slate-200 font-black uppercase text-sm text-slate-500 hover:border-slate-300 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setStep('confirm')}
                  className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                  Review Order <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP: CONFIRM ── */}
          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Confirm Order</h2>
                <p className="text-sm text-slate-500 mt-1">Review your selections before submitting.</p>
              </div>

              <div className="rounded-2xl border-2 border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
                <div className="p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Guest</p>
                  <p className="font-black text-slate-900">{name}</p>
                  {(tableNumber || seatNumber) && (
                    <p className="text-sm text-slate-500 mt-0.5">
                      {tableNumber && `Table ${tableNumber}`}{tableNumber && seatNumber && ' · '}{seatNumber && `Seat ${seatNumber}`}
                    </p>
                  )}
                </div>

                {courseNumbers.map(c => {
                  const selectedId = courseSelections[c];
                  const item = (menuItems || []).find(m => m.id === selectedId);
                  if (!item) return null;
                  return (
                    <div key={c} className="p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                        {courseLabels[c] || `Course ${c}`}
                      </p>
                      <p className="font-black text-slate-900">{item.name}</p>
                    </div>
                  );
                })}

                {(selectedAllergies.length > 0 || selectedDietary.length > 0 || customAllergyNote) && (
                  <div className="p-4 bg-amber-50">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />Dietary Flags
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedAllergies.map(a => <AllergyBadge key={a} label={a} />)}
                      {selectedDietary.map(d => (
                        <span key={d} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                          <Leaf className="w-2.5 h-2.5" />{d}
                        </span>
                      ))}
                    </div>
                    {customAllergyNote && <p className="text-xs text-amber-700 mt-2 font-medium">{customAllergyNote}</p>}
                  </div>
                )}

                {guestNotes && (
                  <div className="p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Notes</p>
                    <p className="text-sm text-slate-600">{guestNotes}</p>
                  </div>
                )}
              </div>

              {error && <p className="text-red-500 text-sm font-bold">{error}</p>}

              <div className="flex gap-3">
                <button onClick={() => setStep('allergies')}
                  className="h-14 px-5 rounded-2xl border-2 border-slate-200 font-black uppercase text-sm text-slate-500 hover:border-slate-300 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={handleSubmit} disabled={isSubmitting}
                  className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : <>Submit Order ✓</>}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP: DONE ── */}
          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-8 py-12">
              <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 12, stiffness: 130 }}
                className="w-20 h-20 mx-auto rounded-3xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </motion.div>
              <div className="space-y-3">
                <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">You're Set!</h2>
                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mx-auto">
                  Your order has been submitted. See you at the event!
                  {selectedAllergies.length > 0 && ' Your allergy flags are noted and the kitchen has been informed.'}
                </p>
              </div>
              {event.title && (
                <div className="inline-block px-6 py-3 rounded-2xl bg-slate-50 border-2 border-slate-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Event</p>
                  <p className="font-black text-slate-900 mt-0.5">{event.title}</p>
                  {eventDate && <p className="text-sm text-slate-500 mt-0.5">{eventDate}</p>}
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}