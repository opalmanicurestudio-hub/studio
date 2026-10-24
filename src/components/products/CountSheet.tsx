'use client';
// src/components/products/CountSheet.tsx — COUNT IT. The number on the shelf, typed by whoever counted. The difference is
// recorded on the product's history with their name (lib/stock-count), so a count never quietly rewrites the number.
import * as React from 'react';
import { countStock } from '@/lib/count-client';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';

export function CountSheet({ tenantId, product, onClose, onCounted }: { tenantId: string; product: any; onClose: () => void; onCounted?: (delta: number) => void }) {
  const was = Math.max(0, Number(product?.totalStock) || 0);
  const held = Math.max(0, Number(product?.stockReserved) || 0);
  const [n, setN] = React.useState(String(was));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const counted = n === '' ? NaN : Math.floor(Number(n));
  const diff = Number.isFinite(counted) ? counted - was : 0;
  const save = async () => {
    if (!Number.isFinite(counted) || busy) return;
    if (counted < held) { setErr(`${held} ${held === 1 ? 'is' : 'are'} held for paid orders, so the shelf can’t be fewer than that. Mark the missing ones on those orders first.`); return; }
    setBusy(true); setErr('');
    const r = await countStock(tenantId, String(product.id), counted);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCounted?.(r.delta); onClose();
  };
  return (
    <Sheet title="Count it" sub={String(product?.name || '')} onClose={onClose}>
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div>
          <label htmlFor="count-n" className="mb-1.5 block text-[13px] font-semibold" style={muted}>How many are on the shelf</label>
          <input id="count-n" inputMode="numeric" autoFocus value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 7))}
            className="h-14 w-full rounded-xl px-4 text-[24px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink }} />
        </div>
        <p className="m-0 text-[14px]" style={muted}>
          The record says {was}.{held ? ` ${held} of those ${held === 1 ? 'is' : 'are'} held for paid orders.` : ''}
          {Number.isFinite(counted) && diff !== 0 ? <span style={{ color: diff < 0 ? C.warn : C.ok }}> {diff < 0 ? `${-diff} fewer` : `${diff} more`} than recorded.</span> : null}
        </p>
        {err && <p role="alert" className="m-0 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
        <Btn kind="primary" type="submit" className="w-full text-[17px]" disabled={!Number.isFinite(counted) || busy}>{busy ? 'Saving…' : diff === 0 ? 'It matches' : 'Save the count'}</Btn>
      </form>
    </Sheet>
  );
}
