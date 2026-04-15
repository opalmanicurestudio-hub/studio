/**
 * EventModeKiosk.tsx
 * 
 * A component that replaces the standard concierge/refreshment kiosk UI
 * when a guest scans their seat QR during an active event.
 * 
 * HOW IT INTEGRATES:
 * In the walk-in kiosk or a standalone seat QR route (/seat/[tenantId]/[tableId]),
 * detect whether there's an active event. If yes → render this instead.
 * 
 * What it does:
 *   1. Shows guest's pre-submitted meal confirmation ("Your chicken is being prepared")
 *   2. Shows allergy flags prominently
 *   3. Removes all food/drink ordering — replaces with FLOOR SERVICE only
 *   4. Floor service writes to floorRequests (NOT refreshmentRequests, NOT KDS)
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, doc, onSnapshot } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, CheckCircle2, AlertTriangle, Utensils, Loader } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useToast } from '@/hooks/use-toast';

// ─── FLOOR SERVICE ITEM TYPES ─────────────────────────────────────────────────
// These NEVER go to the KDS. They write to floorRequests.
const FLOOR_SERVICE_ITEMS = [
  { id: 'napkins',       label: 'Napkins',            emoji: '🧻', description: 'Extra napkins' },
  { id: 'water',         label: 'Water Refill',        emoji: '💧', description: 'Water or still/sparkling' },
  { id: 'condiments',    label: 'Condiments',          emoji: '🧂', description: 'Salt, pepper, sauces' },
  { id: 'utensils',      label: 'Extra Utensils',      emoji: '🍴', description: 'Fork, knife, spoon' },
  { id: 'accessibility', label: 'Accessibility',       emoji: '♿', description: 'Mobility or accessibility assist' },
  { id: 'temperature',   label: 'Too Hot / Cold',      emoji: '🌡️', description: 'Comfort adjustment' },
  { id: 'cleaning',      label: 'Clean Table',         emoji: '🧹', description: 'Spill or cleanup needed' },
  { id: 'other',         label: 'Other Request',       emoji: '💬', description: 'Something else' },
];

// ─── FLOOR SERVICE TILE ────────────────────────────────────────────────────────
const FloorServiceTile = ({ item, selected, onToggle }: { item: any; selected: boolean; onToggle: () => void }) => (
  <motion.button whileTap={{ scale: 0.96 }} onClick={onToggle}
    className={cn(
      'flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-center',
      selected ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-white hover:border-slate-300'
    )}>
    <span className="text-3xl">{item.emoji}</span>
    <p className={cn('text-[10px] font-black uppercase tracking-tight leading-tight', selected ? 'text-white' : 'text-slate-900')}>{item.label}</p>
    {selected && <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center"><Check className="w-3 h-3 text-slate-900" /></div>}
  </motion.button>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
interface EventModeKioskProps {
  tenantId: string;
  eventId: string;
  tableNumber: string;
  seatNumber?: string;
  firestore: any;
  // Theme tokens from parent kiosk
  t?: any;
  primaryHex?: string;
}

export function EventModeKiosk({ tenantId, eventId, tableNumber, seatNumber, firestore, t, primaryHex }: EventModeKioskProps) {
  const { toast } = useToast();
  const [guestOrder, setGuestOrder] = useState<any>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [recentRequests, setRecentRequests] = useState<any[]>([]);

  const btnStyle = primaryHex ? { backgroundColor: primaryHex, color: '#fff' } : undefined;

  // ── Load pre-submitted order for this seat ─────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId || !eventId || !tableNumber) { setLoadingOrder(false); return; }
    const q = query(
      collection(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`),
      where('tableNumber', '==', tableNumber),
      ...(seatNumber ? [where('seatNumber', '==', seatNumber)] : [])
    );
    getDocs(q).then(snap => {
      if (!snap.empty) setGuestOrder({ id: snap.docs[0].id, ...snap.docs[0].data() });
      setLoadingOrder(false);
    }).catch(() => setLoadingOrder(false));
  }, [firestore, tenantId, eventId, tableNumber, seatNumber]);

  // ── Live view of recent floor requests from this table ─────────────────────
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const cutoff = new Date(); cutoff.setHours(cutoff.getHours() - 2);
    const q = query(
      collection(firestore, `tenants/${tenantId}/floorRequests`),
      where('tableNumber', '==', tableNumber),
      where('createdAt', '>=', cutoff.toISOString())
    );
    const unsub = onSnapshot(q, snap => {
      setRecentRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.status !== 'done'));
    });
    return unsub;
  }, [firestore, tenantId, tableNumber]);

  const toggleItem = (id: string) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSubmit = async () => {
    if (selectedItems.length === 0) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      // Write ONE floorRequest per selected item type
      // Each goes to floorRequests collection — floor staff view picks these up
      // NEVER writes to kdsTickets or refreshmentRequests
      const promises = selectedItems.map(itemId =>
        addDoc(collection(firestore, `tenants/${tenantId}/floorRequests`), {
          id: nanoid(),
          tenantId,
          eventId: eventId || null,
          tableNumber,
          seatNumber: seatNumber || null,
          guestName: guestOrder?.guestName || null,
          guestAllergies: guestOrder?.allergies || [],    // always forward allergy context
          requestType: itemId,
          note: note.trim() || null,
          status: 'new',
          createdAt: now,
          source: 'event_kiosk',  // so floor staff knows it's from a seated event guest
        })
      );
      await Promise.all(promises);
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setSelectedItems([]);
        setNote('');
      }, 3000);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Request failed', description: 'Please try again or flag down a staff member.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingOrder) return (
    <div className="p-12 flex items-center justify-center">
      <Loader className="w-6 h-6 animate-spin text-slate-300" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">

      {/* Guest order confirmation */}
      {guestOrder && (
        <div className="p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-emerald-100">
              <Utensils className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Your Order is Confirmed</p>
              <p className="font-black text-emerald-900 text-base mt-0.5">
                {guestOrder.mealName || 'Your selection is being prepared'}
              </p>
              {guestOrder.courseSelections && (
                <div className="mt-1 space-y-0.5">
                  {Object.entries(guestOrder.courseSelections).map(([course, selection]) => (
                    <p key={course} className="text-xs text-emerald-700">{course}: {String(selection)}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Allergy flags — shown prominently to anyone viewing */}
          {(guestOrder.allergies?.length > 0 || guestOrder.allergyNote) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-100 border border-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 mb-0.5">Dietary Requirements on File</p>
                {guestOrder.allergies?.length > 0 && <p className="text-xs font-black text-amber-800">{guestOrder.allergies.join(', ')}</p>}
                {guestOrder.allergyNote && <p className="text-[10px] text-amber-700 mt-0.5">{guestOrder.allergyNote}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pending requests from this table */}
      {recentRequests.length > 0 && (
        <div className="p-3 rounded-xl border-2 border-blue-200 bg-blue-50 space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-blue-600">Request In Progress</p>
          {recentRequests.map(r => (
            <p key={r.id} className="text-xs font-bold text-blue-800">
              {r.requestType === 'napkins' ? '🧻' : r.requestType === 'water' ? '💧' : '🔔'} {r.requestType} — on the way
            </p>
          ))}
        </div>
      )}

      {/* Floor service request section */}
      <div className="space-y-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">How can we help?</p>
          <p className="text-sm text-slate-500 mt-0.5">Select what you need and a floor team member will come to you.</p>
        </div>

        {/* Item grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {FLOOR_SERVICE_ITEMS.map(item => (
            <FloorServiceTile key={item.id} item={item} selected={selectedItems.includes(item.id)} onToggle={() => toggleItem(item.id)} />
          ))}
        </div>

        {/* Optional note */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Additional note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Need a high chair, or running low on napkins…"
            className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 transition-all resize-none" />
        </div>

        {/* Submit */}
        <AnimatePresence mode="wait">
          {submitted ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="w-full h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center gap-2 font-black uppercase tracking-widest text-sm">
              <CheckCircle2 className="w-5 h-5" /> Request Sent — Someone is on the way
            </motion.div>
          ) : (
            <motion.button key="submit" onClick={handleSubmit} disabled={selectedItems.length === 0 || isSubmitting}
              style={selectedItems.length > 0 ? btnStyle : undefined}
              className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all', selectedItems.length > 0 ? (!btnStyle && 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
              {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : <>Request Assistance <ChevronRight className="w-4 h-4" /></>}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Table indicator */}
      <p className="text-center text-[9px] font-black uppercase tracking-widest text-slate-300">
        Table {tableNumber}{seatNumber ? ` · Seat ${seatNumber}` : ''}
      </p>
    </div>
  );
}