'use client';

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, QrCode, Printer, Check, X, Download,
  UserCheck, LayoutGrid, Move, Loader, Users,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import { doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// ─── TYPES ───────────────────────────────────────────────────────────────────
export type Seat = {
  id:    string;
  label: string;
};

export type SeatingTable = {
  id:             string;
  name:           string;
  x:              number | null;
  y:              number | null;
  color:          string;
  seatCount:      number;
  seatLabelStyle: 'letters' | 'numbers';
  seats:          Seat[];
  staffIds:       string[];
};

type Props = {
  tenantId:  string;
  eventId:   string;
  firestore: any;
  guests:    { id: string; name: string; tableNumber?: string; seatNumber?: string }[];
  staff:     { id: string; name: string; avatarUrl?: string }[];
  event:     any;
};

const TABLE_COLORS = [
  { id: 'slate',   bg: 'bg-slate-800',   border: 'border-slate-600',   hex: '#1e293b' },
  { id: 'rose',    bg: 'bg-rose-600',    border: 'border-rose-400',    hex: '#e11d48' },
  { id: 'violet',  bg: 'bg-violet-600',  border: 'border-violet-400',  hex: '#7c3aed' },
  { id: 'teal',    bg: 'bg-teal-600',    border: 'border-teal-400',    hex: '#0d9488' },
  { id: 'amber',   bg: 'bg-amber-500',   border: 'border-amber-300',   hex: '#f59e0b' },
  { id: 'emerald', bg: 'bg-emerald-600', border: 'border-emerald-400', hex: '#059669' },
];

// Avatar color palette for guest initials
const AVATAR_COLORS = [
  'bg-rose-400', 'bg-violet-400', 'bg-teal-400', 'bg-amber-400',
  'bg-emerald-400', 'bg-blue-400', 'bg-orange-400', 'bg-pink-400',
];

const genSeats = (count: number, style: 'letters' | 'numbers'): Seat[] =>
  Array.from({ length: count }, (_, i) => ({
    id:    nanoid(4),
    label: style === 'letters' ? String.fromCharCode(65 + i) : String(i + 1),
  }));

const getInitials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
};

// Stable color from name string
const getAvatarColor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

// ─── CANVAS TABLE CARD ────────────────────────────────────────────────────────
// FIX: Removed the overlay div approach. Instead, the drag handlers live directly
// on the card element using setPointerCapture so pointermove/pointerup keep firing
// even after the pointer leaves the element — no overlay needed.
const CanvasTableCard = ({
  table, isSelected, isDragging, onSelect, onPointerDown, onPointerMove, onPointerUp,
  assignedGuests, staffList,
}: {
  table: SeatingTable; isSelected: boolean; isDragging: boolean;
  onSelect: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp:   (e: React.PointerEvent) => void;
  assignedGuests: { seatId: string; guest: any }[];
  staffList: { id: string; name: string }[];
}) => {
  const color       = TABLE_COLORS.find(c => c.id === table.color) || TABLE_COLORS[0];
  const filledSeats = assignedGuests.length;
  const pct         = table.seatCount > 0 ? (filledSeats / table.seatCount) * 100 : 0;

  // Show up to 6 guest avatars, then +N overflow
  const visibleGuests = assignedGuests.slice(0, 6);
  const overflowCount = assignedGuests.length - visibleGuests.length;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onSelect}
      style={{
        left: `${table.x ?? 20}%`,
        top:  `${table.y ?? 20}%`,
        transform: 'translate(-50%, -50%)',
        width: '128px',
        touchAction: 'none',
        userSelect: 'none',
      }}
      className={cn(
        'absolute cursor-grab active:cursor-grabbing select-none transition-shadow',
        isDragging ? 'shadow-2xl z-50 scale-105' : isSelected ? 'shadow-xl z-10' : 'shadow-md z-0',
      )}
    >
      <div className={cn('rounded-xl border-2 overflow-hidden', color.border, isSelected ? 'ring-2 ring-white ring-offset-1' : '')}>
        {/* Header */}
        <div className={cn('px-3 py-2', color.bg)}>
          <p className="text-[8px] font-black uppercase tracking-widest text-white/70 leading-none mb-0.5">Table</p>
          <p className="font-black text-white text-sm leading-none truncate">{table.name}</p>
        </div>

        {/* Body */}
        <div className="bg-white/95 px-3 py-2 space-y-2">
          {/* Seat fill bar */}
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Seats</span>
            <span className="text-[10px] font-black text-slate-700">{filledSeats}/{table.seatCount}</span>
          </div>
          <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </div>

          {/* ── LIVE GUEST AVATARS ── */}
          {assignedGuests.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {visibleGuests.map(({ guest }) => guest ? (
                <div
                  key={guest.id}
                  title={guest.name}
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black text-white shrink-0 ring-1 ring-white',
                    getAvatarColor(guest.name),
                  )}
                >
                  {getInitials(guest.name)}
                </div>
              ) : null)}
              {overflowCount > 0 && (
                <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[7px] font-black text-slate-500 ring-1 ring-white">
                  +{overflowCount}
                </div>
              )}
            </div>
          )}

          {/* Staff coverage dots */}
          {table.staffIds.length > 0 && (
            <div className="flex flex-wrap gap-0.5 pt-0.5 border-t border-slate-100">
              {table.staffIds.slice(0, 3).map(sid => {
                const s = staffList.find(st => st.id === sid);
                return s ? (
                  <div key={sid} className="w-4 h-4 rounded-full bg-violet-100 flex items-center justify-center text-[6px] font-black text-violet-700" title={s.name}>
                    {getInitials(s.name)}
                  </div>
                ) : null;
              })}
              {table.staffIds.length > 3 && (
                <span className="text-[7px] font-black text-slate-400">+{table.staffIds.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── GUEST ASSIGN SHEET ───────────────────────────────────────────────────────
const GuestAssignSheet = ({
  open, onOpenChange, seat, table, guests, assignedGuests, onAssign,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seat: Seat | null;
  table: SeatingTable | null;
  guests: Props['guests'];
  assignedGuests: { seatId: string; guestId: string; guestName: string }[];
  onAssign: (guestId: string, tableId: string, seatId: string) => Promise<void>;
}) => {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [search, setSearch]       = useState('');

  const available = useMemo(() => {
    const allAssignedGuestIds = new Set(assignedGuests.filter(a => a.seatId !== seat?.id).map(a => a.guestId));
    const base = guests.filter(g => {
      if (allAssignedGuestIds.has(g.id)) return false;
      if (g.tableNumber && g.tableNumber !== table?.id) return false;
      return true;
    });
    if (!search.trim()) return base;
    return base.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
  }, [guests, assignedGuests, seat, table, search]);

  const handlePick = async (guestId: string) => {
    if (!seat || !table) return;
    setAssigning(guestId);
    await onAssign(guestId, table.id, seat.id);
    setAssigning(null);
    setSearch('');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-t-0 pb-safe max-h-[75vh] flex flex-col">
        <SheetHeader className="pb-3 shrink-0">
          <SheetTitle className="font-black uppercase tracking-tight">
            Assign Guest — {table?.name} · Seat {seat?.label}
          </SheetTitle>
        </SheetHeader>
        <div className="relative shrink-0 mb-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search guests…"
            className="w-full h-11 rounded-xl border-2 border-slate-200 px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-400 transition-colors"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pb-4">
          {available.length === 0 && (
            <p className="text-center py-8 text-[10px] font-black uppercase tracking-widest text-slate-400">
              No available guests
            </p>
          )}
          {available.map(g => (
            <button
              key={g.id}
              onClick={() => handlePick(g.id)}
              disabled={!!assigning}
              className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-100 hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
            >
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-sm shrink-0', getAvatarColor(g.name))}>
                {getInitials(g.name)}
              </div>
              <p className="font-black text-slate-900">{g.name}</p>
              {assigning === g.id
                ? <Loader className="w-4 h-4 animate-spin text-slate-400 ml-auto" />
                : <Check className="w-4 h-4 text-slate-200 ml-auto" />
              }
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
};

// ─── TABLE CONFIG PANEL ───────────────────────────────────────────────────────
const TableConfigPanel = ({
  table, onUpdate, onDelete, guests, assignedGuests, onAssignGuest, staff, tenantId, eventId, baseUrl,
}: {
  table: SeatingTable; onUpdate: (t: SeatingTable) => void; onDelete: () => void;
  guests: Props['guests'];
  assignedGuests: { seatId: string; guestId: string; guestName: string }[];
  onAssignGuest: (guestId: string, tableId: string, seatId: string) => Promise<void>;
  staff: Props['staff'];
  tenantId: string; eventId: string; baseUrl: string;
}) => {
  const [qrUrls,     setQrUrls]     = useState<Record<string, string>>({});
  const [showQr,     setShowQr]     = useState(false);
  const [sheetOpen,  setSheetOpen]  = useState(false);
  const [activeSeat, setActiveSeat] = useState<Seat | null>(null);

  const handleSeatCountChange = (count: number) =>
    onUpdate({ ...table, seatCount: count, seats: genSeats(count, table.seatLabelStyle) });

  const handleLabelStyleChange = (style: 'letters' | 'numbers') =>
    onUpdate({ ...table, seatLabelStyle: style, seats: genSeats(table.seatCount, style) });

  const generateQrCodes = async () => {
    const urls: Record<string, string> = {};
    for (const seat of table.seats) {
      const url = `${baseUrl}/request/${tenantId}/${eventId}/${table.id}/${seat.id}`;
      urls[seat.id] = await QRCode.toDataURL(url, { width: 200, margin: 1 });
    }
    setQrUrls(urls);
    setShowQr(true);
  };

  const openAssignSheet = (seat: Seat) => {
    setActiveSeat(seat);
    setSheetOpen(true);
  };

  const toggleStaff = (staffId: string) => {
    const ids = table.staffIds.includes(staffId)
      ? table.staffIds.filter(id => id !== staffId)
      : [...table.staffIds, staffId];
    onUpdate({ ...table, staffIds: ids });
  };

  return (
    <div className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Table Name</label>
        <input
          value={table.name}
          onChange={e => onUpdate({ ...table, name: e.target.value })}
          className="w-full h-10 rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-slate-300"
        />
      </div>

      {/* Seats */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Seat Count</label>
        <div className="flex items-center gap-3">
          <button onClick={() => handleSeatCountChange(Math.max(1, table.seatCount - 1))}
            className="w-9 h-9 rounded-xl border-2 border-slate-100 flex items-center justify-center font-black text-slate-500 hover:border-slate-300">−</button>
          <span className="text-2xl font-black text-slate-800 w-8 text-center">{table.seatCount}</span>
          <button onClick={() => handleSeatCountChange(Math.min(20, table.seatCount + 1))}
            className="w-9 h-9 rounded-xl border-2 border-slate-100 flex items-center justify-center font-black text-slate-500 hover:border-slate-300">+</button>
        </div>
      </div>

      {/* Label style */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Seat Labels</label>
        <div className="flex gap-2">
          {(['letters', 'numbers'] as const).map(s => (
            <button key={s} onClick={() => handleLabelStyleChange(s)}
              className={cn('flex-1 h-9 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all',
                table.seatLabelStyle === s ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-100 text-slate-500 hover:border-slate-300')}>
              {s === 'letters' ? 'A, B, C' : '1, 2, 3'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {table.seats.map(seat => (
            <span key={seat.id} className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-600">
              {seat.label}
            </span>
          ))}
        </div>
      </div>

      {/* Color */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Table Color</label>
        <div className="flex gap-2">
          {TABLE_COLORS.map(c => (
            <button key={c.id} onClick={() => onUpdate({ ...table, color: c.id })}
              className={cn('w-8 h-8 rounded-lg transition-all', c.bg,
                table.color === c.id ? 'ring-2 ring-offset-1 ring-slate-900 scale-110' : 'opacity-60 hover:opacity-100')} />
          ))}
        </div>
      </div>

      {/* Staff coverage */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Staff Coverage</label>
        <div className="space-y-1.5">
          {staff.map(s => (
            <button key={s.id} onClick={() => toggleStaff(s.id)}
              className={cn('w-full flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all',
                table.staffIds.includes(s.id) ? 'border-violet-200 bg-violet-50' : 'border-slate-100 bg-white hover:border-slate-200')}>
              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0',
                table.staffIds.includes(s.id) ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500')}>
                {getInitials(s.name)}
              </div>
              <span className={cn('text-sm font-black flex-1 text-left',
                table.staffIds.includes(s.id) ? 'text-violet-700' : 'text-slate-600')}>
                {s.name}
              </span>
              {table.staffIds.includes(s.id) && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
            </button>
          ))}
          {staff.length === 0 && (
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">No staff assigned to this event</p>
          )}
        </div>
      </div>

      {/* Guest seat assignment */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Seat Assignments</label>
        <div className="space-y-2">
          {table.seats.map(seat => {
            const assigned = assignedGuests.find(a => a.seatId === seat.id);
            return (
              <div key={seat.id} className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">
                  {seat.label}
                </div>
                {assigned ? (
                  <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-xl bg-emerald-50 border-2 border-emerald-100">
                    <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black text-white shrink-0', getAvatarColor(assigned.guestName))}>
                      {getInitials(assigned.guestName)}
                    </div>
                    <span className="text-sm font-black text-emerald-800 truncate flex-1">{assigned.guestName}</span>
                    <button
                      onClick={async () => {
                        const g = guests.find(g => g.id === assigned.guestId);
                        if (g) await onAssignGuest('__remove__', table.id, seat.id);
                      }}
                      className="p-1 rounded-lg hover:bg-emerald-200 text-emerald-400 hover:text-emerald-700 transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => openAssignSheet(seat)}
                    className="flex-1 h-10 rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-400 text-left hover:border-slate-300 transition-colors flex items-center gap-2"
                  >
                    <Users className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    Assign guest…
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* QR codes */}
      <div className="space-y-2">
        <button onClick={generateQrCodes}
          className="w-full h-10 rounded-xl border-2 border-slate-100 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-all">
          <QrCode className="w-4 h-4" /> Generate QR Codes
        </button>
        <AnimatePresence>
          {showQr && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="grid grid-cols-3 gap-2 pt-2">
                {table.seats.map(seat => (
                  <div key={seat.id} className="text-center space-y-1">
                    {qrUrls[seat.id] && <img src={qrUrls[seat.id]} alt={`Seat ${seat.label}`} className="w-full rounded-lg border border-slate-100" />}
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Seat {seat.label}</p>
                  </div>
                ))}
              </div>
              <button onClick={() => {
                table.seats.forEach(seat => {
                  if (qrUrls[seat.id]) {
                    const a = document.createElement('a');
                    a.href = qrUrls[seat.id];
                    a.download = `${table.name}-seat-${seat.label}.png`;
                    a.click();
                  }
                });
              }} className="w-full mt-2 h-9 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download All
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Delete */}
      <button onClick={onDelete}
        className="w-full h-9 rounded-xl border-2 border-red-100 text-red-400 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-red-50 transition-all">
        <Trash2 className="w-3.5 h-3.5" /> Remove Table
      </button>

      <GuestAssignSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        seat={activeSeat}
        table={table}
        guests={guests}
        assignedGuests={assignedGuests}
        onAssign={onAssignGuest}
      />
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export function SeatingChartTab({ tenantId, eventId, firestore, guests, staff, event }: Props) {
  const { toast } = useToast();

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const [tables,     setTables]     = useState<SeatingTable[]>(() => event?.seatingTables || []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isSaving,   setIsSaving]   = useState(false);
  const [saved,      setSaved]      = useState(false);

  const canvasRef     = useRef<HTMLDivElement>(null);
  // Stores pointer offset within the card at drag start (in canvas-percentage units)
  const dragOffset    = useRef({ xPct: 0, yPct: 0 });
  // Active pointer id for correct multi-touch handling
  const activePointer = useRef<number | null>(null);

  useEffect(() => {
    if (event?.seatingTables) setTables(event.seatingTables);
  }, [event?.seatingTables]);

  const selectedTable = tables.find(t => t.id === selectedId) || null;

  const guestAssignments = useMemo(() => {
    const map: Record<string, { seatId: string; guestId: string; guestName: string }[]> = {};
    for (const t of tables) map[t.id] = [];
    for (const g of guests) {
      if (g.tableNumber && g.seatNumber && map[g.tableNumber]) {
        map[g.tableNumber].push({ seatId: g.seatNumber, guestId: g.id, guestName: g.name });
      }
    }
    return map;
  }, [tables, guests]);

  const addTable = () => {
    const id = nanoid();
    const newTable: SeatingTable = {
      id,
      name:           `Table ${tables.length + 1}`,
      x:              20 + (tables.length % 4) * 20,
      y:              20 + Math.floor(tables.length / 4) * 30,
      color:          TABLE_COLORS[tables.length % TABLE_COLORS.length].id,
      seatCount:      4,
      seatLabelStyle: 'letters',
      seats:          genSeats(4, 'letters'),
      staffIds:       [],
    };
    setTables(prev => [...prev, newTable]);
    setSelectedId(id);
  };

  const updateTable = (updated: SeatingTable) =>
    setTables(prev => prev.map(t => t.id === updated.id ? updated : t));

  const deleteTable = (id: string) => {
    setTables(prev => prev.filter(t => t.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Pointer drag — FIX ────────────────────────────────────────────────────
  // Key insight: we call setPointerCapture on the card element so all subsequent
  // pointermove/pointerup events are delivered to that element even if the pointer
  // moves outside it. This removes the need for the overlay div entirely.
  // Handlers are passed down to CanvasTableCard and attached directly on its root div.
  const handlePointerDown = useCallback((e: React.PointerEvent, tableId: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const table = tables.find(t => t.id === tableId);
    if (!table) return;

    const rect     = canvas.getBoundingClientRect();
    // Current table centre in pixels relative to canvas
    const tableXpx = ((table.x ?? 20) / 100) * rect.width;
    const tableYpx = ((table.y ?? 20) / 100) * rect.height;

    // Offset from pointer to table centre (in canvas-% units for resolution independence)
    dragOffset.current = {
      xPct: ((e.clientX - rect.left) - tableXpx) / rect.width  * 100,
      yPct: ((e.clientY - rect.top)  - tableYpx) / rect.height * 100,
    };

    activePointer.current = e.pointerId;

    // Capture: all future events for this pointer go to this element
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    setDraggingId(tableId);
    setSelectedId(tableId);
  }, [tables]);

  const handlePointerMove = useCallback((e: React.PointerEvent, tableId: string) => {
    if (draggingId !== tableId || activePointer.current !== e.pointerId) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const newX = Math.max(5, Math.min(95,
      ((e.clientX - rect.left) / rect.width  * 100) - dragOffset.current.xPct
    ));
    const newY = Math.max(5, Math.min(95,
      ((e.clientY - rect.top)  / rect.height * 100) - dragOffset.current.yPct
    ));

    setTables(prev => prev.map(t => t.id === tableId ? { ...t, x: newX, y: newY } : t));
  }, [draggingId]);

  const handlePointerUp = useCallback((e: React.PointerEvent, tableId: string) => {
    if (draggingId !== tableId) return;
    setDraggingId(null);
    activePointer.current = null;
  }, [draggingId]);

  // ── Save layout ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!firestore || !tenantId || !eventId) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), {
        seatingTables: tables,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast({ title: 'Seating layout saved' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Failed to save layout' });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Assign guest to seat ───────────────────────────────────────────────────
  const handleAssignGuest = async (guestId: string, tableId: string, seatId: string) => {
    if (!firestore || !tenantId) return;
    try {
      if (guestId === '__remove__') {
        const g = guests.find(g => g.tableNumber === tableId && g.seatNumber === seatId);
        if (g) {
          await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, g.id), {
            tableNumber: null,
            seatNumber:  null,
          });
          toast({ title: 'Guest unassigned' });
        }
        return;
      }
      await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId), {
        tableNumber: tableId,
        seatNumber:  seatId,
      });
      toast({ title: 'Guest assigned to seat' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to assign guest' });
    }
  };

  // ── Print all QR codes ─────────────────────────────────────────────────────
  const printAllQrCodes = async () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    let html = `<html><head><title>Seat QR Codes</title><style>
      body{font-family:sans-serif;padding:20px}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
      .card{text-align:center;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
      .table-name{font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#64748b;margin-bottom:4px}
      .seat-label{font-weight:900;font-size:14px;color:#1e293b;margin-top:8px}
      img{width:100%;max-width:140px}
      @media print{.no-print{display:none}}
    </style></head><body>
    <button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:8px 16px;background:#1e293b;color:white;border:none;border-radius:8px;font-weight:900;cursor:pointer">Print All</button>
    <div class="grid">`;

    for (const table of tables) {
      for (const seat of table.seats) {
        const url    = `${baseUrl}/request/${tenantId}/${eventId}/${table.id}/${seat.id}`;
        const qrData = await QRCode.toDataURL(url, { width: 200, margin: 1 });
        html += `<div class="card"><div class="table-name">${table.name}</div><img src="${qrData}" /><div class="seat-label">Seat ${seat.label}</div></div>`;
      }
    }

    html += `</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-black text-slate-900 text-sm uppercase tracking-tight">Room Layout</h3>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            {tables.length} table{tables.length !== 1 ? 's' : ''} · {tables.reduce((n, t) => n + t.seatCount, 0)} seats
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={printAllQrCodes}
            className="h-8 px-3 rounded-xl border-2 border-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-300 flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Print All QR
          </button>
          <button onClick={addTable}
            className="h-8 px-3 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Table
          </button>
          <button onClick={handleSave} disabled={isSaving}
            className={cn('h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
              saved ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white hover:bg-violet-700')}>
            {isSaving
              ? <Loader className="w-3 h-3 animate-spin" />
              : saved
                ? <><Check className="w-3.5 h-3.5" /> Saved</>
                : 'Save Layout'
            }
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0 flex-col md:flex-row">
        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <div
            ref={canvasRef}
            className="relative w-full bg-slate-50 border-2 border-slate-200 rounded-2xl overflow-hidden"
            style={{ aspectRatio: '16/9' }}
            onClick={e => { if (e.target === canvasRef.current) setSelectedId(null); }}
          >
            {/* Grid lines */}
            <div className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: 'linear-gradient(rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.15) 1px, transparent 1px)',
                backgroundSize: '10% 10%',
              }} />

            <div className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-white/80 border border-slate-200">
              <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-400">Room Layout</p>
            </div>
            <div className="absolute bottom-3 right-3 flex items-center gap-1 opacity-50">
              <Move className="w-3 h-3 text-slate-400" />
              <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">Drag to position</p>
            </div>

            {tables.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <LayoutGrid className="w-10 h-10 text-slate-300" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Add tables to build the room layout</p>
              </div>
            )}

            {tables.map(table => (
              <CanvasTableCard
                key={table.id}
                table={table}
                isSelected={selectedId === table.id}
                isDragging={draggingId === table.id}
                onSelect={() => setSelectedId(prev => prev === table.id ? null : table.id)}
                onPointerDown={e => handlePointerDown(e, table.id)}
                onPointerMove={e => handlePointerMove(e, table.id)}
                onPointerUp={e => handlePointerUp(e, table.id)}
                assignedGuests={(guestAssignments[table.id] || []).map(a => ({
                  seatId: a.seatId,
                  guest:  guests.find(g => g.id === a.guestId),
                }))}
                staffList={staff}
              />
            ))}
            {/* No overlay div needed — pointer capture handles this */}
          </div>

          {/* Table list below canvas */}
          {tables.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {tables.map(table => {
                const color  = TABLE_COLORS.find(c => c.id === table.color) || TABLE_COLORS[0];
                const filled = (guestAssignments[table.id] || []).length;
                return (
                  <button key={table.id} onClick={() => setSelectedId(table.id)}
                    className={cn('flex items-center gap-2 p-2 rounded-xl border-2 text-left transition-all',
                      selectedId === table.id ? 'border-slate-300 bg-slate-50' : 'border-slate-100 bg-white hover:border-slate-200')}>
                    <div className={cn('w-3 h-3 rounded-sm shrink-0', color.bg)} />
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-tight text-slate-800 truncate">{table.name}</p>
                      <p className="text-[8px] font-bold text-slate-400">{filled}/{table.seatCount} seated</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Config panel */}
        <AnimatePresence>
          {selectedTable && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className="w-full md:w-[280px] md:shrink-0"
            >
              <div className="bg-white border-2 border-slate-100 rounded-2xl overflow-y-auto max-h-[70vh] md:max-h-[600px]">
                <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between z-10">
                  <p className="font-black text-sm text-slate-800 uppercase tracking-tight">{selectedTable.name}</p>
                  <button onClick={() => setSelectedId(null)} className="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center">
                    <X className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
                <div className="p-4">
                  <TableConfigPanel
                    table={selectedTable}
                    onUpdate={updateTable}
                    onDelete={() => deleteTable(selectedTable.id)}
                    guests={guests}
                    assignedGuests={guestAssignments[selectedTable.id] || []}
                    onAssignGuest={handleAssignGuest}
                    staff={staff}
                    tenantId={tenantId}
                    eventId={eventId}
                    baseUrl={baseUrl}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}