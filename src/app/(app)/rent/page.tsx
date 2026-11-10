'use client';

import { DeskOwedCard } from '@/components/rent/DeskOwedCard';
import { RenterRefundDialog } from '@/components/rent/RenterRefundDialog';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  writeBatch,
  runTransaction,
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
import { resolveCollectionsPolicy, type CollectionsPolicy } from '@/lib/collections-policy';
import { resolveLeavePolicy, addDays as addLeaseDays, subletIncome, LEAVE_TREATMENT_LABEL, LEAVE_TREATMENT_NOTE, LEAVE_TYPE_LABEL, bankedAvailable, redeemValueCents, subletWindowFields, SUBLET_CLEAR_FIELDS, type LeavePolicy, type LeaveTreatment } from '@/lib/leave-policy';
import { AppHeader } from '@/components/shared/AppHeader';
import { RentalsHeader, RENTALS_BTN } from '@/components/renters/RentalsNav';
import { RentMoney } from '@/components/renters/RentMoney';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { nameOf } from '@/lib/rentals-home';
import { rentMoney } from '@/lib/rent-money';
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
  toIsoDate,
  renterOwedCents,
  invoiceOwedCents,
  isOpenLedgerCharge,
  getPastDueEntries,
  computeLateFeeCents,
  buildRentRollSummary,
} from '@/lib/booth-rental-types';
import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';
import { PrintLink } from '@/components/shared/PrintLink';

const PAYMENT_METHODS: { value: PaymentMethodKind; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'ach', label: 'Bank transfer (ACH)' },
  { value: 'other', label: 'Other' },
];


function toNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
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
 * Leave — what a renter can ask for when life happens, and the rent treatment
 * the shop is willing to offer. Nothing is offered until the owner ticks it,
 * and every request is decided by hand.
 */
function LeaveCard({ tenantId, firestore, tenant, leaves, leaseById, renterById, reservations }: { tenantId: string; firestore: any; tenant: any; leaves: any[]; leaseById: Map<string, any>; renterById: Map<string, any>; reservations: any[] }) {
  const [cfg, setCfg] = useState<LeavePolicy>(() => resolveLeavePolicy(tenant));
  const [deciding, setDeciding] = useState<string>('');
  const [chosen, setChosen] = useState<Record<string, LeaveTreatment>>({});
  useEffect(() => { setCfg(resolveLeavePolicy(tenant)); }, [tenant]);
  const decide = async (l: any, status: 'approved' | 'declined') => {
    if (!firestore || !tenantId) return;
    const treatment = status === 'approved' ? (chosen[l.id] || l.preferred || cfg.offered[0]) : null;
    if (status === 'approved' && !treatment) return;
    setDeciding(l.id);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'renterLeaves', l.id), {
        status, treatment, decidedAt: new Date().toISOString(), decidedBy: 'owner',
      });
      if (status === 'approved') {
        await setDoc(doc(firestore, 'tenants', tenantId, 'renters', l.renterId), {
          status: l.type === 'maternity' ? 'maternity_leave' : 'on_leave', leaveId: l.id,
        }, { merge: true });
        await setDoc(doc(firestore, 'tenants', tenantId, 'leases', l.leaseId), { status: 'on_leave', leaveId: l.id, leaveStartedAt: l.startDate }, { merge: true });
        const boothId = leaseById.get(l.leaseId)?.boothId;
        if (treatment === 'sublet' && boothId) {
          await setDoc(doc(firestore, 'tenants', tenantId, 'booths', boothId), subletWindowFields(l), { merge: true });
        }
      }
      try {
        await fetch('/api/booths/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'leave-decision', tenantId, leaveId: l.id }) });
      } catch { /* the decision stands */ }
    } finally { setDeciding(''); }
  };
  const endNow = async (l: any) => {
    if (!firestore || !tenantId) return;
    setDeciding(l.id);
    try {
      const lease = leaseById.get(l.leaseId) || {};
      const pausedDays = Number(l.pausedDays) || 0;
      const patch: Record<string, any> = { status: 'active', leaveId: null, leaveEndedAt: new Date().toISOString() };
      if (l.treatment === 'pause' && pausedDays > 0 && typeof lease.endDate === 'string' && lease.endDate) {
        patch.endDate = addLeaseDays(lease.endDate, pausedDays);
        patch.endDateExtendedByLeaveDays = (Number(lease.endDateExtendedByLeaveDays) || 0) + pausedDays;
      }
      await setDoc(doc(firestore, 'tenants', tenantId, 'leases', l.leaseId), patch, { merge: true });
      if (l.treatment === 'sublet' && lease.boothId) {
        await setDoc(doc(firestore, 'tenants', tenantId, 'booths', lease.boothId), SUBLET_CLEAR_FIELDS, { merge: true });
      }
      await setDoc(doc(firestore, 'tenants', tenantId, 'renters', l.renterId), { status: 'active', leaveId: null }, { merge: true });
      await updateDoc(doc(firestore, 'tenants', tenantId, 'renterLeaves', l.id), {
        status: 'ended', endedAt: new Date().toISOString(), endedBy: 'owner',
        leaseExtendedDays: l.treatment === 'pause' ? pausedDays : 0,
      });
    } finally { setDeciding(''); }
  };
  const creditSublet = async (l: any, cents: number) => {
    if (!firestore || !tenantId || cents <= 0) return;
    setDeciding(`s-${l.id}`);
    try {
      const lease = leaseById.get(l.leaseId) || {};
      const nowIso = new Date().toISOString();
      const ref = doc(collection(firestore, 'tenants', tenantId, 'rentLedger'));
      await setDoc(ref, {
        leaseId: l.leaseId, renterId: l.renterId, boothId: lease.boothId || null,
        type: 'sublet_credit', status: 'paid', amountCents: -cents,
        description: 'Day rentals of their space while on leave',
        note: '', dueDate: null, paidAt: nowIso.slice(0, 10), method: 'sublet_credit',
        stripePaymentIntentId: null, appliesToEntryIds: [], createdBy: 'owner', createdAt: nowIso, updatedAt: nowIso,
      });
      await updateDoc(doc(firestore, 'tenants', tenantId, 'renterLeaves', l.id), {
        subletCreditedCents: (Number(l.subletCreditedCents) || 0) + cents,
        subletCreditedAt: nowIso,
      });
    } finally { setDeciding(''); }
  };
  const decideRedeem = async (l: any, ok: boolean) => {
    if (!firestore || !tenantId) return;
    setDeciding(`r-${l.id}`);
    try {
      const days = Number(l.redeem?.days) || 0;
      const lease = leaseById.get(l.leaseId) || {};
      const cents = redeemValueCents(lease, days);
      if (ok && cents > 0) {
        const nowIso = new Date().toISOString();
        const ref = doc(collection(firestore, 'tenants', tenantId, 'rentLedger'));
        await setDoc(ref, {
          leaseId: l.leaseId, renterId: l.renterId, boothId: lease.boothId || null,
          type: 'leave_credit', status: 'paid', amountCents: -cents,
          description: `${days} banked rental day${days === 1 ? '' : 's'} redeemed`,
          note: String(l.redeem?.note || ''), dueDate: null, paidAt: nowIso.slice(0, 10), method: 'leave_credit',
          stripePaymentIntentId: null, appliesToEntryIds: [], createdBy: 'owner', createdAt: nowIso, updatedAt: nowIso,
        });
        // It comes off their open rent now, and they're told (api/rent/notify).
        void fetch('/api/rent/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, kind: 'credit_added', id: ref.id }) }).catch(() => null);
      }
      await updateDoc(doc(firestore, 'tenants', tenantId, 'renterLeaves', l.id), {
        redeem: { ...(l.redeem || {}), status: ok ? 'approved' : 'declined', decidedAt: new Date().toISOString(), creditCents: ok ? cents : 0 },
        redeemedDays: ok ? (Number(l.redeemedDays) || 0) + days : (Number(l.redeemedDays) || 0),
      });
    } finally { setDeciding(''); }
  };
  const pending = leaves.filter((l) => l.status === 'requested');
  const active = leaves.filter((l) => l.status === 'approved');
  const redeems = leaves.filter((l) => l.redeem && l.redeem.status === 'requested');
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <Card id="time-away" className="scroll-mt-20 rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-[11px] font-black uppercase tracking-widest">Leave</CardTitle>
        <p className="text-[11px] font-bold text-muted-foreground">Maternity, medical, family. Requests from renters, and what rent does while they're away. Every request is yours to decide.</p>
      </CardHeader>
      <CardContent className="p-5 pt-2 space-y-4">
        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-800">Waiting on you</p>
            {pending.map((l) => {
              const r = renterById.get(l.renterId);
              const pick = chosen[l.id] || l.preferred || cfg.offered[0];
              return (
                <div key={l.id} className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-3 space-y-2">
                  <p className="text-sm font-black">{r ? `${r.firstName} ${r.lastName}` : l.renterName}<span className="font-bold text-muted-foreground"> · {LEAVE_TYPE_LABEL[l.type as keyof typeof LEAVE_TYPE_LABEL] || l.type}</span></p>
                  <p className="text-[11px] font-bold text-foreground/80">{l.startDate} → {l.endDate} · {l.days} day{l.days === 1 ? '' : 's'}{l.preferred ? ` · they'd prefer: ${LEAVE_TREATMENT_LABEL[l.preferred as LeaveTreatment]}` : ''}</p>
                  {l.note && <p className="text-[11px] font-medium text-foreground/80">“{l.note}”</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {cfg.offered.map((t) => (
                      <button key={t} type="button" onClick={() => setChosen((m) => ({ ...m, [l.id]: t }))} aria-pressed={pick === t}
                        className={cn('h-9 px-3 rounded-full border-2 text-[9px] font-black uppercase tracking-widest', pick === t ? 'bg-foreground text-background border-slate-900' : 'border-border text-foreground/80 bg-card')}>{LEAVE_TREATMENT_LABEL[t]}</button>
                    ))}
                  </div>
                  {pick === 'sublet' && <p className="text-[10px] font-bold text-foreground/80">Approving opens their space for day rentals from {l.startDate} to {l.endDate} — those dates only.</p>}
                  <div className="flex gap-2">
                    <Button onClick={() => decide(l, 'approved')} disabled={deciding === l.id || !pick} className="h-10 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-black uppercase text-[10px] tracking-widest">{deciding === l.id ? '…' : `Approve · ${pick ? LEAVE_TREATMENT_LABEL[pick] : ''}`}</Button>
                    <Button variant="outline" onClick={() => decide(l, 'declined')} disabled={deciding === l.id} className="h-10 rounded-xl border-2 border-red-200 text-red-700 font-black uppercase text-[10px] tracking-widest">Decline</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {redeems.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-800">Banked days to approve</p>
            {redeems.map((l) => {
              const r = renterById.get(l.renterId);
              const cents = redeemValueCents(leaseById.get(l.leaseId) || {}, Number(l.redeem?.days) || 0);
              return (
                <div key={`r-${l.id}`} className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-3 space-y-2">
                  <p className="text-sm font-black">{r ? `${r.firstName} ${r.lastName}` : l.renterName}<span className="font-bold text-muted-foreground"> · {l.redeem.days} day{l.redeem.days === 1 ? '' : 's'}</span></p>
                  <p className="text-[11px] font-bold text-foreground/80">Approving posts a {formatCents(cents)} credit against their rent. They have {bankedAvailable(l)} banked.</p>
                  {l.redeem.note && <p className="text-[11px] font-medium text-foreground/80">“{l.redeem.note}”</p>}
                  <div className="flex gap-2">
                    <Button onClick={() => decideRedeem(l, true)} disabled={deciding === `r-${l.id}`} className="h-10 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-black uppercase text-[10px] tracking-widest">{deciding === `r-${l.id}` ? '…' : `Credit ${formatCents(cents)}`}</Button>
                    <Button variant="outline" onClick={() => decideRedeem(l, false)} disabled={deciding === `r-${l.id}`} className="h-10 rounded-xl border-2 border-red-200 text-red-700 font-black uppercase text-[10px] tracking-widest">Decline</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {active.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">On leave now</p>
            {active.map((l) => { const r = renterById.get(l.renterId); const back = String(l.endDate) < todayIso; return (
              <div key={l.id} className="rounded-2xl border-2 bg-card px-3.5 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black truncate">{r ? `${r.firstName} ${r.lastName}` : l.renterName}<span className="font-bold text-muted-foreground"> · {l.startDate} → {l.endDate}</span></p>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', back ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>{back ? 'Due back' : (LEAVE_TREATMENT_LABEL[l.treatment as LeaveTreatment] || 'Approved')}</span>
                </div>
                {l.treatment === 'sublet' && (() => {
                  const inc = subletIncome(reservations, l.leaseId, Number(l.subletCreditedCents) || 0);
                  if (inc.bookings === 0) return <p className="text-[10px] font-bold text-muted-foreground">Their space is listed for day rentals until {l.endDate}. Nothing booked yet.</p>;
                  return (
                    <div className="rounded-xl bg-muted/60 border-2 px-3 py-2 space-y-1.5">
                      <p className="text-[11px] font-bold text-foreground/80">
                        {formatCents(inc.grossCents)} from {inc.bookings} booking{inc.bookings === 1 ? '' : 's'} while away
                        {inc.passBookings > 0 ? ` · ${inc.passBookings} paid by prepaid pass, already earned at pack sale` : ''}
                        {inc.creditedCents > 0 ? ` · ${formatCents(inc.creditedCents)} already credited` : ''}
                      </p>
                      <Button variant="outline" onClick={() => creditSublet(l, inc.uncreditedCents)} disabled={deciding === `s-${l.id}` || inc.uncreditedCents <= 0}
                        className="h-9 w-full rounded-xl border-2 font-black uppercase text-[9px] tracking-widest disabled:opacity-40">
                        {deciding === `s-${l.id}` ? '…' : inc.uncreditedCents > 0 ? `Credit ${formatCents(inc.uncreditedCents)} to their rent` : 'All of it credited'}
                      </Button>
                    </div>
                  );
                })()}
                <Button variant="outline" onClick={() => endNow(l)} disabled={deciding === l.id}
                  className="h-9 w-full rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                  {deciding === l.id ? '…' : `End leave${l.treatment === 'pause' && Number(l.pausedDays) > 0 ? ` · extends lease ${l.pausedDays} day${Number(l.pausedDays) === 1 ? '' : 's'}` : ''}`}
                </Button>
              </div>
            ); })}
          </div>
        )}
        <Link href="/rental-policies#away" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-[#16171a] underline">The ways renters can ask for time away are set in Rental policies</Link>
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
        <span className="block text-[12px] font-black uppercase tracking-wide text-foreground">Tour confirmation to the prospect</span>
        <span className="block text-[11px] font-bold text-muted-foreground">Emails the person who booked the tour their time and what to expect. Off means nothing ever sends.</span>
      </span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${prospectOn ? 'bg-emerald-100 text-emerald-700' : 'bg-border text-foreground/80'}`}>
        {prospectOn ? 'On' : 'Off'}
      </span>
    </button>
  );
  const Row = ({ k, label, hint }: { k: string; label: string; hint: string }) => (
    <button type="button" onClick={() => flip(k)} className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left">
      <span>
        <span className="block text-[12px] font-black uppercase tracking-wide text-foreground">{label}</span>
        <span className="block text-[11px] font-bold text-muted-foreground">{hint}</span>
      </span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${cfg[k] !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
        {cfg[k] !== false ? 'On' : 'Off'}
      </span>
    </button>
  );
  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-[11px] font-black uppercase tracking-widest">Rent notifications</CardTitle>
        <p className="text-[11px] font-bold text-muted-foreground">Who hears what, automatically. Late-fee amounts and grace days live on each lease.</p>
      </CardHeader>
      <CardContent className="space-y-2 p-5 pt-2">
        <ProspectRow />
        <Row k="remindRenterBeforeDue" label="Remind renters before rent is due" hint="Branded email with a pay link — autopay renters are skipped" />
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 p-3">
          <span>
            <span className="block text-[12px] font-black uppercase tracking-wide text-foreground">Reminder lead time</span>
            <span className="block text-[11px] font-bold text-muted-foreground">Days before the due date (1–7)</span>
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
  const enabled = tenant?.renterSwapsEnabled !== false;   // on, off or an add-on: set in What renters get

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
        <p className="text-[11px] font-bold text-muted-foreground">
          Renters cover for each other directly. Rent never moves, so there is nothing to approve — this is just who is in.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-2">
        <p className="text-[11px] font-bold text-muted-foreground">
          {enabled ? 'Swap days are on. ' : 'Swap days are off. '}Change it, or make it a paid add-on, in What renters get.
        </p>

        {openCount > 0 && (
          <p className="text-[11px] font-bold text-sky-700">
            {openCount} {openCount === 1 ? 'day is' : 'days are'} currently offered to whoever can take {openCount === 1 ? 'it' : 'them'}.
          </p>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who is covering whom</p>
          {upcoming.length === 0 ? (
            <p className="text-[11px] font-bold text-muted-foreground">No swaps coming up.</p>
          ) : upcoming.map((x: any) => (
            <div key={x.id} className="rounded-2xl border-2 p-3">
              <p className="text-[12px] font-black text-foreground">
                {x.toName || 'Someone'} covers {x.fromName || 'someone'}
              </p>
              <p className="text-[11px] font-bold text-muted-foreground mt-0.5">
                {when(x.giveDate)} · {x.wholeDay === false ? `${x.giveStart}–${x.giveEnd}` : 'all day'}
                {x.giveBoothName ? ` · ${x.giveBoothName}` : ''}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-bold text-muted-foreground">
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
        <p className="text-[11px] font-bold text-muted-foreground">Let a renter take bookings on your booking page with their own menu and prices. They collect payment directly — nothing runs through your Stripe.</p>
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
                  <span className="block text-[12px] font-black uppercase tracking-wide text-foreground">{rName(r)}</span>
                  <span className="block text-[11px] font-bold text-muted-foreground">{on ? `${mine.length} service${mine.length === 1 ? '' : 's'} on their menu` : 'Not taking bookings here'}</span>
                </button>
                <Button size="sm" variant={on ? 'ghost' : 'default'} className="shrink-0 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        onClick={() => (on ? disableProvider(r) : enableProvider(r))}>
                  {on ? 'Turn off' : 'Enable'}
                </Button>
              </div>

              {open && on && (
                <div className="mt-3 space-y-2 border-t-2 pt-3">
                  <div className="rounded-2xl bg-muted/60 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Chair activity (last 30 days)</p>
                    <p className="text-[13px] font-bold text-foreground/80">
                      {(() => {
                        const since = new Date(Date.now() - 30 * 86400000).toISOString();
                        const rows = ((allAppointments || []) as any[]).filter((a: any) => a.isRenterBooking && a.staffId === st?.id && a.startTime >= since && a.status !== 'cancelled');
                        const upcoming = rows.filter((a: any) => a.startTime >= new Date().toISOString()).length;
                        return `${rows.length} booking${rows.length === 1 ? '' : 's'} · ${upcoming} upcoming`;
                      })()}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-muted-foreground">
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
                        <span className="block truncate text-[12px] font-black text-foreground">{sv.name}</span>
                        <span className="block text-[11px] font-bold text-muted-foreground">${Number(sv.price || 0).toFixed(2)} · {sv.duration} min</span>
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
                  <p className="text-[11px] font-bold text-muted-foreground">Clients booking these see “you’ll pay {rName(r)} directly at your visit.” Their own hours and self-serve menu editing come next.</p>
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
  const [payRequestId, setPayRequestId] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [chargeRenter, setChargeRenter] = useState<Renter | null>(null);
  const [refundRenter, setRefundRenter] = useState<Renter | null>(null);
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
  const [lastReceipt, setLastReceipt] = useState<{ renterId: string; paymentId: string } | null>(null);

  // Today and this month on the business's own clock, like the nightly billing (lib/tenant-time).
  const bizTimeZone = tenantTimeZone(selectedTenant);
  const todayIso = todayIn(bizTimeZone);
  const cycleStartIso = `${todayIso.slice(0, 7)}-01`;

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
  const scheduleLeaseById = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of (leases ?? []) as any[]) m.set(l.id, l);
    return m;
  }, [leases]);
  const reservationsRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'boothReservations') : null),
    [firestore, tenantId]);
  const { data: boothReservations } = useCollection<any>(reservationsRef);
  const leavesRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'renterLeaves') : null),
    [firestore, tenantId]);
  const { data: renterLeaves } = useCollection<any>(leavesRef);

  // Invoices — what is owed. The late sweep, the reminder, the planner and
  // the portal already read this collection; the page now does too, so every
  // screen agrees on who is behind.
  const invoicesRef = useMemoFirebase(
    () => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'rentInvoices') : null),
    [firestore, tenantId]);
  const { data: invoices } = useCollection<any>(invoicesRef);
  // Unpaid ledger charges with no invoice — the old cycle's leftovers.
  const uninvoicedCharges = useMemo(() => {
    const invoiced = new Set(((invoices ?? []) as any[]).map((i) => String(i.ledgerEntryId || '')).filter(Boolean));
    const byKey = new Set(((invoices ?? []) as any[]).map((i) => `${i.leaseId}|${i.dueDate}`));
    return ((ledger ?? []) as any[]).filter((e) =>
      e.type === 'rent_charge'
      && (Number(e.amountCents) || 0) > 0
      && !['paid', 'waived', 'refunded', 'failed', 'migrated'].includes(String(e.status))
      && !invoiced.has(e.id)
      && !byKey.has(`${e.leaseId}|${e.dueDate}`));
  }, [ledger, invoices]);

  // Old ledger charges are moved onto rent bills by the server's catch-up (lib/rent-cycle migrateLedger), the same run as
  // "Bring rent up to date": rent bills are written only by the server.
  const importCharges = () => runRentCycle();
  const importing = running;

  const rentSchedule = useMemo(
    () => buildRentSchedule((leases ?? []) as any[], scheduleRenterById, (ledger ?? []) as any[], todayIso, selectedTenant ? ((selectedTenant as any).stripeAccountId || null) : undefined),
    [leases, scheduleRenterById, ledger, todayIso, selectedTenant]);

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
        invoices: (invoices ?? []) as any[],
        timeZone: bizTimeZone,
      }),
    [booths, renters, leases, ledger, todayIso, cycleStartIso, invoices, bizTimeZone]
  );
  // What each renter owes now: open rent bills plus open one-off charges (lib/booth-rental-types renterOwedCents).
  const owedOf = useCallback((renterId: string) => renterOwedCents(renterId, (invoices ?? []) as any[], (ledger ?? []) as any[]), [invoices, ledger]);
  // Rent and deposits at the top of the page (lib/rent-money): one rule with the Rentals home and each renter's page.
  const moneyView = useMemo(() => rentMoney({ todayIso, timeZone: bizTimeZone, renters: (renters ?? []) as any[], leases: (leases ?? []) as any[], booths: (booths ?? []) as any[], invoices: (invoices ?? []) as any[], ledger: (ledger ?? []) as any[], schedule: rentSchedule }),
    [todayIso, bizTimeZone, renters, leases, booths, invoices, ledger, rentSchedule]);

  const openPaymentDialog = (renter: Renter) => {
    const balance = owedOf(renter.id);
    setPaymentForm({
      amountDollars: balance > 0 ? (balance / 100).toString() : '',
      method: 'venmo',
      date: todayIso,
      note: '',
    });
    setPayRequestId(nanoid(16)); setPayError(null);
    setPaymentRenter(renter);
  };

  // Above the page's early return, like every hook here.
  // /rent?pay=<renterId> opens Record payment for them (the Rentals home's late-rent "Record payment"), once their bills
  // and ledger have loaded so what they owe is filled in.
  const payLinked = useRef(false);
  useEffect(() => {
    if (payLinked.current || typeof window === 'undefined' || !renters || !invoices || !ledger) return;
    const rid = new URLSearchParams(window.location.search).get('pay');
    payLinked.current = true;
    const r = rid ? renters.find((x) => x.id === rid) : null;
    if (r) openPaymentDialog(r);
  }, [renters, invoices, ledger]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [formerBusy, setFormerBusy] = useState<string>('');

  // Bar / unbar. The flag is enforced at the public booking route and shown
  // in the pipeline and on their guest-book row — a wall, not a note.
  const setDoNotRent = async (r: any, on: boolean) => {
    if (!firestore || !tenantId) return;
    setFormerBusy(r.id);
    try {
      await setDoc(doc(firestore, 'tenants', tenantId, 'renters', r.id), {
        doNotRent: on, doNotRentAt: on ? new Date().toISOString() : null,
        doNotRentReason: on ? 'Unpaid balance' : null, doNotRentBy: 'owner',
      }, { merge: true });
      // Tell them, if the shop's policy says so — through the logged sender.
      if (on && resolveCollectionsPolicy(selectedTenant).notifyOnBar) {
        try {
          await fetch('/api/booths/notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'renter-barred', tenantId, renterId: r.id }),
          });
        } catch { /* the bar stands */ }
      }
      setCycleResult(on ? `${nameOf(r)} can no longer book or apply until this is cleared.` : `${nameOf(r)} can book again.`);
    } catch { setCycleResult('Could not save that \u2014 try again.'); }
    setFormerBusy('');
  };

  // Write off. The balance becomes a ledger line of its own (so the money is
  // never quietly forgotten), every open bill is voided and every open charge
  // closed, and the renter drops out of Owed. Barring is a separate decision —
  // a write-off is not forgiveness, and forgiveness is not a write-off.
  // Read again as it's saved: if what they owe changed while the owner was
  // deciding (a payment came in), nothing is written and they're told.
  const writeOff = async (r: any, reasonGiven = '', expectCents?: number): Promise<boolean> => {
    if (!firestore || !tenantId) return false;
    const billIds = ((invoices ?? []) as any[]).filter((i) => i.renterId === r.id && invoiceOwedCents(i) > 0).map((i) => String(i.id));
    const chargeIds = (ledgerByRenter.get(r.id) ?? []).filter((e: any) => isOpenLedgerCharge(e) && !String(e.type || '').startsWith('deposit_')).map((e: any) => String(e.id));
    if (!billIds.length && !chargeIds.length) return false;
    setFormerBusy(r.id);
    let ok = false;
    try {
      const nowIso = new Date().toISOString();
      const done = await runTransaction(firestore, async (tx) => {
        const bills = (await Promise.all(billIds.map((id) => tx.get(doc(firestore, 'tenants', tenantId, 'rentInvoices', id)))))
          .filter((x) => x.exists()).map((x) => ({ id: x.id, ...(x.data() as any) })).filter((i) => invoiceOwedCents(i) > 0);
        const charges = (await Promise.all(chargeIds.map((id) => tx.get(doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), id)))))
          .filter((x) => x.exists()).map((x) => ({ id: x.id, ...(x.data() as any) })).filter((e) => isOpenLedgerCharge(e));
        const bal = bills.reduce((n, i) => n + invoiceOwedCents(i), 0) + charges.reduce((n, e) => n + (Number(e.amountCents) || 0), 0);
        if (bal <= 0 || (typeof expectCents === 'number' && bal !== expectCents)) return 0;
        tx.set(doc(collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))), {
          leaseId: leaseByRenter.get(r.id)?.id ?? '', renterId: r.id, boothId: null,
          type: 'payment', status: 'waived', amountCents: -bal,
          description: 'Balance written off', dueDate: null, paidAt: todayIso, method: 'write_off',
          stripePaymentIntentId: null, appliesToEntryIds: [], createdBy: 'owner',
          note: reasonGiven.trim() || 'Written off as uncollectable', createdAt: nowIso, updatedAt: nowIso,
        });
        for (const e of charges) tx.update(doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), e.id), { status: 'waived', updatedAt: nowIso });
        for (const i of bills) tx.update(doc(firestore, 'tenants', tenantId, 'rentInvoices', i.id), { status: 'void', voidedAt: nowIso, voidReason: 'written_off', updatedAt: nowIso });
        return bal;
      });
      if (done > 0) { ok = true; setCycleResult(`Wrote off ${formatCents(done)} for ${nameOf(r)}.`); }
      else setCycleResult('What they owe changed while you were deciding (a payment came in). Nothing was written off.');
    } catch { setCycleResult('Could not write that off \u2014 try again.'); }
    setFormerBusy('');
    return ok;
  };
  const [waiveBusy, setWaiveBusy] = useState<string>('');

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // One rent record: the cycle runs on the server — an invoice for every due date that doesn't have one, and the old
  // ledger charges folded into invoices. It never creates a second invoice for the same due date.
  const runRentCycle = async () => {
    if (!tenantId) return;
    setRunning(true); setCycleResult(null);
    try {
      const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r: any = await fetch('/api/rent/cycle', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId }) }).then((x) => x.json()).catch(() => null);
      if (!r?.ok) { setCycleResult(r?.error || 'That didn’t run — try again.'); return; }
      const bits: string[] = []; if (r.created) bits.push(`${r.created} invoice${r.created === 1 ? '' : 's'} created${r.late ? ` (${r.late} already late)` : ''}`);
      if (r.migrated?.charges || r.migrated?.fees) bits.push(`${r.migrated.charges} older charge${r.migrated.charges === 1 ? '' : 's'} and ${r.migrated.fees} late fee${r.migrated.fees === 1 ? '' : 's'} moved onto invoices`);
      setCycleResult(bits.length ? `${bits.join('; ')}.` : 'Everything is up to date — nothing new due.');
    } finally { setRunning(false); }
  };


  // One path for every recorded payment (api/rent/record-payment): the renter's bills and charges are read and paid in
  // one step on the server (bills first, oldest first, then whole charges, anything over kept as credit), so a bill
  // autopay or an online payment has just paid is never paid twice, and the renter gets a receipt.
  const handleRecordPayment = async () => {
    if (!paymentRenter || !tenantId) return;
    const amountCents = Math.round(toNumber(paymentForm.amountDollars) * 100);
    if (amountCents <= 0) return;
    setSaving(true); setPayError(null);
    try {
      const methodLabel = PAYMENT_METHODS.find((m) => m.value === paymentForm.method)?.label ?? paymentForm.method;
      const renterName = `${paymentRenter.firstName} ${paymentRenter.lastName}`;
      const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r: any = await fetch('/api/rent/record-payment', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
        body: JSON.stringify({ tenantId, renterId: paymentRenter.id, amountCents, method: paymentForm.method, methodLabel, date: paymentForm.date, note: paymentForm.note, requestId: payRequestId || nanoid(16) }) })
        .then((x) => x.json()).catch(() => null);
      if (!r?.ok) { setPayError(r?.error || 'That didn’t save, so nothing was recorded. Try again.'); return; }
      setPaymentRenter(null);
      setCycleResult(`Recorded ${formatCents(amountCents)} from ${renterName}.${r.creditCents > 0 ? ` ${formatCents(r.creditCents)} is kept as credit toward their next rent.` : ''}${r.receiptSentTo ? ` Receipt sent to ${r.receiptSentTo}.` : ''}`);
      setLastReceipt({ renterId: paymentRenter.id, paymentId: r.paymentId });
    } finally {
      setSaving(false);
    }
  };

  // The renter is told about a change made to their account by hand, written from the record on the server, once
  // (api/rent/notify, lib/renter-account-notice). Best effort: the change stands either way.
  const tellRenter = (kind: 'charge_added' | 'fee_waived' | 'bill_waived' | 'charge_waived' | 'credit_added', id: string) => {
    if (!tenantId || !id) return;
    void fetch('/api/rent/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, kind, id }) }).catch(() => null);
  };

  const handleAddCharge = async () => {
    if (!firestore || !chargeRenter) return;
    const amountCents = Math.round(toNumber(chargeForm.amountDollars) * 100);
    if (amountCents <= 0 || !chargeForm.description.trim()) return;
    setSaving(true);
    try {
      const lease = leaseByRenter.get(chargeRenter.id);
      const now = new Date().toISOString();
      const added = await addDoc(
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
      tellRenter('charge_added', added.id);
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

  // Waive a late fee, or a whole invoice. Both are the owner's call and both
  // leave a mark: the fee is zeroed with who/when/why on the invoice, or the
  // invoice is voided with a reason — and a credit line goes to the ledger so
  // the statement's running balance shows the waiver as a line, not a gap.
  // The late sweep will not re-apply a waived fee (feeWaivedAt is the stamp).
  // Read again as it's saved: if the bill was paid, waived or voided while the owner was deciding, nothing is written
  // and they're told, so a credit is never made for money that's already in. True when it's done.
  const waiveInvoice = async (invId: string, what: 'fee' | 'invoice', reasonGiven: string): Promise<boolean> => {
    if (!firestore || !tenantId) return false;
    setWaiveBusy(`${invId}:${what}`);
    try {
      const nowIso = new Date().toISOString();
      const reason = reasonGiven.trim() || (what === 'fee' ? 'Late fee waived' : 'Bill waived');
      const invRef = doc(firestore, 'tenants', tenantId, 'rentInvoices', invId);
      const done = await runTransaction(firestore, async (tx) => {
        const snap = await tx.get(invRef);
        if (!snap.exists()) return null;
        const inv: any = { id: snap.id, ...(snap.data() as any) };
        if (!['due', 'late'].includes(String(inv.status))) return null;
        const credit = (cents: number, description: string) => tx.set(doc(collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))), {
          leaseId: inv.leaseId || '', renterId: inv.renterId, boothId: inv.boothId || null,
          type: 'credit', status: 'paid', amountCents: -cents, description, note: reason,
          dueDate: null, paidAt: todayIso, method: 'waiver', stripePaymentIntentId: null,
          appliesToEntryIds: [], createdBy: 'owner', createdAt: nowIso, updatedAt: nowIso,
        });
        if (what === 'fee') {
          const fee = Number(inv.lateFeeCents) || 0;
          if (fee <= 0) return null;
          tx.update(invRef, { lateFeeCents: 0, feeWaivedCents: fee, feeWaivedAt: nowIso, feeWaivedBy: 'owner', feeWaivedReason: reason, updatedAt: nowIso });
          credit(fee, `Late fee waived — rent due ${inv.dueDate}`);
          return `Waived the ${formatCents(fee)} late fee on rent due ${inv.dueDate}.`;
        }
        const owed = invoiceOwedCents(inv);
        tx.update(invRef, { status: 'void', voidedAt: nowIso, voidedBy: 'owner', voidReason: 'waived', voidNote: reason, updatedAt: nowIso });
        if (owed > 0) credit(owed, `Rent waived — due ${inv.dueDate}`);
        if (inv.ledgerEntryId) tx.update(doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), inv.ledgerEntryId), { status: 'waived', updatedAt: nowIso });
        return `Waived the bill due ${inv.dueDate}${owed > 0 ? ` (${formatCents(owed)})` : ''}.`;
      });
      if (!done) { setCycleResult('That bill changed while you were deciding (it’s paid, or already waived). Nothing was waived.'); return false; }
      setCycleResult(done);
      tellRenter(what === 'fee' ? 'fee_waived' : 'bill_waived', invId);
      return true;
    } catch { setCycleResult('Could not waive that \u2014 try again.'); return false; }
    finally { setWaiveBusy(''); }
  };

  // A one-off charge (not on a bill), waived with the reason kept on it. Read again as it's saved, like a bill.
  const handleWaive = async (entry: RentLedgerEntry, reasonGiven = ''): Promise<boolean> => {
    if (!firestore || !tenantId) return false;
    const ref = doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), entry.id);
    try {
      const nowIso = new Date().toISOString();
      const ok = await runTransaction(firestore, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists() || !isOpenLedgerCharge(snap.data())) return false;
        tx.update(ref, { status: 'waived', waivedAt: nowIso, waivedBy: 'owner', ...(reasonGiven.trim() ? { waivedReason: reasonGiven.trim() } : {}), updatedAt: nowIso });
        return true;
      });
      if (!ok) { setCycleResult('That charge changed while you were deciding (it’s paid, or already waived). Nothing was waived.'); return false; }
      setCycleResult(`Waived ${String(entry.description || 'the charge')}.`);
      tellRenter('charge_waived', entry.id);
      return true;
    } catch { setCycleResult('Could not waive that \u2014 try again.'); return false; }
  };

  const historyEntries = historyRenter
    ? ledgerByRenter.get(historyRenter.id) ?? []
    : [];
  const chargeSettlements = settleCharges(historyEntries);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader title="Rent" />
      <div className="flex-1 w-full max-w-[1100px] mx-auto min-w-0 p-4 sm:p-6 md:p-8 space-y-6"
        style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

      <RentalsHeader businessName={selectedTenant?.name || ''} current="/rent" actions={<>
        <LocationSwitcher />
        <button type="button" onClick={runRentCycle} disabled={running} className={RENTALS_BTN}>{running ? 'Working…' : 'Bring rent up to date'}</button>
      </>} />

      {cycleResult && (
        <p className="text-[11px] font-bold text-muted-foreground">
          {cycleResult}
          {lastReceipt && (
            <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId: lastReceipt.renterId, receipt: lastReceipt.paymentId }} className="ml-1 underline text-foreground">Print receipt</PrintLink>
          )}
        </p>
      )}

      {uninvoicedCharges.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#ececee] bg-white p-5">
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-[15px] font-semibold text-[#b45309]">{uninvoicedCharges.length} unpaid charge{uninvoicedCharges.length === 1 ? '' : 's'} from the old rent cycle {uninvoicedCharges.length === 1 ? 'isn’t' : 'aren’t'} on a bill yet</p>
            <p className="text-[13px] leading-snug text-[#6d7075]">Bring them in, and late notices, reminders and the renter’s portal will see them too.</p>
          </div>
          <button type="button" onClick={importCharges} disabled={importing} className={RENTALS_BTN}>{importing ? 'Working…' : 'Bring them in'}</button>
        </div>
      )}

      {tenantId && (
        <RentMoney tenantId={tenantId} data={moneyView} busy={waiveBusy || (formerBusy ? `bar:${formerBusy}` : '')}
          onRecordPayment={(id) => { const r = ((renters ?? []) as any[]).find((x) => x.id === id); if (r) openPaymentDialog(r); }}
          onWaive={(what, id, why) => what === 'charge' ? handleWaive({ ...(((ledger ?? []) as any[]).find((e) => e.id === id) || { id }) } as any, why) : waiveInvoice(id, what, why)}
          onPayLink={async (id) => {
            const r = await fetch('/api/rent/pay-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, renterId: id }) }).then((x) => x.json()).catch(() => null);
            return r?.ok ? { ok: true, said: `Sent to ${r.sentTo}, for ${formatCents(Number(r.cents) || 0)}.` } : { ok: false, said: String(r?.error || 'That didn’t go out. Try again.') };
          }}
          onWriteOff={(id, why, cents) => { const r = ((renters ?? []) as any[]).find((x) => x.id === id); return r ? writeOff(r, why, cents) : Promise.resolve(false); }}
          onAutopayNotTaken={(inv) => { void updateDoc(doc(firestore, 'tenants', tenantId, 'rentInvoices', inv.id), { autopayUnconfirmed: false, autopayDeclined: 'not taken (checked by the business)', updatedAt: new Date().toISOString() }).then(() => setCycleResult('They can pay that bill now.')).catch(() => setCycleResult('That didn’t save. Try again.')); }}
          onBar={(id, on) => { const r = ((renters ?? []) as any[]).find((x) => x.id === id); if (r) void setDoNotRent(r, on); }} />
      )}

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


      <div className="space-y-3">
        {currentRenters.map((renter) => {
          const entries = ledgerByRenter.get(renter.id) ?? [];
          const lease = leaseByRenter.get(renter.id);
          const booth = lease ? boothById.get(lease.boothId) : undefined;
          const balance = owedOf(renter.id);
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
                        <Link href={`/renters/${encodeURIComponent(renter.id)}`} className="hover:underline">{renter.firstName} {renter.lastName}</Link>
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
                      onClick={() => setRefundRenter(renter)}
                      className="h-11 rounded-xl border-2 text-[13px] font-medium"
                    >
                      Refund
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setHistoryRenter(renter)}
                      aria-label={`Payment history for ${renter.firstName} ${renter.lastName}`}
                      className="h-11 w-11 shrink-0 rounded-xl border-2 p-0"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId: renter.id }}
                      className="h-11 inline-flex items-center rounded-xl border-2 bg-card px-3 text-[10px] font-black uppercase tracking-widest text-foreground/80"
                    >
                      <Receipt className="h-3.5 w-3.5 mr-1.5" /> Statement
                    </PrintLink>
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
            {paymentRenter && ((invoices ?? []) as any[]).some((i) => i.renterId === paymentRenter.id && i.autopayUnconfirmed === true && ['due', 'late'].includes(String(i.status))) && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-[#b45309]">
                Autopay got no answer from the card company on one of their bills, so it may already have been paid. Check your Stripe payments before recording another payment.
              </p>
            )}
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
          {payError && <p role="alert" className="text-[13px] text-[#b45309]">{payError}</p>}
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

      <RenterRefundDialog
        open={refundRenter !== null}
        onOpenChange={(o) => { if (!o) setRefundRenter(null); }}
        tenantId={tenantId || ''}
        renter={refundRenter}
        onDone={(m) => setCycleResult(m)}
      />

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
                placeholder="Supplies restock, key replacement…"
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
                    {entry.type === 'payment' && isCredit && historyRenter && (
                      <PrintLink path="/api/booths/account-statement" params={{ tenantId, renterId: historyRenter.id, receipt: entry.id }} title="Print receipt"
                        className="grid h-9 w-9 place-items-center rounded-lg border-2 bg-card text-foreground/80">
                        <Receipt className="h-3.5 w-3.5" />
                      </PrintLink>
                    )}
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
      {tenantId && <DeskOwedCard tenantId={tenantId} firestore={firestore} renters={(renters || []) as any[]} />}
      {tenantId && <RenterProvidersCard tenantId={tenantId} firestore={firestore} renters={(renters || []) as any[]} staff={(allStaff || []) as any[]} allAppointments={(allAppointments || []) as any[]} />}
      {tenantId && (
        <a href="/rental-policies" className="flex min-h-[44px] items-center justify-between gap-3 rounded-[20px] border border-[#ececee] bg-white p-5">
          <span className="min-w-0"><span className="block text-[17px] font-bold text-[#16171a]">Rental policies</span><span className="block text-[13px] leading-snug text-[#6d7075]">Lease terms, late rent, time away, charges to their card and what comes with the space, in one place.</span></span>
          <span aria-hidden className="text-[20px] text-[#6d7075]">›</span>
        </a>
      )}
      {tenantId && <RenterSwapsCard tenantId={tenantId} firestore={firestore} tenant={selectedTenant} />}
      {tenantId && <RentCommsCard tenantId={tenantId} firestore={firestore} tenant={selectedTenant} />}
      {tenantId && <LeaveCard tenantId={tenantId} firestore={firestore} tenant={selectedTenant} leaves={(renterLeaves ?? []) as any[]} leaseById={scheduleLeaseById} renterById={scheduleRenterById} reservations={(boothReservations ?? []) as any[]} />}
      </div>
    </div>
  );
}
