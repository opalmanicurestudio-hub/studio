'use client';
// src/components/menu/OneOffCard.tsx — SOMETHING NOT ON THE MENU, ON THE MENU PAGE'S SETTINGS (lib/counter-oneoff; api/menu
// 'laneSettings' oneOffMax and oneOffForget; design board "Register tools", part 2). Up to how much the counter and the
// window can ring in something that isn't on the menu ($0 turns it off), and what's been rung in by name, so the
// business can see what's worth putting on the menu. Nothing here changes a price on the menu.
import { useState } from 'react';
import { ONE_OFF_MAX_CAP, type OneOffName } from '@/lib/counter-oneoff';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const dayOf = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };

export type OneOffSettings = { max: number; names: OneOffName[] };

export function OneOffCard({ start, call }: { start: OneOffSettings; call: (body: any) => Promise<any> }) {
  const [open, setOpen] = useState(false);
  const [max, setMax] = useState(start.max); const [typed, setTyped] = useState(start.max > 0 ? start.max.toFixed(2) : '');
  const [names, setNames] = useState<OneOffName[]>(start.names);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const save = async (n: number) => {
    setBusy('max'); setMsg(null);
    const d = await call({ action: 'laneSettings', oneOffMax: n }); setBusy(null);
    if (d.ok && typeof d.lane?.oneOffMax === 'number') { setMax(d.lane.oneOffMax); setTyped(d.lane.oneOffMax > 0 ? d.lane.oneOffMax.toFixed(2) : ''); setMsg({ text: d.lane.oneOffMax > 0 ? `The counter can ring in something not on the menu, up to ${usd(d.lane.oneOffMax)}.` : 'Turned off: only what’s on the menu can be rung in.', tone: 'good' }); }
    else setMsg({ text: d.error || 'That didn’t save. Try again.', tone: 'warn' });
  };
  const forget = async (k: string) => {
    setBusy(k); setMsg(null);
    const d = await call({ action: 'laneSettings', oneOffForget: k }); setBusy(null);
    if (d.ok && Array.isArray(d.lane?.oneOffNames)) setNames(d.lane.oneOffNames); else setMsg({ text: d.error || 'That didn’t save. Try again.', tone: 'warn' });
  };
  const n = Math.round(Number(typed.replace(/[$,\s]/g, '')) * 100) / 100;
  const summary = max > 0 ? `Up to ${usd(max)}${names.length ? `; ${names.length} rung in lately` : ''}` : 'Off';
  return (
    <section aria-labelledby="oneoff-title" className="rounded-3xl border bg-[#fff]" style={{ borderColor: LINE }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-3xl px-5 text-left ${RING}`}>
        <span><span id="oneoff-title" className="block text-[16px] font-semibold">Something not on the menu</span><span className="block text-[13.5px]" style={{ color: MUTED }}>{summary}</span></span>
        <span className="text-[14px] font-semibold" style={{ color: MUTED }}>{open ? 'Close' : 'Change'}</span>
      </button>
      {open && <div className="space-y-5 border-t px-5 pb-5 pt-4" style={{ borderColor: LINE }}>
        <div className="space-y-2">
          <p className="text-[14px]" style={{ color: MUTED }}>The counter and the window can ring in something that isn’t on the menu, with its own name and price. It’s handed over at the counter, not sent to the kitchen, and no stock moves for it.</p>
          <label htmlFor="oneoff-max" className="block text-[13px] font-semibold" style={{ color: MUTED }}>Up to</label>
          <div className="flex flex-wrap gap-2">
            <span className="flex min-h-[44px] w-36 items-center rounded-xl border px-3" style={{ borderColor: LINE }}>
              <span aria-hidden style={{ color: MUTED }}>$</span>
              <input id="oneoff-max" inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="100.00" className="min-w-0 flex-1 bg-transparent px-1 text-[15px] tabular-nums outline-none" style={{ color: INK }} />
            </span>
            <button type="button" disabled={busy === 'max' || !(n > 0 && n <= ONE_OFF_MAX_CAP) || n === max} onClick={() => void save(n)} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'max' ? 'Saving…' : 'Save'}</button>
            {max > 0 && <button type="button" disabled={busy === 'max'} onClick={() => void save(0)} className={btn} style={{ border: `1px solid ${LINE}`, color: INK }}>Turn it off</button>}
          </div>
          {n > ONE_OFF_MAX_CAP && <p className="text-[13.5px]" style={{ color: AMBER }}>Up to ${ONE_OFF_MAX_CAP} at most. Anything more belongs on the menu.</p>}
        </div>
        <div className="space-y-2">
          <p className="text-[15px] font-medium">Rung in lately</p>
          {names.length === 0 ? <p className="text-[14px]" style={{ color: MUTED }}>Nothing yet. What the counter rings in shows here by name, so you can see what’s worth putting on the menu.</p>
            : <ul>{names.map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-3 border-t py-2" style={{ borderColor: LINE }}>
                <span className="min-w-0"><span className="block truncate text-[14.5px]">{x.name}</span>
                  <span className="block text-[13px]" style={{ color: MUTED }}>{x.count} {x.count === 1 ? 'time' : 'times'}, last {usd(x.lastPrice)} on {dayOf(x.lastAt)}</span></span>
                <button type="button" disabled={busy === x.key} onClick={() => void forget(x.key)} className={`${btn} shrink-0 text-[13.5px]`} style={{ color: MUTED }}>Take off the list</button>
              </li>))}</ul>}
          {names.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>Put one on the menu from the Items tab, then take it off this list.</p>}
        </div>
        {msg && <p role={msg.tone === 'warn' ? 'alert' : 'status'} className="text-[14px]" style={{ color: msg.tone === 'warn' ? AMBER : GREEN }}>{msg.text}</p>}
      </div>}
    </section>
  );
}
