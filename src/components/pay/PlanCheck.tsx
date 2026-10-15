'use client';
// THE PAY PLAN CHECK for owners and managers (design canvas "Pay clarity", board 3; lib/pay-clarity-server planCheck).
// Per person: pay per hour before tips and with them, time at work with nothing booked, weeks payroll had to top up to
// minimum wage, and overtime. Then try a plan on everyone it applies to, on their real hours and sales. Nobody's
// private goal, costs or comparisons are ever part of this. Not legal advice.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { payPost, money0 } from '@/components/pay/pay-client';
import { planLabel, type Plan } from '@/lib/pay-clarity';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', INK = 'hsl(var(--foreground))', BG = 'hsl(var(--background))';
const AMBER = '#b45309', GREEN = '#1f7a4d', DARK = '#16171a';
const $2 = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const PRESETS: Plan[] = [{ id: 'g', kind: 'greater_of', rate: 16, pct: 40 }, { id: 't', kind: 'tiered', pct: 40, tiers: [{ over: 6000, pct: 45 }] }, { id: 'hc', kind: 'hourly_commission', rate: 15, pct: 10 }];
const field = 'h-9 w-20 rounded-[10px] border bg-background px-2 text-[13.5px]';

export function PlanCheck() {
  const { selectedTenant } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const [days, setDays] = React.useState(56); const [d, setD] = React.useState<any>(null); const [sim, setSim] = React.useState<Plan | null>(null); const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(async (s: Plan | null) => { setBusy(true); const r = await payPost('/api/pay/plan-check', { tenantId, days, simulate: s }); setBusy(false); setD(r); }, [tenantId, days]);
  React.useEffect(() => { if (tenantId) run(sim); }, [tenantId, days]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="p-8 text-[14px]" style={{ color: MUTED }}>Working it out from everyone’s hours and sales…</p>;
  if (!d.ok) return <p className="p-8 text-[14px]" style={{ color: '#b42318' }}>{d.error || 'That didn’t load.'}</p>;
  const flagged = (d.people || []).filter((p: any) => p.toppedUpAmount > 0);
  const lowUnbooked = (x: any) => x.unbookedShare !== null && x.unbookedShare >= 35;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-8" style={{ color: INK }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[13px]" style={{ color: MUTED }}>Team › Pay</p><h1 className="text-[32px] font-light tracking-[-0.02em]">Pay plan check</h1>
          <p className="text-[13px]" style={{ color: MUTED }}>Minimum wage used: {$2(d.minimumWage)} an hour · Overtime after {d.overtimeHours} hours a week{d.dailyOvertime ? ' and daily overtime' : ''} (Payroll settings)</p></div>
        <div className="flex gap-1.5" role="group" aria-label="How far back">{[[28, '4 weeks'], [56, '8 weeks'], [91, '3 months']].map(([k, l]) => <button key={k} type="button" aria-pressed={days === k} onClick={() => setDays(k as number)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={days === k ? { background: INK, color: BG } : { border: `1px solid ${LINE}` }}>{l}</button>)}</div>
      </div>
      {flagged.map((p: any) => <div key={p.staffId} className="flex flex-wrap items-center gap-3 rounded-[18px] border p-4" style={{ borderColor: AMBER }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: AMBER }} />
        <p className="min-w-0 flex-1 text-[14px]"><b className="font-semibold">{p.toppedUpWeeks ? `${p.toppedUpWeeks} week${p.toppedUpWeeks === 1 ? '' : 's'}` : 'Some weeks'} where {p.name.split(' ')[0]}’s pay before tips came in under minimum wage for their hours.</b> Payroll topped it up ({money0(p.toppedUpAmount)} in all). Worth checking their schedule against their bookings, or their pay plan.</p>
        <span className="text-[12.5px]" style={{ color: MUTED }}>Not legal advice</span></div>)}
      {!d.people?.length && <div className="rounded-[18px] border p-5 text-[14px]" style={{ borderColor: LINE, color: MUTED }}>No clocked hours in this stretch yet. Pay per hour needs the time clock.</div>}
      {d.people?.length > 0 && <div className="overflow-x-auto rounded-[22px] border" style={{ borderColor: LINE }}>
        <table className="w-full min-w-[760px] text-left text-[14px]">
          <thead style={{ background: SOFT, color: MUTED }} className="text-[12.5px]"><tr>{['Person · how they’re paid', 'Per hour, before tips', 'With tips', 'Not booked', 'Topped up to minimum', 'Overtime', ...(d.simulation ? [`With “${d.simulation.label}”`] : [])].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{d.people.map((p: any) => <tr key={p.staffId} style={{ borderTop: `1px solid ${LINE}` }}>
            <td className="px-4 py-3"><b className="font-semibold">{p.name}</b> <span style={{ color: MUTED }}>· {p.plan}</span></td>
            <td className="px-4 py-3" style={p.toppedUpAmount > 0 ? { color: AMBER, fontWeight: 600 } : undefined}>{$2(p.perHourNoTips)}</td>
            <td className="px-4 py-3">{$2(p.perHour)}</td>
            <td className="px-4 py-3" style={lowUnbooked(p) ? { color: AMBER, fontWeight: 600 } : undefined}>{p.unbookedShare === null ? '—' : `${p.unbookedShare}%`}</td>
            <td className="px-4 py-3" style={p.toppedUpAmount > 0 ? { color: AMBER, fontWeight: 600 } : undefined}>{p.toppedUpAmount > 0 ? `${p.toppedUpWeeks ? `${p.toppedUpWeeks} wk · ` : ''}${money0(p.toppedUpAmount)}` : '—'}</td>
            <td className="px-4 py-3">{p.overtimeHours ? `${p.overtimeHours} h` : '—'}</td>
            {d.simulation && <td className="px-4 py-3">{p.simulated ? <span style={{ color: p.simulated.delta > 0 ? GREEN : p.simulated.delta < 0 ? AMBER : MUTED, fontWeight: 600 }}>{p.simulated.delta === 0 ? 'No change' : `${p.simulated.delta > 0 ? '+' : '−'}${money0(Math.abs(p.simulated.delta))}`}</span> : <span style={{ color: MUTED }}>Doesn’t apply</span>}</td>}
          </tr>)}</tbody>
        </table></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-[22px] border bg-card p-5" style={{ borderColor: LINE }}>
          <p className="text-[16px] font-semibold">Try a different plan</p>
          <div className="flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={sim?.id === p.id} onClick={() => { setSim(p); run(p); }} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={sim?.id === p.id ? { background: INK, color: BG } : { border: `1px solid ${LINE}` }}>{planLabel(p)}</button>)}</div>
          {sim && <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
            {['greater_of', 'hourly_commission'].includes(sim.kind) && <label className="flex items-center gap-1">$<input type="number" min={0} value={sim.rate ?? 0} onChange={(e) => setSim({ ...sim, rate: Number(e.target.value) })} aria-label="Per hour" className={field} style={{ borderColor: LINE }} /> an hour</label>}
            <label className="flex items-center gap-1"><input type="number" min={0} max={100} value={sim.pct ?? 0} onChange={(e) => setSim({ ...sim, pct: Number(e.target.value) })} aria-label="Commission" className={field} style={{ borderColor: LINE }} />%</label>
            {sim.kind === 'tiered' && <label className="flex items-center gap-1">then<input type="number" min={0} max={100} value={sim.tiers?.[0]?.pct ?? 0} onChange={(e) => setSim({ ...sim, tiers: [{ over: sim.tiers?.[0]?.over || 0, pct: Number(e.target.value) }] })} aria-label="Higher rate" className={field} style={{ borderColor: LINE }} />% over $<input type="number" min={0} value={sim.tiers?.[0]?.over ?? 0} onChange={(e) => setSim({ ...sim, tiers: [{ pct: sim.tiers?.[0]?.pct || 0, over: Number(e.target.value) }] })} aria-label="Monthly sales line" className="h-9 w-24 rounded-[10px] border bg-background px-2 text-[13.5px]" style={{ borderColor: LINE }} /> a month</label>}
            <button type="button" disabled={busy} onClick={() => run({ ...sim, id: `${sim.id}x` })} className="h-9 rounded-full px-4 text-[13px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>{busy ? 'Working…' : 'Try it'}</button>
            <button type="button" onClick={() => { setSim(null); run(null); }} className="h-9 px-2 text-[12.5px] underline" style={{ color: MUTED }}>Clear</button></div>}
          <p className="text-[12.5px]" style={{ color: MUTED }}>On each person’s real hours and sales for this stretch. Applies to people paid commission; hourly and salaried people stay as they are.</p>
        </section>
        {d.simulation && <section className="space-y-2 rounded-[22px] p-5" style={{ background: DARK, color: '#fff' }}>
          <p className="text-[13px]" style={{ color: '#c9cace' }}>With “{d.simulation.label}”</p>
          <p className="text-[30px] font-light">{d.simulation.delta >= 0 ? '+' : '−'}{money0(Math.abs(d.simulation.delta))} <span className="text-[15px]" style={{ color: '#c9cace' }}>over {Math.round(d.days / 7)} weeks</span></p>
          <p className="text-[14px]">{d.simulation.who.filter((w: any) => w.delta !== 0).map((w: any) => `${w.name} ${w.delta > 0 ? '+' : '−'}${money0(Math.abs(w.delta))}`).join(' · ') || 'No change for anyone.'}</p>
          <p className="text-[12.5px]" style={{ color: '#c9cace' }}>Pay before tips. Payroll works “whichever is more” out week by week, so the real figure can be a little higher.</p>
        </section>}
      </div>
      <p className="text-[12.5px]" style={{ color: MUTED }}>Each person sees only their own numbers in their Pay tab. Their goals, own costs and comparisons stay private to them and are never shown here.</p>
    </div>);
}
export default PlanCheck;
