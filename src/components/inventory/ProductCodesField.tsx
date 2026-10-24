'use client';
// src/components/inventory/ProductCodesField.tsx — A PRODUCT'S CODES, in the product form. Its barcode (scan it with the
// camera, or type it) and any other codes it carries (a second barcode; the case's own code is set in the shop's
// product settings). Every scanner in the shop takes these, so a product is only ever given a code no other product
// has: the form says which product has one already, and the server refuses it too (lib/code-index).
import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { ScanGate } from '@/components/retail/ScanGate';
import { useInventory } from '@/context/InventoryContext';
import { codeClashes, type CodeClash } from '@/lib/code-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/** The codes in a product form that another product already has. `block`: new to this product, so they aren't
 *  saved. `known`: on this product already when it was last saved, and on another one too; the codes check
 *  (Inventory, Codes and listings) settles which one keeps each. */
export function formClashes(items: any[], form: { sku?: any; barcode?: any; barcodes?: any[] }, saved?: any): { block: CodeClash[]; known: CodeClash[] } {
  const all = codeClashes(items || [], { id: saved?.id, type: saved?.type || 'retail', sku: form.sku, barcode: form.barcode, barcodes: form.barcodes || [] }, { exceptId: saved?.id, saved });
  return { block: all.filter((c) => !c.before), known: all.filter((c) => c.before) };
}

export function useCodeClashes(exceptId?: string) {
  const { watch } = useFormContext();
  const { inventory } = useInventory() as any;
  const barcode = String(watch('barcode') || '').trim();
  const extra: string[] = (watch('barcodes') || []) as string[];
  const sku = String(watch('sku') || '').trim();
  return React.useMemo(() => {
    const items = (inventory || []) as any[];
    return formClashes(items, { sku, barcode, barcodes: extra }, exceptId ? items.find((p) => p.id === exceptId) || { id: exceptId } : undefined);
  }, [inventory, barcode, sku, extra.join('|'), exceptId]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** Codes clashing with another product, as sentences (or '' when there are none). */
export function clashText(clashes: { raw?: string; code?: string; item: any }[], known = false): string {
  if (!clashes.length) return '';
  const said = clashes.map((c) => `${c.raw || c.code} is ${known ? 'also' : 'already'} on ${c.item?.name || 'another product'}`).join('. ');
  return known ? `${said}. Choose which one keeps it in Inventory, Codes and listings.` : `${said}. A code can be on one product only.`;
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
      {clashes.block.length > 0
        ? <p role="alert" className="m-0 text-[12px] font-semibold" style={{ color: '#b45309' }}>{clashText(clashes.block)}</p>
        : clashes.known.length > 0
          ? <p role="status" className="m-0 text-[12px]" style={{ color: '#b45309' }}>{clashText(clashes.known, true)}</p>
          : <p className="m-0 text-[12px] text-muted-foreground">Scanned at the register, when packing orders and when stock comes in. Already printed on the product? Use that code.</p>}
    </div>
  );
}
