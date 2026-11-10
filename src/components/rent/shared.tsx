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
// Inside a screen opened from a row, the header already names it, so a section's own title stays for screen readers
// only (the page wraps each screen in ScreenContext).
export const ScreenContext = React.createContext(false);
export const SectionTitle = ({ children }: { icon?: any; children: React.ReactNode }) => {
  const inScreen = React.useContext(ScreenContext);
  return <h2 className={inScreen ? 'sr-only' : 'px-1 text-[14px] font-semibold text-[#6d7075]'}>{children}</h2>;
};

// A short status word. Amber for anything to sort out (red is kept for destructive actions).
export const Chip = ({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'violet'; children: React.ReactNode }) => (
  <span className={cn('inline-block shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium',
    tone === 'green' && 'bg-[#eef6f1] text-[#1f7a4d]',
    (tone === 'amber' || tone === 'red') && 'bg-[#fdf6ee] text-[#b45309]',
    (tone === 'violet' || tone === 'slate') && 'bg-[#f5f5f7] text-[#6d7075]')}>
    {typeof children === 'string' ? children.charAt(0).toUpperCase() + children.slice(1) : children}
  </span>
);
