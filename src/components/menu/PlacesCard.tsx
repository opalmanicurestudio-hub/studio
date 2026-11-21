'use client';
// src/components/menu/PlacesCard.tsx — ORDERING AHEAD AT EACH LOCATION, on the Menu page under Order ahead (design board
// "More than one location"; api/menu 'aheadPlace'; lib/ahead-places). Only with more than one location: guests pick one
// (the nearest first), so each says whether it takes orders ahead and delivers, its hours (the business's or its own),
// and has its own link and code to print. The same card is on Shop settings as Your stores (`mode` 'shop'; lib/shop-stores-
// server): whether each is a store on the online shop, delivers, its hours, and its own shop link.
import { useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const BTN = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const DAYS: [string, string][] = [['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun']];
const CLOCKS = Array.from({ length: 48 }, (_, i) => { const h = Math.floor(i / 2), m = i % 2 ? '30' : '00'; return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`; });
type Day = { enabled: boolean; start: string; end: string };
export type PlaceSettings = { id: string; name: string; address: string | null; ahead: boolean; delivery: boolean; shop?: boolean; hours: Record<string, Day> | null; pinned: boolean; link: string; shopLink?: string;
  /** Where it stands on the map (lib/locate-server), its own time zone when it keeps one, and (Your stores) whether its
   *  hours leave none of the shop's pickup times. */
  map?: 'on' | 'missed' | 'no_address' | 'not_yet'; zone?: string | null; pickupNone?: boolean;
  /** A time zone kept on it that isn't used until the owner says it's right (lib/here-server zoneToAsk). */
  zoneAsk?: string | null };

/** "Central time", from a time zone's name. */
export function zoneWords(tz: string): string {
  try {
    const n = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value || tz;
    return n.replace(/ (Standard|Daylight|Summer) Time$/, ' time').replace(/ Time$/, ' time');
  } catch { return tz; }
}

const startWeek = (): Record<string, Day> => Object.fromEntries(DAYS.map(([d]) => [d, { enabled: d !== 'sunday', start: '9:00 AM', end: '5:00 PM' }]));

/** Opening hours for one location: each day open or closed, with its opening and closing. */
function WeekHours({ start, busy, onSave }: { start: Record<string, Day>; busy: boolean; onSave: (w: Record<string, Day>) => void }) {
  const [w, setW] = useState<Record<string, Day>>(start);
  const set = (d: string, patch: Partial<Day>) => setW((x) => ({ ...x, [d]: { ...x[d], ...patch } }));
  const sel = `min-h-[44px] rounded-xl bg-[#fff] px-1.5 text-[13.5px] disabled:opacity-40 ${RING}`;
  return (
    <div className="space-y-2">
      {DAYS.map(([d, label]) => (
        <div key={d} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className="flex min-h-[44px] w-[64px] shrink-0 items-center gap-2 text-[14px] font-medium"><input type="checkbox" checked={w[d].enabled} onChange={(e) => set(d, { enabled: e.target.checked })} className="h-5 w-5 accent-[#16171a]" />{label}</label>
          {w[d].enabled ? <div className="grid min-w-[230px] max-w-[300px] flex-1 grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <select aria-label={`${label} opens`} value={w[d].start} onChange={(e) => set(d, { start: e.target.value })} className={`${sel} w-full`} style={{ border: `1px solid ${LINE}` }}>{CLOCKS.map((c) => <option key={c}>{c}</option>)}</select>
            <span className="text-[13.5px]" style={{ color: MUTED }}>to</span>
            <select aria-label={`${label} closes`} value={w[d].end} onChange={(e) => set(d, { end: e.target.value })} className={`${sel} w-full`} style={{ border: `1px solid ${LINE}` }}>{CLOCKS.map((c) => <option key={c}>{c}</option>)}</select>
          </div> : <span className="text-[14px]" style={{ color: MUTED }}>Closed</span>}
        </div>))}
      <button type="button" disabled={busy} onClick={() => onSave(w)} className={BTN} style={{ background: INK, color: '#fff' }}>Save its hours</button>
    </div>);
}

export function PlacesCard({ places, call, onSaved, mode = 'ahead', storesLink, houseZone }: { places: PlaceSettings[]; call: (body: any) => Promise<any>; onSaved: (ahead: any) => void; mode?: 'ahead' | 'shop'; storesLink?: string; houseZone?: string }) {
  const shop = mode === 'shop';
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [said, setSaid] = useState('');
  const [own, setOwn] = useState<Record<string, boolean>>(() => Object.fromEntries(places.map((p) => [p.id, !!p.hours])));
  const save = async (p: PlaceSettings, patch: any, words: string) => {
    setBusy(p.id); setErr(''); setSaid('');
    const d = await call({ action: 'aheadPlace', id: p.id, ...patch });
    setBusy('');
    if (d.ok) { onSaved(d.ahead); setSaid(words); } else setErr(d.error || 'That didn’t save. Try again.');
  };
  const linkOf = (p: PlaceSettings) => (shop ? p.shopLink || p.link : p.link);
  const copyText = async (text: string, words: string) => { setErr(''); try { await navigator.clipboard.writeText(text); setSaid(words); } catch { setErr('Copy didn’t work. Select the link and copy it.'); } };
  const copy = (p: PlaceSettings) => copyText(linkOf(p), `${p.name}’s link is copied.`);
  const code = async (p: PlaceSettings) => {
    try {
      const Q: any = await import('qrcode'); const img: string = await Q.toDataURL(linkOf(p), { margin: 1, width: 480, color: { dark: INK, light: '#ffffff' } });
      const a = document.createElement('a'); a.href = img; a.download = `${shop ? 'shop' : 'order-ahead'}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`; a.click();
    } catch { setErr('The code couldn’t be made. Try again.'); }
  };
  const check = (p: PlaceSettings, on: boolean, label: string, k: 'ahead' | 'delivery' | 'shop') => (
    <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
      <input type="checkbox" checked={on} disabled={busy === p.id} onChange={(e) => { const v = e.target.checked; save(p, { [k]: v }, k === 'shop' ? `${p.name} is ${v ? 'on' : 'off'} your shop.` : k === 'delivery' ? `${p.name} ${v ? 'delivers' : 'doesn’t deliver'}.` : `${p.name} ${v ? 'takes' : 'doesn’t take'} orders ahead.`); }} className="h-5 w-5 accent-[#16171a]" />{label}
    </label>);
  return (
    <div className="space-y-3 rounded-2xl p-4" style={{ border: `1px solid ${LINE}` }}>
      <div>
        <p className="text-[15px] font-semibold">{shop ? 'Your stores' : 'Your locations'}</p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>{shop ? 'Customers pick one to pick up from, the nearest first once they share where they are. A delivery goes from the nearest store that delivers there.' : 'Guests pick one, the nearest first once they share where they are. A delivery goes from the nearest one that delivers there.'}</p>
      </div>
      <ul className="space-y-3">
        {places.map((p) => (
          <li key={p.id} className="space-y-2 rounded-2xl p-3.5" style={{ background: SOFT }}>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[15px] font-semibold">{p.name}</p>{p.pinned && p.map !== 'not_yet' && <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>On the map</span>}</div>
              {p.address && <p className="text-[13.5px]" style={{ color: MUTED }}>{p.address}</p>}
              {p.zone && <p className="mt-0.5 text-[13.5px]">{zoneWords(p.zone)}{houseZone ? <span style={{ color: MUTED }}> (the business is on {zoneWords(houseZone)})</span> : null}</p>}
            </div>
            {p.zoneAsk && houseZone && (
              <div className="space-y-2 rounded-xl px-3 py-2.5" style={{ background: AMBER_TINT }}>
                <p className="text-[13.5px]" style={{ color: AMBER }}>Settings, Locations has {p.name} on {zoneWords(p.zoneAsk)}, and the business is on {zoneWords(houseZone)}. Which is it on?</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {([['own', p.zoneAsk], ['house', houseZone]] as const).map(([k, z]) => (
                    <button key={k} type="button" disabled={busy === p.id} onClick={() => save(p, { zone: k }, `${p.name} is on ${zoneWords(z)}.`)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>{zoneWords(z).replace(/^./, (c) => c.toUpperCase())}</button>))}
                </div>
              </div>)}
            {p.pinned && p.map === 'not_yet' && <p className="rounded-xl px-3 py-2 text-[13.5px]" style={{ background: AMBER_TINT, color: AMBER }}>Its address changed. It’s found on the map again the next time this opens; until then distances use its old place.</p>}
            {!p.pinned && <p className="rounded-xl px-3 py-2 text-[13.5px]" style={{ background: AMBER_TINT, color: AMBER }}>{p.map === 'missed' ? 'We couldn’t find its address on the map. Check it in Settings, Locations.'
              : p.map === 'no_address' ? `Add its address in Settings, Locations, so ${shop ? 'customers' : 'guests'} see how far it is and deliveries can go from it.`
              : `Locate its address in Settings, Locations, so ${shop ? 'customers' : 'guests'} see how far it is and deliveries can go from it.`}</p>}
            {shop && p.shop !== false && p.pickupNone && <p className="rounded-xl px-3 py-2 text-[13.5px]" style={{ background: AMBER_TINT, color: AMBER }}>No pickup times coming up: its opening hours and your pickup hours don’t overlap. Change its hours below, or your <a href="/retail-orders/policies/pickup" className="font-semibold underline underline-offset-2">pickup hours</a>.</p>}
            <div className="grid gap-x-4 sm:grid-cols-2">{shop ? check(p, p.shop !== false, 'On your shop', 'shop') : check(p, p.ahead, 'Takes orders ahead', 'ahead')}{check(p, p.delivery, 'Delivers from here', 'delivery')}</div>
            <div role="radiogroup" aria-label={`${p.name}’s opening hours`}>
              <p className="text-[14px] font-semibold">Opening hours</p>
              {shop && <p className="text-[13px]" style={{ color: MUTED }}>Pickup times at this store stay inside them. Ordering ahead uses the same hours.</p>}
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {([[false, 'Same as the business'], [true, 'Its own']] as const).map(([v, words]) => { const on = !!own[p.id] === v; return (
                  <button key={words} type="button" role="radio" aria-checked={on} disabled={busy === p.id} onClick={() => { setOwn((x) => ({ ...x, [p.id]: v })); if (!v && p.hours) void save(p, { hours: null }, `${p.name} uses the business’s hours.`); }}
                    className={`min-h-[44px] rounded-xl px-2 text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={on ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff', color: INK }}>{words}</button>); })}
              </div>
            </div>
            {own[p.id] && <WeekHours start={p.hours || startWeek()} busy={busy === p.id} onSave={(w) => save(p, { hours: w }, `${p.name}’s hours are saved.`)} />}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => copy(p)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>Copy its link</button>
              <button type="button" onClick={() => code(p)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>Save its code</button>
            </div>
          </li>))}
      </ul>
      {shop && storesLink && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3.5" style={{ background: SOFT }}>
          <div className="min-w-0"><p className="text-[14.5px] font-semibold">Find a store page</p><p className="text-[13.5px]" style={{ color: MUTED }}>Linked from your shop’s menu. Each store’s link opens the shop with that store picked.</p></div>
          <button type="button" onClick={() => copyText(storesLink, 'The Find a store link is copied.')} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>Copy the link</button>
        </div>)}
      <p aria-live="polite" className={said ? 'text-[13.5px] font-medium' : 'sr-only'} style={{ color: GREEN }}>{said}</p>
      {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px] font-medium" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
    </div>);
}
