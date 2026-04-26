'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import {
  doc, collection, query, where, writeBatch, onSnapshot,
  updateDoc, deleteDoc, addDoc, getDoc, increment, getDocs,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { format, parseISO, formatDistanceToNowStrict } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { AppHeader } from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Users, AlertTriangle, Leaf, Download, Play, CheckCircle2, Loader,
  QrCode, Printer, BarChart2, Search, Plus, Utensils, Link2, Copy,
  UserPlus, Pencil, Trash2, PackageCheck, PackageX, ChevronDown,
  ChevronUp, X, UserCheck, Box, Check, Bell, ExternalLink,
  RefreshCw, ShieldAlert, Megaphone, Send, Package, FlaskConical,
  MoreHorizontal, MapPin, LayoutGrid, List, FileText, Layers,
  CalendarCheck, ArrowRight, Clock, Info, Users2, TableIcon,
  GripVertical,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));
const safeNum  = (v: any) => Number(v) || 0;
const NO_SELECTION = '**none**';

// ─── ALLERGY PILL ──────────────────────────────────────────────────────────────
const AllergyPill = ({ allergy }: { allergy: any }) => {
  const label    = typeof allergy === 'object' ? allergy.label    : allergy;
  const severity = typeof allergy === 'object' ? allergy.severity : 'preference';
  if (severity === 'critical') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-red-100 border-red-400 text-red-800">
      <AlertTriangle className="w-2.5 h-2.5" /> {label}
    </span>
  );
  if (severity === 'intolerance') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-amber-50 border-amber-300 text-amber-800">
      <AlertTriangle className="w-2 h-2" /> {label}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-slate-100 border-slate-200 text-slate-600">
      <Leaf className="w-2 h-2" /> {label}
    </span>
  );
};

// ─── CAPACITY RING ─────────────────────────────────────────────────────────────
const CapacityRing = ({ checkedIn, total, capacity }: {
  checkedIn: number; total: number; capacity: number | null;
}) => {
  const size   = 72;
  const stroke = 6;
  const r      = (size - stroke) / 2;
  const circ   = 2 * Math.PI * r;
  const cap    = capacity || total || 1;
  const pct    = Math.min(checkedIn / cap, 1);
  const dash   = pct * circ;
  const color  = pct >= 1 ? '#10b981' : pct >= 0.7 ? '#3b82f6' : '#94a3b8';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - dash}
          className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-lg font-black text-slate-900 leading-none">{checkedIn}</p>
        <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">in</p>
      </div>
    </div>
  );
};

// ─── ORDERING DEADLINE BANNER ──────────────────────────────────────────────────
const OrderingDeadlineBanner = ({ deadline }: { deadline: string }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);
  const deadlineMs = new Date(deadline).getTime();
  const msLeft = deadlineMs - now;
  if (msLeft <= 0) return null;
  const hLeft = Math.floor(msLeft / 3600000);
  const mLeft = Math.floor((msLeft % 3600000) / 60000);
  const label  = hLeft > 0 ? `${hLeft}h ${mLeft}m` : `${mLeft}m`;
  const urgent = msLeft < 3600000;
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-2xl border-2 p-4 flex items-center justify-between gap-4',
        urgent ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300')}>
      <div className="flex items-center gap-3">
        <Clock className={cn('w-4 h-4 shrink-0', urgent ? 'text-red-500 animate-pulse' : 'text-amber-600')} />
        <div>
          <p className={cn('font-black text-sm uppercase tracking-tight', urgent ? 'text-red-800' : 'text-amber-800')}>
            Ordering closes in {label}
          </p>
          <p className={cn('text-[9px] font-bold uppercase tracking-widest', urgent ? 'text-red-600' : 'text-amber-600')}>
            Guests cannot submit after {format(new Date(deadline), 'h:mm a')}
          </p>
        </div>
      </div>
      <span className={cn('text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl',
        urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
        {format(new Date(deadline), 'MMM d')}
      </span>
    </motion.div>
  );
};

// ─── STAT CARD ─────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = 'slate' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) => {
  const colors: Record<string, string> = {
    slate:   'bg-white border-slate-200',
    amber:   'bg-amber-50 border-amber-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    blue:    'bg-blue-50 border-blue-200',
    red:     'bg-red-50 border-red-200',
  };
  return (
    <div className={cn('p-5 rounded-2xl border-2', colors[color] || colors.slate)}>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className="text-3xl font-black tracking-tighter text-slate-900 leading-none">{value}</p>
      {sub && <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wide">{sub}</p>}
    </div>
  );
};

// ─── FIX 1: TABLE SELECT — shows name not ID ──────────────────────────────────
const TableSelectField = ({
  tables,
  value,
  onChange,
  placeholder = 'Select table',
}: {
  tables: Record<string, any>;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => {
  const tableList = Object.values(tables).sort((a: any, b: any) =>
    (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
  );
  if (tableList.length === 0) {
    return (
      <div className="h-11 rounded-xl border-2 border-dashed border-slate-200 flex items-center px-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No tables configured</p>
      </div>
    );
  }
  return (
    <Select value={value || NO_SELECTION} onValueChange={v => onChange(v === NO_SELECTION ? '' : v)}>
      <SelectTrigger className="h-11 rounded-xl border-2 font-bold text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-2 shadow-xl">
        <SelectItem value={NO_SELECTION}>No table</SelectItem>
        {tableList.map((t: any) => (
          <SelectItem key={t.id} value={t.id} className="font-bold">
            {t.name}{t.capacity ? ` · ${t.capacity} seats` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// ─── FIX 2: SEAT SELECT — derived from table capacity, not free-text ──────────
const SeatSelectField = ({
  tableId,
  tables,
  value,
  onChange,
}: {
  tableId: string;
  tables: Record<string, any>;
  value: string;
  onChange: (v: string) => void;
}) => {
  const selectedTable = tableId ? tables[tableId] : null;
  const capacity: number = selectedTable?.capacity ?? selectedTable?.seats ?? 0;
  const seatOptions = capacity > 0
    ? Array.from({ length: capacity }, (_, i) => String(i + 1))
    : [];

  useEffect(() => {
    if (value && capacity > 0 && parseInt(value) > capacity) {
      onChange('');
    }
  }, [tableId, capacity]);

  if (!tableId || tableId === NO_SELECTION) {
    return (
      <div className="h-11 rounded-xl border-2 border-dashed border-slate-200 flex items-center px-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select table first</p>
      </div>
    );
  }
  if (seatOptions.length === 0) {
    return (
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Seat #"
        className="h-11 rounded-xl border-2"
      />
    );
  }
  return (
    <Select value={value || NO_SELECTION} onValueChange={v => onChange(v === NO_SELECTION ? '' : v)}>
      <SelectTrigger className="h-11 rounded-xl border-2 font-bold text-sm">
        <SelectValue placeholder="Seat" />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-2 shadow-xl">
        <SelectItem value={NO_SELECTION}>No seat</SelectItem>
        {seatOptions.map(n => (
          <SelectItem key={n} value={n} className="font-bold">Seat {n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// ─── FIX 3: FLOOR PLAN — TAP-TO-ASSIGN (replaces broken mobile drag) ──────────
// On mobile, drag-and-drop with pointer capture is unreliable because browsers
// intercept scroll gestures. We replace it with a two-tap model:
//   Tap 1: select the guest (shows "moving X" indicator)
//   Tap 2: tap a table card to assign them
// On desktop we keep the drag feel via a simpler mouse-only approach.

const FloorTableCard = ({
  table,
  guests,
  orders,
  isSelected,
  movingGuest,
  onSelectTable,
  onSelectGuest,
}: {
  table: any;
  guests: any[];
  orders: any[];
  isSelected?: boolean;
  movingGuest?: any | null;
  onSelectTable?: (tableId: string) => void;
  onSelectGuest?: (guest: any) => void;
}) => {
  const seated = guests.filter(g => g.tableId === table.id || g.tableNumber === table.id || g.tableNumber === table.name);
  const allergyGuests = seated.filter(g => g.allergies?.length > 0);
  const checkedIn = seated.filter(g => g.checkedIn);
  const capacity: number = table.capacity ?? table.seats ?? 0;
  const emptySeats = Math.max(0, capacity - seated.length);
  const pendingOrders = seated.filter(g =>
    !orders.find(o => o.guestId === g.id || o.guestName === g.name)?.mealChoiceId
  );

  return (
    <div
      onClick={() => movingGuest && onSelectTable?.(table.id)}
      className={cn(
        'p-4 rounded-2xl border-2 bg-white transition-all space-y-3 select-none',
        movingGuest ? 'cursor-pointer hover:border-primary hover:bg-primary/5 hover:shadow-lg' : 'cursor-default',
        isSelected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
        allergyGuests.length > 0 && !movingGuest ? 'border-amber-200' : '',
        movingGuest && !isSelected ? 'border-slate-300' : '',
      )}
    >
      {/* Table header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">{table.name}</p>
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

      {/* Guest avatar cluster — FIX 4: at-a-glance avatars with status dots */}
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {seated.map((guest: any) => {
          const guestOrder = orders.find(o => o.guestId === guest.id || o.guestName === guest.name);
          const isCheckedIn = guest.checkedIn;
          const hasMeal = !!guestOrder?.mealChoiceId || !!guestOrder?.mealName || !!guest.mealChoiceId;
          const hasAllergy = (guest.allergies || []).length > 0;
          const hasCritical = (guest.allergies || []).some((a: any) => a.severity === 'critical');

          return (
            <div
              key={guest.id}
              className={cn(
                'relative cursor-pointer transition-transform hover:scale-110',
                movingGuest?.id === guest.id && 'ring-2 ring-primary ring-offset-1 rounded-full scale-110',
              )}
              title={`${guest.name}${guest.seatNumber ? ` · Seat ${guest.seatNumber}` : ''}`}
              onClick={e => {
                e.stopPropagation();
                if (!movingGuest) onSelectGuest?.(guest);
              }}
            >
              <Avatar className={cn(
                'w-9 h-9 border-2 transition-all',
                isCheckedIn ? 'border-emerald-400' : 'border-slate-200',
                hasCritical && 'border-red-400',
              )}>
                <AvatarImage src={guest.avatarUrl} alt={guest.name} />
                <AvatarFallback className={cn(
                  'text-[10px] font-black',
                  isCheckedIn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
                )}>
                  {(guest.name || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {/* Status dot */}
              <span className={cn(
                'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white',
                hasCritical ? 'bg-red-500' :
                hasAllergy ? 'bg-amber-400' :
                isCheckedIn ? 'bg-emerald-500' :
                hasMeal ? 'bg-blue-400' :
                'bg-slate-300'
              )} />
            </div>
          );
        })}

        {/* Empty seat placeholders */}
        {Array.from({ length: Math.min(emptySeats, 6) }).map((_, i) => (
          <div key={`empty-${i}`}
            className="w-9 h-9 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
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
        {movingGuest && (
          <div className="ml-auto text-[9px] font-black uppercase text-primary animate-pulse">
            Tap to seat here →
          </div>
        )}
      </div>
    </div>
  );
};

// ─── FIX 3 CONTINUED: FLOOR PLAN VIEW (tap-to-assign) ────────────────────────
const FloorPlanView = ({
  tables,
  guests,
  orders,
  onAssignGuest,
}: {
  tables: Record<string, any>;
  guests: any[];
  orders: any[];
  onAssignGuest: (guestId: string, tableId: string) => void;
}) => {
  // Tap-to-assign state: tap a guest chip → set movingGuest → tap a table → assign
  const [movingGuest, setMovingGuest] = useState<any | null>(null);

  const tableList = Object.values(tables).sort((a: any, b: any) =>
    (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
  );

  // A guest is "unassigned" if their tableId doesn't match any known table
  const unassigned = guests.filter(g => {
    if (!g.tableId && !g.tableNumber) return true;
    const byId = g.tableId && tables[g.tableId];
    const byNum = g.tableNumber && Object.values(tables).find((t: any) => t.name === g.tableNumber || t.id === g.tableNumber);
    return !byId && !byNum;
  });

  const handleSelectGuest = (guest: any) => {
    setMovingGuest(prev => prev?.id === guest.id ? null : guest);
  };

  const handleSelectTable = (tableId: string) => {
    if (!movingGuest) return;
    onAssignGuest(movingGuest.id, tableId);
    setMovingGuest(null);
  };

  const legend = [
    { color: 'bg-emerald-500', label: 'Checked in' },
    { color: 'bg-blue-400', label: 'Meal selected' },
    { color: 'bg-amber-400', label: 'Allergy' },
    { color: 'bg-red-500', label: 'Critical allergy' },
    { color: 'bg-slate-300', label: 'Pending' },
  ];

  return (
    <div className="space-y-6">
      {/* Legend + instructions */}
      <div className="flex items-center flex-wrap gap-4 px-1">
        {legend.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-full', l.color)} />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{l.label}</span>
          </div>
        ))}
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-auto hidden sm:block">
          Tap guest → tap table to reassign
        </span>
      </div>

      {/* Moving guest indicator */}
      <AnimatePresence>
        {movingGuest && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between p-3 rounded-2xl bg-primary/10 border-2 border-primary/30"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-black text-primary text-sm">
                {movingGuest.name?.charAt(0)}
              </div>
              <div>
                <p className="font-black text-sm text-slate-900">{movingGuest.name}</p>
                <p className="text-[9px] font-bold text-primary uppercase tracking-widest">Tap a table below to seat them</p>
              </div>
            </div>
            <button onClick={() => setMovingGuest(null)} className="p-2 rounded-xl hover:bg-primary/10 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unassigned guests panel */}
      {unassigned.length > 0 && (
        <div className="p-4 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> {unassigned.length} Unassigned Guest{unassigned.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((g: any) => (
              <button
                key={g.id}
                onClick={() => handleSelectGuest(g)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-xl border-2 bg-white transition-all text-left',
                  movingGuest?.id === g.id
                    ? 'border-primary bg-primary/5 shadow-md shadow-primary/20'
                    : 'border-slate-200 hover:border-primary/30',
                  (g.allergies || []).length > 0 && 'border-amber-200',
                )}
              >
                <Avatar className="w-7 h-7 border border-slate-200 shrink-0">
                  <AvatarFallback className="text-[9px] font-black bg-slate-100 text-slate-600">
                    {(g.name || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase truncate text-slate-900">{g.name}</p>
                  {(g.allergies || []).length > 0 && (
                    <p className="text-[9px] font-bold text-amber-600">⚠ allergy</p>
                  )}
                </div>
                {movingGuest?.id === g.id && <Check className="w-3 h-3 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table grid */}
      {tableList.length === 0 ? (
        <div className="text-center py-16 border-4 border-dashed rounded-[2.5rem] opacity-30">
          <TableIcon className="w-10 h-10 mx-auto mb-3" />
          <p className="font-black uppercase tracking-widest text-sm">No tables configured</p>
          <p className="text-[10px] font-bold mt-1 opacity-60">Add tables in event settings</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tableList.map((table: any) => (
            <FloorTableCard
              key={table.id}
              table={table}
              guests={guests}
              orders={orders}
              movingGuest={movingGuest}
              onSelectTable={handleSelectTable}
              onSelectGuest={handleSelectGuest}
            />
          ))}
        </div>
      )}

      {/* Summary footer */}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-dashed text-[10px] font-black uppercase tracking-widest text-slate-400">
        <span>{guests.length} total guests</span>
        <span>{guests.filter(g => g.checkedIn).length} checked in</span>
        <span>{guests.filter(g => (g.allergies || []).length > 0).length} allergy flags</span>
        <span>{unassigned.length} unassigned</span>
      </div>
    </div>
  );
};

// ─── FIX 5: TABLE GROUPED VIEW — resolves table/seat names ────────────────────
const TableGroupedView = ({
  guests, menuItems, tables, onCheckIn, onEdit, onDelete, onOverride,
}: {
  guests: any[]; menuItems: any[]; tables: Record<string, any>;
  onCheckIn: (id: string, current: boolean) => void;
  onEdit: (g: any) => void;
  onDelete: (id: string) => void;
  onOverride: (g: any) => void;
}) => {
  // Resolve a table display name from either tableId or tableNumber
  const resolveTable = (g: any) => {
    if (g.tableId && tables[g.tableId]) return tables[g.tableId].name;
    if (g.tableNumber) {
      // Check if it's an ID
      if (tables[g.tableNumber]) return tables[g.tableNumber].name;
      return g.tableNumber; // already a name
    }
    return null;
  };

  const byTable = useMemo(() => {
    const groups: Record<string, any[]> = {};
    guests.forEach(g => {
      const key = resolveTable(g) || '__unassigned__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(g);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '__unassigned__') return 1;
      if (b === '__unassigned__') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [guests, tables]);

  return (
    <div className="space-y-4">
      {byTable.map(([tableName, tableGuests]) => {
        const checkedInCount = tableGuests.filter(g => g.checkedIn).length;
        const hasCritical = tableGuests.some(g => (g.allergies || []).some((a: any) => a.severity === 'critical'));
        return (
          <div key={tableName} className={cn('rounded-2xl border-2 overflow-hidden', hasCritical ? 'border-red-200' : 'border-slate-200')}>
            <div className={cn('px-5 py-3 flex items-center justify-between', hasCritical ? 'bg-red-50' : 'bg-slate-50')}>
              <div className="flex items-center gap-3">
                <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm', hasCritical ? 'bg-red-100 text-red-700' : 'bg-white text-slate-700 border border-slate-200')}>
                  {tableName === '__unassigned__' ? '?' : tableName.charAt(0)}
                </div>
                <div>
                  <p className="font-black text-sm text-slate-900 uppercase tracking-tight">
                    {tableName === '__unassigned__' ? 'No Table Assigned' : tableName}
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {checkedInCount} / {tableGuests.length} in
                    {hasCritical && <span className="ml-2 text-red-500">⚠ Critical allergy</span>}
                  </p>
                </div>
              </div>
            </div>
            <div className="divide-y divide-slate-50">
              {tableGuests.map(g => {
                const mealName = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName;
                return (
                  <div key={g.id} className={cn('flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors', !g.checkedIn && 'opacity-60')}>
                    <button onClick={() => onCheckIn(g.id, g.checkedIn)}
                      className={cn('w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all',
                        g.checkedIn ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-transparent hover:border-emerald-300')}>
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-sm text-slate-900">{g.name}</p>
                        {/* FIX: show human-readable seat, not raw value */}
                        {g.seatNumber && (
                          <span className="text-[9px] font-bold text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded-lg">
                            Seat {g.seatNumber}
                          </span>
                        )}
                        {(g.allergies || []).map((a: any, i: number) => <AllergyPill key={i} allergy={a} />)}
                      </div>
                      {mealName && <p className="text-[10px] font-bold text-slate-500 mt-0.5">{mealName}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onOverride(g)} className="p-1.5 rounded-lg hover:bg-primary/10 text-slate-400 hover:text-primary transition-colors"><Utensils className="w-3 h-3" /></button>
                      <button onClick={() => onEdit(g)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => onDelete(g.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── COURSE FIRE CONFIRM ───────────────────────────────────────────────────────
const CourseFireConfirmDialog = ({ open, onOpenChange, courseNumber, courseName, guests, menuItems, onConfirm, isFiring }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  courseNumber: number; courseName: string;
  guests: any[]; menuItems: any[];
  onConfirm: () => void; isFiring: boolean;
}) => {
  const eligible = guests.filter(g =>
    g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId))
  );
  const notIn = guests.filter(g =>
    !g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId))
  );
  const itemCounts: Record<string, { name: string; count: number; criticalCount: number }> = {};
  eligible.forEach(g => {
    const id   = g.courseSelections?.[courseNumber] || g.mealChoiceId;
    const item = menuItems.find((m: any) => m.id === id);
    if (!id) return;
    if (!itemCounts[id]) itemCounts[id] = { name: item?.name || 'Unknown', count: 0, criticalCount: 0 };
    itemCounts[id].count++;
    if ((g.allergies || []).some((a: any) => a.severity === 'critical')) itemCounts[id].criticalCount++;
  });
  const criticalGuests = eligible.filter(g => (g.allergies || []).some((a: any) => a.severity === 'critical'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-[2rem] border-4 shadow-2xl">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
            <Play className="w-5 h-5 text-primary" /> Fire {courseName}
          </DialogTitle>
        </DialogHeader>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-xl bg-primary/5 border border-primary/20">
              <p className="text-xl font-black text-primary">{eligible.length}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-primary/60">Tickets</p>
            </div>
            <div className={cn('text-center p-3 rounded-xl border', notIn.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200')}>
              <p className={cn('text-xl font-black', notIn.length > 0 ? 'text-amber-700' : 'text-slate-400')}>{notIn.length}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Not in</p>
            </div>
            <div className={cn('text-center p-3 rounded-xl border', criticalGuests.length > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}>
              <p className={cn('text-xl font-black', criticalGuests.length > 0 ? 'text-red-600' : 'text-slate-400')}>{criticalGuests.length}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Critical</p>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(itemCounts).map(([id, data]) => (
              <div key={id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="font-black text-sm text-slate-900">{data.name}</p>
                <div className="flex items-center gap-2">
                  {data.criticalCount > 0 && (
                    <span className="flex items-center gap-1 text-[8px] font-black uppercase text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <AlertTriangle className="w-2.5 h-2.5" /> {data.criticalCount}
                    </span>
                  )}
                  <span className="font-black text-lg text-primary font-mono">×{data.count}</span>
                </div>
              </div>
            ))}
          </div>
          {criticalGuests.length > 0 && (
            <div className="p-3 rounded-xl bg-red-50 border-2 border-red-200 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-red-600">Critical Allergy Guests</p>
              {criticalGuests.map(g => (
                <div key={g.id} className="flex items-center justify-between gap-2">
                  <p className="font-black text-xs text-red-900">{g.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {(g.allergies || []).filter((a: any) => a.severity === 'critical').map((a: any, i: number) => (
                      <span key={i} className="text-[8px] font-black uppercase text-red-700 bg-red-100 border border-red-300 px-1.5 py-0.5 rounded-full">{a.label}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
            <Button onClick={onConfirm} disabled={isFiring || eligible.length === 0} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20 gap-2">
              {isFiring ? <Loader className="w-4 h-4 animate-spin" /> : <><Play className="w-4 h-4" /> Fire {eligible.length} Tickets</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── FLOOR REQUEST PANEL ───────────────────────────────────────────────────────
const FLOOR_REQUEST_ICONS: Record<string, string> = {
  water: '💧', napkins: '🧻', condiments: '🧂', utensils: '🍴',
  ice: '🧊', accessibility: '♿', temperature: '🌡️', cleaning: '🧹', other: '💬',
};

const FloorRequestPanel = ({ requests, onResolve, tenantId }: {
  requests: any[]; onResolve: (id: string) => void; tenantId: string;
}) => {
  const [resolving, setResolving] = useState<string | null>(null);
  if (requests.length === 0) return null;
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-amber-50 border-2 border-amber-300 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-600 animate-pulse" />
            <p className="font-black text-sm text-amber-800 uppercase tracking-tight">
              Floor Requests — {requests.length} Pending
            </p>
          </div>
        </div>
        <div className="divide-y divide-amber-200 max-h-64 overflow-y-auto">
          {requests.map(r => {
            const elapsedMins = Math.floor((Date.now() - safeDate(r.createdAt).getTime()) / 60000);
            const isLate = elapsedMins >= 5;
            return (
              <div key={r.id} className="flex items-center gap-3 p-3">
                <span className="text-xl shrink-0">{FLOOR_REQUEST_ICONS[r.requestType] || '💬'}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm text-amber-900">{r.label || r.requestType}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.tableNumber && <span className="text-[9px] font-bold text-amber-600 uppercase">Table {r.tableNumber}</span>}
                    {r.guestName   && <span className="text-[9px] font-bold text-amber-600 uppercase">{r.guestName}</span>}
                    <span className={cn('text-[9px] font-black uppercase tracking-widest', isLate ? 'text-red-500' : 'text-amber-500')}>
                      {isLate ? `⚠ ${elapsedMins}m ago` : elapsedMins < 1 ? 'Just now' : `${elapsedMins}m ago`}
                    </span>
                  </div>
                </div>
                <button onClick={async () => { setResolving(r.id); await onResolve(r.id); setResolving(null); }}
                  disabled={resolving === r.id}
                  className="shrink-0 w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-all active:scale-95">
                  {resolving === r.id ? <Loader className="w-4 h-4 animate-spin text-white" /> : <Check className="w-4 h-4 text-white" />}
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// ─── DELTA REFIRE BANNER ───────────────────────────────────────────────────────
const DeltaRefireBanner = ({ courseNumber, courseName, deltaGuests, onRefire, isFiring }: {
  courseNumber: number; courseName: string; deltaGuests: any[];
  onRefire: (n: number, guests: any[]) => Promise<void>; isFiring: boolean;
}) => (
  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
    className="bg-indigo-50 border-2 border-indigo-300 rounded-2xl p-4 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
        <RefreshCw className="w-4 h-4 text-indigo-600" />
      </div>
      <div className="min-w-0">
        <p className="font-black text-sm text-indigo-900 leading-tight">
          {deltaGuests.length} new guest{deltaGuests.length !== 1 ? 's' : ''} missed {courseName}
        </p>
        <p className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5 truncate">
          {deltaGuests.map(g => g.name).join(', ')}
        </p>
      </div>
    </div>
    <Button onClick={() => onRefire(courseNumber, deltaGuests)} disabled={isFiring} size="sm"
      className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest bg-indigo-600 hover:bg-indigo-700 shrink-0 gap-2">
      {isFiring ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><RefreshCw className="w-3.5 h-3.5" /> Re-fire</>}
    </Button>
  </motion.div>
);

// ─── ALL COURSES FIRED NUDGE ───────────────────────────────────────────────────
const AllCoursesFiredNudge = ({ onEndEvent }: { onEndEvent: () => void }) => (
  <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
    className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
      </div>
      <div>
        <p className="font-black text-sm text-emerald-900">All courses fired!</p>
        <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">Kitchen has every ticket. Ready to wrap up?</p>
      </div>
    </div>
    <Button onClick={onEndEvent} size="sm"
      className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shrink-0">
      End Event →
    </Button>
  </motion.div>
);

// ─── KITCHEN PRINT MODAL ───────────────────────────────────────────────────────
const KitchenPrintModal = ({ open, onOpenChange, event, guests, menuItems, courseNumbers }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  event: any; guests: any[]; menuItems: any[]; courseNumbers: number[];
}) => {
  const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = guests.filter(g => g.checkedIn).sort((a, b) => {
      if (a.tableNumber && b.tableNumber) return a.tableNumber.localeCompare(b.tableNumber);
      return a.name.localeCompare(b.name);
    });
    win.document.write(`<!DOCTYPE html><html><head><title>Kitchen Run Sheet</title>
      <style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 24px; } h1 { font-size: 22px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.5px; } h2 { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; margin: 20px 0 8px; border-bottom: 2px solid #0f172a; padding-bottom: 4px; } .meta { color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-top: 4px; } table { width: 100%; border-collapse: collapse; margin-top: 6px; } th { background: #0f172a; color: white; font-weight: 900; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; padding: 6px 8px; text-align: left; } td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; } tr:nth-child(even) td { background: #f8fafc; } @media print { @page { margin: 0.4in; } }</style>
    </head><body>
      <h1>${event?.title || 'Event'} — Kitchen Run Sheet</h1>
      <p class="meta">${guests.filter(g => g.checkedIn).length} of ${guests.length} guests checked in · Printed ${format(new Date(), 'MMM d, h:mm a')}</p>
      <h2>Full Guest List (Checked In)</h2>
      <table><thead><tr><th>Guest</th><th>Table / Seat</th>${courseNumbers.map(n => `<th>${courseLabels[n] || 'Course ' + n}</th>`).join('')}<th>Allergies</th></tr></thead>
      <tbody>${rows.map(g => `<tr><td><strong>${g.name}</strong></td><td>${g.tableNumber ? 'T' + g.tableNumber : '—'}${g.seatNumber ? ' · ' + g.seatNumber : ''}</td>${courseNumbers.map(n => {
        const id = g.courseSelections?.[n] || (n === 1 ? g.mealChoiceId : null);
        const name = id ? menuItems.find((m: any) => m.id === id)?.name || '—' : '—';
        return `<td>${name}</td>`;
      }).join('')}<td>${(g.allergies || []).map((a: any) => typeof a === 'object' ? a.label : a).join(', ')}</td></tr>`).join('')}
      </tbody></table>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm rounded-[2rem] border-4 shadow-2xl">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" /> Print Options
          </DialogTitle>
        </DialogHeader>
        <div className="p-6 space-y-3">
          <button onClick={handlePrint}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-200 bg-white hover:border-primary/30 hover:bg-primary/5 transition-all text-left group">
            <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-slate-500 group-hover:text-primary" />
            </div>
            <div>
              <p className="font-black text-sm text-slate-900 uppercase tracking-tight">Kitchen Run Sheet</p>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">Full guest list with courses and allergies</p>
            </div>
          </button>
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 mt-2">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function EventManifestPage() {
  const params   = useParams();
  const router   = useRouter();
  const { firestore } = useFirebase();
  const { toast }     = useToast();
  const { selectedTenant } = useTenant();
  const { inventory, clients, staff: staffFromContext } = useInventory();
  const tenantId = selectedTenant?.id ?? '';
  const eventId  = params.eventId as string;

  // ── Core data ──────────────────────────────────────────────────────────────
  const [event,         setEvent]         = useState<any>(null);
  const [guests,        setGuests]        = useState<any[]>([]);
  const [menuItems,     setMenuItems]     = useState<any[]>([]);
  const [fires,         setFires]         = useState<any[]>([]);
  const [floorRequests, setFloorRequests] = useState<any[]>([]);
  // FIX: tables stored as id→object map for O(1) lookup
  const [tables,        setTables]        = useState<Record<string, any>>({});
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId || !eventId) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), snap => {
      if (snap.exists()) setEvent({ ...snap.data(), id: snap.id });
      setLoading(false);
    }));
    unsubs.push(onSnapshot(query(collection(firestore, `tenants/${tenantId}/eventGuests`), where('eventId', '==', eventId)),
      snap => setGuests(snap.docs.map(d => ({ ...d.data(), id: d.id })))));
    unsubs.push(onSnapshot(query(collection(firestore, `tenants/${tenantId}/eventMenuItems`), where('eventId', '==', eventId)),
      snap => setMenuItems(snap.docs.map(d => ({ ...d.data(), id: d.id })))));
    unsubs.push(onSnapshot(query(collection(firestore, `tenants/${tenantId}/courseFires`), where('eventId', '==', eventId)),
      snap => setFires(snap.docs.map(d => ({ ...d.data(), id: d.id })))));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/floorRequests`), where('eventId', '==', eventId), where('status', 'in', ['new', 'acknowledged'])),
      snap => setFloorRequests(snap.docs.map(d => ({ ...d.data(), id: d.id })))));
    // FIX: Live listener on tables — builds id→object map
    unsubs.push(onSnapshot(collection(firestore, `tenants/${tenantId}/tables`), snap => {
      const map: Record<string, any> = {};
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
      setTables(map);
    }));

    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, eventId]);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState('');
  const [filterMeal,     setFilterMeal]     = useState('all');
  const [filterFlag,     setFilterFlag]     = useState('all');
  const [guestViewMode,  setGuestViewMode]  = useState<'list' | 'table' | 'floor'>('list');
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(new Set());

  const [isFiring,          setIsFiring]          = useState<number | null>(null);
  const [isRefiring,        setIsRefiring]         = useState<number | null>(null);
  const [fireConfirmCourse, setFireConfirmCourse]  = useState<number | null>(null);
  const [isConfirmActivateOpen, setIsConfirmActivateOpen] = useState(false);
  const [activatingNow,     setActivatingNow]      = useState(false);
  const [undoWindowOpen,    setUndoWindowOpen]     = useState(false);
  const [undoCountdown,     setUndoCountdown]      = useState(120);
  const [showLink,          setShowLink]           = useState(false);
  const [activeTab,         setActiveTab]          = useState('guests');
  const [staffToAdd,        setStaffToAdd]         = useState('');
  const [mealOverrideGuest, setMealOverrideGuest]  = useState<any>(null);
  const [mealOverrideId,    setMealOverrideId]     = useState<string>('');
  const [savingOverride,    setSavingOverride]     = useState(false);
  const [isEndEventOpen,    setIsEndEventOpen]     = useState(false);
  const [broadcastOpen,     setBroadcastOpen]      = useState(false);
  const [broadcastText,     setBroadcastText]      = useState('');
  const [sendingBroadcast,  setSendingBroadcast]   = useState(false);
  const [printModalOpen,    setPrintModalOpen]     = useState(false);

  // Guest form
  const [isAddingGuest, setIsAddingGuest] = useState(false);
  const [editingGuest,  setEditingGuest]  = useState<any>(null);
  // FIX: guest form uses tableId (the Firestore doc ID) not tableNumber
  const [guestForm, setGuestForm] = useState({
    name: '', email: '', phone: '',
    tableId: '',      // stores the Firestore table doc ID
    seatNumber: '',
    mealChoiceId: '', notes: '',
  });
  const [clientSearch,  setClientSearch]  = useState('');
  const [savingGuest,   setSavingGuest]   = useState(false);

  // Menu form
  const [isAddingMenu,       setIsAddingMenu]       = useState(false);
  const [newMenuName,        setNewMenuName]         = useState('');
  const [newMenuDesc,        setNewMenuDesc]         = useState('');
  const [newMenuCourse,      setNewMenuCourse]       = useState(1);
  const [newMenuVegan,       setNewMenuVegan]        = useState(false);
  const [newMenuGF,          setNewMenuGF]           = useState(false);
  const [newMenuPrice,       setNewMenuPrice]        = useState(0);
  const [menuSupplies,       setMenuSupplies]        = useState<{ inventoryId: string; qty: number }[]>([]);

  const [firedGuestIdsByCourse, setFiredGuestIdsByCourse] = useState<Record<number, Set<string>>>({});
  const firingInProgress = useRef<Set<number>>(new Set());
  const [firingBlockedSet, setFiringBlockedSet] = useState<Set<number>>(new Set());
  const [staffZones, setStaffZones] = useState<Record<string, string>>({});

  // ── Derived ────────────────────────────────────────────────────────────────
  const eventStaff = useMemo(() =>
    (staffFromContext || []).filter((s: any) => (event?.assignedStaffIds || []).includes(s.id)),
    [staffFromContext, event]
  );

  useEffect(() => {
    if (!firestore || !tenantId || fires.length === 0) return;
    let cancelled = false;
    const nums = fires.filter(f => f.status === 'fired').map(f => f.courseNumber);
    if (nums.length === 0) return;
    Promise.all(nums.map(async (n: number) => {
      const snap = await getDocs(query(collection(firestore, `tenants/${tenantId}/kdsTickets`), where('eventId', '==', eventId), where('courseNumber', '==', n)));
      return { courseNumber: n, guestIds: new Set(snap.docs.map(d => d.data().guestId as string).filter(Boolean)) };
    })).then(results => {
      if (cancelled) return;
      const map: Record<number, Set<string>> = {};
      results.forEach(({ courseNumber, guestIds }) => { map[courseNumber] = guestIds; });
      setFiredGuestIdsByCourse(map);
    });
    return () => { cancelled = true; };
  }, [fires, firestore, tenantId, eventId]);

  const courseNumbers   = useMemo(() => Array.from(new Set(menuItems.map(m => m.courseNumber))).sort() as number[], [menuItems]);
  const firedCourses    = useMemo(() => new Set(fires.filter(f => f.status === 'fired').map(f => f.courseNumber)), [fires]);
  const unfiredCourses  = useMemo(() => courseNumbers.filter(n => !firedCourses.has(n)), [courseNumbers, firedCourses]);
  const allCoursesFired = courseNumbers.length > 0 && unfiredCourses.length === 0 && event?.status === 'active';

  const deltaGuestsByCourse = useMemo(() => {
    const result: Record<number, any[]> = {};
    fires.filter(f => f.status === 'fired').forEach((f: any) => {
      const n = f.courseNumber;
      const firedIds = firedGuestIdsByCourse[n];
      if (!firedIds) return;
      const eligible = guests.filter(g => g.checkedIn && (g.courseSelections?.[n] || (n === 1 && g.mealChoiceId)) && !firedIds.has(g.id));
      if (eligible.length > 0) result[n] = eligible;
    });
    return result;
  }, [guests, fires, firedGuestIdsByCourse]);

  const stats = useMemo(() => {
    const allergyObjects = guests.flatMap(g => g.allergies || []);
    const allergyLabels  = allergyObjects.map((a: any) => typeof a === 'object' ? a.label : a);
    const mealCounts: Record<string, number> = {};
    guests.forEach(g => {
      const name = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName || 'No selection';
      mealCounts[name] = (mealCounts[name] || 0) + 1;
    });
    return {
      total: guests.length, checkedIn: guests.filter(g => g.checkedIn).length,
      notCheckedIn: guests.filter(g => !g.checkedIn).length,
      allergyCount: allergyLabels.length, uniqueAllergies: Array.from(new Set(allergyLabels)) as string[], mealCounts,
    };
  }, [guests, menuItems]);

  const filtered = useMemo(() => guests.filter(g => {
    if (search && !g.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterMeal !== 'all' && g.mealChoiceId !== filterMeal) return false;
    if (filterFlag === 'allergies' && (!g.allergies || !g.allergies.length)) return false;
    if (filterFlag === 'not-checked-in' && g.checkedIn) return false;
    if (filterFlag === 'checked-in' && !g.checkedIn) return false;
    return true;
  }).sort((a, b) => {
    const aTable = a.tableNumber || '';
    const bTable = b.tableNumber || '';
    return aTable.localeCompare(bTable) || a.name?.localeCompare(b.name || '');
  }), [guests, search, filterMeal, filterFlag]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return (clients || []).slice(0, 10);
    const s = clientSearch.toLowerCase();
    return (clients || []).filter((c: any) => c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s)).slice(0, 10);
  }, [clients, clientSearch]);

  // ── FIX 6: Resolve table name for display ─────────────────────────────────
  const resolveTableName = useCallback((guest: any): string => {
    if (guest.tableId && tables[guest.tableId]) return tables[guest.tableId].name;
    if (guest.tableNumber) {
      if (tables[guest.tableNumber]) return tables[guest.tableNumber].name;
      return guest.tableNumber;
    }
    return '—';
  }, [tables]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCheckInGuest = async (guestId: string, current: boolean) => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId), {
      checkedIn: !current, checkedInAt: !current ? new Date().toISOString() : null,
    });
    toast({ title: !current ? 'Checked In ✓' : 'Check-in Removed' });
  };

  const handleDeleteGuest = async (guestId: string) => {
    if (!firestore || !tenantId) return;
    await deleteDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId));
    toast({ title: 'Guest Removed' });
  };

  const handleSaveGuest = async () => {
    if (!guestForm.name.trim() || !firestore || !tenantId) return;
    setSavingGuest(true);
    const mealItem = menuItems.find(m => m.id === guestForm.mealChoiceId);
    // Resolve the human-readable table name to store alongside the ID
    const tableName = guestForm.tableId && tables[guestForm.tableId]
      ? tables[guestForm.tableId].name
      : '';
    try {
      const guestData = {
        name: guestForm.name.trim(),
        email: guestForm.email,
        phone: guestForm.phone,
        tableId: guestForm.tableId || null,
        tableNumber: tableName || null,   // store resolved name for backwards compat display
        seatNumber: guestForm.seatNumber || null,
        mealChoiceId: guestForm.mealChoiceId || null,
        mealChoiceName: mealItem?.name || null,
        notes: guestForm.notes,
        updatedAt: new Date().toISOString(),
      };
      if (editingGuest) {
        await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, editingGuest.id), guestData);
        toast({ title: 'Guest Updated' });
      } else {
        await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
          id: nanoid(), eventId, tenantId, ...guestData,
          allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'manual', submittedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Added' });
      }
    } catch (e) {
      console.error('Save guest failed:', e);
      toast({ variant: 'destructive', title: 'Failed to save guest' });
    } finally {
      setSavingGuest(false); setIsAddingGuest(false); setEditingGuest(null);
      setGuestForm({ name: '', email: '', phone: '', tableId: '', seatNumber: '', mealChoiceId: '', notes: '' });
    }
  };

  const handleImportClient = async (client: any) => {
    if (!firestore || !tenantId) return;
    if (guests.find(g => g.clientId === client.id)) { toast({ variant: 'destructive', title: 'Already on guest list' }); return; }
    await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
      id: nanoid(), eventId, tenantId, name: client.name, email: client.email || '', phone: client.phone || '',
      tableId: null, tableNumber: null, seatNumber: null, mealChoiceId: null, mealChoiceName: null,
      allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'client_import', clientId: client.id, submittedAt: new Date().toISOString(),
    });
    toast({ title: `${client.name} added` });
  };

  const handleMealOverride = async () => {
    if (!mealOverrideGuest || !firestore || !tenantId) return;
    setSavingOverride(true);
    try {
      const resolvedId = mealOverrideId === NO_SELECTION ? null : mealOverrideId || null;
      const mealItem   = menuItems.find(m => m.id === resolvedId);
      await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, mealOverrideGuest.id), {
        mealChoiceId: resolvedId, mealChoiceName: mealItem?.name || null,
        mealOverriddenAt: new Date().toISOString(), mealOverriddenBy: 'staff',
      });
      toast({ title: `Meal updated for ${mealOverrideGuest.name}` });
      setMealOverrideGuest(null); setMealOverrideId('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Override failed' });
    } finally { setSavingOverride(false); }
  };

  const handleFireCourse = async (courseNumber: number) => {
    if (!firestore || !tenantId) return;
    if (firingInProgress.current.has(courseNumber) || firingBlockedSet.has(courseNumber)) return;
    if (firedCourses.has(courseNumber)) { toast({ variant: 'destructive', title: `Course ${courseNumber} already fired` }); return; }
    firingInProgress.current.add(courseNumber);
    setFiringBlockedSet(prev => new Set(prev).add(courseNumber));
    setIsFiring(courseNumber);
    try {
      const batch  = writeBatch(firestore);
      const fireId = nanoid();
      const now    = new Date().toISOString();
      const labels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
      const forCourse = guests.filter(g => g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId)));
      if (forCourse.length === 0) { toast({ variant: 'destructive', title: 'No checked-in guests' }); return; }
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), { id: fireId, eventId, tenantId, courseNumber, courseName: labels[courseNumber] || `Course ${courseNumber}`, firedAt: now, firedBy: 'host', guestCount: forCourse.length, status: 'fired', isDelta: false });
      forCourse.forEach(g => {
        const menuItemId = g.courseSelections?.[courseNumber] || g.mealChoiceId;
        const menuItem   = menuItems.find(m => m.id === menuItemId);
        const kdsId      = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), { id: kdsId, source: 'event', eventId, courseFireId: fireId, courseNumber, guestId: g.id, guestName: g.name, seatNumber: g.seatNumber || null, tableNumber: g.tableNumber || null, menuItemId, menuItemName: menuItem?.name || 'Item', allergies: g.allergies || [], status: 'pending', createdAt: now, tenantId, isDelta: false });
      });
      await batch.commit();
      toast({ title: `Course ${courseNumber} Fired`, description: `${forCourse.length} tickets sent to kitchen` });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Fire Failed' });
    } finally {
      setIsFiring(null);
      firingInProgress.current.delete(courseNumber);
      setFiringBlockedSet(prev => { const next = new Set(prev); next.delete(courseNumber); return next; });
    }
  };

  const handleRefireDelta = async (courseNumber: number, deltaGuests: any[]) => {
    if (!firestore || !tenantId || deltaGuests.length === 0) return;
    firingInProgress.current.add(courseNumber);
    setIsRefiring(courseNumber);
    try {
      const batch  = writeBatch(firestore);
      const fireId = nanoid();
      const now    = new Date().toISOString();
      const labels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), { id: fireId, eventId, tenantId, courseNumber, courseName: labels[courseNumber] || `Course ${courseNumber}`, firedAt: now, firedBy: 'host_delta', guestCount: deltaGuests.length, status: 'fired', isDelta: true });
      deltaGuests.forEach(g => {
        const menuItemId = g.courseSelections?.[courseNumber] || g.mealChoiceId;
        const menuItem = menuItems.find(m => m.id === menuItemId);
        const kdsId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), { id: kdsId, source: 'event', eventId, courseFireId: fireId, courseNumber, guestId: g.id, guestName: g.name, seatNumber: g.seatNumber || null, tableNumber: g.tableNumber || null, menuItemId, menuItemName: menuItem?.name || 'Item', allergies: g.allergies || [], status: 'pending', createdAt: now, tenantId, isDelta: true });
      });
      await batch.commit();
      toast({ title: `Re-fired ${deltaGuests.length} late arrivals` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Re-fire failed' });
    } finally {
      setIsRefiring(null);
      firingInProgress.current.delete(courseNumber);
      setFiringBlockedSet(prev => { const next = new Set(prev); next.delete(courseNumber); return next; });
    }
  };

  // FIX 3: Assign guest to table (used by FloorPlanView tap-to-assign)
  const handleAssignGuest = async (guestId: string, tableId: string) => {
    if (!firestore || !tenantId || !eventId) return;
    try {
      const tableName = tables[tableId]?.name ?? '';
      await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId), {
        tableId, tableNumber: tableName, updatedAt: new Date().toISOString(),
      });
      toast({ title: `Moved to ${tableName || 'table'}` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not reassign guest' });
    }
  };

  const handleActivateEvent = async () => {
    if (!firestore || !tenantId) return;
    setActivatingNow(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'active', activatedAt: new Date().toISOString() });
      setIsConfirmActivateOpen(false); setUndoWindowOpen(true); setUndoCountdown(120);
      const interval = setInterval(() => {
        setUndoCountdown(prev => { if (prev <= 1) { clearInterval(interval); setUndoWindowOpen(false); return 0; } return prev - 1; });
      }, 1000);
      toast({ title: '🟢 Event is now live' });
    } catch { toast({ variant: 'destructive', title: 'Activation failed' }); }
    finally { setActivatingNow(false); }
  };

  const handleDeactivateEvent = async () => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'upcoming' });
    setUndoWindowOpen(false);
  };

  const handleConfirmEndEvent = async () => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'completed', endedAt: new Date().toISOString() });
    setIsEndEventOpen(false);
    toast({ title: 'Event complete' });
  };

  const handleSendBroadcast = async () => {
    if (!broadcastText.trim() || !firestore) return;
    setSendingBroadcast(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { broadcastMessage: broadcastText.trim(), broadcastSentAt: new Date().toISOString(), broadcastDismissed: false });
      toast({ title: 'Broadcast sent' });
      setBroadcastText(''); setBroadcastOpen(false);
    } catch { toast({ variant: 'destructive', title: 'Send failed' }); }
    finally { setSendingBroadcast(false); }
  };

  const handleClearBroadcast = async () => {
    if (!firestore) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { broadcastMessage: null, broadcastDismissed: true });
  };

  const handleExportCSV = () => {
    const rows = [
      ['Name','Email','Phone','Table','Seat','Meal Choice','Allergies','Checked In'],
      ...guests.map(g => [
        g.name, g.email||'', g.phone||'',
        resolveTableName(g),
        g.seatNumber||'',
        g.mealChoiceName||'',
        (g.allergies||[]).map((a: any) => typeof a==='object'?a.label:a).join(';'),
        g.checkedIn?'Yes':'No',
      ])
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${event?.title||'event'}-manifest.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const handleAddMenuItem = async () => {
    if (!newMenuName.trim() || !firestore || !tenantId) return;
    const id = nanoid();
    const menuItem = { id, eventId, tenantId, name: newMenuName.trim(), description: newMenuDesc.trim() || null, courseNumber: newMenuCourse, isVegan: newMenuVegan, isGlutenFree: newMenuGF, pricePerGuest: newMenuPrice || 0, supplies: menuSupplies.filter(s => s.inventoryId && s.qty > 0) };
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, `tenants/${tenantId}/eventMenuItems`, id), menuItem);
    await batch.commit();
    setNewMenuName(''); setNewMenuDesc(''); setNewMenuCourse(1); setNewMenuVegan(false); setNewMenuGF(false); setIsAddingMenu(false);
    toast({ title: 'Menu item added' });
  };

  const handleDeleteMenuItem = async (item: any) => {
    if (!firestore || !tenantId) return;
    await deleteDoc(doc(firestore, `tenants/${tenantId}/eventMenuItems`, item.id));
    toast({ title: `${item.name} removed` });
  };

  const handleBulkCheckIn = async () => {
    if (!firestore || !tenantId || selectedGuests.size === 0) return;
    const batch = writeBatch(firestore);
    const now = new Date().toISOString();
    selectedGuests.forEach(id => {
      batch.update(doc(firestore, `tenants/${tenantId}/eventGuests`, id), { checkedIn: true, checkedInAt: now });
    });
    await batch.commit();
    setSelectedGuests(new Set());
    toast({ title: `${selectedGuests.size} guests checked in` });
  };

  const toggleSelectGuest = (id: string) => {
    setSelectedGuests(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const selectAll   = () => setSelectedGuests(new Set(filtered.map(g => g.id)));
  const deselectAll = () => setSelectedGuests(new Set());

  const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
  const shareableLink = typeof window !== 'undefined' ? `${window.location.origin}/event/${tenantId}/${eventId}` : '';
  const eventDisplayName = event?.title || event?.name || 'Untitled Event';
  const currentBroadcast = event?.broadcastMessage && !event?.broadcastDismissed ? event.broadcastMessage : null;
  const hasOrderingDeadline = event?.orderingDeadline && new Date(event.orderingDeadline) > new Date();

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex h-screen items-center justify-center"><Loader className="animate-spin w-8 h-8 text-slate-400" /></div>;
  if (!event)  return <div className="flex h-screen items-center justify-center text-slate-400 font-bold">Event not found</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <AppHeader title={`${eventDisplayName} — Manifest`} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 pb-24">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4 md:gap-6">
            <CapacityRing checkedIn={stats.checkedIn} total={stats.total} capacity={event.capacity || null} />
            <div>
              <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">{eventDisplayName}</h1>
              {event.date  && <p className="text-sm text-slate-500 mt-1">{format(new Date(event.date), 'EEEE, MMMM d, yyyy')}</p>}
              {event.venue && <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{event.venue}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {event?.status === 'active' ? (
              <>
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-black uppercase text-[9px] tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
                </span>
                <Button onClick={() => setBroadcastOpen(true)} variant="outline"
                  className="h-9 px-3 rounded-xl border-2 border-violet-200 text-violet-700 font-black uppercase text-[9px] tracking-widest gap-1.5">
                  <Megaphone className="w-3.5 h-3.5" /> Broadcast
                </Button>
                <Button onClick={() => setIsEndEventOpen(true)} variant="outline"
                  className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">End Event</Button>
              </>
            ) : event?.status === 'completed' ? (
              <span className="px-3 py-1.5 rounded-xl bg-slate-100 border-2 border-slate-200 text-slate-500 font-black uppercase text-[9px] tracking-widest">Completed</span>
            ) : (
              <Button onClick={() => setIsConfirmActivateOpen(true)}
                className="h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200">
                <span className="w-2 h-2 rounded-full bg-white" /> Go Live
              </Button>
            )}
            <Button variant="outline" onClick={() => setPrintModalOpen(true)} className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
            <Button variant="outline" onClick={() => setShowLink(!showLink)} className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> Link
            </Button>
            <Button variant="outline" onClick={handleExportCSV} className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1.5">
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          </div>
        </div>

        {/* ── BANNERS ─────────────────────────────────────────────────────── */}
        {event?.menuNote && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 border-2 border-blue-200">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-blue-900">{event.menuNote}</p>
          </div>
        )}
        {hasOrderingDeadline && <OrderingDeadlineBanner deadline={event.orderingDeadline} />}
        {currentBroadcast && (
          <div className="flex items-center justify-between p-3 rounded-2xl bg-violet-50 border-2 border-violet-200">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-violet-600 shrink-0" />
              <p className="text-sm font-bold text-violet-800 truncate">{currentBroadcast}</p>
            </div>
            <button onClick={handleClearBroadcast} className="p-1 rounded-lg hover:bg-violet-100 text-violet-500 shrink-0 ml-2">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <AnimatePresence>
          {undoWindowOpen && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <div><p className="font-black text-sm text-emerald-800">Event is now live</p><p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Undo available for {undoCountdown}s</p></div>
              </div>
              <Button onClick={handleDeactivateEvent} variant="outline" className="h-9 px-4 rounded-xl border-2 border-emerald-300 font-black uppercase text-[9px] text-emerald-700 shrink-0">Undo</Button>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {Object.entries(deltaGuestsByCourse).map(([n, dg]) => (
            <DeltaRefireBanner key={n} courseNumber={Number(n)} courseName={courseLabels[Number(n)] || `Course ${n}`}
              deltaGuests={dg} onRefire={handleRefireDelta} isFiring={isRefiring === Number(n)} />
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {allCoursesFired && <AllCoursesFiredNudge onEndEvent={() => setIsEndEventOpen(true)} />}
        </AnimatePresence>

        {/* ── STATS ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Responses" value={stats.total} sub={`${stats.checkedIn} checked in`} />
          <StatCard label="Allergy Flags" value={stats.allergyCount} sub={stats.uniqueAllergies.slice(0, 2).join(', ') || 'None'} color="amber" />
          {Object.entries(stats.mealCounts).slice(0, 2).map(([meal, count]) => (
            <StatCard key={meal} label={meal} value={count as number} sub={`${Math.round((count as number) / Math.max(stats.total, 1) * 100)}%`} color="emerald" />
          ))}
        </div>

        {/* ── COURSE FIRING ───────────────────────────────────────────────── */}
        {courseNumbers.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-primary" /> Course Firing
              </h2>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {courseNumbers.map(n => {
                const fired     = firedCourses.has(n);
                const isBlocked = firingBlockedSet.has(n);
                const count     = guests.filter(g => g.courseSelections?.[n] || (n === 1 && g.mealChoiceId)).length;
                const inCount   = guests.filter(g => g.checkedIn && (g.courseSelections?.[n] || (n === 1 && g.mealChoiceId))).length;
                return (
                  <div key={n} className={cn('p-4 rounded-2xl border-2', fired ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course {n}</p>
                        <p className="font-black text-slate-900 text-sm">{courseLabels[n] || `Course ${n}`}</p>
                        <p className="text-[10px] text-slate-500">{inCount} in · {count} total</p>
                      </div>
                      {fired && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                    </div>
                    <Button onClick={() => setFireConfirmCourse(n)}
                      disabled={isBlocked || !!isFiring || fired || count === 0}
                      className={cn('w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 mt-1', fired ? 'bg-emerald-500 opacity-60 cursor-not-allowed' : 'shadow-lg shadow-primary/20')}>
                      {isFiring === n || isBlocked ? <Loader className="w-4 h-4 animate-spin" /> : fired ? <><CheckCircle2 className="w-4 h-4" /> Fired</> : <><Play className="w-4 h-4" /> Fire Course</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MAIN TABS ───────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="h-11 rounded-2xl border-2 bg-slate-100 p-1 gap-1 w-max md:w-full">
              {[
                { value: 'guests',   label: `Guests (${guests.length})` },
                { value: 'menu',     label: `Menu (${menuItems.length})` },
                { value: 'staff',    label: 'Staff' },
                { value: 'requests', label: floorRequests.length > 0 ? `Requests (${floorRequests.length})` : 'Requests' },
              ].map(t => (
                <TabsTrigger key={t.value} value={t.value} className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 whitespace-nowrap">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ── GUESTS TAB ─────────────────────────────────────────────── */}
          <TabsContent value="guests" className="mt-4 space-y-4">
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => { setIsAddingGuest(true); setEditingGuest(null); setGuestForm({ name: '', email: '', phone: '', tableId: '', seatNumber: '', mealChoiceId: '', notes: '' }); }}
                className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                <UserPlus className="w-4 h-4" /> Add Guest
              </Button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="pl-8 h-10 w-40 rounded-xl border-2 text-xs font-bold" />
              </div>
              <Select value={filterMeal} onValueChange={setFilterMeal}>
                <SelectTrigger className="h-10 w-36 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="All meals" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Meals</SelectItem>{menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filterFlag} onValueChange={setFilterFlag}>
                <SelectTrigger className="h-10 w-40 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="All guests" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guests</SelectItem>
                  <SelectItem value="not-checked-in">Not Checked In</SelectItem>
                  <SelectItem value="checked-in">Checked In</SelectItem>
                  <SelectItem value="allergies">Has Allergy</SelectItem>
                </SelectContent>
              </Select>
              {/* View toggle — now includes floor plan */}
              <div className="flex items-center rounded-xl border-2 border-slate-200 overflow-hidden h-10 ml-auto">
                {[
                  { mode: 'list' as const, Icon: List, label: 'List' },
                  { mode: 'table' as const, Icon: LayoutGrid, label: 'By table' },
                  { mode: 'floor' as const, Icon: TableIcon, label: 'Floor' },
                ].map(({ mode, Icon, label }) => (
                  <button key={mode} onClick={() => setGuestViewMode(mode)} title={label}
                    className={cn('flex items-center justify-center w-10 h-full transition-colors border-l border-slate-200 first:border-l-0',
                      guestViewMode === mode ? 'bg-primary text-white' : 'hover:bg-slate-50 text-slate-400')}>
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            {/* Bulk check-in bar */}
            {selectedGuests.size > 0 && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between p-3 rounded-2xl bg-primary/5 border-2 border-primary/20">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-xl bg-primary text-white text-xs font-black flex items-center justify-center">{selectedGuests.size}</span>
                  <p className="font-black text-sm text-slate-900 uppercase tracking-tight">{selectedGuests.size} selected</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={handleBulkCheckIn} size="sm" className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" /> Check In All
                  </Button>
                  <button onClick={deselectAll} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
                </div>
              </motion.div>
            )}

            {/* Guest form */}
            <AnimatePresence>
              {(isAddingGuest || editingGuest) && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-white rounded-2xl border-2 border-primary/20 overflow-hidden">
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-black uppercase tracking-tight text-slate-900">{editingGuest ? 'Edit Guest' : 'Add Guest'}</h3>
                      {!editingGuest && (
                        <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                          placeholder="Import from client log…" className="h-9 w-52 rounded-xl border-2 text-xs font-bold" />
                      )}
                    </div>
                    {!editingGuest && clientSearch && filteredClients.length > 0 && (
                      <div className="rounded-xl border-2 divide-y overflow-hidden">
                        {filteredClients.map((c: any) => (
                          <button key={c.id} onClick={() => { handleImportClient(c); setClientSearch(''); }}
                            className="w-full flex items-center justify-between p-3 hover:bg-primary/5 text-left gap-3">
                            <div><p className="font-black text-sm text-slate-900">{c.name}</p><p className="text-[10px] text-slate-400">{c.email}</p></div>
                            <Badge className="bg-primary/10 text-primary border-primary/20 font-black text-[9px] shrink-0">Import</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Name *</Label><Input value={guestForm.name} onChange={e => setGuestForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Email</Label><Input value={guestForm.email} onChange={e => setGuestForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Phone</Label><Input value={guestForm.phone} onChange={e => setGuestForm(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 000-0000" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Meal Choice</Label>
                        <Select value={guestForm.mealChoiceId || NO_SELECTION} onValueChange={v => setGuestForm(p => ({ ...p, mealChoiceId: v === NO_SELECTION ? '' : v }))}>
                          <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="Select meal…" /></SelectTrigger>
                          <SelectContent><SelectItem value={NO_SELECTION}>No selection</SelectItem>{menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {/* FIX 1: Table select shows names, not IDs */}
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Table</Label>
                        <TableSelectField
                          tables={tables}
                          value={guestForm.tableId}
                          onChange={v => setGuestForm(p => ({ ...p, tableId: v, seatNumber: '' }))}
                        />
                      </div>
                      {/* FIX 2: Seat select derived from table capacity */}
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Seat</Label>
                        <SeatSelectField
                          tableId={guestForm.tableId}
                          tables={tables}
                          value={guestForm.seatNumber}
                          onChange={v => setGuestForm(p => ({ ...p, seatNumber: v }))}
                        />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button onClick={() => { setIsAddingGuest(false); setEditingGuest(null); }} variant="outline" className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                      <Button onClick={handleSaveGuest} disabled={savingGuest || !guestForm.name.trim()} className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                        {savingGuest ? <Loader className="w-4 h-4 animate-spin" /> : editingGuest ? 'Save Changes' : 'Add Guest →'}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Views */}
            {guestViewMode === 'floor' ? (
              <FloorPlanView tables={tables} guests={guests} orders={[]} onAssignGuest={handleAssignGuest} />
            ) : guestViewMode === 'table' ? (
              <TableGroupedView
                guests={filtered} menuItems={menuItems} tables={tables}
                onCheckIn={handleCheckInGuest}
                onEdit={g => { setEditingGuest(g); setIsAddingGuest(false); setGuestForm({ name: g.name, email: g.email || '', phone: g.phone || '', tableId: g.tableId || '', seatNumber: g.seatNumber || '', mealChoiceId: g.mealChoiceId || '', notes: g.notes || '' }); }}
                onDelete={handleDeleteGuest}
                onOverride={g => { setMealOverrideGuest(g); setMealOverrideId(g.mealChoiceId || NO_SELECTION); }}
              />
            ) : (
              /* Flat list view */
              <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[640px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="px-4 py-3 w-10">
                          <button onClick={selectedGuests.size === filtered.length && filtered.length > 0 ? deselectAll : selectAll}
                            className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                              selectedGuests.size === filtered.length && filtered.length > 0 ? 'bg-primary border-primary text-white' : 'border-slate-300 hover:border-primary')}>
                            {selectedGuests.size === filtered.length && filtered.length > 0 && <Check className="w-3 h-3" />}
                          </button>
                        </th>
                        {['Guest', 'Table & Seat', 'Meal', 'Flags', 'Status', ''].map(h => (
                          <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filtered.map(guest => (
                        <tr key={guest.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <button onClick={() => toggleSelectGuest(guest.id)}
                              className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                                selectedGuests.has(guest.id) ? 'bg-primary border-primary text-white' : 'border-slate-200 hover:border-primary')}>
                              {selectedGuests.has(guest.id) && <Check className="w-3 h-3" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-black text-sm text-slate-900">{guest.name}</p>
                            <p className="text-[10px] text-slate-400">{guest.email || ''}</p>
                          </td>
                          {/* FIX 6: Show resolved table name + seat number, not raw IDs */}
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              {resolveTableName(guest) !== '—' && (
                                <p className="text-[10px] font-black uppercase text-slate-700">{resolveTableName(guest)}</p>
                              )}
                              {guest.seatNumber && (
                                <p className="text-[10px] font-bold text-slate-400">Seat {guest.seatNumber}</p>
                              )}
                              {resolveTableName(guest) === '—' && !guest.seatNumber && (
                                <p className="text-[10px] text-slate-300 italic">Unassigned</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-bold text-slate-700">{guest.mealChoiceName || <span className="text-slate-300 italic text-xs">—</span>}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(guest.allergies || []).map((a: any, i: number) => <AllergyPill key={i} allergy={a} />)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleCheckInGuest(guest.id, guest.checkedIn)}
                              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest transition-all',
                                guest.checkedIn ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-primary/30 hover:text-primary')}>
                              {guest.checkedIn ? <><UserCheck className="w-3 h-3" /> In</> : <><UserPlus className="w-3 h-3" /> Check In</>}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setMealOverrideGuest(guest); setMealOverrideId(guest.mealChoiceId || NO_SELECTION); }} className="p-1.5 rounded-lg hover:bg-primary/10 text-slate-400 hover:text-primary"><Utensils className="w-3.5 h-3.5" /></button>
                              <button onClick={() => { setEditingGuest(guest); setIsAddingGuest(false); setGuestForm({ name: guest.name, email: guest.email || '', phone: guest.phone || '', tableId: guest.tableId || '', seatNumber: guest.seatNumber || '', mealChoiceId: guest.mealChoiceId || '', notes: guest.notes || '' }); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteGuest(guest.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400 font-bold uppercase tracking-widest">
                          {guests.length === 0 ? 'No guests yet — add manually or share the guest link' : 'No guests match your filters'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── MENU TAB ──────────────────────────────────────────────────── */}
          <TabsContent value="menu" className="mt-4 space-y-4">
            {menuItems.map(item => {
              const selectionCount = guests.filter(g => g.mealChoiceId === item.id || Object.values(g.courseSelections || {}).includes(item.id)).length;
              return (
                <div key={item.id} className="bg-white rounded-2xl border-2 border-slate-200 p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-slate-900">{item.name}</p>
                      <Badge className="bg-slate-100 text-slate-500 border-slate-200 font-black text-[8px]">Course {item.courseNumber}</Badge>
                      {item.isVegan && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[8px]">Vegan</Badge>}
                      {item.isGlutenFree && <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-black text-[8px]">GF</Badge>}
                    </div>
                    {item.description && <p className="text-[10px] text-slate-500 mt-0.5">{item.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={cn('font-black text-[9px]', selectionCount > 0 ? 'bg-primary/10 text-primary border-primary/20' : 'bg-slate-50 text-slate-400 border-slate-200')}>
                      {selectionCount} selected
                    </Badge>
                    <button onClick={() => handleDeleteMenuItem(item)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
            <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
              <button onClick={() => setIsAddingMenu(!isAddingMenu)} className="w-full p-5 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /><span className="font-black uppercase text-sm text-slate-900">Add Menu Item</span></div>
                {isAddingMenu ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              <AnimatePresence>
                {isAddingMenu && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-slate-100">
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5 sm:col-span-2"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Item Name *</Label><Input value={newMenuName} onChange={e => setNewMenuName(e.target.value)} placeholder="e.g. Pan-Seared Salmon" className="h-12 rounded-xl border-2" /></div>
                        <div className="space-y-1.5 sm:col-span-2"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Description</Label><Input value={newMenuDesc} onChange={e => setNewMenuDesc(e.target.value)} placeholder="Shown to guests" className="h-12 rounded-xl border-2" /></div>
                        <div className="space-y-1.5">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Course</Label>
                          <Select value={String(newMenuCourse)} onValueChange={v => setNewMenuCourse(Number(v))}>
                            <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="1">Starter</SelectItem><SelectItem value="2">Main</SelectItem><SelectItem value="3">Dessert</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Price/guest ($)</Label><Input type="number" min="0" step="0.01" value={newMenuPrice} onChange={e => setNewMenuPrice(parseFloat(e.target.value) || 0)} className="h-12 rounded-xl border-2 font-bold text-center" /></div>
                        <div className="flex items-center gap-4 sm:col-span-2">
                          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newMenuVegan} onChange={e => setNewMenuVegan(e.target.checked)} /><span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Vegan</span></label>
                          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newMenuGF} onChange={e => setNewMenuGF(e.target.checked)} /><span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Gluten-Free</span></label>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <Button onClick={() => { setIsAddingMenu(false); setNewMenuName(''); setNewMenuDesc(''); }} variant="outline" className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] border-2">Cancel</Button>
                        <Button onClick={handleAddMenuItem} disabled={!newMenuName.trim()} className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-primary/20">Add Item →</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </TabsContent>

          {/* ── STAFF TAB ─────────────────────────────────────────────────── */}
          <TabsContent value="staff" className="mt-4 space-y-4">
            <div className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Assigned Staff
                </h2>
              </div>
              <div className="p-5 space-y-3">
                {(event?.assignedStaffIds || []).map((staffId: string) => {
                  const member = (staffFromContext || []).find((s: any) => s.id === staffId);
                  if (!member) return null;
                  return (
                    <div key={staffId} className="flex items-center justify-between gap-3 p-3 rounded-2xl border-2 border-slate-200">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center font-black text-primary text-sm shrink-0">
                          {(member as any).name?.charAt(0)}
                        </div>
                        <div><p className="font-black text-sm text-slate-900">{(member as any).name}</p><p className="text-[9px] font-bold uppercase text-slate-400">{(member as any).role}</p></div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Input placeholder="Zone (e.g. T1–4)" defaultValue={event?.staffZones?.[staffId] || ''}
                          onChange={e => setStaffZones(prev => ({ ...prev, [staffId]: e.target.value }))}
                          className="h-8 w-32 rounded-xl border-2 text-xs font-bold" />
                        <button onClick={async () => {
                          const zones = { ...(event?.staffZones || {}), [staffId]: staffZones[staffId] || '' };
                          await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { staffZones: zones });
                          toast({ title: 'Zone saved' });
                        }} className="h-8 w-8 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={async () => {
                          await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { assignedStaffIds: (event?.assignedStaffIds || []).filter((id: string) => id !== staffId) });
                        }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
                {(event?.assignedStaffIds || []).length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed rounded-2xl">
                    <p className="font-black uppercase text-[10px] tracking-widest text-slate-400">No staff assigned yet</p>
                  </div>
                )}
                <div className="pt-2 space-y-2">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Add Staff Member</Label>
                  <div className="flex gap-2">
                    <Select value={staffToAdd || NO_SELECTION} onValueChange={v => setStaffToAdd(v === NO_SELECTION ? '' : v)}>
                      <SelectTrigger className="flex-1 h-11 rounded-xl border-2 font-bold text-sm"><SelectValue placeholder="Select staff…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SELECTION}>Select staff…</SelectItem>
                        {(staffFromContext || []).filter((s: any) => !(event?.assignedStaffIds || []).includes(s.id)).map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={async () => {
                      if (!staffToAdd || staffToAdd === NO_SELECTION) return;
                      const current = event?.assignedStaffIds || [];
                      if (current.includes(staffToAdd)) return;
                      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { assignedStaffIds: [...current, staffToAdd] });
                      setStaffToAdd(''); toast({ title: 'Staff assigned' });
                    }} disabled={!staffToAdd || staffToAdd === NO_SELECTION}
                      className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                      <Plus className="w-4 h-4" /> Assign
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── REQUESTS TAB ──────────────────────────────────────────────── */}
          <TabsContent value="requests" className="mt-4 space-y-4">
            <FloorRequestPanel
              requests={floorRequests}
              onResolve={async id => {
                await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, id), { status: 'done', resolvedAt: new Date().toISOString() });
                toast({ title: 'Request resolved' });
              }}
              tenantId={tenantId}
            />
            {floorRequests.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed rounded-3xl">
                <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="font-black uppercase text-[10px] tracking-widest text-slate-400">No active floor requests</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ── GUEST LINK ──────────────────────────────────────────────────── */}
        <AnimatePresence>
          {showLink && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-2xl border-2 border-primary/20 p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Guest Order Link</p>
              <div className="w-full bg-slate-50 rounded-xl px-4 py-3 border-2 border-slate-200">
                <p className="text-xs font-bold text-slate-700 break-all">{shareableLink}</p>
              </div>
              <Button onClick={() => { navigator.clipboard.writeText(shareableLink); toast({ title: 'Link Copied' }); }}
                className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                <Copy className="w-4 h-4" /> Copy Link
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── DIALOGS ─────────────────────────────────────────────────────── */}

        {/* Meal override */}
        <AnimatePresence>
          {mealOverrideGuest && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={() => setMealOverrideGuest(null)}>
              <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-md bg-white rounded-3xl border-2 shadow-2xl overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Override Meal Choice</p>
                  <p className="font-black text-lg text-slate-900">{mealOverrideGuest.name}</p>
                </div>
                <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                  <button onClick={() => setMealOverrideId(NO_SELECTION)}
                    className={cn('w-full flex items-center justify-between p-3 rounded-2xl border-2 text-left', mealOverrideId === NO_SELECTION ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:border-slate-300')}>
                    <p className="font-black text-sm text-slate-500">No Selection / Clear</p>
                    {mealOverrideId === NO_SELECTION && <Check className="w-4 h-4 text-slate-500 shrink-0" />}
                  </button>
                  {menuItems.map(item => (
                    <button key={item.id} onClick={() => setMealOverrideId(item.id)}
                      className={cn('w-full flex items-center justify-between p-3 rounded-2xl border-2 text-left', mealOverrideId === item.id ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300')}>
                      <p className="font-black text-sm text-slate-900">{item.name}</p>
                      {mealOverrideId === item.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
                <div className="p-4 flex gap-3 border-t border-slate-100">
                  <Button variant="outline" onClick={() => { setMealOverrideGuest(null); setMealOverrideId(''); }} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] border-2">Cancel</Button>
                  <Button onClick={handleMealOverride} disabled={savingOverride || !mealOverrideId} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-primary/20">
                    {savingOverride ? <Loader className="w-4 h-4 animate-spin" /> : 'Save Override →'}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Confirm activate */}
        <Dialog open={isConfirmActivateOpen} onOpenChange={setIsConfirmActivateOpen}>
          <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
            <DialogHeader className="p-6 pb-0"><DialogTitle className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500" /> Go Live</DialogTitle></DialogHeader>
            <div className="p-6 space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-200 space-y-2">
                <p className="font-black text-emerald-800">{eventDisplayName}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">{stats.checkedIn} of {stats.total} guests checked in</p>
              </div>
              {stats.notCheckedIn > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠ {stats.notCheckedIn} guests not yet checked in</p>
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setIsConfirmActivateOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] border-2">Cancel</Button>
                <Button onClick={handleActivateEvent} disabled={activatingNow}
                  className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-200 gap-2">
                  {activatingNow ? <Loader className="w-4 h-4 animate-spin" /> : '🟢 Activate Event'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* End event */}
        <Dialog open={isEndEventOpen} onOpenChange={setIsEndEventOpen}>
          <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
            <DialogHeader className="p-6 pb-0"><DialogTitle className="text-xl font-black uppercase tracking-tighter">End Event</DialogTitle></DialogHeader>
            <div className="p-6 space-y-4">
              {unfiredCourses.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">{unfiredCourses.length} Course{unfiredCourses.length !== 1 ? 's' : ''} not fired</p>
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setIsEndEventOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] border-2">Cancel</Button>
                <Button onClick={handleConfirmEndEvent} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] bg-slate-800 hover:bg-slate-900 gap-2">End Event →</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Broadcast sheet */}
        <Sheet open={broadcastOpen} onOpenChange={setBroadcastOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl">
            <SheetHeader className="pb-4"><SheetTitle className="flex items-center gap-2 font-black uppercase tracking-tight"><Megaphone className="w-5 h-5 text-violet-600" /> Send to Floor Staff</SheetTitle></SheetHeader>
            <div className="space-y-4">
              <Textarea value={broadcastText} onChange={e => setBroadcastText(e.target.value)}
                placeholder="e.g. Course 2 fires in 10 minutes. Clear starter plates now."
                className="min-h-[100px] rounded-2xl border-2 text-sm" />
              <div className="flex gap-3">
                <Button onClick={() => setBroadcastOpen(false)} variant="outline" className="flex-1 h-12 rounded-2xl border-2 font-black uppercase text-[10px]">Cancel</Button>
                <Button onClick={handleSendBroadcast} disabled={!broadcastText.trim() || sendingBroadcast}
                  className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] gap-2 bg-violet-600 hover:bg-violet-700">
                  {sendingBroadcast ? <Loader className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Course fire confirm */}
        {fireConfirmCourse !== null && (
          <CourseFireConfirmDialog
            open={fireConfirmCourse !== null}
            onOpenChange={open => { if (!open) setFireConfirmCourse(null); }}
            courseNumber={fireConfirmCourse}
            courseName={courseLabels[fireConfirmCourse] || `Course ${fireConfirmCourse}`}
            guests={guests} menuItems={menuItems}
            isFiring={isFiring === fireConfirmCourse}
            onConfirm={() => { const n = fireConfirmCourse; setFireConfirmCourse(null); handleFireCourse(n); }}
          />
        )}

        {/* Print modal */}
        <KitchenPrintModal open={printModalOpen} onOpenChange={setPrintModalOpen} event={event} guests={guests} menuItems={menuItems} courseNumbers={courseNumbers} />

      </main>
    </div>
  );
}