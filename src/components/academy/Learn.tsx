'use client';
// src/components/academy/Learn.tsx
//
// THE ACADEMY, AS STUDENTS SEE IT — /learn/{business}/…
//   Catalog     every published course
//   Course      what you'll learn, the curriculum (free previews playable),
//               price, enrol (card or pay-later); "Continue" once enrolled
//   Lesson      protected video (Mux) or embedded link, notes, download,
//               "Mark complete → next", curriculum with ticks, progress bar
//   My courses  sign in by email link (no passwords), progress, continue
//   Welcome     after paying: confirms, signs you in, takes you to the course
//
// A student's sign-in is a token kept in this browser (30 days).

import { InteractiveFrame } from '@/components/academy/InteractiveFrame';
import { wordSearch as wordSearchGrid, crossword as crosswordGrid } from '@/lib/printables';
import { Celebrate, Skeleton } from '@/components/academy/Delight';
import { useCallback, useEffect, useMemo, useRef, useState, createElement } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { StudentPortal } from '@/components/academy/StudentPortal';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';

export const key = (t: string) => `cf_student_${t}`;
export const getToken = (t: string) => { try { return localStorage.getItem(key(t)); } catch { return null; } };
export const setToken = (t: string, v: string | null) => { try { v ? localStorage.setItem(key(t), v) : localStorage.removeItem(key(t)); } catch { /* private mode */ } };
export async function api(body: any) {
  const r = await fetch('/api/academy/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
export const money = (c: number) => (c ? `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}` : 'Free');
const mins = (s?: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');

// ── Assignment (student) — submit writing and/or photos; see grade + feedback ─
function Assignment({ tenantId, courseId, lessonId, color }: { tenantId: string; courseId: string; lessonId: string; color: string }) {
  const [d, setD] = useState<any>(null); const [text, setText] = useState(''); const [files, setFiles] = useState<{ name: string; data: string; preview?: string }[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await api({ action: 'assignment', tenantId, token: getToken(tenantId), courseId, lessonId }); setD(r); if (r.ok && r.submission) setText(r.submission.text || ''); }, [tenantId, courseId, lessonId]);
  useEffect(() => { void load(); }, [load]);
  if (!d?.ok) return null;
  const s = d.submission; const canSubmit = !s || s.status === 'resubmit' || (s.status === 'submitted');
  const add = async (fl: FileList | null) => { if (!fl) return; for (const f of Array.from(fl).slice(0, 8)) { if (f.type.startsWith('image/')) { const url = await new Promise<string>((res) => { const r = new FileReader(); const img = new Image(); r.onload = () => { img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.8)); }; img.src = String(r.result); }; r.readAsDataURL(f); }); setFiles((x) => [...x, { name: f.name, data: url, preview: url }]); }
    else { const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); }); setFiles((x) => [...x, { name: f.name, data }]); } } };
  return (
    <Glass className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-lg font-semibold">📎 Your submission</p>{d.due && <p className="text-[12px] text-stone-500">Due {new Date(d.due).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>}</div>
      {s?.grade && s.status !== 'submitted' && (
        <div className={`rounded-2xl p-4 ${s.status === 'resubmit' ? 'bg-sky-50' : 'bg-emerald-50'}`}><p className="text-2xl font-semibold">{s.grade.pct}% <span className="text-lg">· {s.grade.letter}</span></p>{s.status === 'resubmit' && <p className="text-sm font-semibold text-sky-900">Your instructor has asked you to try again.</p>}<p className="mt-1 whitespace-pre-wrap text-[15px]">{s.grade.feedback}</p><p className="mt-1 text-[11px] text-stone-500">{s.grade.by} · {new Date(s.grade.at).toLocaleDateString()}</p></div>
      )}
      {s?.status === 'submitted' && <p className="rounded-2xl bg-amber-50 p-3 text-sm">✓ Submitted {new Date(s.submittedAt).toLocaleString()} — waiting for your instructor. You can still update it.</p>}
      {(s?.files || []).length > 0 && <div className="flex flex-wrap gap-2">{s.files.map((f: any, i: number) => f.type?.startsWith('image/') ? <img key={i} src={f.url} alt={f.name} className="h-20 w-20 rounded-xl object-cover" /> : <a key={i} href={f.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white/80 px-3 py-2 text-sm">📄 {f.name}</a>)}</div>}
      {canSubmit && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Write your answer here" className="w-full rounded-2xl border border-white/80 bg-white/80 p-3 text-[15px]" />
          <div className="flex flex-wrap gap-2">{files.map((f, i) => <div key={i} className="relative">{f.preview ? <img src={f.preview} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-white/80 text-center text-[11px]">📄 {f.name}</div>}<button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))} className="absolute -right-1 -top-1 h-6 w-6 rounded-full bg-black/70 text-[11px] text-white" aria-label="Remove">✕</button></div>)}
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-[12px]">📷<span>Add</span><input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void add(e.target.files)} /></label></div>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <button type="button" disabled={busy || (!text.trim() && !files.length)} onClick={async () => { setBusy(true); setErr(''); const r = await api({ action: 'assignment-submit', tenantId, token: getToken(tenantId), courseId, lessonId, text, files: files.map((f) => ({ name: f.name, data: f.data })) }); setBusy(false); if (r.ok) { setFiles([]); void load(); } else setErr(r.error); }} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>{busy ? 'Sending…' : s ? 'Submit again' : 'Submit'}</button>
        </>
      )}
    </Glass>
  );
}

// ── Lesson content blocks (student view) ────────────────────────────────
function Blocks({ blocks, accent }: { blocks: any[]; accent?: string | null }) {
  const tone: Record<string, [string, string]> = { safety: ['🛑 Safety', 'border-red-200 bg-red-50/90 text-red-950'], key: ['⭐ Key point', 'border-amber-200 bg-amber-50/90 text-amber-950'], tip: ['💡 Tip', 'border-sky-200 bg-sky-50/90 text-sky-950'] };
  return (
    <div className="space-y-4">{blocks.map((b: any, i: number) => {
      if (b.type === 'text') return <Glass key={i}><Prose text={b.text} /></Glass>;
      if (b.type === 'callout') return <div key={i} className={`rounded-[1.25rem] border-2 p-4 ${tone[b.tone]?.[1] || ''}`}><p className="text-[12px] font-semibold uppercase tracking-widest">{tone[b.tone]?.[0]}</p><p className="mt-1 whitespace-pre-wrap text-[15px]">{b.text}</p></div>;
      if (b.type === 'image') return b.media?.url ? <figure key={i}><img src={b.media.url} alt={b.caption || ''} className="w-full rounded-[1.25rem]" />{b.caption && <figcaption className="mt-1 text-center text-[13px] text-stone-500">{b.caption}</figcaption>}</figure> : null;
      if (b.type === 'file') return b.media?.url ? <a key={i} href={b.media.url} target="_blank" rel="noreferrer" className="glass flex items-center justify-between rounded-2xl border border-white/70 px-4 py-3 text-sm"><span>{b.media.kind === 'audio' ? '🎧' : '📄'} {b.label || b.media.name}</span><span className="text-stone-500">Open</span></a> : null;
      if (b.type === 'steps') return (
        <Glass key={i} className="space-y-4">{b.title && <p className="text-lg font-semibold">{b.title}</p>}
          {b.steps.map((s: any, k: number) => <div key={k} className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-sm font-semibold text-white">{k + 1}</span>
            <div className="space-y-2">{s.text && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{s.text}</p>}{s.media?.url && <img src={s.media.url} alt={`Step ${k + 1}`} className="w-full max-w-md rounded-2xl" />}</div></div>)}</Glass>
      );
      if (b.type === 'divider') return <hr key={i} className="border-white/70" />;
      if (b.type === 'interactive') return <div key={i} className="space-y-1">{b.title && <p className="px-1 text-lg font-semibold">✨ {b.title}</p>}<InteractiveFrame html={b.html} title={b.title} accent={accent} /></div>;
      if (b.type === 'hotspots') return b.media?.url ? <Hotspots key={i} b={b} /> : null;
      if (b.type === 'stages') return <Stages key={i} b={b} />;
      return null;
    })}</div>
  );
}

// ── Accessibility: size, contrast, easier font, less motion (this device) ─
const A11Y_KEY = 'cf_a11y';
type A11y = { size: 0 | 1 | 2 | 3; contrast: boolean; readable: boolean; still: boolean };
const A11Y_DEFAULT: A11y = { size: 0, contrast: false, readable: false, still: false };
function useA11y() {
  const [a, setA] = useState<A11y>(A11Y_DEFAULT);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(A11Y_KEY) || 'null'); if (v) setA({ ...A11Y_DEFAULT, ...v }); } catch { /* none */ } }, []);
  useEffect(() => {
    const html = document.documentElement; const prev = html.style.fontSize;
    html.style.fontSize = ['100%', '112.5%', '125%', '140%'][a.size];
    if (a.readable && !document.querySelector('link[data-cf-font]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap'; l.dataset.cfFont = '1'; document.head.appendChild(l); }
    return () => { html.style.fontSize = prev; };
  }, [a.size, a.readable]);
  const save = (next: A11y) => { setA(next); try { localStorage.setItem(A11Y_KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  return [a, save] as const;
}
const A11Y_CSS = `
[data-cf-contrast="1"] .glass, [data-cf-contrast="1"] section, [data-cf-contrast="1"] header { background:#fff !important; backdrop-filter:none !important; border-color:#1c1917 !important; }
[data-cf-contrast="1"] [class*="text-stone-4"], [data-cf-contrast="1"] [class*="text-stone-5"], [data-cf-contrast="1"] [class*="text-stone-6"] { color:#1c1917 !important; }
[data-cf-contrast="1"] .cf-backdrop { display:none !important; }
[data-cf-readable="1"] { font-family: 'Atkinson Hyperlegible', system-ui, sans-serif !important; letter-spacing:.02em; word-spacing:.08em; }
[data-cf-readable="1"] p, [data-cf-readable="1"] li { line-height:1.8 !important; }
[data-cf-still="1"] *, [data-cf-still="1"] *::before, [data-cf-still="1"] *::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; }
`;
function A11yMenu({ a, save }: { a: A11y; save: (x: A11y) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Reading and display settings" className="h-9 rounded-full bg-white/70 px-3 text-sm font-semibold">Aa</button>
      {open && typeof document !== 'undefined' && createPortal(
        <>
        <div className="fixed inset-0 z-[70] bg-black/20" onClick={() => setOpen(false)} aria-hidden />
        <div className="fixed inset-x-3 top-16 z-[71] space-y-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-900 shadow-2xl sm:inset-x-auto sm:right-6 sm:w-80" role="dialog" aria-label="Display settings">
          <div className="flex items-center justify-between"><p className="font-semibold">Reading & display</p><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="h-8 w-8 rounded-full bg-stone-100">✕</button></div>
          <div><p className="font-semibold">Text size</p><div className="mt-1 flex gap-1">{[0, 1, 2, 3].map((n) => <button key={n} type="button" onClick={() => save({ ...a, size: n as A11y['size'] })} aria-pressed={a.size === n} className={`h-9 flex-1 rounded-lg ${a.size === n ? 'bg-stone-900 text-white' : 'bg-stone-100'}`} style={{ fontSize: 12 + n * 3 }}>A</button>)}</div></div>
          {([['contrast', 'High contrast', 'Solid backgrounds, darker text'], ['readable', 'Easier-to-read font', 'Clearer letters and more spacing — helpful for dyslexia'], ['still', 'Reduce motion', 'No animations']] as const).map(([k, l, h]) => (
            <label key={k} className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-1" checked={a[k]} onChange={(e) => save({ ...a, [k]: e.target.checked })} /><span><span className="font-semibold">{l}</span><span className="block text-[12px] text-stone-500">{h}</span></span></label>
          ))}
          <p className="text-[11px] text-stone-500">Saved on this device. Lessons also have “Listen” to hear the notes read aloud, and videos have their own caption and speed controls.</p>
        </div>
        </>, document.body)}
    </div>
  );
}

/** Read the lesson notes aloud (the device's own voice). */
function Listen({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => { try { window.speechSynthesis.cancel(); } catch { /* none */ } }, []);
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) return null;
  const toggle = () => { const s = window.speechSynthesis; if (on) { s.cancel(); setOn(false); return; } const u = new SpeechSynthesisUtterance(text.replace(/^#+\s*/gm, '')); u.rate = 0.95; u.onend = () => setOn(false); s.cancel(); s.speak(u); setOn(true); };
  return <button type="button" onClick={toggle} className="rounded-full bg-white/80 px-4 py-2 text-sm shadow-sm">{on ? '■ Stop' : '🔊 Listen'}</button>;
}

// ── Flashcards: flip, then "Got it" or "Again" (missed cards come back) ───
function Flashcards({ cards, color }: { cards: { front: string; back: string }[]; color: string }) {
  const [deck, setDeck] = useState(() => cards.map((c, i) => ({ ...c, i })));
  const [flip, setFlip] = useState(false);
  const [known, setKnown] = useState(0);
  if (!deck.length) return <Glass className="text-center"><p className="text-lg font-semibold">🎉 All {cards.length} cards learned</p><button type="button" onClick={() => { setDeck(cards.map((c, i) => ({ ...c, i }))); setKnown(0); }} className="mt-2 text-sm underline">Go again</button></Glass>;
  const c = deck[0];
  const next = (gotIt: boolean) => { setFlip(false); if (gotIt) { setKnown(known + 1); setDeck(deck.slice(1)); } else setDeck([...deck.slice(1), c]); };
  return (
    <Glass className="space-y-3">
      <div className="flex justify-between text-[12px] text-stone-500"><span>Flashcards</span><span>{known} of {cards.length} learned</span></div>
      <button type="button" onClick={() => setFlip(!flip)} aria-label={flip ? 'Show question' : 'Show answer'} className="flex min-h-40 w-full items-center justify-center rounded-2xl bg-white/80 p-6 text-center text-xl">{flip ? c.back : c.front}</button>
      <p className="text-center text-[12px] text-stone-500">{flip ? 'Did you know it?' : 'Tap the card to see the answer'}</p>
      {flip && <div className="flex gap-2"><button type="button" onClick={() => next(false)} className="h-11 flex-1 rounded-full bg-white/80 text-sm">Again</button><button type="button" onClick={() => next(true)} className="h-11 flex-1 rounded-full text-sm font-medium text-white" style={{ background: color }}>Got it</button></div>}
    </Glass>
  );
}

// ── Activities: match · put in order · client scenario ──────────────────
function shuffle<T>(xs: T[]) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function Activity({ a, color, report }: { a: any; color: string; report?: (pct: number) => void }) {
  if (a.type === 'wordsearch') return <WordSearchGame a={a} color={color} report={report} />;
  if (a.type === 'crossword') return <CrosswordGame a={a} color={color} report={report} />;
  if (a.type === 'cloze') return <ClozeGame a={a} color={color} report={report} />;
  if (a.type === 'match') return <MatchGame a={a} color={color} />;
  if (a.type === 'order') return <OrderGame a={a} color={color} />;
  if (a.type === 'label') return <LabelGame a={a} color={color} />;
  return <Scenario a={a} color={color} />;
}
/** Hotspots on an image: tap a number to learn about that part. */
function Hotspots({ b }: { b: any }) {
  const [on, setOn] = useState<number | null>(null);
  return (
    <Glass className="space-y-3">{b.title && <p className="text-lg font-semibold">📍 {b.title}</p>}
      <div className="relative mx-auto w-fit max-w-full"><img src={b.media.url} alt={b.title || ''} className="max-h-[70vh] max-w-full rounded-2xl" />
        {b.points.map((p: any, i: number) => <button key={i} type="button" onClick={() => setOn(on === i ? null : i)} aria-label={p.label} className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white transition ${on === i ? 'scale-110 bg-violet-700' : 'bg-stone-900/80'}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>{i + 1}</button>)}</div>
      {on != null ? <div className="rounded-2xl bg-white/85 p-3"><p className="font-semibold">{on + 1}. {b.points[on].label}</p><p className="text-[15px] text-stone-700">{b.points[on].text}</p></div> : <p className="text-center text-[13px] text-stone-500">Tap a number to learn about that part.</p>}
      <div className="flex flex-wrap gap-1.5">{b.points.map((p: any, i: number) => <button key={i} type="button" onClick={() => setOn(i)} className={`rounded-full px-2.5 py-1 text-[12px] ${on === i ? 'bg-violet-700 text-white' : 'bg-white/80'}`}>{i + 1}. {p.label}</button>)}</div>
    </Glass>
  );
}

/** Stages: drag through a process one stage at a time. */
function Stages({ b }: { b: any }) {
  const [k, setK] = useState(0); const st = b.stages[k] || {};
  if (!b.stages.length) return null;
  return (
    <Glass className="space-y-3">{b.title && <p className="text-lg font-semibold">🎚 {b.title}</p>}
      {st.media?.url && <img src={st.media.url} alt={st.label} className="w-full rounded-2xl" />}
      <div><p className="text-[11px] uppercase tracking-widest text-stone-500">Stage {k + 1} of {b.stages.length}</p><p className="text-xl font-semibold">{st.label}</p><p className="text-[15px] text-stone-700">{st.text}</p></div>
      <input type="range" min={0} max={b.stages.length - 1} step={1} value={k} onChange={(e) => setK(Number(e.target.value))} className="w-full" aria-label="Stage" />
      <div className="flex justify-between gap-1 text-[11px] text-stone-500">{b.stages.map((x: any, i: number) => <button key={i} type="button" onClick={() => setK(i)} className={i === k ? 'font-semibold text-stone-900' : ''}>{x.label || i + 1}</button>)}</div>
    </Glass>
  );
}

/** Refer-or-treat client cases, one at a time. */
function Cases({ c, color, report }: { c: any; color: string; report?: (pct: number) => void }) {
  const [i, setI] = useState(0); const [pick, setPick] = useState<number | null>(null); const [right, setRight] = useState(0); const [done, setDone] = useState(false);
  const x = c.cases[i];
  if (done) return <Glass className="space-y-2 text-center"><p className="text-3xl">🩺</p><p className="text-xl font-semibold">{right} of {c.cases.length} right</p><p className="text-stone-600">Saved. When in doubt, refer — a doctor can rule things out safely.</p><button type="button" onClick={() => { setI(0); setPick(null); setRight(0); setDone(false); }} className="text-sm underline">Try again</button></Glass>;
  return (
    <Glass className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-lg font-semibold">🩺 {c.prompt}</p><span className="text-sm text-stone-500">{i + 1}/{c.cases.length}</span></div>
      {x.media?.url && <img src={x.media.url} alt="" className="w-full rounded-2xl" />}
      <p className="whitespace-pre-wrap text-[16px] leading-relaxed">{x.story}</p>
      <div className="grid gap-2">{x.options.map((o: any, k: number) => { const chosen = pick === k; return <button key={k} type="button" disabled={pick != null} onClick={() => { setPick(k); if (o.correct) setRight((n) => n + 1); }} className={`min-h-12 rounded-2xl px-4 py-2 text-left text-[15px] ${pick != null && o.correct ? 'bg-emerald-600 text-white' : chosen ? 'bg-red-500 text-white' : 'bg-white/90'}`}>{o.text}</button>; })}</div>
      {pick != null && <><p className="rounded-2xl bg-white/85 p-3 text-[15px]">{x.options[pick].feedback || (x.options[pick].correct ? 'Right choice.' : 'Not the best choice here.')}</p>
        <button type="button" onClick={() => { if (i + 1 >= c.cases.length) { setDone(true); report?.(Math.round((right / c.cases.length) * 100)); } else { setI(i + 1); setPick(null); } }} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>{i + 1 >= c.cases.length ? 'See my score' : 'Next case'}</button></>}
    </Glass>
  );
}

/** Word search: tap the first letter, then the last letter of a word. */
function WordSearchGame({ a, color, report }: { a: any; color: string; report?: (pct: number) => void }) {
  const size = Math.min(14, Math.max(10, ...a.words.map((w: string) => w.replace(/[^A-Za-z]/g, '').length)));
  const ws = useMemo(() => wordSearchGrid(a.words, size, a.seed), [a.words, size, a.seed]);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [found, setFound] = useState<string[]>([]);
  const [miss, setMiss] = useState(false);
  const cellsOf = (w: string) => ws.placed.find((p: any) => p.word === w)?.cells || [];
  const lit = new Set(found.flatMap((w) => cellsOf(w).map(([r, c]: any) => `${r},${c}`)));
  const tap = (r: number, c: number) => {
    if (!start) { setStart([r, c]); return; }
    const [r0, c0] = start; setStart(null);
    const hit = ws.placed.find((p: any) => { const f = p.cells[0], l = p.cells[p.cells.length - 1]; return (f[0] === r0 && f[1] === c0 && l[0] === r && l[1] === c) || (l[0] === r0 && l[1] === c0 && f[0] === r && f[1] === c); });
    if (hit && !found.includes(hit.word)) { const nf = [...found, hit.word]; setFound(nf); if (nf.length === ws.placed.length) report?.(100); }
    else if (!hit) { setMiss(true); setTimeout(() => setMiss(false), 600); }
  };
  const done = found.length === ws.placed.length;
  return (
    <Glass className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-lg font-semibold">🔎 {a.prompt}</p><span className="text-sm font-semibold">{found.length}/{ws.placed.length}</span></div>
      <p className="text-[13px] text-stone-500">Tap the first letter of a word, then its last letter.</p>
      <div className={`mx-auto grid w-full max-w-md select-none gap-0.5 ${miss ? 'animate-pulse' : ''}`} style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
        {ws.grid.map((row: string[], r: number) => row.map((ch, c) => { const on = lit.has(`${r},${c}`); const st = start && start[0] === r && start[1] === c; return (
          <button key={`${r},${c}`} type="button" onClick={() => tap(r, c)} className={`aspect-square rounded-md text-[13px] font-semibold sm:text-sm ${st ? 'text-white' : on ? 'bg-emerald-200 text-emerald-900' : 'bg-white/80'}`} style={st ? { background: color } : undefined}>{ch}</button>
        ); }))}
      </div>
      <div className="flex flex-wrap gap-1.5">{ws.placed.map((p: any) => <span key={p.word} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${found.includes(p.word) ? 'bg-emerald-100 text-emerald-800 line-through' : 'bg-white/80'}`}>{p.word}</span>)}</div>
      {done && <p className="rounded-2xl bg-emerald-50 p-3 text-center font-semibold text-emerald-800">🎉 All found — saved!</p>}
    </Glass>
  );
}

/** Crossword: type into the grid, then Check. */
function CrosswordGame({ a, color, report }: { a: any; color: string; report?: (pct: number) => void }) {
  const cw = useMemo(() => crosswordGrid(a.entries, a.seed), [a.entries, a.seed]);
  const [v, setV] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const dirRef = useRef<boolean>(false);
  const wordOk = (p: any) => [...p.word].every((ch: string, i: number) => (v[`${p.row + (p.down ? i : 0)},${p.col + (p.down ? 0 : i)}`] || '') === ch);
  const right = cw.placed.filter(wordOk).length;
  const clues = (down: boolean) => cw.placed.filter((p: any) => p.down === down).map((p: any) => ({ ...p, n: cw.numbers.get(`${p.row},${p.col}`) })).sort((x: any, y: any) => x.n - y.n);
  const type = (r: number, c: number, ch: string) => {
    const L = ch.toUpperCase().replace(/[^A-Z]/g, '').slice(-1); setV((x) => ({ ...x, [`${r},${c}`]: L })); setChecked(false);
    if (!L) return;
    const across = cw.grid[r]?.[c + 1], down = cw.grid[r + 1]?.[c];
    const next = dirRef.current ? (down ? `${r + 1},${c}` : across ? `${r},${c + 1}` : null) : (across ? `${r},${c + 1}` : down ? `${r + 1},${c}` : null);
    if (next) refs.current[next]?.focus();
  };
  return (
    <Glass className="space-y-3">
      <p className="text-lg font-semibold">✏️ {a.prompt}</p>
      <div className="overflow-x-auto"><div className="mx-auto grid w-max gap-0" style={{ gridTemplateColumns: `repeat(${cw.cols}, 1.9rem)` }}>
        {cw.grid.map((row: string[], r: number) => row.map((sol, c) => { const k = `${r},${c}`; if (!sol) return <span key={k} className="h-[1.9rem] w-[1.9rem]" />; const bad = checked && v[k] !== sol; const good = checked && v[k] === sol; return (
          <label key={k} className={`relative h-[1.9rem] w-[1.9rem] border border-stone-800 ${good ? 'bg-emerald-100' : bad ? 'bg-red-100' : 'bg-white'}`}>
            {cw.numbers.has(k) && <span className="absolute left-0.5 top-0 text-[8px] font-semibold leading-none">{cw.numbers.get(k)}</span>}
            <input ref={(el) => { refs.current[k] = el; }} value={v[k] || ''} onFocus={() => { dirRef.current = !cw.grid[r]?.[c + 1] && !cw.grid[r]?.[c - 1]; }} onChange={(e) => type(r, c, e.target.value)} maxLength={2} inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label={`Row ${r + 1} column ${c + 1}`} className="h-full w-full bg-transparent text-center text-[15px] font-semibold uppercase outline-none focus:bg-amber-50" />
          </label>
        ); }))}
      </div></div>
      <div className="grid gap-3 sm:grid-cols-2">{[false, true].map((down) => <div key={String(down)}><p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">{down ? 'Down' : 'Across'}</p>{clues(down).map((p: any) => <p key={`${p.n}${down}`} className={`text-[14px] ${checked && wordOk(p) ? 'text-emerald-700' : ''}`}><b>{p.n}.</b> {p.clue} <span className="text-stone-400">({p.word.length})</span></p>)}</div>)}</div>
      <button type="button" onClick={() => { setChecked(true); report?.(Math.round((right / Math.max(1, cw.placed.length)) * 100)); }} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>Check · {checked ? `${right} of ${cw.placed.length} right — saved` : 'see how you did'}</button>
    </Glass>
  );
}

/** Fill in the blanks, with the word bank. */
function ClozeGame({ a, color, report }: { a: any; color: string; report?: (pct: number) => void }) {
  const [ans, setAns] = useState<string[]>(() => a.items.map(() => ''));
  const [checked, setChecked] = useState(false);
  const bank = useMemo<string[]>(() => shuffle<string>(a.items.map((x: any) => String(x.answer))), [a.items]);
  const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
  const right = a.items.filter((x: any, i: number) => norm(ans[i]) === norm(x.answer)).length;
  return (
    <Glass className="space-y-3">
      <p className="text-lg font-semibold">📝 {a.prompt}</p>
      <div className="flex flex-wrap gap-1.5">{bank.map((w: string, i: number) => <span key={i} className="rounded-full bg-white/80 px-2.5 py-1 text-[12px]">{w}</span>)}</div>
      {a.items.map((x: any, i: number) => { const [before, after] = String(x.sentence).split('____'); const ok = checked && norm(ans[i]) === norm(x.answer); const bad = checked && !ok; return (
        <p key={i} className="text-[15px] leading-9">{i + 1}. {before}<input value={ans[i]} onChange={(e) => { const n = [...ans]; n[i] = e.target.value; setAns(n); setChecked(false); }} className={`mx-1 h-9 w-36 rounded-lg border-2 px-2 text-[15px] ${ok ? 'border-emerald-500 bg-emerald-50' : bad ? 'border-red-400 bg-red-50' : 'border-stone-300 bg-white'}`} aria-label={`Blank ${i + 1}`} />{after}{bad && <span className="ml-1 text-[12px] text-red-700">→ {x.answer}</span>}</p>
      ); })}
      <button type="button" onClick={() => { setChecked(true); report?.(Math.round((right / Math.max(1, a.items.length)) * 100)); }} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>{checked ? `${right} of ${a.items.length} right — saved` : 'Check my answers'}</button>
    </Glass>
  );
}

/** Label the diagram: tap a label, then the numbered spot it belongs to. */
function LabelGame({ a, color }: { a: any; color: string }) {
  const [labels] = useState(() => shuffle(a.points.map((p: any, i: number) => ({ text: p.label, i }))));
  const [pick, setPick] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState<number | null>(null);
  const place = (i: number) => { if (pick == null || done.has(i)) return; if (pick === i) { setDone(new Set([...done, i])); setPick(null); } else { setWrong(i); setTimeout(() => setWrong(null), 700); } };
  return (
    <Glass className="space-y-3">
      <p className="font-semibold">{a.prompt}</p><p className="text-[12px] text-stone-500">Tap a label below, then the numbered spot it belongs to.</p>
      <div className="relative inline-block w-full">
        <img src={a.imageUrl} alt="Diagram to label" className="w-full rounded-2xl" />
        {a.points.map((p: any, i: number) => (
          <button key={i} type="button" onClick={() => place(i)} aria-label={done.has(i) ? `Spot ${i + 1}: ${p.label}` : `Spot ${i + 1}`} className={`absolute flex min-h-8 min-w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-2 text-[12px] font-bold shadow ring-2 ring-white ${done.has(i) ? 'bg-emerald-600 text-white' : wrong === i ? 'bg-red-500 text-white' : 'bg-white text-stone-900'}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>{done.has(i) ? p.label : i + 1}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">{labels.filter((l: any) => !done.has(l.i)).map((l: any) => <button key={l.i} type="button" onClick={() => setPick(l.i)} aria-pressed={pick === l.i} className={`rounded-full px-3 py-2 text-sm ${pick === l.i ? 'text-white' : 'bg-white/80'}`} style={pick === l.i ? { background: color } : undefined}>{l.text}</button>)}</div>
      {done.size === a.points.length && <p className="font-semibold text-emerald-700">🎉 All labelled!</p>}
    </Glass>
  );
}
function MatchGame({ a, color }: { a: any; color: string }) {
  const [rights] = useState(() => shuffle(a.pairs.map((p: any, i: number) => ({ text: p.right, i }))));
  const [pick, setPick] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState<number | null>(null);
  const tryMatch = (ri: number) => { if (pick == null) return; if (ri === pick) { setDone(new Set([...done, pick])); setPick(null); } else { setWrong(ri); setTimeout(() => setWrong(null), 700); } };
  return (
    <Glass className="space-y-3">
      <p className="font-semibold">{a.prompt}</p><p className="text-[12px] text-stone-500">Tap an item on the left, then its match on the right.</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">{a.pairs.map((p: any, i: number) => <button key={i} type="button" disabled={done.has(i)} onClick={() => setPick(i)} aria-pressed={pick === i} className={`w-full rounded-xl p-3 text-left text-sm ${done.has(i) ? 'bg-emerald-100 text-emerald-800' : pick === i ? 'text-white' : 'bg-white/80'}`} style={pick === i && !done.has(i) ? { background: color } : undefined}>{done.has(i) ? '✓ ' : ''}{p.left}</button>)}</div>
        <div className="space-y-2">{rights.map((r: any) => <button key={r.i} type="button" disabled={done.has(r.i)} onClick={() => tryMatch(r.i)} className={`w-full rounded-xl p-3 text-left text-sm ${done.has(r.i) ? 'bg-emerald-100 text-emerald-800' : wrong === r.i ? 'bg-red-100' : 'bg-white/80'}`}>{r.text}</button>)}</div>
      </div>
      {done.size === a.pairs.length && <p className="font-semibold text-emerald-700">🎉 All matched!</p>}
    </Glass>
  );
}
function OrderGame({ a, color }: { a: any; color: string }) {
  const [items, setItems] = useState<string[]>(() => { let s = shuffle(a.steps as string[]); if (s.join('|') === a.steps.join('|')) s = [...s].reverse(); return s; });
  const [checked, setChecked] = useState(false);
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; setItems(n); setChecked(false); };
  const right = items.every((x, i) => x === a.steps[i]);
  return (
    <Glass className="space-y-3">
      <p className="font-semibold">{a.prompt}</p><p className="text-[12px] text-stone-500">Use the arrows to put them in order, then check.</p>
      <ol className="space-y-1.5">{items.map((x, i) => (
        <li key={x} className={`flex items-center gap-2 rounded-xl p-2.5 text-sm ${checked ? (x === a.steps[i] ? 'bg-emerald-100' : 'bg-red-100') : 'bg-white/80'}`}>
          <span className="w-6 text-center font-semibold">{i + 1}</span><span className="flex-1">{x}</span>
          <button type="button" onClick={() => move(i, -1)} aria-label={`Move “${x}” up`} className="h-8 w-8 rounded-lg bg-white">↑</button>
          <button type="button" onClick={() => move(i, 1)} aria-label={`Move “${x}” down`} className="h-8 w-8 rounded-lg bg-white">↓</button>
        </li>
      ))}</ol>
      <button type="button" onClick={() => setChecked(true)} className="h-11 rounded-full px-6 text-sm font-medium text-white" style={{ background: color }}>Check my order</button>
      {checked && <p className={`font-semibold ${right ? 'text-emerald-700' : 'text-stone-700'}`}>{right ? '🎉 Perfect order!' : 'Not quite — the red ones are in the wrong place.'}</p>}
    </Glass>
  );
}
function Scenario({ a, color }: { a: any; color: string }) {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <Glass className="space-y-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">Client scenario</p>
      <p className="whitespace-pre-wrap text-[15px] font-semibold">{a.prompt}</p>
      <div className="space-y-2">{a.options.map((o: any, i: number) => (
        <div key={i}>
          <button type="button" onClick={() => setChosen(i)} className={`w-full rounded-xl p-3 text-left text-sm ${chosen === i ? (o.correct ? 'bg-emerald-100' : 'bg-red-100') : 'bg-white/80'}`}>{o.text}</button>
          {chosen === i && <p className={`mt-1 px-2 text-[13px] ${o.correct ? 'text-emerald-800' : 'text-red-800'}`}>{o.correct ? '✓ ' : '✗ '}{o.feedback}</p>}
        </div>
      ))}</div>
      {chosen != null && !a.options[chosen].correct && <p className="text-[12px] text-stone-500">Try another answer.</p>}
    </Glass>
  );
}

// ── Ask the tutor ─────────────────────────────────────────────────────────
function Tutor({ tenantId, courseId, lessonId, color }: { tenantId: string; courseId: string; lessonId: string; color: string }) {
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ask = async () => {
    const question = q.trim(); if (!question) return;
    setBusy(true); setErr('');
    const r = await api({ action: 'tutor', tenantId, token: getToken(tenantId), courseId, lessonId, question });
    setBusy(false);
    if (r.ok) { setChat([...chat, { q: question, a: r.answer }]); setQ(''); } else setErr(r.error || 'Try again.');
  };
  return (
    <Glass className="space-y-3">
      <p className="font-semibold">✨ Ask the tutor</p>
      <p className="text-[12px] text-stone-500">Answers come only from this course’s lessons. For anything else, message your instructor.</p>
      {chat.map((c, i) => <div key={i} className="space-y-1.5"><p className="ml-auto max-w-[85%] rounded-2xl px-3 py-2 text-sm text-white" style={{ background: color }}>{c.q}</p><p className="max-w-[92%] whitespace-pre-wrap rounded-2xl bg-white/80 px-3 py-2 text-sm">{c.a}</p></div>)}
      <div className="flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} placeholder="e.g. Why does the apex sit behind the stress point?" className="h-11 flex-1 rounded-2xl border border-white/80 bg-white/75 px-4 text-sm" />
        <button type="button" disabled={busy || !q.trim()} onClick={ask} className="rounded-2xl px-4 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>{busy ? '…' : 'Ask'}</button></div>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </Glass>
  );
}

// ── Motion: one shared style — splash landings, staggered reveals, unlock bursts ─
export const MOTION_CSS = `
@keyframes cf-land{0%{opacity:0;transform:translateY(22px) scale(.97)}60%{opacity:1;transform:translateY(-3px) scale(1.005)}100%{opacity:1;transform:none}}
.cf-land{animation:cf-land .62s cubic-bezier(.34,1.56,.64,1) both}
.cf-stagger>*{animation:cf-land .62s cubic-bezier(.34,1.56,.64,1) both}
.cf-stagger>*:nth-child(2){animation-delay:.06s}.cf-stagger>*:nth-child(3){animation-delay:.12s}.cf-stagger>*:nth-child(4){animation-delay:.18s}.cf-stagger>*:nth-child(5){animation-delay:.24s}.cf-stagger>*:nth-child(6){animation-delay:.3s}.cf-stagger>*:nth-child(n+7){animation-delay:.36s}
@keyframes cf-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}.cf-pulse{animation:cf-pulse 2.2s ease-in-out infinite}
@keyframes cf-ripple{0%{opacity:.85;transform:scale(.8)}100%{opacity:0;transform:scale(2.3)}}.cf-ripple{animation:cf-ripple 1.1s ease-out 3}
@keyframes cf-pop{0%{transform:scale(.3);opacity:0}70%{transform:scale(1.14);opacity:1}100%{transform:scale(1)}}.cf-pop{animation:cf-pop .6s cubic-bezier(.34,1.56,.64,1) both}
@keyframes cf-rise{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}.cf-rise{animation:cf-rise .45s ease-out both}
@media (prefers-reduced-motion: reduce){.cf-land,.cf-stagger>*,.cf-pulse,.cf-ripple,.cf-pop,.cf-rise{animation:none!important}}
`;

export function Shell({ brand, tenantId, children }: { brand?: any; tenantId: string; children: React.ReactNode }) {
  const [a, save] = useA11y();
  return (
    <div className="relative min-h-dvh text-stone-900" data-cf-contrast={a.contrast ? '1' : undefined} data-cf-readable={a.readable ? '1' : undefined} data-cf-still={a.still ? '1' : undefined}>
      <style>{A11Y_CSS + MOTION_CSS}</style>
      <div className="cf-backdrop"><AuthBackdrop /></div>
      <div className="relative z-10">
        <header className="sticky top-0 z-20 border-b border-white/60 bg-white/55 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
            <Link href={`/learn/${tenantId}`} className="flex min-w-0 items-center gap-2">
              {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />}
              <span className="truncate text-lg font-light tracking-tight">{brand?.name || 'Academy'} <span className="font-semibold">Academy</span></span>
            </Link>
            <div className="flex shrink-0 items-center gap-2"><A11yMenu a={a} save={save} /><Link href={`/learn/${tenantId}/my`} className="rounded-full bg-white/70 px-4 py-2 text-sm">My courses</Link></div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 pb-28 pt-8">{children}</main>
        <p className="pb-8 text-center text-[11px] text-stone-400">Powered by ClarityFlow</p>
      </div>
    </div>
  );
}
export const Glass = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`glass rounded-[1.75rem] border border-white/70 p-5 ${className}`}>{children}</section>;
export const Loading = () => <Skeleton />;

/** Paragraphs and "# headings" — enough for lesson notes. */
export function Prose({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return <div className="space-y-3 text-[15px] leading-relaxed text-stone-800">{text.split(/\n{2,}/).map((p, i) => p.startsWith('#') ? <h3 key={i} className="pt-2 text-lg font-semibold">{p.replace(/^#+\s*/, '')}</h3> : <p key={i} className="whitespace-pre-wrap">{p}</p>)}</div>;
}

function MuxPlayer({ playbackId, token, color, title, bind }: { playbackId: string; token: string | null; color: string; title: string; bind?: (el: any) => void }) {
  useEffect(() => {
    if (document.querySelector('script[data-mux-player]')) return;
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@mux/mux-player@3/dist/mux-player.js'; s.async = true; s.dataset.muxPlayer = '1'; document.head.appendChild(s);
  }, []);
  return createElement('mux-player', { ref: bind, 'playback-id': playbackId, ...(token ? { 'playback-token': token } : {}), 'stream-type': 'on-demand', 'accent-color': color, 'metadata-video-title': title, style: { width: '100%', aspectRatio: '16 / 9', borderRadius: '1.25rem', overflow: 'hidden', display: 'block' } });
}

// ── Catalog ──────────────────────────────────────────────────────────────
export function Catalog({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api({ action: 'catalog', tenantId, token: getToken(tenantId) }).then(setD); }, [tenantId]);
  if (!d) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (!d.ok) return <Shell tenantId={tenantId}><Glass><p className="text-center">{d.error}</p></Glass></Shell>;
  return (
    <Shell brand={d.brand} tenantId={tenantId}>
      <h1 className="text-4xl font-light tracking-tight sm:text-5xl">Learn with <span className="font-semibold">{d.brand.name}</span></h1>
      <p className="mt-2 text-lg text-stone-600">Online courses you can take at your own pace.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {d.courses.length === 0 && <Glass><p className="text-stone-600">New courses are on the way.</p></Glass>}
        {d.courses.map((c: any) => (
          <Link key={c.id} href={`/learn/${tenantId}/${c.slug}`} className="glass block overflow-hidden rounded-[1.75rem] border border-white/70 transition hover:-translate-y-0.5">
            {c.coverUrl ? <img src={c.coverUrl} alt="" className="aspect-video w-full object-cover" /> : <div className="aspect-video w-full" style={{ background: `linear-gradient(135deg, ${d.brand.color}33, #f7f5f2)` }} />}
            <div className="p-5">
              <p className="text-xl font-semibold">{c.title}</p>
              {c.subtitle && <p className="mt-1 text-stone-600">{c.subtitle}</p>}
              <p className="mt-3 text-sm text-stone-500">{c.lessonCount} lessons{c.level ? ` · ${c.level}` : ''} · <span className="font-semibold text-stone-900">{money(c.priceCents)}</span></p>
            </div>
          </Link>
        ))}
      </div>
    </Shell>
  );
}

// ── Course page ──────────────────────────────────────────────────────────
export function Course({ tenantId, slug }: { tenantId: string; slug: string }) {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ email: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api({ action: 'course', tenantId, slug, token: getToken(tenantId) }).then(setD); }, [tenantId, slug]);
  const [celebrate, setCelebrate] = useState<any[] | null>(null);
  useEffect(() => { if (d?.justUnlocked?.length) setCelebrate(d.justUnlocked); }, [d]);
  const modules = useMemo(() => { const out: { title: string; lessons: any[] }[] = []; for (const l of d?.lessons || []) { const m = out.find((x) => x.title === l.moduleTitle); if (m) m.lessons.push(l); else out.push({ title: l.moduleTitle, lessons: [l] }); } return out; }, [d]);
  if (!d) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (!d.ok) return <Shell tenantId={tenantId}><Glass><p className="text-center">{d.error}</p></Glass></Shell>;
  const c = d.course, color = d.brand.color;
  const first = d.lessons[0]?.id;
  const cont = d.lastLessonId || d.lessons.find((l: any) => !d.progress[l.id])?.id || first;
  const done = Object.keys(d.progress || {}).length, pct = Math.round((done / Math.max(1, d.lessons.length)) * 100);
  const enrol = async () => {
    setBusy(true); setErr('');
    const r = await api({ action: 'checkout', tenantId, courseId: c.id, email: f.email || d.student?.email, name: f.name, token: getToken(tenantId) });
    if (r.ok && r.url) { window.location.href = r.url; return; }
    if (r.ok && r.free) { setToken(tenantId, r.token); router.push(`/learn/${tenantId}/${slug}/${first}`); return; }
    setBusy(false); setErr(r.error || 'Couldn’t start checkout.');
  };
  return (
    <Shell brand={d.brand} tenantId={tenantId}>
      {celebrate && <UnlockMoment items={celebrate} color={color} onClose={() => { void api({ action: 'seen-unlock', tenantId, token: getToken(tenantId), courseId: c.id, keys: celebrate.map((x) => x.key) }); setCelebrate(null); }} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {c.coverUrl && <img src={c.coverUrl} alt="" className="aspect-video w-full rounded-[1.75rem] object-cover" />}
          <div>
            <h1 className="text-4xl font-light tracking-tight sm:text-5xl">{c.title}</h1>
            {c.subtitle && <p className="mt-2 text-lg text-stone-600">{c.subtitle}</p>}
            <p className="mt-2 text-sm text-stone-500">{c.instructorName ? `With ${c.instructorName} · ` : ''}{d.lessons.length} lessons{c.level ? ` · ${c.level}` : ''}</p>
          </div>
          {c.whatYouLearn?.length > 0 && <Glass><p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">What you’ll learn</p><ul className="mt-3 grid gap-2 sm:grid-cols-2">{c.whatYouLearn.map((w: string) => <li key={w} className="flex gap-2 text-[15px]"><span style={{ color }}>✓</span>{w}</li>)}</ul></Glass>}
          {d.enrolled && d.modules?.length > 0 ? <Journey d={d} tenantId={tenantId} slug={slug} color={color} /> : <Glass>
            <p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">Curriculum</p>
            <div className="mt-3 space-y-4">
              {modules.map((m) => (
                <div key={m.title}>
                  <p className="font-semibold">{m.title}</p>
                  <div className="mt-1.5 space-y-1">{m.lessons.map((l: any) => {
                    const locked = l.unlockAt && new Date(l.unlockAt).getTime() > Date.now();
                    const open = (d.enrolled && !locked) || l.preview;
                    const row = <span className="flex items-center gap-2 rounded-2xl bg-white/60 px-3 py-2 text-sm"><span>{d.progress?.[l.id] ? '✓' : l.kind === 'video' ? '▶' : l.kind === 'download' ? '↓' : '≡'}</span><span className="min-w-0 flex-1 truncate">{l.title}</span>{!d.enrolled && l.preview && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: color }}>Watch free</span>}{!open && <span className="text-stone-400">{locked ? `🗓 ${new Date(l.unlockAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '🔒'}</span>}<span className="text-[12px] text-stone-500">{mins(l.durationSec)}</span></span>;
                    return open ? <Link key={l.id} href={`/learn/${tenantId}/${slug}/${l.id}`}>{row}</Link> : <div key={l.id}>{row}</div>;
                  })}</div>
                </div>
              ))}
            </div>
          </Glass>}
          {c.description && <Glass><Prose text={c.description} /></Glass>}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Glass className="space-y-3">
            {d.enrolled ? (
              <>
                <p className="text-lg font-semibold">You’re enrolled</p>
                {d.game && <GameChips g={d.game} color={color} />}
                <div><div className="h-2 rounded-full bg-white/70"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: color }} /></div><p className="mt-1 text-[12px] text-stone-500">{done} of {d.lessons.length} lessons · {pct}%</p></div>
                {cont && <Link href={`/learn/${tenantId}/${slug}/${cont}`} className="block h-12 rounded-full text-center text-sm font-medium leading-[3rem] text-white" style={{ background: color }}>{done ? 'Continue' : 'Start the course'}</Link>}
              </>
            ) : (
              <>
                <p className="text-3xl font-light tracking-tight">{money(c.priceCents)}</p>
                {d.payLater && <p className="text-sm text-stone-600">or pay in instalments with Klarna, Afterpay or Affirm</p>}
                {!d.student && <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="Your email" className="h-11 w-full rounded-2xl border border-white/80 bg-white/75 px-4" />}
                {!d.student && <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" className="h-11 w-full rounded-2xl border border-white/80 bg-white/75 px-4" />}
                {err && <p className="text-sm text-red-700">{err}{/already/.test(err) && <> <Link href={`/learn/${tenantId}/my`} className="underline">Sign in</Link></>}</p>}
                <button type="button" disabled={busy || (!d.student && !f.email.includes('@'))} onClick={enrol} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-50" style={{ background: color }}>{busy ? 'One moment…' : c.priceCents ? 'Enrol now' : 'Enrol free'}</button>
                <p className="text-center text-[12px] text-stone-500">Lifetime access · learn at your own pace</p>
              </>
            )}
          </Glass>
        </div>
      </div>
    </Shell>
  );
}

// ── Lesson (with verified engagement) ────────────────────────────────────
function useEngagement(opts: { tenantId: string; token: string | null; courseId?: string; lessonId: string; on: boolean; mode: 'mux' | 'embed' | 'page' }) {
  const [state, setState] = useState<{ engagedSec: number; watchedSec: number; check: string | null; paused: boolean }>({ engagedSec: 0, watchedSec: 0, check: null, paused: false });
  const sid = useRef<string | null>(null);
  const lastAct = useRef(Date.now());
  const playing = useRef(false);
  const ranges = useRef<[number, number][]>([]);
  const lastT = useRef<number | null>(null);
  const pendingAnswer = useRef<string | null>(null);

  const beat = useCallback(async () => {
    if (!sid.current) return;
    const window = opts.mode === 'embed' ? 180000 : 40000;   // an embedded video can't report play — recent activity counts
    const body = { action: 'heartbeat', tenantId: opts.tenantId, token: opts.token, sessionId: sid.current, visible: document.visibilityState === 'visible',
      playing: playing.current, interacted: Date.now() - lastAct.current <= window, ranges: ranges.current.splice(0), checkAnswer: pendingAnswer.current };
    pendingAnswer.current = null;
    const r = await api(body);
    if (r.restart) { sid.current = null; return; }
    if (r.ok) setState({ engagedSec: r.lessonEngagedSec, watchedSec: r.lessonWatchedSec, check: r.check || null, paused: !!r.paused });
  }, [opts.tenantId, opts.token, opts.mode]);

  useEffect(() => {
    if (!opts.on || !opts.courseId || !opts.token) return;
    let alive = true;
    api({ action: 'session-start', tenantId: opts.tenantId, token: opts.token, courseId: opts.courseId, lessonId: opts.lessonId }).then((r) => { if (alive && r.ok) sid.current = r.sessionId; });
    const mark = () => { lastAct.current = Date.now(); };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const iv = window.setInterval(() => void beat(), 30000);
    const end = () => { if (sid.current) navigator.sendBeacon('/api/academy/public', new Blob([JSON.stringify({ action: 'session-end', tenantId: opts.tenantId, token: opts.token, sessionId: sid.current })], { type: 'application/json' })); };
    window.addEventListener('pagehide', end);
    return () => { alive = false; evs.forEach((e) => window.removeEventListener(e, mark)); window.clearInterval(iv); window.removeEventListener('pagehide', end); end(); sid.current = null; };
  }, [opts.on, opts.courseId, opts.lessonId, opts.tenantId, opts.token, beat]);

  /** Hook the Mux player: play/pause and which seconds were actually watched. */
  const bindPlayer = useCallback((el: any) => {
    if (!el || el.__cfBound) return; el.__cfBound = true;
    el.addEventListener('playing', () => { playing.current = true; lastT.current = el.currentTime; });
    ['pause', 'ended', 'waiting'].forEach((e) => el.addEventListener(e, () => { playing.current = false; }));
    el.addEventListener('seeking', () => { lastT.current = null; });
    el.addEventListener('timeupdate', () => {
      const t = Number(el.currentTime) || 0; const prev = lastT.current;
      if (playing.current && prev != null && t > prev && t - prev <= 2.5) {
        const last = ranges.current[ranges.current.length - 1];
        if (last && Math.abs(last[1] - prev) < 0.6) last[1] = t; else ranges.current.push([prev, t]);
      }
      lastT.current = t;
    });
  }, []);
  const answer = useCallback((id: string) => { pendingAnswer.current = id; lastAct.current = Date.now(); setState((s) => ({ ...s, check: null, paused: false })); void beat(); }, [beat]);
  return { ...state, bindPlayer, answer };
}

export function Lesson({ tenantId, slug, lessonId }: { tenantId: string; slug: string; lessonId: string }) {
  const [course, setCourse] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [quizResult, setQuizResult] = useState<any>(null);
  const [tr, setTr] = useState<any>(null);          // this lesson in the student's language
  const [trBusy, setTrBusy] = useState(false);
  // Must be set up before the loading return below (React needs the same order every render).
  const [cheer, setCheer] = useState(0);
  const [recap, setRecap] = useState<any>(null); const [gained, setGained] = useState(0);
  // Video pop-up questions: pause at each time; scrubbing past one still asks it.
  const playerEl = useRef<any>(null);
  const [vq, setVq] = useState<any>(null); const [vqPick, setVqPick] = useState<number | null>(null);
  const [vqDone, setVqDone] = useState<Map<number, boolean>>(new Map());
  useEffect(() => { setVq(null); setVqPick(null); setVqDone(new Map()); }, [lessonId]);
  useEffect(() => {
    const qs: any[] = (lesson?.ok && lesson.enrolled ? lesson.lesson?.videoQuestions : null) || [];
    const el = playerEl.current; if (!el || !qs.length) return;
    const onTime = () => { if (vq) return; const t = Number(el.currentTime) || 0; const i = qs.findIndex((q, k) => !vqDone.has(k) && t >= q.at); if (i >= 0) { try { el.pause(); } catch { /* */ } setVq({ ...qs[i], i }); } };
    el.addEventListener('timeupdate', onTime); return () => el.removeEventListener('timeupdate', onTime);
  }, [lesson, vq, vqDone]);
  const token = typeof window !== 'undefined' ? getToken(tenantId) : null;
  const load = useCallback(async () => {
    const c = await api({ action: 'course', tenantId, slug, token }); setCourse(c);
    if (c.ok) setLesson(await api({ action: 'lesson', tenantId, courseId: c.course.id, lessonId, token }));
  }, [tenantId, slug, lessonId, token]);
  useEffect(() => { setQuizResult(null); setAnswers({}); setNote(''); void load(); }, [load]);
  const L0 = lesson?.ok ? lesson.lesson : null;
  // Translated view: same lesson, the student's language (quiz answers stay in the same positions).
  const L = L0 && tr ? { ...L0, title: tr.title || L0.title, body: tr.body || L0.body, transcript: tr.transcript || L0.transcript, flashcards: tr.flashcards?.length ? tr.flashcards : L0.flashcards, activity: tr.activity || L0.activity,
    quiz: L0.quiz && tr.quiz ? { ...L0.quiz, questions: L0.quiz.questions.map((q: any, i: number) => ({ ...q, ...(tr.quiz.questions[i] || {}) })) } : L0.quiz } : L0;
  const mode = L?.video?.type === 'mux' ? 'mux' : L?.video?.type === 'embed' ? 'embed' : 'page';
  const eng = useEngagement({ tenantId, token, courseId: course?.course?.id, lessonId, on: !!lesson?.enrolled, mode });
  if (!course || !lesson) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (!course.ok) return <Shell tenantId={tenantId}><Glass><p className="text-center">{course.error}</p></Glass></Shell>;
  const color = course.brand.color;
  const list = course.lessons as any[];
  const i = list.findIndex((l) => l.id === lessonId);
  const next = list[i + 1], prev = list[i - 1];
  const done = !!course.progress?.[lessonId];
  const pct = Math.round((Object.keys(course.progress || {}).length / Math.max(1, list.length)) * 100);
  const trk = lesson.tracking || {};
  const engaged = Math.max(eng.engagedSec, trk.engagedSec || 0), watched = Math.max(eng.watchedSec, trk.watchedSec || 0);
  const dur = L?.durationSec || 0;
  const complete = async () => {
    setBusy(true); setNote('');
    const r = await api({ action: 'progress', tenantId, token, courseId: course.course.id, lessonId, done: !done });
    setBusy(false);
    if (!r.ok) { setNote(r.error || 'Not yet.'); return; }
    // A little celebration on completing a lesson, then on to the next one.
    if (!done) { setCheer((n) => n + 1); if (r.game?.gained) setGained(r.game.gained); await new Promise((res) => setTimeout(res, 900)); }
    // Finished a module: celebrate it, then back to the journey (where any unlock plays).
    if (!done && (r.completedModule || r.courseDone)) { setRecap({ ...r.completedModule, courseDone: r.courseDone, nextModule: r.nextModule, game: r.game }); return; }
    if (!done && next) window.location.href = `/learn/${tenantId}/${slug}/${next.id}`; else void load();
  };
  const submitQuiz = async () => {
    const qs = L.quiz.questions; const arr = qs.map((_: any, k: number) => (answers[k] ?? -1));
    setBusy(true); const r = await api({ action: 'quiz-submit', tenantId, token, courseId: course.course.id, lessonId, answers: arr }); setBusy(false);
    setQuizResult(r); if (r.ok) void load();
  };
  return (
    <Shell brand={course.brand} tenantId={tenantId}>
      <Link href={`/learn/${tenantId}/${slug}`} className="text-sm text-stone-500">← {course.course.title}</Link>
      <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {!lesson.ok ? (
            <Glass className="text-center"><p className="text-lg font-semibold">🔒 {lesson.error}</p><Link href={`/learn/${tenantId}/${slug}`} className="mt-3 inline-block rounded-full px-5 py-2.5 text-sm text-white" style={{ background: color }}>See the course</Link></Glass>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">{L.moduleTitle}</p>
              <h1 className="text-3xl font-light tracking-tight">{L.title}</h1>
              {lesson.enrolled && lesson.studentLang && lesson.studentLang !== 'en' && (
                <div className="flex items-center gap-2"><button type="button" disabled={trBusy} onClick={async () => { if (tr) { setTr(null); return; } setTrBusy(true); const r = await api({ action: 'lesson-translate', tenantId, token, courseId: course.course.id, lessonId }); setTrBusy(false); if (r.ok) setTr(r); }} className="rounded-full bg-white/80 px-4 py-2 text-sm shadow-sm">{trBusy ? '…' : tr ? '🌐 Original' : '🌐 Translate'}</button>
                  {tr && <span className="text-[12px] text-stone-500">Translated automatically — ask your instructor if anything is unclear.</span>}</div>
              )}
              {vq && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-label="Video question">
                <div className="w-full max-w-md space-y-3 rounded-3xl bg-white p-5">
                  <p className="text-[11px] uppercase tracking-widest text-stone-500">Quick question · {vqDone.size + 1} of {(L.videoQuestions || []).length}</p>
                  <p className="text-lg font-semibold">{vq.q}</p>
                  <div className="grid gap-2">{vq.options.map((o: string, k: number) => { const chosen = vqPick === k; const right = vqPick != null && k === vq.answer; return <button key={k} type="button" disabled={vqPick != null} onClick={() => setVqPick(k)} className={`min-h-12 rounded-2xl px-4 text-left text-[15px] ${right ? 'bg-emerald-600 text-white' : chosen ? 'bg-red-500 text-white' : 'bg-stone-100'}`}>{o}</button>; })}</div>
                  {vqPick != null && <><p className="text-sm text-stone-600">{vqPick === vq.answer ? '✓ Right. ' : 'Not quite. '}{vq.explain}</p>
                    <button type="button" onClick={() => { const n = new Map(vqDone); n.set(vq.i, vqPick === vq.answer); setVqDone(n); setVq(null); setVqPick(null); if (n.size === (L.videoQuestions || []).length) void api({ action: 'activity-score', part: 'video', tenantId, token, courseId: course.course.id, lessonId, pct: Math.round(([...n.values()].filter(Boolean).length / n.size) * 100) }); try { playerEl.current?.play?.(); } catch { /* */ } }} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>Keep watching</button></>}
                </div></div>}
              {mode === 'mux' && <MuxPlayer playbackId={L.video.playbackId} token={L.video.token} color={color} title={L.title} bind={(el: any) => { eng.bindPlayer(el); playerEl.current = el; }} />}
              {mode === 'embed' && L.video.url && <iframe src={L.video.url} title={L.title} className="aspect-video w-full rounded-[1.25rem]" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
              {L.kind === 'video' && !L.video && <Glass><p className="text-stone-600">This video is being prepared — check back shortly.</p></Glass>}
              {lesson.enrolled && (
                <div className="glass flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-white/70 px-4 py-2.5 text-[13px] text-stone-600">
                  <span>⏱ Active time: <span className="font-semibold text-stone-900">{Math.floor(engaged / 60)} min</span>{trk.compliance && dur ? ` of ${Math.ceil((dur * (trk.minEngagementPct || 80)) / 100 / 60)} needed` : ''}{trk.compliance && L.minMinutes ? ` of ${L.minMinutes} needed` : ''}</span>
                  {mode === 'mux' && dur > 0 && <span>▶ Watched: <span className="font-semibold text-stone-900">{Math.min(100, Math.round((watched / dur) * 100))}%</span>{trk.compliance ? ` of ${trk.minWatchPct || 90}% needed` : ''}</span>}
                  {eng.paused && <span className="font-semibold text-amber-700">Paused — answer the check to keep your time counting</span>}
                  {trk.compliance && <span className="w-full text-[11px] text-stone-400">This course records verified learning time for your school. Time counts while this page is open and you’re actively learning.</span>}
                </div>
              )}
              {L.body && <Glass className="space-y-3"><div className="flex justify-end"><Listen text={L.body} /></div><Prose text={L.body} /></Glass>}
              <Celebrate show={cheer > 0} color={color} key={cheer} />
              {gained > 0 && <p key={`g${cheer}`} className="cf-pop fixed left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-lg" style={{ color }}>+{gained} points</p>}
              {recap && <ModuleRecap r={recap} color={color} onDone={() => { window.location.href = `/learn/${tenantId}/${slug}`; }} />}
              {(L.blocks || []).length > 0 && <Blocks blocks={L.blocks} accent={color} />}
              {lesson.enrolled && L.kind === 'assignment' && <Assignment tenantId={tenantId} courseId={course.course.id} lessonId={lessonId} color={color} />}
              {L.transcript && <details className="glass rounded-2xl border border-white/70 px-4 py-3"><summary className="cursor-pointer text-sm font-semibold">📄 Transcript</summary><p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap text-[15px] leading-relaxed text-stone-700">{L.transcript}</p></details>}
              {lesson.enrolled && L.cases?.cases?.length > 0 && <Cases c={L.cases} color={color} report={(pct) => void api({ action: 'activity-score', part: 'cases', tenantId, token, courseId: course.course.id, lessonId, pct })} />}
              {lesson.enrolled && L.activity && <Activity a={L.activity} color={color} report={(pct) => void api({ action: 'activity-score', tenantId, token, courseId: course.course.id, lessonId, pct })} />}
              {lesson.enrolled && L.flashcards?.length > 0 && <Flashcards cards={L.flashcards} color={color} />}
              {L.downloadUrl && <a href={L.downloadUrl} target="_blank" rel="noreferrer" className="glass flex items-center justify-between rounded-2xl border border-white/70 px-4 py-3 text-sm"><span>↓ {L.downloadName || 'Download'}</span><span className="text-stone-500">Open</span></a>}
              {L.quiz && lesson.enrolled && (
                <Glass className="space-y-4">
                  <div className="flex items-baseline justify-between"><p className="text-lg font-semibold">Quiz</p><p className="text-[12px] text-stone-500">Pass mark {L.quiz.passPct}%{L.quiz.passed ? ' · ✓ passed' : ''}</p></div>
                  {L.quiz.questions.map((q: any, k: number) => (
                    <div key={k} className={`rounded-2xl p-3 ${quizResult?.wrong?.includes(k) ? 'bg-red-50' : 'bg-white/60'}`}>
                      <p className="font-medium">{k + 1}. {q.q}</p>
                      <div className="mt-2 space-y-1">{q.options.map((o: string, j: number) => (
                        <label key={j} className="flex cursor-pointer items-center gap-2 text-[15px]"><input type="radio" name={`q${k}`} checked={answers[k] === j} onChange={() => setAnswers({ ...answers, [k]: j })} />{o}</label>
                      ))}</div>
                    </div>
                  ))}
                  <button type="button" disabled={busy || Object.keys(answers).length < L.quiz.questions.length} onClick={submitQuiz} className="h-11 rounded-full px-6 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>Submit answers</button>
                  {quizResult?.ok && <p className={`font-semibold ${quizResult.passed ? 'text-emerald-700' : 'text-red-700'}`}>{quizResult.score}% — {quizResult.passed ? 'passed ✓' : `not passed yet (${quizResult.correct}/${quizResult.total}). Review and try again.`}</p>}
                  {(L.quiz.attempts || []).length > 0 && <p className="text-[12px] text-stone-500">Attempts: {L.quiz.attempts.map((a: any) => `${a.score}%`).join(' · ')}</p>}
                </Glass>
              )}
              {lesson.aiTutor && <Tutor tenantId={tenantId} courseId={course.course.id} lessonId={lessonId} color={color} />}
              {note && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {prev && <Link href={`/learn/${tenantId}/${slug}/${prev.id}`} className="rounded-full bg-white/70 px-4 py-2.5 text-sm">← Previous</Link>}
                {lesson.enrolled ? (
                  <button type="button" disabled={busy || (done && trk.compliance)} onClick={complete} className="ml-auto rounded-full px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60" style={{ background: color }}>{done ? '✓ Completed' : next ? 'Mark complete → next' : 'Mark complete'}</button>
                ) : (
                  <Link href={`/learn/${tenantId}/${slug}`} className="ml-auto rounded-full px-5 py-2.5 text-sm font-medium text-white" style={{ background: color }}>Enrol to continue</Link>
                )}
              </div>
            </>
          )}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Glass className="space-y-2">
            {course.enrolled && <div><div className="h-2 rounded-full bg-white/70"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: color }} /></div><p className="mt-1 text-[12px] text-stone-500">{pct}% complete</p></div>}
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {list.map((l: any) => { const open = course.enrolled || l.preview; const cls = `flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] ${l.id === lessonId ? 'bg-white font-semibold' : ''}`; const inner = <><span>{course.progress?.[l.id] ? '✓' : open ? '○' : '🔒'}</span><span className="min-w-0 flex-1 truncate">{l.title}</span></>;
                return open ? <Link key={l.id} href={`/learn/${tenantId}/${slug}/${l.id}`} className={cls}>{inner}</Link> : <div key={l.id} className={cls + ' text-stone-400'}>{inner}</div>; })}
            </div>
          </Glass>
        </aside>
      </div>

      {eng.check && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm" role="alertdialog" aria-label="Attention check">
          <div className="w-full max-w-sm rounded-[1.75rem] bg-[#f7f5f2] p-6 text-center shadow-2xl">
            <p className="text-3xl">👋</p>
            <p className="mt-2 text-xl font-semibold">Still with us?</p>
            <p className="mt-1 text-sm text-stone-600">Your school records active learning time. Tap below to keep it counting.</p>
            <button type="button" onClick={() => eng.answer(eng.check!)} className="mt-4 h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>I’m here — continue</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── A live selfie for clock-in (camera only — not a photo from the gallery) ─
function SelfieCamera({ onPhoto }: { onPhoto: (dataUrl: string | null, live: boolean) => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (shot) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; void video.current.play(); } })
      .catch(() => { setLive(false); setErr('Camera not available — use the button below to take a photo.'); });
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [shot]);
  const snap = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', 0.72); setShot(url); onPhoto(url, true);
  };
  const fromFile = (f: File) => {
    const img = new Image(); const r = new FileReader();
    r.onload = () => { img.onload = () => { const w = 480, h = Math.round((img.height / img.width) * w); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(img, 0, 0, w, h); const url = c.toDataURL('image/jpeg', 0.72); setShot(url); onPhoto(url, false); }; img.src = String(r.result); };
    r.readAsDataURL(f);
  };
  return (
    <div className="space-y-2">
      <div className="mx-auto aspect-square w-56 overflow-hidden rounded-full bg-stone-200">
        {shot ? <img src={shot} alt="Your photo" className="h-full w-full object-cover" /> : live ? <video ref={video} playsInline muted className="h-full w-full -scale-x-100 object-cover" /> : <div className="flex h-full items-center justify-center text-4xl">📷</div>}
      </div>
      {shot ? <button type="button" onClick={() => { setShot(null); onPhoto(null, true); }} className="text-sm text-stone-500 underline">Retake</button>
        : live ? <button type="button" onClick={snap} className="rounded-full bg-white px-5 py-2.5 text-sm shadow-sm">Take photo</button>
        : <label className="inline-block cursor-pointer rounded-full bg-white px-5 py-2.5 text-sm shadow-sm">Take photo<input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); }} /></label>}
      {err && <p className="text-[12px] text-stone-500">{err}</p>}
    </div>
  );
}

// ── Clock in / out at the academy ────────────────────────────────────────
export function Attend({ tenantId }: { tenantId: string }) {
  const sp = useSearchParams();
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [photo, setPhoto] = useState<{ url: string | null; live: boolean }>({ url: null, live: true });
  const token = typeof window !== 'undefined' ? getToken(tenantId) : null;
  const code = sp?.get('c') || '', w = Number(sp?.get('w') || 0);
  useEffect(() => { api({ action: 'attend-status', tenantId, token }).then(setSt); }, [tenantId, token]);
  const go = async (direction: 'in' | 'out') => {
    setBusy(true); setRes(null);
    const geo = await new Promise<any>((resolve) => { if (!navigator.geolocation) return resolve(null); navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => resolve(null), { enableHighAccuracy: true, timeout: 8000 }); });
    const r = await api({ action: 'attend', tenantId, token, code, w, direction, geo, photo: photo.url, photoLive: photo.live });
    setBusy(false); setRes(r); if (r.ok) api({ action: 'attend-status', tenantId, token }).then(setSt);
  };
  if (!st) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (st.needsSignIn || !st.ok) return (
    <Shell tenantId={tenantId}><Glass className="mx-auto max-w-sm text-center"><p className="text-xl font-semibold">Sign in to clock in</p><p className="mt-1 text-sm text-stone-600">Use the email you enrolled with. Then scan the screen again.</p><Link href={`/learn/${tenantId}/my`} className="mt-4 inline-block rounded-full bg-stone-900 px-6 py-3 text-sm text-white">Sign in</Link></Glass></Shell>
  );
  return (
    <Shell tenantId={tenantId}>
      <Glass className="mx-auto max-w-sm space-y-4 text-center">
        <p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">Attendance</p>
        <p className="text-2xl font-light">{st.student.name || st.student.email}</p>
        {res?.ok ? (
          <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900"><p className="text-3xl">✓</p><p className="font-semibold">{res.direction === 'in' ? 'Clocked in' : 'Clocked out'} at {new Date(res.at).toLocaleTimeString()}</p>{res.direction === 'out' && <p className="text-sm">{Math.floor(res.minutes / 60)}h {res.minutes % 60}m{res.pending ? ' — awaiting instructor approval' : ''}</p>}</div>
        ) : (
          <>
            <p className="text-stone-600">{st.open ? `Clocked in since ${new Date(st.open.clockInAt).toLocaleTimeString()}` : 'Not clocked in'}</p>
            {!code && <p className="text-sm text-amber-700">Scan the code on the academy screen to clock {st.open ? 'out' : 'in'}.</p>}
            {code && st.requirePhoto && <SelfieCamera onPhoto={(url, live) => setPhoto({ url, live })} />}
            {code && <button type="button" disabled={busy || (st.requirePhoto && !photo.url)} onClick={() => go(st.open ? 'out' : 'in')} className="h-14 w-full rounded-full bg-stone-900 text-base font-medium text-white disabled:opacity-50">{busy ? 'Checking…' : st.open ? 'Clock out' : 'Clock in'}</button>}
            {res && !res.ok && <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">{res.error}</p>}
            <p className="text-[11px] text-stone-500">Your time, device{st.requirePhoto ? ', photo' : ''}{st.requireGeo ? ' and location' : ''} are recorded for your school’s attendance records. Photos are private — only your instructors and school managers can see them.</p>
          </>
        )}
      </Glass>
    </Shell>
  );
}

// ── My courses (and email sign-in) ───────────────────────────────────────
export function MyCourses({ tenantId }: { tenantId: string }) {
  const sp = useSearchParams();
  const [d, setD] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => setD(await api({ action: 'me', tenantId, token: getToken(tenantId) })), [tenantId]);
  useEffect(() => {
    const login = sp?.get('login');
    if (login) { api({ action: 'exchange', tenantId, loginToken: login }).then((r) => { if (r.ok) setToken(tenantId, r.token); else setErr(r.error); window.history.replaceState(null, '', `/learn/${tenantId}/my`); void load(); }); }
    else void load();
  }, [tenantId, sp, load]);
  if (!d) return <Shell tenantId={tenantId}><Loading /></Shell>;
  // Signed in → the full student portal.
  if (d.student) return <StudentPortal tenantId={tenantId} courses={d.courses} onSignOut={() => { setToken(tenantId, null); void load(); }} />;
  const color = d.brand?.color || '#1c1917';
  return (
    <Shell brand={d.brand} tenantId={tenantId}>
      {!d.student ? (
        <div className="mx-auto max-w-md">
          <h1 className="text-center text-4xl font-light tracking-tight">Welcome <span className="font-semibold">back</span></h1>
          <Glass className="mt-6 space-y-3">
            {sent ? <p className="text-center">✉️ If that email has courses here, a sign-in link is on its way. It works for 30 minutes.</p> : (
              <>
                <p className="text-sm text-stone-600">Enter the email you enrolled with — we’ll send you a sign-in link. No password needed.</p>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Your email" className="h-11 w-full rounded-2xl border border-white/80 bg-white/75 px-4" />
                {err && <p className="text-sm text-red-700">{err}</p>}
                <button type="button" disabled={!email.includes('@')} onClick={async () => { await api({ action: 'login', tenantId, email }); setSent(true); }} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-50" style={{ background: color }}>Email me a sign-in link</button>
              </>
            )}
          </Glass>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h1 className="text-4xl font-light tracking-tight">My <span className="font-semibold">courses</span></h1>
            <div className="flex items-center gap-3"><Link href={`/learn/${tenantId}/live`} className="rounded-full px-4 py-2 text-sm text-white" style={{ background: color }}>● Join a live class</Link><button type="button" onClick={() => { setToken(tenantId, null); void load(); }} className="text-sm text-stone-500 underline">Sign out ({d.student.email})</button></div>
          </div>
          <Inbox tenantId={tenantId} color={color} />
          {(d.programs || []).map((pr: any) => (
            <Glass key={pr.id} className="mt-6 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xl font-semibold">{pr.name}</p><span className="text-[12px] uppercase tracking-widest text-stone-500">{pr.status === 'loa' ? 'leave of absence' : pr.status}</span></div>
              {pr.totalHours && <div><div className="flex justify-between text-sm"><span>Hours</span><span className="font-semibold">{pr.hours.total} of {pr.totalHours} h</span></div><div className="mt-1 h-2 rounded-full bg-white/70"><div className="h-2 rounded-full" style={{ width: `${pr.hours.pct || 0}%`, background: color }} /></div><p className="mt-1 text-[12px] text-stone-500">{pr.hours.online} h online · {pr.hours.inPerson} h in person</p></div>}
              {pr.requirements.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">{pr.requirements.map((r: any) => (
                  <div key={r.key} className="rounded-2xl bg-white/60 p-3"><div className="flex justify-between text-sm"><span>{r.label}</span><span className="font-semibold">{r.done} / {r.required}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-white"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (r.done / Math.max(1, r.required)) * 100)}%`, background: color }} /></div></div>
                ))}</div>
              )}
              <p className="text-[12px] text-stone-500">Services count once an instructor signs them off as passed. <Link href={`/learn/${tenantId}/attend`} className="underline">Clock in / out</Link></p>
            </Glass>
          ))}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {d.courses.length === 0 && <Glass><p>No courses yet. <Link href={`/learn/${tenantId}`} className="underline">Browse courses</Link></p></Glass>}
            {d.courses.map((c: any) => (
              <Glass key={c.id} className="space-y-3">
                <p className="text-xl font-semibold">{c.title}</p>
                <div><div className="h-2 rounded-full bg-white/70"><div className="h-2 rounded-full" style={{ width: `${c.pct}%`, background: color }} /></div><p className="mt-1 text-[12px] text-stone-500">{c.done} of {c.lessonCount} lessons · {c.pct}%</p></div>
                {(c.requiredOnlineHours || c.onlineHours > 0) && <p className="text-[13px] text-stone-600">Online learning: <span className="font-semibold text-stone-900">{c.onlineHours} h</span>{c.requiredOnlineHours ? ` of ${c.requiredOnlineHours} h` : ''}{c.requiredInPersonHours ? ` · in-person required: ${c.requiredInPersonHours} h` : ''}</p>}
                <div className="flex flex-wrap gap-2">
                  <Link href={c.lastLessonId ? `/learn/${tenantId}/${c.slug}/${c.lastLessonId}` : `/learn/${tenantId}/${c.slug}`} className="inline-block rounded-full px-5 py-2.5 text-sm font-medium text-white" style={{ background: color }}>{c.done ? 'Continue' : 'Start'}</Link>
                  {c.certificateCode ? <Link href={`/verify/${c.certificateCode}`} className="inline-block rounded-full bg-white/80 px-5 py-2.5 text-sm">🎓 Certificate</Link>
                    : c.pct === 100 && <button type="button" onClick={async () => { const r = await api({ action: 'certificate', tenantId, token: getToken(tenantId), courseId: c.id }); if (r.ok) window.location.href = `/verify/${r.code}`; else alert(r.error); }} className="rounded-full bg-white/80 px-5 py-2.5 text-sm">Get my certificate</button>}
                </div>
              </Glass>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

// ── Messages & announcements (in My courses) ─────────────────────────────
function Inbox({ tenantId, color }: { tenantId: string; color: string }) {
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setD(await api({ action: 'inbox', tenantId, token: getToken(tenantId) })), [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (!d?.ok) return null;
  return (
    <div className="mt-6 space-y-3">
      {d.announcements.slice(0, 3).map((a: any, i: number) => (
        <div key={i} className="rounded-[1.5rem] border border-white/70 p-4" style={{ background: `${color}14` }}><p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Announcement · {new Date(a.at).toLocaleDateString()}</p><p className="mt-1 font-semibold">{a.title}</p><p className="whitespace-pre-wrap text-[15px] text-stone-700">{a.body}</p></div>
      ))}
      <Glass className="space-y-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left"><span className="font-semibold">Messages with your school{d.messages.length ? ` · ${d.messages.length}` : ''}</span><span className="text-sm text-stone-500">{open ? 'Hide' : 'Open'}</span></button>
        {open && (
          <>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">{d.messages.length === 0 ? <p className="text-sm text-stone-500">Questions about hours, schedules or anything else — send a message.</p> : d.messages.map((m: any, i: number) => <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === 'student' ? 'ml-auto text-white' : 'bg-white/80'}`} style={m.from === 'student' ? { background: color } : undefined}><p className="whitespace-pre-wrap">{m.text}</p><p className="mt-0.5 text-[10px] opacity-70">{m.from === 'school' ? m.by + ' · ' : ''}{new Date(m.at).toLocaleString()}</p></div>)}</div>
            <div className="flex gap-2"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Write to your school" className="flex-1 rounded-2xl border border-white/80 bg-white/75 p-3 text-sm" />
              <button type="button" disabled={busy || !text.trim()} onClick={async () => { setBusy(true); const r = await api({ action: 'message', tenantId, token: getToken(tenantId), text }); setBusy(false); if (r.ok) { setText(''); void load(); } }} className="rounded-2xl px-4 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>Send</button></div>
          </>
        )}
      </Glass>
    </div>
  );
}

// ── Live class (students) ────────────────────────────────────────────────
export function LiveJoin({ tenantId }: { tenantId: string }) {
  const sp = useSearchParams();
  const [code, setCode] = useState(sp?.get('code') || '');
  const [sid, setSid] = useState<string | null>(null);
  const [team, setTeam] = useState<'room' | 'home' | null>(null);
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState('');
  const [needSignIn, setNeedSignIn] = useState(false);
  const [mood, setMood] = useState<{ pulse: string | null; fast: boolean }>({ pulse: null, fast: false });
  const [ask, setAsk] = useState<{ open: boolean; text: string; queue: any[] }>({ open: false, text: '', queue: [] });
  const [word, setWord] = useState(''); const [exit, setExit] = useState<number[]>([]);
  const [now, setNow] = useState(Date.now());
  // Read the sign-in after the page loads (the server can't see it), so the first render matches.
  const [token, setTok] = useState<string | null | undefined>(undefined);
  useEffect(() => { setTok(getToken(tenantId)); }, [tenantId]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(t); }, []);
  const join = useCallback(async (c: string) => { setErr(''); const r = await api({ action: 'live-find', tenantId, token, code: c }); if (r.ok) setSid(r.sessionId); else { setErr(r.error); if (r.needsSignIn) setNeedSignIn(true); } }, [tenantId, token]);
  useEffect(() => { if (token && code.length === 6 && sp?.get('code')) void join(code); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const beat = useCallback(async (extra?: any) => { if (!sid) return; const r = await api({ action: 'live-state', tenantId, token, sessionId: sid, visible: document.visibilityState === 'visible', team, ...(extra || {}) }); if (r.ok) setSt(r); }, [sid, tenantId, token, team]);
  useEffect(() => { if (!sid || !team) return; void beat(); const iv = window.setInterval(() => void beat(), 3000); return () => window.clearInterval(iv); }, [sid, team, beat]);
  const act = st?.activity; const mine = st?.mine;
  // Show the pulse the student already chose (e.g. after reopening the page).
  useEffect(() => { if (st && mood.pulse == null && (st.pulse || st.fast)) setMood({ pulse: st.pulse || null, fast: !!st.fast }); }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWord(''); setExit([]); }, [act?.id]);
  const answer = async (a: any) => { setErr(''); const r = await api({ action: 'live-answer', tenantId, token, sessionId: sid, questionId: act.id, answer: a }); if (!r.ok) setErr(r.error); void beat(); };
  const setPulse = (patch: any) => { const m = { ...mood, ...patch }; setMood(m); void beat({ pulse: m.pulse, fast: m.fast }); };
  const loadQueue = async () => { const r = await api({ action: 'live-queue', tenantId, token, sessionId: sid }); if (r.ok) setAsk((x) => ({ ...x, queue: r.queue })); };
  const color = st?.brand?.color || '#1c1917';
  if (token === undefined) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (needSignIn || !token) return <Shell tenantId={tenantId}><Glass className="mx-auto max-w-sm text-center"><p className="text-xl font-semibold">Sign in to join</p><p className="mt-1 text-sm text-stone-500">Your minutes are recorded to your account.</p><Link href={`/learn/${tenantId}/my`} className="mt-4 inline-block rounded-full bg-stone-900 px-6 py-3 text-sm text-white">Sign in</Link></Glass></Shell>;
  if (!sid) return (
    <Shell tenantId={tenantId}><Glass className="mx-auto max-w-sm space-y-3 text-center">
      <p className="text-2xl font-light">Join a <span className="font-semibold">live class</span></p>
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="h-14 w-full rounded-2xl border border-white/80 bg-white/80 text-center font-mono text-2xl tracking-[0.3em]" />
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button type="button" disabled={code.length !== 6} onClick={() => join(code)} className="h-12 w-full rounded-full bg-stone-900 text-sm font-medium text-white disabled:opacity-40">Join</button>
    </Glass></Shell>
  );
  if (!team) return (
    <Shell tenantId={tenantId}><Glass className="mx-auto max-w-sm space-y-3 text-center"><p className="text-2xl font-light">Where are <span className="font-semibold">you?</span></p>
      <div className="grid grid-cols-2 gap-3">{([['room', '🏫', 'In the room'], ['home', '🏠', 'At home']] as const).map(([k, i, l]) => <button key={k} type="button" onClick={() => setTeam(k)} className="rounded-3xl bg-white/85 p-5 text-center shadow-sm active:scale-95"><span className="block text-4xl">{i}</span><span className="mt-1 block text-sm font-semibold">{l}</span></button>)}</div>
      <p className="text-[12px] text-stone-500">You’ll be on that team for quiz points.</p></Glass></Shell>
  );
  if (!st) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (st.status === 'ended') return <Shell brand={st.brand} tenantId={tenantId}><Glass className="mx-auto max-w-sm text-center"><p className="text-3xl">🎉</p><p className="text-xl font-semibold">Class finished</p><p className="mt-1 text-stone-600">{st.minutes} minutes recorded to your hours.</p><Link href={`/learn/${tenantId}/my`} className="mt-4 inline-block rounded-full px-6 py-3 text-sm text-white" style={{ background: color }}>Back to my portal</Link></Glass></Shell>;
  const left = act?.endsAt ? Math.max(0, Math.ceil((new Date(act.endsAt).getTime() - now) / 1000)) : null;
  const closed = !act?.open || left === 0;
  const kind = act?.kind || 'quiz';
  return (
    <Shell brand={st.brand} tenantId={tenantId}>
      <div className="mx-auto max-w-md space-y-4 pb-28">
        <div className="flex items-center justify-between"><p className="text-lg font-semibold">{st.title}</p><span className="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white">● LIVE · {st.minutes} min</span></div>
        {!act ? <Glass className="py-10 text-center"><p className="text-4xl">👀</p><p className="mt-2 text-stone-600">Listen in — activities will pop up here.</p></Glass> : (
          <Glass className="space-y-3">
            <div className="flex items-start justify-between gap-3"><p className="text-xl font-semibold leading-snug">{act.q}</p>{left != null && !mine && <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold ${left <= 5 ? 'bg-red-500 text-white' : 'bg-white/80'}`}>{left}</span>}</div>
            {['quiz', 'poll', 'confidence'].includes(kind) && <div className="grid gap-2">{(act.options || []).map((o: string, i: number) => { const picked = mine?.choice === i; const right = act.reveal && act.correct === i; const wrong = act.reveal && picked && act.correct !== i && act.correct != null; return (
              <button key={i} type="button" disabled={closed || mine != null} onClick={() => answer({ choice: i })} className={`min-h-14 rounded-2xl px-4 py-3 text-left text-[16px] font-medium shadow-sm transition active:scale-[0.98] ${right ? 'bg-emerald-600 text-white' : wrong ? 'bg-red-500 text-white' : picked ? 'text-white' : 'bg-white/90'}`} style={picked && !right && !wrong ? { background: color } : undefined}>{right ? '✓ ' : ''}{o}</button>); })}</div>}
            {kind === 'word' && (mine ? <p className="rounded-2xl bg-white/80 p-3 text-center">You said <b>“{mine.text}”</b> — watch the screen ☁️</p> : <div className="flex gap-2"><input value={word} onChange={(e) => setWord(e.target.value.slice(0, 40))} placeholder="Your word" className="h-12 flex-1 rounded-2xl border border-white/80 bg-white/90 px-4 text-[16px]" /><button type="button" disabled={!word.trim() || closed} onClick={() => answer({ text: word })} className="rounded-2xl px-5 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>Send</button></div>)}
            {kind === 'rate' && <>{act.image && <img src={act.image} alt="" className="w-full rounded-2xl" />}<div className="flex justify-center gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={closed || mine != null} onClick={() => answer({ rating: n })} className={`h-14 w-14 rounded-2xl text-2xl ${mine?.rating >= n ? 'bg-amber-400' : 'bg-white/80'}`} aria-label={`${n} stars`}>⭐</button>)}</div>{act.reveal && act.instructorRating && <p className="rounded-2xl bg-emerald-50 p-3 text-center">Your instructor gave it <b>{act.instructorRating}/5</b>{mine?.rating ? ` — you said ${mine.rating}` : ''}.</p>}</>}
            {kind === 'tap' && act.image && <div className="relative" onClick={(e) => { if (closed || mine) return; const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); void answer({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }); }}>
              <img src={act.image} alt="" className="w-full rounded-2xl" />{mine?.x != null && <span className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-red-500" style={{ left: `${mine.x}%`, top: `${mine.y}%` }} />}
              {act.reveal && act.target && <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-emerald-500" style={{ left: `${act.target.x}%`, top: `${act.target.y}%`, width: `${act.target.r * 2}%`, aspectRatio: '1' }} />}
              {!mine && !closed && <p className="absolute inset-x-0 bottom-2 text-center text-[12px] font-semibold text-white drop-shadow">Tap the photo</p>}</div>}
            {kind === 'exit' && (mine ? <p className="rounded-2xl bg-white/80 p-3 text-center">✓ Sent{mine.score != null ? ` — ${mine.score}%` : ''}. Thanks!</p> : <div className="space-y-3">{(act.questions || []).map((q: any, qi: number) => <div key={qi}><p className="font-medium">{qi + 1}. {q.q}</p><div className="mt-1 grid gap-1.5">{q.options.map((o: string, oi: number) => <button key={oi} type="button" onClick={() => { const e = [...exit]; e[qi] = oi; setExit(e); }} className={`min-h-12 rounded-xl px-3 text-left text-[15px] ${exit[qi] === oi ? 'text-white' : 'bg-white/90'}`} style={exit[qi] === oi ? { background: color } : undefined}>{o}</button>)}</div></div>)}
              <button type="button" disabled={closed || (act.questions || []).some((_: any, i: number) => exit[i] == null)} onClick={() => answer({ choices: exit })} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>Hand in</button></div>)}
            {mine && !act.reveal && kind === 'quiz' && <p className="text-center text-sm text-stone-500">Answer locked in ✓</p>}
            {act.reveal && mine?.points != null && kind === 'quiz' && <p className={`text-center text-lg font-semibold ${mine.points ? 'text-emerald-700' : 'text-stone-500'}`}>{mine.points ? `+${mine.points} points!` : 'Not this time'}</p>}
            {err && <p className="text-center text-sm text-red-700">{err}</p>}
          </Glass>
        )}
      </div>
      {/* Always-there bar: how I'm doing · too fast · ask */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center gap-2 p-2">
          {(['green', 'yellow', 'red'] as const).map((k) => <button key={k} type="button" onClick={() => setPulse({ pulse: k })} aria-pressed={mood.pulse === k} aria-label={k === 'green' ? 'Got it' : k === 'yellow' ? 'Almost' : 'Lost'} className={`h-11 w-11 rounded-full text-xl transition ${mood.pulse === k ? 'scale-110 bg-white shadow ring-2 ring-stone-900' : 'opacity-70'}`}>{k === 'green' ? '🟢' : k === 'yellow' ? '🟡' : '🔴'}</button>)}
          <button type="button" onClick={() => setPulse({ fast: !mood.fast })} aria-pressed={mood.fast} className={`h-11 rounded-full px-3 text-[13px] font-semibold ${mood.fast ? 'bg-red-500 text-white' : 'bg-white/80'}`}>🐢 Too fast</button>
          <button type="button" onClick={() => { setAsk((x) => ({ ...x, open: true })); void loadQueue(); }} className="ml-auto h-11 rounded-full px-4 text-[13px] font-semibold text-white" style={{ background: color }}>✋ Ask</button>
        </div>
      </div>
      {ask.open && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setAsk((x) => ({ ...x, open: false }))}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[80dvh] w-full space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <p className="text-lg font-semibold">Questions for your instructor</p><p className="text-[12px] text-stone-500">Classmates don’t see who asked. Tap ▲ on questions you want answered too.</p>
            <div className="flex gap-2"><input value={ask.text} onChange={(e) => setAsk({ ...ask, text: e.target.value })} placeholder="Type your question" className="h-12 flex-1 rounded-2xl border px-3 text-[16px]" /><button type="button" disabled={!ask.text.trim()} onClick={async () => { const r = await api({ action: 'live-ask', tenantId, token, sessionId: sid, text: ask.text }); if (r.ok) setAsk({ ...ask, text: '', queue: r.queue }); }} className="rounded-2xl px-4 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>Send</button></div>
            {ask.queue.map((q: any) => <div key={q.id} className={`flex items-center gap-3 rounded-2xl bg-stone-50 p-3 ${q.answered ? 'opacity-40' : ''}`}><button type="button" onClick={async () => { const r = await api({ action: 'live-vote', tenantId, token, sessionId: sid, qid: q.id }); if (r.ok) setAsk((x) => ({ ...x, queue: r.queue })); }} className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-sm font-bold ${q.mine ? 'text-white' : 'bg-white'}`} style={q.mine ? { background: color } : undefined}>▲<span>{q.votes}</span></button><p className="text-[15px]">{q.text}{q.answered ? ' · answered' : ''}</p></div>)}
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── Welcome (after paying) ───────────────────────────────────────────────
export function Welcome({ tenantId }: { tenantId: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [err, setErr] = useState('');
  useEffect(() => {
    const sessionId = sp?.get('session_id'); if (!sessionId) { setState('error'); setErr('Missing payment details.'); return; }
    let tries = 0; let stop = false;
    const go = async () => {
      const r = await api({ action: 'confirm', tenantId, sessionId });
      if (stop) return;
      if (r.ok) { setToken(tenantId, r.token); setState('done'); window.setTimeout(() => router.push(r.slug ? `/learn/${tenantId}/${r.slug}` : `/learn/${tenantId}/my`), 1200); }
      else if (r.pending && tries++ < 12) window.setTimeout(go, 2500);
      else { setState('error'); setErr(r.error || 'We couldn’t confirm your payment yet.'); }
    };
    void go();
    return () => { stop = true; };
  }, [tenantId, sp, router]);
  return (
    <Shell tenantId={tenantId}>
      <Glass className="mx-auto max-w-md text-center">
        {state === 'working' && <><Loading /><p>Confirming your enrolment…</p></>}
        {state === 'done' && <><p className="text-4xl">🎓</p><p className="mt-2 text-2xl font-light">You’re <span className="font-semibold">in.</span></p><p className="mt-1 text-stone-600">Taking you to your course… we’ve emailed you a link too.</p></>}
        {state === 'error' && <><p className="text-lg font-semibold">Almost there</p><p className="mt-1 text-stone-600">{err} If you were charged, you’ll get an email shortly — or <Link href={`/learn/${tenantId}/my`} className="underline">sign in</Link>.</p></>}
      </Glass>
    </Shell>
  );
}

// ── Apply (licensed schools) ─────────────────────────────────────────────
const usd = (c: number) => `$${(Math.round(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function Apply({ tenantId }: { tenantId: string }) {
  const sp = useSearchParams();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ programId: sp?.get('program') || '', name: '', email: '', phone: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api({ action: 'programs', tenantId }).then((r) => { setD(r); if (r.ok && !f.programId && r.programs[0]) setF((x) => ({ ...x, programId: r.programs[0].id })); }); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Shell tenantId={tenantId}><Loading /></Shell>;
  const color = d.brand?.color || '#1c1917';
  const go = async (intent: 'apply' | 'info') => {
    setBusy(true); setErr('');
    const r = await api({ action: 'apply', tenantId, ...f, intent, source: sp?.get('utm_source') || sp?.get('source') || (document.referrer ? new URL(document.referrer).hostname : 'website') });
    setBusy(false); if (r.ok) setDone(r); else setErr(r.error || 'Something went wrong.');
  };
  return (
    <Shell brand={d.brand} tenantId={tenantId}>
      <h1 className="text-4xl font-light tracking-tight sm:text-5xl">Start your <span className="font-semibold">career</span></h1>
      <p className="mt-2 text-lg text-stone-600">Apply to {d.brand?.name}. It takes two minutes — no payment today.</p>
      {done ? (
        <Glass className="mt-8 max-w-xl text-center"><p className="text-4xl">✉️</p><p className="mt-2 text-xl font-semibold">{done.applied ? 'Application started!' : 'Thanks — we’ll be in touch.'}</p><p className="mt-1 text-stone-600">{done.applied ? 'We’ve emailed you a private link to your application — upload your documents, read your enrolment agreement and finish when you’re ready.' : 'Someone from the school will reply soon.'}</p>{done.link && <a href={done.link} className="mt-4 inline-block rounded-full px-6 py-3 text-sm font-medium text-white" style={{ background: color }}>Open my application</a>}</Glass>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {d.programs.map((p: any) => (
              <button key={p.id} type="button" onClick={() => setF({ ...f, programId: p.id })} className={`glass block w-full rounded-[1.5rem] border p-5 text-left ${f.programId === p.id ? 'border-stone-900' : 'border-white/70'}`}>
                <p className="text-xl font-semibold">{p.name}</p>
                <p className="mt-1 text-sm text-stone-600">{p.totalHours ? `${p.totalHours} hours` : ''}{p.tuitionCents ? ` · ${usd(p.tuitionCents)} total${p.installments ? ` · payment plan available` : ''}` : ''}</p>
                {p.description && <p className="mt-2 whitespace-pre-wrap text-[15px] text-stone-700">{p.description}</p>}
              </button>
            ))}
            {d.programs.length === 0 && <Glass><p>Programs will be listed here soon.</p></Glass>}
          </div>
          <Glass className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            {(['name', 'email', 'phone'] as const).map((k) => <input key={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} type={k === 'email' ? 'email' : 'text'} placeholder={k === 'name' ? 'Full legal name' : k === 'email' ? 'Email' : 'Phone (optional)'} className="h-11 w-full rounded-2xl border border-white/80 bg-white/75 px-4" />)}
            <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={3} placeholder="Anything we should know? (optional)" className="w-full rounded-2xl border border-white/80 bg-white/75 p-4" />
            {err && <p className="text-sm text-red-700">{err}</p>}
            <button type="button" disabled={busy || !f.programId || !f.name || !f.email.includes('@')} onClick={() => go('apply')} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-50" style={{ background: color }}>{busy ? 'One moment…' : 'Apply now'}</button>
            <button type="button" disabled={busy || !f.programId || !f.name || !f.email.includes('@')} onClick={() => go('info')} className="h-11 w-full rounded-full bg-white/70 text-sm disabled:opacity-50">Just ask a question</button>
          </Glass>
        </div>
      )}
    </Shell>
  );
}

// ── Application (private link) ───────────────────────────────────────────
export function Application({ tenantId, appToken }: { tenantId: string; appToken: string }) {
  const sp = useSearchParams();
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [sign, setSign] = useState({ typedName: '', agree: false });
  const load = useCallback(async () => setD(await api({ action: 'application', tenantId, appToken })), [tenantId, appToken]);
  useEffect(() => {
    const sid = sp?.get('session_id');
    if (sid) { setBusy('confirm'); (async () => { for (let i = 0; i < 10; i++) { const r = await api({ action: 'app-confirm', tenantId, appToken, sessionId: sid }); if (r.ok) break; await new Promise((res) => setTimeout(res, 2500)); } window.history.replaceState(null, '', `/learn/${tenantId}/application/${appToken}`); setBusy(''); void load(); })(); }
    else void load();
  }, [tenantId, appToken, sp, load]);
  if (!d) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (!d.ok) return <Shell tenantId={tenantId}><Glass className="mx-auto max-w-md text-center"><p>{d.error}</p></Glass></Shell>;
  const color = d.brand.color;
  const docsIn = d.docs.every((x: any) => x.status !== 'missing' && x.status !== 'rejected');
  const upload = async (key: string, file: File) => {
    setBusy(key); setErr('');
    let data: string;
    if (file.type === 'application/pdf') data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
    else data = await new Promise((res) => { const r = new FileReader(); const img = new Image(); r.onload = () => { img.onload = () => { const w = Math.min(1600, img.width), h = Math.round((img.height / img.width) * w); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.drawImage(img, 0, 0, w, h); res(c.toDataURL('image/jpeg', 0.8)); }; img.src = String(r.result); }; r.readAsDataURL(file); });
    const r = await api({ action: 'app-upload', tenantId, appToken, docKey: key, file: data });
    setBusy(''); if (!r.ok) setErr(r.error); void load();
  };
  const Step = ({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) => (
    <Glass className="space-y-3"><div className="flex items-center gap-3"><span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${done ? 'text-white' : 'bg-white/80'}`} style={done ? { background: color } : undefined}>{done ? '✓' : n}</span><p className="text-lg font-semibold">{title}</p></div>{children}</Glass>
  );
  return (
    <Shell brand={d.brand} tenantId={tenantId}>
      <h1 className="text-4xl font-light tracking-tight">Your application, <span className="font-semibold">{d.applicant.name.split(' ')[0]}</span></h1>
      <p className="mt-2 text-stone-600">{d.program.name}{d.program.totalHours ? ` · ${d.program.totalHours} hours` : ''}{d.applicant.startDate ? ` · starts ${new Date(d.applicant.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}{d.applicant.waitlisted ? ' · on the waitlist' : ''}</p>
      {busy === 'confirm' && <Glass className="mt-6"><p>Confirming your payment…</p></Glass>}
      {err && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      <div className="mt-6 space-y-4">
        <Step n={1} title="Upload your documents" done={docsIn}>
          {d.docs.map((x: any) => (
            <div key={x.key} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/60 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">{x.key} · <span className={x.status === 'verified' ? 'text-emerald-700' : x.status === 'rejected' ? 'text-red-700' : 'text-stone-500'}>{x.status === 'missing' ? 'needed' : x.status === 'submitted' ? 'received — being checked' : x.status}</span>{x.reason ? <span className="block text-[12px] text-red-700">{x.reason}</span> : null}</span>
              {x.status !== 'verified' && <label className="cursor-pointer rounded-full bg-white px-4 py-2 text-[13px] shadow-sm">{busy === x.key ? 'Uploading…' : x.status === 'missing' ? 'Upload' : 'Replace'}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(x.key, file); }} /></label>}
            </div>
          ))}
          <p className="text-[12px] text-stone-500">A clear photo or a PDF. Your documents are private to the school’s admissions team.</p>
        </Step>
        <Step n={2} title="Read and sign your enrolment agreement" done={d.agreement.signed}>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white/70 p-4 text-[13px] leading-relaxed">{d.agreement.text}</pre>
          {d.agreement.signed ? <p className="text-sm text-emerald-700">✓ Signed by {d.agreement.signedName} on {new Date(d.agreement.signedAt).toLocaleString()}</p> : (
            <>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sign.agree} onChange={(e) => setSign({ ...sign, agree: e.target.checked })} />I have read and understood this agreement, and I agree to it.</label>
              <input value={sign.typedName} onChange={(e) => setSign({ ...sign, typedName: e.target.value })} placeholder={`Type your full name: ${d.applicant.name}`} className="h-11 w-full rounded-2xl border border-white/80 bg-white/75 px-4 font-serif text-lg italic" />
              <button type="button" disabled={!docsIn || !sign.agree || !sign.typedName || !!busy} onClick={async () => { setBusy('sign'); setErr(''); const r = await api({ action: 'app-sign', tenantId, appToken, ...sign }); setBusy(''); if (!r.ok) setErr(r.error); void load(); }} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>{busy === 'sign' ? 'Signing…' : 'Sign agreement'}</button>
              {!docsIn && <p className="text-[12px] text-stone-500">Upload your documents first.</p>}
              <p className="text-[11px] text-stone-500">Your typed name is your electronic signature. We record the exact text, the time, and your device.</p>
            </>
          )}
        </Step>
        <Step n={3} title={d.payment?.installmentsTotal ? 'Make your down payment' : 'Pay your tuition'} done={!!d.payment?.paid}>
          {!d.payment ? <p className="text-sm text-stone-600">Available once you’ve signed.</p> : d.payment.paid ? (
            <p className="text-sm">✓ Paid. {d.payment.installmentsTotal ? `Your remaining ${d.payment.installmentsTotal} payments of about ${usd(d.payment.installmentCents)} are on autopay${d.payment.nextDueAt ? ` — next on ${new Date(d.payment.nextDueAt).toLocaleDateString()}` : ''}.` : ''} Balance: {usd(d.payment.balanceCents || 0)}.</p>
          ) : (
            <>
              <p className="text-sm">{usd(d.payment.downPaymentCents)} today{d.payment.installmentsTotal ? `, then ${d.payment.installmentsTotal} automatic payments of about ${usd(d.payment.installmentCents)} on the same card` : ''}.</p>
              <button type="button" disabled={!!busy} onClick={async () => { setBusy('pay'); const r = await api({ action: 'app-pay', tenantId, appToken }); if (r.ok && r.url) window.location.href = r.url; else { setBusy(''); setErr(r.error || 'Couldn’t start payment.'); } }} className="h-12 w-full rounded-full text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>{busy === 'pay' ? 'One moment…' : `Pay ${usd(d.payment.downPaymentCents)}`}</button>
            </>
          )}
        </Step>
        <Step n={4} title="You’re enrolled" done={d.applicant.stage === 'enrolled'}>
          {d.applicant.stage === 'enrolled' ? <p className="text-sm">Welcome! Sign in to <Link href={`/learn/${tenantId}/my`} className="underline">My courses</Link> with {d.applicant.email} to start your theory lessons and track your hours.</p> : <p className="text-sm text-stone-600">Happens automatically when your payment goes through.</p>}
        </Step>
      </div>
    </Shell>
  );
}


// ── The journey: modules along a path ─────────────────────────────────────
function Journey({ d, tenantId, slug, color }: any) {
  const mods: any[] = d.modules;
  const current = mods.findIndex((m) => m.open && !m.complete);
  const [openKey, setOpenKey] = useState<string | null>(mods[current]?.key || null);
  const lessonsById = new Map((d.lessons || []).map((l: any) => [l.id, l]));
  return (
    <Glass className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">Your journey</p>
      <div className="cf-stagger relative mt-3">
        {mods.map((m, i) => {
          const here = i === current; const expanded = openKey === m.key && m.open;
          const icon = m.complete ? '✓' : !m.open ? '🔒' : here ? '★' : '○';
          return (
            <div key={m.key} className="relative pb-5 pl-[4.5rem]">
              {i < mods.length - 1 && <span className="absolute left-[1.95rem] top-16 h-[calc(100%-3.5rem)] w-0 border-l-[3px] border-dotted border-stone-300" aria-hidden />}
              <button type="button" disabled={!m.open} onClick={() => setOpenKey(expanded ? null : m.key)} aria-expanded={expanded} className="absolute left-0 top-0 flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold disabled:cursor-default"
                style={m.complete ? { background: '#d1fae5', color: '#047857' } : here ? { background: `${color}1f`, color, border: `3px solid ${color}` } : m.open ? { background: 'white', color } : { background: 'rgba(255,255,255,.6)', color: '#a8a29e' }}>
                {here && <span className="cf-pulse absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 3px ${color}40` }} aria-hidden />}{icon}</button>
              <button type="button" disabled={!m.open} onClick={() => setOpenKey(expanded ? null : m.key)} className="block min-h-16 w-full text-left disabled:cursor-default">
                <span className="flex items-center gap-2"><span className="text-lg font-semibold leading-tight">{m.title}</span>{here && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: color }}>You’re here</span>}{m.complete && d.game && m.badge && <span title={m.badge.name}>{m.badge.emoji}</span>}</span>
                <span className="block text-[13px] text-stone-500">{m.open ? `${m.done} of ${m.total} lessons${m.minutes ? ` · about ${m.minutes} min` : ''}` : m.reason}</span>
                {m.open && m.total > 0 && <span className="mt-1.5 block h-1.5 max-w-xs rounded-full bg-white/80"><span className="block h-1.5 rounded-full transition-all duration-700" style={{ width: `${(m.done / m.total) * 100}%`, background: m.complete ? '#10b981' : color }} /></span>}
              </button>
              {expanded && (
                <div className="cf-rise mt-3 space-y-2">
                  {m.done === 0 && (m.intro || m.lessonTitles.length > 1) && (
                    <div className="rounded-2xl bg-white/85 p-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Welcome to this module</p>
                      {m.intro && <p className="mt-1 text-[15px]">{m.intro}</p>}
                      <p className="mt-2 text-[13px] text-stone-600">You’ll cover: {m.lessonTitles.join(' · ')}</p>
                      {d.game && m.badge && <p className="mt-1 text-[13px]">Finish it to earn <b>{m.badge.emoji} {m.badge.name}</b></p>}
                    </div>
                  )}
                  {m.lessonIds.map((id: string) => { const l: any = lessonsById.get(id); if (!l) return null; const fin = !!d.progress?.[id]; return (
                    <Link key={id} href={`/learn/${tenantId}/${slug}/${id}`} className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5 text-[15px] transition active:scale-[0.99]">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px]" style={fin ? { background: '#d1fae5', color: '#047857' } : { background: `${color}1a`, color }}>{fin ? '✓' : l.kind === 'video' ? '▶' : l.kind === 'assignment' ? '✎' : '≡'}</span>
                      <span className="min-w-0 flex-1 truncate">{l.title}</span><span className="text-stone-400">›</span>
                    </Link>
                  ); })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Glass>
  );
}

/** The moment a new module opens — shown once, when the student comes back. */
function UnlockMoment({ items, color, onClose }: { items: any[]; color: string; onClose: () => void }) {
  const m = items[0];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-label="New module unlocked">
      <div className="cf-land w-full max-w-sm space-y-4 rounded-[2rem] bg-white p-6 text-center shadow-2xl">
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <span className="cf-ripple absolute inset-0 rounded-full" style={{ border: `3px solid ${color}` }} aria-hidden />
          <span className="cf-pop flex h-20 w-20 items-center justify-center rounded-full text-4xl text-white" style={{ background: color }}>🔓</span>
        </div>
        <div><p className="text-[11px] uppercase tracking-[0.25em] text-stone-500">New module unlocked</p><p className="mt-1 text-2xl font-semibold">{m.title}</p>{m.intro && <p className="mt-2 text-[15px] text-stone-600">{m.intro}</p>}
          {items.length > 1 && <p className="mt-1 text-[13px] text-stone-500">and {items.length - 1} more</p>}</div>
        <button type="button" onClick={onClose} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>Let’s go</button>
      </div>
    </div>
  );
}

/** Finished a module (or the whole course): recap, badge, what's next. */
function ModuleRecap({ r, color, onDone }: { r: any; color: string; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-label="Module complete">
      <div className="cf-land w-full max-w-sm space-y-4 rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="text-center"><span className="cf-pop inline-flex h-20 w-20 items-center justify-center rounded-full text-4xl" style={{ background: '#d1fae5' }}>{r.courseDone ? '🎓' : r.badge?.emoji || '✓'}</span>
          <p className="mt-3 text-[11px] uppercase tracking-[0.25em] text-stone-500">{r.courseDone ? 'Course complete' : 'Module complete'}</p>
          <p className="text-2xl font-semibold">{r.courseDone ? 'You did it!' : r.title}</p></div>
        {!r.courseDone && r.lessonTitles?.length > 0 && <div className="rounded-2xl bg-stone-50 p-3"><p className="text-[12px] font-semibold text-stone-500">What you covered</p><ul className="cf-stagger mt-1 space-y-1">{r.lessonTitles.map((t: string) => <li key={t} className="text-[14px]">✓ {t}</li>)}</ul></div>}
        {r.game && <div className="flex justify-center gap-2">{r.badge && <span className="cf-pop rounded-full px-3 py-1 text-sm font-semibold" style={{ background: `${color}1a`, color }}>{r.badge.emoji} {r.badge.name}</span>}<span className="cf-pop rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">⭐ {r.game.points} points</span>{r.game.streak > 1 && <span className="cf-pop rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">🔥 {r.game.streak}-day streak</span>}</div>}
        {r.nextModule && <p className="text-center text-[14px] text-stone-600">Up next: <b>{r.nextModule.title}</b></p>}
        <button type="button" onClick={onDone} className="h-12 w-full rounded-full text-sm font-medium text-white" style={{ background: color }}>{r.nextModule ? 'See what’s unlocked' : 'Back to my course'}</button>
      </div>
    </div>
  );
}

/** Points · streak · badges (only when the academy switches them on). */
export function GameChips({ g, color }: { g: any; color: string }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">⭐ {g.points} points</span>{g.streak > 0 && <span className="rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">🔥 {g.streak}-day streak</span>}</div>
      {g.badges?.length > 0 && <div className="flex flex-wrap gap-1.5">{g.badges.map((b: any) => <span key={b.id} title={b.name} className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: `${color}14`, color }}>{b.emoji} {b.name}</span>)}</div>}
    </div>
  );
}
