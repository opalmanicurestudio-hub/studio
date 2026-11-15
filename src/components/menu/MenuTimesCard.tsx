'use client';
// src/components/menu/MenuTimesCard.tsx — MENUS BY TIME OF DAY, AND HAPPY HOUR, on the Menu page (design canvas "The
// counter and the menus"; lib/menu-time, api/menu 'times'). The windows are set here; each item says which menus it's in
// and its happy-hour price, in its own editor.
import { useState } from 'react';
import type { Daypart, HappyHour } from '@/lib/menu-time';
import { windowWords } from '@/lib/menu-time';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const field = 'min-h-[44px] rounded-xl border bg-[#fff] px-3 text-[15px] outline-none focus:border-[#16171a]';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const newId = () => Math.random().toString(36).slice(2, 10);

export function MenuTimesCard({ start, onSave }: { start: { dayparts: Daypart[]; happyHour: HappyHour }; onSave: (next: { dayparts: Daypart[]; happyHour: HappyHour }) => Promise<string | null> }) {
  const [parts, setParts] = useState<Daypart[]>(start.dayparts);
  const [hh, setHh] = useState<HappyHour>(start.happyHour);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const setPart = (i: number, p: Partial<Daypart>) => setParts((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    const e = await onSave({ dayparts: parts.map((p) => ({ ...p, name: p.name.trim() })), happyHour: hh });
    setBusy(false); if (e) setErr(e); else setMsg('Saved.');
  };
  return (
    <section aria-labelledby="menu-times" className="space-y-4 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <div><h2 id="menu-times" className="text-[18px] font-semibold">Menus by time of day, and happy hour</h2>
        <p className="text-[14px]" style={{ color: MUTED }}>An item in a menu is only sold while it’s on; outside it, screens say when it’s back. Put items in a menu, and give them a happy-hour price, in each item.</p></div>
      <div className="space-y-2">
        {parts.length === 0 && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: SOFT, color: MUTED }}>None yet: everything is sold all day.</p>}
        {parts.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2">
            <input value={p.name} onChange={(e) => setPart(i, { name: e.target.value.slice(0, 30) })} placeholder="Breakfast" aria-label="Menu name" className={`${field} w-40`} style={{ borderColor: LINE }} />
            <input type="time" value={p.from} onChange={(e) => setPart(i, { from: e.target.value })} aria-label={`${p.name || 'Menu'} starts`} className={field} style={{ borderColor: LINE }} />
            <span style={{ color: MUTED }}>to</span>
            <input type="time" value={p.to} onChange={(e) => setPart(i, { to: e.target.value })} aria-label={`${p.name || 'Menu'} ends`} className={field} style={{ borderColor: LINE }} />
            <button type="button" onClick={() => setParts((xs) => xs.filter((_, k) => k !== i))} className={`min-h-[44px] rounded-xl px-3 text-[14px] ${RING}`} style={{ color: MUTED }}>Remove</button>
          </div>
        ))}
        {parts.length < 6 && <button type="button" onClick={() => setParts((xs) => [...xs, { id: newId(), name: '', from: '11:00', to: '15:00' }])} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold ${RING}`} style={{ border: `1px solid ${LINE}` }}>Add a menu by time</button>}
      </div>
      <div className="space-y-2 rounded-2xl p-4" style={{ background: SOFT }}>
        <button type="button" role="switch" aria-checked={hh.on} onClick={() => setHh((x) => ({ ...x, on: !x.on, days: x.days.length ? x.days : [1, 2, 3, 4, 5] }))} className={`flex w-full items-center justify-between gap-3 text-left ${RING}`}>
          <span><span className="block text-[15px] font-semibold">Happy hour</span><span className="block text-[13px]" style={{ color: MUTED }}>{hh.on ? `${hh.days.map((d) => DAYS[d]).join(', ')}, ${windowWords(hh.from, hh.to)}` : 'Off'}. The price when it’s ordered is the price at checkout.</span></span>
          <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={hh.on ? { background: INK, color: '#fff' } : { background: '#fff', color: MUTED }}>{hh.on ? 'On' : 'Off'}</span>
        </button>
        {hh.on && <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Happy hour days">{DAYS.map((d, i) => { const on = hh.days.includes(i);
            return <button key={d} type="button" aria-pressed={on} onClick={() => setHh((x) => ({ ...x, days: on ? x.days.filter((y) => y !== i) : [...x.days, i].sort() }))} className={`min-h-[44px] min-w-[52px] rounded-xl text-[14px] font-semibold ${RING}`} style={on ? { background: INK, color: '#fff' } : { background: '#fff' }}>{d}</button>; })}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="time" value={hh.from} onChange={(e) => setHh((x) => ({ ...x, from: e.target.value }))} aria-label="Happy hour starts" className={field} style={{ borderColor: LINE }} />
            <span style={{ color: MUTED }}>to</span>
            <input type="time" value={hh.to} onChange={(e) => setHh((x) => ({ ...x, to: e.target.value }))} aria-label="Happy hour ends" className={field} style={{ borderColor: LINE }} />
          </div>
        </>}
      </div>
      {err && <p role="alert" className="rounded-xl px-3 py-2 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <div className="flex items-center gap-3"><button type="button" disabled={busy} onClick={save} className={`min-h-[44px] rounded-xl px-5 text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span role="status" className="text-[14px]" style={{ color: MUTED }}>{msg}</span>}</div>
    </section>
  );
}
