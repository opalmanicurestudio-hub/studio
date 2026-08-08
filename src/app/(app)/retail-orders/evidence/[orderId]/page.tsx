'use client';

import { collection, doc, onSnapshot, orderBy, query, type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Camera, Check, ClipboardList, Loader, Package, Printer, Scale,
  ScanLine, Truck, X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { computeIntegrityScore } from '@/lib/integrity-score';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { cn } from '@/lib/utils';

// ─── Order Evidence Record ────────────────────────────────────────────────────
// Everything the system witnessed about one order, on one page: the custody
// timeline, per-line scan verification, packing photos, weights, and carrier
// evidence. Nothing here is NEW data — the workflow has been writing all of
// it (append-only events, scan counters, pack photos, label metadata) since
// those features shipped. This page is the missing READ side: when a claim,
// dispute, or "what happened to #0132?" lands, the answer is assembled
// before anyone starts digging. Browser print (the button) doubles as the
// export — the app's print styles already restore the document look.

type Ev = { id: string; type: string; at: string; actorId: string; actorName: string; meta?: any };

const EVENT_LABELS: Record<string, string> = {
  placed: 'Order placed',
  payment_confirmed: 'Payment confirmed',
  stock_reserved: 'Stock reserved',
  batch_claimed: 'Claimed for fulfilment',
  batch_released: 'Released back to queue',
  batch_auto_released: 'Claim timed out — released',
  item_scanned: 'Item scanned',
  scan_mismatch: 'Scan mismatch',
  line_shorted: 'Line shorted',
  line_reopened: 'Line reopened',
  pick_complete: 'Pick complete',
  packed: 'Packed',
  packing_slip_printed: 'Packing slip printed',
  label_generated: 'Shipping label generated',
  label_scan_verified: 'Label verified onto box',
  marked_ready: 'Marked ready',
  customer_arrived: 'Customer arrived',
  handoff_scanned: 'Handoff verified by scan',
  shipped: 'Handed to carrier',
  completed: 'Completed',
  cancel_requested: 'Cancellation requested',
  restock_scanned: 'Item restocked by scan',
  cancelled: 'Cancelled',
  refund_issued: 'Refund issued',
  return_opened: 'Return opened',
  return_resolved: 'Return resolved',
  replacement_created: 'Replacement created',
  backorder_split: 'Backorder split off',
  override: 'Manager override',
  address_updated: 'Shipping address corrected',
  note: 'Note',
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
};

const metaLine = (e: Ev): string => {
  const m = e.meta || {};
  switch (e.type) {
    case 'item_scanned': return [m.sku, m.qtyScanned != null ? `${m.qtyScanned}/${m.qtyOrdered ?? '?'}` : ''].filter(Boolean).join(' · ');
    case 'scan_mismatch': return m.scannedValue ? `Scanned: ${m.scannedValue}` : '';
    case 'line_shorted': case 'line_reopened': return [m.reason, m.qtyShorted != null ? `${m.qtyShorted} short` : ''].filter(Boolean).join(' · ');
    case 'label_generated': return [m.carrier, m.trackingNumber].filter(Boolean).join(' · ');
    case 'customer_arrived': return m.spotOrVehicle ? String(m.spotOrVehicle) : '';
    case 'refund_issued': return m.amountCents != null ? `$${(Number(m.amountCents) / 100).toFixed(2)} · ${m.scope || ''}` : '';
    case 'override': return [m.rule, m.reason].filter(Boolean).join(' — ');
    case 'address_updated': {
      const to = m.to || {};
      return to.city ? `Now: ${to.line1 || ''}, ${to.city}, ${to.state || ''}` : '';
    }
    case 'note': return m.text ? String(m.text) : '';
    default: return '';
  }
};

export default function OrderEvidencePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = React.use(params);
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';

  const [order, setOrder] = useState<any>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [orderLoaded, setOrderLoaded] = useState(false);

  useEffect(() => {
    if (!firestore || !tenantId || !orderId) return;
    const unsubOrder = onSnapshot(
      doc(firestore as Firestore, `tenants/${tenantId}/retailOrders/${orderId}`),
      (snap: any) => { setOrder(snap.exists() ? { id: snap.id, ...snap.data() } : null); setOrderLoaded(true); },
      () => setOrderLoaded(true)
    );
    const unsubEvents = onSnapshot(
      query(collection(firestore as Firestore, `tenants/${tenantId}/retailOrders/${orderId}/events`), orderBy('at', 'asc')),
      (snap: any) => setEvents(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))),
      () => {}
    );
    return () => { unsubOrder(); unsubEvents(); };
  }, [firestore, tenantId, orderId]);

  // Timeline = recorded events UNION timestamps stamped on the order itself.
  // Older orders predate some event writers; the order-level stamps fill the
  // gaps so the record never shows an empty history for a completed order.
  const timeline = useMemo(() => {
    const have = new Set(events.map((e) => e.type));
    const synth: Ev[] = [];
    const add = (cond: any, type: string, at: string | undefined, actorName = 'System') => {
      if (cond && at && !have.has(type)) synth.push({ id: `synth-${type}`, type, at, actorId: 'system', actorName });
    };
    if (order) {
      add(true, 'placed', order.placedAt);
      add(order.paidAt, 'payment_confirmed', order.paidAt);
      add(order.packedAt, 'packed', order.packedAt);
      add(order.readyAt, 'marked_ready', order.readyAt);
      add(order.completedAt, 'completed', order.completedAt);
      add(order.cancelledAt, 'cancelled', order.cancelledAt);
    }
    return [...events, ...synth].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }, [events, order]);

  const lines: any[] = order?.lines || [];
  const scanChecks = useMemo(() => lines.map((l) => {
    const target = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
    const scanned = Number(l.qtyScanned) || 0;
    return { l, target, scanned, ok: target > 0 ? scanned >= target : true };
  }), [lines]);
  const allScanned = scanChecks.length > 0 && scanChecks.every((c) => c.ok);

  const photos: string[] = Array.isArray(order?.packPhotoUrls) ? order.packPhotoUrls : [];
  const integrity = useMemo(() => {
    if (!order) return null;
    return computeIntegrityScore({
      method: order.method,
      stage: order.stage,
      lines: order.lines || [],
      packPhotoUrls: photos,
      trackingNumber: order.trackingNumber || '',
      hasHandoffOrLabelScan: events.some((e) => e.type === (order.method === 'ship' ? 'label_scan_verified' : 'handoff_scanned')),
      hasMismatchOrOverride: events.some((e) => e.type === 'scan_mismatch' || e.type === 'override'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, events]);
  const labelEv = [...events].reverse().find((e) => e.type === 'label_generated');
  const verifications = order ? [
    { label: 'Every unit scanned', ok: allScanned, icon: ScanLine },
    { label: 'Packing photo', ok: photos.length > 0, icon: Camera },
    { label: order.method === 'ship' ? 'Label verified onto box' : 'Handoff verified by scan', ok: events.some((e) => e.type === (order.method === 'ship' ? 'label_scan_verified' : 'handoff_scanned')), icon: Check },
    ...(order.method === 'ship' ? [{ label: 'Carrier custody', ok: Boolean(order.trackingNumber), icon: Truck }] : []),
  ] : [];

  if (!orderLoaded) {
    return (
      <div className="flex justify-center py-24">
        <Loader className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Loading evidence record</span>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-3 py-24 text-center">
        <ClipboardList className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Order not found in this shop</p>
        <Button asChild variant="outline" className="rounded-xl border-2 font-black uppercase text-[10px] tracking-widest">
          <Link href="/retail-orders">Back to orders</Link>
        </Button>
      </div>
    );
  }

  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-16 sm:p-6">
      <div className="flex h-12 items-center gap-3 print:hidden">
        <Button asChild variant="ghost" size="icon" aria-label="Back to orders board" className="h-10 w-10 shrink-0 rounded-xl">
          <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
        <h1 className="text-xl font-black uppercase tracking-tighter">Evidence record</h1>
        <Button
          variant="outline"
          onClick={() => window.print()}
          className="ml-auto h-10 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest"
        >
          <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Print / export
        </Button>
      </div>

      <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
        <CardContent className="p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-black uppercase tracking-tight">Order {num}</p>
            {integrity && (
              <span
                className={cn(
                  'inline-flex items-baseline gap-1 rounded-xl border-2 px-2.5 py-1',
                  integrity.grade === 'strong' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : integrity.grade === 'fair' ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-red-200 bg-red-50 text-red-900'
                )}
                title="Order Integrity Score — strength of the fulfilment evidence, normalized to what this order could have"
              >
                <span className="font-mono text-sm font-black">{integrity.score}</span>
                <span className="text-[8px] font-black uppercase tracking-widest">/100 {integrity.grade}</span>
              </span>
            )}
            <Badge className="border-2 font-black text-[9px] uppercase tracking-widest">{String(order.stage || '')}</Badge>
            <Badge variant="outline" className="border-2 font-black text-[9px] uppercase tracking-widest">
              {order.method === 'ship' ? 'Shipping' : order.method === 'curbside' ? 'Curbside' : 'Pickup'}
            </Badge>
            {order.priceTier === 'wholesale' && (
              <Badge variant="outline" className="border-2 font-black text-[9px] uppercase tracking-widest">Wholesale</Badge>
            )}
          </div>
          <p className="text-[11px] font-bold text-muted-foreground">
            {order.customerName}{order.customerEmail ? ` · ${order.customerEmail}` : ''}
            {order.placedAt ? ` · placed ${fmtTime(order.placedAt)}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {verifications.map((v) => (
              <span
                key={v.label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border-2 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest',
                  v.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-500'
                )}
              >
                {v.ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                {v.label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Scan verification</p>
          </div>
          <div className="space-y-2">
            {scanChecks.map(({ l, target, scanned, ok }, i) => (
              <div key={l.lineId || i} className="flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase tracking-tight">{l.name}</p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {l.sku ? `${l.sku} · ` : ''}ordered {l.qtyOrdered}{(l.qtyShorted || 0) > 0 ? ` · shorted ${l.qtyShorted} (${l.status || 'shorted'})` : ''}
                  </p>
                </div>
                <span className={cn('shrink-0 rounded-lg border-2 px-2 py-1 font-mono text-xs font-black', ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
                  {scanned}/{target}
                </span>
              </div>
            ))}
            {scanChecks.length === 0 && (
              <p className="text-[11px] font-bold text-muted-foreground">No lines on this order.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {(photos.length > 0 || order.method === 'ship') && (
        <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Packing & shipping evidence</p>
            </div>
            {photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border-2">
                    <img src={u} alt={`Packing photo ${i + 1} of ${photos.length}`} className="h-32 w-full object-cover" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-[11px] font-bold text-muted-foreground">No packing photos on this order.</p>
            )}
            {order.method === 'ship' && (
              <div className="space-y-1.5 pt-1">
                {order.carrier || order.trackingNumber ? (
                  <p className="text-xs font-bold">
                    <Truck className="mr-1.5 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    {[order.carrier, order.trackingNumber].filter(Boolean).join(' · ')}
                    {order.trackingUrl ? (
                      <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="ml-2 font-black uppercase text-[10px] tracking-widest text-primary underline underline-offset-2">Track</a>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-[11px] font-bold text-muted-foreground">No label purchased yet.</p>
                )}
                {labelEv?.meta && (labelEv.meta.weightLb || labelEv.meta.weightOz) ? (
                  <p className="text-[11px] font-bold text-muted-foreground">
                    <Scale className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
                    Recorded weight: {labelEv.meta.weightLb ? `${labelEv.meta.weightLb} lb` : `${labelEv.meta.weightOz} oz`}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Chain of custody</p>
          </div>
          <ol className="space-y-0">
            {timeline.map((e) => {
              const detail = metaLine(e);
              return (
                <li key={e.id} className="relative border-l-2 border-slate-200 pb-4 pl-4 last:pb-0">
                  <span className={cn('absolute -left-[5px] top-1.5 h-2 w-2 rounded-full', e.type === 'scan_mismatch' || e.type === 'override' || e.type === 'cancelled' ? 'bg-amber-500' : 'bg-primary')} aria-hidden="true" />
                  <p className="text-xs font-black uppercase tracking-tight">
                    {EVENT_LABELS[e.type] || e.type}
                    {e.id.startsWith('synth-') ? <span className="ml-1.5 text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">from order record</span> : null}
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {fmtTime(e.at)} · {e.actorName || e.actorId}
                    {e.meta?.client?.ip ? ` · from ${e.meta.client.ip}` : ''}
                  </p>
                  {e.meta?.client?.ua && (
                    <p className="text-[8px] font-bold text-muted-foreground/60 break-all">{e.meta.client.ua}</p>
                  )}
                  {detail && <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">{detail}</p>}
                </li>
              );
            })}
            {timeline.length === 0 && (
              <p className="text-[11px] font-bold text-muted-foreground">No events recorded for this order.</p>
            )}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
