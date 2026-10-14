'use client';
// src/components/staff/TrainingTasksPanel.tsx — STAFF PROFILE → TRAINING & TASKS (main app; lib/my-work): SOPs signed,
// anything overdue, tasks this month and checklists run, what they're certified for (CertifiedFor), then every SOP, task and checklist turn with its status. The
// buttons go to Documents, where SOPs are assigned (with a sign-by date) and tasks are given.
import * as React from 'react';
import { useMyWork } from '@/components/team/useMyWork';
import { CertifiedFor } from '@/components/documents/CertifiedFor';
import type { WorkItem, MyWork as MyWorkData } from '@/lib/my-work';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', RED = '#b42318', AMBER = '#9a5b00', GREEN = '#1f7a4d';
const nice = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const kind = (x: WorkItem) => (x.kind === 'sop' ? 'SOP' : x.kind === 'task' ? 'Task' : 'Checklist');
function Pill({ x }: { x: WorkItem }) {
  const s = x.status === 'overdue' ? { bg: '#fde8e8', fg: RED, t: 'Overdue' } : x.status === 'due' ? { bg: '#fdf1dc', fg: AMBER, t: x.kind === 'checklist' ? 'Their turn' : 'Due today' } : x.status === 'open' ? { bg: '#f3f3f5', fg: MUTED, t: 'Open' }
    : { bg: '#e9f3ed', fg: GREEN, t: x.kind === 'sop' ? `Signed ${x.at ? new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}` : `Done ${x.at ? new Date(x.at.length === 10 ? `${x.at}T12:00:00` : x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}` };
  return <span className="inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.t.trim()}</span>;
}

export function TrainingTasksPanel({ firestore, tenantId, staff, today, preview }: { firestore: any; tenantId: string; staff: { id: string; role?: string; name?: string }; today: string; preview?: MyWorkData }) {
  const loaded = useMyWork(preview ? null : firestore, tenantId, staff, today); const work = preview || loaded.work; const loading = !preview && loaded.loading;
  if (loading && !work) return <p className="p-2 text-[14px]" style={{ color: MUTED }}>Loading…</p>;
  if (!work) return null;
  const rows = [...work.todo, ...work.done].map((x) => ({ ...x, title: x.title.replace(/^(Read|Signed): /, '') }));
  const tile = (label: string, value: React.ReactNode, color = INK) => <div className="rounded-[18px] border bg-card p-3.5" style={{ borderColor: LINE }}><p className="text-[13px]" style={{ color: MUTED }}>{label}</p><p className="text-[24px] font-extrabold tabular-nums" style={{ color }}>{value}</p></div>;
  return (
    <div className="space-y-4 text-left" style={{ color: INK }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[18px] font-extrabold">Training &amp; tasks</h3>
        <div className="flex flex-wrap gap-2">
          <a href="/documents" className="inline-flex h-10 items-center rounded-full border bg-card px-4 text-[14px] font-semibold" style={{ borderColor: 'hsl(var(--border))' }}>Assign an SOP</a>
          <a href={`/documents?tab=tasks&assign=${encodeURIComponent(staff.id)}`} className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-bold text-background" style={{ background: INK }}>Give a task</a>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile('SOPs signed', `${work.sopsSigned} / ${work.sopsTotal}`)}{tile('Overdue', work.overdue, work.overdue ? RED : INK)}{tile('Tasks this month', work.tasksThisMonth)}{tile('Checklists run', work.checklistsRun)}
      </div>
      {!preview && <CertifiedFor tenantId={tenantId} staffId={staff.id} manageHref="/documents?tab=certification" />}
      {!rows.length ? <p className="rounded-[18px] border p-4 text-[14px]" style={{ borderColor: LINE, color: MUTED }}>Nothing given to {String(staff.name || 'them').split(' ')[0]} yet.</p> :
        <div className="overflow-hidden rounded-[18px] border" style={{ borderColor: LINE }}>
          <div className="hidden grid-cols-[1.6fr_0.8fr_1fr_0.9fr] bg-secondary px-4 py-2.5 text-[12px] font-bold md:grid" style={{ color: MUTED }}><span>SOP / task</span><span>Kind</span><span>Due</span><span>Status</span></div>
          {rows.map((x) => <div key={x.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t px-4 py-3 text-[14px] first:border-t-0 md:grid-cols-[1.6fr_0.8fr_1fr_0.9fr] md:first:border-t" style={{ borderColor: '#f0f0f2' }}>
            <span className="min-w-0 truncate font-semibold">{x.title}</span>
            <span className="hidden md:block">{kind(x)}</span>
            <span className="hidden md:block" style={{ color: x.status === 'overdue' ? RED : INK }}>{x.kind === 'checklist' && x.status !== 'done' ? 'Today' : nice(x.due)}</span>
            <span className="justify-self-end md:justify-self-start"><Pill x={x} /></span>
            <span className="col-span-2 text-[12.5px] md:hidden" style={{ color: MUTED }}>{kind(x)}{x.due ? ` · due ${nice(x.due)}` : ''}</span>
          </div>)}
        </div>}
      <p className="text-[12.5px]" style={{ color: MUTED }}>Finished items show for 30 days. SOPs count as signed only for their latest version.</p>
    </div>);
}
