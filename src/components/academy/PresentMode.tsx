'use client';
// src/components/academy/PresentMode.tsx
//
// PRESENT MODE — a lesson on the classroom TV, one step per screen, big type.
//   slides   title (objectives) · notes split at each "# " heading · each content
//            card · each quiz question (answers hidden) · "Questions?"
//   control  arrow keys / space on the laptop, or the instructor's PHONE: scan the
//            QR → /academy/remote/{id} (signed-in staff only) — Next/Back, jump to
//            a slide, speaker notes from the lesson plan. The TV follows the phone.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import QRCode from 'qrcode';
import { deviceId } from '@/lib/device';
import { Blocks, Prose, MOTION_CSS } from '@/components/academy/Learn';

export async function presentApi(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export type Slide = { key: string; label: string; kind: 'title' | 'notes' | 'block' | 'quiz' | 'end'; text?: string; block?: any; q?: any; n?: number };
export function buildSlides(L: any): Slide[] {
  const out: Slide[] = [{ key: 'title', label: L.title || 'Lesson', kind: 'title' }];
  const body = String(L.body || '').trim();
  if (body) {
    const parts: string[] = []; let cur = '';
    for (const line of body.split('\n')) { if (/^#\s+/.test(line) && cur.trim()) { parts.push(cur); cur = ''; } cur += `${line}\n`; }
    if (cur.trim()) parts.push(cur);
    parts.forEach((t, i) => out.push({ key: `notes${i}`, label: (t.match(/^#\s+(.+)$/m)?.[1] || (i ? `Notes ${i + 1}` : 'Notes')).slice(0, 60), kind: 'notes', text: t.trim() }));
  }
  (L.blocks || []).forEach((b: any, i: number) => { if (b.type === 'divider') return; out.push({ key: `b${i}`, label: b.title || ({ text: 'Text', callout: b.tone === 'safety' ? 'Safety' : 'Key point', steps: 'Steps', image: 'Image', interactive: 'Interactive', hotspots: 'Hotspots', stages: 'Stages', game: 'Game', file: 'File' } as any)[b.type] || b.type, kind: 'block', block: b }); });
  (L.quiz?.questions || []).forEach((q: any, i: number) => out.push({ key: `q${i}`, label: `Question ${i + 1}`, kind: 'quiz', q, n: i + 1 }));
  out.push({ key: 'end', label: 'Questions?', kind: 'end' });
  return out;
}

export function PresentMode({ tenantId, courseId, lessonId, color, onClose }: { tenantId: string; courseId: string; lessonId: string; color?: string | null; onClose: () => void }) {
  const [L, setL] = useState<any>(null); const [id, setId] = useState<string | null>(null); const [step, setStep] = useState(0); const [qr, setQr] = useState<string | null>(null); const [showQr, setShowQr] = useState(true); const [err, setErr] = useState('');
  const c = color || '#7c3aed';
  const slides = useMemo(() => (L ? buildSlides(L) : []), [L]);
  const stepRef = useRef(0); stepRef.current = step;
  useEffect(() => { (async () => {
    const [les, st] = await Promise.all([presentApi({ action: 'present-lesson', tenantId, courseId, lessonId }), presentApi({ action: 'present-start', tenantId, courseId, lessonId })]);
    if (!les.ok) { setErr(les.error); return; } setL({ ...les.lesson, courseTitle: les.courseTitle });
    if (st.ok) { setId(st.id); setQr(await QRCode.toDataURL(`${window.location.origin}/academy/remote/${st.id}`, { margin: 1, width: 240 })); }
  })(); }, [tenantId, courseId, lessonId]);
  const go = useCallback((n: number) => { const v = Math.max(0, Math.min(slides.length - 1, n)); setStep(v); if (id) void presentApi({ action: 'present-set', tenantId, id, step: v }); }, [slides.length, id, tenantId]);
  // Follow the phone remote.
  useEffect(() => { if (!id) return; const iv = setInterval(async () => { const r = await presentApi({ action: 'present-state', tenantId, id }); if (r.ok && r.step !== stepRef.current) setStep(r.step); }, 1500); return () => clearInterval(iv); }, [id, tenantId]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(stepRef.current + 1); } else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(stepRef.current - 1); } else if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [go, onClose]);
  const s = slides[step];
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#f7f5f2] text-stone-900">
      <style>{MOTION_CSS}</style>
      <div className="flex items-center gap-3 px-6 py-3 text-sm text-stone-500">
        <span className="truncate font-semibold text-stone-700">{L?.title}</span><span>· {slides.length ? `${step + 1} / ${slides.length}` : ''}</span>
        <div className="ml-4 hidden h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 sm:block"><div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${slides.length ? ((step + 1) / slides.length) * 100 : 0}%`, background: c }} /></div>
        <button type="button" onClick={() => setShowQr(!showQr)} className="rounded-full bg-white px-3 py-1.5 font-semibold">📱 Remote</button>
        <button type="button" onClick={onClose} className="rounded-full bg-white px-3 py-1.5 font-semibold">Exit</button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {err ? <p className="p-10 text-center text-xl">{err}</p> : !s ? <p className="p-10 text-center text-xl text-stone-400">Loading…</p> : (
          <div key={s.key} className="cf-land mx-auto flex min-h-full max-w-5xl flex-col justify-center px-8 py-8" style={{ zoom: 1.45 } as any}>
            {s.kind === 'title' && <div className="space-y-4"><p className="text-sm uppercase tracking-[0.3em] text-stone-500">{L.courseTitle} · {L.moduleTitle}</p><h1 className="text-5xl font-light leading-tight tracking-tight">{L.title}</h1>
              {(L.plan?.objectives || []).length > 0 && <div className="mt-6 space-y-2"><p className="text-sm font-semibold uppercase tracking-widest" style={{ color: c }}>Today you’ll be able to</p>{L.plan.objectives.map((o: string) => <p key={o} className="text-2xl">✓ {o}</p>)}</div>}</div>}
            {s.kind === 'notes' && <div className="rounded-[2rem] bg-white p-8 text-lg leading-relaxed shadow-sm [&_h2]:text-3xl"><Prose text={s.text || ''} /></div>}
            {s.kind === 'block' && <Blocks blocks={[s.block]} accent={c} />}
            {s.kind === 'quiz' && <div className="space-y-5"><p className="text-sm font-semibold uppercase tracking-widest" style={{ color: c }}>Question {s.n}</p><p className="text-4xl font-light leading-snug">{s.q.q}</p><div className="grid gap-3 sm:grid-cols-2">{s.q.options.map((o: string, j: number) => <div key={j} className="rounded-2xl bg-white p-5 text-2xl shadow-sm"><b className="mr-3" style={{ color: c }}>{'ABCD'[j]}</b>{o}</div>)}</div></div>}
            {s.kind === 'end' && <div className="text-center"><p className="text-7xl">💬</p><p className="mt-4 text-5xl font-light">Questions?</p></div>}
          </div>
        )}
        {showQr && qr && <div className="absolute bottom-4 right-4 w-44 rounded-2xl bg-white p-3 text-center shadow-lg"><img src={qr} alt="Scan to control from your phone" className="mx-auto w-36" /><p className="mt-1 text-[11px] text-stone-600">Scan with your phone (signed in) to use it as the remote</p></div>}
      </div>
      <div className="flex items-center justify-center gap-3 pb-5">
        <button type="button" disabled={step === 0} onClick={() => go(step - 1)} className="h-12 rounded-full bg-white px-6 text-sm font-semibold shadow-sm disabled:opacity-30">← Back</button>
        <button type="button" disabled={step >= slides.length - 1} onClick={() => go(step + 1)} className="h-12 rounded-full px-8 text-sm font-semibold text-white shadow-sm disabled:opacity-30" style={{ background: c }}>Next →</button>
      </div>
    </div>
  );
}

/** The phone remote (/academy/remote/{id}). */
export function PresentRemote({ tenantId, id }: { tenantId: string; id: string }) {
  const [st, setSt] = useState<any>(null); const [L, setL] = useState<any>(null); const [err, setErr] = useState('');
  const slides = useMemo(() => (L ? buildSlides(L) : []), [L]);
  const load = useCallback(async () => { const r = await presentApi({ action: 'present-state', tenantId, id }); if (!r.ok) { setErr(r.error); return; } setSt(r); if (!L) { const l = await presentApi({ action: 'present-lesson', tenantId, courseId: r.courseId, lessonId: r.lessonId }); if (l.ok) setL(l.lesson); } }, [tenantId, id, L]);
  useEffect(() => { void load(); const iv = setInterval(load, 2000); return () => clearInterval(iv); }, [load]);
  const go = async (n: number) => { const v = Math.max(0, Math.min(slides.length - 1, n)); setSt({ ...st, step: v }); await presentApi({ action: 'present-set', tenantId, id, step: v }); };
  if (err) return <p className="p-6 text-center">{err}</p>;
  if (!st || !L) return <p className="p-6 text-center text-muted-foreground">Connecting…</p>;
  const s = slides[st.step] || slides[0]; const plan = L.plan || {};
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Remote · {L.title}</p>
      <div className="rounded-3xl bg-muted/40 p-5"><p className="text-sm text-muted-foreground">Now showing · {st.step + 1} of {slides.length}</p><p className="text-2xl font-black">{s?.label}</p></div>
      <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => go(st.step - 1)} className="h-24 rounded-3xl bg-muted text-xl font-black active:scale-95">← Back</button><button type="button" onClick={() => go(st.step + 1)} className="h-24 rounded-3xl bg-foreground text-xl font-black text-background active:scale-95">Next →</button></div>
      {(plan.notes || plan.infectionControl) && <details open className="rounded-2xl bg-amber-50 p-4 text-sm"><summary className="cursor-pointer font-black">Speaker notes</summary>{plan.infectionControl && <p className="mt-2"><b>Infection control:</b> {plan.infectionControl}</p>}{plan.notes && <p className="mt-2 whitespace-pre-wrap">{plan.notes}</p>}</details>}
      <div className="space-y-1">{slides.map((x, i) => <button key={x.key} type="button" onClick={() => go(i)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${i === st.step ? 'bg-foreground font-bold text-background' : 'bg-muted/30'}`}><span className="w-6 text-right text-[12px] opacity-60">{i + 1}</span>{x.label}</button>)}</div>
    </div>
  );
}
