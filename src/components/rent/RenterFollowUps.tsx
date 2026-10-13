'use client';
// src/components/rent/RenterFollowUps.tsx — A RENTER'S OWN FOLLOW-UPS (decided Oct 13: renters get the solo way for their
// own clients, when the business allows it). Off until the renter switches it on. Their first-visit check-ins, no next
// visit booked, cancellations, missed visits, clients due and clients they haven't seen in a while become a short list
// of ready messages from them, at the hour they choose. /api/portal/renter-followups.
import * as React from 'react';
import { FiveMinuteList } from '@/components/opportunities/FiveMinuteList';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', RED = '#b42318';
const font = { color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' } as const;
const call = (body: any) => fetch('/api/portal/renter-followups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t work. Please try again.' }));

export function RenterFollowUps({ tenantId, token }: { tenantId: string; token: string }) {
  const [d, setD] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const load = React.useCallback(() => call({ tenantId, token, action: 'get' }).then(setD), [tenantId, token]);
  React.useEffect(() => { void load(); }, [load]);
  if (!d?.ok || !d.allowed) return null;
  const S = d.settings || { on: false, hour: 18, max: 3 };
  const save = async (patch: any) => { setBusy(true); setErr(''); const r = await call({ tenantId, token, action: 'settings', ...S, ...patch }); setBusy(false); if (r?.ok) setD((x: any) => ({ ...x, settings: r.settings })); else setErr(r?.error || 'That didn’t save.'); };
  return (
    <section className="space-y-3" style={font} aria-label="Follow-ups">
      <div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>my business</p><h2 className="text-[24px] font-light tracking-[-0.02em]">Follow-ups</h2>
        <p className="text-[13.5px]" style={{ color: MUTED }}>A short list of ready messages for your own clients: a first visit to check on, someone who left without a next visit, a cancellation, a client who is due. Only you see them.</p></div>
      <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
        <div className="flex items-center justify-between gap-3"><span className="text-[14.5px] font-semibold">Make my list each day</span>
          <button type="button" role="switch" aria-checked={S.on} aria-label="Make my list each day" disabled={busy} onClick={() => save({ on: !S.on })} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: S.on ? INK : '#dcdde0' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: S.on ? 23 : 3 }} /></button></div>
        {S.on && <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-2 text-[14px]">Ready at<select value={S.hour} disabled={busy} onChange={(e) => save({ hour: Number(e.target.value) })} className="h-10 rounded-[12px] border bg-white px-2 text-[14px]" style={{ borderColor: LINE }}>{Array.from({ length: 15 }, (_, i) => i + 7).map((h) => <option key={h} value={h}>{new Date(2026, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })}</option>)}</select></label>
          <label className="flex items-center justify-between gap-2 text-[14px]">Most a day<select value={S.max} disabled={busy} onChange={(e) => save({ max: Number(e.target.value) })} className="h-10 rounded-[12px] border bg-white px-2 text-[14px]" style={{ borderColor: LINE }}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>}
        {S.on && !(d.items || []).length && <p className="text-[13px]" style={{ color: MUTED }}>Your list is made each morning, ready at the time above. Nothing waiting right now.</p>}
        {err && <p className="text-[13px] font-semibold" style={{ color: RED }}>{err}</p>}
      </div>
      {S.on && <FiveMinuteList tenantId={tenantId} items={d.items || []} hour={S.hour} reload={() => { void load(); }}
        post={(body) => call({ tenantId, token, ...body })} note="Texts go from the studio’s number, signed with your name and business name. Replies come to your Messages, and you get an alert." />}
    </section>);
}
