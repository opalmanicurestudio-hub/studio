'use client';

import {
  type Firestore, collection, onSnapshot, query, where,
} from 'firebase/firestore';
import { Check, ClipboardList, Loader, PackageCheck, ScanLine } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { permissionsFor } from '@/lib/fulfilment-access';
import {
  claimNextBatch, claimSpecificOrder, markPacked, markReady, recordItemScan,
} from '@/lib/retail-fulfill';
import {
  codesMatch, fulfilmentPolicy, parseProductQr, queuePriority, slaFor,
  type RetailOrder,
} from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

// ─── FulfilmentPanel ──────────────────────────────────────────────────────────
// The picking job, and nothing else, for someone working from the staff portal.
//
// Why a separate surface rather than "give everyone the admin app": a picker
// needs the queue, their claimed work and a scanner. They do not need revenue,
// costs, other people's pay, or the ability to cancel an order. Permissions
// decide what appears; the same engine does the work, so nothing can drift
// between this and the manager's board.
//
// THE PROCESS, in the order the buttons appear:
//   1. Take next        — claims the most urgent order (late first, then
//                         soonest promised). Scanning an unclaimed order's
//                         item also claims it, so the shelf walk IS the claim.
//   2. Walk by shelf    — claimed lines are grouped by product, so three
//                         orders wanting the same oil is one trip.
//   3. Scan every item  — each scan files itself to the right order; the last
//                         one packs it and, for pickup, marks it ready.
//   4. Hand it over     — pickup orders leave from the Ready shelf.
//
// A batch is simply "the orders you have claimed". Take next adds one; the
// claim limit for your role caps how many you can hold, so nobody can hoard
// the queue while others wait.

type BoardOrder = RetailOrder & { id: string };

export function FulfilmentPanel({
  tenantId,
  firestore,
  staffMember,
}: {
  tenantId: string;
  firestore: Firestore | null;
  staffMember: { id: string; name: string; role?: string; fulfilmentRole?: string };
}) {
  const { toast } = useToast();
  const perms = useMemo(() => permissionsFor(staffMember), [staffMember]);
  const actor = useMemo(() => ({ id: staffMember.id, name: staffMember.name }), [staffMember]);

  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tenantSettings, setTenantSettings] = useState<any>(null);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      query(
        collection(firestore, `tenants/${tenantId}/retailOrders`),
        where('stage', 'in', ['paid', 'picking', 'packed', 'ready'])
      ),
      (snap) => {
        setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as BoardOrder[]);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [firestore, tenantId]);

  const policy = useMemo(() => fulfilmentPolicy(tenantSettings), [tenantSettings]);

  const queue = useMemo(
    () => orders
      .filter((o) => o.stage === 'paid' && !o.batchId && o.holdUntilRestock !== true)
      .sort((a, b) => queuePriority(a, policy) - queuePriority(b, policy)),
    [orders, policy]
  );

  const mine = useMemo(
    () => orders.filter((o) => o.stage === 'picking' && o.assignedTo === staffMember.id),
    [orders, staffMember.id]
  );

  const shelf = useMemo(() => {
    const map = new Map<string, { productId: string; name: string; needed: number; scanned: number; orders: number[] }>();
    mine.forEach((o) => {
      (o.lines || []).forEach((l: any) => {
        const open = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
        if (open <= 0) return;
        const key = String(l.productId);
        const row = map.get(key) || { productId: key, name: String(l.name || 'Item'), needed: 0, scanned: 0, orders: [] };
        row.needed += open;
        row.scanned += Math.min(l.qtyScanned || 0, open);
        row.orders.push(Number(o.orderNumber) || 0);
        map.set(key, row);
      });
    });
    return [...map.values()].sort((a, b) => {
      const ad = a.scanned >= a.needed ? 1 : 0;
      const bd = b.scanned >= b.needed ? 1 : 0;
      return ad - bd || a.name.localeCompare(b.name);
    });
  }, [mine]);

  const takeNext = async () => {
    if (!firestore || busy) return;
    if (mine.length >= perms.claimLimit) {
      toast({
        variant: 'destructive',
        title: 'Finish what you have first',
        description: `Your role holds up to ${perms.claimLimit} order${perms.claimLimit === 1 ? '' : 's'} at a time.`,
      });
      return;
    }
    setBusy('take');
    const res = await claimNextBatch(firestore, tenantId, actor, 1);
    setBusy(null);
    if ('error' in res) toast({ variant: 'destructive', title: 'Nothing to claim', description: res.error });
  };

  const onScan = async (value: string) => {
    if (!firestore || busy) return;
    setBusy('scan');
    try {
      for (const o of mine) {
        const res = await recordItemScan(firestore, tenantId, o.id, value, actor);
        if (res.ok) {
          scanFeedback(true);
          toast({ title: `#${String(o.orderNumber).padStart(4, '0')} · ${res.message}` });
          if (res.pickComplete && perms.canPack) {
            const packed = await markPacked(firestore, tenantId, o.id, actor);
            if (packed.ok && o.method !== 'ship') await markReady(firestore, tenantId, o.id, actor);
          }
          return;
        }
      }

      // Not on anything you hold — claim the order it belongs to and count it.
      const raw = value.trim();
      const pid = parseProductQr(raw);
      const owner = queue.find((o) => (o.lines || []).some((l: any) =>
        (pid && l.productId === pid)
        || l.productId === raw
        || codesMatch(l.barcode, raw)
        || codesMatch(l.sku, raw)));

      if (owner && mine.length < perms.claimLimit) {
        const grab = await claimSpecificOrder(firestore, tenantId, owner.id, actor);
        if (!('error' in grab)) {
          const res2 = await recordItemScan(firestore, tenantId, owner.id, value, actor);
          if (res2.ok) {
            scanFeedback(true);
            toast({ title: `Claimed #${String(owner.orderNumber).padStart(4, '0')} · ${res2.message}` });
            return;
          }
        }
      }

      scanFeedback(false);
      toast({
        variant: 'destructive',
        title: 'Not on your orders',
        description: owner ? 'That order is at your claim limit — finish one first.' : 'Nothing in the queue needs this item.',
      });
    } finally {
      setBusy(null);
    }
  };

  if (!perms.canPick) {
    return (
      <div className="rounded-2xl border-2 border-dashed p-8 text-center">
        <PackageCheck className="mx-auto h-7 w-7 opacity-20" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold">Fulfilment isn&rsquo;t part of your role</p>
        <p className="mt-1 text-[11px] font-bold text-muted-foreground">Ask a manager if you should be picking orders.</p>
      </div>
    );
  }

  const remaining = shelf.reduce((a, r) => a + Math.max(0, r.needed - r.scanned), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-tight">Orders to pick</p>
          <p className="text-[11px] font-bold text-muted-foreground">
            {loading ? 'Loading…' : `${queue.length} waiting · you hold ${mine.length} of ${perms.claimLimit}`}
          </p>
        </div>
        <Button
          onClick={takeNext}
          disabled={busy === 'take' || queue.length === 0 || mine.length >= perms.claimLimit}
          className="h-12 shrink-0 rounded-xl px-5 text-[11px] font-black uppercase tracking-widest"
        >
          {busy === 'take' ? <Loader className="h-4 w-4 animate-spin" /> : 'Take next'}
        </Button>
      </div>

      {mine.length > 0 && (
        <div className="rounded-2xl border-2 border-primary/40 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Your pick — {remaining} item{remaining === 1 ? '' : 's'} to grab
            </p>
          </div>

          <ScanGate onScan={onScan} />

          {shelf.map((row) => {
            const done = row.scanned >= row.needed;
            return (
              <div key={row.productId} className={cn('flex items-center gap-3 rounded-xl border-2 p-3', done && 'opacity-50')}>
                <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2', done && 'border-primary bg-primary text-primary-foreground')}>
                  {done ? <Check className="h-3.5 w-3.5" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black uppercase tracking-tight">{row.name}</p>
                  <p className="truncate text-[11px] font-bold text-muted-foreground">
                    {row.orders.map((n) => `#${String(n).padStart(4, '0')}`).join(' · ')}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm font-bold">{row.scanned}/{row.needed}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Waiting</p>
        {!loading && queue.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-10 text-center">
            <ClipboardList className="mx-auto h-6 w-6 opacity-20" aria-hidden="true" />
            <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">Queue is clear</p>
          </div>
        )}
        {queue.slice(0, 8).map((o) => {
          const sla = slaFor(o, policy);
          return (
            <div
              key={o.id}
              className={cn('flex items-center justify-between gap-3 rounded-xl border-2 p-3',
                sla.state === 'late' && 'border-destructive/60',
                sla.state === 'due' && 'border-amber-300')}
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-black uppercase tracking-tight">
                  #{String(o.orderNumber).padStart(4, '0')} · {o.customerName}
                </p>
                <p className={cn('text-[11px] font-bold uppercase tracking-widest',
                  sla.state === 'late' ? 'text-destructive' : sla.state === 'due' ? 'text-amber-600' : 'text-muted-foreground')}>
                  {sla.label} · {(o.lines || []).length} item{(o.lines || []).length === 1 ? '' : 's'}
                </p>
              </div>
              <span className="shrink-0 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                {String(o.method || '').replace('_', ' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
