'use client';

import { type Firestore, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  ArrowLeft, Beaker, FlaskConical, Loader, Plus, Search, Trash2, X, Zap,
} from 'lucide-react';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInventory } from '@/context/InventoryContext';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  estimateRunCost, formulaCol, produce, type Actor, type Formula, type FormulaComponent,
} from '@/lib/formulas';
import { cn } from '@/lib/utils';

// ─── Formulas ─────────────────────────────────────────────────────────────────
// Recipes for makers: components in → finished items out, costed from real
// FIFO purchase prices plus optional labor. The Produce button is the whole
// workflow: verify stock, deplete ingredients, mint a costed batch of the
// finished item — margins stay honest with zero spreadsheet work.

export default function FormulasPage() {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || '';
  const { inventory } = useInventory();
  const { user } = useUser();
  const { toast } = useToast();

  const actor: Actor = useMemo(
    () => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Staff' }),
    [user]
  );

  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Formula | null>(null);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [runsDraft, setRunsDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const unsub = onSnapshot(formulaCol(firestore as Firestore, tenantId), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Formula[];
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setFormulas(rows);
      setLoading(false);
    });
    return unsub;
  }, [firestore, tenantId]);

  const items = useMemo(
    () => (inventory || []).filter((i: any) => i.status !== 'archived'),
    [inventory]
  );

  const searchItems = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return items.filter((i: any) => String(i.name).toLowerCase().includes(t)).slice(0, 8);
  }, [items, term]);

  const blank = (): Formula => ({
    id: `fx-${nanoid(8)}`, name: '', outputItemId: '', outputName: '',
    yieldQty: 1, components: [], laborCostDollars: 0, notes: '',
    createdAt: new Date().toISOString(),
  });

  const save = async () => {
    if (!firestore || !tenantId || !editing) return;
    if (!editing.name.trim() || !editing.outputItemId || editing.components.length === 0) {
      toast({ variant: 'destructive', title: 'Formula needs a name, an output item, and at least one component.' });
      return;
    }
    setBusy('save');
    try {
      await setDoc(doc(formulaCol(firestore as Firestore, tenantId), editing.id),
        JSON.parse(JSON.stringify({ ...editing, yieldQty: Math.max(1, Math.floor(editing.yieldQty) || 1) })));
      setEditing(null);
      toast({ title: 'Formula saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const runProduce = async (f: Formula) => {
    if (!firestore || !tenantId || busy) return;
    const runs = Math.max(1, Math.floor(Number(runsDraft[f.id]) || 1));
    setBusy(`p-${f.id}`);
    const res = await produce(firestore as Firestore, tenantId, f, runs, actor);
    setBusy(null);
    toast({ variant: res.ok ? 'default' : 'destructive', title: res.ok ? 'Produced' : 'Could not produce', description: res.message });
  };

  return (
    <div className="min-h-dvh bg-muted/5 pb-24">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b-2">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-xl">
            <Link href="/inventory"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black uppercase tracking-tighter text-xl leading-none">Formulas</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              Recipes → costed finished goods
            </p>
          </div>
          <Button onClick={() => setEditing(blank())}
            className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-md shadow-primary/20">
            <Plus className="mr-1.5 h-4 w-4" /> New
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        {loading && <div className="py-24 text-center"><Loader className="w-7 h-7 mx-auto animate-spin text-primary" /></div>}
        {!loading && formulas.length === 0 && !editing && (
          <div className="rounded-2xl border-2 border-dashed py-20 text-center space-y-2">
            <FlaskConical className="w-8 h-8 mx-auto opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No formulas yet</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 max-w-sm mx-auto">
              A formula turns components into finished items at true FIFO cost — perfect for handmade product lines.
            </p>
          </div>
        )}

        {editing && (
          <Card className="border-2 border-primary rounded-[2.5rem] overflow-hidden bg-white">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                  {formulas.some((f) => f.id === editing.id) ? 'Edit formula' : 'New formula'}
                </p>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setEditing(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Formula name</Label>
                <Input value={editing.name} placeholder="Cuticle Oil — 24 bottle run"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, name: e.target.value })}
                  className="h-12 rounded-xl border-2 font-bold text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Output item</Label>
                  <select
                    value={editing.outputItemId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const it = items.find((i: any) => i.id === e.target.value);
                      setEditing({ ...editing, outputItemId: e.target.value, outputName: it ? it.name : '' });
                    }}
                    className="w-full h-12 rounded-xl border-2 bg-white px-3 text-xs font-bold"
                  >
                    <option value="">Pick the finished item…</option>
                    {items.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Yield per run</Label>
                  <Input inputMode="numeric" value={String(editing.yieldQty)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, yieldQty: Number(e.target.value) || 1 })}
                    className="h-12 rounded-xl border-2 font-black font-mono text-sm text-center" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Components per run</Label>
                {editing.components.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-2xl border-2 p-2.5">
                    <p className="flex-1 min-w-0 font-black uppercase tracking-tight text-xs truncate">{c.name}</p>
                    <Input inputMode="decimal" value={String(c.qty)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const next = [...editing.components];
                        next[idx] = { ...c, qty: Number(e.target.value) || 0 };
                        setEditing({ ...editing, components: next });
                      }}
                      className="h-9 w-16 rounded-xl border-2 font-black font-mono text-xs text-center shrink-0" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground w-10 shrink-0">{c.unit}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive shrink-0"
                      onClick={() => setEditing({ ...editing, components: editing.components.filter((_, i) => i !== idx) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                  <Input placeholder="Add a component — search inventory…" value={term}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
                    className="h-11 pl-11 rounded-2xl border-2 font-bold text-sm" />
                </div>
                {searchItems.length > 0 && (
                  <div className="rounded-2xl border-2 divide-y-2 overflow-hidden">
                    {searchItems.map((i: any) => (
                      <button key={i.id} type="button"
                        onClick={() => {
                          const comp: FormulaComponent = { itemId: i.id, name: i.name, qty: 1, unit: i.unit || 'units' };
                          setEditing({ ...editing, components: [...editing.components, comp] });
                          setTerm('');
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-primary/5 transition-all">
                        <span className="font-black uppercase tracking-tight text-xs">{i.name}</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground ml-2">
                          {i.totalStock ?? 0} {i.unit || 'units'} in stock
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Labor cost per run ($, optional)</Label>
                <Input inputMode="decimal" value={String(editing.laborCostDollars ?? 0)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, laborCostDollars: Number(e.target.value) || 0 })}
                  className="h-11 rounded-xl border-2 font-black font-mono text-sm" />
              </div>

              <Button disabled={busy === 'save'} onClick={save}
                className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                {busy === 'save' ? <Loader className="h-4 w-4 animate-spin" /> : 'Save formula'}
              </Button>
            </CardContent>
          </Card>
        )}

        {formulas.map((f) => {
          const est = estimateRunCost(f, items);
          const runs = runsDraft[f.id] ?? '1';
          return (
            <Card key={f.id} className="border-2 rounded-[2rem] overflow-hidden bg-white">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Beaker className="w-4 h-4 text-primary shrink-0" />
                      <p className="font-black uppercase tracking-tight text-sm truncate">{f.name}</p>
                    </div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
                      {f.yieldQty} × {f.outputName} per run · {f.components.length} component(s)
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black font-mono text-lg leading-none">${est.perUnitDollars.toFixed(2)}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">est. cost / unit</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {f.components.map((c, i) => (
                    <span key={i} className="h-6 px-2.5 rounded-full border-2 bg-muted/10 text-[8px] font-black uppercase tracking-widest inline-flex items-center">
                      {c.qty} {c.unit} {c.name}
                    </span>
                  ))}
                </div>

                {est.shortages.length > 0 && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                    Low: {est.shortages.join(' · ')}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Input inputMode="numeric" value={runs}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRunsDraft({ ...runsDraft, [f.id]: e.target.value })}
                    className="h-11 w-16 rounded-xl border-2 font-black font-mono text-sm text-center shrink-0" />
                  <Button disabled={busy === `p-${f.id}`} onClick={() => runProduce(f)}
                    className="h-11 flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest">
                    {busy === `p-${f.id}` ? <Loader className="h-4 w-4 animate-spin" /> : (<><Zap className="mr-1.5 h-4 w-4" /> Produce {Math.max(1, Number(runs) || 1)} run(s)</>)}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(f)}
                    className="h-11 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest shrink-0">
                    Edit
                  </Button>
                  <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-destructive shrink-0"
                    onClick={async () => {
                      if (!window.confirm(`Delete formula "${f.name}"?`)) return;
                      await deleteDoc(doc(formulaCol(firestore as Firestore, tenantId), f.id));
                    }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
}
