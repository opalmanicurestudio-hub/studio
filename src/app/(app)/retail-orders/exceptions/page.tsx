'use client';

// ─── /retail-orders/exceptions ────────────────────────────────────────────────
// The Loss & Recovery Ledger's first face: every inventory exception, newest
// first, each showing the full triple — landed cost (the accounting number),
// retail value and lost margin (the operational truth) — with its reason,
// who's responsible, whether recovery is on the table, and links back to the
// order and evidence. The header answers the month at a glance. Round N2
// grows the recovery column into the full claim lifecycle; this page is
// where a loss stops being an invisible inventory adjustment.

import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import { ArrowLeft, ShieldQuestion, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { cn } from '@/lib/utils';
import { reasonGroup, reasonLabel } from '@/lib/inventory-exceptions';

const fmt = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

const GROUP_CLS: Record<string, string> = {
  customer: 'border-slate-200 bg-slate-50 text-slate-700',
  carrier: 'border-blue-200 bg-blue-50 text-blue-700',
  supplier: 'border-purple-200 bg-purple-50 text-purple-700',
  internal: 'border-amber-200 bg-amber-50 text-amber-700',
};

export default function InventoryExceptionsPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    return onSnapshot(collection(firestore as Firestore, `tenants/${tenantId}/inventoryExceptions`), (snap) => {
      setRows(snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))));
      setLoading(false);
    });
  }, [firestore, tenantId]);

  const monthKey = new Date().toISOString().slice(0, 7);
  const totals = useMemo(() => {
    const month = rows.filter((r) => String(r.at || '').startsWith(monthKey));
    return {
      count: month.length,
      landed: month.reduce((a, r) => a + (r.landedCostCents || 0), 0),
      retail: month.reduce((a, r) => a + (r.retailCents || 0), 0),
      margin: month.reduce((a, r) => a + (r.marginCents || 0), 0),
      candidates: month.filter((r) => r.recovery?.status === 'candidate').length,
      uncosted: month.filter((r) => r.costed === false).length,
    };
  }, [rows, monthKey]);

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Inventory exceptions</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              Loss &amp; recovery ledger · nothing disappears as an adjustment
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ['This month', String(totals.count)],
            ['Landed cost lost', fmt(totals.landed)],
            ['Retail affected', fmt(totals.retail)],
            ['Margin affected', fmt(totals.margin)],
          ] as const).map(([k, v]) => (
            <Card key={k} className="border-2 rounded-2xl bg-white">
              <CardContent className="p-3">
                <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">{k}</p>
                <p className="mt-0.5 font-mono text-lg font-black leading-none">{v}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {(totals.candidates > 0 || totals.uncosted > 0) && (
          <div className="flex flex-wrap gap-2">
            {totals.candidates > 0 && (
              <p className="rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-blue-700">
                {totals.candidates} recoverable — carrier or supplier may owe you (Recovery Queue lands next round)
              </p>
            )}
            {totals.uncosted > 0 && (
              <p className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                {totals.uncosted} missing a product cost — set costPerUnit in inventory for true figures
              </p>
            )}
          </div>
        )}

        {loading && <p className="py-20 text-center text-[10px] font-black uppercase tracking-widest opacity-30">Loading…</p>}
        {!loading && rows.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <ShieldQuestion className="mx-auto h-8 w-8 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">
              No exceptions yet — they appear when returns are written off or claims approved
            </p>
          </div>
        )}

        {rows.map((r) => (
          <Card key={r.id} className="border-2 rounded-[2rem] overflow-hidden bg-white">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black uppercase tracking-tight text-sm truncate">
                    {r.qty > 1 ? `${r.qty} × ` : ''}{r.name}
                  </p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
                    {when(r.at)}{r.orderNumber != null ? ` · order #${String(r.orderNumber).padStart(4, '0')}` : ''} · {r.responsibleParty} · via {String(r.source || '').replace('_', ' ')}
                  </p>
                </div>
                <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-widest',
                  GROUP_CLS[r.reasonGroup] || GROUP_CLS.internal)}>
                  {reasonLabel(r.reason)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-2xl border-2 border-dashed p-2.5 text-center">
                <div>
                  <p className="font-mono text-sm font-black">{r.costed === false ? '—' : fmt(r.landedCostCents)}</p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Landed cost{r.ledgerTxnId ? ' · ledgered' : ''}</p>
                </div>
                <div>
                  <p className="font-mono text-sm font-black">{fmt(r.retailCents)}</p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Retail value</p>
                </div>
                <div>
                  <p className="font-mono text-sm font-black">{fmt(r.marginCents)}</p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Margin lost</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.recovery?.status === 'candidate' && (
                  <span className="flex items-center gap-1 rounded-full border-2 border-blue-200 bg-blue-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-blue-700">
                    <TriangleAlert className="h-3 w-3" /> Recoverable
                  </span>
                )}
                {r.costed === false && (
                  <span className="rounded-full border-2 border-amber-200 bg-amber-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-amber-700">
                    Needs product cost
                  </span>
                )}
                {r.orderId && (
                  <Link href={`/retail-orders/evidence/${r.orderId}`}
                    className="ml-auto text-[9px] font-black uppercase tracking-widest text-primary underline-offset-4 hover:underline">
                    Evidence
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
