'use client';

import { useState, useMemo } from 'react';
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
};

// Rent notifications — the per-business comms knobs the crons read
// (tenants/{t}.rentComms). Late-fee amounts and grace stay per-lease.
function RentCommsCard({ tenantId, firestore, tenant }: { tenantId: string; firestore: any; tenant: any }) {
  const [cfg, setCfg] = useState<any>({ ...RENT_COMMS_DEFAULTS, ...(tenant?.rentComms || {}) });
  const [saved, setSaved] = useState(false);
  const flip = (k: string) => setCfg((c: any) => ({ ...c, [k]: c[k] === false ? true : !c[k] }));
  const save = async () => {
    try {
      await updateDoc(doc(firestore, `tenants/${tenantId}`), {
        rentComms: { ...cfg, remindLeadDays: Math.min(7, Math.max(1, Number(cfg.remindLeadDays) || 3)) },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('rent notification settings save failed', e);
    }
  };
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
        <Button onClick={save} className="mt-2 w-full rounded-2xl font-black uppercase tracking-widest">{saved ? 'Saved \u2713' : 'Save notification settings'}</Button>
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

  if (!tenantId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading your studio…
      </div>
    );
  }

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

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CircleDollarSign className="h-6 w-6" />
            Rent
          </h1>
          <p className="text-sm text-muted-foreground">
            Who is paid up, who is behind, and what is due.
          </p>
        </div>
        <Button onClick={runRentCycle} disabled={running || ledgerLoading}>
          <PlayCircle className="h-4 w-4 mr-2" />
          {running ? 'Running…' : 'Run rent cycle'}
        </Button>
      </div>

      {cycleResult && (
        <p className="text-sm text-muted-foreground">{cycleResult}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Collected this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCents(summary.collectedThisCycleCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCents(summary.outstandingCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Past due
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary.pastDueRenterIds.length}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}
                renter{summary.pastDueRenterIds.length === 1 ? '' : 's'}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vacant booths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.vacantBooths}</p>
          </CardContent>
        </Card>
      </div>

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
        {rosterRenters.map((renter) => {
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
            <Card key={renter.id}>
              <CardContent className="py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
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
                    <p className="text-sm text-muted-foreground">
                      {booth ? booth.name : 'No active lease'}
                      {lease &&
                        ` — ${formatCents(lease.rentAmountCents)} / ${FREQUENCY_LABELS[lease.frequency].toLowerCase()}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Balance</p>
                      <p className={cn('text-lg font-semibold', balanceClass)}>
                        {formatCents(Math.max(balance, 0))}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => openPaymentDialog(renter)}
                        disabled={balance <= 0}
                      >
                        <HandCoins className="h-3.5 w-3.5 mr-1.5" />
                        Record payment
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setChargeForm({
                            description: '',
                            amountDollars: '',
                            dueDate: todayIso,
                          });
                          setChargeRenter(renter);
                        }}
                      >
                        <Receipt className="h-3.5 w-3.5 mr-1.5" />
                        Add charge
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryRenter(renter)}
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
      {tenantId && <RenterProvidersCard tenantId={tenantId} firestore={firestore} renters={(renters || []) as any[]} staff={(allStaff || []) as any[]} allAppointments={(allAppointments || []) as any[]} />}
      {tenantId && <RentCommsCard tenantId={tenantId} firestore={firestore} tenant={selectedTenant} />}
    </div>
  );
}
