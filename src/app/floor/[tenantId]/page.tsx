'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import {
  doc, collection, query, where, updateDoc, onSnapshot,
  serverTimestamp, getDoc, setDoc,
} from 'firebase/firestore';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Bell, CheckCircle2, AlertTriangle, Loader, WifiOff, LogOut,
  ChefHat, Megaphone, X, Delete, LayoutGrid, List, Users,
  Clock, BarChart3, TrendingUp, Zap, MapPin, RefreshCw, Flag,
  ArrowUp, UserCircle, Shield, Filter,
} from 'lucide-react';

const safeDate = (v: any): Date =>
  v?.toDate?.() ?? (typeof v === 'string' ? parseISO(v) : new Date(v ?? Date.now()));

const getInitials = (name?: string | null) => {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
};

const elapsed = (createdAt: string) => Math.floor((Date.now() - safeDate(createdAt).getTime()) / 1000);
const elapsedMins = (createdAt: string) => Math.floor(elapsed(createdAt) / 60);

// ─── TYPES ────────────────────────────────────────────────────────────────────
type FloorRequest = {
  id: string; tenantId: string; eventId?: string;
  requestType?: string; type?: string; label: string; emoji?: string;
  status: 'new' | 'acknowledged' | 'done';
  tableId?: string; tableNumber?: string;
  seatId?: string; seatNumber?: string; seatLabel?: string;
  guestId?: string; guestName?: string; guestAllergies?: any[];
  message?: string; requestText?: string;
  createdAt: string; resolvedAt?: string; resolvedBy?: string;
  acknowledgedAt?: string; acknowledgedBy?: string;
  claimedBy?: string; claimedByName?: string; claimedAt?: string;
  needsBackup?: boolean; escalated?: boolean;
  waitSeconds?: number | null;
  source?: string; _pending?: boolean;
};

type StaffMember = { id: string; name: string; role?: string; pin?: string; avatarUrl?: string };

type SeatingTable = {
  id: string; name: string; x: number | null; y: number | null;
  color: string; seatCount: number; seats: { id: string; label: string }[];
  staffIds: string[];
};

type Tab = 'requests' | 'chart' | 'analytics';

const TABLE_COLORS: Record<string, string> = {
  slate: '#1e293b', rose: '#e11d48', violet: '#7c3aed',
  teal: '#0d9488', amber: '#f59e0b', emerald: '#059669',
};

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

// ─── ALERT SOUND ─────────────────────────────────────────────────────────────
const playAlertSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    // Two-tone chime: high then mid
    const freqs = [880, 660];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.4);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
};

// ─── ELAPSED TIMER ────────────────────────────────────────────────────────────
const ElapsedTimer = ({ createdAt, compact }: { createdAt: string; compact?: boolean }) => {
  const [mins, setMins] = useState(elapsedMins(createdAt));
  useEffect(() => {
    const i = setInterval(() => setMins(elapsedMins(createdAt)), 10_000);
    return () => clearInterval(i);
  }, [createdAt]);
  const color = mins >= 10 ? 'text-red-500' : mins >= 5 ? 'text-amber-500' : 'text-slate-400';
  if (compact) return <span className={cn('text-[9px] font-black', color)}>{mins < 1 ? 'Just now' : `${mins}m`}</span>;
  return (
    <span className={cn('text-[10px] font-black uppercase tracking-widest', color)}>
      {mins >= 5 && '⚠ '}{mins < 1 ? 'Just now' : `${mins}m ago`}
    </span>
  );
};

// ─── PIN LOGIN ────────────────────────────────────────────────────────────────
const PinLogin = ({ staff, tenantName, onLogin, isLoading }: {
  staff: StaffMember[]; tenantName: string; onLogin: (m: StaffMember) => void; isLoading?: boolean;
}) => {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [ok, setOk] = useState<StaffMember | null>(null);

  const press = (key: string) => {
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) {
      const found = staff.find(s => s.pin === next);
      if (found) { setOk(found); setTimeout(() => onLogin(found), 600); }
      else { setShake(true); setTimeout(() => { setShake(false); setPin(''); }, 600); }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <motion.div
        animate={shake ? { x: [0, -12, 12, -8, 8, 0] } : {}}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-8 w-full max-w-xs"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/20 flex items-center justify-center">
            <ChefHat className="w-7 h-7 text-violet-400" />
          </div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">{tenantName}</p>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-white">Floor Staff</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Enter PIN to continue</p>
        </div>

        {/* PIN dots */}
        <div className="flex gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={cn('w-4 h-4 rounded-full border-2 transition-all',
              pin.length > i
                ? shake ? 'bg-red-500 border-red-500' : 'bg-violet-500 border-violet-500'
                : 'bg-transparent border-slate-700')} />
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {PIN_KEYS.map((key, i) => (
            <button
              key={i}
              onClick={() => key && press(key)}
              disabled={!key}
              className={cn('h-16 rounded-2xl font-black text-2xl transition-all active:scale-95 select-none',
                key === '⌫' ? 'text-slate-500 hover:text-slate-300' :
                  key ? 'bg-slate-800 text-white hover:bg-slate-700 shadow-lg shadow-black/30' :
                    'opacity-0 pointer-events-none')}
            >
              {key === '⌫' ? <Delete className="w-5 h-5 mx-auto" /> : key}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {ok && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-emerald-400">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center font-black text-sm">{getInitials(ok.name)}</div>
              <p className="text-[11px] font-black uppercase tracking-widest">Welcome, {ok.name.split(' ')[0]} ✓</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* No-PIN staff list */}
        <div className="w-full space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 text-center">No PIN? Select your name</p>
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader className="w-5 h-5 animate-spin text-slate-600" />
            </div>
          ) : staff.filter(s => !s.pin).length > 0 ? (
            staff.filter(s => !s.pin).map(s => (
              <button
                key={s.id}
                onClick={() => onLogin(s)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-800 hover:bg-slate-700 transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center font-black text-violet-400 text-sm shrink-0">
                  {getInitials(s.name)}
                </div>
                <div className="text-left flex-1">
                  <p className="font-black text-sm text-white">{s.name}</p>
                  {s.role && <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{s.role}</p>}
                </div>
              </button>
            ))
          ) : (
            <p className="text-center text-[9px] text-slate-700 font-bold uppercase tracking-widest py-2">
              All staff members have PINs configured
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

// ─── BROADCAST BANNER ─────────────────────────────────────────────────────────
const BroadcastBanner = ({ message, sentAt, onDismiss }: {
  message: string; sentAt?: string; onDismiss: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0, y: -12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    className="bg-violet-900 border border-violet-600 rounded-2xl overflow-hidden shadow-lg"
  >
    <div className="p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-violet-700 flex items-center justify-center shrink-0">
        <Megaphone className="w-4 h-4 text-violet-200" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-violet-400 mb-1">Host Message</p>
        <p className="font-black text-white text-sm leading-snug">{message}</p>
        {sentAt && (
          <p className="text-[9px] font-bold text-violet-400 uppercase tracking-widest mt-1.5">
            {Math.floor((Date.now() - safeDate(sentAt).getTime()) / 60000) < 1
              ? 'Just now'
              : `${Math.floor((Date.now() - safeDate(sentAt).getTime()) / 60000)}m ago`}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 w-7 h-7 rounded-lg bg-violet-700 hover:bg-violet-600 flex items-center justify-center"
      >
        <X className="w-3.5 h-3.5 text-violet-200" />
      </button>
    </div>
  </motion.div>
);

// ─── ALLERGY ALERT BANNER ────────────────────────────────────────────────────
const AllergyAlert = ({ requests }: { requests: FloorRequest[] }) => {
  const alerts = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; guestName: string; location: string; allergies: any[] }[] = [];
    requests.forEach(r => {
      if (r.status === 'done') return;
      const critical = (r.guestAllergies || []).filter(
        (a: any) => typeof a === 'object' && a.severity === 'critical'
      );
      if (!critical.length) return;
      const key = `${r.guestId || r.guestName}-${r.tableNumber || r.tableId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        guestName: r.guestName || 'Guest',
        location: [r.tableNumber || r.tableId, r.seatLabel ? `Seat ${r.seatLabel}` : null]
          .filter(Boolean).join(' · ') || '?',
        allergies: critical,
      });
    });
    return out;
  }, [requests]);

  if (!alerts.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-red-950/70 border-2 border-red-500/60 rounded-2xl p-4 space-y-2.5 shadow-lg shadow-red-900/20"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-red-400">
          Critical Allergies — Active Floor
        </p>
      </div>
      <div className="space-y-1.5">
        {alerts.map(alert => (
          <div key={alert.key} className="flex items-start gap-2 flex-wrap">
            <span className="text-[10px] font-black text-red-200">{alert.guestName}</span>
            <span className="text-[9px] text-red-500">·</span>
            <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest">{alert.location}</span>
            <div className="flex flex-wrap gap-1">
              {alert.allergies.map((a: any) => (
                <span
                  key={a.id || a.label}
                  className="px-1.5 py-0.5 rounded-full bg-red-500/30 border border-red-500/50 text-[8px] font-black uppercase text-red-200"
                >
                  ⚠ {a.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// ─── REQUEST CARD ─────────────────────────────────────────────────────────────
const RequestCard = ({
  request, currentStaff, myTableIds, onResolve, onAcknowledge, onClaim, onFlag, isPending,
}: {
  request: FloorRequest; currentStaff: StaffMember | null; myTableIds: string[];
  onResolve: (id: string) => Promise<void>;
  onAcknowledge: (id: string) => Promise<void>;
  onClaim: (id: string) => Promise<void>;
  onFlag: (id: string, flag: 'needsBackup' | 'escalated', val: boolean) => Promise<void>;
  isPending?: boolean;
}) => {
  const [acting, setAct] = useState<string | null>(null);
  const isNew = request.status === 'new';
  const isAck = request.status === 'acknowledged';
  const isDone = request.status === 'done';
  const mins = elapsedMins(request.createdAt);
  const isLate = !isDone && mins >= 5;
  const isMyTable = myTableIds.length === 0
    || (!!request.tableNumber && myTableIds.includes(request.tableNumber))
    || (!!request.tableId && myTableIds.includes(request.tableId));
  // Safe null check: claimedBySomeone only true if claimed AND not by current staff
  const claimedByMe = !!currentStaff && request.claimedBy === currentStaff.id;
  const claimedBySomeone = !!request.claimedBy && !claimedByMe;
  const hasCritical = (request.guestAllergies || []).some(
    (a: any) => typeof a === 'object' && a.severity === 'critical'
  );

  const act = async (key: string, fn: () => Promise<void>) => {
    setAct(key); await fn(); setAct(null);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: isPending ? 0.7 : isMyTable ? 1 : 0.4, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className={cn('rounded-2xl border-2 overflow-hidden',
        isDone ? 'border-slate-100 bg-slate-50/60 opacity-60' :
          request.escalated ? 'border-red-400 bg-red-950/60 shadow-lg shadow-red-900/30' :
            hasCritical ? 'border-red-400 bg-red-950/40 shadow-lg' :
              isLate ? 'border-amber-500/50 bg-amber-950/20 shadow-md' :
                isAck ? 'border-violet-500/40 bg-violet-950/20 shadow-sm' :
                  'border-slate-700/50 bg-slate-900 shadow-md shadow-black/30'
      )}
    >
      <div className="p-4 flex items-start gap-3">
        {/* Emoji */}
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0',
          isDone ? 'bg-slate-800' : isLate ? 'bg-amber-500/20' : isAck ? 'bg-violet-500/20' : 'bg-slate-800')}>
          {request.emoji || '💬'}
        </div>

        <div className="flex-1 min-w-0">
          {/* Label + badges */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <p className={cn('font-black text-sm uppercase tracking-tight', isDone ? 'text-slate-500' : 'text-white')}>
              {request.label}
            </p>
            {isPending && (
              <span className="px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400 text-[8px] font-black uppercase">
                Syncing
              </span>
            )}
            {isAck && !isDone && (
              <span className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[8px] font-black uppercase">
                🏃 {request.claimedByName || request.acknowledgedBy}
              </span>
            )}
            {request.needsBackup && !isDone && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[8px] font-black uppercase">
                🙋 Backup
              </span>
            )}
            {request.escalated && !isDone && (
              <span className="px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[8px] font-black uppercase">
                ⬆ Escalated
              </span>
            )}
          </div>

          {/* Location */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {request.tableNumber && (
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                <MapPin className="w-2.5 h-2.5 inline mr-0.5" />
                {request.tableNumber}
              </span>
            )}
            {request.seatNumber && (
              <span className="text-[10px] font-bold text-slate-500">
                · Seat {request.seatLabel || request.seatNumber}
              </span>
            )}
            {request.guestName && (
              <span className="text-[10px] font-bold text-slate-400">· {request.guestName}</span>
            )}
          </div>

          {/* Critical allergies inline */}
          {hasCritical && (
            <div className="flex flex-wrap gap-1 my-1">
              {(request.guestAllergies || [])
                .filter((a: any) => a.severity === 'critical')
                .map((a: any) => (
                  <span
                    key={a.id}
                    className="px-1.5 py-0.5 rounded-full bg-red-500/30 border border-red-500/50 text-[8px] font-black uppercase text-red-300"
                  >
                    ⚠ {a.label}
                  </span>
                ))}
            </div>
          )}

          {/* Message */}
          {(request.message || request.requestText) && (
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed line-clamp-2">
              "{request.message || request.requestText}"
            </p>
          )}

          {/* Timer + flag buttons */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {!isDone && <ElapsedTimer createdAt={request.createdAt} />}
            {isDone && request.resolvedBy && (
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                ✓ {request.resolvedBy}
              </span>
            )}
            {!isDone && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  onClick={() => act('backup', () => onFlag(request.id, 'needsBackup', !request.needsBackup))}
                  disabled={!!acting}
                  title="Needs backup"
                  className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all',
                    request.needsBackup ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-500 hover:text-amber-400')}
                >
                  🙋
                </button>
                <button
                  onClick={() => act('escalate', () => onFlag(request.id, 'escalated', !request.escalated))}
                  disabled={!!acting}
                  title="Escalate to host"
                  className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all',
                    request.escalated ? 'bg-red-500/30 text-red-300' : 'bg-slate-800 text-slate-500 hover:text-red-400')}
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {!isDone && (
          <div className="flex flex-col gap-1.5 shrink-0">
            {isNew && !claimedBySomeone && (
              <div className="flex flex-col items-center gap-0.5">
                <button
                  onClick={() => act('ack', () => onAcknowledge(request.id))}
                  disabled={!!acting || !!isPending}
                  className={cn('w-11 h-10 rounded-xl flex items-center justify-center transition-all text-lg active:scale-95',
                    acting === 'ack' || isPending
                      ? 'bg-slate-800'
                      : 'bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-900/40')}
                >
                  {acting === 'ack'
                    ? <Loader className="w-4 h-4 animate-spin text-slate-400" />
                    : '🏃'}
                </button>
                <span className="text-[7px] font-black uppercase tracking-widest text-slate-500">On Way</span>
              </div>
            )}
            {claimedBySomeone && (
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-11 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <span className="text-[9px] font-black text-violet-400">{getInitials(request.claimedByName)}</span>
                </div>
                <span className="text-[7px] font-black uppercase tracking-widest text-violet-500">Claimed</span>
              </div>
            )}
            <div className="flex flex-col items-center gap-0.5">
              <button
                onClick={() => act('resolve', () => onResolve(request.id))}
                disabled={!!acting || !!isPending}
                className={cn('w-11 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95',
                  acting === 'resolve' || isPending ? 'bg-slate-800' :
                    isLate ? 'bg-amber-500 hover:bg-amber-400 shadow-lg shadow-amber-900/40' :
                      'bg-emerald-500 hover:bg-emerald-400 shadow-lg shadow-emerald-900/40')}
              >
                {acting === 'resolve'
                  ? <Loader className="w-4 h-4 animate-spin text-slate-400" />
                  : <CheckCircle2 className="w-5 h-5 text-white" />}
              </button>
              <span className="text-[7px] font-black uppercase tracking-widest text-slate-500">Done</span>
            </div>
          </div>
        )}
        {isDone && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />}
      </div>
    </motion.div>
  );
};

// ─── VISUAL SEATING CHART ─────────────────────────────────────────────────────
const VisualChart = ({
  tables, requests, guests, myTableIds, onSelectTable,
}: {
  tables: SeatingTable[]; requests: FloorRequest[]; guests: any[];
  myTableIds: string[]; onSelectTable: (id: string) => void;
}) => {
  const unpositioned = tables.filter(t => t.x == null || t.y == null);
  const positioned = tables.filter(t => t.x != null && t.y != null);

  const getTableRequests = (tableId: string) =>
    requests.filter(r => (r.tableId === tableId || r.tableNumber === tableId) && r.status !== 'done');

  const getGuestAtSeat = (tableId: string, seatId: string) =>
    guests.find(g => g.tableNumber === tableId && g.seatNumber === seatId);

  const renderTable = (table: SeatingTable, style?: React.CSSProperties) => {
    const color = TABLE_COLORS[table.color] || '#1e293b';
    const reqs = getTableRequests(table.id);
    const isMyT = myTableIds.length === 0 || myTableIds.includes(table.id);
    const hasLate = reqs.some(r => elapsedMins(r.createdAt) >= 5);
    const hasNew = reqs.some(r => r.status === 'new');

    return (
      <button
        key={table.id}
        onClick={() => onSelectTable(table.id)}
        style={style}
        className={cn('absolute transition-all active:scale-95', !isMyT && 'opacity-30')}
      >
        <div
          className={cn('rounded-xl border-2 p-2 text-center transition-all',
            isMyT ? 'ring-2 ring-violet-500/40' : '',
            hasLate ? 'ring-2 ring-amber-500 border-amber-500/50' :
              hasNew ? 'ring-1 ring-white/20' : '')}
          style={{ background: color, borderColor: `${color}80`, minWidth: 80 }}
        >
          <p className="text-[8px] font-black uppercase tracking-widest text-white/70 leading-none">Table</p>
          <p className="font-black text-white text-sm leading-tight">{table.name}</p>
          {reqs.length > 0 && (
            <div className={cn('mt-1 px-1.5 py-0.5 rounded-full text-[8px] font-black',
              hasLate ? 'bg-amber-500 text-white' : 'bg-white/20 text-white')}>
              {reqs.length} req
            </div>
          )}
          {/* Seat dots */}
          <div className="flex flex-wrap gap-0.5 justify-center mt-1.5">
            {table.seats.slice(0, 8).map(seat => {
              const g = getGuestAtSeat(table.id, seat.id);
              const seatReq = requests.find(
                r => (r.seatId === seat.id || r.seatNumber === seat.id) && r.status !== 'done'
              );
              return (
                <div
                  key={seat.id}
                  title={g?.name || `Seat ${seat.label}`}
                  className={cn('w-3 h-3 rounded-full border border-white/30',
                    seatReq ? elapsedMins(seatReq.createdAt) >= 5 ? 'bg-amber-400' : 'bg-yellow-300' :
                      g ? 'bg-white/80' : 'bg-white/20')}
                />
              );
            })}
            {table.seats.length > 8 && (
              <span className="text-[7px] text-white/50">+{table.seats.length - 8}</span>
            )}
          </div>
          {/* My-table indicator dot */}
          {isMyT && myTableIds.length > 0 && (
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-violet-500 border-2 border-slate-950" />
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {positioned.length > 0 && (
        <div
          className="relative w-full bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden"
          style={{ aspectRatio: '16/9' }}
        >
          {/* Grid overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
              backgroundSize: '10% 10%',
            }}
          />
          <div className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-slate-800/80 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[7px] font-black uppercase tracking-[0.3em] text-slate-400">Live Floor Plan</p>
          </div>
          {/* Legend */}
          <div className="absolute bottom-2 right-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="text-[7px] font-bold text-slate-500 uppercase">Late</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
              <span className="text-[7px] font-bold text-slate-500 uppercase">Seated</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
              <span className="text-[7px] font-bold text-slate-500 uppercase">Mine</span>
            </div>
          </div>
          {positioned.map(table => renderTable(table, {
            left: `${table.x}%`,
            top: `${table.y}%`,
            transform: 'translate(-50%, -50%)',
          }))}
        </div>
      )}

      {unpositioned.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {unpositioned.map(table => {
            const color = TABLE_COLORS[table.color] || '#1e293b';
            const reqs = getTableRequests(table.id);
            const isMyT = myTableIds.length === 0 || myTableIds.includes(table.id);
            const hasLate = reqs.some(r => elapsedMins(r.createdAt) >= 5);
            return (
              <button
                key={table.id}
                onClick={() => onSelectTable(table.id)}
                className={cn('rounded-xl p-3 text-left border-2 transition-all relative', !isMyT && 'opacity-30',
                  isMyT && myTableIds.length > 0 ? 'border-violet-500/50' : 'border-white/10',
                  hasLate ? 'border-amber-500/50' : '')}
                style={{ background: color }}
              >
                {isMyT && myTableIds.length > 0 && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-violet-500 border-2 border-slate-950" />
                )}
                <p className="text-[8px] font-black uppercase tracking-widest text-white/60">Table</p>
                <p className="font-black text-white">{table.name}</p>
                {reqs.length > 0 && (
                  <p className={cn('text-[9px] font-black mt-1', hasLate ? 'text-amber-300' : 'text-white/70')}>
                    {reqs.length} request{reqs.length !== 1 ? 's' : ''}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {tables.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <LayoutGrid className="w-8 h-8 text-slate-700 mx-auto" />
          <p className="text-slate-600 font-black uppercase text-xs tracking-widest">No seating chart defined</p>
          <p className="text-slate-700 text-xs">Set up tables on the manifest to see the room layout here</p>
        </div>
      )}
    </div>
  );
};

// ─── ANALYTICS PANEL ──────────────────────────────────────────────────────────
const AnalyticsPanel = ({ requests, staff }: { requests: FloorRequest[]; staff: StaffMember[] }) => {
  const allDone = requests.filter(r => r.status === 'done');
  const allActive = requests.filter(r => r.status !== 'done');

  const avgWait = useMemo(() => {
    const withTime = allDone.filter(r => typeof r.waitSeconds === 'number' && r.waitSeconds! >= 0);
    if (!withTime.length) return null;
    return Math.round(withTime.reduce((s, r) => s + (r.waitSeconds || 0), 0) / withTime.length / 60 * 10) / 10;
  }, [allDone]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    requests.forEach(r => { const t = r.requestType || r.type || 'other'; map[t] = (map[t] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [requests]);

  const byStaff = useMemo(() => {
    return staff.map(s => {
      const handled = allDone.filter(r => r.resolvedBy === s.name);
      const withTime = handled.filter(r => typeof r.waitSeconds === 'number');
      const avgSecs = withTime.length
        ? withTime.reduce((a, r) => a + (r.waitSeconds || 0), 0) / withTime.length
        : null;
      return { ...s, handled: handled.length, avgMins: avgSecs ? Math.round(avgSecs / 60 * 10) / 10 : null };
    }).sort((a, b) => b.handled - a.handled);
  }, [allDone, staff]);

  const byTable = useMemo(() => {
    const map: Record<string, number> = {};
    requests.forEach(r => { const t = r.tableNumber || r.tableId; if (t) map[t] = (map[t] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [requests]);

  const Stat = ({ label, value, sub, color }: {
    label: string; value: string; sub?: string; color?: string;
  }) => (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4">
      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500 mb-1">{label}</p>
      <p className={cn('text-2xl font-black leading-none', color || 'text-white')}>{value}</p>
      {sub && <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-5 pb-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Active" value={String(allActive.length)} sub="pending requests" color="text-amber-400" />
        <Stat label="Resolved" value={String(allDone.length)} sub="this session" color="text-emerald-400" />
        {avgWait !== null && (
          <Stat
            label="Avg Wait"
            value={`${avgWait}m`}
            sub="response time"
            color={avgWait > 5 ? 'text-red-400' : avgWait > 3 ? 'text-amber-400' : 'text-emerald-400'}
          />
        )}
        <Stat label="Total" value={String(requests.length)} sub="all requests" />
      </div>

      {byType.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-2xl p-4 space-y-3">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Top Request Types</p>
          {byType.map(([type, count]) => {
            const max = byType[0][1];
            return (
              <div key={type} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">{type}</span>
                  <span className="text-[10px] font-black text-slate-400">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {byStaff.filter(s => s.handled > 0).length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-2xl p-4 space-y-3">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Staff Performance</p>
          {byStaff.filter(s => s.handled > 0).map(s => (
            <div key={s.id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center font-black text-violet-400 text-[10px] shrink-0">
                {getInitials(s.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-tight text-white truncate">{s.name}</p>
                <p className="text-[9px] font-bold text-slate-500">
                  {s.handled} handled{s.avgMins ? ` · avg ${s.avgMins}m` : ''}
                </p>
              </div>
              <div className="shrink-0">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-[9px] font-black text-emerald-400">{s.handled}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {byTable.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-2xl p-4 space-y-3">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">Busiest Tables</p>
          {byTable.map(([table, count]) => (
            <div key={table} className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{table}</span>
              <span className="text-[10px] font-black text-slate-400">{count} req</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function FloorStaffPage() {
  const params = useParams();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const tenantId = params.tenantId as string;

  // ── Session ───────────────────────────────────────────────────────────────
  const [currentStaff, setCurrentStaff] = useState<StaffMember | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return JSON.parse(sessionStorage.getItem(`opal_floor_staff_${tenantId}`) || 'null'); }
    catch { return null; }
  });
  const handleLogin = (m: StaffMember) => {
    sessionStorage.setItem(`opal_floor_staff_${tenantId}`, JSON.stringify(m));
    setCurrentStaff(m);
  };
  const handleLogout = () => {
    sessionStorage.removeItem(`opal_floor_staff_${tenantId}`);
    setCurrentStaff(null);
  };

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('requests');
  const [viewMode, setViewMode] = useState<'list' | 'visual'>('list');
  const [showDone, setShowDone] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [myTableIds, setMyTableIds] = useState<string[]>([]);
  const [pendingResolves, setPendingResolves] = useState<Set<string>>(new Set());
  const [requestFilter, setRequestFilter] = useState<string | null>(null);
  const [chartFocusTable, setChartFocusTable] = useState<string | null>(null);

  // Broadcast dismissal — persisted in sessionStorage so it survives refreshes
  const [dismissedBroadcastAt, setDismissedBroadcastAt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(`opal_broadcast_dismissed_${tenantId}`) || null;
  });
  const handleDismissBroadcast = useCallback((at: string | null) => {
    setDismissedBroadcastAt(at);
    if (at) sessionStorage.setItem(`opal_broadcast_dismissed_${tenantId}`, at);
  }, [tenantId]);

  // ── Active event + seating ────────────────────────────────────────────────
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [seatingTables, setSeatingTables] = useState<SeatingTable[]>([]);
  const [eventGuests, setEventGuests] = useState<any[]>([]);

  // ── Online / offline ──────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => { setIsOnline(true); toast({ title: 'Back online' }); };
    const off = () => {
      setIsOnline(false);
      toast({ variant: 'destructive', title: 'Offline — requests will sync when reconnected' });
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [toast]);

  // ── Firestore queries ─────────────────────────────────────────────────────
  const floorQ = useMemoFirebase(
    () => query(collection(firestore, `tenants/${tenantId}/floorRequests`), where('status', 'in', ['new', 'acknowledged', 'done'])),
    [firestore, tenantId]
  );
  const tenantRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const staffQ = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);

  const { data: allRequests, isLoading } = useCollection<FloorRequest>(floorQ);
  const { data: tenant } = useDoc<any>(tenantRef);
  const { data: staffList, isLoading: staffLoading } = useCollection<StaffMember>(staffQ);

  // ── Active event listener ─────────────────────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/studioEvents`), where('status', '==', 'active')),
      snap => {
        if (!snap.empty) {
          setActiveEvent({ id: snap.docs[0].id, ...snap.docs[0].data() });
        } else {
          setActiveEvent(null);
          setSeatingTables([]);
          setEventGuests([]);
        }
      }
    );
    return unsub;
  }, [firestore, tenantId]);

  // ── Seating tables + guests ───────────────────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId || !activeEvent?.id) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      collection(firestore, `tenants/${tenantId}/studioEvents/${activeEvent.id}/seatingTables`),
      snap => setSeatingTables(snap.docs.map(d => ({ id: d.id, ...d.data() } as SeatingTable)))
    ));
    unsubs.push(onSnapshot(
      query(collection(firestore, `tenants/${tenantId}/eventGuests`), where('eventId', '==', activeEvent.id)),
      snap => setEventGuests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));

    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, activeEvent?.id]);

  // ── Auto-switch to visual mode when positioned tables load ───────────────
  useEffect(() => {
    if (seatingTables.some(t => t.x != null && t.y != null)) {
      setViewMode('visual');
    }
  }, [seatingTables.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table assignments: load from Firestore on event load ─────────────────
  useEffect(() => {
    if (!firestore || !tenantId || !currentStaff?.id || !activeEvent?.id) return;
    getDoc(
      doc(firestore, `tenants/${tenantId}/studioEvents/${activeEvent.id}/staffAssignments`, currentStaff.id)
    ).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.tableIds) && data.tableIds.length > 0) {
          setMyTableIds(data.tableIds);
          return;
        }
      }
      // Fallback: auto-populate from staffIds on the tables
      const myTables = seatingTables.filter(t => t.staffIds?.includes(currentStaff.id)).map(t => t.id);
      if (myTables.length > 0) setMyTableIds(myTables);
    }).catch(() => {
      // Best effort; fall back to staffIds
      const myTables = seatingTables.filter(t => t.staffIds?.includes(currentStaff.id)).map(t => t.id);
      if (myTables.length > 0) setMyTableIds(myTables);
    });
  }, [firestore, tenantId, currentStaff?.id, activeEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table assignment updater — persists to Firestore ─────────────────────
  const updateMyTableIds = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setMyTableIds(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (firestore && tenantId && currentStaff?.id && activeEvent?.id) {
          setDoc(
            doc(firestore, `tenants/${tenantId}/studioEvents/${activeEvent.id}/staffAssignments`, currentStaff.id),
            {
              tableIds: next,
              staffId: currentStaff.id,
              staffName: currentStaff.name,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ).catch(() => {}); // non-blocking, best effort
        }
        return next;
      });
    },
    [firestore, tenantId, currentStaff?.id, currentStaff?.name, activeEvent?.id]
  );

  // ── Sound + vibration on new requests ────────────────────────────────────
  const prevActiveCountRef = useRef(0);
  useEffect(() => {
    if (!currentStaff) return; // don't alert before login
    const newCount = (allRequests || []).filter(r => r.status === 'new' || r.status === 'acknowledged').length;
    if (newCount > prevActiveCountRef.current) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      playAlertSound();
    }
    prevActiveCountRef.current = newCount;
  }, [allRequests, currentStaff]);

  // ── Broadcast ────────────────────────────────────────────────────────────
  const broadcastMsg = activeEvent?.broadcastMessage && !activeEvent?.broadcastDismissed
    ? activeEvent.broadcastMessage
    : null;
  const broadcastAt = activeEvent?.broadcastSentAt || null;
  const showBroadcast = !!broadcastMsg && dismissedBroadcastAt !== broadcastAt;

  // ── Request processing ────────────────────────────────────────────────────
  const { activeRequests, doneRequests } = useMemo(() => ({
    activeRequests: (allRequests || [])
      .filter(r => r.status === 'new' || r.status === 'acknowledged')
      .sort((a, b) => {
        if (a.escalated && !b.escalated) return -1;
        if (b.escalated && !a.escalated) return 1;
        const aType = a.requestType || a.type || '';
        const bType = b.requestType || b.type || '';
        if (aType === 'accessibility' && bType !== 'accessibility') return -1;
        if (bType === 'accessibility' && aType !== 'accessibility') return 1;
        return safeDate(a.createdAt).getTime() - safeDate(b.createdAt).getTime();
      }),
    doneRequests: (allRequests || [])
      .filter(r => r.status === 'done')
      .sort((a, b) => safeDate(b.resolvedAt || b.createdAt).getTime() - safeDate(a.resolvedAt || a.createdAt).getTime())
      .slice(0, 30),
  }), [allRequests]);

  const myRequests = useMemo(() =>
    myTableIds.length === 0
      ? activeRequests
      : activeRequests.filter(r =>
          !r.tableNumber || myTableIds.includes(r.tableNumber) || myTableIds.includes(r.tableId || '')
        ),
    [activeRequests, myTableIds]
  );
  const otherRequests = useMemo(() =>
    myTableIds.length === 0
      ? []
      : activeRequests.filter(r =>
          r.tableNumber && !myTableIds.includes(r.tableNumber) && !myTableIds.includes(r.tableId || '')
        ),
    [activeRequests, myTableIds]
  );

  // Request type filter options derived from active requests
  const requestTypeOptions = useMemo(() => {
    const types = new Set<string>();
    activeRequests.forEach(r => { const t = r.requestType || r.type; if (t) types.add(t); });
    return Array.from(types);
  }, [activeRequests]);

  // Apply type filter to visible requests
  const filteredMyRequests = useMemo(() =>
    requestFilter ? myRequests.filter(r => (r.requestType || r.type) === requestFilter) : myRequests,
    [myRequests, requestFilter]
  );
  const filteredOtherRequests = useMemo(() =>
    requestFilter ? otherRequests.filter(r => (r.requestType || r.type) === requestFilter) : otherRequests,
    [otherRequests, requestFilter]
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleResolve = useCallback(async (id: string) => {
    setPendingResolves(prev => new Set([...prev, id]));
    try {
      const req = (allRequests || []).find(r => r.id === id);
      const waitSeconds = req ? Math.floor((Date.now() - safeDate(req.createdAt).getTime()) / 1000) : null;
      await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, id), {
        status: 'done',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentStaff?.name || 'floor_staff',
        waitSeconds,
      });
    } catch {
      toast({ variant: 'destructive', title: isOnline ? 'Error resolving request' : 'Offline — will retry when reconnected' });
    } finally {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [firestore, tenantId, isOnline, currentStaff, toast, allRequests]);

  const handleAcknowledge = useCallback(async (id: string) => {
    setPendingResolves(prev => new Set([...prev, id]));
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, id), {
        status: 'acknowledged',
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy: currentStaff?.name || 'floor_staff',
        claimedBy: currentStaff?.id || null,
        claimedByName: currentStaff?.name || null,
        claimedAt: new Date().toISOString(),
      });
      toast({ title: '🏃 On my way', description: 'Visible to all floor staff' });
    } catch {
      toast({ variant: 'destructive', title: 'Error acknowledging request' });
    } finally {
      setPendingResolves(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [firestore, tenantId, currentStaff, toast]);

  const handleClaim = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, id), {
        claimedBy: currentStaff?.id,
        claimedByName: currentStaff?.name,
        claimedAt: new Date().toISOString(),
      });
    } catch { toast({ variant: 'destructive', title: 'Error claiming request' }); }
  }, [firestore, tenantId, currentStaff, toast]);

  const handleFlag = useCallback(async (id: string, flag: 'needsBackup' | 'escalated', val: boolean) => {
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, id), { [flag]: val });
    } catch { toast({ variant: 'destructive', title: 'Error updating request' }); }
  }, [firestore, tenantId, toast]);

  // ── PIN login guard ────────────────────────────────────────────────────────
  if (!currentStaff) {
    return (
      <PinLogin
        staff={staffList || []}
        tenantName={tenant?.name || 'Studio'}
        onLogin={handleLogin}
        isLoading={staffLoading || (!staffList && !isLoading)}
      />
    );
  }

  const unreadCount = activeRequests.length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="bg-amber-500 text-slate-900 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest flex-1">Offline — requests queued</p>
              {pendingResolves.size > 0 && (
                <span className="text-[9px] font-black bg-slate-900/20 px-2 py-0.5 rounded-full">
                  {pendingResolves.size} pending
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-md mx-auto space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center">
                <Bell className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-500">{tenant?.name || 'Studio'}</p>
                <h1 className="text-sm font-black uppercase tracking-tight leading-none text-white">Floor</h1>
              </div>
              {unreadCount > 0 && (
                <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                  <span className="text-[9px] font-black text-white">{unreadCount}</span>
                </div>
              )}
              {/* Pending sync indicator (online) */}
              {isOnline && pendingResolves.size > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700">
                  <Loader className="w-3 h-3 text-violet-400 animate-spin" />
                  <span className="text-[8px] font-black text-slate-400">{pendingResolves.size}</span>
                </div>
              )}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1.5">
              {/* Staff chip */}
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-slate-800 border border-slate-700">
                <div className="w-5 h-5 rounded-md bg-violet-500/20 flex items-center justify-center font-black text-violet-400 text-[9px] shrink-0">
                  {getInitials(currentStaff.name)}
                </div>
                <span className="text-[9px] font-black uppercase text-slate-300 hidden sm:block">
                  {currentStaff.name.split(' ')[0]}
                </span>
                <button onClick={handleLogout} className="text-slate-600 hover:text-red-400 transition-colors" title="Log out">
                  <LogOut className="w-3 h-3" />
                </button>
              </div>

              {/* View toggle */}
              <div className="flex rounded-xl overflow-hidden border border-slate-700">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn('w-8 h-8 flex items-center justify-center transition-all',
                    viewMode === 'list' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300')}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('visual')}
                  className={cn('w-8 h-8 flex items-center justify-center transition-all',
                    viewMode === 'visual' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300')}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Show done toggle */}
              <button
                onClick={() => setShowDone(s => !s)}
                className={cn('h-8 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all',
                  showDone ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300')}
              >
                {showDone ? 'Hide ✓' : 'Done'}
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-slate-900 rounded-xl p-1">
            {([
              { id: 'requests', label: 'Requests', icon: Bell },
              { id: 'chart', label: 'Room', icon: LayoutGrid },
              { id: 'analytics', label: 'Stats', icon: BarChart3 },
            ] as { id: Tab; label: string; icon: any }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn('flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                  tab === t.id ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300')}
              >
                <t.icon className="w-3 h-3" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* My tables chips */}
          {myTableIds.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">Watching:</span>
              {myTableIds.map(id => {
                const t = seatingTables.find(st => st.id === id);
                return (
                  <button
                    key={id}
                    onClick={() => updateMyTableIds(prev => prev.filter(x => x !== id))}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-[8px] font-black uppercase tracking-widest text-violet-300 hover:bg-violet-500/30"
                  >
                    {t?.name || id} <X className="w-2.5 h-2.5" />
                  </button>
                );
              })}
              <button
                onClick={() => updateMyTableIds([])}
                className="text-[8px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-400"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-4 py-4 space-y-4">

        {/* Broadcast */}
        <AnimatePresence>
          {showBroadcast && (
            <BroadcastBanner
              message={broadcastMsg!}
              sentAt={broadcastAt}
              onDismiss={() => handleDismissBroadcast(broadcastAt)}
            />
          )}
        </AnimatePresence>

        {/* Active event info bar */}
        {activeEvent && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <p className="text-[9px] font-black uppercase tracking-widest text-violet-300 flex-1 truncate">
              {activeEvent.name || activeEvent.title || 'Live Event'}
            </p>
            {activeEvent.date && (
              <p className="text-[8px] font-bold text-violet-400/70">
                {format(new Date(activeEvent.date), 'MMM d')}
              </p>
            )}
            {/* Quick-jump to floor plan */}
            {seatingTables.length > 0 && (
              <button
                onClick={() => setTab('chart')}
                className="text-[8px] font-black uppercase tracking-widest text-violet-400 hover:text-violet-200 transition-colors px-2 py-0.5 rounded-lg hover:bg-violet-500/20"
              >
                {seatingTables.length} tables →
              </button>
            )}
          </div>
        )}

        {/* ── REQUESTS TAB ── */}
        {tab === 'requests' && (
          <>
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader className="w-8 h-8 animate-spin text-slate-700" />
              </div>
            )}

            {!isLoading && (
              <>
                {/* Critical allergy alert — always shown at top */}
                <AllergyAlert requests={allRequests || []} />

                {/* Request type filter strip */}
                {requestTypeOptions.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap items-center">
                    <Filter className="w-3 h-3 text-slate-600 shrink-0" />
                    <button
                      onClick={() => setRequestFilter(null)}
                      className={cn('px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                        !requestFilter ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300')}
                    >
                      All · {activeRequests.length}
                    </button>
                    {requestTypeOptions.map(type => (
                      <button
                        key={type}
                        onClick={() => setRequestFilter(requestFilter === type ? null : type)}
                        className={cn('px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                          requestFilter === type ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300')}
                      >
                        {type} · {activeRequests.filter(r => (r.requestType || r.type) === type).length}
                      </button>
                    ))}
                  </div>
                )}

                {viewMode === 'list' && (
                  <div className="space-y-3">
                    {filteredMyRequests.length === 0 && filteredOtherRequests.length === 0 && (
                      <div className="text-center py-16 space-y-3">
                        <CheckCircle2 className="w-12 h-12 text-slate-800 mx-auto" />
                        <p className="text-slate-600 font-black uppercase text-sm tracking-widest">
                          {requestFilter ? `No "${requestFilter}" requests` : 'All clear'}
                        </p>
                        <p className="text-slate-700 text-sm">
                          {requestFilter ? 'Try clearing the filter' : 'No pending floor requests'}
                        </p>
                      </div>
                    )}

                    {myTableIds.length > 0 && filteredMyRequests.length > 0 && (
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-violet-400">
                        Your Tables · {filteredMyRequests.length}
                      </p>
                    )}
                    {myTableIds.length === 0 && activeRequests.length > 0 && (
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-500">
                        Pending · {filteredMyRequests.length}
                      </p>
                    )}

                    <AnimatePresence initial={false}>
                      {filteredMyRequests.map(r => (
                        <RequestCard
                          key={r.id} request={r} currentStaff={currentStaff}
                          myTableIds={myTableIds} onResolve={handleResolve}
                          onAcknowledge={handleAcknowledge} onClaim={handleClaim}
                          onFlag={handleFlag} isPending={pendingResolves.has(r.id)}
                        />
                      ))}
                    </AnimatePresence>

                    {filteredOtherRequests.length > 0 && (
                      <>
                        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600 mt-2">
                          Other Tables · {filteredOtherRequests.length}
                        </p>
                        <AnimatePresence initial={false}>
                          {filteredOtherRequests.map(r => (
                            <RequestCard
                              key={r.id} request={r} currentStaff={currentStaff}
                              myTableIds={[]} onResolve={handleResolve}
                              onAcknowledge={handleAcknowledge} onClaim={handleClaim}
                              onFlag={handleFlag} isPending={pendingResolves.has(r.id)}
                            />
                          ))}
                        </AnimatePresence>
                      </>
                    )}

                    <AnimatePresence>
                      {showDone && doneRequests.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-3 overflow-hidden"
                        >
                          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">
                            Resolved · {doneRequests.length}
                          </p>
                          {doneRequests.map(r => (
                            <RequestCard
                              key={r.id} request={r} currentStaff={currentStaff}
                              myTableIds={[]} onResolve={handleResolve}
                              onAcknowledge={handleAcknowledge} onClaim={handleClaim}
                              onFlag={handleFlag}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {viewMode === 'visual' && (
                  <div className="space-y-4">
                    <VisualChart
                      tables={seatingTables}
                      requests={allRequests || []}
                      guests={eventGuests}
                      myTableIds={myTableIds}
                      onSelectTable={id => {
                        setChartFocusTable(id === chartFocusTable ? null : id);
                        // Add to my tables if not already watching
                        updateMyTableIds(prev => prev.includes(id) ? prev : [...prev, id]);
                      }}
                    />
                    {/* Requests for focused table */}
                    {chartFocusTable && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                            {seatingTables.find(t => t.id === chartFocusTable)?.name || chartFocusTable} · Requests
                          </p>
                          <button
                            onClick={() => setChartFocusTable(null)}
                            className="text-[8px] font-black text-slate-600 hover:text-slate-400 uppercase tracking-widest"
                          >
                            Close ×
                          </button>
                        </div>
                        <AnimatePresence>
                          {activeRequests
                            .filter(r => r.tableId === chartFocusTable || r.tableNumber === chartFocusTable)
                            .map(r => (
                              <RequestCard
                                key={r.id} request={r} currentStaff={currentStaff}
                                myTableIds={[]} onResolve={handleResolve}
                                onAcknowledge={handleAcknowledge} onClaim={handleClaim}
                                onFlag={handleFlag} isPending={pendingResolves.has(r.id)}
                              />
                            ))}
                        </AnimatePresence>
                        {activeRequests.filter(
                          r => r.tableId === chartFocusTable || r.tableNumber === chartFocusTable
                        ).length === 0 && (
                          <p className="text-center py-6 text-[9px] font-black uppercase tracking-widest text-slate-700">
                            No active requests at this table
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── ROOM TAB ── */}
        {tab === 'chart' && (
          <div className="space-y-4">
            <VisualChart
              tables={seatingTables}
              requests={allRequests || []}
              guests={eventGuests}
              myTableIds={myTableIds}
              onSelectTable={id => {
                setChartFocusTable(id === chartFocusTable ? null : id);
                // Clicking a table in Room tab adds it to "watching"
                updateMyTableIds(prev => prev.includes(id) ? prev : [...prev, id]);
              }}
            />
            {/* Focused table requests */}
            {chartFocusTable && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
                    {seatingTables.find(t => t.id === chartFocusTable)?.name || chartFocusTable} · Active Requests
                  </p>
                  <button
                    onClick={() => setChartFocusTable(null)}
                    className="text-[8px] font-black text-slate-600 hover:text-slate-400 uppercase tracking-widest"
                  >
                    Close ×
                  </button>
                </div>
                <AnimatePresence>
                  {activeRequests
                    .filter(r => r.tableId === chartFocusTable || r.tableNumber === chartFocusTable)
                    .map(r => (
                      <RequestCard
                        key={r.id} request={r} currentStaff={currentStaff}
                        myTableIds={[]} onResolve={handleResolve}
                        onAcknowledge={handleAcknowledge} onClaim={handleClaim}
                        onFlag={handleFlag} isPending={pendingResolves.has(r.id)}
                      />
                    ))}
                </AnimatePresence>
                {activeRequests.filter(
                  r => r.tableId === chartFocusTable || r.tableNumber === chartFocusTable
                ).length === 0 && (
                  <p className="text-center py-6 text-[9px] font-black uppercase tracking-widest text-slate-700">
                    No active requests at this table
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS TAB ── */}
        {tab === 'analytics' && (
          <AnalyticsPanel requests={allRequests || []} staff={staffList || []} />
        )}

      </div>
    </div>
  );
}