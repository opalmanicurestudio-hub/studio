'use client';

import { type Firestore, collection, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowLeft, Check, Loader, Printer, ScanLine, Waves as WavesIcon } from 'lucide-react';
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
import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import {
  buildWave, eligibleForWave, packQueue, pickList, markRowPicked, recordWaveScan, setWaveStatus, waveScan,
  waveCol, waveSummary, type Wave,
} from '@/lib/waves';
import { hourIn, tenantTimeZone, todayIn } from '@/lib/tenant-time';
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
  const [autoTried, setAutoTried] = useState(false);
  const [lastDrop, setLastDrop] = useState<{ tote: number; name: string; scanned: number; totalQty: number } | null>(null);

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

  const codesFor = useMemo(() => {
    const map = new Map<string, string[]>();
    (inventory || []).forEach((i: any) => {
      const codes = [i.barcode, i.sku, i.upc, i.gtin]
        .map((c: any) => String(c || '').trim())
        .filter(Boolean);
      if (codes.length) map.set(i.id, codes);
    });
    return map;
  }, [inventory]);

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

  /*
   * Auto-build. A morning wave is a decision nobody should have to remember
   * while the phone is ringing, so a shop can set an hour and a tote cap and
   * have the wave waiting.
   *
   * Deliberately conservative: it runs only when a manager or packer actually
   * opens this page after the set hour, only if no wave was built today, and
   * only if orders are waiting. That avoids the two failure modes of a real
   * scheduler here — a wave built at 6am for a shop that opens at 10, and
   * duplicate waves from two devices racing. The buildWave transaction would
   * reject the second anyway.
   */
  useEffect(() => {
    if (autoTried || busy || !firestore || active) return;
    const rs = (selectedTenant as any)?.retailSettings || {};
    if (!rs.autoWaveEnabled) return;
    if (!perms.canPack) return;

    // Both questions here — is it late enough, and has one been built today —
    // were answered by whichever machine had the page open: getHours() is the
    // browser's clock and toISOString() is UTC. A manager checking the board
    // from another timezone could build the morning wave at the shop's 4am,
    // or find a wave already built "today" that was yesterday's. The shop's
    // own clock answers both.
    const zone = tenantTimeZone(selectedTenant as any);
    const hour = Math.min(23, Math.max(0, Number(rs.autoWaveHour) || 9));
    const now = new Date();
    if (hourIn(now, zone) < hour) return;

    const today = todayIn(zone, now);
    const builtToday = waves.some((w) => {
      const at = String(w.createdAt || '');
      return at ? todayIn(zone, new Date(at)) === today : false;
    });
    if (builtToday) return;

    const eligible = eligibleForWave(orders, new Date().toISOString());
    if (eligible.length === 0) return;

    setAutoTried(true);
    (async () => {
      setBusy(true);
      const res = await buildWave(
        firestore as Firestore, tenantId, orders,
        { maxTotes: Math.max(1, Number(rs.autoWaveTotes) || Number(maxTotes) || 12), cutoffAt: new Date().toISOString(), name: `Morning wave` },
        actor
      );
      setBusy(false);
      if (res.ok) toast({ title: 'Morning wave ready', description: res.message });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTried, busy, firestore, active, waves, orders, perms.canPack, selectedTenant]);

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

  /** THE GATE ON THE WALK. A beep resolves the item, names the tote, and
   *  advances the count; the flash card below the gate is the answer to the
   *  only mid-walk question — where does this unit go. Wrong item and extra
   *  unit both refuse with a reason. Progress persists per unit, so a dropped
   *  signal or a second gun on the same wave never double-counts. */
  const onWaveScan = (value: string) => {
    if (!firestore || !active || active.status !== 'picking') return;
    const res = waveScan(rows, active.scanned || {}, value, codesFor);
    scanFeedback(res.ok);
    if (!res.ok) {
      setLastDrop(null);
      toast({ variant: 'destructive', title: res.reason === 'row_complete' ? 'Already picked' : 'Wrong item', description: res.message });
      return;
    }
    setLastDrop({ tote: res.tote, name: res.name, scanned: res.scanned, totalQty: res.totalQty });
    void recordWaveScan(firestore as Firestore, tenantId, active.id, res.productId, res.totalQty);
  };

  /** Tap-to-tick survives, but only where it is honest: rows whose product has
   *  no code at all (nothing to scan), unticking a mistake, and managers
   *  overriding. A coded row stays scan-only for everyone else. */
  const onRowTap = (r: { productId: string }, done: boolean) => {
    if (!firestore || !active) return;
    const coded = codesFor.has(r.productId);
    if (!done && coded && !perms.canManage) {
      toast({ title: 'Scan it in', description: 'This item has a barcode — beep each unit into its tote. A manager can tap to override.' });
      return;
    }
    void markRowPicked(firestore as Firestore, tenantId, active.id, r.productId, !done);
  };

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
            <div className="flex shrink-0 gap-2">
              <Button
                asChild variant="outline"
                className="h-10 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest"
              >
                <a href={`/print/wave/${tenantId}/${active.id}`} target="_blank" rel="noreferrer">
                  <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> Pick sheet
                </a>
              </Button>
              <Button
                asChild variant="outline"
                className="h-10 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest"
              >
                <a href={`/print/slips/${tenantId}/${active.id}`} target="_blank" rel="noreferrer">
                  All slips
                </a>
              </Button>
            </div>
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
                Print the <span className="font-black">pick sheet</span> for the walk (route + tote labels) and
                <span className="font-black"> all slips</span> for the bench (every packing slip in this wave, sorted by tote).
              </p>
            </div>

            {active.status === 'picking' && perms.canPick && (
              <div className="space-y-2 print:hidden">
                <div className="flex items-center gap-2">
                  <ScanLine className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    Scan each unit into its tote
                  </p>
                </div>
                <ScanGate onScan={onWaveScan} />
                {lastDrop && (
                  <div
                    key={`${lastDrop.tote}-${lastDrop.scanned}`}
                    role="status"
                    className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-primary/10 p-4"
                  >
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary font-mono text-3xl font-bold text-primary-foreground">
                      {lastDrop.tote}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-black uppercase leading-tight tracking-tight">Tote {lastDrop.tote}</span>
                      <span className="block truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        {lastDrop.name} · {lastDrop.scanned} of {lastDrop.totalQty}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}

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
                    onClick={() => onRowTap(r, done)}
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
                      {!done && (active.scanned?.[r.productId] || 0) > 0 && (
                        <span className="mt-0.5 block text-[11px] font-black uppercase tracking-widest text-primary">
                          {active.scanned?.[r.productId]} of {r.totalQty} scanned
                        </span>
                      )}
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
