'use client';
// src/components/pos/desk/AssistQueue.tsx — STATION ASSIST (O4) on the desk: ask for help, and answer it.
// One queue: station requests (towels, supplies, a hand, a drink for a client…), lounge orders and supply restocks,
// escalated first. Station requests: I'll get it → Delivered, Suggest a swap (the requester approves), Cancel.
// Lounge orders: Bringing it (the guest is told) → Delivered (the shared delivery step). Restocks: review in Inventory.
import * as React from 'react';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useMemoFirebase } from '@/firebase';
import { assistQueue, ASSIST_PRESETS, URGENCY_LABEL, type AssistKind, type AssistUrgency, type QueueItem } from '@/lib/assist';
import { deliverRefreshment, bringingRefreshmentPatch } from '@/lib/lounge-delivery';

async function api(body: any) { const tk = await getAuth().currentUser?.getIdToken();
  const r = await fetch('/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'That didn’t work.' })); }

export function useAssistQueue(firestore: any, tenantId: string | null) {
  const aQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'assistRequests'), where('status', 'in', ['open', 'accepted'])) : null), [firestore, tenantId]);
  const lQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'refreshmentRequests'), where('status', '==', 'pending')) : null), [firestore, tenantId]);
  const rQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, 'tenants', tenantId, 'staffReplenishmentRequests'), where('status', '==', 'pending')) : null), [firestore, tenantId]);
  const { data: a } = useCollection<any>(aQ); const { data: l } = useCollection<any>(lQ); const { data: r } = useCollection<any>(rQ);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  return React.useMemo(() => assistQueue(a || [], l || [], r || [], now), [a, l, r, now]);
}

/** "Ask for help" — from a busy station (station + client filled in) or from the queue. */
export function AskForHelp({ tenantId, context, onDone }: { tenantId: string; context?: { resourceId?: string; stationName?: string; visitId?: string | null; clientName?: string | null }; onDone?: () => void }) {
  const [kind, setKind] = React.useState<AssistKind | null>(null); const [label, setLabel] = React.useState('');
  const [urgency, setUrgency] = React.useState<AssistUrgency>('soon'); const [by, setBy] = React.useState(''); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<string | null>(null);
  const send = async () => {
    setBusy(true); setMsg(null);
    let neededBy: string | null = null; if (urgency === 'by' && by) { const [h, m] = by.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); neededBy = d.toISOString(); }
    const r = await api({ action: 'create', tenantId, kind, label: label || ASSIST_PRESETS.find((p) => p.kind === kind)?.label, note, urgency, neededBy, ...context });
    setBusy(false); if (r.ok) { setMsg('Sent — you’ll be told when someone’s on the way.'); setKind(null); setNote(''); setTimeout(() => onDone?.(), 900); } else setMsg(r.error || 'That didn’t send.');
  };
  return (
    <div className="space-y-3">
      {context?.stationName && <p className="text-[13px] text-muted-foreground">For {context.stationName}{context.clientName ? ` · ${context.clientName}` : ''}</p>}
      <div className="flex flex-wrap gap-2">{ASSIST_PRESETS.map((p) => (
        <button key={p.kind} type="button" onClick={() => { setKind(p.kind); setLabel(p.kind === 'other' ? '' : p.label); }} aria-pressed={kind === p.kind}
          className={`h-11 rounded-full border px-4 text-[14px] font-medium ${kind === p.kind ? 'bg-stone-900 text-white' : 'bg-white'}`}>{p.label}</button>))}</div>
      {kind && <>
        {kind === 'other' && <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="What do you need?" className="h-11 w-full rounded-xl border px-3 text-[15px]" />}
        <div className="flex flex-wrap gap-2">{(Object.keys(URGENCY_LABEL) as AssistUrgency[]).map((u) => (
          <button key={u} type="button" onClick={() => setUrgency(u)} aria-pressed={urgency === u} className={`h-10 rounded-full border px-3 text-[13px] ${urgency === u ? 'bg-stone-900 text-white' : 'bg-white'}`}>{URGENCY_LABEL[u]}</button>))}
          {urgency === 'by' && <input type="time" value={by} onChange={(e) => setBy(e.target.value)} className="h-10 rounded-xl border px-2 text-[14px]" aria-label="Needed by" />}</div>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Details (optional) — e.g. 2 hand towels" className="h-11 w-full rounded-xl border px-3 text-[14px]" />
        <button type="button" disabled={busy || (kind === 'other' && !label.trim()) || (urgency === 'by' && !by)} onClick={send} className="h-11 w-full rounded-full bg-stone-900 text-[14px] font-semibold text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send request'}</button>
      </>}
      {msg && <p role="status" className="text-[13px] font-medium">{msg}</p>}
    </div>
  );
}

export function AssistQueue({ firestore, tenantId, inventory, user }: { firestore: any; tenantId: string; inventory: any[]; user: any }) {
  const items = useAssistQueue(firestore, tenantId);
  const [busy, setBusy] = React.useState<string | null>(null); const [err, setErr] = React.useState<string | null>(null);
  const [swap, setSwap] = React.useState<{ id: string; text: string } | null>(null); const [asking, setAsking] = React.useState(false);
  const run = async (key: string, fn: () => Promise<any>) => { setBusy(key); setErr(null); try { const r = await fn(); if (r && r.ok === false) setErr(r.error || 'That didn’t work.'); } catch { setErr('That didn’t work — try again.'); } setBusy(null); };
  const act = (q: QueueItem, action: string, extra: any = {}) => run(q.id + action, () => api({ action, tenantId, id: q.id, ...extra }));
  const lounge = {
    bringing: (q: QueueItem) => run(q.id + 'b', async () => { await updateDoc(doc(firestore, 'tenants', tenantId, 'refreshmentRequests', q.id), bringingRefreshmentPatch(user));
      void fetch('/api/retail/lounge-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, requestId: q.id, moment: 'out' }), keepalive: true }).catch(() => undefined); return { ok: true }; }),
    delivered: (q: QueueItem) => run(q.id + 'd', async () => ({ ok: await deliverRefreshment(firestore, tenantId, q.raw, inventory, user), error: 'That item isn’t in your inventory any more.' })),
  };
  const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setAsking((v) => !v)} className="h-11 w-full rounded-full border-2 text-[14px] font-semibold">{asking ? 'Close' : 'Ask for help'}</button>
      {asking && <div className="rounded-2xl border bg-white p-3"><AskForHelp tenantId={tenantId} onDone={() => setAsking(false)} /></div>}
      {err && <p role="alert" className="text-[13px] font-medium text-red-700">{err}</p>}
      {!items.length && <p className="text-[14px] text-muted-foreground">Nothing waiting — all caught up.</p>}
      {items.map((q) => (
        <div key={q.source + q.id} className={`space-y-2 rounded-2xl border p-3 ${q.escalated ? 'border-red-300 bg-red-50' : 'bg-white'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{q.title}{q.where ? ` · ${q.where}` : ''}</p>
              <p className="text-[12px] text-muted-foreground">{[q.requester, q.forClient && `for ${q.forClient}`, q.urgency === 'by' && q.neededBy ? `needed by ${time(q.neededBy)}` : q.urgency === 'now' ? 'needed now' : null, `${q.ageMin} min ago`].filter(Boolean).join(' · ')}</p>
              {q.detail && <p className="text-[13px]">“{q.detail}”</p>}
              {q.status === 'accepted' && <p className="text-[12px] font-medium text-emerald-700">{q.acceptedBy || 'Someone'} is on it</p>}
              {q.escalated && <p className="text-[12px] font-semibold text-red-700">Nobody has taken this yet</p>}
              {q.sub && !q.sub.decision && <p className="text-[13px] text-amber-800">{q.sub.by} suggests “{q.sub.text}” instead — waiting for {q.requester || 'the requester'}</p>}
              {q.sub?.decision && <p className="text-[12px] text-muted-foreground">Swap {q.sub.decision}: “{q.sub.text}”</p>}
            </div>
            <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[11px]">{q.source === 'lounge' ? 'Lounge' : q.source === 'restock' ? 'Restock' : 'Station'}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {q.source === 'assist' && <>
              {q.status === 'open' && <button type="button" disabled={!!busy} onClick={() => act(q, 'accept')} className="h-9 rounded-full bg-stone-900 px-3 text-[13px] font-semibold text-white">I’ll get it</button>}
              <button type="button" disabled={!!busy} onClick={() => act(q, 'deliver')} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white">Delivered</button>
              {!q.sub || q.sub.decision ? <button type="button" onClick={() => setSwap({ id: q.id, text: '' })} className="h-9 rounded-full border px-3 text-[13px]">Suggest a swap</button>
                : <><button type="button" disabled={!!busy} onClick={() => act(q, 'decide-sub', { approve: true })} className="h-9 rounded-full border px-3 text-[13px]">Approve swap</button>
                    <button type="button" disabled={!!busy} onClick={() => act(q, 'decide-sub', { approve: false })} className="h-9 rounded-full border px-3 text-[13px]">Decline</button></>}
              <button type="button" disabled={!!busy} onClick={() => act(q, 'cancel')} className="h-9 rounded-full px-3 text-[13px] text-muted-foreground">Cancel</button>
            </>}
            {q.source === 'lounge' && <>
              {q.status === 'open' && <button type="button" disabled={!!busy} onClick={() => lounge.bringing(q)} className="h-9 rounded-full bg-stone-900 px-3 text-[13px] font-semibold text-white">Bringing it</button>}
              <button type="button" disabled={!!busy} onClick={() => lounge.delivered(q)} className="h-9 rounded-full bg-emerald-600 px-3 text-[13px] font-semibold text-white">Delivered</button>
            </>}
            {q.source === 'restock' && <a href="/inventory" className="flex h-9 items-center rounded-full border px-3 text-[13px]">Review in Inventory</a>}
          </div>
          {swap?.id === q.id && <div className="flex gap-2">
            <input value={swap.text} onChange={(e) => setSwap({ id: q.id, text: e.target.value.slice(0, 120) })} placeholder="What can you bring instead?" className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-[14px]" />
            <button type="button" disabled={!swap.text.trim() || !!busy} onClick={async () => { await act(q, 'propose-sub', { text: swap.text }); setSwap(null); }} className="h-10 rounded-xl bg-stone-900 px-3 text-[13px] font-semibold text-white">Offer</button>
          </div>}
        </div>))}
    </div>
  );
}
