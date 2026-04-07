'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback, createPortal } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  Calendar, Clock, Repeat, Zap, Bell, CheckCircle2, XCircle,
  LogOut, Delete, Shield, CalendarDays, ClipboardList,
  Coffee, ArrowRight, DollarSign, Plus, Timer,
  Scissors, Play, CheckCircle, ShieldCheck,
  Activity, ShoppingCart, LogIn,
  AlertCircle, ChevronRight, Trash2, Loader,
  ChevronLeft, ChevronDown, ChevronUp, RefreshCw,
  User, Lock, AlertTriangle,
} from 'lucide-react';
import {
  format, parseISO, startOfWeek, endOfWeek, addWeeks,
  eachDayOfInterval, isToday, isBefore, startOfDay,
  differenceInMinutes, isSameDay, addMinutes, addMonths,
  startOfMonth, endOfMonth,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, getDocs, writeBatch, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

// ─── TIMELINE CONSTANTS ───────────────────────────────────────────────────────
// Full 24h so the "now" line is always visible no matter the time
const HOUR_START  = 0;
const HOUR_END    = 24;
const TOTAL_MINS  = (HOUR_END - HOUR_START) * 60; // 1440
const PX_PER_MIN  = 2.4;
const TIMELINE_H  = TOTAL_MINS * PX_PER_MIN;       // 3456px
const MIN_BLOCK   = 96;  // minimum block height — always enough room for the button

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','del'];

const STATUS_SWAP: Record<string, { label: string; color: string }> = {
  pending:              { label: 'Pending Review',          color: 'bg-amber-100 text-amber-700'   },
  pending_swap_consent: { label: 'Awaiting Response',       color: 'bg-purple-100 text-purple-700' },
  swap_consent_given:   { label: 'Agreed — Needs Approval', color: 'bg-blue-100 text-blue-700'     },
  swap_consent_denied:  { label: 'They Declined',           color: 'bg-red-100 text-red-700'       },
  approved:             { label: 'Approved',                color: 'bg-green-100 text-green-700'   },
  denied:               { label: 'Denied',                  color: 'bg-red-100 text-red-700'       },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const fmt12 = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const calcHours = (start: string, end: string, brk = 0) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm - brk) / 60);
};

// Convert Date → pixel offset from top of 24h timeline
const timeToPx = (d: Date) =>
  ((d.getHours() * 60 + d.getMinutes()) / TOTAL_MINS) * TIMELINE_H;

// ─── SKELETON ─────────────────────────────────────────────────────────────────
function Skel({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-slate-200', className)} />;
}
function TabSkeleton() {
  return (
    <div className="space-y-4 py-2">
      <Skel className="h-16 w-full" />
      <Skel className="h-12 w-full" />
      <Skel className="h-[420px] w-full" />
    </div>
  );
}

// ─── APPOINTMENT ACTION DRAWER ────────────────────────────────────────────────
// Bottom sheet that opens when staff tap any appointment block.
// Contains ALL possible actions for that appointment's current status.
function AppointmentDrawer({ apt, service, onClose, onAction }: {
  apt: any; service: any; onClose: () => void;
  onAction: (aptId: string, action: string, apt: any) => void;
}) {
  if (!apt) return null;
  const start    = safeDate(apt.startTime);
  const duration = service?.duration || apt.duration || 60;
  const end      = addMinutes(start, duration);
  const st       = apt.status || 'confirmed';

  // Build available actions based on current status
  const actions = ([
    (st === 'confirmed' || st === 'pending')
      ? { id: 'start',    label: 'Start Service',       icon: Play,          cls: 'bg-primary text-white shadow-lg shadow-primary/30' }
      : null,
    st === 'servicing'
      ? { id: 'checkout', label: 'Send to Checkout',    icon: ShoppingCart,  cls: 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30' }
      : null,
    st === 'servicing'
      ? { id: 'complete', label: 'Mark Complete',       icon: CheckCircle2,  cls: 'bg-green-500 text-white' }
      : null,
    st === 'ready_for_checkout'
      ? { id: 'escalate', label: 'Escalate to Manager', icon: AlertTriangle, cls: 'bg-amber-500 text-white' }
      : null,
    st !== 'completed' && st !== 'cancelled' && st !== 'no_show'
      ? { id: 'noshow',   label: 'Mark No Show',        icon: XCircle,       cls: 'bg-slate-100 text-slate-700 border-2 border-slate-200' }
      : null,
  ] as any[]).filter(Boolean);

  const statusLabel: Record<string, string> = {
    pending: 'Pending', confirmed: 'Confirmed', servicing: 'In Service',
    ready_for_checkout: 'Ready for Checkout', completed: 'Completed',
    cancelled: 'Cancelled', no_show: 'No Show',
  };
  const statusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700', confirmed: 'bg-blue-100 text-blue-700',
    servicing: 'bg-primary/10 text-primary', ready_for_checkout: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
    no_show: 'bg-slate-100 text-slate-600',
  };

  // Guard: createPortal requires document, which doesn't exist during SSR.
  // Without this check Next.js crashes the entire page on server render.
  if (typeof document === 'undefined') return null;

  // Portal ensures fixed overlay escapes every scroll container / stacking context
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-black/60 flex items-end"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          className="w-full max-w-lg mx-auto bg-white rounded-t-[2.5rem] overflow-hidden shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Handle bar */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-slate-200" />
          </div>

          {/* Appointment info */}
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-black text-xl uppercase tracking-tight text-slate-900 truncate">
                  {service?.name || 'Service'}
                </p>
                <p className="text-sm font-bold text-muted-foreground mt-0.5">
                  {apt.clientName || 'Guest'} · {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
                </p>
                {apt.clientPhone && (
                  <p className="text-[11px] font-bold text-muted-foreground mt-0.5">
                    📞 {apt.clientPhone}
                  </p>
                )}
              </div>
              <Badge className={cn('font-black text-[10px] uppercase border-none shrink-0 mt-1', statusColor[st] || 'bg-slate-100 text-slate-600')}>
                {statusLabel[st] || st}
              </Badge>
            </div>
            {apt.notes && (
              <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-[10px] font-black uppercase text-amber-700 mb-0.5">Client Notes</p>
                <p className="text-xs text-amber-800">{apt.notes}</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="p-4 space-y-2.5">
            {actions.length === 0 ? (
              <p className="text-center text-[11px] font-black uppercase text-muted-foreground opacity-40 py-4">
                No actions available for this appointment
              </p>
            ) : actions.map((a: any) => (
              <button
                key={a.id}
                onClick={() => { onAction(apt.id, a.id, apt); onClose(); }}
                className={cn(
                  'w-full h-14 rounded-2xl font-black uppercase text-[13px] tracking-wide',
                  'flex items-center justify-center gap-3 transition-all active:scale-[0.97]',
                  a.cls,
                )}
              >
                <a.icon className="w-5 h-5" />
                {a.label}
              </button>
            ))}
            <button
              onClick={onClose}
              className="w-full h-11 rounded-2xl border-2 border-slate-200 font-black uppercase text-[11px] text-slate-400 tracking-widest hover:bg-slate-50 transition-all active:scale-[0.97] mt-1"
            >
              Dismiss
            </button>
          </div>
          <div className="pb-6" /> {/* iOS home indicator clearance */}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// ─── FULL 24H DAY TIMELINE ────────────────────────────────────────────────────
function DayTimeline({ appointments, services, selectedDate, onAptTap }: {
  appointments: any[]; services: any[]; selectedDate: Date;
  onAptTap: (apt: any) => void;
}) {
  const scrollRef    = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const isToday_     = isSameDay(selectedDate, now);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll: today → now minus 130px; other days → 8 AM
  useEffect(() => {
    if (!scrollRef.current) return;
    const target = isToday_
      ? Math.max(0, timeToPx(now) - 130)
      : 8 * 60 * PX_PER_MIN - 30;
    scrollRef.current.scrollTo({ top: target, behavior: 'smooth' });
  }, [selectedDate]); // eslint-disable-line

  const dayApts = useMemo(() => {
    if (!appointments) return [];
    return appointments
      .filter(a => isSameDay(safeDate(a.startTime), selectedDate) && a.status !== 'cancelled')
      .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime());
  }, [appointments, selectedDate]);

  const hours = Array.from({ length: 25 }, (_, i) => i); // 0–24

  // Visual ring / colour per status
  const ringCls: Record<string, string> = {
    servicing:          'border-primary ring-2 ring-primary/30 bg-primary/5 shadow-md shadow-primary/10',
    ready_for_checkout: 'border-emerald-400 ring-2 ring-emerald-300/30 bg-emerald-50',
    completed:          'border-green-300 bg-green-50',
    no_show:            'border-slate-200 bg-slate-50 opacity-40',
    confirmed:          'border-primary/30 bg-white shadow-sm',
    pending:            'border-amber-300 bg-amber-50/60',
  };
  const dotCls: Record<string, string> = {
    servicing: 'bg-primary animate-pulse', ready_for_checkout: 'bg-emerald-500',
    completed: 'bg-green-500', no_show: 'bg-slate-400',
    confirmed: 'bg-blue-400', pending: 'bg-amber-400',
  };
  const statusTxt: Record<string, string> = {
    servicing: 'In Service', ready_for_checkout: 'Checkout Queue',
    completed: '✓ Done', no_show: 'No Show',
    confirmed: 'Confirmed', pending: 'Pending',
  };

  return (
    <div className="rounded-[2rem] border-2 border-slate-100 bg-white flex flex-col">
      <div className="px-4 py-3 border-b bg-white flex items-center justify-between shrink-0 rounded-t-[2rem]">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
          {isToday_ ? "Today's Timeline" : format(selectedDate, 'EEE, MMM d')}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-[9px] font-black uppercase text-primary">
            {dayApts.length} apt{dayApts.length !== 1 ? 's' : ''}
          </p>
          {dayApts.length > 0 && (
            <span className="text-[8px] font-black uppercase text-muted-foreground opacity-40">· tap to act</span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="overflow-y-auto rounded-b-[2rem]" style={{ height: 460 }}>
        <div className="relative overflow-hidden" style={{ height: TIMELINE_H }}>

          {/* Hour grid lines — full 24h */}
          {hours.map(h => {
            const topPx = h * 60 * PX_PER_MIN;
            const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
            return (
              <div key={h} className="absolute left-0 right-0 flex items-center pointer-events-none" style={{ top: topPx }}>
                <span className="text-[8px] font-black text-slate-400 w-12 text-right pr-2 shrink-0 leading-none select-none bg-white z-10">
                  {label}
                </span>
                <div className={cn('flex-1 border-t', h % 6 === 0 ? 'border-slate-200' : 'border-dashed border-slate-100')} />
              </div>
            );
          })}

          {/* Now indicator — only on today */}
          {isToday_ && (
            <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: timeToPx(now) }}>
              <div className="w-3 h-3 rounded-full bg-rose-500 ml-10 shrink-0 ring-2 ring-white shadow-md shadow-rose-400/60" />
              <div className="flex-1 h-[2px] bg-rose-500 opacity-80" />
              <span className="text-[8px] font-black text-rose-500 pr-2 shrink-0 bg-white/90 rounded px-1">
                {format(now, 'h:mm a')}
              </span>
            </div>
          )}

          {/* Appointment blocks
              KEY DESIGN: these are <button> elements — always tappable.
              Height is MAX(MIN_BLOCK, natural duration * PX_PER_MIN) so there's
              always room for the status row + "Tap for actions" cue. */}
          {dayApts.map(apt => {
            const start    = safeDate(apt.startTime);
            const svc      = (services || []).find((s: any) => s.id === apt.serviceId);
            const dur      = svc?.duration || apt.duration || 60;
            const topPx    = timeToPx(start);
            const heightPx = Math.max(MIN_BLOCK, dur * PX_PER_MIN);
            const st       = apt.status || 'confirmed';
            const isPast   = addMinutes(start, dur) < now && isToday_;

            return (
              <button
                key={apt.id}
                onClick={() => onAptTap(apt)}
                className={cn(
                  'absolute left-14 right-2 rounded-2xl border-2 text-left',
                  'pointer-events-auto cursor-pointer',
                  'transition-all active:scale-[0.97] active:brightness-95',
                  'z-30',
                  ringCls[st] || 'border-primary/20 bg-white shadow-sm',
                  isPast && st !== 'completed' && 'opacity-55',
                )}
                style={{ top: topPx, height: heightPx }}
              >
                <div className="p-3 h-full flex flex-col gap-1">
                  {/* Service name + dot */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotCls[st] || 'bg-slate-400')} />
                    <p className="font-black text-[11px] uppercase truncate text-slate-800">
                      {svc?.name || 'Service'}
                    </p>
                  </div>
                  {/* Time + client */}
                  <p className="text-[9px] font-bold text-muted-foreground uppercase pl-3 truncate">
                    {format(start, 'h:mm a')} · {apt.clientName?.split(' ')[0] || 'Guest'}
                  </p>
                  {/* Status + "tap for actions" — always at the bottom */}
                  <div className="flex items-center justify-between mt-auto pl-3">
                    <span className="text-[8px] font-black uppercase text-muted-foreground opacity-50">
                      {statusTxt[st] || st}
                    </span>
                    <span className="flex items-center gap-0.5 text-[8px] font-black uppercase text-primary bg-primary/10 rounded-lg px-1.5 py-0.5">
                      <ChevronUp className="w-2.5 h-2.5" />Actions
                    </span>
                  </div>
                </div>
              </button>
            );
          })}

          {dayApts.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingTop: 8 * 60 * PX_PER_MIN }}>
              <div className="text-center opacity-20">
                <Scissors className="w-8 h-8 mx-auto mb-2" />
                <p className="text-[10px] font-black uppercase tracking-widest">No appointments</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DATE NAVIGATOR ───────────────────────────────────────────────────────────
// Week strip + expandable month calendar so staff can jump any date/month
function DateNavigator({ selectedDate, onChange }: { selectedDate: Date; onChange: (d: Date) => void }) {
  const [monthOffset, setMonthOffset]       = useState(0);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const today = new Date();

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekDays  = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) });

  const monthBase  = addMonths(startOfMonth(today), monthOffset);
  const monthDays  = eachDayOfInterval({ start: startOfMonth(monthBase), end: endOfMonth(monthBase) });
  const blankStart = (startOfMonth(monthBase).getDay() + 6) % 7;

  return (
    <div className="bg-white border-2 border-slate-100 rounded-[2rem] overflow-hidden">
      {/* Week strip header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button onClick={() => onChange(addWeeks(selectedDate, -1))}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 active:scale-95 transition-all">
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>
        <button
          onClick={() => setShowMonthPicker(v => !v)}
          className="flex items-center gap-1 font-black uppercase text-[11px] text-slate-700 hover:text-primary transition-colors"
        >
          {format(selectedDate, 'MMMM yyyy')}
          {showMonthPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button onClick={() => onChange(addWeeks(selectedDate, 1))}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 active:scale-95 transition-all">
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {/* 7-day strip */}
      <div className="grid grid-cols-7 gap-1 px-3 pb-3">
        {weekDays.map(day => {
          const isSel = isSameDay(day, selectedDate);
          const isT   = isToday(day);
          return (
            <button key={day.toISOString()} onClick={() => onChange(day)}
              className={cn('flex flex-col items-center py-2 rounded-xl transition-all active:scale-95',
                isSel ? 'bg-primary text-white shadow-lg shadow-primary/30'
                      : isT ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100 text-slate-600')}>
              <span className="text-[8px] font-black uppercase">{format(day, 'EEE')}</span>
              <span className={cn('font-black text-sm mt-0.5', isSel ? 'text-white' : isT ? 'text-primary' : 'text-slate-800')}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Expandable full month picker */}
      <AnimatePresence>
        {showMonthPicker && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden border-t border-slate-100"
          >
            <div className="flex items-center justify-between px-4 py-2">
              <button onClick={() => setMonthOffset(o => o - 1)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
              <p className="font-black uppercase text-[11px] text-slate-700">{format(monthBase, 'MMMM yyyy')}</p>
              <button onClick={() => setMonthOffset(o => o + 1)} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 px-3 pb-1">
              {['M','T','W','T','F','S','S'].map((d, i) => (
                <p key={i} className="text-[8px] font-black uppercase text-center text-slate-400">{d}</p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 px-3 pb-3">
              {Array.from({ length: blankStart }).map((_, i) => <div key={`b${i}`} />)}
              {monthDays.map(day => {
                const isSel = isSameDay(day, selectedDate);
                const isT   = isToday(day);
                return (
                  <button key={day.toISOString()} onClick={() => { onChange(day); setShowMonthPicker(false); }}
                    className={cn('aspect-square rounded-xl flex items-center justify-center text-[11px] font-black transition-all active:scale-95',
                      isSel ? 'bg-primary text-white' : isT ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100 text-slate-700')}>
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FORGOT PIN FLOW ──────────────────────────────────────────────────────────
function ForgotPinFlow({ tenantId, firestore, onBack, onSuccess }: any) {
  const [step, setStep]     = useState<'name' | 'verify'>('name');
  const [name, setName]     = useState('');
  const [answer, setAnswer] = useState('');
  const [found, setFound]   = useState<any>(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const lookupByName = async () => {
    if (!name.trim()) return;
    setLoading(true); setError('');
    try {
      const allSnap = await getDocs(collection(firestore, `tenants/${tenantId}/staff`));
      const match   = allSnap.docs.find(d =>
        (d.data().name || '').toLowerCase().includes(name.trim().toLowerCase())
      );
      if (match) { setFound({ id: match.id, ...match.data() }); setStep('verify'); }
      else setError('Name not found. Check spelling or ask a manager.');
    } catch { setError('Error. Try again.'); }
    finally { setLoading(false); }
  };

  const verify = () => {
    if (!found) return;
    setLoading(true); setError('');
    const phone4 = (found.phone || '').replace(/\D/g, '').slice(-4);
    const email  = (found.email || '').toLowerCase();
    const input  = answer.trim().toLowerCase();
    if (input === phone4 || input === email) {
      toast({ title: `Welcome back, ${found.name?.split(' ')[0]}!` });
      onSuccess(found);
    } else {
      setError('Verification failed. Ask a manager to reset your PIN.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-8">
        <button onClick={onBack} className="flex items-center gap-2 text-white/40 font-black uppercase text-[9px] tracking-widest hover:text-white/60 transition-colors">
          <ChevronLeft className="w-4 h-4" />Back to PIN
        </button>

        {step === 'name' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-[2rem] bg-amber-500/20 border-2 border-amber-500/30 flex items-center justify-center mx-auto">
                <User className="w-7 h-7 text-amber-400" />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Forgot PIN</h2>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Enter your name to continue</p>
            </div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name"
              onKeyDown={e => e.key === 'Enter' && lookupByName()}
              className="w-full h-14 rounded-2xl bg-white/10 border-2 border-white/10 px-4 text-white font-bold placeholder:text-white/30 outline-none focus:border-primary/50" />
            {error && <p className="text-[10px] font-black uppercase text-destructive text-center">{error}</p>}
            <button onClick={lookupByName} disabled={loading || !name.trim()}
              className="w-full h-14 rounded-2xl bg-primary font-black uppercase tracking-widest text-white disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : <>Continue <ChevronRight className="w-4 h-4" /></>}
            </button>
          </motion.div>
        )}

        {step === 'verify' && found && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-[2rem] bg-blue-500/20 border-2 border-blue-500/30 flex items-center justify-center mx-auto">
                <Lock className="w-7 h-7 text-blue-400" />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Verify Identity</h2>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40 leading-relaxed">
                Enter your email address<br />or last 4 digits of your phone
              </p>
            </div>
            <input value={answer} onChange={e => setAnswer(e.target.value)} placeholder="email or last 4 of phone"
              onKeyDown={e => e.key === 'Enter' && verify()}
              className="w-full h-14 rounded-2xl bg-white/10 border-2 border-white/10 px-4 text-white font-bold placeholder:text-white/30 outline-none focus:border-primary/50" />
            {error && <p className="text-[10px] font-black uppercase text-destructive text-center">{error}</p>}
            <button onClick={verify} disabled={loading || !answer.trim()}
              className="w-full h-14 rounded-2xl bg-primary font-black uppercase tracking-widest text-white disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Verify & Sign In'}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── PIN ENTRY ────────────────────────────────────────────────────────────────
function PinEntry({ onSuccess, tenantId, firestore }: any) {
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [shake, setShake]   = useState(false);
  const [checking, setChecking] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  if (showForgot) return <ForgotPinFlow tenantId={tenantId} firestore={firestore} onBack={() => setShowForgot(false)} onSuccess={onSuccess} />;

  const checkPin = async (entered: string) => {
    setChecking(true);
    try {
      const snap = await getDocs(query(collection(firestore, `tenants/${tenantId}/staff`), where('pin', '==', entered)));
      if (!snap.empty) { onSuccess({ id: snap.docs[0].id, ...snap.docs[0].data() }); }
      else { setError('Incorrect PIN. Try again.'); setShake(true); setTimeout(() => { setShake(false); setPin(''); }, 600); }
    } catch { setError('Error. Try again.'); setPin(''); }
    finally { setChecking(false); }
  };

  const handleDigit = (d: string) => {
    if (d === 'del') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) checkPin(next);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-10">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-[2rem] bg-primary/20 border-2 border-primary/30 flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Staff Portal</h1>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Enter your 4-digit PIN</p>
        </div>

        <motion.div animate={shake ? { x: [-8, 8, -8, 8, 0] } : {}} transition={{ duration: 0.4 }} className="flex justify-center gap-4">
          {[0,1,2,3].map(i => (
            <div key={i} className={cn('w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all', pin.length > i ? 'bg-primary border-primary' : 'bg-white/5 border-white/10')}>
              {pin.length > i && <div className="w-3 h-3 rounded-full bg-white" />}
            </div>
          ))}
        </motion.div>

        {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-center text-[10px] font-black uppercase tracking-widest text-destructive">{error}</motion.p>}

        <div className="grid grid-cols-3 gap-3">
          {DIGITS.map((d, i) => (
            <button key={i} onClick={() => d !== '' && handleDigit(d)} disabled={checking || d === ''}
              className={cn('h-16 rounded-2xl font-black text-xl transition-all active:scale-95',
                d === '' ? 'pointer-events-none opacity-0'
                  : d === 'del' ? 'bg-white/5 border-2 border-white/10 text-white/60 hover:bg-white/10'
                  : 'bg-white/10 border-2 border-white/10 text-white hover:bg-white/20')}>
              {d === 'del' ? <Delete className="w-5 h-5 mx-auto" /> : d}
            </button>
          ))}
        </div>

        {checking && <p className="text-center text-[10px] font-black uppercase tracking-widest text-primary/60 animate-pulse">Verifying...</p>}

        <button onClick={() => setShowForgot(true)}
          className="w-full text-center text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors pt-2">
          Forgot PIN?
        </button>
      </div>
    </div>
  );
}

// ─── CLOCK BUTTON ─────────────────────────────────────────────────────────────
function ClockButton({ staffMember, tenantId, firestore, clockStatus }: any) {
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();

  const handle = async () => {
    setProcessing(true);
    try {
      const now   = new Date().toISOString();
      const type  = clockStatus.isClockedIn ? 'clock_out' : 'clock_in';
      const batch = writeBatch(firestore);
      const logRef = doc(collection(firestore, `tenants/${tenantId}/activityLogs`));
      batch.set(logRef, { id: logRef.id, staffId: staffMember.id, type, timestamp: now, createdAt: now });
      batch.set(doc(firestore, `tenants/${tenantId}/staff`, staffMember.id),
        { status: type === 'clock_in' ? 'available' : 'off', ...(type === 'clock_in' ? { lastClockIn: now } : { lastClockOut: now }) },
        { merge: true });
      await batch.commit();
      toast({ title: type === 'clock_in' ? 'Clocked In ✓' : 'Clocked Out ✓' });
    } catch { toast({ variant: 'destructive', title: 'Clock action failed.' }); }
    finally { setProcessing(false); }
  };

  return (
    <button onClick={handle} disabled={processing}
      className={cn('flex items-center gap-1.5 h-8 px-3 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all active:scale-95 disabled:opacity-50',
        clockStatus.isClockedIn
          ? 'bg-rose-500/20 border border-rose-400/30 text-rose-300 hover:bg-rose-500/30'
          : 'bg-green-500/20 border border-green-400/30 text-green-300 hover:bg-green-500/30')}>
      {processing ? <Loader className="w-3 h-3 animate-spin" />
        : clockStatus.isClockedIn ? <><LogOut className="w-3 h-3" />Out</> : <><LogIn className="w-3 h-3" />In</>}
    </button>
  );
}

// ─── NEXT APPOINTMENT BANNER ──────────────────────────────────────────────────
function NextBanner({ appointments, services }: any) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const next = useMemo(() => {
    if (!appointments) return null;
    return appointments.filter((a: any) =>
      safeDate(a.startTime) > now && !['cancelled','completed'].includes(a.status) && isSameDay(safeDate(a.startTime), now)
    ).sort((a: any, b: any) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0] || null;
  }, [appointments, now]);
  if (!next) return null;
  const start = safeDate(next.startTime);
  const mins  = differenceInMinutes(start, now);
  const svc   = (services || []).find((s: any) => s.id === next.serviceId);
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-primary/10 border-2 border-primary/20">
      <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0"><Timer className="w-5 h-5 text-white" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-black uppercase text-primary/60 tracking-widest">Next Up</p>
        <p className="font-black text-sm text-primary truncate">{svc?.name || 'Service'} · {next.clientName?.split(' ')[0] || 'Guest'}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-black text-lg text-primary leading-none">{mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`}</p>
        <p className="text-[8px] font-black uppercase text-primary/50">{format(start, 'h:mm a')}</p>
      </div>
    </div>
  );
}

// ─── SWAP CARDS ───────────────────────────────────────────────────────────────
function SwapConsentCard({ req, staffMember, tenantId, firestore, allStaff, allShifts }: any) {
  const [processing, setProcessing] = useState(false);
  const { toast } = useToast();
  const requester  = (allStaff  || []).find((s: any) => s.id === req.staffId);
  const myShift    = (allShifts || []).find((s: any) => s.id === req.swapShiftId);
  const theirShift = (allShifts || []).find((s: any) => s.id === req.myShiftId);

  const respond = async (agree: boolean) => {
    setProcessing(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, req.id), { status: agree ? 'swap_consent_given' : 'swap_consent_denied', consentBy: staffMember.id, consentAt: now });
      const n1 = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(n1, { id: n1.id, userId: req.staffId, read: false, createdAt: now, link: 'requests', type: agree ? 'swap_consent_given' : 'swap_consent_denied', message: agree ? `${staffMember.name} agreed to your swap on ${req.date ? format(safeDate(req.date), 'MMM d') : 'the date'}.` : `${staffMember.name} declined your swap.` });
      const mgrs = await getDocs(query(collection(firestore, `tenants/${tenantId}/staff`), where('role', 'in', ['owner', 'admin'])));
      mgrs.docs.forEach(mgr => { const n = doc(collection(firestore, `tenants/${tenantId}/notifications`)); batch.set(n, { id: n.id, userId: mgr.id, read: false, createdAt: now, link: '/schedule/requests', type: 'swap_request', message: agree ? `${staffMember.name} agreed to swap with ${requester?.name}. Ready for approval.` : `Swap between ${requester?.name} and ${staffMember.name} declined.` }); });
      await batch.commit();
      toast({ title: agree ? 'Swap Agreed ✓' : 'Swap Declined' });
    } catch { toast({ variant: 'destructive', title: 'Error.' }); }
    finally { setProcessing(false); }
  };

  return (
    <div className="rounded-[2rem] border-2 border-purple-200 bg-purple-50 overflow-hidden">
      <div className="px-4 py-3 bg-purple-100/60 border-b border-purple-200 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-purple-600 shrink-0" />
        <p className="font-black uppercase text-[10px] text-purple-700">Swap Request from {requester?.name}</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[{ label: 'Their shift → you', sh: theirShift, col: 'text-primary' }, { label: 'Your shift → them', sh: myShift, col: 'text-purple-600' }].map(({ label, sh, col }) => (
            <div key={label} className="p-3 rounded-xl bg-white border-2 border-purple-100">
              <p className="text-[8px] font-black uppercase text-muted-foreground opacity-60 mb-0.5">{label}</p>
              {sh ? <><p className={cn('font-black text-[11px]', col)}>{fmt12(sh.startTime)} – {fmt12(sh.endTime)}</p><p className="text-[8px] font-bold opacity-60 uppercase">{sh.date}</p></> : <p className="text-[9px] opacity-40 uppercase">Not found</p>}
            </div>
          ))}
        </div>
        {req.reason && <p className="text-[10px] font-bold text-purple-700 uppercase">{req.reason}</p>}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => respond(false)} disabled={processing} className="h-12 rounded-2xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-0.5"><XCircle className="w-4 h-4" />Decline</button>
          <button onClick={() => respond(true)}  disabled={processing} className="h-12 rounded-2xl bg-green-600 text-white font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 shadow-lg flex flex-col items-center justify-center gap-0.5"><CheckCircle2 className="w-4 h-4" />Agree</button>
        </div>
      </div>
    </div>
  );
}

function SwapApproveCard({ req, staffMember, tenantId, firestore, allStaff, allShifts }: any) {
  const [processing, setProcessing] = useState(false);
  const [note, setNote] = useState('');
  const { toast } = useToast();
  if (staffMember.role !== 'owner' && staffMember.role !== 'admin') return null;
  const requester    = (allStaff  || []).find((s: any) => s.id === req.staffId);
  const consentGiver = (allStaff  || []).find((s: any) => s.id === req.swapWithStaffId);
  const shift1       = (allShifts || []).find((s: any) => s.id === req.myShiftId);
  const shift2       = (allShifts || []).find((s: any) => s.id === req.swapShiftId);

  const decide = async (approve: boolean) => {
    setProcessing(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, `tenants/${tenantId}/shiftRequests`, req.id), { status: approve ? 'approved' : 'denied', approvedBy: staffMember.id, approvedAt: now, managerNote: note.trim() || null });
      if (approve && shift1 && shift2) { batch.update(doc(firestore, `tenants/${tenantId}/shifts`, shift1.id), { staffId: req.swapWithStaffId }); batch.update(doc(firestore, `tenants/${tenantId}/shifts`, shift2.id), { staffId: req.staffId }); }
      [req.staffId, req.swapWithStaffId].filter(Boolean).forEach((uid: string) => { const n = doc(collection(firestore, `tenants/${tenantId}/notifications`)); batch.set(n, { id: n.id, userId: uid, read: false, createdAt: now, link: 'schedule', type: approve ? 'swap_approved' : 'request_denied', message: approve ? `Your swap was approved.` : `Your swap was denied.${note ? ` Note: ${note}` : ''}` }); });
      await batch.commit();
      toast({ title: approve ? 'Swap Approved ✓' : 'Swap Denied' });
    } catch { toast({ variant: 'destructive', title: 'Error.' }); }
    finally { setProcessing(false); }
  };

  return (
    <div className="rounded-[2rem] border-2 border-blue-200 bg-blue-50 overflow-hidden">
      <div className="px-4 py-3 bg-blue-100/60 border-b border-blue-200 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
        <p className="font-black uppercase text-[10px] text-blue-700">Swap Awaiting Approval</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[{ label: `${requester?.name?.split(' ')[0]}'s shift`, sh: shift1 }, { label: `${consentGiver?.name?.split(' ')[0]}'s shift`, sh: shift2 }].map(({ label, sh }) => (
            <div key={label} className="p-3 rounded-xl bg-white border-2 border-blue-100">
              <p className="text-[8px] font-black uppercase opacity-60 mb-0.5">{label}</p>
              {sh ? <><p className="font-black text-[11px] text-primary">{fmt12(sh.startTime)} – {fmt12(sh.endTime)}</p><p className="text-[8px] font-bold opacity-60 uppercase">{sh.date}</p></> : <p className="text-[9px] opacity-40">N/A</p>}
            </div>
          ))}
        </div>
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Manager note (optional)" className="rounded-2xl border-2 bg-white min-h-[60px] text-sm" />
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => decide(false)} disabled={processing} className="h-12 rounded-2xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-0.5"><XCircle className="w-4 h-4" />Deny</button>
          <button onClick={() => decide(true)}  disabled={processing} className="h-12 rounded-2xl bg-blue-600 text-white font-black uppercase text-[9px] active:scale-95 disabled:opacity-50 shadow-lg flex flex-col items-center justify-center gap-0.5"><CheckCircle2 className="w-4 h-4" />Approve</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
function StaffDashboard({ staffMember, tenantId, firestore, onSignOut }: any) {
  const { toast } = useToast();
  const [activeTab, setActiveTab]   = useState<'today'|'schedule'|'requests'|'earnings'|'inbox'>('today');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [drawerApt, setDrawerApt]   = useState<any>(null);
  const [drawerSvc, setDrawerSvc]   = useState<any>(null);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [requestType, setRequestType]     = useState<'day_off'|'swap'|'early_release'>('day_off');
  const [requestDate, setRequestDate]     = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [swapTargetShiftId, setSwapTargetShiftId] = useState('');
  const [swapTargetStaffId, setSwapTargetStaffId] = useState('');
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [isClearingInbox, setIsClearingInbox] = useState(false);
  const [refreshKey, setRefreshKey]       = useState(0);

  const isOwnerOrAdmin = staffMember.role === 'owner' || staffMember.role === 'admin';
  const today = new Date();

  // ── Queries ──
  const myShiftsQ       = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/shifts`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id,refreshKey]);
  const allShiftsQ      = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/shifts`), [firestore,tenantId]);
  const myApptsQ        = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/appointments`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id,refreshKey]);
  const myRequestsQ     = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/shiftRequests`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  const incomingSwapQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/shiftRequests`), where('swapWithStaffId','==',staffMember.id), where('status','==','pending_swap_consent')), [firestore,tenantId,staffMember?.id]);
  const pendingApprovalQ = useMemoFirebase(() => (!firestore||!tenantId||!isOwnerOrAdmin) ? null : query(collection(firestore,`tenants/${tenantId}/shiftRequests`), where('status','==','swap_consent_given')), [firestore,tenantId,isOwnerOrAdmin]);
  const allStaffQ       = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/staff`), [firestore,tenantId]);
  const servicesQ       = useMemoFirebase(() => (!firestore||!tenantId) ? null : collection(firestore,`tenants/${tenantId}/services`), [firestore,tenantId]);
  const notifsQ         = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/notifications`), where('userId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  const activityLogsQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/activityLogs`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);
  const transactionsQ   = useMemoFirebase(() => (!firestore||!tenantId||!staffMember?.id) ? null : query(collection(firestore,`tenants/${tenantId}/transactions`), where('staffId','==',staffMember.id)), [firestore,tenantId,staffMember?.id]);

  const { data: myShiftsRaw,  loading: shiftsLoading }  = useCollection<any>(myShiftsQ);
  const { data: allShiftsRaw }                          = useCollection<any>(allShiftsQ);
  const { data: myApptsRaw,   loading: apptsLoading }   = useCollection<any>(myApptsQ);
  const { data: myRequests }                            = useCollection<any>(myRequestsQ);
  const { data: incomingSwaps }                         = useCollection<any>(incomingSwapQ);
  const { data: pendingApprovals }                      = useCollection<any>(pendingApprovalQ);
  const { data: allStaff }                              = useCollection<any>(allStaffQ);
  const { data: services,     loading: svcsLoading }    = useCollection<any>(servicesQ);
  const { data: notifs }                                = useCollection<any>(notifsQ);
  const { data: activityLogs }                          = useCollection<any>(activityLogsQ);
  const { data: transactions }                          = useCollection<any>(transactionsQ);

  const isLoadingToday = apptsLoading || svcsLoading;

  // ── Derived state ──
  const todayShift = useMemo(() => {
    if (!myShiftsRaw) return null;
    const s = format(today, 'yyyy-MM-dd');
    return myShiftsRaw.find((sh: any) => sh.date === s && sh.status !== 'cancelled' && sh.status !== 'draft') || null;
  }, [myShiftsRaw]);

  const clockStatus = useMemo(() => {
    if (!activityLogs) return { isClockedIn: false, minutesWorked: 0 };
    const logs = activityLogs.filter((l: any) => isSameDay(safeDate(l.timestamp), today)).sort((a: any, b: any) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());
    let isClockedIn = false, clockInTime: Date | null = null, total = 0;
    for (const l of logs) {
      if (l.type === 'clock_in') { isClockedIn = true; clockInTime = safeDate(l.timestamp); }
      else if (l.type === 'clock_out' && clockInTime) { total += differenceInMinutes(safeDate(l.timestamp), clockInTime); isClockedIn = false; clockInTime = null; }
    }
    if (isClockedIn && clockInTime) total += differenceInMinutes(new Date(), clockInTime);
    return { isClockedIn, minutesWorked: total };
  }, [activityLogs]);

  const weekEarnings = useMemo(() => {
    const ws = startOfWeek(today, { weekStartsOn: 1 });
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const shifts = (myShiftsRaw || []).filter((s: any) => s.date >= format(ws,'yyyy-MM-dd') && s.date <= format(we,'yyyy-MM-dd') && s.status !== 'cancelled');
    const weekHours = shifts.reduce((sum: number, s: any) => sum + calcHours(s.startTime, s.endTime, s.breakMinutes||0), 0);
    const weekTx    = (transactions||[]).filter((t: any) => { const d = safeDate(t.date); return d >= ws && d <= we; });
    const tipTotal       = weekTx.reduce((s: number, t: any) => s + (t.tipAmount || (t.category==='Tips' ? t.amount : 0)), 0);
    const serviceRevenue = weekTx.filter((t: any) => t.category==='Service Revenue').reduce((s: number, t: any) => s + t.amount, 0);
    const apptCount      = (myApptsRaw||[]).filter((a: any) => { const d = safeDate(a.startTime); return d >= ws && d <= we && a.status==='completed'; }).length;
    const ps = staffMember.payStructure;
    let estimatedPay = 0;
    if      (ps==='hourly')                estimatedPay = weekHours * (staffMember.hourlyRate||0);
    else if (ps==='commission')            estimatedPay = serviceRevenue * ((staffMember.commissionRate||0)/100);
    else if (ps==='hourly_plus_commission') estimatedPay = (staffMember.hourlyRate||0)*weekHours + serviceRevenue*((staffMember.commissionRate||0)/100);
    else if (ps==='salary')               estimatedPay = staffMember.salaryWeekly || 0;
    return { estimatedPay, weekHours, tipTotal, serviceRevenue, apptCount };
  }, [myShiftsRaw, transactions, myApptsRaw, staffMember]);

  const sortedNotifs   = useMemo(() => notifs ? [...notifs].sort((a,b) => new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime()) : [], [notifs]);
  const unreadCount    = useMemo(() => sortedNotifs.filter(n => !n.read).length, [sortedNotifs]);
  const sortedRequests = useMemo(() => myRequests ? [...myRequests].sort((a,b) => new Date(b.createdAt||0).getTime()-new Date(a.createdAt||0).getTime()) : [], [myRequests]);
  const requestsBadge  = (incomingSwaps||[]).length + (isOwnerOrAdmin ? (pendingApprovals||[]).length : 0);

  const shiftsOnRequestDate = useMemo(() => {
    if (!requestDate||requestType!=='swap'||!allShiftsRaw||!allStaff) return [];
    return allShiftsRaw.filter((s: any) => s.date===requestDate&&s.staffId!==staffMember.id&&s.status!=='cancelled'&&s.status!=='draft').map((s: any) => ({ shift:s, member:(allStaff||[]).find((st: any) => st.id===s.staffId) })).filter((x: any) => x.member);
  }, [allShiftsRaw, allStaff, requestDate, requestType, staffMember.id]);

  const myShiftOnRequestDate = useMemo(() => (!requestDate||!myShiftsRaw) ? null : myShiftsRaw.find((s: any) => s.date===requestDate&&s.status!=='cancelled') || null, [myShiftsRaw, requestDate]);

  const todayColleagues = useMemo(() => {
    if (!allShiftsRaw||!allStaff) return [];
    const s = format(today,'yyyy-MM-dd');
    return allShiftsRaw.filter((sh: any) => sh.date===s&&sh.staffId!==staffMember.id&&sh.status!=='cancelled'&&sh.status!=='draft').map((sh: any) => { const m=(allStaff||[]).find((st: any) => st.id===sh.staffId); return m ? { id:sh.id, firstName:m.name?.split(' ')[0]||'Staff', startTime:sh.startTime, endTime:sh.endTime } : null; }).filter(Boolean);
  }, [allShiftsRaw, allStaff, today, staffMember.id]);

  // ── Appointment action handler ──
  const handleAptAction = useCallback(async (aptId: string, action: string, apt: any) => {
    if (!firestore||!tenantId) return;
    const now   = new Date().toISOString();
    const batch = writeBatch(firestore);
    const aptRef = doc(firestore,`tenants/${tenantId}/appointments`,aptId);
    switch (action) {
      case 'start':
        batch.update(aptRef,{ status:'servicing', actualStartTime:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'busy' },{ merge:true });
        break;
      case 'checkout':
        batch.update(aptRef,{ status:'ready_for_checkout', actualEndTime:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'idle' },{ merge:true });
        break;
      case 'complete':
        batch.update(aptRef,{ status:'completed', completedAt:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'available' },{ merge:true });
        break;
      case 'escalate': {
        batch.update(aptRef,{ escalatedAt:now, escalatedBy:staffMember.id });
        const mgrs = await getDocs(query(collection(firestore,`tenants/${tenantId}/staff`),where('role','in',['owner','admin'])));
        mgrs.docs.forEach(mgr => { const n=doc(collection(firestore,`tenants/${tenantId}/notifications`)); batch.set(n,{ id:n.id, userId:mgr.id, read:false, createdAt:now, type:'escalation', link:'/appointments', message:`${staffMember.name} escalated ${apt.clientName||'a client'} at checkout.` }); });
        break;
      }
      case 'noshow':
        batch.update(aptRef,{ status:'no_show', noShowAt:now });
        batch.set(doc(firestore,`tenants/${tenantId}/staff`,staffMember.id),{ status:'available' },{ merge:true });
        break;
    }
    await batch.commit();
    const labels: Record<string,string> = { start:'Service Started ✓', checkout:'Sent to Checkout ✓', complete:'Marked Complete ✓', escalate:'Escalated to Manager ✓', noshow:'Marked No Show' };
    toast({ title: labels[action] || 'Updated' });
  }, [firestore, tenantId, staffMember]);

  const handleNotifClick = async (n: any) => {
    if (!n.read) { try { await updateDoc(doc(firestore,`tenants/${tenantId}/notifications`,n.id),{ read:true }); } catch {} }
    const map: Record<string,typeof activeTab> = { requests:'requests', schedule:'schedule', '/my-schedule':'schedule', '/schedule/requests':'requests', earnings:'earnings' };
    if (n.link && map[n.link]) setActiveTab(map[n.link]);
  };

  const handleClearInbox = async () => {
    if (!notifs?.length) return;
    setIsClearingInbox(true);
    try {
      const batch = writeBatch(firestore);
      notifs.forEach(n => batch.delete(doc(firestore,`tenants/${tenantId}/notifications`,n.id)));
      await batch.commit();
      toast({ title:'Inbox Cleared' });
    } catch { toast({ variant:'destructive', title:'Failed to clear inbox.' }); }
    finally { setIsClearingInbox(false); }
  };

  const handleSubmitRequest = async () => {
    if (!requestDate||!requestReason.trim()) { toast({ variant:'destructive', title:'Fill in all fields.' }); return; }
    if (requestType==='swap'&&!swapTargetShiftId) { toast({ variant:'destructive', title:'Choose a shift to swap.' }); return; }
    if (requestType==='swap'&&!myShiftOnRequestDate) { toast({ variant:'destructive', title:"You're not scheduled on this date." }); return; }
    setIsSubmitting(true);
    try {
      const batch=writeBatch(firestore); const now=new Date().toISOString();
      const reqRef=doc(collection(firestore,`tenants/${tenantId}/shiftRequests`));
      batch.set(reqRef,{ id:reqRef.id, staffId:staffMember.id, type:requestType, date:requestDate, reason:requestReason, status:requestType==='swap'?'pending_swap_consent':'pending', createdAt:now, ...(requestType==='swap'&&{ swapWithStaffId:swapTargetStaffId, swapShiftId:swapTargetShiftId, myShiftId:myShiftOnRequestDate?.id||null }) });
      if (requestType==='day_off') { const b=doc(collection(firestore,`tenants/${tenantId}/shiftDayOffBlocks`)); batch.set(b,{ id:b.id, staffId:staffMember.id, date:requestDate, status:'pending', requestId:reqRef.id, reason:requestReason, createdAt:now }); }
      if (requestType==='swap'&&swapTargetStaffId) { const n=doc(collection(firestore,`tenants/${tenantId}/notifications`)); batch.set(n,{ id:n.id, userId:swapTargetStaffId, read:false, createdAt:now, type:'swap_request', link:'requests', message:`${staffMember.name} wants to swap shifts on ${format(safeDate(requestDate),'EEE, MMM d')}.` }); }
      if (requestType!=='swap') { const mgrs=await getDocs(query(collection(firestore,`tenants/${tenantId}/staff`),where('role','in',['owner','admin']))); mgrs.docs.forEach(mgr => { const n=doc(collection(firestore,`tenants/${tenantId}/notifications`)); batch.set(n,{ id:n.id, userId:mgr.id, read:false, createdAt:now, type:requestType==='day_off'?'day_off_request':'early_release_request', link:'/schedule/requests', message:`${staffMember.name} requested ${requestType==='day_off'?'a day off':'early release'} on ${format(safeDate(requestDate),'EEE, MMM d')}.` }); }); }
      await batch.commit();
      toast({ title:'Request Submitted ✓' });
      setIsRequestOpen(false); setRequestReason(''); setRequestDate(''); setSwapTargetShiftId(''); setSwapTargetStaffId('');
    } catch { toast({ variant:'destructive', title:'Submission failed.' }); }
    finally { setIsSubmitting(false); }
  };

  const TABS = [
    { id:'today',    label:'Today',    icon:CalendarDays },
    { id:'schedule', label:'Schedule', icon:Calendar },
    { id:'earnings', label:'Earnings', icon:DollarSign },
    { id:'requests', label:'Requests', icon:ClipboardList, badge:requestsBadge },
    { id:'inbox',    label:'Inbox',    icon:Bell, badge:unreadCount },
  ] as const;

  const NOTIF_ICONS: Record<string,any> = {
    timesheet_approved: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    timesheet_rejected: <XCircle className="w-4 h-4 text-destructive" />,
    day_off_approved:   <Calendar className="w-4 h-4 text-blue-500" />,
    swap_approved:      <Repeat className="w-4 h-4 text-purple-500" />,
    swap_consent_given: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    swap_consent_denied:<XCircle className="w-4 h-4 text-destructive" />,
    swap_request:       <Repeat className="w-4 h-4 text-purple-500" />,
    request_approved:   <CheckCircle2 className="w-4 h-4 text-green-500" />,
    request_denied:     <XCircle className="w-4 h-4 text-destructive" />,
    schedule_published: <CalendarDays className="w-4 h-4 text-primary" />,
    escalation:         <AlertTriangle className="w-4 h-4 text-amber-500" />,
    client_movement:    <Activity className="w-4 h-4 text-blue-500" />,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">

      {/* Header */}
      <div className="bg-slate-900 px-5 pt-6 pb-5 space-y-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-11 h-11 rounded-2xl border-2 border-white/10">
              <AvatarImage src={staffMember.avatarUrl} className="object-cover" />
              <AvatarFallback className="bg-primary/20 text-primary font-black">{staffMember.name?.[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-black uppercase text-white text-sm leading-none">{staffMember.name}</p>
              <p className="text-[9px] font-black uppercase text-primary/60 mt-0.5">{staffMember.role} · {format(today,'EEE, MMM d')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsRequestOpen(true)} className="h-9 px-3 rounded-xl bg-primary/20 border border-primary/30 text-primary font-black uppercase text-[9px] tracking-widest flex items-center gap-1.5 hover:bg-primary/30 transition-colors">
              <Plus className="w-3.5 h-3.5" />Request
            </button>
            <button onClick={onSignOut} className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
          <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', clockStatus.isClockedIn ? 'bg-green-400 animate-pulse' : 'bg-white/20')} />
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase text-white/40">Status</p>
            <p className="font-black text-white text-sm">{clockStatus.isClockedIn ? `Clocked In · ${Math.floor(clockStatus.minutesWorked/60)}h ${clockStatus.minutesWorked%60}m` : 'Not Clocked In'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {todayShift && <div className="text-right"><p className="text-[9px] font-black uppercase text-white/40">Shift</p><p className="font-black text-primary text-sm">{fmt12(todayShift.startTime)} – {fmt12(todayShift.endTime)}</p></div>}
            <ClockButton staffMember={staffMember} tenantId={tenantId} firestore={firestore} clockStatus={clockStatus} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-white border-b-2 border-slate-100 shrink-0">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={cn('flex-1 flex flex-col items-center gap-1 py-3 text-[8px] font-black uppercase tracking-widest transition-all relative shrink-0 min-w-[56px]', activeTab===tab.id ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground')}>
            <div className="relative">
              <tab.icon className="w-4 h-4" />
              {(tab as any).badge > 0 && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[7px] font-black rounded-full flex items-center justify-center">{(tab as any).badge}</span>}
            </div>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Refresh button */}
      <div className="flex justify-end px-4 py-1.5 bg-slate-50 shrink-0">
        <button onClick={() => setRefreshKey(k => k+1)} className="flex items-center gap-1 text-[8px] font-black uppercase text-muted-foreground opacity-30 hover:opacity-60 transition-opacity">
          <RefreshCw className="w-2.5 h-2.5" />Refresh
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pb-10 space-y-4">

          {/* TODAY */}
          {activeTab==='today' && (
            isLoadingToday ? <TabSkeleton /> : (
              <div className="space-y-4">
                <NextBanner appointments={myApptsRaw} services={services} />
                <DateNavigator selectedDate={selectedDate} onChange={setSelectedDate} />
                <DayTimeline appointments={myApptsRaw} services={services} selectedDate={selectedDate}
                  onAptTap={apt => { setDrawerApt(apt); setDrawerSvc((services||[]).find((s: any) => s.id===apt.serviceId)); }} />
                {isSameDay(selectedDate,today) && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Also Working Today</p>
                    {todayColleagues.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {todayColleagues.map((c: any) => (
                          <div key={c.id} className="flex items-center gap-2 p-3 rounded-2xl border-2 border-slate-100 bg-white">
                            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><p className="font-black text-primary text-sm">{c.firstName[0]}</p></div>
                            <div className="min-w-0"><p className="font-black uppercase text-[10px] truncate">{c.firstName}</p><p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{fmt12(c.startTime)} – {fmt12(c.endTime)}</p></div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center rounded-2xl border-2 border-dashed opacity-30"><p className="text-[10px] font-black uppercase tracking-widest">No other staff scheduled</p></div>
                    )}
                  </div>
                )}
              </div>
            )
          )}

          {/* SCHEDULE */}
          {activeTab==='schedule' && (
            shiftsLoading ? <TabSkeleton /> : (
              <div className="space-y-4">
                <DateNavigator selectedDate={selectedDate} onChange={setSelectedDate} />
                {(() => {
                  const dayStr   = format(selectedDate,'yyyy-MM-dd');
                  const dayShift = (myShiftsRaw||[]).find((s: any) => s.date===dayStr&&s.status!=='cancelled'&&s.status!=='draft');
                  const isPast   = isBefore(selectedDate,startOfDay(today))&&!isToday(selectedDate);
                  return (
                    <div className={cn('rounded-[2rem] border-2 overflow-hidden bg-white', isToday(selectedDate) ? 'border-primary/30 shadow-md shadow-primary/10' : 'border-slate-100', isPast && 'opacity-50')}>
                      <div className={cn('px-4 py-3 flex items-center gap-3 border-b border-dashed', isToday(selectedDate) ? 'bg-primary/5' : 'bg-muted/5')}>
                        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0', isToday(selectedDate) ? 'bg-primary text-white' : 'bg-white border-2 text-slate-600')}>{format(selectedDate,'d')}</div>
                        <div className="flex-1"><p className={cn('font-black uppercase text-sm leading-none', isToday(selectedDate) ? 'text-primary' : 'text-slate-700')}>{format(selectedDate,'EEEE')}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{format(selectedDate,'MMMM d, yyyy')}</p></div>
                        {isToday(selectedDate) && <Badge className="bg-primary text-white border-none font-black text-[8px] uppercase">Today</Badge>}
                      </div>
                      <div className="p-3">
                        {dayShift ? (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border-2 border-primary/10">
                            <Clock className="w-4 h-4 text-primary/40 shrink-0" />
                            <div className="flex-1"><p className="font-black uppercase text-[11px] text-primary">{fmt12(dayShift.startTime)} – {fmt12(dayShift.endTime)}</p>{(dayShift.breakMinutes||0)>0&&<p className="text-[9px] font-bold opacity-60 uppercase flex items-center gap-1"><Coffee className="w-2.5 h-2.5"/>{dayShift.breakMinutes}m break</p>}{dayShift.notes&&<p className="text-[9px] italic text-muted-foreground opacity-70 mt-0.5 truncate">{dayShift.notes}</p>}</div>
                            <p className="font-black font-mono text-sm text-primary shrink-0">{calcHours(dayShift.startTime,dayShift.endTime,dayShift.breakMinutes||0).toFixed(1)}h</p>
                          </div>
                        ) : <p className="text-[9px] font-black uppercase text-muted-foreground opacity-30 text-center py-2">No shift scheduled</p>}
                      </div>
                    </div>
                  );
                })()}
                <DayTimeline appointments={myApptsRaw} services={services} selectedDate={selectedDate}
                  onAptTap={apt => { setDrawerApt(apt); setDrawerSvc((services||[]).find((s: any) => s.id===apt.serviceId)); }} />
              </div>
            )
          )}

          {/* EARNINGS */}
          {activeTab==='earnings' && (
            <div className="space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">This Week's Summary</p>
              <div className="p-6 rounded-[2.5rem] bg-slate-900 text-white space-y-6">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase text-primary/60 tracking-[0.3em]">Estimated Earnings</p>
                  <p className="text-5xl font-black font-mono tracking-tighter text-primary">${weekEarnings.estimatedPay.toFixed(2)}</p>
                  <p className="text-[9px] font-bold text-white/40 uppercase">{staffMember.payStructure?.replace(/_/g,' ')||'commission'} · {weekEarnings.weekHours.toFixed(1)}h</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[{l:'Tips',v:`$${weekEarnings.tipTotal.toFixed(0)}`,c:'text-green-400'},{l:'Services',v:String(weekEarnings.apptCount),c:'text-white'},{l:'Hours',v:weekEarnings.weekHours.toFixed(1),c:'text-white'}].map(({l,v,c}) => (
                    <div key={l} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center"><p className="text-[8px] font-black uppercase text-white/40">{l}</p><p className={cn('font-black font-mono text-lg',c)}>{v}</p></div>
                  ))}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-white border-2 border-slate-100 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Pay Structure</p>
                <div className="flex items-center justify-between"><p className="font-bold uppercase text-sm text-slate-700">{staffMember.payStructure?.replace(/_/g,' ')||'Commission'}</p>{staffMember.commissionRate&&<Badge className="bg-primary/10 text-primary border-none font-black text-[10px]">{staffMember.commissionRate}% service</Badge>}</div>
                {staffMember.hourlyRate&&<p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">${staffMember.hourlyRate}/hr base</p>}
                <div className="pt-2 border-t border-dashed"><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-40 leading-relaxed">Estimates based on scheduled shifts and completed services. Final payout confirmed by management.</p></div>
              </div>
            </div>
          )}

          {/* REQUESTS */}
          {activeTab==='requests' && (
            <div className="space-y-4">
              {isOwnerOrAdmin&&(pendingApprovals||[]).length>0&&(
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 px-1 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5"/>Awaiting Your Approval</p>
                  {(pendingApprovals||[]).map((r: any) => <SwapApproveCard key={r.id} req={r} staffMember={staffMember} tenantId={tenantId} firestore={firestore} allStaff={allStaff} allShifts={allShiftsRaw}/>)}
                </div>
              )}
              {(incomingSwaps||[]).length>0&&(
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-purple-700 px-1 flex items-center gap-2"><Repeat className="w-3.5 h-3.5"/>Swap Requests For You</p>
                  {(incomingSwaps||[]).map((r: any) => <SwapConsentCard key={r.id} req={r} staffMember={staffMember} tenantId={tenantId} firestore={firestore} allStaff={allStaff} allShifts={allShiftsRaw}/>)}
                </div>
              )}
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">My Requests</p>
                {sortedRequests.length===0&&(incomingSwaps||[]).length===0&&(!isOwnerOrAdmin||(pendingApprovals||[]).length===0)&&(
                  <div className="py-12 text-center border-2 border-dashed rounded-[2rem] opacity-30"><ClipboardList className="w-10 h-10 mx-auto mb-3"/><p className="text-[10px] font-black uppercase tracking-widest">No requests yet</p></div>
                )}
                {sortedRequests.map((req: any) => {
                  const swapTarget = req.swapWithStaffId ? (allStaff||[]).find((s: any) => s.id===req.swapWithStaffId) : null;
                  const si = STATUS_SWAP[req.status]||STATUS_SWAP.pending;
                  return (
                    <Card key={req.id} className="border-2 rounded-[2rem] bg-white shadow-sm">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {req.type==='day_off'?<Calendar className="w-4 h-4 text-blue-600"/>:req.type==='swap'?<Repeat className="w-4 h-4 text-purple-600"/>:<Zap className="w-4 h-4 text-amber-600"/>}
                            <div><p className="font-black uppercase text-[10px] text-slate-900">{req.type==='day_off'?'Day Off':req.type==='swap'?'Shift Swap':'Early Release'}{req.date&&` · ${format(safeDate(req.date),'MMM d')}`}</p><p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{format(safeDate(req.createdAt),'MMM d, p')}</p></div>
                          </div>
                          <Badge className={cn('font-black text-[8px] uppercase border-none h-5 px-2 shrink-0',si.color)}>{si.label}</Badge>
                        </div>
                        {req.type==='swap'&&swapTarget&&<div className="flex items-center gap-2 text-[9px] font-bold text-purple-700 uppercase"><ArrowRight className="w-3 h-3 shrink-0"/>Swap with {swapTarget.name?.split(' ')[0]}</div>}
                        <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">{req.reason}</p>
                        {req.managerNote&&<div className="p-2.5 rounded-xl bg-primary/5 border border-primary/10"><p className="text-[9px] font-black uppercase text-primary/60 mb-0.5">Manager Response</p><p className="text-[10px] font-bold text-slate-700">{req.managerNote}</p></div>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* INBOX */}
          {activeTab==='inbox' && (
            <div className="space-y-3">
              {sortedNotifs.length>0&&(
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{unreadCount>0?`${unreadCount} unread`:'All caught up'}</p>
                  <button onClick={handleClearInbox} disabled={isClearingInbox} className="flex items-center gap-1.5 h-8 px-3 rounded-xl border-2 border-destructive/20 bg-white text-destructive font-black uppercase text-[8px] tracking-widest hover:bg-destructive/5 transition-all active:scale-95 disabled:opacity-50">
                    {isClearingInbox?<Loader className="w-3 h-3 animate-spin"/>:<Trash2 className="w-3 h-3"/>}Clear All
                  </button>
                </div>
              )}
              {sortedNotifs.length===0&&<div className="py-16 text-center opacity-30"><Bell className="w-10 h-10 mx-auto mb-3"/><p className="text-[10px] font-black uppercase tracking-widest">No notifications</p></div>}
              {sortedNotifs.map(n => (
                <div key={n.id} onClick={() => handleNotifClick(n)} className={cn('flex items-start gap-3 p-4 rounded-2xl border-2 bg-white cursor-pointer transition-all active:scale-[0.98]', !n.read?'border-primary/20 bg-primary/[0.02]':'border-slate-100')}>
                  <div className="p-2 rounded-xl bg-muted/20 border shrink-0">{NOTIF_ICONS[n.type]||<Bell className="w-4 h-4 text-muted-foreground"/>}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 leading-relaxed">{n.message}</p>
                    <div className="flex items-center gap-2 mt-1"><p className="text-[8px] font-black uppercase text-muted-foreground opacity-40">{format(safeDate(n.createdAt),'MMM d, h:mm a')}</p>{n.link&&<p className="text-[8px] font-black uppercase text-primary/50 flex items-center gap-0.5"><ChevronRight className="w-2.5 h-2.5"/>View</p>}</div>
                  </div>
                  {!n.read&&<div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5"/>}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Appointment action drawer */}
      {drawerApt && (
        <AppointmentDrawer apt={drawerApt} service={drawerSvc}
          onClose={() => { setDrawerApt(null); setDrawerSvc(null); }}
          onAction={handleAptAction} />
      )}

      {/* Request dialog */}
      <Dialog open={isRequestOpen} onOpenChange={v => { if (!v) { setIsRequestOpen(false); setRequestReason(''); setRequestDate(''); setSwapTargetShiftId(''); setSwapTargetStaffId(''); }}}>
        <DialogContent className="sm:max-w-md rounded-[3rem] border-4 shadow-3xl bg-background">
          <DialogHeader className="p-6 pb-0 text-left">
            <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900">Submit Request</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Your manager will be notified.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</Label>
              <Select value={requestType} onValueChange={(v: any) => { setRequestType(v); setSwapTargetShiftId(''); setSwapTargetStaffId(''); }}>
                <SelectTrigger className="h-12 rounded-2xl border-2 font-black uppercase text-[10px]"><SelectValue/></SelectTrigger>
                <SelectContent className="rounded-xl border-2 shadow-2xl">
                  <SelectItem value="day_off" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600"/>Day Off</div></SelectItem>
                  <SelectItem value="swap" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Repeat className="w-4 h-4 text-purple-600"/>Shift Swap</div></SelectItem>
                  <SelectItem value="early_release" className="font-bold uppercase text-[10px]"><div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600"/>Early Release</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Date</Label>
              <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} min={format(today,'yyyy-MM-dd')} className="w-full h-12 rounded-2xl border-2 px-4 font-bold text-sm outline-none bg-white focus:border-primary/40"/>
            </div>
            {requestType==='swap'&&requestDate&&(
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Swap With</Label>
                {myShiftOnRequestDate ? <p className="text-[9px] font-bold text-primary/70 uppercase">Your shift: {fmt12(myShiftOnRequestDate.startTime)} – {fmt12(myShiftOnRequestDate.endTime)}</p>
                  : <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200"><AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0"/><p className="text-[9px] font-bold text-amber-700 uppercase">No shift on this date — swap not allowed</p></div>}
                {shiftsOnRequestDate.length>0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {shiftsOnRequestDate.map(({ shift, member }: any) => (
                      <button key={shift.id} type="button" onClick={() => { setSwapTargetShiftId(shift.id); setSwapTargetStaffId(shift.staffId); }}
                        className={cn('w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left', swapTargetShiftId===shift.id?'border-purple-400 bg-purple-50':'border-slate-200 bg-white hover:border-purple-200')}>
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><p className="font-black text-primary text-sm">{member?.name?.[0]}</p></div>
                        <div className="flex-1 min-w-0"><p className="font-black uppercase text-[10px] truncate">{member?.name?.split(' ')[0]}</p><p className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">{fmt12(shift.startTime)} – {fmt12(shift.endTime)}</p></div>
                        {swapTargetShiftId===shift.id&&<CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0"/>}
                      </button>
                    ))}
                  </div>
                ) : <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed text-center"><p className="text-[9px] font-black uppercase text-muted-foreground opacity-40">No other staff scheduled on this date</p></div>}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Reason</Label>
              <Textarea value={requestReason} onChange={e => setRequestReason(e.target.value)} placeholder="Explain your request..." className="rounded-2xl border-2 min-h-[80px]"/>
            </div>
          </div>
          <DialogFooter className="p-6 pt-0 flex flex-col gap-3">
            <Button onClick={handleSubmitRequest} disabled={isSubmitting||!requestDate||!requestReason.trim()||(requestType==='swap'&&(!swapTargetShiftId||!myShiftOnRequestDate))} className="w-full h-14 rounded-2xl font-black uppercase shadow-xl shadow-primary/20">
              {isSubmitting ? <Loader className="animate-spin"/> : 'Submit Request'}
            </Button>
            <Button variant="ghost" onClick={() => setIsRequestOpen(false)} className="font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function StaffPortalPage({ params }: { params: { tenantId: string } }) {
  const { firestore } = useFirebase();
  const [signedInStaff, setSignedInStaff] = useState<any | null>(null);
  const tenantId = params.tenantId;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSignedInStaff(null), 15 * 60 * 1000);
  }, []);

  useEffect(() => {
    if (!signedInStaff) return;
    resetTimeout();
    const events = ['touchstart','click','keydown'];
    events.forEach(e => window.addEventListener(e, resetTimeout));
    return () => { events.forEach(e => window.removeEventListener(e, resetTimeout)); if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [signedInStaff, resetTimeout]);

  if (!firestore || !tenantId) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-white/40 font-black uppercase text-[10px] tracking-widest animate-pulse">Loading...</p>
    </div>
  );

  if (!signedInStaff) return <PinEntry firestore={firestore} tenantId={tenantId} onSuccess={setSignedInStaff} />;

  return <StaffDashboard staffMember={signedInStaff} tenantId={tenantId} firestore={firestore} onSignOut={() => setSignedInStaff(null)} />;
}