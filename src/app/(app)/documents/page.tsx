'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
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
  {
    key: 'sanitation',
    title: 'Sanitation & disinfection SOP',
    category: 'sop',
    blurb: 'The non-negotiable hygiene standard, station by station.',
    sections: [
      { type: 'text', heading: 'Purpose', body: 'Protects every client and team member. This standard is not optional and is never shortened for time.' },
      { type: 'step', heading: 'Between every client', body: 'Remove all used items. Disinfect every touched surface with the approved product and let it sit for the full contact time on the label — wiping early is the same as not disinfecting.' },
      { type: 'checklist', heading: 'Tool processing', body: 'Wash tools with soap and warm water\nFully immerse in disinfectant for the labeled contact time\nDry on a clean towel — never a used one\nStore in the clean, closed container' },
      { type: 'warning', heading: 'Single-use means single-use', body: 'Files, buffers, and anything porous cannot be disinfected. One client, then the bin — in front of the client when possible.' },
      { type: 'tip', heading: 'Let clients see it', body: 'Sanitize visibly. Clients who watch the standard become clients who tell their friends about it.' },
    ],
  },
  {
    key: 'firstweek',
    title: 'New hire — first week guide',
    category: 'sop',
    blurb: 'Day-by-day ramp so nobody’s first week is guesswork.',
    sections: [
      { type: 'text', heading: 'Welcome', body: 'This week is for learning, not performing. Ask everything — the only bad question is the one you sat on.' },
      { type: 'checklist', heading: 'Day one', body: 'Tour the space — exits, supplies, break area\nMeet the team\nSet up your staff portal and PIN\nRead and confirm the employee handbook\nShadow a full shift' },
      { type: 'checklist', heading: 'By end of week', body: 'Read and confirm every assigned SOP\nComplete the opening checklist with a buddy\nComplete the closing checklist with a buddy\nKnow who to call when something breaks' },
      { type: 'tip', heading: 'For the trainer', body: 'Explain the why behind each step — people follow procedures they understand and improvise around ones they don’t.' },
    ],
  },
  {
    key: 'incident',
    title: 'Incident report policy',
    category: 'policy',
    blurb: 'What gets reported, by whom, and how fast.',
    sections: [
      { type: 'text', heading: 'What counts as an incident', body: 'Any injury to a client or team member, any adverse reaction to a product or service, any damage, theft, or safety hazard — and anything that made you think “should I report this?” The answer to that question is yes.' },
      { type: 'step', heading: 'Immediate response', body: 'Make the person and the area safe first. Care before paperwork, always.' },
      { type: 'step', heading: 'Report the same day', body: 'Tell the manager on duty before you leave. Write down what happened, when, who was involved, and what was done — plain facts, no blame.' },
      { type: 'warning', heading: 'Never', body: 'Never admit fault to a client on the business’s behalf, and never promise compensation — that decision belongs to the owner.' },
      { type: 'text', heading: 'After', body: 'The owner reviews every incident, decides follow-up, and updates procedures if the incident revealed a gap.' },
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

const RunsCollector = ({ tenantId, docItem, onRuns }: { tenantId: string; docItem: any; onRuns: (docId: string, runs: any[]) => void }) => {
  const { firestore } = useFirebase();
  const runsQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/documents/${docItem.id}/runs`) : null,
    [firestore, tenantId, docItem.id]
  );
  const { data } = useCollection(runsQ);
  useEffect(() => { onRuns(docItem.id, (data || []) as any[]); }, [data, docItem.id, onRuns]);
  return null;
};

const TASK_TEMPLATES = [
  { title: 'Deep-clean the front window & entry', notes: 'Glass, frame, door handles, and the welcome mat area.', requirePhoto: true },
  { title: 'Supply inventory count', notes: 'Count back-bar and retail. Note anything under par on the list.', requirePhoto: false },
  { title: 'Restock retail shelves', notes: 'Face all products forward; note gaps to reorder.', requirePhoto: true },
  { title: 'Wipe down break room', notes: 'Counters, microwave, fridge handles; toss expired items.', requirePhoto: false },
  { title: 'Call supplier about order', notes: 'Confirm delivery date and any backordered items; note the answer here after.', requirePhoto: false },
] as const;

const AcksCollector = ({ tenantId, docItem, onAcks }: { tenantId: string; docItem: any; onAcks: (docId: string, acks: any[]) => void }) => {
  const { firestore } = useFirebase();
  const acksQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/documents/${docItem.id}/acks`) : null,
    [firestore, tenantId, docItem.id]
  );
  const { data } = useCollection(acksQ);
  useEffect(() => { onAcks(docItem.id, (data || []) as any[]); }, [data, docItem.id, onAcks]);
  return null;
};

const AUDIT_FILTERS = [['all', 'Everything'], ['tasks', 'Tasks'], ['runs', 'Checklists'], ['rotations', 'Rotations'], ['acks', 'Sign-offs']] as const;

const AUDIT_KIND_META: Record<string, { dot: string; label: string }> = {
  tasks: { dot: 'bg-emerald-500', label: 'Task' },
  runs: { dot: 'bg-slate-900', label: 'Checklist' },
  rotations: { dot: 'bg-amber-500', label: 'Rotation' },
  acks: { dot: 'bg-sky-500', label: 'Sign-off' },
};

const AuditCard = ({ tenantId, staff }: { tenantId: string; staff: any[] }) => {
  const { firestore } = useFirebase();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [personId, setPersonId] = useState('');
  const [openRunKey, setOpenRunKey] = useState<string | null>(null);
  const [runsByDoc, setRunsByDoc] = useState<Record<string, any[]>>({});
  const [acksByDoc, setAcksByDoc] = useState<Record<string, any[]>>({});

  const tasksQ = useMemoFirebase(
    () => (tenantId && open) ? collection(firestore, `tenants/${tenantId}/tasks`) : null,
    [firestore, tenantId, open]
  );
  const { data: tasks } = useCollection(tasksQ);

  const rotationsQ = useMemoFirebase(
    () => (tenantId && open) ? collection(firestore, `tenants/${tenantId}/rotations`) : null,
    [firestore, tenantId, open]
  );
  const { data: rotations } = useCollection(rotationsQ);

  const documentsQ = useMemoFirebase(
    () => (tenantId && open) ? collection(firestore, `tenants/${tenantId}/documents`) : null,
    [firestore, tenantId, open]
  );
  const { data: allDocs } = useCollection(documentsQ);
  const checklistDocs = useMemo(
    () => ((allDocs || []) as any[]).filter(d => d.status === 'published' && (d.sections || []).some((x: any) => x.type === 'checklist')),
    [allDocs]
  );
  const docById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const d of ((allDocs || []) as any[])) m[d.id] = d;
    return m;
  }, [allDocs]);

  const onRuns = useCallback((docId: string, runs: any[]) => {
    setRunsByDoc(prev => ({ ...prev, [docId]: runs }));
  }, []);
  const onAcks = useCallback((docId: string, acks: any[]) => {
    setAcksByDoc(prev => ({ ...prev, [docId]: acks }));
  }, []);
  const publishedDocs = useMemo(
    () => ((allDocs || []) as any[]).filter(d => d.status === 'published'),
    [allDocs]
  );

  const entries = useMemo(() => {
    const out: Array<{ kind: string; ts: string; dayKey: string; staffId: string; payload: any }> = [];
    for (const t of ((tasks || []) as any[])) {
      if (t.status !== 'done' || !t.completedAt) continue;
      out.push({ kind: 'tasks', ts: String(t.completedAt), dayKey: String(t.completedAt).slice(0, 10), staffId: String(t.completedBy || ''), payload: t });
    }
    for (const [docId, runs] of Object.entries(runsByDoc)) {
      for (const r of (runs as any[])) {
        const ts = String(r.completedAt || r.startedAt || `${r.date}T12:00:00`);
        out.push({ kind: 'runs', ts, dayKey: String(r.date || ts.slice(0, 10)), staffId: String(r.staffId || ''), payload: { ...r, docId } });
      }
    }
    for (const r of ((rotations || []) as any[])) {
      for (const h of ((r.history || []) as any[])) {
        if (h.action !== 'done') continue;
        out.push({ kind: 'rotations', ts: `${h.date}T12:00:01`, dayKey: String(h.date || ''), staffId: String(h.staffId || ''), payload: { ...h, rotationTitle: r.title } });
      }
    }
    for (const [docId, acks] of Object.entries(acksByDoc)) {
      const dTitle = docById[docId]?.title || 'Document';
      for (const a of (acks as any[])) {
        if (!a.acknowledgedAt) continue;
        const ts = String(a.acknowledgedAt);
        out.push({ kind: 'acks', ts, dayKey: ts.slice(0, 10), staffId: String(a.id || ''), payload: { ...a, docTitle: dTitle } });
      }
    }
    return out
      .filter(e => filter === 'all' || e.kind === filter)
      .filter(e => !personId || e.staffId === personId)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 200);
  }, [tasks, runsByDoc, rotations, acksByDoc, docById, filter, personId]);

  const byDay = useMemo(() => {
    const m = new Map<string, typeof entries>();
    for (const e of entries) {
      if (!m.has(e.dayKey)) m.set(e.dayKey, [] as any);
      (m.get(e.dayKey) as any).push(e);
    }
    return [...m.entries()];
  }, [entries]);

  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Completed work — audit trail</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">Every finished task, checklist run, and rotation turn — with photos</p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="audit-print-area space-y-3 border-t-2 border-dashed pt-3">
            <style>{`
              @media print {
                body * { visibility: hidden !important; }
                .audit-print-area, .audit-print-area * { visibility: visible !important; }
                .audit-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; border: 0 !important; padding: 0 !important; }
                .audit-print-hide { display: none !important; }
                .audit-print-area * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              }
              @page { margin: 0.6in; }
            `}</style>
            <div className="audit-print-hide">
              <Button type="button" variant="outline" onClick={() => window.print()} className="h-10 w-full rounded-xl border-2 text-[10px] font-black uppercase tracking-widest">
                🖨 Print this timeline
              </Button>
            </div>
            <div className="hidden print:block">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Completed work — audit trail</p>
              <p className="text-[12px] font-bold text-slate-700">Printed {format(new Date(), 'EEEE, MMMM d, yyyy \u00b7 h:mm a')}{personId ? '' : ' \u00b7 whole team'}</p>
            </div>
            {checklistDocs.map((d: any) => (
              <RunsCollector key={d.id} tenantId={tenantId} docItem={d} onRuns={onRuns} />
            ))}
            {publishedDocs.map((d: any) => (
              <AcksCollector key={`a-${d.id}`} tenantId={tenantId} docItem={d} onAcks={onAcks} />
            ))}
            <div className="flex flex-wrap gap-1.5">
              {AUDIT_FILTERS.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', filter === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={personId === ''} onClick={() => setPersonId('')} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', personId === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                Whole team
              </button>
              {staff.filter((m: any) => !m.archived).map((m: any) => (
                <button key={m.id} type="button" aria-pressed={personId === m.id} onClick={() => setPersonId(personId === m.id ? '' : m.id)} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', personId === m.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                  {m.name}
                </button>
              ))}
            </div>

            {byDay.length === 0 ? (
              <p className="py-6 text-center text-[12px] font-bold text-muted-foreground">Nothing completed yet — finished work lands here automatically.</p>
            ) : byDay.map(([day, dayEntries]: [string, any[]]) => (
              <div key={day}>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {safeDate(day) ? format(safeDate(day) as Date, 'EEEE, MMM d') : day}
                </p>
                <div className="relative mt-2 space-y-3 border-l-2 border-slate-200 pl-5">
                  {dayEntries.map((e: any, i: number) => {
                    const meta = AUDIT_KIND_META[e.kind] || AUDIT_KIND_META.tasks;
                    const timeStr = /T\d{2}:\d{2}/.test(e.ts) && safeDate(e.ts) ? format(safeDate(e.ts) as Date, 'h:mm a') : '';
                    const dot = <span className={cn('absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white ring-2 ring-slate-200', meta.dot)} aria-hidden="true" />;
                    const header = (
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                        {meta.label}{timeStr ? ` \u00b7 ${timeStr}` : ''}
                      </p>
                    );
                    if (e.kind === 'acks') {
                      const a = e.payload;
                      return (
                        <div key={`a-${i}`} className="relative">
                          {dot}
                          {header}
                          <p className="text-[12px] font-bold text-slate-700">✍️ {a.staffName || 'Team member'} read &amp; confirmed <span className="font-black">{a.docTitle}</span> (v{a.version})</p>
                        </div>
                      );
                    }
                    if (e.kind === 'tasks') {
                      const t = e.payload;
                      return (
                        <div key={`t-${t.id}-${i}`} className="relative">
                          {dot}
                          {header}
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 text-[12px] font-bold text-slate-700">
                              ✓ {t.title} — <span className="font-black">{t.completedByName || 'Team member'}</span>{t.notes ? <span className="text-slate-500"> \u00b7 {t.notes}</span> : null}
                            </p>
                            {t.photoUrl && (
                              <a href={t.photoUrl} target="_blank" rel="noreferrer">
                                <img src={t.photoUrl} alt={`Evidence: ${t.title}`} className="h-10 w-10 shrink-0 rounded-lg border-2 object-cover" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (e.kind === 'rotations') {
                      const h = e.payload;
                      return (
                        <div key={`r-${i}`} className="relative">
                          {dot}
                          {header}
                          <p className="text-[12px] font-bold text-slate-700">
                            ✓ {h.rotationTitle} — <span className="font-black">{h.staffName}</span>{h.coveredForName ? ` (covering for ${h.coveredForName})` : ''}
                          </p>
                        </div>
                      );
                    }
                    const r = e.payload;
                    const rDoc = docById[r.docId];
                    const full = r.totalItems > 0 && Number(r.checkedCount) >= Number(r.totalItems);
                    const runKey = `${r.docId}:${r.id}`;
                    const isOpen = openRunKey === runKey;
                    const photoCount = Object.keys(r.photos || {}).length;
                    const started = r.startedAt && safeDate(r.startedAt) ? format(safeDate(r.startedAt) as Date, 'h:mm a') : '';
                    const finished = r.completedAt && safeDate(r.completedAt) ? format(safeDate(r.completedAt) as Date, 'h:mm a') : '';
                    return (
                      <div key={`run-${runKey}`} className="relative">
                        {dot}
                        {header}
                        <button type="button" onClick={() => setOpenRunKey(isOpen ? null : runKey)} className="flex w-full items-center justify-between gap-2 text-left">
                          <p className="min-w-0 flex-1 text-[12px] font-bold text-slate-700">
                            {full ? '✓' : '◐'} {rDoc?.title || 'Document'} — <span className="font-black">{r.staffName || 'Team member'}</span> · {r.checkedCount}/{r.totalItems}
                            {photoCount > 0 ? ` · 📷 ${photoCount}` : ''}
                            {started && finished ? <span className="text-slate-500"> \u00b7 {started} \u2192 {finished}</span> : started ? <span className="text-slate-500"> \u00b7 started {started}</span> : null}
                          </p>
                          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                        </button>
                        {isOpen && rDoc && (
                          <div className="mt-2 space-y-1 border-t-2 border-dashed pt-2">
                            {(rDoc.sections || []).filter((sec: any) => sec.type === 'checklist').map((sec: any) => {
                              const items = String(sec.body || '').split('\n').map((x: string) => x.trim()).filter(Boolean);
                              return items.map((item: string, ii: number) => {
                                const key = `${sec.id}:${ii}`;
                                const on = !!(r.items || {})[key];
                                const photo = (r.photos || {})[key];
                                return (
                                  <div key={key} className="flex items-center justify-between gap-2 py-0.5">
                                    <p className={cn('min-w-0 flex-1 text-[11px] font-bold', on ? 'text-slate-700' : 'text-slate-400')}>{on ? '✓' : '·'} {item}</p>
                                    {photo && (
                                      <a href={photo} target="_blank" rel="noreferrer">
                                        <img src={photo} alt={`Evidence: ${item}`} className="h-10 w-10 shrink-0 rounded-lg border-2 object-cover" />
                                      </a>
                                    )}
                                  </div>
                                );
                              });
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[11px] font-bold text-muted-foreground">Showing the latest 200 entries. Evidence photos open full-size in a new tab.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ROTATION_CADENCES = [['daily', 'Daily'], ['weekly', 'Weekly'], ['per-shift', 'Per shift']] as const;

const RotationsCard = ({ tenantId, staff, publishedDocs }: { tenantId: string; staff: any[]; publishedDocs: any[] }) => {
  const { firestore } = useFirebase();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState('daily');
  const [linkedDocId, setLinkedDocId] = useState('');
  const [allowCover, setAllowCover] = useState(true);
  const [allowSwap, setAllowSwap] = useState(true);
  const [err, setErr] = useState('');

  const rotationsQ = useMemoFirebase(
    () => tenantId ? collection(firestore, `tenants/${tenantId}/rotations`) : null,
    [firestore, tenantId]
  );
  const { data: rotations } = useCollection(rotationsQ);
  const list = useMemo(() => ([...((rotations || []) as any[])]).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))), [rotations]);
  const activeStaff = staff.filter((m: any) => !m.archived);
  const nameOf = (id: string) => activeStaff.find((m: any) => m.id === id)?.name || 'Team member';

  const createRotation = () => {
    const t = title.trim().slice(0, 140);
    if (!t) { setErr('Name the rotation.'); return; }
    if (memberIds.length < 2) { setErr('A rotation needs at least two people.'); return; }
    setErr('');
    const id = nanoid();
    const memberNames: Record<string, string> = {};
    for (const mid of memberIds) memberNames[mid] = nameOf(mid);
    const linkedDoc = publishedDocs.find((x: any) => x.id === linkedDocId) || null;
    const linkedHasChecklist = !!linkedDoc && (linkedDoc.sections || []).some((x: any) => x.type === 'checklist');
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${id}`), {
      id, title: t, memberIds, memberNames, cadence, linkedDocId: linkedDocId || '',
      linkedHasChecklist,
      allowCover, allowSwap,
      currentIndex: 0, history: [], lastDoneDate: '', createdAt: new Date().toISOString(),
    }, { merge: false });
    setCreating(false); setTitle(''); setMemberIds([]); setCadence('daily'); setLinkedDocId(''); setAllowCover(true); setAllowSwap(true);
  };

  const moveMember = (r: any, i: number, dir: number) => {
    const ids = [...(r.memberIds || [])];
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`), { memberIds: ids });
  };

  return (
    <Card className="rounded-[2rem] border-2 bg-white overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Rotations</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
              {list.length > 0 ? `${list.length} running — turn-taking chores, tracked fairly` : 'Shared duties that take turns (laundry, bathroom check\u2026)'}
            </p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            {list.map((r: any) => {
              const ids: string[] = r.memberIds || [];
              const cur = ids[Number(r.currentIndex || 0) % Math.max(ids.length, 1)];
              const history = ([...(r.history || [])]).slice(-6).reverse();
              return (
                <div key={r.id} className="space-y-2 rounded-2xl border-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-black tracking-tight text-slate-900">{r.title}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        {(ROTATION_CADENCES.find(([v]) => v === r.cadence)?.[1]) || 'Daily'}{r.linkedDocId ? ' · linked to an SOP' : ''}
                      </p>
                    </div>
                    <Button type="button" variant="outline" aria-label={`Remove rotation ${r.title}`} onClick={() => deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`))} className="h-9 shrink-0 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive border-destructive/30">✕</Button>
                  </div>
                  <div className="rounded-xl border-2 border-dashed bg-slate-50 p-2.5">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Now: {nameOf(cur)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" aria-pressed={r.allowCover !== false} onClick={() => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`), { allowCover: r.allowCover === false })} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', r.allowCover !== false ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                      {r.allowCover !== false ? '✓ Covering on' : 'Covering off'}
                    </button>
                    <button type="button" aria-pressed={r.allowSwap !== false} onClick={() => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`), { allowSwap: r.allowSwap === false })} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', r.allowSwap !== false ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                      {r.allowSwap !== false ? '✓ Swaps on' : 'Swaps off'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Order</p>
                    {ids.map((id, i) => (
                      <div key={id} className="flex items-center gap-2">
                        <p className={cn('min-w-0 flex-1 truncate text-[12px] font-bold', id === cur ? 'text-slate-900' : 'text-slate-500')}>{i + 1}. {nameOf(id)}{id === cur ? ' ← turn' : ''}</p>
                        <Button type="button" variant="outline" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0} onClick={() => moveMember(r, i, -1)} className="h-8 w-8 rounded-lg border-2 p-0 text-[10px] font-black">↑</Button>
                        <Button type="button" variant="outline" aria-label={`Move ${nameOf(id)} down`} disabled={i === ids.length - 1} onClick={() => moveMember(r, i, 1)} className="h-8 w-8 rounded-lg border-2 p-0 text-[10px] font-black">↓</Button>
                      </div>
                    ))}
                  </div>
                  {history.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recent turns</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {history.map((h: any, i: number) => (
                          <span key={i} className={cn('rounded-lg border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', h.action === 'swap' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-900 border-emerald-300')}>
                            {h.action === 'swap' ? `${h.staffName} ⇄ ${h.withName || ''}` : `${h.staffName}${h.coveredForName ? ` (for ${h.coveredForName})` : ''} · ${h.date}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {creating ? (
              <div className="space-y-2 rounded-2xl border-2 p-3">
                <label htmlFor="rot-title" className="sr-only">Rotation name</label>
                <Input id="rot-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Towel laundry" className="h-11 rounded-xl border-2 bg-white font-bold text-sm" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who takes turns (tap in order)</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeStaff.map((m: any) => {
                    const idx = memberIds.indexOf(m.id);
                    const on = idx >= 0;
                    return (
                      <button key={m.id} type="button" aria-pressed={on} onClick={() => setMemberIds(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                        {on ? `${idx + 1}. ` : ''}{m.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROTATION_CADENCES.map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={cadence === v} onClick={() => setCadence(v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', cadence === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What members may do</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={allowCover} onClick={() => setAllowCover(v => !v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', allowCover ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                    {allowCover ? '✓ ' : ''}Covering allowed
                  </button>
                  <button type="button" aria-pressed={allowSwap} onClick={() => setAllowSwap(v => !v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', allowSwap ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                    {allowSwap ? '✓ ' : ''}Swaps allowed
                  </button>
                </div>
                {publishedDocs.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Link an SOP (optional — the turn arrives with its checklist)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {publishedDocs.map((dd: any) => (
                        <button key={dd.id} type="button" aria-pressed={linkedDocId === dd.id} onClick={() => setLinkedDocId(linkedDocId === dd.id ? '' : dd.id)} className={cn('h-10 max-w-[220px] truncate rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', linkedDocId === dd.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                          {dd.title || 'Untitled'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreating(false)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
                  <Button type="button" onClick={createRotation} className="h-11 flex-[2] rounded-xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white">Start rotation</Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setCreating(true)} className="h-11 w-full rounded-xl border-2 border-dashed text-[11px] font-black uppercase tracking-widest">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New rotation
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Quick starts</p>
                <div className="flex flex-wrap gap-1.5">
                  {TASK_TEMPLATES.map(tt => (
                    <button key={tt.title} type="button" onClick={() => { setTitle(tt.title); setNotes(tt.notes); setRequirePhoto(tt.requirePhoto); }} className="h-9 max-w-[240px] truncate rounded-lg border-2 bg-white px-2.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {tt.requirePhoto ? '\ud83d\udcf7 ' : ''}{tt.title}
                    </button>
                  ))}
                </div>
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

const DocumentCardWithAcks = ({ d, tenantId, canManage, myStaffId, actorName, staff, expandedId, setExpandedId, onSave, onDelete, onPrint }: any) => {
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
            <Button type="button" variant="outline" onClick={onPrint} className="h-10 w-full rounded-xl border-2 text-[10px] font-black uppercase tracking-widest">
              🖨 Open print view (new tab)
            </Button>
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
  const [pageTab, setPageTab] = useState<'library' | 'tasks' | 'rotations' | 'audit'>('library');

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
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {([['library', 'Library'], ['tasks', 'Tasks'], ['rotations', 'Rotations'], ['audit', 'Audit trail']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={pageTab === v} onClick={() => setPageTab(v)} className={cn('h-11 shrink-0 rounded-xl border-2 px-4 text-[11px] font-black uppercase tracking-widest', pageTab === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-muted-foreground')}>
                {l}
              </button>
            ))}
          </div>
        )}
        {canManage && pageTab === 'audit' && (
          <AuditCard tenantId={tenantId || ''} staff={(staff || []) as any[]} />
        )}
        {canManage && pageTab === 'rotations' && (
          <RotationsCard tenantId={tenantId || ''} staff={(staff || []) as any[]} publishedDocs={((documents || []) as any[]).filter((x: any) => x.status === 'published')} />
        )}
        {canManage && pageTab === 'tasks' && (
          <TasksCard tenantId={tenantId || ''} staff={(staff || []) as any[]} actorName={actorName} />
        )}

        {(!canManage || pageTab === 'library') && (
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search documents"
          placeholder="Search by title or type"
          className="h-12 rounded-2xl border-2 bg-white px-4 font-bold text-sm"
        />
        )}

        {(!canManage || pageTab === 'library') && (isLoading ? (
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
                onPrint={() => window.open(`/print-doc?id=${d.id}`, '_blank')}
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
        ))}
      </main>
    </div>
  );
}
