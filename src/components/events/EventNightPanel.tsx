'use client';
// src/components/events/EventNightPanel.tsx — EVENT NIGHT on the event's manifest page (design canvas "Event night";
// lib/event-night, api/event-night): the run of show with what's done and what's next, course pacing from the
// kitchen's tickets, and the prep from the guests' choices. A manager sets the run of show and pushes it on the night;
// firing a course goes through the manifest's own fire (its check of who's in and what they chose).
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { Moment, Pacing } from '@/lib/event-night';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', RED = '#b42318';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
const card = 'rounded-2xl border bg-[#fff] p-4 sm:p-5';
const chip = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold';

type Night = {
  event: { id: string; title: string; date: string; time: string | null; status: string };
  show: Moment[]; saved: boolean; courses: { n: number; name: string }[]; fired: number[];
  onTheNight: boolean; now: string;
  state: { states: Record<string, 'done' | 'next' | 'later'>; next: Moment | null; inMin: number | null } | null;
  pacing: Pacing | null;
  prep: { guests: number; dishes: { id: string; name: string; course: number; portions: number }[]; unchosen: number; allergies: { name: string; count: number }[]; diets: { name: string; count: number }[] };
};

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/event-night', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const clock = (hm: string) => { const [h, m] = hm.split(':').map(Number); if (!Number.isFinite(h)) return hm; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; };
const minWords = (n: number) => (n === 1 ? '1 min' : `${n} min`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const PACE: Record<Pacing['state'], { text: string; tone: 'green' | 'amber' | 'soft' }> = {
  waiting: { text: 'Not started', tone: 'soft' }, on_pace: { text: 'On pace', tone: 'green' }, fire_now: { text: 'Fire now', tone: 'amber' },
  hold: { text: 'Hold', tone: 'amber' }, ready: { text: 'Ready', tone: 'green' }, done: { text: 'All fired', tone: 'soft' },
};
const toneStyle = (t: 'green' | 'amber' | 'soft' | 'ink') => (t === 'green' ? { background: GREEN_TINT, color: GREEN } : t === 'amber' ? { background: AMBER_TINT, color: AMBER } : t === 'ink' ? { background: INK, color: '#fff' } : { background: SOFT, color: MUTED });

export default function EventNightPanel({ tenantId, eventId, firedKey, onFire }: { tenantId: string; eventId: string; firedKey?: string; onFire?: (course: number) => void }) {
  const [n, setN] = useState<Night | null>(null); const [manager, setManager] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Moment[] | null>(null);

  const load = useCallback(async (fresh = false) => {
    const d = await post({ tenantId, eventId, action: 'view', ...(fresh ? { fresh: true } : {}) });
    if (d.ok) { setN(d.night); setManager(!!d.manager); setErr(''); } else setErr(d.error || 'The event night didn’t load. Try again.');
  }, [tenantId, eventId]);
  useEffect(() => { load(true); }, [load, firedKey]);
  // On the night it keeps itself up to date, once a minute while the page is in view.
  const live = !!n?.onTheNight;
  useEffect(() => {
    if (!live) return;
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const back = () => { if (document.visibilityState === 'visible') load(true); };
    const t = setInterval(tick, 60000); document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [live, load]);

  const act = async (key: string, body: any) => {
    setBusy(key); const d = await post({ tenantId, eventId, ...body }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t save. Try again.'); return false; }
    setErr(''); await load(); return true;
  };

  if (!n) return err ? <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p> : null;
  const st = n.state; const next = st?.next || null; const p = n.pacing;
  const nextCourse = next && next.course !== null && !n.fired.includes(next.course) ? next.course : null;
  const headChip = !n.onTheNight ? { text: 'The plan', tone: 'soft' as const }
    : !next ? { text: 'All done', tone: 'soft' as const }
    : st!.inMin! < -1 ? { text: `${minWords(-st!.inMin!)} late`, tone: 'amber' as const }
    : { text: st!.inMin! <= 0 ? 'Next now' : `Next in ${minWords(st!.inMin!)}`, tone: 'ink' as const };
  const courseName = (c: number) => n.show.find((m) => m.course === c)?.what || n.courses.find((x) => x.n === c)?.name || `Course ${c}`;
  const byCourse = n.courses.map((c) => ({ ...c, dishes: n.prep.dishes.filter((d) => d.course === c.n) })).filter((c) => c.dishes.length);

  return (
    <section aria-labelledby="en-title" className="space-y-3" style={{ color: INK }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="en-title" className="text-[18px] font-semibold">Event night</h2>
        {n.onTheNight && <p className="text-[13px] tabular-nums" style={{ color: MUTED }}>It’s {clock(n.now)}</p>}
      </div>
      {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className={card} style={{ borderColor: LINE }}>
          <div className="flex items-center justify-between gap-2"><h3 className="text-[15px] font-semibold">Run of show</h3><span className={chip} style={toneStyle(headChip.tone)}>{headChip.text}</span></div>
          {!n.saved && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>A first plan from the start time and the courses.{manager ? ' Change it to match your night.' : ''}</p>}
          {edit ? (
            <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await act('save', { action: 'show', show: edit })) setEdit(null); }}>
              {edit.map((m, i) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 border-b pb-2" style={{ borderColor: LINE }}>
                  <label className="sr-only" htmlFor={`en-at-${m.id}`}>Time</label>
                  <input id={`en-at-${m.id}`} type="time" required value={m.at} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)))} className={`min-h-[44px] w-[118px] rounded-xl border px-2 text-[14px] tabular-nums ${RING}`} style={{ borderColor: LINE }} />
                  <label className="sr-only" htmlFor={`en-what-${m.id}`}>What happens</label>
                  <input id={`en-what-${m.id}`} required maxLength={80} value={m.what} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)))} className={`min-h-[44px] min-w-[150px] flex-1 basis-[180px] rounded-xl border px-3 text-[14px] ${RING}`} style={{ borderColor: LINE }} />
                  <label className="sr-only" htmlFor={`en-course-${m.id}`}>Course</label>
                  <select id={`en-course-${m.id}`} value={m.course ?? ''} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, course: e.target.value ? Number(e.target.value) : null } : x)))} className={`min-h-[44px] grow basis-[150px] rounded-xl border bg-[#fff] px-2 text-[14px] ${RING}`} style={{ borderColor: LINE }}>
                    <option value="">Not a course</option>{n.courses.map((c) => <option key={c.n} value={c.n}>Fires {c.name.toLowerCase()}</option>)}
                  </select>
                  <button type="button" onClick={() => setEdit(edit.filter((_, j) => j !== i))} className={`${btn} px-3`} style={{ color: RED }} aria-label={`Remove ${m.what || 'this moment'}`}>Remove</button>
                </div>))}
              <div className="flex flex-wrap gap-2 pt-1">
                {edit.length < 20 && <button type="button" onClick={() => setEdit([...edit, { id: `n${Date.now().toString(36).slice(-6)}`, at: edit[edit.length - 1]?.at || n.event.time || '19:00', what: '', course: null, note: null }])} className={btn} style={{ border: `1px solid ${LINE}` }}>Add a moment</button>}
                <button type="submit" disabled={busy === 'save'} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'save' ? 'Saving' : 'Save the run of show'}</button>
                <button type="button" onClick={() => setEdit(null)} className={btn} style={{ color: MUTED }}>Cancel</button>
              </div>
            </form>
          ) : (
            <ol className="mt-3 space-y-1">
              {n.show.map((m) => { const s = st?.states[m.id] || 'later'; const isNext = s === 'next';
                return (
                  <li key={m.id} aria-current={isNext ? 'step' : undefined} className="grid grid-cols-[64px_1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-[14px]" style={isNext ? { background: SOFT } : undefined}>
                    <span className={`tabular-nums ${isNext ? 'font-semibold' : ''}`} style={s === 'done' ? { color: MUTED } : undefined}>{clock(m.at)}</span>
                    <span className={`min-w-0 ${isNext ? 'font-semibold' : ''}`} style={s === 'done' ? { color: MUTED } : undefined}>{m.what}{m.note ? <span className="block text-[12.5px] font-normal" style={{ color: MUTED }}>{m.note}</span> : null}</span>
                    <span className="text-[12.5px]" style={{ color: MUTED }}>{s === 'done' ? (m.course !== null ? 'Fired' : 'Done') : isNext ? <span className={chip} style={toneStyle(m.course !== null ? 'amber' : 'soft')}>{m.course !== null ? `Fire at ${clock(m.at)}` : 'Next'}</span> : ''}</span>
                  </li>); })}
            </ol>
          )}
          {!edit && (
            <div className="mt-3 flex flex-wrap gap-2">
              {n.onTheNight && nextCourse !== null && onFire && <button type="button" onClick={() => onFire(nextCourse)} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>Fire {courseName(nextCourse).toLowerCase()}</button>}
              {n.onTheNight && manager && next && <button type="button" disabled={busy === 'push'} onClick={() => act('push', { action: 'push', minutes: 10 })} className={btn} style={{ border: `1px solid ${LINE}` }}>{busy === 'push' ? 'Pushing' : 'Push 10 min'}</button>}
              {manager && <button type="button" onClick={() => setEdit(n.show.map((m) => ({ ...m })))} className={`${btn} px-0 underline underline-offset-4`} style={{ color: INK }}>Change the run of show</button>}
            </div>
          )}
        </div>

        <div className={card} style={{ borderColor: LINE }}>
          <div className="flex items-center justify-between gap-2"><h3 className="text-[15px] font-semibold">Course pacing</h3>{p && <span className={chip} style={toneStyle(PACE[p.state].tone)}>{PACE[p.state].text}</span>}</div>
          {!n.onTheNight ? <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Shows on the night, from the kitchen’s tickets: how much of each course is out, and when to fire the next.</p> : p && (<>
            {p.course !== null && p.total > 0 && <>
              <p className="mt-2 flex justify-between text-[14px]"><span>{courseName(p.course)} out</span><span className="tabular-nums">{p.out} of {p.total} plates</span></p>
              <div className="mt-1 h-2 overflow-hidden rounded" style={{ background: SOFT }} aria-hidden><div className="h-2" style={{ width: `${Math.round((p.out / p.total) * 100)}%`, background: GREEN }} /></div>
            </>}
            {p.atPass > 0 && <p className="mt-1 text-[13px] tabular-nums" style={{ color: AMBER }}>{p.atPass} {p.atPass === 1 ? 'plate is' : 'plates are'} ready at the pass.</p>}
            <p role="status" className="mt-2 text-[13.5px] leading-snug" style={{ color: p.state === 'hold' || p.state === 'fire_now' ? INK : MUTED }}>{p.words}</p>
            {p.next !== null && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>A course has taken the kitchen about {p.kitchenMin} minutes tonight.</p>}
          </>)}
        </div>

        <div className={card} style={{ borderColor: LINE }}>
          <div className="flex items-center justify-between gap-2"><h3 className="text-[15px] font-semibold">Prep for the event</h3><span className="text-[13px] tabular-nums" style={{ color: MUTED }}>{n.prep.guests} {n.prep.guests === 1 ? 'guest' : 'guests'}</span></div>
          {byCourse.length === 0 ? <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Add the event’s menu to see portions here.</p> : byCourse.map((c) => (
            <div key={c.n} className="mt-2">
              <p className="text-[12.5px] font-semibold" style={{ color: MUTED }}>{c.name}</p>
              {c.dishes.map((d) => <p key={d.id} className="flex justify-between gap-3 text-[14px]"><span className="min-w-0">{d.name}</span><span className="tabular-nums">{d.portions} {d.portions === 1 ? 'portion' : 'portions'}</span></p>)}
            </div>))}
          {n.prep.unchosen > 0 && <p className="mt-2 text-[13px]" style={{ color: AMBER }}>{n.prep.unchosen} {n.prep.unchosen === 1 ? 'choice is' : 'choices are'} still to be made.</p>}
          {(n.prep.allergies.length > 0 || n.prep.diets.length > 0) && <p className="mt-2 text-[13px] leading-snug" style={{ color: MUTED }}>
            {n.prep.allergies.length > 0 && <>Allergies in the room: {list(n.prep.allergies.map((a) => `${a.name} (${a.count})`))}. </>}
            {n.prep.diets.length > 0 && <>Diets: {list(n.prep.diets.map((a) => `${a.name} (${a.count})`))}.</>}
          </p>}
        </div>
      </div>
    </section>
  );
}
