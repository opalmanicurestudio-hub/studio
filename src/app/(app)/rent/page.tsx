'use client';

import { useState, useMemo } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
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

      await addDoc(
        collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId)),
        {
          leaseId: lease?.id ?? '',
          renterId: paymentRenter.id,
          boothId: lease?.boothId ?? null,
          type: 'payment',
          status: 'paid',
          amountCents: -amountCents,
          description: `Payment — ${PAYMENT_METHODS.find((m) => m.value === paymentForm.method)?.label ?? paymentForm.method}`,
          dueDate: null,
          paidAt: paymentForm.date,
          method: paymentForm.method,
          stripePaymentIntentId: null,
          appliesToEntryIds: settledIds,
          createdBy: 'owner',
          note: paymentForm.note.trim(),
          createdAt: now,
          updatedAt: now,
        }
      );

      for (const chargeId of settledIds) {
        await updateDoc(
          doc(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId), chargeId),
          { status: 'paid', paidAt: paymentForm.date, updatedAt: now }
        );
      }

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
              const canWaive =
                entry.amountCents > 0 &&
                entry.status !== 'paid' &&
                entry.status !== 'waived' &&
                entry.status !== 'refunded';
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
                    <p className="text-xs text-muted-foreground">
                      {entry.dueDate
                        ? `Due ${entry.dueDate}`
                        : entry.paidAt
                          ? `Paid ${entry.paidAt}`
                          : entry.createdAt.slice(0, 10)}
                      {' · '}
                      {entry.status}
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
    </div>
  );
}
