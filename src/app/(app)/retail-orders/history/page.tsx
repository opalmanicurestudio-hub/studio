'use client';

import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type Firestore,
} from 'firebase/firestore';
import {
  ArrowLeft, Car, Check, ClipboardCopy, History, Loader, Printer, Search, Store, Truck, X,
} from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { markRefundExecuted } from '@/lib/retail-returns';
import {
  STAGE_LABELS, type OrderEvent, type OrderStage, type RetailOrder,
} from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

// ─── Order History ────────────────────────────────────────────────────────────
// The customer-service database view: every order ever, searchable by order
// number, name, or email, filterable by stage, with a full detail sheet —
// items, money, timestamps, and the append-only audit timeline (who did what,
// when). Loads newest-first in pages; a pure-digit search also queries the
// backend directly so old orders are findable without paging.

const PAGE_SIZE = 60;

const fmt = (cents: number) =>
  ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const when = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

const EVENT_LABELS: Record<string, string> = {
  placed: 'Order placed', payment_confirmed: 'Payment confirmed', stock_reserved: 'Stock reserved',
  batch_claimed: 'Claimed for picking', batch_released: 'Released back to queue',
  batch_auto_released: 'Auto-released (idle claim)', item_scanned: 'Item scanned',
  scan_mismatch: 'Scan mismatch', line_shorted: 'Line shorted', pick_complete: 'Pick complete',
  packed: 'Packed', packing_slip_printed: 'Packing slip printed', label_generated: 'Label generated',
  label_scan_verified: 'Label verified', marked_ready: 'Marked ready', customer_arrived: 'Customer arrived',
  handoff_scanned: 'Handoff QR scanned', shipped: 'Shipped', completed: 'Completed',
  cancel_requested: 'Cancel requested', restock_scanned: 'Restocked', cancelled: 'Cancelled',
  refund_issued: 'Refund issued', return_opened: 'Return opened', return_resolved: 'Return resolved',
  replacement_created: 'Replacement created', backorder_split: 'Backorder split',
  override: 'Manager override', note: 'Note',
};

const STAGE_FILTERS: { id: 'all' | 'active' | OrderStage; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'refunded', label: 'Refunded' },
];

const ACTIVE_STAGES = ['placed', 'paid', 'picking', 'packed', 'ready', 'arrived'];

type HistoryOrder = RetailOrder & { id: string };

export default function RetailOrderHistoryPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { user } = useUser();
  const { toast } = useToast();

  const actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );

  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [cursor, setCursor] = useState<any>(null);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | OrderStage>('all');
  const [detail, setDetail] = useState<HistoryOrder | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const mergeOrders = (prev: HistoryOrder[], add: HistoryOrder[]) => {
    const seen = new Map(prev.map((o) => [o.id, o]));
    add.forEach((o) => seen.set(o.id, o));
    return [...seen.values()].sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || ''));
  };

  const loadPage = useCallback(async (after?: any) => {
    if (!firestore || !tenantId) return;
    const base = [orderBy('placedAt', 'desc'), limit(PAGE_SIZE)] as any[];
    const q = after
      ? query(collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`), base[0], startAfter(after), base[1])
      : query(collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`), base[0], base[1]);
    const snap = await getDocs(q);
    const batch = snap.docs.map((d: any) => ({ ...(d.data() as RetailOrder), id: d.id as string }));
    setOrders((prev) => mergeOrders(after ? prev : [], batch));
    setCursor(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
    setExhausted(snap.docs.length < PAGE_SIZE);
  }, [firestore, tenantId]);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    setLoading(true);
    loadPage().finally(() => setLoading(false));
  }, [firestore, tenantId, loadPage]);

  // Pure-digit searches also hit the backend directly, so an order from months
  // ago is findable without paging through everything.
  useEffect(() => {
    if (!firestore || !tenantId) return;
    const num = parseInt(term.replace(/^#/, ''), 10);
    if (!Number.isFinite(num) || String(num) !== term.replace(/^#/, '').trim()) return;
    const t = setTimeout(async () => {
      const snap = await getDocs(query(
        collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`),
        where('orderNumber', '==', num)
      ));
      const found = snap.docs.map((d: any) => ({ ...(d.data() as RetailOrder), id: d.id as string }));
      if (found.length > 0) setOrders((prev) => mergeOrders(prev, found));
    }, 350);
    return () => clearTimeout(t);
  }, [term, firestore, tenantId]);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === 'active' ? !ACTIVE_STAGES.includes(o.stage) : filter !== 'all' && o.stage !== filter) return false;
      if (!t) return true;
      return (
        String(o.orderNumber).includes(t.replace(/^#/, '')) ||
        (o.customerName || '').toLowerCase().includes(t) ||
        (o.customerEmail || '').toLowerCase().includes(t) ||
        (o.businessName || '').toLowerCase().includes(t) ||
        (o.poNumber || '').toLowerCase().includes(t)
      );
    });
  }, [orders, term, filter]);

  const openDetail = async (o: HistoryOrder) => {
    setDetail(o);
    setEvents([]);
    if (!firestore || !tenantId) return;
    setEventsLoading(true);
    try {
      const fresh = await getDoc(doc(firestore as Firestore, `tenants/${tenantId}/retailOrders`, o.id));
      if (fresh.exists()) setDetail({ ...(fresh.data() as RetailOrder), id: o.id });
      const evSnap = await getDocs(query(
        collection(firestore as Firestore, `tenants/${tenantId}/retailOrders/${o.id}/events`),
        orderBy('at', 'asc')
      ));
      setEvents(evSnap.docs.map((d: any) => d.data() as OrderEvent));
    } finally {
      setEventsLoading(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast({ title: `${label} copied` }))
      .catch(() => toast({ variant: 'destructive', title: 'Could not copy' }));
  };

  const stageBadge = (stage: OrderStage) => (
    <Badge variant="outline" className={cn(
      'h-6 px-2.5 font-black text-[8px] uppercase tracking-widest border-2 shrink-0',
      ['completed', 'handed_off', 'shipped'].includes(stage) && 'bg-green-50 border-green-100 text-green-700',
      ['cancelled', 'refunded'].includes(stage) && 'bg-slate-100 border-slate-200 text-slate-500',
      ACTIVE_STAGES.includes(stage) && 'bg-primary/5 border-primary/20 text-primary'
    )}>
      {STAGE_LABELS[stage] || stage}
    </Badge>
  );

  const methodIcon = (m: string) => (m === 'curbside' ? Car : m === 'ship' ? Truck : Store);

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Order History</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              {orders.length} loaded{exhausted ? ' · all' : ''}
            </p>
          </div>
          <History className="w-5 h-5 text-primary/40" />
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input
              placeholder="Search order #, name, email, business, PO…"
              value={term}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
              className="h-12 pl-11 rounded-2xl border-2 font-bold text-sm"
            />
            {term && (
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 p-1" onClick={() => setTerm('')}>
                <X className="w-4 h-4 opacity-40" />
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {STAGE_FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className={cn('shrink-0 h-8 px-3.5 rounded-full border-2 text-[9px] font-black uppercase tracking-widest transition-all',
                  filter === f.id ? 'bg-foreground text-background border-foreground' : 'bg-white hover:border-primary/40')}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-2.5">
        {loading && (
          <div className="py-24 text-center"><Loader className="w-7 h-7 mx-auto animate-spin text-primary" /></div>
        )}
        {!loading && shown.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <Search className="w-8 h-8 mx-auto opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No matching orders</p>
          </div>
        )}
        {shown.map((o) => {
          const Icon = methodIcon(o.method);
          return (
            <button key={o.id} type="button" onClick={() => openDetail(o)} className="w-full text-left">
              <Card className="border-2 rounded-2xl overflow-hidden bg-white hover:border-primary/40 transition-all">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl border-2 bg-muted/10 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-black uppercase tracking-tight text-sm">#{String(o.orderNumber).padStart(4, '0')}</p>
                      {o.priceTier === 'wholesale' && (
                        <Badge className="h-5 px-1.5 bg-primary/10 text-primary border-2 border-primary/20 font-black text-[7px] uppercase tracking-widest">B2B</Badge>
                      )}
                      {(o.pendingRefundCents || 0) > 0 && (
                        <Badge className="h-5 px-1.5 bg-amber-50 text-amber-700 border-2 border-amber-100 font-black text-[7px] uppercase tracking-widest">Refund due</Badge>
                      )}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">
                      {o.customerName}{o.customerEmail ? ` · ${o.customerEmail}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    {stageBadge(o.stage)}
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      {when(o.placedAt)} · <span className="font-mono font-black text-foreground">{fmt(o.totalCents)}</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
        {!loading && !exhausted && (
          <Button variant="outline" disabled={loadingMore}
            onClick={() => { setLoadingMore(true); loadPage(cursor).finally(() => setLoadingMore(false)); }}
            className="w-full h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest">
            {loadingMore ? <Loader className="h-4 w-4 animate-spin" /> : 'Load older orders'}
          </Button>
        )}
      </main>

      <Sheet open={!!detail} onOpenChange={(v: boolean) => !v && setDetail(null)}>
        <SheetContent side="bottom" className="rounded-t-[2rem] border-t-4 p-0 h-[90dvh] flex flex-col">
          {detail && (
            <>
              <SheetHeader className="p-6 pb-4 border-b-2 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <SheetTitle className="font-black uppercase tracking-tighter text-2xl leading-none">
                      #{String(detail.orderNumber).padStart(4, '0')}
                    </SheetTitle>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">
                      {detail.customerName} · {when(detail.placedAt)}
                    </p>
                  </div>
                  {stageBadge(detail.stage)}
                </div>
                <div className="flex flex-wrap gap-2 pt-3">
                  <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
                    onClick={() => copy(`${window.location.origin}/shop/${tenantId}/order/${detail.id}`, 'Customer tracking link')}>
                    <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Tracking link
                  </Button>
                  {detail.customerEmail && (
                    <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
                      onClick={() => copy(detail.customerEmail, 'Email')}>
                      Email
                    </Button>
                  )}
                  {detail.qrToken && (
                    <Button variant="outline" size="sm" className="h-9 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest"
                      onClick={() => window.open(`/print/packing-slip/${tenantId}/${detail.id}?t=${encodeURIComponent(detail.qrToken || '')}`, '_blank')}>
                      <Printer className="mr-1.5 h-3.5 w-3.5" /> Slip
                    </Button>
                  )}
                  {(detail.pendingRefundCents || 0) > 0 && (
                    <Button size="sm" disabled={busy}
                      className="h-9 rounded-xl font-black uppercase text-[9px] tracking-widest bg-amber-500 hover:bg-amber-600"
                      onClick={async () => {
                        if (!firestore || !tenantId) return;
                        setBusy(true);
                        const r = await markRefundExecuted(firestore as Firestore, tenantId, detail.id, actor);
                        setBusy(false);
                        toast({ variant: r.ok ? 'default' : 'destructive', title: r.message });
                        if (r.ok) openDetail(detail);
                      }}>
                      Mark {fmt(detail.pendingRefundCents || 0)} refunded
                    </Button>
                  )}
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="space-y-2">
                  {detail.lines.map((l) => (
                    <div key={l.lineId} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black uppercase tracking-tight text-xs">{l.qtyOrdered - l.qtyShorted} × {l.name}</p>
                        {(l.qtyShorted > 0 || (l.qtyReturned || 0) > 0) && (
                          <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                            {l.qtyShorted > 0 ? `${l.qtyShorted} ${l.status === 'backordered' ? 'backordered' : 'shorted'}` : ''}
                            {l.qtyShorted > 0 && (l.qtyReturned || 0) > 0 ? ' · ' : ''}
                            {(l.qtyReturned || 0) > 0 ? `${l.qtyReturned} returned` : ''}
                          </p>
                        )}
                      </div>
                      <p className="font-black font-mono text-xs shrink-0">{fmt(l.unitPriceCents * (l.qtyOrdered - l.qtyShorted))}</p>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between items-baseline">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground space-x-3">
                      <span>Sub {fmt(detail.subtotalCents)}</span>
                      {detail.taxCents > 0 && <span>Tax {fmt(detail.taxCents)}</span>}
                      {detail.shippingCents > 0 && <span>Ship {fmt(detail.shippingCents)}</span>}
                      {detail.refundedCents > 0 && <span className="text-amber-600">Refunded {fmt(detail.refundedCents)}</span>}
                    </div>
                    <p className="font-black font-mono text-lg text-primary">{fmt(detail.totalCents)}</p>
                  </div>
                  {(detail.businessName || detail.poNumber) && (
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {detail.businessName}{detail.poNumber ? ` · PO ${detail.poNumber}` : ''}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Audit timeline</p>
                  {eventsLoading && <Loader className="w-5 h-5 animate-spin text-primary" />}
                  <div className="space-y-0">
                    {events.map((ev, i) => (
                      <div key={ev.id || i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={cn('w-2.5 h-2.5 rounded-full mt-1.5 shrink-0',
                            ev.type === 'scan_mismatch' || ev.type === 'override' ? 'bg-amber-500' : 'bg-primary')} />
                          {i < events.length - 1 && <div className="w-0.5 flex-1 bg-muted my-0.5" />}
                        </div>
                        <div className="pb-4 min-w-0">
                          <p className="text-xs font-black uppercase tracking-tight">
                            {EVENT_LABELS[ev.type] || ev.type}
                          </p>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {when(ev.at)} · {ev.actorName}
                            {ev.meta?.reason ? ` · ${ev.meta.reason}` : ''}
                            {ev.meta?.text ? ` · ${ev.meta.text}` : ''}
                            {ev.meta?.qtyScanned != null ? ` · ${ev.meta.qtyScanned}/${ev.meta.qtyOrdered}` : ''}
                            {ev.meta?.amountCents != null ? ` · ${fmt(Number(ev.meta.amountCents))}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                    {!eventsLoading && events.length === 0 && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">No events recorded</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
