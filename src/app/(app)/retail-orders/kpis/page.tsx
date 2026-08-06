'use client';

import {
  type Firestore, collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { ArrowLeft, Gauge, Loader, Target } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { permissionsFor, staffKpis, teamKpis, type StaffKpis } from '@/lib/fulfilment-access';
import { dueAt, fulfilmentPolicy } from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

// ─── Fulfilment KPIs ──────────────────────────────────────────────────────────
// Numbers about how work actually went, derived from events the engine already
// writes — no timers to start, nothing for staff to fill in.
//
// Two deliberate rules, because dashboards change behaviour:
//   • Speed never appears without accuracy beside it. A board that ranks people
//     on minutes alone produces rushed picking and hidden shorts.
//   • Everyone sees their own card; only managers see the team. People should
//     meet their own numbers before anyone else does.

const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
] as const;

export default function FulfilmentKpisPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { user } = useUser();
  const tenantId = selectedTenant?.id || '';

  const [rangeId, setRangeId] = useState<string>('7');
  const [rows, setRows] = useState<StaffKpis[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderCount, setOrderCount] = useState(0);

  const perms = useMemo(() => {
    const staff = (selectedTenant as any)?.staffMember || { role: (selectedTenant as any)?.role || 'staff' };
    return permissionsFor(staff);
  }, [selectedTenant]);

  const policy = useMemo(
    () => fulfilmentPolicy((selectedTenant as any)?.retailSettings),
    [selectedTenant]
  );

  useEffect(() => {
    if (!firestore || !tenantId) return;
    let alive = true;
    setLoading(true);

    (async () => {
      try {
        const days = RANGES.find((r) => r.id === rangeId)?.days ?? 7;
        const since = new Date(Date.now() - days * 86_400_000).toISOString();

        const snap = await getDocs(query(
          collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`),
          where('placedAt', '>', since),
          orderBy('placedAt', 'desc'),
          limit(150)
        ));

        // Events live in a subcollection per order; fetched in parallel and
        // capped, because a KPI screen must never become the slowest page.
        const withEvents = await Promise.all(snap.docs.map(async (d) => {
          const data = d.data() as any;
          let events: any[] = [];
          try {
            const evSnap = await getDocs(query(collection(d.ref, 'events'), limit(60)));
            events = evSnap.docs.map((e) => e.data() as any);
          } catch {
            // an order whose events can't be read simply contributes nothing
          }
          return {
            id: d.id,
            orderNumber: data.orderNumber,
            stage: data.stage,
            method: data.method,
            placedAt: data.placedAt,
            paidAt: data.paidAt,
            lines: data.lines || [],
            events,
            dueAtMs: dueAt(data, policy),
          };
        }));

        if (!alive) return;
        setOrderCount(withEvents.length);
        setRows(staffKpis(withEvents));
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [firestore, tenantId, rangeId, policy]);

  const team = useMemo(() => teamKpis(rows), [rows]);
  const mine = useMemo(
    () => rows.find((r) => r.actorId === user?.uid) || null,
    [rows, user?.uid]
  );

  const visible = perms.canSeeTeam ? rows : rows.filter((r) => r.actorId === user?.uid);

  const stat = (label: string, value: string, tone?: 'good' | 'warn') => (
    <div key={label} className="rounded-2xl border-2 p-3">
      <p className={cn('font-mono text-xl font-bold leading-none',
        tone === 'warn' && 'text-amber-600', tone === 'good' && 'text-emerald-700')}>
        {value}
      </p>
      <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 border-b-2 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back to orders" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black uppercase leading-none tracking-tighter">Fulfilment</h1>
            <p className="mt-0.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {loading ? 'Reading order history…' : `${orderCount} orders · ${team.people} people`}
            </p>
          </div>
        </div>
        <div className="mx-auto flex max-w-4xl gap-1.5 px-4 pb-3">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={rangeId === r.id}
              onClick={() => setRangeId(r.id)}
              className={cn('h-9 rounded-full border-2 px-3.5 text-[11px] font-black uppercase tracking-widest',
                rangeId === r.id ? 'border-foreground bg-foreground text-background' : 'bg-white')}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        {loading && (
          <div className="py-24 text-center">
            <Loader className="mx-auto h-7 w-7 animate-spin text-primary" aria-label="Loading" />
          </div>
        )}

        {!loading && mine && (
          <Card className="border-2 border-primary/40 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <p className="text-[11px] font-black uppercase tracking-widest">Your work</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {stat('orders picked', String(mine.ordersPicked))}
                {stat('items picked', String(mine.itemsPicked))}
                {stat('typical order', mine.medianMinutes === null ? '—' : `${mine.medianMinutes}m`)}
                {stat('accuracy', mine.accuracy === null ? '—' : `${mine.accuracy}%`,
                  mine.accuracy !== null && mine.accuracy < 95 ? 'warn' : 'good')}
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                {mine.onTimeRate === null
                  ? 'No promise times to compare against yet.'
                  : `${mine.onTimeRate}% finished before the promised time.`}
                {mine.shortsRaised > 0 ? ` You flagged ${mine.shortsRaised} stock problem${mine.shortsRaised === 1 ? '' : 's'}.` : ''}
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && perms.canSeeTeam && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <p className="text-[11px] font-black uppercase tracking-widest">The shop</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {stat('orders', String(team.orders))}
                {stat('items', String(team.items))}
                {stat('typical order', team.medianMinutes === null ? '—' : `${team.medianMinutes}m`)}
                {stat('on time', team.onTimeRate === null ? '—' : `${team.onTimeRate}%`,
                  team.onTimeRate !== null && team.onTimeRate < 90 ? 'warn' : 'good')}
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && visible.length === 0 && (
          <div className="rounded-[2rem] border-2 border-dashed py-20 text-center">
            <Gauge className="mx-auto h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold">No picking recorded in this range</p>
            <p className="mt-1 text-[11px] font-bold text-muted-foreground">
              Numbers appear as orders are claimed, scanned and finished.
            </p>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {perms.canSeeTeam ? 'By person' : 'Your detail'}
            </p>
            {visible.map((r) => (
              <div key={r.actorId} className="rounded-[1.5rem] border-2 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate text-sm font-black uppercase tracking-tight">{r.name}</p>
                  <p className="shrink-0 font-mono text-base font-bold">
                    {r.ordersPicked} <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">orders</span>
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">
                    {r.itemsPicked} items
                  </span>
                  <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">
                    {r.medianMinutes === null ? 'no timing' : `${r.medianMinutes}m typical`}
                  </span>
                  <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest',
                    r.accuracy !== null && r.accuracy < 95 ? 'bg-amber-100 text-amber-800' : 'bg-muted/40')}>
                    {r.accuracy === null ? 'no scans' : `${r.accuracy}% accurate`}
                  </span>
                  {r.onTimeRate !== null && (
                    <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-widest',
                      r.onTimeRate < 90 ? 'bg-amber-100 text-amber-800' : 'bg-muted/40')}>
                      {r.onTimeRate}% on time
                    </span>
                  )}
                  {r.shortsRaised > 0 && (
                    <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">
                      {r.shortsRaised} shorts flagged
                    </span>
                  )}
                  {r.abandonedClaims > 0 && (
                    <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest">
                      {r.abandonedClaims} claims timed out
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && perms.canSeeTeam && rows.length > 1 && (
          <p className="text-[11px] font-bold text-muted-foreground">
            Read speed and accuracy together — a fast picker with a low accuracy score is
            costing you refunds, and a high shorts count usually means someone is finding
            stock problems everyone else walked past.
          </p>
        )}
      </main>
    </div>
  );
}
