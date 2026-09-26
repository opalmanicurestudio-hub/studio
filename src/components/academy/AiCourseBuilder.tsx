'use client';
// src/components/academy/AiCourseBuilder.tsx
//
// ✨ BUILD A COURSE WITH AI — paste an outline or attach a PDF (your
// curriculum or state syllabus). AI proposes modules and lessons with
// objectives; untick anything you don't want; "Create draft course" makes a
// DRAFT course (never published automatically). Fill each lesson afterwards.

import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { X } from 'lucide-react';
import { deviceId } from '@/lib/device';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export function AiCourseBuilder({ tenantId, onClose, onCreated }: { tenantId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ outline: '', audience: '', hours: '' });
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const lessons = draft ? draft.modules.reduce((n: number, m: any) => n + m.lessons.filter((l: any) => !l.skip).length, 0) : 0;
  const toggle = (mi: number, li: number) => { const d = structuredClone(draft); d.modules[mi].lessons[li].skip = !d.modules[mi].lessons[li].skip; setDraft(d); };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[94dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl">
        <div className="flex items-start justify-between"><div><p className="text-xl font-black">✨ Build a course with AI</p><p className="text-sm text-muted-foreground">From your outline or curriculum. You review everything; it’s created as a draft.</p></div><button type="button" onClick={onClose} aria-label="Close" className="h-10 w-10 rounded-xl border-2"><X className="mx-auto h-4 w-4" /></button></div>
        {!draft ? (
          <>
            <textarea rows={8} value={f.outline} onChange={(e) => setF({ ...f, outline: e.target.value })} className="w-full rounded-2xl border-2 p-3 text-sm" placeholder={'Paste an outline, syllabus or notes — e.g.\nUnit 1 Infection control: hand washing, disinfection, blood exposure\nUnit 2 Nail anatomy and disorders\nUnit 3 Basic manicure…'} />
            <label className="flex cursor-pointer items-center justify-between rounded-2xl border-2 border-dashed p-3 text-sm"><span>{pdf ? `📄 ${pdf.name}` : '…or attach a PDF (curriculum, syllabus — up to 3 MB)'}</span><span className="font-bold">{pdf ? 'Change' : 'Choose'}</span>
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 3_000_000) { setErr('That PDF is over 3 MB — split it or paste the outline.'); return; } const r = new FileReader(); r.onload = () => setPdf({ name: file.name, data: String(r.result) }); r.readAsDataURL(file); }} /></label>
            <div className="grid gap-2 sm:grid-cols-2"><input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} className="h-11 rounded-xl border-2 px-3 text-sm" placeholder="Who it’s for (e.g. manicurist students)" /><input type="number" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} className="h-11 rounded-xl border-2 px-3 text-sm" placeholder="Approx. hours (optional)" /></div>
            {err && <p className="text-sm text-red-700">{err}</p>}
            <button type="button" disabled={!!busy || (!f.outline.trim() && !pdf)} onClick={async () => { setBusy('gen'); setErr(''); const r = await api({ action: 'ai-course', tenantId, ...f, pdf: pdf?.data }); setBusy(''); if (r.ok) setDraft(r.draft); else setErr(r.error); }} className="h-12 w-full rounded-xl bg-violet-700 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Designing your course… (up to a minute)' : 'Draft the course'}</button>
          </>
        ) : (
          <>
            <div className="rounded-2xl bg-muted/40 p-3"><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full bg-transparent text-lg font-black outline-none" /><p className="text-sm text-muted-foreground">{draft.subtitle}</p></div>
            {draft.modules.map((m: any, mi: number) => (
              <div key={mi} className="space-y-1"><p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{m.title}</p>
                {m.lessons.map((l: any, li: number) => <label key={li} className={`flex gap-2 rounded-xl p-2 text-sm ${l.skip ? 'opacity-40' : 'bg-muted/40'}`}><input type="checkbox" checked={!l.skip} onChange={() => toggle(mi, li)} className="mt-1" /><span><b>{l.title}</b> <span className="text-[11px] text-muted-foreground">· {l.kind}{l.minutes ? ` · ${l.minutes} min` : ''}</span><span className="block text-[12px] text-muted-foreground">{l.summary}</span></span></label>)}</div>
            ))}
            {err && <p className="text-sm text-red-700">{err}</p>}
            <div className="grid gap-2 sm:grid-cols-2"><button type="button" disabled={!!busy || !lessons} onClick={async () => { setBusy('make'); const r = await api({ action: 'ai-course-create', tenantId, draft }); setBusy(''); if (r.ok) onCreated(r.id); else setErr(r.error); }} className="h-12 rounded-xl bg-foreground text-sm font-bold text-background disabled:opacity-40">{busy ? 'Creating…' : `Create draft course · ${lessons} lessons`}</button>
              <button type="button" onClick={() => setDraft(null)} className="h-12 rounded-xl border-2 text-sm font-bold">Start over</button></div>
          </>
        )}
      </div>
    </div>
  );
}
