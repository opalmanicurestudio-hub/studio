'use client';
// src/components/academy/Grading.tsx
//
// GRADING (per course) — assignments waiting first; open one → the student's
// answer, photos and files; score each rubric row (✨ AI can suggest scores and
// feedback for written work — you decide); Return, or Return for another try.
// Gradebook: students × quizzes and assignments, average, letter; print or CSV.

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, X } from 'lucide-react';
import { deviceId } from '@/lib/device';
import { openPrivateFile, PrivateImg } from '@/components/shared/private-file';
import { printDocument, heading, esc } from '@/lib/doc-theme';
import { letter } from '@/lib/grades';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const STATUS: Record<string, string> = { submitted: 'bg-amber-100 text-amber-900', returned: 'bg-emerald-100 text-emerald-900', resubmit: 'bg-sky-100 text-sky-900' };

export function Grading({ tenantId, courseId, courseTitle, brand }: { tenantId: string; courseId: string; courseTitle: string; brand: any }) {
  const [view, setView] = useState<'queue' | 'book'>('queue');
  const [subs, setSubs] = useState<any[] | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const [s, c] = await Promise.all([api({ action: 'submissions', tenantId, courseId }), api({ action: 'course-get', tenantId, courseId })]);
    if (s.ok) setSubs(s.submissions); else setMsg(s.error); if (c.ok) setLessons(c.lessons);
  }, [tenantId, courseId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view === 'book' && !book) api({ action: 'gradebook', tenantId, courseId }).then((r) => (r.ok ? setBook(r) : setMsg(r.error))); }, [view, book, tenantId, courseId]);
  const lessonOf = (id: string) => lessons.find((l) => l.id === id);
  const printBook = () => printDocument({ title: `Gradebook — ${courseTitle}`, brand, body: `${heading('Grade', 'book')}<p class="sub">${esc(courseTitle)} · A 90–100 · B 80–89 · C 70–79 · F below 70</p>
    <table><thead><tr><th>Student</th>${book.items.map((i: any) => `<th>${esc(i.title)}</th>`).join('')}<th>Average</th><th>Grade</th></tr></thead>${book.rows.map((r: any) => `<tr><td>${esc(r.name)}</td>${r.cells.map((c: any) => `<td>${c == null ? '—' : `${c}%`}</td>`).join('')}<td><b>${r.avg ?? '—'}${r.avg != null ? '%' : ''}</b></td><td><b>${esc(r.letter)}</b></td></tr>`).join('')}</table>` });
  const csv = () => { const rows = [['Student', 'Email', ...book.items.map((i: any) => i.title), 'Average', 'Grade'], ...book.rows.map((r: any) => [r.name, r.email, ...r.cells.map((c: any) => c ?? ''), r.avg ?? '', r.letter])]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((x) => x.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })); a.download = `gradebook-${courseTitle}.csv`; a.click(); };

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">{([['queue', `To grade${subs ? ` · ${subs.filter((s) => s.status === 'submitted').length}` : ''}`], ['book', 'Gradebook']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${view === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
      {msg && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">{msg}</p>}
      {view === 'queue' && (!subs ? <Loader className="h-5 w-5 animate-spin" /> : subs.length === 0 ? <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">No submissions yet. Add an <b>Assignment</b> lesson in Curriculum.</p> : (
        <div className="space-y-1.5">{subs.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s)} className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2.5 text-left text-sm hover:bg-muted">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${STATUS[s.status] || ''}`}>{s.status === 'submitted' ? 'to grade' : s.status === 'resubmit' ? 'sent back' : `${s.grade?.pct}% ${s.grade?.letter}`}</span>
            <span className="min-w-0 flex-1 truncate"><b>{s.name || s.email}</b> · {lessonOf(s.lessonId)?.title || 'Assignment'}</span>
            <span className="text-[12px] text-muted-foreground">{new Date(s.submittedAt).toLocaleDateString()}{s.late ? ' · late' : ''}{s.attempts > 1 ? ` · try ${s.attempts}` : ''}</span>
          </button>
        ))}</div>
      ))}
      {view === 'book' && (!book ? <Loader className="h-5 w-5 animate-spin" /> : (
        <div className="space-y-2">
          <div className="flex gap-2"><button type="button" onClick={printBook} className="h-9 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Print</button><button type="button" onClick={csv} className="h-9 rounded-xl border-2 px-4 text-sm font-bold">CSV</button></div>
          <div className="overflow-x-auto rounded-2xl border-2 border-border/60"><table className="w-full text-left text-[12px]"><thead className="bg-muted/50"><tr><th className="sticky left-0 bg-muted p-2">Student</th>{book.items.map((i: any) => <th key={i.id} className="whitespace-nowrap p-2">{i.kind === 'quiz' ? '📝' : '📎'} {i.title}</th>)}<th className="p-2">Avg</th><th className="p-2">Grade</th></tr></thead>
            <tbody>{book.rows.map((r: any) => <tr key={r.studentId} className="border-t"><td className="sticky left-0 whitespace-nowrap bg-background p-2 font-bold">{r.name}</td>{r.cells.map((c: any, i: number) => <td key={i} className={`p-2 ${c != null && c < 70 ? 'font-bold text-red-700' : ''}`}>{c == null ? '—' : `${c}%`}</td>)}<td className="p-2 font-black">{r.avg ?? '—'}{r.avg != null ? '%' : ''}</td><td className="p-2 font-black">{r.letter}</td></tr>)}</tbody></table></div>
        </div>
      ))}
      {open && <GradePanel tenantId={tenantId} sub={open} lesson={lessonOf(open.lessonId)} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); setBook(null); await load(); }} />}
    </div>
  );
}

function GradePanel({ tenantId, sub, lesson, onClose, onDone }: any) {
  const rub = lesson?.assignment?.rubric || [];
  const [scores, setScores] = useState<number[]>(sub.grade?.scores || rub.map(() => 0));
  const [feedback, setFeedback] = useState(sub.grade?.feedback || '');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const max = rub.reduce((n: number, r: any) => n + r.points, 0) || 100;
  const total = scores.reduce((n, x) => n + (Number(x) || 0), 0); const pct = Math.round((total / max) * 100);
  const save = async (resubmit: boolean) => { setBusy(resubmit ? 'redo' : 'save'); const r = await api({ action: 'submission-grade', tenantId, courseId: sub.courseId, id: sub.id, scores, feedback, resubmit }); setBusy(''); if (r.ok) onDone(); else setErr(r.error); };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="h-full w-full max-w-xl space-y-3 overflow-y-auto bg-background p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-2"><div><p className="text-lg font-black">{sub.name || sub.email}</p><p className="text-[12px] text-muted-foreground">{lesson?.title} · submitted {new Date(sub.submittedAt).toLocaleString()}{sub.late ? ' · late' : ''}</p></div><button type="button" onClick={onClose} aria-label="Close" className="h-10 w-10 rounded-xl border-2"><X className="mx-auto h-4 w-4" /></button></div>
        {lesson?.assignment?.prompt && <details className="rounded-xl bg-muted/40 p-3 text-sm"><summary className="cursor-pointer font-bold">The assignment</summary><p className="mt-1 whitespace-pre-wrap">{lesson.assignment.prompt}</p></details>}
        {sub.text && <div className="rounded-2xl border-2 p-3 text-[15px] leading-relaxed"><p className="whitespace-pre-wrap">{sub.text}</p></div>}
        {(sub.files || []).length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{sub.files.map((f: any, i: number) => f.type?.startsWith('image/') ? <button key={i} type="button" onClick={() => openPrivateFile(f.ref)}><PrivateImg src={f.ref} alt={f.name} className="aspect-square w-full rounded-xl object-cover" /></button> : <button key={i} type="button" onClick={() => openPrivateFile(f.ref)} className="flex aspect-square flex-col items-center justify-center rounded-xl bg-muted text-sm">📄<span className="px-2 text-center text-[11px]">{f.name}</span></button>)}</div>}
        <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
          {rub.map((r: any, i: number) => <div key={i} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1">{r.criterion}</span><input type="number" min={0} max={r.points} value={scores[i] ?? 0} onChange={(e) => { const s = [...scores]; s[i] = Math.max(0, Math.min(r.points, Number(e.target.value) || 0)); setScores(s); }} className="h-11 w-20 rounded-xl border-2 text-center text-base font-bold" /><span className="w-10 text-muted-foreground">/ {r.points}</span></div>)}
          <p className="text-right text-lg font-black">{total} / {max} · {pct}% · {letter(pct)}</p>
        </div>
        <div className="flex items-center justify-between"><p className="text-sm font-bold">Feedback for the student</p>{sub.text && <button type="button" disabled={!!busy} onClick={async () => { setBusy('ai'); setErr(''); const r = await api({ action: 'submission-ai', tenantId, courseId: sub.courseId, id: sub.id }); setBusy(''); if (r.ok) { setScores(r.scores); setFeedback(r.feedback); } else setErr(r.error); }} className="h-9 rounded-full bg-violet-100 px-3 text-[12px] font-bold text-violet-900 disabled:opacity-50">{busy === 'ai' ? 'Reading…' : '✨ Suggest scores & feedback'}</button>}</div>
        <textarea rows={5} value={feedback} onChange={(e) => setFeedback(e.target.value)} className="w-full rounded-2xl border-2 p-3 text-[15px]" placeholder="What went well, and what to work on next." />
        {err && <p className="text-sm text-red-700">{err}</p>}
        <div className="grid gap-2 sm:grid-cols-2"><button type="button" disabled={!!busy} onClick={() => save(false)} className="h-12 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">{busy === 'save' ? 'Returning…' : `Return · ${pct}% ${letter(pct)}`}</button>
          {lesson?.assignment?.resubmit !== false && <button type="button" disabled={!!busy} onClick={() => save(true)} className="h-12 rounded-xl border-2 text-sm font-bold disabled:opacity-50">Return for another try</button>}</div>
        <p className="text-[11px] text-muted-foreground">The student is emailed and sees the grade and your feedback in their lesson. A passing grade completes the lesson. Every grade is kept in the audit log.</p>
      </div>
    </div>
  );
}
