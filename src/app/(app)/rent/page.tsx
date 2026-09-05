'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CircleDollarSign,
  PlayCircle,
  Receipt,
  HandCoins,
  History,
  AlertTriangle,
  BadgeCheck,
  Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildRentSchedule, type ScheduledCharge } from '@/lib/rent-schedule';
import { buildRentInvoice, leasesToInvoice, invoiceKey } from '@/lib/rent-invoices';
import { AppHeader } from '@/components/shared/AppHeader';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { CalendarClock as CalendarClockIcon } from 'lucide-react';
import {
  Booth,
  Renter,
  Lease,
  RentLedgerEntry,
  PaymentMethodKind,
  BOOTH_RENTAL_COLLECTIONS,
  FREQUENCY_LABELS,
  LEDGER_TYPE_LABELS,
  formatCents,
  parseIsoDate,
  toIsoDate,
  computeBalanceCents,
  getPastDueEntries,
  computeLateFeeCents,
  buildRentRollSummary,
} from '@/lib/booth-rental-types';
import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';

const PAYMENT_METHODS: { value: PaymentMethodKind; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'ach', label: 'Bank transfer (ACH)' },
  { value: 'other', label: 'Other' },
];

const MAX_GENERATED_CHARGES_PER_LEASE = 26;

function toNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function enumerateDueDates(lease: Lease, todayIso: string): string[] {
  const today = parseIsoDate(todayIso);
  const last = lease.lastChargeDate ? parseIsoDate(lease.lastChargeDate) : null;
  const dates: string[] = [];
  let cursor = parseIsoDate(lease.firstChargeDate);
  let guard = 0;

  while (cursor <= today && guard < MAX_GENERATED_CHARGES_PER_LEASE) {
    if (!last || cursor <= last) {
      dates.push(toIsoDate(cursor));
    }
    if (lease.frequency === 'monthly') {
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(lease.dueDay, 28));
      cursor = next;
    } else {
      const next = new Date(cursor);
      next.setDate(next.getDate() + (lease.frequency === 'weekly' ? 7 : 14));
      cursor = next;
    }
    guard += 1;
  }
  return dates;
}

// ─── Charge settlement (display-only) ─────────────────────────────────────────
// Derives each charge's paid/partial/unpaid state by applying payments
// oldest-first. Purely for display — it writes nothing and mirrors the same
// oldest-first order handleRecordPayment uses, so it always agrees with the
// renter's computed balance.

type ChargeSettlement = {
  status: 'paid' | 'partial' | 'unpaid' | 'waived' | 'refunded';
  paidCents: number;
  remainingCents: number;
};

const SETTLEMENT_LABELS: Record<ChargeSettlement['status'], string> = {
  paid: 'Paid',
  partial: 'Partially paid',
  unpaid: 'Unpaid',
  waived: 'Waived',
  refunded: 'Refunded',
};

function settleCharges(
  entries: RentLedgerEntry[]
): Map<string, ChargeSettlement> {
  const result = new Map<string, ChargeSettlement>();

  // Credit pool = all payments (negative entries), excluding refunded ones.
  let credit = entries
    .filter((e) => e.amountCents < 0 && e.status !== 'refunded')
    .reduce((sum, e) => sum + Math.abs(e.amountCents), 0);

  // Apply credit to charges oldest-first — same order as handleRecordPayment.
  const charges = entries
    .filter((e) => e.amountCents > 0)
    .sort((a, b) =>
      (a.dueDate ?? a.createdAt).localeCompare(b.dueDate ?? b.createdAt)
    );

  for (const charge of charges) {
    if (charge.status === 'waived') {
      result.set(charge.id, {
        status: 'waived',
        paidCents: 0,
        remainingCents: 0,
      });
      continue;
    }
    if (charge.status === 'refunded') {
      result.set(charge.id, {
        status: 'refunded',
        paidCents: 0,
        remainingCents: 0,
      });
      continue;
    }
    const applied = Math.min(credit, charge.amountCents);
    credit -= applied;
    const remainingCents = charge.amountCents - applied;
    const status =
      applied === 0 ? 'unpaid' : remainingCents === 0 ? 'paid' : 'partial';
    result.set(charge.id, { status, paidCents: applied, remainingCents });
  }

  return result;
}

interface PaymentFormState {
  amountDollars: string;
  method: PaymentMethodKind;
  date: string;
  note: string;
}

interface ChargeFormState {
  description: string;
  amountDollars: string;
  dueDate: string;
}


const RENT_COMMS_DEFAULTS: any = {
  remindRenterBeforeDue: true,
  remindLeadDays: 3,
  sendReceipts: true,
  lateNoticeEmail: true,
  lateNoticeSms: true,
  ownerEmailOnFailedAutopay: true,
  swapNotifyEmail: true,
  swapNotifySms: true,
};

// Rent notifications — the per-business comms knobs the crons read
// (tenants/{t}.rentComms). Late-fee amounts and grace stay per-lease.
/**
 * What autopay is ABOUT to do. The autopay cron decides at noon UTC on the
 * lease's due day; until this card there was no way to see that coming — only
 * the receipts and declines afterwards. Same rule the cron uses (rent-schedule
 * lifts it out), so what this shows is what will happen, not an estimate.
 */
function RentScheduleCard({ rows, renterById, boothById, onEnableAutopay }: {
  rows: ScheduledCharge[];
  renterById: Map<string, any>;
  boothById: Map<string, any>;
  /** Flip autopay on for a renter who has a card but is still paying by hand. */
  onEnableAutopay?: (renterId: string) => void;
}) {
  const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = (isoDate: string) => {
    const d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return isoDate;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return days === 0 ? `Today · ${label}` : days === 1 ? `Tomorrow · ${label}` : days < 7 ? `In ${days} days · ${label}` : label;
  };
  const chip = (r: ScheduledCharge) => {
    if (r.readiness === 'ready') {
      if (r.lastAttempt && !r.lastAttempt.ok) return ['Last one declined', 'bg-red-100 text-red-800'];
      return ['Autopay ready', 'bg-emerald-100 text-emerald-800'];
    }
    if (r.readiness === 'no_card') return ['No card on file', 'bg-amber-100 text-amber-900'];
    if (r.readiness === 'manual') return ['Pays manually', 'bg-slate-100 text-slate-600'];
    return ['No schedule', 'bg-slate-100 text-slate-500'];
  };
  const upcoming = rows.slice(0, 12);
  const dueSum = rows.reduce((n, r) => n + (r.readiness === 'ready' ? r.amountCents : 0), 0);
  const trouble = rows.filter((r) => r.readiness === 'no_card' || (r.lastAttempt && !r.lastAttempt.ok)).length;

  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
          <CalendarClockIcon className="h-3.5 w-3.5" /> Scheduled
        </CardTitle>
        <p className="text-[11px] font-bold text-slate-500">
          What autopay will draft next, and whether it can.
          {rows.length > 0 && ` ${money(dueSum)} set to collect automatically`}
          {trouble > 0 && ` · ${trouble} need${trouble === 1 ? 's' : ''} attention`}.
        </p>
      </CardHeader>
      <CardContent className="p-5 pt-2 space-y-2">
        {upcoming.length === 0 ? (
          <p className="text-[11px] font-bold text-slate-500">No active leases with a due day yet.</p>
        ) : upcoming.map((r) => {
          const renter = renterById.get(r.renterId);
          const booth = boothById.get(r.boothId);
          const [label, tone] = chip(r);
          const name = renter ? `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter' : 'Renter';
          return (
            <div key={r.leaseId} className="flex items-center gap-3 rounded-2xl border-2 bg-white px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">{name}<span className="font-bold text-slate-400"> · {booth?.name || 'Space'}</span></p>
                <p className="text-[11px] font-bold text-slate-500">
                  {when(r.date)} · {money(r.amountCents)} {r.frequency}
                  {r.lastAttempt ? ` · last ${r.lastAttempt.ok ? 'paid' : `declined (${r.lastAttempt.note})`} ${r.lastAttempt.date}` : ''}
                </p>
              </div>
              {r.readiness === 'manual' && renter?.cardOnFile && onEnableAutopay ? (
                // Every existing renter starts here — autopay unset, card on
                // file. One tap moves them to "ready" without opening their
                // card; the switch there does the same thing.
                <button type="button" onClick={() => onEnableAutopay(r.renterId)}
                  className="shrink-0 rounded-full border-2 border-emerald-300 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-50">
                  Turn on autopay
                </button>
              ) : (
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', tone)}>{label}</span>
              )}
            </div>
          );
        })}
        {rows.length > 12 && <p className="text-[10px] font-bold text-slate-400">Showing the next 12 of {rows.length}.</p>}
      </CardContent>
    </Card>
  );
}

function RentCommsCard({ tenantId, firestore, tenant }: { tenantId: string; firestore: any; tenant: any }) {
  const [cfg, setCfg] = useState<any>({ ...RENT_COMMS_DEFAULTS, ...(tenant?.rentComms || {}) });
  const [saved, setSaved] = useState(false);
  const flip = (k: string) => setCfg((c: any) => ({ ...c, [k]: c[k] === false ? true : !c[k] }));
  // Prospect emails are a TOP-LEVEL tenant flag, not part of rentComms:
  // they go to people who are not customers yet, under the studio's name,
  // which is a different kind of consent than a receipt to a renter. The
  // switch lives here so it is one tap instead of a Firestore console edit,
  // but the flag stays where the kiosk already reads it.
  const [prospectOn, setProspectOn] = useState<boolean>(tenant?.prospectEmailsEnabled === true);
  const save = async () => {
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}`), {
        prospectEmailsEnabled: prospectOn === true,
        rentComms: { ...cfg, remindLeadDays: Math.min(7, Math.max(1, Number(cfg.remindLeadDays) || 3)) },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('rent notification settings save failed', e);
    }
  };
  const ProspectRow = () => (
    <button type="button" onClick={() => setProspectOn((v) => !v)} className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left">
      <span>
        <span className="block text-[12px] font-black uppercase tracking-wide text-slate-900">Tour confirmation to the prospect</span>
        <span className="block text-[11px] font-bold text-slate-500">Emails the person who booked the tour their time and what to expect. Off means nothing ever sends.</span>
      </span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${prospectOn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
        {prospectOn ? 'On' : 'Off'}
      </span>
    </button>
  );
  const Row = ({ k, label, hint }: { k: string; label: string; hint: string }) => (
    <button type="button" onClick={() => flip(k)} className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left">
      <span>
        <span className="block text-[12px] font-black uppercase tracking-wide text-slate-900">{label}</span>
        <span className="block text-[11px] font-bold text-slate-500">{hint}</span>
      </span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${cfg[k] !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
        {cfg[k] !== false ? 'On' : 'Off'}
      </span>
    </button>
  );
  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-[11px] font-black uppercase tracking-widest">Rent notifications</CardTitle>
        <p className="text-[11px] font-bold text-slate-500">Who hears what, automatically. Late-fee amounts and grace days live on each lease.</p>
      </CardHeader>
      <CardContent className="space-y-2 p-5 pt-2">
        <ProspectRow />
        <Row k="remindRenterBeforeDue" label="Remind renters before rent is due" hint="Branded email with a pay link — autopay renters are skipped" />
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 p-3">
          <span>
            <span className="block text-[12px] font-black uppercase tracking-wide text-slate-900">Reminder lead time</span>
            <span className="block text-[11px] font-bold text-slate-500">Days before the due date (1–7)</span>
          </span>
          <Input type="number" min={1} max={7} value={cfg.remindLeadDays} onChange={(e: any) => setCfg((c: any) => ({ ...c, remindLeadDays: e.target.value }))} className="w-20 text-center font-black" />
        </div>
        <Row k="sendReceipts" label="Autopay receipts" hint="Email renters a receipt each time autopay collects" />
        <Row k="lateNoticeEmail" label="Late notice — email" hint="Branded email the night rent goes late, with a pay link" />
        <Row k="lateNoticeSms" label="Late notice — text" hint="One-tap pay link by text (needs SMS configured)" />
        <Row k="ownerEmailOnFailedAutopay" label="Email me when autopay is declined" hint="Card-declined alert to your owner email" />
        <Row k="swapNotifyEmail" label="Day swaps — email" hint="Renters emailed when a swap is asked, taken, or declined" />
        <Row k="swapNotifySms" label="Day swaps — text" hint="Texts for swaps that need an answer; open offers stay email-only" />
        <Button onClick={save} className="mt-2 w-full rounded-2xl font-black uppercase tracking-widest">{saved ? 'Saved \u2713' : 'Save notification settings'}</Button>
      </CardContent>
    </Card>
  );
}




// ── Day swaps ────────────────────────────────────────────────────────────────
// Renters arrange cover between themselves; you are told, not asked. That is
// deliberate — a swap trades TIME, never money, so no rent, invoice or lease
// moves and there is nothing here for you to approve. What you DO need is to
// know who is actually in the building, which is what the list below is for.
// A permanent change of days is a lease change, and that stays your call.
function RenterSwapsCard({ tenantId, firestore, tenant }: { tenantId: string; firestore: any; tenant: any }) {
  const [saved, setSaved] = useState(false);
  const enabled = tenant?.renterSwapsEnabled !== false;

  const swapsRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/renterSwaps`) : null),
    [firestore, tenantId]
  );
  const { data: swaps } = useCollection<any>(swapsRef);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => (swaps || [])
    .filter((x: any) => (x.status === 'accepted' || x.status === 'taken')
      && typeof x.giveDate === 'string' && x.giveDate >= today)
    .sort((a: any, b: any) => String(a.giveDate).localeCompare(String(b.giveDate)))
    .slice(0, 12), [swaps, today]);
  const openCount = useMemo(() => (swaps || [])
    .filter((x: any) => x.status === 'open' && typeof x.giveDate === 'string' && x.giveDate >= today).length,
    [swaps, today]);

  const toggle = async () => {
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}`), { renterSwapsEnabled: !enabled });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('renter swap toggle failed', e);
    }
  };

  const when = (d: string) => {
    try {
      const dt = new Date(`${d}T12:00:00`);
      return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
    } catch { return d; }
  };

  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-[11px] font-black uppercase tracking-widest">Day swaps</CardTitle>
        <p className="text-[11px] font-bold text-slate-500">
          Renters cover for each other directly. Rent never moves, so there is nothing to approve — this is just who is in.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-2">
        <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left">
          <span>
            <span className="block text-[12px] font-black uppercase tracking-wide text-slate-900">Renters can swap days directly</span>
            <span className="block text-[11px] font-bold text-slate-500">Turn off in a tight space where you want every change to come through you</span>
          </span>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {saved ? 'Saved' : enabled ? 'On' : 'Off'}
          </span>
        </button>

        {openCount > 0 && (
          <p className="text-[11px] font-bold text-sky-700">
            {openCount} {openCount === 1 ? 'day is' : 'days are'} currently offered to whoever can take {openCount === 1 ? 'it' : 'them'}.
          </p>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Who is covering whom</p>
          {upcoming.length === 0 ? (
            <p className="text-[11px] font-bold text-slate-500">No swaps coming up.</p>
          ) : upcoming.map((x: any) => (
            <div key={x.id} className="rounded-2xl border-2 p-3">
              <p className="text-[12px] font-black text-slate-900">
                {x.toName || 'Someone'} covers {x.fromName || 'someone'}
              </p>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                {when(x.giveDate)} · {x.wholeDay === false ? `${x.giveStart}–${x.giveEnd}` : 'all day'}
                {x.giveBoothName ? ` · ${x.giveBoothName}` : ''}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-bold text-slate-400">
          Rent, invoices and leases are untouched by every swap above. A permanent change of days is a lease change.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Independent providers ────────────────────────────────────────────────────
// Turns a renter into a bookable provider with their OWN menu. Their services
// live in tenants/{t}/renterServices keyed by their staff record, never mixed
// into the house menu, and every one of them is marked collectsOwnPayment so
// the booking engine takes no money for them (see resolveBookingPlan).
function RenterProvidersCard({ tenantId, firestore, renters, staff, allAppointments }: { tenantId: string; firestore: any; renters: any[]; staff: any[]; allAppointments: any[] }) {
  const [openId, setOpenId] = useState<string>('');
  const [copied, setCopied] = useState('');
  const [draft, setDraft] = useState<{ name: string; price: string; duration: string }>({ name: '', price: '', duration: '60' });

  const menuRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/renterServices`) : null),
    [firestore, tenantId]
  );
  const { data: renterServices } = useCollection<any>(menuRef);

  const staffForRenter = (renterId: string) => (staff || []).find((m: any) => m.isRenter && m.renterId === renterId);
  const rName = (r: any) => `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Renter';

  const enableProvider = async (r: any) => {
    const existing = staffForRenter(r.id);
    const staffId = existing?.id || nanoid();
    await setDoc(doc(firestore, `tenants/${tenantId}/staff/${staffId}`), {
      id: staffId,
      tenantId,
      name: rName(r),
      email: r.email || '',
      phone: r.phone || '',
      role: 'staff',
      isRenter: true,
      renterId: r.id,
      payStructure: 'none',
      isActive: true,
      active: false,
      onBreak: false,
      status: 'idle',
      avatarUrl: '',
    }, { merge: true });
    setOpenId(r.id);
  };

  const disableProvider = async (r: any) => {
    const st = staffForRenter(r.id);
    if (!st) return;
    await updateDoc(doc(firestore, `tenants/${tenantId}/staff/${st.id}`), { isActive: false });
  };

  const addService = async (r: any) => {
    const st = staffForRenter(r.id);
    if (!st) return;
    const name = draft.name.trim();
    const price = Number(draft.price);
    const duration = Math.max(5, Number(draft.duration) || 60);
    if (!name || !(price >= 0)) return;
    const id = nanoid();
    await setDoc(doc(firestore, `tenants/${tenantId}/renterServices/${id}`), {
      id, tenantId, staffId: st.id, renterId: r.id,
      name, price, duration,
      isActive: true,
      collectsOwnPayment: true,
      createdAt: new Date().toISOString(),
    });
    setDraft({ name: '', price: '', duration: '60' });
  };

  const removeService = async (svcId: string) => {
    await updateDoc(doc(firestore, `tenants/${tenantId}/renterServices/${svcId}`), { isActive: false });
  };

  const linkFor = (r: any) => {
    const st = staffForRenter(r.id);
    if (!st) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/book/${tenantId}?provider=${st.id}`;
  };

  const list = (renters || []).filter((r: any) => !r.archived);
  if (list.length === 0) return null;

  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-[11px] font-black uppercase tracking-widest">Independent providers</CardTitle>
        <p className="text-[11px] font-bold text-slate-500">Let a renter take bookings on your booking page with their own menu and prices. They collect payment directly — nothing runs through your Stripe.</p>
      </CardHeader>
      <CardContent className="space-y-2 p-5 pt-2">
        {list.map((r: any) => {
          const st = staffForRenter(r.id);
          const on = !!st && st.isActive !== false;
          const mine = ((renterServices || []) as any[]).filter((sv: any) => sv.staffId === st?.id && sv.isActive !== false);
          const open = openId === r.id;
          return (
            <div key={r.id} className="rounded-2xl border-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setOpenId(open ? '' : r.id)} className="flex-1 text-left">
                  <span className="block text-[12px] font-black uppercase tracking-wide text-slate-900">{rName(r)}</span>
                  <span className="block text-[11px] font-bold text-slate-500">{on ? `${mine.length} service${mine.length === 1 ? '' : 's'} on their menu` : 'Not taking bookings here'}</span>
                </button>
                <Button size="sm" variant={on ? 'ghost' : 'default'} className="shrink-0 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        onClick={() => (on ? disableProvider(r) : enableProvider(r))}>
                  {on ? 'Turn off' : 'Enable'}
                </Button>
              </div>

              {open && on && (
                <div className="mt-3 space-y-2 border-t-2 pt-3">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chair activity (last 30 days)</p>
                    <p className="text-[13px] font-bold text-slate-700">
                      {(() => {
                        const since = new Date(Date.now() - 30 * 86400000).toISOString();
                        const rows = ((allAppointments || []) as any[]).filter((a: any) => a.isRenterBooking && a.staffId === st?.id && a.startTime >= since && a.status !== 'cancelled');
                        const upcoming = rows.filter((a: any) => a.startTime >= new Date().toISOString()).length;
                        return `${rows.length} booking${rows.length === 1 ? '' : 's'} · ${upcoming} upcoming`;
                      })()}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      Volume only — their earnings are their own books.
                      {Number(r.sharedTargetHourlyCents) > 0
                        ? ` They've chosen to share an hourly target of $${(Number(r.sharedTargetHourlyCents) / 100).toFixed(2)}.`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={linkFor(r)} className="text-[11px] font-bold" />
                    <Button size="sm" variant="outline" className="shrink-0 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            onClick={() => { navigator.clipboard?.writeText(linkFor(r)); setCopied(r.id); setTimeout(() => setCopied(''), 2000); }}>
                      {copied === r.id ? 'Copied ✓' : 'Copy link'}
                    </Button>
                  </div>
                  {mine.map((sv: any) => (
                    <div key={sv.id} className="flex items-center justify-between gap-3 rounded-xl border-2 p-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-black text-slate-900">{sv.name}</span>
                        <span className="block text-[11px] font-bold text-slate-500">${Number(sv.price || 0).toFixed(2)} · {sv.duration} min</span>
                      </span>
                      <Button size="sm" variant="ghost" className="shrink-0 text-[10px] font-black uppercase tracking-widest" onClick={() => removeService(sv.id)}>Remove</Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <Input placeholder="Service name" value={draft.name} onChange={(e: any) => setDraft(d => ({ ...d, name: e.target.value }))} className="min-w-[8rem] flex-1 text-[12px] font-bold" />
                    <Input type="number" min={0} placeholder="$" value={draft.price} onChange={(e: any) => setDraft(d => ({ ...d, price: e.target.value }))} className="w-20 text-center text-[12px] font-bold" />
                    <Input type="number" min={5} step={5} value={draft.duration} onChange={(e: any) => setDraft(d => ({ ...d, duration: e.target.value }))} className="w-20 text-center text-[12px] font-bold" />
                    <Button size="sm" className="rounded-xl text-[10px] font-black uppercase tracking-widest" onClick={() => addService(r)}>Add</Button>
                  </div>
                  <p className="text-[11px] font-bold text-slate-500">Clients booking these see “you’ll pay {rName(r)} directly at your visit.” Their own hours and self-serve menu editing come next.</p>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function RentRollPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;

  const rentersRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId))
        : null,
    [firestore, tenantId]
  );
  const boothsRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId))
        : null,
    [firestore, tenantId]
  );
  const leasesRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId))
        : null,
    [firestore, tenantId]
  );
  const ledgerRef = useMemoFirebase(
    () =>
      firestore && tenantId
        ? collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))
        : null,
    [firestore, tenantId]
  );

  const { data: renters } = useCollection<Renter>(rentersRef);
  const staffRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null),
    [firestore, tenantId]
  );
  const { data: allStaff } = useCollection<any>(staffRef);
  const apptsRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/appointments`) : null),
    [firestore, tenantId]
  );
  const { data: allAppointments } = useCollection<any>(apptsRef);
  const { data: booths } = useCollection<Booth>(boothsRef);
  const { data: leases } = useCollection<Lease>(leasesRef);
  const { data: ledger, isLoading: ledgerLoading } =
    useCollection<RentLedgerEntry>(ledgerRef);

  const [paymentRenter, setPaymentRenter] = useState<Renter | null>(null);
  const [chargeRenter, setChargeRenter] = useState<Renter | null>(null);
  const [historyRenter, setHistoryRenter] = useState<Renter | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({
    amountDollars: '',
    method: 'venmo',
    date: toIsoDate(new Date()),
    note: '',
  });
  const [chargeForm, setChargeForm] = useState<ChargeFormState>({
    description: '',
    amountDollars: '',
    dueDate: toIsoDate(new Date()),
  });
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cycleResult, setCycleResult] = useState<string | null>(null);

  const todayIso = toIsoDate(new Date());
  const cycleStartIso = useMemo(() => {
    const now = new Date();
    return toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const activeLeases = useMemo(
    () => (leases ?? []).filter((l) => l.status === 'active'),
    [leases]
  );

  const scheduleRenterById = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of (renters ?? []) as any[]) m.set(r.id, r);
    return m;
  }, [renters]);
  const scheduleBoothById = useMemo(() => {
    const m = new Map<string, any>();
    for (const b of (booths ?? []) as any[]) m.set(b.id, b);
    return m;
  }, [booths]);
  // Invoices — what is owed. The late sweep, the reminder, the planner and
  // the portal already read this collection; the page now does too, so every
  // screen agrees on who is behind.
  const invoicesRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'rentInvoices') : null),
    [firestore, tenantId]);
  const { data: invoices } = useCollection<any>(invoicesRef);
  const openInvoices = useMemo(() => ((invoices ?? []) as any[])
    .filter((i) => i.status === 'due' || i.status === 'late')
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))), [invoices]);
  const owedByRenter = useMemo(() => {
    const m = new Map<string, { renterId: string; renterName: string; boothName: string; dueCents: number; lateCents: number; feeCents: number; oldest: string; count: number; late: boolean }>();
    for (const i of openInvoices) {
      const cur = m.get(i.renterId) || { renterId: i.renterId, renterName: i.renterName || 'Renter', boothName: i.boothName || '', dueCents: 0, lateCents: 0, feeCents: 0, oldest: i.dueDate, count: 0, late: false };
      const amt = Math.max(0, (Number(i.amountCents) || 0) - (Number(i.paidCents) || 0));
      if (i.status === 'late') { cur.lateCents += amt; cur.late = true; } else cur.dueCents += amt;
      cur.feeCents += Number(i.lateFeeCents) || 0;
      cur.count += 1;
      if (String(i.dueDate) < cur.oldest) cur.oldest = i.dueDate;
      m.set(i.renterId, cur);
    }
    return Array.from(m.values()).sort((a, b) => (b.late === a.late ? a.oldest.localeCompare(b.oldest) : b.late ? 1 : -1));
  }, [openInvoices]);
  const owedTotal = owedByRenter.reduce((n, r) => n + r.dueCents + r.lateCents + r.feeCents, 0);

  // Unpaid ledger charges with no invoice — the old cycle's leftovers.
  const uninvoicedCharges = useMemo(() => {
    const invoiced = new Set(((invoices ?? []) as any[]).map((i) => String(i.ledgerEntryId || '')).filter(Boolean));
    const byKey = new Set(((invoices ?? []) as any[]).map((i) => `${i.leaseId}|${i.dueDate}`));
    return ((ledger ?? []) as any[]).filter((e) =>
      e.type === 'rent_charge'
      && (Number(e.amountCents) || 0) > 0
      && !['paid', 'waived', 'refunded'].includes(String(e.status))
      && !invoiced.has(e.id)
      && !byKey.has(`${e.leaseId}|${e.dueDate}`));
  }, [ledger, invoices]);

  const [importing, setImporting] = useState(false);
  const importCharges = async () => {
    if (!firestore || !tenantId || uninvoicedCharges.length === 0) return;
    setImporting(true);
    try {
      const batch = writeBatch(firestore);
      const nowIso = new Date().toISOString();
      for (const e of uninvoicedCharges) {
        const lease = (leases ?? []).find((l) => l.id === e.leaseId);
        const renter = scheduleRenterById.get(e.renterId);
        const booth = scheduleBoothById.get(e.boothId || lease?.boothId || '');
        const grace = Number(lease?.lateFeePolicy?.graceDays ?? 0);
        const due = String(e.dueDate || '').slice(0, 10);
        const graceEnd = new Date(due + 'T00:00:00'); graceEnd.setDate(graceEnd.getDate() + grace);
        const isLate = !!due && graceEnd.getTime() < new Date(todayIso + 'T00:00:00').getTime();
        const ref = doc(collection(firestore, 'tenants', tenantId, 'rentInvoices'));
        batch.set(ref, {
          id: ref.id, leaseId: e.leaseId || '', renterId: e.renterId, boothId: e.boothId || lease?.boothId || '',
          renterName: renter ? `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || 'Renter' : 'Renter',
          boothName: booth?.name || 'Space',
          amountCents: Number(e.amountCents) || 0, lateFeeCents: 0,
          status: isLate ? 'late' : 'due', dueDate: due || todayIso, paidAt: null,
          ledgerEntryId: e.id, dueSoonNotifiedAt: null,
          source: 'imported', createdAt: nowIso, updatedAt: nowIso,
        });
      }
      await batch.commit();
      setCycleResult(`Brought ${uninvoicedCharges.length} open charge${uninvoicedCharges.length === 1 ? '' : 's'} into invoices.`);
    } catch {
      setCycleResult('Could not import those charges \u2014 try again.');
    }
    setImporting(false);
  };

  const rentSchedule = useMemo(
    () => buildRentSchedule((leases ?? []) as any[], scheduleRenterById, (ledger ?? []) as any[], todayIso),
    [leases, scheduleRenterById, ledger, todayIso]);

  const leaseByRenter = useMemo(() => {
    const map = new Map<string, Lease>();
    activeLeases.forEach((l) => map.set(l.renterId, l));
    return map;
  }, [activeLeases]);

  const boothById = useMemo(() => {
    const map = new Map<string, Booth>();
    (booths ?? []).forEach((b) => map.set(b.id, b));
    return map;
  }, [booths]);

  const ledgerByRenter = useMemo(() => {
    const map = new Map<string, RentLedgerEntry[]>();
    (ledger ?? []).forEach((entry) => {
      const list = map.get(entry.renterId) ?? [];
      list.push(entry);
      map.set(entry.renterId, list);
    });
    map.forEach((list) =>
      list.sort((a, b) =>
        (b.dueDate ?? b.createdAt).localeCompare(a.dueDate ?? a.createdAt)
      )
    );
    return map;
  }, [ledger]);

  const summary = useMemo(
    () =>
      buildRentRollSummary({
        booths: booths ?? [],
        renters: renters ?? [],
        leases: leases ?? [],
        ledger: ledger ?? [],
        todayIso,
        cycleStartIso,
      }),
    [booths, renters, leases, ledger, todayIso, cycleStartIso]
  );

  const rosterRenters = useMemo(() => {
    const list = (renters ?? []).filter(
      (r) => r.status === 'active' || (ledgerByRenter.get(r.id)?.length ?? 0) > 0
    );
    list.sort((a, b) => {
      const aPastDue = summary.pastDueRenterIds.includes(a.id) ? 0 : 1;
      const bPastDue = summary.pastDueRenterIds.includes(b.id) ? 0 : 1;
      return aPastDue - bPastDue || a.lastName.localeCompare(b.lastName);
    });
    return list;
  }, [renters, ledgerByRenter, summary.pastDueRenterIds]);

  // Current = has an active lease (or is marked active). Former = no longer
  // renting but still on the books. A former renter who owes nothing simply
  // drops off; one who owes stays until it is collected, written off, or
  // deliberately barred — and looks different from a current renter so the
  // two are never read as the same situation.
  const currentRenters = useMemo(() => rosterRenters.filter((r) => r.status === 'active' || leaseByRenter.has(r.id)), [rosterRenters, leaseByRenter]);
  const formerOwing = useMemo(() => rosterRenters.filter((r) => {
    if (r.status === 'active' || leaseByRenter.has(r.id)) return false;
    const bal = computeBalanceCents(ledgerByRenter.get(r.id) ?? []);
    return bal > 0 || (r as any).doNotRent === true;
  }), [rosterRenters, leaseByRenter, ledgerByRenter]);
  const [formerBusy, setFormerBusy] = useState<string>('');
  const [armed, setArmed] = useState<string>('');
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(''), 5000); return () => clearTimeout(t); }, [armed]);
  const arm = (key: string, run: () => void) => { if (armed === key) { setArmed(''); run(); } else setArmed(key); };

  // Bar / unbar. The flag is enforced at the public booking route and shown
  // in the pipeline and on their guest-book row — a wall, not a note.
  const setDoNotRent = async (r: any, on: boolean) => {
    if (!firestore || !tenantId) return;
    setFormerBusy(r.id);
    try {
      await setDoc(doc(firestore, 'tenants', tenantId, 'renters', r.id), {
        doNotRent: on, doNotRentAt: on ? new Date().toISOString() : null,
        doNotRentReason: on ? 'Unpaid balance' : null,
      }, { merge: true });
      setCycleResult(on ? `${r.firstName} ${r.lastName} can no longer book or apply until this is cleared.` : `${r.firstName} ${r.lastName} can book again.`);
    } catch { setCycleResult('Could not save that \u2014 try again.'); }
    setFormerBusy('');
  };

  // Write off. The balance becomes a ledger line of its own (so the money is
  // never quietly forgotten), every open invoice is voided, and the renter
  // drops out of Owed. Barring is a separate decision — a write-off is not
  // forgiveness, and forgiveness is not a write-off.
  const writeOff = async (r: any) => {
    if (!firestore || !tenantId) return;
    const bal = computeBalanceCents(ledgerByRenter.get(r.id) ?? []);
    if (bal <= 0) return;
    setFormerBusy(r.id);
    try {
      const nowIso = new Date().toISOString();
      const batch = writeBatch(firestore);
      const wRef = doc(collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId)));
      batch.set(wRef, {
        leaseId: leaseByRenter.get(r.id)?.id ?? '', renterId: r.id, boothId: null,
        type: 'payment', status: 'waived', amountCents: -bal,
        description: 'Balance written off', dueDate: null, paidAt: todayIso, method: 'write_off',
        stripePaymentIntentId: null, appliesToEntryIds: [], createdBy: 'owner',
        note: 'Written off as uncollectable', createdAt: nowIso, updatedAt: nowIso,
      });
      for (const e of (ledgerByRenter.get(r.id) ?? [])) {
        if (e.type === 'rent_charge' && !['paid', 'waived', 'refunded'].includes(String(e.status))) {
          batch.update(doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), e.id), { status: 'waived', updatedAt: nowIso });
        }
      }
      for (const i of ((invoices ?? []) as any[]).filter((i) => i.renterId === r.id && (i.status === 'due' || i.status === 'late'))) {
        batch.update(doc(firestore, 'tenants', tenantId, 'rentInvoices', i.id), { status: 'void', voidedAt: nowIso, voidReason: 'written_off', updatedAt: nowIso });
      }
      await batch.commit();
      setCycleResult(`Wrote off ${formatCents(bal)} for ${r.firstName} ${r.lastName}.`);
    } catch { setCycleResult('Could not write that off \u2014 try again.'); }
    setFormerBusy('');
  };

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading your studio…
      </div>
    );
  }

  // Invoice today's rent on demand. The nightly job does this at 7am; this
  // is for the day you change a lease and don't want to wait. Same rule, same
  // document, so nothing can be invoiced twice.
  const invoiceToday = async () => {
    if (!firestore || !tenantId) return;
    setRunning(true);
    setCycleResult(null);
    try {
      const existing = new Set(((invoices ?? []) as any[]).map((i) => invoiceKey(String(i.leaseId || ''), String(i.dueDate || ''))));
      const due = leasesToInvoice((leases ?? []) as any[], todayIso, existing);
      if (due.length === 0) { setCycleResult('Nothing is due today that isn\u2019t already invoiced.'); setRunning(false); return; }
      const batch = writeBatch(firestore);
      const nowIso = new Date().toISOString();
      for (const lease of due) {
        const ref = doc(collection(firestore, 'tenants', tenantId, 'rentInvoices'));
        batch.set(ref, buildRentInvoice({
          id: ref.id, lease, renter: scheduleRenterById.get(lease.renterId), booth: scheduleBoothById.get(lease.boothId),
          dueDate: todayIso, source: 'manual', nowIso,
        }));
      }
      await batch.commit();
      setCycleResult(`Invoiced ${due.length} renter${due.length === 1 ? '' : 's'} for today.`);
    } catch {
      setCycleResult('Could not invoice today \u2014 try again.');
    }
    setRunning(false);
  };

  const runRentCycle = async () => {
    if (!firestore) return;
    setRunning(true);
    setCycleResult(null);
    try {
      const batch = writeBatch(firestore);
      const ledgerCollection = collection(
        firestore,
        BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId)
      );
      const now = new Date().toISOString();
      let chargesCreated = 0;
      let lateFeesCreated = 0;

      for (const lease of activeLeases) {
        const entries = (ledger ?? []).filter((e) => e.leaseId === lease.id);
        const existingChargeDates = new Set(
          entries
            .filter((e) => e.type === 'rent_charge')
            .map((e) => e.dueDate ?? '')
        );

        const dueDates = enumerateDueDates(lease, todayIso);
        for (const dueDate of dueDates) {
          if (existingChargeDates.has(dueDate)) continue;
          const newRef = doc(ledgerCollection);
          batch.set(newRef, {
            leaseId: lease.id,
            renterId: lease.renterId,
            boothId: lease.boothId,
            type: 'rent_charge',
            status: 'pending',
            amountCents: lease.rentAmountCents,
            description: `Rent — due ${dueDate}`,
            dueDate,
            paidAt: null,
            method: null,
            stripePaymentIntentId: null,
            appliesToEntryIds: [],
            createdBy: 'system',
            createdAt: now,
            updatedAt: now,
          });
          chargesCreated += 1;
        }

        const grace = lease.lateFeePolicy?.graceDays ?? 0;
        const pastDueCharges = getPastDueEntries(
          entries.filter((e) => e.type === 'rent_charge'),
          grace,
          todayIso
        );
        const existingFeeTargets = new Set(
          entries
            .filter((e) => e.type === 'late_fee')
            .flatMap((e) => e.appliesToEntryIds ?? [])
        );
        for (const charge of pastDueCharges) {
          if (existingFeeTargets.has(charge.id)) continue;
          const feeCents = computeLateFeeCents(
            lease.lateFeePolicy,
            charge.amountCents
          );
          if (feeCents <= 0) continue;
          const feeRef = doc(ledgerCollection);
          batch.set(feeRef, {
            leaseId: lease.id,
            renterId: lease.renterId,
            boothId: lease.boothId,
            type: 'late_fee',
            status: 'pending',
            amountCents: feeCents,
            description: `Late fee — rent due ${charge.dueDate}`,
            dueDate: todayIso,
            paidAt: null,
            method: null,
            stripePaymentIntentId: null,
            appliesToEntryIds: [charge.id],
            createdBy: 'system',
            createdAt: now,
            updatedAt: now,
          });
          lateFeesCreated += 1;
        }
      }

      if (chargesCreated > 0 || lateFeesCreated > 0) {
        await batch.commit();
        setCycleResult(
          `Created ${chargesCreated} rent charge${chargesCreated === 1 ? '' : 's'} and ${lateFeesCreated} late fee${lateFeesCreated === 1 ? '' : 's'}.`
        );
      } else {
        setCycleResult('Everything is up to date — no new charges due.');
      }
    } finally {
      setRunning(false);
    }
  };

  const openPaymentDialog = (renter: Renter) => {
    const entries = ledgerByRenter.get(renter.id) ?? [];
    const balance = computeBalanceCents(entries);
    setPaymentForm({
      amountDollars: balance > 0 ? (balance / 100).toString() : '',
      method: 'venmo',
      date: todayIso,
      note: '',
    });
    setPaymentRenter(renter);
  };

  const handleRecordPayment = async () => {
    if (!firestore || !paymentRenter) return;
    const amountCents = Math.round(toNumber(paymentForm.amountDollars) * 100);
    if (amountCents <= 0) return;
    setSaving(true);
    try {
      const lease = leaseByRenter.get(paymentRenter.id);
      const booth = lease ? boothById.get(lease.boothId) : undefined;
      const now = new Date().toISOString();
      const entries = ledgerByRenter.get(paymentRenter.id) ?? [];

      const unpaidCharges = entries
        .filter(
          (e) =>
            e.amountCents > 0 &&
            e.status !== 'paid' &&
            e.status !== 'waived' &&
            e.status !== 'refunded'
        )
        .sort((a, b) =>
          (a.dueDate ?? a.createdAt).localeCompare(b.dueDate ?? b.createdAt)
        );

      let remaining = amountCents;
      const settledIds: string[] = [];
      for (const charge of unpaidCharges) {
        if (remaining < charge.amountCents) break;
        remaining -= charge.amountCents;
        settledIds.push(charge.id);
      }

      const methodLabel =
        PAYMENT_METHODS.find((m) => m.value === paymentForm.method)?.label ??
        paymentForm.method;
      const renterName = `${paymentRenter.firstName} ${paymentRenter.lastName}`;

      const batch = writeBatch(firestore);

      // Refs first so each record can cross-reference the other.
      const paymentRef = doc(
        collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))
      );
      const txnRef = doc(
        collection(firestore, 'tenants', tenantId, 'transactions'),
        ledgerEntryId('booth_rent', paymentRef.id)
      );

      // 1. Rent subledger payment (negative cents = credit)
      batch.set(paymentRef, {
        leaseId: lease?.id ?? '',
        renterId: paymentRenter.id,
        boothId: lease?.boothId ?? null,
        type: 'payment',
        status: 'paid',
        amountCents: -amountCents,
        description: `Payment — ${methodLabel}`,
        dueDate: null,
        paidAt: paymentForm.date,
        method: paymentForm.method,
        stripePaymentIntentId: null,
        appliesToEntryIds: settledIds,
        createdBy: 'owner',
        note: paymentForm.note.trim(),
        transactionId: txnRef.id,
        createdAt: now,
        updatedAt: now,
      });

      // 2. General-ledger income line — routed through the canonical funnel.
      const entry = buildLedgerEntry({
        source: 'booth_rent',
        sourceId: paymentRef.id,
        amountCents,
        category: 'Booth Rent',
        description: `Booth rent — ${booth ? booth.name : 'booth'} — ${renterName}`,
        clientOrVendor: renterName,
        date: paymentForm.date,
        paymentMethod: methodLabel,
      });
      batch.set(txnRef, { ...entry, id: txnRef.id });

      // 3. Mark settled charges paid
      for (const chargeId of settledIds) {
        batch.update(
          doc(
            firestore,
            BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId),
            chargeId
          ),
          { status: 'paid', paidAt: paymentForm.date, updatedAt: now }
        );
      }

      // 4. Settle the renter's open invoices, oldest first, with the same
      //    money. Invoices are what the Owed card, the late sweep, the
      //    reminder and the portal read — a cash payment that only touched the
      //    ledger left all four still saying "owes". Whole invoices only; a
      //    part-payment leaves the invoice open with the remainder recorded on
      //    it so nobody is chased for money they've handed over.
      let invoiceRemaining = amountCents;
      const openForRenter = ((invoices ?? []) as any[])
        .filter((i) => i.renterId === paymentRenter.id && (i.status === 'due' || i.status === 'late'))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      for (const inv of openForRenter) {
        const owed = (Number(inv.amountCents) || 0) + (Number(inv.lateFeeCents) || 0) - (Number(inv.paidCents) || 0);
        if (owed <= 0) continue;
        const ref = doc(firestore, 'tenants', tenantId, 'rentInvoices', inv.id);
        if (invoiceRemaining >= owed) {
          invoiceRemaining -= owed;
          batch.update(ref, {
            status: 'paid', paidAt: paymentForm.date, paidVia: paymentForm.method,
            paidCents: (Number(inv.paidCents) || 0) + owed, ledgerEntryId: paymentRef.id, updatedAt: now,
          });
        } else if (invoiceRemaining > 0) {
          batch.update(ref, {
            paidCents: (Number(inv.paidCents) || 0) + invoiceRemaining, ledgerEntryId: paymentRef.id, updatedAt: now,
          });
          invoiceRemaining = 0;
        }
        if (invoiceRemaining === 0) break;
      }

      await batch.commit();
      setPaymentRenter(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCharge = async () => {
    if (!firestore || !chargeRenter) return;
    const amountCents = Math.round(toNumber(chargeForm.amountDollars) * 100);
    if (amountCents <= 0 || !chargeForm.description.trim()) return;
    setSaving(true);
    try {
      const lease = leaseByRenter.get(chargeRenter.id);
      const now = new Date().toISOString();
      await addDoc(
        collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId)),
        {
          leaseId: lease?.id ?? '',
          renterId: chargeRenter.id,
          boothId: lease?.boothId ?? null,
          type: 'one_off_charge',
          status: 'pending',
          amountCents,
          description: chargeForm.description.trim(),
          dueDate: chargeForm.dueDate,
          paidAt: null,
          method: null,
          stripePaymentIntentId: null,
          appliesToEntryIds: [],
          createdBy: 'owner',
          createdAt: now,
          updatedAt: now,
        }
      );
      setChargeRenter(null);
      setChargeForm({
        description: '',
        amountDollars: '',
        dueDate: todayIso,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleWaive = async (entry: RentLedgerEntry) => {
    if (!firestore) return;
    await updateDoc(
      doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), entry.id),
      { status: 'waived', updatedAt: new Date().toISOString() }
    );
  };

  const historyEntries = historyRenter
    ? ledgerByRenter.get(historyRenter.id) ?? []
    : [];
  const chargeSettlements = settleCharges(historyEntries);

  const kpis: [string, string, string][] = [
    ['Owed right now', formatCents(owedTotal), owedByRenter.length ? `${owedByRenter.length} renter${owedByRenter.length === 1 ? '' : 's'}` : 'everyone is current'],
    ['Late', String(owedByRenter.filter((r) => r.late).length), 'past grace'],
    ['Collected this month', formatCents(summary.collectedThisCycleCents), 'into the ledger'],
    ['Drafting next', formatCents(rentSchedule.reduce((n, r) => n + (r.readiness === 'ready' ? r.amountCents : 0), 0)), 'on autopay'],
  ];

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Rent" />
      <div className="flex-1 w-full max-w-[1100px] mx-auto min-w-0 p-4 sm:p-6 md:p-8 space-y-6"
        style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground opacity-60">Booth rental</p>
          <h1 className="flex items-center gap-2.5 text-3xl md:text-4xl font-black uppercase tracking-tighter leading-none">
            <span className="grid h-9 w-9 place-items-center rounded-2xl border-2 border-primary/15 bg-primary/5 shrink-0">
              <CircleDollarSign className="h-4 w-4 text-primary" />
            </span>
            Rent
          </h1>
          <p className="text-xs font-bold text-muted-foreground max-w-prose">
            Invoices raise themselves on each due day. Who is behind, what is about to draft, and what has moved.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <LocationSwitcher />
          <Button variant="outline" onClick={invoiceToday} disabled={running}
            className="h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
            <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
            {running ? 'Working…' : 'Invoice today'}
          </Button>
        </div>
      </header>

      {cycleResult && (
        <p className="text-[11px] font-bold text-muted-foreground">{cycleResult}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {kpis.map(([label, value, sub]) => (
          <div key={label} className="rounded-2xl border-2 bg-white p-3.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-black tabular-nums leading-none">{value}</p>
            <p className="mt-1 text-[10px] font-bold text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {/* Owed — from invoices, the collection every automation reads */}
      <Card className="rounded-[2rem] border-2">
        <CardHeader className="p-5 pb-2">
          <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
            <AlertTriangle className="h-3.5 w-3.5" /> Owed
          </CardTitle>
          <p className="text-[11px] font-bold text-slate-500">
            Open invoices, oldest first. Late ones have passed their grace days and carry any fee the lease sets.
          </p>
        </CardHeader>
        <CardContent className="p-5 pt-2 space-y-2">
          {uninvoicedCharges.length > 0 && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black text-amber-900">
                  {uninvoicedCharges.length} unpaid charge{uninvoicedCharges.length === 1 ? '' : 's'} from the old rent cycle {uninvoicedCharges.length === 1 ? 'is' : 'are'} not invoiced yet.
                </p>
                <p className="text-[10px] font-bold text-amber-800">
                  Bring them in and the late sweep, the reminders and the renter portal will see them too.
                </p>
              </div>
              <Button size="sm" onClick={importCharges} disabled={importing}
                className="h-10 shrink-0 rounded-xl bg-amber-700 hover:bg-amber-800 font-black uppercase text-[9px] tracking-widest">
                {importing ? 'Working…' : 'Bring them in'}
              </Button>
            </div>
          )}
          {owedByRenter.length === 0 ? (
            <p className="text-[11px] font-bold text-slate-500">Nothing outstanding. Invoices appear here on each lease's due day.</p>
          ) : owedByRenter.map((r) => (
            <div key={r.renterId} className={cn('flex items-center gap-3 rounded-2xl border-2 px-3.5 py-2.5', r.late ? 'border-red-200 bg-red-50/60' : 'bg-white')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">{r.renterName}<span className="font-bold text-slate-400"> · {r.boothName}</span></p>
                <p className="text-[11px] font-bold text-slate-500">
                  {r.count} invoice{r.count === 1 ? '' : 's'} · oldest due {r.oldest}
                  {r.feeCents > 0 ? ` · ${formatCents(r.feeCents)} in late fees` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={cn('text-base font-black tabular-nums', r.late ? 'text-red-700' : 'text-slate-900')}>{formatCents(r.dueCents + r.lateCents + r.feeCents)}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{r.late ? 'Late' : 'Due'}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {ledgerLoading && (
        <p className="text-sm text-muted-foreground">Loading the ledger…</p>
      )}

      {!ledgerLoading && rosterRenters.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Receipt className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">No rent activity yet</p>
            <p className="text-sm text-muted-foreground">
              Set up a lease on the Renters page, then run the rent cycle to
              generate the first charges.
            </p>
          </CardContent>
        </Card>
      )}

      {formerOwing.length > 0 && (
        <Card className="rounded-[2rem] border-2 border-slate-300">
          <CardHeader className="p-5 pb-2">
            <CardTitle className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
              <AlertTriangle className="h-3.5 w-3.5" /> Former renters who still owe
            </CardTitle>
            <p className="text-[11px] font-bold text-slate-500">
              No lease, nothing more coming due. Collect it, write it off, or bar them from booking until it is cleared.
            </p>
          </CardHeader>
          <CardContent className="p-5 pt-2 space-y-2">
            {formerOwing.map((r) => {
              const bal = computeBalanceCents(ledgerByRenter.get(r.id) ?? []);
              const barred = (r as any).doNotRent === true;
              const busy = formerBusy === r.id;
              return (
                <div key={r.id} className={cn('rounded-2xl border-2 px-4 py-3 space-y-2.5', barred ? 'border-slate-900 bg-slate-50' : 'bg-white')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-sm truncate">{r.firstName} {r.lastName}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">
                        Former renter{(r as any).leaseEndedAt ? ` · left ${String((r as any).leaseEndedAt).slice(0, 10)}` : ''}
                        {barred ? ' · barred from booking' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Owes</p>
                      <p className="text-xl font-black tabular-nums leading-none text-red-700">{formatCents(Math.max(bal, 0))}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => openPaymentDialog(r)} disabled={bal <= 0 || busy}
                      className="h-11 flex-1 min-w-[9rem] rounded-xl font-black uppercase text-[10px] tracking-widest">
                      <HandCoins className="h-3.5 w-3.5 mr-1.5" /> Record payment
                    </Button>
                    <Button variant="outline" onClick={() => setDoNotRent(r, !barred)} disabled={busy}
                      className={cn('h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest', barred ? 'bg-slate-900 text-white border-slate-900' : '')}>
                      {barred ? 'Allow booking' : 'Bar from booking'}
                    </Button>
                    {bal > 0 && (
                      <Button variant="outline" onClick={() => arm(`${r.id}:writeoff`, () => writeOff(r))} disabled={busy}
                        className={cn('h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest',
                          armed === `${r.id}:writeoff` ? 'bg-red-600 border-red-600 text-white' : 'border-red-200 text-red-700')}>
                        {armed === `${r.id}:writeoff` ? 'Tap again to write off' : 'Write off'}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setHistoryRenter(r)} aria-label="Payment history"
                      className="h-11 w-11 shrink-0 rounded-xl border-2 p-0"><History className="h-4 w-4" /></Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {currentRenters.map((renter) => {
          const entries = ledgerByRenter.get(renter.id) ?? [];
          const lease = leaseByRenter.get(renter.id);
          const booth = lease ? boothById.get(lease.boothId) : undefined;
          const balance = computeBalanceCents(entries);
          const isPastDue = summary.pastDueRenterIds.includes(renter.id);
          const balanceClass =
            balance > 0
              ? isPastDue
                ? 'text-red-600'
                : 'text-amber-600'
              : 'text-emerald-600';
          return (
            <Card key={renter.id} className={cn('rounded-[2rem] border-2', isPastDue && 'border-red-200')}>
              <CardContent className="p-5">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-base truncate">
                        {renter.firstName} {renter.lastName}
                      </p>
                      {isPastDue && (
                        <Badge className="bg-red-100 text-red-700">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Past due
                        </Badge>
                      )}
                      {!isPastDue && balance <= 0 && entries.length > 0 && (
                        <Badge className="bg-emerald-100 text-emerald-700">
                          <BadgeCheck className="h-3 w-3 mr-1" />
                          Paid up
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      {booth ? booth.name : 'No active lease'}
                      {lease &&
                        ` — ${formatCents(lease.rentAmountCents)} / ${FREQUENCY_LABELS[lease.frequency].toLowerCase()}`}
                    </p>
                  </div>
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Balance</p>
                      <p className={cn('text-xl font-black tabular-nums leading-none', balanceClass)}>
                        {formatCents(Math.max(balance, 0))}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => openPaymentDialog(renter)}
                      disabled={balance <= 0}
                      className="h-11 flex-1 min-w-[10rem] rounded-xl font-black uppercase text-[10px] tracking-widest"
                    >
                      <HandCoins className="h-3.5 w-3.5 mr-1.5" />
                      Record payment
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setChargeForm({
                          description: '',
                          amountDollars: '',
                          dueDate: todayIso,
                        });
                        setChargeRenter(renter);
                      }}
                      className="h-11 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
                    >
                      <Receipt className="h-3.5 w-3.5 mr-1.5" />
                      Add charge
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setHistoryRenter(renter)}
                      aria-label={`Payment history for ${renter.firstName} ${renter.lastName}`}
                      className="h-11 w-11 shrink-0 rounded-xl border-2 p-0"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={paymentRenter !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentRenter(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {paymentRenter
                ? `${paymentRenter.firstName} ${paymentRenter.lastName}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pay-amount">Amount ($)</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  value={paymentForm.amountDollars}
                  onChange={(e) =>
                    setPaymentForm((p) => ({
                      ...p,
                      amountDollars: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Method</Label>
                <Select
                  value={paymentForm.method}
                  onValueChange={(value) =>
                    setPaymentForm((p) => ({
                      ...p,
                      method: value as PaymentMethodKind,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-date">Payment date</Label>
              <Input
                id="pay-date"
                type="date"
                value={paymentForm.date}
                onChange={(e) =>
                  setPaymentForm((p) => ({ ...p, date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Textarea
                id="pay-note"
                value={paymentForm.note}
                onChange={(e) =>
                  setPaymentForm((p) => ({ ...p, note: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentRenter(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleRecordPayment}
              disabled={saving || toNumber(paymentForm.amountDollars) <= 0}
            >
              {saving ? 'Saving…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={chargeRenter !== null}
        onOpenChange={(open) => {
          if (!open) setChargeRenter(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add charge</DialogTitle>
            <DialogDescription>
              {chargeRenter
                ? `${chargeRenter.firstName} ${chargeRenter.lastName} — product, damages, or any one-off`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="chg-desc">What is it for?</Label>
              <Input
                id="chg-desc"
                placeholder="Gel polish restock, key replacement…"
                value={chargeForm.description}
                onChange={(e) =>
                  setChargeForm((p) => ({ ...p, description: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="chg-amount">Amount ($)</Label>
                <Input
                  id="chg-amount"
                  type="number"
                  value={chargeForm.amountDollars}
                  onChange={(e) =>
                    setChargeForm((p) => ({
                      ...p,
                      amountDollars: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="chg-due">Due date</Label>
                <Input
                  id="chg-due"
                  type="date"
                  value={chargeForm.dueDate}
                  onChange={(e) =>
                    setChargeForm((p) => ({ ...p, dueDate: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeRenter(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddCharge}
              disabled={
                saving ||
                toNumber(chargeForm.amountDollars) <= 0 ||
                !chargeForm.description.trim()
              }
            >
              {saving ? 'Saving…' : 'Add charge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={historyRenter !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryRenter(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ledger</DialogTitle>
            <DialogDescription>
              {historyRenter
                ? `${historyRenter.firstName} ${historyRenter.lastName} — full history`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {historyEntries.length === 0 && (
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            )}
            {historyEntries.map((entry) => {
              const isCredit = entry.amountCents < 0;
              const amountClass = isCredit
                ? 'text-emerald-600'
                : 'text-foreground';
              const settlement =
                entry.amountCents > 0
                  ? chargeSettlements.get(entry.id)
                  : undefined;
              const canWaive =
                entry.amountCents > 0 &&
                entry.status !== 'paid' &&
                entry.status !== 'waived' &&
                entry.status !== 'refunded' &&
                settlement?.status !== 'paid';

              const statusText = settlement
                ? settlement.status === 'partial'
                  ? `Partially paid · ${formatCents(settlement.remainingCents)} left`
                  : SETTLEMENT_LABELS[settlement.status]
                : entry.status;
              const statusClass =
                settlement?.status === 'partial'
                  ? 'text-amber-600 font-medium'
                  : settlement?.status === 'paid'
                    ? 'text-emerald-600'
                    : 'text-muted-foreground';

              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {entry.description ||
                        LEDGER_TYPE_LABELS[entry.type] ||
                        entry.type}
                    </p>
                    <p className={cn('text-xs', statusClass)}>
                      {entry.dueDate
                        ? `Due ${entry.dueDate}`
                        : entry.paidAt
                          ? `Paid ${entry.paidAt}`
                          : entry.createdAt.slice(0, 10)}
                      {' · '}
                      {statusText}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className={cn('text-sm font-semibold', amountClass)}>
                      {isCredit ? '−' : ''}
                      {formatCents(Math.abs(entry.amountCents))}
                    </p>
                    {canWaive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Waive this charge"
                        onClick={() => handleWaive(entry)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      {tenantId && (
        <RentScheduleCard rows={rentSchedule} renterById={scheduleRenterById} boothById={scheduleBoothById}
          onEnableAutopay={async (renterId) => {
            if (!firestore) return;
            const r = scheduleRenterById.get(renterId);
            if (!r?.cardOnFile) return;
            await setDoc(doc(firestore, 'tenants', tenantId, 'renters', renterId), {
              autopayEnabled: true, autopayChangedAt: new Date().toISOString(), autopayChangedBy: 'owner',
            }, { merge: true });
          }} />
      )}
      {tenantId && <RenterProvidersCard tenantId={tenantId} firestore={firestore} renters={(renters || []) as any[]} staff={(allStaff || []) as any[]} allAppointments={(allAppointments || []) as any[]} />}
      {tenantId && <RenterSwapsCard tenantId={tenantId} firestore={firestore} tenant={selectedTenant} />}
      {tenantId && <RentCommsCard tenantId={tenantId} firestore={firestore} tenant={selectedTenant} />}
      </div>
    </div>
  );
}
