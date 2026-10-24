'use client';
// src/components/inventory/UnknownCodePanel.tsx — A CODE NO PRODUCT HAS YET, at a scanner (packing, receiving). Which
// product is it? The items on the order or delivery come first; any product can be found by name or SKU. The code is
// saved to the one chosen (by the server, lib/code-index learnCode), so every scanner knows it from then on, and a
// code that's already on another product is never saved twice.
import * as React from 'react';
import { codesOf } from '@/lib/code-form';
import { Btn, C, muted } from '@/components/orders/ui';

export type CodeOption = { productId: string; name: string; here?: boolean };

/** What a product carries now, in a few words ("Barcode 0 71249 60302 6", "SKU TC-30 · no barcode yet"). */
function carries(item: any, here: string): string {
  const cs = codesOf(item); const unit = cs.find((c) => c.kind === 'unit'); const sku = cs.find((c) => c.kind === 'sku');
  const parts = [here];
  if (unit) parts.push(`Barcode ${unit.raw}`); else parts.push(sku ? `SKU ${sku.raw} · no barcode yet` : 'no barcode yet');
  return parts.filter(Boolean).join(' · ');
}

export function UnknownCodePanel({ code, options, inventory, where, onSave, onCancel }: {
  code: string;
  /** The items on the order or delivery, first in the list. */
  options: CodeOption[];
  inventory: any[];
  /** "In this order", "On this delivery". */
  where: string;
  onSave: (productId: string, name: string) => Promise<{ ok: boolean; message: string }>;
  onCancel: () => void;
}) {
  const byId = React.useMemo(() => new Map((inventory || []).map((i: any) => [String(i.id), i])), [inventory]);
  // An item here without a barcode yet is the likely one.
  const first = options.find((o) => !codesOf(byId.get(o.productId)).some((c) => c.kind === 'unit')) || null;
  const [pick, setPick] = React.useState<string>(first?.productId || '');
  const [find, setFind] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => { setPick(first?.productId || ''); setFind(''); setErr(''); }, [code]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = React.useMemo(() => {
    const here = options.map((o) => ({ ...o, here: true }));
    const t = find.trim().toLowerCase();
    if (t.length < 2) return here;
    const match = (name: string, it: any) => name.toLowerCase().includes(t) || codesOf(it).some((c) => c.raw.toLowerCase().includes(t));
    const ids = new Set(here.map((o) => o.productId));
    const more = (inventory || []).filter((it: any) => it && it.status !== 'archived' && !['equipment', 'overhead'].includes(String(it.type || '')) && !ids.has(String(it.id)) && match(String(it.name || ''), it))
      .slice(0, 8).map((it: any) => ({ productId: String(it.id), name: String(it.name || 'Product'), here: false }));
    return [...here.filter((o) => match(o.name, byId.get(o.productId))), ...more];
  }, [find, options, inventory, byId]);
  const chosen = shown.find((o) => o.productId === pick) || options.find((o) => o.productId === pick) || null;

  const save = async () => {
    if (!chosen || busy) return;
    setBusy(true); setErr('');
    const r = await onSave(chosen.productId, chosen.name);
    setBusy(false);
    if (!r.ok) setErr(r.message);
  };

  return (
    <div className="flex flex-col gap-3.5" style={{ color: C.ink }}>
      <div className="rounded-[18px] px-4 py-4" style={{ background: C.soft }}>
        <p className="m-0 text-[13px] font-semibold" style={muted}>Scanned</p>
        <p className="m-0 mt-0.5 break-all text-[20px] font-semibold tabular-nums tracking-[0.03em]">{code.slice(0, 64)}</p>
        <p className="m-0 mt-1.5 text-[14px] leading-relaxed">No product has this code yet. Which one is it? It’s saved to the one you choose, so every scanner knows it from now on.</p>
      </div>
      <div>
        <label htmlFor="unknown-find" className="mb-1.5 block text-[13px] font-semibold">Find the product</label>
        <input id="unknown-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name or SKU" autoComplete="off" className="h-[46px] w-full rounded-[14px] border bg-transparent px-3.5 text-[15px] outline-none" style={{ borderColor: C.line, color: C.ink }} />
      </div>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Which product it is">
        {shown.map((o) => {
          const on = o.productId === pick;
          return (
            <button key={o.productId} type="button" role="radio" aria-checked={on} onClick={() => setPick(o.productId)}
              className="cf-press flex min-h-[56px] w-full items-center gap-3 rounded-[14px] px-3.5 py-2 text-left"
              style={{ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: on ? '7px 13px' : undefined, background: C.paper, color: C.ink }}>
              <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full" style={{ border: on ? `6px solid ${C.ink}` : `2px solid ${C.muted}` }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{o.name}</span>
                <span className="block truncate text-[12.5px]" style={muted}>{carries(byId.get(o.productId), o.here ? where : '')}</span>
              </span>
            </button>);
        })}
        {shown.length === 0 && <p className="m-0 text-[13.5px]" style={muted}>{find.trim().length >= 2 ? 'Nothing in Inventory matches that.' : 'Find it by its name or SKU.'}</p>}
      </div>
      {err && <p role="alert" className="m-0 text-[13.5px] font-semibold" style={{ color: C.warn }}>{err}</p>}
      <div className="flex flex-col gap-2">
        <Btn kind="primary" className="h-12 w-full text-[14.5px]" disabled={!chosen || busy} onClick={() => void save()}>{busy ? 'Saving…' : chosen ? `Save the code to ${chosen.name}` : 'Choose the product'}</Btn>
        <Btn kind="soft" className="h-12 w-full text-[14.5px]" style={{ border: `1px solid ${C.line}`, background: C.paper }} onClick={onCancel}>Not now</Btn>
      </div>
      <div className="flex items-start gap-2.5 rounded-[14px] border px-3.5 py-3" style={{ borderColor: C.line }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.5" /></svg>
        <p className="m-0 text-[12.5px] leading-relaxed" style={muted}>A code that’s already on another product is never saved twice. You’re told which product has it, so it can be moved from there first.</p>
      </div>
    </div>);
}
