'use client';
// src/components/academy/AcademyHome.tsx
//
// ACADEMY HOME — the first screen. Plain language, one tap to each job.
//   What needs you today   cards with a count and "Go" — only what's waiting
//   This month             enrolments, course sales, students, programs
//   Getting started        a checklist until the academy is set up

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Loader } from 'lucide-react';

export type Section = 'home' | 'courses' | 'live' | 'materials' | 'assign' | 'salon' | 'students' | 'attendance' | 'reports' | 'admissions' | 'programs' | 'settings';

export async function academyHome(tenantId: string) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'home', tenantId }) });
  return r.json().catch(() => null);
}

export function AcademyHome({ tenantId, data, go }: { tenantId: string; data: any; go: (s: Section) => void }) {
  const [now] = useState(new Date());
  if (!data) return <Loader className="h-5 w-5 animate-spin" />;
  const s = data.school;
  const hello = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const cards: { n: number | null; title: string; hint: string; to: Section; tone: string }[] = s ? [
    { n: s.checkoffsToday, title: 'Services to sign off', hint: 'Student-salon services today waiting for an instructor', to: 'salon' as Section, tone: 'amber' },
    { n: s.attendanceToFix, title: 'Attendance to fix', hint: 'Missing clock-outs, photo checks or approvals', to: 'attendance' as Section, tone: 'red' },
    { n: s.atRisk, title: 'Students who need you', hint: 'High risk — the reasons are listed for each', to: 'students' as Section, tone: 'red' },
    { n: s.unread, title: 'Unread messages', hint: 'From students', to: 'students' as Section, tone: 'sky' },
    ...(s.isLead ? [
      { n: s.formsDue, title: 'Board forms due', hint: 'Due within 5 days or overdue — open the student’s file', to: 'students' as Section, tone: 'red' },
      { n: s.docsToCheck, title: 'Documents to check', hint: 'Uploaded by applicants — verify or send back', to: 'admissions' as Section, tone: 'amber' },
      { n: s.toCountersign, title: 'Agreements to countersign', hint: 'Signed by new students', to: 'admissions' as Section, tone: 'violet' },
      { n: s.newInquiries, title: 'New inquiries', hint: 'People asking about your programs', to: 'admissions' as Section, tone: 'sky' },
      { n: s.tuitionLate, title: 'Late tuition', hint: 'Autopay failed — it retries every 3 days', to: 'admissions' as Section, tone: 'red' },
    ] : []),
  ].filter((c) => (c.n || 0) > 0) : [];
  const TONE: Record<string, string> = { amber: 'bg-amber-50 border-amber-200', red: 'bg-red-50 border-red-200', sky: 'bg-sky-50 border-sky-200', violet: 'bg-violet-50 border-violet-200' };

  const steps = data.mode === 'school' ? [
    { done: (s?.programs || 0) > 0, text: 'Create a program — hours, required services, tuition', to: 'programs' as Section },
    { done: (data.courses.published || 0) > 0, text: 'Publish a theory course for your program', to: 'courses' as Section },
    { done: (s?.activeStudents || 0) > 0, text: 'Enrol your first student (or share your apply page)', to: 'admissions' as Section },
    { done: (s?.onFloor || 0) > 0 || (s?.activeStudents || 0) > 2, text: 'Put the clock-in screen on a tablet at the front desk', to: 'attendance' as Section },
  ] : [
    { done: (data.courses.total || 0) > 0, text: 'Create your first course', to: 'courses' as Section },
    { done: (data.courses.published || 0) > 0, text: 'Add lessons and publish it', to: 'courses' as Section },
    { done: (data.month.enrolments || 0) > 0, text: 'Share your academy page and get your first student', to: 'settings' as Section },
  ];
  const setupLeft = steps.filter((x) => !x.done).length;

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-black tracking-tight">{hello}.</h2><p className="text-muted-foreground">{s ? (cards.length ? `${cards.length} thing${cards.length === 1 ? '' : 's'} need${cards.length === 1 ? 's' : ''} you today.` : 'Nothing is waiting for you right now.') : 'Here’s how your courses are doing.'}{s?.onFloor ? ` ${s.onFloor} student${s.onFloor === 1 ? ' is' : 's are'} clocked in.` : ''}</p></div>

      {cards.length > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">What needs you today</p>
          <div className="grid gap-2 sm:grid-cols-2">{cards.map((c) => (
            <button key={c.title} type="button" onClick={() => go(c.to)} className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition hover:-translate-y-0.5 ${TONE[c.tone]}`}>
              <span className="text-3xl font-black tabular-nums">{c.n}</span>
              <span className="min-w-0 flex-1"><span className="block font-bold">{c.title}</span><span className="block text-[12px] text-muted-foreground">{c.hint}</span></span>
              <span className="text-sm font-bold">Go →</span>
            </button>
          ))}</div>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">This month</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[[data.month.enrolments, 'New course enrolments'], [`$${Math.round((data.month.revenueCents || 0) / 100).toLocaleString()}`, 'Course sales'], ...(s ? [[s.activeStudents, 'Students in programs'], [s.watch + s.atRisk, 'On the watch list']] : [[data.courses.published, 'Live courses'], [data.courses.total - data.courses.published, 'Drafts']])].map(([v, l]) => (
            <div key={String(l)} className="rounded-2xl bg-muted/40 p-4"><p className="text-2xl font-black tabular-nums">{v}</p><p className="text-[12px] text-muted-foreground">{l}</p></div>
          ))}
        </div>
      </section>

      {setupLeft > 0 && (
        <section className="space-y-2 rounded-2xl border-2 border-dashed border-border/60 p-4">
          <p className="font-black">Getting started <span className="font-normal text-muted-foreground">· {steps.length - setupLeft} of {steps.length} done</span></p>
          {steps.map((x) => (
            <button key={x.text} type="button" onClick={() => go(x.to)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted/40">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black ${x.done ? 'bg-emerald-600 text-white' : 'border-2'}`}>{x.done ? '✓' : ''}</span>
              <span className={x.done ? 'text-muted-foreground line-through' : 'font-bold'}>{x.text}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
