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

import { useCallback, useEffect, useMemo, useState, createElement } from 'react';
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

function MuxPlayer({ playbackId, token, color, title }: { playbackId: string; token: string | null; color: string; title: string }) {
  useEffect(() => {
    if (document.querySelector('script[data-mux-player]')) return;
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@mux/mux-player@3/dist/mux-player.js'; s.async = true; s.dataset.muxPlayer = '1'; document.head.appendChild(s);
  }, []);
  return createElement('mux-player', { 'playback-id': playbackId, ...(token ? { 'playback-token': token } : {}), 'stream-type': 'on-demand', 'accent-color': color, 'metadata-video-title': title, style: { width: '100%', aspectRatio: '16 / 9', borderRadius: '1.25rem', overflow: 'hidden', display: 'block' } });
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
                    const open = d.enrolled || l.preview;
                    const row = <span className="flex items-center gap-2 rounded-2xl bg-white/60 px-3 py-2 text-sm"><span>{d.progress?.[l.id] ? '✓' : l.kind === 'video' ? '▶' : l.kind === 'download' ? '↓' : '≡'}</span><span className="min-w-0 flex-1 truncate">{l.title}</span>{!d.enrolled && l.preview && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: color }}>Watch free</span>}{!open && <span className="text-stone-400">🔒</span>}<span className="text-[12px] text-stone-500">{mins(l.durationSec)}</span></span>;
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

// ── Lesson ───────────────────────────────────────────────────────────────
export function Lesson({ tenantId, slug, lessonId }: { tenantId: string; slug: string; lessonId: string }) {
  const [course, setCourse] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const token = typeof window !== 'undefined' ? getToken(tenantId) : null;
  const load = useCallback(async () => {
    const c = await api({ action: 'course', tenantId, slug, token }); setCourse(c);
    if (c.ok) setLesson(await api({ action: 'lesson', tenantId, courseId: c.course.id, lessonId, token }));
  }, [tenantId, slug, lessonId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!course || !lesson) return <Shell tenantId={tenantId}><Loading /></Shell>;
  if (!course.ok) return <Shell tenantId={tenantId}><Glass><p className="text-center">{course.error}</p></Glass></Shell>;
  const color = course.brand.color;
  const list = course.lessons as any[];
  const i = list.findIndex((l) => l.id === lessonId);
  const next = list[i + 1], prev = list[i - 1];
  const done = !!course.progress?.[lessonId];
  const pct = Math.round((Object.keys(course.progress || {}).length / Math.max(1, list.length)) * 100);
  const complete = async () => {
    setBusy(true);
    await api({ action: 'progress', tenantId, token, courseId: course.course.id, lessonId, done: !done });
    setBusy(false);
    if (!done && next) window.location.href = `/learn/${tenantId}/${slug}/${next.id}`; else void load();
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
              <p className="text-[11px] uppercase tracking-[0.25em] text-stone-400">{lesson.lesson.moduleTitle}</p>
              <h1 className="text-3xl font-light tracking-tight">{lesson.lesson.title}</h1>
              {lesson.lesson.video?.type === 'mux' && <MuxPlayer playbackId={lesson.lesson.video.playbackId} token={lesson.lesson.video.token} color={color} title={lesson.lesson.title} />}
              {lesson.lesson.video?.type === 'embed' && lesson.lesson.video.url && <iframe src={lesson.lesson.video.url} title={lesson.lesson.title} className="aspect-video w-full rounded-[1.25rem]" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
              {lesson.lesson.kind === 'video' && !lesson.lesson.video && <Glass><p className="text-stone-600">This video is being prepared — check back shortly.</p></Glass>}
              {lesson.lesson.body && <Glass><Prose text={lesson.lesson.body} /></Glass>}
              {lesson.lesson.downloadUrl && <a href={lesson.lesson.downloadUrl} target="_blank" rel="noreferrer" className="glass flex items-center justify-between rounded-2xl border border-white/70 px-4 py-3 text-sm"><span>↓ {lesson.lesson.downloadName || 'Download'}</span><span className="text-stone-500">Open</span></a>}
              <div className="flex flex-wrap items-center gap-2">
                {prev && <Link href={`/learn/${tenantId}/${slug}/${prev.id}`} className="rounded-full bg-white/70 px-4 py-2.5 text-sm">← Previous</Link>}
                {lesson.enrolled ? (
                  <button type="button" disabled={busy} onClick={complete} className="ml-auto rounded-full px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50" style={{ background: color }}>{done ? '✓ Completed' : next ? 'Mark complete → next' : 'Mark complete'}</button>
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
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {d.courses.length === 0 && <Glass><p>No courses yet. <Link href={`/learn/${tenantId}`} className="underline">Browse courses</Link></p></Glass>}
            {d.courses.map((c: any) => (
              <Glass key={c.id} className="space-y-3">
                <p className="text-xl font-semibold">{c.title}</p>
                <div><div className="h-2 rounded-full bg-white/70"><div className="h-2 rounded-full" style={{ width: `${c.pct}%`, background: color }} /></div><p className="mt-1 text-[12px] text-stone-500">{c.done} of {c.lessonCount} lessons · {c.pct}%</p></div>
                <Link href={c.lastLessonId ? `/learn/${tenantId}/${c.slug}/${c.lastLessonId}` : `/learn/${tenantId}/${c.slug}`} className="inline-block rounded-full px-5 py-2.5 text-sm font-medium text-white" style={{ background: color }}>{c.done ? 'Continue' : 'Start'}</Link>
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
