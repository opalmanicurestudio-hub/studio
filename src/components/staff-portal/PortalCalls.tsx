'use client';
// src/components/staff-portal/PortalCalls.tsx — CALLS FOR YOU, in the staff portal. When the front desk logs a call and
// passes it on (a message, something to do by a time, or urgent), it lands here as well as on their phone: who called,
// what they said, what's being asked. Got it · Reply · Hand back · Done — the front desk sees every step (/api/calls).
import * as React from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useMemoFirebase } from '@/firebase';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const DONE = [{ v: 'answered', l: 'Answered' }, { v: 'booked', l: 'Booked them' }, { v: 'passed_on', l: 'Passed on' }, { v: 'no_action', l: 'Nothing needed' }];
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function useMyCalls(firestore: any, tenantId: string, staffId: string, isManager: boolean) {
  const q = useMemoFirebase(() => (!firestore || !tenantId) ? null : query(collection(firestore, `tenants/${tenantId}/calls`), where('status', '==', 'open')), [firestore, tenantId]);
  const { data } = useCollection<any>(q);
  return React.useMemo(() => (data || []).filter((c: any) => (c.recipients || []).some((r: any) => (r.type === 'staff' && r.id === staffId) || (r.type === 'role' && isManager)))
    .sort((a: any, b: any) => Number(b.outcome === 'urgent') - Number(a.outcome === 'urgent') || String(a.dueAt || '9').localeCompare(String(b.dueAt || '9')) || String(b.at).localeCompare(String(a.at))), [data, staffId, isManager]);
}

function CallCard({ c, tenantId, staffId, isManager, accent }: { c: any; tenantId: string; staffId: string; isManager: boolean; accent: string }) {
  const mine = (c.recipients || []).find((r: any) => r.type === 'staff' && r.id === staffId) || (isManager ? (c.recipients || []).find((r: any) => r.type === 'role') : null);
  const [mode, setMode] = React.useState<'' | 'reply' | 'handback' | 'done'>(''); const [text, setText] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const urgent = c.outcome === 'urgent'; const overdue = c.dueAt && Date.parse(c.dueAt) < Date.now();
  const post = async (body: any) => {
    setBusy(true); setErr('');
    try {
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
      const viaKey = ['reply', 'handback'].includes(body.action) || !tk;
      const r = await fetch('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk && !viaKey ? { Authorization: `Bearer ${tk}` } : {}) },
        body: JSON.stringify({ tenantId, id: c.id, ...(viaKey && mine?.token ? { k: mine.token } : {}), ...body }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
      if (!r.ok) { setErr(r.error || 'That didn’t work.'); return; }
      setMode(''); setText('');
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2.5 rounded-[22px] border bg-white p-4" style={{ borderColor: urgent ? '#f1c9c4' : LINE, background: urgent ? '#fdf3f2' : '#fff' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={urgent ? { background: '#b42318', color: '#fff' } : c.outcome === 'action' ? { background: overdue ? '#b42318' : '#fdf1dc', color: overdue ? '#fff' : '#7a4a00' } : { background: `${accent}14`, color: accent }}>
          {urgent ? 'Urgent' : c.outcome === 'action' ? `${overdue ? 'Overdue' : 'To do'}${c.dueAt ? ` by ${time(c.dueAt)}` : ''}` : 'Message'}
        </span>
        <span className="text-[12px]" style={{ color: MUTED }}>{c.direction === 'out' ? 'Called' : 'Called in'} {time(c.at)} · from {String(c.loggedBy || 'front desk').split(' ')[0]}</span>
      </div>
      <div>
        <p className="text-[17px] font-bold leading-tight">{c.callerName}{c.reasonLabel ? <span className="font-medium" style={{ color: MUTED }}> · {c.reasonLabel}</span> : null}</p>
        {c.callerPhone && <a href={`tel:${c.callerPhone}`} className="text-[14px] font-semibold" style={{ color: accent }}>{c.callerPhone}</a>}
      </div>
      <p className="text-[15px] leading-snug">“{c.summary}”</p>
      {c.ask && <p className="text-[14px] font-semibold">Please {String(c.ask).replace(/^please\s+/i, '')}</p>}
      {c.promised && <p className="text-[13px]" style={{ color: MUTED }}>We told them: {c.promised}</p>}
      {c.handedBackBy && <p className="text-[13px]" style={{ color: '#9a5b00' }}>Handed back by {String(c.handedBackBy).split(' ')[0]}</p>}
      {mode === '' ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {mine && !mine.ackedAt && <button type="button" disabled={busy} onClick={() => post({ action: 'ack' })} className="h-10 rounded-[12px] px-4 text-[14px] font-bold text-white" style={{ background: INK }}>Got it</button>}
          <button type="button" onClick={() => setMode('reply')} className="h-10 rounded-[12px] border px-4 text-[14px] font-semibold" style={{ borderColor: '#e6e6e8' }}>Reply</button>
          <button type="button" onClick={() => setMode('done')} className="h-10 rounded-[12px] border px-4 text-[14px] font-semibold" style={{ borderColor: '#e6e6e8' }}>Done</button>
          <button type="button" onClick={() => setMode('handback')} className="h-10 rounded-[12px] px-3 text-[14px] font-semibold" style={{ color: MUTED }}>Hand back</button>
        </div>
      ) : mode === 'done' ? (
        <div className="space-y-2 pt-1">
          <p className="text-[13px] font-semibold">What happened?</p>
          <div className="flex flex-wrap gap-2">{DONE.map((d) => <button key={d.v} type="button" disabled={busy} onClick={() => post({ action: 'resolve', outcome: d.v, note: text.trim() })} className="h-10 rounded-[12px] border px-3.5 text-[14px] font-semibold" style={{ borderColor: '#e6e6e8' }}>{d.l}</button>)}</div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (optional)" aria-label="Note" className="h-11 w-full rounded-[12px] border px-3 text-[15px]" style={{ borderColor: '#e6e6e8' }} />
          <button type="button" onClick={() => setMode('')} className="text-[13px] font-semibold" style={{ color: MUTED }}>Cancel</button>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label={mode === 'reply' ? 'Your reply' : 'Why you’re handing it back'} placeholder={mode === 'reply' ? 'Your reply to the front desk…' : 'Why you’re handing it back…'} className="w-full rounded-[12px] border px-3 py-2 text-[15px]" style={{ borderColor: '#e6e6e8' }} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => post({ action: mode, text })} className="h-10 rounded-[12px] px-4 text-[14px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>{mode === 'reply' ? 'Send reply' : 'Hand back'}</button>
            <button type="button" onClick={() => setMode('')} className="h-10 rounded-[12px] px-3 text-[14px] font-semibold" style={{ color: MUTED }}>Cancel</button>
          </div>
        </div>)}
      {err && <p role="alert" className="text-[13px] font-medium" style={{ color: '#b42318' }}>{err}</p>}
    </div>);
}

export function PortalCalls({ calls, tenantId, staffId, isManager, accent = INK, title = 'Calls for you' }: { calls: any[]; tenantId: string; staffId: string; isManager: boolean; accent?: string; title?: string }) {
  if (!calls.length) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <p className="px-0.5 text-[15px] font-bold">{title} <span className="font-semibold" style={{ color: MUTED }}>· {calls.length}</span></p>
      {calls.map((c) => <CallCard key={c.id} c={c} tenantId={tenantId} staffId={staffId} isManager={isManager} accent={accent} />)}
    </section>);
}
