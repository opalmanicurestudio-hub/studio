'use client';

import { type Firestore } from 'firebase/firestore';
import {
  ArrowLeft, Boxes, Loader, MapPin, Minus, PackageOpen, Plus, Search, Undo2, UserRound, Zap,
} from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';

import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  allocationList, distribute, holderKey, itemAllocations, markUsed, parDeficits,
  poolQty, returnToStock, setPar, type Actor, type Holder,
} from '@/lib/inventory-allocation';
import { codesMatch, parseProductQr } from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

// ─── Distribution ─────────────────────────────────────────────────────────────
// Where allotments live: pick a station or provider, see exactly what they
// hold vs their par, move stock with taps or scans, record usage. Every move
// is actor-stamped in stockMovements, pool math always shows what's actually
// distributable (back stock minus online reservations), and "Restock to par"
// turns morning setup into one tap.

export default function DistributionPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { inventory, locations, staff } = useInventory();
  const { user } = useUser();
  const { toast } = useToast();

  const actor: Actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );

  const [holder, setHolder] = useState<Holder | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const stations: Holder[] = useMemo(
    () => (locations || []).map((l: any) => ({ type: 'location' as const, id: l.id, name: l.name })),
    [locations]
  );
  const providers: Holder[] = useMemo(
    () => (staff || []).map((s: any) => ({ type: 'staff' as const, id: s.id, name: s.name })),
    [staff]
  );

  const trackable = useMemo(
    () => (inventory || []).filter((i: any) => i.status !== 'archived' && ['professional', 'retail', 'refreshment'].includes(i.type)),
    [inventory]
  );

  const held = useMemo(() => {
    if (!holder) return [];
    const key = holderKey(holder);
    return trackable
      .map((item: any) => ({ item, alloc: itemAllocations(item)[key] }))
      .filter((x: any) => x.alloc && (x.alloc.qty > 0 || (x.alloc.par || 0) > 0))
      .sort((a: any, b: any) => String(a.item.name).localeCompare(String(b.item.name)));
  }, [trackable, holder]);

  const deficits = useMemo(() => (holder ? parDeficits(trackable, holder) : []), [trackable, holder]);

  const addList = useMemo(() => {
    const t = term.trim().toLowerCase();
    return trackable
      .filter((i: any) => !t || String(i.name).toLowerCase().includes(t) || String(i.sku || '').toLowerCase().includes(t))
      .slice(0, 40);
  }, [trackable, term]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    if (busy) return;
    setBusy(key);
    const res = await fn();
    setBusy(null);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? res.message : 'Problem', description: res.ok ? undefined : res.message });
  };

  const onScan = (value: string) => {
    if (!firestore || !tenantId || !holder) return;
    const raw = value.trim();
    const pid = parseProductQr(raw);
    const item = trackable.find((i: any) =>
      pid ? i.id === pid : codesMatch(String(i.barcode || ''), raw) || codesMatch(String(i.sku || ''), raw)
    );
    if (!item) {
      scanFeedback(false);
      toast({ variant: 'destructive', title: `Scanned: ${raw.slice(0, 40)}`, description: 'No item matches this code.' });
      return;
    }
    scanFeedback(true);
    run(`scan-${item.id}`, () => distribute(firestore as Firestore, tenantId, item.id, holder, 1, actor));
  };

  const restockToPar = async () => {
    if (!firestore || !tenantId || !holder || busy) return;
    setBusy('par');
    let moved = 0;
    const problems: string[] = [];
    for (const d of deficits) {
      const res = await distribute(firestore as Firestore, tenantId, d.item.id, holder, d.need, actor);
      if (res.ok) moved += d.need;
      else problems.push(`${d.item.name}: ${res.message}`);
    }
    setBusy(null);
    toast({
      variant: problems.length > 0 ? 'destructive' : 'default',
      title: moved > 0 ? `${moved} unit(s) distributed to ${holder.name}` : 'Nothing to move',
      description: problems.length > 0 ? problems.join(' · ').slice(0, 240) : undefined,
    });
  };

  const HolderChip = ({ h }: { h: Holder }) => (
    <button
      type="button"
      onClick={() => { setHolder(holder && holderKey(holder) === holderKey(h) ? null : h); setAddOpen(false); }}
      className={cn(
        'shrink-0 h-10 px-4 rounded-full border-2 text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5',
        holder && holderKey(holder) === holderKey(h)
          ? 'bg-foreground text-background border-foreground'
          : 'bg-white hover:border-primary/40'
      )}
    >
      {h.type === 'location' ? <MapPin className="w-3 h-3" /> : <UserRound className="w-3 h-3" />}
      {h.name}
    </button>
  );

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/inventory"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Distribution</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              Station &amp; provider allotments — every unit accounted for
            </p>
          </div>
          <Boxes className="w-5 h-5 text-primary/40" />
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-3 space-y-2">
          {stations.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              <span className="shrink-0 self-center text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">Stations</span>
              {stations.map((h) => <HolderChip key={holderKey(h)} h={h} />)}
            </div>
          )}
          {providers.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              <span className="shrink-0 self-center text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">Providers</span>
              {providers.map((h) => <HolderChip key={holderKey(h)} h={h} />)}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {!holder && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <PackageOpen className="w-8 h-8 mx-auto opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">
              Pick a station or provider above
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 max-w-sm mx-auto">
              Their allotment, par levels, and one-tap restock live here. Stations come from Locations; providers from your Team.
            </p>
          </div>
        )}

        {holder && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={restockToPar}
                disabled={busy === 'par' || deficits.length === 0}
                className="h-12 flex-1 sm:flex-none rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20"
              >
                {busy === 'par' ? <Loader className="h-4 w-4 animate-spin" /> : (
                  <><Zap className="mr-1.5 h-4 w-4" /> Restock to par{deficits.length > 0 ? ` (${deficits.reduce((s, d) => s + d.need, 0)})` : ''}</>
                )}
              </Button>
              <Button
                variant={addOpen ? 'default' : 'outline'}
                onClick={() => setAddOpen(!addOpen)}
                className="h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest"
              >
                <Plus className="mr-1.5 h-4 w-4" /> {addOpen ? 'Done adding' : 'Add items'}
              </Button>
            </div>

            {addOpen && (
              <Card className="border-2 border-primary rounded-[2rem] overflow-hidden bg-white">
                <CardContent className="p-5 space-y-3">
                  <ScanGate onScan={onScan} label={`Scan a unit to send it to ${holder.name} — each beep moves one`} />
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <Input
                      placeholder="Or search items…"
                      value={term}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
                      className="h-12 pl-11 rounded-2xl border-2 font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {addList.map((item: any) => {
                      const pool = poolQty(item) - (Number(item.stockReserved) || 0);
                      const draft = qtyDrafts[item.id] ?? '1';
                      return (
                        <div key={item.id} className="rounded-2xl border-2 p-3 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-black uppercase tracking-tight text-xs truncate">{item.name}</p>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                              {Math.max(0, pool)} in back stock
                            </p>
                          </div>
                          <Input
                            inputMode="numeric"
                            value={draft}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQtyDrafts({ ...qtyDrafts, [item.id]: e.target.value })}
                            className="h-10 w-14 rounded-xl border-2 font-black font-mono text-xs text-center shrink-0"
                          />
                          <Button
                            disabled={busy === `add-${item.id}` || pool <= 0}
                            onClick={() => run(`add-${item.id}`, () =>
                              distribute(firestore as Firestore, tenantId, item.id, holder, Math.max(1, Math.floor(Number(draft) || 1)), actor))}
                            className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest shrink-0"
                          >
                            Send
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2.5">
              {held.length === 0 && !addOpen && (
                <div className="rounded-2xl border-2 border-dashed py-16 text-center space-y-2">
                  <PackageOpen className="w-7 h-7 mx-auto opacity-20" />
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-30">
                    {holder.name} holds nothing yet — tap Add items
                  </p>
                </div>
              )}
              {held.map(({ item, alloc }: any) => {
                const below = (alloc.par || 0) > 0 && alloc.qty < alloc.par;
                return (
                  <Card key={item.id} className={cn('border-2 rounded-2xl overflow-hidden bg-white', below && 'border-amber-200')}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-black uppercase tracking-tight text-sm truncate">{item.name}</p>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {Math.max(0, poolQty(item) - (Number(item.stockReserved) || 0))} in back stock
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-black font-mono text-xl leading-none">
                            {alloc.qty}
                            {(alloc.par || 0) > 0 && <span className="text-xs text-muted-foreground">/{alloc.par}</span>}
                          </p>
                          {below && (
                            <Badge className="mt-1 h-5 px-2 bg-amber-50 text-amber-700 border-2 border-amber-100 font-black text-[7px] uppercase tracking-widest">
                              Below par
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline" size="sm" disabled={!!busy}
                          onClick={() => run(`d1-${item.id}`, () => distribute(firestore as Firestore, tenantId, item.id, holder, 1, actor))}
                          className="h-9 rounded-xl border-2 font-black uppercase text-[8px] tracking-widest"
                        >
                          <Plus className="mr-1 h-3 w-3" /> Add 1
                        </Button>
                        <Button
                          variant="outline" size="sm" disabled={!!busy || alloc.qty <= 0}
                          onClick={() => run(`r1-${item.id}`, () => returnToStock(firestore as Firestore, tenantId, item.id, holder, 1, actor))}
                          className="h-9 rounded-xl border-2 font-black uppercase text-[8px] tracking-widest"
                        >
                          <Undo2 className="mr-1 h-3 w-3" /> Return 1
                        </Button>
                        <Button
                          variant="outline" size="sm" disabled={!!busy || alloc.qty <= 0}
                          onClick={() => run(`u1-${item.id}`, () => markUsed(firestore as Firestore, tenantId, item.id, holder, 1, actor))}
                          className="h-9 rounded-xl border-2 font-black uppercase text-[8px] tracking-widest text-destructive"
                        >
                          <Minus className="mr-1 h-3 w-3" /> Used 1
                        </Button>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Par</span>
                          <Input
                            key={`${item.id}-${alloc.par ?? 0}`}
                            defaultValue={String(alloc.par ?? 0)}
                            inputMode="numeric"
                            onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                              const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                              if (v !== (alloc.par ?? 0)) run(`p-${item.id}`, () => setPar(firestore as Firestore, tenantId, item.id, holder, v));
                            }}
                            className="h-9 w-14 rounded-xl border-2 font-black font-mono text-xs text-center"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
