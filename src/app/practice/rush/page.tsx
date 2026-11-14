'use client';
// /practice/rush — PRACTICE A RUSH at the host stand (design canvas PracticeRush). A made-up Friday night on the real host
// stand's rules (lib/practice/rush): seat the parties waiting (the coach says when a better table was free, and why),
// and take care of what the floor needs (food at the pass, a table that hasn't ordered, mains to fire, a table asking for
// the check, a booking that didn't come). Pause any time, or play at double speed. At the end: how it went, and what to
// take from it. Nothing here is real: no guests, texts, tickets or payments.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as R from '@/lib/practice/rush';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', AMBER_TINT = '#fff7ed', BLUE = '#1d4ed8', BLUE_TINT = '#eef4ff';
const BTN = 'min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const STEP_MS = 500;
const AMBER_KEYS = new Set(['no_order', 'at_pass', 'check', 'paid']);

export default function PracticeRush() {
  const sim = useRef<R.RushState | null>(null);
  const [, setN] = useState(0); const redraw = () => setN((n) => n + 1);
  const [running, setRunning] = useState(false); const [speed, setSpeed] = useState(1);
  const [pick, setPick] = useState<string | null>(null); const [said, setSaidText] = useState(''); const [saidN, setSaidN] = useState(0);
  const setSaid = (t: string) => { setSaidText(t); setSaidN((n) => n + 1); };
  // A message said back fades after a few seconds.
  useEffect(() => { if (!said) return; const i = setTimeout(() => setSaidText(''), 6000); return () => clearTimeout(i); }, [said, saidN]);
  const start = useCallback(() => { sim.current = R.newRush(); setPick(null); setSaid(''); setRunning(true); redraw(); }, []);
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => { const s = sim.current; if (!s || s.ended) return; R.tick(s, 0.125 * speed); if (s.ended) setRunning(false); redraw(); }, STEP_MS);
    return () => clearInterval(i);
  }, [running, speed]);

  const s = sim.current;
  if (!s) return (
    <div className="grid min-h-dvh place-items-center px-4" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="w-full max-w-lg space-y-4 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}>
        <span className="inline-block rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: BLUE_TINT, color: BLUE }}>Nothing here is real</span>
        <h1 className="text-[26px] font-semibold tracking-tight">Practice a rush at the host stand</h1>
        <p className="text-[15px] leading-relaxed" style={{ color: MUTED }}>A Friday night, 7 to 7:40 pm. The room’s nearly full and people are waiting. Seat each party at a table that fits, and take care of what the floor needs: food at the pass, a table that hasn’t ordered, a table that wants to pay. It runs on the same rules as the real host stand, and a coach says when a better table was free.</p>
        <ul className="space-y-1.5 text-[14.5px]">
          <li>Tap a waiting party, then a free table. Or use the suggested table.</li>
          <li>Keep guests happy: no long waits past what they were told, no food sitting at the pass.</li>
          <li>Pause any time. About three minutes at normal speed.</li>
        </ul>
        <button type="button" onClick={start} className={`${BTN} w-full`} style={{ background: INK, color: '#fff' }}>Start the rush</button>
        <a href="/practice" className="block text-center text-[14px] font-semibold underline underline-offset-4">Other practice</a>
      </div>
    </div>
  );

  const floor = R.floorOf(s); const stages = R.stagesOf(s); const needs = R.needsOf(s); const sugg = R.suggestions(s); const sc = R.scoreOf(s);
  const parties = Object.values(s.parties);
  const waiting = parties.filter((p) => p.status === 'waiting').sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  const at = (tableId: string) => parties.find((p) => p.status === 'seated' && p.unitIds[0] === tableId) || null;
  const waitedOf = (p: R.RushParty) => Math.max(0, Math.round(s.t - R.minuteOf(p.joinedAt)));
  const seat = (partyId: string, tableId: string) => { const r = R.seat(s, partyId, tableId); setSaid(r.ok ? '' : r.error || ''); if (r.ok) setPick(null); redraw(); };
  const act = (key: string) => { const r = R.act(s, key); setSaid(r.ok ? '' : r.error || ''); redraw(); };
  const tapTable = (id: string) => { if (pick) seat(pick, id); else setSaid('Pick a waiting party first.'); };

  if (s.ended) return (
    <div className="min-h-dvh px-4 py-8" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-2xl space-y-4 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}>
        <h1 className="text-[26px] font-semibold tracking-tight">How the rush went</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Seated', `${sc.seated}`], ['Tables turned', `${sc.turned}`], ['Longest wait', `${sc.longestWait} min`], ['Happy guests', `${sc.happy}%`]].map(([k, v]) => (
            <div key={k} className="rounded-2xl p-3" style={{ background: SOFT }}><p className="text-[22px] font-semibold tabular-nums">{v}</p><p className="text-[13px]" style={{ color: MUTED }}>{k}</p></div>))}
        </div>
        <section aria-label="What to take from it" className="space-y-2">
          {R.lessons(s).map((l) => <p key={l} className="rounded-2xl px-4 py-3 text-[15px] leading-snug" style={{ border: `1px solid ${LINE}` }}>{l}</p>)}
        </section>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={start} className={BTN} style={{ background: INK, color: '#fff' }}>Play again</button><a href="/practice" className={`${BTN} inline-flex items-center border`} style={{ borderColor: LINE }}>Other practice</a></div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-[#fff] px-4 py-3 sm:px-6" style={{ borderColor: LINE }}>
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-[20px] font-semibold">Practice: Friday rush</h1><span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: BLUE_TINT, color: BLUE }}>Nothing here is real</span></div>
          <p className="text-[13.5px]" style={{ color: MUTED }}>{R.clockOf(s.t)}. {Math.floor(s.t)} {Math.floor(s.t) === 1 ? "minute" : "minutes"} in, {Math.max(0, Math.ceil(R.RUSH_MIN - s.t))} to go.</p>
        </div>
        <dl className="flex gap-5">
          {[['Seated', `${sc.seated}`, INK], ['Longest wait', `${sc.longestWait} min`, sc.longestWait > 20 ? AMBER : INK], ['Turned', `${sc.turned}`, INK], ['Happy', `${sc.happy}%`, sc.happy >= 80 ? GREEN : AMBER]].map(([k, v, c]) => (
            <div key={k} className="flex flex-col-reverse"><dt className="text-[12px]" style={{ color: MUTED }}>{k}</dt><dd className="text-[19px] font-semibold tabular-nums" style={{ color: c }}>{v}</dd></div>))}
        </dl>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRunning((r) => !r)} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>{running ? 'Pause' : 'Play'}</button>
          <button type="button" aria-pressed={speed === 2} onClick={() => setSpeed((x) => (x === 2 ? 1 : 2))} className={BTN} style={speed === 2 ? { background: INK, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>2×</button>
        </div>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
        <main className="space-y-3 rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}` }}>
          {pick && <p className="rounded-2xl px-4 py-2.5 text-[14px] font-medium" style={{ background: BLUE_TINT, color: BLUE }}>Seating {s.parties[pick]?.name}, {s.parties[pick]?.size}: tap a free table. <button type="button" onClick={() => setPick(null)} className="ml-1 min-h-[44px] font-semibold underline underline-offset-4">Never mind</button></p>}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {s.tables.map((t) => { const f = floor.find((x) => x.id === t.id)!; const p = at(t.id); const st = stages[t.id]; const free = !f.occupied;
              const fits = pick ? (s.parties[pick]?.size || 0) <= t.seatCount && (s.parties[pick]?.needs || []).every((n) => t.tags.includes(n)) : true;
              return (
                <button key={t.id} type="button" onClick={() => tapTable(t.id)} disabled={!!pick && (!free || !fits)} aria-label={`Table ${t.name}${free ? ', free' : ''}`}
                  className="flex min-h-[112px] flex-col gap-1 rounded-2xl bg-[#fff] p-3 text-left disabled:opacity-45"
                  style={{ border: free ? `2px solid ${GREEN}` : f.clearing ? `1px dashed ${MUTED}` : `1px solid ${LINE}` }}>
                  <span className="flex items-baseline justify-between"><b className="text-[16px] font-semibold">{t.name}</b><span className="text-[12px]" style={{ color: MUTED }}>{t.seatCount} seats{t.tags.includes('step-free') ? ', step-free' : t.tags.includes('window') ? ', window' : ''}</span></span>
                  {p ? <span className="text-[12.5px]" style={{ color: MUTED }}>{p.name}, {p.size}</span> : null}
                  <span className="text-[13.5px] font-semibold" style={{ color: free ? GREEN : st && AMBER_KEYS.has(st.key) ? AMBER : f.clearing ? MUTED : INK }}>{free ? 'Free' : f.clearing ? 'Being cleared' : st?.words || 'Seated'}</span>
                  {st && <span className="flex gap-[3px]" aria-hidden>{Array.from({ length: 5 }, (_, i) => <i key={i} className="block h-[5px] flex-1 rounded" style={{ background: i < st.step ? INK : LINE }} />)}</span>}
                  {!free && f.freeIn !== null && <span className="text-[12px]" style={{ color: MUTED }}>Free about {R.clockOf(s.t + f.freeIn)}</span>}
                </button>); })}
          </div>
          {(said || (s.coach && s.t - s.coachAt < 8)) && <p role="status" className="rounded-2xl px-4 py-3 text-[14px] leading-snug" style={{ background: said ? AMBER_TINT : SOFT, color: said ? AMBER : INK }}>{said ? said : <><b className="font-semibold">Coach: </b>{s.coach}</>}</p>}
        </main>

        <aside className="space-y-4">
          <section aria-labelledby="w" className="rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}` }}>
            <h2 id="w" className="pb-1 text-[16px] font-semibold">Waiting</h2>
            {waiting.length === 0 && <p className="py-2 text-[14px]" style={{ color: MUTED }}>Nobody’s waiting.</p>}
            {waiting.map((p) => { const w = waitedOf(p); const over = p.quotedMinutes !== null && w > p.quotedMinutes; const sg = sugg.find((x) => x.partyId === p.id);
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
                  <div className="min-w-[150px] flex-1">
                    <p className="text-[15px] font-semibold">{p.name}, {p.size}{p.kind === 'booking' && p.bookedFor !== null ? <span className="font-normal" style={{ color: MUTED }}> booked {R.clockOf(p.bookedFor)}</span> : null}</p>
                    <p className="text-[13px]" style={{ color: over ? AMBER : MUTED }}>{w} min{p.quotedMinutes !== null ? `, told ${p.quotedMinutes}` : ''}{p.asks.length ? `. ${p.asks.join(', ')}` : ''}</p>
                  </div>
                  {sg && sg.action === 'seat' ? <button type="button" onClick={() => seat(p.id, sg.tableId)} className={BTN} style={{ background: INK, color: '#fff' }}>Seat at {sg.tableName}</button> : null}
                  <button type="button" aria-pressed={pick === p.id} onClick={() => setPick(pick === p.id ? null : p.id)} className={BTN} style={pick === p.id ? { background: BLUE, color: '#fff' } : { border: `1px solid ${LINE}`, background: '#fff' }}>{pick === p.id ? 'Picking…' : 'Pick a table'}</button>
                </div>); })}
          </section>
          <section aria-labelledby="n" className="rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}` }}>
            <h2 id="n" className="pb-1 text-[16px] font-semibold">Needs you</h2>
            {needs.length === 0 && <p className="py-2 text-[14px]" style={{ color: MUTED }}>All good for now.</p>}
            {needs.map((n) => (
              <div key={n.key} className="flex flex-wrap items-center gap-2 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: n.kind === 'no_show' ? BLUE : AMBER }} aria-hidden />
                <p className={`min-w-[160px] flex-1 text-[14px] leading-snug ${n.urgent ? 'font-semibold' : 'font-medium'}`}>{n.text}</p>
                <button type="button" onClick={() => act(n.key)} className={BTN} style={{ background: INK, color: '#fff' }}>{n.action}</button>
                {n.kind === 'no_show' && <button type="button" onClick={() => { R.letGoNoShow(s, n.partyId); redraw(); }} className={BTN} style={{ border: `1px solid ${LINE}`, background: '#fff' }}>Let it go</button>}
              </div>))}
          </section>
          <section aria-label="What happened" className="rounded-3xl bg-[#fff] p-4" style={{ border: `1px solid ${LINE}` }}>
            <h2 className="pb-1 text-[16px] font-semibold">What happened</h2>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-[13.5px]">
              {s.log.slice(0, 12).map((l, i) => <li key={i} style={{ color: l.tone === 'bad' || l.tone === 'warn' ? AMBER : MUTED, fontWeight: l.tone === 'bad' ? 600 : 400 }}><span className="tabular-nums">{R.clockOf(l.t)}</span> {l.text}</li>)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
