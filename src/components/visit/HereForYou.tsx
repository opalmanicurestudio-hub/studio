'use client';
// src/components/visit/HereForYou.tsx — THE PROVIDER'S ANSWER (design canvas: They’re here; lib/arrival-nudge). When a
// guest of theirs checks in, the provider is nudged, and answers here with one tap: Coming now, 5 minutes, 10 minutes,
// Send them back. The desk sees the answer on Here now, and the guest on their own page.
//   HereForYou — the staff portal's Today: a card for each of their guests who's here and not yet started.
//   HereReply  — one visit's answer (the planner's side panel): the four answers for its provider; for anyone else,
//                what the provider said, or how long since they were told.
import * as React from 'react';
import { REPLIES, STARTED, nudgeView, replyWords, type ReplyKind } from '@/lib/arrival-nudge';
import { arrivalCall } from '@/lib/arrival-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const ms = (v: any) => { const t = Date.parse(String(v?.toDate ? v.toDate().toISOString() : v || '')); return Number.isFinite(t) ? t : 0; };
export const isWaitingHere = (a: any) => ['arrived', 'checked_in', 'checkedIn'].includes(String(a?.checkInStatus || '')) && !STARTED.includes(String(a?.status || '')) && String(a?.stage || '') !== 'in_service';
const viaLine = (v: unknown) => (v === 'kiosk' ? 'Checked in at the kiosk.' : v === 'client link' ? 'Checked in on their own link.' : 'Checked in at the desk.');

function useTick(ms: number) { const [, set] = React.useState(0); React.useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]); }

export function HereReply({ tenantId, visit, mine, label }: { tenantId: string; visit: any; mine: boolean; label?: string }) {
  useTick(30000);
  const [busy, setBusy] = React.useState<ReplyKind | ''>(''); const [err, setErr] = React.useState(''); const [changing, setChanging] = React.useState(false);
  const [mineNow, setMineNow] = React.useState<{ kind: ReplyKind; at: number } | null>(null);   // what was just tapped, until the visit catches up
  const status = React.useRef<HTMLParagraphElement | null>(null); const firstAnswer = React.useRef<HTMLButtonElement | null>(null);
  if (!isWaitingHere(visit)) return null;
  const serverAt = ms(visit?.arrivalReply?.at);
  const said = mineNow && mineNow.at >= serverAt ? mineNow.kind : (visit?.arrivalReply?.kind as ReplyKind | undefined) || mineNow?.kind;
  const answer = async (kind: ReplyKind) => {
    if (busy) return; setBusy(kind); setErr('');
    const r = await arrivalCall({ tenantId, appointmentId: visit.id, action: 'reply', reply: kind });
    setBusy(''); if (!r.ok) { setErr(r.error || 'That didn’t go through. Try again.'); return; }
    setMineNow({ kind, at: Date.now() }); setChanging(false); requestAnimationFrame(() => status.current?.focus());
  };
  if (!mine) {
    const v = nudgeView(visit, Date.now()); if (!v) return null;
    return <p className="text-[13.5px] font-semibold" style={{ color: v.tone === 'ok' ? GREEN : v.tone === 'warn' ? AMBER : MUTED }}>{v.text}</p>;
  }
  if (said && !changing) return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl px-3" style={{ background: '#ecf6f0' }}>
      <p ref={status} tabIndex={-1} role="status" className="text-[14.5px] font-semibold outline-none" style={{ color: GREEN }}>You said {replyWords(said).toLowerCase()}</p>
      <button type="button" onClick={() => { setChanging(true); requestAnimationFrame(() => firstAnswer.current?.focus()); }} className="min-h-[44px] text-[14px] font-semibold underline underline-offset-2" style={{ color: INK }}>Change</button>
    </div>);
  return (
    <div>
      <div role="group" aria-label={label || 'Answer'} className="grid grid-cols-2 gap-2">
        {REPLIES.map((r, i) => (
          <button key={r.id} ref={i === 0 ? firstAnswer : undefined} type="button" onClick={() => answer(r.id)} disabled={!!busy}
            className="min-h-[44px] min-w-0 rounded-xl px-2 text-[14.5px] font-semibold leading-tight disabled:opacity-60"
            style={i === 0 ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{busy === r.id ? 'Sending…' : r.words}</button>))}
      </div>
      {err && <p role="alert" className="mt-2 text-[13.5px]" style={{ color: AMBER }}>{err}</p>}
    </div>);
}

/** Each of their guests who's here and hasn't started, longest wait first. */
export function HereForYou({ tenantId, visits, serviceOf }: { tenantId: string; visits: any[]; serviceOf?: (v: any) => string }) {
  useTick(30000);
  const here = (visits || []).filter(isWaitingHere).sort((a, b) => (ms(a.arrivedAt || a.checkedInAt) || 0) - (ms(b.arrivedAt || b.checkedInAt) || 0));
  if (!here.length) return null;
  return (
    <section aria-label="Here for you" className="space-y-2.5">
      {here.map((v) => {
        const since = ms(v.arrivedAt || v.checkedInAt || v.checkInStatusTimestamp); const m = since ? Math.max(0, Math.round((Date.now() - since) / 60000)) : 0;
        const at = ms(v.startTime) && !v.noBookedTime ? new Date(ms(v.startTime)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
        const svc = (serviceOf ? serviceOf(v) : '') || v.serviceName || '';
        const answered = !!v.arrivalReply?.kind;
        return (
          <div key={v.id} className="rounded-[20px] bg-[#fff] p-4" style={{ border: answered ? `1px solid ${LINE}` : `2px solid ${INK}` }}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[16px] font-semibold">{v.clientName || 'Your guest'} is here</h3>
              <span className="shrink-0 text-[13px]" style={{ color: MUTED }}>{m < 1 ? 'Just now' : `${m} min`}</span>
            </div>
            <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>{[at, svc.toLowerCase()].filter(Boolean).join(' ')}{at || svc ? '. ' : ''}{viaLine(v.arrivalNudge?.via || v.checkedInVia)}</p>
            <div className="mt-3"><HereReply tenantId={tenantId} visit={v} mine label={`Answer for ${v.clientName || 'your guest'}`} /></div>
          </div>);
      })}
    </section>);
}
