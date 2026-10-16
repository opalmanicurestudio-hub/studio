'use client';
// src/components/planner/UnconfirmedSheet.tsx — TOMORROW'S VISITS NOBODY HAS CONFIRMED. Opened from "needs you". Each
// row shows whether they were already asked or followed up, with a button to send the one-tap confirm message now
// (api/visits/send-client, kind 'confirm'); "Send to everyone" does the rest in one go.
import * as React from 'react';
import { format } from 'date-fns';

const safe = (v: any) => new Date(v?.toDate ? v.toDate() : v);
const muted = { color: 'var(--muted, #6d7075)' } as React.CSSProperties;

export function UnconfirmedSheet({ tenantId, visits, staff, onOpenVisit, onClose }: { tenantId: string; visits: any[]; staff: any[]; onOpenVisit: (a: any) => void; onClose: () => void }) {
  const [state, setState] = React.useState<Record<string, 'sending' | 'sent' | string>>({});
  const send = async (a: any) => {
    setState((s) => ({ ...s, [a.id]: 'sending' }));
    const r: any = await fetch('/api/visits/send-client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: a.id, kind: 'confirm' }) }).then((x) => x.json()).catch(() => ({ ok: false, reason: 'No connection.' }));
    setState((s) => ({ ...s, [a.id]: r.ok ? 'sent' : (r.reason || 'Not sent') }));
  };
  const waiting = visits.filter((a) => state[a.id] !== 'sent' && state[a.id] !== 'sending');
  const prov = (a: any) => String(staff.find((s) => s.id === a.staffId)?.name || '').split(' ')[0];
  const asked = (a: any) => a.confirmNudgedAt ? `Followed up ${format(safe(a.confirmNudgedAt), 'EEE h:mm a')}` : a.confirmAskedAt ? `Asked in the reminder, ${format(safe(a.confirmAskedAt), 'EEE h:mm a')}` : 'Not asked yet';
  return (
    <div role="dialog" aria-modal="true" aria-label="Not confirmed yet" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(22,23,26,.38)' }} onClick={onClose}>
      <div className="max-h-[86dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] p-5 sm:rounded-[28px]" style={{ background: 'var(--card, #fff)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div><p className="text-[20px] font-light">Not confirmed yet</p><p className="text-[13px]" style={muted}>Tomorrow · {visits.length} visit{visits.length === 1 ? '' : 's'}. Confirming takes them one tap; nothing is charged.</p></div>
          <button type="button" onClick={onClose} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'var(--soft, #f5f5f7)' }}>Close</button>
        </div>
        {visits.length === 0 ? <p className="py-6 text-center text-[15px]" style={muted}>Everyone has confirmed.</p> : <ul className="mt-2">
          {visits.map((a) => { const st = state[a.id]; return (
            <li key={a.id} className="flex items-center gap-3 border-t py-3" style={{ borderColor: 'var(--line, #ececee)' }}>
              <button type="button" onClick={() => onOpenVisit(a)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[15px]"><b className="font-semibold">{a.clientName || 'Client'}</b> · {format(safe(a.startTime), 'h:mm a')}{prov(a) ? ` · ${prov(a)}` : ''}</span>
                <span className="block truncate text-[12px]" style={muted}>{st && st !== 'sending' && st !== 'sent' ? st : asked(a)}</span>
              </button>
              {st === 'sent' ? <span className="text-[13px] font-semibold" style={{ color: 'var(--ok, #1f7a4d)' }}>Sent</span>
                : <button type="button" disabled={st === 'sending'} onClick={() => void send(a)} className="h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--soft, #f5f5f7)' }}>{st === 'sending' ? 'Sending…' : a.confirmNudgedAt ? 'Ask again' : 'Ask now'}</button>}
            </li>); })}
        </ul>}
        {waiting.length > 1 && <button type="button" onClick={() => { waiting.forEach((a) => void send(a)); }} className="mt-3 h-11 w-full rounded-full text-[15px] font-semibold" style={{ background: 'var(--ink, #16171a)', color: 'var(--paper, #fff)' }}>Ask all {waiting.length}</button>}
      </div>
    </div>);
}
