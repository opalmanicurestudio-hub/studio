'use client';
// src/components/staff/PayStatement.tsx — A PAY STATEMENT CARD (lib/pay-statement via /api/pay/statement): what someone
// earned in a period, line by line — services, time, overtime, minimum-wage top-ups, extras, tips — and anything that
// still needs fixing (forgotten clock-outs, unapproved shifts). Used in the staff portal (their own, with
// "this week / last pay period / last month") and on Payday (anyone's, for the period on screen).
import * as React from 'react';
import { getAuth } from 'firebase/auth';

type Line = { label: string; detail?: string; amount: number };
type St = { name: string; from: string; to: string; sections: { title: string; lines: Line[] }[]; total: number; tips: number; notes: string[]; hours: number };
const money = (v: number) => `$${(Math.round((v || 0) * 100) / 100).toFixed(2)}`;
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function periods(weekStartsOn = 1) {
  const now = new Date(); const d = new Date(now); d.setHours(0, 0, 0, 0); const back = (d.getDay() - weekStartsOn + 7) % 7; d.setDate(d.getDate() - back);
  const thisWeek = { from: d.toISOString(), to: now.toISOString() };
  const lastStart = new Date(d); lastStart.setDate(d.getDate() - 14); const lastEnd = new Date(d.getTime() - 1);
  const m0 = new Date(now.getFullYear(), now.getMonth() - 1, 1); const m1 = new Date(now.getFullYear(), now.getMonth(), 1); m1.setMilliseconds(-1);
  return [{ key: 'week', label: 'This week', ...thisWeek }, { key: 'last2', label: 'Last two weeks', from: lastStart.toISOString(), to: lastEnd.toISOString() }, { key: 'month', label: 'Last month', from: m0.toISOString(), to: m1.toISOString() }];
}

export function PayStatement({ tenantId, staffId, from, to, weekStartsOn = 1, title = 'Your pay', compact = false }: { tenantId: string; staffId?: string; from?: string; to?: string; weekStartsOn?: number; title?: string; compact?: boolean }) {
  const choices = React.useMemo(() => periods(weekStartsOn), [weekStartsOn]);
  const [pick, setPick] = React.useState('week');
  const range = from && to ? { from, to } : choices.find((c) => c.key === pick) || choices[0];
  const [st, setSt] = React.useState<St | null>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!tenantId) return; let on = true; setBusy(true); setErr('');
    (async () => { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r = await fetch('/api/pay/statement', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, staffId, from: range.from, to: range.to }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection.' }));
      if (!on) return; setBusy(false); if (r.ok) setSt(r.statement); else { setSt(null); setErr(r.error || 'Couldn’t load.'); } })();
    return () => { on = false; }; }, [tenantId, staffId, range.from, range.to]);
  const line = 'var(--line, #e7e2dc)'; const muted = { color: 'var(--muted, #78716c)' };

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4" style={{ border: `1px solid ${line}` }} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-[16px] font-[800]">{title}</p>{st && <p className="text-[12px]" style={muted}>{dayLabel(st.from)} – {dayLabel(st.to)}</p>}</div>
        {!(from && to) && <div className="flex overflow-hidden rounded-full border text-[12px] font-[600]" style={{ borderColor: line }}>
          {choices.map((c) => <button key={c.key} type="button" aria-pressed={pick === c.key} onClick={() => setPick(c.key)} className={`h-9 px-3 ${pick === c.key ? 'bg-[#17181A] text-white' : 'bg-white'}`}>{c.label}</button>)}</div>}
      </div>
      {busy && !st && <p className="text-[13px]" style={muted}>Working it out…</p>}
      {err && <p className="text-[13px] font-[600] text-[#B42318]">{err}</p>}
      {st && (<>
        {st.sections.length === 0 && <p className="text-[13px]" style={muted}>Nothing earned in this period yet.</p>}
        {st.sections.map((sec) => (
          <div key={sec.title} className="space-y-1">
            <p className="text-[12px] font-[700]" style={muted}>{sec.title}</p>
            {sec.lines.slice(0, compact ? 6 : 50).map((l, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="min-w-0"><span className="font-[600]">{l.label}</span>{l.detail && <span style={muted}> · {l.detail}</span>}</span>
                <span className="shrink-0 tabular-nums font-[600]">{money(l.amount)}</span>
              </div>))}
          </div>))}
        <div className="flex items-baseline justify-between border-t pt-2 text-[16px] font-[800]" style={{ borderColor: line }}><span>Total before taxes</span><span className="tabular-nums">{money(st.total)}</span></div>
        <ul className="space-y-0.5">{st.notes.map((n, i) => <li key={i} className="text-[12px]" style={muted}>{n}</li>)}</ul>
      </>)}
    </section>);
}
