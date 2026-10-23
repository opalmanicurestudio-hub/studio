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
  CalendarCheck, ArrowRight, Clock, Info, Users2,
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
import { SeatingChartTab } from '@/components/events/SeatingChartTab';
import { PRINT, esc, printPage } from '@/lib/print-style';

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
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border bg-muted border-border text-foreground/80">
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
        <p className="text-lg font-black text-foreground leading-none">{checkedIn}</p>
        <p className="text-[8px] font-black uppercase text-muted-foreground tracking-widest">in</p>
      </div>
    </div>
  );
};

// ─── ORDERING DEADLINE BANNER ──────────────────────────────────────────────────
const OrderingDeadlineBanner = ({ deadline, eventId, tenantId, firestore }: {
  deadline: string; eventId: string; tenantId: string; firestore: any;
}) => {
  const [now, setNow] = useState(Date.now());
  const { toast }     = useToast();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = new Date(deadline).getTime();
  const msLeft     = deadlineMs - now;
  if (msLeft <= 0) return null;

  const hLeft = Math.floor(msLeft / 3600000);
  const mLeft = Math.floor((msLeft % 3600000) / 60000);
  const label  = hLeft > 0 ? `${hLeft}h ${mLeft}m` : `${mLeft}m`;
  const urgent = msLeft < 3600000; // < 1 hour

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

// ─── MENU NOTE BANNER ──────────────────────────────────────────────────────────
const MenuNoteBanner = ({ note }: { note: string }) => (
  <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 border-2 border-blue-200">
    <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-blue-600 mb-0.5">Menu Note (visible to guests)</p>
      <p className="text-sm font-bold text-blue-900">{note}</p>
    </div>
  </div>
);

// ─── QUOTE LINK BADGE ──────────────────────────────────────────────────────────
const QuoteLinkBadge = ({ quoteId, tenantId, firestore }: {
  quoteId: string; tenantId: string; firestore: any;
}) => {
  const router = useRouter();
  const [quote, setQuote] = useState<any>(null);

  useEffect(() => {
    if (!quoteId || !firestore || !tenantId) return;
    getDoc(doc(firestore, `tenants/${tenantId}/quotes`, quoteId))
      .then(snap => { if (snap.exists()) setQuote({ id: snap.id, ...snap.data() }); })
      .catch(console.error);
  }, [quoteId, firestore, tenantId]);

  if (!quote) return null;
  const total = (quote.lineItems || []).reduce((a: number, i: any) => a + (i.price || 0) * (i.quantity || 1), 0);
  const STATUS_COLORS: Record<string, string> = {
    accepted: 'bg-green-50 border-green-200 text-green-700',
    declined: 'bg-red-50 border-red-200 text-red-600',
    sent:     'bg-blue-50 border-blue-200 text-blue-700',
    viewed:   'bg-violet-50 border-violet-200 text-violet-700',
  };

  return (
    <button
      onClick={() => router.push('/quotes')}
      className={cn(
        'flex items-center gap-2 h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest transition-all hover:shadow-md',
        STATUS_COLORS[quote.status] || 'bg-muted/60 border-border text-foreground/80',
      )}>
      <CalendarCheck className="w-3.5 h-3.5" />
      Quote · ${total.toFixed(0)}
      <ArrowRight className="w-3 h-3" />
    </button>
  );
};

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
      className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 shrink-0">
      End Event →
    </Button>
  </motion.div>
);

// ─── COURSE FIRE CONFIRM DIALOG ────────────────────────────────────────────────
const CourseFireConfirmDialog = ({ open, onOpenChange, courseNumber, courseName, guests, menuItems, onConfirm, isFiring }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  courseNumber: number; courseName: string;
  guests: any[]; menuItems: any[];
  onConfirm: () => void; isFiring: boolean;
}) => {
  const eligible = guests.filter(g =>
    g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId))
  );
  const notIn    = guests.filter(g =>
    !g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId))
  );

  // Counts by menu item
  const itemCounts: Record<string, { name: string; count: number; criticalCount: number }> = {};
  eligible.forEach(g => {
    const id   = g.courseSelections?.[courseNumber] || g.mealChoiceId;
    const item = menuItems.find(m => m.id === id);
    if (!id) return;
    if (!itemCounts[id]) itemCounts[id] = { name: item?.name || 'Unknown', count: 0, criticalCount: 0 };
    itemCounts[id].count++;
    if ((g.allergies || []).some((a: any) => a.severity === 'critical')) itemCounts[id].criticalCount++;
  });

  const criticalGuests = eligible.filter(g =>
    (g.allergies || []).some((a: any) => a.severity === 'critical')
  );

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
            <div className={cn('text-center p-3 rounded-xl border', notIn.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-muted/60 border-border')}>
              <p className={cn('text-xl font-black', notIn.length > 0 ? 'text-amber-700' : 'text-muted-foreground')}>{notIn.length}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Not checked in</p>
            </div>
            <div className={cn('text-center p-3 rounded-xl border', criticalGuests.length > 0 ? 'bg-red-50 border-red-200' : 'bg-muted/60 border-border')}>
              <p className={cn('text-xl font-black', criticalGuests.length > 0 ? 'text-red-600' : 'text-muted-foreground')}>{criticalGuests.length}</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Critical allergy</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Ticket Breakdown</p>
            {Object.entries(itemCounts).map(([id, data]) => (
              <div key={id} className="flex items-center justify-between p-3 rounded-xl bg-muted/60 border border-border">
                <p className="font-black text-sm text-foreground">{data.name}</p>
                <div className="flex items-center gap-2">
                  {data.criticalCount > 0 && (
                    <span className="flex items-center gap-1 text-[8px] font-black uppercase text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <AlertTriangle className="w-2.5 h-2.5" /> {data.criticalCount} allergy
                    </span>
                  )}
                  <span className="font-black text-lg text-primary font-mono">×{data.count}</span>
                </div>
              </div>
            ))}
          </div>

          {criticalGuests.length > 0 && (
            <div className="p-3 rounded-xl bg-red-50 border-2 border-red-200 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-red-600">Critical Allergy Guests — Alert Kitchen</p>
              {criticalGuests.map(g => (
                <div key={g.id} className="flex items-center justify-between gap-2">
                  <p className="font-black text-xs text-red-900">{g.name}{g.tableNumber && ` · T${g.tableNumber}`}</p>
                  <div className="flex flex-wrap gap-1">
                    {(g.allergies || []).filter((a: any) => a.severity === 'critical').map((a: any, i: number) => (
                      <span key={i} className="text-[8px] font-black uppercase text-red-700 bg-red-100 border border-red-300 px-1.5 py-0.5 rounded-full">{a.label}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {notIn.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-amber-700">
                {notIn.length} guest{notIn.length !== 1 ? 's have' : ' has'} not checked in and will be skipped.
                Use delta re-fire when they arrive.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}
              className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={isFiring || eligible.length === 0}
              className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20 gap-2">
              {isFiring ? <Loader className="w-4 h-4 animate-spin" /> : <><Play className="w-4 h-4" /> Fire {eligible.length} Tickets</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── KITCHEN PRINT MODAL ───────────────────────────────────────────────────────
// Both printouts are in the app's print look (lib/print-style). A critical allergy is red and carries a small warning
// mark, so it still stands out on a black-and-white printer; an intolerance is amber; a preference is plain.
const WARN_MARK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17v.5"/></svg>';
const allergyPill = (a: any) => {
  const label = typeof a === 'object' ? a.label : a;
  const sev   = typeof a === 'object' ? a.severity : 'preference';
  if (sev === 'critical') return `<span class="pill bad">${WARN_MARK}${esc(label)}</span>`;
  if (sev === 'intolerance') return `<span class="pill warn">${esc(label)}</span>`;
  return `<span class="pill">${esc(label)}</span>`;
};

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

    const criticalAllergies = guests.filter(g =>
      (g.allergies || []).some((a: any) => a.severity === 'critical')
    );

    const countsPerCourse = courseNumbers.map(n => {
      const counts: Record<string, number> = {};
      guests.filter(g => g.checkedIn).forEach(g => {
        const id = g.courseSelections?.[n] || (n === 1 ? g.mealChoiceId : null);
        if (!id) return;
        const name = menuItems.find(m => m.id === id)?.name || 'Unknown';
        counts[name] = (counts[name] || 0) + 1;
      });
      return { courseNumber: n, name: courseLabels[n] || `Course ${n}`, counts };
    });

    const checkedIn = guests.filter(g => g.checkedIn).length;
    const when = [event?.date ? format(new Date(event.date), 'EEEE, MMMM d, yyyy') : '', event?.time || '', event?.venue || ''].filter(Boolean).map(esc).join(' · ');

    const body = `
      <h2>Course summary</h2>
      ${countsPerCourse.map(c => `
        <h3>${esc(c.name)}</h3>
        <div class="grid3">
          ${Object.entries(c.counts).map(([name, count]) => `<div class="panel stat"><div class="v">${count}</div><div class="l">${esc(name)}</div></div>`).join('')}
        </div>
      `).join('')}

      ${criticalAllergies.length > 0 ? `
        <h2 class="bad">Critical allergies · ${criticalAllergies.length} guest${criticalAllergies.length !== 1 ? 's' : ''}</h2>
        ${criticalAllergies.map(g => `
          <div class="alert">
            <p class="who">${esc(g.name)}${g.tableNumber ? ` · Table ${esc(g.tableNumber)}` : ''}${g.seatNumber ? ` · Seat ${esc(g.seatNumber)}` : ''}</p>
            <div class="pills">${(g.allergies || []).map(allergyPill).join('')}</div>
          </div>
        `).join('')}
      ` : ''}

      <h2>Full guest list (checked in)</h2>
      <table>
        <thead><tr>
          <th>Guest</th><th>Table / seat</th>
          ${courseNumbers.map(n => `<th>${esc(courseLabels[n] || 'Course ' + n)}</th>`).join('')}
          <th>Allergies / dietary</th>
        </tr></thead>
        <tbody>
          ${rows.map(g => `<tr>
            <td><b>${esc(g.name)}</b></td>
            <td class="nowrap">${g.tableNumber ? 'T' + esc(g.tableNumber) : '—'}${g.seatNumber ? ' · ' + esc(g.seatNumber) : ''}</td>
            ${courseNumbers.map(n => {
              const id   = g.courseSelections?.[n] || (n === 1 ? g.mealChoiceId : null);
              const name = id ? menuItems.find(m => m.id === id)?.name || '—' : '—';
              return `<td>${esc(name)}</td>`;
            }).join('')}
            <td><div class="pills">${(g.allergies || []).map(allergyPill).join('')}</div></td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    win.document.write(printPage({
      title: `Kitchen run sheet · ${event?.title || 'Event'}`,
      heading: 'Kitchen run <b>sheet</b>',
      subtitle: [esc(event?.title || 'Event'), when].filter(Boolean).join(' · '),
      meta: [`${checkedIn} of ${guests.length} guests checked in`],
      body,
      css: `
        .pp h3 { margin: 14px 0 6px; }
        .pp .stat .l { margin-top: 2px; }
        .pp .alert { background: ${PRINT.redSoft}; border-radius: 14px; padding: 10px 14px; margin: 0 0 8px; break-inside: avoid; }
        .pp .alert .who { font-weight: 600; color: ${PRINT.red}; }
        .pp .alert .pill { background: #fff; }
        .pp .pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .pp td .pills { margin-top: 0; }
      `,
    }));
    win.document.close();
  };

  // Per-guest allergen cards
  const handlePrintAllergenCards = () => {
    const flaggedGuests = guests.filter(g =>
      g.checkedIn && (g.allergies || []).length > 0
    );
    if (flaggedGuests.length === 0) return;

    const win = window.open('', '_blank');
    if (!win) return;

    const body = `
      <div class="cards">
        ${flaggedGuests.map(g => {
          const hasCritical = (g.allergies || []).some((a: any) => a.severity === 'critical');
          const seat = [g.tableNumber ? 'Table ' + esc(g.tableNumber) : '', g.seatNumber ? 'Seat ' + esc(g.seatNumber) : ''].filter(Boolean).join(' · ');
          return `<div class="card${hasCritical ? ' critical' : ''}">
            ${hasCritical ? '<p class="flag">Critical allergy</p>' : ''}
            <p class="name">${esc(g.name)}</p>
            ${seat ? `<p class="seat">${seat}</p>` : ''}
            <div class="pills">${(g.allergies || []).map(allergyPill).join('')}</div>
          </div>`;
        }).join('')}
      </div>`;

    win.document.write(printPage({
      title: `Allergen cards · ${event?.title || 'Event'}`,
      heading: 'Allergen <b>cards</b>',
      subtitle: esc(event?.title || 'Event'),
      meta: [`${flaggedGuests.length} checked-in guest${flaggedGuests.length !== 1 ? 's' : ''} with allergies or dietary needs`],
      body,
      css: `
        .pp .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .pp .card { border: 1px solid ${PRINT.line}; border-radius: 14px; padding: 12px 14px; min-height: 100px; break-inside: avoid; }
        .pp .card.critical { background: ${PRINT.redSoft}; border-color: ${PRINT.redSoft}; }
        .pp .card .flag { font-size: 11px; font-weight: 600; color: ${PRINT.red}; margin-bottom: 2px; }
        .pp .card .name { font-size: 15px; font-weight: 600; line-height: 1.25; }
        .pp .card .seat { font-size: 11px; color: ${PRINT.muted}; margin-top: 2px; }
        .pp .pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
        .pp .card .pill { font-size: 11.5px; padding: 3px 9px; }
        .pp .card.critical .pill { background: #fff; }
      `,
    }));
    win.document.close();
  };

  const allergenGuestCount = guests.filter(g => g.checkedIn && (g.allergies || []).length > 0).length;

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
            className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-all text-left group">
            <div className="w-10 h-10 rounded-xl bg-muted group-hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors">
              <FileText className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div>
              <p className="font-black text-sm text-foreground uppercase tracking-tight">Kitchen Run Sheet</p>
              <p className="text-[10px] font-bold text-muted-foreground mt-0.5">Full guest list · course counts · allergy summary</p>
            </div>
          </button>
          <button onClick={handlePrintAllergenCards} disabled={allergenGuestCount === 0}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-border bg-card hover:border-red-200 hover:bg-red-50 transition-all text-left group disabled:opacity-40 disabled:cursor-not-allowed">
            <div className="w-10 h-10 rounded-xl bg-muted group-hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors">
              <AlertTriangle className="w-5 h-5 text-muted-foreground group-hover:text-red-500 transition-colors" />
            </div>
            <div>
              <p className="font-black text-sm text-foreground uppercase tracking-tight">
                Allergen Cards
                {allergenGuestCount > 0 && <span className="ml-2 text-[9px] font-black text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">{allergenGuestCount}</span>}
              </p>
              <p className="text-[10px] font-bold text-muted-foreground mt-0.5">Per-guest cards for kitchen · 3-up grid layout</p>
            </div>
          </button>
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2 mt-2">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── TABLE GROUPED VIEW ────────────────────────────────────────────────────────
const TableGroupedView = ({ guests, menuItems, onCheckIn, onEdit, onDelete, onOverride }: {
  guests: any[]; menuItems: any[];
  onCheckIn: (id: string, current: boolean) => void;
  onEdit: (g: any) => void;
  onDelete: (id: string) => void;
  onOverride: (g: any) => void;
}) => {
  const byTable = useMemo(() => {
    const groups: Record<string, any[]> = {};
    guests.forEach(g => {
      const key = g.tableNumber || '__unassigned__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(g);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '__unassigned__') return 1;
      if (b === '__unassigned__') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [guests]);

  return (
    <div className="space-y-4">
      {byTable.map(([table, tableGuests]) => {
        const checkedInCount = tableGuests.filter(g => g.checkedIn).length;
        const hasCritical    = tableGuests.some(g => (g.allergies || []).some((a: any) => a.severity === 'critical'));
        return (
          <div key={table} className={cn('rounded-2xl border-2 overflow-hidden', hasCritical ? 'border-red-200' : 'border-border')}>
            <div className={cn('px-5 py-3 flex items-center justify-between', hasCritical ? 'bg-red-50' : 'bg-muted/60')}>
              <div className="flex items-center gap-3">
                <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm', hasCritical ? 'bg-red-100 text-red-700' : 'bg-card text-foreground/80 border border-border')}>
                  {table === '__unassigned__' ? '?' : table}
                </div>
                <div>
                  <p className="font-black text-sm text-foreground uppercase tracking-tight">
                    {table === '__unassigned__' ? 'No Table Assigned' : `Table ${table}`}
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {checkedInCount} / {tableGuests.length} in
                    {hasCritical && <span className="ml-2 text-red-500">⚠ Critical allergy</span>}
                  </p>
                </div>
              </div>
              <div className="w-6 h-6 rounded-full border-2 border-border overflow-hidden shrink-0" title={`${checkedInCount}/${tableGuests.length} checked in`}>
                <div className="bg-emerald-400 h-full transition-all" style={{ width: `${(checkedInCount / tableGuests.length) * 100}%` }} />
              </div>
            </div>
            <div className="divide-y divide-slate-50">
              {tableGuests.map(g => {
                const mealName = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName;
                return (
                  <div key={g.id} className={cn('flex items-center gap-3 px-5 py-3 hover:bg-muted/50 transition-colors', !g.checkedIn && 'opacity-60')}>
                    <button onClick={() => onCheckIn(g.id, g.checkedIn)}
                      className={cn('w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all',
                        g.checkedIn ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border text-transparent hover:border-emerald-300')}>
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-sm text-foreground">{g.name}</p>
                        {g.seatNumber && <span className="text-[9px] font-bold text-muted-foreground uppercase">S{g.seatNumber}</span>}
                        {(g.allergies || []).map((a: any, i: number) => <AllergyPill key={i} allergy={a} />)}
                      </div>
                      {mealName && <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{mealName}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onOverride(g)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Utensils className="w-3 h-3" /></button>
                      <button onClick={() => onEdit(g)}     className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground/80 transition-colors"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => onDelete(g.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
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

// ─── STAT CARD ─────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = 'slate' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) => {
  const colors: Record<string, string> = {
    slate:   'bg-card border-border',
    amber:   'bg-amber-50 border-amber-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    blue:    'bg-blue-50 border-blue-200',
    red:     'bg-red-50 border-red-200',
  };
  return (
    <div className={cn('p-5 rounded-2xl border-2', colors[color] || colors.slate)}>
      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <p className="text-3xl font-black tracking-tighter text-foreground leading-none">{value}</p>
      {sub && <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wide">{sub}</p>}
    </div>
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
          <a href={`/floor/${tenantId}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-800 transition-colors">
            Full View <ExternalLink className="w-3 h-3" />
          </a>
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
      className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 shrink-0 gap-2">
      {isFiring ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><RefreshCw className="w-3.5 h-3.5" /> Re-fire</>}
    </Button>
  </motion.div>
);

// ─── FORMULA BREAKDOWN ─────────────────────────────────────────────────────────
const FormulaBreakdown = ({ formula }: {
  formula: { id: string; name: string; quantityUsed: number; unit: string; costPerUnit?: number }[];
}) => {
  if (!formula?.length) return null;
  return (
    <div className="mt-2 pl-2 border-l-2 border-primary/20 space-y-1">
      <p className="text-[8px] font-black uppercase tracking-[0.2em] text-primary/50 mb-1.5">Unit Decomposition</p>
      {formula.map((f, i) => (
        <div key={f.id || i} className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-muted-foreground truncate">{f.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-black text-foreground/80">{f.quantityUsed} {f.unit}</span>
            {f.costPerUnit != null && f.costPerUnit > 0 && (
              <span className="text-[9px] font-bold text-muted-foreground">(${(f.quantityUsed * f.costPerUnit).toFixed(3)})</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── COURSE INGREDIENTS PREVIEW ────────────────────────────────────────────────
const CourseIngredientsPreview = ({ courseNumber, menuItems, guests, inventory }: {
  courseNumber: number; menuItems: any[]; guests: any[]; inventory: any[];
}) => {
  const [open, setOpen] = useState(false);
  const deductionSummary = useMemo(() => {
    const map: Record<string, any> = {};
    guests.filter(g => g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId))).forEach(guest => {
      const id   = guest.courseSelections?.[courseNumber] || guest.mealChoiceId;
      const item = menuItems.find(m => m.id === id);
      if (!item?.supplies) return;
      item.supplies.forEach((s: any) => {
        const inv       = (inventory || []).find((i: any) => i.id === s.inventoryId);
        if (!inv) return;
        const unitLabel = inv.costingMethod === 'size' ? (inv.containerUnit || inv.unit || 'units') : (inv.useUnit || 'uses');
        if (!map[s.inventoryId]) map[s.inventoryId] = { name: inv.name, qty: 0, unit: unitLabel, inStock: safeNum(inv.totalStock), imageUrl: inv.imageUrl, formula: inv.formula || [] };
        map[s.inventoryId].qty += safeNum(s.qty);
      });
    });
    return Object.entries(map).map(([id, d]) => ({ id, ...d as any, isShort: (d as any).qty > (d as any).inStock, remaining: (d as any).inStock - (d as any).qty }));
  }, [courseNumber, menuItems, guests, inventory]);

  if (deductionSummary.length === 0) return null;
  const hasShortage = deductionSummary.some(d => d.isShort);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(o => !o)} className={cn('flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest transition-colors', hasShortage ? 'text-red-500' : 'text-muted-foreground hover:text-foreground/80')}>
        <FlaskConical className="w-2.5 h-2.5" />
        {hasShortage ? '⚠ Stock shortage' : `${deductionSummary.length} supply item${deductionSummary.length !== 1 ? 's' : ''}`}
        {open ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-2">
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/60 border border-border">
              {deductionSummary.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-foreground truncate">{d.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-black text-foreground">−{d.qty.toFixed(1)} {d.unit}</span>
                    <span className={cn('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-lg', d.isShort ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                      {d.isShort ? `Short ${Math.abs(d.remaining).toFixed(1)}` : `${d.remaining.toFixed(1)} left`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
  const [loading,       setLoading]       = useState(true);

  // FIX: { ...d.data(), id: d.id } everywhere — Firestore doc ID always wins.
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
    return () => unsubs.forEach(u => u());
  }, [firestore, tenantId, eventId]);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState('');
  const [filterMeal,     setFilterMeal]     = useState('all');
  const [filterFlag,     setFilterFlag]     = useState('all');
  const [guestViewMode,  setGuestViewMode]  = useState<'list' | 'table'>('list');
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(new Set());

  const [isFiring,          setIsFiring]          = useState<number | null>(null);
  const [isRefiring,        setIsRefiring]         = useState<number | null>(null);
  const [fireConfirmCourse, setFireConfirmCourse]  = useState<number | null>(null);
  const [showForecast,      setShowForecast]       = useState(true);
  const [isConfirmActivateOpen, setIsConfirmActivateOpen] = useState(false);
  const [activatingNow,     setActivatingNow]      = useState(false);
  const [undoWindowOpen,    setUndoWindowOpen]     = useState(false);
  const [undoCountdown,     setUndoCountdown]      = useState(120);
  const [showLink,          setShowLink]           = useState(false);
  const [qrTables,          setQrTables]           = useState('');
  const [qrSeatsPerTable,   setQrSeatsPerTable]    = useState('');
  const [qrCodes,           setQrCodes]            = useState<{ label: string; dataUrl: string }[]>([]);
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
  const [guestForm,     setGuestForm]     = useState({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' });
  const [clientSearch,  setClientSearch]  = useState('');
  const [savingGuest,   setSavingGuest]   = useState(false);

  // Menu form
  const [isAddingMenu,      setIsAddingMenu]      = useState(false);
  const [newMenuName,       setNewMenuName]       = useState('');
  const [newMenuDesc,       setNewMenuDesc]       = useState('');
  const [newMenuCourse,     setNewMenuCourse]     = useState(1);
  const [newMenuVegan,      setNewMenuVegan]      = useState(false);
  const [newMenuGF,         setNewMenuGF]         = useState(false);
  const [menuSupplies,      setMenuSupplies]      = useState<{ inventoryId: string; qty: number }[]>([]);
  const [newMenuInventoryItemId, setNewMenuInventoryItemId] = useState('');
  const [newMenuPrice,      setNewMenuPrice]      = useState(0);
  const [inventorySearch,   setInventorySearch]   = useState('');

  const [firedGuestIdsByCourse, setFiredGuestIdsByCourse] = useState<Record<number, Set<string>>>({});

  // Firing
  const firingInProgress = useRef<Set<number>>(new Set());
  const [firingBlockedSet, setFiringBlockedSet] = useState<Set<number>>(new Set());

  // Staff zones
  const [staffZones, setStaffZones] = useState<Record<string, string>>({});

  // Request types
  const DEFAULT_REQUEST_TYPES = [
    { id: 'water',    label: 'Water Refill',  emoji: '💧', enabled: true,  alwaysShow: true  },
    { id: 'napkins',  label: 'Napkins',        emoji: '🧻', enabled: true,  alwaysShow: true  },
    { id: 'utensils', label: 'Extra Utensils', emoji: '🍴', enabled: true,  alwaysShow: true  },
    { id: 'condiments',label:'Condiments',     emoji: '🧂', enabled: true,  alwaysShow: true  },
    { id: 'ice',      label: 'Ice',            emoji: '🧊', enabled: true,  alwaysShow: true  },
    { id: 'menu',     label: 'Menu Question',  emoji: '📋', enabled: true,  alwaysShow: true  },
    { id: 'temp',     label: 'Too Hot/Cold',   emoji: '🌡️', enabled: true,  alwaysShow: true  },
    { id: 'spill',    label: 'Spill/Cleanup',  emoji: '🧹', enabled: true,  alwaysShow: true  },
    { id: 'order',    label: 'Ready to Order', emoji: '✋', enabled: false, alwaysShow: false },
    { id: 'bill',     label: 'Bill Please',    emoji: '💳', enabled: false, alwaysShow: false },
    { id: 'other',    label: 'Something Else', emoji: '💬', enabled: true,  alwaysShow: true  },
  ];
  const requestTypes: typeof DEFAULT_REQUEST_TYPES = event?.requestTypes || DEFAULT_REQUEST_TYPES;
  const [editingRequestTypes, setEditingRequestTypes] = useState(false);
  const [localRequestTypes,   setLocalRequestTypes]   = useState(requestTypes);

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

  const courseNumbers  = useMemo(() => Array.from(new Set(menuItems.map(m => m.courseNumber))).sort() as number[], [menuItems]);
  const firedCourses   = useMemo(() => new Set(fires.filter(f => f.status === 'fired').map(f => f.courseNumber)), [fires]);
  const unfiredCourses = useMemo(() => courseNumbers.filter(n => !firedCourses.has(n)), [courseNumbers, firedCourses]);
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
    guests.forEach(g => { const name = menuItems.find(m => m.id === g.mealChoiceId)?.name || g.mealChoiceName || 'No selection'; mealCounts[name] = (mealCounts[name] || 0) + 1; });
    return {
      total: guests.length, checkedIn: guests.filter(g => g.checkedIn).length,
      notCheckedIn: guests.filter(g => !g.checkedIn).length,
      allergyCount: allergyLabels.length, uniqueAllergies: Array.from(new Set(allergyLabels)) as string[], mealCounts,
    };
  }, [guests, menuItems]);

  const filtered = useMemo(() => guests.filter(g => {
    if (search && !g.name?.toLowerCase().includes(search.toLowerCase()) && !g.seatNumber?.includes(search) && !g.tableNumber?.includes(search)) return false;
    if (filterMeal !== 'all' && g.mealChoiceId !== filterMeal) return false;
    if (filterFlag === 'allergies'     && (!g.allergies || !g.allergies.length)) return false;
    if (filterFlag === 'dietary'       && (!g.dietaryRestrictions || !g.dietaryRestrictions.length)) return false;
    if (filterFlag === 'not-checked-in' && g.checkedIn) return false;
    if (filterFlag === 'checked-in'    && !g.checkedIn) return false;
    return true;
  }).sort((a, b) => a.tableNumber && b.tableNumber ? a.tableNumber.localeCompare(b.tableNumber) : (a.submittedAt || '').localeCompare(b.submittedAt || '')),
    [guests, search, filterMeal, filterFlag]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return (clients || []).slice(0, 10);
    const s = clientSearch.toLowerCase();
    return (clients || []).filter((c: any) => c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s)).slice(0, 10);
  }, [clients, clientSearch]);

  const filteredInventory = useMemo(() => {
    if (!inventorySearch.trim()) return (inventory || []).slice(0, 12);
    const s = inventorySearch.toLowerCase();
    return (inventory || []).filter((i: any) => i.name?.toLowerCase().includes(s)).slice(0, 12);
  }, [inventory, inventorySearch]);

  const crossContaminationWarnings = useMemo(() => {
    const warnings: { table: string; reason: string }[] = [];
    const byTable: Record<string, any[]> = {};
    guests.filter(g => g.tableNumber).forEach(g => { if (!byTable[g.tableNumber]) byTable[g.tableNumber] = []; byTable[g.tableNumber].push(g); });
    Object.entries(byTable).forEach(([table, tGuests]) => {
      const criticals = tGuests.filter(g => (g.allergies || []).some((a: any) => a.severity === 'critical'));
      if (!criticals.length) return;
      criticals.forEach(cg => {
        const allergens = (cg.allergies || []).filter((a: any) => a.severity === 'critical').map((a: any) => a.id);
        tGuests.filter(g => g.id !== cg.id).forEach(other => {
          const item = menuItems.find(m => m.id === other.mealChoiceId);
          if (!item) return;
          const conflicts = allergens.filter((a: string) => `${item.name} ${item.description || ''}`.toLowerCase().includes(a));
          if (conflicts.length > 0) warnings.push({ table, reason: `${cg.name} has critical ${conflicts.join(', ')} allergy — ${other.name} ordered "${item.name}"` });
        });
      });
    });
    return warnings;
  }, [guests, menuItems]);

  // ── Bulk select ────────────────────────────────────────────────────────────
  const toggleSelectGuest = (id: string) => {
    setSelectedGuests(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const selectAll   = () => setSelectedGuests(new Set(filtered.map(g => g.id)));
  const deselectAll = () => setSelectedGuests(new Set());
  const handleBulkCheckIn = async () => {
    if (!firestore || !tenantId || selectedGuests.size === 0) return;
    const batch = writeBatch(firestore);
    const now   = new Date().toISOString();
    selectedGuests.forEach(id => {
      batch.update(doc(firestore, `tenants/${tenantId}/eventGuests`, id), { checkedIn: true, checkedInAt: now });
    });
    await batch.commit();
    setSelectedGuests(new Set());
    toast({ title: `${selectedGuests.size} guests checked in` });
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCheckInGuest = async (guestId: string, current: boolean) => {
    if (!firestore || !tenantId) return;
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, guestId), {
        checkedIn: !current, checkedInAt: !current ? new Date().toISOString() : null,
      });
      toast({ title: !current ? 'Checked In ✓' : 'Check-in Removed' });
    } catch (e) {
      console.error('Check-in failed:', e);
      toast({ variant: 'destructive', title: 'Check-in failed — please try again' });
    }
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
    try {
      if (editingGuest) {
        await updateDoc(doc(firestore, `tenants/${tenantId}/eventGuests`, editingGuest.id), {
          ...guestForm, mealChoiceId: guestForm.mealChoiceId || null, mealChoiceName: mealItem?.name || null, updatedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Updated' });
      } else {
        await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
          id: nanoid(), eventId, tenantId, ...guestForm,
          mealChoiceId: guestForm.mealChoiceId || null, mealChoiceName: mealItem?.name || null,
          allergies: [], dietaryRestrictions: [], checkedIn: false, source: 'manual', submittedAt: new Date().toISOString(),
        });
        toast({ title: 'Guest Added' });
      }
    } catch (e) {
      console.error('Save guest failed:', e);
      toast({ variant: 'destructive', title: editingGuest ? 'Update failed' : 'Failed to add guest' });
    } finally {
      setSavingGuest(false); setIsAddingGuest(false); setEditingGuest(null);
      setGuestForm({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' });
    }
  };

  const handleImportClient = async (client: any) => {
    if (!firestore || !tenantId) return;
    if (guests.find(g => g.clientId === client.id)) { toast({ variant: 'destructive', title: 'Already on guest list' }); return; }
    await addDoc(collection(firestore, `tenants/${tenantId}/eventGuests`), {
      id: nanoid(), eventId, tenantId, name: client.name, email: client.email || '', phone: client.phone || '',
      tableNumber: '', seatNumber: '', mealChoiceId: null, mealChoiceName: null,
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
      console.error(e);
      toast({ variant: 'destructive', title: 'Override failed — please try again' });
    } finally {
      setSavingOverride(false);
    }
  };

  const handleFireCourse = async (courseNumber: number) => {
    if (!firestore || !tenantId) return;
    if (firingInProgress.current.has(courseNumber) || firingBlockedSet.has(courseNumber)) return;
    if (firedCourses.has(courseNumber)) { toast({ variant: 'destructive', title: `Course ${courseNumber} already fired` }); return; }
    if (courseNumber > 1) {
      const unfiredPrev = courseNumbers.filter(n => n < courseNumber && !firedCourses.has(n));
      if (unfiredPrev.length > 0 && !window.confirm(`Course ${unfiredPrev.join(', ')} not fired yet. Continue?`)) return;
    }
    firingInProgress.current.add(courseNumber);
    setFiringBlockedSet(prev => new Set(prev).add(courseNumber));
    setIsFiring(courseNumber);
    try {
      const existing = await getDocs(query(collection(firestore, `tenants/${tenantId}/courseFires`), where('eventId', '==', eventId), where('courseNumber', '==', courseNumber), where('status', '==', 'fired')));
      if (existing.docs.some(d => !d.data().isDelta)) { toast({ variant: 'destructive', title: 'Already fired' }); return; }
      const batch     = writeBatch(firestore);
      const fireId    = nanoid();
      const now       = new Date().toISOString();
      const labels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
      const forCourse = guests.filter(g => g.checkedIn && (g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId)));
      if (forCourse.length === 0) { toast({ variant: 'destructive', title: 'No checked-in guests' }); return; }
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), { id: fireId, eventId, tenantId, courseNumber, courseName: labels[courseNumber] || `Course ${courseNumber}`, firedAt: now, firedBy: 'host', guestCount: forCourse.length, status: 'fired', isDelta: false });
      forCourse.forEach(g => {
        const menuItemId = g.courseSelections?.[courseNumber] || g.mealChoiceId;
        const menuItem   = menuItems.find(m => m.id === menuItemId);
        const kdsId      = nanoid();
        batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), { id: kdsId, source: 'event', eventId, eventTitle: event?.title || event?.name || '', courseFireId: fireId, courseNumber, guestId: g.id, guestName: g.name, seatNumber: g.seatNumber || null, tableNumber: g.tableNumber || null, menuItemId, menuItemName: menuItem?.name || 'Item', allergies: g.allergies || [], allergyNote: g.allergyNote || null, hasCriticalAllergy: (g.allergies || []).some((a: any) => a.severity === 'critical'), notes: g.guestNote || null, status: 'pending', createdAt: now, tenantId, isDelta: false });
      });
      const deductionMap: Record<string, number> = {};
      forCourse.forEach(g => { const item = menuItems.find(m => m.id === (g.courseSelections?.[courseNumber] || g.mealChoiceId)); if (!item?.supplies) return; item.supplies.forEach((s: any) => { deductionMap[s.inventoryId] = (deductionMap[s.inventoryId] || 0) + safeNum(s.qty); }); });
      Object.entries(deductionMap).forEach(([invId, qty]) => { const inv = (inventory || []).find((i: any) => i.id === invId); if (!inv) return; batch.update(doc(firestore, `tenants/${tenantId}/inventory`, invId), { totalStock: increment(-qty) }); });
      await batch.commit();
      const notIn = guests.filter(g => g.courseSelections?.[courseNumber] || (courseNumber === 1 && g.mealChoiceId)).length - forCourse.length;
      toast({ title: `Course ${courseNumber} Fired`, description: notIn > 0 ? `${forCourse.length} tickets sent · ${notIn} not checked in` : `${forCourse.length} tickets sent to kitchen` });
    } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Fire Failed' }); }
    finally {
      setIsFiring(null);
      firingInProgress.current.delete(courseNumber);
      setFiringBlockedSet(prev => { const next = new Set(prev); next.delete(courseNumber); return next; });
    }
  };

  const handleRefireDelta = async (courseNumber: number, deltaGuests: any[]) => {
    if (!firestore || !tenantId || deltaGuests.length === 0 || firingInProgress.current.has(courseNumber)) return;
    firingInProgress.current.add(courseNumber);
    setFiringBlockedSet(prev => new Set(prev).add(courseNumber));
    setIsRefiring(courseNumber);
    try {
      const batch  = writeBatch(firestore);
      const fireId = nanoid();
      const now    = new Date().toISOString();
      const labels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
      batch.set(doc(firestore, `tenants/${tenantId}/courseFires`, fireId), { id: fireId, eventId, tenantId, courseNumber, courseName: labels[courseNumber] || `Course ${courseNumber}`, firedAt: now, firedBy: 'host_delta', guestCount: deltaGuests.length, status: 'fired', isDelta: true });
      deltaGuests.forEach(g => { const menuItemId = g.courseSelections?.[courseNumber] || g.mealChoiceId; const menuItem = menuItems.find(m => m.id === menuItemId); const kdsId = nanoid(); batch.set(doc(firestore, `tenants/${tenantId}/kdsTickets`, kdsId), { id: kdsId, source: 'event', eventId, eventTitle: event?.title || '', courseFireId: fireId, courseNumber, guestId: g.id, guestName: g.name, seatNumber: g.seatNumber || null, tableNumber: g.tableNumber || null, menuItemId, menuItemName: menuItem?.name || 'Item', allergies: g.allergies || [], hasCriticalAllergy: (g.allergies || []).some((a: any) => a.severity === 'critical'), status: 'pending', createdAt: now, tenantId, isDelta: true }); });
      const deductionMap: Record<string, number> = {};
      deltaGuests.forEach(g => { const item = menuItems.find(m => m.id === (g.courseSelections?.[courseNumber] || g.mealChoiceId)); if (!item?.supplies) return; item.supplies.forEach((s: any) => { deductionMap[s.inventoryId] = (deductionMap[s.inventoryId] || 0) + safeNum(s.qty); }); });
      Object.entries(deductionMap).forEach(([invId, qty]) => { const inv = (inventory || []).find((i: any) => i.id === invId); if (!inv) return; batch.update(doc(firestore, `tenants/${tenantId}/inventory`, invId), { totalStock: increment(-qty) }); });
      await batch.commit();
      toast({ title: `Course ${courseNumber} re-fired`, description: `${deltaGuests.length} late arrival${deltaGuests.length !== 1 ? 's' : ''} sent to kitchen` });
    } catch (e) { console.error(e); toast({ variant: 'destructive', title: 'Re-fire failed' }); }
    finally {
      setIsRefiring(null);
      firingInProgress.current.delete(courseNumber);
      setFiringBlockedSet(prev => { const next = new Set(prev); next.delete(courseNumber); return next; });
    }
  };

  const handleAddStaff = async () => {
    if (!staffToAdd || !firestore || !tenantId) return;
    const current = event?.assignedStaffIds || [];
    if (current.includes(staffToAdd)) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { assignedStaffIds: [...current, staffToAdd] });
    setStaffToAdd(''); toast({ title: 'Staff assigned' });
  };
  const handleRemoveStaff = async (staffId: string) => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { assignedStaffIds: (event?.assignedStaffIds || []).filter((id: string) => id !== staffId) });
    toast({ title: 'Staff removed' });
  };
  const handleSaveStaffZone = async (staffId: string) => {
    if (!firestore || !tenantId) return;
    const zones = { ...(event?.staffZones || {}), [staffId]: staffZones[staffId] || '' };
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { staffZones: zones });
    toast({ title: 'Zone saved' });
  };

  const handleActivateEvent = async () => {
    if (!firestore || !tenantId) return;
    setActivatingNow(true);
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'active', activatedAt: new Date().toISOString(), activatedBy: 'host' });
      setIsConfirmActivateOpen(false); setUndoWindowOpen(true); setUndoCountdown(120);
      const interval = setInterval(() => { setUndoCountdown(prev => { if (prev <= 1) { clearInterval(interval); setUndoWindowOpen(false); return 0; } return prev - 1; }); }, 1000);
      toast({ title: '🟢 Event is now live' });
    } catch { toast({ variant: 'destructive', title: 'Activation failed' }); }
    finally { setActivatingNow(false); }
  };
  const handleDeactivateEvent = async () => {
    if (!firestore || !tenantId) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'upcoming', activatedAt: null });
    setUndoWindowOpen(false); toast({ title: 'Event deactivated' });
  };

  const handleConfirmEndEvent = async () => {
    if (!firestore || !tenantId) return;
    const now   = new Date().toISOString();
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { status: 'completed', endedAt: now });
    (event?.assignedStaffIds || []).forEach((staffId: string) => {
      const nRef = doc(collection(firestore, `tenants/${tenantId}/notifications`));
      batch.set(nRef, { id: nRef.id, userId: staffId, type: 'event_ended', message: `${eventDisplayName} has ended.`, link: `/events/${eventId}/reconciliation`, eventId, createdAt: now, read: false });
    });
    await batch.commit();
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
    toast({ title: 'Broadcast cleared' });
  };

  const handleExportCSV = () => {
    const rows = [['Name','Email','Phone','Table','Seat','Meal Choice','Allergies','Dietary','Notes','Checked In'], ...guests.map(g => [g.name, g.email||'', g.phone||'', g.tableNumber||'', g.seatNumber||'', g.mealChoiceName||'', (g.allergies||[]).map((a:any)=>typeof a==='object'?a.label:a).join(';'), (g.dietaryRestrictions||[]).join(';'), g.notes||'', g.checkedIn?'Yes':'No'])];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a   = document.createElement('a'); a.href = url; a.download = `${event?.title||'event'}-manifest.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const courseLabels: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
  const shareableLink = typeof window !== 'undefined' ? `${window.location.origin}/event/${tenantId}/${eventId}` : '';

  const generateQRDataUrl = async (url: string) => `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  const handleGenerateQRs = async () => {
    const tables = qrTables.split(',').map(t => t.trim()).filter(Boolean);
    const seats  = parseInt(qrSeatsPerTable) || 4;
    const codes: { label: string; dataUrl: string }[] = [];
    for (const t of tables) for (let s = 1; s <= seats; s++) codes.push({ label: `T${t} · S${s}`, dataUrl: await generateQRDataUrl(`${shareableLink}?table=${t}&seat=${s}`) });
    setQrCodes(codes); toast({ title: `${codes.length} QR codes generated` });
  };

  const handleSaveRequestTypes = async () => {
    if (!firestore) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/studioEvents`, eventId), { requestTypes: localRequestTypes });
    toast({ title: 'Request menu saved' }); setEditingRequestTypes(false);
  };

  const resetMenuForm = () => {
    setNewMenuName(''); setNewMenuDesc(''); setNewMenuCourse(1);
    setNewMenuVegan(false); setNewMenuGF(false); setMenuSupplies([]);
    setNewMenuInventoryItemId(''); setNewMenuPrice(0); setInventorySearch(''); setIsAddingMenu(false);
  };

  const handleAddMenuItem = async () => {
    if (!newMenuName.trim() || !firestore || !tenantId) return;
    const id = nanoid(); const batch = writeBatch(firestore);
    const linkedItem = newMenuInventoryItemId ? (inventory || []).find((i: any) => i.id === newMenuInventoryItemId) : null;
    const menuItem = { id, eventId, tenantId, name: newMenuName.trim(), description: newMenuDesc.trim() || null, courseNumber: newMenuCourse, isVegan: newMenuVegan, isGlutenFree: newMenuGF, inventoryItemId: newMenuInventoryItemId || null, pricePerGuest: newMenuPrice || 0, imageUrl: (linkedItem as any)?.imageUrl || null, supplies: menuSupplies.filter(s => s.inventoryId && s.qty > 0) };
    batch.set(doc(firestore, `tenants/${tenantId}/eventMenuItems`, id), menuItem);
    const eRef    = doc(firestore, `tenants/${tenantId}/studioEvents`, eventId);
    const eSnap   = await getDoc(eRef);
    const existing = eSnap.data()?.menuItems || [];
    const updated  = [...existing.filter((m: any) => m.id !== id), menuItem];
    batch.update(eRef, { menuItems: updated });
    await batch.commit(); resetMenuForm(); toast({ title: 'Menu item added' });
  };

  const handleDeleteMenuItem = async (item: any) => {
    if (!firestore || !tenantId) return;
    const n = guests.filter(g => g.mealChoiceId === item.id).length;
    if (n > 0 && !window.confirm(`${n} guest${n !== 1 ? 's have' : ' has'} selected "${item.name}". Delete anyway?`)) return;
    if (n > 0) { const b = writeBatch(firestore); guests.filter(g => g.mealChoiceId === item.id).forEach(g => { b.update(doc(firestore, `tenants/${tenantId}/eventGuests`, g.id), { mealChoiceId: null, mealChoiceName: null }); }); await b.commit(); }
    await deleteDoc(doc(firestore, `tenants/${tenantId}/eventMenuItems`, item.id));
    toast({ title: `${item.name} removed` });
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex h-screen items-center justify-center"><Loader className="animate-spin w-8 h-8 text-muted-foreground" /></div>;
  if (!event)  return <div className="flex h-screen items-center justify-center text-muted-foreground font-bold">Event not found</div>;

  const eventDisplayName   = event.title || event.name || 'Untitled Event';
  const assignedStaffCount = (event?.assignedStaffIds || []).length;
  const currentBroadcast   = event?.broadcastMessage && !event?.broadcastDismissed ? event.broadcastMessage : null;
  const linkedInvItem      = newMenuInventoryItemId ? (inventory || []).find((i: any) => i.id === newMenuInventoryItemId) : null;
  const hasOrderingDeadline = event?.orderingDeadline && !isPast(new Date(event.orderingDeadline));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted/60">
      <AppHeader title={`${eventDisplayName} — Manifest`} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 pb-24">

        <>
          <div className="hidden md:flex items-start justify-between gap-4">
            <div className="flex items-start gap-6">
              <CapacityRing
                checkedIn={stats.checkedIn}
                total={stats.total}
                capacity={event.capacity || null}
              />
              <div>
                <h1 className="text-4xl font-black uppercase tracking-tighter text-foreground leading-none">{eventDisplayName}</h1>
                {event.date  && <p className="text-sm text-muted-foreground mt-1">{format(new Date(event.date), 'EEEE, MMMM d, yyyy')}</p>}
                {event.venue && <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{event.venue}</p>}
                {event.capacity && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-32 h-1.5 rounded-full bg-border overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min((stats.total / event.capacity) * 100, 100)}%` }} />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{stats.total}/{event.capacity} capacity</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {event.quoteId && (
                <QuoteLinkBadge quoteId={event.quoteId} tenantId={tenantId} firestore={firestore} />
              )}
              {event?.status === 'active' ? (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-black uppercase text-[9px] tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                  <Button onClick={() => setBroadcastOpen(true)} variant="outline"
                    className="h-9 px-3 rounded-xl border-2 border-violet-200 text-violet-700 hover:bg-violet-50 font-black uppercase text-[9px] tracking-widest gap-1.5">
                    <Megaphone className="w-3.5 h-3.5" /> Broadcast
                  </Button>
                  <Button onClick={() => setIsEndEventOpen(true)} variant="outline"
                    className="h-9 px-3 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                    End Event
                  </Button>
                </div>
              ) : event?.status === 'completed' ? (
                <span className="px-3 py-1.5 rounded-xl bg-muted border-2 border-border text-muted-foreground font-black uppercase text-[9px] tracking-widest">Completed</span>
              ) : (
                <Button onClick={() => setIsConfirmActivateOpen(true)}
                  className="h-10 px-5 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-card" /> Go Live
                </Button>
              )}
              <Button variant="outline" onClick={() => setPrintModalOpen(true)}
                className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
                <Printer className="w-4 h-4" /> Print
              </Button>
              <Button variant="outline" onClick={() => setShowLink(!showLink)}
                className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
                <Link2 className="w-4 h-4" /> Guest Link
              </Button>
              <Button variant="outline" onClick={handleExportCSV}
                className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
                <Download className="w-4 h-4" /> CSV
              </Button>
              <Button variant="outline" onClick={() => router.push(`/events/${eventId}/reconciliation`)}
                className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest gap-2">
                <BarChart2 className="w-4 h-4" /> Post-Event
              </Button>
            </div>
          </div>

          <div className="md:hidden space-y-3">
            <div className="flex items-center gap-4">
              <CapacityRing checkedIn={stats.checkedIn} total={stats.total} capacity={event.capacity || null} />
              <div className="min-w-0">
                <h1 className="text-2xl font-black uppercase tracking-tighter text-foreground leading-tight">{eventDisplayName}</h1>
                {event.date  && <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(event.date), 'EEE, MMM d')}</p>}
                {event.venue && <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{event.venue}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {event.quoteId && <QuoteLinkBadge quoteId={event.quoteId} tenantId={tenantId} firestore={firestore} />}
              {event?.status === 'active' ? (
                <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-black uppercase text-[9px] tracking-widest shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
                </span>
              ) : event?.status !== 'completed' && (
                <Button onClick={() => setIsConfirmActivateOpen(true)} size="sm"
                  className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest gap-1.5 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-card" /> Go Live
                </Button>
              )}
              {event?.status === 'active' && (
                <Button onClick={() => setBroadcastOpen(true)} variant="outline" size="sm"
                  className="h-9 px-3 rounded-xl border-2 border-violet-200 text-violet-700 shrink-0">
                  <Megaphone className="w-3.5 h-3.5" />
                </Button>
              )}
              <button onClick={() => setPrintModalOpen(true)}
                className="flex items-center gap-1 h-9 px-3 rounded-xl border-2 border-border font-black uppercase text-[9px] tracking-widest text-foreground/80 hover:border-border shrink-0">
                <Printer className="w-3.5 h-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0 rounded-xl border-2 shrink-0">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-2 shadow-xl p-1 min-w-[180px]">
                  <DropdownMenuItem onClick={() => setShowLink(!showLink)} className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                    <Link2 className="w-3.5 h-3.5" /> Guest Link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportCSV} className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/events/${eventId}/reconciliation`)} className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                    <BarChart2 className="w-3.5 h-3.5" /> Post-Event Report
                  </DropdownMenuItem>
                  {event?.status === 'active' && (
                    <DropdownMenuItem onClick={() => setIsEndEventOpen(true)} className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 text-red-500">
                      <X className="w-3.5 h-3.5" /> End Event
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </>


        {event?.menuNote && <MenuNoteBanner note={event.menuNote} />}

        {hasOrderingDeadline && (
          <OrderingDeadlineBanner
            deadline={event.orderingDeadline}
            eventId={eventId} tenantId={tenantId} firestore={firestore}
          />
        )}

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
              <Button onClick={handleDeactivateEvent} variant="outline" className="h-9 px-4 rounded-xl border-2 border-emerald-300 font-black uppercase text-[9px] text-emerald-700 hover:bg-emerald-100 shrink-0">Undo</Button>
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
          {allCoursesFired && (
            <AllCoursesFiredNudge onEndEvent={() => setIsEndEventOpen(true)} />
          )}
        </AnimatePresence>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Responses" value={stats.total} sub={`${stats.checkedIn} checked in`} />
          <StatCard label="Allergy Flags" value={stats.allergyCount} sub={stats.uniqueAllergies.slice(0, 2).join(', ') || 'None'} color="amber" />
          {Object.entries(stats.mealCounts).slice(0, 2).map(([meal, count]) => (
            <StatCard key={meal} label={meal} value={count as number} sub={`${Math.round((count as number) / Math.max(stats.total, 1) * 100)}%`} color="emerald" />
          ))}
        </div>

        {crossContaminationWarnings.length > 0 && (
          <div className="bg-red-50 rounded-2xl border-2 border-red-300 p-5 space-y-3">
            <div className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-600" /><h2 className="text-sm font-black uppercase tracking-[0.2em] text-red-800">Cross-Contamination Risk — {crossContaminationWarnings.length} Table{crossContaminationWarnings.length !== 1 ? 's' : ''}</h2></div>
            <div className="space-y-2">{crossContaminationWarnings.map((w, i) => (<div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-card border border-red-200"><span className="text-red-500 font-black text-sm shrink-0">T{w.table}</span><p className="text-[11px] font-bold text-red-700">{w.reason}</p></div>))}</div>
          </div>
        )}

        {courseNumbers.length > 0 && (
          <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
            <div className="p-5 border-b border-border"><h2 className="text-sm font-black uppercase tracking-[0.2em] text-foreground flex items-center gap-2"><Utensils className="w-4 h-4 text-primary" /> Course Firing</h2></div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {courseNumbers.map(n => {
                const fired     = firedCourses.has(n);
                const isBlocked = firingBlockedSet.has(n);
                const count     = guests.filter(g => g.courseSelections?.[n] || (n === 1 && g.mealChoiceId)).length;
                const inCount   = guests.filter(g => g.checkedIn && (g.courseSelections?.[n] || (n === 1 && g.mealChoiceId))).length;
                const deltaCount = deltaGuestsByCourse[n]?.length || 0;
                return (
                  <div key={n} className={cn('p-4 rounded-2xl border-2', fired ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-muted/60')}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Course {n}</p>
                        <p className="font-black text-foreground text-sm">{courseLabels[n] || `Course ${n}`}</p>
                        <p className="text-[10px] text-muted-foreground">{inCount} checked in · {count} total</p>
                        {fired && deltaCount > 0 && <p className="text-[9px] font-black text-indigo-600 mt-0.5">+{deltaCount} new arrival{deltaCount !== 1 ? 's' : ''}</p>}
                      </div>
                      {fired && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                    </div>
                    <CourseIngredientsPreview courseNumber={n} menuItems={menuItems} guests={guests} inventory={inventory || []} />
                    <Button
                      onClick={() => setFireConfirmCourse(n)}
                      disabled={isBlocked || !!isFiring || fired || count === 0}
                      className={cn('w-full h-10 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 mt-3', fired ? 'bg-emerald-500 hover:bg-emerald-500 opacity-60 cursor-not-allowed' : 'shadow-lg shadow-primary/20')}>
                      {isFiring === n || isBlocked ? <Loader className="w-4 h-4 animate-spin" /> : fired ? <><CheckCircle2 className="w-4 h-4" /> Fired</> : <><Play className="w-4 h-4" /> Fire Course</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="h-11 rounded-2xl border-2 bg-muted p-1 gap-1 w-max md:w-full">
              {[
                { value: 'guests',   label: `Guests (${guests.length})` },
                { value: 'menu',     label: `Menu (${menuItems.length})` },
                { value: 'seating',  label: 'Seating' },
                { value: 'staff',    label: 'Staff' },
                { value: 'requests', label: floorRequests.filter(r => r.status === 'new' || r.status === 'acknowledged').length > 0 ? `Requests (${floorRequests.filter(r => r.status === 'new' || r.status === 'acknowledged').length})` : 'Requests' },
              ].map(t => (
                <TabsTrigger key={t.value} value={t.value} className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-card data-[state=active]:shadow-sm px-4 whitespace-nowrap">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="guests" className="mt-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => { setIsAddingGuest(true); setEditingGuest(null); setGuestForm({ name: '', email: '', phone: '', tableNumber: '', seatNumber: '', mealChoiceId: '', notes: '' }); }}
                className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                <UserPlus className="w-4 h-4" /> Add Guest
              </Button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
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
                  <SelectItem value="dietary">Dietary Req.</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center rounded-xl border-2 border-border overflow-hidden h-10 ml-auto">
                <button onClick={() => setGuestViewMode('list')}
                  className={cn('flex items-center justify-center w-10 h-full transition-colors', guestViewMode === 'list' ? 'bg-primary text-white' : 'hover:bg-muted/60 text-muted-foreground')}>
                  <List className="w-4 h-4" />
                </button>
                <button onClick={() => setGuestViewMode('table')}
                  className={cn('flex items-center justify-center w-10 h-full transition-colors border-l border-border', guestViewMode === 'table' ? 'bg-primary text-white' : 'hover:bg-muted/60 text-muted-foreground')}>
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>

            {selectedGuests.size > 0 && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between p-3 rounded-2xl bg-primary/5 border-2 border-primary/20">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-xl bg-primary text-white text-xs font-black flex items-center justify-center">{selectedGuests.size}</span>
                  <p className="font-black text-sm text-foreground uppercase tracking-tight">Guest{selectedGuests.size !== 1 ? 's' : ''} selected</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={handleBulkCheckIn} size="sm"
                    className="h-9 px-4 rounded-xl font-black uppercase text-[9px] tracking-widest gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" /> Check In All
                  </Button>
                  <button onClick={deselectAll} className="p-2 rounded-xl hover:bg-muted text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            <AnimatePresence>
              {(isAddingGuest || editingGuest) && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-card rounded-2xl border-2 border-primary/20 overflow-hidden">
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-black uppercase tracking-tight text-foreground">{editingGuest ? 'Edit Guest' : 'Add Guest'}</h3>
                      {!editingGuest && <Input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Import from client log…" className="h-9 w-52 rounded-xl border-2 text-xs font-bold" />}
                    </div>
                    {!editingGuest && clientSearch && filteredClients.length > 0 && (
                      <div className="rounded-xl border-2 divide-y overflow-hidden">
                        {filteredClients.map((c: any) => (
                          <button key={c.id} onClick={() => { handleImportClient(c); setClientSearch(''); }}
                            className="w-full flex items-center justify-between p-3 hover:bg-primary/5 transition-colors text-left gap-3">
                            <div><p className="font-black text-sm text-foreground">{c.name}</p><p className="text-[10px] text-muted-foreground">{c.email}</p></div>
                            <Badge className="bg-primary/10 text-primary border-primary/20 font-black text-[9px] shrink-0">Import</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Name *</Label><Input value={guestForm.name} onChange={e => setGuestForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Email</Label><Input value={guestForm.email} onChange={e => setGuestForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Phone</Label><Input value={guestForm.phone} onChange={e => setGuestForm(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 000-0000" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Meal Choice</Label>
                        <Select value={guestForm.mealChoiceId || NO_SELECTION} onValueChange={v => setGuestForm(p => ({ ...p, mealChoiceId: v === NO_SELECTION ? '' : v }))}>
                          <SelectTrigger className="h-11 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue placeholder="Select meal…" /></SelectTrigger>
                          <SelectContent><SelectItem value={NO_SELECTION}>No selection</SelectItem>{menuItems.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Table</Label><Input value={guestForm.tableNumber} onChange={e => setGuestForm(p => ({ ...p, tableNumber: e.target.value }))} placeholder="Table #" className="h-11 rounded-xl border-2" /></div>
                      <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Seat</Label><Input value={guestForm.seatNumber} onChange={e => setGuestForm(p => ({ ...p, seatNumber: e.target.value }))} placeholder="Seat #" className="h-11 rounded-xl border-2" /></div>
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

            {guestViewMode === 'table' ? (
              <TableGroupedView
                guests={filtered} menuItems={menuItems}
                onCheckIn={handleCheckInGuest}
                onEdit={g => { setEditingGuest(g); setIsAddingGuest(false); setGuestForm({ name: g.name, email: g.email || '', phone: g.phone || '', tableNumber: g.tableNumber || '', seatNumber: g.seatNumber || '', mealChoiceId: g.mealChoiceId || '', notes: g.notes || '' }); }}
                onDelete={handleDeleteGuest}
                onOverride={g => { setMealOverrideGuest(g); setMealOverrideId(g.mealChoiceId || NO_SELECTION); }}
              />
            ) : (
              /* Flat list view */
              <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 w-10">
                          <button onClick={selectedGuests.size === filtered.length ? deselectAll : selectAll}
                            className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                              selectedGuests.size === filtered.length && filtered.length > 0 ? 'bg-primary border-primary text-white' : 'border-border hover:border-primary')}>
                            {selectedGuests.size === filtered.length && filtered.length > 0 && <Check className="w-3 h-3" />}
                          </button>
                        </th>
                        {['Guest', 'Seat', 'Meal', 'Flags', 'Status', ''].map(h => (
                          <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filtered.map(guest => (
                        <tr key={guest.id} className={cn('hover:bg-muted/50 transition-colors', !guest.checkedIn && filterFlag === 'not-checked-in' && 'bg-amber-50/30')}>
                          <td className="px-4 py-3">
                            <button onClick={() => toggleSelectGuest(guest.id)}
                              className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                                selectedGuests.has(guest.id) ? 'bg-primary border-primary text-white' : 'border-border hover:border-primary')}>
                              {selectedGuests.has(guest.id) && <Check className="w-3 h-3" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-black text-sm text-foreground">{guest.name}</p>
                            <p className="text-[10px] text-muted-foreground">{guest.email || ''}{guest.phone ? ` · ${guest.phone}` : ''}</p>
                            {guest.hasCriticalAllergy && <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 mt-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Critical Allergy</span>}
                            {guest.mealClearedReason && <span className="text-[8px] font-bold text-amber-600 block mt-0.5">⚠ Meal cleared</span>}
                          </td>
                          <td className="px-4 py-3">
                            {guest.tableNumber && <span className="text-[10px] font-black uppercase text-muted-foreground">T{guest.tableNumber}</span>}
                            {guest.seatNumber  && <span className="text-[10px] font-black uppercase text-muted-foreground"> · {guest.seatNumber}</span>}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-bold text-foreground/80">{guest.mealChoiceName || <span className="text-muted-foreground/70 italic text-xs">—</span>}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(guest.allergies || []).map((a: any, i: number) => <AllergyPill key={i} allergy={a} />)}
                              {(guest.dietaryRestrictions || []).map((d: string) => (
                                <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase border bg-emerald-50 border-emerald-200 text-emerald-700"><Leaf className="w-2 h-2" /> {d}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleCheckInGuest(guest.id, guest.checkedIn)}
                              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest transition-all',
                                guest.checkedIn ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-border bg-muted/60 text-muted-foreground hover:border-primary/30 hover:text-primary')}>
                              {guest.checkedIn ? <><UserCheck className="w-3 h-3" /> In</> : <><UserPlus className="w-3 h-3" /> Check In</>}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setMealOverrideGuest(guest); setMealOverrideId(guest.mealChoiceId || NO_SELECTION); }} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Utensils className="w-3.5 h-3.5" /></button>
                              <button onClick={() => { setEditingGuest(guest); setIsAddingGuest(false); setGuestForm({ name: guest.name, email: guest.email || '', phone: guest.phone || '', tableNumber: guest.tableNumber || '', seatNumber: guest.seatNumber || '', mealChoiceId: guest.mealChoiceId || '', notes: guest.notes || '' }); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground/80 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteGuest(guest.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground font-bold uppercase tracking-widest">
                          {guests.length === 0 ? 'No guests yet — add manually or share the guest link' : 'No guests match your filters'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="menu" className="mt-4 space-y-5">
            {menuItems.length > 0 && (
              <div className="space-y-2">
                {menuItems.map(item => {
                  const selectionCount = guests.filter(g => g.mealChoiceId === item.id || Object.values(g.courseSelections || {}).includes(item.id)).length;
                  return (
                    <div key={item.id} className="bg-card rounded-2xl border-2 border-border p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-black text-foreground">{item.name}</p>
                          <Badge className="bg-muted text-muted-foreground border-border font-black text-[8px]">Course {item.courseNumber}</Badge>
                          {item.isVegan      && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black text-[8px]">Vegan</Badge>}
                          {item.isGlutenFree && <Badge className="bg-blue-50 text-blue-700 border-blue-200 font-black text-[8px]">GF</Badge>}
                        </div>
                        {item.description && <p className="text-[10px] text-muted-foreground mt-0.5">{item.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={cn('font-black text-[9px]', selectionCount > 0 ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/60 text-muted-foreground border-border')}>
                          {selectionCount} selected
                        </Badge>
                        <button onClick={() => handleDeleteMenuItem(item)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground/70 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
              <button onClick={() => setIsAddingMenu(!isAddingMenu)} className="w-full p-5 flex items-center justify-between hover:bg-muted/60 transition-colors">
                <div className="flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /><span className="font-black uppercase text-sm tracking-tight text-foreground">Add Menu Item</span></div>
                {isAddingMenu ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              <AnimatePresence>
                {isAddingMenu && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border">
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5 sm:col-span-2"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Item Name *</Label><Input value={newMenuName} onChange={e => setNewMenuName(e.target.value)} placeholder="e.g. Pan-Seared Salmon" className="h-12 rounded-xl border-2" /></div>
                        <div className="space-y-1.5 sm:col-span-2"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Description</Label><Input value={newMenuDesc} onChange={e => setNewMenuDesc(e.target.value)} placeholder="Shown to guests on order form" className="h-12 rounded-xl border-2" /></div>
                        <div className="space-y-1.5">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Course</Label>
                          <Select value={String(newMenuCourse)} onValueChange={v => setNewMenuCourse(Number(v))}>
                            <SelectTrigger className="h-12 rounded-xl border-2 font-bold uppercase text-[10px]"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="1">Starter</SelectItem><SelectItem value="2">Main</SelectItem><SelectItem value="3">Dessert</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Price per guest ($)</Label><Input type="number" min="0" step="0.01" value={newMenuPrice} onChange={e => setNewMenuPrice(parseFloat(e.target.value) || 0)} className="h-12 rounded-xl border-2 font-bold text-center" /></div>
                        <div className="flex items-center gap-4 sm:col-span-2">
                          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newMenuVegan} onChange={e => setNewMenuVegan(e.target.checked)} className="rounded" /><span className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Vegan</span></label>
                          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newMenuGF}    onChange={e => setNewMenuGF(e.target.checked)}    className="rounded" /><span className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Gluten-Free</span></label>
                        </div>
                      </div>
                      <div className="flex gap-3 pt-1">
                        <Button onClick={resetMenuForm} variant="outline" className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                        <Button onClick={handleAddMenuItem} disabled={!newMenuName.trim()} className="flex-1 h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">Add Item →</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {menuItems.length === 0 && !isAddingMenu && (
              <div className="text-center py-10 border-2 border-dashed rounded-3xl">
                <Utensils className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3" />
                <p className="font-black uppercase text-[10px] tracking-widest text-muted-foreground">No menu items yet</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="seating" className="mt-4">
            <SeatingChartTab eventId={eventId} tenantId={tenantId} firestore={firestore} guests={guests} staff={eventStaff} event={event} />
          </TabsContent>

          <TabsContent value="staff" className="mt-4 space-y-4">
            <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-foreground flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Assigned Staff
                </h2>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Assign table zones so staff know their section</p>
              </div>
              <div className="p-5 space-y-3">
                {(event?.assignedStaffIds || []).length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed rounded-2xl">
                    <p className="font-black uppercase text-[10px] tracking-widest text-muted-foreground">No staff assigned yet</p>
                  </div>
                )}
                {(event?.assignedStaffIds || []).map((staffId: string) => {
                  const member      = (staffFromContext || []).find((s: any) => s.id === staffId);
                  if (!member) return null;
                  const currentZone = event?.staffZones?.[staffId] || '';
                  return (
                    <div key={staffId} className="flex items-center justify-between gap-3 p-3 rounded-2xl border-2 border-border">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center font-black text-primary text-sm shrink-0">
                          {(member as any).name?.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-sm text-foreground">{(member as any).name}</p>
                          <p className="text-[9px] font-bold uppercase text-muted-foreground">{(member as any).role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Input
                          placeholder="Zone / tables (e.g. T1–4)"
                          defaultValue={currentZone}
                          onChange={e => setStaffZones(prev => ({ ...prev, [staffId]: e.target.value }))}
                          className="h-8 w-36 rounded-xl border-2 text-xs font-bold"
                        />
                        <button onClick={() => handleSaveStaffZone(staffId)}
                          className="h-8 w-8 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors shrink-0">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleRemoveStaff(staffId)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 space-y-2">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Add Staff Member</Label>
                  <div className="flex gap-2">
                    <Select value={staffToAdd || NO_SELECTION} onValueChange={v => setStaffToAdd(v === NO_SELECTION ? '' : v)}>
                      <SelectTrigger className="flex-1 h-11 rounded-xl border-2 font-bold text-sm"><SelectValue placeholder="Select staff member…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SELECTION}>Select staff member…</SelectItem>
                        {(staffFromContext || []).filter((s: any) => !(event?.assignedStaffIds || []).includes(s.id)).map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAddStaff} disabled={!staffToAdd || staffToAdd === NO_SELECTION}
                      className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shadow-lg shadow-primary/20">
                      <Plus className="w-4 h-4" /> Assign
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="requests" className="mt-4 space-y-4">
            <div className="bg-card rounded-2xl border-2 border-border overflow-hidden">
              <button onClick={() => { setLocalRequestTypes(requestTypes); setEditingRequestTypes(s => !s); }}
                className="w-full p-4 flex items-center justify-between hover:bg-muted/60 transition-colors">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <p className="font-black text-sm uppercase tracking-tight text-foreground">Request Menu Config</p>
                  <Badge className="bg-muted text-muted-foreground border-border font-black text-[9px]">
                    {requestTypes.filter((t: any) => t.enabled).length} active
                  </Badge>
                </div>
                {editingRequestTypes ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              <AnimatePresence>
                {editingRequestTypes && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border">
                    <div className="p-4 space-y-3">
                      <div className="space-y-2">
                        {localRequestTypes.map((type, idx) => (
                          <div key={type.id} className={cn('flex items-center gap-3 p-3 rounded-xl border-2 transition-all', type.enabled ? 'border-primary/20 bg-primary/5' : 'border-border bg-card opacity-50')}>
                            <span className="text-xl leading-none w-6 shrink-0">{type.emoji}</span>
                            <p className="flex-1 font-black text-sm text-foreground">{type.label}</p>
                            <button onClick={() => { const next = [...localRequestTypes]; next[idx] = { ...next[idx], enabled: !next[idx].enabled }; setLocalRequestTypes(next); }}
                              className={cn('w-9 h-5 rounded-full transition-all relative', type.enabled ? 'bg-primary' : 'bg-border')}>
                              <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-card shadow transition-all', type.enabled ? 'left-4' : 'left-0.5')} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3 pt-2">
                        <Button onClick={() => setEditingRequestTypes(false)} variant="outline" className="flex-1 h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">Cancel</Button>
                        <Button onClick={handleSaveRequestTypes} className="flex-1 h-10 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">Save Config</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <FloorRequestPanel
              requests={floorRequests.filter(r => r.status === 'new' || r.status === 'acknowledged')}
              onResolve={async id => {
                await updateDoc(doc(firestore, `tenants/${tenantId}/floorRequests`, id), { status: 'done', resolvedAt: new Date().toISOString(), resolvedBy: 'host' });
                toast({ title: 'Request resolved' });
              }}
              tenantId={tenantId}
            />
            {floorRequests.filter(r => r.status === 'new' || r.status === 'acknowledged').length === 0 && (
              <div className="text-center py-12 border-2 border-dashed rounded-3xl">
                <CheckCircle2 className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3" />
                <p className="font-black uppercase text-[10px] tracking-widest text-muted-foreground">No active floor requests</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <AnimatePresence>
          {showLink && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-card rounded-2xl border-2 border-primary/20 p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Guest Order Link</p>
              <div className="w-full bg-muted/60 rounded-xl px-4 py-3 border-2 border-border">
                <p className="text-xs font-bold text-foreground/80 break-all">{shareableLink}</p>
              </div>
              <Button onClick={() => { navigator.clipboard.writeText(shareableLink); toast({ title: 'Link Copied' }); }}
                className="w-full h-11 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                <Copy className="w-4 h-4" /> Copy Link
              </Button>
              <div className="space-y-3 pt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Generate Per-Seat QR Codes</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input placeholder="Tables (e.g. 1,2,3)" value={qrTables} onChange={e => setQrTables(e.target.value)} className="h-10 rounded-xl border-2 flex-1" />
                  <Input placeholder="Seats per table" value={qrSeatsPerTable} onChange={e => setQrSeatsPerTable(e.target.value)} className="h-10 rounded-xl border-2 sm:w-36" />
                  <Button onClick={handleGenerateQRs} className="h-10 px-4 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 shrink-0"><QrCode className="w-4 h-4" /> Generate</Button>
                </div>
                {qrCodes.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-64 overflow-y-auto" id="qr-print-area">
                    {qrCodes.map(qr => (
                      <div key={qr.label} className="flex flex-col items-center gap-1 p-3 border-2 rounded-xl bg-card">
                        <img src={qr.dataUrl} alt={qr.label} className="w-16 h-16" />
                        <p className="text-[8px] font-black uppercase text-foreground/80 text-center">{qr.label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>


        <AnimatePresence>
          {mealOverrideGuest && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={() => setMealOverrideGuest(null)}>
              <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-md bg-card rounded-3xl border-2 border-border shadow-2xl overflow-hidden">
                <div className="p-5 border-b border-border">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Override Meal Choice</p>
                  <p className="font-black text-lg text-foreground mt-0.5">{mealOverrideGuest.name}</p>
                  <p className="text-[10px] text-muted-foreground font-bold">Current: {mealOverrideGuest.mealChoiceName || 'No selection'}</p>
                </div>
                <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                  <button onClick={() => setMealOverrideId(NO_SELECTION)}
                    className={cn('w-full flex items-center justify-between p-3 rounded-2xl border-2 transition-all text-left', mealOverrideId === NO_SELECTION ? 'border-slate-400 bg-muted/60' : 'border-border hover:border-border')}>
                    <div><p className="font-black text-sm text-muted-foreground">No Selection / Clear</p><p className="text-[10px] text-muted-foreground">Remove guest's meal choice</p></div>
                    {mealOverrideId === NO_SELECTION && <Check className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {menuItems.map(item => (
                    <button key={item.id} onClick={() => setMealOverrideId(item.id)}
                      className={cn('w-full flex items-center justify-between p-3 rounded-2xl border-2 transition-all text-left', mealOverrideId === item.id ? 'border-primary bg-primary/5' : 'border-border hover:border-border')}>
                      <div><p className="font-black text-sm text-foreground">{item.name}</p>{item.description && <p className="text-[10px] text-muted-foreground">{item.description}</p>}</div>
                      {mealOverrideId === item.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
                <div className="p-4 flex gap-3 border-t border-border">
                  <Button variant="outline" onClick={() => { setMealOverrideGuest(null); setMealOverrideId(''); }}
                    className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                  <Button onClick={handleMealOverride} disabled={savingOverride || !mealOverrideId}
                    className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                    {savingOverride ? <Loader className="w-4 h-4 animate-spin" /> : 'Save Override →'}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

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
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠ {stats.notCheckedIn} guest{stats.notCheckedIn !== 1 ? 's' : ''} not yet checked in</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setIsConfirmActivateOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                <Button onClick={handleActivateEvent} disabled={activatingNow}
                  className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-200 gap-2">
                  {activatingNow ? <Loader className="w-4 h-4 animate-spin" /> : '🟢 Activate Event'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isEndEventOpen} onOpenChange={setIsEndEventOpen}>
          <DialogContent className="sm:max-w-md rounded-[2rem] border-4 shadow-2xl">
            <DialogHeader className="p-6 pb-0"><DialogTitle className="text-xl font-black uppercase tracking-tighter">End Event</DialogTitle></DialogHeader>
            <div className="p-6 space-y-4">
              {unfiredCourses.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">{unfiredCourses.length} Course{unfiredCourses.length !== 1 ? 's' : ''} not fired — {unfiredCourses.map(n => courseLabels[n] || `Course ${n}`).join(', ')}</p>
                </div>
              )}
              {floorRequests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <Bell className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">{floorRequests.length} unresolved floor request{floorRequests.length !== 1 ? 's' : ''}</p>
                </div>
              )}
              <div className="p-4 rounded-2xl bg-muted/60 border border-border space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Event Summary</p>
                <p className="font-black text-foreground">{eventDisplayName}</p>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{stats.checkedIn} of {stats.total} guests · {fires.filter(f => f.status === 'fired' && !f.isDelta).length} of {courseNumbers.length} courses fired</p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setIsEndEventOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest border-2">Cancel</Button>
                <Button onClick={handleConfirmEndEvent} className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-slate-800 hover:bg-slate-900 gap-2">End Event →</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Sheet open={broadcastOpen} onOpenChange={setBroadcastOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl border-t-0 pb-safe">
            <SheetHeader className="pb-4">
              <SheetTitle className="flex items-center gap-2 font-black uppercase tracking-tight">
                <Megaphone className="w-5 h-5 text-violet-600" /> Send to Floor Staff
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-4">
              <Textarea value={broadcastText} onChange={e => setBroadcastText(e.target.value)}
                placeholder="e.g. Course 2 fires in 10 minutes. Clear starter plates now."
                className="min-h-[100px] rounded-2xl border-2 text-sm font-medium resize-none" />
              <div className="flex gap-3">
                <Button onClick={() => setBroadcastOpen(false)} variant="outline" className="flex-1 h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">Cancel</Button>
                <Button onClick={handleSendBroadcast} disabled={!broadcastText.trim() || sendingBroadcast}
                  className="flex-1 h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest gap-2 bg-violet-600 hover:bg-violet-700 shadow-lg shadow-violet-200 disabled:opacity-30">
                  {sendingBroadcast ? <Loader className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send to Floor</>}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {fireConfirmCourse !== null && (
          <CourseFireConfirmDialog
            open={fireConfirmCourse !== null}
            onOpenChange={open => { if (!open) setFireConfirmCourse(null); }}
            courseNumber={fireConfirmCourse}
            courseName={courseLabels[fireConfirmCourse] || `Course ${fireConfirmCourse}`}
            guests={guests}
            menuItems={menuItems}
            isFiring={isFiring === fireConfirmCourse}
            onConfirm={() => {
              const n = fireConfirmCourse;
              setFireConfirmCourse(null);
              handleFireCourse(n);
            }}
          />
        )}

        <KitchenPrintModal
          open={printModalOpen}
          onOpenChange={setPrintModalOpen}
          event={event}
          guests={guests}
          menuItems={menuItems}
          courseNumbers={courseNumbers}
        />

      </main>
    </div>
  );
}

// Small helper used by ordering deadline banner
function isPast(date: Date) {
  return date.getTime() < Date.now();
}
