'use client';

import { collection, doc, onSnapshot, orderBy, query, limit, runTransaction, type Firestore } from 'firebase/firestore';
import { getDoc, updateDoc } from 'firebase/firestore';

import { recordInventoryException } from '@/lib/inventory-exceptions';
import {
  ArrowLeft, Check, ClipboardList, ExternalLink, Loader, ShieldQuestion, X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { scoreClaimSnapshot } from '@/lib/integrity-score';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Claims desk ──────────────────────────────────────────────────────────────
// Every claim arrives with its evidence already snapshotted at open time —
// scans, photos, carrier state, prior-claim count — so review is a judgment,
// not an investigation. Approving queues the money in the order's
// pendingRefundCents (the same staff banner every refund uses); declining
// requires a written reason because the customer's email quotes it verbatim.
// After either decision the desk pings claim-notify, which emails the
// customer exactly once per decision — appealed claims come back here with
// the customer's note attached and "Appealed after decline" on the record.

type Claim = {
  id: string; orderId: string; orderNumber?: number | null;
  customerName?: string; customerEmail?: string;
  type: string; qty?: number; lineName?: string | null; lineSku?: string | null;
  description?: string | null; claimValueCents?: number;
  evidence?: any; risk?: string; riskFactors?: string[];
  status: string; resolution?: string | null; resolutionCents?: number | null;
  openedAt?: string; decidedAt?: string | null; decidedBy?: string | null; declineReason?: string | null;
  appealNote?: string | null; appealedAt?: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  missing: 'Missing item', damaged: 'Damaged', wrong_item: 'Wrong item', not_received: 'Never arrived',
};
const STATUS_META: Record<string, { label: string; cls: string }> = {
  in_review:     { label: 'In review',     cls: 'bg-amber-100 text-amber-900 border-amber-200' },
  auto_resolved: { label: 'Auto-approved', cls: 'bg-emerald-100 text-emerald-900 border-emerald-200' },
  resolved:      { label: 'Resolved',      cls: 'bg-emerald-100 text-emerald-900 border-emerald-200' },
  declined:      { label: 'Declined',      cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const money = (c?: number | null) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

export default function RetailClaimsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { toast } = useToast();

  const [claims, setClaims] = useState<Claim[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all' | 'decided'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineWhy, setDeclineWhy] = useState('');
  const [askFor, setAskFor] = useState<Record<string, string>>({});
  const [askBusy, setAskBusy] = useState<string | null>(null);
  const [approveCents, setApproveCents] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const q = query(
      collection(firestore as Firestore, `tenants/${tenantId}/retailClaims`),
      orderBy('openedAt', 'desc'),
      limit(200)
    );
    return onSnapshot(
      q,
      (snap: any) => { setClaims(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))); setLoaded(true); },
      () => setLoaded(true)
    );
  }, [firestore, tenantId]);

  const requestInfo = async (c: Claim) => {
    const text = (askFor[c.id] || '').trim();
    if (!firestore || !tenantId || !text || askBusy) return;
    setAskBusy(c.id);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/retailClaims`, c.id), {
        infoRequestText: text.slice(0, 400),
        infoRequestAt: now,
        infoRequestBy: 'staff',
      });
      fetch('/api/retail/claim-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, claimId: c.id, kind: 'info_request' }),
      }).catch(() => {});
      setAskFor({ ...askFor, [c.id]: '' });
      toast({ title: 'Request sent', description: 'The customer sees it on their order page and by email.' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not send the request' });
    } finally {
      setAskBusy(null);
    }
  };

  const decide = async (c: Claim, approve: boolean) => {
    if (!firestore || !tenantId || busy) return;
    if (!approve && !declineWhy.trim()) {
      toast({ variant: 'destructive', title: 'A decline needs a reason', description: 'The customer email quotes it word for word.' });
      return;
    }
    setBusy(c.id);
    try {
      await runTransaction(firestore as Firestore, async (txn) => {
        const claimRef = doc(firestore as Firestore, `tenants/${tenantId}/retailClaims/${c.id}`);
        const orderRef = doc(firestore as Firestore, `tenants/${tenantId}/retailOrders/${c.orderId}`);
        const [claimSnap, orderSnap] = [await txn.get(claimRef), await txn.get(orderRef)];
        if (!claimSnap.exists()) throw new Error('Claim vanished');
        const cur = claimSnap.data() as any;
        if (cur.status !== 'in_review') throw new Error('Already decided on another device');
        const now = new Date().toISOString();
        if (approve) {
          const asked = Math.max(0, Number(cur.claimValueCents) || 0);
          const edited = approveCents[c.id];
          const cents = Number.isFinite(edited) ? Math.max(0, Math.min(Math.round(edited), asked)) : asked;
          txn.update(claimRef, { status: 'resolved', resolution: 'refund', resolutionCents: cents, decidedAt: now, decidedBy: 'staff', ...(cents !== asked ? { partialOfCents: asked } : {}) });
          if (orderSnap.exists()) {
            const o = orderSnap.data() as any;
            txn.update(orderRef, { pendingRefundCents: Math.max(0, Number(o.pendingRefundCents) || 0) + cents });
          }
        } else {
          txn.update(claimRef, { status: 'declined', resolution: 'declined', decidedAt: now, decidedBy: 'staff', declineReason: declineWhy.trim().slice(0, 400) });
        }
      });
      fetch('/api/retail/claim-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, claimId: c.id }),
      }).catch(() => {});
      /* THE EXCEPTION SPINE. An approved claim IS an inventory loss — a unit
       * was consumed without producing its value — so approval records the
       * exception: reason from the claim type, responsible party and
       * recovery candidacy following from it (a never-arrived order is the
       * CARRIER's loss to reimburse, and N2's Recovery Queue starts from
       * that stamp). Landed cost resolves through the order line's product;
       * a claim whose product can't be costed records with costed:false and
       * the retail figure, honestly flagged rather than guessed. Declines
       * record nothing — a declined claim lost no inventory. Deterministic
       * id = one record no matter how many devices tapped approve. */
      if (approve && firestore) {
        void (async () => {
          try {
            const lineId = String(c.id).split('__')[2] || '';
            let productId: string | null = null;
            let costPerUnit: number | null = null;
            let retailPer: number | null = null;
            let qty = Math.max(1, Number(c.qty) || 1);
            let trackingNumber: string | null = null;
            let carrier: string | null = null;
            let insuredCents: number | null = null;
            let shippedAt: string | null = null;
            const oSnap = await getDoc(doc(firestore as Firestore, `tenants/${tenantId}/retailOrders/${c.orderId}`));
            if (oSnap.exists()) {
              const o = oSnap.data() as any;
              trackingNumber = o.trackingNumber || null;
              carrier = o.carrier || null;
              insuredCents = o.shipmentProtection ? (Number(o.shipmentProtection.insuranceCents) || 0) : null;
              shippedAt = o.completedAt || o.shipmentProtection?.decidedAt || null;
              const line = (o.lines || []).find((l: any) => l.lineId === lineId);
              if (line) {
                productId = line.productId || null;
                retailPer = Number(line.unitPriceCents) || null;
                if (productId) {
                  const iSnap = await getDoc(doc(firestore as Firestore, `tenants/${tenantId}/inventory/${productId}`));
                  if (iSnap.exists()) costPerUnit = Number((iSnap.data() as any).costPerUnit) || null;
                }
              } else if (c.type === 'not_received') {
                qty = (o.lines || []).reduce((a: number, l: any) => a + Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)), 0) || qty;
              }
            }
            await recordInventoryException(firestore as Firestore, tenantId, {
              dedupeId: `claim-${c.id}`,
              reason: c.type === 'missing' ? 'reported_missing'
                : c.type === 'damaged' ? 'reported_damaged'
                : c.type === 'wrong_item' ? 'wrong_item_shipped'
                : 'carrier_lost',
              qty,
              productId,
              sku: c.lineSku || null,
              name: c.lineName || `Order #${String(c.orderNumber ?? '').padStart(4, '0')} contents`,
              costPerUnitDollars: costPerUnit,
              retailPerUnitCents: retailPer,
              orderId: c.orderId,
              orderNumber: c.orderNumber ?? null,
              claimId: c.id,
              trackingNumber,
              carrier,
              insuredCents,
              shippedAt,
              responsibleParty: c.type === 'not_received' ? 'carrier'
                : c.type === 'wrong_item' ? 'internal' : 'unknown',
              note: c.description || null,
              photoUrls: Array.isArray((c as any).photoUrls) ? (c as any).photoUrls : [],
              recordedBy: { id: 'staff', name: 'Claims desk' },
              source: 'claims_desk',
            });
          } catch { /* the claim decision stands; the ledger view will show the gap */ }
        })();
      }
      toast({
        title: approve ? 'Approved — refund queued' : 'Declined',
        description: approve
          ? `${money(Number.isFinite(approveCents[c.id]) ? Math.min(approveCents[c.id], Number(c.claimValueCents) || 0) : c.claimValueCents)} added to the refund banner. The customer has been emailed.`
          : 'Reason saved and emailed to the customer — they can appeal once.',
      });
      setDeclineFor(null);
      setDeclineWhy('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not decide claim', description: e?.message || 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => ({
    open: claims.filter((c) => c.status === 'in_review').length,
    decided: claims.filter((c) => c.status !== 'in_review').length,
    all: claims.length,
  }), [claims]);

  const shown = useMemo(() => {
    const base = filter === 'open' ? claims.filter((c) => c.status === 'in_review')
      : filter === 'decided' ? claims.filter((c) => c.status !== 'in_review')
      : claims;
    return [...base].sort((a, b) => {
      const ar = a.status === 'in_review' ? 0 : 1;
      const br = b.status === 'in_review' ? 0 : 1;
      return ar - br || String(b.openedAt || '').localeCompare(String(a.openedAt || ''));
    });
  }, [claims, filter]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-16 sm:p-6">
      <div className="flex h-12 items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to orders board" className="h-10 w-10 shrink-0 rounded-xl">
          <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <h1 className="text-xl font-black uppercase tracking-tighter">Claims</h1>
        {counts.open > 0 && (
          <Badge className="ml-auto border-2 bg-amber-100 text-amber-900 border-amber-200 font-black text-[10px] uppercase tracking-widest">
            {counts.open} to review
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['open', 'decided', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest transition-all',
              filter === f ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary/30'
            )}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="flex justify-center py-20">
          <Loader className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading claims</span>
        </div>
      ) : shown.length === 0 ? (
        <div className="space-y-3 py-20 text-center">
          <ShieldQuestion className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {filter === 'open' ? 'Nothing waiting on you' : 'No claims yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((c) => {
            const meta = STATUS_META[c.status] || STATUS_META.in_review;
            const ev = c.evidence || {};
            const integ = scoreClaimSnapshot(ev);
            return (
              <Card key={c.id} className="rounded-2xl border-2">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black uppercase tracking-tight">
                      #{String(c.orderNumber ?? '').padStart(4, '0')} · {TYPE_LABELS[c.type] || c.type}
                    </p>
                    <Badge className={cn('border-2 font-black text-[9px] uppercase tracking-widest', meta.cls)}>{meta.label}</Badge>
                    {c.appealedAt && c.status === 'in_review' && (
                      <Badge variant="outline" className="border-2 border-amber-200 font-black text-[9px] uppercase tracking-widest text-amber-900">Appeal</Badge>
                    )}
                    {c.risk && c.status === 'in_review' && (
                      <Badge variant="outline" className="border-2 font-black text-[9px] uppercase tracking-widest">{c.risk} risk</Badge>
                    )}
                    <span
                      className={cn('rounded-lg border-2 px-2 py-0.5 font-mono text-[10px] font-black',
                        integ.grade === 'strong' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : integ.grade === 'fair' ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-red-200 bg-red-50 text-red-900')}
                      title="Evidence strength AT CLAIM TIME — a weak score means the record was thin, not that anyone is right or wrong"
                    >
                      {integ.score}
                    </span>
                    <span className="ml-auto font-mono text-sm font-black">{money(c.claimValueCents)}</span>
                  </div>

                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {c.customerName}{c.customerEmail ? ` · ${c.customerEmail}` : ''}
                    {c.lineName ? ` · ${c.lineName}${(c.qty || 1) > 1 ? ` ×${c.qty}` : ''}` : ''}
                    {(c as any).component ? ` · piece: ${(c as any).component}` : ''}
                  </p>
                  {Array.isArray((c as any).photoUrls) && (c as any).photoUrls.length > 0 && (
                    <div className="mt-2 flex gap-2">
                      {((c as any).photoUrls as string[]).slice(0, 4).map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer" aria-label="Open customer photo full size">
                          <img src={u} alt="Customer claim photo" className="h-14 w-14 rounded-lg border-2 object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {(c as any).infoRequestText && (
                    <div className="mt-2 rounded-xl border-2 border-sky-100 bg-sky-50/60 p-2.5 space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-sky-800">You asked for</p>
                      <p className="text-[11px] font-bold text-sky-900">{(c as any).infoRequestText}</p>
                      {(c as any).infoResponseText ? (
                        <p className="text-[11px] font-bold text-foreground border-t-2 border-sky-100 pt-1.5">Customer: {(c as any).infoResponseText}</p>
                      ) : (
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Waiting on the customer</p>
                      )}
                    </div>
                  )}
                  {c.status === 'in_review' && (
                    <div className="mt-2 flex gap-2">
                      <input
                        aria-label="Ask the customer for a specific document or photo"
                        placeholder="Ask for something specific — e.g. a photo of the batch code"
                        value={askFor[c.id] ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAskFor({ ...askFor, [c.id]: e.target.value })}
                        className="h-9 flex-1 rounded-xl border-2 px-2.5 text-xs font-bold"
                      />
                      <Button size="sm" variant="outline" disabled={askBusy === c.id || !(askFor[c.id] || '').trim()}
                        onClick={() => requestInfo(c)}
                        className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                        {askBusy === c.id ? 'Sending…' : 'Request'}
                      </Button>
                    </div>
                  )}
                  {c.description && <p className="text-sm font-bold leading-relaxed text-muted-foreground">&ldquo;{c.description}&rdquo;</p>}
                  {c.appealNote && (
                    <p className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-relaxed text-amber-900">
                      Appeal: &ldquo;{c.appealNote}&rdquo;
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {ev.lineScanned != null && (
                      <span className={cn('rounded-lg border-2 px-2 py-1 text-[9px] font-black uppercase tracking-widest', ev.lineScanComplete ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
                        Scanned {ev.lineScanned}
                      </span>
                    )}
                    <span className={cn('rounded-lg border-2 px-2 py-1 text-[9px] font-black uppercase tracking-widest', (ev.photoCount || 0) > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-500')}>
                      {(ev.photoCount || 0) > 0 ? `${ev.photoCount} pack photo${ev.photoCount === 1 ? '' : 's'}` : 'No pack photo'}
                    </span>
                    {(c.riskFactors || []).map((r) => (
                      <span key={r} className="rounded-lg border-2 border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-900">{r}</span>
                    ))}
                  </div>

                  {c.declineReason && (
                    <p className="text-[11px] font-bold text-muted-foreground">Declined: {c.declineReason}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button asChild size="sm" variant="outline" className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
                      <Link href={`/retail-orders/evidence/${c.orderId}`}>
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Evidence record
                      </Link>
                    </Button>
                    {c.status === 'in_review' && (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black text-muted-foreground">$</span>
                          <input
                            aria-label="Approval amount in dollars — lower it for one piece of a kit or set"
                            inputMode="decimal"
                            value={Number.isFinite(approveCents[c.id]) ? String(approveCents[c.id] / 100) : String((Number(c.claimValueCents) || 0) / 100)}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setApproveCents({ ...approveCents, [c.id]: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })}
                            className="h-9 w-20 rounded-xl border-2 bg-white px-2 text-center font-mono text-xs font-black"
                          />
                          <Button
                            size="sm"
                            disabled={busy === c.id}
                            onClick={() => decide(c, true)}
                            className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest"
                          >
                            {busy === c.id ? <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : (<><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Approve</>)}
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === c.id}
                          onClick={() => setDeclineFor(declineFor === c.id ? null : c.id)}
                          className="h-9 rounded-xl font-black uppercase text-[10px] tracking-widest text-destructive hover:text-destructive"
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Decline
                        </Button>
                      </>
                    )}
                  </div>

                  {declineFor === c.id && c.status === 'in_review' && (
                    <div className="space-y-2">
                      <Textarea
                        aria-label="Reason for declining this claim"
                        placeholder="Why — the customer's email quotes this word for word"
                        value={declineWhy}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDeclineWhy(e.target.value)}
                        className="min-h-20 rounded-xl border-2 font-bold text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === c.id}
                        onClick={() => decide(c, false)}
                        className="h-9 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest text-destructive"
                      >
                        Confirm decline
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        <ClipboardList className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
        Approvals queue money in the refund banner — nothing leaves Stripe without a person.
      </p>
    </div>
  );
}
