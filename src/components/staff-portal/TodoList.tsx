'use client';
// src/components/staff-portal/TodoList.tsx — STAFF APP → Today → ONE TO DO LIST (decided Oct 13; design canvas OE2).
// Three bands, most urgent first:
//   Now      — someone is waiting: calls passed to you, call-backs you (or the desk) promised, clients who replied.
//   Today    — follow-up tasks due today, best likely result first.
//   Anytime  — follow-ups due later, and the team's tasks and SOPs with their own dates.
// Each kind keeps its own records and screens (calls → /api/calls, call-backs → /api/callbacks, follow-ups →
// /api/opportunities, team tasks → tasks); this list only shows them together.
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { payPost } from '@/components/pay/pay-client';
import { PortalCalls } from '@/components/staff-portal/PortalCalls';
import { YourTasks } from '@/components/staff-portal/YourTasks';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#2563eb';
const DESK = ['front_desk', 'frontdesk', 'desk', 'receptionist', 'coordinator', 'assistant'];

function Band({ tone, title, sub }: { tone: string; title: string; sub: string }) {
  return <div className="flex items-center gap-2 px-1 pt-1"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} aria-hidden="true" />
    <span className="text-[12.5px] font-extrabold uppercase tracking-[0.05em]">{title}</span><span className="text-[12.5px]" style={{ color: MUTED }}>{sub}</span></div>;
}

async function callbackPost(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/callbacks', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t save. Please try again.' }));
}
const dueText = (d: any) => {
  if (!d.dueAt) return { text: 'No set time', late: false };
  const t = Date.parse(d.dueAt); const mins = Math.round((t - Date.now()) / 60000);
  const at = new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.timePromised) return mins < 0 ? { text: `Promise missed: told them ${at}`, late: true } : { text: `Promised by ${at}`, late: false };
  return mins < 0 ? { text: 'Past the target: call soon', late: true } : { text: mins < 60 ? `Within ${Math.max(1, mins)} min` : `Within ${Math.round(mins / 60)} hr`, late: false };
};

/** A call-back someone was promised: who, why, what they were told, and the three things you do with it. */
function CallbackCard({ d, tenantId, me, onDone }: { d: any; tenantId: string; me: string; onDone: () => void }) {
  const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [closing, setClosing] = React.useState(false);
  const mine = d.ownerId === me; const due = dueText(d); const tel = String(d.callerPhone || '').replace(/[^\d+]/g, '');
  const act = async (key: string, body: any, ok: string) => { setBusy(key); const r = await callbackPost({ tenantId, id: d.id, ...body }); setBusy(''); setMsg(r?.ok ? { ok: true, t: ok } : { ok: false, t: r?.error || 'That didn’t save.' }); if (r?.ok) onDone(); return !!r?.ok; };
  return (
    <div className="space-y-2 rounded-[18px] border bg-white p-3.5" style={{ borderColor: due.late ? '#f3c2bd' : '#f3dfc4' }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-bold">Call back {d.callerName || d.clientName || 'a caller'}</span>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: due.late ? '#fdecec' : '#fdf1e3', color: due.late ? RED : AMBER }}>{due.text}</span></div>
      {(d.reasonLabel || d.callSummary || d.note) && <p className="text-[13px] leading-snug" style={{ color: MUTED }}>{[d.reasonLabel, d.callSummary || d.note].filter(Boolean).join(' · ')}</p>}
      {d.promised && <p className="text-[12.5px]" style={{ color: MUTED }}><b style={{ color: INK }}>They were told:</b> {d.promised}</p>}
      <div className="flex flex-wrap gap-1.5">
        {tel && <a href={`tel:${tel}`} className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold text-white" style={{ background: INK }}>Call</a>}
        {tel && <a href={`sms:${tel}`} className="inline-flex h-10 items-center rounded-full border px-4 text-[13.5px] font-semibold" style={{ borderColor: LINE }}>Text</a>}
        {!mine && <button type="button" disabled={!!busy} onClick={() => act('take', { action: 'update', ownerId: me }, 'It’s yours.')} className="h-10 rounded-full border px-3.5 text-[13px] font-semibold" style={{ borderColor: LINE }}>Take it</button>}
        <button type="button" disabled={!!busy} onClick={() => act('try', { action: 'attempt', note: 'Tried, no answer', nextDueAt: new Date(Date.now() + 3600000).toISOString() }, 'Noted. It’s due again in an hour.')} className="h-10 rounded-full border px-3.5 text-[13px]" style={{ borderColor: LINE }}>No answer</button>
        <button type="button" onClick={() => setClosing(!closing)} className="h-10 rounded-full border px-3.5 text-[13px] font-semibold" style={{ borderColor: LINE }}>Done…</button></div>
      {closing && <div className="flex flex-wrap gap-1.5 rounded-[14px] p-2.5" style={{ background: SOFT }}>
        {([['booked', 'Booked them'], ['answered', 'Answered their question'], ['no_answer', 'Couldn’t reach them'], ['declined', 'Not interested']] as const).map(([k, l]) =>
          <button key={k} type="button" disabled={!!busy} onClick={() => act('done', { action: 'resolve', outcome: k, note: '' }, 'Closed.')} className="h-9 rounded-full bg-white px-3 text-[12.5px] font-semibold">{l}</button>)}</div>}
      {msg && <p className="text-[12.5px] font-semibold" style={{ color: msg.ok ? GREEN : RED }}>{msg.t}</p>}
    </div>);
}

export function TodoList({ tenantId, staffMember, calls, isManager, accent = INK, teamTasks }: { tenantId: string; staffMember: any; calls: any[]; isManager: boolean; accent?: string; teamTasks?: React.ReactNode }) {
  const { firestore } = useFirebase() as any;
  const me = String(staffMember?.id || ''); const desk = isManager || DESK.includes(String(staffMember?.role || '').toLowerCase());
  // Call-backs: mine, or nobody's yet if I'm the desk or a manager.
  const cbQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/callBackDrafts`), where('status', '==', 'pending')) : null), [firestore, tenantId]);
  const { data: cbs } = useCollection<any>(cbQ);
  const promises = React.useMemo(() => (cbs || []).filter((d: any) => d.ownerId === me || (!d.ownerId && desk))
    .sort((a: any, b: any) => (Date.parse(a.dueAt || '') || Infinity) - (Date.parse(b.dueAt || '') || Infinity)), [cbs, me, desk]);
  // Team tasks — only to know whether "Anytime" has anything (the list itself is the team-tasks panel passed in).
  const tQ = useMemoFirebase(() => (firestore && tenantId && me ? query(collection(firestore, `tenants/${tenantId}/tasks`), where('assignedStaffIds', 'array-contains', me)) : null), [firestore, tenantId, me]);
  const { data: tasks } = useCollection<any>(tQ); const teamOpen = (tasks || []).filter((t: any) => t.status !== 'done').length;
  // Follow-ups, loaded once and shared between the bands.
  const [opps, setOpps] = React.useState<any[]>([]);
  const reload = React.useCallback(() => payPost('/api/opportunities', { tenantId, action: 'list' }).then((r) => setOpps(r?.ok ? r.items || [] : [])), [tenantId]);
  React.useEffect(() => { void reload(); }, [reload]);
  const eod = React.useMemo(() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }, []);
  const open = opps.filter((o) => o.status === 'open');
  const replied = open.filter((o) => o.repliedAt); const today = open.filter((o) => !o.repliedAt && (Date.parse(o.dueAt || o.expiresAt || '') || 0) <= eod); const later = open.filter((o) => !o.repliedAt && (Date.parse(o.dueAt || o.expiresAt || '') || 0) > eod);
  const nowCount = calls.length + promises.length + replied.length;
  if (!nowCount && !today.length && !later.length && !teamOpen) return null;
  return (
    <section className="space-y-3" aria-label="To do" style={{ color: INK }}>
      <div className="flex items-end justify-between px-1"><p className="text-[20px] font-light tracking-[-0.02em]">To do</p><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[12px] font-bold text-white" style={{ background: INK }}>{nowCount + today.length + later.length + teamOpen}</span></div>
      {nowCount > 0 && <div className="space-y-2.5">
        <Band tone={RED} title="Now" sub="someone is waiting" />
        {promises.map((d: any) => <CallbackCard key={d.id} d={d} tenantId={tenantId} me={me} onDone={() => undefined} />)}
        <PortalCalls calls={calls} tenantId={tenantId} staffId={me} isManager={isManager} accent={accent} title="Calls passed to you" />
        {replied.length > 0 && <YourTasks tenantId={tenantId} accent={accent} items={replied} reload={reload} title="They replied" sub={`${replied.length} client${replied.length === 1 ? '' : 's'} wrote back`} />}
      </div>}
      {today.length > 0 && <div className="space-y-2.5">
        <Band tone={BLUE} title="Today" sub={`${today.length} follow-up${today.length === 1 ? '' : 's'}`} />
        <YourTasks tenantId={tenantId} accent={accent} items={today} reload={reload} title="Follow-ups" sub="most important first" />
      </div>}
      {(later.length > 0 || teamOpen > 0) && <div className="space-y-2.5">
        <Band tone={MUTED} title="Anytime" sub="with their own dates" />
        {later.length > 0 && <YourTasks tenantId={tenantId} accent={accent} items={later} reload={reload} title="Follow-ups coming up" sub={`${later.length} due later`} />}
        {teamOpen > 0 && teamTasks}
      </div>}
    </section>);
}
