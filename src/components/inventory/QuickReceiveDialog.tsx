'use client';

import { type Firestore, collection, doc, runTransaction } from 'firebase/firestore';
import { Loader, Minus, PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
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

// ─── QuickReceiveDialog ───────────────────────────────────────────────────────
// The seamless restock path: box arrives (with or without a purchase order),
// tap Receive stock, scan each item — every beep adds one — set costs if you
// know them, confirm. Each line lands as a costed FIFO batch + a ledger
// entry, so margins and history stay true without ever creating a PO. The
// formal PO Receive flow still exists for tracked supplier orders; this is
// for the everyday "supplies walked in the door" moment.

interface QuickLine {
  productId: string;
  name: string;
  qty: number;
  unitCost: string; // dollars, editable; blank = keep item's current cost
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
  const [saving, setSaving] = useState(false);

  const items = useMemo(() => (inventory || []).filter((i: any) => i.status !== 'archived'), [inventory]);

  const results = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return items.filter((i: any) => String(i.name).toLowerCase().includes(t)).slice(0, 6);
  }, [items, term]);

  const addItem = (item: any, viaScan: boolean) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === item.id);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { productId: item.id, name: item.name, qty: 1, unitCost: '' }];
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
      toast({ variant: 'destructive', title: `Scanned: ${raw.slice(0, 40)}`, description: 'No inventory item matches — add it by search, or paste this code into the item\u2019s Barcode field.' });
      return;
    }
    addItem(item, true);
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
      toast({ title: 'Stock received', description: `${units} unit(s) across ${lines.length} item(s) — costed batches created.` });
      setLines([]);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-md rounded-[2rem] border-2 max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tight flex items-center gap-2">
            <PackagePlus className="w-4 h-4 text-primary" /> Receive stock
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <ScanGate onScan={onScan} />

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input placeholder="No barcode? Search by name…" value={term}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
              className="h-11 pl-11 rounded-2xl border-2 font-bold text-sm" />
          </div>
          {results.length > 0 && (
            <div className="rounded-2xl border-2 divide-y-2 overflow-hidden">
              {results.map((i: any) => (
                <button key={i.id} type="button" onClick={() => { addItem(i, false); setTerm(''); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-primary/5 transition-all">
                  <span className="font-black uppercase tracking-tight text-xs">{i.name}</span>
                  <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground ml-2">
                    {i.totalStock ?? 0} in stock
                  </span>
                </button>
              ))}
            </div>
          )}

          {lines.length === 0 && (
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 text-center py-4">
              Scan each item as you unbox — every beep adds one
            </p>
          )}

          {lines.map((l, idx) => (
            <div key={l.productId} className="rounded-2xl border-2 p-3 space-y-2">
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
                  className="h-9 rounded-xl border-2 font-black font-mono text-xs" />
              </div>
            </div>
          ))}

          <Button disabled={lines.length === 0 || saving} onClick={confirm}
            className={cn('w-full h-12 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-primary/20')}>
            {saving ? <Loader className="h-4 w-4 animate-spin" /> : `Add ${lines.reduce((a, l) => a + l.qty, 0)} unit(s) to stock`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
