'use client';
// src/components/academy/StudentPortal.tsx
//
// THE STUDENT PORTAL — everything a student needs, a tap away, in their language.
//   Today      clocked in?, today's duty, today's clinic clients, continue
//              learning, tuition alerts (Pay), documents to redo, announcements
//   Learn      courses and program progress (services done / required)
//   Hours      total vs required, online / live / in person, attendance
//              history, progress checks, online time by week
//   Tuition    balance, upcoming payments, history; Pay next · Pay balance ·
//              Update card (a failed payment is retried straight away)
//   Inbox      messages with the school (translated both ways) + announcements
//   Documents  signed agreement (translation as a reading aid only),
//              certificates, hours letters, uploaded documents
//
// Language: the portal's words and all content are shown in the student's
// language (AI translation, cached); originals are always one tap away.

import { ProgressRing } from '@/components/academy/Delight';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, getToken, Shell, Loading, GameChips } from '@/components/academy/Learn';

// ── The portal's words (English) — translated for other languages ─────────
const S = {
  today: 'Today', learn: 'Learn', hours: 'Hours', tuition: 'Tuition', inbox: 'Inbox', docs: 'Documents',
  hello: 'Hello', language: 'Language', clockedIn: 'Clocked in since', notClockedIn: 'Not clocked in', scanToClock: 'Scan the code at the front desk to clock in or out.',
  duty: 'Your duty today', noDuty: 'No duty assigned today', week: 'This week', clinicToday: 'Your clinic clients today', noClinic: 'No clinic clients booked today',
  signedOff: 'signed off', continueLearning: 'Continue learning', lessonsDone: 'lessons done', open: 'Open',
  paymentFailed: 'Your last tuition payment didn’t go through', updateCard: 'Update card', payNow: 'Pay now', nextPayment: 'Next payment', onAutopay: 'on autopay',
  redo: 'Please upload again', announcements: 'Announcements', messages: 'Messages', newMessages: 'new messages',
  courses: 'Your courses', start: 'Start', cont: 'Continue', program: 'Your program', servicesDone: 'Services signed off',
  total: 'Total', online: 'Online', live: 'Live classes', inPerson: 'In person', of: 'of', attendance: 'Attendance history', progressChecks: 'Progress checks', onlineByWeek: 'Online learning by week', minutes: 'min',
  balance: 'Balance', paid: 'Paid', upcoming: 'Upcoming payments', history: 'Payment history', payNext: 'Pay next instalment', payAll: 'Pay full balance', allPaid: 'All paid — thank you!',
  cardSaved: 'Card updated.', retried: 'We tried your payment again:', success: 'it went through', failed: 'it didn’t go through — please try another card',
  write: 'Write to your school', send: 'Send', showOriginal: 'Show original', showTranslation: 'Show translation', translatedNote: 'Translated automatically',
  agreement: 'Enrolment agreement', signedOn: 'Signed on', readingAid: 'Translation to help you understand — the English original is the version you signed.',
  todo: 'To do', dueWord: 'Due', overdueWord: 'Overdue', reviewWord: 'Review', allDone: 'All caught up', lessonsWord: 'lessons', goWord: 'Start',
  toGo: 'to go', certificates: 'Certificates',
  practice: 'State-board practice', practiceHint: 'Timed, mixed questions from your courses — see which topics to study.', questionsWord: 'questions', startPractice: 'Start', handIn: 'Hand in', timeLeft: 'left', unanswered: 'unanswered',
  yourScore: 'Your score', byTopic: 'By topic', studyNext: 'Study these next', review: 'Questions you missed', rightAnswer: 'Right answer', recent: 'Recent attempts', prev: 'Back', nextQ: 'Next', close: 'Close', notEnough: 'Your school hasn’t added practice questions yet.', letters: 'Hours letters', uploads: 'Your documents', nothingYet: 'Nothing here yet.', signOut: 'Sign out', joinLive: 'Join a live class',
  statusApproved: 'approved', statusOpen: 'on the floor', statusFlagged: 'needs your instructor', statusPending: 'waiting for approval', statusClosed: 'recorded',
};
type Str = typeof S;
const UI_V = 'v4';   // bump when words are added, so phones fetch the new translations

/** The portal's words in the student's language (translated once, remembered on this device). */
function useWords(tenantId: string, lang: string): Str {
  const [w, setW] = useState<Str>(S);
  useEffect(() => {
    if (!lang || lang === 'en') { setW(S); return; }
    const k = `cf_ui_${lang}_${UI_V}`;
    try { const c = localStorage.getItem(k); if (c) { setW({ ...S, ...JSON.parse(c) }); return; } } catch { /* none */ }
    const keys = Object.keys(S) as (keyof Str)[];
    api({ action: 'translate', tenantId, token: getToken(tenantId), lang, texts: keys.map((x) => S[x]) }).then((r) => {
      if (!r.ok) return; const out: any = {}; keys.forEach((x, i) => { out[x] = r.texts[i] || S[x]; });
      setW(out); try { localStorage.setItem(k, JSON.stringify(out)); } catch { /* private mode */ }
    });
  }, [tenantId, lang]);
  return w;
}
/** Translate a few pieces of content (announcements etc.) — cached on the server. */
function useTranslated(tenantId: string, lang: string, texts: string[]) {
  const [out, setOut] = useState<string[] | null>(null);
  const sig = texts.join('\u241E');
  useEffect(() => {
    if (!lang || lang === 'en' || !texts.length) { setOut(null); return; }
    api({ action: 'translate', tenantId, token: getToken(tenantId), lang, texts }).then((r) => r.ok && setOut(r.texts));
  }, [tenantId, lang, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}
const usd = (c: number) => `$${(Math.round(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayName = (k: string, lang: string) => new Date(2024, 0, 1 + ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(k)).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang, { weekday: 'short' });
const fmt = (iso: string | null | undefined, lang: string, opt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => (iso ? new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang, opt) : '—');
const time = (iso: string, lang: string) => new Date(iso).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : lang, { hour: 'numeric', minute: '2-digit' });

type Tab = 'today' | 'learn' | 'hours' | 'tuition' | 'inbox' | 'docs';

export function StudentPortal({ tenantId, courses, onSignOut }: { tenantId: string; courses: any[]; onSignOut: () => void }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp?.get('tab') as Tab) || 'today');
  const [p, setP] = useState<any>(null);
  const [lang, setLang] = useState('en');
  const [note, setNote] = useState('');
  const token = getToken(tenantId);
  const w = useWords(tenantId, lang);
  const load = useCallback(async () => { const r = await api({ action: 'portal', tenantId, token }); if (r.ok) { setP(r); setLang(r.lang || 'en'); } }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  // Back from Stripe: record the payment / new card.
  useEffect(() => {
    const paid = sp?.get('paid'), card = sp?.get('card');
    if (!paid && !card) return;
    (async () => {
      const r = await api({ action: paid ? 'tuition-confirm' : 'card-confirm', tenantId, token, sessionId: paid || card });
      if (card && r.ok) setNote(`${S.cardSaved}${r.retried ? ` ${S.retried} ${r.retried.ok ? S.success : S.failed}.` : ''}`);
      window.history.replaceState(null, '', `/learn/${tenantId}/my?tab=tuition`); setTab('tuition'); void load();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <Shell tenantId={tenantId}><Loading /></Shell>;
  const color = p.brand?.color || '#1c1917';
  const tabs: [Tab, string, string][] = [['today', w.today, '☀️'], ['learn', w.learn, '📚'], ...(p.isSchool ? [['hours', w.hours, '⏱'] as [Tab, string, string]] : []), ...(p.tuition.length ? [['tuition', w.tuition, '💳'] as [Tab, string, string]] : []), ['inbox', w.inbox, '💬'], ['docs', w.docs, '📄']];

  return (
    <Shell brand={p.brand} tenantId={tenantId}>
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-light tracking-tight">{w.hello}, <span className="font-semibold">{String(p.student.name || p.student.email).split(' ')[0]}</span></h1>
          <label className="flex items-center gap-1.5 text-sm"><span aria-hidden>🌐</span><span className="sr-only">{w.language}</span>
            <select value={lang} onChange={async (e) => { const l = e.target.value; setLang(l); await api({ action: 'set-language', tenantId, token, lang: l }); void load(); }} className="h-9 rounded-full bg-white/80 px-3 text-sm">
              {Object.entries(p.languages || {}).map(([k, v]: any) => <option key={k} value={k}>{v.native}</option>)}
            </select></label>
        </div>
        {note && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">{note}</p>}

        {tab === 'today' && <Today p={p} w={w} lang={lang} tenantId={tenantId} color={color} go={setTab} />}
        {tab === 'learn' && <LearnTab p={p} w={w} tenantId={tenantId} color={color} courses={courses} />}
        {tab === 'hours' && <HoursTab w={w} lang={lang} tenantId={tenantId} color={color} />}
        {tab === 'tuition' && <TuitionTab w={w} lang={lang} tenantId={tenantId} color={color} />}
        {tab === 'inbox' && <InboxTab w={w} lang={lang} tenantId={tenantId} color={color} announcements={p.announcements} onRead={load} />}
        {tab === 'docs' && <DocsTab w={w} lang={lang} tenantId={tenantId} />}

        <div className="flex items-center justify-center gap-4 pt-2 text-sm">
          <Link href={`/learn/${tenantId}/live`} className="underline">● {w.joinLive}</Link>
          <button type="button" onClick={onSignOut} className="text-stone-500 underline">{w.signOut}</button>
        </div>
      </div>
      {/* Tab bar — thumb-friendly on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl" aria-label="Portal">
        <div className="mx-auto flex max-w-2xl">{tabs.map(([k, l, i]) => (
          <button key={k} type="button" onClick={() => { setTab(k); window.scrollTo({ top: 0 }); }} aria-current={tab === k ? 'page' : undefined} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${tab === k ? 'font-semibold' : 'text-stone-500'}`} style={tab === k ? { color } : undefined}>
            <span className="text-lg" aria-hidden>{i}</span>{l}
            {k === 'inbox' && p.unread > 0 && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-red-500" aria-label={`${p.unread} ${w.newMessages}`} />}
          </button>
        ))}</div>
      </nav>
    </Shell>
  );
}

function Card({ title, children, tone }: { title?: string; children: React.ReactNode; tone?: 'alert' | 'ok' }) {
  return <section className={`rounded-[1.5rem] border p-4 ${tone === 'alert' ? 'border-red-200 bg-red-50/90' : 'glass border-white/70'}`}>{title && <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-stone-500">{title}</p>}{children}</section>;
}

function Today({ p, w, lang, tenantId, color, go }: any) {
  const tr = useTranslated(tenantId, lang, p.announcements.flatMap((a: any) => [a.title, a.body]));
  const late = p.tuition.find((x: any) => x.status === 'past_due');
  const next = p.tuition.find((x: any) => x.status === 'active' && x.nextDueAt);
  return (
    <div className="cf-stagger space-y-3">
      {p.game && <Card><GameChips g={p.game} color={color} /></Card>}
      <TodoCard w={w} lang={lang} tenantId={tenantId} color={color} />
      {late && <Card tone="alert"><p className="font-semibold text-red-900">{w.paymentFailed}</p><p className="text-sm text-red-800">{usd(late.balanceCents)} · {late.lastError}</p><button type="button" onClick={() => go('tuition')} className="mt-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white">{w.updateCard} / {w.payNow}</button></Card>}
      {p.needs.length > 0 && <Card tone="alert"><p className="font-semibold text-red-900">{w.redo}</p>{p.needs.map((n: any) => <p key={n.doc} className="text-sm text-red-800">{n.doc}{n.reason ? ` — ${n.reason}` : ''}</p>)}</Card>}
      {p.isSchool && (
        <Card><div className="flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${p.clock ? 'bg-emerald-500' : 'bg-stone-300'}`} /><p className="font-semibold">{p.clock ? `${w.clockedIn} ${time(p.clock.since, lang)}` : w.notClockedIn}</p></div><p className="mt-1 text-[13px] text-stone-500">{w.scanToClock}</p></Card>
      )}
      {p.isSchool && (p.duty.length > 0 || p.week.length > 0) && (
        <Card title={w.duty}><p className="text-lg font-semibold">{p.duty.length ? p.duty.join(' · ') : w.noDuty}</p>
          {p.week.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{p.week.map((d: any) => <span key={d.day} className="rounded-full bg-white/80 px-2.5 py-1 text-[12px]"><b>{dayName(d.day, lang)}</b> {d.stations.join(', ') || '—'}</span>)}</div>}</Card>
      )}
      {p.isSchool && (
        <Card title={w.clinicToday}>{p.clinic.length === 0 ? <p className="text-sm text-stone-500">{w.noClinic}</p> : p.clinic.map((c: any, i: number) => <p key={i} className="flex justify-between py-1 text-[15px]"><span><b>{time(c.time, lang)}</b> · {c.service} · {c.client}</span>{c.signedOff && <span className="text-[12px] text-emerald-700">✓ {w.signedOff}</span>}</p>)}</Card>
      )}
      {p.next && (
        <Card title={w.continueLearning}><p className="text-lg font-semibold">{p.next.title}</p><p className="text-sm text-stone-500">{p.next.done} {w.of} {p.next.total} {w.lessonsDone}</p>
          <Link href={p.next.lessonId ? `/learn/${tenantId}/${p.next.slug}/${p.next.lessonId}` : `/learn/${tenantId}/${p.next.slug}`} className="mt-2 inline-block rounded-full px-5 py-2.5 text-sm font-medium text-white" style={{ background: color }}>{w.cont} →</Link></Card>
      )}
      {next && <Card title={w.nextPayment}><p className="text-[15px]"><b>{usd(Math.min(next.installmentCents, next.balanceCents))}</b> · {fmt(next.nextDueAt, lang, { weekday: 'short', month: 'short', day: 'numeric' })}{next.autopay ? ` · ${w.onAutopay}` : ''}</p></Card>}
      {p.unread > 0 && <button type="button" onClick={() => go('inbox')} className="glass w-full rounded-[1.5rem] border border-white/70 p-4 text-left"><b>💬 {p.unread}</b> {w.newMessages}</button>}
      {p.announcements.length > 0 && (
        <Card title={w.announcements}>{p.announcements.map((a: any, i: number) => <div key={i} className="py-1.5"><p className="font-semibold">{tr ? tr[i * 2] : a.title}</p><p className="whitespace-pre-wrap text-[15px] text-stone-700">{tr ? tr[i * 2 + 1] : a.body}</p><p className="text-[11px] text-stone-400">{fmt(a.at, lang)}{tr ? ` · ${w.translatedNote}` : ''}</p></div>)}</Card>
      )}
    </div>
  );
}

function LearnTab({ p, w, tenantId, color, courses }: any) {
  return (
    <div className="space-y-3">
      <Practice w={w} tenantId={tenantId} color={color} />
      {p.programs.map((pr: any) => (
        <Card key={pr.id} title={w.program}><p className="text-lg font-semibold">{pr.name}</p>
          {pr.totalHours && <div className="mt-3 flex items-center gap-4"><ProgressRing value={pr.hours.total} max={pr.totalHours} color={color} label={`${pr.hours.total}`} sub={`${w.of} ${pr.totalHours} h`} />
            <div className="min-w-0 flex-1 space-y-1 text-sm"><p>{w.inPerson} <b>{pr.hours.inPerson}</b></p><p>{w.online} <b>{pr.hours.online}</b></p><p className="text-stone-500">{Math.max(0, Math.round((pr.totalHours - pr.hours.total) * 4) / 4)} h {w.toGo}</p></div></div>}
          {pr.requirements.length > 0 && <><p className="mt-3 text-[12px] font-semibold text-stone-500">{w.servicesDone}</p><div className="mt-1 grid gap-1.5 sm:grid-cols-2">{pr.requirements.map((r: any) => <div key={r.key} className="rounded-xl bg-white/70 px-3 py-2 text-sm"><div className="flex justify-between"><span>{r.label}</span><b>{r.done}/{r.required}</b></div><div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (r.done / Math.max(1, r.required)) * 100)}%`, background: color }} /></div></div>)}</div></>}
        </Card>
      ))}
      <Card title={w.courses}>{courses.length === 0 ? <p className="text-sm text-stone-500">{w.nothingYet}</p> : courses.map((c: any) => (
        <div key={c.id} className="flex items-center gap-3 border-b border-white/60 py-2.5 last:border-0">
          <div className="min-w-0 flex-1"><p className="truncate font-semibold">{c.title}</p><div className="mt-1 h-1.5 rounded-full bg-white/80"><div className="h-1.5 rounded-full" style={{ width: `${c.pct}%`, background: color }} /></div><p className="mt-0.5 text-[11px] text-stone-500">{c.done} {w.of} {c.lessonCount} {w.lessonsDone}</p></div>
          {c.certificateCode ? <Link href={`/verify/${c.certificateCode}`} className="text-sm">🎓</Link> : null}
          <Link href={c.lastLessonId ? `/learn/${tenantId}/${c.slug}/${c.lastLessonId}` : `/learn/${tenantId}/${c.slug}`} className="rounded-full px-4 py-2 text-sm text-white" style={{ background: color }}>{c.done ? w.cont : w.start}</Link>
        </div>
      ))}</Card>
    </div>
  );
}

function HoursTab({ w, lang, tenantId, color }: any) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api({ action: 'hours', tenantId, token: getToken(tenantId) }).then(setD); }, [tenantId]);
  if (!d) return <Loading />;
  const status: Record<string, string> = { approved: w.statusApproved, open: w.statusOpen, flagged: w.statusFlagged, pending: w.statusPending, closed: w.statusClosed };
  const maxW = Math.max(1, ...d.onlineByWeek.map((x: any) => x.minutes));
  return (
    <div className="space-y-3">
      {d.programs.map((pr: any, i: number) => (
        <Card key={i} title={pr.name}>{pr.totalHours && <div className="mb-3 flex justify-center"><ProgressRing value={pr.hours.total} max={pr.totalHours} size={150} color={color} label={`${pr.hours.total} h`} sub={`${w.of} ${pr.totalHours}`} /></div>}<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[[w.total, pr.hours.total], [w.online, pr.hours.online], [w.live, pr.hours.live || 0], [w.inPerson, pr.hours.inPerson]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-white/70 p-2 text-center"><p className="text-xl font-semibold">{v}</p><p className="text-[11px] text-stone-500">{l}</p></div>)}</div>
          {pr.totalHours && <p className="mt-2 text-sm text-stone-600">{pr.hours.total} {w.of} {pr.totalHours} {w.hours.toLowerCase()}</p>}
          {pr.sap.length > 0 && <><p className="mt-3 text-[12px] font-semibold text-stone-500">{w.progressChecks}</p>{pr.sap.map((s: any, k: number) => <p key={k} className="text-sm">{s.checkpoint} h · <b className={s.result === 'satisfactory' ? 'text-emerald-700' : s.result === 'warning' ? 'text-amber-700' : 'text-red-700'}>{s.result}</b> · {fmt(s.at, lang)}</p>)}</>}
        </Card>
      ))}
      {d.onlineByWeek.length > 0 && <Card title={w.onlineByWeek}><div className="flex h-28 items-end gap-1">{d.onlineByWeek.map((x: any) => <div key={x.week} className="flex flex-1 flex-col items-center gap-1"><div className="w-full rounded-t-md" style={{ height: `${(x.minutes / maxW) * 90}px`, background: color }} title={`${x.minutes} ${w.minutes}`} /><span className="text-[9px] text-stone-500">{fmt(x.week, lang, { month: 'numeric', day: 'numeric' })}</span></div>)}</div></Card>}
      <Card title={w.attendance}>{d.punches.length === 0 ? <p className="text-sm text-stone-500">{w.nothingYet}</p> : d.punches.map((x: any, i: number) => <p key={i} className="flex justify-between py-1 text-sm"><span>{fmt(x.in, lang, { weekday: 'short', month: 'short', day: 'numeric' })} · {time(x.in, lang)}–{x.out ? time(x.out, lang) : '…'}</span><span>{Math.floor(x.minutes / 60)}h {x.minutes % 60}m · <span className="text-stone-500">{status[x.status] || x.status}</span></span></p>)}</Card>
      {d.live.length > 0 && <Card title={w.live}>{d.live.map((x: any, i: number) => <p key={i} className="text-sm">{fmt(x.at, lang)} · {x.title} · {x.minutes} {w.minutes}</p>)}</Card>}
    </div>
  );
}

function TuitionTab({ w, lang, tenantId, color }: any) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { api({ action: 'tuition', tenantId, token: getToken(tenantId) }).then(setD); }, [tenantId]);
  if (!d) return <Loading />;
  const go = async (action: string, planId: string, what?: string) => { setBusy(action + (what || '')); const r = await api({ action, tenantId, token: getToken(tenantId), planId, what }); if (r.ok && r.url) window.location.href = r.url; else { setBusy(''); alert(r.error || 'Try again.'); } };
  return (
    <div className="space-y-3">{d.plans.map((x: any) => (
      <div key={x.id} className="space-y-3">
        {x.lastError && <Card tone="alert"><p className="font-semibold text-red-900">{w.paymentFailed}</p><p className="text-sm text-red-800">{x.lastError}</p></Card>}
        <Card><div className="grid grid-cols-2 gap-3"><div><p className="text-[12px] text-stone-500">{w.balance}</p><p className="text-3xl font-light">{usd(x.balanceCents)}</p></div><div className="text-right"><p className="text-[12px] text-stone-500">{w.paid}</p><p className="text-xl">{usd(x.paidCents)} <span className="text-sm text-stone-500">{w.of} {usd(x.totalCents)}</span></p></div></div>
          <div className="mt-2 h-2 rounded-full bg-white/80"><div className="h-2 rounded-full" style={{ width: `${Math.min(100, (x.paidCents / Math.max(1, x.totalCents)) * 100)}%`, background: color }} /></div>
          {x.balanceCents <= 0 ? <p className="mt-3 font-semibold text-emerald-700">✓ {w.allPaid}</p> : (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {x.installmentsTotal > x.installmentsPaid && <button type="button" disabled={!!busy} onClick={() => go('tuition-pay', x.id, 'next')} className="h-11 rounded-full text-sm font-medium text-white disabled:opacity-50" style={{ background: color }}>{w.payNext} · {usd(Math.min(x.installmentCents, x.balanceCents))}</button>}
              <button type="button" disabled={!!busy} onClick={() => go('tuition-pay', x.id, 'balance')} className="h-11 rounded-full bg-white/80 text-sm disabled:opacity-50">{w.payAll}</button>
              <button type="button" disabled={!!busy} onClick={() => go('card-update', x.id)} className="h-11 rounded-full bg-white/80 text-sm disabled:opacity-50">{w.updateCard}</button>
            </div>
          )}
        </Card>
        {x.upcoming.length > 0 && <Card title={w.upcoming}>{x.upcoming.map((u: any) => <p key={u.n} className="flex justify-between py-1 text-[15px]"><span>{fmt(u.dueAt, lang, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><b>{usd(u.amountCents)}</b></p>)}<p className="mt-1 text-[12px] text-stone-500">{x.autopay ? `✓ ${w.onAutopay}` : ''}</p></Card>}
        <Card title={w.history}>{x.history.map((h: any, i: number) => <p key={i} className="flex justify-between py-1 text-sm"><span>{fmt(h.at, lang)} · {h.desc}</span><span className={`shrink-0 whitespace-nowrap pl-2 ${h.type === 'payment' ? 'font-semibold text-emerald-700' : h.type === 'refund' ? 'text-sky-700' : ''}`}>{h.type === 'payment' ? '✓ ' : h.type === 'refund' ? '↩ ' : ''}{usd(Math.abs(h.amountCents))}</span></p>)}</Card>
      </div>
    ))}</div>
  );
}

function InboxTab({ w, lang, tenantId, color, announcements, onRead }: any) {
  const [d, setD] = useState<any>(null);
  const [text, setText] = useState('');
  const [orig, setOrig] = useState<Record<number, boolean>>({});
  const load = useCallback(async () => { const r = await api({ action: 'inbox', tenantId, token: getToken(tenantId) }); if (r.ok) { setD(r); onRead?.(); } }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const tr = useTranslated(tenantId, lang, (d?.announcements || announcements || []).flatMap((a: any) => [a.title, a.body]));
  if (!d) return <Loading />;
  return (
    <div className="space-y-3">
      <Card title={w.messages}>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">{d.messages.length === 0 ? <p className="text-sm text-stone-500">{w.nothingYet}</p> : d.messages.map((m: any, i: number) => {
          const mine = m.from === 'student'; const shown = !mine && m.translated && !orig[i] ? m.translated : m.text;
          return (
            <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${mine ? 'ml-auto text-white' : 'bg-white/85'}`} style={mine ? { background: color } : undefined}>
              <p className="whitespace-pre-wrap">{shown}</p>
              <p className="mt-0.5 text-[10px] opacity-70">{!mine ? `${m.by} · ` : ''}{fmt(m.at, lang)} {time(m.at, lang)}{!mine && m.translated ? <> · <button type="button" onClick={() => setOrig({ ...orig, [i]: !orig[i] })} className="underline">{orig[i] ? w.showTranslation : w.showOriginal}</button></> : null}</p>
            </div>
          );
        })}</div>
        <div className="mt-3 flex gap-2"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={w.write} className="flex-1 rounded-2xl border border-white/80 bg-white/80 p-3 text-[15px]" />
          <button type="button" disabled={!text.trim()} onClick={async () => { const r = await api({ action: 'message', tenantId, token: getToken(tenantId), text }); if (r.ok) { setText(''); void load(); } }} className="rounded-2xl px-4 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>{w.send}</button></div>
      </Card>
      {(d.announcements || []).length > 0 && <Card title={w.announcements}>{d.announcements.map((a: any, i: number) => <div key={i} className="py-1.5"><p className="font-semibold">{tr ? tr[i * 2] : a.title}</p><p className="whitespace-pre-wrap text-[15px] text-stone-700">{tr ? tr[i * 2 + 1] : a.body}</p><p className="text-[11px] text-stone-400">{fmt(a.at, lang)}</p></div>)}</Card>}
    </div>
  );
}

function DocsTab({ w, lang, tenantId }: any) {
  const [d, setD] = useState<any>(null);
  const [trAgreement, setTrAgreement] = useState<string | null>(null);
  useEffect(() => { api({ action: 'documents', tenantId, token: getToken(tenantId) }).then(setD); }, [tenantId]);
  if (!d) return <Loading />;
  return (
    <div className="space-y-3">
      {d.agreements.map((a: any, i: number) => (
        <Card key={i} title={w.agreement}><p className="text-sm">{w.signedOn} {fmt(a.signedAt, lang, { year: 'numeric', month: 'long', day: 'numeric' })} · {a.signedName}</p>
          <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold">{w.open}</summary><pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/70 p-3 text-[13px]">{trAgreement ?? a.text}</pre>
            {lang !== 'en' && <button type="button" onClick={async () => { if (trAgreement) { setTrAgreement(null); return; } const r = await api({ action: 'translate', tenantId, token: getToken(tenantId), texts: String(a.text).split(/\n{2,}/) }); if (r.ok) setTrAgreement(r.texts.join('\n\n')); }} className="mt-2 text-sm underline">{trAgreement ? w.showOriginal : w.showTranslation}</button>}
            {trAgreement && <p className="mt-1 text-[12px] text-amber-800">{w.readingAid}</p>}</details></Card>
      ))}
      <Card title={w.certificates}>{d.certificates.length === 0 ? <p className="text-sm text-stone-500">{w.nothingYet}</p> : d.certificates.map((c: any) => <Link key={c.code} href={`/verify/${c.code}`} className="block py-1 text-[15px] underline">🎓 {c.title} · {fmt(c.at, lang)}</Link>)}</Card>
      <Card title={w.letters}>{d.letters.length === 0 ? <p className="text-sm text-stone-500">{w.nothingYet}</p> : d.letters.map((c: any) => <Link key={c.code} href={`/verify/${c.code}`} className="block py-1 text-[15px] underline">📄 {c.program} · {c.hours} h · {fmt(c.at, lang)}</Link>)}</Card>
      {d.uploads.length > 0 && <Card title={w.uploads}>{d.uploads.map((u: any) => <p key={u.doc} className="text-sm">{u.doc} · <b>{u.status}</b>{u.reason ? ` — ${u.reason}` : ''}</p>)}</Card>}
    </div>
  );
}


// ── State-board practice ─────────────────────────────────────────────────
function Practice({ w, tenantId, color }: any) {
  const [info, setInfo] = useState<any>(null); const [run, setRun] = useState<any>(null); const [res, setRes] = useState<any>(null);
  const [count, setCount] = useState(25); const [i, setI] = useState(0); const [ans, setAns] = useState<(number | null)[]>([]);
  const [now, setNow] = useState(Date.now()); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await api({ action: 'practice-info', tenantId, token: getToken(tenantId) }); if (r.ok) setInfo(r); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!run) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [run]);
  const handIn = useCallback(async () => { if (!run || busy) return; setBusy(true); const r = await api({ action: 'practice-submit', tenantId, token: getToken(tenantId), attemptId: run.attemptId, answers: ans }); setBusy(false); if (r.ok) { setRes(r); setRun(null); void load(); } else setErr(r.error); }, [run, busy, ans, tenantId, load]);
  const left = run ? Math.max(0, Math.round((new Date(run.endsAt).getTime() - now) / 1000)) : 0;
  useEffect(() => { if (run && left === 0) void handIn(); }, [run, left, handIn]);
  if (!info) return null;
  if (run) { const q = run.questions[i]; const miss = ans.filter((x) => x == null).length; return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f7f5f2] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center justify-between text-sm"><span className="font-semibold">{i + 1} / {run.questions.length}</span><span className={`rounded-full px-3 py-1 font-semibold ${left < 60 ? 'bg-red-500 text-white' : 'bg-white'}`}>⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} {w.timeLeft}</span></div>
        <div className="h-1.5 rounded-full bg-white"><div className="h-1.5 rounded-full" style={{ width: `${((i + 1) / run.questions.length) * 100}%`, background: color }} /></div>
        <p className="text-[11px] uppercase tracking-widest text-stone-500">{q.topic}</p>
        <p className="text-xl font-semibold leading-snug">{q.q}</p>
        <div className="grid gap-2">{q.options.map((o: string, k: number) => <button key={k} type="button" onClick={() => { const a = [...ans]; a[i] = k; setAns(a); }} className={`min-h-14 rounded-2xl px-4 py-3 text-left text-[16px] shadow-sm ${ans[i] === k ? 'text-white' : 'bg-white'}`} style={ans[i] === k ? { background: color } : undefined}>{o}</button>)}</div>
        <div className="flex gap-2"><button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="h-12 flex-1 rounded-full bg-white text-sm disabled:opacity-40">{w.prev}</button>
          {i + 1 < run.questions.length ? <button type="button" onClick={() => setI(i + 1)} className="h-12 flex-1 rounded-full text-sm font-medium text-white" style={{ background: color }}>{w.nextQ}</button>
            : <button type="button" disabled={busy} onClick={() => { if (miss && !window.confirm(`${miss} ${w.unanswered}. ${w.handIn}?`)) return; void handIn(); }} className="h-12 flex-1 rounded-full text-sm font-medium text-white" style={{ background: color }}>{busy ? '…' : w.handIn}</button>}</div>
        {miss > 0 && <p className="text-center text-[12px] text-stone-500">{miss} {w.unanswered}</p>}
        {err && <p className="text-center text-sm text-red-700">{err}</p>}
      </div>
    </div>
  ); }
  if (res) return (
    <section className="glass space-y-3 rounded-[1.5rem] border border-white/70 p-4">
      <div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">{w.yourScore}</p><button type="button" onClick={() => setRes(null)} className="text-sm underline">{w.close}</button></div>
      <p className="text-4xl font-light">{res.pct}% <span className="text-base text-stone-500">· {res.right}/{res.total}</span></p>
      <p className="text-[12px] font-semibold text-stone-500">{w.byTopic}</p>
      {res.byTopic.map((t: any) => <div key={t.topic}><div className="flex justify-between text-sm"><span>{t.topic}</span><b className={t.pct < 70 ? 'text-red-700' : 'text-emerald-700'}>{t.pct}%</b></div><div className="mt-0.5 h-1.5 rounded-full bg-white/80"><div className="h-1.5 rounded-full" style={{ width: `${t.pct}%`, background: t.pct < 70 ? '#ef4444' : '#10b981' }} /></div></div>)}
      {res.byTopic.some((t: any) => t.pct < 70) && <p className="rounded-2xl bg-amber-50 p-3 text-sm"><b>{w.studyNext}:</b> {res.byTopic.filter((t: any) => t.pct < 70).slice(0, 3).map((t: any) => t.topic).join(', ')}</p>}
      <details><summary className="cursor-pointer text-sm font-semibold">{w.review} ({res.review.filter((r: any) => !r.ok).length})</summary>
        <div className="mt-2 space-y-2">{res.review.filter((r: any) => !r.ok).map((r: any, k: number) => <div key={k} className="rounded-2xl bg-white/85 p-3 text-sm"><p className="font-semibold">{r.q}</p><p className="text-emerald-800">✓ {w.rightAnswer}: {r.options[r.answer]}</p>{r.chose != null && <p className="text-red-700">✗ {r.options[r.chose]}</p>}{r.explanation && <p className="text-stone-600">{r.explanation}</p>}</div>)}</div></details>
    </section>
  );
  return (
    <section className="glass space-y-2 rounded-[1.5rem] border border-white/70 p-4">
      <p className="text-lg font-semibold">📝 {w.practice}</p><p className="text-sm text-stone-600">{w.practiceHint}</p>
      {info.available < 5 ? <p className="text-sm text-stone-500">{w.notEnough}</p> : <div className="flex flex-wrap items-center gap-2">{[10, 25, 50].filter((n) => n <= Math.max(10, info.available)).map((n) => <button key={n} type="button" onClick={() => setCount(n)} className={`h-10 rounded-full px-4 text-sm ${count === n ? 'text-white' : 'bg-white/80'}`} style={count === n ? { background: color } : undefined}>{Math.min(n, info.available)} {w.questionsWord}</button>)}
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); const r = await api({ action: 'practice-start', tenantId, token: getToken(tenantId), count }); setBusy(false); if (r.ok) { setRun(r); setAns(r.questions.map(() => null)); setI(0); setRes(null); } else setErr(r.error); }} className="ml-auto h-10 rounded-full px-5 text-sm font-medium text-white" style={{ background: color }}>{w.startPractice} →</button></div>}
      {err && <p className="text-sm text-red-700">{err}</p>}
      {info.history.length > 0 && <p className="text-[12px] text-stone-500">{w.recent}: {info.history.slice(0, 4).map((h: any) => `${h.pct}%`).join(' · ')}</p>}
    </section>
  );
}


/** Assigned work and automatic reviews — what to do next. */
function TodoCard({ w, lang, tenantId, color }: any) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api({ action: 'todo', tenantId, token: getToken(tenantId) }).then((r) => setItems(r.ok ? r.items : [])); }, [tenantId]);
  if (!items || !items.length) return null;
  const open = items.filter((x) => !x.done);
  return (
    <Card title={w.todo}>
      {open.length === 0 ? <p className="text-sm text-emerald-700">✓ {w.allDone}</p> : open.slice(0, 6).map((x) => (
        <Link key={x.id} href={`/learn/${tenantId}/${x.courseSlug}/${x.nextLessonId}`} className="flex items-center gap-3 border-b border-white/60 py-2.5 last:border-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: x.overdue ? '#fee2e2' : `${color}1a`, color: x.overdue ? '#b91c1c' : color }}>{x.review ? '🔁' : x.finished > 0 ? '◐' : '○'}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{x.review ? `${w.reviewWord}: ` : ''}{x.title}</span>
            <span className={`block text-[12px] ${x.overdue ? 'font-semibold text-red-700' : 'text-stone-500'}`}>{x.overdue ? w.overdueWord : x.dueAt ? `${w.dueWord} ${fmt(x.dueAt, lang, { weekday: 'short', month: 'short', day: 'numeric' })}` : x.courseTitle} · {x.finished}/{x.total} {w.lessonsWord}</span>
            {x.note && <span className="block truncate text-[12px] text-stone-500">“{x.note}”</span>}</span>
          <span className="shrink-0 rounded-full px-3 py-1 text-[12px] font-medium text-white" style={{ background: color }}>{w.goWord}</span>
        </Link>
      ))}
    </Card>
  );
}
