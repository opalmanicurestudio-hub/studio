'use client';
// src/components/pos/desk/RunningBehind.tsx — THE FRONT DESK'S DELAY STRIP. Shows every visit running behind (by the
// business's margin, default 5 min), when it will now finish, and each visit it pushes back with its new start time.
// "Tell <name>" sends the client a short text (email if no phone) and updates their visit page; "No need" dismisses it.
// Live on screen (recalculated every 30 seconds) — the server check does the same for phones and automatic messages.
import * as React from 'react';
import { delayChain, delaySettings, type DelayEntry } from '@/lib/delay';

const clock = (v: number) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function useDelays(appts: any[], services: any[], tenant: any): DelayEntry[] {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  return React.useMemo(() => delayChain({ appts: appts || [], services: services || [], now, settings: delaySettings(tenant) }), [appts, services, tenant, now]);
}

export function RunningBehind({ tenantId, delays, appts, staff, onOpenVisit, margin = 5 }: { tenantId: string; delays: DelayEntry[]; appts: any[]; staff: any[]; onOpenVisit?: (id: string) => void; margin?: number }) {
  const [busy, setBusy] = React.useState<string | null>(null); const [said, setSaid] = React.useState<Record<string, string>>({});
  if (!delays.length) return null;
  const first = (n: string) => String(n || '').split(' ')[0];
  const staffName = (id: string | null) => first(staff.find((m: any) => m.id === id)?.name || '');
  const act = async (id: string, expectedMs: number, skip = false) => { setBusy(id);
    try { const r = await fetch('/api/appointments/delay-tell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: id, expectedStartAt: new Date(expectedMs).toISOString(), skip }) }).then((x) => x.json());
      setSaid((s) => ({ ...s, [id]: r?.ok ? (skip ? 'Not messaged' : r.via === 'none' ? 'No phone or email on file — call them' : `Told by ${r.via === 'sms' ? 'text' : r.via}`) : r?.error || 'That didn’t send — try again.' })); }
    catch { setSaid((s) => ({ ...s, [id]: 'That didn’t send — try again.' })); } setBusy(null); };
  return (
    <section aria-label="Running behind" className="mb-4 rounded-2xl p-4" style={{ background: 'color-mix(in srgb, #b42318 7%, var(--card, #fff))', border: '1px solid color-mix(in srgb, #b42318 30%, transparent)' }}>
      <p className="mb-2 text-[13px] font-[700]" style={{ color: '#b42318' }}>Running behind · {delays.length}</p>
      <ul className="space-y-3">
        {delays.map((d) => (
          <li key={d.visitId} className="space-y-1.5">
            <button type="button" onClick={() => onOpenVisit?.(d.visitId)} className="text-left text-[15px]">
              <b className="font-[700]">{first(d.clientName)}</b>{staffName(d.staffId) ? ` with ${staffName(d.staffId)}` : ''} · <b className="font-[700]" style={{ color: '#b42318' }}>{d.delayMin} min behind</b>
              <span className="text-[13px]" style={{ color: 'var(--muted)' }}> · finishes ~{clock(d.clientEndMs)}{d.stationIds.length ? ` · station free ~${clock(d.freeMs)}` : ''}</span>
            </button>
            {d.next.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No one after is affected — there’s room in the schedule.</p> :
              <ul className="space-y-1.5 pl-3" style={{ borderLeft: '2px solid color-mix(in srgb, #b42318 35%, transparent)' }}>
                {d.next.map((k) => { const ap: any = appts.find((x) => x.id === k.id) || {}; const toldMin = Math.max(Number(ap.delayTold?.min) || 0, Number(ap.providerDelay?.minutes) || 0); const reply = ap.providerDelay?.reply;
                  const told = said[k.id] || (reply === 'keep' ? 'Keeping it ✓' : reply === 'cancel' ? 'They cancelled' : toldMin && toldMin >= k.lateMin - 4 ? `Told (~${toldMin} min)${ap.delayTold?.by === 'Automatic' ? ' automatically' : ''}` : ap.delaySkipped && !ap.delayToConfirm ? 'Not messaged' : '');
                  return (
                    <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px]">
                      <span><b className="font-[600]">{first(k.clientName)}</b> {clock(k.startMs)} → <b className="font-[700]">~{clock(k.expectedMs)}</b> <span style={{ color: 'var(--muted)' }}>({k.lateMin} min · {k.why === 'station' ? 'station' : staffName(k.staffId) || 'provider'})</span></span>
                      {told ? <span className="text-[13px] font-[600]" style={{ color: '#1f6b3a' }}>{told}</span> : k.lateMin < margin ? <span className="text-[13px]" style={{ color: 'var(--muted)' }}>A few minutes — no message needed</span> : <>
                        <button type="button" disabled={busy === k.id} onClick={() => act(k.id, k.expectedMs)} className="h-9 rounded-xl px-3 text-[13px] font-[700] text-white disabled:opacity-50" style={{ background: '#17181a' }}>{busy === k.id ? 'Sending…' : `Tell ${first(k.clientName)}`}</button>
                        <button type="button" disabled={busy === k.id} onClick={() => act(k.id, k.expectedMs, true)} className="h-9 rounded-xl border px-3 text-[13px] font-[600] disabled:opacity-50">No need</button></>}
                    </li>); })}
              </ul>}
          </li>))}
      </ul>
    </section>);
}
