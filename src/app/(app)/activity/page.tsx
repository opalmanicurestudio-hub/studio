'use client';
// src/app/(app)/activity/page.tsx — ACTIVITY, AND WHO CAN DO WHAT (design boards "Activity", layout B, and "Who can do
// what"; api/activity; lib/activity, lib/money-rules). For the owner: every money moment on a day, from every screen,
// as it happens. The day's totals first (a tap shows just those), then what's worth a look, then everything, by kind or
// by person. The second tab is the owner's rules: for each money moment, anyone, a manager or only them; how much staff
// can refund on their own; what's worth a look; and the online shop's automatic refunds. Nothing here can change a line.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import { ACTIVITY_KINDS, TELL_MODES, lineTitle, lineWho, type ActivityKind, type ActivityLine, type TellMode } from '@/lib/activity';
import { NEEDS, RULES, type MoneyRules, type Need, type RuleKey } from '@/lib/money-rules';
import { addDays, formatTime } from '@/lib/tenant-time';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = 'var(--ok-ink)', AMBER = 'var(--warn-ink)', AMBER_TINT = 'var(--warn-soft)';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const usd = (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`;
const WHERE: Record<string, string> = { counter: 'Counter', window: 'Window', desk: 'Front desk', online: 'Online', app: 'App' };
type Tab = 'activity' | 'rules';
type Day = { day: string; today: string; timeZone: string; lines: ActivityLine[]; totals: Record<ActivityKind, { n: number; cents: number }>; flagged: string[]; people: string[]; more: boolean };
type Rules = { rules: MoneyRules; alerts: { refundOverCents: number | null; tell?: TellMode }; auto: { cents: number } | null; canChange?: boolean };

export default function ActivityPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [tab, setTab] = useState<Tab>(() => { try { return new URLSearchParams(window.location.search).get('tab') === 'rules' ? 'rules' : 'activity'; } catch { return 'activity'; } });
  const call = useCallback(async (body: any) => {
    try {
      const r = await fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  }, [tenantId]);
  const pick = (t: Tab) => { setTab(t); try { const u = new URL(window.location.href); if (t === 'activity') u.searchParams.delete('tab'); else u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()); } catch { /* the tab still changes */ } };
  return (
    <div className="mx-auto w-full max-w-[920px] space-y-5 px-4 pb-16 pt-6 sm:px-6" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Every refund, void, item on the house, price change, discount and drawer opening, from every screen, as it happens. Nobody can change or delete a line, you included.</p>
      </div>
      <div role="tablist" aria-label="Activity" className="flex flex-wrap gap-2">
        {([['activity', 'Activity'], ['rules', 'Who can do what']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => pick(id)} className={btn}
            style={tab === id ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{label}</button>))}
      </div>
      {tenantId && tab === 'activity' && <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity"><DayView call={call} /></div>}
      {tenantId && tab === 'rules' && <div id="panel-rules" role="tabpanel" aria-labelledby="tab-rules"><RulesView call={call} /></div>}
    </div>
  );
}

function DayView({ call }: { call: (b: any) => Promise<any> }) {
  const [day, setDay] = useState<string | null>(null);
  const [data, setData] = useState<Day | null>(null); const [err, setErr] = useState('');
  const [kind, setKind] = useState<ActivityKind | 'all'>('all'); const [person, setPerson] = useState('all');
  const load = useCallback(async () => {
    const d = await call({ action: 'list', ...(day ? { day } : {}) });
    if (d.ok) { setData(d); setErr(''); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [call, day]);
  useEffect(() => { void load(); }, [load]);
  // (Today's, as it happens: read again every minute while it's on screen.)
  useEffect(() => {
    if (!data || data.day !== data.today) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60000);
    return () => clearInterval(t);
  }, [data, load]);
  const shown = useMemo(() => (data?.lines || []).filter((l) => (kind === 'all' || l.kind === kind) && (person === 'all' || l.by === person || l.okBy === person)), [data, kind, person]);
  const flagged = useMemo(() => (data?.lines || []).filter((l) => l.flag), [data]);
  if (err && !data) return <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>;
  if (!data) return <p className="text-[15px]" style={{ color: MUTED }}>Loading the day…</p>;
  const tiles = ACTIVITY_KINDS.filter((k) => ['refund', 'void', 'comp', 'drawer'].includes(k.id) || data.totals[k.id].n > 0);
  const when = (iso: string) => formatTime(iso, data.timeZone);
  const isToday = data.day === data.today;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setDay(null)} className={btn} style={isToday ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }} aria-pressed={isToday}>Today</button>
        <button type="button" onClick={() => setDay(addDays(data.today, -1))} className={btn} style={data.day === addDays(data.today, -1) ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }} aria-pressed={data.day === addDays(data.today, -1)}>Yesterday</button>
        <label className="flex min-h-[44px] items-center gap-2 rounded-xl border px-3 text-[14px]" style={{ background: '#fff', borderColor: LINE }}><span style={{ color: MUTED }}>Another day</span>
          <input type="date" value={data.day} max={data.today} onChange={(e) => e.target.value && setDay(e.target.value)} className="bg-transparent text-[14.5px] outline-none" style={{ color: INK }} /></label>
        {isToday && <span className="text-[13px]" style={{ color: MUTED }}>Live</span>}
      </div>

      <section aria-labelledby="glance" className="space-y-2">
        <h2 id="glance" className="text-[13px] font-semibold" style={{ color: MUTED }}>{isToday ? 'Today at a glance' : 'That day at a glance'}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((k) => { const t = data.totals[k.id]; const on = kind === k.id; return (
            <button key={k.id} type="button" aria-pressed={on} onClick={() => setKind(on ? 'all' : k.id)} className={`flex min-h-[72px] flex-col items-start justify-center rounded-2xl border px-4 py-3 text-left ${RING}`}
              style={on ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>
              <span className="text-[20px] font-semibold tabular-nums">{t.cents > 0 && k.id !== 'drawer' ? usd(t.cents) : t.n}</span>
              <span className="text-[13px]" style={{ color: on ? '#d9dadd' : MUTED }}>{t.cents > 0 && k.id !== 'drawer' ? `${t.n} ${t.n === 1 ? k.one : k.many}` : t.n === 1 ? k.one : k.many}</span>
            </button>); })}
        </div>
      </section>

      {flagged.length > 0 && <section aria-labelledby="look" className="space-y-2">
        <h2 id="look" className="text-[13px] font-semibold" style={{ color: MUTED }}>Worth a look</h2>
        <ul className="space-y-2">{flagged.map((l) => (
          <li key={l.id} className="rounded-2xl px-4 py-3" style={{ background: AMBER_TINT }}>
            <span className="block text-[15px] font-semibold" style={{ color: AMBER }}>{l.flag}</span>
            <span className="block text-[13.5px]" style={{ color: INK }}>{when(l.at)}: {lineTitle(l)}{l.cents ? `, ${usd(l.cents)}` : ''}. {lineWho(l)}.</span>
          </li>))}</ul>
      </section>}

      <section aria-labelledby="all" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="all" className="text-[13px] font-semibold" style={{ color: MUTED }}>Everything{kind !== 'all' ? `: ${ACTIVITY_KINDS.find((k) => k.id === kind)!.label.toLowerCase()}` : ''}</h2>
          <label className="flex items-center gap-2 text-[14px]"><span style={{ color: MUTED }}>Who</span>
            <select value={person} onChange={(e) => setPerson(e.target.value)} className={`min-h-[44px] rounded-xl border px-3 text-[14.5px] ${RING}`} style={{ background: '#fff', color: INK, borderColor: LINE }}>
              <option value="all">Everyone</option>{data.people.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {[{ id: 'all', label: 'Everything' }, ...ACTIVITY_KINDS.filter((k) => data.totals[k.id].n > 0)].map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id as any)} className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`}
              style={kind === k.id ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{k.label}</button>))}
        </div>
        {shown.length === 0 ? <p className="rounded-2xl border px-4 py-5 text-[15px]" style={{ background: '#fff', borderColor: LINE, color: MUTED }}>{data.lines.length ? 'Nothing like that on this day.' : isToday ? 'Nothing yet today. Refunds, voids and the rest show here the moment they happen.' : 'Nothing on this day.'}</p>
          : <ul className="divide-y rounded-2xl border" style={{ background: '#fff', borderColor: LINE }}>{shown.map((l) => (
            <li key={l.id} className="grid grid-cols-[64px_1fr_auto] gap-3 px-4 py-3" style={{ borderColor: LINE, background: l.flag ? AMBER_TINT : undefined }}>
              <span className="text-[13.5px] tabular-nums" style={{ color: MUTED }}>{when(l.at)}</span>
              <span className="min-w-0"><span className="block text-[15px] font-semibold">{lineTitle(l)}</span>
                <span className="block text-[13.5px]" style={{ color: MUTED }}>{lineWho(l)}{l.where ? `, ${WHERE[l.where]}` : ''}</span>
                {l.flag && <span className="mt-0.5 block text-[13px] font-medium" style={{ color: AMBER }}>{l.flag}</span>}</span>
              <span className="text-[15px] tabular-nums">{l.cents ? usd(l.cents) : ''}</span>
            </li>))}</ul>}
        {data.more && <p className="text-[13px]" style={{ color: MUTED }}>The busiest days show their latest 1,000 lines.</p>}
      </section>
    </div>
  );
}

function RulesView({ call }: { call: (b: any) => Promise<any> }) {
  const [r, setR] = useState<Rules | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const [other, setOther] = useState('');
  useEffect(() => { void call({ action: 'rules' }).then((d) => { if (d.ok) setR(d); else setMsg({ text: d.error || 'That didn’t load. Try again.', tone: 'warn' }); }); }, [call]);
  const save = async (k: string, body: any, said: string) => {
    setBusy(k); setMsg(null);
    const d = await call({ action: 'saveRules', ...body }); setBusy(null);
    if (d.ok) { setR(d); setMsg({ text: said, tone: 'good' }); } else setMsg({ text: d.error || 'That didn’t save. Try again.', tone: 'warn' });
  };
  if (!r) return msg ? <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{msg.text}</p> : <p className="text-[15px]" style={{ color: MUTED }}>Loading your rules…</p>;
  const seg = (on: boolean) => (on ? { background: INK, color: '#fff' } : { color: INK });
  // (An admin sees the rules; only the owner changes them.)
  const locked = r.canChange === false;
  const chip = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK });
  const selfOpts = [0, 1000, 2500];
  const overOpts: (number | null)[] = [2500, 5000, 10000, null];
  return (
    <div className="space-y-6">
      {locked && <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: SOFT }}>Only the owner changes who can do what. You can see them here.</p>}
      <section aria-labelledby="rules-h" className="space-y-2">
        <h2 id="rules-h" className="text-[13px] font-semibold" style={{ color: MUTED }}>At the counter and the window</h2>
        <ul className="divide-y rounded-2xl border" style={{ background: '#fff', borderColor: LINE }}>
          {RULES.map((x) => (
            <li key={x.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_minmax(300px,1.1fr)] sm:items-center" style={{ borderColor: LINE }}>
              <span><span className="block text-[15px] font-semibold">{x.label}</span><span className="block text-[13px]" style={{ color: MUTED }}>{x.hint}</span></span>
              <span role="radiogroup" aria-label={x.label} className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: SOFT }}>
                {NEEDS.map((n) => <button key={n.id} type="button" role="radio" aria-checked={r.rules[x.id as RuleKey] === n.id} disabled={!!busy || locked}
                  onClick={() => r.rules[x.id as RuleKey] !== n.id && void save(x.id, { rules: { [x.id]: n.id } }, `${x.label}: ${n.label.toLowerCase()}.`)}
                  className={`min-h-[44px] rounded-lg px-2 text-[13.5px] font-semibold ${RING}`} style={seg(r.rules[x.id as RuleKey] === (n.id as Need))}>{n.id === 'owner' && locked ? 'The owner' : n.label}</button>)}
              </span>
              {x.id === 'refund' && <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <span className="text-[13.5px]" style={{ color: MUTED }}>Staff can refund on their own up to</span>
                {selfOpts.map((c) => <button key={c} type="button" aria-pressed={r.rules.refundSelfCents === c} disabled={!!busy || locked} onClick={() => void save('self', { rules: { refundSelfCents: c } }, c ? `Staff can refund up to ${usd(c)} on their own.` : 'Every refund takes the rule above.')}
                  className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(r.rules.refundSelfCents === c)}>{usd(c).replace('.00', '')}</button>)}
                <span className="flex min-h-[44px] items-center rounded-full px-3" style={{ background: selfOpts.includes(r.rules.refundSelfCents) ? SOFT : INK, color: selfOpts.includes(r.rules.refundSelfCents) ? INK : '#fff' }}>
                  <span aria-hidden>$</span><input aria-label="Another amount staff can refund on their own" inputMode="decimal" value={other || (selfOpts.includes(r.rules.refundSelfCents) ? '' : (r.rules.refundSelfCents / 100).toFixed(2))} placeholder="Other"
                    onChange={(e) => setOther(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))} disabled={!!busy || locked} onBlur={() => { const c = Math.round(Number(other) * 100); if (other && Number.isFinite(c)) void save('self', { rules: { refundSelfCents: c } }, `Staff can refund up to ${usd(c)} on their own.`); setOther(''); }}
                    className="w-16 bg-transparent px-1 text-[14px] font-semibold outline-none placeholder:text-current" /></span>
                <span className="w-full text-[13px]" style={{ color: MUTED }}>All the refunds on one order count together, so a refund in pieces is one refund.</span>
              </div>}
            </li>))}
        </ul>
      </section>

      <section aria-labelledby="look-h" className="space-y-2">
        <h2 id="look-h" className="text-[13px] font-semibold" style={{ color: MUTED }}>Worth a look</h2>
        <div className="space-y-3 rounded-2xl border px-4 py-4" style={{ background: '#fff', borderColor: LINE }}>
          <p className="text-[14.5px]">Always marked: a void after the kitchen started, the drawer opened with no sale twice in half an hour by the same person, cash given back by whoever took the payment with nobody else okaying it, and too many wrong PINs.</p>
          <div className="flex flex-wrap items-center gap-2"><span className="text-[14px]" style={{ color: MUTED }}>And refunds of</span>
            {overOpts.map((c) => <button key={String(c)} type="button" aria-pressed={r.alerts.refundOverCents === c} disabled={!!busy || locked} onClick={() => void save('over', { alerts: { refundOverCents: c } }, c ? `Refunds of ${usd(c)} or more are marked.` : 'Big refunds aren’t marked.')}
              className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(r.alerts.refundOverCents === c)}>{c ? `${usd(c).replace('.00', '')} or more` : 'None'}</button>)}</div>
          <div role="radiogroup" aria-labelledby="tell-h" className="flex flex-wrap items-center gap-2"><span id="tell-h" className="text-[14px]" style={{ color: MUTED }}>When something’s worth a look, tell me</span>
            {TELL_MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={(r.alerts.tell || 'push') === m.id} disabled={!!busy || locked} onClick={() => void save('tell', { alerts: { tell: m.id } }, m.id === 'push' ? 'Your phone buzzes when something’s worth a look.' : m.id === 'app' ? 'Something worth a look waits in the app’s notifications.' : 'Nothing tells you. It’s still marked here.')}
              className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip((r.alerts.tell || 'push') === m.id)}>{m.label}</button>)}</div>
          <p className="text-[13px]" style={{ color: MUTED }}>It goes to you and your admins, never to whoever it’s about. Your phone follows your own alert settings, like quiet hours.</p>
        </div>
      </section>

      {r.auto && <section aria-labelledby="auto-h" className="space-y-2">
        <h2 id="auto-h" className="text-[13px] font-semibold" style={{ color: MUTED }}>What happens on its own</h2>
        <div className="space-y-3 rounded-2xl border px-4 py-4" style={{ background: '#fff', borderColor: LINE }}>
          <p className="text-[14.5px]">Online orders your rules already decided go back on their own: a return checked in, a canceled order, an item that wasn’t on the shelf, a swap turned down, a claim approved. Over the amount, it waits for someone allowed to send it.</p>
          <div className="flex flex-wrap items-center gap-2"><span className="text-[14px]" style={{ color: MUTED }}>On its own, up to</span>
            {[0, 1000, 2500, 5000].map((c) => <button key={c} type="button" aria-pressed={r.auto!.cents === c} disabled={!!busy || locked} onClick={() => void save('auto', { autoBelowCents: c }, c ? `Online refunds up to ${usd(c)} go back on their own.` : 'Every online refund waits for someone.')}
              className={`min-h-[44px] rounded-full px-4 text-[14px] font-semibold ${RING}`} style={chip(r.auto!.cents === c)}>{c ? usd(c).replace('.00', '') : 'Off'}</button>)}
            {![0, 1000, 2500, 5000].includes(r.auto.cents) && <span className="text-[14px]" style={{ color: MUTED }}>Now {usd(r.auto.cents)}</span>}</div>
        </div>
      </section>}

      {msg && <p role={msg.tone === 'warn' ? 'alert' : 'status'} className="text-[14.5px]" style={{ color: msg.tone === 'warn' ? AMBER : GREEN }}>{msg.text}</p>}
      <ul className="space-y-1.5 text-[13.5px]" style={{ color: MUTED }}>
        <li>A manager’s PIN okays it for that moment only. It never changes who’s signed in.</li>
        <li>You, as the owner, are never asked for a PIN. Changing these rules is a line in Activity too.</li>
      </ul>
    </div>
  );
}
