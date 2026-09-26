'use client';
// src/components/academy/CourseMaterials.tsx
//
// TESTS & WORKSHEETS.
//   Question bank  by topic; ✨ generate from a lesson (review, tick, save);
//                  import the course's lesson quizzes; add your own
//   Build a test   lessons · how many questions · versions A/B/C · time →
//                  Print (each version, then its answer key)
//   Worksheets     matching · word search · crossword · fill in the blanks ·
//                  short answer · label the diagram → Print sheet / Print key
// Everything prints in the ClarityFlow document look.

import { deviceId } from '@/lib/device';
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader, Trash2 } from 'lucide-react';
import { printDocument } from '@/lib/doc-theme';
import { testVersions, testHtml, keyHtml, wordSearch, wordSearchHtml, crossword, crosswordHtml, matchingHtml, clozeHtml, shortAnswerHtml, labelHtml, rng, shuffle, GRADE_SCALE } from '@/lib/printables';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const field = 'h-10 rounded-xl border-2 border-border/60 bg-background px-3 text-sm';
const WS: [string, string, string][] = [['matching', 'Matching', 'Terms and definitions'], ['wordsearch', 'Word search', 'Key terms hidden in a grid'], ['crossword', 'Crossword', 'Terms with clues'], ['cloze', 'Fill in the blanks', 'Sentences with a word bank'], ['short', 'Short answer', 'Questions with writing lines'], ['label', 'Label the diagram', 'From a lesson’s labelling activity']];

export function CourseMaterials({ tenantId, courses, brand }: { tenantId: string; courses: any[]; brand: any }) {
  const [courseId, setCourseId] = useState<string>(courses[0]?.id || '');
  const [tab, setTab] = useState<'bank' | 'test' | 'sheets'>('bank');
  const [lessons, setLessons] = useState<any[]>([]);
  const [bank, setBank] = useState<any[] | null>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');
  const course = courses.find((c) => c.id === courseId);
  const load = useCallback(async () => {
    if (!courseId) return; setBank(null);
    const [c, q] = await Promise.all([api({ action: 'course-get', tenantId, courseId }), api({ action: 'qbank-list', tenantId, courseId })]);
    if (c.ok) setLessons(c.lessons); if (q.ok) setBank(q.questions);
  }, [tenantId, courseId]);
  useEffect(() => { void load(); }, [load]);
  if (!courses.length) return <p className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">Create a course first — tests and worksheets are made from its lessons.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={courseId} onChange={(e) => setCourseId(e.target.value)}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">{([['bank', 'Question bank'], ['test', 'Build a test'], ['sheets', 'Worksheets']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold ${tab === k ? 'bg-foreground text-background' : 'bg-muted/50'}`}>{l}</button>)}</div>
      </div>
      {msg && <p className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" onClick={() => setMsg('')}>{msg}</p>}
      {!bank ? <Loader className="h-5 w-5 animate-spin" /> : (
        <>
          {tab === 'bank' && <Bank tenantId={tenantId} courseId={courseId} lessons={lessons} bank={bank} reload={load} setMsg={setMsg} busy={busy} setBusy={setBusy} />}
          {tab === 'test' && <TestBuilder bank={bank} lessons={lessons} course={course} brand={brand} />}
          {tab === 'sheets' && <Worksheets tenantId={tenantId} courseId={courseId} lessons={lessons} course={course} brand={brand} setMsg={setMsg} />}
        </>
      )}
    </div>
  );
}

function Bank({ tenantId, courseId, lessons, bank, reload, setMsg, busy, setBusy }: any) {
  const [gen, setGen] = useState({ lessonId: '', count: 10, difficulty: 'medium' });
  const [drafts, setDrafts] = useState<any[] | null>(null);
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const [add, setAdd] = useState<any>(null);
  const topics = [...new Set(bank.map((q: any) => q.topic || 'General'))] as string[];
  const generate = async () => { setBusy('gen'); const r = await api({ action: 'qbank-ai', tenantId, courseId, ...gen, lessonId: gen.lessonId || undefined }); setBusy(''); if (!r.ok) { setMsg(r.error); return; } setDrafts(r.questions); setKeep(Object.fromEntries(r.questions.map((_: any, i: number) => [i, true]))); };
  const importQuizzes = async () => { const qs = lessons.flatMap((l: any) => (l.quiz?.questions || []).map((q: any) => ({ q: q.q, options: q.options, answer: q.answer, topic: l.title, lessonId: l.id, source: 'lesson quiz' }))); if (!qs.length) { setMsg('No lesson quizzes in this course yet.'); return; } const r = await api({ action: 'qbank-save-many', tenantId, courseId, questions: qs }); setMsg(r.ok ? `${r.saved} quiz questions added to the bank.` : r.error); await reload(); };
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/60 p-3">
        <p className="text-sm font-black">✨ Generate questions from the lesson material</p>
        <div className="flex flex-wrap gap-2"><select className={field} value={gen.lessonId} onChange={(e) => setGen({ ...gen, lessonId: e.target.value })}><option value="">Whole course</option>{lessons.map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
          <input type="number" min={3} max={25} className={`${field} w-24`} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} title="How many" />
          <select className={field} value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
          <button type="button" disabled={!!busy} onClick={generate} className="h-10 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy === 'gen' ? 'Writing questions…' : 'Generate'}</button>
          <button type="button" onClick={importQuizzes} className="h-10 rounded-xl border-2 px-3 text-sm font-bold">Import lesson quizzes</button>
          <button type="button" onClick={() => setAdd({ q: '', options: ['', '', '', ''], answer: 0, topic: '', difficulty: 'medium' })} className="h-10 rounded-xl border-2 px-3 text-sm font-bold">+ Write one</button></div>
        <p className="text-[11px] text-muted-foreground">Questions use only what’s in your lessons. Read each one before saving — nothing reaches students or tests until you keep it.</p>
      </div>
      {drafts && (
        <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-3">
          <p className="font-black">Review {drafts.length} draft questions</p>
          {drafts.map((q, i) => <label key={i} className={`flex gap-2 rounded-xl p-2 text-sm ${keep[i] ? 'bg-muted/40' : 'opacity-50'}`}><input type="checkbox" checked={!!keep[i]} onChange={(e) => setKeep({ ...keep, [i]: e.target.checked })} className="mt-1" /><span><b>{q.q}</b><span className="block text-[12px]">{q.options.map((o: string, j: number) => `${'ABCD'[j]}. ${o}${j === q.answer ? ' ✓' : ''}`).join('   ')}</span>{q.explanation && <span className="block text-[11px] text-muted-foreground">{q.explanation}</span>}</span></label>)}
          <div className="flex gap-2"><button type="button" onClick={async () => { const r = await api({ action: 'qbank-save-many', tenantId, courseId, questions: drafts.filter((_, i) => keep[i]) }); setMsg(r.ok ? `${r.saved} questions saved to the bank.` : r.error); setDrafts(null); await reload(); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Save {Object.values(keep).filter(Boolean).length} to the bank</button><button type="button" onClick={() => setDrafts(null)} className="h-10 px-3 text-sm font-bold text-muted-foreground">Discard</button></div>
        </div>
      )}
      {add && (
        <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-3">
          <input className={`${field} w-full`} value={add.q} onChange={(e) => setAdd({ ...add, q: e.target.value })} placeholder="Question" />
          {add.options.map((o: string, j: number) => <label key={j} className="flex items-center gap-2 text-sm"><input type="radio" checked={add.answer === j} onChange={() => setAdd({ ...add, answer: j })} /><input className={`${field} flex-1`} value={o} onChange={(e) => { const os = [...add.options]; os[j] = e.target.value; setAdd({ ...add, options: os }); }} placeholder={`Option ${'ABCD'[j]}`} /></label>)}
          <div className="flex gap-2"><input className={field} value={add.topic} onChange={(e) => setAdd({ ...add, topic: e.target.value })} placeholder="Topic" /><button type="button" onClick={async () => { const r = await api({ action: 'qbank-save', tenantId, courseId, question: add }); if (r.ok) { setAdd(null); await reload(); } else setMsg(r.error); }} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Save</button><button type="button" onClick={() => setAdd(null)} className="px-3 text-sm font-bold text-muted-foreground">Cancel</button></div>
        </div>
      )}
      <p className="text-sm font-bold">{bank.length} questions in the bank</p>
      {topics.map((t) => (
        <details key={t} className="rounded-2xl bg-muted/40 p-3"><summary className="cursor-pointer text-sm font-black">{t} · {bank.filter((q: any) => (q.topic || 'General') === t).length}</summary>
          <div className="mt-2 space-y-1.5">{bank.filter((q: any) => (q.topic || 'General') === t).map((q: any) => <div key={q.id} className="flex items-start gap-2 rounded-xl bg-background p-2 text-sm"><span className="min-w-0 flex-1"><b>{q.q}</b><span className="block text-[12px] text-muted-foreground">✓ {q.options[q.answer]} · {q.difficulty}{q.source === 'ai' ? ' · AI draft, approved' : ''}</span></span><button type="button" onClick={async () => { if (window.confirm('Remove this question from the bank?')) { await api({ action: 'qbank-delete', tenantId, courseId, id: q.id }); await reload(); } }} className="text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>)}</div></details>
      ))}
    </div>
  );
}

function TestBuilder({ bank, lessons, course, brand }: any) {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [o, setO] = useState({ title: `${course?.title || 'Unit'} test`, count: 20, versions: 2, minutes: 30 });
  const pool = bank.filter((q: any) => !Object.values(sel).some(Boolean) || sel[q.lessonId || q.topic || 'general']);
  const groups = [...new Map(bank.map((q: any) => [q.lessonId || q.topic || 'general', lessons.find((l: any) => l.id === q.lessonId)?.title || q.topic || 'General'])).entries()] as [string, string][];
  const print = () => {
    const seed = Date.now() % 100000;
    const chosen = shuffle(pool, rng(seed)).slice(0, Math.min(o.count, pool.length));
    const vs = testVersions(chosen.map((q: any) => ({ q: q.q, options: q.options, answer: q.answer, topic: q.topic })), o.versions, seed);
    const body = vs.map((v, i) => `${i ? '<div class="break"></div>' : ''}${testHtml({ title: o.title, course: course?.title || '', version: v.label, items: v.items, minutes: o.minutes, scale: GRADE_SCALE })}`).join('')
      + vs.map((v) => `<div class="break"></div>${keyHtml({ title: o.title, version: v.label, items: v.items })}`).join('');
    printDocument({ title: o.title, brand, body, footerNote: `Test set ${seed} · keep answer keys separate from student copies` });
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-[12px] font-bold sm:col-span-2">Title<input className={`${field} w-full`} value={o.title} onChange={(e) => setO({ ...o, title: e.target.value })} /></label>
        <label className="text-[12px] font-bold">Questions<input type="number" className={`${field} w-full`} value={o.count} onChange={(e) => setO({ ...o, count: Number(e.target.value) })} /></label>
        <label className="text-[12px] font-bold">Versions<select className={`${field} w-full`} value={o.versions} onChange={(e) => setO({ ...o, versions: Number(e.target.value) })}><option value={1}>1 (A)</option><option value={2}>2 (A, B)</option><option value={3}>3 (A, B, C)</option></select></label>
        <label className="text-[12px] font-bold">Minutes<input type="number" className={`${field} w-full`} value={o.minutes} onChange={(e) => setO({ ...o, minutes: Number(e.target.value) })} /></label>
      </div>
      <div className="rounded-2xl bg-muted/40 p-3"><p className="text-sm font-black">Cover these lessons <span className="font-normal text-muted-foreground">(none ticked = whole bank)</span></p>
        <div className="mt-1 flex flex-wrap gap-1.5">{groups.map(([k, l]) => <label key={k} className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-bold ${sel[k] ? 'bg-foreground text-background' : 'bg-background'}`}><input type="checkbox" className="hidden" checked={!!sel[k]} onChange={(e) => setSel({ ...sel, [k]: e.target.checked })} />{l}</label>)}</div></div>
      <p className="text-sm">{pool.length} questions available{pool.length < o.count ? ` — the test will have ${pool.length}` : ''}. Each version shuffles questions and answer choices; answer keys print after the tests. Grading: {GRADE_SCALE}.</p>
      <button type="button" disabled={!pool.length} onClick={print} className="h-11 rounded-xl bg-foreground px-5 text-sm font-bold text-background disabled:opacity-40">Print test{o.versions > 1 ? 's' : ''} + answer keys</button>
    </div>
  );
}

function Worksheets({ tenantId, courseId, lessons, course, brand, setMsg }: any) {
  const [kind, setKind] = useState('matching'); const [lessonId, setLessonId] = useState(lessons[0]?.id || '');
  const [items, setItems] = useState<any>(null); const [busy, setBusy] = useState(false);
  const lesson = lessons.find((l: any) => l.id === lessonId);
  const title = lesson?.title || course?.title || 'Worksheet';
  useEffect(() => { setItems(null); }, [kind, lessonId]);
  const prepare = async () => {
    setBusy(true);
    if (kind === 'label') { setItems(lesson?.activity?.type === 'label' ? lesson.activity : null); if (lesson?.activity?.type !== 'label') setMsg('This lesson has no “label the diagram” activity — add one in the lesson editor.'); setBusy(false); return; }
    const fromCards = (lesson?.flashcards || []).map((f: any) => ({ term: f.front, definition: f.back }));
    if (['matching', 'wordsearch', 'crossword'].includes(kind) && fromCards.length >= 5) { setItems(fromCards); setBusy(false); return; }
    const aiKind = ['matching', 'wordsearch', 'crossword'].includes(kind) ? 'vocab' : kind;
    const r = await api({ action: 'worksheet-ai', tenantId, courseId, lessonId: lessonId || undefined, kind: aiKind, count: kind === 'crossword' ? 12 : 10 });
    setBusy(false); if (!r.ok) { setMsg(r.error); return; } setItems(r.items);
  };
  const html = (key: boolean) => {
    const seed = [...String(lessonId || courseId)].reduce((n, c) => n + c.charCodeAt(0), 0);
    if (kind === 'matching') return matchingHtml(title, items, seed, key);
    if (kind === 'wordsearch') return wordSearchHtml(title, wordSearch(items.map((x: any) => x.term), 15, seed), key);
    if (kind === 'crossword') return crosswordHtml(title, crossword(items.map((x: any) => ({ answer: x.term, clue: x.definition })), seed), key);
    if (kind === 'cloze') return clozeHtml(title, items, key);
    if (kind === 'short') return shortAnswerHtml(title, items, key);
    return labelHtml(title, items, key);
  };
  const nameLine = '<div class="grid grid3" style="margin-bottom:10px"><div class="panel">Name<div class="answer-line"></div></div><div class="panel">Date<div class="answer-line"></div></div><div class="panel">Score<div class="answer-line"></div></div></div>';
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">{WS.map(([k, l, h]) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-2xl border-2 p-3 text-left ${kind === k ? 'border-foreground' : 'border-border/60'}`}><p className="font-black">{l}</p><p className="text-[12px] text-muted-foreground">{h}</p></button>)}</div>
      <div className="flex flex-wrap items-center gap-2"><select className={field} value={lessonId} onChange={(e) => setLessonId(e.target.value)}><option value="">Whole course</option>{lessons.map((l: any) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
        <button type="button" disabled={busy} onClick={prepare} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background disabled:opacity-50">{busy ? 'Preparing…' : 'Prepare'}</button>
        <span className="text-[12px] text-muted-foreground">{['matching', 'wordsearch', 'crossword'].includes(kind) ? 'Uses the lesson’s flashcards (5+), otherwise ✨ AI picks key terms from the lesson.' : kind === 'label' ? 'Uses the lesson’s “label the diagram” activity.' : '✨ AI writes these from the lesson — check them before printing.'}</span></div>
      {items && (
        <div className="space-y-2 rounded-2xl border-2 border-foreground/30 p-3">
          {kind !== 'label' ? (items as any[]).map((x: any, i: number) => <p key={i} className="text-sm"><b>{i + 1}.</b> {x.term ? `${x.term} — ${x.definition}` : x.sentence ? `${x.sentence} (${x.answer})` : `${x.question} → ${x.answer}`}</p>) : <p className="text-sm">{items.points.length} labels on the diagram.</p>}
          <div className="flex gap-2"><button type="button" onClick={() => printDocument({ title: `${title} — worksheet`, brand, body: nameLine + html(false) })} className="h-10 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Print worksheet</button>
            <button type="button" onClick={() => printDocument({ title: `${title} — answer key`, brand, body: html(true), footerNote: 'Answer key — keep separate from student copies' })} className="h-10 rounded-xl border-2 px-4 text-sm font-bold">Print answer key</button></div>
        </div>
      )}
    </div>
  );
}
