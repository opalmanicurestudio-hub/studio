'use client';
// src/components/academy/LessonCanvas.tsx
//
// THE LESSON CANVAS — pieces for the redesigned lesson builder:
//   LESSON_KINDS     friendly lesson types (🎬 Video · 📖 Reading · 📎 Download · ✍️ Assignment)
//   LESSON_TEMPLATES starting points: Theory lesson, Hands-on skill, Review game, Exam prep
//   TemplatePicker   "Add a lesson" → choose a starting point
//   AddToLesson      the ＋ picker: content cards (text, photo steps, interactive,
//                    hotspots, stages, callout, image, file) and lesson extras
//                    (quiz, flashcards, activity, client cases, video questions),
//                    plus ✨ drafts from the lesson's own text
//   LessonPreview    the lesson as a student sees it, in a phone frame, live

import { useState } from 'react';
import { InteractiveFrame } from '@/components/academy/InteractiveFrame';

const uid = () => Math.random().toString(36).slice(2, 10);

export const LESSON_KINDS: [string, string, string][] = [['video', '🎬', 'Video'], ['text', '📖', 'Reading'], ['download', '📎', 'Download'], ['assignment', '✍️', 'Assignment']];

const ASSIGNMENT = { prompt: '', type: 'any', rubric: [{ criterion: 'Accuracy', points: 40 }, { criterion: 'Infection control & safety', points: 30 }, { criterion: 'Presentation', points: 30 }], dueDays: 7, resubmit: true };
export const LESSON_TEMPLATES: { key: string; icon: string; name: string; hint: string; make: () => any }[] = [
  { key: 'blank', icon: '✦', name: 'Start blank', hint: 'An empty lesson', make: () => ({ kind: 'text' }) },
  { key: 'theory', icon: '📖', name: 'Theory lesson', hint: 'Notes, a key point, and a quick check', make: () => ({ kind: 'text', blocks: [{ id: uid(), type: 'callout', tone: 'key', text: '' }], quiz: { passPct: 80, questions: [{ q: '', options: ['', '', ''], answer: 0 }] } }) },
  { key: 'skill', icon: '🖐', name: 'Hands-on skill', hint: 'Photo steps, safety, then hand in photos', make: () => ({ kind: 'assignment', assignment: { ...ASSIGNMENT, type: 'photo' }, blocks: [{ id: uid(), type: 'callout', tone: 'safety', text: '' }, { id: uid(), type: 'steps', title: '', steps: [{ text: '', mediaId: null }, { text: '', mediaId: null }, { text: '', mediaId: null }] }] }) },
  { key: 'game', icon: '🎮', name: 'Review game', hint: 'An interactive, flashcards and a matching game', make: () => ({ kind: 'text', blocks: [{ id: uid(), type: 'interactive', title: '', request: '', html: '' }], flashcards: [{ front: '', back: '' }], activity: { type: 'match', prompt: 'Match each term to its meaning', pairs: [{ left: '', right: '' }, { left: '', right: '' }] } }) },
  { key: 'exam', icon: '📝', name: 'Exam prep', hint: 'A longer quiz and client cases', make: () => ({ kind: 'text', quiz: { passPct: 70, questions: [{ q: '', options: ['', '', '', ''], answer: 0 }] }, cases: { prompt: 'What would you do?', cases: [{ story: '', mediaId: null, options: [{ text: 'Proceed with the service as planned', correct: false, feedback: '' }, { text: 'Adapt the service', correct: false, feedback: '' }, { text: 'Refer the client to a doctor', correct: true, feedback: '' }] }] } }) },
];

export function TemplatePicker({ onPick, onClose }: { onPick: (t: any) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl space-y-3 rounded-t-3xl bg-background p-5 sm:rounded-3xl">
        <p className="text-xl font-black">New lesson</p><p className="-mt-2 text-sm text-muted-foreground">Pick a starting point — you can change everything.</p>
        <div className="grid grid-cols-2 gap-2">{LESSON_TEMPLATES.map((t) => (
          <button key={t.key} type="button" onClick={() => onPick(t.make())} className="flex min-h-28 flex-col justify-between rounded-2xl border-2 border-border/60 bg-muted/30 p-3 text-left active:scale-[0.98]">
            <span className="text-2xl">{t.icon}</span><span><span className="block font-black">{t.name}</span><span className="block text-[12px] text-muted-foreground">{t.hint}</span></span>
          </button>
        ))}</div>
      </div>
    </div>
  );
}

const CONTENT: [string, string, string, string][] = [
  ['text', '¶', 'Text', 'A paragraph or two'], ['steps', '🔢', 'Photo steps', 'Numbered steps, a photo each'], ['interactive', '✨', 'Interactive', 'AI builds an animated demo'],
  ['hotspots', '📍', 'Hotspots', 'Tap parts of your image'], ['stages', '🎚', 'Stages', 'Slide through a process'], ['callout', '🛑', 'Safety / key point', 'A highlighted note'],
  ['image', '🖼', 'Image', 'A photo or diagram'], ['file', '📄', 'File', 'A PDF or audio'],
];
const newBlock = (type: string) => type === 'interactive' ? { id: uid(), type, title: '', request: '', html: '' } : type === 'hotspots' ? { id: uid(), type, title: '', mediaId: null, points: [] } : type === 'stages' ? { id: uid(), type, title: '', stages: [{ label: '', text: '', mediaId: null }, { label: '', text: '', mediaId: null }] } : type === 'steps' ? { id: uid(), type, title: '', steps: [{ text: '', mediaId: null }] } : type === 'callout' ? { id: uid(), type, tone: 'safety', text: '' } : { id: uid(), type, text: '' };

/** The ＋ picker: add a content card, or switch on a lesson extra. */
export function AddToLesson({ lesson, setLesson, draft, drafting, onClose }: { lesson: any; setLesson: (l: any) => void; draft: (k: any) => void; drafting: string; onClose: () => void }) {
  const [tab, setTab] = useState<'content' | 'check' | 'ai'>('content');
  const canDraft = String(lesson.body || '').length >= 120 || !!lesson.transcript;
  const extras: [string, string, string, string, boolean, () => any][] = [
    ['quiz', '✅', 'Quiz', 'Questions to check understanding', !!lesson.quiz, () => ({ quiz: { passPct: 80, questions: [{ q: '', options: ['', '', ''], answer: 0 }] } })],
    ['flashcards', '🃏', 'Flashcards', 'Terms and answers to flip', (lesson.flashcards || []).length > 0, () => ({ flashcards: [{ front: '', back: '' }] })],
    ['activity', '🧩', 'Activity', 'Matching, order, scenario or label', !!lesson.activity, () => ({ activity: { type: 'match', prompt: 'Match each item to its pair', pairs: [{ left: '', right: '' }, { left: '', right: '' }] } })],
    ['cases', '🩺', 'Client cases', 'Refer-or-treat practice', !!lesson.cases, () => ({ cases: { prompt: 'What would you do?', cases: [{ story: '', mediaId: null, options: [{ text: 'Proceed with the service as planned', correct: false, feedback: '' }, { text: 'Adapt the service', correct: false, feedback: '' }, { text: 'Refer the client to a doctor', correct: true, feedback: '' }] }] } })],
    ...(lesson.kind === 'video' ? [['vq', '⏸', 'Video questions', 'Pop up while they watch', (lesson.videoQuestions || []).length > 0, () => ({ videoQuestions: [{ at: 60, q: '', options: ['', ''], answer: 0, explain: '' }] })] as any] : []),
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[88dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl">
        <div className="flex items-center justify-between"><p className="text-xl font-black">Add to this lesson</p><button type="button" onClick={onClose} className="text-sm font-bold text-muted-foreground">Done</button></div>
        <div className="flex gap-1">{([['content', 'Content'], ['check', 'Practice and checks'], ['ai', '✨ Draft with AI']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
        {tab === 'content' && <div className="grid grid-cols-2 gap-2">{CONTENT.map(([k, i, n, h]) => (
          <button key={k} type="button" onClick={() => { setLesson({ ...lesson, blocks: [...(lesson.blocks || []), newBlock(k)] }); onClose(); }} className="flex items-start gap-3 rounded-2xl border-2 border-border/60 p-3 text-left active:scale-[0.98]"><span className="text-2xl">{i}</span><span><span className="block font-black">{n}</span><span className="block text-[12px] text-muted-foreground">{h}</span></span></button>
        ))}</div>}
        {tab === 'check' && <div className="grid grid-cols-2 gap-2">{extras.map(([k, i, n, h, on, make]) => (
          <button key={k} type="button" disabled={on} onClick={() => { setLesson({ ...lesson, ...make() }); onClose(); }} className="flex items-start gap-3 rounded-2xl border-2 border-border/60 p-3 text-left disabled:opacity-50 active:scale-[0.98]"><span className="text-2xl">{i}</span><span><span className="block font-black">{n}{on ? ' ✓' : ''}</span><span className="block text-[12px] text-muted-foreground">{on ? 'Already in this lesson' : h}</span></span></button>
        ))}</div>}
        {tab === 'ai' && <div className="space-y-2">
          {!canDraft && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Write a few paragraphs of lesson text first — drafts use only what you’ve written.</p>}
          <div className="grid grid-cols-2 gap-2">{([['quiz', '✅', 'Quiz'], ['flashcards', '🃏', 'Flashcards'], ['match', '🧩', 'Matching game'], ['order', '🔀', 'Put in order'], ['scenario', '🩺', 'Client scenario']] as const).map(([k, i, n]) => (
            <button key={k} type="button" disabled={!canDraft || !!drafting} onClick={() => { draft(k); onClose(); }} className="flex items-center gap-3 rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-3 text-left font-black disabled:opacity-40"><span className="text-2xl">{i}</span>{drafting === k ? 'Drafting…' : n}</button>
          ))}</div>
          <p className="text-[12px] text-muted-foreground">Drafts appear in the lesson for you to check and edit before saving.</p>
        </div>}
      </div>
    </div>
  );
}

/** The lesson as a student sees it — live, in a phone frame. */
export function LessonPreview({ lesson, color, stepMode }: { lesson: any; color?: string | null; stepMode?: boolean }) {
  const c = color || '#7c3aed';
  const pieces: { key: string; node: React.ReactNode }[] = [];
  if (lesson.kind === 'video') pieces.push({ key: 'video', node: <div className="flex aspect-video items-center justify-center rounded-2xl bg-stone-800 text-3xl text-white/80">▶</div> });
  if (String(lesson.body || '').trim()) pieces.push({ key: 'body', node: <div className="whitespace-pre-wrap rounded-2xl bg-white/80 p-3 text-[13px] leading-relaxed">{String(lesson.body).slice(0, 700)}{String(lesson.body).length > 700 ? '…' : ''}</div> });
  for (const b of lesson.blocks || []) {
    if (b.type === 'text' && b.text) pieces.push({ key: b.id, node: <div className="whitespace-pre-wrap rounded-2xl bg-white/80 p-3 text-[13px]">{b.text}</div> });
    else if (b.type === 'callout') pieces.push({ key: b.id, node: <div className={`rounded-2xl border-2 p-3 text-[13px] ${b.tone === 'safety' ? 'border-red-200 bg-red-50' : b.tone === 'tip' ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50'}`}><b className="text-[10px] uppercase tracking-widest">{b.tone === 'safety' ? '🛑 Safety' : b.tone === 'tip' ? '💡 Tip' : '⭐ Key point'}</b><p>{b.text || '…'}</p></div> });
    else if (b.type === 'steps') pieces.push({ key: b.id, node: <div className="space-y-1.5 rounded-2xl bg-white/80 p-3 text-[13px]">{b.title && <b>{b.title}</b>}{(b.steps || []).map((s: any, i: number) => <p key={i} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[10px] text-white">{i + 1}</span>{s.text || '…'}{s.mediaId ? ' 📷' : ''}</p>)}</div> });
    else if (b.type === 'interactive' && b.html) pieces.push({ key: b.id, node: <InteractiveFrame html={b.html} title={b.title} accent={c} minHeight={200} /> });
    else if (b.type === 'interactive') pieces.push({ key: b.id, node: <div className="rounded-2xl border-2 border-dashed border-violet-300 p-4 text-center text-[12px] text-violet-800">✨ Interactive — build it to preview</div> });
    else if (['image', 'hotspots', 'stages', 'file'].includes(b.type)) pieces.push({ key: b.id, node: <div className="rounded-2xl bg-white/80 p-3 text-center text-[12px] text-stone-500">{b.type === 'image' ? '🖼 Image' : b.type === 'hotspots' ? `📍 ${b.title || 'Hotspots'} · ${(b.points || []).length} points` : b.type === 'stages' ? `🎚 ${b.title || 'Stages'} · ${(b.stages || []).length} stages` : `📄 ${b.label || 'File'}`}</div> });
  }
  if (lesson.activity) pieces.push({ key: 'act', node: <div className="rounded-2xl bg-white/80 p-3 text-[13px]">🧩 <b>{lesson.activity.prompt || 'Activity'}</b></div> });
  if ((lesson.flashcards || []).length) pieces.push({ key: 'fc', node: <div className="rounded-2xl bg-white/80 p-3 text-[13px]">🃏 <b>{lesson.flashcards.length} flashcards</b></div> });
  if (lesson.cases?.cases?.length) pieces.push({ key: 'cases', node: <div className="rounded-2xl bg-white/80 p-3 text-[13px]">🩺 <b>{lesson.cases.cases.length} client cases</b></div> });
  if (lesson.quiz?.questions?.length) pieces.push({ key: 'quiz', node: <div className="rounded-2xl bg-white/80 p-3 text-[13px]">✅ <b>Quiz · {lesson.quiz.questions.length} questions</b><p className="text-stone-500">{lesson.quiz.questions[0]?.q || '…'}</p></div> });
  if (lesson.kind === 'assignment') pieces.push({ key: 'asg', node: <div className="rounded-2xl bg-white/80 p-3 text-[13px]">✍️ <b>Your submission</b><p className="text-stone-500">{String(lesson.assignment?.prompt || '…').slice(0, 140)}</p></div> });
  const [step, setStep] = useState(0);
  const shown = stepMode ? pieces.slice(Math.min(step, Math.max(0, pieces.length - 1)), Math.min(step, Math.max(0, pieces.length - 1)) + 1) : pieces;
  return (
    <div className="mx-auto w-[300px] rounded-[2.4rem] border-[10px] border-stone-900 bg-stone-900 shadow-2xl">
      <div className="h-[560px] overflow-y-auto rounded-[1.7rem] bg-gradient-to-b from-rose-50 to-violet-50 p-3">
        <p className="text-[9px] uppercase tracking-[0.25em] text-stone-400">{lesson.moduleTitle || 'Module'}</p>
        <p className="mb-2 text-lg font-light leading-tight">{lesson.title || 'Lesson title'}</p>
        {stepMode && pieces.length > 1 && <div className="mb-2 flex gap-1">{pieces.map((p, i) => <span key={p.key} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? c : '#e7e5e4' }} />)}</div>}
        <div className="space-y-2">{pieces.length === 0 ? <p className="rounded-2xl border-2 border-dashed p-6 text-center text-[12px] text-stone-400">Add something with ＋</p> : shown.map((p) => <div key={p.key}>{p.node}</div>)}</div>
        {stepMode && pieces.length > 1 && <div className="mt-3 flex gap-2"><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="h-9 flex-1 rounded-full bg-white text-[12px] disabled:opacity-40">Back</button><button type="button" onClick={() => setStep(Math.min(pieces.length - 1, step + 1))} className="h-9 flex-1 rounded-full text-[12px] text-white" style={{ background: c }}>{step >= pieces.length - 1 ? 'Mark complete' : 'Next'}</button></div>}
      </div>
    </div>
  );
}
