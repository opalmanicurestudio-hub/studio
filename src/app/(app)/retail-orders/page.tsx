'use client';

import { collection, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import {
  AlertTriangle, Car, Check, ClipboardList, Loader, Package, PackageCheck,
  PackageOpen, QrCode, RefreshCw, ScanLine, Ship, Store, Truck, X, Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  STAGE_LABELS, isPickComplete, queuePriority, type FulfillmentBatch, type OrderLine, type RetailOrder,
} from '@/lib/retail-orders';
import {
  claimNextBatch, handoffByScan, handoffWithoutScan, markPacked, markReady,
  markShipped, recordItemScan, releaseBackorder, releaseBatch, resolveShortLine,
  sweepStaleClaims, type Actor,
} from '@/lib/retail-fulfill';
import { cn } from '@/lib/utils';

// ─── Fulfillment Board ────────────────────────────────────────────────────────
// The staff-side drive-thru: Queue → Picking → Ready → Arrived, plus the
// backorder tray and pending-refund flags. Live via onSnapshot; stale claims
// auto-release from any open board every 60 seconds.

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const methodIcon = (m: string) =>
  m === 'curbside' ? Car : m === 'ship' ? Truck : Store;

type BoardOrder = RetailOrder & { id: string };

export default function RetailFulfillmentBoard() {
  const { firestore } = useFirebase();
  const { tenantId } = useTenant();
  const { user } = useUser();
  const { toast } = useToast();

  const actor: Actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );

  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [batches, setBatches] = useState<(FulfillmentBatch & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [handoffOpen, setHandoffOpen] = useState(false);
  const [shortTarget, setShortTarget] = useState<{ order: BoardOrder; line: OrderLine } | null>(null);
  const [shortReason, setShortReason] = useState('');
  const [shipTarget, setShipTarget] = useState<BoardOrder | null>(null);
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipNumber, setShipNumber] = useState('');
  const [shipUrl, setShipUrl] = useState('');
  const [noScanTarget, setNoScanTarget] = useState<BoardOrder | null>(null);
  const [verifiedBy, setVerifiedBy] = useState('');

  // ── Live subscriptions ────────────────────────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const qo = query(
      collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`),
      where('stage', 'in', ['paid', 'picking', 'packed', 'ready', 'arrived'])
    );
    const unsubO = onSnapshot(qo, (snap: any) => {
      setOrders(snap.docs.map((d: any) => ({ ...(d.data() as RetailOrder), id: d.id as string })));
      setLoading(false);
    });
    const qb = query(
      collection(firestore as Firestore, `tenants/${tenantId}/fulfillmentBatches`),
      where('active', '==', true)
    );
    const unsubB = onSnapshot(qb, (snap: any) => {
      setBatches(snap.docs.map((d: any) => ({ ...(d.data() as FulfillmentBatch), id: d.id as string })));
    });
    return () => { unsubO(); unsubB(); };
  }, [firestore, tenantId]);

  // ── Stale-claim sweep: on load + every 60s ────────────────────────────────
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const run = () => sweepStaleClaims(firestore as Firestore, tenantId).then((n: number) => {
      if (n > 0) toast({ title: 'Claims released', description: `${n} idle claim(s) returned to the queue.` });
    }).catch(() => {});
    run();
    const t = setInterval(run, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, tenantId]);

  // ── Derived lanes ─────────────────────────────────────────────────────────
  const queue = useMemo(
    () => orders.filter((o) => o.stage === 'paid' && o.holdUntilRestock !== true).sort((a, b) => queuePriority(a) - queuePriority(b)),
    [orders]
  );
  const backorders = useMemo(() => orders.filter((o) => o.stage === 'paid' && o.holdUntilRestock === true), [orders]);
  const inProgress = useMemo(() => orders.filter((o) => ['picking', 'packed'].includes(o.stage)), [orders]);
  const ready = useMemo(() => orders.filter((o) => o.stage === 'ready'), [orders]);
  const arrived = useMemo(() => orders.filter((o) => o.stage === 'arrived'), [orders]);
  const myBatch = useMemo(() => batches.find((b) => b.assignedTo === actor.id) || null, [batches, actor.id]);
  const myOrders = useMemo(
    () => (myBatch ? inProgress.filter((o) => o.batchId === myBatch.id) : []),
    [myBatch, inProgress]
  );
  const pendingRefunds = useMemo(
    () => orders.filter((o) => (o.pendingRefundCents || 0) > 0),
    [orders]
  );

  const requireCtx = () => {
    if (!firestore || !tenantId) { toast({ variant: 'destructive', title: 'Not connected' }); return null; }
    return firestore as Firestore;
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const takeNext = async () => {
    const fs = requireCtx(); if (!fs || claiming) return;
    setClaiming(true);
    const res = await claimNextBatch(fs, tenantId, actor);
    setClaiming(false);
    if ('error' in res) toast({ title: 'Queue', description: res.error });
    else toast({ title: `Claimed ${res.orderIds.length} order(s)`, description: 'Start scanning items.' });
  };

  const onPickScan = useCallback(async (value: string) => {
    const fs = requireCtx(); if (!fs) return;
    // Route the scan to whichever of my orders accepts it; mismatch on all = real mismatch.
    for (const o of myOrders.filter((x) => x.stage === 'picking')) {
      const res = await recordItemScan(fs, tenantId, o.id, value, actor);
      if (res.ok) {
        scanFeedback(true);
        toast({ title: `#${String(o.orderNumber).padStart(4, '0')} · ${res.message}`, description: res.pickComplete ? 'Pick complete — mark it packed!' : undefined });
        return;
      }
    }
    scanFeedback(false);
    toast({ variant: 'destructive', title: 'Not on your orders', description: 'That code does not match any open line in your batch.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOrders, tenantId, actor]);

  const doShort = async (resolution: 'refund' | 'backorder') => {
    const fs = requireCtx(); if (!fs || !shortTarget) return;
    const res = await resolveShortLine(fs, tenantId, shortTarget.order.id, shortTarget.line.lineId,
      shortReason.trim() || 'Shelf discrepancy', resolution, actor);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? 'Line shorted' : 'Problem', description: res.message });
    if (res.ok) { setShortTarget(null); setShortReason(''); }
  };

  const act = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    const fs = requireCtx(); if (!fs || busy) return;
    setBusy(key);
    const res = await fn();
    setBusy(null);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? res.message : 'Problem', description: res.ok ? undefined : res.message });
  };

  const onHandoffScan = useCallback(async (value: string) => {
    const fs = requireCtx(); if (!fs) return;
    const res = await handoffByScan(fs, tenantId, value, actor);
    scanFeedback(res.ok);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? 'Handed off ✓' : 'Hold on', description: res.message });
    if (res.ok) setHandoffOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, actor]);

  // ── Card ──────────────────────────────────────────────────────────────────
  const OrderCard = ({ o, children }: { o: BoardOrder; children?: React.ReactNode }) => {
    const Icon = methodIcon(o.method);
    const waiting = o.method === 'curbside' && !!o.curbside?.arrivedAt && o.stage !== 'arrived';
    return (
      <Card className={cn(
        'border-2 rounded-[1.75rem] overflow-hidden bg-white',
        o.stage === 'arrived' && 'border-primary shadow-lg shadow-primary/15',
        waiting && 'border-amber-300'
      )}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-black uppercase tracking-tight text-sm">#{String(o.orderNumber).padStart(4, '0')}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{o.customerName}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant="outline" className="h-5 px-2 font-black text-[8px] uppercase tracking-widest border-2">
                <Icon className="w-3 h-3 mr-1" />{o.method}
              </Badge>
              {o.priceTier === 'wholesale' && (
                <Badge className="h-5 px-2 bg-primary/10 text-primary border-2 border-primary/20 font-black text-[8px] uppercase tracking-widest">B2B</Badge>
              )}
            </div>
          </div>
          <p className="text-[10px] font-bold text-muted-foreground">
            {o.lines.reduce((a, l) => a + l.qtyOrdered, 0)} items · {fmt(o.totalCents)}
          </p>
          {waiting && (
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 animate-pulse">
              Customer waiting{o.curbside?.spotOrVehicle ? ` · ${o.curbside.spotOrVehicle}` : ''}
            </p>
          )}
          {o.stage === 'arrived' && (
            <p className="text-[9px] font-black uppercase tracking-widest text-primary">
              {o.curbside?.spotOrVehicle || 'Outside now'}
            </p>
          )}
          {children}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Opening the board…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/5 pb-28">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Fulfillment</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {queue.length} queued · {inProgress.length} in progress · {ready.length} ready · {arrived.length} outside
            </p>
          </div>
          <Button
            onClick={takeNext}
            disabled={claiming || !!myBatch || queue.length === 0}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20"
          >
            {claiming ? <Loader className="h-4 w-4 animate-spin" /> : <><Zap className="mr-1.5 h-4 w-4" /> Take next</>}
          </Button>
          <Button
            variant="outline"
            onClick={() => setHandoffOpen(true)}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"
          >
            <QrCode className="mr-1.5 h-4 w-4" /> Handoff
          </Button>
        </div>
        {pendingRefunds.length > 0 && (
          <div className="bg-amber-50 border-t border-amber-100">
            <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                {pendingRefunds.length} refund(s) to execute in Stripe: {pendingRefunds.map((o) => `#${o.orderNumber} ${fmt(o.pendingRefundCents || 0)}`).join(' · ')}
              </p>
            </div>
          </div>
        )}
      </header>

      {myBatch && (
        <section className="max-w-7xl mx-auto px-4 pt-5">
          <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white shadow-xl shadow-primary/10">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-primary" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Your pick — scan every item</p>
                </div>
                <Button
                  variant="ghost" size="sm"
                  className="h-8 font-black uppercase text-[9px] tracking-widest text-muted-foreground"
                  onClick={() => { const fs = requireCtx(); if (fs) releaseBatch(fs, tenantId, myBatch, 'manual', actor); }}
                >
                  <X className="mr-1 h-3 w-3" /> Release
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <ScanGate onScan={onPickScan} label="Scan item barcode, SKU label, or product QR" />
                <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                  {myOrders.map((o) => (
                    <div key={o.id} className="rounded-2xl border-2 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-black uppercase tracking-tight text-xs">#{String(o.orderNumber).padStart(4, '0')} · {o.customerName}</p>
                        <Badge variant="outline" className="h-5 px-2 font-black text-[8px] uppercase tracking-widest border-2">
                          {STAGE_LABELS[o.stage]}
                        </Badge>
                      </div>
                      {o.lines.map((l) => {
                        const doneLine = l.qtyScanned >= l.qtyOrdered || ['shorted', 'refunded', 'backordered'].includes(l.status);
                        return (
                          <div key={l.lineId} className="flex items-center gap-2">
                            <div className={cn(
                              'w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0',
                              doneLine ? 'bg-primary border-primary text-primary-foreground' : 'border-muted'
                            )}>
                              {doneLine ? <Check className="w-3.5 h-3.5" /> : null}
                            </div>
                            <p className={cn('text-[11px] font-bold flex-1 min-w-0 truncate', doneLine && 'opacity-50')}>{l.name}</p>
                            <p className="font-black font-mono text-[11px]">{l.qtyScanned}/{l.qtyOrdered}</p>
                            {!doneLine && o.stage === 'picking' && (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 px-2 font-black uppercase text-[8px] tracking-widest text-amber-600"
                                onClick={() => setShortTarget({ order: o, line: l })}
                              >
                                Short
                              </Button>
                            )}
                          </div>
                        );
                      })}
                      {o.stage === 'picking' ? (
                        <Button
                          disabled={!isPickComplete(o.lines) || busy === `pack-${o.id}`}
                          onClick={() => act(`pack-${o.id}`, () => markPacked(requireCtx() as Firestore, tenantId, o.id, actor))}
                          className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                        >
                          <PackageCheck className="mr-1.5 h-3.5 w-3.5" /> Mark packed
                        </Button>
                      ) : (
                        <Button
                          disabled={busy === `ready-${o.id}`}
                          onClick={() => act(`ready-${o.id}`, () => markReady(requireCtx() as Firestore, tenantId, o.id, actor))}
                          className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                        >
                          <Package className="mr-1.5 h-3.5 w-3.5" /> Mark ready
                        </Button>
                      )}
                    </div>
                  ))}
                  {myOrders.length === 0 && (
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center py-8">
                      Batch complete — take the next one
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <main className="max-w-7xl mx-auto px-4 py-5 grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { title: 'Queue', icon: ClipboardList, list: queue },
          { title: 'In Progress', icon: PackageOpen, list: inProgress },
          { title: 'Ready', icon: Package, list: ready },
          { title: 'Outside', icon: Car, list: arrived },
        ].map((lane) => (
          <div key={lane.title} className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <lane.icon className="w-3.5 h-3.5 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">{lane.title}</p>
              <span className="ml-auto font-black font-mono text-xs opacity-40">{lane.list.length}</span>
            </div>
            {lane.list.map((o) => (
              <OrderCard key={o.id} o={o}>
                {o.stage === 'picking' && o.batchId !== myBatch?.id && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    Picking · {batches.find((b) => b.id === o.batchId)?.assignedToName || 'claimed'}
                  </p>
                )}
                {o.stage === 'packed' && (
                  <Button
                    disabled={busy === `ready-${o.id}`}
                    onClick={() => act(`ready-${o.id}`, () => markReady(requireCtx() as Firestore, tenantId, o.id, actor))}
                    className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                  >
                    Mark ready
                  </Button>
                )}
                {o.stage === 'ready' && o.method === 'ship' && (
                  <Button
                    onClick={() => { setShipTarget(o); setShipCarrier(''); setShipNumber(''); setShipUrl(''); }}
                    className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                  >
                    <Ship className="mr-1.5 h-3.5 w-3.5" /> Mark shipped
                  </Button>
                )}
                {['ready', 'arrived'].includes(o.stage) && o.method !== 'ship' && (
                  <Button
                    variant="outline"
                    onClick={() => { setNoScanTarget(o); setVerifiedBy(''); }}
                    className="w-full h-8 rounded-xl font-black uppercase text-[8px] tracking-widest border-2 text-muted-foreground"
                  >
                    Hand off without scan
                  </Button>
                )}
              </OrderCard>
            ))}
            {lane.list.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed py-8 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest opacity-30">Empty</p>
              </div>
            )}
          </div>
        ))}
      </main>

      {backorders.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 pb-6 space-y-3">
          <div className="flex items-center gap-2 px-1">
            <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Backorders — waiting on restock</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {backorders.map((o) => (
              <OrderCard key={o.id} o={o}>
                <Button
                  disabled={busy === `bo-${o.id}`}
                  onClick={() => act(`bo-${o.id}`, () => releaseBackorder(requireCtx() as Firestore, tenantId, o.id, actor))}
                  variant="outline"
                  className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2"
                >
                  Release to queue
                </Button>
              </OrderCard>
            ))}
          </div>
        </section>
      )}

      <Sheet open={handoffOpen} onOpenChange={setHandoffOpen}>
        <SheetContent side="bottom" className="rounded-t-[2rem] border-t-4 p-6">
          <SheetHeader className="text-left pb-3">
            <SheetTitle className="font-black uppercase tracking-tighter text-xl">Scan customer pickup QR</SheetTitle>
          </SheetHeader>
          {handoffOpen && <ScanGate onScan={onHandoffScan} label="Customer's pickup code from their order page" />}
        </SheetContent>
      </Sheet>

      <Dialog open={!!shortTarget} onOpenChange={(v: boolean) => !v && setShortTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 p-7">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="font-black uppercase tracking-tighter text-lg">Short this line?</DialogTitle>
            <DialogDescription className="text-xs font-bold text-muted-foreground">
              {shortTarget ? `${shortTarget.line.name} — ${shortTarget.line.qtyOrdered - shortTarget.line.qtyScanned} missing. Shelf count will be corrected automatically.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input
              placeholder="What happened? (e.g. shelf empty, damaged)"
              value={shortReason}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShortReason(e.target.value)}
              className="h-12 rounded-xl border-2 font-bold text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => doShort('refund')} className="h-12 rounded-2xl font-black uppercase text-[9px] tracking-widest">
                Refund missing
              </Button>
              <Button onClick={() => doShort('backorder')} variant="outline" className="h-12 rounded-2xl font-black uppercase text-[9px] tracking-widest border-2">
                Backorder it
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shipTarget} onOpenChange={(v: boolean) => !v && setShipTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 p-7">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="font-black uppercase tracking-tighter text-lg">
              Ship order #{shipTarget ? String(shipTarget.orderNumber).padStart(4, '0') : ''}
            </DialogTitle>
            <DialogDescription className="text-xs font-bold text-muted-foreground">
              Stock deducts the moment you confirm. Tracking is optional but shows on the customer&apos;s page instantly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input placeholder="Carrier (USPS, UPS…)" value={shipCarrier} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShipCarrier(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            <Input placeholder="Tracking number" value={shipNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShipNumber(e.target.value)} className="h-12 rounded-xl border-2 font-mono font-black text-xs" />
            <Input placeholder="Tracking URL (optional)" value={shipUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShipUrl(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-xs" />
          </div>
          <DialogFooter className="pt-3">
            <Button
              disabled={busy === 'ship'}
              onClick={() => shipTarget && act('ship', async () => {
                const r = await markShipped(requireCtx() as Firestore, tenantId, shipTarget.id,
                  { carrier: shipCarrier.trim(), number: shipNumber.trim(), url: shipUrl.trim() }, actor);
                if (r.ok) setShipTarget(null);
                return r;
              })}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest"
            >
              Confirm shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!noScanTarget} onOpenChange={(v: boolean) => !v && setNoScanTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border-4 p-7">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="font-black uppercase tracking-tighter text-lg">Hand off without scan</DialogTitle>
            <DialogDescription className="text-xs font-bold text-muted-foreground">
              For customers without their QR. This is logged as an override with your name — verify identity first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input
              placeholder="How was identity verified? (name + order #, ID…)"
              value={verifiedBy}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVerifiedBy(e.target.value)}
              className="h-12 rounded-xl border-2 font-bold text-sm"
            />
            <Button
              disabled={!verifiedBy.trim() || busy === 'noscan'}
              onClick={() => noScanTarget && act('noscan', async () => {
                const r = await handoffWithoutScan(requireCtx() as Firestore, tenantId, noScanTarget.id, verifiedBy.trim(), actor);
                if (r.ok) setNoScanTarget(null);
                return r;
              })}
              className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest"
            >
              Confirm handoff
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
