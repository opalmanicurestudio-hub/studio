'use client';
// src/app/(app)/briefing/page.tsx — THE PRE-SHIFT BRIEFING (design canvas "Pre-shift briefing and staffing";
// lib/briefing, api/briefing). Today's or tomorrow's, written from the bookings, the event, a usual night, the regulars
// and their allergies, the prep list, what's sold out and the schedule: the guests expected and when, staffing hour by
// hour against who's on, the bookings worth knowing, the kitchen, who's working, a note from the manager, and "Got it".
// Prints on one page.
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useTenant } from '@/context/TenantContext';
import { hourWords, JOB_COLUMN, COUNTED, type HourRow, type StaffingSettings, type ToKnow } from '@/lib/briefing';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-50 ${RING}`;
type B = {
  day: string; days: string[]; tonight: boolean;
  guests: { expected: number | null; booked: number; bookings: number; walkIns: number | null; usual: number | null; basis: string; eventGuests: number; byHour: { hour: number; guests: number }[]; peak: number | null; walkInsByHour: boolean };
  staffing: { rows: HourRow[]; short: string[]; over: string[]; shortHours: number; settings: StaffingSettings; unknown: string[]; stayMin: number };
  working: { staffId: string; name: string; job: string; from: string; to: string }[];
  events: { title: string; time: string; guests: number }[]; toKnow: ToKnow[];
  kitchen: { prepTotal: number; prepLeft: number; prepNames: string[]; soldOut: string[]; low: string[] };
  note: { text: string; by: string; at: string } | null;
  read: { mine: boolean; names: string[]; notYet: string[]; others: number };
};

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  try { const r = await fetch('/api/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}
const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const clock = (hm: string) => { const [h, m] = hm.split(':').map(Number); if (!Number.isFinite(h)) return hm; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const card = 'rounded-2xl border bg-[#fff] p-4 sm:p-5 break-inside-avoid';

export default function BriefingPage() {
  const { selectedTenant } = useTenant() as any;
  const tenantId: string | null = selectedTenant?.id || null;
  const [day, setDay] = useState<string | null>(null);
  const [b, setB] = useState<B | null>(null); const [manager, setManager] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false); const [noteText, setNoteText] = useState('');
  const [numsOpen, setNumsOpen] = useState(false); const [nums, setNums] = useState<StaffingSettings | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const d = await post({ tenantId, action: 'view', ...(day ? { day } : {}) });
    if (d.ok) { setB(d.briefing); setManager(!!d.manager); setErr(''); } else setErr(d.error || 'That didn’t load. Try again.');
  }, [tenantId, day]);
  useEffect(() => { void load(); }, [load]);

  const act = async (what: string, body: any) => {
    if (!tenantId || !b) return; setBusy(what);
    const d = await post({ tenantId, day: b.day, ...body }); setBusy(null);
    if (!d.ok) { setErr(d.error || 'That didn’t save. Try again.'); return false; }
    await load(); return true;
  };
  if (!tenantId) return null;
  if (!b) return <div className="p-6 text-[15px]" style={{ color: err ? AMBER : MUTED }}>{err || 'Putting tonight’s briefing together…'}</div>;
  const g = b.guests; const s = b.staffing;
  const cols = COUNTED.filter((j) => s.rows.some((r) => r.need[j] > 0 || r.have[j] > 0));
  const maxH = Math.max(1, ...g.byHour.map((x) => x.guests));
  const usualWord = new Date(`${b.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" style={{ color: INK }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13.5px]" style={{ color: MUTED }}>{dayWords(b.day)}</p>
          <h1 className="text-[24px] font-semibold tracking-tight">{b.tonight ? 'Tonight’s briefing' : 'Tomorrow’s briefing'}</h1>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {b.days.map((d, i) => <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={b.day === d} className={btn} style={b.day === d ? { background: INK, color: '#fff' } : { background: '#fff', border: `1px solid ${LINE}` }}>{i === 0 ? 'Today' : 'Tomorrow'}</button>)}
          <button type="button" onClick={() => window.print()} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Print</button>
        </div>
      </header>
      {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px] print:hidden" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <section aria-labelledby="b-guests" className={card} style={{ borderColor: LINE }}>
            <div className="flex items-center justify-between gap-2"><h2 id="b-guests" className="text-[14px]" style={{ color: MUTED }}>Expected guests</h2><span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: SOFT, color: MUTED }}>An estimate</span></div>
            <p className="mt-1 text-[28px] font-semibold tabular-nums tracking-tight">{g.expected === null ? `${g.booked} booked` : `About ${g.expected + g.eventGuests}`}</p>
            <p className="text-[13.5px] leading-snug" style={{ color: MUTED }}>
              {g.booked} booked in {g.bookings} {g.bookings === 1 ? 'booking' : 'bookings'}{g.walkIns !== null ? `, and about ${g.walkIns} walk-ins like a usual ${usualWord}` : ''}{g.eventGuests ? `, plus ${g.eventGuests} at the ${b.events.length > 1 ? 'events' : 'event'}` : ''}.
              {g.peak !== null ? ` Busiest ${hourWords(g.peak)} to ${hourWords(g.peak + 1)}.` : ''}{g.expected === null ? ' There’s no usual night to go by yet, so walk-ins aren’t counted.' : ''}{g.expected !== null && !g.walkInsByHour ? ' Hour by hour counts the bookings only.' : ''}
            </p>
            {g.byHour.length > 0 && <div className="mt-3" aria-hidden>
              <div className="flex h-16 items-end gap-1.5">{g.byHour.map((x) => <div key={x.hour} className="flex-1 rounded-[4px]" style={{ height: `${Math.max(8, (x.guests / maxH) * 100)}%`, background: INK, opacity: x.hour === g.peak ? 1 : 0.55 }} />)}</div>
              <div className="mt-1 flex gap-1.5 text-[11.5px]" style={{ color: MUTED }}>{g.byHour.map((x) => <span key={x.hour} className="flex-1 text-center tabular-nums">{x.hour % 12 || 12}</span>)}</div>
            </div>}
          </section>

          <section aria-labelledby="b-know" className={card} style={{ borderColor: LINE }}>
            <h2 id="b-know" className="text-[15px] font-semibold">Bookings to know</h2>
            {b.toKnow.length === 0 ? <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Nothing special in the bookings.</p> : <ul className="mt-2 space-y-2.5">{b.toKnow.map((k, i) => (
              <li key={i} className="space-y-1">
                <p className="flex flex-wrap items-center justify-between gap-2 text-[14px]"><span><span className="font-semibold tabular-nums">{clock(k.time)}</span> {k.name}, {k.size}</span>
                  <span className="flex flex-wrap gap-1.5">{k.tags.map((t, j) => <span key={j} className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={t.warn ? { background: AMBER_TINT, color: AMBER } : { background: SOFT, color: MUTED }}>{t.text}</span>)}</span></p>
                {k.detail && <p className="text-[13px] leading-snug" style={{ color: MUTED }}>{k.detail}</p>}
              </li>))}</ul>}
            <p className="mt-2 text-[12.5px] leading-snug" style={{ color: MUTED }}>Allergies and usuals show only for guests the team already knows. Always ask at the table.</p>
          </section>

          {b.events.length > 0 && <section aria-labelledby="b-events" className={card} style={{ borderColor: LINE }}>
            <h2 id="b-events" className="text-[15px] font-semibold">{b.events.length === 1 ? 'Event' : 'Events'}</h2>
            {b.events.map((e, i) => <p key={i} className="mt-1 flex justify-between gap-3 text-[14px]"><span>{e.time ? `${e.title}, ${clock(e.time)}` : e.title}</span><span className="tabular-nums">{e.guests} guests</span></p>)}
          </section>}
        </div>

        <div className="space-y-4">
          <section aria-labelledby="b-staff" className={card} style={{ borderColor: LINE }}>
            <div className="flex items-center justify-between gap-2"><h2 id="b-staff" className="text-[15px] font-semibold">Staffing</h2>
              {s.shortHours > 0 ? <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Short {s.shortHours} {s.shortHours === 1 ? 'hour' : 'hours'}</span>
                : s.rows.length > 0 && <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Covered</span>}</div>
            <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>From the guests expected, against who’s scheduled. Scheduled of needed.</p>
            {s.rows.length === 0 ? <p className="mt-2 text-[14px]" style={{ color: MUTED }}>No guests expected and nobody scheduled yet.</p> : (
              <div className="mt-2 overflow-x-auto"><table className="w-full text-[13.5px]">
                <thead><tr style={{ color: MUTED }}><th className="py-1.5 pr-2 text-left font-semibold">Hour</th><th className="py-1.5 pr-2 text-left font-semibold">Guests</th>{cols.map((j) => <th key={j} className="py-1.5 pr-2 text-left font-semibold">{JOB_COLUMN[j]}</th>)}</tr></thead>
                <tbody>{s.rows.map((r) => <tr key={r.hour} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{hourWords(r.hour)}</td><td className="py-1.5 pr-2 tabular-nums">{r.guests}</td>
                  {cols.map((j) => { const shortBy = r.need[j] - r.have[j]; return <td key={j} className="whitespace-nowrap py-1.5 pr-2 tabular-nums" style={shortBy > 0 ? { color: AMBER, fontWeight: 600 } : undefined}>{r.have[j]} of {r.need[j]}</td>; })}</tr>)}</tbody>
              </table></div>)}
            {s.short.length > 0 && <p className="mt-2 text-[13.5px]"><span className="font-semibold" style={{ color: AMBER }}>Short:</span> {list(s.short)}.</p>}
            {s.over.length > 0 && <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Could spare: {list(s.over)}.</p>}
            {s.unknown.length > 0 && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>{list(s.unknown)} {s.unknown.length === 1 ? 'isn’t' : 'aren’t'} counted: add a job title (server, cook, bartender, host) on the staff page.</p>}
            <p className="mt-1 text-[13px]" style={{ color: MUTED }}>Based on {s.settings.perServer} guests a server, {s.settings.perCook} an hour a cook, {s.settings.perBartender} a bartender, a host from {s.settings.hostAt} an hour, and a usual stay of {s.stayMin} minutes.</p>
            {manager && <div className="mt-2 print:hidden">
              {!numsOpen ? <button type="button" onClick={() => { setNums(s.settings); setNumsOpen(true); }} className={`${btn} px-0 underline underline-offset-4`} style={{ color: INK }}>Change these numbers</button> : nums && (
                <form className="mt-2 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await act('nums', { action: 'staffing', staffing: nums })) setNumsOpen(false); }}>
                  {([['perServer', 'Guests a server looks after'], ['perCook', 'Guests an hour a cook can feed'], ['perBartender', 'Guests a bartender looks after'], ['hostAt', 'A host from this many arriving an hour']] as [keyof StaffingSettings, string][]).map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between gap-3 text-[14px]"><span>{label}</span>
                      <input type="number" inputMode="numeric" value={nums[k]} onChange={(e) => setNums({ ...nums, [k]: Number(e.target.value) })} className={`h-11 w-24 rounded-xl border px-3 text-[15px] ${RING}`} style={{ borderColor: LINE }} /></label>))}
                  <div className="flex gap-2"><button type="submit" disabled={busy === 'nums'} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'nums' ? 'Saving…' : 'Save'}</button>
                    <button type="button" onClick={() => setNumsOpen(false)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Cancel</button></div>
                </form>)}
            </div>}
          </section>

          <section aria-labelledby="b-work" className={card} style={{ borderColor: LINE }}>
            <h2 id="b-work" className="text-[15px] font-semibold">Who’s working</h2>
            {b.working.length === 0 ? <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>Nobody is on the schedule for this day yet.</p>
              : <ul className="mt-1.5 space-y-1">{b.working.map((w, i) => <li key={i} className="flex justify-between gap-3 text-[14px]"><span>{w.name}{w.job !== 'team' ? `, ${w.job}` : ''}</span><span className="tabular-nums" style={{ color: MUTED }}>{clock(w.from)} to {clock(w.to)}</span></li>)}</ul>}
          </section>
        </div>

        <div className="space-y-4">
          <section aria-labelledby="b-kitchen" className={card} style={{ borderColor: LINE }}>
            <h2 id="b-kitchen" className="text-[15px] font-semibold">Kitchen</h2>
            <p className="mt-1 flex justify-between gap-3 text-[14px]"><span>Prep still to do</span><span className="tabular-nums">{b.kitchen.prepTotal ? `${b.kitchen.prepLeft} of ${b.kitchen.prepTotal}` : 'Nothing on the list'}</span></p>
            {b.kitchen.prepNames.length > 0 && <p className="text-[13px]" style={{ color: MUTED }}>{b.kitchen.prepNames.join(', ')}</p>}
            {b.tonight && <>
              <p className="mt-2 flex flex-wrap justify-between gap-2 text-[14px]"><span>Sold out</span><span className="font-semibold" style={{ color: b.kitchen.soldOut.length ? AMBER : MUTED }}>{b.kitchen.soldOut.length ? b.kitchen.soldOut.join(', ') : 'Nothing'}</span></p>
              {b.kitchen.low.length > 0 && <p className="flex flex-wrap justify-between gap-2 text-[14px]"><span>Running low</span><span style={{ color: MUTED }}>{b.kitchen.low.join(', ')}</span></p>}
            </>}
          </section>

          <section aria-labelledby="b-note" className={card} style={{ borderColor: LINE }}>
            <h2 id="b-note" className="text-[15px] font-semibold">From the manager</h2>
            {!noteOpen && (b.note ? <><p className="mt-1 whitespace-pre-line text-[14.5px] leading-relaxed">{b.note.text}</p><p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>{b.note.by}, {new Date(b.note.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}</p></>
              : <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{manager ? 'Add tonight’s specials, what to push, anything closed.' : 'No note yet.'}</p>)}
            {manager && !noteOpen && <button type="button" onClick={() => { setNoteText(b.note?.text || ''); setNoteOpen(true); }} className={`${btn} mt-1 px-0 underline underline-offset-4 print:hidden`} style={{ color: INK }}>{b.note ? 'Change the note' : 'Write a note'}</button>}
            {noteOpen && <form className="mt-2 space-y-2 print:hidden" onSubmit={async (e) => { e.preventDefault(); if (await act('note', { action: 'note', text: noteText })) setNoteOpen(false); }}>
              <textarea aria-label="Note for the team" value={noteText} onChange={(e) => setNoteText(e.target.value.slice(0, 1000))} rows={4} className={`w-full rounded-xl border p-3 text-[15px] ${RING}`} style={{ borderColor: LINE }} placeholder="New dessert tonight. Patio’s closed." />
              <div className="flex gap-2"><button type="submit" disabled={busy === 'note'} className={btn} style={{ background: INK, color: '#fff' }}>{busy === 'note' ? 'Saving…' : 'Save the note'}</button>
                <button type="button" onClick={() => setNoteOpen(false)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Cancel</button></div>
            </form>}
          </section>

          <section aria-labelledby="b-read" className={`${card} print:hidden`} style={{ borderColor: LINE }}>
            <div className="flex items-center justify-between gap-2"><h2 id="b-read" className="text-[15px] font-semibold">Read by</h2>
              {b.working.length > 0 && <span className="text-[13px] tabular-nums" style={{ color: MUTED }}>{b.read.names.length} of {b.read.names.length + b.read.notYet.length}</span>}</div>
            <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{b.read.names.length ? `${list(b.read.names)}.` : 'Nobody yet.'}{b.read.notYet.length ? ` Not yet: ${list(b.read.notYet)}.` : ''}</p>
            <button type="button" disabled={b.read.mine || busy === 'read'} onClick={() => void act('read', { action: 'read' })} className={`${btn} mt-3 w-full`} style={b.read.mine ? { background: GREEN_TINT, color: GREEN } : { background: INK, color: '#fff' }}>{b.read.mine ? 'You’ve read it' : busy === 'read' ? 'Saving…' : 'Got it'}</button>
          </section>
          <p className="text-[12.5px] print:hidden" style={{ color: MUTED }}>Written from the bookings, {b.events.length > 1 ? 'the events, ' : b.events.length ? 'the event, ' : ''}a usual {usualWord}, your regulars, the prep list and the schedule. Guests and staffing are estimates.</p>
        </div>
      </div>
    </div>
  );
}
