'use client';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { getApps, initializeApp } from 'firebase/app';
import { getStorage, ref as storageRef } from 'firebase/storage';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { uploadImage } from '@/lib/upload-image';
import { firebaseConfig } from '@/firebase/config';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { credentialViews, stateLabel, CREDENTIAL_LABEL } from '@/lib/compliance';
import { LINK_KINDS, SECTION_KINDS, RENTER_FONTS, onAccent } from '@/lib/renter-identity';
import { useToast } from '@/hooks/use-toast';
import {
  Armchair, CalendarDays, Clock, CreditCard, LogOut, Loader,
  CheckCircle2, Sparkles, ChevronRight, Receipt, AlertTriangle,
  Wallet, KeyRound, Phone, RefreshCw, Repeat, X,
  MessageSquare,
  CalendarClock,
  Users,
  Home,
  Store,
  BellRing,
  ShieldAlert,
  Wrench,
  CloudLightning,
  FileSignature,
} from 'lucide-react';


// Local YYYY-MM-DD — the UTC-slice version flips to tomorrow in the evening.
export const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fmtDate = (s?: string | null) => {
  if (!s) return '';
  try { return format(parseISO(String(s).slice(0, 10) + 'T12:00:00'), 'EEE, MMM d'); } catch { return s; }
};
export const fmtMoney = (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`;
export const fmtTime = (t?: string | null) => {
  if (!t) return '';
  try { return format(parseISO(`2000-01-01T${t}:00`), 'h:mm a'); } catch { return t; }
};

// ─── Local calendar days ─────────────────────────────────────────────────────
// Appointment and block times are stored in UTC. The portal planner was
// turning them into DAYS by slicing the ISO string — which is the UTC day.
// In US time zones a 9pm block is 1am tomorrow in UTC, so it landed on the
// wrong column, and after 8pm "today" was already tomorrow. Every day
// comparison now goes through the phone's own calendar.
export const localDay = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(x.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

// ─── Shared UI bits ───────────────────────────────────────────────────────────
export const SectionTitle = ({ icon: Icon, children }: { icon: any; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 px-1">
    <Icon className="w-3.5 h-3.5 text-primary" />
    <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">{children}</h2>
  </div>
);

export const Chip = ({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'violet'; children: React.ReactNode }) => (
  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest',
    tone === 'green' && 'bg-emerald-100 text-emerald-700',
    tone === 'amber' && 'bg-amber-100 text-amber-700',
    tone === 'red' && 'bg-red-100 text-red-700',
    tone === 'violet' && 'bg-violet-100 text-violet-700',
    tone === 'slate' && 'bg-slate-100 text-slate-600')}>
    {children}
  </span>
);
