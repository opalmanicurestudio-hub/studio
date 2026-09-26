'use client';
// src/components/academy/StudentSalon.tsx
//
// STUDENT SALON (licensed-school mode) — the clinic floor for instructors.
// Clients book students through the normal booking page; appointments appear
// here by day. For each service an instructor opens the check-off: scores
// every rubric criterion 1–5, adds before/after photos and notes, then
// Pass (counts toward the student's requirement) or Needs redo (recorded,
// not counted). Checkout won't take a clinic service until it's signed off.

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader } from 'lucide-react';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const shrink = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); const img = new Image();
  r.onload = () => { img.onload = () => { const w = 900, h = Math.round((img.height / img.width) * w); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(img, 0, 0, w, h); resolve(c.toDataURL('image/jpeg', 0.75)); }; img.onerror = reject; img.src = String(r.result); };
  r.onerror = reject; r.readAsDataURL(file);
});

const DAYS: [string, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const mondayOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

/** Weekly duty rota: stations × days. "Fill fairly" rotates everyone evenly. */
function Rotation({ tenantId }: { tenantId: string }) {
  const [week, setWeek] = useState(mondayOf(new Date()));
  const [d, setD] = useState<any>(null);
  const [r, setR] = useState<any>(null);
  const [pick, setPick] = useState<{ day: string; st: string } | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api({ action: 'rotation-get', tenantId, week }).then((x) => { if (!x.ok) return setMsg(x.error); setD(x); setR(x.rotation || { stations: x.defaults.stations, days: x.defaults.days, assignments: {}, published: false }); }); }, [tenantId, week]);
  if (!d || !r) return <Loader className="h-5 w-5 animate-spin" />;
  const name = (id: string) => d.students.find((s: any) => s.id === id)?.name || '—';
  const cell = (day: string, st: string): string[] => r.assignments?.[day]?.[st] || [];
  const setCell = (day: string, st: string, ids: string[]) => setR({ ...r, published: false, assignments: { ...r.assignments, [day]: { ...(r.assignments?.[day] || {}), [st]: ids } } });
  const fill = () => {
    // Everyone gets a station each day; stations rotate so nobody is stuck on one.
    const people = d.students.map((s: any) => s.id); const a: any = {};
    r.days.forEach((day: string, di: number) => { a[day] = {}; r.stations.forEach((st: string) => { a[day][st] = []; });
      people.forEach((pid: string, pi: number) => { const st = r.stations[(pi + di) % r.stations.length]; a[day][st].push(pid); }); });
    setR({ ...r, assignments: a, published: false });
  };
  const save = async (publish: boolean) => { const x = await api({ action: 'rotation-save', tenantId, week, stations: r.stations, days: r.days, assignments: r.assignments, publish }); setMsg(x.ok ? (publish ? 'Published — students see their duty in their portal.' : 'Saved as draft.') : x.error); if (x.ok) setR({ ...r, published: publish }); };
  const print = () => { const w = window.open('', '_blank'); if (!w) return; w.document.write(`<html><head><title>Rotation ${week}</title><style>body{font-family:system-ui;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:12px;vertical-align:top;text-align:left}</style></head><body><h2>Rotation — week of ${week}</h2><table><tr><th></th>${r.days.map((x: string) => `<th>${x.toUpperCase()}</th>`).join('')}</tr>${r.stations.map((st: string) => `<tr><th>${st}</th>${r.days.map((day: string) => `<td>${cell(day, st).map(name).join('<br>')}</td>`).join('')}</tr>`).join('')}</table><script>print()</script></body></html>`); w.document.close(); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { const x = new Date(week); x.setDate(x.getDate() - 7); setWeek(x.toISOString().slice(0, 10)); }} className="h-9 rounded-xl border-2 px-3 text-sm font-bold">←</button>
        <p className="font-black">Week of {new Date(week + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>
        <button type="button" onClick={() => { const x = new Date(week); x.setDate(x.getDate() + 7); setWeek(x.toISOString().slice(0, 10)); }} className="h-9 rounded-xl border-2 px-3 text-sm font-bold">→</button>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.published ? 'published' : 'draft'}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={fill} className="h-9 rounded-xl border-2 px-3 text-sm font-bold">Fill fairly</button>
          <button type="button" onClick={print} className="h-9 rounded-xl border-2 px-3 text-sm font-bold">Print</button>
          <button type="button" onClick={() => save(false)} className="h-9 rounded-xl border-2 px-3 text-sm font-bold">Save draft</button>
          <button type="button" onClick={() => save(true)} className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Publish</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[12px]"><span className="font-bold text-muted-foreground">Days:</span>{DAYS.map(([k, l]) => <button key={k} type="button" onClick={() => setR({ ...r, days: r.days.includes(k) ? r.days.filter((x: string) => x !== k) : DAYS.map(([x]) => x).filter((x) => x === k || r.days.includes(x)) })} className={`rounded-full px-2.5 py-1 font-bold ${r.days.includes(k) ? 'bg-foreground text-background' : 'bg-muted'}`}>{l}</button>)}
        <span className="ml-3 font-bold text-muted-foreground">Stations:</span><input className="h-8 w-80 rounded-lg border px-2" value={r.stations.join(', ')} onChange={(e) => setR({ ...r, stations: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></div>
      {msg && <p className="rounded-2xl bg-emerald-50 p-2 text-sm text-emerald-900">{msg}</p>}
      {d.students.length === 0 ? <p className="text-sm text-muted-foreground">No active students yet.</p> : (
        <div className="overflow-x-auto rounded-2xl border-2 border-border/60"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-2 text-left">Station</th>{r.days.map((x: string) => <th key={x} className="p-2 text-left uppercase">{x}</th>)}</tr></thead>
          <tbody>{r.stations.map((st: string) => <tr key={st} className="border-t align-top"><th className="p-2 text-left">{st}</th>{r.days.map((day: string) => (
            <td key={day} className="p-1.5"><button type="button" onClick={() => setPick({ day, st })} className="min-h-12 w-full rounded-lg bg-muted/40 p-1.5 text-left text-[12px] hover:bg-muted">{cell(day, st).length ? cell(day, st).map((id) => <span key={id} className="block truncate">{name(id)}</span>) : <span className="text-muted-foreground">+ add</span>}</button></td>
          ))}</tr>)}</tbody></table></div>
      )}
      {pick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setPick(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[80dvh] w-full max-w-sm space-y-2 overflow-y-auto rounded-3xl bg-background p-4">
            <p className="font-black">{pick.st} · {pick.day.toUpperCase()}</p>
            {d.students.map((s: any) => { const on = cell(pick.day, pick.st).includes(s.id); return <label key={s.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted/40"><input type="checkbox" checked={on} onChange={() => setCell(pick.day, pick.st, on ? cell(pick.day, pick.st).filter((x) => x !== s.id) : [...cell(pick.day, pick.st), s.id])} />{s.name}</label>; })}
            <button type="button" onClick={() => setPick(null)} className="h-10 w-full rounded-xl bg-foreground text-sm font-bold text-background">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function StudentSalon({ tenantId }: { tenantId: string }) {
  const [view, setView] = useState<'today' | 'rotation'>('today');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState<any[] | null>(null);
  const [programs, setPrograms] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ before?: string; after?: string }>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { setQ(null); const r = await api({ action: 'clinic-queue', tenantId, date: day }); if (r.ok) setQ(r.queue); else setMsg(r.error); }, [tenantId, day]);
  useEffect(() => { void load(); api({ action: 'overview', tenantId }).then((r) => r.ok && setPrograms(r.programs)); }, [load, tenantId]);

  // The rubric for the student's program (falls back to the first program's).
  const rubric = (programs.find((p) => p.id === open?.programId)?.rubric) || (programs[0]?.rubric) || { criteria: [{ label: 'Sanitation & safety' }, { label: 'Technique' }, { label: 'Finish & shape' }, { label: 'Client care' }, { label: 'Time management' }], passAvg: 3 };
  const start = (a: any) => { const rb = programs.find((p) => p.id === a.programId)?.rubric || rubric; setOpen(a); setScores(rb.criteria.map(() => 0)); setNotes(''); setPhotos({}); setMsg(''); };
  const avg = scores.length && scores.every((x) => x > 0) ? Math.round((scores.reduce((n, x) => n + x, 0) / scores.length) * 10) / 10 : null;
  const submit = async (redo: boolean) => {
    setBusy(true);
    const r = await api({ action: 'checkoff', tenantId, appointmentId: open.id, scores, notes, redo, photoBefore: photos.before, photoAfter: photos.after });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(r.passed ? `Signed off — ${r.avg}/5, passed${r.counted ? ` · counts toward ${r.requirement}` : ''}. The service can now be checked out.` : `Recorded as needs redo (${r.avg}/5) — not counted. The client can still be checked out.`);
    setOpen(null); void load();
  };

  const tabs = <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">{([['today', 'Today’s clinic'], ['rotation', 'Rotation']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${view === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>;
  if (view === 'rotation') return <div className="space-y-4">{tabs}<Rotation tenantId={tenantId} /></div>;
  return (
    <div className="space-y-4">
      {tabs}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-10 rounded-xl border-2 px-3 text-sm" />
        <button type="button" onClick={() => void load()} className="h-10 rounded-xl px-3 text-sm font-bold text-muted-foreground">Refresh</button>
        <p className="text-[12px] text-muted-foreground">Clients book students on your booking page. Each service needs your sign-off before checkout.</p>
      </div>
      {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      {!q ? <Loader className="h-5 w-5 animate-spin" /> : q.length === 0 ? <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">No student-salon appointments this day.</p> : (
        <div className="space-y-1.5">{q.map((a) => (
          <div key={a.id} className={`flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 text-sm ${a.checkoff ? (a.checkoff.passed ? 'bg-emerald-50' : 'bg-amber-50') : 'bg-muted/40'}`}>
            <span className="w-16 font-mono text-[12px]">{new Date(a.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span className="min-w-0 flex-1"><span className="font-bold">{a.studentName}</span> · {a.serviceName} · {a.clientName || 'client'} <span className="text-muted-foreground">· {a.status}</span></span>
            {a.checkoff ? <span className="text-[12px] font-bold">{a.checkoff.passed ? `✓ passed ${a.checkoff.avg}/5` : `↺ redo ${a.checkoff.avg}/5`} · {a.checkoff.by}</span>
              : <button type="button" onClick={() => start(a)} className="h-9 rounded-xl bg-foreground px-4 text-[13px] font-bold text-background">Check off</button>}
          </div>
        ))}</div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-3xl bg-background p-5 shadow-2xl">
            <div><p className="text-lg font-black">Check off · {open.studentName}</p><p className="text-sm text-muted-foreground">{open.serviceName} for {open.clientName || 'client'}</p></div>
            {rubric.criteria.map((c: any, i: number) => (
              <div key={i}><p className="text-sm font-bold">{c.label}</p>
                <div className="mt-1 flex gap-1.5">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => { const s = [...scores]; s[i] = n; setScores(s); }} className={`h-10 flex-1 rounded-xl text-sm font-black ${scores[i] === n ? 'bg-foreground text-background' : 'bg-muted'}`}>{n}</button>)}</div></div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              {(['before', 'after'] as const).map((k) => (
                <label key={k} className="cursor-pointer rounded-2xl border-2 border-dashed p-2 text-center text-[12px] font-bold">
                  {photos[k] ? <img src={photos[k]} alt={k} className="mx-auto h-24 rounded-xl object-cover" /> : <span className="block py-6">📷 {k === 'before' ? 'Before' : 'After'} photo</span>}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setPhotos({ ...photos, [k]: await shrink(file) }); }} />
                </label>
              ))}
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Feedback for the student (they’ll see it on their record)" className="w-full rounded-2xl border-2 p-3 text-sm" />
            <p className="text-sm">Average: <span className="font-black">{avg ?? '—'}</span> / 5 · passes at {rubric.passAvg}</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !avg} onClick={() => submit(false)} className="h-11 flex-1 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Saving…' : avg && avg < rubric.passAvg ? 'Record (below pass)' : 'Pass & sign off'}</button>
              <button type="button" disabled={busy || !avg} onClick={() => submit(true)} className="h-11 rounded-xl border-2 px-4 text-sm font-bold disabled:opacity-40">Needs redo</button>
            </div>
            <p className="text-[11px] text-muted-foreground">Your sign-off, scores and photos are kept on the student’s record and in the audit log.</p>
          </div>
        </div>
      )}
    </div>
  );
}
