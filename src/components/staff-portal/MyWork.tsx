'use client';
// src/components/staff-portal/MyWork.tsx — STAFF APP → ME → MY WORK (lib/my-work): a ring for how much is done, what's
// still to do (tasks, SOPs to read and sign, checklists it's your turn for — overdue and due today first), and what you
// finished lately. Tapping something takes you to where it's done: tasks and checklists on Today, SOPs in Handbook.
import * as React from 'react';
import { useMyWork } from '@/components/team/useMyWork';
import { bizKey } from '@/lib/biz-clock';
import type { WorkItem, MyWork as MyWorkData } from '@/lib/my-work';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', AMBER = '#9a5b00', RED = '#b42318';
const when = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso); if (isNaN(+d)) return ''; const days = Math.floor((Date.now() - +d) / 864e5); return days < 1 ? 'Today' : days < 7 ? d.toLocaleDateString('en-US', { weekday: 'short' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

export function MyWork({ firestore, tenantId, staff, accent, onBack, onOpen, preview }: { firestore: any; tenantId: string; staff: { id: string; role?: string }; accent: string; onBack: () => void; onOpen: (where: 'today' | 'documents', docId?: string) => void; preview?: MyWorkData }) {
  const loaded = useMyWork(preview ? null : firestore, tenantId, staff, bizKey()); const work = preview || loaded.work; const loading = !preview && loaded.loading;
  const C = 2 * Math.PI * 27; const pct = work?.pct ?? 0;
  const go = (x: WorkItem) => onOpen(x.kind === 'sop' ? 'documents' : 'today', x.kind === 'sop' ? x.ref.docId : undefined);
  return (
    <div className="space-y-3.5 text-[#16171a]">
      <button type="button" onClick={onBack} className="text-[14px]" style={{ color: MUTED }}>‹ Me</button>
      <div className="flex items-center gap-3.5 rounded-[24px] border p-4" style={{ borderColor: LINE }}>
        <div className="relative h-16 w-16 shrink-0">
          <svg aria-hidden="true" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="#f0f0f2" strokeWidth="7" /><circle cx="32" cy="32" r="27" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 32 32)" /></svg>
          <span className="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold">{loading ? '…' : `${pct}%`}</span>
        </div>
        <div><p className="text-[18px] font-extrabold">My work</p>
          <p className="text-[14px]" style={{ color: MUTED }}>{!work ? 'Loading…' : work.total ? `${work.doneCount} of ${work.total} done${work.overdue ? ` · ${work.overdue} overdue` : work.dueToday ? ` · ${work.dueToday} due today` : ''}` : 'Nothing given to you right now'}</p></div>
      </div>
      {!!work?.todo.length && <><p className="text-[15px] font-bold">To do</p>
        <div className="space-y-2">{work.todo.map((x) => { const hot = x.status === 'overdue' || x.status === 'due';
          return <button key={x.key} type="button" onClick={() => go(x)} className="flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-left" style={{ background: x.status === 'overdue' ? '#fdecec' : hot ? '#fdf6ea' : '#f6f6f7' }}>
            <span className="h-[26px] w-[26px] shrink-0 rounded-[9px] border-2" style={{ borderColor: x.status === 'overdue' ? RED : hot ? '#d9a441' : '#c9cacf' }} />
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{x.title}</span><span className="block text-[13px]" style={{ color: x.status === 'overdue' ? RED : hot ? AMBER : MUTED }}>{x.sub}</span></span>
          </button>; })}</div></>}
      {!!work?.done.length && <><p className="pt-1 text-[15px] font-bold">Done lately</p>
        <div className="space-y-1">{work.done.slice(0, 8).map((x) => <div key={x.key} className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px]" style={{ background: accent }}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>
          <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: '#55585e' }}>{x.title}</span><span className="text-[12px]" style={{ color: '#9a9ca1' }}>{when(x.at)}</span></div>)}</div></>}
      {work && !work.total && !loading && <p className="rounded-[18px] p-4 text-[14.5px]" style={{ background: '#f6f6f7', color: MUTED }}>When a manager gives you a task, an SOP to sign or a checklist turn, it shows here.</p>}
      <p className="text-[12.5px]" style={{ color: INK, opacity: 0.55 }}>Finished things stay here for 30 days.</p>
    </div>);
}
