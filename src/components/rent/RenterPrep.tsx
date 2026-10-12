'use client';
// src/components/rent/RenterPrep.tsx — PART 6, a renter's own Before the visit (design canvas row 26, "before the visit,
// my rules"). Their clients' answers come only to them, and they decide: approve the change (if it fits), keep it as
// booked, ask the client to pick a new time (free), or cancel with no fee. Below: their own rules, and the questions on
// each of their services. /api/portal/renter-prep.
import * as React from 'react';
import { CheckEditor } from '@/components/prep/CheckEditor';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const font = { color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' } as const;
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)}`;
const post = (body: any) => fetch('/api/portal/renter-prep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
const NEEDS = ['answered', 'agreed', 'question', 'safety', 'needs_desk'];

export function RenterPrep({ tenantId, token }: { tenantId: string; token: string }) {
  const [d, setD] = React.useState<any>(null); const [open, setOpen] = React.useState('');
  const load = React.useCallback(() => post({ tenantId, token, action: 'get' }).then(setD), [tenantId, token]);
  React.useEffect(() => { void load(); }, [load]);
  if (!d) return null; if (!d.ok) return <p className="text-[13.5px]" style={{ color: RED }}>{d.error}</p>;
  const S = d.settings; const visits: any[] = d.visits || [];
  const need = visits.filter((v) => v.prep && NEEDS.includes(v.prep.status) && (v.prep.quote?.changed || ['question', 'safety'].includes(v.prep.status)));
  const waiting = visits.filter((v) => !v.prep?.answeredAt && v.prepSentAt);
  const anyOn = (d.services || []).some((s: any) => s.prepCheck?.on);
  const saveS = async (patch: any) => { const r = await post({ tenantId, token, action: 'settings', prep: { ...S, ...patch } }); if (r.ok) setD((x: any) => ({ ...x, settings: r.settings })); };
  const pick = (label: string, value: string, opts: Array<[string, string]>, on: (v: string) => void) => <label className="flex items-center justify-between gap-2 py-2.5 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><span>{label}</span>
    <select value={value} onChange={(e) => on(e.target.value)} className="h-10 max-w-[56%] rounded-[10px] border bg-white px-2 text-[13.5px]" style={{ borderColor: LINE }}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return (
    <section className="space-y-3" style={font} aria-label="Before the visit">
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>my business</p><h2 className="text-[24px] font-light tracking-[-0.02em]">Before the visit</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>A few quick questions before maintenance visits, so you save the right time — and clients see any change and price before they agree.</p></div>
      {need.length > 0 && <div className="space-y-2"><p className="text-[15px] font-semibold">Needs you · {need.length}</p>{need.map((v) => <VisitCard key={v.id} v={v} tenantId={tenantId} token={token} word={S.quote === 'about' ? 'about' : 'up to'} onDone={load} />)}</div>}
      {waiting.length > 0 && <p className="rounded-[14px] px-3.5 py-3 text-[13.5px]" style={{ background: SOFT }}>Not answered yet: {waiting.map((v) => `${v.clientName} (${new Date(v.startTime).toLocaleDateString('en-US', { weekday: 'short' })})`).join(', ')}.{waiting.some((v) => v.suggestion) ? ' If they don’t answer, the weeks since their last visit suggest the service.' : ''}</p>}
      {anyOn && !need.length && !waiting.length && <p className="rounded-[14px] px-3.5 py-3 text-[13.5px]" style={{ background: '#e9f3ed', color: GREEN }}>Nothing needs you right now.</p>}
      <div className="rounded-[18px] border bg-white px-4 pb-1 pt-3" style={{ borderColor: LINE }}>
        <p className="pb-1 text-[15px] font-semibold">My rules</p>
        {pick('The price clients see', S.quote, [['upto', 'Up to'], ['about', 'About']], (v) => saveS({ quote: v }))}
        {pick('Deposit when the price rises', S.topUp.mode, [['off', 'Keep it'], ['percent', 'Keep it 25% of the price'], ['over', 'Top up over $20 more']], (v) => saveS({ topUp: v === 'percent' ? { mode: 'percent', pct: S.topUp.pct || 25, overCents: 0 } : v === 'over' ? { mode: 'over', overCents: S.topUp.overCents || 2000, pct: 0 } : { mode: 'off', overCents: 0, pct: 0 } }))}
        {pick('More to do on the day', S.onDay, [['fit_rebook', 'Do what fits, book the rest'], ['extend_or_move', 'Extend if free, else move'], ['provider', 'I decide']], (v) => saveS({ onDay: v }))}
        {pick('On-the-day fee', String(S.onDayFeeCents), [['0', 'None'], ['1000', '$10'], ['1500', '$15'], ['2500', '$25']], (v) => saveS({ onDayFeeCents: Number(v) }))}
        {pick('Small changes that fit', String(S.autoMinutes), [['0', 'I approve every one'], ['15', 'Approve up to 15 min'], ['30', 'Approve up to 30 min']], (v) => saveS({ autoMinutes: Number(v) }))}
      </div>
      <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
        <p className="px-4 pt-3 text-[15px] font-semibold">Questions on my services</p>
        {(d.services || []).map((s: any) => <div key={s.id} style={{ borderTop: `1px solid ${LINE}` }}>
          <button type="button" onClick={() => setOpen(open === s.id ? '' : s.id)} className="flex w-full items-center justify-between px-4 py-3 text-left"><span><span className="block text-[14.5px] font-semibold">{s.name}</span><span className="block text-[12.5px]" style={{ color: MUTED }}>{s.prepCheck?.on ? `${(s.prepCheck.questions || []).length} question${(s.prepCheck.questions || []).length === 1 ? '' : 's'}` : 'No questions'}</span></span>
            <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={s.prepCheck?.on ? { background: '#e9f3ed', color: GREEN } : { background: SOFT, color: MUTED }}>{s.prepCheck?.on ? 'On' : 'Off'}</span></button>
          {open === s.id && <CheckEditor key={s.id} service={s} services={d.services} tenant={null} S={S} canEdit renter addOnPool={(d.services || []).filter((x: any) => x.id !== s.id)}
            onSave={async (check) => { const r = await post({ tenantId, token, action: 'check', serviceId: s.id, check }); if (!r.ok) throw new Error(r.error); setOpen(''); await load(); }} />}
        </div>)}
        {!(d.services || []).length && <p className="px-4 pb-4 text-[13.5px]" style={{ color: MUTED }}>Add your services first.</p>}
      </div>
      <p className="flex items-start gap-2 rounded-[14px] px-3.5 py-3 text-[13px] leading-[1.45]" style={{ background: '#efe6f3', color: '#4d2d5a' }}>Your clients’ answers and your decisions come only to you. Your prices and fees are yours.</p>
    </section>);
}

function VisitCard({ v, tenantId, token, word, onDone }: { v: any; tenantId: string; token: string; word: string; onDone: () => void }) {
  const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState(''); const [sure, setSure] = React.useState(false);
  const p = v.prep || {}; const q = p.quote;
  const go = async (decision: string) => { setBusy(decision); setMsg(''); const r = await post({ tenantId, token, action: 'decide', appointmentId: v.id, decision }); setBusy(''); if (r.ok) { setMsg(decision === 'cancel' && r.depositToRefund ? `Cancelled — refund their ${money(r.depositToRefund / 100)} deposit.` : 'Done — they’ve been told.'); setTimeout(onDone, 900); } else setMsg(r.error || 'That didn’t work.'); };
  const btn = (label: string, decision: string, solid = false) => <button type="button" disabled={!!busy} onClick={() => go(decision)} className="h-10 rounded-full px-3.5 text-[13.5px] font-semibold disabled:opacity-40" style={solid ? { background: INK, color: '#fff' } : { background: SOFT }}>{busy === decision ? '…' : label}</button>;
  const when = new Date(v.startTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return (<div className="space-y-2 rounded-[18px] border bg-white p-3.5" style={{ borderColor: p.status === 'safety' ? '#f4c7c3' : LINE }}>
    <p className="text-[14.5px] font-semibold">{v.clientName} · {when} <span className="font-normal" style={{ color: MUTED }}>· {v.serviceName}</span></p>
    {p.status === 'safety' && <p className="rounded-[12px] px-3 py-2 text-[13.5px]" style={{ background: '#fdecec', color: '#7a1d14' }}>A safety answer — talk to them before anything else. Moving it is free.</p>}
    {q?.changed && p.status !== 'safety' && <p className="rounded-[12px] px-3 py-2 text-[13.5px]" style={{ background: '#fdf3e6', color: '#7a3e05' }}><b>{(q.lines || []).join(' · ')}</b>{q.newPrice !== q.oldPrice ? ` · ${money(q.oldPrice)} → ${word} ${money(q.newPrice)}` : ''}</p>}
    {p.question && <p className="rounded-[12px] px-3 py-2 text-[13.5px]" style={{ background: SOFT }}>“{p.question}”</p>}
    {p.photos?.length > 0 && <div className="flex gap-1.5">{p.photos.map((u: string) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-14 w-14 rounded-[12px] object-cover" /></a>)}</div>}
    {q?.changed && p.status !== 'safety' && <p className="text-[13px]" style={{ color: p.fits ? GREEN : AMBER }}>{p.fits ? `Fits${p.freeMinutes ? ` — ${p.freeMinutes} min free after` : ''}; the time is held.` : 'Doesn’t fit after this visit.'}</p>}
    <div className="flex flex-wrap gap-1.5">
      {q?.changed && p.fits && p.status !== 'safety' && btn('Approve', 'approve', true)}
      {p.status !== 'safety' && q?.changed && btn('Ask them to pick a new time', 'move', !p.fits)}
      {btn('Keep as booked', 'keep')}
      {!sure ? <button type="button" disabled={!!busy} onClick={() => setSure(true)} className="h-10 rounded-full px-3.5 text-[13.5px]" style={{ background: SOFT, color: RED }}>Cancel — no fee</button>
        : <button type="button" disabled={!!busy} onClick={() => go('cancel')} className="h-10 rounded-full px-3.5 text-[13.5px] font-semibold text-white" style={{ background: RED }}>{busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it'}</button>}
    </div>
    {msg && <p className="text-[13px]" style={{ color: msg.startsWith('Done') || msg.startsWith('Cancelled') ? GREEN : RED }}>{msg}</p>}
  </div>);
}
