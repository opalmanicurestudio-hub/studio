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
export const overdueCallbacks = (list: any[], now = Date.now()) => list.filter((d) => d.dueAt && Date.parse(d.dueAt) < now).length;

const OUTCOMES: [string, string][] = [['booked', 'Booked'], ['answered', 'Answered their question'], ['no_answer', 'Couldn’t reach them'], ['declined', 'Not interested'], ['other', 'Something else']];
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
function dueLabel(iso?: string | null, now = Date.now()) {
  if (!iso) return { text: 'No due time', late: false };
  const t = Date.parse(iso); const mins = Math.round((t - now) / 60000);
  if (mins < 0) return { text: `Overdue — was due ${new Date(t).toDateString() === new Date(now).toDateString() ? hm(iso) : new Date(t).toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, late: true };
  if (mins < 60) return { text: `Due in ${mins} min`, late: false };
  return { text: `Due ${new Date(t).toDateString() === new Date(now).toDateString() ? `at ${hm(iso)}` : new Date(t).toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, late: false };
}

export function CallbackQueue({ tenantId, uid }: { tenantId: string; uid?: string | null }) {
  const list = usePendingCallbacks(tenantId);
  const [openDone, setOpenDone] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState('booked'); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<Record<string, string>>({});
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => (Date.parse(a.dueAt || '') || Infinity) - (Date.parse(b.dueAt || '') || Infinity));
  const act = async (id: string, key: string, body: any, okText: string) => {
    setBusy(`${id}:${key}`); const r = await post({ tenantId, id, ...body }); setBusy(null);
    setMsg((m) => ({ ...m, [id]: r?.ok ? okText : r?.error || 'That didn’t save.' }));
    return r?.ok;
  };
  return (
    <section className="space-y-3 rounded-3xl border bg-card p-4">
      <div className="flex items-baseline justify-between"><p className="font-semibold">Callbacks</p><p className="text-xs text-muted-foreground">{sorted.length} waiting · {overdueCallbacks(sorted)} overdue</p></div>
      {sorted.map((d: any) => {
        const due = dueLabel(d.dueAt); const phone = String(d.callerPhone || '').trim(); const tel = phone.replace(/[^\d+]/g, '');
        return (
          <div key={d.id} className={`space-y-2 rounded-2xl border p-3 ${due.late ? 'border-red-300 bg-red-50/40' : ''}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{d.callerName || d.clientName || 'Unknown caller'}{phone && <span className="ml-2 font-normal text-muted-foreground">{phone}</span>}</p>
              <p className={`text-xs ${due.late ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>{due.text}</p>
            </div>
            {(d.callSummary || d.note) && <p className="text-sm">{d.callSummary || d.note}</p>}
            {d.promised && <p className="text-xs text-muted-foreground"><b>They were told:</b> {d.promised}</p>}
            <p className="text-xs text-muted-foreground">
              {d.source === 'ai_receptionist' ? 'From the AI receptionist · ' : ''}{d.ownerName ? `${String(d.ownerName).split(' ')[0]} is calling back` : 'Unassigned'}
              {d.contactBy && d.contactBy !== 'call' ? ` · prefers ${d.contactBy === 'text' ? 'a text' : 'an email'}` : ''}
              {Array.isArray(d.attempts) && d.attempts.length ? ` · ${d.attempts.length} tr${d.attempts.length === 1 ? 'y' : 'ies'} (last: ${d.attempts[d.attempts.length - 1].note})` : ''}
              {d.confirmationSentAt ? ` · we ${d.confirmationSentBy === 'email' ? 'emailed' : 'texted'} them when to expect us` : ''}
              {d.snapshot ? ' · booking details saved — resume from Quick book' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {tel && <a href={`tel:${tel}`} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Call</a>}
              {tel && <a href={`sms:${tel}`} className="rounded-full border px-3 py-1.5 text-xs font-semibold">Text</a>}
              {d.callerEmail && <a href={`mailto:${d.callerEmail}`} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${d.contactBy === 'email' && !tel ? 'bg-primary text-primary-foreground' : 'border'}`}>Email</a>}
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
