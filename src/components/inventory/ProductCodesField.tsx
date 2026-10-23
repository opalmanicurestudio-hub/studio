'use client';
// src/components/inventory/ProductCodesField.tsx — A PRODUCT'S CODES, in the product form. Its barcode (scan it with the
// camera, or type it) and any other codes it carries (a second barcode, the case's own code is set in the shop's
// product settings). These are the codes the register, packing and receiving scan (lib/product-codes), so a product
// is only ever given a code no other product has: the form says which product already uses one.
import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { ScanGate } from '@/components/retail/ScanGate';
import { useInventory } from '@/context/InventoryContext';
import { codeOwners } from '@/lib/product-codes';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/** Other products already using the codes in this form: a barcode the form won't save (`block`), and a SKU it only
 *  points out (`warn`), since older products may share one. */
export function useCodeClashes(exceptId?: string) {
  const { watch } = useFormContext();
  const { inventory } = useInventory() as any;
  const barcode = String(watch('barcode') || '').trim();
  const extra: string[] = (watch('barcodes') || []) as string[];
  const sku = String(watch('sku') || '').trim();
  return React.useMemo(() => ({
    block: codeOwners((inventory || []) as any[], [barcode, ...extra].filter(Boolean), exceptId),
    warn: sku ? codeOwners((inventory || []) as any[], [sku], exceptId) : [],
  }), [inventory, barcode, sku, extra.join('|'), exceptId]);
}

/** Codes clashing with another product, as one sentence (or '' when there are none). */
export function clashText(clashes: { code: string; item: any }[]): string {
  if (!clashes.length) return '';
  return clashes.map((c) => `${c.code} is already on ${c.item?.name || 'another product'}`).join('. ') + '. Each code can belong to one product only.';
}

export function ProductCodesField({ exceptId }: { exceptId?: string }) {
  const { register, watch, setValue } = useFormContext();
  const [scanning, setScanning] = React.useState(false);
  const [more, setMore] = React.useState('');
  const extra: string[] = (watch('barcodes') || []) as string[];
  const clashes = useCodeClashes(exceptId);

  const add = () => {
    const c = more.trim();
    if (!c || extra.includes(c) || c === String(watch('barcode') || '').trim()) { setMore(''); return; }
    setValue('barcodes', [...extra, c].slice(0, 10), { shouldDirty: true });
    setMore('');
  };

  return (
    <div className="space-y-2 text-left">
      <Label htmlFor="product-barcode" className="text-[9px] font-black uppercase text-muted-foreground ml-1">Barcode</Label>
      <div className="flex gap-2">
        <Input id="product-barcode" placeholder="Scan or type the barcode on the product" autoComplete="off" {...register('barcode')} className="h-11 flex-1 rounded-xl border-2 font-mono font-black" />
        <Button type="button" variant="outline" onClick={() => setScanning((s) => !s)} className="h-11 shrink-0 rounded-xl border-2 text-[11px] font-black uppercase">{scanning ? 'Close' : 'Scan'}</Button>
      </div>
      {scanning && (
        <div className="overflow-hidden rounded-2xl">
          <ScanGate label="Point at the product’s barcode" onScan={(v) => { setValue('barcode', String(v || '').trim(), { shouldDirty: true }); setScanning(false); }} />
        </div>)}
      <div className="flex gap-2">
        <Input aria-label="Another code this product carries" placeholder="Another code (optional)" value={more} onChange={(e) => setMore(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className="h-10 flex-1 rounded-xl border-2 font-mono text-[13px]" />
        <Button type="button" variant="outline" onClick={add} className="h-10 shrink-0 rounded-xl border-2 text-[11px] font-black uppercase">Add</Button>
      </div>
      {extra.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {extra.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[12px]">
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => setValue('barcodes', extra.filter((x) => x !== c), { shouldDirty: true })} className="text-muted-foreground">×</button>
            </span>))}
        </div>)}
      {clashes.block.length > 0 || clashes.warn.length > 0
        ? <p role="alert" className="m-0 text-[12px] font-semibold" style={{ color: '#b45309' }}>{clashText([...clashes.block, ...clashes.warn])}</p>
        : <p className="m-0 text-[12px] text-muted-foreground">Scanned at the register, when packing orders and when stock comes in. Already printed on the product? Use that code.</p>}
    </div>
  );
}
