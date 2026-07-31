'use client';

import {
  Car, Check, CheckCircle2, Clock, Loader, Package, PackageCheck,
  QrCode, ShoppingBag, Store, Truck, XCircle,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── /shop/[tenantId]/order/[orderId]/page.tsx ────────────────────────────────
// The customer's live order tracker — the success URL from Stripe Checkout
// lands here. Handles every stage and edge state:
//
//   placed     → "Confirming payment" (Stripe redirected before the webhook
//                landed — polls every 4s until 'paid' flips; never shows a
//                just-paid customer an unpaid order)
//   paid       → in queue, with live position
//   picking    → being picked
//   packed     → almost ready
//   ready      → BIG pickup QR + counter/curbside instructions
//   arrived    → "we're bringing it out" (curbside)
//   shipped    → tracking link when the label has one
//   handed_off / completed → receipt view
//   cancelled  → clear message + refund note
//
// Partial fulfillment is first-class: shorted/refunded lines are labeled and
// the refund total is shown. Curbside early arrival is supported — the
// "I'm here" card is available from the moment payment confirms.
//
// NOTE: requires the `qrcode` package → add "qrcode": "^1.5.4" plus
// "@types/qrcode": "^1.5.5" in devDependencies to package.json.

interface StatusLine {
  name: string; qtyOrdered: number; qtyShorted: number; unitPriceCents: number; status: string;
}
interface StatusOrder {
  id: string; orderNumber: number; stage: string; method: string; priceTier: string;
  businessName: string; poNumber: string; customerName: string;
  lines: StatusLine[];
  subtotalCents: number; taxCents: number; shippingCents: number;
  refundedCents: number; totalCents: number;
  timestamps: Record<string, string | null>;
  curbside: { arrivedAt: string | null; spotOrVehicle: string } | null;
  shipCity: string | null; trackingNumber: string | null; trackingUrl: string | null; carrier: string | null;
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const ACTIVE_POLL_MS = 4000;

export default function OrderStatusPage() {
  const params = useParams<{ tenantId: string; orderId: string }>();
  const tenantId = String(params?.tenantId || '');
  const orderId = String(params?.orderId || '');
  const { toast } = useToast();

  const [order, setOrder] = useState<StatusOrder | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [lanePosition, setLanePosition] = useState<number | null>(null);
  const [curbside, setCurbside] = useState<{ mode: string; spots: string[] }>({ mode: 'freeform', spots: [] });
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const activeRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/retail/order-status?tenantId=${tenantId}&orderId=${orderId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order not found');
      setOrder(data.order);
      setQueuePosition(data.queuePosition);
      setLanePosition(data.lanePosition ?? null);
      if (data.curbsideExperience) setCurbside(data.curbsideExperience);
      setQrValue(data.qrValue);
      activeRef.current = data.active;
      setLoadError('');
    } catch (e: any) {
      if (!order) setLoadError(e?.message || 'Could not load this order');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, orderId]);

  // Poll while active; pause when the tab is hidden.
  useEffect(() => {
    if (!tenantId || !orderId) return;
    load();
    const t = setInterval(() => {
      if (activeRef.current && document.visibilityState === 'visible') load();
    }, ACTIVE_POLL_MS);
    return () => clearInterval(t);
  }, [tenantId, orderId, load]);

  // Render the QR whenever the value changes.
  useEffect(() => {
    if (!qrValue) { setQrDataUrl(null); return; }
    QRCode.toDataURL(qrValue, { width: 480, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrValue]);

  const checkIn = async () => {
    if (!order || !qrValue || checkingIn) return;
    setCheckingIn(true);
    try {
      const qrToken = qrValue.split('order/')[1];
      const res = await fetch('/api/retail/arrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId, qrToken, spotOrVehicle: vehicle.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed');
      toast({
        title: data.early ? "We know you're here" : 'Checked in',
        description: data.early
          ? 'Your order is still being prepared — we will bring it right out when it is ready.'
          : 'Someone is on the way out with your order.',
      });
      load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Check-in problem', description: e?.message });
    } finally {
      setCheckingIn(false);
    }
  };

  if (loadError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-8 text-center bg-muted/5">
        <XCircle className="w-10 h-10 text-muted-foreground opacity-30" />
        <p className="font-black uppercase tracking-tight text-lg">Order not found</p>
        <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/5">
        <Loader className="w-8 h-8 animate-spin text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Finding your order…</p>
      </div>
    );
  }

  const isPickup = order.method === 'counter' || order.method === 'curbside';
  const isShip = order.method === 'ship';
  const checkedIn = !!order.curbside?.arrivedAt;

  // Progress model — the customer's drive-thru lane view.
  const steps = isShip
    ? [
        { id: 'paid', label: 'Confirmed' },
        { id: 'picking', label: 'Preparing' },
        { id: 'packed', label: 'Packed' },
        { id: 'shipped', label: 'Shipped' },
      ]
    : [
        { id: 'paid', label: 'Confirmed' },
        { id: 'picking', label: 'Preparing' },
        { id: 'ready', label: 'Ready' },
        { id: 'handed_off', label: 'Picked up' },
      ];
  const stageRank: Record<string, number> = {
    placed: -1, paid: 0, picking: 1, packed: isShip ? 2 : 1.5, ready: 2,
    arrived: 2.5, shipped: 3, handed_off: 3, completed: 3.5, cancelled: -2, refunded: 3.5,
  };
  const rank = stageRank[order.stage] ?? 0;

  const refundedLines = order.lines.filter((l) => l.qtyShorted > 0);

  return (
    <div className="min-h-dvh bg-muted/5 pb-20">
      <header className="bg-white border-b-2">
        <div className="max-w-lg mx-auto px-5 py-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">
              {isShip ? 'Shipping Order' : order.method === 'curbside' ? 'Curbside Order' : 'Pickup Order'}
            </p>
            <h1 className="font-black uppercase tracking-tighter text-2xl leading-none">
              Order #{String(order.orderNumber).padStart(4, '0')}
            </h1>
          </div>
          {order.priceTier === 'wholesale' && (
            <Badge className="bg-primary/10 text-primary border-2 border-primary/20 font-black text-[9px] uppercase tracking-widest">
              B2B{order.poNumber ? ` · PO ${order.poNumber}` : ''}
            </Badge>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-6 space-y-5">
        {order.stage === 'cancelled' && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-8 text-center space-y-3">
              <XCircle className="w-10 h-10 mx-auto text-destructive/60" />
              <p className="font-black uppercase tracking-tight text-lg">Order cancelled</p>
              <p className="text-sm text-muted-foreground">
                {order.refundedCents > 0
                  ? `${fmt(order.refundedCents)} was refunded to your original payment method. Refunds usually appear in 5–10 business days.`
                  : 'This order was cancelled before payment completed — nothing was charged.'}
              </p>
            </CardContent>
          </Card>
        )}

        {order.stage === 'placed' && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-8 text-center space-y-4">
              <Loader className="w-8 h-8 mx-auto animate-spin text-primary" />
              <p className="font-black uppercase tracking-tight text-lg">Confirming your payment</p>
              <p className="text-sm text-muted-foreground">
                This usually takes a few seconds and updates automatically. If you didn&apos;t finish
                checking out, you can close this page — nothing has been charged.
              </p>
            </CardContent>
          </Card>
        )}

        {rank >= 0 && order.stage !== 'cancelled' && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6">
              <div className="flex items-center">
                {steps.map((s, i) => {
                  const stepRank = stageRank[s.id] ?? i;
                  const done = rank >= stepRank;
                  const current = !done && (i === 0 || rank >= (stageRank[steps[i - 1].id] ?? i - 1));
                  return (
                    <React.Fragment key={s.id}>
                      {i > 0 && <div className={cn('flex-1 h-1 rounded-full mx-1.5', rank >= stepRank ? 'bg-primary' : 'bg-muted')} />}
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={cn(
                          'w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all',
                          done ? 'bg-primary border-primary text-primary-foreground' :
                          current ? 'border-primary text-primary animate-pulse' : 'border-muted text-muted-foreground/40'
                        )}>
                          {done ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                        </div>
                        <span className={cn('text-[8px] font-black uppercase tracking-widest', done || current ? 'text-foreground' : 'text-muted-foreground/40')}>
                          {s.label}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {order.stage === 'paid' && queuePosition != null && (
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-4">
                  {queuePosition === 1 ? "You're next in line" : `#${queuePosition} in the queue`}
                </p>
              )}
              {order.stage === 'arrived' && (
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-primary mt-4 animate-pulse">
                  {curbside.mode === 'drive_thru' && lanePosition != null
                    ? lanePosition <= 1 ? 'You&#39;re next — pull forward' : `#${lanePosition} in the lane — we&#39;re moving fast`
                    : 'We&apos;re bringing your order out now'}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {isPickup && qrDataUrl && !['handed_off', 'completed'].includes(order.stage) && (
          <Card className={cn(
            'border-2 rounded-[2rem] overflow-hidden bg-white transition-all',
            order.stage === 'ready' || order.stage === 'arrived' ? 'border-primary shadow-xl shadow-primary/10' : ''
          )}>
            <CardContent className="p-6 text-center space-y-3">
              <div className="flex items-center justify-center gap-2">
                <QrCode className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {order.stage === 'ready' || order.stage === 'arrived'
                    ? 'Show this to pick up'
                    : 'Your pickup code — ready when you are'}
                </p>
              </div>
              <img src={qrDataUrl} alt={`Pickup QR for order ${order.orderNumber}`} className="w-56 h-56 mx-auto rounded-2xl border-2" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                Backup: give your name and order #{String(order.orderNumber).padStart(4, '0')} at the counter
              </p>
            </CardContent>
          </Card>
        )}

        {order.method === 'curbside' && !['handed_off', 'completed', 'cancelled', 'placed'].includes(order.stage) && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Curbside</p>
              </div>
              {checkedIn && order.stage !== 'arrived' ? (
                <p className="text-sm font-bold text-muted-foreground">
                  We know you&apos;re here{order.curbside?.spotOrVehicle ? ` (${order.curbside.spotOrVehicle})` : ''} —
                  your order is still being prepared and we&apos;ll bring it straight out.
                  {curbside.mode === 'drive_thru' && lanePosition != null ? ` You're #${lanePosition + 1} in line.` : ''}
                </p>
              ) : order.stage === 'arrived' ? (
                <p className="text-sm font-bold text-muted-foreground">
                  Checked in{order.curbside?.spotOrVehicle ? ` — ${order.curbside.spotOrVehicle}` : ''}. Hang tight!
                </p>
              ) : (
                <>
                  {curbside.mode === 'spots' && curbside.spots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {curbside.spots.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setVehicle(s)}
                          className={cn(
                            'rounded-2xl border-2 p-3 text-[10px] font-black uppercase tracking-widest transition-all',
                            vehicle === s ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary/30'
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ) : curbside.mode === 'drive_thru' ? (
                    <p className="text-sm font-bold text-muted-foreground">
                      Pull into the pickup lane, then tap below — you&apos;ll see your live spot in line.
                    </p>
                  ) : (
                    <Input
                      placeholder="Spot number or car description"
                      value={vehicle}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVehicle(e.target.value)}
                      className="h-12 rounded-xl border-2 font-bold text-sm"
                    />
                  )}
                  <Button
                    disabled={checkingIn || (curbside.mode === 'spots' && curbside.spots.length > 0 && !vehicle)}
                    onClick={checkIn}
                    className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20"
                  >
                    {checkingIn ? <Loader className="h-4 w-4 animate-spin" /> : curbside.mode === 'drive_thru' ? "I'm in the lane" : "I'm here"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {isShip && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-2">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Shipping to {order.shipCity || 'you'}
                </p>
              </div>
              {order.trackingNumber ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-black text-xs truncate">{order.carrier ? `${order.carrier} · ` : ''}{order.trackingNumber}</p>
                  {order.trackingUrl && (
                    <Button asChild variant="outline" size="sm" className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest border-2">
                      <a href={order.trackingUrl} target="_blank" rel="noreferrer">Track</a>
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm font-bold text-muted-foreground">
                  Tracking will appear here as soon as your order ships.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {['handed_off', 'completed'].includes(order.stage) && (
          <Card className="border-2 border-green-200 rounded-[2rem] overflow-hidden bg-green-50/50">
            <CardContent className="p-6 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 mx-auto text-green-600" />
              <p className="font-black uppercase tracking-tight">
                {isShip ? 'Delivered — enjoy!' : 'Picked up — enjoy!'}
              </p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Thanks, {order.customerName.split(' ')[0]}
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your items</p>
            </div>
            <div className="space-y-2.5">
              {order.lines.map((l, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black uppercase tracking-tight text-xs">
                      {l.qtyOrdered - l.qtyShorted > 0 ? `${l.qtyOrdered - l.qtyShorted} × ` : ''}{l.name}
                    </p>
                    {l.qtyShorted > 0 && (
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                        {l.status === 'backordered'
                          ? `${l.qtyShorted} on backorder — ships separately`
                          : `${l.qtyShorted} unavailable — refunded`}
                      </p>
                    )}
                  </div>
                  <p className="font-black font-mono text-xs shrink-0">{fmt(l.unitPriceCents * (l.qtyOrdered - l.qtyShorted))}</p>
                </div>
              ))}
            </div>
            <Separator />
            <div className="space-y-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{fmt(order.subtotalCents)}</span></div>
              {order.taxCents > 0 && <div className="flex justify-between"><span>Tax</span><span className="font-mono">{fmt(order.taxCents)}</span></div>}
              {order.shippingCents > 0 && <div className="flex justify-between"><span>Shipping</span><span className="font-mono">{fmt(order.shippingCents)}</span></div>}
              {order.refundedCents > 0 && (
                <div className="flex justify-between text-amber-600"><span>Refunded</span><span className="font-mono">-{fmt(order.refundedCents)}</span></div>
              )}
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[10px] font-black uppercase tracking-widest">Total paid</span>
              <span className="font-black font-mono text-lg text-primary">{fmt(order.totalCents)}</span>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
