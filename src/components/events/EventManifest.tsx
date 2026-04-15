'use client';
/**
 * EventManifest.tsx
 * Dashboard component — shows inside the planner or events admin page.
 * Props: tenantId, eventId
 * Reads from: tenants/{tenantId}/events/{eventId}/guestOrders
 * 
 * Features:
 *  - Summary row: totals per meal, allergy flags
 *  - Sortable/filterable table of every guest
 *  - Per-row allergy badge (amber if flagged)
 *  - Course fire button: pushes all orders to kdsTickets simultaneously
 *  - Export to CSV
 *  - Print per-seat place cards (one per guest)
 */

import React, { useState, useMemo, useEffect } from 'react';
import { collection, query, onSnapshot, doc, writeBatch, orderBy } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import {
  AlertTriangle, ChevronDown, ChevronUp, Download, Flame, Printer,
  Search, Users, Utensils, CheckCircle2, Clock, Filter, X
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const safeDate = (v: any) => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v === 'string') try { return parseISO(v); } catch { return new Date(); }
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return new Date(v);
};

const exportToCSV = (orders: any[], eventName: string) => {
  const header = ['Name', 'Table', 'Seat', 'Meal', 'Allergies', 'Notes', 'Submitted'];
  const rows = orders.map(o => [
    o.guestName, o.tableNumber, o.seatNumber || '', o.mealName || 'Multi-course',
    (o.allergies || []).join('; '), o.allergyNote || '', format(safeDate(o.submittedAt), 'MMM d h:mm a')
  ]);
  const csv = [header, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${eventName.replace(/\s/g, '_')}_manifest.csv`; a.click();
  URL.revokeObjectURL(url);
};

// ─── ALLERGY BADGE ────────────────────────────────────────────────────────────
const AllergyBadge = ({ allergies, note }: { allergies: string[]; note?: string }) => {
  if (!allergies?.length && !note) return <span className="text-slate-300 text-[10px]">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {(allergies || []).slice(0, 3).map(a => (
        <span key={a} className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">{a}</span>
      ))}
      {(allergies || []).length > 3 && <span className="text-[9px] font-black text-amber-600">+{allergies.length - 3}</span>}
      {note && <span title={note} className="text-[9px] font-black text-amber-600 cursor-help">⚠ note</span>}
    </div>
  );
};

// ─── SUMMARY CARDS ────────────────────────────────────────────────────────────
const SummaryCards = ({ orders, event }: { orders: any[]; event: any }) => {
  const mealCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      const name = o.mealName || 'Other';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const allergyCount = orders.filter(o => o.allergies?.length > 0 || o.allergyNote).length;
  const unfiredCount = orders.filter(o => !o.firedAt).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div className="p-4 rounded-2xl border-2 border-slate-200 bg-white space-y-1">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total RSVPs</p>
        <p className="text-3xl font-black text-slate-900">{orders.length}</p>
        <p className="text-[10px] text-slate-400">{unfiredCount} pending fire</p>
      </div>
      {mealCounts.slice(0, 2).map(([name, count]) => (
        <div key={name} className="p-4 rounded-2xl border-2 border-slate-200 bg-white space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 truncate">{name}</p>
          <p className="text-3xl font-black text-slate-900">{count}</p>
          <p className="text-[10px] text-slate-400">{Math.round((count / orders.length) * 100)}% of guests</p>
        </div>
      ))}
      <div className={cn('p-4 rounded-2xl border-2 space-y-1', allergyCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white')}>
        <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Allergy Flags</p>
        <p className={cn('text-3xl font-black', allergyCount > 0 ? 'text-amber-700' : 'text-slate-900')}>{allergyCount}</p>
        <p className="text-[10px] text-amber-600">{allergyCount > 0 ? 'require attention' : 'none flagged'}</p>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
interface EventManifestProps {
  tenantId: string;
  eventId: string;
  firestore: any;
  event?: any;
}

export function EventManifest({ tenantId, eventId, firestore, event }: EventManifestProps) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAllergy, setFilterAllergy] = useState(false);
  const [filterUnfired, setFilterUnfired] = useState(false);
  const [sortField, setSortField] = useState<'tableNumber' | 'guestName' | 'submittedAt'>('tableNumber');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isFiring, setIsFiring] = useState(false);
  const [selectedCourseToFire, setSelectedCourseToFire] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // Live listener on guestOrders subcollection
  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const q = query(collection(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`));
    const unsub = onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => { console.error(err); setLoading(false); });
    return unsub;
  }, [firestore, tenantId, eventId]);

  const filtered = useMemo(() => {
    let list = [...orders];
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(o => o.guestName?.toLowerCase().includes(s) || o.tableNumber?.includes(s) || o.mealName?.toLowerCase().includes(s));
    }
    if (filterAllergy) list = list.filter(o => o.allergies?.length > 0 || o.allergyNote);
    if (filterUnfired) list = list.filter(o => !o.firedAt);
    list.sort((a, b) => {
      let av = a[sortField] || ''; let bv = b[sortField] || '';
      if (sortField === 'tableNumber') { av = parseInt(av) || 0; bv = parseInt(bv) || 0; }
      if (sortField === 'submittedAt') { av = safeDate(av).getTime(); bv = safeDate(bv).getTime(); }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [orders, search, filterAllergy, filterUnfired, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  // ── Course Firing ──────────────────────────────────────────────────────────
  // Pushes all (or filtered) pre-orders to kdsTickets simultaneously
  const handleFireCourse = async (courseLabel: string) => {
    if (isFiring) return;
    const toFire = orders.filter(o => !o.firedAt);
    if (toFire.length === 0) { toast({ title: 'All orders already fired' }); return; }
    setIsFiring(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    toFire.forEach(order => {
      // Write to kdsTickets — kitchen display sees these
      const kdsRef = doc(collection(firestore, `tenants/${tenantId}/kdsTickets`));
      batch.set(kdsRef, {
        id: kdsRef.id,
        eventId, tenantId,
        guestOrderId: order.id,
        guestName: order.guestName,
        tableNumber: order.tableNumber,
        seatNumber: order.seatNumber || null,
        courseLabel,
        // Single-course
        mealId: order.mealId || null,
        mealName: order.mealName || null,
        // Multi-course — pull the specific course selection
        courseSelection: order.courseSelections?.[selectedCourseToFire || ''] || null,
        // CRITICAL: allergy flags always visible on kitchen ticket
        allergies: order.allergies || [],
        allergyNote: order.allergyNote || null,
        status: 'in_progress',  // KDS lane: pending → in_progress → done
        firedAt: now,
        ticketType: 'event_course',
      });
      // Mark the order as fired
      const orderRef = doc(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`, order.id);
      batch.update(orderRef, { firedAt: now, kdsTicketId: kdsRef.id, status: 'in_progress' });
    });
    await batch.commit();
    toast({ title: `🔥 ${toFire.length} tickets fired to kitchen`, description: `Course: ${courseLabel}` });
    setIsFiring(false);
    setSelectedCourseToFire(null);
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-20" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  if (loading) return <div className="p-8 flex items-center justify-center"><div className="w-6 h-6 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">

      {/* Summary */}
      <SummaryCards orders={orders} event={event} />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guest, table, meal…" className="pl-9 h-10 rounded-xl border-2 text-sm" />
          </div>
          <button onClick={() => setFilterAllergy(p => !p)}
            className={cn('h-10 px-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
              filterAllergy ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300')}>
            <AlertTriangle className="w-3.5 h-3.5" /> Allergies
          </button>
          <button onClick={() => setFilterUnfired(p => !p)}
            className={cn('h-10 px-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
              filterUnfired ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500 hover:border-slate-300')}>
            <Clock className="w-3.5 h-3.5" /> Unfired
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToCSV(orders, event?.name || 'Event')}
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
            <Printer className="w-3.5 h-3.5" /> Print Cards
          </Button>
          {/* Course fire button */}
          <Button
            onClick={() => handleFireCourse(selectedCourseToFire || 'Main Course')}
            disabled={isFiring || orders.filter(o => !o.firedAt).length === 0}
            className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/30">
            <Flame className="w-3.5 h-3.5" />
            {isFiring ? 'Firing…' : `Fire ${orders.filter(o => !o.firedAt).length} Tickets`}
          </Button>
        </div>
      </div>

      {/* Manifest table */}
      <div className="rounded-2xl border-2 border-slate-200 overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_80px_80px_1.5fr_1.5fr_80px] bg-slate-50 border-b border-slate-200 px-4 py-3">
          {[
            { label: 'Guest', field: 'guestName' as const },
            { label: 'Table', field: 'tableNumber' as const },
            { label: 'Seat', field: null },
            { label: 'Meal', field: null },
            { label: 'Allergies', field: null },
            { label: 'Status', field: 'submittedAt' as const },
          ].map(col => (
            <button key={col.label} onClick={col.field ? () => toggleSort(col.field!) : undefined}
              className={cn('text-left text-[9px] font-black uppercase tracking-widest flex items-center gap-1', col.field ? 'text-slate-600 hover:text-slate-900 cursor-pointer' : 'text-slate-400 cursor-default')}>
              {col.label} {col.field && <SortIcon field={col.field} />}
            </button>
          ))}
        </div>

        {/* Rows */}
        <div className="divide-y divide-slate-100">
          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <Users className="w-8 h-8 mx-auto text-slate-200 mb-2" />
              <p className="text-sm font-bold text-slate-400">{orders.length === 0 ? 'No orders yet' : 'No results'}</p>
            </div>
          )}
          {filtered.map(order => (
            <React.Fragment key={order.id}>
              <div
                onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                className={cn('grid grid-cols-[1fr_80px_80px_1.5fr_1.5fr_80px] px-4 py-3 cursor-pointer transition-colors',
                  order.allergies?.length > 0 ? 'hover:bg-amber-50/50' : 'hover:bg-slate-50',
                  expandedOrderId === order.id && 'bg-slate-50')}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn('w-2 h-2 rounded-full shrink-0', order.firedAt ? 'bg-emerald-500' : 'bg-slate-200')} />
                  <p className="font-bold text-sm text-slate-900 truncate">{order.guestName}</p>
                </div>
                <p className="text-sm font-bold text-slate-700 flex items-center">{order.tableNumber}</p>
                <p className="text-sm text-slate-500 flex items-center">{order.seatNumber || '—'}</p>
                <p className="text-sm font-bold text-slate-900 truncate flex items-center">{order.mealName || 'Multi-course'}</p>
                <div className="flex items-center"><AllergyBadge allergies={order.allergies} note={order.allergyNote} /></div>
                <div className="flex items-center">
                  {order.firedAt
                    ? <Badge className="bg-emerald-100 text-emerald-700 border-none text-[9px] font-black uppercase">Fired</Badge>
                    : <Badge variant="outline" className="text-[9px] font-black uppercase text-slate-500">Pending</Badge>
                  }
                </div>
              </div>
              {/* Expanded row */}
              <AnimatePresence>
                {expandedOrderId === order.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="bg-slate-50 border-t border-slate-100 px-4 py-4 overflow-hidden">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
                      <div><p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Email</p><p className="text-xs font-bold text-slate-700">{order.guestEmail || '—'}</p></div>
                      <div><p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Submitted</p><p className="text-xs font-bold text-slate-700">{format(safeDate(order.submittedAt), 'MMM d, h:mm a')}</p></div>
                      {order.allergyNote && <div className="col-span-2"><p className="text-[8px] font-black uppercase text-amber-600 mb-0.5">⚠ Allergy Note</p><p className="text-xs font-bold text-amber-700">{order.allergyNote}</p></div>}
                      {order.guestNote && <div className="col-span-2"><p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Guest Note</p><p className="text-xs text-slate-600">{order.guestNote}</p></div>}
                      {order.courseSelections && (
                        <div className="col-span-4 space-y-1">
                          <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Course Selections</p>
                          {Object.entries(order.courseSelections).map(([courseId, optionId]) => (
                            <p key={courseId} className="text-xs font-bold text-slate-700">{courseId}: {String(optionId)}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </React.Fragment>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 text-center">
        {filtered.length} of {orders.length} orders shown · Showing {filtered.filter(o => o.firedAt).length} fired, {filtered.filter(o => !o.firedAt).length} pending
      </p>
    </div>
  );
}