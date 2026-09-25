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

export function StudentSalon({ tenantId }: { tenantId: string }) {
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

  return (
    <div className="space-y-4">
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
