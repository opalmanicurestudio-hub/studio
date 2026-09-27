'use client';
// src/components/academy/ApplicationForms.tsx
//
// ADMISSIONS → ⚙ APPLICATION FORMS — per program:
//   Documents   what applicants upload (+ a short note, e.g. "both sides")
//   Questions   your own: short answer, paragraph, choice, yes/no; required or not
//   Review      the checks every applicant must meet, and an optional rubric
// A live preview shows the applicant's view. Existing applicants keep the
// document list they applied with.

import { useState } from 'react';

const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const TYPES: [string, string][] = [['short', 'Short answer'], ['paragraph', 'Paragraph'], ['choice', 'Multiple choice'], ['yesno', 'Yes / no']];
const uid = () => `q${Math.random().toString(36).slice(2, 7)}`;

function Row({ children, onUp, onDown, onRemove }: { children: React.ReactNode; onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-1.5 rounded-xl bg-background p-2">
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
      <div className="flex flex-col"><button type="button" onClick={onUp} disabled={!onUp} aria-label="Move up" className="h-7 w-7 disabled:opacity-20">↑</button><button type="button" onClick={onDown} disabled={!onDown} aria-label="Move down" className="h-7 w-7 disabled:opacity-20">↓</button></div>
      <button type="button" onClick={onRemove} aria-label="Remove" className="h-7 w-7 text-red-700">✕</button>
    </div>
  );
}
const move = <T,>(xs: T[], i: number, d: number) => { const a = [...xs]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

function ProgramForm({ p, onSave }: { p: any; onSave: (form: any) => Promise<boolean> }) {
  const [f, setF] = useState(() => ({ docs: p.form.docs.map((d: any) => ({ ...d })), questions: p.form.questions.map((q: any) => ({ ...q, options: (q.options || []).join('\n') })), checks: p.form.checks.join('\n'), rubric: p.form.rubric.join('\n') }));
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const setQ = (i: number, patch: any) => setF({ ...f, questions: f.questions.map((q: any, j: number) => (j === i ? { ...q, ...patch } : q)) });
  const setD = (i: number, patch: any) => setF({ ...f, docs: f.docs.map((d: any, j: number) => (j === i ? { ...d, ...patch } : d)) });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <section className="space-y-2"><p className="text-sm font-black">📎 Documents to upload</p>
          {f.docs.map((d: any, i: number) => <Row key={i} onUp={i ? () => setF({ ...f, docs: move(f.docs, i, -1) }) : undefined} onDown={i < f.docs.length - 1 ? () => setF({ ...f, docs: move(f.docs, i, 1) }) : undefined} onRemove={() => setF({ ...f, docs: f.docs.filter((_: any, j: number) => j !== i) })}>
            <input className={field} value={d.name} onChange={(e) => setD(i, { name: e.target.value })} placeholder="e.g. Photo ID" aria-label="Document name" />
            <input className={field} value={d.note} onChange={(e) => setD(i, { note: e.target.value })} placeholder="Note for the applicant (optional) — e.g. a clear photo of both sides" aria-label="Note" />
          </Row>)}
          {f.docs.length < 12 && <button type="button" onClick={() => setF({ ...f, docs: [...f.docs, { name: '', note: '' }] })} className="h-9 rounded-full bg-muted px-3 text-[12px] font-bold">+ Document</button>}
        </section>
        <section className="space-y-2"><p className="text-sm font-black">❓ Your questions</p>
          {f.questions.length === 0 && <p className="text-[12px] text-muted-foreground">No questions yet — applicants just give their name, email and phone.</p>}
          {f.questions.map((q: any, i: number) => <Row key={q.id} onUp={i ? () => setF({ ...f, questions: move(f.questions, i, -1) }) : undefined} onDown={i < f.questions.length - 1 ? () => setF({ ...f, questions: move(f.questions, i, 1) }) : undefined} onRemove={() => setF({ ...f, questions: f.questions.filter((_: any, j: number) => j !== i) })}>
            <input className={field} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="e.g. Why do you want to become a nail technician?" aria-label="Question" />
            <div className="flex flex-wrap items-center gap-2"><select className="h-9 rounded-lg border-2 px-2 text-[13px]" value={q.type} onChange={(e) => setQ(i, { type: e.target.value })} aria-label="Answer type">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={!!q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required</label></div>
            {q.type === 'choice' && <textarea className="min-h-16 w-full rounded-xl border-2 p-2 text-sm" value={q.options} onChange={(e) => setQ(i, { options: e.target.value })} placeholder={'One choice per line, e.g.\nDays\nEvenings\nWeekends'} aria-label="Choices" />}
          </Row>)}
          {f.questions.length < 12 && <button type="button" onClick={() => setF({ ...f, questions: [...f.questions, { id: uid(), label: '', type: 'short', options: '', required: false }] })} className="h-9 rounded-full bg-muted px-3 text-[12px] font-bold">+ Question</button>}
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-black">✅ Review checks <span className="block text-[11px] font-normal text-muted-foreground">One per line — staff tick these during review</span><textarea className="mt-1 min-h-20 w-full rounded-xl border-2 p-2 text-sm font-normal" value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} /></label>
          <label className="text-sm font-black">📊 Rubric (optional) <span className="block text-[11px] font-normal text-muted-foreground">One criterion per line, scored 1–5</span><textarea className="mt-1 min-h-20 w-full rounded-xl border-2 p-2 text-sm font-normal" value={f.rubric} onChange={(e) => setF({ ...f, rubric: e.target.value })} /></label>
        </section>
        <div className="flex items-center gap-3"><button type="button" disabled={busy} onClick={async () => { setBusy(true); setSaved(false); const ok = await onSave({ docs: f.docs, questions: f.questions.map((q: any) => ({ ...q, options: String(q.options || '').split('\n') })), checks: f.checks.split('\n'), rubric: f.rubric.split('\n') }); setBusy(false); setSaved(ok); }} className="h-10 rounded-full bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">{busy ? 'Saving…' : 'Save application form'}</button>{saved && <span className="text-sm text-emerald-800">✓ Saved — new applicants see it now.</span>}</div>
        <p className="text-[11px] text-muted-foreground">People who already applied keep the document list they applied with.</p>
      </div>
      <aside className="space-y-2 rounded-2xl bg-muted/40 p-3 text-sm" aria-label="Preview">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">What applicants see</p>
        <div className="space-y-2 rounded-xl bg-background p-3">
          <p className="font-bold">{p.name}</p>
          {f.questions.filter((q: any) => q.label).map((q: any) => <div key={q.id} className="space-y-1"><p className="text-[13px]">{q.label}{q.required ? ' *' : ''}</p>
            {q.type === 'paragraph' ? <div className="h-12 rounded-lg border" /> : q.type === 'yesno' ? <div className="flex gap-1.5"><span className="rounded-full border px-3 py-1 text-[12px]">Yes</span><span className="rounded-full border px-3 py-1 text-[12px]">No</span></div> : q.type === 'choice' ? <div className="flex flex-wrap gap-1.5">{String(q.options || '').split('\n').filter(Boolean).map((o: string) => <span key={o} className="rounded-full border px-3 py-1 text-[12px]">{o}</span>)}</div> : <div className="h-8 rounded-lg border" />}</div>)}
          <p className="pt-1 text-[12px] font-bold">Then they upload:</p>
          <ul className="space-y-0.5 text-[12px]">{f.docs.filter((d: any) => d.name).map((d: any) => <li key={d.name}>• {d.name}{d.note ? <span className="text-muted-foreground"> — {d.note}</span> : null}</li>)}</ul>
        </div>
      </aside>
    </div>
  );
}

export function ApplicationForms({ programs, save, onClose }: { programs: any[]; save: (programId: string, form: any) => Promise<boolean>; onClose: () => void }) {
  const [sel, setSel] = useState(programs[0]?.id || '');
  const p = programs.find((x) => x.id === sel);
  return (
    <section className="space-y-3 rounded-2xl border-2 border-foreground/10 p-4">
      <div className="flex items-start justify-between gap-2"><div><p className="font-black">⚙ Application forms</p><p className="text-[12px] text-muted-foreground">What each program asks applicants — documents, your own questions, and the review checklist.</p></div><button type="button" onClick={onClose} aria-label="Close" className="p-1">✕</button></div>
      {programs.length === 0 ? <p className="text-sm text-muted-foreground">Add a program first (Set up → Programs).</p> : <>
        {programs.length > 1 && <div className="flex flex-wrap gap-1.5">{programs.map((x) => <button key={x.id} type="button" onClick={() => setSel(x.id)} className={`h-9 rounded-full px-3 text-[13px] font-bold ${sel === x.id ? 'bg-foreground text-background' : 'bg-muted'}`}>{x.name}</button>)}</div>}
        {p && <ProgramForm key={p.id} p={p} onSave={(form) => save(p.id, form)} />}
      </>}
    </section>
  );
}
