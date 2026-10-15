'use client';
// "What my time is worth" (design canvas "Pay clarity", boards 1, 2 and 4): what someone really earns per hour at work —
// with and without tips, and after the costs they pay themselves — where the money came from, booked vs unbooked time,
// period by period, a goal, and the same hours and sales paid other ways (including working for yourself). Their goal,
// costs and comparisons are private to them (/api/pay/clarity, lib/pay-clarity-server). Before tax throughout.
import * as React from 'react';
import { payPost, money0, dshort } from '@/components/pay/pay-client';
import { planPay, planLabel, breakEvenSales, type Plan, type Cost } from '@/lib/pay-clarity';
import { CONTRACTOR_QUESTIONS, contractorLean } from '@/lib/pay-extras';

const MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', INK = 'hsl(var(--foreground))', BG = 'hsl(var(--background))';
const GREEN = '#1f7a4d', AMBER = '#b45309', MINT = '#7fd1a5', DARK = '#16171a';
const SRC_COLOR: Record<string, string> = { services: DARK, tips: MINT, retail: '#6d7075', time: '#a9abb0', other: '#d6d7da', adjustments: GREEN };
const $2 = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const rid = () => Math.random().toString(36).slice(2, 9);
const card = 'rounded-[22px] border bg-card p-5';
const field = 'h-10 rounded-[10px] border bg-background px-3 text-[14px]';
const KINDS: [Plan['kind'], string][] = [['hourly', 'Hourly'], ['commission', 'Commission'], ['hourly_commission', 'Hourly + commission'], ['greater_of', 'Hourly or commission, whichever is more'], ['salary', 'Salary'], ['draw', 'Commission with a weekly advance'], ['self', 'Working for myself']];

export function PayClarity({ tenantId }: { tenantId: string }) {
  const [range, setRange] = React.useState('4w'); const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [priv, setPriv] = React.useState<any>(null); const [saving, setSaving] = React.useState(''); const [adding, setAdding] = React.useState<Plan | null>(null);
  const load = React.useCallback(async () => { setD(null); const r = await payPost('/api/pay/clarity', { tenantId, action: 'mine', range }); if (r?.ok) { setD(r); setPriv(r.private); setErr(''); } else setErr(r?.error || 'Couldn’t load your pay.'); }, [tenantId, range]);
  React.useEffect(() => { load(); }, [load]);
  const save = async (next: any, why: string) => { setSaving(why); const r = await payPost('/api/pay/clarity', { tenantId, action: 'save', ...next }); setSaving(''); if (r?.ok) { setPriv(r.private); load(); } else setErr(r?.error || 'That didn’t save.'); };
  if (err) return <p role="alert" className="rounded-[16px] border px-4 py-3 text-[14px]" style={{ borderColor: '#b42318', color: '#b42318' }}>{err}</p>;
  if (!d || !priv) return <div className="h-[220px] animate-pulse rounded-[22px]" style={{ background: SOFT }} aria-busy="true" />;
  const c = d.clarity; const has = c.hours > 0;
  const plans: Plan[] = priv.plans || []; const editPlans = (list: Plan[]) => save({ ...priv, plans: list }, 'plans');
  const total = c.sources.reduce((s: number, x: any) => s + Math.max(0, x.amount), 0) || 1;
  const perVals = c.trend.map((x: any) => x.perHour || 0).filter((v: number) => v > 0); const maxPer = Math.max(1, ...perVals); const minPer = perVals.length ? Math.min(...perVals) * 0.8 : 0;
  const barH = (v: number | null) => (v ? 18 + ((v - minPer) / Math.max(0.01, maxPer - minPer)) * 78 : 4);
  const selfPlan = (d.compare || []).find((x: any) => x.plan.kind === 'self');
  const be = selfPlan && d.basis ? breakEvenSales(selfPlan.plan, { id: 'now', ...d.payNow }, d.basis) : null;
  const best = (d.compare || []).reduce((m: any, x: any) => (!m || x.beforeIncomeTax > m.beforeIncomeTax ? x : m), null);
  const nowRow = (d.compare || [])[0];
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[13px]" style={{ color: MUTED }}>{c.days ? `Pay · ${dshort(d.periods[d.periods.length - 1]?.from)} – ${dshort(d.periods[0]?.to)}` : 'Pay'}</p><h2 className="text-[28px] font-light tracking-[-0.02em]">What my time is worth</h2></div>
        <div className="flex gap-1.5" role="group" aria-label="How far back">{[['4w', '4 weeks'], ['3m', '3 months'], ['1y', 'This year']].map(([k, l]) => <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={range === k ? { background: INK, color: BG } : { border: `1px solid ${LINE}` }}>{l}</button>)}</div>
      </div>
      {d.seasonality && <p className="rounded-[14px] px-4 py-2.5 text-[13.5px]" style={{ background: SOFT }}>{d.seasonality}</p>}
      {!has && <div className={card} style={{ borderColor: LINE }}><p className="text-[14px]" style={{ color: MUTED }}>No clocked hours in this stretch yet, so there’s nothing to divide by. Once you clock in and out, your real pay per hour shows here.</p></div>}
      {has && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 rounded-[22px] p-5" style={{ background: DARK, color: '#fff' }}>
            <p className="text-[13px]" style={{ color: '#c9cace' }}>Per hour at work</p>
            <p className="text-[42px] font-light leading-none tracking-[-0.03em]">{$2(c.perHour)}</p>
            <p className="text-[13px]" style={{ color: MINT }}>{$2(c.perHourNoTips)} without tips</p>
            <p className="text-[12px]" style={{ color: '#c9cace' }}>Everything you were paid ÷ every hour you were there, before tax</p>
          </div>
          <div className={card} style={{ borderColor: LINE }}><p className="text-[13px]" style={{ color: MUTED }}>Paid, before tax</p><p className="text-[28px] font-light">{money0(c.gross)}</p><p className="text-[13px]" style={{ color: MUTED }}>{money0(c.tips)} of it in tips</p></div>
          <div className={card} style={{ borderColor: LINE }}><p className="text-[13px]" style={{ color: MUTED }}>Hours at work</p><p className="text-[28px] font-light">{Math.round(c.hours)}</p><p className="text-[13px]" style={{ color: MUTED }}>{Math.round(c.bookedHours)} booked · {Math.round(c.unbookedHours)} not booked</p></div>
          <div className={card} style={{ borderColor: LINE }}><p className="text-[13px]" style={{ color: MUTED }}>After my own costs</p><p className="text-[28px] font-light">{$2(c.perHourAfterCosts)}<span className="text-[14px]" style={{ color: MUTED }}> / hr</span></p><p className="text-[13px]" style={{ color: MUTED }}>{c.costs ? `${money0(c.costs)} I paid for work` : 'Add what you pay for yourself below'}</p></div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
          <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
            <p className="text-[16px] font-semibold">Where it came from</p>
            <div className="flex h-3.5 overflow-hidden rounded-full" aria-hidden>{c.sources.filter((x: any) => x.amount > 0).map((x: any) => <span key={x.key} style={{ width: `${(x.amount / total) * 100}%`, background: SRC_COLOR[x.key] || '#d6d7da' }} />)}</div>
            <div className="grid gap-x-5 gap-y-1.5 text-[14px] sm:grid-cols-2">{c.sources.map((x: any) => <div key={x.key} className="flex justify-between gap-3"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SRC_COLOR[x.key] }} />{x.label}</span><b className="font-semibold">{money0(x.amount)}</b></div>)}</div>
            {c.sales > 0 && <p className="text-[12.5px]" style={{ color: MUTED }}>{money0(c.sales)} in sales from your work{c.retail > 0 ? ` and ${money0(c.retail)} in products` : ''}{c.avgTicket ? ` · ${money0(c.avgTicket)} on average per booking` : ''}{c.salesPerHour ? ` · ${$2(c.salesPerHour)} in sales per hour at work` : ''}. Tips are counted once.</p>}
          </section>
          <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
            <p className="text-[16px] font-semibold">Period by period</p>
            <div className="flex h-[120px] items-end gap-2">{[...c.trend].map((x: any, i: number, a: any[]) => { const prev = a[i - 1]; const down = prev && x.perHour !== null && prev.perHour !== null && x.perHour < prev.perHour * 0.9;
              return <div key={x.from} className="flex flex-1 flex-col items-center gap-1.5" title={x.perHour !== null ? `${$2(x.perHour)} an hour` : 'No hours'}><div className="w-full rounded-[8px]" style={{ height: `${barH(x.perHour)}px`, background: x.current ? '#a9abb0' : down ? AMBER : DARK }} /><span className="text-[11.5px]" style={{ color: MUTED }}>{dshort(x.from)}{x.current ? ' (so far)' : ''}</span></div>; })}</div>
            {c.change && <p className="text-[14px]">Last period: <b>{$2(c.change.last)} an hour</b>{c.change.prev !== null ? `, ${c.change.last >= c.change.prev ? 'up' : 'down'} from ${$2(c.change.prev)}` : ''}.{c.change.unbooked >= 1 ? ` ${Math.round(c.change.unbooked)} hours had nothing booked.` : ''}</p>}
            {c.steadiness && <p className="text-[13px]" style={{ color: MUTED }}>Your pay per hour {c.steadiness === 'steady' ? 'is steady' : c.steadiness}.</p>}
          </section>
        </div>
      </>}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
          <div className="flex items-baseline justify-between gap-2"><p className="text-[16px] font-semibold">My goal</p><span className="text-[12.5px]" style={{ color: MUTED }}>Only you see this</span></div>
          <GoalEdit value={priv.goalMonthly} busy={saving === 'goal'} onSave={(v) => save({ ...priv, goalMonthly: v }, 'goal')} />
          {c.goal && <>
            <div className="h-2.5 overflow-hidden rounded-full" style={{ background: SOFT }}><div className="h-full" style={{ width: `${c.goal.pct}%`, background: GREEN }} /></div>
            <p className="text-[14px]">{c.goal.gap <= 0 ? `You’re on track: about ${money0(c.goal.current)} a month.` : c.goal.salesNeeded ? `About ${money0(c.goal.salesNeeded)} more in sales a month gets you there${c.goal.bookingsNeeded ? `: roughly ${c.goal.bookingsNeeded} more booking${c.goal.bookingsNeeded === 1 ? '' : 's'} at your average` : ''}.${c.goal.unbookedPerMonth ? ` You have about ${Math.round(c.goal.unbookedPerMonth)} unbooked hours a month to put them in.` : ''}` : c.goal.hoursNeeded ? `About ${c.goal.hoursNeeded} more hours a month at your rate gets you there.` : `${money0(c.goal.gap)} a month to go.`}</p>
            <p className="text-[12px]" style={{ color: MUTED }}>An estimate from your last {c.days} days ({money0(c.goal.current)} a month). Never more hours than are safe or allowed.</p></>}
        </section>
        <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
          <div className="flex items-baseline justify-between gap-2"><p className="text-[16px] font-semibold">What I pay for myself</p><span className="text-[12.5px]" style={{ color: MUTED }}>Only you see this</span></div>
          <p className="text-[13px]" style={{ color: MUTED }}>Tools, supplies, uniforms, licences, parking for work: anything your employer doesn’t pay back. Payroll deductions are already counted, so don’t add them here.</p>
          <CostsEdit costs={priv.costs} busy={saving === 'costs'} onSave={(costs) => save({ ...priv, costs }, 'costs')} />
        </section>
      </div>

      {has && <div className="grid gap-3 lg:grid-cols-2">
        <AllIn d={d} priv={priv} busy={saving === 'perks'} onSave={(perks) => save({ ...priv, perks }, 'perks')} />
        <TakeHome d={d} priv={priv} busy={saving === 'tax'} onSave={(tax) => save({ ...priv, tax }, 'tax')} />
      </div>}
      {d.contractor && <Contractor />}

      {has && <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-[16px] font-semibold">The same work, paid other ways</p><span className="text-[12.5px]" style={{ color: MUTED }}>Only you see this</span></div>
        <div className="divide-y" style={{ borderColor: LINE }}>{(d.compare || []).map((x: any) => (
          <details key={x.plan.id} className="py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px]"><span>{x.plan.kind === 'current' ? <b className="font-semibold">{x.label}</b> : x.label}{best && best.plan.id === x.plan.id && x.plan.kind !== 'current' && nowRow && x.beforeIncomeTax > nowRow.beforeIncomeTax ? <span className="ml-2 rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: '#e7f3ec', color: GREEN }}>most on these numbers</span> : null}</span>
              <span className="flex items-center gap-3">{x.perHourAllIn ? <span className="hidden text-[12.5px] sm:inline" style={{ color: MUTED }}>{$2(x.perHourAllIn)}/hr all in</span> : null}<b className="font-semibold">{money0(x.beforeIncomeTax)}</b>{x.plan.kind !== 'current' && <button type="button" onClick={(e) => { e.preventDefault(); editPlans((plans.length ? plans : (d.compare || []).slice(1).map((y: any) => y.plan)).filter((p: Plan) => p.id !== x.plan.id)); }} className="text-[12.5px] underline" style={{ color: MUTED }} aria-label={`Remove ${x.label}`}>Remove</button>}</span></summary>
            <div className="mt-2 space-y-1 rounded-[14px] p-3 text-[13px]" style={{ background: SOFT }}>{x.lines.map((l: any) => <div key={l.label} className="flex justify-between"><span>{l.label}</span><span>{l.amount < 0 ? `−${money0(-l.amount)}` : money0(l.amount)}</span></div>)}
              {x.notes.map((n: string) => <p key={n} style={{ color: MUTED }}>{n}</p>)}</div>
          </details>))}</div>
        {be !== null && <p className="text-[13.5px]">Working for yourself breaks even at about <b>{money0(be)} in sales a month</b>. Below that, the job pays more.</p>}
        {adding ? <PlanForm plan={adding} setPlan={setAdding} onCancel={() => setAdding(null)} onSave={() => { editPlans([...(plans.length ? plans : (d.compare || []).slice(1).map((y: any) => y.plan)), adding]); setAdding(null); }} preview={d.basis ? planPay(adding, d.basis) : null} />
          : <button type="button" onClick={() => setAdding({ id: rid(), kind: 'hourly', rate: 20 })} className="h-10 rounded-full border border-dashed px-4 text-[13.5px] font-semibold" style={{ borderColor: '#c9cace' }}>Add a plan or a job offer</button>}
        <p className="text-[12px]" style={{ color: MUTED }}>Same hours, sales and tips as the stretch above. Before income tax, after Social Security and Medicare. Working for yourself also takes out space, supplies and card fees. Estimates, not tax or legal advice.</p>
      </section>}
      <p className="text-[12px]" style={{ color: MUTED }}>Your goal, your own costs and your comparisons are private to you. Your employer can’t see them.</p>
    </div>);
}

function GoalEdit({ value, busy, onSave }: { value: number | null; busy: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = React.useState(value ? String(value) : ''); React.useEffect(() => { setV(value ? String(value) : ''); }, [value]);
  const n = Math.round(Number(v) || 0);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[14px]"><label className="flex items-center gap-1.5">$<input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} placeholder="4500" aria-label="Monthly goal before tax" className={`${field} w-28`} style={{ borderColor: LINE }} /> a month before tax</label>
      {(n || null) !== (value || null) && <button type="button" disabled={busy} onClick={() => onSave(n || null)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>{busy ? 'Saving…' : 'Save'}</button>}</div>);
}

function CostsEdit({ costs, busy, onSave }: { costs: Cost[]; busy: boolean; onSave: (c: Cost[]) => void }) {
  const [list, setList] = React.useState<Cost[]>(costs); React.useEffect(() => { setList(costs); }, [costs]);
  const changed = JSON.stringify(list) !== JSON.stringify(costs);
  return (
    <div className="space-y-2">
      {list.map((c, i) => <div key={c.id} className="flex flex-wrap items-center gap-2 text-[14px]">
        <input value={c.label} onChange={(e) => setList(list.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} placeholder="Tools and supplies" aria-label="What it was" className={`${field} min-w-0 flex-1`} style={{ borderColor: LINE }} />
        <label className="flex items-center gap-1">$<input inputMode="decimal" value={c.amount || ''} onChange={(e) => setList(list.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } : x)))} aria-label="Amount" className={`${field} w-20`} style={{ borderColor: LINE }} /></label>
        <select value={c.per} onChange={(e) => setList(list.map((x, k) => (k === i ? { ...x, per: e.target.value as Cost['per'] } : x)))} aria-label="How often" className={field} style={{ borderColor: LINE }}><option value="month">a month</option><option value="once">this stretch</option></select>
        <button type="button" onClick={() => setList(list.filter((_, k) => k !== i))} className="h-10 px-2 text-[12.5px]" style={{ color: MUTED }}>Remove</button></div>)}
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setList([...list, { id: rid(), label: '', amount: 0, per: 'month' }])} className="h-10 rounded-full border border-dashed px-4 text-[13.5px] font-semibold" style={{ borderColor: '#c9cace' }}>Add a cost</button>
        {changed && <button type="button" disabled={busy} onClick={() => onSave(list)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>{busy ? 'Saving…' : 'Save'}</button>}</div>
    </div>);
}

function PlanForm({ plan, setPlan, onSave, onCancel, preview }: { plan: Plan; setPlan: (p: Plan) => void; onSave: () => void; onCancel: () => void; preview: any }) {
  const num = (k: string, label: string, pre = '', post = '', step = 1) => <label className="flex items-center gap-1.5 text-[13.5px]">{label} {pre}<input type="number" min={0} step={step} value={(plan as any)[k] ?? ''} onChange={(e) => setPlan({ ...plan, [k]: Number(e.target.value) })} aria-label={label} className={`${field} w-24`} style={{ borderColor: LINE }} />{post}</label>;
  const sf = (k: string, label: string, post: string) => <label className="flex items-center gap-1.5 text-[13.5px]">{label}<input type="number" min={0} value={(plan.self as any)?.[k] ?? ''} onChange={(e) => setPlan({ ...plan, self: { spacePerWeek: 0, suppliesPct: 0, cardPct: 2.9, ...(plan.self || {}), [k]: Number(e.target.value) } })} aria-label={label} className={`${field} w-24`} style={{ borderColor: LINE }} />{post}</label>;
  return (
    <div className="space-y-3 rounded-[16px] border p-4" style={{ borderColor: LINE }}>
      <div className="flex flex-wrap gap-1.5">{KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={plan.kind === k} onClick={() => setPlan({ id: plan.id, kind: k, label: plan.label, ...(k === 'self' ? { self: { spacePerWeek: 250, suppliesPct: 8, cardPct: 2.9, otherMonthly: 90, unpaidWeeks: 2 } } : k === 'salary' ? { salary: 45000 } : k === 'draw' ? { pct: 40, draw: { perWeek: 500, recoverable: true } } : { rate: 18, pct: 40 }) })} className="h-9 rounded-full px-3 text-[12.5px] font-semibold" style={plan.kind === k ? { background: INK, color: BG } : { background: SOFT }}>{l}</button>)}</div>
      <input value={plan.label || ''} onChange={(e) => setPlan({ ...plan, label: e.target.value })} placeholder={`Name it (optional): ${planLabel({ ...plan, label: undefined })}`} aria-label="Name" className={`${field} w-full`} style={{ borderColor: LINE }} />
      <div className="flex flex-wrap gap-3">
        {['hourly', 'hourly_commission', 'greater_of'].includes(plan.kind) && num('rate', 'Per hour', '$')}
        {['commission', 'hourly_commission', 'greater_of'].includes(plan.kind) && num('pct', 'Commission', '', '%')}
        {['commission', 'hourly_commission', 'greater_of'].includes(plan.kind) && num('retailPct', 'On products', '', '%')}
        {plan.kind === 'salary' && num('salary', 'A year', '$', '', 1000)}
        {plan.kind === 'self' && <>{sf('spacePerWeek', 'Space a week $', '')}{sf('suppliesPct', 'Supplies', '% of sales')}{sf('cardPct', 'Card fees', '%')}{sf('retailMarginPct', 'Keep on products', '%')}{sf('otherMonthly', 'Insurance, software, licences a month $', '')}{sf('unpaidWeeks', 'Weeks off a year (unpaid)', '')}</>}
        {plan.kind === 'draw' && <>{num('pct', 'Commission', '', '%')}<label className="flex items-center gap-1.5 text-[13.5px]">Advance a week $<input type="number" min={0} value={plan.draw?.perWeek ?? ''} onChange={(e) => setPlan({ ...plan, draw: { recoverable: plan.draw?.recoverable !== false, perWeek: Number(e.target.value) } })} aria-label="Advance a week" className={`${field} w-24`} style={{ borderColor: LINE }} /></label>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={plan.draw?.recoverable !== false} onChange={(e) => setPlan({ ...plan, draw: { perWeek: plan.draw?.perWeek || 0, recoverable: e.target.checked } })} /> Paid back from later commission</label></>}
      </div>
      {plan.kind !== 'self' && <details className="text-[13.5px]"><summary className="cursor-pointer font-semibold">What comes with it (benefits, supplies, commute)</summary>
        <div className="mt-2 flex flex-wrap gap-3">{([['ptoDays', 'Paid days off a year', ''], ['healthMonthly', 'Health insurance a month $', ''], ['matchPct', 'Retirement match', '%'], ['suppliesMonthly', 'Supplies you’d buy a month $', ''], ['commuteMin', 'Commute each way', 'min']] as const).map(([k, l, post]) =>
          <label key={k} className="flex items-center gap-1.5">{l}<input type="number" min={0} value={(plan.perks as any)?.[k] ?? ''} onChange={(e) => setPlan({ ...plan, perks: { ...(plan.perks || {}), [k]: Number(e.target.value) } })} aria-label={l} className={`${field} w-20`} style={{ borderColor: LINE }} />{post}</label>)}</div></details>}
      {preview && <p className="text-[14px]">On your numbers: <b>{money0(preview.beforeIncomeTax)}</b> before income tax.{preview.toppedUp ? ` Includes ${money0(preview.toppedUp)} topped up to minimum wage.` : ''}</p>}
      <div className="flex gap-2"><button type="button" onClick={onSave} className="h-10 rounded-full px-4 text-[13.5px] font-semibold" style={{ background: INK, color: BG }}>Add it</button><button type="button" onClick={onCancel} className="h-10 rounded-full border px-4 text-[13.5px]" style={{ borderColor: LINE }}>Cancel</button></div>
    </div>);
}

function AllIn({ d, priv, busy, onSave }: { d: any; priv: any; busy: boolean; onSave: (p: any) => void }) {
  const [k, setK] = React.useState<any>(priv.perks || {}); React.useEffect(() => { setK(priv.perks || {}); }, [priv.perks]);
  const changed = JSON.stringify(k) !== JSON.stringify(priv.perks || {}); const a = d.allIn;
  const F: [string, string, string][] = [['commuteMin', 'Commute each way', 'min'], ['daysPerWeek', 'Days a week at work', ''], ['offClockMonthly', 'Hours worked off the clock a month', 'h'], ['ptoDays', 'Paid days off a year', ''], ['healthMonthly', 'Employer pays toward health insurance a month $', ''], ['matchPct', 'Retirement match', '%']];
  return (
    <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
      <div className="flex items-baseline justify-between gap-2"><p className="text-[16px] font-semibold">All in</p><span className="text-[12.5px]" style={{ color: MUTED }}>Only you see this</span></div>
      <div className="grid gap-2 text-[13.5px] sm:grid-cols-2">{F.map(([key, l, post]) => <label key={key} className="flex items-center justify-between gap-2"><span>{l}</span><span className="flex items-center gap-1"><input type="number" min={0} value={k[key] ?? ''} onChange={(e) => setK({ ...k, [key]: Number(e.target.value) })} aria-label={l} className={`${field} w-20`} style={{ borderColor: LINE }} />{post}</span></label>)}</div>
      {changed && <button type="button" disabled={busy} onClick={() => onSave(k)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>{busy ? 'Saving…' : 'Save'}</button>}
      {a && <div className="space-y-1 rounded-[14px] p-3 text-[14px]" style={{ background: SOFT }}>
        {a.perHourWithOffClock !== null && <div className="flex justify-between"><span>Counting {Math.round(a.offClockHours)} hours off the clock</span><b className="font-semibold">{$2(a.perHourWithOffClock)}/hr</b></div>}
        {a.perHourWithCommute !== null && <div className="flex justify-between"><span>Counting {Math.round(a.commuteHours)} hours of commute</span><b className="font-semibold">{$2(a.perHourWithCommute)}/hr</b></div>}
        {a.perHourWithBenefits !== null && <div className="flex justify-between"><span>With benefits worth {money0(a.benefits)}</span><b className="font-semibold">{$2(a.perHourWithBenefits)}/hr</b></div>}
        <div className="flex justify-between border-t pt-1" style={{ borderColor: LINE }}><span>All in, after your own costs</span><b className="font-semibold">{$2(a.perHourAllIn)}/hr</b></div></div>}
      {(k.offClockMonthly || 0) > 0 && <p className="text-[12.5px]" style={{ color: MUTED }}>Work off the clock should be paid. Your employer sees only how many people on the team reported some this month, never who or how much.</p>}
    </section>);
}
function TakeHome({ d, priv, busy, onSave }: { d: any; priv: any; busy: boolean; onSave: (t: any) => void }) {
  const [t, setT] = React.useState<any>(priv.tax || { on: false, filing: 'single', statePct: 0 }); React.useEffect(() => { setT(priv.tax || { on: false, filing: 'single', statePct: 0 }); }, [priv.tax]);
  const changed = JSON.stringify(t) !== JSON.stringify(priv.tax || { on: false, filing: 'single', statePct: 0 }); const th = d.takeHome;
  return (
    <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
      <div className="flex items-baseline justify-between gap-2"><p className="text-[16px] font-semibold">What I take home, roughly</p><span className="text-[12.5px]" style={{ color: MUTED }}>Only you see this</span></div>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={!!t.on} onChange={(e) => setT({ ...t, on: e.target.checked })} /> Show a rough income tax estimate</label>
      {t.on && <div className="flex flex-wrap items-center gap-2 text-[13.5px]"><select value={t.filing} onChange={(e) => setT({ ...t, filing: e.target.value })} aria-label="How you file" className={field} style={{ borderColor: LINE }}><option value="single">Single</option><option value="joint">Married, filing together</option><option value="head">Head of household</option></select>
        <label className="flex items-center gap-1">State income tax<input type="number" min={0} max={15} step={0.1} value={t.statePct ?? 0} onChange={(e) => setT({ ...t, statePct: Number(e.target.value) })} aria-label="State income tax percent" className={`${field} w-20`} style={{ borderColor: LINE }} />%</label></div>}
      {changed && <button type="button" disabled={busy} onClick={() => onSave(t)} className="h-10 rounded-full px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: INK, color: BG }}>{busy ? 'Saving…' : 'Save'}</button>}
      {th && d.monthlyBeforeIncomeTax !== null && <div className="space-y-1 rounded-[14px] p-3 text-[14px]" style={{ background: SOFT }}>
        <div className="flex justify-between"><span>A month, before income tax</span><span>{money0(d.monthlyBeforeIncomeTax)}</span></div>
        <div className="flex justify-between"><span>Federal income tax</span><span>−{money0(th.federal)}</span></div>
        {th.state > 0 && <div className="flex justify-between"><span>State income tax</span><span>−{money0(th.state)}</span></div>}
        <div className="flex justify-between border-t pt-1 font-semibold" style={{ borderColor: LINE }}><span>Take home, roughly</span><span>{money0(th.takeHome)}</span></div></div>}
      <p className="text-[12px]" style={{ color: MUTED }}>Uses {d.taxYear} federal brackets and the standard deduction, as if this were your only income, with no credits. Your real tax depends on your whole year.</p>
    </section>);
}
function Contractor() {
  const [a, setA] = React.useState<Record<string, boolean | null>>({}); const r = contractorLean(a);
  return (
    <section className={`${card} space-y-3`} style={{ borderColor: LINE }}>
      <div><p className="text-[16px] font-semibold">Paid as a contractor? Questions worth asking</p><p className="text-[13px]" style={{ color: MUTED }}>Labor agencies look at how the work is done, not what it’s called. Your answers stay on this screen; nothing is saved or sent.</p></div>
      <div className="space-y-1.5">{CONTRACTOR_QUESTIONS.map((q) => <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]"><span className="min-w-0 flex-1">{q.q}</span>
        <span className="flex gap-1">{([[true, 'Yes'], [false, 'No']] as const).map(([v, l]) => <button key={l} type="button" aria-pressed={a[q.id] === v} onClick={() => setA({ ...a, [q.id]: a[q.id] === v ? null : v })} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={a[q.id] === v ? { background: INK, color: BG } : { border: `1px solid ${LINE}` }}>{l}</button>)}</span></div>)}</div>
      {r.lean && <p className="text-[14px]">{r.lean === 'employee' ? 'Most of your answers describe how employees usually work.' : r.lean === 'contractor' ? 'Most of your answers describe how independent contractors usually work.' : 'Your answers are mixed.'} Employees get minimum wage, overtime and the business paying half of Social Security and Medicare; contractors don’t.</p>}
      <p className="text-[12px]" style={{ color: MUTED }}>Not legal advice. Your state’s labor department can tell you how the rules apply to you.</p>
    </section>);
}
