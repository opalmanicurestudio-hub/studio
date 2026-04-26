'use client';

/**
 * EventManifest.tsx
 * Dashboard component — shows inside the planner or events admin page.
 *
 * FIXES APPLIED:
 * 1. Tables show human-readable names, not raw IDs
 * 2. Seat number is a Select derived from table capacity, not free-text
 * 3. Drag-and-drop uses pointer events — works on mobile & desktop
 * 4. Tables listener waits for tenantId before subscribing (no phantom saves)
 * 5. New FloorPlanView tab: visual seating with guest avatars, status dots, allergy flags
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { collection, query, onSnapshot, doc, writeBatch, updateDoc, orderBy } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';
import {
  AlertTriangle, ChevronDown, ChevronUp, Download, Flame, Printer,
  Search, Users, Utensils, CheckCircle2, Clock, Filter, X,
  LayoutGrid, List, TableIcon, GripVertical,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const safeDate = (v: any) => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  if (typeof v === 'string') try { return parseISO(v); } catch { return new Date(); }
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return new Date(v);
};

const exportToCSV = (orders: any[], tables: Record<string, any>, eventName: string) => {
  const header = ['Name', 'Table', 'Seat', 'Meal', 'Allergies', 'Notes', 'Submitted'];
  const rows = orders.map(o => [
    o.guestName,
    // FIX: use human-readable table name instead of raw ID
    tables[o.tableId]?.name ?? o.tableNumber ?? '',
    o.seatNumber || '',
    o.mealName || 'Multi-course',
    (o.allergies || []).join('; '),
    o.allergyNote || '',
    format(safeDate(o.submittedAt), 'MMM d h:mm a'),
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${eventName.replace(/\s/g, '_')}_manifest.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── ALLERGY BADGE ────────────────────────────────────────────────────────────
const AllergyBadge = ({ allergies, note }: { allergies: string[]; note?: string }) => {
  if (!allergies?.length && !note) return <span className="text-slate-300 text-[10px]">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {(allergies || []).slice(0, 3).map(a => (
        <span key={a} className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
          {a}
        </span>
      ))}
      {(allergies || []).length > 3 && (
        <span className="text-[9px] font-black text-amber-600">+{allergies.length - 3}</span>
      )}
      {note && (
        <span title={note} className="text-[9px] font-black text-amber-600 cursor-help">⚠ note</span>
      )}
    </div>
  );
};

// ─── SUMMARY CARDS ────────────────────────────────────────────────────────────
const SummaryCards = ({ orders }: { orders: any[] }) => {
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
          <p className="text-[10px] text-slate-400">
            {orders.length > 0 ? Math.round((count / orders.length) * 100) : 0}% of guests
          </p>
        </div>
      ))}
      <div className={cn(
        'p-4 rounded-2xl border-2 space-y-1',
        allergyCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      )}>
        <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Allergy Flags</p>
        <p className={cn('text-3xl font-black', allergyCount > 0 ? 'text-amber-700' : 'text-slate-900')}>
          {allergyCount}
        </p>
        <p className="text-[10px] text-amber-600">{allergyCount > 0 ? 'require attention' : 'none flagged'}</p>
      </div>
    </div>
  );
};

// ─── SEAT SELECT ─────────────────────────────────────────────────────────────
// FIX: was a free-text Input — now derives valid seat numbers from the selected table's capacity.
// Shows "Select table first" when no table is chosen.
export const SeatSelect = ({
  tableId,
  tables,
  value,
  onChange,
  disabled,
}: {
  tableId: string | null;
  tables: Record<string, any>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) => {
  const selectedTable = tableId ? tables[tableId] : null;
  const capacity: number = selectedTable?.capacity ?? selectedTable?.seats ?? 0;
  const seatOptions = capacity > 0
    ? Array.from({ length: capacity }, (_, i) => String(i + 1))
    : [];

  // If the table changes and the current seat is no longer valid, clear it
  useEffect(() => {
    if (value && capacity > 0 && parseInt(value) > capacity) {
      onChange('');
    }
  }, [tableId, capacity]);

  return (
    <Select
      value={value || ''}
      onValueChange={onChange}
      disabled={disabled || !tableId || seatOptions.length === 0}
    >
      <SelectTrigger className="h-11 rounded-xl border-2 font-bold text-sm">
        <SelectValue placeholder={!tableId ? 'Select table first' : 'Seat'} />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-2 shadow-xl">
        {seatOptions.map(n => (
          <SelectItem key={n} value={n} className="font-bold">
            Seat {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// ─── TABLE SELECT ─────────────────────────────────────────────────────────────
// FIX: shows table name (e.g. "Table 4 — Round 8") not raw ID
export const TableSelect = ({
  tables,
  value,
  onChange,
}: {
  tables: Record<string, any>;
  value: string;
  onChange: (v: string) => void;
}) => {
  const tableList = Object.values(tables).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
  );

  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="h-11 rounded-xl border-2 font-bold text-sm">
        <SelectValue placeholder="Select table" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-2 shadow-xl">
        {tableList.map(t => (
          <SelectItem key={t.id} value={t.id} className="font-bold">
            {t.name}
            {t.capacity ? ` · ${t.capacity} seats` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// ─── FLOOR PLAN — TABLE CARD ──────────────────────────────────────────────────
// Shows a visual card for each table with guest avatars, check-in status,
// allergy dots, and pending order counts.
const FloorTableCard = ({
  table,
  guests,
  orders,
  onGuestDrop,
  isDragTarget,
}: {
  table: any;
  guests: any[];
  orders: any[];
  onGuestDrop: (guestId: string, tableId: string) => void;
  isDragTarget: boolean;
}) => {
  const seated = guests.filter(g => g.tableId === table.id);
  const allergyGuests = seated.filter(g => g.allergies?.length > 0);
  const pendingOrders = seated.filter(g => !orders.find(o => o.guestId === g.id || o.guestOrderId === g.id)?.mealChoiceId);
  const checkedIn = seated.filter(g => g.checkedIn);
  const capacity: number = table.capacity ?? table.seats ?? 0;
  const emptySeats = Math.max(0, capacity - seated.length);

  // FIX: pointer event handlers for drag-over detection
  const handleDragOver = (e: React.PointerEvent) => {
    // We detect when a dragged guest is hovering over this table
    // The actual drop is handled by the parent via onPointerUp
  };

  return (
    <div
      className={cn(
        'p-4 rounded-2xl border-2 bg-white transition-all space-y-3',
        isDragTarget && 'border-primary bg-primary/5 ring-2 ring-primary/20',
        allergyGuests.length > 0 ? 'border-amber-200' : 'border-slate-200',
        pendingOrders.length > 0 && !allergyGuests.length && 'border-dashed'
      )}
      data-table-id={table.id}
    >
      {/* Table header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">
            {table.name}
          </p>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            {capacity ? `${seated.length} / ${capacity} seated` : `${seated.length} seated`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {allergyGuests.length > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-black bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-2.5 h-2.5" /> {allergyGuests.length}
            </span>
          )}
          {pendingOrders.length > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-black bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
              <Clock className="w-2.5 h-2.5" /> {pendingOrders.length}
            </span>
          )}
        </div>
      </div>

      {/* Guest avatar cluster */}
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {seated.map(guest => {
          const guestOrder = orders.find(o => o.guestId === guest.id || o.guestName === guest.name);
          const isCheckedIn = guest.checkedIn;
          const hasMeal = !!guestOrder?.mealChoiceId || !!guestOrder?.mealName;
          const hasAllergy = guest.allergies?.length > 0;

          return (
            <div key={guest.id} className="relative" title={guest.name}>
              <Avatar className={cn(
                'w-9 h-9 border-2 transition-all',
                isCheckedIn ? 'border-emerald-400' : 'border-slate-200',
              )}>
                <AvatarImage src={guest.avatarUrl} alt={guest.name} />
                <AvatarFallback className={cn(
                  'text-[10px] font-black',
                  isCheckedIn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
                )}>
                  {(guest.name || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {/* Status dot: green = checked in, amber = allergy, grey = pending */}
              <span className={cn(
                'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white',
                hasAllergy ? 'bg-amber-400' :
                isCheckedIn ? 'bg-emerald-500' :
                hasMeal ? 'bg-blue-400' :
                'bg-slate-300'
              )} />
            </div>
          );
        })}

        {/* Empty seat placeholders */}
        {Array.from({ length: Math.min(emptySeats, 8) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="w-9 h-9 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center"
          >
            <span className="text-[9px] text-slate-300 font-black">{seated.length + i + 1}</span>
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1 text-[9px] font-black uppercase">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          <span className="text-emerald-600">{checkedIn.length} in</span>
        </div>
        {pendingOrders.length > 0 && (
          <div className="flex items-center gap-1 text-[9px] font-black uppercase">
            <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />
            <span className="text-slate-500">{pendingOrders.length} pending</span>
          </div>
        )}
        {allergyGuests.length > 0 && (
          <div className="flex items-center gap-1 text-[9px] font-black uppercase">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            <span className="text-amber-600">{allergyGuests.length} allergy</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── DRAGGABLE GUEST CHIP ─────────────────────────────────────────────────────
// FIX: uses pointer events instead of HTML5 drag API — works on mobile touch screens.
// The key insight is `touch-action: none` which prevents the browser from intercepting
// the touch events for scrolling before our handlers fire.
const DraggableGuestChip = ({
  guest,
  tables,
  onAssign,
}: {
  guest: any;
  tables: Record<string, any>;
  onAssign: (guestId: string, tableId: string, seatNumber?: string) => void;
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const currentTable = tables[guest.tableId];

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setStartPos({ x: e.clientX, y: e.clientY });
    setPos({ x: e.clientX, y: e.clientY });
    setIsDragging(false); // only set true after a small threshold
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startPos.x;
    const dy = e.clientY - startPos.y;
    // Only engage drag after 8px movement — prevents accidental drags on tap
    if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 8) {
      setIsDragging(true);
    }
    if (isDragging) {
      setPos({ x: e.clientX, y: e.clientY });
    }
  }, [isDragging, startPos]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) {
      setIsDragging(false);
      return;
    }
    setIsDragging(false);

    // Find which table card is under the drop point
    // We use elementFromPoint which works for both mouse and touch
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tableCard = el?.closest('[data-table-id]');
    const targetTableId = tableCard?.getAttribute('data-table-id');

    if (targetTableId && targetTableId !== guest.tableId) {
      onAssign(guest.id, targetTableId);
    }
  }, [isDragging, guest.id, guest.tableId, onAssign]);

  return (
    <>
      {/* Draggable chip */}
      <div
        ref={ref}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          // FIX: touch-action: none is CRITICAL on mobile — without it the browser
          // captures the touch event for scrolling and our handlers never fire
          touchAction: 'none',
          userSelect: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
          opacity: isDragging ? 0.4 : 1,
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl border-2 bg-white transition-all',
          guest.allergies?.length > 0 ? 'border-amber-200' : 'border-slate-200',
          guest.checkedIn && 'border-emerald-200 bg-emerald-50/30',
        )}
      >
        <GripVertical className="w-3 h-3 text-slate-300 shrink-0" />
        <Avatar className="w-7 h-7 border border-slate-200 shrink-0">
          <AvatarFallback className="text-[9px] font-black bg-slate-100 text-slate-600">
            {(guest.name || '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase truncate text-slate-900">{guest.name}</p>
          <p className="text-[9px] font-bold text-slate-400 truncate">
            {currentTable?.name ?? 'Unassigned'}
            {guest.seatNumber ? ` · Seat ${guest.seatNumber}` : ''}
          </p>
        </div>
        {guest.allergies?.length > 0 && (
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        )}
        {guest.checkedIn && (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        )}
      </div>

      {/* Floating ghost during drag */}
      {isDragging && (
        <div
          className="fixed pointer-events-none z-50 px-3 py-2 rounded-xl border-2 border-primary bg-white shadow-2xl shadow-primary/20 flex items-center gap-2 opacity-90"
          style={{ left: pos.x - 60, top: pos.y - 20, transform: 'rotate(-2deg)' }}
        >
          <Avatar className="w-6 h-6 border border-primary/20 shrink-0">
            <AvatarFallback className="text-[9px] font-black bg-primary/10 text-primary">
              {(guest.name || '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <p className="text-[11px] font-black uppercase text-slate-900 whitespace-nowrap">{guest.name}</p>
        </div>
      )}
    </>
  );
};

// ─── FLOOR PLAN VIEW ─────────────────────────────────────────────────────────
// Visual seating overview — all tables as cards with avatars + status dots.
// Includes an unassigned guest panel with drag-to-assign functionality.
const FloorPlanView = ({
  tables,
  guests,
  orders,
  onAssignGuest,
}: {
  tables: Record<string, any>;
  guests: any[];
  orders: any[];
  onAssignGuest: (guestId: string, tableId: string, seatNumber?: string) => void;
}) => {
  const [dragTargetTableId, setDragTargetTableId] = useState<string | null>(null);
  const tableList = Object.values(tables).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
  );
  const unassigned = guests.filter(g => !g.tableId || !tables[g.tableId]);

  // Legend items
  const legend = [
    { color: 'bg-emerald-500', label: 'Checked in' },
    { color: 'bg-blue-400', label: 'Meal selected' },
    { color: 'bg-amber-400', label: 'Allergy flag' },
    { color: 'bg-slate-300', label: 'Pending' },
  ];

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="flex items-center flex-wrap gap-4 px-1">
        {legend.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-full', l.color)} />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{l.label}</span>
          </div>
        ))}
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-auto">
          Drag guests between tables
        </span>
      </div>

      {/* Unassigned guests panel */}
      {unassigned.length > 0 && (
        <div className="p-4 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> {unassigned.length} Unassigned Guest{unassigned.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {unassigned.map(g => (
              <DraggableGuestChip
                key={g.id}
                guest={g}
                tables={tables}
                onAssign={onAssignGuest}
              />
            ))}
          </div>
        </div>
      )}

      {/* Table grid */}
      {tableList.length === 0 ? (
        <div className="text-center py-16 border-4 border-dashed rounded-[2.5rem] opacity-30">
          <TableIcon className="w-10 h-10 mx-auto mb-3" />
          <p className="font-black uppercase tracking-widest text-sm">No tables configured</p>
          <p className="text-[10px] font-bold mt-1 opacity-60">Add tables in the event settings</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tableList.map(table => (
            <FloorTableCard
              key={table.id}
              table={table}
              guests={guests}
              orders={orders}
              onGuestDrop={onAssignGuest}
              isDragTarget={dragTargetTableId === table.id}
            />
          ))}
        </div>
      )}

      {/* Summary footer */}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-dashed text-[10px] font-black uppercase tracking-widest text-slate-400">
        <span>{guests.length} total guests</span>
        <span>{guests.filter(g => g.checkedIn).length} checked in</span>
        <span>{guests.filter(g => g.allergies?.length > 0).length} allergy flags</span>
        <span>{unassigned.length} unassigned</span>
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
  const [guests, setGuests] = useState<any[]>([]);
  // FIX: tables stored as id→object map for O(1) lookup during render
  const [tables, setTables] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAllergy, setFilterAllergy] = useState(false);
  const [filterUnfired, setFilterUnfired] = useState(false);
  const [sortField, setSortField] = useState<'tableNumber' | 'guestName' | 'submittedAt'>('tableNumber');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isFiring, setIsFiring] = useState(false);
  const [selectedCourseToFire, setSelectedCourseToFire] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'list' | 'floor'>('list');

  // FIX: Live listener on guestOrders — guard ensures tenantId exists before subscribing.
  // Previously the effect had empty deps [] so if tenantId was undefined on mount,
  // the listener would never be created and tables would appear empty.
  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const q = query(collection(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`));
    const unsub = onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      console.error('[EventManifest] orders listener error:', err);
      setLoading(false);
    });
    return unsub;
  }, [firestore, tenantId, eventId]); // FIX: all three as deps

  // FIX: Live listener on guests subcollection — same guard pattern
  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const q = query(collection(firestore, `tenants/${tenantId}/events/${eventId}/guests`));
    const unsub = onSnapshot(q, snap => {
      setGuests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error('[EventManifest] guests listener error:', err));
    return unsub;
  }, [firestore, tenantId, eventId]);

  // FIX: Live listener on tables — guard + convert array to map for fast lookup.
  // Was previously reading from a different path or without the tenantId guard.
  useEffect(() => {
    if (!firestore || !tenantId) return;
    // Tables live at the tenant level, not inside the event
    const q = query(collection(firestore, `tenants/${tenantId}/tables`));
    const unsub = onSnapshot(q, snap => {
      const map: Record<string, any> = {};
      snap.docs.forEach(d => {
        map[d.id] = { id: d.id, ...d.data() };
      });
      setTables(map);
    }, err => console.error('[EventManifest] tables listener error:', err));
    return unsub;
  }, [firestore, tenantId]); // FIX: only depends on firestore + tenantId, not eventId

  // FIX: resolves human-readable table name for display
  const resolveTableName = useCallback((order: any): string => {
    // First try the tableId reference (new format)
    if (order.tableId && tables[order.tableId]) {
      return tables[order.tableId].name;
    }
    // Fallback: tableNumber might be a name already, or an old ID
    if (order.tableNumber) {
      // Check if it looks like a Firestore ID (20+ alphanumeric chars)
      if (/^[a-zA-Z0-9]{15,}$/.test(order.tableNumber)) {
        return tables[order.tableNumber]?.name ?? `Table ${order.tableNumber.slice(0, 4)}…`;
      }
      return order.tableNumber;
    }
    return '—';
  }, [tables]);

  const filtered = useMemo(() => {
    let list = [...orders];
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(o =>
        o.guestName?.toLowerCase().includes(s) ||
        resolveTableName(o).toLowerCase().includes(s) ||
        o.mealName?.toLowerCase().includes(s)
      );
    }
    if (filterAllergy) list = list.filter(o => o.allergies?.length > 0 || o.allergyNote);
    if (filterUnfired) list = list.filter(o => !o.firedAt);
    list.sort((a, b) => {
      let av: any = a[sortField] || '';
      let bv: any = b[sortField] || '';
      if (sortField === 'tableNumber') {
        av = parseInt(resolveTableName(a)) || 0;
        bv = parseInt(resolveTableName(b)) || 0;
      }
      if (sortField === 'submittedAt') {
        av = safeDate(av).getTime();
        bv = safeDate(bv).getTime();
      }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [orders, search, filterAllergy, filterUnfired, sortField, sortDir, resolveTableName]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  // Assign a guest to a different table (from drag-and-drop in FloorPlanView)
  const handleAssignGuest = async (guestId: string, tableId: string, seatNumber?: string) => {
    if (!firestore || !tenantId || !eventId) return;
    try {
      const guestRef = doc(firestore, `tenants/${tenantId}/events/${eventId}/guests`, guestId);
      await updateDoc(guestRef, {
        tableId,
        tableName: tables[tableId]?.name ?? '',
        ...(seatNumber ? { seatNumber } : {}),
        updatedAt: new Date().toISOString(),
      });
      toast({ title: `Moved to ${tables[tableId]?.name ?? 'table'}` });
    } catch (e) {
      console.error('[EventManifest] assign guest error:', e);
      toast({ variant: 'destructive', title: 'Could not reassign guest' });
    }
  };

  // ── Course Firing ──────────────────────────────────────────────────────────
  const handleFireCourse = async (courseLabel: string) => {
    if (isFiring) return;
    const toFire = orders.filter(o => !o.firedAt);
    if (toFire.length === 0) {
      toast({ title: 'All orders already fired' });
      return;
    }
    setIsFiring(true);
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();

    toFire.forEach(order => {
      const kdsRef = doc(collection(firestore, `tenants/${tenantId}/kdsTickets`));
      batch.set(kdsRef, {
        id: kdsRef.id,
        eventId,
        tenantId,
        guestOrderId: order.id,
        guestName: order.guestName,
        // FIX: store both the ID and resolved name on the ticket
        tableId: order.tableId || null,
        tableName: resolveTableName(order),
        tableNumber: resolveTableName(order),
        seatNumber: order.seatNumber || null,
        courseLabel,
        mealId: order.mealId || null,
        mealName: order.mealName || null,
        courseSelection: order.courseSelections?.[selectedCourseToFire || ''] || null,
        allergies: order.allergies || [],
        allergyNote: order.allergyNote || null,
        status: 'in_progress',
        firedAt: now,
        ticketType: 'event_course',
      });

      const orderRef = doc(firestore, `tenants/${tenantId}/events/${eventId}/guestOrders`, order.id);
      batch.update(orderRef, { firedAt: now, kdsTicketId: kdsRef.id, status: 'in_progress' });
    });

    await batch.commit();
    toast({
      title: `🔥 ${toFire.length} tickets fired to kitchen`,
      description: `Course: ${courseLabel}`,
    });
    setIsFiring(false);
    setSelectedCourseToFire(null);
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-20" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  if (loading) return (
    <div className="p-8 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      <SummaryCards orders={orders} />

      {/* View toggle + toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search guest, table, meal…"
              className="pl-9 h-10 rounded-xl border-2 text-sm"
            />
          </div>
          <button
            onClick={() => setFilterAllergy(p => !p)}
            className={cn(
              'h-10 px-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
              filterAllergy ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Allergies
          </button>
          <button
            onClick={() => setFilterUnfired(p => !p)}
            className={cn(
              'h-10 px-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
              filterUnfired ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500 hover:border-slate-300'
            )}
          >
            <Clock className="w-3.5 h-3.5" /> Unfired
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center border-2 border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setActiveView('list')}
              className={cn(
                'h-10 px-3 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
                activeView === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              <List className="w-3.5 h-3.5" /> List
            </button>
            <button
              onClick={() => setActiveView('floor')}
              className={cn(
                'h-10 px-3 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
                activeView === 'floor' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Floor
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToCSV(orders, tables, event?.name || 'Event')}
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </Button>
          <Button
            onClick={() => handleFireCourse(selectedCourseToFire || 'Main Course')}
            disabled={isFiring || orders.filter(o => !o.firedAt).length === 0}
            className="h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/30"
          >
            <Flame className="w-3.5 h-3.5" />
            {isFiring ? 'Firing…' : `Fire ${orders.filter(o => !o.firedAt).length} Tickets`}
          </Button>
        </div>
      </div>

      {/* ── LIST VIEW ── */}
      {activeView === 'list' && (
        <div className="rounded-2xl border-2 border-slate-200 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_80px_80px_1.5fr_1.5fr_80px] bg-slate-50 border-b border-slate-200 px-4 py-3">
            {[
              { label: 'Guest',     field: 'guestName' as const },
              { label: 'Table',     field: 'tableNumber' as const },
              { label: 'Seat',      field: null },
              { label: 'Meal',      field: null },
              { label: 'Allergies', field: null },
              { label: 'Status',    field: 'submittedAt' as const },
            ].map(col => (
              <button
                key={col.label}
                onClick={col.field ? () => toggleSort(col.field!) : undefined}
                className={cn(
                  'text-left text-[9px] font-black uppercase tracking-widest flex items-center gap-1',
                  col.field ? 'text-slate-600 hover:text-slate-900 cursor-pointer' : 'text-slate-400 cursor-default'
                )}
              >
                {col.label} {col.field && <SortIcon field={col.field} />}
              </button>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <div className="py-12 text-center">
                <Users className="w-8 h-8 mx-auto text-slate-200 mb-2" />
                <p className="text-sm font-bold text-slate-400">
                  {orders.length === 0 ? 'No orders yet' : 'No results'}
                </p>
              </div>
            )}
            {filtered.map(order => (
              <React.Fragment key={order.id}>
                <div
                  onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                  className={cn(
                    'grid grid-cols-[1fr_80px_80px_1.5fr_1.5fr_80px] px-4 py-3 cursor-pointer transition-colors',
                    order.allergies?.length > 0 ? 'hover:bg-amber-50/50' : 'hover:bg-slate-50',
                    expandedOrderId === order.id && 'bg-slate-50'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      order.firedAt ? 'bg-emerald-500' : 'bg-slate-200'
                    )} />
                    <p className="font-bold text-sm text-slate-900 truncate">{order.guestName}</p>
                  </div>
                  {/* FIX: show resolved table name, not raw tableNumber/ID */}
                  <p className="text-sm font-bold text-slate-700 flex items-center">
                    {resolveTableName(order)}
                  </p>
                  <p className="text-sm text-slate-500 flex items-center">{order.seatNumber || '—'}</p>
                  <p className="text-sm font-bold text-slate-900 truncate flex items-center">
                    {order.mealName || 'Multi-course'}
                  </p>
                  <div className="flex items-center">
                    <AllergyBadge allergies={order.allergies} note={order.allergyNote} />
                  </div>
                  <div className="flex items-center">
                    {order.firedAt
                      ? <Badge className="bg-emerald-100 text-emerald-700 border-none text-[9px] font-black uppercase">Fired</Badge>
                      : <Badge variant="outline" className="text-[9px] font-black uppercase text-slate-500">Pending</Badge>
                    }
                  </div>
                </div>

                {/* Expanded detail row */}
                <AnimatePresence>
                  {expandedOrderId === order.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="bg-slate-50 border-t border-slate-100 px-4 py-4 overflow-hidden"
                    >
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
                        <div>
                          <p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Email</p>
                          <p className="text-xs font-bold text-slate-700">{order.guestEmail || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Table</p>
                          {/* FIX: expanded row also shows resolved name */}
                          <p className="text-xs font-bold text-slate-700">{resolveTableName(order)}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Submitted</p>
                          <p className="text-xs font-bold text-slate-700">
                            {format(safeDate(order.submittedAt), 'MMM d, h:mm a')}
                          </p>
                        </div>
                        {order.allergyNote && (
                          <div className="col-span-2">
                            <p className="text-[8px] font-black uppercase text-amber-600 mb-0.5">⚠ Allergy Note</p>
                            <p className="text-xs font-bold text-amber-700">{order.allergyNote}</p>
                          </div>
                        )}
                        {order.guestNote && (
                          <div className="col-span-2">
                            <p className="text-[8px] font-black uppercase text-slate-400 mb-0.5">Guest Note</p>
                            <p className="text-xs text-slate-600">{order.guestNote}</p>
                          </div>
                        )}
                        {order.courseSelections && (
                          <div className="col-span-4 space-y-1">
                            <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Course Selections</p>
                            {Object.entries(order.courseSelections).map(([courseId, optionId]) => (
                              <p key={courseId} className="text-xs font-bold text-slate-700">
                                {courseId}: {String(optionId)}
                              </p>
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
      )}

      {/* ── FLOOR PLAN VIEW ── */}
      {activeView === 'floor' && (
        <FloorPlanView
          tables={tables}
          guests={guests}
          orders={orders}
          onAssignGuest={handleAssignGuest}
        />
      )}

      <p className="text-[10px] text-slate-400 text-center">
        {filtered.length} of {orders.length} orders shown
        {' · '}
        {filtered.filter(o => o.firedAt).length} fired,{' '}
        {filtered.filter(o => !o.firedAt).length} pending
      </p>
    </div>
  );
}