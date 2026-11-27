'use client';
// src/components/ledger/BadDebtAgingCard.tsx — FEES CLIENTS OWE (the Books tab, under the lines): every unpaid fee on a
// client (a no-show, a late cancel), how long it's been owed, and two ways to settle it:
//   Charge their card  the card they saved, through /api/stripe/charge-card (staff only, one charge per fee however often
//                      it's tapped; a declined card can be tried again). The fee is then cleared and recorded here, so
//                      the route records nothing.
//   Mark paid          paid in cash or another way.
// Either one takes the fee off the client (by its feeId, or the whole fee for older ones), adds the money to the books
// and notes it in the activity, in one write. It's everything owed now, not tied to the dates the Books tab shows.

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { doc, writeBatch, arrayRemove, collection } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { safeNumber } from '@/lib/utils';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { auditEntry } from '@/lib/audit';
import { staffAuthHeader } from '@/lib/staff-fetch';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnpaidFee {
  feeId?: string;           // stable ID — present on fees created after this update
  feeAmount: number;
  reason: string;
  appointmentDate?: string;
  createdAt?: string;
  stripeCustomerId?: string; // set on client doc if they have a card on file
  stripePaymentMethodId?: string;
}

export interface ClientWithFees {
  id: string;
  name?: string;
  email?: string;
  stripeCustomerId?: string;
  stripePaymentMethodId?: string; // default card on file
  cardOnFile?: { customerId?: string; paymentMethodId?: string; brand?: string; last4?: string }; // where a saved card lives (lib/card-save)
  unpaidFees?: UnpaidFee[];
}

interface AgingItem {
  clientId: string;
  clientName: string;
  clientEmail?: string;
  amount: number;
  reason: string;
  days: number;
  bucket: 0 | 1 | 2 | 3;
  feeObj: UnpaidFee;             // full object — used as arrayRemove key
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  hasCard: boolean;              // a saved card the charge route can use (client.cardOnFile)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const bucketOf = (days: number): 0 | 1 | 2 | 3 => {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
};

const BUCKET_LABELS = ['Up to 30 days', '31 to 60 days', '61 to 90 days', 'Over 90 days'] as const;

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// A declined card gets a fresh try next time (a new key), even after the dialog closes or the page reloads; an answer
// that never came keeps the same key, so trying again can't charge twice.
const declineCounts = new Map<string, number>();
const declinesOf = (feeKey: string): number => {
  try { const n = Number(window.localStorage.getItem(`cf-fee-declines-${feeKey}`)); if (n > 0) return n; } catch { /* storage off: this tab's count */ }
  return declineCounts.get(feeKey) || 0;
};
const noteDecline = (feeKey: string) => {
  const n = declinesOf(feeKey) + 1;
  declineCounts.set(feeKey, n);
  try { window.localStorage.setItem(`cf-fee-declines-${feeKey}`, String(n)); } catch { /* this tab's count still holds */ }
};

// ─── ChargeCardDialog ─────────────────────────────────────────────────────────
// Confirms the charge before hitting Stripe. Shows the amount, client name,
// and last 4 (if available). On confirm, charges the client's saved card through /api/stripe/charge-card (staff only,
// one charge per fee however often it's tapped); the fee is then cleared and recorded here, so the route records nothing.

const ChargeCardDialog = ({
  tenantId,
  item,
  open,
  onOpenChange,
  onSuccess,
}: {
  tenantId: string;
  item: AgingItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // v67 — the PaymentIntent ID is now threaded through so the ledger note
  // carries the Stripe reference (was fetched but dropped before).
  onSuccess: (item: AgingItem, paymentIntentId?: string) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = React.useRef(false);
  const { toast } = useToast();
  useEffect(() => { setError(null); }, [item?.feeObj]);

  const handleCharge = useCallback(async () => {
    if (!item || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const fee: any = item.feeObj || {};
      const feeKey = String(fee.feeId || `${item.clientId}-${Math.round(item.amount * 100)}-${fee.createdAt || fee.appointmentDate || ''}-${item.reason}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 110);
      const declines = declinesOf(feeKey);
      const res = await fetch('/api/stripe/charge-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) },
        body: JSON.stringify({
          tenantId,
          clientId: item.clientId,
          amountCents: Math.round(item.amount * 100),
          description: `Fee collected: ${item.reason}`,
          category: 'Fees',
          reason: item.reason,
          mode: 'pos',
          kind: 'arrears_fee',
          noLedger: true,
          idempotencyKey: `owed-fee-${feeKey}${declines ? `-r${declines}` : ''}`,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        // A clear no (a declined card, say): the next try is a new attempt. An answer that never came, or one still
        // going through, keeps the same key so trying again can't charge twice.
        if (data && !data.unknown && !['in_progress', 'unconfirmed', 'reload'].includes(String(data.code || ''))) noteDecline(feeKey);
        setError(data?.error || data?.reason || 'The card wasn’t charged. Please try again.');
        return;
      }

      // Stripe charge succeeded — parent clears Firestore + logs transaction
      onSuccess(item, data.paymentIntentId);
      onOpenChange(false);
      toast({ title: 'Card charged', description: `${fmt(item.amount)} from ${item.clientName}.` });
    } catch (e: any) {
      setError('No answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [item, onSuccess, onOpenChange, toast, tenantId]);

  if (!item) return null;
  const hasCard = item.hasCard;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl border-0 bg-[#fff] p-0 sm:max-w-sm">
        <div className="p-6" style={{ color: INK }}>
          <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>Charge {item.clientName}’s saved card</DialogTitle>
          <DialogDescription className="mt-1 text-[14px]" style={{ color: MUTED }}>{item.reason}, owed for {item.days} {item.days === 1 ? 'day' : 'days'}. The card is charged as soon as you tap.</DialogDescription>
          <div className="mt-4 rounded-2xl px-4 py-4 text-center" style={{ background: SOFT }}>
            <p className="text-[14px]" style={{ color: MUTED }}>Charge</p>
            <p className="text-[30px] font-semibold tabular-nums leading-tight">{fmt(item.amount)}</p>
          </div>
          {!hasCard && <p className="mt-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>There’s no saved card for {item.clientName}. Take the payment another way, then tap Mark paid.</p>}
          {error && <p role="alert" className="mt-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{error}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={handleCharge} disabled={loading || !hasCard} className={btn} style={solid}>{loading ? 'Charging the card' : `Charge ${fmt(item.amount)}`}</button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={loading} className={btn} style={plain}>Cancel</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── BadDebtAgingCard ─────────────────────────────────────────────────────────

interface BadDebtAgingCardProps {
  clients: ClientWithFees[];
  tenantId: string;
  /** Acting team member (from useAuditActor) — stamped on the audit
   *  entries these collections write. */
  actor?: { type: 'user'; id?: string; name?: string; role?: string };
}

export const BadDebtAgingCard = ({ clients, tenantId, actor }: BadDebtAgingCardProps) => {
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [charging, setCharging] = useState<AgingItem | null>(null);   // item in ChargeCardDialog
  const [processing, setProcessing] = useState<Set<string>>(new Set()); // feeIds being cleared

  // ── Build aging items ──────────────────────────────────────────────────────
  const { items, buckets, total } = useMemo(() => {
    const now = new Date();
    const buckets: [number, number, number, number] = [0, 0, 0, 0];
    const items: AgingItem[] = [];

    (clients || []).forEach(client => {
      (client.unpaidFees || []).forEach(fee => {
        const amt = safeNumber(fee.feeAmount);
        if (amt <= 0) return;

        const days = differenceInDays(
          now,
          safeDate(fee.appointmentDate || fee.createdAt),
        );
        const bucket = bucketOf(days);
        buckets[bucket] += amt;

        items.push({
          clientId: client.id,
          clientName: client.name || 'Unknown client',
          clientEmail: client.email,
          amount: amt,
          reason: fee.reason || 'Unpaid fee',
          days,
          bucket,
          feeObj: fee,
          // Card-on-file: fee-level fields take priority, then fall back to client-level
          stripeCustomerId: fee.stripeCustomerId || client.stripeCustomerId,
          stripePaymentMethodId: fee.stripePaymentMethodId || client.stripePaymentMethodId,
          // The charge route uses the client's saved card (cardOnFile), so that's what decides whether Charge is offered.
          hasCard: !!(client.cardOnFile?.customerId && client.cardOnFile?.paymentMethodId),
        });
      });
    });

    items.sort((a, b) => b.days - a.days);
    const total = buckets.reduce((s, n) => s + n, 0);

    return { items, buckets, total };
  }, [clients]);

  // ── Auto-expand when there are outstanding fees ────────────────────────────
  // (only once — don't fight the user's collapse choice)
  // v67 — moved from a setState-during-render pattern into an effect: same
  // behavior, none of the fragility.
  const [autoExpanded, setAutoExpanded] = useState(false);
  useEffect(() => {
    if (total > 0 && !autoExpanded) {
      setAutoExpanded(true);
      setExpanded(true);
    }
  }, [total, autoExpanded]);

  // ── Core write: remove the fee from Firestore + log a transaction ──────────
  const clearFee = useCallback(async (
    item: AgingItem,
    opts: {
      paymentMethod: string;
      stripePaymentIntentId?: string;
    },
  ) => {
    if (!firestore || !tenantId) return;

    // Use feeId if present, otherwise fall back to the full fee object
    // (Firestore arrayRemove uses deep-equality, so the full object works
    //  as long as no fields were mutated after creation)
    const removeKey = item.feeObj;

    const batch = writeBatch(firestore);

    // 1. Remove the fee from the client's unpaidFees array
    // v67 — merge-set instead of strict update: if the client doc is
    // missing (deleted client), a strict update fails the WHOLE batch —
    // including the income transaction — AFTER Stripe already charged.
    batch.set(doc(firestore, `tenants/${tenantId}/clients`, item.clientId), {
      unpaidFees: arrayRemove(removeKey),
    }, { merge: true });

    // 2. Log an income transaction so the ledger stays complete
    const txnRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
    batch.set(txnRef, {
      id: txnRef.id,
      date: new Date().toISOString(),
      description: `Fee collected: ${item.reason}`,
      clientOrVendor: item.clientName,
      clientId: item.clientId,
      type: 'income',
      context: 'Business',
      category: 'Fee Recovery',
      taxBucket: 'adjustment',
      amount: item.amount,
      paymentMethod: opts.paymentMethod,
      hasReceipt: false,
      notes: `A fee the client owed, paid after ${item.days} days.${
        opts.stripePaymentIntentId ? ` Stripe PI: ${opts.stripePaymentIntentId}` : ''
      }`,
    });

    // 3. v67 — audit entry, atomically in the same batch: collecting a debt
    // (especially charging a saved card) is a money action the owner's
    // Activity feed must show, with who did it and the Stripe reference.
    const auditRef = doc(collection(firestore, `tenants/${tenantId}/auditLogs`));
    batch.set(auditRef, {
      id: auditRef.id,
      ...auditEntry({
        action: opts.paymentMethod === 'Card on File' ? 'debt.charge_card' : 'debt.collect',
        targetType: 'transaction',
        targetId: txnRef.id,
        summary: `${opts.paymentMethod === 'Card on File' ? 'Charged their saved card' : 'Paid'}: ${item.reason}, ${item.clientName} (owed ${item.days} days)${
          opts.stripePaymentIntentId ? `, Stripe ${opts.stripePaymentIntentId}` : ''
        }`,
        amount: item.amount,
        actor: actor || { type: 'user' },
      }),
    });

    await batch.commit();
  }, [firestore, tenantId, actor]);

  // ── Mark collected (cash/check/other — no Stripe) ─────────────────────────
  const handleMarkCollected = useCallback(async (item: AgingItem) => {
    const key = item.feeObj.feeId || `${item.clientId}-${item.amount}`;
    setProcessing(prev => new Set(prev).add(key));

    try {
      await clearFee(item, { paymentMethod: 'Cash / Other' });
      toast({ title: 'Marked paid', description: `${fmt(item.amount)} from ${item.clientName} is in your books.` });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'That didn’t save', description: 'Nothing changed. Try again.' });
    } finally {
      setProcessing(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [clearFee, toast]);

  // ── Card-on-file success callback (called by ChargeCardDialog) ─────────────
  const handleCardSuccess = useCallback(async (item: AgingItem, paymentIntentId?: string) => {
    const key = item.feeObj.feeId || `${item.clientId}-${item.amount}`;
    setProcessing(prev => new Set(prev).add(key));

    try {
      await clearFee(item, {
        paymentMethod: 'Card on File',
        stripePaymentIntentId: paymentIntentId,
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'The card was charged, but your books didn’t update', description: 'Refresh the page and check the fee is gone and the money is in your books.' });
    } finally {
      setProcessing(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [clearFee, toast]);

  // (Nothing owed: nothing to show.)
  if (total === 0 && items.length === 0) return null;

  return (
    <>
      <section aria-label="Fees clients owe" className="rounded-3xl bg-[#fff] px-5 pb-3 pt-2" style={{ border: `1px solid ${LINE}`, color: INK }}>
        <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className={`flex min-h-[56px] w-full items-center justify-between gap-3 text-left ${RING}`}>
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold">Fees clients owe</span>
            <span className="block text-[14px]" style={{ color: MUTED }}>{items.length} unpaid {items.length === 1 ? 'fee' : 'fees'}, all owed now, whatever the dates above</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-[17px] font-semibold tabular-nums" style={{ color: AMBER }}>{fmt(total)}</span>
            {expanded ? <ChevronUp className="h-5 w-5" style={{ color: MUTED }} /> : <ChevronDown className="h-5 w-5" style={{ color: MUTED }} />}
          </span>
        </button>

        {expanded && (
          <div className="pb-1">
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(buckets as number[]).map((amt, i) => (
                <div key={i} className="rounded-2xl px-3 py-2" style={{ background: SOFT }}>
                  <p className="text-[13px]" style={{ color: MUTED }}>{BUCKET_LABELS[i]}</p>
                  <p className="text-[15px] font-semibold tabular-nums" style={{ color: amt > 0 ? INK : MUTED }}>{fmt(amt)}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 max-h-[420px] overflow-y-auto">
              {items.map((item, idx) => {
                const key = item.feeObj.feeId || `${item.clientId}-${item.amount}-${idx}`;
                const busy = processing.has(item.feeObj.feeId || `${item.clientId}-${item.amount}`);
                return (
                  <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" style={{ borderTop: `1px solid ${LINE}`, opacity: busy ? 0.5 : 1 }}>
                    <span className="flex min-w-[240px] flex-1 items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block">{item.clientName}</span>
                        <span className="block text-[13px]" style={{ color: item.bucket >= 2 ? AMBER : MUTED }}>{item.reason}, owed {item.days} {item.days === 1 ? 'day' : 'days'}</span>
                      </span>
                      <span className="shrink-0 pt-0.5 font-semibold tabular-nums">{fmt(item.amount)}</span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {busy ? <span role="status" className="text-[13px]" style={{ color: MUTED }}>Saving</span> : <>
                        {item.hasCard && <button type="button" onClick={() => setCharging(item)} className={btn} style={plain}>Charge their card</button>}
                        <button type="button" onClick={() => handleMarkCollected(item)} className={btn} style={plain}>Mark paid</button>
                      </>}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[13px]" style={{ color: MUTED, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>Charge their card charges the card they saved. Mark paid is for cash or another way. Either one adds the money to your books.</p>
          </div>
        )}
      </section>

      <ChargeCardDialog
        tenantId={tenantId}
        item={charging}
        open={!!charging}
        onOpenChange={o => { if (!o) setCharging(null); }}
        onSuccess={handleCardSuccess}
      />
    </>
  );
};
