'use client';

import { type Firestore, collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Loader, PackageCheck, ScanLine, WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { permissionsFor } from '@/lib/fulfilment-access';
import {
  handoffWithoutScan, markPacked, markReady, recordItemScan, resolveShortLine,
} from '@/lib/retail-fulfill';
import { codesMatch, parseProductQr, slaFor, fulfilmentPolicy } from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

// ─── Pack bench ───────────────────────────────────────────────────────────────
// One order at a time, at a table, with both hands busy.
//
// Picking proves you took the right things off the shelf; packing proves the
// right things went into the right box. Those are different guarantees, which
// is why every item is scanned again here even after a wave pick — a mis-sort
// between tote and box is the most expensive error in fulfilment and the
// cheapest one to catch at this exact moment.
//
// Scenarios this screen is built around, rather than patched for later:
//   • Order cancelled after it was picked → loud banner, packing blocked, the
//     tote is released instead of a dead box being taped shut.
//   • Item missing from the tote → short it here; the order continues and the
//     refund is queued rather than the bench stalling.
//   • Wrong item scanned → the engine refuses and says which order it belongs
//     to; nothing is silently accepted.
//   • Signal drops → scanning and packing keep working (Firestore queues the
//     writes); only buying a label needs the network, and the screen says so.
//   • Someone else packed it → the live subscription moves it out from under
//     you and advances to the next tote rather than showing a stale order.
//   • Permissions → packing needs canPack, buying a label needs canShip, and
//     the buttons are simply absent otherwise.

type BenchOrder = any;

export default function PackBenchPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { inventory } = useInventory();
  const { user } = useUser();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id || '';

  const [orders, setOrders] = useState<BenchOrder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [shortTarget, setShortTarget] = useState<{ lineId: string; name: string } | null>(null);

  const actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );
  const perms = useMemo(() => {
    const staff = (selectedTenant as any)?.staffMember || { role: (selectedTenant as any)?.role || 'staff' };
    return permissionsFor(staff);
  }, [selectedTenant]);
  const policy = useMemo(
    () => fulfilmentPolicy((selectedTenant as any)?.retailSettings),
    [selectedTenant]
  );

  useEffect(() => {
    const set = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    set();
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => {
      window.removeEventListener('online', set);
      window.removeEventListener('offline', set);
    };
  }, []);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      query(
        collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`),
        where('stage', 'in', ['picking', 'packed', 'cancelled'])
      ),
      (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    return unsub;
  }, [firestore, tenantId]);

  const photoFor = useMemo(() => {
    const map = new Map<string, string>();
    (inventory || []).forEach((i: any) => {
      const url = (Array.isArray(i.imageUrls) && i.imageUrls.find((u: any) => typeof u === 'string' && u.trim()))
        || (typeof i.imageUrl === 'string' && i.imageUrl.trim() ? i.imageUrl : '');
      if (url) map.set(i.id, String(url));
    });
    return map;
  }, [inventory]);

  // The bench queue: tote order when the order came from a wave, then the rest
  // oldest first. Cancelled orders stay visible only while they are the one on
  // the table, so nobody tapes shut a box for an order that no longer exists.
  const queue = useMemo(
    () => orders
      .filter((o) => ['picking', 'packed'].includes(String(o.stage)))
      .sort((a, b) => {
        const at = Number(a.waveTote) || 9999;
        const bt = Number(b.waveTote) || 9999;
        return at - bt || String(a.paidAt || a.placedAt || '').localeCompare(String(b.paidAt || b.placedAt || ''));
      }),
    [orders]
  );

  const active: BenchOrder | null = useMemo(
    () => orders.find((o) => o.id === activeId) || null,
    [orders, activeId]
  );

  useEffect(() => {
    // Nothing selected, or the selected order left the bench (someone else
    // packed it, or it was cancelled and closed) — advance rather than stall.
    if (!activeId && queue.length > 0) setActiveId(queue[0].id);
    if (activeId && !orders.some((o) => o.id === activeId)) setActiveId(queue[0]?.id || null);
  }, [activeId, queue, orders]);

  const lines: any[] = active?.lines || [];
  const remaining = lines.reduce(
    (a, l) => a + Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0) - (l.qtyScanned || 0)), 0
  );
  const allScanned = active ? remaining === 0 : false;
  const isCancelled = active ? ['cancelled', 'refunded'].includes(String(active.stage)) : false;

  const nextTote = () => {
    const idx = queue.findIndex((o) => o.id === activeId);
    setActiveId(queue[(idx + 1) % Math.max(1, queue.length)]?.id || null);
  };

  const onScan = async (value: string) => {
    if (!firestore || !active || busy) return;
    if (isCancelled) {
      scanFeedback(false);
      toast({ variant: 'destructive', title: 'This order was cancelled', description: 'Put the items back and move to the next tote.' });
      return;
    }
    setBusy('scan');
    try {
      const res = await recordItemScan(firestore as Firestore, tenantId, active.id, value, actor);
      if (res.ok) {
        scanFeedback(true);
        toast({ title: res.message });
        return;
      }

      // Not on this order — say where it actually belongs rather than "no".
      const raw = value.trim();
      const pid = parseProductQr(raw);
      const elsewhere = queue.find((o) => o.id !== active.id && (o.lines || []).some((l: any) =>
        (pid && l.productId === pid) || codesMatch(l.barcode, raw) || codesMatch(l.sku, raw)));
      scanFeedback(false);
      toast({
        variant: 'destructive',
        title: elsewhere ? `That belongs to #${String(elsewhere.orderNumber).padStart(4, '0')}` : 'Not on this order',
        description: elsewhere
          ? `Tote ${elsewhere.waveTote ?? '—'} — put it back and finish this one first.`
          : res.message,
      });
    } finally {
      setBusy(null);
    }
  };

  const act = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    if (busy) return;
    setBusy(key);
    const res = await fn();
    setBusy(null);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.message });
    return res;
  };

  if (!perms.canPack) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <PackageCheck className="mx-auto h-8 w-8 opacity-20" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold">Packing isn&rsquo;t part of your role</p>
        <p className="mt-1 text-[11px] font-bold text-muted-foreground">Pickers can still claim and scan from the board.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/5 pb-28 station-mode">
      <header className="sticky top-0 z-30 border-b-2 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back to orders" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black uppercase leading-none tracking-tighter">Pack bench</h1>
            <p className="mt-0.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {queue.length} order{queue.length === 1 ? '' : 's'} waiting to be packed
            </p>
          </div>
          {!online && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-800">
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Offline
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {!active && (
          <div className="rounded-[2rem] border-2 border-dashed py-20 text-center">
            <PackageCheck className="mx-auto h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold">Nothing on the bench</p>
            <p className="mt-1 text-[11px] font-bold text-muted-foreground">Picked orders appear here in tote order.</p>
          </div>
        )}

        {active && (
          <>
            {isCancelled && (
              <div className="flex items-start gap-3 rounded-2xl border-2 border-destructive/50 bg-destructive/[0.05] p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-tight text-destructive">Cancelled while it was being picked</p>
                  <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                    Return the items to stock and free the tote — don&rsquo;t pack this one.
                  </p>
                </div>
              </div>
            )}

            <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-2xl font-bold leading-none">
                      #{String(active.orderNumber).padStart(4, '0')}
                    </p>
                    <p className="mt-1 truncate text-xs font-black uppercase tracking-tight">{active.customerName}</p>
                    <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      {String(active.method || '').replace('_', ' ')}
                      {active.waveTote ? ` · tote ${active.waveTote}` : ''}
                      {active.stage === 'packed' ? ' · packed' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-xl font-bold leading-none">{remaining}</p>
                    <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">left to scan</p>
                  </div>
                </div>

                {!isCancelled && !allScanned && <ScanGate onScan={onScan} />}

                <div className="space-y-2">
                  {lines.map((l: any) => {
                    const need = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
                    const done = (l.qtyScanned || 0) >= need && need > 0;
                    const shorted = (l.qtyShorted || 0) > 0;
                    return (
                      <div key={l.lineId} className={cn('flex items-center gap-3 rounded-2xl border-2 p-3', done && 'opacity-50')}>
                        {photoFor.get(l.productId) ? (
                          <img src={photoFor.get(l.productId)} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl border object-cover" />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded-xl border bg-muted/30" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black uppercase tracking-tight">{l.name}</p>
                          {l.optionsLabel ? (
                            <p className="truncate text-[11px] font-black uppercase tracking-widest text-primary">{l.optionsLabel}</p>
                          ) : null}
                          {shorted ? (
                            <p className="text-[11px] font-black uppercase tracking-widest text-amber-600">
                              {l.qtyShorted} short
                            </p>
                          ) : null}
                        </div>
                        <p className="shrink-0 font-mono text-lg font-bold">
                          {l.qtyScanned || 0}/{need}
                        </p>
                        {!done && !shorted && !isCancelled && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setShortTarget({ lineId: l.lineId, name: String(l.name || 'Item') })}
                            className="h-9 shrink-0 rounded-lg text-[11px] font-black uppercase tracking-widest text-amber-600"
                          >
                            Missing
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {shortTarget && (
                  <div className="space-y-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-amber-800">
                      {shortTarget.name} isn&rsquo;t in the tote
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy === 'short'}
                        onClick={async () => {
                          if (!firestore) return;
                          await act('short', () => resolveShortLine(
                            firestore as Firestore, tenantId, active.id, shortTarget.lineId,
                            'Not in tote at packing', 'refund', actor
                          ));
                          setShortTarget(null);
                        }}
                        className="h-10 rounded-xl text-[11px] font-black uppercase tracking-widest"
                      >
                        Refund this item
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={busy === 'short'}
                        onClick={async () => {
                          if (!firestore) return;
                          await act('short', () => resolveShortLine(
                            firestore as Firestore, tenantId, active.id, shortTarget.lineId,
                            'Not in tote at packing', 'backorder', actor
                          ));
                          setShortTarget(null);
                        }}
                        className="h-10 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest"
                      >
                        Send it later
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setShortTarget(null)}
                        className="h-10 rounded-xl text-[11px] font-black uppercase tracking-widest"
                      >
                        Keep looking
                      </Button>
                    </div>
                  </div>
                )}

                {!isCancelled && (
                  <div className="space-y-2">
                    {active.stage === 'picking' && (
                      <Button
                        disabled={!allScanned || busy === 'pack'}
                        onClick={() => firestore && act('pack', () => markPacked(firestore as Firestore, tenantId, active.id, actor))}
                        className="h-14 w-full rounded-2xl text-xs font-black uppercase tracking-widest"
                      >
                        {busy === 'pack' ? <Loader className="h-4 w-4 animate-spin" />
                          : allScanned ? 'Everything in the box — mark packed'
                          : `Scan ${remaining} more item${remaining === 1 ? '' : 's'}`}
                      </Button>
                    )}

                    {active.stage === 'packed' && active.method === 'ship' && perms.canShip && (
                      <Button asChild className="h-14 w-full rounded-2xl text-xs font-black uppercase tracking-widest">
                        <Link href="/retail-orders">Weigh &amp; buy the label</Link>
                      </Button>
                    )}

                    {active.stage === 'packed' && active.method === 'ship' && !perms.canShip && (
                      <p className="rounded-2xl border-2 border-dashed p-3 text-center text-[11px] font-bold text-muted-foreground">
                        Packed — a shipper or manager buys the label.
                      </p>
                    )}

                    {active.stage === 'packed' && active.method !== 'ship' && (
                      <Button
                        disabled={busy === 'ready'}
                        onClick={() => firestore && act('ready', () => markReady(firestore as Firestore, tenantId, active.id, actor))}
                        className="h-14 w-full rounded-2xl text-xs font-black uppercase tracking-widest"
                      >
                        {busy === 'ready' ? <Loader className="h-4 w-4 animate-spin" /> : 'On the shelf — tell the customer'}
                      </Button>
                    )}

                    {!online && active.method === 'ship' && (
                      <p className="text-center text-[11px] font-bold text-amber-700">
                        Offline: scanning and packing still save. Buying a label needs a connection.
                      </p>
                    )}
                  </div>
                )}

                <Button
                  variant="outline"
                  onClick={nextTote}
                  disabled={queue.length < 2}
                  className="h-12 w-full rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest"
                >
                  Next tote <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        {queue.length > 1 && (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Up next</p>
            {queue.filter((o) => o.id !== activeId).slice(0, 6).map((o) => {
              const sla = slaFor(o, policy);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setActiveId(o.id)}
                  className={cn('flex w-full items-center gap-3 rounded-2xl border-2 bg-white p-3 text-left',
                    sla.state === 'late' && 'border-destructive/50')}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 font-mono text-base font-bold">
                    {o.waveTote ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black uppercase tracking-tight">
                      #{String(o.orderNumber).padStart(4, '0')} · {o.customerName}
                    </span>
                    <span className={cn('block text-[11px] font-bold uppercase tracking-widest',
                      sla.state === 'late' ? 'text-destructive' : 'text-muted-foreground')}>
                      {sla.label} · {(o.lines || []).length} item{(o.lines || []).length === 1 ? '' : 's'}
                    </span>
                  </span>
                  {o.stage === 'packed' && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
