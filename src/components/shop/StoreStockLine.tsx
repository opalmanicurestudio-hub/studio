'use client';
// src/components/shop/StoreStockLine.tsx — IN STOCK AT THE STORE PICKED, on a product's page (design board "Stock at each
// store, and tonight's counts at each location"; lib/store-stock atStoresOf). Only for a product counted at a store, with
// more than one: in stock (and how many, when few) or out of stock at the store the customer picked, and where else it
// is, to pick up there instead. With no store picked yet: which stores have it.
import * as React from 'react';
import Link from 'next/link';
import { saveStore, savedStore } from '@/lib/shop-stores';
import { storeLine, type AtStore } from '@/lib/store-stock';

const names = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function StoreStockLine({ tenantId, at }: { tenantId: string; at: AtStore[] | null | undefined }) {
  const [picked, setPicked] = React.useState('');
  React.useEffect(() => { setPicked(savedStore(tenantId)); }, [tenantId]);
  const line = storeLine(at, picked);
  if (!line) return null;
  const muted = { color: 'var(--shop-muted)' };
  const chip = (ok: boolean, text: string) => (
    <span className="inline-flex items-center px-3 py-1 text-sm font-semibold" style={{ borderRadius: 'var(--shop-radius-pill, 999px)', ...(ok ? { background: 'color-mix(in srgb, #1f7a4d 12%, transparent)', color: '#1f7a4d' } : { background: 'color-mix(in srgb, #b45309 12%, transparent)', color: '#b45309' }) }}>{text}</span>);
  const pick = (id: string) => { saveStore(tenantId, id); setPicked(id); };
  const linkStyle = { textDecoration: 'underline', textUnderlineOffset: 3 } as const;
  return (
    <div className="space-y-2" aria-live="polite">
      {line.here ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {chip(line.here.qty > 0, line.here.qty > 0 ? `In stock at ${line.here.name}` : line.here.counted === false ? `Not available at ${line.here.name} right now` : `Out of stock at ${line.here.name}`)}
          {line.here.qty > 0 && line.here.qty <= 5 && <span className="text-sm" style={muted}>{line.here.qty} left there</span>}
          <Link href={`/shop/${tenantId}/stores`} className="inline-flex min-h-[44px] items-center text-sm font-semibold" style={linkStyle}>Change store</Link>
        </div>
      ) : line.elsewhere.length ? (
        <p className="m-0 text-sm" style={muted}>In stock at {names(line.elsewhere.map((s) => s.name))}.</p>
      ) : <p className="m-0 text-sm" style={muted}>Out of stock at every store.</p>}
      {line.here && line.here.qty <= 0 && line.elsewhere.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
          <span>In stock at {s.name}</span>
          <button type="button" onClick={() => pick(s.id)} className="inline-flex min-h-[44px] items-center font-semibold" style={linkStyle}>Pick up there</button>
        </div>))}
    </div>
  );
}
