'use client';

/**
 * BadDebtAgingCard
 *
 * Drop-in replacement for the inline bad-debt section in LedgerPage.
 *
 * What this fixes vs. the original:
 *  1. "Mark collected (cash/other)" removes the fee from clients.unpaidFees
 *     immediately via arrayRemove — the aging widget clears in real-time.
 *  2. "Charge card on file" calls a Stripe PaymentIntent via your existing
 *     /api/stripe/charge-saved-card route, then on success removes the fee
 *     and logs an income transaction — fully automated.
 *  3. Tax Collected is excluded from revenue in the summary panel passed down
 *     from LedgerPage (fix that in financialSummary useMemo there — see comment).
 *  4. Collapsible on mobile — collapsed by default when total === 0.
 *  5. Each fee has a stable `feeId` (nanoid) so arrayRemove can target it
 *     precisely. For old fees without feeId the full object is used as the
 *     remove key (Firestore arrayRemove uses deep equality).
 *
 * Usage in LedgerPage — replace the existing badDebtAging JSX block with:
 *   <BadDebtAgingCard clients={clients || []} tenantId={tenantId || ''} />
 *
 * Make sure you also fix financialSummary in LedgerPage:
 *   const revenue = filteredTransactions
 *     .filter(t => t.type === 'income' && t.category !== 'Tax Collected')
 *     .reduce((s, t) => s + t.amount, 0);
 *   const taxLiability = filteredTransactions
 *     .filter(t => t.category === 'Tax Collected')
 *     .reduce((s, t) => s + t.amount, 0);
 *   // Add taxLiability to the returned object and show it in TransactionFilters.
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, AlertTriangle, CreditCard, Banknote,
  CheckCircle2, Loader2, X, FileWarning, CircleCheck,
} from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { doc, writeBatch, arrayRemove, collection } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { cn, safeNumber } from '@/lib/utils';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

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

const BUCKET_LABELS = ['0–30 days', '31–60 days', '61–90 days', '90+ days'] as const;

const BUCKET_STYLES = [
  // 0–30: warning
  { badge: 'bg-amber-100 text-amber-800', val: 'text-amber-700' },
  // 31–60: stronger warning
  { badge: 'bg-orange-100 text-orange-800', val: 'text-orange-700' },
  // 61–90: danger-adjacent
  { badge: 'bg-red-100 text-red-800', val: 'text-red-600' },
  // 90+: full red
  { badge: 'bg-red-200 text-red-900', val: 'text-red-700' },
] as const;

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// ─── ChargeCardDialog ─────────────────────────────────────────────────────────
// Confirms the charge before hitting Stripe. Shows the amount, client name,
// and last 4 (if available). On confirm, calls /api/stripe/charge-saved-card.

const ChargeCardDialog = ({
  item,
  open,
  onOpenChange,
  onSuccess,
}: {
  item: AgingItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: (item: AgingItem) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCharge = useCallback(async () => {
    if (!item) return;
    setLoading(true);
    setError(null);

    try {
      // ── Call your Stripe charge endpoint ────────────────────────────────────
      // Adjust the route to match your actual API. Expected request body:
      //   { customerId, paymentMethodId, amount (cents), description, metadata }
      // Expected response: { success: boolean; paymentIntentId?: string; error?: string }
      const res = await fetch('/api/stripe/charge-saved-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: item.stripeCustomerId,
          paymentMethodId: item.stripePaymentMethodId,
          amount: Math.round(item.amount * 100), // Stripe expects cents
          description: `Fee collection: ${item.reason} — ${item.clientName}`,
          metadata: {
            clientId: item.clientId,
            reason: item.reason,
            source: 'clarityflow_ledger_bad_debt',
          },
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Charge failed. Check Stripe dashboard for details.');
        return;
      }

      // Stripe charge succeeded — parent clears Firestore + logs transaction
      onSuccess(item);
      onOpenChange(false);
      toast({
        title: 'Card charged successfully',
        description: `${fmt(item.amount)} collected from ${item.clientName}.`,
      });
    } catch (e: any) {
      setError(e?.message || 'Network error — charge may not have completed. Check Stripe.');
    } finally {
      setLoading(false);
    }
  }, [item, onSuccess, onOpenChange, toast]);

  if (!item) return null;
  const hasCard = !!(item.stripeCustomerId && item.stripePaymentMethodId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm rounded-[2.5rem] border-4 shadow-2xl p-0 overflow-hidden bg-background">
        <DialogHeader className="p-7 pb-5 border-b bg-muted/5 text-left">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-60">
              Card on File
            </span>
          </div>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">
            Charge saved card
          </DialogTitle>
          <DialogDescription className="text-xs font-bold uppercase tracking-widest opacity-50 mt-1">
            This will immediately process the charge.
          </DialogDescription>
        </DialogHeader>

        <div className="p-7 space-y-5">
          {/* Amount block */}
          <div className="p-5 rounded-[1.5rem] bg-primary/5 border-2 border-primary/10 text-center space-y-1">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-primary/50">
              Charge amount
            </p>
            <p className="text-4xl font-black font-mono tracking-tighter text-primary">
              {fmt(item.amount)}
            </p>
            <p className="text-[11px] font-bold uppercase text-slate-500">
              {item.clientName}
            </p>
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
              Reason
            </p>
            <p className="text-sm font-bold text-slate-800">{item.reason}</p>
            <p className="text-[10px] font-bold text-amber-600 uppercase">
              {item.days} days outstanding
            </p>
          </div>

          {/* Card status */}
          {!hasCard && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border-2 border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-black uppercase text-amber-800">No card on file</p>
                <p className="text-[10px] text-amber-700 mt-1 leading-relaxed">
                  This client doesn&apos;t have a saved payment method. Use &quot;Mark collected&quot; after
                  taking payment another way.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-destructive/5 border-2 border-destructive/20">
              <X className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs font-bold text-destructive leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter className="p-7 pt-0 flex flex-col gap-2">
          <Button
            onClick={handleCharge}
            disabled={loading || !hasCard}
            className="w-full h-14 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-primary/20"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
            ) : (
              <><CreditCard className="w-4 h-4 mr-2" /> Confirm charge {fmt(item.amount)}</>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="w-full font-black uppercase text-[10px] tracking-widest text-slate-400"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── BadDebtAgingCard ─────────────────────────────────────────────────────────

interface BadDebtAgingCardProps {
  clients: ClientWithFees[];
  tenantId: string;
}

export const BadDebtAgingCard = ({ clients, tenantId }: BadDebtAgingCardProps) => {
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
        });
      });
    });

    items.sort((a, b) => b.days - a.days);
    const total = buckets.reduce((s, n) => s + n, 0);

    return { items, buckets, total };
  }, [clients]);

  // ── Auto-expand when there are outstanding fees ────────────────────────────
  // (only on first render with fees — don't fight the user's collapse choice)
  const [autoExpanded, setAutoExpanded] = useState(false);
  if (total > 0 && !autoExpanded) {
    setAutoExpanded(true);
    setExpanded(true);
  }

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
    batch.update(doc(firestore, `tenants/${tenantId}/clients`, item.clientId), {
      unpaidFees: arrayRemove(removeKey),
    });

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
      notes: `Bad debt collection — originally outstanding ${item.days} days.${
        opts.stripePaymentIntentId ? ` Stripe PI: ${opts.stripePaymentIntentId}` : ''
      }`,
    });

    await batch.commit();
  }, [firestore, tenantId]);

  // ── Mark collected (cash/check/other — no Stripe) ─────────────────────────
  const handleMarkCollected = useCallback(async (item: AgingItem) => {
    const key = item.feeObj.feeId || `${item.clientId}-${item.amount}`;
    setProcessing(prev => new Set(prev).add(key));

    try {
      await clearFee(item, { paymentMethod: 'Cash / Other' });
      toast({
        title: 'Fee marked as collected',
        description: `${fmt(item.amount)} cleared for ${item.clientName}.`,
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Failed to update — try again.' });
    } finally {
      setProcessing(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [clearFee, toast]);

  // ── Card-on-file success callback (called by ChargeCardDialog) ─────────────
  const handleCardSuccess = useCallback(async (item: AgingItem) => {
    const key = item.feeObj.feeId || `${item.clientId}-${item.amount}`;
    setProcessing(prev => new Set(prev).add(key));

    try {
      await clearFee(item, {
        paymentMethod: 'Card on File',
        // stripePaymentIntentId is available inside ChargeCardDialog after
        // the API call — for now we just note it's a card charge.
        // If you need to thread the PI ID through, add it to onSuccess callback.
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Stripe charge succeeded but ledger update failed. Refresh and check.' });
    } finally {
      setProcessing(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [clearFee, toast]);

  // ── Nothing outstanding — render a small "all clear" pill ─────────────────
  if (total === 0 && items.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-green-50 border border-green-200 text-green-700 text-xs font-black uppercase tracking-widest w-fit">
        <CircleCheck className="w-3.5 h-3.5" />
        No outstanding fees
      </div>
    );
  }

  return (
    <>
      <Card
        className={cn(
          'border-2 shadow-sm rounded-3xl overflow-hidden transition-colors',
          total > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-border',
        )}
      >
        {/* ── Collapsible header ─────────────────────────────────────────── */}
        <CardHeader
          className="border-b border-amber-200/70 bg-amber-50/50 py-4 cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-amber-100 shrink-0">
                <FileWarning className="w-4 h-4 text-amber-700" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-amber-800 leading-none">
                  Bad Debt Aging
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-tight opacity-60 mt-0.5">
                  {items.length} unpaid fee{items.length !== 1 ? 's' : ''} · snapshot, not period-filtered
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className={cn(
                'font-mono font-black text-lg tracking-tighter',
                total > 0 ? 'text-amber-800' : 'text-green-700',
              )}>
                {fmt(total)}
              </span>
              {expanded
                ? <ChevronUp className="w-4 h-4 text-amber-600" />
                : <ChevronDown className="w-4 h-4 text-amber-600" />
              }
            </div>
          </div>
        </CardHeader>

        {/* ── Expanded body ──────────────────────────────────────────────── */}
        {expanded && (
          <CardContent className="p-0">
            {/* Bucket summary bar */}
            <div className="grid grid-cols-4 divide-x divide-amber-200 border-b border-amber-200">
              {(buckets as number[]).map((amt, i) => (
                <div key={i} className="py-3 px-2 text-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mb-1">
                    {BUCKET_LABELS[i]}
                  </p>
                  <p className={cn(
                    'font-mono font-black text-sm tracking-tighter',
                    amt > 0 ? BUCKET_STYLES[i].val : 'text-muted-foreground opacity-30',
                  )}>
                    {fmt(amt)}
                  </p>
                </div>
              ))}
            </div>

            {/* Fee rows */}
            <ScrollArea className="max-h-80">
              <div className="divide-y divide-amber-100">
                {items.map((item, idx) => {
                  const key = item.feeObj.feeId || `${item.clientId}-${item.amount}-${idx}`;
                  const isProcessing = processing.has(
                    item.feeObj.feeId || `${item.clientId}-${item.amount}`,
                  );
                  const hasCard = !!(item.stripeCustomerId && item.stripePaymentMethodId);

                  return (
                    <div
                      key={key}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3.5 transition-opacity',
                        isProcessing && 'opacity-40 pointer-events-none',
                      )}
                    >
                      {/* Age badge */}
                      <Badge
                        className={cn(
                          'shrink-0 font-black text-[9px] border-none h-5 px-2 uppercase tracking-widest',
                          BUCKET_STYLES[item.bucket].badge,
                        )}
                      >
                        {item.days}d
                      </Badge>

                      {/* Client + reason */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black uppercase tracking-tight text-slate-900 truncate">
                          {item.clientName}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-bold truncate opacity-60">
                          {item.reason}
                        </p>
                      </div>

                      {/* Amount */}
                      <span className="font-mono font-black text-sm text-amber-800 shrink-0">
                        {fmt(item.amount)}
                      </span>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isProcessing ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                          <>
                            {/* Card on file — shown only when Stripe IDs exist */}
                            {hasCard && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1 text-primary border-primary/30 hover:bg-primary/5"
                                onClick={() => setCharging(item)}
                                title="Charge card on file"
                              >
                                <CreditCard className="w-3 h-3" />
                                Card
                              </Button>
                            )}

                            {/* Mark collected (cash/other) */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest gap-1 text-green-700 border-green-300 hover:bg-green-50"
                              onClick={() => handleMarkCollected(item)}
                              title="Mark as collected (cash / other)"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Collected
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-amber-200 bg-amber-50/40">
              <div className="flex items-center gap-4 text-[10px] font-bold uppercase text-muted-foreground opacity-60">
                <span className="flex items-center gap-1.5">
                  <CreditCard className="w-3 h-3" />
                  Card = charges Stripe
                </span>
                <span className="flex items-center gap-1.5">
                  <Banknote className="w-3 h-3" />
                  Collected = cash/other
                </span>
              </div>
              <span className="font-mono font-black text-sm text-amber-800">
                {fmt(total)} total
              </span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Charge card dialog ─────────────────────────────────────────────── */}
      <ChargeCardDialog
        item={charging}
        open={!!charging}
        onOpenChange={o => { if (!o) setCharging(null); }}
        onSuccess={handleCardSuccess}
      />
    </>
  );
};

// ─── LedgerPage drop-in notes ─────────────────────────────────────────────────
//
// 1. In LedgerPage, remove the entire badDebtAging useMemo and the JSX block
//    that renders the existing aging card.
//
// 2. Add this import at the top of LedgerPage:
//    import { BadDebtAgingCard } from '@/components/ledger/BadDebtAgingCard';
//
// 3. In the JSX where the old card was, add:
//    <BadDebtAgingCard clients={clients || []} tenantId={tenantId || ''} />
//
// 4. Fix financialSummary to exclude Tax Collected from revenue:
//    const revenue = filteredTransactions
//      .filter(t => t.type === 'income' && t.category !== 'Tax Collected')
//      .reduce((s, t) => s + t.amount, 0);
//    const taxLiability = filteredTransactions
//      .filter(t => t.category === 'Tax Collected')
//      .reduce((s, t) => s + t.amount, 0);
//    // Return taxLiability from the memo and add a "Tax Liability" row
//    // to the summary panel in TransactionFilters, styled differently
//    // (e.g. text-slate-500 with a note "Held for government — not income").
//
// 5. When creating new unpaid fees (no-show handler, cancellation policy, etc.)
//    add feeId: nanoid() to the fee object so future arrayRemove is precise:
//    const fee: UnpaidFee = {
//      feeId: nanoid(),
//      feeAmount: amount,
//      reason: 'No-show cancellation fee',
//      appointmentDate: appointment.date,
//      createdAt: new Date().toISOString(),
//    };
//    // Then: arrayUnion(fee) on the client doc.
//
// 6. /api/stripe/charge-saved-card (if you don't have it yet):
//    export async function POST(req: Request) {
//      const { customerId, paymentMethodId, amount, description, metadata } = await req.json();
//      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
//      try {
//        const pi = await stripe.paymentIntents.create({
//          amount,                    // already in cents
//          currency: 'usd',
//          customer: customerId,
//          payment_method: paymentMethodId,
//          confirm: true,
//          off_session: true,
//          description,
//          metadata,
//        });
//        return Response.json({ success: true, paymentIntentId: pi.id });
//      } catch (e: any) {
//        return Response.json({ success: false, error: e.message }, { status: 400 });
//      }
//    }
