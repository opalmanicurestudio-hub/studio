// src/app/floor/[tenantId]/page.tsx
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where, updateDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle2, Bell, AlertTriangle, Loader, Droplets, Utensils,
  Package, Accessibility, MessageSquare, WifiOff, UserCheck,
  LogOut, ChefHat, MapPin, Calendar, Users, Delete,
} from 'lucide-react';

const safeDate = (v: any) => v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v));

// ─── TYPES ────────────────────────────────────────────────────────────────────
type FloorRequest = {
  id: string;
  tenantId: string;
  requestType?: string;
  type?: string;
  label: string;
  status: 'new' | 'acknowledged' | 'done';
  tableNumber?: string;
  seatNumber?: string;
  guestName?: string;
  guestAllergies?: any[];
  requestText?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  source?: string;
  _pending?: boolean;
};

type StaffMember = {
  id: string;
  name: string;
  role?: string;
  pin?: string;
  avatarUrl?: string;
};

const getType = (r: FloorRequest) => r.requestType || r.type || 'other';

const FLOOR_REQUEST_TYPES = [
  { type: 'water',         label: 'Water Refill',   icon: '💧' },
  { type: 'napkins',       label: 'Napkins',         icon: '🧻' },
  { type: 'condiments',    label: 'Condiments',      icon: '🧂' },
  { type: 'utensils',      label: 'Extra Utensils',  icon: '🍴' },
  { type: 'ice',           label: 'Ice',             icon: '🧊' },
  { type: 'accessibility', label: 'Accessibility',   icon: '♿' },
  { type: 'temperature',   label: 'Temperature',     icon: '🌡️' },
  { type: 'cleaning',      label: 'Spill / Cleanup', icon: '🧹' },
  { type: 'other',         label: 'Other',           icon: '💬' },
];

const typeIcon = (type: string) => {
  const map: Record<string, React.ReactNode> = {
    water:         <Droplets      className="w-5 h-5" />,
    napkins:       <Package       className="w-5 h-5" />,
    condiments:    <Package       className="w-5 h-5" />,
    utensils:      <Utensils      className="w-5 h-5" />,
    accessibility: <Accessibility className="w-5 h-5" />,
    other:         <MessageSquare className="w-5 h-5" />,
  };
  return map[type] ?? <Bell className="w-5 h-5" />;
};

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── GAP 5: PIN LOGIN ─────────────────────────────────────────────────────────
const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

const PinLogin = ({
  staff, tenantName, onLogin,
}: {
  staff: StaffMember[];
  tenantName: string;
  onLogin: (member: StaffMember) => void;
}) => {
  const [pin, setPin]         = useState('');
  const [shake, setShake]     = useState(false);
  const [welcome, setWelcome] = useState<StaffMember | null>(null);

  const press = (key: string) => {
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) {
      const found = staff.find(s => s.pin === next);
      if (found) {
        setWelcome(found);
        setTimeout(() => onLogin(found), 600);
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); }, 600);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <motion.div
        animate={shake ? { x: [0, -12, 12, -8, 8, 0] } : {}}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-8 w-full max-w-xs"
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center">
            <ChefHat className="w-7 h-7 text-primary" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">{tenantName}</p>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-white mt-1">Floor Staff</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Enter your PIN to continue</p>
          </div>
        </div>

        {/* PIN dots */}
        <div className="flex gap-4">
          {[0,1,2,3].map(i => (
            <motion.div key={i}
              animate={{ scale: pin.length > i ? 1.25 : 1 }}
              className={cn(
                'w-4 h-4 rounded-full border-2 transition-colors duration-150',
                pin.length > i
                  ? shake ? 'bg-red-500 border-red-500' : 'bg-primary border-primary'
                  : 'bg-transparent border-slate-600'
              )} />
          ))}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {PIN_KEYS.map((key, i) => (
            <button key={i} onClick={() => key && press(key)} disabled={!key}
              className={cn(
                'h-16 rounded-2xl font-black text-2xl transition-all active:scale-95 select-none',
                key === '⌫'
                  ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  : key
                  ? 'bg-slate-800 text-white hover:bg-slate-700 shadow-lg shadow-black/30'
                  : 'opacity-0 pointer-events-none'
              )}>
              {key === '⌫' ? <Delete className="w-5 h-5 mx-auto" /> : key}
            </button>
          ))}
        </div>

        {/* Welcome flash */}
        <AnimatePresence>
          {welcome && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-emerald-400">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center font-black text-sm">
                {getInitials(welcome.name)}
              </div>
              <p className="text-[11px] font-black uppercase tracking-widest">
                Welcome, {welcome.name.split(' ')[0]} ✓
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* No PIN set — fallback list */}
        {staff.filter(s => !s.pin).length > 0 && (
          <div className="w-full space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 text-center">Or select your name</p>
            {staff.filter(s => !s.pin).map(s => (
              <button key={s.id} onClick={() => onLogin(s)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-800 hover:bg-slate-700 transition-all">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center font-black text-primary text-sm shrink-0">
                  {getInitials(s.name)}
                </div>
                <div className="text-left">
                  <p className="font-black text-sm text-white">{s.name}</p>
                  {s.role && <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{s.role}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

// ─── GAP 4: EVENT CONTEXT PANEL ───────────────────────────────────────────────
const EventContextPanel = ({
  event, myTables, assignedTables, menuItems, checkedInCount, totalCount,
}: {
  event: any;
  myTables: string[];
  assignedTables: string[];
  menuItems: any[];
  checkedInCount: number;
  totalCount: number;
}) => {
  const [expanded, setExpanded] = useState(false);
  if (!event) return null;

  const displayName = event.title || event.name || 'Tonight\'s Event';
  const effectiveTables = myTables.length > 0 ? myTables : assignedTables;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      {/* Summary row — always visible */}
      <button onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-800/50 transition-all text-left">
        <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
          <Calendar className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-white truncate">{displayName}</p>
          <div className="flex items-center gap-3 mt-0.5">
            {effectiveTables.length > 0 && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-primary">
                <MapPin className="w-2.5 h-2.5 inline mr-0.5" />
                Tables {effectiveTables.join(', ')}
              </span>
            )}
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
              <Users className="w-2.5 h-2.5 inline mr-0.5" />
              {checkedInCount}/{totalCount} in
            </span>
          </div>
        </div>
        <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded menu + details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-slate-800">
            <div className="p-4 space-y-4">
              {/* Event details */}
              {event.date && (
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <Calendar className="w-3 h-3" />
                  {format(new Date(event.date), 'EEEE, MMMM d')}
                  {event.time && ` · ${event.time}`}
                  {event.venue && ` · ${event.venue}`}
                </div>
              )}

              {/* Menu items — grouped by course */}
              {menuItems.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-500">Tonight's Menu</p>
                  {[1, 2, 3].map(courseNum => {
                    const courseItems = menuItems.filter(m => m.courseNumber === courseNum);
                    if (courseItems.length === 0) return null;
                    const courseLabel = courseNum === 1 ? 'Starters' : courseNum === 2 ? 'Mains' : 'Desserts';
                    return (
                      <div key={courseNum}>
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 mb-1">{courseLabel}</p>
                        <div className="space-y-1">
                          {courseItems.map(item => (
                            <div key={item.id} className="flex items-start gap-2 p-2 rounded-xl bg-slate-800/50">
                              <Utensils className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
                              <div>
                                <p className="text-[11px] font-black text-white">{item.name}</p>
                                {item.description && <p className="text-[9px] text-slate-500">{item.description}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Assigned tables reminder */}
              {effectiveTables.length > 0 && (
                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                  <p className="text-[8px] font-black uppercase tracking-[0.3em] text-primary/70 mb-1">Your Tables Tonight</p>
                  <p className="font-black text-primary text-sm">{effectiveTables.join(', ')}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── LIVE ELAPSED TIMER ───────────────────────────────────────────────────────
const ElapsedTimer = ({ createdAt }: { createdAt: string }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - safeDate(createdAt).getTime()) / 1000));
    tick();
    const i = setInterval(tick, 10_000);
    return () => clearInterval(i);
  }, [createdAt]);
  const mins = Math.floor(elapsed / 60);
  const isWarning = mins >= 5;
  return (
    <span className={cn('text-[10px] font-black uppercase tracking-widest',
      isWarning ? 'text-amber-500' : 'text-slate-400')}>
      {isWarning && '⚠ '}{mins < 1 ? 'Just now' : `${mins}m ago`}
    </span>
  );
};

// ─── REQUEST CARD ─────────────────────────────────────────────────────────────
const RequestCard = ({
  request, onResolve, onAcknowledge, myTables, isPending,
}: {
  request: FloorRequest;
  onResolve: (id: string) => Promise<void>;
  onAcknowledge: (id: string) => Promise<void>;
  myTables: string[];
  isPending?: boolean;
}) => {
  const [resolving, setResolving]       = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  const type           = getType(request);
  const isNew          = request.status === 'new';
  const isAcknowledged = request.status === 'acknowledged';
  const isActive       = isNew || isAcknowledged;
  const isUrgent       = type === 'accessibility';
  const elapsedMins    = Math.floor((Date.now() - safeDate(request.createdAt).getTime()) / 60000);
  const isLate         = isActive && elapsedMins >= 5;
  const isMyTable      = myTables.length === 0 || (request.tableNumber && myTables.includes(request.tableNumber));
  const hasCritical    = (request.guestAllergies || []).some((a: any) => typeof a === 'object' && a.severity === 'critical');

  const handleResolve     = async () => { setResolving(true);     await onResolve(request.id);     setResolving(false); };
  const handleAcknowledge = async () => { setAcknowledging(true); await onAcknowledge(request.id); setAcknowledging(false); };

  return (
    <motion.div layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: isPending ? 0.7 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className={cn(
        'rounded-2xl border-2 overflow-hidden transition-all',
        !isMyTable && 'opacity-40',
        isActive && isUrgent  ? 'border-red-300 bg-red-50 shadow-lg shadow-red-100' :
        isActive && isLate    ? 'border-amber-300 bg-amber-50 shadow-md shadow-amber-100' :
        isAcknowledged        ? 'border-amber-200 bg-amber-50/60 shadow-sm' :
        isNew                 ? 'border-slate-200 bg-white shadow-md shadow-slate-100' :
        'border-slate-100 bg-slate-50 opacity-60'
      )}>
      <div className="p-4 flex items-start gap-4">
        <div className={cn('p-3 rounded-xl shrink-0',
          isUrgent       ? 'bg-red-100 text-red-600' :
          isLate         ? 'bg-amber-100 text-amber-700' :
          isAcknowledged ? 'bg-amber-50 text-amber-600' :
          isNew          ? 'bg-slate-100 text-slate-600' :
          'bg-slate-100 text-slate-400')}>
          {typeIcon(type)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="font-black text-base text-slate-900 uppercase tracking-tight">
              {FLOOR_REQUEST_TYPES.find(t => t.type === type)?.label || request.label || type}
            </p>
            {isPending && (
              <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-wide">Syncing…</span>
            )}
            {isAcknowledged && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-wide">🏃 En Route</span>
            )}
            {isActive && isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black uppercase tracking-wide">Urgent</span>
            )}
            {isActive && isLate && !isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-wide">Waiting {elapsedMins}m</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1 flex-wrap">
            {request.tableNumber && <span>Table {request.tableNumber}</span>}
            {request.tableNumber && request.seatNumber && <span>·</span>}
            {request.seatNumber  && <span>Seat {request.seatNumber}</span>}
            {request.guestName   && <><span>·</span><span className="text-slate-700">{request.guestName}</span></>}
          </div>

          {hasCritical && (
            <div className="flex flex-wrap gap-1 my-1.5">
              {(request.guestAllergies || [])
                .filter((a: any) => typeof a === 'object' && a.severity === 'critical')
                .map((a: any) => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-[9px] font-black uppercase tracking-wide text-red-800">
                    <AlertTriangle className="w-2.5 h-2.5" /> {a.label}
                  </span>
                ))}
            </div>
          )}
          {!hasCritical && (request.guestAllergies || []).length > 0 && (
            <div className="flex flex-wrap gap-1 my-1.5">
              {(request.guestAllergies || []).map((a: any) => (
                <span key={typeof a === 'string' ? a : a.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-black uppercase tracking-wide text-amber-700">
                  ⚠ {typeof a === 'string' ? a : a.label}
                </span>
              ))}
            </div>
          )}

          {request.requestText && <p className="text-sm text-slate-600 mt-1 leading-relaxed">{request.requestText}</p>}
          <div className="mt-2"><ElapsedTimer createdAt={request.createdAt} /></div>
        </div>

        {isActive && (
          <div className="flex flex-col gap-2 shrink-0">
            {isNew && (
              <div className="flex flex-col items-center gap-0.5">
                <button onClick={handleAcknowledge} disabled={acknowledging || isPending} title="On my way"
                  className={cn('w-12 h-11 rounded-xl flex items-center justify-center transition-all text-lg',
                    acknowledging || isPending ? 'bg-slate-100' : 'bg-amber-400 hover:bg-amber-500 active:scale-95 shadow-lg shadow-amber-200')}>
                  {acknowledging ? <Loader className="w-4 h-4 animate-spin text-slate-400" /> : <span>🏃</span>}
                </button>
                <span className="text-[7px] font-black uppercase tracking-widest text-slate-400">On Way</span>
              </div>
            )}
            <div className="flex flex-col items-center gap-0.5">
              <button onClick={handleResolve} disabled={resolving || isPending} title="Mark done"
                className={cn('w-12 h-11 rounded-xl flex items-center justify-center transition-all',
                  resolving || isPending ? 'bg-slate-100' :
                  isLate ? 'bg-amber-500 hover:bg-amber-600 active:scale-95 shadow-lg shadow-amber-200' :
                  'bg-emerald-500 hover:bg-emerald-600 active:scale-95 shadow-lg shadow-emerald-200')}>
                {resolving ? <Loader className="w-5 h-5 animate-spin text-slate-400" /> : <CheckCircle2 className="w-6 h-6 text-white" />}
              </button>
              <span className="text-[7px] font-black uppercase tracking-widest text-slate-400">Done</span>
            </div>
          </div>
        )}
        {!isActive && <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-1" />}
      </div>
    </motion.div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function FloorStaffPage() {
  const params        = useParams();
  const { firestore } = useFirebase();
  const { toast }     = useToast();
  const tenantId      = params.tenantId as string;

  // ── GAP 5: Staff session ──────────────────────────────────────────────────
  const [currentStaff, setCurrentStaff] = useState<StaffMember | null>(() => {
    // Persist across page refreshes for the session
    if (typeof window === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem(`opal_floor_staff_${tenantId}`);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const handleLogin = (member: StaffMember) => {
    sessionStorage.setItem(`opal_floor_staff_${tenantId}`, JSON.stringify(member));
    setCurrentStaff(member);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(`opal_floor_staff_${tenantId}`);
    setCurrentStaff(null);
  };

  const [showDone, setShowDone]             = useState(false);
  const [isOnline, setIsOnline]             = useState(true);
  const [myTables, setMyTables]             = useState<string[]>([]);
  const [tableInput, setTableInput]         = useState('');
  const [showTableSetup, setShowTableSetup] = useState(false);
  const [pendingResolves, setPendingResolves] = useState<Set<string>>(new Set());

  // ── GAP 4: Active event + menu items ──────────────────────────────────────
  const [activeEvent, setActiveEvent]   = useState<any>(null);
  const [eventGuests, setEventGuests]   = useState<any[]>([]);
  const [eventMenuItems, setEventMenuItems] = useState<any[]>([]);

  // ── Online / offline ───────────────────────────────────────────────────────
  useEffect(() => {
    const onOnline  = () => { setIsOnline(true);  toast({ title: 'Back online' }); };
    const onOffline = () => { setIsOnline(false); toast({ variant: 'destructive', title: 'Offline — requests will sync when reconnected' }); };
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [toast]);

  // ── Data ───────────────────────────────────────────────────────────────────
  const floorQ = useMemoFirebase(() => query(
    collection(firestore, `tenants/${tenantId}/floorRequests`),
    where('status', 'in', ['new', 'acknowledged', 'done'])
  ), [firestore, tenantId]);

  const tenantRef = useMemoFirebase(
    () => doc(firestore, `tenants/${tenantId}`),
    [firestore, tenantId]
  );

  const staffQ = useMemoFirebase(
    () => collection(firestore, `tenants/${tenantId}/staff`),
    [firestore, tenantId]
  );

  const { data: allRequests, isLoading } = useCollection<FloorRequest>(floorQ);
  const { data: tenant }                 = useDoc<any>(tenantRef);
  const { data: staffList }              = useCollection<StaffMember>(staffQ);

  // ── GAP 4: Listen for active event today ──────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const today = new Date().toISOString().slice(0, 10);
    const unsub = onSnapshot(
      query(
        collection(firestore, `tenants/${tenantId}/studioEvents`),
        where('date', '==', today),
        where('status', '==', 'active')
      ),
      snap => {
        if (!snap.empty) {
          setActiveEvent({ id: snap.docs[0].id, ...snap.docs[0].data() });
        } else {
          setActiveEvent(null);
          setEventGuests([]);
          setEventMenuItems([]);
        }
      }
    );
    return unsub;
  }, [firestore, tenantId]);

  // When we have an active event, load its guests and menu items
  useEffect(() => {
    if (!firestore || !tenantId || !activeEvent?.id) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/eventGuests`), where('eventId', '==', activeEvent.id)),
      snap => setEventGuests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/eventMenuItems`), where('eventId', '==', activeEvent.id)),
      snap => setEventMenuItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));

    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, activeEvent?.id]);

  // ── GAP 4: Derive assigned tables for this staff member ───────────────────
  // The manifest assigns staffIds to the event — use that to auto-filter tables
  const assignedTables = useMemo(() => {
    if (!currentStaff || !activeEvent) return [];
    // assignedStaffIds on the event — if this staff member is assigned, show all tables
    // In a future improvement you could assign specific tables per staff, but for now
    // we show all tables when the staff member is on the event's assigned list
    const isAssigned = (activeEvent.assignedStaffIds || []).includes(currentStaff.id);
    if (!isAssigned) return [];
    // Return all unique table numbers from checked-in guests
    const tables = Array.from(new Set(
      eventGuests.filter(g => g.tableNumber).map(g => g.tableNumber as string)
    )).sort();
    return tables;
  }, [currentStaff, activeEvent, eventGuests]);

  // Auto-set my tables from assigned tables when staff logs in and event is active
  useEffect(() => {
    if (assignedTables.length > 0 && myTables.length === 0) {
      setMyTables(assignedTables);
    }
  }, [assignedTables]);

  // Counts for event context panel
  const checkedInCount = useMemo(() => eventGuests.filter(g => g.checkedIn).length, [eventGuests]);
  const totalCount     = eventGuests.length;

  // ── Requests ──────────────────────────────────────────────────────────────
  const { newRequests, doneRequests } = useMemo(() => ({
    newRequests: (allRequests || [])
      .filter(r => r.status === 'new' || r.status === 'acknowledged')
      .sort((a, b) => {
        const aType = getType(a);
        const bType = getType(b);
        if (aType === 'accessibility' && bType !== 'accessibility') return -1;
        if (bType === 'accessibility' && aType !== 'accessibility') return 1;
        return safeDate(a.createdAt).getTime() - safeDate(b.createdAt).getTime();
      }),
    doneRequests: (allRequests || [])
      .filter(r => r.status === 'done')
      .sort((a, b) =>
        safeDate(b.resolvedAt || b.createdAt).getTime() -
        safeDate(a.resolvedAt || a.createdAt).getTime()
      )
      .slice(0, 20),
  }), [allRequests]);

  const myNewRequests = useMemo(() => {
    if (myTables.length === 0) return newRequests;
    return newRequests.filter(r => !r.tableNumber || myTables.includes(r.tableNumber));
  }, [newRequests, myTables]);

  const otherRequests = useMemo(() => {
    if (myTables.length === 0) return [];
    return newRequests.filter(r => r.tableNumber && !myTables.includes(r.tableNumber));
  }, [newRequests, myTables]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleResolve = useCallback(async (requestId: string) => {
    setPendingResolves(prev => new Set([...prev, requestId]));
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, requestId), {
        status: 'done',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentStaff?.name || 'floor_staff',
      });
    } catch {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(requestId); return next; });
      toast({ variant: 'destructive', title: isOnline ? 'Error resolving request' : 'Offline — will retry when reconnected' });
    } finally {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(requestId); return next; });
    }
  }, [firestore, tenantId, isOnline, currentStaff, toast]);

  const handleAcknowledge = useCallback(async (requestId: string) => {
    setPendingResolves(prev => new Set([...prev, requestId]));
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, requestId), {
        status: 'acknowledged',
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: currentStaff?.name || 'floor_staff',
      });
      toast({ title: 'On my way ✓', description: 'Guest has been notified.' });
    } catch {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(requestId); return next; });
      toast({ variant: 'destructive', title: 'Error acknowledging request' });
    } finally {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(requestId); return next; });
    }
  }, [firestore, tenantId, currentStaff, toast]);

  const handleSetTables = () => {
    const tables = tableInput.split(',').map(t => t.trim()).filter(Boolean);
    setMyTables(tables);
    setShowTableSetup(false);
    toast({ title: `Watching ${tables.length} table${tables.length !== 1 ? 's' : ''}`, description: tables.join(', ') });
  };

  // ── GAP 5: Show PIN login if no staff session ──────────────────────────────
  if (!currentStaff) {
    return (
      <PinLogin
        staff={staffList || []}
        tenantName={tenant?.name || 'Studio'}
        onLogin={handleLogin}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="bg-amber-500 text-slate-900 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 max-w-md mx-auto">
              <WifiOff className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                Offline — requests queued, will sync when reconnected
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
              <Bell className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                {tenant?.name || 'Studio'}
              </p>
              <h1 className="text-sm font-black uppercase tracking-tight leading-none">Floor Requests</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* GAP 5: Logged-in staff chip */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700">
              <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center font-black text-primary text-[10px] shrink-0">
                {getInitials(currentStaff.name)}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                {currentStaff.name.split(' ')[0]}
              </span>
              <button onClick={handleLogout} className="text-slate-500 hover:text-red-400 transition-colors ml-1" title="Log out">
                <LogOut className="w-3 h-3" />
              </button>
            </div>

            {myTables.length > 0 && (
              <span className="text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-lg">
                T{myTables.join(', T')}
              </span>
            )}
            <button onClick={() => setShowTableSetup(s => !s)}
              className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-800 text-slate-400 hover:text-slate-200 transition-all">
              <UserCheck className="w-3.5 h-3.5 inline mr-1" />Tables
            </button>
            {newRequests.length > 0 && (
              <div className="w-7 h-7 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-[11px] font-black text-white">{newRequests.length}</span>
              </div>
            )}
            <button onClick={() => setShowDone(s => !s)}
              className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                showDone ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200')}>
              {showDone ? 'Hide Done' : 'Done'}
            </button>
          </div>
        </div>

        {/* Table setup */}
        <AnimatePresence>
          {showTableSetup && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="max-w-md mx-auto overflow-hidden">
              <div className="pt-3 flex items-center gap-2">
                <input value={tableInput} onChange={e => setTableInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSetTables()}
                  placeholder="My tables: 1, 2, 3 (comma separated)"
                  className="flex-1 h-10 rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:border-primary" />
                <button onClick={handleSetTables}
                  className="h-10 px-4 rounded-xl bg-primary font-black uppercase text-[10px] tracking-widest text-white shrink-0">
                  Set
                </button>
                {myTables.length > 0 && (
                  <button onClick={() => { setMyTables([]); setTableInput(''); setShowTableSetup(false); }}
                    className="h-10 px-3 rounded-xl bg-slate-800 font-black uppercase text-[10px] tracking-widest text-slate-400">
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-1.5">
                Only your tables will be highlighted. Other tables are dimmed.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">

        {/* GAP 4: Event context panel */}
        {activeEvent && (
          <EventContextPanel
            event={activeEvent}
            myTables={myTables}
            assignedTables={assignedTables}
            menuItems={eventMenuItems}
            checkedInCount={checkedInCount}
            totalCount={totalCount}
          />
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-slate-600" />
          </div>
        )}

        {!isLoading && (
          <>
            {myNewRequests.length === 0 && otherRequests.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <CheckCircle2 className="w-12 h-12 text-slate-700 mx-auto" />
                <p className="text-slate-500 font-black uppercase text-sm tracking-widest">All clear</p>
                <p className="text-slate-600 text-sm">No pending floor requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myTables.length > 0 && myNewRequests.length > 0 && (
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-primary">
                    Your Tables · {myNewRequests.length} request{myNewRequests.length !== 1 ? 's' : ''}
                  </p>
                )}
                {myTables.length === 0 && newRequests.length > 0 && (
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                    Pending · {newRequests.length} request{newRequests.length !== 1 ? 's' : ''}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {myNewRequests.map(r => (
                    <RequestCard key={r.id} request={r}
                      onResolve={handleResolve} onAcknowledge={handleAcknowledge}
                      myTables={myTables} isPending={pendingResolves.has(r.id)} />
                  ))}
                </AnimatePresence>

                {otherRequests.length > 0 && (
                  <>
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600 mt-4">
                      Other Tables · {otherRequests.length}
                    </p>
                    <AnimatePresence initial={false}>
                      {otherRequests.map(r => (
                        <RequestCard key={r.id} request={r}
                          onResolve={handleResolve} onAcknowledge={handleAcknowledge}
                          myTables={[]} isPending={pendingResolves.has(r.id)} />
                      ))}
                    </AnimatePresence>
                  </>
                )}
              </div>
            )}

            <AnimatePresence>
              {showDone && doneRequests.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 overflow-hidden">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">
                    Resolved · {doneRequests.length}
                  </p>
                  {doneRequests.map(r => (
                    <RequestCard key={r.id} request={r}
                      onResolve={handleResolve} onAcknowledge={handleAcknowledge}
                      myTables={[]} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}