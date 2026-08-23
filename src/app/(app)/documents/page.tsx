'use client';

import React, { useMemo, useState } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import { useFirebase, useUser, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection, doc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Loader, FileText, ChevronDown, Plus, CheckCircle2, AlertTriangle, Lightbulb, Square } from 'lucide-react';
import { resolveActiveStaffId } from '@/lib/staff-identity';

const CATEGORIES = [
  ['sop', 'SOP'],
  ['handbook', 'Handbook'],
  ['policy', 'Policy'],
  ['other', 'Other'],
] as const;

const MAX_SECTIONS = 20;

const SECTION_TYPES = [
  ['text', 'Text'],
  ['step', 'Step'],
  ['checklist', 'Checklist'],
  ['warning', 'Warning'],
  ['tip', 'Tip'],
] as const;

const SECTION_PLACEHOLDER: Record<string, { heading: string; body: string }> = {
  text: { heading: 'Section heading', body: 'Write the rules or guidance for this section' },
  step: { heading: 'What this step does (e.g. Disinfect the station)', body: 'Exactly how to do it, and what done-right looks like' },
  checklist: { heading: 'Checklist name (e.g. Before unlocking)', body: 'One item per line — each line becomes a checkbox' },
  warning: { heading: 'Warning title (optional)', body: 'What can go wrong and what to never do' },
  tip: { heading: 'Tip title (optional)', body: 'The shortcut or judgment call experienced people know' },
};

const SectionRenderer = ({ sec, stepNumber }: { sec: any; stepNumber: number | null }) => {
  const type = sec.type || 'text';
  if (type === 'step') {
    return (
      <div className="rounded-2xl border-2 border-l-8 border-l-slate-900 p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Step {stepNumber}</p>
        {sec.heading && <p className="mt-0.5 text-[13px] font-black tracking-tight text-slate-900">{sec.heading}</p>}
        {sec.body && <p className="mt-1 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-700">{sec.body}</p>}
      </div>
    );
  }
  if (type === 'checklist') {
    const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
    return (
      <div className="rounded-2xl border-2 p-3">
        {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-slate-900">{sec.heading}</p>}
        <div className="mt-1.5 space-y-1.5">
          {items.map((item: string, i: number) => (
            <div key={i} className="flex items-start gap-2">
              <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <p className="text-[13px] font-bold leading-relaxed text-slate-700">{item}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (type === 'warning') {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-amber-900">{sec.heading}</p>}
            {sec.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-amber-900">{sec.body}</p>}
          </div>
        </div>
      </div>
    );
  }
  if (type === 'tip') {
    return (
      <div className="rounded-2xl border-2 border-dashed bg-slate-50 p-3">
        <div className="flex items-start gap-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <div>
            {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-slate-700">{sec.heading}</p>}
            {sec.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-600">{sec.body}</p>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      {sec.heading && <p className="text-[12px] font-black uppercase tracking-widest text-slate-900">{sec.heading}</p>}
      {sec.body && <p className="mt-1 whitespace-pre-wrap text-[13px] font-bold leading-relaxed text-slate-700">{sec.body}</p>}
    </div>
  );
};

const TEMPLATES: Array<{ key: string; title: string; category: string; blurb: string; sections: Array<{ heading: string; body: string; type?: string }> }> = [
  {
    key: 'opening',
    title: 'Opening checklist',
    category: 'sop',
    blurb: 'Start-of-day routine so any team member can open alone.',
    sections: [
      { type: 'checklist', heading: 'Before unlocking', body: 'Arrive 15 minutes before open\nCheck the exterior — signage on, entry clear and safe\nDisarm the alarm\nTurn on lights' },
      { type: 'checklist', heading: 'Set up the space', body: 'Turn on all equipment and let it reach working temperature\nWipe down stations and shared surfaces\nRestock anything below par level\nNote shortages for the manager' },
      { type: 'checklist', heading: 'Systems check', body: 'Open the point of sale and count the float\nReview today\u2019s schedule for special notes\nConfirm the booking page and phone line are live' },
      { type: 'step', heading: 'Ready to open', body: 'Unlock the door at the posted time. First impression standard: music on, space tidy, team ready to greet.' },
    ],
  },
  {
    key: 'closing',
    title: 'Closing checklist',
    category: 'sop',
    blurb: 'End-of-day shutdown that protects cash, equipment, and tomorrow.',
    sections: [
      { type: 'step', heading: 'Last client through', body: 'No new walk-ins after the posted cutoff. Finish every client with the full standard — closing time never shortens service quality.' },
      { type: 'checklist', heading: 'Clean and reset', body: 'Sanitize all stations and tools per the sanitation standard\nEmpty bins\nReset each station so tomorrow starts clean' },
      { type: 'step', heading: 'Cash and records', body: 'Count the drawer with a second person when possible. Record totals. Prepare the deposit and secure it as trained.' },
      { type: 'checklist', heading: 'Lock up', body: 'Equipment off, lights off, thermostat set\nArm the alarm\nConfirm the door is locked behind you\nReport anything unusual to the manager tonight, not tomorrow' },
    ],
  },
  {
    key: 'handbook',
    title: 'Employee handbook starter',
    category: 'handbook',
    blurb: 'A humane starter handbook — edit every section to sound like you.',
    sections: [
      { heading: 'Welcome', body: 'Welcome to the team. This handbook explains how we work, what you can expect from us, and what we ask of you. When in doubt, ask — questions are always welcome here.' },
      { heading: 'Schedules & time off', body: 'Schedules post in advance. Swaps need manager approval. Request time off as early as you can; we\u2019ll always try to make it work.' },
      { heading: 'Conduct & respect', body: 'We treat clients and each other with respect, full stop. Harassment or discrimination of any kind is not tolerated and should be reported to the owner immediately.' },
      { heading: 'Phones & appearance', body: 'Personal phones stay off the floor during service. Follow the posted appearance standard for your role.' },
      { heading: 'Acknowledgment', body: 'Read this handbook fully, then mark it read and understood below. Your confirmation is recorded with the version you read.' },
    ],
  },
  {
    key: 'complaint',
    title: 'Client complaint policy',
    category: 'policy',
    blurb: 'How complaints get handled the same way every time.',
    sections: [
      { type: 'step', heading: 'First response', body: 'Listen fully without interrupting. Thank them for telling us. Never argue in front of other clients — move the conversation somewhere calm.' },
      { type: 'step', heading: 'What you can offer', body: 'Team members may offer a redo of the service. Anything involving a refund or beyond goes to a manager — say: \u201cI want to make this right, let me get my manager.\u201d' },
      { type: 'step', heading: 'Escalation', body: 'Manager decides refund or resolution and records what happened and what was offered in the client\u2019s notes the same day.' },
      { type: 'warning', heading: 'Safety incidents', body: 'If the complaint involves safety or a reaction, follow the incident procedure and notify the owner immediately.' },
    ],
  },
];

const safeDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const categoryLabel = (c: string) => CATEGORIES.find(x => x[0] === c)?.[1] || 'Other';

const DocumentReadView = ({ docItem, myAck, onAck }: { docItem: any; myAck: any; onAck: () => void }) => {
  const [open, setOpen] = useState(false);
  const version = docItem.version || 1;
  const ackCurrent = myAck && Number(myAck.version) === Number(version);
  const ackStale = myAck && Number(myAck.version) < Number(version);
  return (
    <Card className={cn('rounded-[2rem] border-2 bg-white overflow-hidden', ackStale && 'border-amber-300')}>
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-black tracking-tight text-slate-900">{docItem.title}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {categoryLabel(docItem.category)} · v{version}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {ackCurrent && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Read and understood" />}
            {ackStale && <span className="rounded-lg border-2 border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-900">Updated</span>}
            {!myAck && <span className="rounded-lg border-2 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-700">To read</span>}
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </div>
        </button>
        {open && (
          <div className="space-y-4 border-t-2 border-dashed pt-3">
            {ackStale && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <p className="text-[11px] font-bold text-amber-900">This document changed since you last read it (you read v{myAck.version}, this is v{version}). Please read it again and confirm below.</p>
              </div>
            )}
            {(() => { let n = 0; return (docItem.sections || []).map((sec: any) => {
              const stepNumber = (sec.type === 'step') ? ++n : null;
              return <SectionRenderer key={sec.id} sec={sec} stepNumber={stepNumber} />;
            }); })()}
            {ackCurrent ? (
              <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-900">
                  Read &amp; understood{myAck.acknowledgedAt && safeDate(myAck.acknowledgedAt) ? ` · ${format(safeDate(myAck.acknowledgedAt) as Date, 'MMM d, yyyy')}` : ''}
                </p>
              </div>
            ) : (
              <Button type="button" onClick={onAck} className="h-12 w-full rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> I&apos;ve read and understood this
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const DocumentEditor = ({ docItem, staff, onSave, onPublish, onDelete, onClose }: { docItem: any; staff: any[]; onSave: (d: any) => void; onPublish: (d: any) => void; onDelete: () => void; onClose: () => void }) => {
  const [title, setTitle] = useState(docItem.title || '');
  const [category, setCategory] = useState(docItem.category || 'sop');
  const [sections, setSections] = useState<any[]>(docItem.sections?.length ? docItem.sections : [{ id: nanoid(), heading: '', body: '' }]);
  const [assignedRoles, setAssignedRoles] = useState<string[]>(docItem.assignedRoles || ['all']);
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>(docItem.assignedStaffIds || []);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patchSection = (id: string, patch: any) =>
    setSections(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
  const moveSection = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    setSections(prev => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleRole = (r: string) => {
    if (r === 'all') { setAssignedRoles(['all']); return; }
    setAssignedRoles(prev => {
      const base = prev.filter(x => x !== 'all');
      return base.includes(r) ? base.filter(x => x !== r) : [...base, r];
    });
  };

  const collect = () => {
    const cleanTitle = title.trim().slice(0, 140);
    if (!cleanTitle) { setErr('Give the document a title.'); return null; }
    const cleanSections = sections
      .map(x => {
        const body = String(x.body || '').trim().slice(0, 8000);
        const lineCount = body.split('\n').map(l => l.trim()).filter(Boolean).length;
        const photoLines = (x.type === 'checklist' && Array.isArray(x.photoLines))
          ? x.photoLines.filter((n: number) => Number.isInteger(n) && n >= 0 && n < lineCount)
          : [];
        return { id: x.id, type: x.type || 'text', heading: String(x.heading || '').trim().slice(0, 140), body, photoLines };
      })
      .filter(x => x.heading || x.body);
    if (cleanSections.length === 0) { setErr('Add at least one section with content.'); return null; }
    setErr('');
    return { title: cleanTitle, category, sections: cleanSections, assignedRoles, assignedStaffIds };
  };

  return (
    <div className="space-y-3 border-t-2 border-dashed pt-3">
      <div className="space-y-1.5">
        <label htmlFor={`doc-title-${docItem.id}`} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Title</label>
        <Input id={`doc-title-${docItem.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Opening checklist, Employee handbook" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={category === v} onClick={() => setCategory(v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', category === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sections</p>
        {sections.map((sec, i) => {
          const secType = sec.type || 'text';
          const ph = SECTION_PLACEHOLDER[secType] || SECTION_PLACEHOLDER.text;
          return (
          <div key={sec.id} className="space-y-2 rounded-2xl border-2 p-3">
            <div className="flex flex-wrap gap-1.5">
              {SECTION_TYPES.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={secType === v} onClick={() => patchSection(sec.id, { type: v })} className={cn('h-8 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', secType === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={`sec-h-${sec.id}`} className="sr-only">Section heading</label>
              <Input id={`sec-h-${sec.id}`} value={sec.heading} onChange={e => patchSection(sec.id, { heading: e.target.value })} maxLength={140} placeholder={ph.heading} className="h-10 flex-1 rounded-xl border-2 bg-white font-bold text-sm" />
              <Button type="button" variant="outline" aria-label="Move section up" disabled={i === 0} onClick={() => moveSection(i, -1)} className="h-10 w-10 rounded-lg border-2 p-0 text-xs font-black">↑</Button>
              <Button type="button" variant="outline" aria-label="Move section down" disabled={i === sections.length - 1} onClick={() => moveSection(i, 1)} className="h-10 w-10 rounded-lg border-2 p-0 text-xs font-black">↓</Button>
              {sections.length > 1 && (
                <Button type="button" variant="outline" aria-label="Remove section" onClick={() => setSections(prev => prev.filter(x => x.id !== sec.id))} className="h-10 w-10 rounded-lg border-2 p-0 text-xs font-black text-destructive border-destructive/30">✕</Button>
              )}
            </div>
            <label htmlFor={`sec-b-${sec.id}`} className="sr-only">Section content</label>
            <textarea id={`sec-b-${sec.id}`} value={sec.body} onChange={e => patchSection(sec.id, { body: e.target.value })} maxLength={8000} rows={secType === 'checklist' ? 5 : 4} placeholder={ph.body} className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm" />
            {secType === 'checklist' && String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean).length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">📷 Require a photo for…</p>
                <div className="flex flex-wrap gap-1.5">
                  {String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean).map((line: string, i: number) => {
                    const on = Array.isArray(sec.photoLines) && sec.photoLines.includes(i);
                    return (
                      <button key={i} type="button" aria-pressed={on} onClick={() => {
                        const cur = Array.isArray(sec.photoLines) ? sec.photoLines : [];
                        patchSection(sec.id, { photoLines: on ? cur.filter((x: number) => x !== i) : [...cur, i] });
                      }} className={cn('h-9 max-w-[220px] truncate rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                        {on ? '📷 ' : ''}{line.slice(0, 26)}{line.length > 26 ? '…' : ''}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] font-bold text-muted-foreground">Tapped items can&apos;t be checked off in the portal without taking a photo.</p>
              </div>
            )}
          </div>
          );
        })}
        {sections.length < MAX_SECTIONS && (
          <Button type="button" variant="outline" onClick={() => setSections(prev => [...prev, { id: nanoid(), heading: '', body: '' }])} className="h-11 w-full rounded-xl border-2 border-dashed text-[11px] font-black uppercase tracking-widest">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add section
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who is this for?</p>
        <div className="flex flex-wrap gap-1.5">
          {[['all', 'Everyone'], ['staff', 'Team members'], ['admin', 'Admins']].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={assignedRoles.includes(v)} onClick={() => toggleRole(v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', assignedRoles.includes(v) ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
              {l}
            </button>
          ))}
        </div>
        {staff.length > 0 && (
          <>
            <p className="pt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Or specific people</p>
            <div className="flex flex-wrap gap-1.5">
              {staff.filter((m: any) => !m.archived).map((m: any) => {
                const on = assignedStaffIds.includes(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={on} onClick={() => setAssignedStaffIds(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                    {m.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onClose} className="h-12 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Close</Button>
        <Button type="button" onClick={() => { const d = collect(); if (d) onSave(d); }} className="h-12 flex-1 rounded-xl border-2 bg-white text-[11px] font-black uppercase tracking-widest text-slate-900" variant="outline">Save draft</Button>
        <Button type="button" onClick={() => { const d = collect(); if (d) onPublish(d); }} className="h-12 flex-[1.4] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">Publish</Button>
      </div>
      <button
        type="button"
        onClick={() => { if (confirmDelete) { onDelete(); } else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); } }}
        className={cn('h-10 w-full rounded-xl border-2 text-[10px] font-black uppercase tracking-widest', confirmDelete ? 'border-destructive bg-destructive/10 text-destructive' : 'border-destructive/30 text-destructive')}
      >
        {confirmDelete ? 'Tap again to delete this document' : 'Delete document'}
      </button>
    </div>
  );
};

const TasksCard = ({ tenantId, staff, actorName }: { tenantId: string; staff: any[]; actorName: string }) => {
  const { firestore } = useFirebase();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [err, setErr] = useState('');

  const tasksQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/tasks`) : null,
    [firestore, tenantId]
  );
  const { data: tasks } = useCollection(tasksQ);
  const openTasks = useMemo(() => ((tasks || []) as any[]).filter(t => t.status !== 'done').sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))), [tasks]);
  const doneTasks = useMemo(() => ((tasks || []) as any[]).filter(t => t.status === 'done').sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || ''))).slice(0, 8), [tasks]);
  const activeStaff = staff.filter((m: any) => !m.archived);
  const nameOf = (id: string) => activeStaff.find((m: any) => m.id === id)?.name || 'Team member';

  const createTask = () => {
    const t = title.trim().slice(0, 140);
    if (!t) { setErr('Give the task a name.'); return; }
    if (assignees.length === 0) { setErr('Pick at least one person.'); return; }
    setErr('');
    const id = nanoid();
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/tasks/${id}`), {
      id,
      title: t,
      notes: notes.trim().slice(0, 2000),
      assignedStaffIds: assignees,
      dueDate: dueDate || '',
      requirePhoto,
      status: 'open',
      createdAt: new Date().toISOString(),
      createdBy: actorName,
    }, { merge: false });
    for (const staffId of assignees) {
      const nId = nanoid();
      setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/notifications/${nId}`), {
        id: nId, userId: staffId, read: false, createdAt: new Date().toISOString(),
        type: 'task', link: 'today', message: `New task: ${t}${dueDate ? ` — due ${dueDate}` : ''}`,
      }, { merge: false });
    }
    setCreating(false);
    setTitle(''); setNotes(''); setAssignees([]); setDueDate(''); setRequirePhoto(false);
  };

  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">One-off tasks</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
              {openTasks.length > 0 ? `${openTasks.length} open` : 'Assign a to-do that isn\u2019t an SOP'}
            </p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            {openTasks.map((t: any) => (
              <div key={t.id} className="rounded-2xl border-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-black tracking-tight text-slate-900">{t.title}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {(t.assignedStaffIds || []).map(nameOf).join(', ')}{t.dueDate ? ` · due ${t.dueDate}` : ''}{t.requirePhoto ? ' · 📷' : ''}
                    </p>
                  </div>
                  <Button type="button" variant="outline" aria-label={`Remove task ${t.title}`} onClick={() => deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/tasks/${t.id}`))} className="h-9 shrink-0 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive border-destructive/30">✕</Button>
                </div>
                {t.notes && <p className="mt-1 text-[12px] font-bold text-slate-600">{t.notes}</p>}
              </div>
            ))}

            {doneTasks.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recently done</p>
                <div className="mt-1 space-y-1.5">
                  {doneTasks.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-dashed bg-slate-50/60 px-3 py-2">
                      <p className="min-w-0 text-[12px] font-bold text-slate-700">✓ {t.title} · {t.completedByName || 'Team member'}{t.completedAt && safeDate(t.completedAt) ? ` · ${format(safeDate(t.completedAt) as Date, 'MMM d, h:mm a')}` : ''}</p>
                      {t.photoUrl && (
                        <a href={t.photoUrl} target="_blank" rel="noreferrer">
                          <img src={t.photoUrl} alt={`Evidence: ${t.title}`} className="h-9 w-9 shrink-0 rounded-lg border-2 object-cover" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {creating ? (
              <div className="space-y-2 rounded-2xl border-2 p-3">
                <label htmlFor="task-title" className="sr-only">Task name</label>
                <Input id="task-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Deep-clean the front window" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
                <label htmlFor="task-notes" className="sr-only">Notes</label>
                <textarea id="task-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Details (optional)" className="w-full rounded-xl border-2 bg-white p-3 font-bold text-sm" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeStaff.map((m: any) => {
                    const on = assignees.includes(m.id);
                    return (
                      <button key={m.id} type="button" aria-pressed={on} onClick={() => setAssignees(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="task-due" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Due</label>
                  <input id="task-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-10 rounded-xl border-2 bg-white px-3 text-[12px] font-bold" />
                  <button type="button" aria-pressed={requirePhoto} onClick={() => setRequirePhoto(v => !v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', requirePhoto ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                    📷 {requirePhoto ? 'Photo required' : 'No photo needed'}
                  </button>
                </div>
                {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreating(false)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
                  <Button type="button" onClick={createTask} className="h-11 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">Assign task</Button>
                </div>
                <p className="text-[11px] font-bold text-muted-foreground">Assignees get a ping in their portal inbox.</p>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setCreating(true)} className="h-11 w-full rounded-xl border-2 border-dashed text-[11px] font-black uppercase tracking-widest">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New task
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const DocumentCardWithAcks = ({ d, tenantId, canManage, myStaffId, actorName, staff, expandedId, setExpandedId, onSave, onDelete }: any) => {
  const { firestore } = useFirebase();
  const acksQuery = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/documents/${d.id}/acks`) : null,
    [firestore, tenantId, d.id]
  );
  const { data: acks } = useCollection(acksQuery);
  const ackList = (acks || []) as any[];
  const runsQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/documents/${d.id}/runs`) : null,
    [firestore, tenantId, d.id, canManage]
  );
  const { data: runs } = useCollection(runsQuery);
  const recentRuns = useMemo(
    () => ([...((runs || []) as any[])]).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 6),
    [runs]
  );
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const openRun = recentRuns.find((r: any) => r.id === openRunId) || null;
  const hasChecklists = (d.sections || []).some((x: any) => x.type === 'checklist');
  const myAck = ackList.find((a: any) => a.id === myStaffId) || null;

  const handleAck = () => {
    if (!tenantId || !myStaffId) return;
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${d.id}/acks/${myStaffId}`), {
      id: myStaffId,
      staffId: myStaffId,
      staffName: actorName,
      version: d.version || 1,
      acknowledgedAt: new Date().toISOString(),
    }, { merge: true });
  };

  if (!canManage) {
    return <DocumentReadView docItem={d} myAck={myAck} onAck={handleAck} />;
  }

  const version = d.version || 1;
  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setExpandedId(expandedId === d.id ? null : d.id)} aria-expanded={expandedId === d.id} className="flex w-full items-start justify-between gap-3 text-left">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-black tracking-tight text-slate-900">{d.title || 'Untitled document'}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {categoryLabel(d.category)} · v{version} · {(d.sections || []).length} section{(d.sections || []).length === 1 ? '' : 's'}
              {d.status === 'published' ? ` · read by ${ackList.filter((a: any) => Number(a.version) === Number(version)).length}` : ''}
              {d.updatedAt && safeDate(d.updatedAt) ? ` · ${format(safeDate(d.updatedAt) as Date, 'MMM d')}` : ''}
            </p>
          </div>
          <span className={cn('shrink-0 rounded-lg border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', d.status === 'published' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-amber-100 text-amber-900 border-amber-300')}>
            {d.status === 'published' ? 'Published' : 'Draft'}
          </span>
        </button>
        {expandedId === d.id && (
          <>
            {d.status === 'published' && (() => {
              const activeStaff = (staff || []).filter((m: any) => !m.archived);
              const assignedTo = activeStaff.filter((m: any) => {
                const roles = d.assignedRoles || [];
                if (roles.includes('all')) return true;
                if (m.role && roles.includes(m.role)) return true;
                return (d.assignedStaffIds || []).includes(m.id);
              });
              const currentIds = new Set(ackList.filter((a: any) => Number(a.version) === Number(version)).map((a: any) => a.id));
              const missing = assignedTo.filter((m: any) => !currentIds.has(m.id));
              return (
                <div className="rounded-2xl border-2 border-dashed bg-slate-50/60 p-3 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Read &amp; understood — {currentIds.size} of {assignedTo.length} assigned
                  </p>
                  {ackList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {ackList.map((a: any) => {
                        const current = Number(a.version) === Number(version);
                        return (
                          <span key={a.id} className={cn('rounded-lg border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', current ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-amber-50 text-amber-900 border-amber-300')}>
                            {a.staffName || 'Team member'}{current ? '' : ` · read v${a.version}`}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {missing.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Still to read</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {missing.map((m: any) => (
                          <span key={m.id} className="rounded-lg border-2 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500">{m.name}</span>
                        ))}
                      </div>
                    </div>
                  ) : assignedTo.length > 0 ? (
                    <p className="text-[11px] font-bold text-emerald-700">Everyone assigned has read the current version.</p>
                  ) : null}
                </div>
              );
            })()}
            {hasChecklists && d.status === 'published' && (
              <div className="rounded-2xl border-2 border-dashed bg-slate-50/60 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recent checklist runs</p>
                {recentRuns.length === 0 ? (
                  <p className="mt-1 text-[12px] font-bold text-muted-foreground">No runs yet — the team ticks these off from their portal&apos;s Documents tab.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recentRuns.map((r: any) => {
                      const full = r.totalItems > 0 && Number(r.checkedCount) >= Number(r.totalItems);
                      return (
                        <button key={r.id} type="button" aria-pressed={openRunId === r.id} onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)} className={cn('rounded-lg border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', full ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-amber-50 text-amber-900 border-amber-300', openRunId === r.id && 'ring-2 ring-slate-900')}>
                          {r.staffName || 'Team member'} · {r.date ? format(safeDate(r.date) as Date, 'MMM d') : ''} · {r.checkedCount}/{r.totalItems}{full ? ' ✓' : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
                {openRun && (
                  <div className="space-y-1.5 rounded-xl border-2 bg-white p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">
                      {openRun.staffName} · {openRun.date ? format(safeDate(openRun.date) as Date, 'EEEE, MMM d') : ''}
                      {openRun.completedAt ? ` · finished ${format(safeDate(openRun.completedAt) as Date, 'h:mm a')}` : ' · not finished'}
                    </p>
                    {(d.sections || []).filter((sec: any) => sec.type === 'checklist').map((sec: any) => {
                      const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
                      return (
                        <div key={sec.id}>
                          {sec.heading && <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{sec.heading}</p>}
                          {items.map((item: string, i: number) => {
                            const key = `${sec.id}:${i}`;
                            const on = !!(openRun.items || {})[key];
                            const photo = (openRun.photos || {})[key];
                            return (
                              <div key={i} className="flex items-center justify-between gap-2 py-1">
                                <p className={cn('min-w-0 flex-1 text-[12px] font-bold', on ? 'text-slate-800' : 'text-slate-400 line-through decoration-transparent')}>
                                  {on ? '✓' : '·'} {item}
                                </p>
                                {photo && (
                                  <a href={photo} target="_blank" rel="noreferrer">
                                    <img src={photo} alt={`Evidence: ${item}`} className="h-12 w-12 shrink-0 rounded-lg border-2 object-cover" />
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <DocumentEditor
              docItem={d}
              staff={staff}
              onSave={(data: any) => onSave(d.id, data, false)}
              onPublish={(data: any) => onSave(d.id, data, true)}
              onDelete={onDelete}
              onClose={() => setExpandedId(null)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default function DocumentsPage() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant, role } = useTenant();
  const tenantId = selectedTenant?.id;
  const canManage = role === 'owner' || role === 'admin';
  const actorName = currentUser?.displayName || currentUser?.email || 'A manager';
  const myStaffId = resolveActiveStaffId(currentUser?.uid) || '';

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const documentsQuery = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/documents`) : null,
    [firestore, tenantId]
  );
  const { data: documents, isLoading } = useCollection(documentsQuery);

  const staffQuery = useMemoFirebase(
    () => (tenantId && canManage) ? collection(firestore, `tenants/${tenantId}/staff`) : null,
    [firestore, tenantId, canManage]
  );
  const { data: staff } = useCollection(staffQuery);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = ((documents || []) as any[]);
    if (!canManage) {
      list = list.filter(d => d.status === 'published' && (
        (d.assignedRoles || []).includes('all') ||
        (role && (d.assignedRoles || []).includes(role)) ||
        (myStaffId && (d.assignedStaffIds || []).includes(myStaffId))
      ));
    }
    if (needle) list = list.filter(d => `${d.title || ''} ${d.category || ''}`.toLowerCase().includes(needle));
    return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }, [documents, canManage, role, myStaffId, q]);

  const handleCreate = (tpl?: typeof TEMPLATES[number]) => {
    if (!tenantId) return;
    const id = nanoid();
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${id}`), {
      id,
      title: tpl ? tpl.title : '',
      category: tpl ? tpl.category : 'sop',
      sections: tpl ? tpl.sections.map(x => ({ id: nanoid(), heading: x.heading, body: x.body })) : [],
      assignedRoles: ['all'],
      assignedStaffIds: [],
      status: 'draft',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    }, { merge: false });
    setExpandedId(id);
  };

  const handleSave = (id: string, data: any, publish: boolean) => {
    if (!tenantId) return;
    const existing = ((documents || []) as any[]).find(d => d.id === id);
    const bumping = publish && existing?.status === 'published';
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${id}`), {
      ...data,
      status: publish ? 'published' : (existing?.status || 'draft'),
      version: bumping ? (existing?.version || 1) + 1 : (existing?.version || 1),
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    });
    if (publish) setExpandedId(null);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50">
      <AppHeader title="Documents" />
      <main className="flex-1 space-y-6 p-4 md:p-8 mx-auto w-full max-w-3xl">
        {canManage && (
          <Card className="rounded-[2rem] border-2 bg-slate-950 text-white overflow-hidden">
            <CardContent className="p-5 space-y-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Your operating library</p>
                <p className="mt-1 text-[13px] font-bold text-slate-200">SOPs, handbooks, and policies — written once, assigned to roles or people, versioned when they change.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => handleCreate()} className="h-11 rounded-xl bg-white px-4 text-[11px] font-black uppercase tracking-widest text-slate-900 hover:bg-slate-200">
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Blank document
                </Button>
                <Button onClick={() => setTemplatesOpen(v => !v)} variant="outline" className="h-11 rounded-xl border-2 border-white/30 bg-transparent px-4 text-[11px] font-black uppercase tracking-widest text-white hover:bg-white/10">
                  Start from a template
                </Button>
              </div>
              {templatesOpen && (
                <div className="space-y-2 border-t-2 border-dashed border-white/20 pt-3">
                  {TEMPLATES.map(t => (
                    <button key={t.key} type="button" onClick={() => { handleCreate(t); setTemplatesOpen(false); }} className="w-full rounded-2xl border-2 border-white/20 bg-white/5 p-3 text-left hover:bg-white/10">
                      <p className="text-[13px] font-black tracking-tight text-white">{t.title}</p>
                      <p className="text-[11px] font-bold text-slate-400">{categoryLabel(t.category)} · {t.sections.length} sections — {t.blurb}</p>
                    </button>
                  ))}
                  <p className="text-[11px] font-bold text-slate-400">Templates land as drafts — edit every line to match how your business actually runs, then publish.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {canManage && (
          <TasksCard tenantId={tenantId || ''} staff={(staff || []) as any[]} actorName={actorName} />
        )}

        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search documents"
          placeholder="Search by title or type"
          className="h-12 rounded-2xl border-2 bg-white px-4 font-bold text-sm"
        />

        {isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader className="h-7 w-7 animate-spin text-slate-900" aria-label="Loading documents" />
          </div>
        ) : visible.length > 0 ? (
          <div className="space-y-4">
            {visible.map((d: any) => (
              <DocumentCardWithAcks
                key={d.id}
                d={d}
                tenantId={tenantId}
                canManage={canManage}
                myStaffId={myStaffId}
                actorName={actorName}
                staff={(staff || []) as any[]}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                onSave={handleSave}
                onDelete={() => { if (tenantId) { deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${d.id}`)); setExpandedId(null); } }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[2rem] border-2 border-dashed bg-white/60 py-14 text-center">
            <FileText className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm font-black uppercase tracking-widest text-slate-900">
              {canManage ? 'No documents yet' : 'Nothing assigned to you yet'}
            </p>
            <p className="mt-1 text-[12px] font-bold text-muted-foreground">
              {canManage ? 'Start with your opening checklist or the employee handbook.' : 'When your manager publishes a handbook or SOP for your role, it shows up here.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
