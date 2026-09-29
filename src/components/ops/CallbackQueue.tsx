'use client';
// src/components/ops/CallbackQueue.tsx — "I'll have someone call you back", tracked.
// Every pending call-back (saved at the desk, or by the AI receptionist):
// who, why, what they were told, who owns it, when it's due. Overdue first.
// Call / Text · Assign to me · Tried, no answer · Done (with what happened).
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/callbacks', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));
}

/** Pending call-backs for this business, live. */
export function usePendingCallbacks(tenantId?: string | null) {
  const { firestore } = useFirebase() as any;
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/callBackDrafts`), where('status', '==', 'pending')) : null), [firestore, tenantId]);
  const { data } = useCollection<any>(q);
  return data || [];
}
/** How many are overdue (for the Needs attention badge). */
export const overdueCallbacks = (list: any[], now = Date.now()) => list.filter((d) => d.dueAt && Date.parse(d.dueAt) < now).length;   // past a promise or a target

const OUTCOMES: [string, string][] = [['booked', 'Booked'], ['answered', 'Answered their question'], ['no_answer', 'Couldn’t reach them'], ['declined', 'Not interested'], ['other', 'Something else']];
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** A promised time (told to the caller) vs the reason's internal target (never told). */
function dueLabel(d: any, now = Date.now()) {
  const iso = d.dueAt; if (!iso) return { text: 'No target', late: false, missed: false };
  const t = Date.parse(iso); const mins = Math.round((t - now) / 60000);
  const at = new Date(t).toDateString() === new Date(now).toDateString() ? hm(iso) : new Date(t).toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  if (d.timePromised) return mins < 0 ? { text: `Promise missed — told them ${at}`, late: true, missed: true } : { text: `Promised by ${at}`, late: false, missed: false };
  if (mins < 0) return { text: 'Past target — call soon', late: true, missed: false };
  return { text: mins < 60 ? `Aim: within ${Math.max(1, mins)} min` : `Aim: within ${Math.round(mins / 60)} hr`, late: false, missed: false };
}

export function CallbackQueue({ tenantId, uid }: { tenantId: string; uid?: string | null }) {
  const list = usePendingCallbacks(tenantId);
  const [openDone, setOpenDone] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState('booked'); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<Record<string, string>>({});
  if (!list.length) return null;
  // Missed promises first (the caller was told a time), then by how soon each is due.
  const sorted = [...list].sort((a, b) => (Number(dueLabel(b).missed) - Number(dueLabel(a).missed)) || ((Date.parse(a.dueAt || '') || Infinity) - (Date.parse(b.dueAt || '') || Infinity)));
  const act = async (id: string, key: string, body: any, okText: string) => {
    setBusy(`${id}:${key}`); const r = await post({ tenantId, id, ...body }); setBusy(null);
    setMsg((m) => ({ ...m, [id]: r?.ok ? okText : r?.error || 'That didn’t save.' }));
    return r?.ok;
  };
  return (
    <section className="space-y-3 rounded-3xl border bg-card p-4">
      <div className="flex items-baseline justify-between"><p className="font-semibold">Callbacks</p><p className="text-xs text-muted-foreground">{sorted.length} waiting · {overdueCallbacks(sorted)} overdue</p></div>
      {sorted.map((d: any) => {
        const due = dueLabel(d); const phone = String(d.callerPhone || '').trim(); const tel = phone.replace(/[^\d+]/g, '');
        return (
          <div key={d.id} className={`space-y-2 rounded-2xl border p-3 ${due.late ? 'border-red-300 bg-red-50/40' : ''}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{d.reasonLabel && <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] ${d.urgent ? 'bg-red-100 text-red-800' : 'bg-secondary'}`}>{d.reasonLabel}</span>}{d.callerName || d.clientName || 'Unknown caller'}{phone && <span className="ml-2 font-normal text-muted-foreground">{phone}</span>}</p>
              <p className={`text-xs ${due.late ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{due.text}</p>
            </div>
            {(d.callSummary || d.note) && <p className="text-sm">{d.callSummary || d.note}</p>}
            {d.promised && <p className="text-xs text-muted-foreground"><b>They were told:</b> {d.promised}</p>}
            {Array.isArray(d.callerAdded) && d.callerAdded.length > 0 && <div className="rounded-xl bg-secondary p-2 text-sm">
              <p className="text-xs font-semibold">They added (from their link):</p>
              {d.callerAdded.slice(-3).map((x: any, i: number) => <p key={i} className="whitespace-pre-wrap">“{x.text}”</p>)}
            </div>}
            <p className="text-xs text-muted-foreground">
              {d.source === 'ai_receptionist' ? 'From the AI receptionist · ' : ''}{d.ownerName ? `${String(d.ownerName).split(' ')[0]} is calling back` : 'Unassigned'}
              {d.contactBy && d.contactBy !== 'call' ? ` · prefers ${d.contactBy === 'text' ? 'a text' : 'an email'}` : ''}
              {Array.isArray(d.attempts) && d.attempts.length ? ` · ${d.attempts.length} tr${d.attempts.length === 1 ? 'y' : 'ies'} (last: ${d.attempts[d.attempts.length - 1].note})` : ''}
              {d.confirmationSentAt ? ` · we ${d.confirmationSentBy === 'email' ? 'emailed' : 'texted'} them when to expect us` : ''}
              {d.snapshot ? ' · booking details saved' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {tel && <a href={`tel:${tel}`} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Call</a>}
              {tel && <a href={`sms:${tel}`} className="rounded-full border px-3 py-1.5 text-xs font-semibold">Text</a>}
              {d.callerEmail && <a href={`mailto:${d.callerEmail}`} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${d.contactBy === 'email' && !tel ? 'bg-primary text-primary-foreground' : 'border'}`}>Email</a>}
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('cf:resume-callback', { detail: d }))} className="rounded-full border px-3 py-1.5 text-xs font-semibold">{d.snapshot ? 'Resume booking' : 'Book for them'}</button>
              {uid && d.ownerId !== uid && <button type="button" disabled={!!busy} onClick={() => act(d.id, 'mine', { action: 'update', ownerId: uid }, 'It’s yours.')} className="rounded-full border px-3 py-1.5 text-xs">Assign to me</button>}
              <button type="button" disabled={!!busy} onClick={() => act(d.id, 'try', { action: 'attempt', note: 'Tried — no answer', nextDueAt: new Date(Date.now() + 3600000).toISOString() }, 'Noted — due again in an hour.')} className="rounded-full border px-3 py-1.5 text-xs">Tried — no answer</button>
              <button type="button" onClick={() => { setOpenDone(openDone === d.id ? null : d.id); setOutcome('booked'); setNote(''); }} className="rounded-full border px-3 py-1.5 text-xs font-semibold">Done…</button>
            </div>
            {openDone === d.id && <div className="space-y-2 rounded-xl bg-secondary p-3">
              <p className="text-xs font-semibold">What happened?</p>
              <div className="flex flex-wrap gap-1.5">{OUTCOMES.map(([k, l]) => <button key={k} type="button" aria-pressed={outcome === k} onClick={() => setOutcome(k)} className={`rounded-full border px-3 py-1 text-xs ${outcome === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === 'other' ? 'A short note (needed)' : 'Note (optional)'} className="h-9 w-full rounded-lg border px-3 text-sm" />
              <button type="button" disabled={!!busy || (outcome === 'other' && !note.trim())} onClick={async () => { if (await act(d.id, 'done', { action: 'resolve', outcome, note }, 'Closed.')) setOpenDone(null); }} className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{busy === `${d.id}:done` ? 'Saving…' : 'Close it'}</button>
            </div>}
            {msg[d.id] && <p className="text-xs font-semibold">{msg[d.id]}</p>}
          </div>
        );
      })}
    </section>
  );
}
