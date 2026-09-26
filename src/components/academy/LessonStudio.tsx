'use client';
// src/components/academy/LessonStudio.tsx
//
// LESSON STUDIO pieces used inside the course builder's lesson editor.
//   BlocksEditor  text · image · step-by-step (a photo per step) · callout
//                 (safety / key point / tip) · file · divider — reorder, remove
//   MediaPicker   the course's media library: upload once (images are resized
//                 for you), reuse anywhere; private to enrolled students
//   PlanEditor    the instructor's lesson plan in the Board's instruction order,
//                 infection control integrated — "Draft with AI" and "Print"

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { printDocument, heading, esc } from '@/lib/doc-theme';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-10 w-full rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const area = 'w-full rounded-xl border-2 border-border/60 bg-background p-3 text-sm';
const uid = () => Math.random().toString(36).slice(2, 10);
const shrink = (file: File, max = 1800) => new Promise<string>((res, rej) => { const r = new FileReader(); const img = new Image(); r.onload = () => { img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.84)); }; img.onerror = rej; img.src = String(r.result); }; r.onerror = rej; r.readAsDataURL(file); });
const raw = (file: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });

// ── Media library ─────────────────────────────────────────────────────────
export function MediaPicker({ tenantId, courseId, kind, onPick, onClose }: { tenantId: string; courseId: string; kind: 'image' | 'any'; onPick: (m: any) => void; onClose: () => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { api({ action: 'media-list', tenantId, courseId }).then(async (r) => { if (!r.ok) return; const l = r.media.filter((m: any) => kind === 'any' || m.kind === 'image'); setList(l);
    for (const m of l.filter((x: any) => x.kind === 'image').slice(0, 30)) { const u = await api({ action: 'media-url', tenantId, courseId, mediaId: m.id }); if (u.ok) setThumbs((t) => ({ ...t, [m.id]: u.url })); } }); }, [tenantId, courseId, kind]);
  const upload = async (file: File) => {
    setBusy(true); setErr('');
    const data = file.type.startsWith('image/') ? await shrink(file) : await raw(file);
    const r = await api({ action: 'media-upload', tenantId, courseId, name: file.name, file: data });
    setBusy(false); if (r.ok) onPick(r.media); else setErr(r.error);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[85dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-3xl bg-background p-5">
        <div className="flex items-center justify-between"><p className="text-lg font-black">Media library</p><button type="button" onClick={onClose} className="text-sm font-bold text-muted-foreground">Close</button></div>
        <label className="flex h-20 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed text-sm font-bold">{busy ? 'Uploading…' : `＋ Upload ${kind === 'image' ? 'an image' : 'an image, PDF or audio file'} (up to 3 MB)`}
          <input type="file" accept={kind === 'image' ? 'image/*' : 'image/*,application/pdf,audio/*'} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} /></label>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {!list ? <p className="text-sm text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing uploaded for this course yet.</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{list.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m)} className="overflow-hidden rounded-xl border-2 text-left hover:border-foreground">
              {m.kind === 'image' ? (thumbs[m.id] ? <img src={thumbs[m.id]} alt={m.name} className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-muted" />) : <div className="flex aspect-square items-center justify-center bg-muted text-3xl">{m.kind === 'pdf' ? '📄' : '🎧'}</div>}
              <p className="truncate px-2 py-1 text-[11px]">{m.name}</p>
            </button>
          ))}</div>
        )}
      </div>
    </div>
  );
}

// ── Content blocks ────────────────────────────────────────────────────────
const TONE: Record<string, [string, string]> = { safety: ['🛑 Safety', 'bg-red-50 border-red-200'], key: ['⭐ Key point', 'bg-amber-50 border-amber-200'], tip: ['💡 Tip', 'bg-sky-50 border-sky-200'] };
export function BlocksEditor({ tenantId, courseId, value, onChange }: { tenantId: string; courseId: string; value: any[]; onChange: (v: any[]) => void }) {
  const [pick, setPick] = useState<{ index: number; step?: number; kind: 'image' | 'any' } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const blocks = value || [];
  const set = (i: number, patch: any) => onChange(blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  const add = (type: string) => onChange([...blocks, type === 'steps' ? { id: uid(), type, title: '', steps: [{ text: '', mediaId: null }] } : type === 'callout' ? { id: uid(), type, tone: 'safety', text: '' } : { id: uid(), type, text: '' }]);
  const chosen = (m: any) => { if (!pick) return; setNames((x) => ({ ...x, [m.id]: m.name })); const b = blocks[pick.index];
    if (pick.step != null) { const steps = [...b.steps]; steps[pick.step] = { ...steps[pick.step], mediaId: m.id }; set(pick.index, { steps }); }
    else set(pick.index, { mediaId: m.id, ...(b.type === 'file' && !b.label ? { label: m.name } : {}) }); setPick(null); };
  return (
    <div className="space-y-2 rounded-2xl bg-muted/40 p-3">
      <p className="text-sm font-black">Lesson content blocks <span className="font-normal text-muted-foreground">— shown to students after the notes</span></p>
      {blocks.map((b, i) => (
        <div key={b.id || i} className="space-y-2 rounded-xl bg-background p-3">
          <div className="flex items-center gap-2"><span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{b.type === 'steps' ? 'Step-by-step' : b.type}</span>
            <span className="ml-auto flex gap-1"><button type="button" onClick={() => move(i, -1)} aria-label="Move up" className="p-1"><ArrowUp className="h-4 w-4" /></button><button type="button" onClick={() => move(i, 1)} aria-label="Move down" className="p-1"><ArrowDown className="h-4 w-4" /></button><button type="button" onClick={() => onChange(blocks.filter((_, k) => k !== i))} aria-label="Remove block" className="p-1 text-red-600"><Trash2 className="h-4 w-4" /></button></span></div>
          {b.type === 'text' && <textarea rows={4} className={area} value={b.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="Write… (a line starting with # is a heading)" />}
          {b.type === 'callout' && <><div className="flex gap-1">{Object.entries(TONE).map(([k, [l]]) => <button key={k} type="button" onClick={() => set(i, { tone: k })} className={`rounded-full px-3 py-1 text-[12px] font-bold ${b.tone === k ? 'bg-foreground text-background' : 'bg-muted'}`}>{l}</button>)}</div><textarea rows={2} className={`${area} ${TONE[b.tone]?.[1] || ''}`} value={b.text} onChange={(e) => set(i, { text: e.target.value })} placeholder={b.tone === 'safety' ? 'e.g. Stop the service if the skin is broken — follow blood exposure procedure.' : 'Write the point…'} /></>}
          {(b.type === 'image' || b.type === 'file') && <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setPick({ index: i, kind: b.type === 'image' ? 'image' : 'any' })} className="h-9 rounded-lg border-2 px-3 text-[12px] font-bold">{b.mediaId ? `✓ ${names[b.mediaId] || 'chosen'} — change` : b.type === 'image' ? 'Choose image' : 'Choose file'}</button>
            <input className={`${field} flex-1`} value={b.type === 'image' ? b.caption || '' : b.label || ''} onChange={(e) => set(i, b.type === 'image' ? { caption: e.target.value } : { label: e.target.value })} placeholder={b.type === 'image' ? 'Caption (optional)' : 'Button label, e.g. “Nail anatomy worksheet”'} /></div>}
          {b.type === 'steps' && <>
            <input className={field} value={b.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="e.g. Basic manicure — step by step" />
            {b.steps.map((s: any, k: number) => <div key={k} className="flex items-start gap-2"><span className="mt-2 w-6 text-sm font-black">{k + 1}</span><textarea rows={2} className={area} value={s.text} onChange={(e) => { const st = [...b.steps]; st[k] = { ...s, text: e.target.value }; set(i, { steps: st }); }} placeholder="What to do (include the infection-control step where it belongs)" />
              <button type="button" onClick={() => setPick({ index: i, step: k, kind: 'image' })} className="mt-1 h-9 shrink-0 rounded-lg border-2 px-2 text-[12px] font-bold">{s.mediaId ? '✓ photo' : '📷 photo'}</button>
              <button type="button" onClick={() => set(i, { steps: b.steps.filter((_: any, x: number) => x !== k) })} aria-label="Remove step" className="mt-2 text-red-600"><Trash2 className="h-4 w-4" /></button></div>)}
            <button type="button" onClick={() => set(i, { steps: [...b.steps, { text: '', mediaId: null }] })} className="rounded-full bg-muted px-3 py-1 text-[12px] font-bold">+ Step</button></>}
          {b.type === 'divider' && <hr className="border-dashed" />}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">{([['text', '¶ Text'], ['steps', '🔢 Step-by-step'], ['image', '🖼 Image'], ['callout', '🛑 Callout'], ['file', '📄 File'], ['divider', '— Divider']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => add(k)} className="rounded-full bg-background px-3 py-1.5 text-[12px] font-bold">{l}</button>)}</div>
      {pick && <MediaPicker tenantId={tenantId} courseId={courseId} kind={pick.kind} onPick={chosen} onClose={() => setPick(null)} />}
    </div>
  );
}

// ── Lesson plan ───────────────────────────────────────────────────────────
export const PLAN_TYPES: [string, string][] = [['guided_theory', 'Guided theory'], ['demonstration', 'Demonstration'], ['guided_practice', 'Guided practice'], ['independent_theory', 'Independent theory'], ['practice', 'Practice'], ['evaluation', 'Evaluation'], ['performance', 'Performance']];
const blank = { objectives: [], minutes: 60, materials: [], setup: '', infectionControl: '', agenda: [], notes: '', differentiation: '', assessment: '', subjects: [] };
export function PlanEditor({ tenantId, courseId, lesson, value, onChange, brand, courseTitle }: { tenantId: string; courseId: string; lesson: any; value: any; onChange: (v: any) => void; brand: any; courseTitle: string }) {
  const [open, setOpen] = useState(!!value); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const p = { ...blank, ...(value || {}) };
  const set = (patch: any) => onChange({ ...p, ...patch });
  const total = (p.agenda || []).reduce((n: number, a: any) => n + (Number(a.minutes) || 0), 0);
  const guided = (p.agenda || []).filter((a: any) => ['guided_theory', 'demonstration', 'guided_practice'].includes(a.type)).reduce((n: number, a: any) => n + (Number(a.minutes) || 0), 0);
  const draft = async () => { if (!lesson.id) { setErr('Save the lesson once first.'); return; } setBusy(true); setErr(''); const r = await api({ action: 'ai-plan', tenantId, courseId, lessonId: lesson.id, minutes: p.minutes }); setBusy(false); if (r.ok) { onChange(r.plan); setOpen(true); } else setErr(r.error); };
  const print = () => printDocument({ title: `Lesson plan — ${lesson.title}`, brand, body: `${heading('Lesson', 'plan')}<p class="sub">${esc(lesson.title)} · ${esc(courseTitle)}${p.minutes ? ` · ${p.minutes} minutes` : ''}</p>
    <div class="grid grid2"><div class="panel"><b>Objectives</b>${(p.objectives || []).map((o: string) => `<div>• ${esc(o)}</div>`).join('') || '<div class="muted">—</div>'}</div><div class="panel"><b>Materials & kit</b>${(p.materials || []).map((o: string) => `<div>• ${esc(o)}</div>`).join('') || '<div class="muted">—</div>'}</div></div>
    ${p.setup ? `<h2>Setup</h2><p>${esc(p.setup)}</p>` : ''}${p.infectionControl ? `<h2>Infection control</h2><div class="panel">${esc(p.infectionControl)}</div>` : ''}
    <h2>Agenda · ${total} minutes${total ? ` · guided ${Math.round((guided / total) * 100)}%` : ''}</h2><table><thead><tr><th>Min</th><th>Stage</th><th>Activity</th></tr></thead>${(p.agenda || []).map((a: any) => `<tr><td>${esc(a.minutes)}</td><td>${esc(PLAN_TYPES.find(([k]) => k === a.type)?.[1] || a.type)}</td><td>${esc(a.activity)}</td></tr>`).join('')}</table>
    ${p.notes ? `<h2>Teaching notes</h2><p>${esc(p.notes)}</p>` : ''}${p.differentiation ? `<h2>Support & challenge</h2><p>${esc(p.differentiation)}</p>` : ''}${p.assessment ? `<h2>Checking learning</h2><p>${esc(p.assessment)}</p>` : ''}
    ${(p.subjects || []).length ? `<p class="muted">Subjects: ${(p.subjects || []).map(esc).join(', ')}</p>` : ''}
    <div class="sig"><div>Instructor</div><div>Date taught</div><div>Substitute (if any)</div></div>` });
  return (
    <div className="space-y-2 rounded-2xl border-2 border-dashed border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setOpen(!open)} className="text-sm font-black">{open ? '▾' : '▸'} Lesson plan <span className="font-normal text-muted-foreground">— for instructors and substitutes (students don’t see this)</span></button>
        <span className="ml-auto flex gap-2"><button type="button" disabled={busy} onClick={draft} className="h-8 rounded-full bg-violet-100 px-3 text-[12px] font-bold text-violet-900 disabled:opacity-50">{busy ? 'Drafting…' : '✨ Draft with AI'}</button>{value && <button type="button" onClick={print} className="h-8 rounded-full border-2 px-3 text-[12px] font-bold">Print</button>}</span></div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {open && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[12px] font-bold">Objectives (one per line)<textarea rows={3} className={area} value={(p.objectives || []).join('\n')} onChange={(e) => set({ objectives: e.target.value.split('\n') })} /></label>
            <label className="text-[12px] font-bold">Materials & kit (one per line)<textarea rows={3} className={area} value={(p.materials || []).join('\n')} onChange={(e) => set({ materials: e.target.value.split('\n') })} /></label>
            <label className="text-[12px] font-bold">Setup<textarea rows={2} className={area} value={p.setup} onChange={(e) => set({ setup: e.target.value })} /></label>
            <label className="text-[12px] font-bold">Infection control built into this lesson<textarea rows={2} className={area} value={p.infectionControl} onChange={(e) => set({ infectionControl: e.target.value })} /></label>
          </div>
          <p className="text-[12px] font-black">Agenda <span className="font-normal text-muted-foreground">· {total} min{total ? ` · guided theory/demo/guided practice ${Math.round((guided / total) * 100)}%` : ''} (NC asks for at least 10% each week)</span></p>
          {(p.agenda || []).map((a: any, i: number) => <div key={i} className="flex gap-2"><input type="number" className={`${field} w-20`} value={a.minutes} onChange={(e) => { const g = [...p.agenda]; g[i] = { ...a, minutes: e.target.value }; set({ agenda: g }); }} title="Minutes" />
            <select className={`${field} w-44`} value={a.type} onChange={(e) => { const g = [...p.agenda]; g[i] = { ...a, type: e.target.value }; set({ agenda: g }); }}>{PLAN_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className={field} value={a.activity} onChange={(e) => { const g = [...p.agenda]; g[i] = { ...a, activity: e.target.value }; set({ agenda: g }); }} placeholder="What happens" />
            <button type="button" onClick={() => set({ agenda: p.agenda.filter((_: any, k: number) => k !== i) })} className="text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>)}
          <button type="button" onClick={() => set({ agenda: [...(p.agenda || []), { minutes: 15, type: 'guided_theory', activity: '' }] })} className="rounded-full bg-muted px-3 py-1 text-[12px] font-bold">+ Agenda step</button>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[12px] font-bold">Teaching notes<textarea rows={3} className={area} value={p.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
            <label className="text-[12px] font-bold">Support & challenge<textarea rows={3} className={area} value={p.differentiation} onChange={(e) => set({ differentiation: e.target.value })} /></label>
            <label className="text-[12px] font-bold">How learning is checked<textarea rows={3} className={area} value={p.assessment} onChange={(e) => set({ assessment: e.target.value })} /></label>
          </div>
          <label className="text-[12px] font-bold">Subjects (comma-separated — e.g. Infection control, Nail anatomy)<input className={field} value={(p.subjects || []).join(', ')} onChange={(e) => set({ subjects: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
        </div>
      )}
    </div>
  );
}
