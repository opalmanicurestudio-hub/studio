'use client';
// src/components/menu/OfferAsk.tsx — OFFERED AT THE END, AT THE COUNTER AND THE LANE (design canvas "Food numbers":
// Offers at the counter and the lane). Right after something is added, the team sees what that item offers (set on the
// Menu page under Offered at the end; lib/menu-upgrades): the next size up and up to two things to go with it, as a line to
// read out, each one tap. Size up changes only what was just added (api/counter 'sizeUp'); something to go with it is
// its own line at its own price, marked as taken from an offer. The screen closes it once anything else changes on the
// order, it's sent, or No thanks / Done; each thing is offered once.
import * as React from 'react';
import { offersFor } from '@/lib/menu-upgrades';
import type { Picks } from '@/lib/menu-choices';

const INK = '#16171a', MUTED = '#6d7075', SOFT = '#f5f5f7';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

/** What was just added, and what's happened since: a size taken, or something taken with it. */
export type JustAdded = { orderId: string; itemId: string; name: string; picks: Picks; quantity: number; lineId: string; took: boolean; sized: boolean };
type Offerable = { id: string; name: string; soldOut?: boolean; upgrades?: unknown; choices?: unknown };

/** "the latte", "the blueberry muffin"; a name with other capitals in it ("BLT", "Caesar Salad") is kept as it is. */
const the = (name: string) => `the ${/^[A-Z][^A-Z]*$/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name}`;

/** What there is to offer now (nothing: the line isn't shown). `find`: an item that can be had right now (on the menu at
 *  this time, not sold out), or undefined. */
export function offerList<T extends Offerable>(just: JustAdded | null, item: T | undefined, find: (id: string) => T | undefined, have: (id: string) => boolean) {
  if (!just || !item) return { size: null, items: [] as T[] };
  const o = offersFor(item, just.picks, find, have);
  return { size: just.sized ? null : o.size, items: o.items };
}

export function OfferAsk<T extends Offerable>({ just: j, orderId, item, find, have, price, busy, onSizeUp, onAdd, onClose }: {
  just: JustAdded | null; orderId: string; item: T | undefined; find: (id: string) => T | undefined; have: (id: string) => boolean; price: (m: T) => number;
  busy: boolean; onSizeUp: () => void; onAdd: (m: T) => void; onClose: () => void;
}) {
  const just = j && j.orderId === orderId ? j : null;   // only on the order it was added to
  const { size, items } = offerList(just, item, find, have);
  // Said out loud as it appears: the wrapper stays while the order is being taken, so what's added to it is read out.
  if (!just || (!size && !items.length)) return <div aria-live="polite" />;
  const row = (key: string, name: string, sub: string, action: string, label: string, onClick: () => void) => (
    <li key={key} className="flex items-center justify-between gap-3 rounded-xl bg-[#fff] py-1.5 pl-3 pr-1.5 text-[14.5px]">
      <span className="min-w-0"><b className="font-semibold">{name}</b> <span className="tabular-nums" style={{ color: MUTED }}>{sub}</span></span>
      <button type="button" disabled={busy} onClick={onClick} aria-label={label} className={`min-h-[44px] shrink-0 rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`} style={{ background: INK, color: '#fff' }}>{action}</button>
    </li>);
  return (
    <div aria-live="polite"><div role="group" aria-labelledby="offer-ask" className="space-y-2 rounded-2xl p-3" style={{ background: SOFT, color: INK }}>
      <p id="offer-ask" className="text-[14px] font-semibold">{just.took ? 'Anything with it?' : `Offer with ${the(just.name)}`}</p>
      <ul className="space-y-2">
        {size && row('size', `${size.to} instead`, `+${usd(size.adds * just.quantity)}`, 'Size up', `Size up to ${size.to}, ${usd(size.adds * just.quantity)} more`, onSizeUp)}
        {items.map((m) => { const p = `${(m as any).from ? 'from ' : ''}${usd(price(m))}`; return row(m.id, m.name, p, 'Add', `Add ${m.name}, ${p}`, () => onAdd(m)); })}
      </ul>
      <button type="button" onClick={onClose} className={`min-h-[44px] rounded-xl bg-[#fff] px-4 text-[14.5px] font-semibold ${RING}`} style={{ color: INK }}>{just.took ? 'Done' : 'No thanks'}</button>
    </div></div>
  );
}
