'use client';
// src/components/staff-portal/DayChange.tsx — ON THE DAY, in the staff app's visit drawer (lib/prep-day). More to do than
// the booking allows? The provider picks what's needed — add-ons with a count, extra minutes, or a different service — sees
// the new "up to" price and whether it fits, then hands the screen to the client: the change, the price, the time, any
// on-the-day fee, and two big buttons. Nothing changes until the client says yes, and every answer is kept on the visit.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { payPost } from '@/components/pay/pay-client';
import { quoteFor, dayCheck } from '@/lib/prep-check';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;
const LIVE = ['arrived', 'checked_in', 'confirmed', 'servicing', 'in_service', 'ready_for_checkout', 'scheduled', 'booked'];

export function DayChange({ apt, tenantId, staffName }: { apt: any; tenantId: string; staffName?: string }) {
  const [open, setOpen] = React.useState(false); const [o, setO] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [qty, setQty] = React.useState<Record<string, number>>({}); const [mins, setMins] = React.useState(0); const [sw, setSw] = React.useState<string>('');
  const [fee, setFee] = React.useState(true); const [runOver, setRunOver] = React.useState(false);
  const [show, setShow] = React.useState(false); const [busy, setBusy] = React.useState(''); const [done, setDone] = React.useState<any>(null);
  const first = String(apt?.clientName || 'the client').split(' ')[0];
  const today = apt?.startTime && new Date(apt.startTime).toDateString() === new Date().toDateString();
  if (!apt?.id || !today || !LIVE.includes(String(apt.status || 'booked'))) return null;

  const load = async () => { setOpen(true); setErr(''); if (o) return; const r = await payPost('/api/prep-decide', { tenantId, appointmentId: apt.id, action: 'day_options' }); if (r.ok) setO(r); else setErr(r.error || 'Couldn’t load the options.'); };
  const input = { addOns: Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => ({ id, qty: n })), addMinutes: mins, switchServiceId: sw || null };
  const svc = o ? (o.catalog || []).find((s: any) => s.id === apt.serviceId) || { id: apt.serviceId, name: o.serviceName, price: o.price, duration: o.minutes } : null;
  const q = o ? quoteFor(dayCheck(input), svc, o.catalog || [], { day: 'pick' }, { price: o.price, duration: o.minutes }) : null;
  const extra = q ? Math.max(0, q.newMinutes - o.minutes) : 0; const fits = !o || o.freeMinutes === null || extra <= o.freeMinutes;
  const word = o?.quote === 'about' ? 'About' : 'Up to'; const feeAmt = o && fee && o.feeCents > 0 ? o.feeCents / 100 : 0;
  const canRunOver = o?.onDay === 'provider';
  const until = q && o ? new Date(Date.parse(apt.startTime) + q.newMinutes * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: o.timeZone }) : '';
  const answer = async (ans: 'yes' | 'no') => { setBusy(ans); setErr(''); const r = await payPost('/api/prep-decide', { tenantId, appointmentId: apt.id, action: 'day_change', ...input, answer: ans, fee: feeAmt > 0, runOver: canRunOver && runOver }); setBusy(''); if (r.ok) { setDone({ ...r, answer: ans }); setShow(false); } else setErr(r.error || 'That didn’t save — try again.'); };
  const step = (id: string, d: number) => setQty((m) => ({ ...m, [id]: Math.max(0, Math.min(20, (m[id] || 0) + d)) }));
  const outcomeText = (r: any) => r.answer === 'no' ? `${first} said no — kept as booked.` : r.outcome === 'applied' || r.outcome === 'applied_over' ? `${first} said yes — it’s on the booking, ${word.toLowerCase()} ${money(r.quote?.newPrice || 0)}${r.fee ? ` + ${money(r.fee)} fee` : ''}. They’ve been sent it in writing.` : r.outcome === 'needs_new_time' ? `${first} said yes — it doesn’t fit today, so the desk will find a new time (free).` : `${first} said yes — do what fits today; the desk will book the rest before they leave.`;
  const ruleText = o?.onDay === 'extend_or_move' ? 'It doesn’t fit today — we’ll find you another time for it, with no fee.' : o?.onDay === 'provider' ? (runOver ? `We’ll take the extra time today — until about ${until}.` : 'It doesn’t fit today — we’ll do what fits and book the rest with you.') : 'It doesn’t fit today — we’ll do what fits and book the rest with you.';

  return (
    <div className="space-y-2.5 rounded-[18px] border bg-white p-3.5 text-left" style={{ borderColor: LINE, color: INK }}>
      {!open && !done && <button type="button" onClick={load} className="flex w-full items-center justify-between text-left"><span><span className="block text-[15.5px] font-semibold">More to do than booked?</span><span className="block text-[13px]" style={{ color: MUTED }}>Show {first} the change and the price first — they can say no.</span></span><span className="text-[20px]" style={{ color: MUTED }}>›</span></button>}
      {done && <p className="text-[14px]" style={{ color: done.answer === 'yes' ? GREEN : INK }}>{outcomeText(done)}</p>}
      {open && !done && <>
        <div className="flex items-center justify-between"><p className="text-[15.5px] font-semibold">On the day</p><button type="button" onClick={() => setOpen(false)} className="text-[13px]" style={{ color: MUTED }}>Close</button></div>
        {!o && !err && <p className="text-[13.5px]" style={{ color: MUTED }}>Loading…</p>}
        {o && <>
          {o.before && <p className="rounded-[12px] px-3 py-2 text-[13px]" style={{ background: SOFT }}>{o.before}.</p>}
          {o.addOns.length > 0 && <div className="space-y-1.5"><p className="text-[12px] tracking-[0.08em]" style={{ color: MUTED }}>add-ons</p>
            {o.addOns.map((x: any) => <div key={x.id} className="flex items-center justify-between gap-2 text-[14px]"><span>{x.name} <span style={{ color: MUTED }}>· {money(x.price)}</span></span>
              <span className="flex items-center gap-1.5"><button type="button" aria-label={`One fewer ${x.name}`} disabled={!qty[x.id]} onClick={() => step(x.id, -1)} className="h-9 w-9 rounded-full disabled:opacity-30" style={{ background: SOFT }}>−</button><span className="w-6 text-center">{qty[x.id] || 0}</span><button type="button" aria-label={`One more ${x.name}`} onClick={() => step(x.id, 1)} className="h-9 w-9 rounded-full" style={{ background: SOFT }}>+</button></span></div>)}</div>}
          <div className="space-y-1.5"><p className="text-[12px] tracking-[0.08em]" style={{ color: MUTED }}>extra time</p>
            <div className="flex flex-wrap gap-1.5">{[0, 15, 30, 45, 60].map((m) => <button key={m} type="button" aria-pressed={mins === m} onClick={() => setMins(m)} className="h-9 rounded-full px-3.5 text-[13.5px]" style={mins === m ? { background: INK, color: '#fff' } : { background: SOFT }}>{m ? `+${m} min` : 'None'}</button>)}</div></div>
          {o.switches.length > 0 && <label className="block space-y-1.5"><span className="block text-[12px] tracking-[0.08em]" style={{ color: MUTED }}>a different service instead</span>
            <select value={sw} onChange={(e) => setSw(e.target.value)} className="h-11 w-full rounded-[12px] border bg-white px-3 text-[14px]" style={{ borderColor: LINE }}><option value="">Keep {o.serviceName}</option>{o.switches.map((s: any) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</select></label>}
          {q?.changed && <div className="space-y-1.5 rounded-[12px] px-3 py-2.5 text-[13.5px]" style={{ background: '#fdf3e6', color: '#7a3e05' }}>
            <p><b>{q.lines.join(' · ')}</b></p><p>{money(q.oldPrice)} → {word.toLowerCase()} {money(q.newPrice)} · {fits ? `fits — until about ${until}` : `needs ${extra} min, ${o.freeMinutes} free after`}</p></div>}
          {q?.changed && !fits && canRunOver && <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={runOver} onChange={(e) => setRunOver(e.target.checked)} /> I’ll run over into my next time</label>}
          {q?.changed && o.feeCents > 0 && (fits || runOver) && <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={fee} onChange={(e) => setFee(e.target.checked)} /> Add the on-the-day fee ({money(o.feeCents / 100)})</label>}
          <button type="button" disabled={!q?.changed} onClick={() => setShow(true)} className="h-12 w-full rounded-full text-[15px] font-semibold text-white disabled:opacity-30" style={{ background: INK }}>Show {first}</button>
        </>}
        {err && <p className="text-[13px]" style={{ color: RED }}>{err}</p>}
      </>}

      {show && q && o && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[400] flex flex-col overflow-y-auto p-6" role="dialog" aria-modal="true" aria-label="Today’s change" style={{ color: INK, background: '#fff', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
        <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col">
          <p className="text-[13px] tracking-[0.1em]" style={{ color: MUTED }}>today’s visit</p>
          <h2 className="mt-1 text-[30px] font-light leading-tight tracking-[-0.02em]">{first}, here’s what {staffName ? staffName.split(' ')[0] : 'we'} found</h2>
          <div className="mt-5 space-y-2">{q.lines.map((l) => <p key={l} className="rounded-[18px] px-4 py-3 text-[17px]" style={{ background: SOFT }}>{l}</p>)}</div>
          <div className="mt-5 rounded-[18px] border p-4" style={{ borderColor: LINE }}>
            <div className="flex items-baseline justify-between"><span className="text-[15px]" style={{ color: MUTED }}>Was</span><span className="text-[17px]" style={{ color: MUTED, textDecoration: 'line-through' }}>{money(q.oldPrice)}</span></div>
            <div className="mt-1 flex items-baseline justify-between"><span className="text-[17px]">{fits || runOver ? `Now ${word.toLowerCase()}` : 'Today'}</span><span className="text-[30px] font-semibold">{money(fits || runOver ? q.newPrice : q.oldPrice)}</span></div>
            {feeAmt > 0 && (fits || runOver) && <div className="mt-1 flex items-baseline justify-between text-[15px]"><span>On-the-day change fee</span><span>{money(feeAmt)}</span></div>}
            {o.quote !== 'about' && <p className="mt-2 text-[13.5px]" style={{ color: GREEN }}>You only pay for what’s done — never more than this.</p>}
          </div>
          <p className="mt-4 text-[15.5px]" style={{ color: fits || runOver ? INK : AMBER }}>{fits ? `It takes about ${extra} more minutes — until about ${until}.` : ruleText}</p>
          <div className="mt-auto grid gap-2 pt-6">
            <button type="button" disabled={!!busy} onClick={() => answer('yes')} className="h-14 rounded-full text-[17px] font-semibold text-white" style={{ background: GREEN }}>{busy === 'yes' ? 'Saving…' : 'Yes, go ahead'}</button>
            <button type="button" disabled={!!busy} onClick={() => answer('no')} className="h-14 rounded-full border text-[17px]" style={{ borderColor: LINE }}>{busy === 'no' ? 'Saving…' : 'No, keep it as booked'}</button>
            <button type="button" onClick={() => setShow(false)} className="h-10 text-[13.5px]" style={{ color: MUTED }}>Back</button>
            {err && <p className="text-center text-[13px]" style={{ color: RED }}>{err}</p>}
            <p className="text-center text-[12px]" style={{ color: MUTED }}>Your answer is kept with your visit{fits || runOver ? ' and sent to you in writing' : ''}.</p>
          </div>
        </div>
      </div>, document.body)}
    </div>);
}
