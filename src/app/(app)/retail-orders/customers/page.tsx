'use client';

import {
  collection, getDocs, limit, orderBy, query, type Firestore,
} from 'firebase/firestore';
import {
  ArrowLeft, Crown, Loader, Mail, Search, Sparkles, Clock, Users,
} from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetTitle,
} from '@/components/ui/sheet';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { cn } from '@/lib/utils';

// ─── Shoppers ─────────────────────────────────────────────────────────────────
// A CRM with no new data model: every number here is derived from orders the
// shop already has. That matters — a separate customer table would start
// wrong and drift, while this is true by construction the moment an order
// lands.
//
// Per shopper: lifetime spend, order count, average order, first and last
// order, favourite category, and how they buy (pickup vs ship). Segments
// answer the questions a shop actually asks — who are my regulars, who spends
// most, who has gone quiet, and who is brand new.

const TERMINAL_UNPAID = ['placed', 'cancelled'];

interface Shopper {
  email: string;
  name: string;
  phone: string;
  orders: number;
  spendCents: number;
  firstAt: string;
  lastAt: string;
  categories: Record<string, number>;
  methods: Record<string, number>;
  lines: { name: string; qty: number }[];
  history: { id: string; number: number; at: string; totalCents: number; stage: string }[];
}

const money = (c: number) => `$${((c || 0) / 100).toFixed(2)}`;
const daysSince = (iso: string) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;
};
const when = (iso: string) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ShoppersPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';

  const [loading, setLoading] = useState(true);
  const [shoppers, setShoppers] = useState<Shopper[]>([]);
  const [term, setTerm] = useState('');
  const [segment, setSegment] = useState<'all' | 'repeat' | 'top' | 'lapsed' | 'new'>('all');
  const [detail, setDetail] = useState<Shopper | null>(null);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`),
          orderBy('placedAt', 'desc'),
          limit(1000)
        ));

        const byEmail = new Map<string, Shopper>();
        snap.docs.forEach((d) => {
          const o = d.data() as any;
          const email = String(o.customerEmail || '').trim().toLowerCase();
          if (!email) return;
          // Unpaid and cancelled orders are attempts, not custom.
          if (TERMINAL_UNPAID.includes(String(o.stage))) return;

          const at = String(o.placedAt || '');
          const s = byEmail.get(email) || {
            email,
            name: String(o.customerName || 'Guest'),
            phone: String(o.customerPhone || ''),
            orders: 0, spendCents: 0, firstAt: at, lastAt: at,
            categories: {}, methods: {}, lines: [], history: [],
          };

          s.orders += 1;
          s.spendCents += Math.max(0, (Number(o.totalCents) || 0) - (Number(o.refundedCents) || 0));
          if (at && (!s.firstAt || at < s.firstAt)) s.firstAt = at;
          if (at && (!s.lastAt || at > s.lastAt)) s.lastAt = at;
          if (o.customerPhone && !s.phone) s.phone = String(o.customerPhone);
          const m = String(o.method || 'pickup');
          s.methods[m] = (s.methods[m] || 0) + 1;
          (o.lines || []).forEach((l: any) => {
            const cat = String(l.category || '').trim();
            if (cat) s.categories[cat] = (s.categories[cat] || 0) + (Number(l.qtyOrdered) || 1);
            s.lines.push({ name: String(l.name || ''), qty: Number(l.qtyOrdered) || 1 });
          });
          s.history.push({
            id: d.id,
            number: Number(o.orderNumber) || 0,
            at,
            totalCents: Number(o.totalCents) || 0,
            stage: String(o.stage || ''),
          });
          byEmail.set(email, s);
        });

        if (!alive) return;
        setShoppers([...byEmail.values()].sort((a, b) => b.spendCents - a.spendCents));
      } catch {
        if (alive) setShoppers([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [firestore, tenantId]);

  const totals = useMemo(() => {
    const orders = shoppers.reduce((a, s) => a + s.orders, 0);
    const spend = shoppers.reduce((a, s) => a + s.spendCents, 0);
    const repeat = shoppers.filter((s) => s.orders > 1).length;
    return {
      customers: shoppers.length,
      orders,
      spend,
      aov: orders ? Math.round(spend / orders) : 0,
      repeatRate: shoppers.length ? Math.round((repeat / shoppers.length) * 100) : 0,
    };
  }, [shoppers]);

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    return shoppers.filter((s) => {
      if (t && !(s.name.toLowerCase().includes(t) || s.email.includes(t) || s.phone.includes(t))) return false;
      const since = daysSince(s.lastAt);
      if (segment === 'repeat') return s.orders > 1;
      if (segment === 'top') return s.spendCents >= 10_000;
      if (segment === 'lapsed') return s.orders > 0 && since !== null && since > 90;
      if (segment === 'new') return s.orders === 1 && since !== null && since <= 30;
      return true;
    });
  }, [shoppers, term, segment]);

  const favourite = (s: Shopper) => {
    const entries = Object.entries(s.categories);
    if (entries.length === 0) return '';
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 border-b-2 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back to shop orders" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black uppercase leading-none tracking-tighter">Shoppers</h1>
            <p className="mt-0.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {loading ? 'Reading orders…' : `${totals.customers} customers · ${totals.orders} orders`}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { label: 'lifetime revenue', value: money(totals.spend) },
            { label: 'average order', value: money(totals.aov) },
            { label: 'repeat customers', value: `${totals.repeatRate}%` },
            { label: 'customers', value: String(totals.customers) },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border-2 bg-white p-3">
              <p className="font-mono text-lg font-bold leading-none">{k.value}</p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
          <label htmlFor="shopper-search" className="sr-only">Search shoppers</label>
          <Input
            id="shopper-search"
            value={term}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
            placeholder="Search by name, email or phone…"
            className="h-12 rounded-2xl border-2 pl-11 text-sm font-bold"
          />
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {([
            ['all', 'Everyone', Users],
            ['repeat', 'Regulars', Sparkles],
            ['top', 'Top spenders', Crown],
            ['lapsed', 'Gone quiet', Clock],
            ['new', 'New', Mail],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSegment(key)}
              aria-pressed={segment === key}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 text-[11px] font-black uppercase tracking-widest transition-colors',
                segment === key ? 'border-foreground bg-foreground text-background' : 'bg-white'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="py-24 text-center">
            <Loader className="mx-auto h-7 w-7 animate-spin text-primary" aria-label="Loading shoppers" />
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="rounded-[2rem] border-2 border-dashed py-20 text-center">
            <Users className="mx-auto h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold">
              {shoppers.length === 0 ? 'No paid orders yet' : 'Nobody matches that'}
            </p>
          </div>
        )}

        <div className="space-y-2">
          {visible.map((s) => {
            const since = daysSince(s.lastAt);
            return (
              <button
                key={s.email}
                type="button"
                onClick={() => setDetail(s)}
                className="w-full rounded-[1.5rem] border-2 bg-white p-4 text-left transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase tracking-tight">{s.name}</p>
                    <p className="truncate text-[11px] font-bold text-muted-foreground">{s.email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-base font-bold leading-none">{money(s.spendCents)}</p>
                    <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                      {s.orders} order{s.orders === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.orders > 1 && (
                    <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">Regular</span>
                  )}
                  {favourite(s) && (
                    <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">{favourite(s)}</span>
                  )}
                  <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">
                    {since === null ? '—' : since === 0 ? 'today' : `${since}d ago`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </main>

      <Sheet open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <SheetContent side="bottom" className="h-[90dvh] overflow-y-auto rounded-t-[2rem] border-t-2">
          <SheetTitle className="sr-only">Shopper detail</SheetTitle>
          {detail && (
            <div className="mx-auto max-w-2xl space-y-4 pt-2">
              <div>
                <h2 className="text-xl font-black uppercase leading-none tracking-tighter">{detail.name}</h2>
                <p className="mt-1 text-[11px] font-bold text-muted-foreground">{detail.email}{detail.phone ? ` · ${detail.phone}` : ''}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'lifetime', value: money(detail.spendCents) },
                  { label: 'orders', value: String(detail.orders) },
                  { label: 'avg order', value: money(Math.round(detail.spendCents / Math.max(1, detail.orders))) },
                ].map((k) => (
                  <div key={k.label} className="rounded-2xl border-2 p-3">
                    <p className="font-mono text-base font-bold leading-none">{k.value}</p>
                    <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border-2 p-3 text-[11px] font-bold">
                <p>First order {when(detail.firstAt)} · last {when(detail.lastAt)}</p>
                <p className="mt-1 text-muted-foreground">
                  {Object.entries(detail.methods).map(([m, n]) => `${n}× ${m.replace('_', ' ')}`).join(' · ')}
                  {favourite(detail) ? ` · mostly ${favourite(detail)}` : ''}
                </p>
              </div>

              <Button asChild variant="outline" className="h-11 w-full rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest">
                <a href={`mailto:${detail.email}`}>Email {detail.name.split(' ')[0]}</a>
              </Button>

              <div className="space-y-2">
                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Orders</p>
                {detail.history.sort((a, b) => String(b.at).localeCompare(String(a.at))).map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 p-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold">#{String(h.number).padStart(4, '0')}</p>
                      <p className="text-[11px] font-bold text-muted-foreground">{when(h.at)} · {h.stage.replace('_', ' ')}</p>
                    </div>
                    <p className="shrink-0 font-mono text-sm font-bold">{money(h.totalCents)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
