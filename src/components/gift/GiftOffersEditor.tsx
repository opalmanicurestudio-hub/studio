'use client';
// src/components/gift/GiftOffersEditor.tsx — "OFFERS" in the gift card settings drawer (lib/gift-offers): "Buy a $100 gift
// card, get $20 for you." Each offer: what it's called, the amounts (up to four steps), the days it runs, when the bonus
// can first be used and how long it lasts, and where it runs (online, front desk).
import * as React from 'react';
import { offerLine } from '@/lib/gift-offers';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d';
const field = 'h-11 w-full rounded-xl border px-3 text-[15px]';
const pill = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: SOFT });

function nextJan1() { const d = new Date(); return `${d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear()}-01-01`; }
function today() { return new Date().toISOString().slice(0, 10); }
const PRESETS = [
  { label: 'Holiday bonus', make: () => ({ name: 'Holiday bonus', tiers: [{ buyCents: 10000, bonusCents: 2000 }], startsOn: today(), endsOn: `${new Date().getFullYear()}-12-31`, usableFrom: nextJan1(), bonusDays: 90, online: true, desk: true, on: true }) },
  { label: 'Mother’s Day', make: () => ({ name: 'Mother’s Day bonus', tiers: [{ buyCents: 7500, bonusCents: 1000 }, { buyCents: 15000, bonusCents: 2500 }], startsOn: today(), endsOn: null, usableFrom: null, bonusDays: 60, online: true, desk: true, on: true }) },
  { label: 'Start from scratch', make: () => ({ name: 'Gift card bonus', tiers: [{ buyCents: 5000, bonusCents: 1000 }], startsOn: today(), endsOn: null, usableFrom: null, bonusDays: 90, online: true, desk: true, on: true }) },
];

export function GiftOffersEditor({ offers, onChange }: { offers: any[]; onChange: (v: any[]) => void }) {
  const [adding, setAdding] = React.useState(false);
  const put = (i: number, patch: any) => onChange(offers.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const dollars = (c: number) => (c ? String(c / 100) : '');
  return (
    <section className="space-y-3 rounded-[18px] p-4" style={{ border: `1px solid ${LINE}` }}>
      <div><p className="text-[15px] font-semibold">Offers</p>
        <p className="text-[13px]" style={{ color: MUTED }}>“Buy a $100 gift card, get $20 for you.” The bonus is a separate card for the buyer, so the gift stays whole. Bonus cards are used at the studio, have an end date, and show in your books as a discount when they’re used.</p></div>
      {offers.map((o, i) => (
        <div key={i} className="space-y-3 rounded-2xl p-4" style={{ background: SOFT }}>
          <div className="flex items-center gap-2">
            <input value={o.name} onChange={(e) => put(i, { name: e.target.value.slice(0, 40) })} aria-label="Offer name" className={`${field} bg-white`} style={{ borderColor: LINE }} />
            <button type="button" role="switch" aria-checked={o.on !== false} aria-label="Offer on" onClick={() => put(i, { on: o.on === false })} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: o.on !== false ? GREEN : '#d5d6da' }}><span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: o.on !== false ? 24 : 4 }} /></button>
          </div>
          <div className="space-y-2">{(o.tiers || []).map((t: any, k: number) => (
            <div key={k} className="flex flex-wrap items-center gap-2 text-[14px]">
              <span className="shrink-0">Buy</span><input value={dollars(t.buyCents)} onChange={(e) => put(i, { tiers: o.tiers.map((x: any, z: number) => (z === k ? { ...x, buyCents: Math.round(Number(e.target.value.replace(/[^0-9.]/g, '')) * 100) || 0 } : x)) })} inputMode="decimal" aria-label="Gift card amount" placeholder="$100" className="h-10 w-24 rounded-xl border bg-white px-2 text-center" style={{ borderColor: LINE }} />
              <span className="shrink-0">or more, get</span><input value={dollars(t.bonusCents)} onChange={(e) => put(i, { tiers: o.tiers.map((x: any, z: number) => (z === k ? { ...x, bonusCents: Math.round(Number(e.target.value.replace(/[^0-9.]/g, '')) * 100) || 0 } : x)) })} inputMode="decimal" aria-label="Bonus amount" placeholder="$20" className="h-10 w-20 rounded-xl border bg-white px-2 text-center" style={{ borderColor: LINE }} />
              <span className="shrink-0">for you</span>
              {o.tiers.length > 1 && <button type="button" onClick={() => put(i, { tiers: o.tiers.filter((_: any, z: number) => z !== k) })} className="ml-auto text-[13px] underline" style={{ color: MUTED }}>Remove</button>}
            </div>))}
            {(o.tiers || []).length < 4 && <button type="button" onClick={() => put(i, { tiers: [...(o.tiers || []), { buyCents: ((o.tiers?.[o.tiers.length - 1]?.buyCents) || 5000) * 2, bonusCents: ((o.tiers?.[o.tiers.length - 1]?.bonusCents) || 1000) * 2 }] })} className="text-[13px] font-semibold underline underline-offset-4">Add a bigger step</button>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([['Sell from', 'startsOn'], ['Until', 'endsOn'], ['Bonus usable from', 'usableFrom']] as const).map(([l, k]) => (
              <label key={k} className="block text-[12.5px] font-semibold" style={{ color: MUTED }}>{l}
                <input type="date" value={o[k] || ''} onChange={(e) => put(i, { [k]: e.target.value || null })} className="mt-1 h-10 w-full rounded-xl border bg-white px-2 text-[14px]" style={{ borderColor: LINE, color: INK }} /></label>))}
          </div>
          <div><p className="mb-1.5 text-[12.5px] font-semibold" style={{ color: MUTED }}>The bonus lasts</p>
            <div className="flex flex-wrap gap-1.5">{[30, 60, 90, 180, 365].map((d) => <button key={d} type="button" aria-pressed={o.bonusDays === d} onClick={() => put(i, { bonusDays: d })} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={pill(o.bonusDays === d)}>{d === 365 ? '1 year' : `${d} days`}</button>)}</div></div>
          <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[12.5px] font-semibold" style={{ color: MUTED }}>Where</span>
            <button type="button" aria-pressed={o.online !== false} onClick={() => put(i, { online: o.online === false })} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={pill(o.online !== false)}>Online shop</button>
            <button type="button" aria-pressed={o.desk !== false} onClick={() => put(i, { desk: o.desk === false })} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={pill(o.desk !== false)}>Front desk</button></div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 text-[13.5px]"><span>Buyers see: <b>{(o.tiers || []).filter((t: any) => t.buyCents && t.bonusCents).length ? offerLine({ ...o, tiers: o.tiers.filter((t: any) => t.buyCents && t.bonusCents) }) : '—'}</b></span>
            <button type="button" onClick={() => onChange(offers.filter((_, j) => j !== i))} className="shrink-0 text-[13px] underline" style={{ color: MUTED }}>Delete offer</button></div>
        </div>))}
      {adding ? <div className="flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p.label} type="button" onClick={() => { onChange([...offers, p.make()]); setAdding(false); }} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: SOFT }}>{p.label}</button>)}</div>
        : offers.length < 10 && <button type="button" onClick={() => setAdding(true)} className="h-11 rounded-full px-5 text-[14.5px] font-semibold" style={{ border: `1px solid ${LINE}` }}>Add an offer</button>}
      <p className="text-[12.5px]" style={{ color: MUTED }}>The first offer that’s on and in its dates is the one that runs. Bonus cards can’t be used in the online shop, for deposits or for a balance.</p>
    </section>);
}
