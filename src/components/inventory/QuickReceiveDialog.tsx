'use client';

import { type Firestore, collection, doc, runTransaction } from 'firebase/firestore';
import { Camera, Loader, Minus, PackagePlus, Plus, Search, Trash2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import React, { useMemo, useState } from 'react';

import { ScanGate, scanFeedback } from '@/components/retail/ScanGate';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { codesMatch, parseProductQr } from '@/lib/retail-orders';
import { cn } from '@/lib/utils';

// ─── QuickReceiveDialog v2 ────────────────────────────────────────────────────
// Stock-first receiving: the dialog opens showing YOUR existing inventory —
// tap items to add them, search to narrow. The camera is strictly opt-in
// ("Scan instead") and only mounts while that mode is on, so typing and
// browsing never share the screen with a live camera (the source of the
// search-while-scanning crash). Confirm still writes costed FIFO batches +
// ledger entries per line.

interface QuickLine {
  productId: string;
  name: string;
  qty: number;
  unitCost: string;
}

export function QuickReceiveDialog({
  open, onOpenChange, tenantId, inventory,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  inventory: any[];
}) {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const { toast } = useToast();

  const [lines, setLines] = useState<QuickLine[]>([]);
  const [term, setTerm] = useState('');
  const [scanMode, setScanMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const items = useMemo(
    () => (inventory || [])
      .filter((i: any) => i && i.status !== 'archived')
      .slice()
      .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''))),
    [inventory]
  );

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return items;
    return items.filter((i: any) => String(i.name || '').toLowerCase().includes(t));
  }, [items, term]);

  const qtyFor = (id: string) => lines.find((l) => l.productId === id)?.qty || 0;

  const addItem = (item: any, viaScan: boolean) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === item.id);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { productId: item.id, name: String(item.name || 'Item'), qty: 1, unitCost: '' }];
    });
    if (viaScan) scanFeedback(true);
  };

  const onScan = (value: string) => {
    const raw = value.trim();
    const pid = parseProductQr(raw);
    const item = items.find((i: any) =>
      pid ? i.id === pid
        : i.id === raw || String(i.id).toLowerCase() === raw.toLowerCase() ||
          codesMatch(String(i.barcode || ''), raw) || codesMatch(String(i.sku || ''), raw) ||
          codesMatch(String(i.name || ''), raw)
    );
    if (!item) {
      scanFeedback(false);
      toast({ variant: 'destructive', title: `Scanned: ${raw.slice(0, 40)}`, description: 'No inventory item matches \u2014 close the scanner and tap it from the list, or paste this code into the item\u2019s Barcode field.' });
      return;
    }
    addItem(item, true);
  };

  const close = (v: boolean) => {
    if (saving) return;
    if (!v) setScanMode(false);
    onOpenChange(v);
  };

  const confirm = async () => {
    if (!firestore || !tenantId || lines.length === 0 || saving) return;
    setSaving(true);
    const actorName = user?.displayName || user?.email || 'Staff';
    const now = new Date().toISOString();
    let units = 0;
    const failures: string[] = [];

    for (const l of lines) {
      try {
        await runTransaction(firestore as Firestore, async (txn) => {
          const ref = doc(firestore as Firestore, `tenants/${tenantId}/inventory`, l.productId);
          const snap = await txn.get(ref);
          if (!snap.exists()) throw new Error('item missing');
          const item = snap.data() as any;
          const cost = l.unitCost.trim() === '' ? (Number(item.costPerUnit) || 0) : Math.max(0, Number(l.unitCost) || 0);
          const batch = { id: `batch-${nanoid(8)}`, stock: l.qty, costPerUnit: cost, receivedDate: now };
          txn.update(ref, JSON.parse(JSON.stringify({
            batches: [...(item.batches || []), batch],
            totalStock: (Number(item.totalStock) || 0) + l.qty,
            costPerUnit: cost || (Number(item.costPerUnit) || 0),
          })));
          txn.set(doc(collection(firestore as Firestore, `tenants/${tenantId}/stockCorrections`)), {
            productId: l.productId, date: now, change: l.qty, unit: item.unit || 'units',
            reason: 'Quick receive', actorId: user?.uid || 'staff', actorName, source: 'quick_receive',
          });
        });
        units += l.qty;
      } catch {
        failures.push(l.name);
      }
    }

    setSaving(false);
    if (failures.length > 0) {
      toast({ variant: 'destructive', title: 'Some lines failed', description: failures.join(', ') });
    } else {
      toast({ title: 'Stock received', description: `${units} unit(s) across ${lines.length} item(s) \u2014 costed batches created.` });
      setLines([]);
      setTerm('');
      close(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-[2rem] border-2 max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tight flex items-center gap-2">
            <PackagePlus className="w-4 h-4 text-primary" /> Receive stock
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {lines.length > 0 && (
            <div className="space-y-2 rounded-2xl border-2 border-primary/30 bg-primary/[0.03] p-3">
              <p className="text-[8px] font-black uppercase tracking-widest text-primary">Receiving now</p>
              {lines.map((l, idx) => (
                <div key={l.productId} className="rounded-2xl border-2 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black uppercase tracking-tight text-xs min-w-0 truncate">{l.name}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2" disabled={l.qty <= 1}
                        onClick={() => setLines(lines.map((x, i) => (i === idx ? { ...x, qty: x.qty - 1 } : x)))}>
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="font-black font-mono text-sm w-8 text-center">{l.qty}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-2"
                        onClick={() => setLines(lines.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x)))}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive"
                        onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground shrink-0">Unit cost $</span>
                    <Input inputMode="decimal" placeholder="keep current" value={l.unitCost}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLines(lines.map((x, i) => (i === idx ? { ...x, unitCost: e.target.value } : x)))}
                      className="h-9 rounded-xl border-2 font-black font-mono text-xs bg-white" />
                  </div>
                </div>
              ))}
              <Button disabled={saving} onClick={confirm}
                className="w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20">
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : `Add ${lines.reduce((a, l) => a + l.qty, 0)} unit(s) to stock`}
              </Button>
            </div>
          )}

          {!scanMode && (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                  <Input placeholder="Search your stock…" value={term}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
                    className="h-11 pl-11 rounded-2xl border-2 font-bold text-sm" />
                </div>
                <Button variant="outline" onClick={() => setScanMode(true)}
                  className="h-11 rounded-2xl border-2 font-black uppercase text-[9px] tracking-widest shrink-0">
                  <Camera className="mr-1.5 h-4 w-4" /> Scan
                </Button>
              </div>

              <div className="rounded-2xl border-2 divide-y-2 overflow-hidden max-h-[38dvh] overflow-y-auto">
                {visible.length === 0 && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 text-center py-6">
                    Nothing matches “{term}”
                  </p>
                )}
                {visible.map((i: any) => {
                  const inCart = qtyFor(i.id);
                  return (
                    <button key={i.id} type="button" onClick={() => addItem(i, false)}
                      className={cn('w-full text-left px-4 py-3 hover:bg-primary/5 transition-all flex items-center justify-between gap-2', inCart > 0 && 'bg-primary/[0.04]')}>
                      <span className="min-w-0">
                        <span className="font-black uppercase tracking-tight text-xs block truncate">{String(i.name || 'Item')}</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
                          {i.totalStock ?? 0} in stock now
                        </span>
                      </span>
                      <span className={cn('shrink-0 h-7 min-w-7 px-2 rounded-full border-2 inline-flex items-center justify-center text-[10px] font-black font-mono',
                        inCart > 0 ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground/60')}>
                        {inCart > 0 ? `+${inCart}` : '+'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50 text-center">
                Tap an item for each unit received — or use Scan for barcodes
              </p>
            </>
          )}

          {scanMode && (
            <div className="space-y-2">
              <ScanGate onScan={onScan} />
              <Button variant="outline" onClick={() => setScanMode(false)}
                className="w-full h-10 rounded-2xl border-2 font-black uppercase text-[9px] tracking-widest">
                <X className="mr-1.5 h-4 w-4" /> Close scanner — back to the list
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
