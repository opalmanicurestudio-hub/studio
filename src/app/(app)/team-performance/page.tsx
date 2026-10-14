'use client';
// src/app/(app)/team-performance/page.tsx — TEAM PERFORMANCE (approved design, Staff Portal Directions canvas S "Manager ·
// Team performance" and "Book a one-on-one"). The team's numbers against the business's goals, each person's row with
// twelve weeks of revenue, a flag where a number keeps slipping, and one-on-ones: book one (on both schedules; it blocks
// booking), the agenda started from their numbers and last time's next steps, and close it with notes and next steps.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';
import { towardGoal, type TeamGoals } from '@/lib/staff-kpis';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', ACC = '#2e6b66', DOWN = '#9a5b00', AMBER = '#b45309', RED = '#b42318', GREEN = '#1f7a4d';
const money = (n: number | null) => (n === null ? '—' : n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2).replace(/\.00$/, '')}`);
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

export default function TeamPerformance() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || ''; const tz = selectedTenant?.timezone || 'America/New_York';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [d, setD] = React.useState<any>(null); const [goalsOpen, setGoalsOpen] = React.useState(false); const [who, setWho] = React.useState<any>(null);
  const load = React.useCallback(() => (tenantId ? payPost('/api/team/kpis', { tenantId, action: 'team' }).then(setD) : null), [tenantId]);
  React.useEffect(() => { void load(); }, [load]);
  if (!manager) return <div className="p-8"><AppHeader title="Team performance" /><p className="mt-6" style={{ color: MUTED }}>Only managers see the team’s numbers. Your own are in the staff app under Me → My numbers.</p></div>;
  const g: TeamGoals | null = d?.goals || null;
  const tile = (label: string, goal: string, value: string, bar: number, change: string | null, up: boolean) => (
    <div className="flex flex-col gap-1.5 rounded-[18px] border bg-card p-3" style={{ borderColor: LINE }}>
      <div className="flex justify-between text-[12px]" style={{ color: MUTED }}><span>{label}</span><span>{goal}</span></div>
      <div className="text-[22px] font-extrabold tracking-[-0.02em]">{value}</div>
      <div className="h-1.5 rounded-full" style={{ background: '#f0f0f2' }}><div className="h-1.5 rounded-full" style={{ width: `${bar}%`, background: ACC }} /></div>
      {change && <div className="text-[12px] font-bold" style={{ color: up ? ACC : DOWN }}>{change}</div>}
    </div>);
  const ch = (a: number | null, b: number | null, unit: 'pts' | '$', lowerBetter = false) => { if (a === null || b === null) return [null, true] as const; const v = Math.round((a - b) * 100) / 100; if (!v) return ['same', true] as const;
    return [`${v > 0 ? '▲' : '▼'} ${unit === '$' ? money(Math.abs(v)) : `${Math.abs(Math.round(v * 10) / 10)} ${Math.abs(Math.round(v * 10) / 10) === 1 ? 'pt' : 'pts'}`}`, lowerBetter ? v < 0 : v > 0] as const; };
  return (
    <div className="min-h-full p-4 md:p-8" style={{ color: INK }}>
      <AppHeader title="Team performance" />
      <div className="mx-auto mt-4 max-w-[1180px] space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[30px] font-light tracking-[-0.02em]">Team performance</h1><p className="text-[14px]" style={{ color: MUTED }}>Last 30 days, against the 30 before · renters aren’t included — their business is their own</p></div>
          <button type="button" onClick={() => setGoalsOpen((x) => !x)} className="h-10 rounded-full border bg-card px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>{goalsOpen ? 'Close goals' : 'Goals'}</button></div>
        {goalsOpen && g && <Goals tenantId={tenantId} g={g} onSaved={() => { setGoalsOpen(false); void load(); }} />}
        {!d && <p style={{ color: MUTED }}>Working out the numbers…</p>}
        {d && !d.ok && <p style={{ color: RED }}>{d.error}</p>}
        {d?.ok && g && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(() => { const [c, u] = ch(d.cur.rebookPct, d.prev.rebookPct, 'pts'); return tile('Team rebook', `goal ${g.rebookPct}%`, pct(d.cur.rebookPct), towardGoal('rebookPct', d.cur.rebookPct, g), c, u); })()}
            {(() => { const [c, u] = ch(d.cur.avgVisit, d.prev.avgVisit, '$'); return tile('Average visit', `goal $${g.avgVisit}`, money(d.cur.avgVisit), towardGoal('avgVisit', d.cur.avgVisit, g), c, u); })()}
            {(() => { const [c, u] = ch(d.cur.retailPerVisit, d.prev.retailPerVisit, '$'); return tile('Retail per visit', `goal $${g.retailPerVisit}`, money(d.cur.retailPerVisit), towardGoal('retailPerVisit', d.cur.retailPerVisit, g), c, u); })()}
            {(() => { const [c, u] = ch(d.cur.redoPct, d.prev.redoPct, 'pts', true); return tile('Redos', `goal under ${g.redoPctMax}%`, pct(d.cur.redoPct), towardGoal('redoPctMax', d.cur.redoPct, g), c, u); })()}
          </div>
          <div className="overflow-x-auto rounded-[18px] border bg-card" style={{ borderColor: LINE }}>
            <table className="w-full min-w-[860px] text-[14px]"><thead><tr className="text-left text-[12px]" style={{ color: MUTED, background: 'hsl(var(--secondary))' }}>
              {['Team member', 'Revenue', 'Visits', 'Rebook', 'Avg visit', 'Retail/visit', 'Redos', '12 weeks', ''].map((h) => <th key={h} className="px-4 py-2.5 font-bold">{h}</th>)}</tr></thead>
              <tbody>{d.people.map((p: any) => { const max = Math.max(1, ...p.weeks); return (
                <tr key={p.staffId} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="px-4 py-3 font-bold">{p.name}{p.topics.length > 0 && <span title={p.topics.join(' · ')} style={{ color: AMBER }}> ⚠</span>}</td>
                  <td className="px-4">{money(p.cur.revenue)}</td><td className="px-4">{p.cur.visits}</td><td className="px-4">{pct(p.cur.rebookPct)}</td><td className="px-4">{money(p.cur.avgVisit)}</td><td className="px-4">{money(p.cur.retailPerVisit)}</td><td className="px-4">{p.cur.redos}</td>
                  <td className="px-4"><span className="flex h-6 items-end gap-[2px]" aria-label={`Weekly revenue, last 12 weeks: ${p.weeks.map((w: number) => Math.round(w)).join(', ')}`}>{p.weeks.map((w: number, i: number) => <span key={i} className="w-[5px] rounded-[2px]" style={{ height: `${Math.max(2, Math.round((w / max) * 22))}px`, background: `${ACC}66` }} />)}</span></td>
                  <td className="px-4 text-right"><button type="button" onClick={() => setWho(p)} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: SOFT }}>One-on-one</button></td>
                </tr>); })}</tbody></table>
            {!d.people.length && <p className="p-5 text-[14px]" style={{ color: MUTED }}>No finished visits in the last 12 weeks yet.</p>}
          </div>
          {d.people.filter((p: any) => p.topics.length).slice(0, 4).map((p: any) => <p key={p.staffId} className="text-[13px]" style={{ color: MUTED }}><span style={{ color: AMBER }}>⚠</span> {p.name.split(' ')[0]}: {p.topics[0]} — a topic for a one-on-one.</p>)}
        </>}
      </div>
      {who && <OneOnOne tenantId={tenantId} tz={tz} p={who} onClose={() => setWho(null)} />}
    </div>);
}

function Goals({ tenantId, g, onSaved }: { tenantId: string; g: TeamGoals; onSaved: () => void }) {
  const [v, setV] = React.useState<TeamGoals>(g); const [busy, setBusy] = React.useState(false);
  const f = (k: keyof TeamGoals, label: string, prefix = '', suffix = '') => <label className="flex items-center justify-between gap-2 text-[14px]"><span>{label}</span><span className="inline-flex items-center gap-1.5">{prefix && <span style={{ color: MUTED }}>{prefix}</span>}
    <input type="number" min={0} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) || 0 })} className="h-10 w-20 rounded-[10px] border bg-card px-2 text-center text-[14px]" style={{ borderColor: LINE }} aria-label={label} />{suffix && <span style={{ color: MUTED }}>{suffix}</span>}</span></label>;
  return (<div className="grid gap-3 rounded-[18px] border bg-card p-4 md:grid-cols-3" style={{ borderColor: LINE }}>
    {f('rebookPct', 'Rebooked', '', '%')}{f('avgVisit', 'Average visit', '$')}{f('retailPerVisit', 'Retail per visit', '$')}{f('chairPct', 'Chair time used', '', '%')}{f('onTimePct', 'On time', '', '%')}{f('redoPctMax', 'Redos under', '', '%')}
    <div className="md:col-span-3"><button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await payPost('/api/team/kpis', { tenantId, action: 'goals', goals: v }); setBusy(false); if (r.ok) onSaved(); }} className="h-10 rounded-full px-5 text-[14px] font-semibold text-background" style={{ background: INK }}>{busy ? 'Saving…' : 'Save goals'}</button>
      <span className="ml-3 text-[12.5px]" style={{ color: MUTED }}>Everyone sees their own numbers against these.</span></div>
  </div>);
}

function OneOnOne({ tenantId, tz, p, onClose }: { tenantId: string; tz: string; p: any; onClose: () => void }) {
  const first = String(p.name).split(' ')[0];
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: tz });
  const [date, setDate] = React.useState(tomorrow); const [time, setTime] = React.useState('10:00'); const [minutes, setMinutes] = React.useState(30);
  const [agenda, setAgenda] = React.useState<any[]>([]); const [topic, setTopic] = React.useState(''); const [staffCanAdd, setStaffCanAdd] = React.useState(true);
  const [items, setItems] = React.useState<any[]>([]); const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState('');
  const [closing, setClosing] = React.useState<any>(null); const [notes, setNotes] = React.useState(''); const [steps, setSteps] = React.useState('');
  const refresh = React.useCallback(() => payPost('/api/team/kpis', { tenantId, action: 'list', staffId: p.staffId }).then((r) => setItems(r.ok ? r.items : [])), [tenantId, p.staffId]);
  React.useEffect(() => { payPost('/api/team/kpis', { tenantId, action: 'agenda', staffId: p.staffId }).then((r) => setAgenda(r.ok ? r.agenda : [])); void refresh(); }, [tenantId, p.staffId, refresh]);
  // The chosen local time in the business's time zone → an exact moment.
  const startIso = () => { const guess = Date.parse(`${date}T${time}:00Z`); const off = new Date(guess).getTime() - Date.parse(new Date(guess).toLocaleString('en-US', { timeZone: tz }) + ' UTC'); return new Date(guess + off).toISOString(); };
  const book = async () => { setBusy('book'); setMsg(''); const r = await payPost('/api/team/kpis', { tenantId, action: 'book', staffId: p.staffId, startTime: startIso(), minutes, agenda, staffCanAdd }); setBusy(''); if (r.ok) { setMsg(`Booked — ${first} has been told.`); void refresh(); } else setMsg(r.error || 'That didn’t book.'); };
  const close = async (cancel = false) => { setBusy('close'); const r = await payPost('/api/team/kpis', { tenantId, action: 'close', id: closing.id, notes, nextSteps: steps.split('\n'), cancel }); setBusy(''); if (r.ok) { setClosing(null); setNotes(''); setSteps(''); void refresh(); } };
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const tag = (s: string) => s === 'numbers' ? { t: 'FROM NUMBERS', bg: '#fdf6ea', fg: DOWN } : s === 'last' ? { t: 'LAST TIME', bg: SOFT, fg: MUTED } : s === 'staff' ? { t: first.toUpperCase(), bg: '#e6ecf7', fg: '#3d5a99' } : { t: 'YOU', bg: SOFT, fg: INK };
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`One-on-one with ${first}`} style={{ background: 'rgba(22,23,26,.35)' }} onClick={onClose}>
      <div className="h-full w-full max-w-[480px] space-y-4 overflow-y-auto bg-card p-5" onClick={(e) => e.stopPropagation()} style={{ color: INK }}>
        <div className="flex items-center justify-between"><h2 className="text-[20px] font-extrabold">One-on-one with {first}</h2><button type="button" onClick={onClose} className="text-[14px]" style={{ color: MUTED }}>Close</button></div>
        <div className="grid grid-cols-3 gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" className="h-12 rounded-[14px] border px-3 text-[15px]" style={{ borderColor: 'hsl(var(--border))' }} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="h-12 rounded-[14px] border px-3 text-[15px]" style={{ borderColor: 'hsl(var(--border))' }} />
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="How long" className="h-12 rounded-[14px] border bg-card px-2 text-[15px]" style={{ borderColor: 'hsl(var(--border))' }}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
        </div>
        <p className="text-[12px]" style={{ color: MUTED }}>It goes on both schedules and blocks booking for you both. If either of you is busy, it says so.</p>
        <p className="text-[13px] font-bold" style={{ color: MUTED }}>Agenda</p>
        <div className="space-y-1.5">{agenda.map((a) => { const t = tag(a.source); return (
          <div key={a.id} className="flex items-center gap-2.5 rounded-[14px] px-3 py-2.5" style={{ background: t.bg }}><span className="text-[11px] font-extrabold" style={{ color: t.fg }}>{t.t}</span><span className="flex-1 text-[14px]">{a.text}</span>
            <button type="button" aria-label="Remove topic" onClick={() => setAgenda((x) => x.filter((y) => y.id !== a.id))} className="text-[16px]" style={{ color: MUTED }}>×</button></div>); })}
          <div className="flex gap-2"><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="+ Add a topic" aria-label="Add a topic" className="h-11 min-w-0 flex-1 rounded-[14px] border border-dashed px-3 text-[14px]" style={{ borderColor: 'hsl(var(--border))' }} />
            <button type="button" disabled={!topic.trim()} onClick={() => { setAgenda((x) => [...x, { id: Math.random().toString(36).slice(2, 9), text: topic.trim(), source: 'manager' }]); setTopic(''); }} className="h-11 rounded-[14px] px-3.5 text-[14px] font-semibold disabled:opacity-40" style={{ background: SOFT }}>Add</button></div></div>
        <label className="flex items-center justify-between text-[15px]"><span>{first} can add topics too</span><input type="checkbox" checked={staffCanAdd} onChange={(e) => setStaffCanAdd(e.target.checked)} className="h-5 w-5" /></label>
        <button type="button" disabled={!!busy} onClick={book} className="h-12 w-full rounded-[16px] text-[16px] font-bold text-background" style={{ background: INK }}>{busy === 'book' ? 'Booking…' : `Book and tell ${first}`}</button>
        {msg && <p className="text-[13.5px]" style={{ color: msg.startsWith('Booked') ? GREEN : RED }}>{msg}</p>}
        {items.length > 0 && <div className="space-y-2 border-t pt-4" style={{ borderColor: LINE }}><p className="text-[15px] font-bold">Earlier and upcoming</p>
          {items.map((o) => <div key={o.id} className="space-y-1 rounded-[14px] border p-3 text-[13.5px]" style={{ borderColor: LINE }}>
            <div className="flex items-center justify-between"><span className="font-semibold">{when(o.startTime)}</span><span className="text-[12px] font-semibold" style={{ color: o.status === 'done' ? GREEN : o.status === 'cancelled' ? MUTED : '#3d5a99' }}>{o.status === 'done' ? 'Done' : o.status === 'cancelled' ? 'Cancelled' : 'Booked'}</span></div>
            {(o.agenda || []).length > 0 && <p style={{ color: MUTED }}>{o.agenda.map((a: any) => a.text).join(' · ')}</p>}
            {o.notes && <p>{o.notes}</p>}
            {(o.nextSteps || []).length > 0 && <p><b>Next:</b> {o.nextSteps.map((x: any) => x.text).join(' · ')}</p>}
            {o.status === 'booked' && (closing?.id === o.id ? <div className="space-y-2 pt-1">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What you talked about" aria-label="Notes" className="w-full rounded-[12px] border p-2.5 text-[14px]" style={{ borderColor: LINE }} />
              <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={2} placeholder="Next steps, one per line — they come back next time" aria-label="Next steps" className="w-full rounded-[12px] border p-2.5 text-[14px]" style={{ borderColor: LINE }} />
              <div className="flex gap-2"><button type="button" disabled={!!busy} onClick={() => close(false)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold text-background" style={{ background: INK }}>Save and close</button><button type="button" disabled={!!busy} onClick={() => close(true)} className="h-10 rounded-full px-4 text-[13.5px]" style={{ background: SOFT, color: RED }}>Cancel it</button></div></div>
              : <button type="button" onClick={() => { setClosing(o); setNotes(''); setSteps(''); }} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: SOFT }}>Add notes and close</button>)}
          </div>)}</div>}
      </div>
    </div>);
}
