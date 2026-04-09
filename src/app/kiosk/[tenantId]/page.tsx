'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, getDoc, query, where, doc, writeBatch } from 'firebase/firestore';
import {
  type Service, type Staff, type ConsentForm, type Tenant,
  type Client, type PartyMember, type PricingTier, type Appointment
} from '@/lib/data';
import {
  Sparkles, User, ArrowRight, ArrowLeft, Users, Mail, Loader, Clock,
  PlusCircle, Check, Printer, DollarSign, FileSignature, Ban, Star,
  Cake, Delete, CalendarCheck, CheckCircle2, AlertTriangle, Phone, Timer,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { format, parseISO, parse, isSameDay, addMinutes, differenceInMinutes } from 'date-fns';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneInput } from '@/components/ui/phone-input';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { useForm, FormProvider } from 'react-hook-form';
import Link from 'next/link';

// ─── OFFLINE DETECTION HOOK ───────────────────────────────────────────────────
const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return isOnline;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

// FIX 1: check kiosk-specific hours first, then fall back to business schedule
const isKioskOpen = (kioskSettings: any, scheduleProfiles: any[]): { open: boolean; hours?: string } => {
  const now = new Date();
  const dayName = format(now, 'eeee').toLowerCase();

  // If kiosk has its own schedule enabled, use it
  if (kioskSettings?.useSpecificHours && kioskSettings?.kioskSchedule) {
    const dayHours = kioskSettings.kioskSchedule[dayName];
    if (!dayHours?.enabled) return { open: false };
    try {
      const parseTime = (t: string) => parse(t, t.length > 7 ? 'hh:mm a' : 'h:mm a', now);
      return {
        open: now >= parseTime(dayHours.start) && now <= parseTime(dayHours.end),
        hours: `${dayHours.start} – ${dayHours.end}`
      };
    } catch { return { open: true }; }
  }

  // Fall back to business schedule
  const schedule = scheduleProfiles?.[0];
  if (!schedule?.week) return { open: true };
  const dayHours = schedule.week[dayName];
  if (!dayHours?.enabled) return { open: false };
  try {
    const parseTime = (t: string) => parse(t, t.length > 7 ? 'hh:mm a' : 'h:mm a', now);
    return {
      open: now >= parseTime(dayHours.start) && now <= parseTime(dayHours.end),
      hours: `${dayHours.start} – ${dayHours.end}`
    };
  } catch { return { open: true }; }
};

// FIX 6: accurate estimated duration including padding
const calcEstimatedDuration = (memberServiceIds: string[], allServices: Service[]): number => {
  return memberServiceIds.reduce((total, sid) => {
    const svc = allServices.find(s => s.id === sid);
    if (!svc) return total;
    // Primary service includes its own padding; add-ons typically share the main padding
    // but we add their duration. padBefore/padAfter on the service object itself.
    return total + (svc.duration || 0) + (svc.padBefore || 0) + (svc.padAfter || 0);
  }, 0);
};

// ─── THEME SYSTEM (settings-driven, not user-facing in kiosk) ─────────────────
type KioskTheme = 'light' | 'dark' | 'rose' | 'sage' | 'slate';

interface T { // theme tokens
  bg: string; text: string; muted: string; card: string; cardBorder: string;
  btn: string; btnText: string; label: string; inputBg: string; inputBorder: string;
  surface: string;
}

const THEMES: Record<KioskTheme, T> = {
  light: { bg: 'bg-gradient-to-br from-slate-50 via-white to-slate-100', text: 'text-slate-900', muted: 'text-slate-500', card: 'bg-white', cardBorder: 'border-slate-200', btn: 'bg-slate-900 hover:bg-slate-800', btnText: 'text-white', label: 'text-slate-400', inputBg: 'bg-white', inputBorder: 'border-slate-200', surface: 'bg-slate-50' },
  dark:  { bg: 'bg-[#0c0c0f]', text: 'text-white', muted: 'text-white/50', card: 'bg-white/[0.06]', cardBorder: 'border-white/10', btn: 'bg-white hover:bg-white/90', btnText: 'text-black', label: 'text-white/30', inputBg: 'bg-white/[0.06]', inputBorder: 'border-white/10', surface: 'bg-white/[0.03]' },
  rose:  { bg: 'bg-gradient-to-br from-rose-50 via-pink-50 to-white', text: 'text-slate-900', muted: 'text-slate-500', card: 'bg-white', cardBorder: 'border-rose-100', btn: 'bg-rose-500 hover:bg-rose-600', btnText: 'text-white', label: 'text-slate-400', inputBg: 'bg-white', inputBorder: 'border-rose-100', surface: 'bg-rose-50' },
  sage:  { bg: 'bg-gradient-to-br from-emerald-50 via-teal-50 to-white', text: 'text-slate-900', muted: 'text-slate-500', card: 'bg-white', cardBorder: 'border-emerald-100', btn: 'bg-emerald-600 hover:bg-emerald-700', btnText: 'text-white', label: 'text-slate-400', inputBg: 'bg-white', inputBorder: 'border-emerald-100', surface: 'bg-emerald-50' },
  slate: { bg: 'bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900', text: 'text-white', muted: 'text-white/50', card: 'bg-white/[0.08]', cardBorder: 'border-white/15', btn: 'bg-white hover:bg-white/90', btnText: 'text-slate-900', label: 'text-white/30', inputBg: 'bg-white/[0.06]', inputBorder: 'border-white/10', surface: 'bg-white/[0.04]' },
};

const btnStyle = (primaryHex?: string, themeName?: KioskTheme): React.CSSProperties | undefined => {
  if (!primaryHex || themeName === 'dark' || themeName === 'slate') return undefined;
  return { backgroundColor: primaryHex, color: '#fff' };
};

// ─── DARK MESH BACKGROUND ────────────────────────────────────────────────────
const DarkMeshBg = ({ hex }: { hex?: string }) => (
  <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
    <div className="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full opacity-25 blur-[100px]"
      style={{ background: hex ? `${hex}50` : '#7c3aed50' }} />
    <div className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] rounded-full opacity-15 blur-[80px]"
      style={{ background: hex ? `${hex}40` : '#ec489940' }} />
  </div>
);

// ─── SURFACE CARD ─────────────────────────────────────────────────────────────
const SurfaceCard = ({ children, t }: { children: React.ReactNode; t: T }) => (
  <motion.div
    initial={{ opacity: 0, y: 10, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -8, scale: 0.98 }}
    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    className={cn('w-full max-w-2xl mx-auto overflow-hidden border rounded-3xl shadow-xl', t.card, t.cardBorder)}
  >
    {children}
  </motion.div>
);

// ─── STEP DOTS ────────────────────────────────────────────────────────────────
const StepDots = ({ total, current, t, hex }: { total: number; current: number; t: T; hex?: string }) => (
  <div className="flex items-center gap-1.5">
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} className="h-1.5 rounded-full transition-all duration-500"
        style={{
          width: i === current ? '1.5rem' : '0.5rem',
          backgroundColor: i <= current ? (hex || (t.text === 'text-white' ? '#fff' : '#0f172a')) : 'currentColor',
          opacity: i === current ? 1 : i < current ? 0.4 : 0.2,
        }} />
    ))}
  </div>
);

// ─── CHOICE TILE ──────────────────────────────────────────────────────────────
const ChoiceTile = ({ onClick, icon: Icon, title, subtitle, t, hex }: any) => (
  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={onClick}
    className={cn('flex flex-col items-center justify-center p-8 md:p-10 rounded-2xl border-2 transition-all cursor-pointer text-center', t.card, t.cardBorder, 'hover:shadow-lg')}>
    <div className={cn('mb-4 p-4 rounded-xl', t.surface)}>
      <Icon className={cn('w-10 h-10 md:w-12 md:h-12', t.muted)} strokeWidth={1.3} />
    </div>
    <p className={cn('text-lg md:text-xl font-black uppercase tracking-tight leading-none mb-1.5', t.text)}>{title}</p>
    <p className={cn('text-[10px] font-bold uppercase tracking-[0.2em]', t.muted)}>{subtitle}</p>
  </motion.button>
);

// ─── FIX 3: WAIT TIME PANEL (replaces full floor grid) ───────────────────────
// Shows: estimated wait for this guest + optional floor toggle
const WaitTimePanel = ({ waitIns, staff, appointments, services, showFloor, onToggleFloor, t }: {
  waitIns: any[]; staff: Staff[] | null; appointments: Appointment[];
  services: Service[] | null; showFloor: boolean; onToggleFloor: () => void; t: T;
}) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(i); }, []);

  // How many people are ahead in queue
  const queueAhead = (waitIns || []).filter(w => w.status === 'waiting').length;

  // Active staff (no break, no event block now)
  const availableCount = (staff || []).filter(s => s.active && !(s as any).onBreak && s.status !== 'busy').length;

  // Staff in service with estimated free times
  const inService = useMemo(() => {
    return (staff || []).filter(s => s.active && s.status === 'busy').map(s => {
      const apt = appointments.find(a => a.staffId === s.id && a.status === 'servicing');
      let mins: number | null = null;
      if (apt?.endTime) {
        const m = differenceInMinutes(safeDate(apt.endTime), now);
        if (m > 0) mins = m;
      }
      return { ...s, estFree: mins };
    });
  }, [staff, appointments, now]);

  const shortestWait = inService.filter(s => s.estFree !== null).length > 0
    ? Math.min(...inService.filter(s => s.estFree !== null).map(s => s.estFree!))
    : null;

  return (
    <div className={cn('rounded-2xl border-2 overflow-hidden', t.card, t.cardBorder)}>
      {/* Main wait summary */}
      <div className="p-5 text-center space-y-1">
        {availableCount > 0 ? (
          <>
            <p className={cn('text-[9px] font-black uppercase tracking-[0.25em]', t.muted)}>Estimated Wait</p>
            <p className={cn('text-3xl font-black', t.text)}>Ready Now</p>
            <p className={cn('text-[10px] font-bold uppercase', t.muted)}>
              {availableCount} provider{availableCount > 1 ? 's' : ''} available
            </p>
          </>
        ) : shortestWait !== null ? (
          <>
            <p className={cn('text-[9px] font-black uppercase tracking-[0.25em]', t.muted)}>Estimated Wait</p>
            <p className={cn('text-3xl font-black', t.text)}>~{shortestWait}m</p>
            {queueAhead > 0 && <p className={cn('text-[10px] font-bold uppercase', t.muted)}>{queueAhead} guest{queueAhead > 1 ? 's' : ''} ahead of you</p>}
          </>
        ) : (
          <>
            <p className={cn('text-[9px] font-black uppercase tracking-[0.25em]', t.muted)}>Floor Status</p>
            <p className={cn('text-xl font-black', t.muted)}>Checking in…</p>
          </>
        )}
      </div>

      {/* Toggle to show full floor */}
      <div className={cn('flex items-center justify-between px-5 py-3 border-t', t.cardBorder)}>
        <p className={cn('text-[9px] font-black uppercase tracking-widest', t.muted)}>Show Staff Status</p>
        <Switch checked={showFloor} onCheckedChange={onToggleFloor} className="scale-90" />
      </div>

      {/* Optional floor grid */}
      <AnimatePresence>
        {showFloor && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 border-t', t.cardBorder)}>
              {(staff || []).filter(s => s.active).map(s => {
                const isOnBreak = (s as any).onBreak;
                const isBusy = s.status === 'busy';
                const apt = appointments.find(a => a.staffId === s.id && a.status === 'servicing');
                const est = apt?.endTime ? Math.max(0, differenceInMinutes(safeDate(apt.endTime), now)) : null;
                const label = isOnBreak ? 'Break' : isBusy ? 'In Service' : 'Available';
                const dot = isOnBreak ? 'bg-amber-400' : isBusy ? 'bg-blue-500' : 'bg-emerald-500';
                return (
                  <div key={s.id} className={cn('flex items-center gap-2 p-2.5 rounded-xl border', t.surface, t.cardBorder)}>
                    <div className="relative shrink-0">
                      <Avatar className="w-8 h-8 rounded-lg">
                        <AvatarImage src={s.avatarUrl} className="object-cover" />
                        <AvatarFallback className={cn('text-xs font-black', t.text)}>{(s.name || 'S').charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className={cn('absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full border border-white', dot)} />
                    </div>
                    <div className="min-w-0">
                      <p className={cn('text-[10px] font-black uppercase truncate', t.text)}>{s.name?.split(' ')[0]}</p>
                      <p className={cn('text-[8px] font-bold uppercase', t.muted)}>
                        {label}{est !== null && est > 0 ? ` ~${est}m` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── GUEST NAMES VIEW ─────────────────────────────────────────────────────────
// Shown AFTER primary identity is resolved — names pre-filled if returning guest
// FIX 5: comes after identity, no double entry
const GuestNamesView = ({ members, onChangeName, onConfirm, onBack, t, hex }: {
  members: PartyMember[]; onChangeName: (idx: number, name: string) => void;
  onConfirm: () => void; onBack: () => void; t: T; hex?: string;
}) => {
  const allNamed = members.every(m => m.name.trim().length > 0);
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="text-center space-y-1">
        <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Party of {members.length}</p>
        <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>Guest Names</h2>
        <p className={cn('text-sm font-bold uppercase tracking-[0.15em]', t.muted)}>Each guest gets their own queue ticket</p>
      </div>
      <div className="space-y-3">
        {members.map((m, idx) => (
          <div key={m.id} className={cn('flex items-center gap-3 p-4 rounded-2xl border-2', t.card, t.cardBorder)}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black shrink-0 text-white"
              style={{ backgroundColor: idx === 0 ? (hex || '#0f172a') : undefined }}
              className={cn('w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black shrink-0', idx === 0 ? '' : cn(t.surface, t.muted))}>
              {idx + 1}
            </div>
            <div className="flex-1">
              <label className={cn('text-[8px] font-black uppercase tracking-widest', t.label)}>
                {idx === 0 ? 'Primary Guest' : `Guest ${idx + 1}`}
              </label>
              <input
                value={m.name}
                onChange={e => onChangeName(idx, e.target.value)}
                placeholder={idx === 0 ? 'Your name' : `Guest ${idx + 1} name`}
                className={cn('w-full h-10 rounded-xl border-2 px-3 text-sm font-bold outline-none transition-all uppercase tracking-tight mt-0.5', t.inputBg, t.inputBorder, t.text, 'placeholder:opacity-30')}
              />
            </div>
            {idx === 0 && m.name && (
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            )}
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <button onClick={onConfirm} disabled={!allNamed}
          className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-30', t.btn, t.btnText)}
          style={btnStyle(hex)}>
          Set Up Services <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={onBack} className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70')}>← Back</button>
      </div>
    </div>
  );
};

// ─── MEMBER DETAILS STEP ──────────────────────────────────────────────────────
const StepDetails = ({ member, onUpdate, primaryMember, isGroup, bannedClient, existingClientWithBalance, isResolvingIdentity, isKnownClient, clientType, t }: any) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <label className={cn('text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5', t.label)}><Phone className="w-3 h-3" /> Phone</label>
      <PhoneInput name={`phone-${member.id}`} international defaultCountry="US" value={member.phone || ''} onChange={v => onUpdate({ phone: v || '' })} placeholder="(555) 000-0000"
        className={cn('h-14 w-full rounded-2xl border-2 px-4 text-lg font-bold transition-all', t.inputBg, t.inputBorder, t.text, '[&_input]:border-none [&_input]:bg-transparent [&_input]:placeholder:opacity-30')} />
    </div>
    {/* Name is already captured — show read-only unless they want to change it */}
    <div className="space-y-2">
      <label className={cn('text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5', t.label)}><User className="w-3 h-3" /> Full Name</label>
      <input value={member.name} onChange={e => onUpdate({ name: e.target.value })} placeholder="Your full name"
        className={cn('w-full h-14 rounded-2xl border-2 px-4 text-lg font-bold outline-none transition-all uppercase tracking-tight', t.inputBg, t.inputBorder, t.text, 'placeholder:opacity-30')} />
    </div>
    {/* FIX 5b: Copy contact copies BOTH phone AND email */}
    {isGroup && !member.isPrimary && primaryMember && (
      <button onClick={() => onUpdate({ phone: primaryMember.phone || '', email: primaryMember.email || '' })}
        className={cn('w-full h-10 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all', t.card, t.cardBorder, t.muted, 'hover:opacity-70')}>
        Copy {primaryMember.name?.split(' ')[0] || 'primary'}'s phone &amp; email
      </button>
    )}
    <div className="space-y-2">
      <label className={cn('text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5', t.label)}><Mail className="w-3 h-3" /> Email</label>
      <input type="email" value={member.email || ''} onChange={e => onUpdate({ email: e.target.value })} placeholder="your@email.com"
        className={cn('w-full h-14 rounded-2xl border-2 px-4 text-lg font-bold outline-none transition-all', t.inputBg, t.inputBorder, t.text, 'placeholder:opacity-30')} />
    </div>
    <AnimatePresence>
      {isResolvingIdentity && <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn('flex items-center gap-2 py-2 justify-center text-[9px] font-black uppercase tracking-widest', t.muted)}><Loader className="w-3 h-3 animate-spin" /> Checking…</motion.div>}
      {isKnownClient && clientType === 'new' && !bannedClient && !existingClientWithBalance && (
        <motion.div key="k" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div><p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1">Profile Found</p><p className="text-[9px] font-bold text-amber-600 uppercase">Go back and select <strong>Return Guest</strong>.</p></div>
        </motion.div>
      )}
      {bannedClient && (
        <motion.div key="b" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex gap-3">
          <Ban className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div><p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">Access Restricted</p><p className="text-[9px] font-bold text-red-500 uppercase">{bannedClient.banMessage || 'Please see front desk.'}</p></div>
        </motion.div>
      )}
      {existingClientWithBalance && !bannedClient && (
        <motion.div key="bal" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex gap-3">
          <DollarSign className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div><p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">Balance Due</p><p className="text-[9px] font-bold text-red-500 uppercase">${existingClientWithBalance.outstandingBalance?.toFixed(2)} — settle at desk first.</p></div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// ─── SERVICE SELECTION ────────────────────────────────────────────────────────
const ServiceTile = ({ service, isSelected, onToggle, t, hex }: any) => {
  const minPrice = useMemo(() => { if (!service.serviceTiers?.length) return service.price; return Math.min(...service.serviceTiers.map((st: any) => st.price)); }, [service]);
  return (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onToggle}
      className={cn('relative flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all text-center gap-2.5', isSelected ? 'border-transparent shadow-lg' : `${t.card} ${t.cardBorder} ${t.text} hover:opacity-80`)}
      style={isSelected ? (btnStyle(hex) || { backgroundColor: '#0f172a', color: '#fff' }) : undefined}>
      {isSelected && <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center"><Check className="w-2.5 h-2.5" /></div>}
      <div className={cn('p-3 rounded-xl', isSelected ? 'bg-white/20' : t.surface)}><Sparkles className={cn('w-6 h-6', isSelected ? '' : t.muted)} strokeWidth={1.5} /></div>
      <p className="text-[10px] font-black uppercase tracking-tight leading-tight">{service.name}</p>
      <p className={cn('text-[9px] font-black font-mono', isSelected ? 'opacity-70' : t.muted)}>${minPrice?.toFixed(0) ?? 0}+</p>
    </motion.button>
  );
};

const StepServices = ({ member, onUpdate, services, t, hex }: any) => {
  const mainServices = useMemo(() => (services || []).filter((s: Service) => s.type === 'service'), [services]);
  const selectedMainId = useMemo(() => member.serviceIds.find((id: string) => mainServices.some((s: Service) => s.id === id)), [member.serviceIds, mainServices]);
  const selectedMain = useMemo(() => (services || []).find((s: Service) => s.id === selectedMainId), [services, selectedMainId]);
  const categories = useMemo(() => Array.from(new Set(mainServices.map((s: Service) => s.category || 'Standard'))).sort() as string[], [mainServices]);
  const addOns = useMemo(() => selectedMain ? (services || []).filter((s: Service) => s.type === 'addon' && (selectedMain.compatibleAddOnIds || []).includes(s.id)) : [], [services, selectedMain]);
  const [view, setView] = useState<'cat' | 'main' | 'addon'>(selectedMainId ? 'addon' : 'cat');
  const [cat, setCat] = useState<string | null>(null);
  return (
    <AnimatePresence mode="wait">
      {view === 'cat' && <motion.div key="cat" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-3">
        <p className={cn('text-[9px] font-black uppercase tracking-[0.2em]', t.label)}>Choose category</p>
        {categories.map(c => <motion.button key={c} whileTap={{ scale: 0.98 }} onClick={() => { setCat(c); setView('main'); }} className={cn('w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all', t.card, t.cardBorder, t.text, 'hover:opacity-80')}><span className="font-black uppercase tracking-tight text-base">{c}</span><ArrowRight className={cn('w-4 h-4', t.muted)} /></motion.button>)}
      </motion.div>}
      {view === 'main' && <motion.div key="main" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
        <div className="flex items-center gap-3"><button onClick={() => setView('cat')} className={cn('flex items-center gap-1 text-[9px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70')}><ArrowLeft className="w-3 h-3" /> Back</button><p className={cn('flex-1 text-center text-[9px] font-black uppercase tracking-[0.2em]', t.muted)}>{cat}</p></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{mainServices.filter((s: Service) => (s.category || 'Standard') === cat).map((svc: Service) => <ServiceTile key={svc.id} service={svc} isSelected={member.serviceIds.includes(svc.id)} t={t} hex={hex} onToggle={() => { onUpdate({ serviceIds: [svc.id] }); if ((services || []).filter((s: Service) => s.type === 'addon' && (svc.compatibleAddOnIds || []).includes(s.id)).length > 0) setView('addon'); }} />)}</div>
      </motion.div>}
      {view === 'addon' && <motion.div key="addon" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
        <div className="flex items-center gap-3"><button onClick={() => setView('main')} className={cn('flex items-center gap-1 text-[9px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70')}><ArrowLeft className="w-3 h-3" /> Change</button><div className={cn('flex-1 text-center px-2 py-1 rounded-xl border', t.card, t.cardBorder)}><p className={cn('text-[9px] font-black uppercase tracking-tight truncate', t.muted)}>Selected: {selectedMain?.name}</p></div></div>
        {addOns.length > 0 ? <><p className={cn('text-[9px] font-black uppercase tracking-[0.2em]', t.label)}>Add-ons (optional)</p><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{addOns.map((addon: Service) => <ServiceTile key={addon.id} service={addon} t={t} hex={hex} isSelected={member.serviceIds.includes(addon.id)} onToggle={() => { const has = member.serviceIds.includes(addon.id); onUpdate({ serviceIds: has ? member.serviceIds.filter((id: string) => id !== addon.id) : [...member.serviceIds, addon.id] }); }} />)}</div></> : <p className={cn('text-center py-4 text-[9px] font-black uppercase tracking-widest', t.muted)}>No add-ons available</p>}
      </motion.div>}
    </AnimatePresence>
  );
};

// ─── STAFF PREFERENCE ─────────────────────────────────────────────────────────
const StepStaff = ({ member, onUpdate, staff, t, hex }: any) => (
  <div className="space-y-4">
    <p className={cn('text-[9px] font-black uppercase tracking-[0.2em]', t.label)}>Provider preference</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <button onClick={() => onUpdate({ preferredStaffId: 'any' })}
        className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all', (!member.preferredStaffId || member.preferredStaffId === 'any') ? 'border-transparent shadow-md text-white' : `${t.card} ${t.cardBorder} ${t.text}`)}
        style={(!member.preferredStaffId || member.preferredStaffId === 'any') ? (btnStyle(hex) || { backgroundColor: '#0f172a', color: '#fff' }) : undefined}>
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center"><Users className="w-6 h-6" strokeWidth={1.3} /></div>
        <p className="text-[9px] font-black uppercase tracking-tight">First Available</p>
      </button>
      {(staff || []).map((s: Staff) => (
        <button key={s.id} onClick={() => onUpdate({ preferredStaffId: s.id })}
          className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all relative', member.preferredStaffId === s.id ? 'border-transparent shadow-md' : `${t.card} ${t.cardBorder} ${t.text}`)}
          style={member.preferredStaffId === s.id ? (btnStyle(hex) || { backgroundColor: '#0f172a', color: '#fff' }) : undefined}>
          {member.preferredStaffId === s.id && <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center"><Check className="w-2.5 h-2.5" /></div>}
          <Avatar className="w-12 h-12 rounded-xl"><AvatarImage src={s.avatarUrl} className="object-cover" /><AvatarFallback className={cn('font-black text-sm', t.text)}>{(s.name || 'S').charAt(0)}</AvatarFallback></Avatar>
          <p className="text-[9px] font-black uppercase tracking-tight truncate max-w-[80px]">{s.name?.split(' ')[0]}</p>
        </button>
      ))}
    </div>
    {member.preferredStaffId && member.preferredStaffId !== 'any' && (
      <div className={cn('flex items-center justify-between p-4 rounded-2xl border-2', t.card, t.cardBorder)}>
        <div><p className={cn('text-[10px] font-black uppercase tracking-widest', t.text)}>Wait for this provider?</p><p className={cn('text-[9px] font-bold uppercase mt-0.5', t.muted)}>May increase wait time</p></div>
        <Switch checked={member.waitForPreferredStaff} onCheckedChange={v => onUpdate({ waitForPreferredStaff: v })} />
      </div>
    )}
  </div>
);

const StepConsents = ({ requiredForms, formAnswers, setFormAnswers, t }: any) => (
  <div className="space-y-5">
    {requiredForms.map((form: ConsentForm) => (
      <div key={form.id} className={cn('space-y-5 p-5 rounded-2xl border-2', t.card, t.cardBorder)}>
        <h3 className={cn('font-black uppercase tracking-tight flex items-center gap-2 text-sm', t.text)}><FileSignature className={cn('w-4 h-4', t.muted)} />{form.title}</h3>
        {form.fields?.map((field: any) => <FormFieldRenderer key={field.id} field={field} value={formAnswers[form.id]?.[field.id]} onChange={val => setFormAnswers({ ...formAnswers, [form.id]: { ...(formAnswers[form.id] || {}), [field.id]: val } })} />)}
      </div>
    ))}
  </div>
);

// ─── MEMBER SETUP ─────────────────────────────────────────────────────────────
type MemberSubStep = 'details' | 'services' | 'consents' | 'staff';

const MemberSetup = ({ member, onUpdate, partyMembers, memberSubStep, services, staff, consentForms, formAnswers, setFormAnswers, onNext, onBack, isGroup, isLastMember, onFinishedGuest, onSubmit, isSubmitting, bannedClient, existingClientWithBalance, isResolvingIdentity, matchedAppointment, onAppointmentCheckIn, dayAccessTier, isKnownClient, clientType, t, hex }: any) => {
  const primaryService = (services || []).find((s: Service) => s.id === member.serviceIds[0]);
  const requiredForms = (consentForms || []).filter((f: ConsentForm) => primaryService?.requiredFormIds?.includes(f.id));
  const subSteps: MemberSubStep[] = ['details', 'services'];
  if (requiredForms.length > 0) subSteps.push('consents');
  subSteps.push('staff');
  const idx = subSteps.indexOf(memberSubStep);
  const hasNext = idx < subSteps.length - 1;
  const isBlocked = !!bannedClient || !!existingClientWithBalance || isResolvingIdentity || (isKnownClient && clientType === 'new');
  const stepLabel: Record<MemberSubStep, string> = { details: 'Your Info', services: 'Treatment', consents: 'Agreements', staff: 'Preference' };
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {isGroup && <p className={cn('text-[9px] font-black uppercase tracking-[0.2em] mb-1', t.muted)}>Guest {member.index + 1} of {partyMembers.length}</p>}
          <h2 className={cn('text-2xl md:text-3xl font-black uppercase tracking-tight leading-none', t.text)}>{stepLabel[memberSubStep]}</h2>
          {isGroup && member.name && <p className={cn('text-sm font-bold uppercase tracking-widest mt-1', t.muted)}>for {member.name}</p>}
        </div>
        <StepDots total={subSteps.length} current={idx} t={t} hex={hex} />
      </div>
      {memberSubStep === 'details' && matchedAppointment && (
        <div className={cn('p-4 rounded-2xl border-2 space-y-3', t.card, t.cardBorder)}>
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-xl', t.surface)}><CalendarCheck className={cn('w-5 h-5', t.text)} /></div>
            <div><p className={cn('text-[9px] font-black uppercase tracking-widest', t.muted)}>Appointment Found</p><p className={cn('text-sm font-black uppercase', t.text)}>{services?.find((s: any) => s.id === matchedAppointment.serviceId)?.name}</p></div>
          </div>
          <button onClick={() => onAppointmentCheckIn(matchedAppointment)} className={cn('w-full h-12 rounded-xl font-black uppercase text-sm', t.btn, t.btnText)} style={btnStyle(hex)}>Check In for This Appointment →</button>
          <p className={cn('text-center text-[8px] font-black uppercase tracking-widest', t.muted)}>Or continue below to change services</p>
        </div>
      )}
      {memberSubStep === 'details' && dayAccessTier === 'members' && <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-4"><p className="text-[9px] font-black uppercase tracking-widest text-indigo-600 mb-1">Members Priority Day</p><p className="text-[9px] font-bold text-indigo-500 uppercase">Today is reserved for Club Members only.</p></div>}
      <AnimatePresence mode="wait">
        <motion.div key={memberSubStep} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
          {memberSubStep === 'details' && <StepDetails member={member} onUpdate={onUpdate} isGroup={isGroup} primaryMember={partyMembers?.[0]} bannedClient={bannedClient} existingClientWithBalance={existingClientWithBalance} isResolvingIdentity={isResolvingIdentity} isKnownClient={isKnownClient} clientType={clientType} t={t} />}
          {memberSubStep === 'services' && <StepServices member={member} onUpdate={onUpdate} services={services} t={t} hex={hex} />}
          {memberSubStep === 'consents' && <StepConsents requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} t={t} />}
          {memberSubStep === 'staff' && <StepStaff member={member} onUpdate={onUpdate} staff={staff} t={t} hex={hex} />}
        </motion.div>
      </AnimatePresence>
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} disabled={isSubmitting} className={cn('h-14 px-5 rounded-2xl border-2 font-black uppercase text-sm', t.card, t.cardBorder, t.muted, 'hover:opacity-70')}>←</button>
        <div className="flex-1 flex gap-3">
          {hasNext ? (
            <button onClick={() => onNext(subSteps[idx + 1])} disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)} className={cn('flex-1 h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-30', t.btn, t.btnText)} style={btnStyle(hex)}>Continue <ArrowRight className="w-4 h-4" /></button>
          ) : (
            <>
              {isGroup && !isLastMember && <button onClick={onFinishedGuest} disabled={isSubmitting || isBlocked || member.serviceIds.length === 0} className={cn('flex-1 h-14 rounded-2xl border-2 font-black uppercase text-sm disabled:opacity-30', t.card, t.cardBorder, t.text)}>Next Guest →</button>}
              <button onClick={onSubmit} disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)} className={cn('flex-1 h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-30', t.btn, t.btnText)} style={btnStyle(hex)}>
                {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : 'Complete ✓'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── CONFIRMATION ─────────────────────────────────────────────────────────────
const ConfirmationScreen = ({ confirmedParty, onPrint, onDone, staff, liveAppointments, services, walkIns, t, hex, studioName, studioLogoUrl }: any) => {
  const [showFloor, setShowFloor] = useState(false);
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="text-center space-y-2">
        <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 12, stiffness: 140 }}
          className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </motion.div>
        <h2 className={cn('text-4xl font-black uppercase tracking-tighter', t.text)}>You're In!</h2>
        <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>
          {confirmedParty.length > 1 ? `${confirmedParty.length} tickets — print one per guest` : "We'll notify you when it's your turn"}
        </p>
      </div>

      {/* Per-guest ticket cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {confirmedParty.map((ticket: WalkInTicketData, i: number) => (
          <motion.div key={ticket.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className={cn('flex items-center justify-between p-4 rounded-2xl border-2', t.card, t.cardBorder)}>
            <div>
              <p className={cn('text-[8px] font-black uppercase tracking-[0.2em] mb-0.5', t.muted)}>Queue #{ticket.queuePosition}</p>
              <p className={cn('text-lg font-black uppercase tracking-tight leading-none', t.text)}>{ticket.name}</p>
              <p className={cn('text-[9px] font-bold uppercase mt-1 truncate max-w-[140px]', t.muted)}>{ticket.services.map((s: Service) => s.name).join(' + ')}</p>
            </div>
            <button onClick={() => onPrint({ ...ticket, studioName, studioLogoUrl })}
              className={cn('w-10 h-10 rounded-xl border-2 flex items-center justify-center shrink-0', t.card, t.cardBorder, 'hover:opacity-70')}>
              <Printer className={cn('w-4 h-4', t.muted)} />
            </button>
          </motion.div>
        ))}
      </div>

      {confirmedParty.length > 1 && (
        <button onClick={() => confirmedParty.forEach((ticket: WalkInTicketData) => onPrint({ ...ticket, studioName, studioLogoUrl }))}
          className={cn('w-full h-11 rounded-2xl border-2 font-black uppercase tracking-widest text-xs', t.card, t.cardBorder, t.text, 'hover:opacity-80')}>
          Print All {confirmedParty.length} Tickets
        </button>
      )}

      {/* Wait time panel — FIX 3 */}
      <WaitTimePanel
        waitIns={walkIns || []} staff={staff} appointments={liveAppointments || []}
        services={services} showFloor={showFloor} onToggleFloor={() => setShowFloor(p => !p)} t={t}
      />

      <button onClick={onDone} className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest', t.btn, t.btnText)} style={btnStyle(hex)}>Done</button>
    </div>
  );
};

// ─── BIRTHDAY ─────────────────────────────────────────────────────────────────
const BirthdayView = ({ name, onDone, t, hex }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn('fixed inset-0 z-[200] flex flex-col items-center justify-center p-6 text-center', t.bg)}>
    {Array.from({ length: 12 }).map((_, i) => (
      <motion.div key={i} initial={{ y: -20, opacity: 0 }} animate={{ y: '110vh', opacity: [0, 1, 1, 0] }} transition={{ delay: i * 0.18, duration: 2.5, repeat: Infinity }} className="absolute text-2xl" style={{ left: `${(i / 12) * 100}%`, top: '-5%' }}>
        {['✨','🎉','🎊','💐','⭐'][i % 5]}
      </motion.div>
    ))}
    <div className="relative z-10 space-y-8 max-w-sm">
      <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }} className={cn('w-28 h-28 mx-auto rounded-3xl border-2 flex items-center justify-center', t.card, t.cardBorder)}><Cake className={cn('w-14 h-14', t.text)} strokeWidth={1} /></motion.div>
      <div><h2 className={cn('text-5xl font-black leading-none', t.text)}>Happy Birthday,<br /><span className={cn('italic font-light', t.muted)}>{name.split(' ')[0]}!</span></h2><p className={cn('font-bold uppercase tracking-[0.2em] text-sm mt-3', t.muted)}>Celebrating with us today</p></div>
      <button onClick={onDone} className={cn('h-14 px-10 rounded-full font-black uppercase tracking-widest', t.btn, t.btnText)} style={btnStyle(hex)}>Continue →</button>
    </div>
  </motion.div>
);

// ─── CLOSED ───────────────────────────────────────────────────────────────────
const ClosedView = ({ hours, logoUrl, tenantName, t }: any) => (
  <div className={cn('text-center space-y-6 max-w-sm mx-auto p-10 rounded-3xl border-2', t.card, t.cardBorder)}>
    <div className={cn('w-20 h-20 mx-auto rounded-3xl border-2 flex items-center justify-center', t.card, t.cardBorder)}>
      {logoUrl ? <Image src={logoUrl} alt={tenantName || 'Studio'} width={48} height={48} className="object-cover rounded-xl" /> : <Clock className={cn('w-8 h-8', t.muted)} />}
    </div>
    <div><h1 className={cn('text-3xl font-black uppercase tracking-tighter', t.text)}>Closed</h1><p className={cn('font-bold uppercase tracking-[0.15em] text-xs mt-2', t.muted)}>Kiosk available during business hours</p></div>
    {hours && <div className={cn('p-4 rounded-2xl border-2', t.card, t.cardBorder)}><p className={cn('text-[8px] font-black uppercase tracking-[0.2em] mb-1', t.muted)}>Today's Hours</p><p className={cn('font-black text-lg', t.text)}>{hours}</p></div>}
    <Link href="/" className={cn('block w-full h-12 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center', t.btn, t.btnText)}>Return Home</Link>
  </div>
);

// ─── STEP TYPE ────────────────────────────────────────────────────────────────
// FIX 5: guestNames now comes AFTER identity is resolved (after welcomeBack/identityConfirm)
// New flow: partyType → partySize → identityChoice → [phonePad → identityConfirm → welcomeBack] → guestNames → memberSetup×N → confirmation
type Step = 'partyType' | 'partySize' | 'identityChoice' | 'phonePad' | 'identityConfirm' | 'welcomeBack' | 'guestNames' | 'memberSetup' | 'confirmation';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function WalkInPage() {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const params = useParams();
  const tenantId = params.tenantId as string;
  const methods = useForm({ defaultValues: { name: '', email: '', phone: '' } });

  const tenantRef    = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQ    = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQ       = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const schedulesQ   = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where('isActive', '==', true)), [firestore, tenantId]);
  const consentsQ    = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  // No realtime clients listener — looked up lazily via getDocs only when needed
  // Live appointments for floor view (servicing + confirmed)
  const liveAptsQ    = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/appointments`), where('status', 'in', ['confirmed', 'servicing'])), [firestore, tenantId]);
  // Today's events — to filter out staff with event blocks (FIX 2)
  const eventsQ      = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/events`), where('date', '==', format(new Date(), 'yyyy-MM-dd'))), [firestore, tenantId]);
  // Live walk-in queue for wait estimate
  const walkInsQ     = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/walkIns`), where('status', '==', 'waiting')), [firestore, tenantId]);

  const { data: tenant }           = useDoc<Tenant>(tenantRef);
  const { data: services }         = useCollection<Service>(servicesQ);
  const { data: staff }            = useCollection<Staff>(staffQ);
  const { data: scheduleProfiles } = useCollection<any>(schedulesQ);
  const { data: consentForms }     = useCollection<ConsentForm>(consentsQ);
  const { data: liveAppointments } = useCollection<Appointment>(liveAptsQ);
  const { data: events }           = useCollection<any>(eventsQ);
  const { data: walkIns }          = useCollection<any>(walkInsQ);

  // Theme — entirely from kioskSettings
  const kioskSettings = tenant?.kioskSettings;
  const logoUrl       = kioskSettings?.logoUrl;
  const wordmarkUrl   = kioskSettings?.wordmarkUrl;
  const showWordmark  = kioskSettings?.showWordmark !== false;
  const primaryHex    = kioskSettings?.primaryColor || undefined;
  const themeName     = (kioskSettings?.theme as KioskTheme) || 'light';
  const t             = THEMES[themeName];

  // FIX 2: filter out staff who have an event block RIGHT NOW
  const activeStaff = useMemo(() => {
    const now = new Date();
    return (staff || []).filter(s => {
      if (!s.active || (s as any).onBreak) return false;
      // Check if this staff member has an event block covering now
      const blockedByEvent = (events || []).some(ev => {
        if (!(ev.staffIds || []).includes(s.id) && (ev.staffIds || []).length > 0) return false;
        const evStart = safeDate(ev.startTime || ev.start);
        const evEnd   = safeDate(ev.endTime   || ev.end);
        return evStart <= now && evEnd >= now;
      });
      return !blockedByEvent;
    });
  }, [staff, events]);

  // Flow state
  const [entered, setEntered]             = useState(false);
  const [step, setStep]                   = useState<Step>('partyType');
  const [isGroup, setIsGroup]             = useState(false);
  const [partySize, setPartySize]         = useState(1);
  const [partyMembers, setPartyMembers]   = useState<PartyMember[]>([]);
  const [currentIdx, setCurrentIdx]       = useState(0);
  const [memberSubStep, setMemberSubStep] = useState<MemberSubStep>('details');
  const [formAnswers, setFormAnswers]     = useState<Record<string, Record<string, any>>>({});
  const [confirmedParty, setConfirmedParty] = useState<WalkInTicketData[]>([]);
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [ticketToPrint, setTicketToPrint] = useState<WalkInTicketData | null>(null);
  const [isPrintOpen, setIsPrintOpen]     = useState(false);

  // Identity state
  const [existingBalance, setExistingBalance] = useState<Client | null>(null);
  const [bannedClient, setBannedClient]       = useState<Client | null>(null);
  const [isResolving, setIsResolving]         = useState(false);
  const [matchedApt, setMatchedApt]           = useState<Appointment | null>(null);
  const [matchedClient, setMatchedClient]     = useState<Client | null>(null);
  const [isKnownClient, setIsKnownClient]     = useState(false);
  const [clientType, setClientType]           = useState<'new' | 'returning' | null>(null);
  const [phoneVal, setPhoneVal]               = useState('');
  const [showBirthday, setShowBirthday]       = useState(false);
  const [birthdayName, setBirthdayName]       = useState('');

  const activeDaySchedule = useMemo(() => {
    const day = format(new Date(), 'eeee').toLowerCase();
    return scheduleProfiles?.[0]?.week?.[day] || null;
  }, [scheduleProfiles]);

  const isOnline = useOnlineStatus();

  // FIX 1: use kiosk-specific hours
  const kioskOpenStatus = useMemo(() => isKioskOpen(kioskSettings, scheduleProfiles || []), [kioskSettings, scheduleProfiles]);

  // ── Identity resolution ────────────────────────────────────────────────────
  const resolveIdentity = useCallback(async (
    email?: string, phone?: string, callerType?: 'new' | 'returning' | null
  ): Promise<{ isBanned: boolean; hasBalance: boolean; isKnown: boolean; client: any }> => {
    const empty = { isBanned: false, hasBalance: false, isKnown: false, client: null };
    if (!firestore || !tenantId || (!email && !phone)) return empty;
    setIsResolving(true);
    try {
      const ref = collection(firestore, 'tenants', tenantId, 'clients');
      const snaps = await Promise.all([
        ...(email ? [getDocs(query(ref, where('email', '==', email.toLowerCase().trim())))] : []),
        ...(phone ? [getDocs(query(ref, where('phone', '==', phone)))] : []),
      ]);
      const allDocs = snaps.flatMap(s => s.docs);
      if (allDocs.length > 0) {
        const d = allDocs[0];
        const c = { ...d.data() as Client, id: d.id };
        setMatchedClient(c);
        if (c.status === 'banned') { setBannedClient(c); setExistingBalance(null); setMatchedApt(null); setIsKnownClient(false); return { isBanned: true, hasBalance: false, isKnown: false, client: c }; }
        if ((c.outstandingBalance || 0) > 0) { setExistingBalance(c); setBannedClient(null); setMatchedApt(null); setIsKnownClient(false); return { isBanned: false, hasBalance: true, isKnown: false, client: c }; }
        setBannedClient(null); setExistingBalance(null);
        const effective = callerType ?? clientType;
        if (effective === 'new') { setIsKnownClient(true); return { isBanned: false, hasBalance: false, isKnown: true, client: c }; }
        else {
          setIsKnownClient(false);
          const aptSnap = await getDocs(query(collection(firestore, 'tenants', tenantId, 'appointments'), where('clientId', '==', d.id), where('status', '==', 'confirmed')));
          const todayApt = aptSnap.docs.map(ad => ({ ...ad.data(), id: ad.id } as Appointment)).find(a => isSameDay(safeDate(a.startTime), new Date()));
          setMatchedApt(todayApt || null);
          return { isBanned: false, hasBalance: false, isKnown: false, client: c };
        }
      } else {
        setBannedClient(null); setExistingBalance(null); setMatchedApt(null); setMatchedClient(null); setIsKnownClient(false);
        if ((callerType ?? clientType) === 'returning' && step === 'phonePad') {
          toast({ variant: 'destructive', title: 'Profile Not Found', description: 'Continuing as new guest.' });
          setClientType('new'); setStep('memberSetup');
        }
        return empty;
      }
    } catch (e) { console.error(e); return empty; }
    finally { setIsResolving(false); }
  }, [firestore, tenantId, clientType, step, toast]);

  // ── Flow handlers ──────────────────────────────────────────────────────────

  const handlePartyType = (type: 'individual' | 'group') => {
    const group = type === 'group';
    setIsGroup(group);
    setCurrentIdx(0);
    if (group) {
      setStep('partySize');
    } else {
      setPartySize(1);
      setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
      setStep('identityChoice');
    }
  };

  const handlePartySizeConfirm = (size: number) => {
    setPartySize(size);
    // Create member slots — names will be filled on guestNames screen (after identity)
    setPartyMembers(Array.from({ length: size }, (_, i) => ({
      id: nanoid(5), name: '', serviceIds: [], isPrimary: i === 0, preferredStaffId: 'any', waitForPreferredStaff: false,
    })));
    setStep('identityChoice');
  };

  const handleIdentityChoice = (type: 'new' | 'returning') => {
    setClientType(type);
    if (type === 'returning') { setStep('phonePad'); setPhoneVal(''); }
    else {
      setMemberSubStep(isGroup ? 'services' : 'details');
      setStep(isGroup ? 'guestNames' : 'memberSetup');
    }
  };

  const handlePhonePadConfirm = async () => {
    if (phoneVal.length < 10) return;
    const result = await resolveIdentity(undefined, `+1${phoneVal}`, 'returning');
    if (result.client) setStep('identityConfirm');
  };

  // FIX: pre-fill primary member without calling handleMemberUpdate (avoids clearing matchedClient)
  const handleIdentityConfirm = async () => {
    if (!matchedClient) return;
    setPartyMembers(prev => prev.map((m, i) =>
      i === currentIdx ? { ...m, name: m.name || matchedClient.name || '', email: m.email || matchedClient.email || '', phone: m.phone || matchedClient.phone || '' } : m
    ));
    if (matchedApt) { await handleAppointmentCheckIn(matchedApt); }
    else {
      setMemberSubStep('services'); // primary already has details filled
      if (isGroup) setStep('guestNames'); // collect other guest names
      else setStep('welcomeBack');
    }
  };

  const handleGuestNamesConfirm = () => {
    // All guest names collected — start service selection for guest 1
    setCurrentIdx(0);
    setMemberSubStep('services'); // primary's details already filled; skip to services
    setStep('memberSetup');
  };

  const handleMemberUpdate = (updates: Partial<PartyMember>) => {
    if (updates.phone !== undefined || updates.email !== undefined) {
      setIsKnownClient(false); setBannedClient(null); setExistingBalance(null); setMatchedApt(null);
      // NOT clearing matchedClient — preserves welcomeBack name display
    }
    setPartyMembers(prev => prev.map((m, i) => i === currentIdx ? { ...m, ...updates } : m));
  };

  const handleNextSubStep = async (next: MemberSubStep) => {
    const member = partyMembers[currentIdx];
    if (memberSubStep === 'details') {
      if (!member.phone || member.phone.length < 5) return toast({ variant: 'destructive', title: 'Phone Required' });
      if (!member.name.trim()) return toast({ variant: 'destructive', title: 'Name Required' });
      if (!member.email?.trim()) return toast({ variant: 'destructive', title: 'Email Required' });
      if (!/^\S+@\S+\.\S+$/.test(member.email!)) return toast({ variant: 'destructive', title: 'Invalid Email' });
      const result = await resolveIdentity(member.email, member.phone, clientType);
      if (result.isBanned || result.hasBalance) return;
      if (result.isKnown && clientType === 'new') return;
      const dayAccess = activeDaySchedule?.accessTier || 'all';
      if (dayAccess === 'members' && !((matchedClient?.activeMembershipId || matchedClient?.subscription) || (matchedClient?.activePackages?.length || 0) > 0)) { toast({ variant: 'destructive', title: 'Members Only Today' }); return; }
      if (dayAccess === 'returning' && !matchedClient) { toast({ variant: 'destructive', title: 'Return Guests Only Today' }); return; }
    }
    if (memberSubStep === 'services' && member.serviceIds.length === 0) return toast({ variant: 'destructive', title: 'Please select a service' });
    setMemberSubStep(next);
  };

  const handleFinishedGuest = () => {
    setCurrentIdx(prev => prev + 1);
    // Non-primary guests need to enter their contact details
    setMemberSubStep('details');
    setBannedClient(null); setExistingBalance(null); setMatchedApt(null); setIsKnownClient(false);
  };

  const handleBack = () => {
    if (memberSubStep === 'details') {
      if (currentIdx > 0) { setCurrentIdx(prev => prev - 1); setMemberSubStep('staff'); }
      else if (isGroup) setStep('guestNames');
      else setStep('identityChoice');
    } else {
      const member = partyMembers[currentIdx];
      const primary = (services || []).find((s: Service) => s.id === member.serviceIds[0]);
      const forms = (consentForms || []).filter((f: ConsentForm) => primary?.requiredFormIds?.includes(f.id));
      const steps: MemberSubStep[] = ['details', 'services'];
      if (forms.length > 0) steps.push('consents');
      steps.push('staff');
      const i = steps.indexOf(memberSubStep);
      if (i > 0) setMemberSubStep(steps[i - 1]);
    }
  };

  const handleAppointmentCheckIn = async (apt: Appointment) => {
    if (isSubmitting || !firestore || !tenantId) return;
    setIsSubmitting(true);
    const batch = writeBatch(firestore);
    try {
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', apt.id), { checkInStatus: 'arrived' });
      if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { checkInStatus: 'arrived', tenantId });
      if (apt.staffId) { const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`)); batch.set(nRef, { id: nanoid(), userId: apt.staffId, type: 'client_movement', message: `${apt.clientName || 'Your guest'} checked in.`, link: '/planner', createdAt: new Date().toISOString(), read: false }); }
      await batch.commit();
      const ticket: WalkInTicketData = { id: apt.id, name: apt.clientName || 'Guest', services: (services || []).filter(s => s.id === apt.serviceId), queuePosition: 0, checkInTime: new Date().toISOString(), studioName: tenant?.name, studioLogoUrl: logoUrl };
      setConfirmedParty([ticket]);
      // Lazy single-doc lookup for birthday check (no full clients listener needed)
      let birthdayHit = false;
      if (apt.clientId) {
        try {
          const cSnap = await getDoc(doc(firestore, 'tenants', tenantId, 'clients', apt.clientId));
          if (cSnap.exists() && isBirthdayToday((cSnap.data() as any).birthday)) {
            setBirthdayName((cSnap.data() as any).name || 'Guest');
            setShowBirthday(true);
            birthdayHit = true;
          }
        } catch { /* non-critical */ }
      }
      if (!birthdayHit) setStep('confirmation');
    } catch { toast({ variant: 'destructive', title: 'Check-in Error' }); }
    finally { setIsSubmitting(false); }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const batch = writeBatch(firestore);
    const groupId = nanoid();
    const now = new Date().toISOString();
    const tickets: WalkInTicketData[] = [];
    let birthdayName_ = '';
    try {
      const qSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/walkIns`), where('status', '==', 'waiting')));
      let pos = qSnap.size + 1;
      // DUPLICATE GUARD: check each member isn't already in the active queue
      const duplicateChecks = await Promise.all(
        partyMembers.map(async m => {
          if (!m.phone && !m.email) return null;
          const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
          const snaps = await Promise.all([
            ...(m.phone ? [getDocs(query(clientsRef, where('phone', '==', m.phone)))] : []),
            ...(m.email ? [getDocs(query(clientsRef, where('email', '==', m.email.toLowerCase().trim())))] : []),
          ]);
          const clientId = snaps.flatMap(s => s.docs)[0]?.id;
          if (!clientId) return null;
          const activeQ = query(
            collection(firestore, `tenants/${tenantId}/walkIns`),
            where('clientId', '==', clientId),
            where('status', 'in', ['waiting', 'notified', 'arrived'])
          );
          const active = await getDocs(activeQ);
          return active.empty ? null : { name: m.name || 'Guest', pos: active.docs[0].data().queueOrder };
        })
      );
      const duplicates = duplicateChecks.filter(Boolean);
      if (duplicates.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Already in Queue',
          description: `${duplicates[0]!.name} is already waiting. Please check in with the front desk.`
        });
        setIsSubmitting(false);
        return;
      }

      for (const member of partyMembers) {
        // Lazy client lookup — reuse resolveIdentity's result if available, otherwise query
        const clientsRef = collection(firestore, 'tenants', tenantId, 'clients');
        const matchSnaps = await Promise.all([
          ...(member.email ? [getDocs(query(clientsRef, where('email', '==', member.email.toLowerCase().trim())))] : []),
          ...(member.phone ? [getDocs(query(clientsRef, where('phone', '==', member.phone)))] : []),
        ]);
        const matchDocs = matchSnaps.flatMap(s => s.docs);
        const mc = matchDocs.length > 0 ? { ...matchDocs[0].data(), id: matchDocs[0].id } as any : null;
        let clientId = mc?.id;
        if (mc && isBirthdayToday(mc.birthday)) birthdayName_ = mc.name || member.name;
        if (!clientId) {
          clientId = nanoid();
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), { id: clientId, name: member.name, email: member.email || '', phone: member.phone || '', avatarUrl: `https://picsum.photos/seed/${clientId}/100`, lifetimeValue: 0, lastAppointment: now, status: 'active' });
        } else {
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), { name: member.name, email: member.email || '', phone: member.phone || '', lastAppointment: now }, { merge: true });
        }
        const walkInId = nanoid();
        // FIX 6: accurate estimated duration including padding
        const estDuration = calcEstimatedDuration(member.serviceIds, services || []);
        batch.set(doc(firestore, `tenants/${tenantId}/walkIns`, walkInId), {
          id: walkInId, groupId, isPrimaryContact: !!member.isPrimary, clientId,
          customerName: member.name, customerPhone: member.phone || '', customerEmail: member.email || '',
          serviceIds: member.serviceIds, checkInTime: now, status: 'waiting',
          queueOrder: Date.now() + (tickets.length * 1000),
          waitForPreferredStaff: !!member.waitForPreferredStaff,
          estimatedDuration: estDuration,
          ...(isGroup && { groupName: `${partyMembers[0].name}'s Party`, groupSize: partyMembers.length }),
          ...(member.preferredStaffId && member.preferredStaffId !== 'any' ? { preferredStaffId: member.preferredStaffId } : {}),
        });
        const memberAnswers = formAnswers[member.id] || {};
        Object.entries(memberAnswers).forEach(([formId, data]) => {
          const cRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
          const form = (consentForms || []).find(f => f.id === formId);
          batch.set(cRef, { id: cRef.id, formId, formTitle: form?.title || 'Form', clientId, signedAt: now, formData: data });
        });
        tickets.push({
          id: walkInId, name: member.name,
          services: (services || []).filter(s => member.serviceIds.includes(s.id)),
          queuePosition: pos++, checkInTime: now,
          studioName: tenant?.name, studioLogoUrl: logoUrl,
          groupName: isGroup ? `${partyMembers[0].name}'s Party` : undefined,
          groupTotal: isGroup ? partyMembers.length : undefined,
        });
      }
      await batch.commit();
      setConfirmedParty(tickets);
      if (birthdayName_) { setBirthdayName(birthdayName_); setShowBirthday(true); }
      else setStep('confirmation');
    } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Check-in Error' }); }
    finally { setIsSubmitting(false); }
  };

  function isBirthdayToday(birthday?: string) {
    if (!birthday) return false;
    const b = safeDate(birthday); const today = new Date();
    return b.getDate() === today.getDate() && b.getMonth() === today.getMonth();
  }

  const reset = () => {
    setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({});
    setMatchedApt(null); setPhoneVal(''); setClientType(null); setMatchedClient(null);
    setIsKnownClient(false); setCurrentIdx(0); setPartySize(1); setIsGroup(false); setMemberSubStep('details');
    setBannedClient(null); setExistingBalance(null);
  };

  if (!tenant || !services) return <div className={cn('h-screen flex items-center justify-center', t.bg)}><Loader className="w-8 h-8 animate-spin text-slate-400" /></div>;

  return (
    <div className={cn('min-h-screen flex flex-col overflow-x-hidden relative', t.bg)}>
      {(themeName === 'dark' || themeName === 'slate') && <DarkMeshBg hex={primaryHex} />}
      <FormProvider {...methods}>
        {/* Offline banner */}
        {!isOnline && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center py-2 px-4">
            <p className="text-[10px] font-black uppercase tracking-widest">
              ⚠ No internet connection — check-ins will be saved when reconnected
            </p>
          </div>
        )}

        {!kioskOpenStatus.open ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <ClosedView hours={kioskOpenStatus.hours} logoUrl={logoUrl} tenantName={tenant.name} t={t} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4 md:p-8">
            <AnimatePresence mode="wait">
              {!entered ? (
                <motion.div key="splash" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }}
                  className="text-center cursor-pointer select-none p-8 z-10 w-full max-w-md" onClick={() => setEntered(true)}>
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} className="mb-10">
                    <div className={cn('relative overflow-hidden mx-auto', showWordmark ? 'w-24 h-24 rounded-3xl' : 'w-40 h-40 rounded-[2.5rem]', logoUrl ? 'shadow-xl' : cn('border-2', t.card, t.cardBorder))}>
                      {logoUrl ? <Image src={logoUrl} alt={tenant.name} fill className="object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ClarityFlowLogo className="w-16 h-16 opacity-30" /></div>}
                    </div>
                  </motion.div>
                  {showWordmark && (
                    <div className="mb-8">
                      {wordmarkUrl ? <div className="relative h-16 w-[280px] mx-auto"><Image src={wordmarkUrl} alt={tenant.name} fill className="object-contain" /></div>
                        : <h1 className={cn('text-5xl md:text-6xl font-black uppercase tracking-tighter leading-none', t.text)}>{tenant.name}</h1>}
                    </div>
                  )}
                  <motion.p animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 2.5, repeat: Infinity }} className={cn('text-sm font-black uppercase tracking-[0.35em]', t.muted)}>Tap to check in</motion.p>
                </motion.div>
              ) : (
                <div className="w-full max-w-2xl mx-auto z-10">
                  <AnimatePresence mode="wait">

                    {/* PARTY TYPE */}
                    {step === 'partyType' && <motion.div key="pt"><SurfaceCard t={t}>
                      <div className="p-8 md:p-12 space-y-8">
                        <div className="text-center space-y-2">
                          <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Walk-in Check-in</p>
                          <h2 className={cn('text-4xl md:text-5xl font-black uppercase tracking-tighter leading-none', t.text)}>Welcome</h2>
                          <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>Who are we checking in today?</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <ChoiceTile onClick={() => handlePartyType('individual')} icon={User} title="Just Me" subtitle="Solo check-in" t={t} hex={primaryHex} />
                          <ChoiceTile onClick={() => handlePartyType('group')} icon={Users} title="My Party" subtitle="Multiple guests" t={t} hex={primaryHex} />
                        </div>
                      </div>
                    </SurfaceCard></motion.div>}

                    {/* PARTY SIZE */}
                    {step === 'partySize' && <motion.div key="ps"><SurfaceCard t={t}>
                      <div className="p-8 md:p-12 space-y-8">
                        <div className="text-center space-y-2">
                          <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Group Check-in</p>
                          <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>How many guests?</h2>
                          <p className={cn('text-sm font-bold uppercase tracking-[0.15em]', t.muted)}>Each person gets their own queue ticket</p>
                        </div>
                        <div className="flex items-center justify-center gap-8">
                          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setPartySize(s => Math.max(2, s - 1))} className={cn('w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-black', t.card, t.cardBorder, t.text)}>−</motion.button>
                          <div className="text-center"><p className={cn('text-7xl font-black leading-none', t.text)}>{partySize}</p><p className={cn('text-[10px] font-black uppercase tracking-widest mt-1', t.muted)}>guests</p></div>
                          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setPartySize(s => Math.min(8, s + 1))} className={cn('w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-black', t.card, t.cardBorder, t.text)}>+</motion.button>
                        </div>
                        <div className="grid grid-cols-4 gap-2">{[2,3,4,5,6,7,8].map(n => <button key={n} onClick={() => setPartySize(n)} className={cn('h-12 rounded-xl border-2 font-black text-lg transition-all', partySize === n ? 'border-transparent text-white shadow-md' : `${t.card} ${t.cardBorder} ${t.text}`)} style={partySize === n ? (btnStyle(primaryHex) || { backgroundColor: '#0f172a', color: '#fff' }) : undefined}>{n}</button>)}</div>
                        <div className="space-y-3">
                          <button onClick={() => handlePartySizeConfirm(partySize)} className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2', t.btn, t.btnText)} style={btnStyle(primaryHex)}>Continue →</button>
                          <button onClick={() => setStep('partyType')} className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted)}>← Back</button>
                        </div>
                      </div>
                    </SurfaceCard></motion.div>}

                    {/* IDENTITY CHOICE */}
                    {step === 'identityChoice' && <motion.div key="id"><SurfaceCard t={t}>
                      <div className="p-8 md:p-12 space-y-8">
                        <div className="text-center space-y-2">
                          <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>{isGroup ? `Party of ${partySize} · Primary Guest` : 'Identity'}</p>
                          <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>First visit?</h2>
                          <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>Help us find your profile</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <ChoiceTile onClick={() => handleIdentityChoice('returning')} icon={Star} title="Return Guest" subtitle="I've been here before" t={t} hex={primaryHex} />
                          <ChoiceTile onClick={() => handleIdentityChoice('new')} icon={PlusCircle} title="First Visit" subtitle="New guest" t={t} hex={primaryHex} />
                        </div>
                        <div className="text-center"><button onClick={() => setStep(isGroup ? 'partySize' : 'partyType')} className={cn('text-[10px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70')}>← Back</button></div>
                      </div>
                    </SurfaceCard></motion.div>}

                    {/* PHONE PAD */}
                    {step === 'phonePad' && <motion.div key="pp"><SurfaceCard t={t}>
                      <div className="p-8 md:p-12 space-y-8">
                        <div className="text-center space-y-2">
                          <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Return Guest</p>
                          <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>Your Phone</h2>
                        </div>
                        <div className={cn('mx-auto max-w-xs p-6 rounded-2xl border-2 text-center', t.card, t.cardBorder)}>
                          <p className={cn('text-3xl md:text-4xl font-black font-mono tracking-widest min-h-[1.2em]', t.text)}>
                            {(() => { const c = phoneVal; if (!c) return <span className={t.muted}>––––</span>; if (c.length <= 3) return `(${c})`; if (c.length <= 6) return `(${c.slice(0,3)}) ${c.slice(3)}`; return `(${c.slice(0,3)}) ${c.slice(3,6)}-${c.slice(6)}`; })()}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
                          {['1','2','3','4','5','6','7','8','9','','0','del'].map((d, i) => {
                            if (d === '') return <div key={i} />;
                            if (d === 'del') return <motion.button key={i} whileTap={{ scale: 0.88 }} onClick={() => setPhoneVal(p => p.slice(0,-1))} className={cn('h-14 w-14 mx-auto rounded-xl flex items-center justify-center', t.muted)}><Delete className="w-5 h-5" strokeWidth={1.5} /></motion.button>;
                            return <motion.button key={i} whileTap={{ scale: 0.9 }} onClick={() => { if (phoneVal.length < 10) setPhoneVal(p => p + d); }} className={cn('h-14 w-14 mx-auto rounded-xl border-2 text-xl font-bold', t.card, t.cardBorder, t.text)}>{d}</motion.button>;
                          })}
                        </div>
                        <div className="space-y-3 max-w-xs mx-auto">
                          <button onClick={handlePhonePadConfirm} disabled={phoneVal.length < 10 || isResolving} className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-30', t.btn, t.btnText)} style={btnStyle(primaryHex)}>
                            {isResolving ? <Loader className="w-5 h-5 animate-spin" /> : <>Find Profile <ArrowRight className="w-4 h-4" /></>}
                          </button>
                          <button onClick={() => setStep('identityChoice')} className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted)}>← Back</button>
                        </div>
                      </div>
                    </SurfaceCard></motion.div>}

                    {/* IDENTITY CONFIRM */}
                    {step === 'identityConfirm' && <motion.div key="ic"><SurfaceCard t={t}>
                      {matchedClient ? (
                        <div className="p-8 md:p-12 space-y-8 text-center">
                          <div className="space-y-2"><p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Profile Found</p><h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>Is this you?</h2></div>
                          <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                              <Avatar className="w-28 h-28 rounded-3xl border-2 shadow-lg"><AvatarImage src={matchedClient.avatarUrl} className="object-cover" /><AvatarFallback className={cn('text-3xl font-black', t.text)}>{(matchedClient.name || 'G').charAt(0)}</AvatarFallback></Avatar>
                              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white"><Check className="w-4 h-4 text-white" /></div>
                            </div>
                            <div><h3 className={cn('text-2xl font-black uppercase tracking-tight', t.text)}>{matchedClient.name}</h3><p className={cn('text-xs font-bold uppercase tracking-widest mt-1', t.muted)}>{matchedClient.email || matchedClient.phone}</p></div>
                          </div>
                          <div className="space-y-3 max-w-xs mx-auto">
                            <button onClick={handleIdentityConfirm} className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2', t.btn, t.btnText)} style={btnStyle(primaryHex)}>Yes, That's Me <Check className="w-4 h-4" /></button>
                            <button onClick={() => { setMatchedClient(null); setStep('phonePad'); }} className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted)}>Not me → try again</button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-12 text-center space-y-4"><p className={cn('font-bold uppercase text-sm', t.muted)}>Something went wrong</p><button onClick={() => setStep('phonePad')} className={cn('h-12 px-8 rounded-2xl font-black uppercase', t.btn, t.btnText)} style={btnStyle(primaryHex)}>Try Again</button></div>
                      )}
                    </SurfaceCard></motion.div>}

                    {/* WELCOME BACK */}
                    {step === 'welcomeBack' && <motion.div key="wb"><SurfaceCard t={t}>
                      <div className="p-12 md:p-16 text-center space-y-8">
                        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14, stiffness: 140 }} className={cn('w-24 h-24 mx-auto rounded-3xl border-2 flex items-center justify-center', t.card, t.cardBorder)}>
                          <Sparkles className={cn('w-12 h-12', t.muted)} strokeWidth={1} />
                        </motion.div>
                        <div className="space-y-3">
                          <h2 className={cn('text-4xl md:text-5xl font-black leading-none', t.text)}>Welcome back,<br /><span className={cn('italic font-light', t.muted)}>{matchedClient?.name?.split(' ')[0] || partyMembers[0]?.name?.split(' ')[0] || 'friend'}</span></h2>
                          <p className={cn('font-bold uppercase tracking-[0.2em] text-sm', t.muted)}>Great to see you again</p>
                        </div>
                        <button onClick={() => setStep('memberSetup')} className={cn('h-14 px-10 rounded-2xl font-black uppercase tracking-widest inline-flex items-center gap-2', t.btn, t.btnText)} style={btnStyle(primaryHex)}>
                          Continue <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </SurfaceCard></motion.div>}

                    {/* GUEST NAMES — now after identity, FIX 5 */}
                    {step === 'guestNames' && <motion.div key="gn"><SurfaceCard t={t}>
                      <GuestNamesView
                        members={partyMembers}
                        onChangeName={(idx: number, name: string) => setPartyMembers(prev => prev.map((m, i) => i === idx ? { ...m, name } : m))}
                        onConfirm={handleGuestNamesConfirm}
                        onBack={() => setStep(clientType === 'returning' ? 'welcomeBack' : 'identityChoice')}
                        t={t} hex={primaryHex}
                      />
                    </SurfaceCard></motion.div>}

                    {/* MEMBER SETUP */}
                    {step === 'memberSetup' && partyMembers[currentIdx] && <motion.div key={`ms-${currentIdx}`}><SurfaceCard t={t}>
                      <MemberSetup
                        member={{ ...partyMembers[currentIdx], index: currentIdx }}
                        partyMembers={partyMembers}
                        onUpdate={handleMemberUpdate}
                        memberSubStep={memberSubStep}
                        services={services}
                        staff={activeStaff}
                        consentForms={consentForms || []}
                        formAnswers={formAnswers[partyMembers[currentIdx].id] || {}}
                        setFormAnswers={(a: any) => setFormAnswers(p => ({ ...p, [partyMembers[currentIdx].id]: a }))}
                        onNext={handleNextSubStep}
                        onBack={handleBack}
                        isGroup={isGroup}
                        isLastMember={currentIdx === partyMembers.length - 1}
                        onFinishedGuest={handleFinishedGuest}
                        onSubmit={handleSubmit}
                        isSubmitting={isSubmitting}
                        bannedClient={bannedClient}
                        existingClientWithBalance={existingBalance}
                        isResolvingIdentity={isResolving}
                        matchedAppointment={matchedApt}
                        onAppointmentCheckIn={handleAppointmentCheckIn}
                        dayAccessTier={activeDaySchedule?.accessTier}
                        isKnownClient={isKnownClient}
                        clientType={clientType}
                        t={t} hex={primaryHex}
                      />
                    </SurfaceCard></motion.div>}

                    {/* CONFIRMATION */}
                    {step === 'confirmation' && <motion.div key="conf"><SurfaceCard t={t}>
                      <ConfirmationScreen
                        confirmedParty={confirmedParty}
                        onPrint={(ticket: WalkInTicketData) => { setTicketToPrint(ticket); setIsPrintOpen(true); }}
                        onDone={reset}
                        staff={staff}
                        liveAppointments={liveAppointments || []}
                        services={services}
                        walkIns={walkIns || []}
                        t={t} hex={primaryHex}
                        studioName={tenant?.name}
                        studioLogoUrl={logoUrl}
                      />
                    </SurfaceCard></motion.div>}

                  </AnimatePresence>
                </div>
              )}
            </AnimatePresence>
          </div>
        )}
      </FormProvider>

      <AnimatePresence>{showBirthday && <BirthdayView name={birthdayName} onDone={() => { setShowBirthday(false); setStep('confirmation'); }} t={t} hex={primaryHex} />}</AnimatePresence>

      <Dialog open={isPrintOpen} onOpenChange={setIsPrintOpen}>
        <DialogContent className={cn('max-w-sm rounded-3xl border-2 p-0 overflow-hidden', t.card, t.cardBorder)}>
          <DialogHeader className={cn('p-5 border-b', t.cardBorder)}>
            <DialogTitle className={cn('text-center font-black uppercase tracking-tight text-sm', t.text)}>Ticket — {ticketToPrint?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center p-6 bg-white">{ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}</div>
          <DialogFooter className={cn('p-4 border-t', t.cardBorder)}>
            <button onClick={() => { window.print(); setIsPrintOpen(false); }} className={cn('w-full h-12 rounded-2xl font-black uppercase tracking-widest', t.btn, t.btnText)} style={btnStyle(primaryHex)}>Print Ticket</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}