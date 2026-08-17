'use client';

import { arrayUnion, collection, doc, onSnapshot, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import {
  AlertTriangle, Car, Check, ClipboardList, Loader, Package, PackageCheck,
  History, PackageOpen, Printer, QrCode, RefreshCw, RotateCcw, ScanLine, Settings, Ship, Store, Truck, X, Zap,
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
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  STAGE_LABELS, codesMatch, parseProductQr, isPickComplete, queuePriority, type FulfillmentBatch, type OrderLine, type RetailOrder,
  fulfilmentPolicy, slaFor, type SlaInfo,
} from '@/lib/retail-orders';
import { curbsideWaitMinutes } from '@/lib/retail-orders';
import { samePickupCount } from '@/lib/retail-orders';
import { stillWaiting } from '@/lib/retail-orders';
import { curbsideWaitStats } from '@/lib/retail-orders';
import {
  cancelOrder, claimNextBatch, claimSpecificOrder, reopenShortedLine, handoffByScan, handoffWithoutScan, markBringingOut, markPacked, markReady,
  notifyCurbside,
  markShipped, recordItemScan, releaseBackorder, releaseBatch, resolveShortLine, splitReadyFromWaiting,
  sweepStaleClaims, type Actor,
} from '@/lib/retail-fulfill';
import { markRefundExecuted } from '@/lib/retail-returns';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// ─── Fulfillment Board ────────────────────────────────────────────────────────
// The staff-side drive-thru: Queue → Picking → Ready → Arrived, plus the
// backorder tray and pending-refund flags. Live via onSnapshot; stale claims
// auto-release from any open board every 60 seconds.

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const printUrl = (kind: 'packing-slip' | 'label', tenantId: string, o: { id: string; qrToken?: string }) =>
  `/print/${kind}/${tenantId}/${o.id}?t=${encodeURIComponent(o.qrToken || '')}`;

const methodIcon = (m: string) =>
  m === 'curbside' ? Car : m === 'ship' ? Truck : Store;

type BoardOrder = RetailOrder & { id: string };

export default function RetailFulfillmentBoard() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { inventory, staff } = useInventory();

  // Picking is a visual task: a thumbnail is faster to match against a shelf
  // than a name, and it catches the classic "two products, similar words"
  // mistake before it reaches the box.
  const policy = useMemo(
    () => fulfilmentPolicy((selectedTenant as any)?.retailSettings),
    [selectedTenant]
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const [batchView, setBatchView] = useState<'orders' | 'shelf'>('shelf');
  const [stationMode, setStationMode] = useState(false);

  /*
   * Where a product physically sits. The allocation system already records
   * which station or provider holds units, and items can carry a storage
   * note — so the pick line can say "Station 2" instead of leaving someone
   * to remember. Back-stock only means no hint, which is the honest answer.
   */
  const shelfFor = useMemo(() => {
    const map = new Map<string, string>();
    (inventory || []).forEach((i: any) => {
      const explicit = String(i.storageLocation || i.shelf || i.binLocation || '').trim();
      if (explicit) { map.set(i.id, explicit); return; }
      const allocs = Object.values((i.allocations && typeof i.allocations === 'object') ? i.allocations : {}) as any[];
      const held = allocs.filter((a) => a && Number(a.qty) > 0).sort((a, b) => Number(b.qty) - Number(a.qty));
      if (held.length > 0) {
        map.set(i.id, held.length > 1 ? `${held[0].name} +${held.length - 1}` : String(held[0].name || ''));
      }
    });
    return map;
  }, [inventory]);

  const photoFor = useMemo(() => {
    const map = new Map<string, string>();
    (inventory || []).forEach((i: any) => {
      const url = (Array.isArray(i.imageUrls) && i.imageUrls.find((u: any) => typeof u === 'string' && u.trim()))
        || (typeof i.imageUrl === 'string' && i.imageUrl.trim() ? i.imageUrl : '');
      if (url) map.set(i.id, String(url));
    });
    return map;
  }, [inventory]);

  const staleHours = Math.max(
    1,
    Math.floor(Number((selectedTenant as any)?.retailSettings?.readyStaleHours) || 24)
  );

  const tenantId = selectedTenant?.id || '';
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
  const [parcel, setParcel] = useState({ weightLb: '1', weightOz: '0', lengthIn: '10', widthIn: '8', heightIn: '4' });
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const packagingPresets: { id: string; name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number }[] =
    ((selectedTenant as any)?.retailSettings?.packagingPresets || []).slice(0, 8);

  /* Real product weight of an order — item.weightOz × open qty, 4oz fallback
   * per unknown unit. The box's own weight comes from the chosen preset. */
  const productWeightOz = (o: BoardOrder) => (o.lines || []).reduce((sum: number, l: any) => {
    if (l.digital === true) return sum;
    const w = Number((inventory || []).find((i: any) => i.id === l.productId)?.weightOz) || 0;
    const open = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
    return sum + (w > 0 ? w : 4) * open;
  }, 0);

  const applyPreset = (pr: { id: string; name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number }) => {
    if (!shipTarget) return;
    const total = Math.max(8, Math.ceil(productWeightOz(shipTarget) + (Number(pr.weightOz) || 0)));
    setParcel({
      weightLb: String(Math.floor(total / 16)), weightOz: String(total % 16),
      lengthIn: String(pr.lengthIn || 10), widthIn: String(pr.widthIn || 8), heightIn: String(pr.heightIn || 4),
    });
    setActivePresetId(pr.id);
    setRates([]);
  };

  const savePreset = async () => {
    if (!firestore || !tenantId || !shipTarget) return;
    const name = (window.prompt('Name this packaging (e.g. Small mailer, 8x6x4 box):') || '').trim().slice(0, 40);
    if (!name) return;
    /* The preset stores the BOX's own weight — current parcel weight minus
     * this order's product weight — so applying it to any future order adds
     * the right box weight to THAT order's products. */
    const boxOz = Math.max(0, perBoxOz() - Math.ceil(productWeightOz(shipTarget)));
    const preset = {
      id: `pkg-${Date.now()}`, name, weightOz: boxOz,
      lengthIn: Number(parcel.lengthIn) || 10, widthIn: Number(parcel.widthIn) || 8, heightIn: Number(parcel.heightIn) || 4,
    };
    try {
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), {
        'retailSettings.packagingPresets': arrayUnion(preset),
      });
      setActivePresetId(preset.id);
      toast({ title: `"${name}" saved`, description: `${preset.lengthIn}×${preset.widthIn}×${preset.heightIn} in · box weighs ${boxOz} oz — it'll be one tap on every ship dialog.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save preset', description: e?.message });
    }
  };

  const packedShipOrders = useMemo(
    () => orders.filter((o: any) => o.stage === 'packed' && o.method === 'ship'
      && o.shippingAddress && !o.trackingNumber && !o.labelUrl),
    [orders]
  );

  /* ONE TAP, EVERY LABEL. Cheapest rate per order, weights from the products
   * plus the default preset's box, same protection policy as the dialog —
   * then the print stack opens with the whole run in order-number order. */
  const buyAllLabels = async () => {
    if (bulkBusy || packedShipOrders.length === 0) return;
    setBulkBusy(true);
    try {
      const pr = packagingPresets[0];
      const res = await fetch('/api/retail/shipping-labels-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          orders: packedShipOrders.map((o: any) => ({ orderId: o.id, qrToken: o.qrToken || '' })),
          parcelDefaults: pr
            ? { lengthIn: pr.lengthIn, widthIn: pr.widthIn, heightIn: pr.heightIn, boxWeightOz: pr.weightOz }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk purchase failed');
      toast({ title: 'Labels bought', description: data.message });
      const okIds = (data.results || []).filter((r: any) => r.ok && r.labelUrl).map((r: any) => r.orderId);
      if (okIds.length > 0) {
        window.open(`/print/labels/${tenantId}?ids=${okIds.join(',')}`, '_blank');
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Bulk labels failed', description: e?.message });
    } finally {
      setBulkBusy(false);
    }
  };
  const [boxes, setBoxes] = useState(1);
  const [extraLabels, setExtraLabels] = useState<string[]>([]);
  const perBoxOz = () => Math.max(1, (Number(parcel.weightLb) || 0) * 16 + (Number(parcel.weightOz) || 0));
  const [rates, setRates] = useState<{ id: string; provider: string; service: string; amountCents: number; days: number | null }[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [buyingRate, setBuyingRate] = useState<string | null>(null);
  const [labelUrl, setLabelUrl] = useState('');
  const shippoConfigured = !!(selectedTenant as any)?.retailSettings?.shippoApiKey;
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
    () => orders.filter((o) => o.stage === 'paid' && o.holdUntilRestock !== true).sort((a, b) => queuePriority(a, policy) - queuePriority(b, policy)),
    [orders]
  );
  const backorders = useMemo(() => orders.filter((o) => o.stage === 'paid' && o.holdUntilRestock === true), [orders]);
  const inProgress = useMemo(() => orders.filter((o) => ['picking', 'packed'].includes(o.stage)), [orders]);
  const ready = useMemo(() => orders.filter((o) => o.stage === 'ready'), [orders]);

  const health = useMemo(() => {
    const active = orders.filter((o) => ['paid', 'picking', 'packed'].includes(o.stage));
    const slas = active.map((o) => slaFor(o, policy));
    return {
      late: slas.filter((x) => x.state === 'late').length,
      due: slas.filter((x) => x.state === 'due').length,
      working: active.length,
      oldest: slas.reduce((a, b) => (b.waitedMinutes > a ? b.waitedMinutes : a), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, policy, tick]);


  /*
   * The exception lane. Shorts, orders cancelled mid-pick, backorders and
   * abandoned claims each used to live in a different corner of the board, so
   * the one thing they have in common — a human has to decide something — was
   * invisible. Anything here is work that will not resolve itself.
   */
  const exceptions = useMemo(() => {
    const out: { id: string; kind: string; title: string; detail: string; tone: 'warn' | 'bad' }[] = [];
    orders.forEach((o) => {
      const num = `#${String(o.orderNumber).padStart(4, '0')}`;

      if (['cancelled', 'refunded'].includes(String(o.stage)) && (o.batchId || o.waveId)) {
        out.push({
          id: `${o.id}-dead`, kind: 'cancelled', tone: 'bad',
          title: `${num} cancelled while being picked`,
          detail: o.waveTote ? `Return the items and free tote ${o.waveTote}` : 'Return the items to stock',
        });
      }

      (o.lines || []).forEach((l: any) => {
        if ((l.qtyShorted || 0) > 0 && l.status === 'backordered') {
          out.push({
            id: `${o.id}-${l.lineId}-bo`, kind: 'backorder', tone: 'warn',
            title: `${num} · ${l.name} on backorder`,
            detail: `${l.qtyShorted} owed — release when stock lands`,
          });
        }
      });

      if ((o.pendingRefundCents || 0) > 0) {
        out.push({
          id: `${o.id}-refund`, kind: 'refund', tone: 'warn',
          title: `${num} refund queued`,
          detail: `$${((o.pendingRefundCents || 0) / 100).toFixed(2)} to process in Stripe, then mark refunded`,
        });
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, tick]);

  const staleReady = useMemo(
    () => ready.filter((o) => {
      const t = Date.parse(String((o as any).readyAt || o.placedAt || ''));
      return Number.isFinite(t) && Date.now() - t > staleHours * 3_600_000;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, staleHours, tick]
  );

  const arrived = useMemo(
    () => orders.filter((o) => o.stage === 'arrived')
      .sort((a, b) => (a.curbside?.arrivedAt || '').localeCompare(b.curbside?.arrivedAt || '')),
    [orders]
  );
  // One tick a second, so every wait clock on the board counts up without
  // each card owning a timer.
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // THE ALARM. A board nobody is looking at is a customer sitting in a car
  // park. When someone new checks in, make a noise once — not per render, not
  // per poll — and only for arrivals we haven't already announced.
  const announcedRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = arrived.filter((o) => !announcedRef.current.has(o.id));
    if (fresh.length === 0) return;
    fresh.forEach((o) => announcedRef.current.add(o.id));
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const gain = ctx.createGain();
        gain.gain.value = 0.06;
        gain.connect(ctx.destination);
        [880, 1320].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.frequency.value = freq;
          osc.connect(gain);
          osc.start(ctx.currentTime + i * 0.18);
          osc.stop(ctx.currentTime + i * 0.18 + 0.15);
        });
      }
    } catch { /* a silent board still shows the card */ }
    const o = fresh[0];
    toast({
      title: `#${String(o.orderNumber).padStart(4, '0')} is outside`,
      description: `${o.customerName}${o.curbside?.spotOrVehicle ? ` — ${o.curbside.spotOrVehicle}` : ''}. Take it out.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived.map((o) => o.id).join(',')]);

  // If a wait crosses five minutes and nobody has set off, the alert leaves
  // the building. The route sends once per order; this only has to notice.
  const escalatedRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const o of arrived) {
      if (escalatedRef.current.has(o.id)) continue;
      if ((o.curbside as any)?.bringingOutAt) continue;
      const mins = curbsideWaitMinutes(o as any, nowTick);
      if (mins === null || mins < 5) continue;
      escalatedRef.current.add(o.id);
      notifyCurbside(tenantId, o.id, 'staff_escalation' as any);
    }
  }, [arrived, nowTick, tenantId]);

  // Everyone still expecting something, in one place — because at closing
  // time the waiting people are on two different screens and neither is the
  // one you check on the way out.
  const [loungeOpen, setLoungeOpen] = useState<any[]>([]);
  useEffect(() => {
    const fs = firestore as Firestore | null;
    if (!fs || !tenantId) return;
    const unsub = onSnapshot(
      collection(fs, `tenants/${tenantId}/refreshmentRequests`),
      (snap) => setLoungeOpen(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => setLoungeOpen([]),
    );
    return () => unsub();
  }, [firestore, tenantId]);

  // Are we getting slower? The three timestamps were already being recorded;
  // this only reads them. Median as well as average, because one forgotten
  // car should not make a good week look bad.
  const waitStats = useMemo(() => curbsideWaitStats(orders as any), [orders]);

  const waitingNow = useMemo(
    () => stillWaiting(orders as any, loungeOpen as any, nowTick),
    [orders, loungeOpen, nowTick],
  );

  const myBatch = useMemo(() => batches.find((b) => b.assignedTo === actor.id) || null, [batches, actor.id]);
  const myOrders = useMemo(
    () => (myBatch ? inProgress.filter((o) => o.batchId === myBatch.id) : []),
    [myBatch, inProgress]
  );

  const shelfList = useMemo(() => {
    const map = new Map<string, {
      productId: string; name: string; photo: string;
      needed: number; scanned: number; orders: { number: number; qty: number }[];
    }>();
    myOrders.filter((o) => o.stage === 'picking').forEach((o) => {
      (o.lines || []).forEach((l: any) => {
        const open = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
        if (open <= 0) return;
        const key = String(l.productId);
        const row = map.get(key) || {
          productId: key, name: String(l.name || 'Item'), photo: photoFor.get(key) || '',
          needed: 0, scanned: 0, orders: [],
        };
        row.needed += open;
        row.scanned += Math.min(l.qtyScanned || 0, open);
        row.orders.push({ number: Number(o.orderNumber) || 0, qty: open });
        map.set(key, row);
      });
    });
    // Group the walk by where things live, so the list reads like a route
    // through the room rather than a jumble.
    return [...map.values()].sort((a, b) => {
      const ad = a.scanned >= a.needed ? 1 : 0;
      const bd = b.scanned >= b.needed ? 1 : 0;
      const al = shelfFor.get(a.productId) || 'zzz';
      const bl = shelfFor.get(b.productId) || 'zzz';
      return ad - bd || al.localeCompare(bl) || b.needed - a.needed || a.name.localeCompare(b.name);
    });
  }, [myOrders, photoFor, shelfFor]);

  const pendingRefunds = useMemo(
    () => orders.filter((o) => (o.pendingRefundCents || 0) > 0),
    [orders]
  );

  const fetchRates = async () => {
    if (!shipTarget || ratesLoading) return;
    setRatesLoading(true);
    setRates([]);
    try {
      const res = await fetch('/api/retail/shipping-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, orderId: shipTarget.id, qrToken: shipTarget.qrToken || '',
          action: 'rates',
          parcels: Array.from({ length: Math.max(1, boxes) }, () => ({
            weightOz: perBoxOz(),
            lengthIn: Number(parcel.lengthIn) || 10,
            widthIn: Number(parcel.widthIn) || 8,
            heightIn: Number(parcel.heightIn) || 4,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not fetch rates');
      setRates(data.rates || []);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Rates unavailable', description: e?.message });
    } finally {
      setRatesLoading(false);
    }
  };

  useEffect(() => {
    // Automation feel: opening the Ship dialog IS the request for rates —
    // no "Get live rates" tap needed when Shippo is connected.
    if (shipTarget && shippoConfigured && rates.length === 0 && !labelUrl && !ratesLoading) {
      fetchRates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipTarget?.id]);

  const buyLabel = async (rateId: string) => {
    if (!shipTarget || buyingRate) return;
    setBuyingRate(rateId);
    try {
      const res = await fetch('/api/retail/shipping-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, orderId: shipTarget.id, qrToken: shipTarget.qrToken || '', action: 'purchase', rateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Label purchase failed');
      setShipCarrier(data.carrier || '');
      setShipNumber(data.trackingNumber || '');
      setShipUrl(data.trackingUrl || '');
      setLabelUrl(data.labelUrl || '');
      setExtraLabels((data.extraLabelUrls || []) as string[]);
      setRates([]);
      if (data.labelUrl) window.open(data.labelUrl, '_blank');
      toast({ title: 'Label purchased', description: 'Tracking filled in — print, affix, then confirm shipped.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not buy label', description: e?.message });
    } finally {
      setBuyingRate(null);
    }
  };

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
    let specific: string | null = null;
    for (const o of myOrders.filter((x) => x.stage === 'picking')) {
      const res = await recordItemScan(fs, tenantId, o.id, value, actor);
      if (res.ok) {
        scanFeedback(true);
        if (res.pickComplete) {
          // Express flow: the last scan IS the pack. Auto-advance so a
          // pickup order needs zero admin taps between scanning and the
          // shelf — packed, then ready (which notifies the customer).
          const packed = await markPacked(fs, tenantId, o.id, actor);
          if (packed.ok && o.method !== 'ship') {
            const ready = await markReady(fs, tenantId, o.id, actor);
            toast({
              title: `#${String(o.orderNumber).padStart(4, '0')} complete`,
              description: ready.ok ? 'Packed & Ready — customer notified. On to the shelf.' : `Packed. ${ready.message}`,
            });
          } else {
            toast({
              title: `#${String(o.orderNumber).padStart(4, '0')} · ${res.message}`,
              description: packed.ok
                ? (o.method === 'ship' ? 'Packed — open Ship to buy the label.' : undefined)
                : `Pick complete. ${packed.message}`,
            });
          }
        } else {
          toast({ title: `#${String(o.orderNumber).padStart(4, '0')} · ${res.message}` });
        }
        return;
      }
      if (!specific && res.message && !res.message.includes('is not on this order')) {
        specific = `#${String(o.orderNumber).padStart(4, '0')}: ${res.message}`;
      }
    }
    if (specific) {
      scanFeedback(false);
      toast({ variant: 'destructive', title: 'Scan matched — but that line is closed', description: specific });
      return;
    }
    const raw = value.trim();
    const pid = parseProductQr(raw);
    const lineHit = (o: BoardOrder) => o.lines?.some((l: any) =>
      (pid && l.productId === pid) ||
      l.productId === raw || String(l.productId).toLowerCase() === raw.toLowerCase() ||
      codesMatch(l.barcode, raw) || codesMatch(l.sku, raw));
    const elsewhere = orders.find((o) => !['cancelled', 'refunded', 'completed'].includes(o.stage) && lineHit(o));
    if (elsewhere) {
      const num = `#${String(elsewhere.orderNumber).padStart(4, '0')}`;
      if (elsewhere.stage === 'paid' && !elsewhere.batchId) {
        const grab = await claimSpecificOrder(fs, tenantId, elsewhere.id, actor);
        if (!('error' in grab)) {
          const res2 = await recordItemScan(fs, tenantId, elsewhere.id, value, actor);
          if (res2.ok) {
            scanFeedback(true);
            toast({
              title: `Claimed ${num} \u00b7 ${res2.message}`,
              description: res2.pickComplete ? undefined : 'Scan-to-claim: the order is yours now \u2014 keep scanning.',
            });
            if (res2.pickComplete) {
              const packed2 = await markPacked(fs, tenantId, elsewhere.id, actor);
              if (packed2.ok && elsewhere.method !== 'ship') await markReady(fs, tenantId, elsewhere.id, actor);
            }
            return;
          }
        }
      }
      const why = elsewhere.stage === 'paid'
        ? `${num} is in the Queue and claimed by someone else right now.`
        : ['picking', 'packed'].includes(elsewhere.stage)
          ? `${num} is claimed by ${elsewhere.claimedByName || 'another teammate'}.`
          : `${num} is already ${elsewhere.stage} \u2014 picking is done there.`;
      scanFeedback(false);
      toast({ variant: 'destructive', title: 'Right product, different order', description: why });
      return;
    }
    scanFeedback(false);
    toast({
      variant: 'destructive',
      title: `Scanned: ${raw.slice(0, 40)}`,
      description: 'This code isn\u2019t on any open order\u2019s lines. If it IS the right product, open it in Inventory and paste this exact code into its Barcode field \u2014 it will match instantly.',
    });
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
    // How long they have actually been sitting outside. A clock beats a badge:
    // "arrived" tells you nothing at a glance, "waiting 6 min" tells you to go.
    const waitMin = curbsideWaitMinutes(o as any, nowTick);
    const onWay = o.method === 'curbside' && !!o.curbside?.onWayAt && !o.curbside?.arrivedAt;
    // One car, two orders: without this the board sends someone out twice and
    // the second trip finds an empty space.
    const sameTrip = o.method === 'curbside' && o.curbside?.arrivedAt
      ? samePickupCount(o as any, arrived as any) : 0;
    const sla: SlaInfo | null = ['paid', 'picking', 'packed'].includes(o.stage) ? slaFor(o, policy) : null;
    return (
      <Card className={cn(
        'border-2 rounded-[1.75rem] overflow-hidden bg-white',
        o.stage === 'arrived' && 'border-primary shadow-lg shadow-primary/15',
        sla?.state === 'late' && 'border-destructive/60',
        sla?.state === 'due' && 'border-amber-300',
        waiting && 'border-amber-300'
      )}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-black uppercase tracking-tight text-sm">#{String(o.orderNumber).padStart(4, '0')}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{o.customerName}</p>
              {(o.curbside as any)?.bringToVehicle && (
                <p className="mt-1 rounded-lg border-2 border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-sky-900">
                  Bring to vehicle
                  {(o.curbside as any)?.accessNote ? ` — ${(o.curbside as any).accessNote}` : ''}
                </p>
              )}
              {sameTrip > 0 && (
                <p className="mt-1 rounded-lg border-2 border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-primary">
                  +{sameTrip} more order{sameTrip === 1 ? '' : 's'} for this car — take them together
                </p>
              )}
              {waitMin !== null && (
                <p className={cn('mt-1 inline-flex items-center gap-1 rounded-lg border-2 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest',
                  waitMin >= 5 ? 'border-destructive/50 bg-destructive/10 text-destructive'
                    : waitMin >= 3 ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-primary/40 bg-primary/5 text-primary')}>
                  <Car className="h-3 w-3" aria-hidden="true" />
                  Outside {waitMin === 0 ? 'just now' : `${waitMin} min`}
                  {o.curbside?.spotOrVehicle ? ` · ${o.curbside.spotOrVehicle}` : ''}
                  {o.curbside?.checkInSource === 'geo_auto' ? ' · auto' : o.curbside?.checkInSource === 'sign_qr' ? ' · scanned' : ''}
                </p>
              )}
              {onWay && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-lg border-2 border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-sky-800">
                  <Car className="h-3 w-3" aria-hidden="true" />
                  On the way{o.curbside?.etaMinutes ? ` · ~${o.curbside.etaMinutes} min` : ''}
                </p>
              )}
              {(o as any).shelfSlot && ['ready', 'arrived'].includes(o.stage) && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-lg border-2 border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-primary">
                  Shelf {(o as any).shelfSlot}
                </p>
              )}
              {sla && (
                <p className={cn('text-[10px] font-black uppercase tracking-widest mt-0.5',
                  sla.state === 'late' ? 'text-destructive' : sla.state === 'due' ? 'text-amber-600' : 'text-muted-foreground/70')}>
                  {sla.label} · waited {Math.round(sla.waitedMinutes)}m
                </p>
              )}
              {(o as any).pickupAt && (o as any).pickupAt !== 'ASAP' && (
                <p className="text-[8px] font-black uppercase tracking-widest text-primary">Wants it {(o as any).pickupAt}</p>
              )}
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
    <div className={`min-h-dvh bg-muted/5 pb-28${stationMode ? ' station-mode' : ''}`}>
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="w-full sm:w-auto sm:flex-1 min-w-0 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Fulfillment</h1>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5 truncate">
                {queue.length} queued · {inProgress.length} in progress · {ready.length} ready · {arrived.length} outside
                {waitStats.medianMin !== null ? ` · typical wait ${waitStats.medianMin} min` : ''}
                {waitStats.neverCollected > 0 ? ` · ${waitStats.neverCollected} never collected` : ''}
              </p>
            </div>
            <div className="flex items-center gap-0.5 sm:hidden shrink-0">
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
                <Link href="/retail-orders/history" aria-label="Order history"><History className="h-4 w-4" aria-hidden="true" /></Link>
              </Button>
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
                <Link href="/retail-orders/settings" aria-label="Shop settings"><Settings className="h-4 w-4" aria-hidden="true" /></Link>
              </Button>
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-primary">
                <a href={`/shop/${tenantId}`} target="_blank" rel="noreferrer" aria-label="Open your storefront in a new tab"><Store className="h-4 w-4" aria-hidden="true" /></a>
              </Button>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={stationMode}
            onClick={() => setStationMode((v) => !v)}
            className="h-11 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest shrink-0"
          >
            {stationMode ? 'Phone view' : 'Station view'}
          </Button>
          <Button
            onClick={takeNext}
            disabled={claiming || !!myBatch || queue.length === 0}
            className="flex-1 sm:flex-none h-12 sm:h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20"
          >
            {claiming ? <Loader className="h-4 w-4 animate-spin" /> : <><Zap className="mr-1.5 h-4 w-4" /> Take next</>}
          </Button>
          <Button
            variant="outline"
            onClick={() => setHandoffOpen(true)}
            className="h-12 sm:h-11 rounded-xl font-black uppercase text-[10px] tracking-widest border-2"
          >
            <QrCode className="mr-1.5 h-4 w-4" /> Handoff
          </Button>
          <Button asChild variant="outline" className="h-12 w-12 sm:h-11 sm:w-auto rounded-xl font-black uppercase text-[10px] tracking-widest border-2 px-0 sm:px-4">
            <Link href="/retail-orders/returns"><RotateCcw className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Returns</span></Link>
          </Button>
          <div className="hidden sm:flex items-center gap-1">
            <Button asChild variant="ghost" size="icon" className="h-11 w-11 rounded-xl">
              <Link href="/retail-orders/history" aria-label="Order history"><History className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
            <Button asChild variant="ghost" size="icon" className="h-11 w-11 rounded-xl">
              <Link href="/retail-orders/settings" aria-label="Shop settings"><Settings className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
            <Button asChild variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-primary">
              <a href={`/shop/${tenantId}`} target="_blank" rel="noreferrer" aria-label="Open your storefront in a new tab"><Store className="h-4 w-4" aria-hidden="true" /></a>
            </Button>
          </div>
        </div>
        {packedShipOrders.length > 1 && shippoConfigured && (
          <div className="bg-primary/[0.04] border-t border-primary/10">
            <div className="max-w-7xl mx-auto px-4 py-1.5 flex flex-wrap items-center gap-2">
              <Ship className="w-3.5 h-3.5 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest text-primary flex-1">
                {packedShipOrders.length} packed ship orders have no label yet
              </p>
              <Button size="sm" disabled={bulkBusy} onClick={() => void buyAllLabels()}
                className="h-7 rounded-lg px-3 font-black uppercase text-[9px] tracking-widest">
                {bulkBusy ? <Loader className="h-3 w-3 animate-spin" /> : `Buy all ${packedShipOrders.length} labels — cheapest rates`}
              </Button>
            </div>
          </div>
        )}
        {pendingRefunds.length > 0 && (
          <div className="bg-amber-50 border-t border-amber-100">
            <div className="max-w-7xl mx-auto px-4 py-1.5 flex flex-wrap items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex-1">
                {pendingRefunds.length} refund(s) to execute in Stripe:
              </p>
              {pendingRefunds.map((o) => (
                <Button
                  key={o.id}
                  variant="outline"
                  size="sm"
                  disabled={busy === `refund-${o.id}`}
                  onClick={() => act(`refund-${o.id}`, () => markRefundExecuted(requireCtx() as Firestore, tenantId, o.id, actor))}
                  className="h-7 rounded-lg font-black uppercase text-[8px] tracking-widest border-2 border-amber-200 text-amber-700 hover:bg-amber-100"
                >
                  #{o.orderNumber} {fmt(o.pendingRefundCents || 0)} · Mark refunded
                </Button>
              ))}
            </div>
          </div>
        )}
      </header>

      {staleReady.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 pt-4">
          <div className="rounded-[1.5rem] border-2 border-amber-300 bg-amber-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
              {staleReady.length} order{staleReady.length === 1 ? '' : 's'} waiting on the shelf over {staleHours}h
            </p>
            <p className="mt-1 text-[11px] font-bold text-amber-900/80">
              Uncollected orders quietly become dead stock — a nudge usually clears them.
            </p>
            <div className="mt-3 space-y-2">
              {staleReady.slice(0, 5).map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-amber-200 bg-white p-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black uppercase tracking-tight">
                      #{String(o.orderNumber).padStart(4, '0')} · {o.customerName}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      ready {Math.round((Date.now() - Date.parse(String((o as any).readyAt || o.placedAt || ''))) / 3_600_000)}h ago
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {o.customerEmail && (
                      <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest">
                        <a href={`mailto:${o.customerEmail}?subject=${encodeURIComponent(`Your order #${String(o.orderNumber).padStart(4, '0')} is ready`)}&body=${encodeURIComponent(`Hi ${String(o.customerName || '').split(' ')[0]}, your order is packed and waiting for you whenever you can swing by.`)}`}>
                          Remind
                        </a>
                      </Button>
                    )}
                    {o.customerPhone && (
                      <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-2 text-[9px] font-black uppercase tracking-widest">
                        <a href={`sms:${o.customerPhone}`}>Text</a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {myBatch && (
        <section className="max-w-7xl mx-auto px-4 pt-5">
          <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white shadow-xl shadow-primary/10">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ScanLine className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-[10px] font-black uppercase tracking-widest truncate">Your pick — scan every item</p>
                </div>
                <div className="flex rounded-xl border-2 overflow-hidden shrink-0">
                  {(['shelf', 'orders'] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={batchView === v}
                      onClick={() => setBatchView(v)}
                      className={cn('h-8 px-3 text-[9px] font-black uppercase tracking-widest',
                        batchView === v ? 'bg-foreground text-background' : 'bg-white')}>
                      {v === 'shelf' ? 'By shelf' : 'By order'}
                    </button>
                  ))}
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
                  {batchView === 'shelf' && (
                    <>
                      {shelfList.length === 0 && (
                        <p className="py-6 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          Nothing left to pick
                        </p>
                      )}
                      {shelfList.map((row) => {
                        const done = row.scanned >= row.needed;
                        return (
                          <div key={row.productId} className={cn('flex items-center gap-3 rounded-2xl border-2 p-3', done && 'opacity-50')}>
                            {row.photo ? (
                              <img src={row.photo} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl border object-cover" />
                            ) : (
                              <div className="h-12 w-12 shrink-0 rounded-xl border bg-muted/30" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-black uppercase tracking-tight">{row.name}</p>
                              <p className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                {shelfFor.get(row.productId) ? `${shelfFor.get(row.productId)} · ` : ''}
                                {row.orders.map((x) => `#${String(x.number).padStart(4, '0')}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(' · ')}
                              </p>
                            </div>
                            <p className={cn('shrink-0 font-mono text-base font-black', done && 'text-primary')}>
                              {row.scanned}/{row.needed}
                            </p>
                          </div>
                        );
                      })}
                      {shelfList.length > 0 && (
                        <p className="pt-1 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          Grab {shelfList.reduce((a, r) => a + Math.max(0, r.needed - r.scanned), 0)} item(s) · each scan still files to its own order
                        </p>
                      )}
                    </>
                  )}
                  {batchView === 'orders' && myOrders.map((o) => (
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
                            {photoFor.get(l.productId) ? (
                              <img
                                src={photoFor.get(l.productId)}
                                alt=""
                                loading="lazy"
                                className={cn('w-9 h-9 rounded-lg border object-cover shrink-0', doneLine && 'opacity-40')}
                              />
                            ) : (
                              <div className={cn('w-9 h-9 rounded-lg border bg-muted/30 shrink-0', doneLine && 'opacity-40')} />
                            )}
                            <p className={cn('text-[11px] font-bold flex-1 min-w-0 truncate', doneLine && 'opacity-50')}>
                              {l.name}
                              {(l as any).optionsLabel ? <span className="block text-[8px] font-black uppercase tracking-widest text-primary">{(l as any).optionsLabel}</span> : null}
                              {shelfFor.get(l.productId) ? (
                                <span className="block text-[8px] font-black uppercase tracking-widest text-muted-foreground/80">
                                  {shelfFor.get(l.productId)}
                                </span>
                              ) : null}
                            </p>
                            <p className="font-black font-mono text-[11px]">{l.qtyScanned}/{l.qtyOrdered}</p>
                            {!doneLine && o.stage === 'picking' && (l.qtyShorted || 0) === 0 && (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 px-2 font-black uppercase text-[8px] tracking-widest text-amber-600"
                                onClick={() => setShortTarget({ order: o, line: l })}
                              >
                                Short
                              </Button>
                            )}
                            {o.stage === 'picking' && (l.qtyShorted || 0) > 0 && (
                              <Button
                                variant="ghost" size="sm"
                                disabled={busy === `reopen-${l.lineId}`}
                                className="h-6 px-2 font-black uppercase text-[8px] tracking-widest text-primary"
                                onClick={() => act(`reopen-${l.lineId}`, () => reopenShortedLine(requireCtx() as Firestore, tenantId, o.id, l.lineId, actor))}
                              >
                                Reopen
                              </Button>
                            )}
                          </div>
                        );
                      })}
                      <Button
                        variant="outline"
                        onClick={() => window.open(printUrl('packing-slip', tenantId, o), '_blank')}
                        className="w-full h-8 rounded-xl font-black uppercase text-[8px] tracking-widest border-2 text-muted-foreground"
                      >
                        <Printer className="mr-1 h-3 w-3" /> Packing slip
                      </Button>
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
                          onClick={() => act(`ready-${o.id}`, async () => {
                            const r = await markReady(requireCtx() as Firestore, tenantId, o.id, actor);
                            if (r.ok && (r as any).notifyReady) notifyCurbside(tenantId, o.id, 'ready');
                            return r;
                          })}
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

      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className={cn('rounded-[1.5rem] border-2 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3',
          health.late > 0 ? 'border-destructive/50 bg-destructive/[0.04]' : 'bg-white')}>
          {[
            { n: health.late, label: 'past due', tone: health.late > 0 ? 'bad' : 'ok' },
            { n: health.due, label: 'due soon', tone: health.due > 0 ? 'warn' : 'ok' },
            { n: health.working, label: 'in the queue', tone: 'ok' },
            { n: staleReady.length, label: `on shelf >${staleHours}h`, tone: staleReady.length > 0 ? 'warn' : 'ok' },
          ].map((k) => (
            <div key={k.label} className="min-w-0">
              <p className={cn('font-mono text-xl font-bold leading-none',
                k.tone === 'bad' && 'text-destructive', k.tone === 'warn' && 'text-amber-600')}>{k.n}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground truncate">{k.label}</p>
            </div>
          ))}
        </div>
        {health.late > 0 && (
          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-destructive">
            Past-due orders lead the queue — Take Next picks them first
          </p>
        )}
      </div>

      {exceptions.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 pt-4">
          <div className="rounded-[1.5rem] border-2 border-amber-300 bg-amber-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
              {exceptions.length} thing{exceptions.length === 1 ? '' : 's'} need a decision
            </p>
            <div className="mt-3 space-y-2">
              {exceptions.slice(0, 6).map((x) => (
                <div
                  key={x.id}
                  className={cn('rounded-xl border-2 bg-white p-3',
                    x.tone === 'bad' ? 'border-destructive/40' : 'border-amber-200')}
                >
                  <p className={cn('text-xs font-black uppercase tracking-tight',
                    x.tone === 'bad' && 'text-destructive')}>
                    {x.title}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">{x.detail}</p>
                </div>
              ))}
              {exceptions.length > 6 && (
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                  +{exceptions.length - 6} more in Order History
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {waitingNow.total > 0 && (
        <section className="max-w-7xl mx-auto px-4 pt-4">
          <div className="rounded-[1.75rem] border-2 border-amber-300 bg-amber-50/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
              Still waiting to be served — {waitingNow.total}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...waitingNow.curbside, ...waitingNow.lounge].slice(0, 8).map((w) => (
                <span key={w.id} className="rounded-lg border-2 border-amber-200 bg-white px-2 py-1 text-[11px] font-black uppercase tracking-widest text-amber-900">
                  {w.label} · {w.waitedMin} min
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] font-bold text-amber-800">
              Don&apos;t lock up yet — someone is out there expecting you.
            </p>
          </div>
        </section>
      )}

      <main className="max-w-7xl mx-auto px-4 py-5 grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { title: 'Queue', icon: ClipboardList, list: queue },
          { title: 'In Progress', icon: PackageOpen, list: inProgress },
          { title: 'Ready', icon: Package, list: ready },
          { title: 'Outside', icon: Car, list: arrived },
        ].map((lane) => (
          <div key={lane.title} className={cn('space-y-3', lane.list.length === 0 && lane.title !== 'Queue' && 'hidden md:block')}>
            <div className="flex items-center gap-2 px-1 sticky top-[104px] md:static z-10 bg-muted/5 backdrop-blur py-1 -my-1 rounded-lg">
              <lane.icon className="w-3.5 h-3.5 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-widest">{lane.title}</p>
              <span className="ml-auto font-black font-mono text-xs opacity-40">{lane.list.length}</span>
            </div>
            {lane.list.map((o) => (
              <OrderCard key={o.id} o={o}>
                {o.stage === 'paid' && (
                  <Button
                    variant="outline"
                    disabled={busy === `cancel-${o.id}`}
                    onClick={() => {
                      const why = window.prompt(`Cancel order #${String(o.orderNumber).padStart(4, '0')}? Reason (optional):`);
                      if (why === null) return;
                      act(`cancel-${o.id}`, () => cancelOrder(requireCtx() as Firestore, tenantId, o.id, actor, why.trim()));
                    }}
                    className="w-full h-8 rounded-xl font-black uppercase text-[8px] tracking-widest border-2 border-destructive/30 text-destructive"
                  >
                    Cancel order
                  </Button>
                )}
                {o.stage === 'picking' && o.batchId !== myBatch?.id && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    Picking · {batches.find((b) => b.id === o.batchId)?.assignedToName || 'claimed'}
                  </p>
                )}
                {o.stage === 'packed' && (
                  <Button
                    disabled={busy === `ready-${o.id}`}
                    onClick={() => act(`ready-${o.id}`, async () => {
                            const r = await markReady(requireCtx() as Firestore, tenantId, o.id, actor);
                            if (r.ok && (r as any).notifyReady) notifyCurbside(tenantId, o.id, 'ready');
                            return r;
                          })}
                    className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                  >
                    Mark ready
                  </Button>
                )}
                {o.stage === 'ready' && o.method === 'ship' && (
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      onClick={() => window.open(printUrl('label', tenantId, o), '_blank')}
                      className="w-full h-8 rounded-xl font-black uppercase text-[8px] tracking-widest border-2 text-muted-foreground"
                    >
                      <Printer className="mr-1 h-3 w-3" /> Print 4x6 label
                    </Button>
                    <Button
                      onClick={() => {
                        setShipTarget(o);
                        setShipCarrier(''); setShipNumber(''); setShipUrl('');
                        setRates([]); setLabelUrl((o as any).labelUrl || '');
                        const known = (o.lines || []).reduce((sum: number, l: any) => {
                          const w = Number((inventory || []).find((i: any) => i.id === l.productId)?.weightOz) || 0;
                          return sum + w * Math.max(0, l.qtyOrdered - (l.qtyShorted || 0));
                        }, 0);
                        setBoxes(1);
                        setExtraLabels(((o as any).extraLabelUrls || []) as string[]);
                        if (known > 0) {
                          const total = known + 4;
                          setParcel((prev) => ({ ...prev, weightLb: String(Math.floor(total / 16)), weightOz: String(total % 16) }));
                        }
                      }}
                      className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest"
                    >
                      <Ship className="mr-1.5 h-3.5 w-3.5" /> Mark shipped
                    </Button>
                  </div>
                )}
                {['paid', 'picking'].includes(o.stage) && !(o as any).parentOrderId
                  && (o.lines || []).some((l: any) => l.preorder === true && !['refunded', 'cancelled'].includes(String(l.status)))
                  && (o.lines || []).some((l: any) => l.preorder !== true) && (
                  <Button
                    variant="outline"
                    disabled={busy === `split-${o.id}`}
                    onClick={() => act(`split-${o.id}`, () => splitReadyFromWaiting(requireCtx() as Firestore, tenantId, o.id, actor))}
                    className="w-full h-8 rounded-xl font-black uppercase text-[8px] tracking-widest border-2 text-amber-700 border-amber-200"
                  >
                    Ship what&apos;s ready now
                  </Button>
                )}
                {o.stage === 'arrived' && !(o.curbside as any)?.bringingOutAt && (
                  <Button
                    disabled={busy === `out-${o.id}`}
                    onClick={() => act(`out-${o.id}`, async () => {
                      const me = (staff || []).find((m: any) =>
                        m.id === actor.id || (m.email && user?.email && String(m.email).toLowerCase() === String(user.email).toLowerCase()));
                      const r = await markBringingOut(requireCtx() as Firestore, tenantId, o.id, actor, (me as any)?.avatarUrl || undefined);
                      // A banner only reaches a phone that is awake and looking.
                      // The text reaches the one in the cupholder.
                      if (r.ok) notifyCurbside(tenantId, o.id, 'out');
                      return r;
                    })}
                    className="w-full h-9 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-lg shadow-primary/20"
                  >
                    On my way out
                  </Button>
                )}
                {o.stage === 'arrived' && !!(o.curbside as any)?.bringingOutAt && (
                  <p className="rounded-xl border-2 border-primary/30 bg-primary/[0.04] px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary">
                    {(o.curbside as any).bringingOutBy || 'Someone'} is heading out
                  </p>
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
              aria-label="What happened"
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
          <div className="space-y-3 pt-1 max-h-[55dvh] overflow-y-auto pr-1">
            {shippoConfigured && !labelUrl && (
              <div className="rounded-2xl border-2 border-primary/30 bg-primary/[0.03] p-4 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-primary">Live label via Shippo</p>
                <div className="flex flex-wrap gap-1.5">
                  {packagingPresets.map((pr) => (
                    <button key={pr.id} type="button" aria-pressed={activePresetId === pr.id}
                      onClick={() => applyPreset(pr)}
                      className={cn('h-8 rounded-lg border-2 px-2.5 text-[8px] font-black uppercase tracking-widest transition-all active:scale-95',
                        activePresetId === pr.id ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40')}>
                      {pr.name}
                    </button>
                  ))}
                  <button type="button" onClick={() => void savePreset()}
                    className="h-8 rounded-lg border-2 border-dashed px-2.5 text-[8px] font-black uppercase tracking-widest text-muted-foreground transition-all hover:border-primary/40 active:scale-95">
                    + Save as preset
                  </button>
                </div>
                {activePresetId && (
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">
                    Weight = this order&apos;s products + the box — dims from the preset. Adjust anything below.
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Boxes</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2" disabled={boxes <= 1}
                      onClick={() => { setBoxes(boxes - 1); setRates([]); }}>−</Button>
                    <span className="font-black font-mono text-sm w-6 text-center">{boxes}</span>
                    <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2" disabled={boxes >= 10}
                      onClick={() => { setBoxes(boxes + 1); setRates([]); }}>+</Button>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {([['weightLb', boxes > 1 ? 'lb / box' : 'lb', 'Weight in pounds'], ['weightOz', 'oz', 'Weight in ounces'], ['lengthIn', 'L in', 'Length in inches'], ['widthIn', 'W in', 'Width in inches'], ['heightIn', 'H in', 'Height in inches']] as const).map(([k, lbl, a11y]) => (
                    <div key={k} className="space-y-1">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground text-center">{lbl}</p>
                      <Input inputMode="decimal" aria-label={a11y} value={(parcel as any)[k]}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setParcel({ ...parcel, [k]: e.target.value }); setRates([]); }}
                        className="h-10 rounded-xl border-2 font-black font-mono text-xs text-center" />
                    </div>
                  ))}
                </div>
                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground text-center">
                  Total: {Math.floor((perBoxOz() * boxes) / 16)} lb {(perBoxOz() * boxes) % 16} oz{boxes > 1 ? ` across ${boxes} boxes` : ''}
                </p>
                {perBoxOz() > 1120 && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-destructive text-center">
                    Over 70 lb per box — carriers will refuse it. Add boxes to split the weight.
                  </p>
                )}
                <Button variant="outline" disabled={ratesLoading} onClick={fetchRates}
                  className="w-full h-10 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest">
                  {ratesLoading ? <Loader className="h-4 w-4 animate-spin" /> : 'Get live rates'}
                </Button>
                {rates.length > 0 && (
                  <div className="space-y-1.5">
                    {rates.map((r) => (
                      <button key={r.id} type="button" disabled={!!buyingRate} onClick={() => buyLabel(r.id)}
                        className="w-full rounded-xl border-2 p-3 flex items-center justify-between gap-2 hover:border-primary/50 transition-all disabled:opacity-50">
                        <span className="text-left">
                          <span className="block text-[10px] font-black uppercase tracking-widest">{r.provider} · {r.service}</span>
                          {r.days != null && <span className="block text-[8px] font-bold uppercase tracking-widest text-muted-foreground">~{r.days} day{r.days === 1 ? '' : 's'}</span>}
                        </span>
                        <span className="font-black font-mono text-sm text-primary shrink-0">
                          {buyingRate === r.id ? '…' : `$${(r.amountCents / 100).toFixed(2)}`}
                        </span>
                      </button>
                    ))}
                    <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">Tap a rate to buy the 4x6 label</p>
                  </div>
                )}
              </div>
            )}
            {labelUrl && (
              <div className="space-y-2">
                <Button asChild variant="outline" className="w-full h-11 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-primary border-primary/40">
                  <a href={labelUrl} target="_blank" rel="noreferrer">{extraLabels.length > 0 ? 'Open label — box 1' : 'Open purchased label (4x6 PDF)'}</a>
                </Button>
                {extraLabels.map((u, i) => (
                  <Button key={u} asChild variant="outline" className="w-full h-10 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-primary border-primary/40">
                    <a href={u} target="_blank" rel="noreferrer">Open label — box {i + 2}</a>
                  </Button>
                ))}
                <Button
                  variant="outline"
                  disabled={busy === 'void-label'}
                  onClick={async () => {
                    if (!shipTarget) return;
                    if (!window.confirm('Void this label? The postage is refunded by the carrier and the tracking is cleared.')) return;
                    setBusy('void-label');
                    try {
                      const res = await fetch('/api/retail/shipping-label', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tenantId, orderId: shipTarget.id, qrToken: shipTarget.qrToken || '', action: 'void' }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Void failed');
                      setLabelUrl(''); setShipCarrier(''); setShipNumber(''); setShipUrl('');
                      toast({ title: 'Label voided', description: data.message });
                    } catch (e: any) {
                      toast({ variant: 'destructive', title: 'Could not void', description: e?.message });
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="w-full h-10 rounded-xl border-2 border-destructive/30 text-destructive font-black uppercase text-[9px] tracking-widest"
                >
                  Void label &amp; refund postage
                </Button>
              </div>
            )}
            <Input placeholder="Carrier (USPS, UPS…)" aria-label="Carrier" value={shipCarrier} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShipCarrier(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-sm" />
            <Input placeholder="Tracking number" aria-label="Tracking number" value={shipNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShipNumber(e.target.value)} className="h-12 rounded-xl border-2 font-mono font-black text-xs" />
            <Input placeholder="Tracking URL (optional)" aria-label="Tracking URL, optional" value={shipUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShipUrl(e.target.value)} className="h-12 rounded-xl border-2 font-bold text-xs" />
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
              placeholder="How was identity verified? (name + order #, ID…)" aria-label="How was identity verified"
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
