'use client';

import { type Firestore, collection, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowLeft, Check, Loader, Printer, Waves as WavesIcon } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { permissionsFor } from '@/lib/fulfilment-access';
import {
  buildWave, eligibleForWave, packQueue, pickList, markRowPicked, setWaveStatus,
  waveCol, waveSummary, type Wave,
} from '@/lib/waves';
import { cn } from '@/lib/utils';

// ─── Wave picking ─────────────────────────────────────────────────────────────
// Phase one of two-phase fulfilment: pick the whole morning's orders in one
// walk, dropping units into numbered totes, then pack at a bench.
//
// The screen is also the printout — the same markup prints as the pick sheet,
// so a printer jam never stops the work and paper never disagrees with the
// screen.

export default function WavesPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { inventory } = useInventory();
  const { user } = useUser();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id || '';

  const [orders, setOrders] = useState<any[]>([]);
  const [waves, setWaves] = useState<Wave[]>([]);
  const [busy, setBusy] = useState(false);
  const [maxTotes, setMaxTotes] = useState('12');
  const [cutoff, setCutoff] = useState('');

  const actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );
  const perms = useMemo(() => {
    const staff = (selectedTenant as any)?.staffMember || { role: (selectedTenant as any)?.role || 'staff' };
    return permissionsFor(staff);
  }, [selectedTenant]);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(
      query(
        collection(firestore as Firestore, `tenants/${tenantId}/retailOrders`),
        where('stage', 'in', ['paid', 'picking', 'packed', 'ready'])
      ),
      (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    return unsub;
  }, [firestore, tenantId]);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(waveCol(firestore as Firestore, tenantId), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Wave[];
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      setWaves(rows);
    });
    return unsub;
  }, [firestore, tenantId]);

  const shelfFor = useMemo(() => {
    const map = new Map<string, string>();
    (inventory || []).forEach((i: any) => {
      const explicit = String(i.storageLocation || i.shelf || i.binLocation || '').trim();
      if (explicit) { map.set(i.id, explicit); return; }
      const allocs = Object.values((i.allocations && typeof i.allocations === 'object') ? i.allocations : {}) as any[];
      const held = allocs.filter((a) => a && Number(a.qty) > 0).sort((a, b) => Number(b.qty) - Number(a.qty));
      if (held.length > 0) map.set(i.id, String(held[0].name || ''));
    });
    return map;
  }, [inventory]);

  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const cutoffIso = useMemo(
    () => (cutoff ? new Date(cutoff).toISOString() : new Date().toISOString()),
    [cutoff]
  );
  const waiting = useMemo(() => eligibleForWave(orders, cutoffIso), [orders, cutoffIso]);

  const active = useMemo(
    () => waves.find((w) => w.status === 'picking') || waves.find((w) => w.status === 'packing') || null,
    [waves]
  );

  const rows = useMemo(
    () => (active ? pickList(active, ordersById, shelfFor) : []),
    [active, ordersById, shelfFor]
  );
  const summary = useMemo(
    () => (active ? waveSummary(rows, active) : null),
    [rows, active]
  );

  const build = async () => {
    if (!firestore || busy) return;
    setBusy(true);
    const res = await buildWave(
      firestore as Firestore, tenantId, orders,
      { maxTotes: Math.max(1, Number(maxTotes) || 12), cutoffAt: cutoffIso },
      actor
    );
    setBusy(false);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? 'Wave built' : 'Could not build', description: res.message });
  };

  const picked = new Set(active?.pickedProductIds || []);

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 border-b-2 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back to orders" className="h-10 w-10 rounded-xl">
            <Link href="/retail-orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black uppercase leading-none tracking-tighter">Wave picking</h1>
            <p className="mt-0.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {active ? `${active.name} · ${active.status}` : `${waiting.length} orders waiting`}
            </p>
          </div>
          {active && (
            <Button
              variant="outline"
              onClick={() => window.print()}
              className="h-10 shrink-0 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest"
            >
              <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> Print
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {!active && (
          <Card className="border-2 rounded-[2rem] overflow-hidden bg-white print:hidden">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <WavesIcon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <p className="text-[11px] font-black uppercase tracking-widest">Build today&rsquo;s wave</p>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                Takes the longest-waiting orders first, up to your tote count. Orders placed after the
                cutoff wait for the next wave, so the sheet in your hand never changes underneath you.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="totes" className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    Totes available
                  </Label>
                  <Input
                    id="totes" inputMode="numeric" value={maxTotes}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxTotes(e.target.value)}
                    className="h-11 rounded-xl border-2 text-center font-mono text-sm font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cutoff" className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    Cutoff (blank = now)
                  </Label>
                  <Input
                    id="cutoff" type="datetime-local" value={cutoff}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCutoff(e.target.value)}
                    className="h-11 rounded-xl border-2 text-sm font-bold"
                  />
                </div>
              </div>

              <Button
                onClick={build}
                disabled={busy || waiting.length === 0 || !perms.canPack}
                className="h-12 w-full rounded-2xl text-[11px] font-black uppercase tracking-widest"
              >
                {busy ? <Loader className="h-4 w-4 animate-spin" />
                  : waiting.length === 0 ? 'Nothing waiting'
                  : `Build wave — ${Math.min(waiting.length, Math.max(1, Number(maxTotes) || 12))} orders`}
              </Button>
              {!perms.canPack && (
                <p className="text-[11px] font-bold text-muted-foreground">
                  Building a wave is a packer or manager job.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {active && summary && (
          <>
            <div className="rounded-[1.5rem] border-2 bg-white p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ['orders', summary.orders], ['products', summary.products],
                  ['units', summary.units], ['stops', summary.stops], ['packed', summary.packed],
                ].map(([label, n]) => (
                  <div key={String(label)}>
                    <p className="font-mono text-xl font-bold leading-none">{n as number}</p>
                    <p className="mt-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] font-bold text-muted-foreground">
                Tote 1 is the order that has waited longest. Drop each unit into its tote as you walk.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Pick list — walk in this order
              </p>
              {rows.map((r) => {
                const done = picked.has(r.productId);
                return (
                  <button
                    key={r.productId}
                    type="button"
                    onClick={() => {
                      if (!firestore || !active) return;
                      markRowPicked(firestore as Firestore, tenantId, active.id, r.productId, !done);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border-2 bg-white p-4 text-left',
                      done && 'opacity-45'
                    )}
                  >
                    <span className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2',
                      done && 'border-primary bg-primary text-primary-foreground'
                    )}>
                      {done ? <Check className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black uppercase tracking-tight">{r.name}</span>
                      <span className="block truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        {r.location || 'no location set'} · totes {r.totes.map((t) => (t.qty > 1 ? `${t.tote}×${t.qty}` : t.tote)).join(', ')}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-2xl font-bold">{r.totalQty}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 print:break-before-page">
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Totes — pack in this order
              </p>
              {packQueue(active, ordersById).map((w) => (
                <div key={w.orderId} className="flex items-center gap-3 rounded-2xl border-2 bg-white p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 font-mono text-lg font-bold">
                    {w.tote}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black uppercase tracking-tight">
                      #{String(w.orderNumber).padStart(4, '0')} · {w.customerName}
                    </span>
                    <span className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      {w.itemCount} item{w.itemCount === 1 ? '' : 's'} · {String(w.method).replace('_', ' ')}
                    </span>
                  </span>
                  <Button
                    asChild variant="outline" size="sm"
                    className="h-9 shrink-0 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest print:hidden"
                  >
                    <a href={`/print/packing-slip/${tenantId}/${w.orderId}`} target="_blank" rel="noreferrer">Slip</a>
                  </Button>
                </div>
              ))}
            </div>

            {perms.canPack && (
              <div className="flex gap-2 print:hidden">
                <Button
                  variant="outline"
                  onClick={() => firestore && setWaveStatus(firestore as Firestore, tenantId, active.id, active.status === 'picking' ? 'packing' : 'done')}
                  className="h-12 flex-1 rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest"
                >
                  {active.status === 'picking' ? 'Shelves walked — move to the bench' : 'Close this wave'}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
