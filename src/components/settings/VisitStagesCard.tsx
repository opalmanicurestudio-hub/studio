'use client';
// src/components/settings/VisitStagesCard.tsx — VISIT STAGES & THE CLIENT TIMELINE (Settings → Experience).
// The standard stages stay the same underneath (reports, rules and every screen agree); each business renames them for
// its niche, per kind of visit. And the business decides what clients see on their visit link.
import { Section, Row, Toggle, More } from '@/components/settings/settings-ui';
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { stageLabel, clientTimelineSettingsOf, type Stage, type VisitKind } from '@/lib/visit';

const STAGES: Stage[] = ['requested', 'booked', 'arrived', 'waiting', 'in_service', 'ready_to_pay', 'complete'];
const KINDS: [VisitKind, string, any][] = [['service', 'Services', {}], ['table', 'Tables', { tableId: 'x' }], ['class', 'Classes', { classId: 'x' }], ['event', 'Events', { eventId: 'x' }], ['virtual', 'Video / phone', { kind: 'virtual' }]];

export function VisitStagesCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [labels, setLabels] = React.useState<any>(tenant?.visitStageLabels || {});
  const [tl, setTl] = React.useState(clientTimelineSettingsOf(tenant));
  const [kind, setKind] = React.useState<VisitKind>('service'); const [msg, setMsg] = React.useState<string | null>(null);
  const timer = React.useRef<any>(null);
  const save = (patch: any) => { setMsg(null); clearTimeout(timer.current);
    timer.current = setTimeout(async () => { try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), patch); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } }, 600); };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const sample = KINDS.find(([k]) => k === kind)?.[2] || {};
  const setLabel = (st: Stage, v: string) => { const next = { ...labels, [kind]: { ...(labels[kind] || {}), [st]: v.slice(0, 30) } }; if (!v.trim()) delete next[kind][st]; setLabels(next); save({ visitStageLabels: next }); };
  const setT = (patch: any) => { const next = { ...tl, ...patch }; setTl(next); save({ visitTimeline: next, visitTimelineForClients: next.on }); };
  return (
    <div className="space-y-10">
      <Section title="What clients see" help="Their visit link shows where things are — booked, arrived, in service, ready to pay.">
        <Row label="Show clients their visit as it happens" inline><Toggle checked={tl.on} disabled={!canEdit} onChange={(v) => setT({ on: v })} label="Show clients their visit as it happens" /></Row>
        {tl.on && (<>
          <Row label="Show the times" inline><Toggle checked={tl.showTimes} disabled={!canEdit} onChange={(v) => setT({ showTimes: v })} label="Show the times" /></Row>
          <Row label="Include notes staff share with the client" help="Only notes marked to share. Team notes, payment detail and who did what are never shown." inline><Toggle checked={tl.notes} disabled={!canEdit} onChange={(v) => setT({ notes: v })} label="Include shared notes" /></Row>
          <Row label="Steps clients see"><div className="flex flex-wrap gap-1.5">{(['booked', 'arrived', 'waiting', 'in_service', 'ready_to_pay', 'complete'] as Stage[]).map((st) => { const on = tl.stages.includes(st);
            return <button key={st} type="button" aria-pressed={on} disabled={!canEdit} onClick={() => setT({ stages: on ? tl.stages.filter((x) => x !== st) : [...tl.stages, st] })} className={`rounded-full border px-3 py-1 ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}>{stageLabel(st, {}, { ...tenant, visitStageLabels: labels })}</button>; })}</div></Row>
        </>)}
      </Section>
      <More label="Rename the steps" help="Use your own words — for example “Being seated” instead of “Waiting”.">
        <div className="cf-sheet space-y-3 p-5">
          <p className="text-[14px] cf-muted">Every visit goes Booked → Arrived → Waiting → In service → Ready to pay → Complete. Waiting can be skipped.</p>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">{KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 ${kind === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
        <div className="grid gap-2 sm:grid-cols-2">{STAGES.map((st) => { const std = stageLabel(st, sample, { ...tenant, visitStageLabels: {} });
          return <label key={st} className="flex items-center gap-2"><span className="w-28 shrink-0 text-xs text-muted-foreground">{std}</span>
            <input value={labels?.[kind]?.[st] || ''} onChange={(e) => setLabel(st, e.target.value)} placeholder={std} disabled={!canEdit} aria-label={`Your name for “${std}”`} className="h-10 min-w-0 flex-1 rounded-xl border px-3" /></label>; })}</div>
        <p className="text-xs text-muted-foreground">Leave a box blank to keep the standard name.</p>
      </div>
        </div>
      </More>
      {!canEdit && <p className="text-[13.5px] cf-muted">Only a manager can change these.</p>}
      {msg && <p role="status" className="text-[14px] font-medium">{msg}</p>}
    </div>
  );
}
