'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import {
  type Service, type Staff, type ConsentForm, type Tenant,
  type Client, type PartyMember, type PricingTier, type Appointment
} from '@/lib/data';
import { Progress } from '@/components/ui/progress';
import {
  Sparkles, User, Phone, ArrowRight, ArrowLeft, Users, Mail, Loader, Clock,
  PlusCircle, Check, Printer, DollarSign, FileSignature, XCircle, Ban,
  ShieldCheck, Star, ArrowDown, Cake, PartyPopper, Delete, CalendarCheck,
  CheckCircle2, Award, Lock, AlertTriangle, Activity, Timer,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { format, parseISO, parse, isSameDay, addMinutes, differenceInMinutes } from 'date-fns';
import { cn, hexToHSLComponents } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  if (typeof val === 'string') return parseISO(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const isBusinessOpen = (date: Date, schedule: any) => {
  if (!schedule?.week) return { open: true };
  const dayName = format(date, 'eeee').toLowerCase();
  const dayHours = schedule.week[dayName];
  if (!dayHours?.enabled) return { open: false };
  try {
    const now = date;
    const parseTime = (t: string) => parse(t, t.length > 7 ? 'hh:mm a' : 'h:mm a', now);
    return { open: now >= parseTime(dayHours.start) && now <= parseTime(dayHours.end), hours: `${dayHours.start} – ${dayHours.end}` };
  } catch { return { open: true }; }
};

// ─── ANIMATED BACKGROUND ──────────────────────────────────────────────────────
const MeshBackground = ({ primaryColor }: { primaryColor?: string }) => (
  <div className="fixed inset-0 -z-10 overflow-hidden">
    <div className="absolute inset-0 bg-[#0a0a0f]" />
    <div
      className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] rounded-full opacity-30 blur-[120px]"
      style={{ background: primaryColor ? `${primaryColor}40` : 'radial-gradient(circle, #7c3aed40, transparent)' }}
    />
    <div
      className="absolute -bottom-[30%] -right-[10%] w-[70%] h-[70%] rounded-full opacity-20 blur-[100px]"
      style={{ background: primaryColor ? `${primaryColor}30` : 'radial-gradient(circle, #ec489940, transparent)' }}
    />
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[40%] rounded-full opacity-10 blur-[80px]"
      style={{ background: 'radial-gradient(circle, #06b6d420, transparent)' }}
    />
    {/* Grain overlay */}
    <div className="absolute inset-0 opacity-[0.03]" style={{
      backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
      backgroundSize: '200px'
    }} />
  </div>
);

// ─── GLASS CARD WRAPPER ────────────────────────────────────────────────────────
const GlassCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 16, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -8, scale: 0.98 }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    className={cn(
      'relative w-full max-w-2xl mx-auto overflow-hidden',
      'bg-white/[0.04] backdrop-blur-2xl',
      'border border-white/10',
      'rounded-[2rem] md:rounded-[3rem]',
      'shadow-[0_32px_64px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]',
      className
    )}
  >
    {/* Inner top glow line */}
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    {children}
  </motion.div>
);

// ─── STEP INDICATOR ───────────────────────────────────────────────────────────
const StepIndicator = ({ steps, current }: { steps: string[]; current: number }) => (
  <div className="flex items-center justify-center gap-2 pb-4">
    {steps.map((label, i) => (
      <React.Fragment key={i}>
        <div className={cn(
          'flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-500',
          i === current
            ? 'bg-white/15 text-white border border-white/20'
            : i < current
            ? 'text-white/30'
            : 'text-white/20'
        )}>
          {i < current ? <Check className="w-2.5 h-2.5" /> : <span className="w-3 h-3 rounded-full border border-current flex items-center justify-center text-[7px]">{i + 1}</span>}
          <span className="hidden md:inline">{label}</span>
        </div>
        {i < steps.length - 1 && <div className={cn('h-px w-4 transition-all duration-500', i < current ? 'bg-white/30' : 'bg-white/10')} />}
      </React.Fragment>
    ))}
  </div>
);

// ─── CHOICE TILE ──────────────────────────────────────────────────────────────
const ChoiceTile = ({ onClick, icon: Icon, title, subtitle, accent = false }: any) => (
  <motion.button
    whileHover={{ scale: 1.02, y: -4 }}
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    className={cn(
      'group relative flex flex-col items-center justify-center p-8 md:p-12 rounded-[2rem] border transition-all duration-300 cursor-pointer text-center',
      accent
        ? 'bg-white/10 border-white/20 hover:bg-white/15 hover:border-white/30'
        : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] hover:border-white/20'
    )}
  >
    {/* Glow on hover */}
    <div className="absolute inset-0 rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-white/5 to-transparent" />
    <div className={cn(
      'relative mb-5 p-5 rounded-2xl transition-all duration-500',
      accent ? 'bg-white/10 group-hover:bg-white/15' : 'bg-white/[0.06] group-hover:bg-white/10'
    )}>
      <Icon className="w-10 h-10 md:w-14 md:h-14 text-white" strokeWidth={1.2} />
    </div>
    <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight text-white leading-none mb-2">{title}</h3>
    <p className="text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] text-white/40">{subtitle}</p>
  </motion.button>
);

// ─── PARTY TYPE SELECTION ─────────────────────────────────────────────────────
const PartyTypeSelection = ({ onSelect }: { onSelect: (t: 'individual' | 'group') => void }) => (
  <div className="p-8 md:p-12 space-y-8">
    <div className="text-center space-y-2">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Studio Check-in</p>
      <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-white leading-none">Welcome</h2>
      <p className="text-sm md:text-base text-white/40 font-bold uppercase tracking-[0.15em]">Who are we checking in today?</p>
    </div>
    <div className="grid grid-cols-2 gap-4 md:gap-6 pt-4">
      <ChoiceTile onClick={() => onSelect('individual')} icon={User} title="Solo" subtitle="Just me" accent />
      <ChoiceTile onClick={() => onSelect('group')} icon={Users} title="My Party" subtitle="Group check-in" />
    </div>
  </div>
);

// ─── IDENTITY CHOICE ──────────────────────────────────────────────────────────
const IdentityChoiceView = ({ onSelect, onBack, isGroup }: { onSelect: (t: 'new' | 'returning') => void; onBack: () => void; isGroup?: boolean }) => (
  <div className="p-8 md:p-12 space-y-8">
    <div className="text-center space-y-2">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">{isGroup ? 'Primary Guest' : 'Identity'}</p>
      <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white leading-none">First visit?</h2>
      <p className="text-sm text-white/40 font-bold uppercase tracking-[0.15em]">Help us find your profile</p>
    </div>
    <div className="grid grid-cols-2 gap-4 pt-4">
      <ChoiceTile onClick={() => onSelect('returning')} icon={Star} title="Return Guest" subtitle="I've been here before" accent />
      <ChoiceTile onClick={() => onSelect('new')} icon={PlusCircle} title="First Visit" subtitle="I'm new here" />
    </div>
    <div className="text-center">
      <button onClick={onBack} className="text-white/30 font-bold uppercase tracking-widest text-[10px] hover:text-white/50 transition-colors">← Back</button>
    </div>
  </div>
);

// ─── PHONE PAD ────────────────────────────────────────────────────────────────
const PhonePadView = ({ value, onDigit, onDelete, onConfirm, onBack, isVerifying }: any) => {
  const digits = ['1','2','3','4','5','6','7','8','9','','0','del'];
  const formatted = useMemo(() => {
    const c = value.replace(/\D/g,'');
    if (!c) return '';
    if (c.length <= 3) return `(${c})`;
    if (c.length <= 6) return `(${c.slice(0,3)}) ${c.slice(3)}`;
    return `(${c.slice(0,3)}) ${c.slice(3,6)}-${c.slice(6)}`;
  }, [value]);

  return (
    <div className="p-8 md:p-12 space-y-8">
      <div className="text-center space-y-2">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Returning Guest</p>
        <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-white leading-none">Your Phone</h2>
        <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Enter the number on file</p>
      </div>

      {/* Display */}
      <div className="mx-auto max-w-xs">
        <div className="bg-white/[0.06] border border-white/10 rounded-2xl p-6 text-center">
          <p className="text-3xl md:text-4xl font-black font-mono tracking-widest text-white min-h-[1.2em]">
            {formatted || <span className="text-white/20">( _ _ _ )</span>}
          </p>
        </div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
        {digits.map((d, i) => {
          if (d === '') return <div key={i} />;
          if (d === 'del') return (
            <motion.button key={i} whileTap={{ scale: 0.88 }} onClick={onDelete}
              className="h-14 w-14 mx-auto rounded-xl flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
              <Delete className="w-5 h-5" strokeWidth={1.5} />
            </motion.button>
          );
          return (
            <motion.button key={i} whileTap={{ scale: 0.9 }}
              onClick={() => onDigit(d)}
              className="h-14 w-14 mx-auto bg-white/[0.06] border border-white/10 rounded-xl text-xl font-bold text-white hover:bg-white/10 hover:border-white/20 transition-all flex items-center justify-center">
              {d}
            </motion.button>
          );
        })}
      </div>

      <div className="space-y-3 max-w-xs mx-auto">
        <Button onClick={onConfirm} disabled={value.length < 10 || isVerifying}
          className="w-full h-14 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90 disabled:opacity-30 transition-all">
          {isVerifying ? <Loader className="w-5 h-5 animate-spin" /> : <>Find My Profile <ArrowRight className="ml-2 w-4 h-4" /></>}
        </Button>
        <button onClick={onBack} className="w-full text-center text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white/50 transition-colors">← Back</button>
      </div>
    </div>
  );
};

// ─── IDENTITY CONFIRM ─────────────────────────────────────────────────────────
const IdentityConfirmView = ({ client, onConfirm, onBack }: { client: Client; onConfirm: () => void; onBack: () => void }) => (
  <div className="p-8 md:p-12 space-y-8 text-center">
    <div className="space-y-2">
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Profile Found</p>
      <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-white">Is this you?</h2>
    </div>
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <div className="w-28 h-28 rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl">
          <Avatar className="w-full h-full">
            <AvatarImage src={client.avatarUrl} className="object-cover" />
            <AvatarFallback className="bg-white/10 text-white text-3xl font-black">{(client.name||'G').charAt(0)}</AvatarFallback>
          </Avatar>
        </div>
        <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-green-500 rounded-full flex items-center justify-center border-2 border-[#0a0a0f]">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
      </div>
      <div>
        <h3 className="text-2xl font-black uppercase tracking-tight text-white">{client.name}</h3>
        <p className="text-xs text-white/40 font-bold uppercase tracking-widest mt-1">{client.email || client.phone}</p>
      </div>
    </div>
    <div className="space-y-3 max-w-xs mx-auto">
      <Button onClick={onConfirm} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90">
        Yes, That's Me <Check className="ml-2 w-4 h-4" />
      </Button>
      <button onClick={onBack} className="w-full text-center text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white/50 transition-colors">Not me → back</button>
    </div>
  </div>
);

// ─── WELCOME BACK ─────────────────────────────────────────────────────────────
const WelcomeBackView = ({ name, onContinue }: { name: string; onContinue: () => void }) => (
  <div className="p-12 md:p-16 text-center space-y-8">
    <motion.div
      initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', damping: 15, stiffness: 150 }}
      className="w-24 h-24 mx-auto rounded-3xl bg-white/10 border border-white/20 flex items-center justify-center"
    >
      <Sparkles className="w-12 h-12 text-white" strokeWidth={1} />
    </motion.div>
    <div className="space-y-3">
      <h2 className="text-4xl md:text-6xl font-black text-white leading-none">
        Welcome back,<br />
        <span className="italic font-light text-white/70">{name.split(' ')[0]}</span>
      </h2>
      <p className="text-white/40 font-bold uppercase tracking-[0.2em] text-sm">Great to see you again</p>
    </div>
    <Button onClick={onContinue} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90">
      Continue <ArrowRight className="ml-2 w-4 h-4" />
    </Button>
  </div>
);

// ─── LIVE FLOOR STATUS (new component for kiosk) ──────────────────────────────
const LiveFloorStatus = ({ staff, appointments, services }: { staff: Staff[] | null; appointments: any[]; services: Service[] | null }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const activeStaff = useMemo(() => {
    return (staff || []).filter(s => s.active).map(s => {
      const currentApt = (appointments || []).find(a => a.staffId === s.id && a.status === 'servicing');
      const nextApt = (appointments || [])
        .filter(a => a.staffId === s.id && a.status === 'confirmed' && safeDate(a.startTime) > now)
        .sort((a, b) => safeDate(a.startTime).getTime() - safeDate(b.startTime).getTime())[0];

      let statusLabel = 'Available';
      let statusColor = 'bg-green-500';
      let estimatedFree: number | null = null;

      if ((s as any).onBreak) {
        statusLabel = 'On Break'; statusColor = 'bg-amber-500';
      } else if (s.status === 'busy' || currentApt) {
        statusLabel = 'In Service'; statusColor = 'bg-blue-500';
        if (currentApt?.endTime) {
          const mins = differenceInMinutes(safeDate(currentApt.endTime), now);
          if (mins > 0) estimatedFree = mins;
          else statusLabel = 'Finishing';
        }
      } else if (!s.active) {
        statusLabel = 'Off Shift'; statusColor = 'bg-white/20';
      }

      return { ...s, statusLabel, statusColor, estimatedFree, currentApt, nextApt };
    });
  }, [staff, appointments, now]);

  if (activeStaff.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30 text-center">Studio Floor</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {activeStaff.map(member => (
          <div key={member.id} className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 flex flex-col items-center gap-2 text-center">
            <div className="relative">
              <Avatar className="w-12 h-12 rounded-xl border border-white/20">
                <AvatarImage src={member.avatarUrl} className="object-cover" />
                <AvatarFallback className="bg-white/10 text-white font-black text-sm">{(member.name||'S').charAt(0)}</AvatarFallback>
              </Avatar>
              <div className={cn('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0f]', member.statusColor)} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-tight text-white truncate max-w-[80px]">{member.name?.split(' ')[0]}</p>
              <p className="text-[8px] font-bold text-white/40 uppercase">{member.statusLabel}</p>
              {member.estimatedFree && (
                <p className="text-[8px] font-black text-white/60 mt-0.5">~{member.estimatedFree}m</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── MEMBER FORM (details step) ───────────────────────────────────────────────
const StepDetails = ({ member, onUpdate, primaryMember, isGroup, bannedClient, existingClientWithBalance, isResolvingIdentity, isKnownClient, clientType }: any) => (
  <div className="space-y-5">
    <div className="space-y-2">
      <Label className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40 flex items-center gap-1.5"><Phone className="w-3 h-3" />Phone</Label>
      <PhoneInput
        name={`phone-${member.id}`} international defaultCountry="US"
        value={member.phone || ''} onChange={v => onUpdate({ phone: v || '' })}
        placeholder="(555) 000-0000"
        className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-lg font-bold text-white [&_input]:border-none [&_input]:bg-transparent [&_input]:text-white [&_input]:placeholder:text-white/20"
      />
    </div>
    <div className="space-y-2">
      <Label className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40 flex items-center gap-1.5"><User className="w-3 h-3" />Name</Label>
      <input
        value={member.name} onChange={e => onUpdate({ name: e.target.value })}
        placeholder={member.isPrimary ? 'Your full name' : "Guest's name"}
        className="w-full h-14 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-lg font-bold text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all uppercase tracking-tight"
      />
    </div>
    {isGroup && !member.isPrimary && (
      <button onClick={() => { if (primaryMember) onUpdate({ phone: primaryMember.phone, email: primaryMember.email }); }}
        className="w-full h-10 rounded-xl border border-white/10 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white/60 hover:border-white/20 transition-all">
        Use {primaryMember?.name?.split(' ')[0]}'s contact info
      </button>
    )}
    <div className="space-y-2">
      <Label className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40 flex items-center gap-1.5"><Mail className="w-3 h-3" />Email</Label>
      <input
        type="email" value={member.email || ''} onChange={e => onUpdate({ email: e.target.value })}
        placeholder="your@email.com"
        className="w-full h-14 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-lg font-bold text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all"
      />
    </div>

    <AnimatePresence>
      {isResolvingIdentity && (
        <motion.div key="resolving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-white/40 py-2 justify-center">
          <Loader className="w-3 h-3 animate-spin" /> Verifying...
        </motion.div>
      )}
      {isKnownClient && clientType === 'new' && !bannedClient && !existingClientWithBalance && (
        <motion.div key="known" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">Profile Found</p>
            <p className="text-[9px] font-bold text-amber-400/70 uppercase leading-relaxed">
              We found an existing record. Please go back and select <strong>Return Guest</strong>.
            </p>
          </div>
        </motion.div>
      )}
      {bannedClient && (
        <motion.div key="banned" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex gap-3">
          <Ban className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-1">Access Restricted</p>
            <p className="text-[9px] font-bold text-red-400/70 uppercase">{bannedClient.banMessage || 'Please see front desk.'}</p>
          </div>
        </motion.div>
      )}
      {existingClientWithBalance && !bannedClient && (
        <motion.div key="balance" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex gap-3">
          <DollarSign className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-1">Outstanding Balance</p>
            <p className="text-[9px] font-bold text-red-400/70 uppercase">${existingClientWithBalance.outstandingBalance?.toFixed(2)} — settle at desk to continue.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// ─── SERVICE SELECTION ────────────────────────────────────────────────────────
const ServiceTile = ({ service, isSelected, onToggle }: any) => {
  const minPrice = useMemo(() => {
    if (!service.serviceTiers?.length) return service.price;
    return Math.min(...service.serviceTiers.map((t: any) => t.price));
  }, [service]);

  return (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onToggle}
      className={cn(
        'relative flex flex-col items-center justify-center p-5 rounded-2xl border transition-all duration-300 text-center gap-2',
        isSelected
          ? 'bg-white/15 border-white/30 shadow-[0_0_20px_rgba(255,255,255,0.1)]'
          : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.07] hover:border-white/20'
      )}>
      {isSelected && <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white flex items-center justify-center"><Check className="w-2.5 h-2.5 text-black" /></div>}
      <div className={cn('p-3 rounded-xl transition-all', isSelected ? 'bg-white/10' : 'bg-white/[0.05]')}>
        <Sparkles className={cn('w-6 h-6', isSelected ? 'text-white' : 'text-white/40')} strokeWidth={1.5} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-tight text-white leading-tight">{service.name}</p>
      <p className="text-[9px] font-black text-white/40 font-mono">${minPrice.toFixed(0)}+</p>
    </motion.button>
  );
};

const StepServices = ({ member, onUpdate, services }: any) => {
  const mainServices = useMemo(() => services.filter((s: Service) => s.type === 'service'), [services]);
  const selectedMainId = useMemo(() => member.serviceIds.find((id: string) => mainServices.some((s: Service) => s.id === id)), [member.serviceIds, mainServices]);
  const selectedMain = useMemo(() => services.find((s: Service) => s.id === selectedMainId), [services, selectedMainId]);
  const categories = useMemo(() => Array.from(new Set(mainServices.map((s: Service) => s.category || 'Standard'))).sort() as string[], [mainServices]);
  const compatibleAddOns = useMemo(() => {
    if (!selectedMain) return [];
    return services.filter((s: Service) => s.type === 'addon' && (selectedMain.compatibleAddOnIds || []).includes(s.id));
  }, [services, selectedMain]);
  const [view, setView] = useState<'category'|'main'|'addon'>(selectedMainId ? 'addon' : 'category');
  const [selectedCat, setSelectedCat] = useState<string|null>(null);

  return (
    <AnimatePresence mode="wait">
      {view === 'category' && (
        <motion.div key="cat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Choose a category</p>
          {categories.map(cat => (
            <motion.button key={cat} whileTap={{ scale: 0.98 }}
              onClick={() => { setSelectedCat(cat); setView('main'); }}
              className="w-full flex items-center justify-between p-5 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all">
              <span className="font-black uppercase tracking-tight text-white text-base">{cat}</span>
              <ArrowRight className="w-4 h-4 text-white/30" />
            </motion.button>
          ))}
        </motion.div>
      )}
      {view === 'main' && (
        <motion.div key="main" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('category')} className="text-white/40 hover:text-white/70 transition-colors flex items-center gap-1 text-[9px] font-black uppercase tracking-widest"><ArrowLeft className="w-3 h-3" />Back</button>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 flex-1 text-center">{selectedCat}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mainServices.filter((s: Service) => (s.category || 'Standard') === selectedCat).map((svc: Service) => (
              <ServiceTile key={svc.id} service={svc} isSelected={member.serviceIds.includes(svc.id)}
                onToggle={() => {
                  onUpdate({ serviceIds: [svc.id] });
                  const addOns = services.filter((s: Service) => s.type === 'addon' && (svc.compatibleAddOnIds || []).includes(s.id));
                  if (addOns.length > 0) setView('addon');
                }} />
            ))}
          </div>
        </motion.div>
      )}
      {view === 'addon' && (
        <motion.div key="addon" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('main')} className="text-white/40 hover:text-white/70 transition-colors flex items-center gap-1 text-[9px] font-black uppercase tracking-widest"><ArrowLeft className="w-3 h-3" />Change</button>
            <div className="flex-1 text-center">
              <p className="text-[8px] font-black uppercase tracking-[0.2em] text-white/30">Selected</p>
              <p className="text-[10px] font-black uppercase text-white/60 tracking-tight">{selectedMain?.name}</p>
            </div>
          </div>
          {compatibleAddOns.length > 0 ? (
            <>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Add-ons (optional)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {compatibleAddOns.map((addon: Service) => (
                  <ServiceTile key={addon.id} service={addon} isSelected={member.serviceIds.includes(addon.id)}
                    onToggle={() => {
                      const curr = member.serviceIds.includes(addon.id);
                      onUpdate({ serviceIds: curr ? member.serviceIds.filter((id: string) => id !== addon.id) : [...member.serviceIds, addon.id] });
                    }} />
                ))}
              </div>
            </>
          ) : (
            <div className="py-6 text-center">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/20">No add-ons available</p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── STAFF PREFERENCE STEP ────────────────────────────────────────────────────
const StepStaff = ({ member, onUpdate, staff }: any) => (
  <div className="space-y-4">
    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Provider preference</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {/* Any available option */}
      <button onClick={() => onUpdate({ preferredStaffId: 'any' })}
        className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all',
          (!member.preferredStaffId || member.preferredStaffId === 'any')
            ? 'bg-white/15 border-white/30' : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.07]')}>
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
          <Users className="w-6 h-6 text-white/60" strokeWidth={1.5} />
        </div>
        <p className="text-[9px] font-black uppercase tracking-tight text-white">First Available</p>
      </button>
      {(staff || []).map((s: Staff) => (
        <button key={s.id} onClick={() => onUpdate({ preferredStaffId: s.id })}
          className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all',
            member.preferredStaffId === s.id ? 'bg-white/15 border-white/30' : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.07]')}>
          <div className="relative">
            <Avatar className="w-12 h-12 rounded-xl border border-white/20">
              <AvatarImage src={s.avatarUrl} className="object-cover" />
              <AvatarFallback className="bg-white/10 text-white font-black">{(s.name||'S').charAt(0)}</AvatarFallback>
            </Avatar>
            {member.preferredStaffId === s.id && (
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white flex items-center justify-center"><Check className="w-2.5 h-2.5 text-black" /></div>
            )}
          </div>
          <p className="text-[9px] font-black uppercase tracking-tight text-white truncate max-w-[80px]">{s.name?.split(' ')[0]}</p>
        </button>
      ))}
    </div>
    {member.preferredStaffId && member.preferredStaffId !== 'any' && (
      <div className="flex items-center justify-between p-4 rounded-2xl border border-white/10 bg-white/[0.04]">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-white">Wait for this provider?</p>
          <p className="text-[8px] font-bold text-white/30 uppercase mt-0.5">May increase wait time</p>
        </div>
        <Switch checked={member.waitForPreferredStaff} onCheckedChange={v => onUpdate({ waitForPreferredStaff: v })} />
      </div>
    )}
  </div>
);

// ─── CONSENT STEP ─────────────────────────────────────────────────────────────
const StepConsents = ({ member, requiredForms, formAnswers, setFormAnswers }: any) => (
  <div className="space-y-6">
    {requiredForms.map((form: ConsentForm) => (
      <div key={form.id} className="space-y-5 p-5 rounded-2xl border border-white/10 bg-white/[0.04]">
        <h3 className="font-black uppercase tracking-tight text-white flex items-center gap-2 text-sm">
          <FileSignature className="w-4 h-4 text-white/40" />{form.title}
        </h3>
        {form.fields?.map((field: any) => (
          <div key={field.id}>
            <FormFieldRenderer
              field={field}
              value={formAnswers[form.id]?.[field.id]}
              onChange={val => setFormAnswers({ ...formAnswers, [form.id]: { ...(formAnswers[form.id] || {}), [field.id]: val } })}
            />
          </div>
        ))}
      </div>
    ))}
  </div>
);

// ─── MEMBER SETUP WRAPPER ─────────────────────────────────────────────────────
type MemberSubStep = 'details' | 'services' | 'consents' | 'staff';

const MemberSetup = ({
  member, onUpdate, partyMembers, memberSubStep, services, staff, consentForms,
  formAnswers, setFormAnswers, onNext, onBack, isGroup, isLastMember, onAddAnother,
  onSubmit, isSubmitting, bannedClient, existingClientWithBalance, isResolvingIdentity,
  matchedAppointment, onAppointmentCheckIn, dayAccessTier, isKnownClient, clientType
}: any) => {
  const SUB_STEPS: MemberSubStep[] = ['details', 'services', 'consents', 'staff'];
  const primaryService = services.find((s: Service) => s.id === member.serviceIds[0]);
  const requiredForms = consentForms.filter((f: ConsentForm) => primaryService?.requiredFormIds?.includes(f.id));
  const subSteps: MemberSubStep[] = ['details', 'services'];
  if (requiredForms.length > 0) subSteps.push('consents');
  subSteps.push('staff');

  const stepIdx = subSteps.indexOf(memberSubStep);
  const stepLabels = subSteps.map(s => s === 'details' ? 'Info' : s === 'services' ? 'Service' : s === 'consents' ? 'Forms' : 'Staff');
  const isBlocked = !!bannedClient || !!existingClientWithBalance || isResolvingIdentity || (isKnownClient && clientType === 'new');
  const hasNext = stepIdx < subSteps.length - 1;

  return (
    <div className="p-6 md:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {isGroup && <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Guest {member.index + 1} of {partyMembers.length}</p>}
          <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white leading-none">
            {subSteps[stepIdx] === 'details' ? 'Your Info' : subSteps[stepIdx] === 'services' ? 'Treatment' : subSteps[stepIdx] === 'consents' ? 'Agreements' : 'Preference'}
          </h2>
        </div>
        <StepIndicator steps={stepLabels} current={stepIdx} />
      </div>

      {/* Appointment match banner */}
      {memberSubStep === 'details' && matchedAppointment && (
        <div className="p-4 rounded-2xl border border-white/20 bg-white/[0.08] space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/10"><CalendarCheck className="w-5 h-5 text-white" /></div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Appointment Found</p>
              <p className="text-sm font-black uppercase text-white">{services.find((s: any) => s.id === matchedAppointment.serviceId)?.name}</p>
            </div>
          </div>
          <Button className="w-full h-12 rounded-xl font-black uppercase text-sm bg-white text-black hover:bg-white/90"
            onClick={() => onAppointmentCheckIn(matchedAppointment)}>
            Check In Now →
          </Button>
        </div>
      )}

      {/* Member access tier alert */}
      {memberSubStep === 'details' && dayAccessTier === 'members' && (
        <div className="p-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10">
          <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400 mb-1">Members Priority Day</p>
          <p className="text-[9px] font-bold text-indigo-400/70 uppercase">Today is reserved for Club Members only.</p>
        </div>
      )}

      {/* Sub-step content */}
      <AnimatePresence mode="wait">
        <motion.div key={memberSubStep} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
          {memberSubStep === 'details' && (
            <StepDetails member={member} onUpdate={onUpdate} isGroup={isGroup} primaryMember={partyMembers?.[0]}
              bannedClient={bannedClient} existingClientWithBalance={existingClientWithBalance}
              isResolvingIdentity={isResolvingIdentity} isKnownClient={isKnownClient} clientType={clientType} />
          )}
          {memberSubStep === 'services' && <StepServices member={member} onUpdate={onUpdate} services={services} />}
          {memberSubStep === 'consents' && <StepConsents member={member} requiredForms={requiredForms} formAnswers={formAnswers} setFormAnswers={setFormAnswers} />}
          {memberSubStep === 'staff' && <StepStaff member={member} onUpdate={onUpdate} staff={staff} />}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} disabled={isSubmitting}
          className="h-14 px-5 rounded-2xl border border-white/10 text-white/40 font-black uppercase text-[9px] tracking-widest hover:text-white/60 hover:border-white/20 transition-all">
          ←
        </button>
        <div className="flex-1">
          {hasNext ? (
            <Button onClick={() => onNext(subSteps[stepIdx + 1])}
              disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)}
              className="w-full h-14 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90 disabled:opacity-30">
              Continue <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          ) : (
            <div className="flex gap-3">
              {isGroup && !isLastMember && (
                <Button variant="outline" onClick={onAddAnother}
                  disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)}
                  className="flex-1 h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest border-white/20 text-white hover:bg-white/10">
                  Next Guest
                </Button>
              )}
              <Button onClick={onSubmit}
                disabled={isSubmitting || (memberSubStep === 'details' && isBlocked) || (memberSubStep === 'services' && member.serviceIds.length === 0)}
                className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90 disabled:opacity-30">
                {isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : 'Complete'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── CONFIRMATION SCREEN ──────────────────────────────────────────────────────
const ConfirmationScreen = ({ confirmedParty, onPrint, onDone, staff, appointments, services }: any) => (
  <div className="p-8 md:p-12 space-y-8 text-center">
    <motion.div
      initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', damping: 12, stiffness: 130 }}
      className="w-20 h-20 mx-auto rounded-3xl bg-green-500/10 border border-green-500/30 flex items-center justify-center"
    >
      <CheckCircle2 className="w-10 h-10 text-green-400" />
    </motion.div>

    <div className="space-y-2">
      <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tighter text-white">You're In!</h2>
      <p className="text-white/40 font-bold uppercase tracking-[0.15em] text-sm">We'll text you when it's your turn</p>
    </div>

    {/* Queue cards */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {confirmedParty.map((ticket: WalkInTicketData) => (
        <div key={ticket.id} className="flex items-center justify-between p-5 rounded-2xl border border-white/10 bg-white/[0.04]">
          <div className="text-left">
            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-white/30">Queue Position</p>
            <p className="text-4xl font-black text-white tracking-tighter">#{ticket.queuePosition}</p>
            <p className="text-[10px] font-bold uppercase text-white/50 mt-1 truncate max-w-[120px]">{ticket.name}</p>
          </div>
          <button onClick={() => onPrint(ticket)}
            className="w-12 h-12 rounded-2xl border border-white/10 bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-colors">
            <Printer className="w-5 h-5 text-white/40" />
          </button>
        </div>
      ))}
    </div>

    {/* Live floor status */}
    <LiveFloorStatus staff={staff} appointments={appointments} services={services} />

    <Button onClick={onDone} className="h-14 px-10 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90">
      Done
    </Button>
  </div>
);

// ─── BIRTHDAY CELEBRATION ─────────────────────────────────────────────────────
const BirthdayCelebrationView = ({ clientName, onDone }: { clientName: string; onDone: () => void }) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0a0a0f] p-6 text-center"
  >
    {Array.from({ length: 16 }).map((_, i) => (
      <motion.div key={i}
        initial={{ y: -20, opacity: 0, x: `${(i / 16) * 100}vw` }}
        animate={{ y: '110vh', opacity: [0, 1, 1, 0] }}
        transition={{ delay: i * 0.15, duration: 3, repeat: Infinity }}
        className="absolute text-2xl"
        style={{ left: `${Math.random() * 100}%`, top: '-5%' }}
      >
        {['✨','🎉','🎊','💫','⭐'][i % 5]}
      </motion.div>
    ))}
    <div className="relative z-10 space-y-8 max-w-sm">
      <motion.div
        animate={{ scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="w-28 h-28 mx-auto rounded-3xl bg-white/10 border border-white/20 flex items-center justify-center"
      >
        <Cake className="w-14 h-14 text-white" strokeWidth={1} />
      </motion.div>
      <div className="space-y-3">
        <h2 className="text-5xl font-black text-white leading-none">Happy<br/>Birthday<br/><span className="italic font-light">{clientName.split(' ')[0]}!</span></h2>
        <p className="text-white/50 font-bold uppercase tracking-[0.2em] text-sm">So glad you're celebrating with us today</p>
      </div>
      <Button onClick={onDone} className="h-14 px-10 rounded-full font-black uppercase tracking-widest bg-white text-black hover:bg-white/90">
        Continue to Queue →
      </Button>
    </div>
  </motion.div>
);

// ─── CLOSED VIEW ──────────────────────────────────────────────────────────────
const ClosedView = ({ schedule, logoUrl, tenantName }: any) => (
  <div className="text-center space-y-6 max-w-sm mx-auto p-10">
    <div className="w-20 h-20 mx-auto rounded-3xl bg-white/[0.06] border border-white/10 flex items-center justify-center">
      {logoUrl ? <Image src={logoUrl} alt={tenantName||'Studio'} width={48} height={48} className="object-cover rounded-xl" /> : <Clock className="w-8 h-8 text-white/30" />}
    </div>
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter text-white">Closed</h1>
      <p className="text-white/40 font-bold uppercase tracking-[0.15em] text-xs mt-2">Kiosk available during business hours</p>
    </div>
    {schedule && (
      <div className="p-4 rounded-2xl border border-white/10 bg-white/[0.04]">
        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-white/30 mb-1">Today's Hours</p>
        <p className="font-black text-white text-lg">{isBusinessOpen(new Date(), schedule).hours || 'Closed'}</p>
      </div>
    )}
    <Button asChild className="w-full h-12 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90">
      <Link href="/">Return Home</Link>
    </Button>
  </div>
);

// ─── STEP TYPES ───────────────────────────────────────────────────────────────
type Step = 'partyType' | 'identityChoice' | 'phonePad' | 'identityConfirm' | 'welcomeBack' | 'memberSetup' | 'confirmation';

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
  const tenantRef      = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const servicesQ      = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/services`), [firestore, tenantId]);
  const staffQ         = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/staff`), [firestore, tenantId]);
  const schedulesQ     = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/scheduleProfiles`), where('isActive', '==', true)), [firestore, tenantId]);
  const pricingQ       = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/pricingTiers`), [firestore, tenantId]);
  const consentsQ      = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/consentForms`), [firestore, tenantId]);
  const clientsQ       = useMemoFirebase(() => collection(firestore, `tenants/${tenantId}/clients`), [firestore, tenantId]);
  const appointmentsQ  = useMemoFirebase(() => query(collection(firestore, `tenants/${tenantId}/appointments`), where('status', 'in', ['confirmed', 'servicing'])), [firestore, tenantId]);

  const { data: tenant }         = useDoc<Tenant>(tenantRef);
  const { data: services }       = useCollection<Service>(servicesQ);
  const { data: staff }          = useCollection<Staff>(staffQ);
  const { data: scheduleProfiles } = useCollection<any>(schedulesQ);
  const { data: pricingTiers }   = useCollection<PricingTier>(pricingQ);
  const { data: consentForms }   = useCollection<ConsentForm>(consentsQ);
  const { data: clients }        = useCollection<Client>(clientsQ);
  const { data: liveAppointments } = useCollection<Appointment>(appointmentsQ);

  // ── State ──
  const [entered, setEntered]               = useState(false);
  const [step, setStep]                     = useState<Step>('partyType');
  const [isGroup, setIsGroup]               = useState(false);
  const [partyMembers, setPartyMembers]     = useState<PartyMember[]>([]);
  const [currentMemberIndex, setCurrentMemberIndex] = useState(0);
  const [memberSubStep, setMemberSubStep]   = useState<MemberSubStep>('details');
  const [formAnswers, setFormAnswers]       = useState<Record<string, Record<string, any>>>({});
  const [confirmedParty, setConfirmedParty] = useState<WalkInTicketData[]>([]);
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [ticketToPrint, setTicketToPrint]   = useState<WalkInTicketData | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [existingClientWithBalance, setExistingClientWithBalance] = useState<Client | null>(null);
  const [bannedClient, setBannedClient]     = useState<Client | null>(null);
  const [isResolvingIdentity, setIsResolvingIdentity] = useState(false);
  const [matchedAppointment, setMatchedAppointment]   = useState<Appointment | null>(null);
  const [matchedClient, setMatchedClient]   = useState<Client | null>(null);
  const [showBirthday, setShowBirthday]     = useState(false);
  const [birthdayName, setBirthdayName]     = useState('');
  const [clientType, setClientType]         = useState<'new' | 'returning' | null>(null);
  const [phonePadValue, setPhonePadValue]   = useState('');
  const [isKnownClient, setIsKnownClient]   = useState(false);

  const activeDaySchedule = useMemo(() => {
    const day = format(new Date(), 'eeee').toLowerCase();
    return scheduleProfiles?.[0]?.week?.[day] || null;
  }, [scheduleProfiles]);

  // ── Identity resolution ────────────────────────────────────────────────────
  // FIXED: accepts callerClientType explicitly — avoids stale closure bugs
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
          const aptsSnap = await getDocs(query(
            collection(firestore, 'tenants', tenantId, 'appointments'),
            where('clientId', '==', d.id), where('status', '==', 'confirmed')
          ));
          const todayApt = aptsSnap.docs
            .map(ad => ({ ...ad.data(), id: ad.id } as Appointment))
            .find(a => isSameDay(safeDate(a.startTime), new Date()));
          setMatchedAppointment(todayApt || null);
          return { isBanned: false, hasBalance: false, isKnown: false, client: clientObj };
        }
      } else {
        setBannedClient(null); setExistingClientWithBalance(null); setMatchedAppointment(null); setMatchedClient(null); setIsKnownClient(false);
        const effective = callerClientType ?? clientType;
        if (effective === 'returning' && step === 'phonePad') {
          toast({ variant: 'destructive', title: 'Profile Not Found', description: "Continuing as first visit." });
          setClientType('new'); setStep('memberSetup');
        }
        return empty;
      }
    } catch (e) { console.error(e); return empty; }
    finally { setIsResolvingIdentity(false); }
  }, [firestore, tenantId, clientType, step, toast]);

  // ── Flow handlers ──────────────────────────────────────────────────────────
  const handlePartyTypeSelect = (type: 'individual' | 'group') => {
    setIsGroup(type === 'group');
    setPartyMembers([{ id: nanoid(5), name: '', serviceIds: [], isPrimary: true, preferredStaffId: 'any', waitForPreferredStaff: false }]);
    setCurrentMemberIndex(0);
    // FIXED: both solo AND group go through identity choice for primary member
    setStep('identityChoice');
  };

  const handleIdentitySelect = (type: 'new' | 'returning') => {
    setClientType(type);
    if (type === 'returning') { setStep('phonePad'); setPhonePadValue(''); }
    else setStep('memberSetup');
  };

  // FIXED: only navigate to identityConfirm if a client was found
  const handlePhonePadConfirm = async () => {
    if (phonePadValue.length < 10) return;
    const result = await resolveIdentity(undefined, `+1${phonePadValue}`, 'returning');
    if (result.client) setStep('identityConfirm');
    // If not found, resolveIdentity already set step to memberSetup
  };

  const handleIdentityConfirm = async () => {
    if (!matchedClient) return;
    handleMemberUpdate({ name: matchedClient.name, email: matchedClient.email, phone: matchedClient.phone });
    if (matchedAppointment) { await handleAppointmentCheckIn(matchedAppointment); }
    else { setMemberSubStep('services'); setStep('welcomeBack'); }
  };

  const handleMemberUpdate = (updates: Partial<PartyMember>) => {
    if (updates.phone !== undefined || updates.email !== undefined) {
      setIsKnownClient(false); setMatchedClient(null); setBannedClient(null); setExistingClientWithBalance(null); setMatchedAppointment(null);
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

      // FIXED: pass clientType explicitly
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
    if (memberSubStep === 'services' && member.serviceIds.length === 0) return toast({ variant: 'destructive', title: 'Select a Service' });
    setMemberSubStep(next);
  };

  const handleBack = () => {
    if (memberSubStep === 'details') {
      if (currentMemberIndex > 0) { setCurrentMemberIndex(currentMemberIndex - 1); setMemberSubStep('staff'); }
      else { setStep(isGroup ? 'identityChoice' : 'identityChoice'); }
    } else {
      const member = partyMembers[currentMemberIndex];
      const primary = services?.find((s: Service) => s.id === member.serviceIds[0]);
      const forms = consentForms?.filter((f: ConsentForm) => primary?.requiredFormIds?.includes(f.id)) || [];
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
        batch.set(nRef, { id: nanoid(), userId: apt.staffId, type: 'client_movement', message: `${apt.clientName || 'Your guest'} checked in at kiosk.`, link: '/planner', createdAt: new Date().toISOString(), read: false });
      }
      await batch.commit();
      const ticket: WalkInTicketData = { id: apt.id, name: apt.clientName || 'Guest', services: services?.filter(s => s.id === apt.serviceId) || [], queuePosition: 0, checkInTime: new Date().toISOString() };
      setConfirmedParty([ticket]);
      const mc = clients?.find(c => c.id === apt.clientId);
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
      const queueSnap = await getDocs(query(collection(firestore, `tenants/${tenantId}/walkIns`), where('status', '==', 'waiting')));
      let pos = queueSnap.size + 1;

      for (const member of partyMembers) {
        let mc = clients?.find(c => (member.email && c.email?.toLowerCase() === member.email.toLowerCase()) || (member.phone && c.phone === member.phone));
        let clientId = mc?.id;
        if (mc && isBirthdayToday(mc.birthday)) birthdayMemberName = mc.name || member.name;

        if (!clientId) {
          clientId = nanoid();
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), { id: clientId, name: member.name, email: member.email || '', phone: member.phone || '', avatarUrl: `https://picsum.photos/seed/${clientId}/100`, lifetimeValue: 0, lastAppointment: now, status: 'active' });
        } else {
          batch.set(doc(firestore, `tenants/${tenantId}/clients`, clientId), { name: member.name, email: member.email || '', phone: member.phone || '', lastAppointment: now }, { merge: true });
        }

        const walkInId = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/walkIns`, walkInId), {
          id: walkInId, groupId, isPrimaryContact: !!member.isPrimary, clientId,
          customerName: member.name, customerPhone: member.phone || '', customerEmail: member.email || '',
          serviceIds: member.serviceIds, checkInTime: now, status: 'waiting',
          // FIXED: space group members 1 second apart for correct queue ordering
          queueOrder: Date.now() + (tickets.length * 1000),
          waitForPreferredStaff: !!member.waitForPreferredStaff,
          estimatedDuration: services?.filter(s => member.serviceIds.includes(s.id)).reduce((a, s) => a + (s.duration || 0), 0) || 0,
          ...(isGroup && { groupName: `${partyMembers[0].name}'s Party` }),
          ...(member.preferredStaffId && member.preferredStaffId !== 'any' && { preferredStaffId: member.preferredStaffId }),
        });

        const memberAnswers = formAnswers[member.id] || {};
        Object.entries(memberAnswers).forEach(([formId, data]) => {
          const cRef = doc(collection(firestore, `tenants/${tenantId}/clients/${clientId}/signedConsents`));
          const form = consentForms?.find(f => f.id === formId);
          batch.set(cRef, { id: cRef.id, formId, formTitle: form?.title || 'Form', clientId, signedAt: now, formData: data });
        });
        tickets.push({ id: walkInId, name: member.name, services: services?.filter(s => member.serviceIds.includes(s.id)) || [], queuePosition: pos++, checkInTime: now });
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
    const b = safeDate(birthday); const t = new Date();
    return b.getDate() === t.getDate() && b.getMonth() === t.getMonth();
  }

  // ── Kiosk config ──
  const kioskSettings    = tenant?.kioskSettings;
  const logoUrl          = kioskSettings?.logoUrl;
  const wordmarkUrl      = kioskSettings?.wordmarkUrl;
  const showWordmark     = kioskSettings?.showWordmark !== false;
  const customColor      = kioskSettings?.primaryColor;
  const primaryColorHSL  = customColor?.startsWith('#') ? hexToHSLComponents(customColor) : customColor;
  const activeStaff      = useMemo(() => (staff || []).filter(s => s.active && !s.onBreak), [staff]);
  const isClosed         = !isBusinessOpen(new Date(), scheduleProfiles?.[0]).open;

  if (!tenant || !services) return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
      <Loader className="w-8 h-8 animate-spin text-white/30" />
    </div>
  );

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 overflow-x-hidden relative"
      style={primaryColorHSL ? { '--primary': primaryColorHSL } as React.CSSProperties : {}}
    >
      <MeshBackground primaryColor={customColor} />

      <FormProvider {...methods}>
        {isClosed ? (
          <ClosedView schedule={scheduleProfiles?.[0]} logoUrl={logoUrl} tenantName={tenant.name} />
        ) : (
          <AnimatePresence mode="wait">
            {!entered ? (
              // ── Welcome / tap to begin ──
              <motion.div
                key="splash"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="text-center cursor-pointer select-none p-8 z-10"
                onClick={() => setEntered(true)}
              >
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  className="mb-10"
                >
                  <div className={cn(
                    'relative overflow-hidden mx-auto mb-0',
                    showWordmark ? 'w-24 h-24 rounded-3xl' : 'w-40 h-40 rounded-[2.5rem]',
                    logoUrl ? 'shadow-2xl' : 'bg-white/[0.06] border border-white/10'
                  )}>
                    {logoUrl
                      ? <Image src={logoUrl} alt={tenant.name} fill className="object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><ClarityFlowLogo className="w-16 h-16" /></div>}
                  </div>
                </motion.div>

                {showWordmark && (
                  <div className="mb-8">
                    {wordmarkUrl
                      ? <div className="relative h-16 w-[280px] mx-auto"><Image src={wordmarkUrl} alt={tenant.name} fill className="object-contain" /></div>
                      : <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter text-white leading-none">{tenant.name}</h1>}
                  </div>
                )}

                <motion.p
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className="text-xs md:text-sm font-black uppercase tracking-[0.4em] text-white/50"
                >
                  Tap anywhere to begin
                </motion.p>
                <motion.div
                  animate={{ y: [0, 6, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="mt-8 flex justify-center"
                >
                  <ArrowDown className="w-5 h-5 text-white/20" />
                </motion.div>
              </motion.div>
            ) : (
              // ── Main flow ──
              <div className="w-full max-w-2xl mx-auto z-10">
                <GlassCard>
                  <AnimatePresence mode="wait">
                    {step === 'partyType'     && <motion.div key="party"><PartyTypeSelection onSelect={handlePartyTypeSelect} /></motion.div>}
                    {step === 'identityChoice' && <motion.div key="identity"><IdentityChoiceView onSelect={handleIdentitySelect} onBack={() => setStep('partyType')} isGroup={isGroup} /></motion.div>}
                    {step === 'phonePad'      && <motion.div key="phone"><PhonePadView value={phonePadValue} onDigit={d => { if (phonePadValue.length < 10) setPhonePadValue(p => p + d); }} onDelete={() => setPhonePadValue(p => p.slice(0, -1))} onConfirm={handlePhonePadConfirm} onBack={() => setStep('identityChoice')} isVerifying={isResolvingIdentity} /></motion.div>}
                    {step === 'identityConfirm' && (
                      matchedClient
                        ? <motion.div key="confirm"><IdentityConfirmView client={matchedClient} onConfirm={handleIdentityConfirm} onBack={() => { setStep('phonePad'); setMatchedClient(null); }} /></motion.div>
                        : <motion.div key="confirm-fallback" className="p-12 text-center space-y-4">
                            <p className="text-white/40 font-bold uppercase text-sm">Something went wrong</p>
                            <Button onClick={() => setStep('phonePad')} className="bg-white text-black">Try Again</Button>
                          </motion.div>
                    )}
                    {step === 'welcomeBack'   && matchedClient && <motion.div key="welcome"><WelcomeBackView name={matchedClient.name} onContinue={() => setStep('memberSetup')} /></motion.div>}
                    {step === 'memberSetup'   && partyMembers[currentMemberIndex] && (
                      <motion.div key={`member-${currentMemberIndex}`}>
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
                            setPartyMembers([...partyMembers, { id: nanoid(5), name: '', serviceIds: [], preferredStaffId: 'any', waitForPreferredStaff: false }]);
                            setCurrentMemberIndex(partyMembers.length);
                            setMemberSubStep('details');
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
                        />
                      </motion.div>
                    )}
                    {step === 'confirmation' && (
                      <motion.div key="done">
                        <ConfirmationScreen
                          confirmedParty={confirmedParty}
                          onPrint={t => { setTicketToPrint(t); setIsPrintDialogOpen(true); }}
                          onDone={() => {
                            setEntered(false); setStep('partyType'); setPartyMembers([]); setFormAnswers({});
                            setMatchedAppointment(null); setPhonePadValue(''); setClientType(null);
                            setMatchedClient(null); setIsKnownClient(false); setCurrentMemberIndex(0);
                          }}
                          staff={staff}
                          appointments={liveAppointments || []}
                          services={services}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </GlassCard>
              </div>
            )}
          </AnimatePresence>
        )}
      </FormProvider>

      <AnimatePresence>
        {showBirthday && (
          <BirthdayCelebrationView
            clientName={birthdayName}
            onDone={() => { setShowBirthday(false); setStep('confirmation'); }}
          />
        )}
      </AnimatePresence>

      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="max-w-sm rounded-3xl border border-white/10 bg-[#0a0a0f] p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-white/10">
            <DialogTitle className="text-center font-black uppercase tracking-tight text-white">Ticket Ready</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center p-8 bg-white">
            {ticketToPrint && <PrintWalkInTicket data={ticketToPrint} />}
          </div>
          <DialogFooter className="p-4 border-t border-white/10">
            <Button className="w-full h-12 rounded-2xl font-black uppercase tracking-widest bg-white text-black hover:bg-white/90"
              onClick={() => { window.print(); setIsPrintDialogOpen(false); }}>
              Print Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}