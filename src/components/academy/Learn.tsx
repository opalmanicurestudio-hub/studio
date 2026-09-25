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

import { useCallback, useEffect, useMemo, useRef, useState, createElement } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';

const key = (t: string) => `cf_student_${t}`;
const getToken = (t: string) => { try { return localStorage.getItem(key(t)); } catch { return null; } };
const setToken = (t: string, v: string | null) => { try { v ? localStorage.setItem(key(t), v) : localStorage.removeItem(key(t)); } catch { /* private mode */ } };
async function api(body: any) {
  const r = await fetch('/api/academy/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const money = (c: number) => (c ? `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}` : 'Free');
const mins = (s?: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');

function Shell({ brand, tenantId, children }: { brand?: any; tenantId: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh text-stone-900">
      <AuthBackdrop />
      <div className="relative z-10">
        <header className="sticky top-0 z-20 border-b border-white/60 bg-white/55 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
            <Link href={`/learn/${tenantId}`} className="flex min-w-0 items-center gap-2">
              {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />}
              <span className="truncate text-lg font-light tracking-tight">{brand?.name || 'Academy'} <span className="font-semibold">Academy</span></span>
            </Link>
            <Link href={`/learn/${tenantId}/my`} className="shrink-0 rounded-full bg-white/70 px-4 py-2 text-sm">My courses</Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 pb-28 pt-8">{children}</main>
        <p className="pb-8 text-center text-[11px] text-stone-400">Powered by ClarityFlow</p>
      </div>
    </div>
  );
}
const Glass = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`glass rounded-[1.75rem] border border-white/70 p-5 ${className}`}>{children}</section>;
const Loading = () => <div className="flex justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" /></div>;

/** Paragraphs and "# headings" — enough for lesson notes. */
function Prose({ text }: { text: string }) {
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
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {c.coverUrl && <img src={c.coverUrl} alt="" className="aspect-video w-full rounded-[1.75rem] object-cover" />}
          <div>
            <h1 className="text-4xl font-light tracking-tight sm:text-5xl">{c.title}</h1>
            {c.subtitle && <p className="mt-2 text-lg text-stone-600">{c.subtitle}</p>}
            <p className="mt-2 text-sm text-stone-500">{c.instructorName ? `With ${c.instructorName} · ` : ''}{d.lessons.length} lessons{c.level ? ` · ${c.level}` : ''}</p>
          </div>
          {c.whatYouLearn?.length > 0 && <Glass><p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">What you’ll learn</p><ul className="mt-3 grid gap-2 sm:grid-cols-2">{c.whatYouLearn.map((w: string) => <li key={w} className="flex gap-2 text-[15px]"><span style={{ color }}>✓</span>{w}</li>)}</ul></Glass>}
          <Glass>
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
          </Glass>
          {c.description && <Glass><Prose text={c.description} /></Glass>}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Glass className="space-y-3">
            {d.enrolled ? (
              <>
                <p className="text-lg font-semibold">You’re enrolled</p>
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
  const token = typeof window !== 'undefined' ? getToken(tenantId) : null;
  const load = useCallback(async () => {
    const c = await api({ action: 'course', tenantId, slug, token }); setCourse(c);
    if (c.ok) setLesson(await api({ action: 'lesson', tenantId, courseId: c.course.id, lessonId, token }));
  }, [tenantId, slug, lessonId, token]);
  useEffect(() => { setQuizResult(null); setAnswers({}); setNote(''); void load(); }, [load]);
  const L = lesson?.ok ? lesson.lesson : null;
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
  const tr = lesson.tracking || {};
  const engaged = Math.max(eng.engagedSec, tr.engagedSec || 0), watched = Math.max(eng.watchedSec, tr.watchedSec || 0);
  const dur = L?.durationSec || 0;
  const complete = async () => {
    setBusy(true); setNote('');
    const r = await api({ action: 'progress', tenantId, token, courseId: course.course.id, lessonId, done: !done });
    setBusy(false);
    if (!r.ok) { setNote(r.error || 'Not yet.'); return; }
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
              {mode === 'mux' && <MuxPlayer playbackId={L.video.playbackId} token={L.video.token} color={color} title={L.title} bind={eng.bindPlayer} />}
              {mode === 'embed' && L.video.url && <iframe src={L.video.url} title={L.title} className="aspect-video w-full rounded-[1.25rem]" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
              {L.kind === 'video' && !L.video && <Glass><p className="text-stone-600">This video is being prepared — check back shortly.</p></Glass>}
              {lesson.enrolled && (
                <div className="glass flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-white/70 px-4 py-2.5 text-[13px] text-stone-600">
                  <span>⏱ Active time: <span className="font-semibold text-stone-900">{Math.floor(engaged / 60)} min</span>{tr.compliance && dur ? ` of ${Math.ceil((dur * (tr.minEngagementPct || 80)) / 100 / 60)} needed` : ''}{tr.compliance && L.minMinutes ? ` of ${L.minMinutes} needed` : ''}</span>
                  {mode === 'mux' && dur > 0 && <span>▶ Watched: <span className="font-semibold text-stone-900">{Math.min(100, Math.round((watched / dur) * 100))}%</span>{tr.compliance ? ` of ${tr.minWatchPct || 90}% needed` : ''}</span>}
                  {eng.paused && <span className="font-semibold text-amber-700">Paused — answer the check to keep your time counting</span>}
                  {tr.compliance && <span className="w-full text-[11px] text-stone-400">This course records verified learning time for your school. Time counts while this page is open and you’re actively learning.</span>}
                </div>
              )}
              {L.body && <Glass><Prose text={L.body} /></Glass>}
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
              {note && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {prev && <Link href={`/learn/${tenantId}/${slug}/${prev.id}`} className="rounded-full bg-white/70 px-4 py-2.5 text-sm">← Previous</Link>}
                {lesson.enrolled ? (
                  <button type="button" disabled={busy || (done && tr.compliance)} onClick={complete} className="ml-auto rounded-full px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60" style={{ background: color }}>{done ? '✓ Completed' : next ? 'Mark complete → next' : 'Mark complete'}</button>
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
            <button type="button" onClick={() => { setToken(tenantId, null); void load(); }} className="text-sm text-stone-500 underline">Sign out ({d.student.email})</button>
          </div>
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
