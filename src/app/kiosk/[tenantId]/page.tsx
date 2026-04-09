'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import {
  type Service, type Staff, type ConsentForm, type Tenant,
  type Client, type PartyMember, type PricingTier, type Appointment
} from '@/lib/data';
import {
  Sparkles, User, ArrowRight, ArrowLeft, Users, Mail, Loader, Clock,
  PlusCircle, Check, Printer, DollarSign, FileSignature,
  Ban, Star, ArrowDown, Cake, PartyPopper, Delete, CalendarCheck,
  CheckCircle2, Award, AlertTriangle, Timer, Minus, Phone,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { format, parseISO, parse, isSameDay, addMinutes, differenceInMinutes, startOfDay } from 'date-fns';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PrintWalkInTicket, type WalkInTicketData } from '@/components/walk-in/PrintWalkInTicket';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { PhoneInput } from '@/components/ui/phone-input';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { useForm, FormProvider } from 'react-hook-form';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const isBusinessOpen = (date: Date, schedule: any) => {
  if (!schedule?.week) return { open: true };
  const dayName = format(date, 'eeee').toLowerCase();
  const dayHours = schedule.week[dayName];
  if (!dayHours?.enabled) return { open: false };
  try {
    const parseTime = (t: string) => parse(t, t.length > 7 ? 'hh:mm a' : 'h:mm a', date);
    return {
      open: date >= parseTime(dayHours.start) && date <= parseTime(dayHours.end),
      hours: `${dayHours.start} – ${dayHours.end}`
    };
  } catch { return { open: true }; }
};

// ─── THEME TYPES ──────────────────────────────────────────────────────────────
type KioskTheme = 'light' | 'dark' | 'rose' | 'sage' | 'slate';

const THEMES: Record<KioskTheme, {
  bg: string; surface: string; border: string; text: string; muted: string;
  card: string; cardBorder: string; btn: string; btnText: string; accent: string;
  label: string;
}> = {
  light: {
    bg: 'bg-gradient-to-br from-slate-50 via-white to-slate-100',
    surface: 'bg-white',
    border: 'border-slate-200',
    text: 'text-slate-900',
    muted: 'text-slate-500',
    card: 'bg-white',
    cardBorder: 'border-slate-200',
    btn: 'bg-slate-900 hover:bg-slate-800',
    btnText: 'text-white',
    accent: 'bg-slate-900',
    label: 'text-slate-400',
  },
  dark: {
    bg: 'bg-[#0c0c0f]',
    surface: 'bg-white/[0.04]',
    border: 'border-white/10',
    text: 'text-white',
    muted: 'text-white/50',
    card: 'bg-white/[0.06]',
    cardBorder: 'border-white/10',
    btn: 'bg-white hover:bg-white/90',
    btnText: 'text-black',
    accent: 'bg-white',
    label: 'text-white/30',
  },
  rose: {
    bg: 'bg-gradient-to-br from-rose-50 via-pink-50 to-white',
    surface: 'bg-white',
    border: 'border-rose-100',
    text: 'text-slate-900',
    muted: 'text-slate-500',
    card: 'bg-white',
    cardBorder: 'border-rose-100',
    btn: 'bg-rose-500 hover:bg-rose-600',
    btnText: 'text-white',
    accent: 'bg-rose-500',
    label: 'text-slate-400',
  },
  sage: {
    bg: 'bg-gradient-to-br from-emerald-50 via-teal-50 to-white',
    surface: 'bg-white',
    border: 'border-emerald-100',
    text: 'text-slate-900',
    muted: 'text-slate-500',
    card: 'bg-white',
    cardBorder: 'border-emerald-100',
    btn: 'bg-emerald-600 hover:bg-emerald-700',
    btnText: 'text-white',
    accent: 'bg-emerald-600',
    label: 'text-slate-400',
  },
  slate: {
    bg: 'bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900',
    surface: 'bg-white/[0.06]',
    border: 'border-white/10',
    text: 'text-white',
    muted: 'text-white/50',
    card: 'bg-white/[0.08]',
    cardBorder: 'border-white/15',
    btn: 'bg-white hover:bg-white/90',
    btnText: 'text-slate-900',
    accent: 'bg-white',
    label: 'text-white/30',
  },
};

// ─── ANIMATED BG (dark themes) ────────────────────────────────────────────────
const DarkMeshBg = ({ primaryHex }: { primaryHex?: string }) => (
  <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
    <div className="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full opacity-25 blur-[100px]"
      style={{ background: primaryHex ? `${primaryHex}50` : '#7c3aed50' }} />
    <div className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] rounded-full opacity-15 blur-[80px]"
      style={{ background: primaryHex ? `${primaryHex}40` : '#ec489940' }} />
  </div>
);

// ─── GLASS / SURFACE CARD ─────────────────────────────────────────────────────
const SurfaceCard = ({ children, className, t }: { children: React.ReactNode; className?: string; t: typeof THEMES['light'] }) => (
  <motion.div
    initial={{ opacity: 0, y: 12, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -8, scale: 0.98 }}
    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    className={cn(
      'w-full max-w-2xl mx-auto overflow-hidden',
      t.card,
      `border ${t.cardBorder}`,
      'rounded-3xl shadow-xl',
      className
    )}
  >
    {children}
  </motion.div>
);

// ─── STEP INDICATOR ───────────────────────────────────────────────────────────
const StepDots = ({ total, current, t }: { total: number; current: number; t: typeof THEMES['light'] }) => (
  <div className="flex items-center justify-center gap-2">
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} className={cn(
        'h-1.5 rounded-full transition-all duration-500',
        i === current ? `w-6 ${t.accent}` : i < current ? `w-3 opacity-40 ${t.accent}` : `w-3 opacity-20 ${t.accent}`
      )} />
    ))}
  </div>
);

// ─── CHOICE TILE ──────────────────────────────────────────────────────────────
const ChoiceTile = ({ onClick, icon: Icon, title, subtitle, selected, t }: any) => (
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    className={cn(
      'group relative flex flex-col items-center justify-center p-8 md:p-10 rounded-2xl border-2 transition-all duration-300 cursor-pointer text-center',
      selected
        ? `${t.btn} ${t.btnText} border-transparent shadow-lg`
        : `${t.card} ${t.cardBorder} ${t.text} hover:border-opacity-40`
    )}
  >
    <div className={cn('mb-4 p-4 rounded-xl transition-all', selected ? 'bg-white/20' : 'bg-slate-100/50')}>
      <Icon className={cn('w-10 h-10 md:w-12 md:h-12', selected ? (t.btn.includes('white') ? 'text-black' : 'text-white') : t.muted)} strokeWidth={1.3} />
    </div>
    <p className={cn('text-lg md:text-xl font-black uppercase tracking-tight leading-none mb-1.5', selected ? (t.btn.includes('white') ? 'text-black' : 'text-white') : t.text)}>{title}</p>
    <p className={cn('text-[10px] font-bold uppercase tracking-[0.2em]', selected ? 'opacity-60' : t.muted)}>{subtitle}</p>
  </motion.button>
);

// ─── THEME SWITCHER ───────────────────────────────────────────────────────────
const ThemeSwitcher = ({ current, onChange }: { current: KioskTheme; onChange: (t: KioskTheme) => void }) => {
  const swatches: { key: KioskTheme; color: string; label: string }[] = [
    { key: 'light', color: 'bg-white border-slate-300', label: 'Light' },
    { key: 'dark',  color: 'bg-slate-900',              label: 'Dark'  },
    { key: 'rose',  color: 'bg-rose-400',               label: 'Rose'  },
    { key: 'sage',  color: 'bg-emerald-500',            label: 'Sage'  },
    { key: 'slate', color: 'bg-slate-600',              label: 'Slate' },
  ];
  return (
    <div className="flex items-center gap-2">
      {swatches.map(s => (
        <button key={s.key} onClick={() => onChange(s.key)} title={s.label}
          className={cn('w-7 h-7 rounded-full border-2 transition-all', s.color, current === s.key ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent opacity-60 hover:opacity-100')} />
      ))}
    </div>
  );
};

// ─── LIVE FLOOR STATUS ────────────────────────────────────────────────────────
const LiveFloorStatus = ({
  staff, appointments, services, t
}: {
  staff: Staff[] | null;
  appointments: Appointment[];
  services: Service[] | null;
  t: typeof THEMES['light'];
}) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const enriched = useMemo(() => {
    const today = startOfDay(now);
    return (staff || [])
      .filter(s => s.active)
      .map(s => {
        const servicing = (appointments || []).find(a =>
          a.staffId === s.id && a.status === 'servicing'
        );
        const isOnBreak = (s as any).onBreak;
        const isBusy = s.status === 'busy' || !!servicing;

        let label = 'Available';
        let dotColor = 'bg-emerald-500';
        let estFree: number | null = null;
        let serviceName: string | null = null;

        if (isOnBreak) {
          label = 'On Break'; dotColor = 'bg-amber-400';
        } else if (isBusy) {
          label = 'In Service'; dotColor = 'bg-blue-500';
          if (servicing) {
            const svc = (services || []).find(sv => sv.id === servicing.serviceId);
            if (svc) serviceName = svc.name;
            if (servicing.endTime) {
              const mins = differenceInMinutes(safeDate(servicing.endTime), now);
              if (mins > 0) estFree = mins;
              else label = 'Finishing';
            }
          }
        }

        return { ...s, label, dotColor, estFree, serviceName };
      })
      .sort((a, b) => {
        const order = { 'Available': 0, 'Finishing': 1, 'In Service': 2, 'On Break': 3 };
        return (order[a.label as keyof typeof order] ?? 4) - (order[b.label as keyof typeof order] ?? 4);
      });
  }, [staff, appointments, services, now]);

  if (!enriched.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={cn('h-px flex-1', t.border, 'bg-current opacity-20')} />
        <p className={cn('text-[9px] font-black uppercase tracking-[0.25em]', t.muted)}>Studio Floor</p>
        <div className={cn('h-px flex-1', t.border, 'bg-current opacity-20')} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {enriched.map(member => (
          <div key={member.id}
            className={cn('flex items-center gap-3 p-3 rounded-2xl border', t.card, t.cardBorder)}>
            <div className="relative shrink-0">
              <Avatar className="w-10 h-10 rounded-xl border border-slate-200/50">
                <AvatarImage src={member.avatarUrl} className="object-cover" />
                <AvatarFallback className={cn('font-black text-sm', t.surface, t.text)}>
                  {(member.name || 'S').charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white', member.dotColor)} />
            </div>
            <div className="min-w-0">
              <p className={cn('text-[11px] font-black uppercase tracking-tight truncate', t.text)}>
                {member.name?.split(' ')[0]}
              </p>
              <p className={cn('text-[9px] font-bold uppercase', t.muted)}>
                {member.label}
              </p>
              {member.estFree && (
                <p className={cn('text-[9px] font-black', t.muted)}>
                  ~{member.estFree}m
                </p>
              )}
              {member.serviceName && !member.estFree && (
                <p className={cn('text-[8px] font-bold truncate max-w-[70px]', t.muted)}>
                  {member.serviceName}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Estimated wait hint */}
      {(() => {
        const waiting = (staff || []).filter(s => s.active && !((s as any).onBreak) && s.status !== 'busy').length;
        const busyWithEst = enriched.filter(e => e.estFree !== null);
        const shortestWait = busyWithEst.length > 0
          ? Math.min(...busyWithEst.map(e => e.estFree!))
          : null;
        return (
          <div className={cn('rounded-2xl p-4 border text-center', t.card, t.cardBorder)}>
            {waiting > 0 ? (
              <>
                <p className={cn('text-[10px] font-black uppercase tracking-widest', t.muted)}>Staff Available Now</p>
                <p className={cn('text-2xl font-black mt-1', t.text)}>{waiting} provider{waiting > 1 ? 's' : ''} ready</p>
              </>
            ) : shortestWait !== null ? (
              <>
                <p className={cn('text-[10px] font-black uppercase tracking-widest', t.muted)}>Est. Next Available</p>
                <p className={cn('text-2xl font-black mt-1', t.text)}>~{shortestWait}m</p>
              </>
            ) : (
              <>
                <p className={cn('text-[10px] font-black uppercase tracking-widest', t.muted)}>Floor Status</p>
                <p className={cn('text-sm font-black mt-1', t.muted)}>Checking availability…</p>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
};

// ─── PARTY SIZE SELECTOR ──────────────────────────────────────────────────────
const PartySizeView = ({ onSelect, onBack, t }: { onSelect: (n: number) => void; onBack: () => void; t: typeof THEMES['light'] }) => {
  const [size, setSize] = useState(2);
  return (
    <div className="p-8 md:p-12 space-y-8">
      <div className="text-center space-y-2">
        <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Group Check-in</p>
        <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>
          How many guests?
        </h2>
        <p className={cn('text-sm font-bold uppercase tracking-[0.15em]', t.muted)}>
          We'll set up a profile for each person
        </p>
      </div>

      {/* Counter */}
      <div className="flex items-center justify-center gap-8">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSize(s => Math.max(2, s - 1))}
          className={cn('w-14 h-14 rounded-2xl border-2 flex items-center justify-center font-black text-2xl transition-all', t.card, t.cardBorder, t.text, 'hover:opacity-70')}>
          −
        </motion.button>
        <div className="text-center">
          <p className={cn('text-7xl font-black leading-none', t.text)}>{size}</p>
          <p className={cn('text-[10px] font-black uppercase tracking-widest mt-1', t.muted)}>guests</p>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSize(s => Math.min(8, s + 1))}
          className={cn('w-14 h-14 rounded-2xl border-2 flex items-center justify-center font-black text-2xl transition-all', t.card, t.cardBorder, t.text, 'hover:opacity-70')}>
          +
        </motion.button>
      </div>

      {/* Quick select */}
      <div className="grid grid-cols-4 gap-2">
        {[2, 3, 4, 5, 6, 7, 8].slice(0, 7).map(n => (
          <button key={n} onClick={() => setSize(n)}
            className={cn('h-12 rounded-xl border-2 font-black text-lg transition-all',
              size === n ? `${t.btn} ${t.btnText} border-transparent` : `${t.card} ${t.cardBorder} ${t.text}`)}>
            {n}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <Button onClick={() => onSelect(size)}
          className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest', t.btn, t.btnText)}>
          Continue with {size} guests →
        </Button>
        <button onClick={onBack} className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70 transition-opacity')}>
          ← Back
        </button>
      </div>
    </div>
  );
};

// ─── MEMBER DETAILS FORM ──────────────────────────────────────────────────────
const StepDetails = ({ member, onUpdate, primaryMember, isGroup, bannedClient, existingClientWithBalance, isResolvingIdentity, isKnownClient, clientType, t }: any) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <label className={cn('text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5', t.label)}>
        <Phone className="w-3 h-3" /> Phone
      </label>
      <PhoneInput
        name={`phone-${member.id}`} international defaultCountry="US"
        value={member.phone || ''} onChange={v => onUpdate({ phone: v || '' })}
        placeholder="(555) 000-0000"
        className={cn('h-14 w-full rounded-2xl border-2 px-4 text-lg font-bold transition-all', t.card, t.cardBorder, t.text,
          '[&_input]:border-none [&_input]:bg-transparent [&_input]:placeholder:opacity-30 focus-within:ring-2 focus-within:ring-slate-300')}
      />
    </div>
    <div className="space-y-2">
      <label className={cn('text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5', t.label)}>
        <Users className="w-3 h-3" /> Full Name
      </label>
      <input
        value={member.name} onChange={e => onUpdate({ name: e.target.value })}
        placeholder={member.isPrimary ? 'Your full name' : `Guest ${member.index + 1} name`}
        className={cn('w-full h-14 rounded-2xl border-2 px-4 text-lg font-bold outline-none transition-all uppercase tracking-tight', t.card, t.cardBorder, t.text, 'placeholder:opacity-30 focus:ring-2 focus:ring-slate-300')}
      />
    </div>
    {isGroup && !member.isPrimary && (
      <button onClick={() => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); }}
        className={cn('w-full h-10 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest transition-all', t.card, t.cardBorder, t.muted, 'hover:opacity-70')}>
        Copy {primaryMember?.name?.split(' ')[0] || 'primary'}'s contact info
      </button>
    )}
    <div className="space-y-2">
      <label className={cn('text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5', t.label)}>
        <Mail className="w-3 h-3" /> Email
      </label>
      <input
        type="email" value={member.email || ''} onChange={e => onUpdate({ email: e.target.value })}
        placeholder="your@email.com"
        className={cn('w-full h-14 rounded-2xl border-2 px-4 text-lg font-bold outline-none transition-all', t.card, t.cardBorder, t.text, 'placeholder:opacity-30 focus:ring-2 focus:ring-slate-300')}
      />
    </div>

    <AnimatePresence>
      {isResolvingIdentity && (
        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={cn('flex items-center gap-2 py-2 justify-center text-[9px] font-black uppercase tracking-widest', t.muted)}>
          <Loader className="w-3 h-3 animate-spin" /> Checking records…
        </motion.div>
      )}
      {isKnownClient && clientType === 'new' && !bannedClient && !existingClientWithBalance && (
        <motion.div key="known" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1">Profile Found</p>
            <p className="text-[9px] font-bold text-amber-600 uppercase leading-relaxed">
              We found a record with this contact. Please go back and choose <strong>Return Guest</strong> to load your profile.
            </p>
          </div>
        </motion.div>
      )}
      {bannedClient && (
        <motion.div key="banned" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex gap-3">
          <Ban className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">Access Restricted</p>
            <p className="text-[9px] font-bold text-red-500 uppercase">{bannedClient.banMessage || 'Please see front desk.'}</p>
          </div>
        </motion.div>
      )}
      {existingClientWithBalance && !bannedClient && (
        <motion.div key="balance" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex gap-3">
          <DollarSign className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">Balance Due</p>
            <p className="text-[9px] font-bold text-red-500 uppercase">${existingClientWithBalance.outstandingBalance?.toFixed(2)} outstanding — settle at desk first.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// ─── SERVICE SELECTION ────────────────────────────────────────────────────────
const ServiceTile = ({ service, isSelected, onToggle, t }: any) => {
  const minPrice = useMemo(() => {
    if (!service.serviceTiers?.length) return service.price;
    return Math.min(...service.serviceTiers.map((st: any) => st.price));
  }, [service]);
  return (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onToggle}
      className={cn(
        'relative flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all text-center gap-2.5',
        isSelected
          ? `${t.btn} ${t.btnText} border-transparent shadow-lg`
          : `${t.card} ${t.cardBorder} ${t.text} hover:opacity-80`
      )}>
      {isSelected && (
        <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center">
          <Check className="w-2.5 h-2.5" />
        </div>
      )}
      <div className={cn('p-3 rounded-xl', isSelected ? 'bg-white/20' : 'bg-slate-100/60')}>
        <Sparkles className={cn('w-6 h-6', isSelected ? '' : t.muted)} strokeWidth={1.5} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-tight leading-tight">{service.name}</p>
      <p className={cn('text-[9px] font-black font-mono', isSelected ? 'opacity-70' : t.muted)}>${minPrice?.toFixed(0) ?? 0}+</p>
    </motion.button>
  );
};

const StepServices = ({ member, onUpdate, services, t }: any) => {
  const mainServices = useMemo(() => (services || []).filter((s: Service) => s.type === 'service'), [services]);
  const selectedMainId = useMemo(() => member.serviceIds.find((id: string) => mainServices.some((s: Service) => s.id === id)), [member.serviceIds, mainServices]);
  const selectedMain = useMemo(() => services?.find((s: Service) => s.id === selectedMainId), [services, selectedMainId]);
  const categories = useMemo(() => Array.from(new Set(mainServices.map((s: Service) => s.category || 'Standard'))).sort() as string[], [mainServices]);
  const addOns = useMemo(() => selectedMain ? (services || []).filter((s: Service) => s.type === 'addon' && (selectedMain.compatibleAddOnIds || []).includes(s.id)) : [], [services, selectedMain]);
  const [view, setView] = useState<'cat' | 'main' | 'addon'>(selectedMainId ? 'addon' : 'cat');
  const [cat, setCat] = useState<string | null>(null);

  return (
    <AnimatePresence mode="wait">
      {view === 'cat' && (
        <motion.div key="cat" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-3">
          <p className={cn('text-[9px] font-black uppercase tracking-[0.2em]', t.label)}>Choose category</p>
          {categories.map(c => (
            <motion.button key={c} whileTap={{ scale: 0.98 }} onClick={() => { setCat(c); setView('main'); }}
              className={cn('w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all', t.card, t.cardBorder, t.text, 'hover:opacity-80')}>
              <span className="font-black uppercase tracking-tight text-base">{c}</span>
              <ArrowRight className={cn('w-4 h-4', t.muted)} />
            </motion.button>
          ))}
        </motion.div>
      )}
      {view === 'main' && (
        <motion.div key="main" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('cat')} className={cn('flex items-center gap-1 text-[9px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70')}>
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
            <p className={cn('flex-1 text-center text-[9px] font-black uppercase tracking-[0.2em]', t.muted)}>{cat}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mainServices.filter((s: Service) => (s.category || 'Standard') === cat).map((svc: Service) => (
              <ServiceTile key={svc.id} service={svc} isSelected={member.serviceIds.includes(svc.id)} t={t}
                onToggle={() => {
                  onUpdate({ serviceIds: [svc.id] });
                  const has = (services || []).filter((s: Service) => s.type === 'addon' && (svc.compatibleAddOnIds || []).includes(s.id));
                  if (has.length > 0) setView('addon');
                }} />
            ))}
          </div>
        </motion.div>
      )}
      {view === 'addon' && (
        <motion.div key="addon" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('main')} className={cn('flex items-center gap-1 text-[9px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70')}>
              <ArrowLeft className="w-3 h-3" /> Change
            </button>
            <div className={cn('flex-1 text-center px-2 py-1 rounded-xl border', t.card, t.cardBorder)}>
              <p className={cn('text-[9px] font-black uppercase tracking-tight truncate', t.muted)}>Selected: {selectedMain?.name}</p>
            </div>
          </div>
          {addOns.length > 0 ? (
            <>
              <p className={cn('text-[9px] font-black uppercase tracking-[0.2em]', t.label)}>Add-ons (optional)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {addOns.map((addon: Service) => (
                  <ServiceTile key={addon.id} service={addon} t={t}
                    isSelected={member.serviceIds.includes(addon.id)}
                    onToggle={() => {
                      const has = member.serviceIds.includes(addon.id);
                      onUpdate({ serviceIds: has ? member.serviceIds.filter((id: string) => id !== addon.id) : [...member.serviceIds, addon.id] });
                    }} />
                ))}
              </div>
            </>
          ) : (
            <p className={cn('text-center py-4 text-[9px] font-black uppercase tracking-widest', t.muted)}>No add-ons available</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── STAFF PREFERENCE ─────────────────────────────────────────────────────────
const StepStaff = ({ member, onUpdate, staff, t }: any) => (
  <div className="space-y-4">
    <p className={cn('text-[9px] font-black uppercase tracking-[0.2em]', t.label)}>Provider preference</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <button onClick={() => onUpdate({ preferredStaffId: 'any' })}
        className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all',
          (!member.preferredStaffId || member.preferredStaffId === 'any')
            ? `${t.btn} ${t.btnText} border-transparent` : `${t.card} ${t.cardBorder} ${t.text}`)}>
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', 'bg-slate-100/60')}>
          <Users className={cn('w-6 h-6', t.muted)} strokeWidth={1.3} />
        </div>
        <p className="text-[9px] font-black uppercase tracking-tight">First Available</p>
      </button>
      {(staff || []).map((s: Staff) => (
        <button key={s.id} onClick={() => onUpdate({ preferredStaffId: s.id })}
          className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all relative',
            member.preferredStaffId === s.id ? `${t.btn} ${t.btnText} border-transparent` : `${t.card} ${t.cardBorder} ${t.text}`)}>
          {member.preferredStaffId === s.id && (
            <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center">
              <Check className="w-2.5 h-2.5" />
            </div>
          )}
          <Avatar className="w-12 h-12 rounded-xl border border-slate-200/50">
            <AvatarImage src={s.avatarUrl} className="object-cover" />
            <AvatarFallback className={cn('font-black text-sm', t.surface, t.text)}>{(s.name || 'S').charAt(0)}</AvatarFallback>
          </Avatar>
          <p className="text-[9px] font-black uppercase tracking-tight truncate max-w-[80px]">{s.name?.split(' ')[0]}</p>
        </button>
      ))}
    </div>
    {member.preferredStaffId && member.preferredStaffId !== 'any' && (
      <div className={cn('flex items-center justify-between p-4 rounded-2xl border-2', t.card, t.cardBorder)}>
        <div>
          <p className={cn('text-[10px] font-black uppercase tracking-widest', t.text)}>Wait for this provider?</p>
          <p className={cn('text-[9px] font-bold uppercase mt-0.5', t.muted)}>May increase wait time</p>
        </div>
        <Switch checked={member.waitForPreferredStaff} onCheckedChange={v => onUpdate({ waitForPreferredStaff: v })} />
      </div>
    )}
  </div>
);

// ─── CONSENT STEP ─────────────────────────────────────────────────────────────
const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers, t }: any) => (
  <div className="space-y-5">
    {requiredForms.map((form: ConsentForm) => (
      <div key={form.id} className={cn('space-y-5 p-5 rounded-2xl border-2', t.card, t.cardBorder)}>
        <h3 className={cn('font-black uppercase tracking-tight flex items-center gap-2 text-sm', t.text)}>
          <FileSignature className={cn('w-4 h-4', t.muted)} />{form.title}
        </h3>
        {form.fields?.map((field: any) => (
          <FormFieldRenderer key={field.id} field={field}
            value={formAnswers[form.id]?.[field.id]}
            onChange={val => setFormAnswers({ ...formAnswers, [form.id]: { ...(formAnswers[form.id] || {}), [field.id]: val } })} />
        ))}
      </div>
    ))}
  </div>
);

// ─── MEMBER SETUP ─────────────────────────────────────────────────────────────
type MemberSubStep = 'details' | 'services' | 'consents' | 'staff';

const MemberSetup = ({
  member, onUpdate, partyMembers, memberSubStep, services, staff, consentForms,
  formAnswers, setFormAnswers, onNext, onBack, isGroup, isLastMember,
  onAddAnother, onSubmit, isSubmitting, bannedClient, existingClientWithBalance,
  isResolvingIdentity, matchedAppointment, onAppointmentCheckIn, dayAccessTier,
  isKnownClient, clientType, t
}: any) => {
  const primaryService = (services || []).find((s: Service) => s.id === member.serviceIds[0]);
  const requiredForms = (consentForms || []).filter((f: ConsentForm) => primaryService?.requiredFormIds?.includes(f.id));
  const subSteps: MemberSubStep[] = ['details', 'services'];
  if (requiredForms.length > 0) subSteps.push('consents');
  subSteps.push('staff');

  const stepIdx = subSteps.indexOf(memberSubStep);
  const hasNext = stepIdx < subSteps.length - 1;
  const isBlocked = !!bannedClient || !!existingClientWithBalance || isResolvingIdentity || (isKnownClient && clientType === 'new');

  const stepLabel = { details: 'Your Info', services: 'Treatment', consents: 'Agreements', staff: 'Preference' }[memberSubStep];

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {isGroup && (
            <p className={cn('text-[9px] font-black uppercase tracking-[0.2em] mb-1', t.muted)}>
              Guest {member.index + 1} of {partyMembers.length}
            </p>
          )}
          <h2 className={cn('text-2xl md:text-3xl font-black uppercase tracking-tight leading-none', t.text)}>{stepLabel}</h2>
        </div>
        <StepDots total={subSteps.length} current={stepIdx} t={t} />
      </div>

      {/* Appointment match */}
      {memberSubStep === 'details' && matchedAppointment && (
        <div className={cn('p-4 rounded-2xl border-2', t.card, t.cardBorder, 'space-y-3')}>
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-xl', t.accent, 'bg-opacity-10')}>
              <CalendarCheck className={cn('w-5 h-5', t.text)} />
            </div>
            <div>
              <p className={cn('text-[9px] font-black uppercase tracking-widest', t.muted)}>Appointment Found</p>
              <p className={cn('text-sm font-black uppercase', t.text)}>{services?.find((s: any) => s.id === matchedAppointment.serviceId)?.name}</p>
            </div>
          </div>
          <button onClick={() => onAppointmentCheckIn(matchedAppointment)}
            className={cn('w-full h-12 rounded-xl font-black uppercase text-sm', t.btn, t.btnText)}>
            Check In for This Appointment →
          </button>
          <p className={cn('text-center text-[8px] font-black uppercase tracking-widest', t.muted)}>Or continue below to change services</p>
        </div>
      )}

      {/* Member day access alert */}
      {memberSubStep === 'details' && dayAccessTier === 'members' && (
        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-indigo-600 mb-1">Members Priority Day</p>
          <p className="text-[9px] font-bold text-indigo-500 uppercase">Today is reserved for Club Members only.</p>
        </div>
      )}

      {/* Sub-step content */}
      <AnimatePresence mode="wait">
        <motion.div key={memberSubStep} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
          {memberSubStep === 'details' && (
            <StepDetails member={member} onUpdate={onUpdate} isGroup={isGroup}
              primaryMember={partyMembers?.[0]} bannedClient={bannedClient}
              existingClientWithBalance={existingClientWithBalance} isResolvingIdentity={isResolvingIdentity}
              isKnownClient={isKnownClient} clientType={clientType} t={t} />
          )}
          {memberSubStep === 'services' && <StepServices member={member} onUpdate={onUpdate} services={services} t={t} />}
          {memberSubStep === 'consents' && <StepConsents member={member} requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} t={t} />}
          {memberSubStep === 'staff' && <StepStaff member={member} onUpdate={onUpdate} staff={staff} t={t} />}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} disabled={isSubmitting}
          className={cn('h-14 px-5 rounded-2xl border-2 font-black uppercase text-sm transition-all', t.card, t.cardBorder, t.muted, 'hover:opacity-70')}>
          ←
        </button>
        <div className="flex-1 flex gap-3">
          {hasNext ? (
            <button onClick={() => onNext(subSteps[stepIdx + 1])}
              disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)}
              className={cn('flex-1 h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-30', t.btn, t.btnText)}>
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              {isGroup && !isLastMember && (
                <button onClick={onAddAnother}
                  disabled={isSubmitting || isBlocked || member.serviceIds.length === 0}
                  className={cn('flex-1 h-14 rounded-2xl border-2 font-black uppercase text-sm transition-all disabled:opacity-30', t.card, t.cardBorder, t.text)}>
                  Next Guest
                </button>
              )}
              <button onClick={onSubmit}
                disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)}
                className={cn('flex-1 h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-30', t.btn, t.btnText)}>
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
const ConfirmationScreen = ({ confirmedParty, onPrint, onDone, staff, liveAppointments, services, t }: any) => (
  <div className="p-8 md:p-10 space-y-8">
    {/* Success */}
    <div className="text-center space-y-3">
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 12, stiffness: 140 }}
        className="w-20 h-20 mx-auto rounded-3xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center"
      >
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
      </motion.div>
      <h2 className={cn('text-4xl font-black uppercase tracking-tighter', t.text)}>You're In!</h2>
      <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>We'll notify you when it's your turn</p>
    </div>

    {/* Queue positions */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {confirmedParty.map((ticket: WalkInTicketData) => (
        <div key={ticket.id} className={cn('flex items-center justify-between p-5 rounded-2xl border-2', t.card, t.cardBorder)}>
          <div>
            <p className={cn('text-[8px] font-black uppercase tracking-[0.2em] mb-1', t.muted)}>Queue Position</p>
            <p className={cn('text-4xl font-black leading-none', t.text)}>#{ticket.queuePosition}</p>
            <p className={cn('text-[10px] font-bold uppercase mt-1 truncate max-w-[120px]', t.muted)}>{ticket.name}</p>
          </div>
          <button onClick={() => onPrint(ticket)}
            className={cn('w-11 h-11 rounded-2xl border-2 flex items-center justify-center transition-all', t.card, t.cardBorder, 'hover:opacity-70')}>
            <Printer className={cn('w-5 h-5', t.muted)} />
          </button>
        </div>
      ))}
    </div>

    {/* Live floor status */}
    <LiveFloorStatus staff={staff} appointments={liveAppointments || []} services={services} t={t} />

    <button onClick={onDone}
      className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest', t.btn, t.btnText)}>
      Done
    </button>
  </div>
);

// ─── BIRTHDAY CELEBRATION ─────────────────────────────────────────────────────
const BirthdayCelebrationView = ({ clientName, onDone, t }: { clientName: string; onDone: () => void; t: typeof THEMES['light'] }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className={cn('fixed inset-0 z-[200] flex flex-col items-center justify-center p-6 text-center', t.bg)}>
    {Array.from({ length: 12 }).map((_, i) => (
      <motion.div key={i}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: '110vh', opacity: [0, 1, 1, 0] }}
        transition={{ delay: i * 0.18, duration: 2.5, repeat: Infinity }}
        className="absolute text-2xl"
        style={{ left: `${(i / 12) * 100}%`, top: '-5%' }}
      >
        {['✨', '🎉', '🎊', '💐', '⭐'][i % 5]}
      </motion.div>
    ))}
    <div className="relative z-10 space-y-8 max-w-sm">
      <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }}
        className={cn('w-28 h-28 mx-auto rounded-3xl border-2 flex items-center justify-center', t.card, t.cardBorder)}>
        <Cake className={cn('w-14 h-14', t.text)} strokeWidth={1} />
      </motion.div>
      <div>
        <h2 className={cn('text-5xl font-black leading-none', t.text)}>Happy Birthday,<br /><span className="italic font-light">{clientName.split(' ')[0]}!</span></h2>
        <p className={cn('font-bold uppercase tracking-[0.2em] text-sm mt-3', t.muted)}>Celebrating with us today</p>
      </div>
      <button onClick={onDone} className={cn('h-14 px-10 rounded-full font-black uppercase tracking-widest', t.btn, t.btnText)}>
        Continue →
      </button>
    </div>
  </motion.div>
);

// ─── CLOSED VIEW ──────────────────────────────────────────────────────────────
const ClosedView = ({ schedule, logoUrl, tenantName, t }: any) => (
  <div className={cn('text-center space-y-6 max-w-sm mx-auto p-10 rounded-3xl border-2', t.card, t.cardBorder)}>
    <div className={cn('w-20 h-20 mx-auto rounded-3xl border-2 flex items-center justify-center', t.card, t.cardBorder)}>
      {logoUrl ? <Image src={logoUrl} alt={tenantName || 'Studio'} width={48} height={48} className="object-cover rounded-xl" /> : <Clock className={cn('w-8 h-8', t.muted)} />}
    </div>
    <div>
      <h1 className={cn('text-3xl font-black uppercase tracking-tighter', t.text)}>Closed</h1>
      <p className={cn('font-bold uppercase tracking-[0.15em] text-xs mt-2', t.muted)}>Kiosk available during business hours</p>
    </div>
    {schedule && (
      <div className={cn('p-4 rounded-2xl border-2', t.card, t.cardBorder)}>
        <p className={cn('text-[8px] font-black uppercase tracking-[0.2em] mb-1', t.muted)}>Today's Hours</p>
        <p className={cn('font-black text-lg', t.text)}>{isBusinessOpen(new Date(), schedule).hours || 'Closed'}</p>
      </div>
    )}
    <Button asChild className={cn('w-full h-12 rounded-2xl font-black uppercase tracking-widest', t.btn, t.btnText)}>
      <Link href="/">Return Home</Link>
    </Button>
  </div>
);

// ─── STEP TYPES ───────────────────────────────────────────────────────────────
type Step = 'partyType' | 'partySize' | 'identityChoice' | 'phonePad' | 'identityConfirm' | 'welcomeBack' | 'memberSetup' | 'confirmation';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function WalkInPage() {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const params = useParams();
  const tenantId = params.tenantId as string;
  const methods = useForm({ defaultValues: { name: '', email: '', phone: '' } });

  // ── Queries ──
  const tenantRef     = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQ     = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQ        = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const schedulesQ    = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where('isActive', '==', true)), [firestore, tenantId]);
  const pricingQ      = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
  const consentsQ     = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const clientsQ      = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients`), [firestore, tenantId]);
  // Live appointments for floor status — servicing + confirmed today
  const liveAptsQ     = useMemoFirebase(() => query(
    collection(firestore, `tenants/${tenantId}/appointments`),
    where('status', 'in', ['confirmed', 'servicing'])
  ), [firestore, tenantId]);

  const { data: tenant }          = useDoc<Tenant>(tenantRef);
  const { data: services }        = useCollection<Service>(servicesQ);
  const { data: staff }           = useCollection<Staff>(staffQ);
  const { data: scheduleProfiles } = useCollection<any>(schedulesQ);
  const { data: pricingTiers }    = useCollection<PricingTier>(pricingQ);
  const { data: consentForms }    = useCollection<ConsentForm>(consentsQ);
  const { data: clients }         = useCollection<Client>(clientsQ);
  const { data: liveAppointments } = useCollection<Appointment>(liveAptsQ);

  // ── Theme ──
  const [theme, setTheme] = useState<KioskTheme>('light');
  const t = THEMES[theme];

  // ── Flow state ──
  const [entered, setEntered]               = useState(false);
  const [step, setStep]                     = useState<Step>('partyType');
  const [isGroup, setIsGroup]               = useState(false);
  const [partySize, setPartySize]           = useState(1);
  const [partyMembers, setPartyMembers]     = useState<PartyMember[]>([]);
  const [currentMemberIndex, setCurrentMemberIndex] = useState(0);
  const [memberSubStep, setMemberSubStep]   = useState<MemberSubStep>('details');
  const [formAnswers, setFormAnswers]       = useState<Record<string, Record<string, any>>>({});
  const [confirmedParty, setConfirmedParty] = useState<WalkInTicketData[]>([]);
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [ticketToPrint, setTicketToPrint]   = useState<WalkInTicketData | null>(null);
  const [isPrintOpen, setIsPrintOpen]       = useState(false);

  // ── Identity state ──
  const [existingClientWithBalance, setExistingClientWithBalance] = useState<Client | null>(null);
  const [bannedClient, setBannedClient]     = useState<Client | null>(null);
  const [isResolvingIdentity, setIsResolvingIdentity] = useState(false);
  const [matchedAppointment, setMatchedAppointment]   = useState<Appointment | null>(null);
  // ── FIX: separate matchedClientForConfirm from member data to avoid wipe on handleMemberUpdate ──
  const [matchedClient, setMatchedClient]             = useState<Client | null>(null);
  const [isKnownClient, setIsKnownClient]   = useState(false);
  const [clientType, setClientType]         = useState<'new' | 'returning' | null>(null);
  const [phonePadValue, setPhonePadValue]   = useState('');
  const [showBirthday, setShowBirthday]     = useState(false);
  const [birthdayName, setBirthdayName]     = useState('');

  const activeDaySchedule = useMemo(() => {
    const day = format(new Date(), 'eeee').toLowerCase();
    return scheduleProfiles?.[0]?.week?.[day] || null;
  }, [scheduleProfiles]);

  // ── Identity resolution ────────────────────────────────────────────────────
  const resolveIdentity = useCallback(async (
    email?: string,
    phone?: string,
    callerClientType?: 'new' | 'returning' | null
  ): Promise<{ isBanned: boolean; hasBalance: boolean; isKnown: boolean; client: any }> => {
    const empty = { isBanned: false, hasBalance: false, isKnown: false, client: null };
    if (!firestore || !tenantId || (!email && !phone)) return empty;
    setIsResolvingIdentity(true);
    try {
      const ref = collection(firestore, 'tenants', tenantId, 'clients');
      const promises = [];
      if (email) promises.push(getDocs(query(ref, where('email', '==', email.toLowerCase().trim()))));
      if (phone) promises.push(getDocs(query(ref, where('phone', '==', phone))));
      const snaps = await Promise.all(promises);
      const allDocs = snaps.flatMap(s => s.docs);

      if (allDocs.length > 0) {
        const d = allDocs[0];
        const clientObj = { ...d.data() as Client, id: d.id };
        setMatchedClient(clientObj);

        if (clientObj.status === 'banned') {
          setBannedClient(clientObj); setExistingClientWithBalance(null); setMatchedAppointment(null); setIsKnownClient(false);
          return { isBanned: true, hasBalance: false, isKnown: false, client: clientObj };
        }
        if ((clientObj.outstandingBalance || 0) > 0) {
          setExistingClientWithBalance(clientObj); setBannedClient(null); setMatchedAppointment(null); setIsKnownClient(false);
          return { isBanned: false, hasBalance: true, isKnown: false, client: clientObj };
        }

        setBannedClient(null); setExistingClientWithBalance(null);
        const effective = callerClientType ?? clientType;

        if (effective === 'new') {
          setIsKnownClient(true);
          return { isBanned: false, hasBalance: false, isKnown: true, client: clientObj };
        } else {
          setIsKnownClient(false);
          const aptSnap = await getDocs(query(
            collection(firestore, 'tenants', tenantId, 'appointments'),
            where('clientId', '==', d.id), where('status', '==', 'confirmed')
          ));
          const todayApt = aptSnap.docs
            .map(ad => ({ ...ad.data(), id: ad.id } as Appointment))
            .find(a => isSameDay(safeDate(a.startTime), new Date()));
          setMatchedAppointment(todayApt || null);
          return { isBanned: false, hasBalance: false, isKnown: false, client: clientObj };
        }
      } else {
        setBannedClient(null); setExistingClientWithBalance(null); setMatchedAppointment(null);
        setMatchedClient(null); setIsKnownClient(false);
        const effective = callerClientType ?? clientType;
        if (effective === 'returning' && step === 'phonePad') {
          toast({ variant: 'destructive', title: 'Profile Not Found', description: 'Continuing as first visit.' });
          setClientType('new'); setStep('memberSetup');
        }
        return empty;
      }
    } catch (e) { console.error(e); return empty; }
    finally { setIsResolvingIdentity(false); }
  }, [firestore, tenantId, clientType, step, toast]);

  // ── Flow handlers ──────────────────────────────────────────────────────────

  const handlePartyTypeSelect = (type: 'individual' | 'group') => {
    const group = type === 'group';
    setIsGroup(group);
    setCurrentMemberIndex(0);
    if (group) {
      // Groups: first ask how many, then identity for primary
      setStep('partySize');
    } else {
      setPartySize(1);
      setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
      setStep('identityChoice');
    }
  };

  const handlePartySizeConfirm = (size: number) => {
    setPartySize(size);
    // Create all member slots upfront with empty data
    const members: PartyMember[] = Array.from({ length: size }, (_, i) => ({
      id: nanoid(5), name: '', serviceIds: [], isPrimary: i === 0, preferredStaffId: 'any', waitForPreferredStaff: false,
    }));
    setPartyMembers(members);
    // Ask primary member identity
    setStep('identityChoice');
  };

  const handleIdentitySelect = (type: 'new' | 'returning') => {
    setClientType(type);
    if (type === 'returning') { setStep('phonePad'); setPhonePadValue(''); }
    else { setMemberSubStep('details'); setStep('memberSetup'); }
  };

  // FIXED: only navigate to identityConfirm if client found
  const handlePhonePadConfirm = async () => {
    if (phonePadValue.length < 10) return;
    const result = await resolveIdentity(undefined, `+1${phonePadValue}`, 'returning');
    if (result.client) setStep('identityConfirm');
    // else: resolveIdentity already redirected to memberSetup
  };

  // FIXED: don't call handleMemberUpdate with phone/email here — that wipes matchedClient
  // Instead, pre-fill member separately without triggering the identity reset
  const handleIdentityConfirm = async () => {
    if (!matchedClient) return;
    // Pre-fill member data WITHOUT calling handleMemberUpdate (which would clear matchedClient)
    setPartyMembers(prev => prev.map((m, i) =>
      i === currentMemberIndex
        ? { ...m, name: matchedClient.name || m.name, email: matchedClient.email || m.email, phone: matchedClient.phone || m.phone }
        : m
    ));
    if (matchedAppointment) {
      await handleAppointmentCheckIn(matchedAppointment);
    } else {
      setMemberSubStep('services');
      setStep('welcomeBack');
    }
  };

  // FIXED: only reset identity flags when contact info actually changes (not on name-only updates)
  const handleMemberUpdate = (updates: Partial<PartyMember>) => {
    const contactChanged = updates.phone !== undefined || updates.email !== undefined;
    if (contactChanged) {
      setIsKnownClient(false);
      setBannedClient(null);
      setExistingClientWithBalance(null);
      setMatchedAppointment(null);
      // DO NOT clear matchedClient here — that breaks the welcomeBack flow
      // matchedClient is only cleared when user explicitly goes back to phonePad
    }
    setPartyMembers(prev => prev.map((m, i) => i === currentMemberIndex ? { ...m, ...updates } : m));
  };

  const handleNextSubStep = async (next: MemberSubStep) => {
    const member = partyMembers[currentMemberIndex];
    if (memberSubStep === 'details') {
      if (!member.phone || member.phone.length < 5) return toast({ variant: 'destructive', title: 'Phone Required' });
      if (!member.name.trim()) return toast({ variant: 'destructive', title: 'Name Required' });
      if (!member.email?.trim()) return toast({ variant: 'destructive', title: 'Email Required' });
      if (!/^\S+@\S+\.\S+$/.test(member.email!)) return toast({ variant: 'destructive', title: 'Invalid Email' });

      const result = await resolveIdentity(member.email, member.phone, clientType);
      if (result.isBanned || result.hasBalance) return;
      if (result.isKnown && clientType === 'new') return;

      const dayAccess = activeDaySchedule?.accessTier || 'all';
      if (dayAccess === 'members') {
        const isMember = !!(matchedClient?.activeMembershipId || matchedClient?.subscription);
        const hasPackage = (matchedClient?.activePackages?.length || 0) > 0;
        if (!isMember && !hasPackage) { toast({ variant: 'destructive', title: 'Members Only Today' }); return; }
      } else if (dayAccess === 'returning' && !matchedClient) {
        toast({ variant: 'destructive', title: 'Return Guests Only Today' }); return;
      }
    }
    if (memberSubStep === 'services' && member.serviceIds.length === 0) {
      return toast({ variant: 'destructive', title: 'Please select a service' });
    }
    setMemberSubStep(next);
  };

  const handleBack = () => {
    if (memberSubStep === 'details') {
      if (currentMemberIndex > 0) {
        setCurrentMemberIndex(prev => prev - 1);
        setMemberSubStep('staff');
      } else {
        setStep('identityChoice');
        setMemberSubStep('details');
      }
    } else {
      const member = partyMembers[currentMemberIndex];
      const primary = (services || []).find((s: Service) => s.id === member.serviceIds[0]);
      const forms = (consentForms || []).filter((f: ConsentForm) => primary?.requiredFormIds?.includes(f.id));
      const steps: MemberSubStep[] = ['details', 'services'];
      if (forms.length > 0) steps.push('consents');
      steps.push('staff');
      const idx = steps.indexOf(memberSubStep);
      setMemberSubStep(steps[idx - 1]);
    }
  };

  const handleAppointmentCheckIn = async (apt: Appointment) => {
    if (isSubmitting || !firestore || !tenantId) return;
    setIsSubmitting(true);
    const batch = writeBatch(firestore);
    try {
      batch.update(doc(firestore, 'tenants', tenantId, 'appointments', apt.id), { checkInStatus: 'arrived' });
      if (apt.checkInToken) batch.update(doc(firestore, 'appointmentCheckIns', apt.checkInToken), { checkInStatus: 'arrived', tenantId });
      if (apt.staffId) {
        const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        batch.set(nRef, { id: nanoid(), userId: apt.staffId, type: 'client_movement', message: `${apt.clientName || 'Your guest'} checked in.`, link: '/planner', createdAt: new Date().toISOString(), read: false });
      }
      await batch.commit();
      const ticket: WalkInTicketData = { id: apt.id, name: apt.clientName || 'Guest', services: (services || []).filter(s => s.id === apt.serviceId), queuePosition: 0, checkInTime: new Date().toISOString() };
      setConfirmedParty([ticket]);
      const mc = (clients || []).find(c => c.id === apt.clientId);
      if (mc && isBirthdayToday(mc.birthday)) { setBirthdayName(mc.name || 'Guest'); setShowBirthday(true); }
      else setStep('confirmation');
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
    let birthdayMemberName = '';
    try {
      const qSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/walkIns`), where('status', '==', 'waiting')));
      let pos = qSnap.size + 1;

      for (const member of partyMembers) {
        const mc = (clients || []).find(c =>
          (member.email && c.email?.toLowerCase() === member.email.toLowerCase()) ||
          (member.phone && c.phone === member.phone)
        );
        let clientId = mc?.id;
        if (mc && isBirthdayToday(mc.birthday)) birthdayMemberName = mc.name || member.name;

        if (!clientId) {
          clientId = nanoid();
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), {
            id: clientId, name: member.name, email: member.email || '', phone: member.phone || '',
            avatarUrl: `https://picsum.photos/seed/${clientId}/100`, lifetimeValue: 0, lastAppointment: now, status: 'active'
          });
        } else {
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId),
            { name: member.name, email: member.email || '', phone: member.phone || '', lastAppointment: now },
            { merge: true });
        }

        const walkInId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/walkIns`, walkInId), {
          id: walkInId, groupId, isPrimaryContact: !!member.isPrimary, clientId,
          customerName: member.name, customerPhone: member.phone || '', customerEmail: member.email || '',
          serviceIds: member.serviceIds, checkInTime: now, status: 'waiting',
          queueOrder: Date.now() + (tickets.length * 1000), // space group members 1 second apart
          waitForPreferredStaff: !!member.waitForPreferredStaff,
          estimatedDuration: (services || []).filter(s => member.serviceIds.includes(s.id)).reduce((a, s) => a + (s.duration || 0), 0) || 0,
          ...(isGroup && tickets.length === 0 ? {} : {}),
          ...(isGroup && { groupName: `${partyMembers[0].name}'s Party`, groupSize: partyMembers.length }),
          ...(member.preferredStaffId && member.preferredStaffId !== 'any' ? { preferredStaffId: member.preferredStaffId } : {}),
        });

        const memberAnswers = formAnswers[member.id] || {};
        Object.entries(memberAnswers).forEach(([formId, data]) => {
          const cRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
          const form = (consentForms || []).find(f => f.id === formId);
          batch.set(cRef, { id: cRef.id, formId, formTitle: form?.title || 'Form', clientId, signedAt: now, formData: data });
        });
        tickets.push({ id: walkInId, name: member.name, services: (services || []).filter(s => member.serviceIds.includes(s.id)), queuePosition: pos++, checkInTime: now });
      }

      await batch.commit();
      setConfirmedParty(tickets);
      if (birthdayMemberName) { setBirthdayName(birthdayMemberName); setShowBirthday(true); }
      else setStep('confirmation');
    } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Check-in Error' }); }
    finally { setIsSubmitting(false); }
  };

  function isBirthdayToday(birthday?: string) {
    if (!birthday) return false;
    const b = safeDate(birthday); const today = new Date();
    return b.getDate() === today.getDate() && b.getMonth() === today.getMonth();
  }

  const resetAll = () => {
    setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({});
    setMatchedAppointment(null); setPhonePadValue(''); setClientType(null);
    setMatchedClient(null); setIsKnownClient(false); setCurrentMemberIndex(0);
    setPartySize(1); setIsGroup(false); setMemberSubStep('details');
    setBannedClient(null); setExistingClientWithBalance(null);
  };

  // ── Kiosk settings ──
  const kioskSettings  = tenant?.kioskSettings;
  const logoUrl        = kioskSettings?.logoUrl;
  const wordmarkUrl    = kioskSettings?.wordmarkUrl;
  const showWordmark   = kioskSettings?.showWordmark !== false;
  const customColor    = kioskSettings?.primaryColor;
  const activeStaff    = useMemo(() => (staff || []).filter(s => s.active && !s.onBreak), [staff]);
  const isClosed       = !isBusinessOpen(new Date(), scheduleProfiles?.[0]).open;

  if (!tenant || !services) return (
    <div className={cn('h-screen flex items-center justify-center', THEMES.light.bg)}>
      <Loader className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );

  // Phone pad handlers
  const handlePhoneDigit = (d: string) => { if (phonePadValue.length < 10) setPhonePadValue(p => p + d); };
  const handlePhoneDelete = () => setPhonePadValue(p => p.slice(0, -1));

  return (
    <div className={cn('min-h-screen flex flex-col overflow-x-hidden relative', t.bg)}>
      {/* Dark theme mesh */}
      {(theme === 'dark' || theme === 'slate') && <DarkMeshBg primaryHex={customColor} />}

      <FormProvider {...methods}>
        {/* Theme switcher — top right corner, subtle */}
        {entered && (
          <div className="fixed top-4 right-4 z-50">
            <ThemeSwitcher current={theme} onChange={setTheme} />
          </div>
        )}

        {isClosed ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <ClosedView schedule={scheduleProfiles?.[0]} logoUrl={logoUrl} tenantName={tenant.name} t={t} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4 md:p-8">
            <AnimatePresence mode="wait">
              {!entered ? (
                // ── Splash screen ──
                <motion.div key="splash"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.03 }}
                  className="text-center cursor-pointer select-none p-8 z-10 w-full max-w-md"
                  onClick={() => setEntered(true)}
                >
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} className="mb-10">
                    <div className={cn(
                      'relative overflow-hidden mx-auto',
                      showWordmark ? 'w-24 h-24 rounded-3xl' : 'w-40 h-40 rounded-[2.5rem]',
                      logoUrl ? 'shadow-xl' : cn('border-2', t.card, t.cardBorder)
                    )}>
                      {logoUrl
                        ? <Image src={logoUrl} alt={tenant.name} fill className="object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><ClarityFlowLogo className="w-16 h-16 opacity-30" /></div>}
                    </div>
                  </motion.div>

                  {showWordmark && (
                    <div className="mb-8">
                      {wordmarkUrl
                        ? <div className="relative h-16 w-[280px] mx-auto"><Image src={wordmarkUrl} alt={tenant.name} fill className="object-contain" /></div>
                        : <h1 className={cn('text-5xl md:text-6xl font-black uppercase tracking-tighter leading-none', t.text)}>{tenant.name}</h1>}
                    </div>
                  )}

                  <motion.p animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 2.5, repeat: Infinity }}
                    className={cn('text-sm font-black uppercase tracking-[0.35em]', t.muted)}>
                    Tap to check in
                  </motion.p>

                  {/* Theme switcher on splash too */}
                  <div className="mt-8 flex justify-center">
                    <ThemeSwitcher current={theme} onChange={setTheme} />
                  </div>
                </motion.div>
              ) : (
                // ── Main flow card ──
                <div className="w-full max-w-2xl mx-auto z-10">
                  <AnimatePresence mode="wait">

                    {/* Party type */}
                    {step === 'partyType' && (
                      <motion.div key="party">
                        <SurfaceCard t={t}>
                          <div className="p-8 md:p-12 space-y-8">
                            <div className="text-center space-y-2">
                              <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Walk-in Check-in</p>
                              <h2 className={cn('text-4xl md:text-5xl font-black uppercase tracking-tighter leading-none', t.text)}>Welcome</h2>
                              <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>Who are we checking in today?</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <ChoiceTile onClick={() => handlePartyTypeSelect('individual')} icon={User} title="Just Me" subtitle="Solo check-in" t={t} />
                              <ChoiceTile onClick={() => handlePartyTypeSelect('group')} icon={Users} title="My Party" subtitle="Multiple guests" t={t} />
                            </div>
                          </div>
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Party size */}
                    {step === 'partySize' && (
                      <motion.div key="partysize">
                        <SurfaceCard t={t}>
                          <PartySizeView onSelect={handlePartySizeConfirm} onBack={() => setStep('partyType')} t={t} />
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Identity choice */}
                    {step === 'identityChoice' && (
                      <motion.div key="identity">
                        <SurfaceCard t={t}>
                          <div className="p-8 md:p-12 space-y-8">
                            <div className="text-center space-y-2">
                              <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>
                                {isGroup ? `Party of ${partySize} · Primary Guest` : 'Identity'}
                              </p>
                              <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>First visit?</h2>
                              <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>Help us find your profile</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <ChoiceTile onClick={() => handleIdentitySelect('returning')} icon={Star} title="Return Guest" subtitle="I've been here before" t={t} />
                              <ChoiceTile onClick={() => handleIdentitySelect('new')} icon={PlusCircle} title="First Visit" subtitle="Brand new guest" t={t} />
                            </div>
                            <div className="text-center">
                              <button onClick={() => setStep(isGroup ? 'partySize' : 'partyType')}
                                className={cn('text-[10px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70 transition-opacity')}>
                                ← Back
                              </button>
                            </div>
                          </div>
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Phone pad */}
                    {step === 'phonePad' && (
                      <motion.div key="phone">
                        <SurfaceCard t={t}>
                          <div className="p-8 md:p-12 space-y-8">
                            <div className="text-center space-y-2">
                              <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Return Guest</p>
                              <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>Your Phone</h2>
                              <p className={cn('font-bold uppercase tracking-[0.15em] text-sm', t.muted)}>Enter the number on file</p>
                            </div>
                            {/* Display */}
                            <div className={cn('mx-auto max-w-xs p-6 rounded-2xl border-2 text-center', t.card, t.cardBorder)}>
                              <p className={cn('text-3xl md:text-4xl font-black font-mono tracking-widest min-h-[1.2em]', t.text)}>
                                {(() => {
                                  const c = phonePadValue;
                                  if (!c) return <span className={t.muted}>––––––––</span>;
                                  if (c.length <= 3) return `(${c})`;
                                  if (c.length <= 6) return `(${c.slice(0,3)}) ${c.slice(3)}`;
                                  return `(${c.slice(0,3)}) ${c.slice(3,6)}-${c.slice(6)}`;
                                })()}
                              </p>
                            </div>
                            {/* Keypad */}
                            <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
                              {['1','2','3','4','5','6','7','8','9','','0','del'].map((d, i) => {
                                if (d === '') return <div key={i} />;
                                if (d === 'del') return (
                                  <motion.button key={i} whileTap={{ scale: 0.88 }} onClick={handlePhoneDelete}
                                    className={cn('h-14 w-14 mx-auto rounded-xl flex items-center justify-center', t.muted, 'hover:opacity-70 transition-opacity')}>
                                    <Delete className="w-5 h-5" strokeWidth={1.5} />
                                  </motion.button>
                                );
                                return (
                                  <motion.button key={i} whileTap={{ scale: 0.9 }} onClick={() => handlePhoneDigit(d)}
                                    className={cn('h-14 w-14 mx-auto rounded-xl border-2 text-xl font-bold transition-all', t.card, t.cardBorder, t.text, 'hover:opacity-80')}>
                                    {d}
                                  </motion.button>
                                );
                              })}
                            </div>
                            <div className="space-y-3 max-w-xs mx-auto">
                              <button onClick={handlePhonePadConfirm} disabled={phonePadValue.length < 10 || isResolvingIdentity}
                                className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-30', t.btn, t.btnText)}>
                                {isResolvingIdentity ? <Loader className="w-5 h-5 animate-spin" /> : <>Find Profile <ArrowRight className="w-4 h-4" /></>}
                              </button>
                              <button onClick={() => setStep('identityChoice')}
                                className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70 transition-opacity')}>
                                ← Back
                              </button>
                            </div>
                          </div>
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Identity confirm */}
                    {step === 'identityConfirm' && (
                      <motion.div key="confirm">
                        <SurfaceCard t={t}>
                          {matchedClient ? (
                            <div className="p-8 md:p-12 space-y-8 text-center">
                              <div className="space-y-2">
                                <p className={cn('text-[9px] font-black uppercase tracking-[0.3em]', t.muted)}>Profile Found</p>
                                <h2 className={cn('text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none', t.text)}>Is this you?</h2>
                              </div>
                              <div className="flex flex-col items-center gap-4">
                                <div className="relative">
                                  <Avatar className="w-28 h-28 rounded-3xl border-2 border-slate-200/50 shadow-lg">
                                    <AvatarImage src={matchedClient.avatarUrl} className="object-cover" />
                                    <AvatarFallback className={cn('text-3xl font-black', t.surface, t.text)}>{(matchedClient.name || 'G').charAt(0)}</AvatarFallback>
                                  </Avatar>
                                  <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white shadow-md">
                                    <Check className="w-4 h-4 text-white" />
                                  </div>
                                </div>
                                <div>
                                  <h3 className={cn('text-2xl font-black uppercase tracking-tight', t.text)}>{matchedClient.name}</h3>
                                  <p className={cn('text-xs font-bold uppercase tracking-widest mt-1', t.muted)}>{matchedClient.email || matchedClient.phone}</p>
                                </div>
                              </div>
                              <div className="space-y-3 max-w-xs mx-auto">
                                <button onClick={handleIdentityConfirm}
                                  className={cn('w-full h-14 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2', t.btn, t.btnText)}>
                                  Yes, That's Me <Check className="w-4 h-4" />
                                </button>
                                <button onClick={() => { setMatchedClient(null); setStep('phonePad'); }}
                                  className={cn('w-full text-center text-[10px] font-black uppercase tracking-widest', t.muted, 'hover:opacity-70 transition-opacity')}>
                                  Not me → try again
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-12 text-center space-y-4">
                              <p className={cn('font-bold uppercase text-sm', t.muted)}>Something went wrong</p>
                              <button onClick={() => setStep('phonePad')} className={cn('h-12 px-8 rounded-2xl font-black uppercase', t.btn, t.btnText)}>
                                Try Again
                              </button>
                            </div>
                          )}
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Welcome back */}
                    {step === 'welcomeBack' && (
                      <motion.div key="welcome">
                        <SurfaceCard t={t}>
                          <div className="p-12 md:p-16 text-center space-y-8">
                            <motion.div
                              initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                              transition={{ type: 'spring', damping: 14, stiffness: 140 }}
                              className={cn('w-24 h-24 mx-auto rounded-3xl border-2 flex items-center justify-center', t.card, t.cardBorder)}>
                              <Sparkles className={cn('w-12 h-12', t.muted)} strokeWidth={1} />
                            </motion.div>
                            <div className="space-y-3">
                              {/* FIX: use matchedClient directly — no longer null because we don't wipe it in handleIdentityConfirm */}
                              <h2 className={cn('text-4xl md:text-5xl font-black leading-none', t.text)}>
                                Welcome back,<br />
                                <span className={cn('italic font-light', t.muted)}>
                                  {matchedClient?.name?.split(' ')[0] || partyMembers[0]?.name?.split(' ')[0] || 'friend'}
                                </span>
                              </h2>
                              <p className={cn('font-bold uppercase tracking-[0.2em] text-sm', t.muted)}>Great to see you again</p>
                            </div>
                            <button onClick={() => setStep('memberSetup')}
                              className={cn('h-14 px-10 rounded-2xl font-black uppercase tracking-widest inline-flex items-center gap-2', t.btn, t.btnText)}>
                              Continue <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Member setup */}
                    {step === 'memberSetup' && partyMembers[currentMemberIndex] && (
                      <motion.div key={`member-${currentMemberIndex}`}>
                        <SurfaceCard t={t}>
                          <MemberSetup
                            member={{ ...partyMembers[currentMemberIndex], index: currentMemberIndex }}
                            partyMembers={partyMembers}
                            onUpdate={handleMemberUpdate}
                            memberSubStep={memberSubStep}
                            services={services}
                            staff={activeStaff}
                            pricingTiers={pricingTiers || []}
                            consentForms={consentForms || []}
                            formAnswers={formAnswers[partyMembers[currentMemberIndex].id] || {}}
                            setFormAnswers={(a: any) => setFormAnswers(p => ({ ...p, [partyMembers[currentMemberIndex].id]: a }))}
                            onNext={handleNextSubStep}
                            onBack={handleBack}
                            isGroup={isGroup}
                            isLastMember={currentMemberIndex === partyMembers.length - 1}
                            onAddAnother={() => {
                              setCurrentMemberIndex(prev => prev + 1);
                              setMemberSubStep('details');
                              // Clear identity flags for next member
                              setBannedClient(null); setExistingClientWithBalance(null);
                              setMatchedAppointment(null); setIsKnownClient(false);
                            }}
                            onSubmit={handleSubmit}
                            isSubmitting={isSubmitting}
                            bannedClient={bannedClient}
                            existingClientWithBalance={existingClientWithBalance}
                            isResolvingIdentity={isResolvingIdentity}
                            matchedAppointment={matchedAppointment}
                            onAppointmentCheckIn={handleAppointmentCheckIn}
                            dayAccessTier={activeDaySchedule?.accessTier}
                            isKnownClient={isKnownClient}
                            clientType={clientType}
                            t={t}
                          />
                        </SurfaceCard>
                      </motion.div>
                    )}

                    {/* Confirmation */}
                    {step === 'confirmation' && (
                      <motion.div key="done">
                        <SurfaceCard t={t}>
                          <ConfirmationScreen
                            confirmedParty={confirmedParty}
                            onPrint={ticket => { setTicketToPrint(ticket); setIsPrintOpen(true); }}
                            onDone={resetAll}
                            staff={staff}
                            liveAppointments={liveAppointments || []}
                            services={services}
                            t={t}
                          />
                        </SurfaceCard>
                      </motion.div>
                    )}

                  </AnimatePresence>
                </div>
              )}
            </AnimatePresence>
          </div>
        )}
      </FormProvider>

      {/* Birthday overlay */}
      <AnimatePresence>
        {showBirthday && (
          <BirthdayCelebrationView
            clientName={birthdayName}
            onDone={() => { setShowBirthday(false); setStep('confirmation'); }}
            t={t}
          />
        )}
      </AnimatePresence>

      {/* Print dialog */}
      <Dialog open={isPrintOpen} onOpenChange={setIsPrintOpen}>
        <DialogContent className={cn('max-w-sm rounded-3xl border-2 p-0 overflow-hidden', t.card, t.cardBorder)}>
          <DialogHeader className={cn('p-6 border-b', t.cardBorder)}>
            <DialogTitle className={cn('text-center font-black uppercase tracking-tight', t.text)}>Print Ticket</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center p-8 bg-white">
            {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
          </div>
          <DialogFooter className={cn('p-4 border-t', t.cardBorder)}>
            <button onClick={() => { window.print(); setIsPrintOpen(false); }}
              className={cn('w-full h-12 rounded-2xl font-black uppercase tracking-widest', t.btn, t.btnText)}>
              Print
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}