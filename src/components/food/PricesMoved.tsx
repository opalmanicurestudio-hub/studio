'use client';
// src/components/food/PricesMoved.tsx — PRICES THAT MOVED (design canvas "Food numbers": This week's numbers; lib/
// price-creep). On the Food cost page: each ingredient that came in at 5% more or less than the delivery before, in the
// stretch picked, and what it did to the menu: a dish now over the aim (with the price that brings it back, set here in
// two taps through api/food-cost 'price', or its recipe opened on the Menu), and a choice that no longer pays for itself.
import { useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const money = (v: number) => `$${v.toFixed(2)}`;
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export type MovedDish = { id: string; name: string; price: number; before: number; after: number; shareBefore: number | null; shareAfter: number | null; crossed: boolean; over: boolean; fix: number | null };
export type MovedOption = { itemId: string; item: string; option: string; charges: number; costBefore: number; costAfter: number; keeps: number };
export type PriceMove = { id: string; name: string; container: string; from: number; to: number; pct: number; up: boolean; at: string; live?: number | null; dishes: MovedDish[]; options: MovedOption[] };

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/food-cost', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export function PricesMoved({ tenantId, moves, target, periodText, onPriced }: { tenantId: string; moves: PriceMove[]; target: number; periodText: string; onPriced: () => void }) {
  const [asking, setAsking] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; good: boolean } | null>(null);
  const setPrice = async (d: MovedDish) => {
    if (!d.fix) return; setBusy(true); setSaid(null);
    const r = await post({ tenantId, action: 'price', itemId: d.id, price: d.fix, was: d.price }); setBusy(false); setAsking(null);
    if (r.ok) { setSaid({ text: `${d.name} is ${money(d.fix)} now, on every menu.`, good: true }); onPriced(); } else setSaid({ text: r.error || 'That didn’t save.', good: false });
  };
  return (
    <section aria-labelledby="moved-title" className="rounded-3xl bg-[#fff] px-5 py-4">
      <h2 id="moved-title" className="text-[15px] font-semibold">Prices that moved</h2>
      <p className="text-[13.5px]" style={{ color: MUTED }}>From your deliveries {periodText}, and the dishes they moved against your {pct(target)} aim.</p>
      {said && <p role="status" className="mt-2 rounded-2xl px-3 py-2 text-[13.5px]" style={said.good ? { background: SOFT, color: GREEN } : { background: AMBER_TINT, color: AMBER }}>{said.text}</p>}
      {moves.length === 0 ? <p className="mt-3 text-[14px]" style={{ color: MUTED }}>Nothing came in at 5% more or less than the time before. When a delivery costs something new, type what you paid as you put it away, and it shows here.</p> : (
        <ul className="mt-2">
          {moves.map((m) => {
            const hurt = m.dishes.filter((d) => d.over); const rest = m.dishes.filter((d) => !d.over).slice(0, Math.max(0, 3 - hurt.length));
            return (
              <li key={m.id} className="border-t py-3" style={{ borderColor: LINE }}>
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14.5px]"><span className="font-medium">{m.name}</span>
                  <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: m.up ? AMBER : GREEN }}>{m.up ? 'Up' : 'Down'} {Math.round(Math.abs(m.pct) * 100)}%</span></p>
                <p className="text-[13px] tabular-nums" style={{ color: MUTED }}>{money(m.from)} to {money(m.to)}{m.container ? ` a ${m.container}` : ''}, from the {day(m.at)} delivery</p>
                {m.live !== null && m.live !== undefined && <p className="mt-1 text-[13px]" style={{ color: AMBER }}>Your costs still use {money(m.live)}, so the dishes below show what they’d cost at the new price.</p>}
                {m.live !== null && m.live !== undefined && <Link href={`/inventory/product/${encodeURIComponent(m.id)}`} className={`inline-flex min-h-[44px] items-center rounded-xl text-[13.5px] font-semibold underline underline-offset-4 ${RING}`}>Put in what you pay now</Link>}
                {hurt.map((d) => {
                  const k = `${m.id}/${d.id}`;
                  return (
                    <div key={d.id} className="mt-2 rounded-2xl px-3 py-2.5" style={{ background: AMBER_TINT }}>
                      <p className="text-[13.5px]" style={{ color: INK }}><b className="font-semibold">{d.name}</b> is {pct(d.shareAfter)} of its {money(d.price)} price now <span style={{ color: MUTED }}>(it was {pct(d.shareBefore)})</span>.</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {d.fix && (asking === k
                          ? <><button type="button" disabled={busy} onClick={() => void setPrice(d)} className={`min-h-[44px] rounded-xl px-3 text-[13.5px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : `Change it to ${money(d.fix)}`}</button>
                            <button type="button" onClick={() => setAsking(null)} className={`min-h-[44px] rounded-xl px-3 text-[13.5px] font-semibold ${RING}`} style={{ color: MUTED }}>Cancel</button></>
                          : <button type="button" onClick={() => { setAsking(k); setSaid(null); }} className={`min-h-[44px] rounded-xl bg-[#fff] px-3 text-[13.5px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Price it at {money(d.fix)}</button>)}
                        <Link href={`/menu?item=${encodeURIComponent(d.id)}`} className={`inline-flex min-h-[44px] items-center rounded-xl px-2 text-[13.5px] font-semibold underline underline-offset-4 ${RING}`}>Look at the recipe</Link>
                      </div>
                    </div>
                  );
                })}
                {rest.map((d) => <p key={d.id} className="mt-1 text-[13px]" style={{ color: MUTED }}>{d.name}: {pct(d.shareAfter)} now, was {pct(d.shareBefore)}</p>)}
                {m.options.map((o) => (
                  <div key={`${o.itemId}-${o.option}`} className="mt-2 rounded-2xl px-3 py-2.5" style={{ background: AMBER_TINT }}>
                    <p className="text-[13.5px]"><b className="font-semibold">{o.option}</b> on {o.item} now costs you {money(o.costAfter)} more, and you charge {money(o.charges)} for it.</p>
                    <Link href={`/menu?item=${encodeURIComponent(o.itemId)}`} className={`mt-1 inline-flex min-h-[44px] items-center rounded-xl px-2 text-[13.5px] font-semibold underline underline-offset-4 ${RING}`}>Change what it charges</Link>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
