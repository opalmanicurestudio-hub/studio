'use client';
// src/components/inventory/ReceiveAtStore.tsx — WHICH STORE A DELIVERY CAME TO (design board "Receiving at a store, and
// each variant at each store"; lib/store-stock). With more than one location, every way of receiving asks: a purchase
// order in Inventory, a quick receive, and an order on Ordering. It starts on the store this screen is set to. What came
// in goes on that store's shelf for anything counted there; anything counted at other stores but not at this one yet
// waits in "Not at a store yet", and the screen says so before it's added. The same picker asks where something taken
// off by hand happened (a write-off, a sale or a use logged in Inventory) and where a return is checked in.
import * as React from 'react';
import { businessLocations } from '@/lib/business-locations';
import { receivedTo, type Store } from '@/lib/store-stock';
import { C, muted } from '@/components/orders/ui';

/** The business's stores, with more than one location (none with one), in the order the server keeps them. */
export function storesFrom(locs: any[] | null | undefined): Store[] {
  const b = businessLocations(locs);
  return b.length > 1 ? b.map((l: any) => ({ id: String(l.id), name: String(l.name || 'Location').slice(0, 80) })).sort((x, y) => x.name.localeCompare(y.name)) : [];
}

/** The store a delivery came to: starts on the one this screen is set to, when that's one of `stores`. */
export function useCameTo(stores: Store[]): [string, (id: string) => void] {
  const [at, setAt] = React.useState('');
  const key = stores.map((s) => s.id).join(',');
  React.useEffect(() => {
    setAt((cur) => {
      if (!stores.length) return '';
      if (stores.some((s) => s.id === cur)) return cur;
      let here = ''; try { here = localStorage.getItem('selectedLocationId') || ''; } catch { /* a private window */ }
      return stores.some((s) => s.id === here) ? here : '';
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [at, setAt];
}

export function CameTo({ stores, at, onPick, id = 'came-to', label = 'Came to', hint = 'Pick the store it came to.' }: { stores: Store[]; at: string; onPick: (id: string) => void; id?: string; label?: string; hint?: string }) {
  if (stores.length < 2) return null;
  return (
    <div>
      <p id={id} className="m-0 mb-1.5 text-[13px] font-semibold" style={muted}>{label}</p>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {stores.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={s.id === at} onClick={() => onPick(s.id)} className="min-h-[44px] rounded-xl px-4 text-[15px] font-semibold"
            style={s.id === at ? { background: C.ink, color: C.paper } : { background: C.paper, color: C.ink, border: `1px solid ${C.line}` }}>{s.name}</button>))}
      </div>
      {!at && <p className="m-0 mt-1.5 text-[13px]" style={muted}>{hint}</p>}
    </div>);
}

const listOf = (names: string[]) => (names.length <= 2 ? names.join(' and ') : names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`);

/** What won't go on (`in`) or come off (`out`) that store's shelf: counted at other stores, not at this one. */
export function NotOnShelf({ items, stores, at, className = '', way = 'in' }: { items: any[]; stores: Store[]; at: string; className?: string; way?: 'in' | 'out' }) {
  if (stores.length < 2 || !at) return null;
  const names = items.filter((i) => i && receivedTo(i, stores, at) === 'unplaced').map((i) => String(i.name || 'An item'));
  if (!names.length) return null;
  const store = stores.find((s) => s.id === at)?.name || 'this store'; const one = names.length === 1;
  return (
    <p role="status" className={`m-0 rounded-xl px-3 py-2 text-[14px] leading-snug ${className}`} style={{ background: C.warnSoft, color: C.warn }}>
      {listOf(names)} {one ? 'isn’t' : 'aren’t'} counted at {store} yet, so {way === 'out' ? `${one ? 'it comes' : 'they come'} off “Not at a store yet”.` : `${one ? 'it goes' : 'they go'} to “Not at a store yet” until ${one ? 'it’s' : 'they’re'} counted there or moved.`}
    </p>);
}
