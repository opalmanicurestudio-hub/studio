'use client';
// src/app/(app)/prep/page.tsx — TOMORROW'S PREP (design canvas PrepList). About how many of each dish to prep, by station,
// worked out from the bookings and a usual night (the same day of the week), and always said to be an estimate. The
// guests expected (booked, and the walk-ins of a usual night), the last few of those nights, and what the recipes take
// against what's in stock now. The kitchen ticks dishes off as they're prepped; another day this week can be picked;
// it prints (lib/prep-list, api/prep).
//   Prep recipes (lib/prep-recipes): how many batches of each sauce, soup or dough the day's dishes take, against what's
//   on the shelf and still good by then; "Made it" takes what goes into a batch off stock and puts what it makes on the
//   shelf (api/prep 'made'), after saying so.
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { needWords, weekdayName, type PrepBatch, type PrepPlan } from '@/lib/prep-list';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
type Plan = PrepPlan & { days: string[]; done: Record<string, { by: string; at: string; make?: number | null }> };
const short = (day: string) => { const d = new Date(`${day}T12:00:00Z`); return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`; };
const long = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/prep', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export default function PrepPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [day, setDay] = useState('');
  const [p, setP] = useState<Plan | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async (fresh = false) => {
    if (!tenantId) return; setBusy(true);
    const d = await post({ tenantId, action: 'plan', ...(day ? { day } : {}), fresh }); setBusy(false);
    if (d.ok) { setP(d.plan); setErr(''); } else setErr(d.error || 'The prep list didn’t load.');
  }, [tenantId, day]);
  useEffect(() => { void load(); }, [load]);

  const tick = async (itemId: string, done: boolean, make: number | null) => {
    if (!tenantId || !p) return;
    setP({ ...p, done: done ? { ...p.done, [itemId]: { by: 'You', at: new Date().toISOString(), make } } : Object.fromEntries(Object.entries(p.done).filter(([k]) => k !== itemId)) });
    const d = await post({ tenantId, action: 'done', day: p.day, itemId, done, make });
    if (!d.ok) { setErr(d.error || 'That didn’t save.'); void load(); }
  };

  // One key per "Made it": sent again after a lost reply, it makes the batch once (api/prep 'made').
  const [making, setMaking] = useState<{ id: string; n: number; key?: string } | null>(null);
  const [made, setMade] = useState<Record<string, string>>({});
  const makeIt = async (b: PrepBatch, n: number) => {
    if (!tenantId) return; setBusy(true); setErr('');
    const key = making?.key || `mk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (making && !making.key) setMaking({ ...making, key });
    const d = await post({ tenantId, action: 'made', prepId: b.id, batches: n, tapKey: key }); setBusy(false);
    if (!d.ok) { setErr(d.error || 'That didn’t go through.'); return; }
    setMaking(null); setMade((m) => ({ ...m, [b.id]: `Made: ${needWords(d.made, d.unit)} of ${b.name} on the shelf${d.left !== null && d.left !== undefined ? `, ${needWords(Math.round(d.left * 10) / 10, d.unit)} in all` : ''}.` }));
    void load(true);
  };

  const tomorrow = p?.days?.[1];
  const usual = p ? (p.basis === 'weekday' ? `A usual ${weekdayName(p.day)}` : 'A usual night') : '';
  const stations = p ? Array.from(new Set(p.rows.map((r) => r.station))) : [];
  const most = p ? Math.max(1, ...p.nights.map((n) => n.guests || 0), p.guests || 0) : 1;
  // The prep recipes, with how many batches the day takes and "Made it" (shown even before there are nights to go by).
  const batchSection = p && (p.batches || []).length > 0 ? (
    <section className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }} aria-label="Make in batches">
      <h2 className="text-[17px] font-semibold">Make in batches</h2>
      <p className="pb-1 text-[13px]" style={{ color: MUTED }}>Your prep recipes: what the dishes take, less what’s on the shelf and still good by then</p>
      <div className="grid gap-x-6 sm:grid-cols-2">
      {(p.batches || []).map((b) => { const open = making?.id === b.id; const n = open ? making!.n : Math.max(1, b.batches); const until = b.keepsDays ? new Date(Date.now() + b.keepsDays * 864e5) : null; return (
        <div key={b.id} className="space-y-1.5 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
          <div className="flex items-baseline justify-between gap-3"><b className="text-[15px] font-semibold">{b.name}</b>
            <b className="text-[15px] font-semibold tabular-nums" style={b.batches ? undefined : { color: MUTED, fontWeight: 500 }}>{b.batches ? `${b.batches} batch${b.batches === 1 ? '' : 'es'}` : 'Enough'}</b></div>
          <p className="text-[13px] leading-snug" style={{ color: b.past ? AMBER : MUTED }}>{b.need > 0 ? `Needs about ${needWords(Math.round(b.need * 10) / 10, b.unit)}.` : 'The dishes on the list don’t need any.'}{b.have !== null ? (b.have > 0 ? ` You have ${needWords(Math.round(b.have * 10) / 10, b.unit)}` : ' None on the shelf') : ''}{b.past && b.lastMadeAt ? `, made ${new Date(b.lastMadeAt).toLocaleDateString('en-US', { weekday: 'short' })}: past its ${b.keepsDays} days by then.` : b.goodUntil && b.have ? `, good until ${new Date(b.goodUntil).toLocaleDateString('en-US', { weekday: 'short' })}.` : b.have !== null ? '.' : ''}{b.minutes ? ` A batch takes about ${b.minutes} min.` : ''}</p>
          {made[b.id] && !open && <p className="text-[13px] font-semibold" style={{ color: GREEN }}>{made[b.id]}</p>}
          {!open ? <div className="print:hidden"><button type="button" onClick={() => setMaking({ id: b.id, n: Math.max(1, b.batches), key: `mk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` })} className="min-h-[44px] rounded-xl px-4 text-[14px] font-semibold"
              style={b.batches ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>Made it</button></div>
            : <div className="space-y-2 rounded-2xl p-3 print:hidden" style={{ background: SOFT }}>
                <div className="flex items-center gap-2" role="group" aria-label="How many batches">
                  <button type="button" onClick={() => setMaking({ id: b.id, n: Math.max(1, n - 1), key: undefined })} aria-label="One batch fewer" className="h-11 w-11 rounded-xl border bg-[#fff] text-[18px]" style={{ borderColor: LINE }}>−</button>
                  <span className="min-w-[96px] text-center text-[15px] font-semibold tabular-nums">{n} batch{n === 1 ? '' : 'es'}</span>
                  <button type="button" onClick={() => setMaking({ id: b.id, n: Math.min(20, n + 1), key: undefined })} aria-label="One batch more" className="h-11 w-11 rounded-xl border bg-[#fff] text-[18px]" style={{ borderColor: LINE }}>+</button>
                </div>
                <p className="text-[13px] leading-snug">Takes {b.goesIn.length ? b.goesIn.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'what goes into it'} off stock, and puts {needWords(Math.round(b.makes * n * 100) / 100, b.unit)} of {b.name} on the shelf{until ? `, good until ${until.toLocaleDateString('en-US', { weekday: 'short' })}` : ''}.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => makeIt(b, n)} className="min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-50" style={{ background: INK, color: '#fff' }}>{busy ? 'Saving…' : 'Made it'}</button>
                  <button type="button" onClick={() => setMaking(null)} className="min-h-[44px] rounded-xl border bg-[#fff] px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>Cancel</button>
                </div>
              </div>}
        </div>); })}
      </div>
    </section>
  ) : null;

  return (
    <div className="min-h-dvh print:bg-[#fff]" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[28px] font-semibold tracking-tight">{p ? `Prep for ${long(p.day)}` : 'Prep list'}</h1>
              <span className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>An estimate</span>
            </div>
            <p className="max-w-[640px] text-[15px] leading-snug" style={{ color: MUTED }}>
              {!p ? 'Working it out…' : p.basis === 'none' ? 'There aren’t any nights sold yet to go by. Once a few nights are through the kitchen screen, this fills in.'
                : p.basis === 'recent' ? (p.sameDay === 0
                  ? `Nothing sold on the last six ${weekdayName(p.day)}s. If you’re closed ${weekdayName(p.day)}s, there’s nothing to prep. Otherwise this goes by the last few nights.`
                  : `Not enough ${weekdayName(p.day)}s yet, so this goes by the last few nights, and ${p.booked} ${p.booked === 1 ? 'guest' : 'guests'} booked.`)
                : `From ${p.booked} ${p.booked === 1 ? 'guest' : 'guests'} booked and ${usual.charAt(0).toLowerCase()}${usual.slice(1)}. Check it against what you know is coming.`}
              {p?.truncated ? ' Some of those nights were too busy to read in full, so these may run low.' : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div role="radiogroup" aria-label="Which day" className="flex flex-wrap gap-1 rounded-2xl p-1" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
              {(p?.days || []).slice(1).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={p?.day === d} onClick={() => setDay(d)} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold"
                  style={p?.day === d ? { background: INK, color: '#fff' } : { color: MUTED }}>{d === tomorrow ? 'Tomorrow' : short(d)}</button>))}
            </div>
            <button type="button" disabled={busy} onClick={() => load(true)} className="min-h-[44px] rounded-xl border bg-[#fff] px-4 text-[14px] font-semibold disabled:opacity-50" style={{ borderColor: LINE }}>{busy ? 'Working it out…' : 'Work it out again'}</button>
            <button type="button" onClick={() => window.print()} className="min-h-[44px] rounded-xl border bg-[#fff] px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>Print</button>
          </div>
        </header>
        {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: AMBER }}>{err}</p>}

        {p && p.basis === 'none' && batchSection && <div className="max-w-3xl">{batchSection}</div>}
        {p && p.basis !== 'none' && <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-4">
          {batchSection}
          <main className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }} aria-busy={busy}>
            <div className="grid grid-cols-[44px_1fr_60px_76px] sm:grid-cols-[44px_1fr_96px_120px] items-center gap-2 pb-1 text-[13px]" style={{ color: MUTED }}>
              <span /><span>Dish</span><span className="text-right">Make about</span><span className="text-right">Usually</span>
            </div>
            {p.rows.length === 0 && <p className="py-6 text-center text-[15px]" style={{ color: MUTED }}>Nothing sold on those nights to go by.</p>}
            {stations.map((st) => (
              <section key={st} aria-label={st}>
                <h2 className="pb-1 pt-4 text-[14px] font-semibold" style={{ color: MUTED }}>{st}</h2>
                {p.rows.filter((r) => r.station === st).map((r) => { const mark = p.done[r.id]; const more = !!mark && typeof mark.make === 'number' && r.make !== null && r.make > mark.make; const done = !!mark && !more; return (
                  <div key={r.id} className="grid min-h-[56px] grid-cols-[44px_1fr_60px_76px] sm:grid-cols-[44px_1fr_96px_120px] items-center gap-2" style={{ borderTop: `1px solid ${LINE}` }}>
                    {r.isNew ? <span /> : <button type="button" role="checkbox" aria-checked={done} aria-label={`${r.name} prepped`} onClick={() => tick(r.id, !done, r.make)} className="grid h-11 w-11 place-items-center rounded-xl">
                      <span className="grid h-6 w-6 place-items-center rounded-[7px]" style={done ? { background: GREEN } : { boxShadow: 'inset 0 0 0 1.5px #c9cacd' }}>
                        {done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>}</span></button>}
                    <span className="min-w-0"><span className="block truncate text-[15px] font-semibold" style={done ? { color: MUTED, textDecoration: 'line-through' } : undefined}>{r.name}</span>
                      {more && <span className="block text-[12.5px] font-semibold" style={{ color: AMBER }}>{mark!.make} prepped. It’s {r.make} now</span>}</span>
                    {r.isNew ? <span className="text-right text-[15px] font-semibold" style={{ color: MUTED }}>New</span>
                      : <span className="text-right text-[20px] font-semibold tabular-nums" style={done ? { color: MUTED, textDecoration: 'line-through' } : undefined}>{r.make}</span>}
                    <span className="text-right text-[13px]" style={{ color: MUTED }}>{r.isNew ? 'Not sold yet' : r.low === r.high ? `${r.low}` : `${r.low} to ${r.high}`}</span>
                  </div>); })}
              </section>))}
          </main>
          </div>

          <aside className="space-y-4">
            <section className="space-y-2 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }} aria-label="Guests">
              <h2 className="text-[17px] font-semibold">{p.guests !== null ? `About ${p.guests} guests` : `${p.booked} booked`}</h2>
              <p className="text-[14px] leading-snug">{p.guests !== null
                ? <><b className="font-semibold">{p.booked} booked</b>{p.bookings ? ` in ${p.bookings} booking${p.bookings === 1 ? '' : 's'}` : ''}, and about {p.walkIns} walk-ins, as on {usual.charAt(0).toLowerCase()}{usual.slice(1)}.</>
                : 'Guests aren’t counted on the floor here, so this is a usual night’s sales as they were.'}</p>
              {p.nights.some((n) => n.guests) && <>
                <p className="pt-1 text-[13px]" style={{ color: MUTED }}>{p.basis === 'weekday' ? `The last ${p.nights.length} ${weekdayName(p.day)}s` : 'The last few nights'}</p>
                <div className="flex h-16 items-end gap-1.5" aria-hidden>
                  {p.nights.map((n) => <i key={n.day} className="block flex-1" style={{ height: `${Math.max(6, Math.round(((n.guests || 0) / most) * 100))}%`, background: '#c9cacd', borderRadius: '5px 5px 2px 2px' }} />)}
                  {p.guests !== null && <i className="block flex-1" style={{ height: `${Math.max(6, Math.round((p.guests / most) * 100))}%`, background: INK, borderRadius: '5px 5px 2px 2px' }} />}
                </div>
                <div className="flex gap-1.5 text-[12px] tabular-nums" style={{ color: MUTED }}>
                  {p.nights.map((n) => <span key={n.day} className="flex-1 text-center">{n.guests ?? ''}</span>)}
                  {p.guests !== null && <span className="flex-1 text-center font-semibold" style={{ color: INK }}>{p.guests}</span>}
                </div></>}
            </section>
            <section className="rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}` }} aria-label="What it takes">
              <h2 className="text-[17px] font-semibold">What it takes</h2>
              <p className="pb-1 text-[13px]" style={{ color: MUTED }}>From your recipes, against what’s in stock right now</p>
              {p.needs.length === 0 ? <p className="py-2 text-[14px]" style={{ color: MUTED }}>Add recipes to your dishes on the Menu page and what they take shows here.</p>
                : p.needs.map((n) => { const short = n.have !== null && n.have < n.need; return (
                  <div key={n.id} className="flex min-h-[48px] items-center gap-3 text-[14.5px]" style={{ borderTop: `1px solid ${LINE}` }}>
                    <span className="min-w-0 flex-1 truncate">{n.name}</span>
                    <span className="text-right tabular-nums" style={short ? { color: AMBER, fontWeight: 600 } : undefined}>{needWords(n.need, n.unit)}{n.have !== null ? `, have ${needWords(Math.round(n.have * 10) / 10, n.unit)}` : ''}</span>
                  </div>); })}
            </section>
          </aside>
        </div>}
      </div>
    </div>
  );
}
