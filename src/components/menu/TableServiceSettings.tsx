'use client';
// src/components/menu/TableServiceSettings.tsx — TABLES, KITCHEN AND BAR on the Menu page (managers): the stations
// things are made at (each gets its own kitchen screen), the courses (and which wait until the server fires them), how
// much a server can comp in a night on their own say, and the comp reasons offered. Saved through api/menu 'service';
// the rules themselves are lib/table-service.
import { useEffect, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', RED = '#b42318';
export type Service = { courses: { n: number; name: string; hold: boolean }[]; stations: string[]; compAllowanceCents: number; compReasons: string[] };
const ALLOWANCES = [0, 500, 1000, 1500, 2000, 2500, 5000, 10000];
const dollars = (c: number) => (c === 0 ? 'Nothing, always a manager' : `Up to $${(c / 100).toFixed(0)}`);

export function TableServiceSettings({ service, onSave }: { service: Service; onSave: (next: Partial<Service>) => Promise<string | null> }) {
  const [stations, setStations] = useState<string[]>(service.stations);
  const [courses, setCourses] = useState(service.courses.map((c) => ({ name: c.name, hold: c.hold })));
  const [allow, setAllow] = useState(service.compAllowanceCents);
  const [reasons, setReasons] = useState<string[]>(service.compReasons);
  const [newStation, setNewStation] = useState(''); const [newReason, setNewReason] = useState('');
  const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { setStations(service.stations); setCourses(service.courses.map((c) => ({ name: c.name, hold: c.hold }))); setAllow(service.compAllowanceCents); setReasons(service.compReasons); }, [service]);
  const changed = JSON.stringify([stations, courses, allow, reasons]) !== JSON.stringify([service.stations, service.courses.map((c) => ({ name: c.name, hold: c.hold })), service.compAllowanceCents, service.compReasons]);
  const save = async () => { setBusy(true); setErr(''); setNote('');
    const e = await onSave({ stations, courses: courses.map((c, i) => ({ n: i + 1, name: c.name.trim(), hold: c.hold })), compAllowanceCents: allow, compReasons: reasons });
    setBusy(false); if (e) setErr(e); else setNote('Saved. Screens pick it up within a few seconds.'); };
  const chip = 'inline-flex min-h-[40px] items-center gap-1 rounded-full pl-3 pr-1 text-[13.5px] font-medium';
  const x = (label: string, onClick: () => void) => <button type="button" onClick={onClick} aria-label={label} className="h-9 w-9 rounded-full grid place-items-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>;
  const field = 'h-11 rounded-xl border px-3 text-[15px] outline-none bg-[#fff]';
  return (
    <section aria-labelledby="ts-title" className="rounded-3xl border bg-[#fff] p-5 space-y-5" style={{ borderColor: LINE, color: INK }}>
      <div><h2 id="ts-title" className="text-[18px] font-semibold">Tables, kitchen and bar</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>Where each item is made, how a table’s order goes out, and what a server can comp on their own.</p></div>

      <div className="space-y-2">
        <h3 className="text-[15px] font-semibold">Stations</h3>
        <p className="text-[13px]" style={{ color: MUTED }}>Each one can have its own kitchen screen. Set where an item goes on the item itself; drinks go to the bar by default.</p>
        <div className="flex flex-wrap gap-2 items-center">
          {stations.map((s, i) => <span key={s} className={chip} style={{ background: SOFT }}>{s}{stations.length > 1 && x(`Remove ${s}`, () => setStations(stations.filter((_, j) => j !== i)))}</span>)}
          {stations.length < 12 && <form onSubmit={(e) => { e.preventDefault(); const v = newStation.trim().slice(0, 24); if (v && !stations.some((y) => y.toLowerCase() === v.toLowerCase())) setStations([...stations, v]); setNewStation(''); }} className="flex gap-2">
            <input value={newStation} onChange={(e) => setNewStation(e.target.value)} placeholder="Add a station, like Grill" aria-label="New station" className={`${field} w-52`} style={{ borderColor: LINE }} />
            <button type="submit" disabled={!newStation.trim()} className="min-h-[44px] rounded-xl border px-4 text-[14px] font-semibold disabled:opacity-40" style={{ borderColor: LINE }}>Add</button></form>}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-[15px] font-semibold">Courses</h3>
        <p className="text-[13px]" style={{ color: MUTED }}>Items go to a course by their menu section (Mains, Entrées…) unless set on the item. A held course waits until the server fires it, when the kitchen screen is part of your plan; without it, everything goes right away.</p>
        {courses.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 min-h-[52px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
            <input value={c.name} onChange={(e) => setCourses(courses.map((y, j) => (j === i ? { ...y, name: e.target.value.slice(0, 24) } : y)))} aria-label={`Course ${i + 1} name`} className={`${field} w-44`} style={{ borderColor: LINE }} />
            <div role="radiogroup" aria-label={`${c.name || 'Course'}: when it goes`} className="flex rounded-xl p-1 gap-1" style={{ background: SOFT }}>
              {[[false, 'Right away'], [true, 'Hold until fired']].map(([h, label]) => <button key={String(h)} type="button" role="radio" aria-checked={c.hold === h} onClick={() => setCourses(courses.map((y, j) => (j === i ? { ...y, hold: h as boolean } : y)))}
                className="min-h-[38px] rounded-lg px-3 text-[13px] font-semibold" style={c.hold === h ? { background: '#fff', color: INK } : { color: MUTED }}>{label as string}</button>)}
            </div>
            {courses.length > 1 && <button type="button" onClick={() => setCourses(courses.filter((_, j) => j !== i))} className="min-h-[44px] px-3 text-[13.5px] font-semibold" style={{ color: MUTED }}>Remove</button>}
          </div>
        ))}
        {courses.length < 6 && <button type="button" onClick={() => setCourses([...courses, { name: '', hold: true }])} className="min-h-[44px] rounded-xl border px-4 text-[14px] font-semibold" style={{ borderColor: LINE }}>Add a course</button>}
      </div>

      <div className="space-y-2">
        <h3 className="text-[15px] font-semibold">Comps</h3>
        <label className="flex flex-wrap items-center justify-between gap-3">
          <span><span className="block text-[14.5px] font-medium">A server can comp on their own</span><span className="block text-[13px]" style={{ color: MUTED }}>Each night. Over it, a manager’s PIN. Managers aren’t limited.</span></span>
          <select value={allow} onChange={(e) => setAllow(Number(e.target.value))} className={field} style={{ borderColor: LINE }}>
            {Array.from(new Set([...ALLOWANCES, allow])).sort((a, b) => a - b).map((c) => <option key={c} value={c}>{dollars(c)}</option>)}
          </select>
        </label>
        <p className="text-[14.5px] font-medium pt-1">Reasons to pick from</p>
        <div className="flex flex-wrap gap-2 items-center">
          {reasons.map((r, i) => <span key={r} className={chip} style={{ background: SOFT }}>{r}{reasons.length > 1 && x(`Remove ${r}`, () => setReasons(reasons.filter((_, j) => j !== i)))}</span>)}
          {reasons.length < 8 && <form onSubmit={(e) => { e.preventDefault(); const v = newReason.trim().slice(0, 40); if (v && !reasons.includes(v)) setReasons([...reasons, v]); setNewReason(''); }} className="flex gap-2">
            <input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Add a reason" aria-label="New reason" className={`${field} w-44`} style={{ borderColor: LINE }} />
            <button type="submit" disabled={!newReason.trim()} className="min-h-[44px] rounded-xl border px-4 text-[14px] font-semibold disabled:opacity-40" style={{ borderColor: LINE }}>Add</button></form>}
        </div>
        <p className="text-[13px]" style={{ color: MUTED }}>“Something else” is always offered too, with a few words.</p>
      </div>

      {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
      {note && !changed && <p className="text-[14px]" style={{ color: MUTED }} role="status">{note}</p>}
      <button type="button" disabled={!changed || busy || courses.some((c) => !c.name.trim())} onClick={save} className="min-h-[48px] rounded-2xl px-6 text-[15px] font-semibold text-[#fff] disabled:opacity-40" style={{ background: INK }}>Save</button>
    </section>
  );
}
