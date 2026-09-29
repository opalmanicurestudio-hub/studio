'use client';
// src/components/ops/CallLog.tsx — LOG A CALL (desk) and the CALLS section of Needs attention.
// Record once, route to the right people, track only the follow-through that's needed.
import * as React from 'react';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { DESK_CSS, Btn, Seg } from '@/components/pos/desk/kit';
import { callbackReasonsFor } from '@/lib/callback-reasons';

async function callsPost(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
const first = (n: any) => String(n || '').split(' ')[0];
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const Chip = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) =>
  <button type="button" aria-pressed={on} onClick={onClick} className="rounded-full px-3 py-1.5 text-[13px] font-medium transition" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--soft)', color: 'var(--ink)' }}>{children}</button>;
const H = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] font-semibold">{children}</p>;

/** Open calls + the AI receptionist's open items (for the panel and the badge). */
export function useOpenCalls(tenantId?: string | null) {
  const { firestore } = useFirebase() as any;
  const cq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/calls`), where('status', '==', 'open')) : null), [firestore, tenantId]);
  const vq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/voiceInbox`), where('status', '==', 'open')) : null), [firestore, tenantId]);
  const { data: calls } = useCollection<any>(cq); const { data: voice } = useCollection<any>(vq);
  return { calls: calls || [], voice: voice || [] };
}
/** What counts on the Needs attention badge: urgent, overdue actions, messages nobody has acknowledged. */
export const callsNeedingAttention = (calls: any[], now = Date.now()) => calls.filter((c) => c.outcome === 'urgent'
  || (c.outcome === 'action' && c.dueAt && Date.parse(c.dueAt) < now) || (c.ackNeeded && !(c.recipients || []).some((r: any) => r.ackedAt)) || !!c.handedBackAt).length;

export function LogCallSheet({ open, onClose, tenantId, tenant, clients, staff, appointments, uid }: {
  open: boolean; onClose: () => void; tenantId: string; tenant: any; clients: any[]; staff: any[]; appointments: any[]; uid?: string | null;
}) {
  const [q, setQ] = React.useState(''); const [client, setClient] = React.useState<any>(null);
  const [name, setName] = React.useState(''); const [phone, setPhone] = React.useState('');
  const [apptId, setApptId] = React.useState(''); const [reason, setReason] = React.useState('');
  const [summary, setSummary] = React.useState(''); const [privateNote, setPrivateNote] = React.useState('');
  const [outcome, setOutcome] = React.useState<'logged' | 'message' | 'action' | 'callback' | 'urgent'>('message');
  const [to, setTo] = React.useState<string[]>([]); const [ask, setAsk] = React.useState(''); const [dueAt, setDueAt] = React.useState('');
  const [sendLink, setSendLink] = React.useState<'' | 'book' | 'visit'>(''); const [promised, setPromised] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null); const [done, setDone] = React.useState<string | null>(null);
  const reset = () => { setQ(''); setClient(null); setName(''); setPhone(''); setApptId(''); setReason(''); setSummary(''); setPrivateNote(''); setOutcome('message'); setTo([]); setAsk(''); setDueAt(''); setSendLink(''); setPromised(''); setErr(null); setDone(null); };
  React.useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = React.useMemo(() => { const t = q.trim().toLowerCase(); if (t.length < 2) return []; const d = t.replace(/\D/g, '');
    return (clients || []).filter((c: any) => String(c.name || '').toLowerCase().includes(t) || (d.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(d))).slice(0, 5); }, [q, clients]);
  const theirAppts = React.useMemo(() => (client ? (appointments || []).filter((a: any) => a.clientId === client.id && Date.parse(a.startTime) > Date.now() - 864e5 && !['cancelled', 'canceled'].includes(String(a.status))).sort((x: any, y: any) => Date.parse(x.startTime) - Date.parse(y.startTime)).slice(0, 4) : []), [client, appointments]);
  if (!open) return null;
  const team = (staff || []).filter((m: any) => m.isActive !== false);
  const needsWho = ['message', 'action', 'urgent'].includes(outcome);
  const save = async () => {
    setBusy(true); setErr(null);
    const r: any = await callsPost({ tenantId, action: 'create', callerName: client?.name || name, callerPhone: client?.phone || phone, callerEmail: client?.email || null, clientId: client?.id || null,
      appointmentId: apptId || null, reason: reason || null, summary, privateNote, outcome, ask, dueAt: dueAt ? new Date(dueAt).toISOString() : null, callerWaiting: outcome === 'urgent', promised,
      recipients: to.map((id) => (id === 'managers' ? { type: 'role', id } : { type: 'staff', id })), sendLink: sendLink || null, callbackOwnerId: outcome === 'callback' ? (to[0] && to[0] !== 'managers' ? to[0] : uid) : null });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t save.'); return; }
    const who = to.map((id) => (id === 'managers' ? 'managers' : first(team.find((m: any) => m.id === id)?.name))).join(', ');
    setDone(outcome === 'logged' ? 'Logged for reference.' : outcome === 'callback' ? 'Logged — it’s in the callback queue.' : `Logged and passed to ${who}${outcome === 'urgent' ? ' (urgent)' : ''}.${r.linkSent ? ' They’ve been texted the link.' : ''}`);
  };
  const inp = 'h-11 w-full rounded-xl px-3.5 text-[15px] outline-none'; const inpS = { background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)' } as React.CSSProperties;
  const accent = tenant?.bookingPageSettings?.cfPageConfig?.accentColor || tenant?.brandColor || 'hsl(var(--primary))';
  return (
    <div className="desk fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(28,25,23,.45)', ['--accent' as any]: accent, ['--accent-ink' as any]: '#fff' }} onClick={onClose}>
      <style>{DESK_CSS}</style>
      <div role="dialog" aria-modal="true" aria-label="Log a call" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-xl flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <header className="flex items-center justify-between px-5 pb-3 pt-5"><p className="text-[20px] font-semibold">{done ? 'Logged' : 'Log a call'}</p><Btn quiet onClick={onClose}>Close</Btn></header>
        {done ? <div className="space-y-3 px-5"><p className="rounded-3xl p-4 text-[15px]" style={{ background: 'var(--card)' }}>{done}</p><div className="grid grid-cols-2 gap-2"><Btn quiet big onClick={reset}>Log another</Btn><Btn big onClick={onClose}>Done</Btn></div></div> : <>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
            <section className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
              <H>Who called</H>
              {client ? <div className="flex items-center justify-between"><p className="text-[15px] font-semibold">{client.name} <span className="font-normal" style={{ color: 'var(--muted)' }}>{client.phone}</span></p><Btn quiet onClick={() => { setClient(null); setApptId(''); }}>Change</Btn></div> : <>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients — or type below for someone new" className={inp} style={inpS} />
                {matches.map((c: any) => <button key={c.id} type="button" onClick={() => { setClient(c); setQ(''); }} className="flex w-full justify-between rounded-2xl p-3 text-left" style={{ background: 'var(--soft)' }}><span>{c.name}</span><span style={{ color: 'var(--muted)' }}>{c.phone}</span></button>)}
                <div className="grid grid-cols-2 gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inp} style={inpS} /><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" className={inp} style={inpS} /></div>
              </>}
              {theirAppts.length > 0 && <div className="flex flex-wrap gap-1.5"><span className="text-[13px]" style={{ color: 'var(--muted)' }}>About:</span>{theirAppts.map((a: any) => <Chip key={a.id} on={apptId === a.id} onClick={() => setApptId(apptId === a.id ? '' : a.id)}>{new Date(a.startTime).toLocaleDateString('en-US', { weekday: 'short' })} {hm(a.startTime)} {a.serviceName || ''}</Chip>)}</div>}
            </section>
            <section className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
              <H>What’s it about?</H>
              <div className="flex flex-wrap gap-1.5">{callbackReasonsFor(tenant).map((r) => <Chip key={r.id} on={reason === r.id} onClick={() => setReason(reason === r.id ? '' : r.id)}>{r.label}</Chip>)}</div>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="What they said — in their words" className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[15px] outline-none" style={inpS} />
              <textarea value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} rows={2} placeholder="Private note (team only — never shown to the person you pass this to)" className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[14px] outline-none" style={inpS} />
            </section>
            <section className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
              <H>What happens next</H>
              <Seg label="What happens next" value={outcome} onChange={(v) => setOutcome(v)} options={[['logged', 'Just log it'], ['message', 'Pass on a message'], ['action', 'Action needed'], ['callback', 'Callback'], ['urgent', 'Urgent']]} />
              {(needsWho || outcome === 'callback') && <><p className="text-[13px]" style={{ color: 'var(--muted)' }}>{outcome === 'callback' ? 'Who calls back (optional — otherwise anyone at the desk)' : 'Who needs to know'}</p>
                <div className="flex flex-wrap gap-1.5">{team.map((m: any) => <Chip key={m.id} on={to.includes(m.id)} onClick={() => setTo((x) => (outcome === 'callback' ? (x.includes(m.id) ? [] : [m.id]) : x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}>{m.id === uid ? 'Me' : first(m.name)}{m.renterId ? ' (renter)' : ''}</Chip>)}
                  {outcome !== 'callback' && <Chip on={to.includes('managers')} onClick={() => setTo((x) => (x.includes('managers') ? x.filter((y) => y !== 'managers') : [...x, 'managers']))}>Managers</Chip>}</div></>}
              {(outcome === 'message' || outcome === 'action' || outcome === 'urgent') && <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What they need to do (e.g. confirm she can start 15 minutes later)" className={inp} style={inpS} />}
              {outcome === 'action' && <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inp} style={inpS} aria-label="Needs doing by" />}
              {outcome === 'urgent' && <p className="text-[13px]" style={{ color: 'var(--warn)' }}>They’re told right now, by text as well — and managers too.</p>}
              {outcome === 'callback' && <input value={promised} onChange={(e) => setPromised(e.target.value)} placeholder="What you told them (optional)" className={inp} style={inpS} />}
              {(client?.phone || phone) && <div className="flex flex-wrap items-center gap-1.5"><span className="text-[13px]" style={{ color: 'var(--muted)' }}>Text them a link now:</span>
                <Chip on={sendLink === 'book'} onClick={() => setSendLink(sendLink === 'book' ? '' : 'book')}>Booking page</Chip>
                {apptId && <Chip on={sendLink === 'visit'} onClick={() => setSendLink(sendLink === 'visit' ? '' : 'visit')}>Their visit link</Chip>}</div>}
            </section>
          </div>
          <footer className="space-y-2 border-t px-5 pb-5 pt-3" style={{ borderColor: 'var(--line)' }}>
            {err && <p role="alert" className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
            <Btn big onClick={save} disabled={busy || !summary.trim()}>{busy ? 'Saving…' : outcome === 'logged' ? 'Log it' : outcome === 'callback' ? 'Log and add to callbacks' : 'Log and pass it on'}</Btn>
          </footer>
        </>}
      </div>
    </div>
  );
}

const RES: [string, string][] = [['answered', 'Answered'], ['booked', 'Booked'], ['passed_on', 'Passed on'], ['no_action', 'Nothing needed'], ['other', 'Something else']];
export function CallsPanel({ tenantId, uid, role, staff }: { tenantId: string; uid?: string | null; role?: string; staff: any[] }) {
  const { firestore } = useFirebase() as any;
  const { calls, voice } = useOpenCalls(tenantId);
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<Record<string, string>>({});
  const [openFor, setOpenFor] = React.useState<{ id: string; kind: 'done' | 'pass' } | null>(null);
  const [res, setRes] = React.useState('answered'); const [note, setNote] = React.useState(''); const [passTo, setPassTo] = React.useState('');
  if (!calls.length && !voice.length) return null;
  const now = Date.now(); const mgr = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const rank = (c: any) => (c.outcome === 'urgent' ? 0 : c.handedBackAt ? 1 : c.outcome === 'action' && Date.parse(c.dueAt || '') < now ? 2 : c.ackNeeded && !(c.recipients || []).some((r: any) => r.ackedAt) ? 3 : 4);
  const list = [...calls].sort((a, b) => rank(a) - rank(b) || Date.parse(b.at) - Date.parse(a.at));
  const act = async (c: any, body: any, ok: string) => { setBusy(c.id); const r = await callsPost({ tenantId, id: c.id, ...body }); setBusy(null); setMsg((m) => ({ ...m, [c.id]: r?.ok ? ok : r?.error || 'That didn’t save.' })); if (r?.ok) { setOpenFor(null); setNote(''); } };
  const btn = 'rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
  return (
    <section className="space-y-3 rounded-3xl border bg-card p-4">
      <div className="flex items-baseline justify-between"><p className="font-semibold">Calls</p><p className="text-xs text-muted-foreground">{callsNeedingAttention(calls)} need attention · {calls.length} open</p></div>
      {list.map((c: any) => {
        const mine = (c.recipients || []).some((r: any) => r.id === uid || (r.type === 'role' && mgr));
        const acked = (c.recipients || []).filter((r: any) => r.ackedAt).map((r: any) => first(r.name));
        const overdue = c.outcome === 'action' && Date.parse(c.dueAt || '') < now;
        return <div key={c.id} className={`space-y-1.5 rounded-2xl border p-3 text-sm ${c.outcome === 'urgent' || overdue || c.handedBackAt ? 'border-red-300 bg-red-50/40' : ''}`}>
          <p><span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] ${c.outcome === 'urgent' ? 'bg-red-100 text-red-800' : 'bg-secondary'}`}>{c.outcome === 'urgent' ? 'Urgent' : c.outcome === 'action' ? (overdue ? 'Overdue' : `Action · by ${hm(c.dueAt)}`) : 'Message'}</span>
            <b>{c.callerName}</b>{c.reasonLabel ? ` · ${c.reasonLabel}` : ''} <span className="text-xs text-muted-foreground">{hm(c.at)}</span></p>
          <p>“{c.summary}”{c.ask ? <> — <b>please {c.ask.replace(/^please\s+/i, '')}</b></> : null}</p>
          {c.privateNote && <p className="text-xs text-muted-foreground">Private note: {c.privateNote}</p>}
          <p className="text-xs text-muted-foreground">To {(c.recipients || []).map((r: any) => first(r.name)).join(', ') || '—'} · {acked.length ? `got it: ${acked.join(', ')}` : 'not acknowledged yet'}{c.handedBackBy ? ` · handed back by ${first(c.handedBackBy)}` : ''}</p>
          {(c.history || []).filter((h: any) => /Replied|Handed back/.test(h.what)).slice(-2).map((h: any, i: number) => <p key={i} className="rounded-xl bg-secondary p-2 text-xs">{first(h.by)}: {h.what}</p>)}
          <div className="flex flex-wrap gap-2">
            {c.callerPhone && <a href={`tel:${String(c.callerPhone).replace(/[^\d+]/g, '')}`} className={btn}>Call {first(c.callerName)}</a>}
            {mine && !(c.recipients || []).some((r: any) => (r.id === uid || (r.type === 'role' && mgr)) && r.ackedAt) && <button type="button" disabled={!!busy} onClick={() => act(c, { action: 'ack' }, 'Marked as got it.')} className={btn}>Got it</button>}
            <button type="button" onClick={() => { setOpenFor(openFor?.id === c.id && openFor?.kind === 'pass' ? null : { id: c.id, kind: 'pass' }); setNote(''); setPassTo(''); }} className={btn}>Pass to someone…</button>
            <button type="button" onClick={() => { setOpenFor(openFor?.id === c.id && openFor?.kind === 'done' ? null : { id: c.id, kind: 'done' }); setRes('answered'); setNote(''); }} className={btn}>Done…</button>
          </div>
          {openFor?.id === c.id && openFor?.kind === 'pass' && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary p-2">
            <select value={passTo} onChange={(e) => setPassTo(e.target.value)} className="h-8 rounded-lg border px-2 text-xs"><option value="">Pass to…</option>{(staff || []).filter((m: any) => m.isActive !== false).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (recorded)" className="h-8 flex-1 rounded-lg border px-2 text-xs" />
            <button type="button" disabled={!!busy || !passTo || !note.trim()} onClick={() => act(c, { action: 'reassign', toId: passTo, reason: note }, 'Passed on.')} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">Pass it on</button>
          </div>}
          {openFor?.id === c.id && openFor?.kind === 'done' && <div className="space-y-2 rounded-xl bg-secondary p-2">
            <div className="flex flex-wrap gap-1.5">{RES.map(([k, l]) => <button key={k} type="button" aria-pressed={res === k} onClick={() => setRes(k)} className={`rounded-full border px-3 py-1 text-xs ${res === k ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={res === 'other' ? 'What happened (needed)' : 'Note (optional)'} className="h-8 w-full rounded-lg border px-2 text-xs" />
            <button type="button" disabled={!!busy || (res === 'other' && !note.trim())} onClick={() => act(c, { action: 'resolve', outcome: res, note }, 'Closed.')} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50">Close it</button>
          </div>}
          {msg[c.id] && <p className="text-xs font-semibold">{msg[c.id]}</p>}
        </div>;
      })}
      {voice.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold text-muted-foreground">From the AI receptionist</p>
        {voice.slice(0, 8).map((v: any) => <div key={v.id} className="space-y-1 rounded-2xl border p-3 text-sm">
          <p><span className="mr-2 rounded-full bg-secondary px-2 py-0.5 text-[11px]">{String(v.intent || 'call').replace(/_/g, ' ')}</span><b>{v.callerName || 'Caller'}</b> <span className="text-xs text-muted-foreground">{v.createdAt ? hm(v.createdAt) : ''}</span></p>
          {(v.callSummary || v.details) && <p>{v.callSummary || v.details}</p>}
          <div className="flex flex-wrap gap-2">
            {v.callerPhone && <a href={`tel:${String(v.callerPhone).replace(/[^\d+]/g, '')}`} className={btn}>Call back</a>}
            <a href="/voice" className={btn}>Open in the voice inbox</a>
            <button type="button" disabled={!!busy} onClick={async () => { setBusy(v.id); try { await updateDoc(doc(firestore, `tenants/${tenantId}/voiceInbox/${v.id}`), { status: 'handled', handledAt: new Date().toISOString(), handledBy: uid || null }); } finally { setBusy(null); } }} className={btn}>Mark handled</button>
          </div>
        </div>)}</div>}
    </section>
  );
}
