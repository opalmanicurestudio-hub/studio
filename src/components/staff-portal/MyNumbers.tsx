'use client';
// src/components/staff-portal/MyNumbers.tsx — STAFF APP → Me → My numbers (approved design, Staff Portal Directions
// canvas S "Staff · My numbers"). Six tiles against the business's goals (last 30 days, with the change from the 30
// before), the next one-on-one with its agenda — and a place to add a topic if the manager allowed it. Only the person
// and managers see these. /api/team/kpis.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { towardGoal } from '@/lib/staff-kpis';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', DOWN = '#9a5b00';
const money = (n: number) => (n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2).replace(/\.00$/, '')}`);

export function MyNumbers({ tenantId, accent = '#2e6b66', tz, onBack }: { tenantId: string; accent?: string; tz?: string; onBack: () => void }) {
  const [d, setD] = React.useState<any>(null); const [topic, setTopic] = React.useState(''); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(() => payPost('/api/team/kpis', { tenantId, action: 'mine' }).then(setD), [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  const back = <button type="button" onClick={onBack} className="text-[14px]" style={{ color: MUTED }}>‹ Me</button>;
  if (!d) return <div className="space-y-3">{back}<p className="text-[14px]" style={{ color: MUTED }}>Loading your numbers…</p></div>;
  if (!d.ok) return <div className="space-y-3">{back}<p className="text-[14px]" style={{ color: '#b42318' }}>{d.error}</p></div>;
  const { cur, prev, goals: g, next } = d; const fu = d.followUps;
  const delta = (a: number | null, b: number | null, unit: 'pts' | '$' | '', better = 1) => { if (a === null || b === null) return null; const v = Math.round((a - b) * (unit === '$' ? 100 : 10)) / (unit === '$' ? 100 : 10); if (!v) return { t: 'same as before', up: true };
    const up = v * better > 0; return { t: `${v > 0 ? '▲' : '▼'} ${unit === '$' ? money(Math.abs(v)) : Math.abs(v)}${unit === 'pts' ? (Math.abs(v) === 1 ? ' pt' : ' pts') : ''}`, up }; };
  const tiles = [
    { label: 'Rebooked', goal: `goal ${g.rebookPct}%`, value: cur.rebookPct === null ? '—' : `${cur.rebookPct}%`, bar: towardGoal('rebookPct', cur.rebookPct, g), d: delta(cur.rebookPct, prev.rebookPct, 'pts') },
    { label: 'Average visit', goal: `goal $${g.avgVisit}`, value: cur.avgVisit === null ? '—' : money(cur.avgVisit), bar: towardGoal('avgVisit', cur.avgVisit, g), d: delta(cur.avgVisit, prev.avgVisit, '$') },
    { label: 'Retail per visit', goal: `goal $${g.retailPerVisit}`, value: cur.retailPerVisit === null ? '—' : money(cur.retailPerVisit), bar: towardGoal('retailPerVisit', cur.retailPerVisit, g), d: delta(cur.retailPerVisit, prev.retailPerVisit, '$') },
    { label: 'Chair time used', goal: `goal ${g.chairPct}%`, value: cur.chairPct === null ? '—' : `${cur.chairPct}%`, bar: towardGoal('chairPct', cur.chairPct, g), d: delta(cur.chairPct, prev.chairPct, 'pts') },
    { label: 'On time', goal: `goal ${g.onTimePct}%`, value: cur.onTimePct === null ? '—' : `${cur.onTimePct}%`, bar: towardGoal('onTimePct', cur.onTimePct, g), d: delta(cur.onTimePct, prev.onTimePct, 'pts') },
    { label: 'Reviews', goal: cur.reviews ? `${cur.reviews} new` : 'none yet', value: cur.rating === null ? '—' : `${cur.rating} ★`, bar: cur.rating ? Math.round((cur.rating / 5) * 100) : 0, d: delta(cur.rating, prev.rating, '') },
  ];
  const when = next ? new Date(next.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '';
  const add = async () => { if (!topic.trim() || !next) return; setMsg(''); const r = await payPost('/api/team/kpis', { tenantId, action: 'topic', id: next.id, text: topic }); if (r.ok) { setTopic(''); void load(); } else setMsg(r.error || 'That didn’t save.'); };
  return (
    <div className="space-y-3.5" style={{ color: INK }}>
      {back}
      <div className="flex items-center justify-between"><h2 className="text-[24px] font-bold">My numbers</h2><span className="rounded-full px-3 py-1.5 text-[13px] font-semibold" style={{ background: '#f4f4f5' }}>Last 30 days</span></div>
      {cur.visits === 0 && <p className="rounded-[16px] p-3.5 text-[14px]" style={{ background: '#f4f4f5', color: MUTED }}>No finished visits in the last 30 days yet — your numbers start with your first.</p>}
      <div className="grid grid-cols-2 gap-2">{tiles.map((t) => (
        <div key={t.label} className="flex flex-col gap-1.5 rounded-[18px] border p-3" style={{ borderColor: LINE }}>
          <div className="flex justify-between text-[12px]" style={{ color: MUTED }}><span>{t.label}</span><span>{t.goal}</span></div>
          <div className="text-[22px] font-extrabold tracking-[-0.02em]">{t.value}</div>
          <div className="h-1.5 rounded-full" style={{ background: '#f0f0f2' }}><div className="h-1.5 rounded-full" style={{ width: `${t.bar}%`, background: accent }} /></div>
          {t.d && <div className="text-[12px] font-bold" style={{ color: t.d.up ? accent : DOWN }}>{t.d.t}</div>}
        </div>))}</div>
      {fu && (fu.visits > 0 || fu.booked > 0 || fu.open > 0) && <div className="space-y-1.5 rounded-[18px] border p-3.5" style={{ borderColor: LINE }}>
        <div className="flex items-baseline justify-between"><p className="text-[14px] font-extrabold">From your follow-ups</p><span className="text-[12px]" style={{ color: MUTED }}>{fu.open} open</span></div>
        <p className="text-[22px] font-extrabold tracking-[-0.02em]" style={{ color: '#1f7a4d' }}>{money(fu.paidCents / 100)}</p>
        <p className="text-[12.5px]" style={{ color: MUTED }}>{fu.visits} visit{fu.visits === 1 ? '' : 's'} paid{fu.recovered ? ` · ${fu.recovered} won back after a cancellation` : ''}{fu.booked ? ` · ${fu.booked} booked, counted once paid` : ''}</p>
        {fu.bonusOn && <p className="text-[12.5px]"><b>Bonus this month:</b> {money(fu.bonusCents / 100)} <span style={{ color: MUTED }}>(on your pay as its own line)</span></p>}
      </div>}
      {next ? <div className="space-y-2 rounded-[20px] border p-3.5" style={{ background: `${accent}0f`, borderColor: `${accent}1f` }}>
        <p className="text-[13px] font-extrabold" style={{ color: accent }}>Your next one-on-one</p>
        <p className="text-[16px] font-extrabold">{when} with {String(next.managerName || 'your manager').split(' ')[0]}</p>
        {(next.agenda || []).length > 0 && <ul className="space-y-1 text-[13.5px]" style={{ color: '#55585e' }}>{next.agenda.map((a: any) => <li key={a.id}>• {a.text}</li>)}</ul>}
        {next.staffCanAdd && <div className="flex gap-2 pt-1"><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Add something you want to talk about" aria-label="Add a topic" className="h-11 min-w-0 flex-1 rounded-[14px] border bg-white px-3 text-[14px]" style={{ borderColor: LINE }} />
          <button type="button" onClick={add} disabled={!topic.trim()} className="h-11 rounded-[14px] px-4 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>Add</button></div>}
        {msg && <p className="text-[13px]" style={{ color: '#b42318' }}>{msg}</p>}
      </div> : <p className="text-[13.5px]" style={{ color: MUTED }}>No one-on-one booked. Your manager books them from Team performance.</p>}
      <p className="text-[13px]" style={{ color: MUTED }}>Only you and managers see your numbers.</p>
    </div>);
}
