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
import { withItemIds, itemKey } from '@/lib/doc-items';
import { DocsLibrary } from '@/components/documents/DocsLibrary';
import { DocDetail } from '@/components/documents/DocDetail';
import { TrainingRecord } from '@/components/documents/TrainingRecord';
import { Certification } from '@/components/documents/Certification';
import { collectionsOf, collectionFor, reviewDue } from '@/lib/doc-collections';

const CATEGORIES = [
  ['sop', 'SOP'],
  ['handbook', 'Handbook'],
  ['policy', 'Policy'],
  ['other', 'Other'],
] as const;

const TEMPLATES: Array<{ key: string; title: string; category: string; blurb: string; forRenters?: boolean; sections: Array<{ heading: string; body: string; type?: string }> }> = [
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
  {
    key: 'aftercare',
    title: 'Looking after it at home',
    category: 'aftercare',
    blurb: 'Client aftercare, sent the day after their visit. Edit it for each service.',
    sections: [
      { type: 'text', heading: 'Thank you for coming in', body: 'A few simple things keep your results looking their best for longer.' },
      { type: 'step', heading: 'The first 24 hours', body: 'What to avoid right after the service, and why.' },
      { type: 'step', heading: 'Day to day', body: 'The small habits that make it last — and the products we recommend.' },
      { type: 'tip', heading: 'Make it last', body: 'Book your next visit before this one grows out, so you get your favorite time.' },
      { type: 'warning', heading: 'Something not right?', body: 'If anything changes in the first week, tell us — we’ll look at it and make it right.' },
    ],
  },
  {
    key: 'building-shared', forRenters: true,
    title: 'Shared spaces & the back room',
    category: 'policy',
    blurb: 'Building rules for renters — they read and sign it in their portal.',
    sections: [
      { type: 'text', heading: 'Why we have these', body: 'Everyone in the building shares these spaces. A few simple rules keep them clean, safe and fair for every business here.' },
      { type: 'step', heading: 'The back room', body: 'Label your products and tools. Nothing on the floor. Wipe down shared counters after use.' },
      { type: 'step', heading: 'Shared equipment', body: 'Book shared equipment on the sheet. Report anything broken through the portal the same day.' },
      { type: 'step', heading: 'Closing up', body: 'The last one out runs the closing checklist for the shared spaces.' },
      { type: 'warning', heading: 'Safety', body: 'Never prop an outside door open. Keep fire exits and extinguishers clear.' },
    ],
  },
  {
    key: 'building-hours', forRenters: true,
    title: 'Hours, keys & the alarm',
    category: 'policy',
    blurb: 'When the building is open, keys and codes, and the alarm — for renters to sign.',
    sections: [
      { type: 'step', heading: 'Building hours', body: 'The hours the building is open, and how early you can arrive or late you can stay.' },
      { type: 'step', heading: 'Keys and codes', body: 'Keys and door codes are yours only — never share or copy them. Tell us straight away if one is lost.' },
      { type: 'checklist', heading: 'If you’re last out', body: 'Lights off in shared spaces\nBack door locked\nAlarm set' },
      { type: 'warning', heading: 'If the alarm goes off', body: 'Who to call, and what to do while you wait.' },
    ],
  },
  {
    key: 'building-sanitation', forRenters: true,
    title: 'Sanitation in the building',
    category: 'policy',
    blurb: 'The building’s standard for shared sinks, laundry and waste — your own station is yours to run.',
    sections: [
      { type: 'text', heading: 'Your station, the shared spaces', body: 'How you clean and disinfect your own station is part of your business. These are the rules for the spaces everyone uses.' },
      { type: 'step', heading: 'Shared sinks', body: 'Rinse and wipe after every use. No product left in the basin.' },
      { type: 'step', heading: 'Laundry and waste', body: 'Used towels in the laundry bin. Sharps in the sharps container only.' },
      { type: 'tip', heading: 'Running low?', body: 'Tell the studio through the portal before something runs out.' },
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
  runs: { dot: 'bg-foreground', label: 'Checklist' },
  rotations: { dot: 'bg-amber-500', label: 'Rotation' },
  acks: { dot: 'bg-sky-500', label: 'Sign-off' },
};

const AuditCard = ({ tenantId, staff, initialOpen }: { tenantId: string; staff: any[]; initialOpen?: boolean }) => {
  const { firestore } = useFirebase();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (initialOpen) setOpen(true); }, [initialOpen]);
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
    <Card className="rounded-[2rem] border-2 bg-card overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-foreground">Completed work — audit trail</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">Every finished task, checklist run, and rotation turn — with photos</p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            {checklistDocs.map((d: any) => (
              <RunsCollector key={d.id} tenantId={tenantId} docItem={d} onRuns={onRuns} />
            ))}
            {publishedDocs.map((d: any) => (
              <AcksCollector key={`a-${d.id}`} tenantId={tenantId} docItem={d} onAcks={onAcks} />
            ))}
            <div className="flex flex-wrap gap-1.5">
              {AUDIT_FILTERS.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', filter === v ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={personId === ''} onClick={() => setPersonId('')} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', personId === '' ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                Whole team
              </button>
              {staff.filter((m: any) => !m.archived).map((m: any) => (
                <button key={m.id} type="button" aria-pressed={personId === m.id} onClick={() => setPersonId(personId === m.id ? '' : m.id)} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', personId === m.id ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
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
                <div className="relative mt-2 space-y-3 border-l-2 border-border pl-5">
                  {dayEntries.map((e: any, i: number) => {
                    const meta = AUDIT_KIND_META[e.kind] || AUDIT_KIND_META.tasks;
                    const timeStr = /T\d{2}:\d{2}/.test(e.ts) && safeDate(e.ts) ? format(safeDate(e.ts) as Date, 'h:mm a') : '';
                    const dot = <span className={cn('absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white ring-2 ring-border', meta.dot)} aria-hidden="true" />;
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
                          <p className="text-[12px] font-bold text-foreground/80">✍️ {a.staffName || 'Team member'} read &amp; confirmed <span className="font-black">{a.docTitle}</span> (v{a.version})</p>
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
                            <p className="min-w-0 flex-1 text-[12px] font-bold text-foreground/80">
                              ✓ {t.title} — <span className="font-black">{t.completedByName || 'Team member'}</span>{t.notes ? <span className="text-muted-foreground"> \u00b7 {t.notes}</span> : null}
                            </p>
                            {(Array.isArray(t.photoUrls) && t.photoUrls.length > 0 ? t.photoUrls : (t.photoUrl ? [t.photoUrl] : [])).map((u: string, pi: number) => (
                              <a key={pi} href={u} target="_blank" rel="noreferrer">
                                <img src={u} alt={`Photo ${pi + 1} — ${t.title}`} className="h-10 w-10 shrink-0 rounded-lg border-2 object-cover" />
                              </a>
                            ))}
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
                          <p className="text-[12px] font-bold text-foreground/80">
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
                          <p className="min-w-0 flex-1 text-[12px] font-bold text-foreground/80">
                            {full ? '✓' : '◐'} {rDoc?.title || 'Document'} — <span className="font-black">{r.staffName || 'Team member'}</span> · {r.checkedCount}/{r.totalItems}
                            {photoCount > 0 ? ` · 📷 ${photoCount}` : ''}
                            {started && finished ? <span className="text-muted-foreground"> \u00b7 {started} \u2192 {finished}</span> : started ? <span className="text-muted-foreground"> \u00b7 started {started}</span> : null}
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
                                    <p className={cn('min-w-0 flex-1 text-[11px] font-bold', on ? 'text-foreground/80' : 'text-muted-foreground')}>{on ? '✓' : '·'} {item}</p>
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
    <Card className="rounded-[2rem] border-2 bg-card overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-foreground">Rotations</p>
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
                      <p className="text-[13px] font-black tracking-tight text-foreground">{r.title}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        {(ROTATION_CADENCES.find(([v]) => v === r.cadence)?.[1]) || 'Daily'}{r.linkedDocId ? ' · linked to an SOP' : ''}
                      </p>
                    </div>
                    <Button type="button" variant="outline" aria-label={`Remove rotation ${r.title}`} onClick={() => deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`))} className="h-9 shrink-0 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive border-destructive/30">✕</Button>
                  </div>
                  <div className="rounded-xl border-2 border-dashed bg-muted/60 p-2.5">
                    <p className="text-[11px] font-black uppercase tracking-widest text-foreground">Now: {nameOf(cur)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" aria-pressed={r.allowCover !== false} onClick={() => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`), { allowCover: r.allowCover === false })} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', r.allowCover !== false ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                      {r.allowCover !== false ? '✓ Covering on' : 'Covering off'}
                    </button>
                    <button type="button" aria-pressed={r.allowSwap !== false} onClick={() => updateDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/rotations/${r.id}`), { allowSwap: r.allowSwap === false })} className={cn('h-9 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest', r.allowSwap !== false ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                      {r.allowSwap !== false ? '✓ Swaps on' : 'Swaps off'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Order</p>
                    {ids.map((id, i) => (
                      <div key={id} className="flex items-center gap-2">
                        <p className={cn('min-w-0 flex-1 truncate text-[12px] font-bold', id === cur ? 'text-foreground' : 'text-muted-foreground')}>{i + 1}. {nameOf(id)}{id === cur ? ' ← turn' : ''}</p>
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
                          <span key={i} className={cn('rounded-lg border-2 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', h.action === 'swap' ? 'bg-muted text-foreground/80' : 'bg-emerald-100 text-emerald-900 border-emerald-300')}>
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
                <Input id="rot-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Towel laundry" className="h-11 rounded-xl border-2 bg-card font-bold text-sm" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who takes turns (tap in order)</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeStaff.map((m: any) => {
                    const idx = memberIds.indexOf(m.id);
                    const on = idx >= 0;
                    return (
                      <button key={m.id} type="button" aria-pressed={on} onClick={() => setMemberIds(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                        {on ? `${idx + 1}. ` : ''}{m.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROTATION_CADENCES.map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={cadence === v} onClick={() => setCadence(v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', cadence === v ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What members may do</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={allowCover} onClick={() => setAllowCover(v => !v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', allowCover ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                    {allowCover ? '✓ ' : ''}Covering allowed
                  </button>
                  <button type="button" aria-pressed={allowSwap} onClick={() => setAllowSwap(v => !v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', allowSwap ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                    {allowSwap ? '✓ ' : ''}Swaps allowed
                  </button>
                </div>
                {publishedDocs.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Link an SOP (optional — the turn arrives with its checklist)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {publishedDocs.map((dd: any) => (
                        <button key={dd.id} type="button" aria-pressed={linkedDocId === dd.id} onClick={() => setLinkedDocId(linkedDocId === dd.id ? '' : dd.id)} className={cn('h-10 max-w-[220px] truncate rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', linkedDocId === dd.id ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                          {dd.title || 'Untitled'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreating(false)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
                  <Button type="button" onClick={createRotation} className="h-11 flex-[2] rounded-xl bg-foreground text-[11px] font-black uppercase tracking-widest text-background">Start rotation</Button>
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

const TasksCard = ({ tenantId, staff, actorName, focusTaskId }: { tenantId: string; staff: any[]; actorName: string; focusTaskId?: string }) => {
  const { firestore } = useFirebase();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (focusTaskId) setOpen(true);
  }, [focusTaskId]);
  // From a staff profile ("Give a task"): ?assign=<staffId> opens the form with them picked.
  useEffect(() => {
    try { const who = new URLSearchParams(window.location.search).get('assign'); if (who) { setOpen(true); setCreating(true); setAssignees([who]); } } catch { /* fine */ }
  }, []);
  useEffect(() => {
    if (!focusTaskId) return;
    const t = setTimeout(() => {
      document.getElementById(`task-${focusTaskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
    return () => clearTimeout(t);
  }, [focusTaskId]);
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
    <Card className="rounded-[2rem] border-2 bg-card overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-foreground">One-off tasks</p>
            <p className="mt-0.5 text-[12px] font-bold text-muted-foreground">
              {openTasks.length > 0 ? `${openTasks.length} open` : 'Assign a to-do that isn\u2019t an SOP'}
            </p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>

        {open && (
          <div className="space-y-3 border-t-2 border-dashed pt-3">
            {openTasks.map((t: any) => (
              <div key={t.id} id={`task-${t.id}`} className={cn('rounded-2xl border-2 p-3', focusTaskId === t.id && 'ring-4 ring-amber-300')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-black tracking-tight text-foreground">{t.title}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {(t.assignedStaffIds || []).map(nameOf).join(', ')}{t.dueDate ? ` · due ${t.dueDate}` : ''}{t.requirePhoto ? ' · 📷' : ''}
                    </p>
                  </div>
                  <Button type="button" variant="outline" aria-label={`Remove task ${t.title}`} onClick={() => deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/tasks/${t.id}`))} className="h-9 shrink-0 rounded-lg border-2 px-2.5 text-[10px] font-black uppercase tracking-widest text-destructive border-destructive/30">✕</Button>
                </div>
                {t.notes && <p className="mt-1 text-[12px] font-bold text-foreground/80">{t.notes}</p>}
              </div>
            ))}

            {doneTasks.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recently done</p>
                <div className="mt-1 space-y-1.5">
                  {doneTasks.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-dashed bg-muted/60 px-3 py-2">
                      <p className="min-w-0 text-[12px] font-bold text-foreground/80">✓ {t.title} · {t.completedByName || 'Team member'}{t.completedAt && safeDate(t.completedAt) ? ` · ${format(safeDate(t.completedAt) as Date, 'MMM d, h:mm a')}` : ''}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {(Array.isArray(t.photoUrls) && t.photoUrls.length > 0 ? t.photoUrls : (t.photoUrl ? [t.photoUrl] : [])).map((u: string, pi: number) => (
                          <a key={pi} href={u} target="_blank" rel="noreferrer">
                            <img src={u} alt={`Photo ${pi + 1} — ${t.title}`} className="h-9 w-9 rounded-lg border-2 object-cover" />
                          </a>
                        ))}
                      </div>
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
                    <button key={tt.title} type="button" onClick={() => { setTitle(tt.title); setNotes(tt.notes); setRequirePhoto(tt.requirePhoto); }} className="h-9 max-w-[240px] truncate rounded-lg border-2 bg-card px-2.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {tt.requirePhoto ? '\ud83d\udcf7 ' : ''}{tt.title}
                    </button>
                  ))}
                </div>
                <label htmlFor="task-title" className="sr-only">Task name</label>
                <Input id="task-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Deep-clean the front window" className="h-11 rounded-xl border-2 bg-card font-bold text-sm" />
                <label htmlFor="task-notes" className="sr-only">Notes</label>
                <textarea id="task-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Details (optional)" className="w-full rounded-xl border-2 bg-card p-3 font-bold text-sm" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeStaff.map((m: any) => {
                    const on = assignees.includes(m.id);
                    return (
                      <button key={m.id} type="button" aria-pressed={on} onClick={() => setAssignees(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', on ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="task-due" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Due</label>
                  <input id="task-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-10 rounded-xl border-2 bg-card px-3 text-[12px] font-bold" />
                  <button type="button" aria-pressed={requirePhoto} onClick={() => setRequirePhoto(v => !v)} className={cn('h-10 rounded-xl border-2 px-3 text-[11px] font-black uppercase tracking-widest', requirePhoto ? 'bg-foreground text-background border-slate-900' : 'bg-card text-muted-foreground')}>
                    📷 {requirePhoto ? 'Photo required' : 'No photo needed'}
                  </button>
                </div>
                {err && <p className="text-[11px] font-bold text-destructive">{err}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setCreating(false)} className="h-11 flex-1 rounded-xl border-2 text-[11px] font-black uppercase tracking-widest">Cancel</Button>
                  <Button type="button" onClick={createTask} className="h-11 flex-[2] rounded-xl bg-foreground text-[11px] font-black uppercase tracking-widest text-background">Assign task</Button>
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

export default function DocumentsPage() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { selectedTenant, role, can } = useTenant();
  const tenantId = selectedTenant?.id;
  const canManage = can('documents.manage');
  const actorName = currentUser?.displayName || currentUser?.email || 'A manager';
  const myStaffId = resolveActiveStaffId(currentUser?.uid) || '';

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [pageTab, setPageTab] = useState<'library' | 'training' | 'certification' | 'tasks' | 'rotations' | 'audit'>('library');
  const [focusTaskId, setFocusTaskId] = useState('');
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const tab = sp.get('tab');
      if (tab === 'tasks' || tab === 'rotations' || tab === 'audit' || tab === 'library' || tab === 'training' || tab === 'certification') setPageTab(tab);
      const tk = sp.get('task') || '';
      if (tk) { setPageTab('tasks'); setFocusTaskId(tk); }
    } catch { /* no-op */ }
  }, []);

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
        d.category === 'aftercare' ||   // client aftercare: anyone on the team can read what clients are sent
        (d.assignedRoles || []).includes('all') ||
        (role && (d.assignedRoles || []).includes(role)) ||
        (myStaffId && (d.assignedStaffIds || []).includes(myStaffId))
      ));
    }
    if (needle) list = list.filter(d => `${d.title || ''} ${d.category || ''}`.toLowerCase().includes(needle));
    return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }, [documents, canManage, role, myStaffId, q]);
  const openDoc = expandedId ? (visible.find((d: any) => d.id === expandedId) || null) : null;

  const handleCreate = (tpl?: typeof TEMPLATES[number]) => {
    if (!tenantId) return;
    const id = nanoid();
    setDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${id}`), {
      id,
      title: tpl ? tpl.title : '',
      category: tpl ? tpl.category : 'sop',
      // Keep each template section's type (checklist, step, warning, tip) and photo lines — they used to be dropped.
      sections: tpl ? withItemIds(tpl.sections.map((x: any) => ({ id: nanoid(), type: x.type || 'text', heading: x.heading, body: x.body, photoLines: Array.isArray(x.photoLines) ? x.photoLines : [] }))) : [],
      assignedRoles: tpl?.category === 'aftercare' ? [] : (tpl as any)?.forRenters ? ['renter'] : ['all'],   // aftercare is for clients; building rules for renters
      ...((tpl as any)?.forRenters ? { collectionId: 'building', requireSignature: true } : {}),
      assignedStaffIds: [],
      status: 'draft',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    }, { merge: false });
    setExpandedId(id);
  };

  // Saving a live document keeps the changes in `draft` (the team goes on reading the live copy). Publishing applies them,
  // bumps the version, keeps a copy of that version (documents/{id}/versions/{n}) with its "what changed" note, and
  // tells the team once (/api/comms/dispatch).
  const handleSave = (id: string, data: any, publish: boolean) => {
    if (!tenantId) return;
    const existing = ((documents || []) as any[]).find(d => d.id === id);
    const live = existing?.status === 'published';
    const now = new Date().toISOString();
    const targetRef = doc(firestore, `tenants/${tenantId}/documents/${id}`);
    const { id: _id, ...clean } = data || {}; void _id;
    if (!publish) {
      // Where it shows up during work isn't part of what people sign, so it changes the live copy straight away.
      if (live) { const { links, ...rest } = clean; updateDocumentNonBlocking(targetRef, { draft: { ...rest, savedAt: now, savedBy: actorName }, ...(links ? { links } : {}) }); }
      else updateDocumentNonBlocking(targetRef, { ...clean, updatedAt: now, updatedBy: actorName });
      return;
    }
    const version = live ? (Number(existing?.version) || 1) + 1 : (Number(existing?.version) || 1);
    const note = String(clean.changeNote || '').trim() || (version === 1 ? 'First version.' : '');
    import('firebase/firestore')
      .then(async ({ updateDoc, setDoc, deleteField, arrayUnion }) => {
        await updateDoc(targetRef, { ...clean, changeNote: note || null, status: 'published', version, updatedAt: now, updatedBy: actorName, publishedAt: now,
          draft: deleteField(), history: arrayUnion({ version, at: now, by: actorName, note: note || null }) });
        await setDoc(doc(firestore, `tenants/${tenantId}/documents/${id}/versions/${version}`), { version, title: clean.title || '', category: clean.category || 'sop', sections: clean.sections || [], changeNote: note || null, publishedAt: now, publishedBy: actorName }).catch(() => { /* the live copy is what matters */ });
      })
      .then(() => {
        try {
          void fetch('/api/comms/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'document', tenantId, documentId: id }),
          }).catch(() => { /* the publish is saved; notices are best-effort */ });
        } catch { /* fire-and-forget */ }
      })
      .catch(err => console.error('publish failed', err));
    setExpandedId(null);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppHeader title="Documents" />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 p-4 md:p-8" style={{ color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] tracking-[0.1em]" style={{ color: 'hsl(var(--muted-foreground))' }}>documents</p>
            <h1 className="mt-1 text-[30px] font-normal tracking-[-0.03em] md:text-[34px]">{canManage ? 'Your playbook' : 'Handbook and SOPs'}</h1>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setTemplatesOpen(v => !v)} aria-expanded={templatesOpen} className="h-11 rounded-full border bg-card px-5 text-[14px] font-medium" style={{ borderColor: 'hsl(var(--border))' }}>Templates</button>
              <button type="button" onClick={() => { handleCreate(); setPageTab('library'); }} className="h-11 rounded-full px-5 text-[14px] font-semibold text-white" style={{ background: 'hsl(var(--foreground))' }}>New document</button>
            </div>
          )}
        </div>
        {canManage && templatesOpen && (
          <div className="rounded-[18px] border bg-card p-4" style={{ borderColor: 'hsl(var(--border))' }}>
            <div className="mb-3 flex items-baseline justify-between"><p className="text-[15px] font-semibold">Start from a template</p><p className="text-[12.5px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Templates land as drafts — make every line match how you work, then publish.</p></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map(t => (
                <button key={t.key} type="button" onClick={() => { handleCreate(t); setTemplatesOpen(false); setPageTab('library'); }} className="rounded-[14px] p-3.5 text-left hover:bg-[#ececee]" style={{ background: 'hsl(var(--secondary))' }}>
                  <p className="text-[14.5px] font-semibold">{t.title}</p>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: 'hsl(var(--muted-foreground))' }}>{categoryLabel(t.category)} · {t.sections.length} sections — {t.blurb}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {canManage && (
          <div role="tablist" aria-label="Documents" className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            {([['library', 'Library'], ['training', 'Training record'], ['certification', 'Certification'], ['tasks', 'Tasks'], ['rotations', 'Rotations'], ['audit', 'Activity']] as const).map(([v, l]) => (
              <button key={v} type="button" role="tab" aria-selected={pageTab === v} onClick={() => { setPageTab(v); setExpandedId(null); }} className="-mb-px h-11 shrink-0 px-3.5 text-[14px]" style={pageTab === v ? { fontWeight: 700, borderBottom: '2px solid hsl(var(--foreground))' } : { color: 'hsl(var(--muted-foreground))' }}>{l}</button>
            ))}
          </div>
        )}
        {canManage && pageTab === 'training' && (
          <TrainingRecord tenantId={tenantId || ''} tenant={selectedTenant} docs={(documents || []) as any[]} staff={(staff || []) as any[]}
            today={new Intl.DateTimeFormat('en-CA', { timeZone: (selectedTenant as any)?.timezone || 'America/New_York' }).format(new Date())}
            onOpenDoc={(id) => { setPageTab('library'); setExpandedId(id); }} />
        )}
        {canManage && pageTab === 'certification' && (
          <Certification tenantId={tenantId || ''} docs={(documents || []) as any[]} onOpenDoc={(id) => { setPageTab('library'); setExpandedId(id); }} />
        )}
        {canManage && pageTab === 'audit' && (
          <AuditCard tenantId={tenantId || ''} staff={(staff || []) as any[]} initialOpen={pageTab === 'audit'} />
        )}
        {canManage && pageTab === 'rotations' && (
          <RotationsCard tenantId={tenantId || ''} staff={(staff || []) as any[]} publishedDocs={((documents || []) as any[]).filter((x: any) => x.status === 'published')} />
        )}
        {canManage && pageTab === 'tasks' && (
          <TasksCard tenantId={tenantId || ''} staff={(staff || []) as any[]} actorName={actorName} focusTaskId={focusTaskId} />
        )}

        {(!canManage || pageTab === 'library') && (isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader className="h-7 w-7 animate-spin" aria-label="Loading documents" />
          </div>
        ) : openDoc ? (
          // One document: who has signed, recent checklist runs, and (for managers) the editor.
          <div className="space-y-3">
            <button type="button" onClick={() => setExpandedId(null)} className="text-[14px]" style={{ color: 'hsl(var(--muted-foreground))' }}>‹ All documents</button>
            <DocDetail
              key={openDoc.id}
              d={openDoc}
              tenantId={tenantId || ''}
              canManage={canManage}
              me={{ id: myStaffId, name: actorName, role: String(role || '') }}
              staff={(staff || []) as any[]}
              onSave={handleSave}
              onClose={() => setExpandedId(null)}
              onPrint={() => { if (openDoc.status !== 'published') { window.alert('Publish it first — only published documents print.'); return; } window.open(`/print/document/${tenantId}/${openDoc.id}`, '_blank', 'noopener'); }}
              onDelete={() => { if (tenantId) { deleteDocumentNonBlocking(doc(firestore, `tenants/${tenantId}/documents/${openDoc.id}`)); setExpandedId(null); } }}
            />
          </div>
        ) : (
          <DocsLibrary tenantId={tenantId || ''} tenant={selectedTenant} docs={visible} staff={(staff || []) as any[]} canManage={canManage} myStaffId={myStaffId} onOpen={(id) => setExpandedId(id)}
            today={new Intl.DateTimeFormat('en-CA', { timeZone: (selectedTenant as any)?.timezone || 'America/New_York' }).format(new Date())} />
        ))}
      </main>
    </div>
  );
}
