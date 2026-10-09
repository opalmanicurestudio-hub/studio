'use client';
// src/components/pos/desk/RunningBehind.tsx — THE FRONT DESK'S DELAY STRIP. Shows every visit running behind (by the
// business's margin, default 5 min), when it will now finish, and each visit it pushes back with its new start time.
// "Tell <name>" sends the client a short text (email if no phone) and updates their visit page; "No need" dismisses it.
// Live on screen (recalculated every 30 seconds) — the server check does the same for phones and automatic messages.
import * as React from 'react';
import { delayChain, delaySettings, type DelayEntry } from '@/lib/delay';
import { Initials } from '@/components/pos/desk/hk-ui';

const clock = (v: number) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');

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
  const RED = '#b42318', INK = '#17181a';
  return (
    <section aria-label="Running behind" className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden" style={{ background: RED }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: RED }} /></span>
        <p className="text-[13px] font-[700] tracking-[0.02em]" style={{ color: RED }}>Running behind · {delays.length}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {delays.map((d) => { const span = Math.max(1, d.freeMs - (d.clientEndMs - d.delayMin * 60000) ); const bookedEnd = d.clientEndMs - d.delayMin * 60000;
          return (
          <article key={d.visitId} className="overflow-hidden rounded-[22px] bg-white shadow-[0_1px_0_rgba(23,24,26,0.04),0_8px_24px_-12px_rgba(23,24,26,0.18)]" style={{ border: '1px solid #ece6dd' }}>
            <button type="button" onClick={() => onOpenVisit?.(d.visitId)} className="flex w-full items-center gap-3 px-4 pb-3 pt-4 text-left">
              <Initials name={staff.find((m: any) => m.id === d.staffId)?.name || d.clientName} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-[700]" style={{ color: INK }}>{first(d.clientName)}{staffName(d.staffId) ? <span className="font-[500]" style={{ color: 'var(--muted, #6a655d)' }}> with {staffName(d.staffId)}</span> : null}</p>
                <p className="text-[13px] tabular-nums" style={{ color: 'var(--muted, #6a655d)' }}>finishes ~{clock(d.clientEndMs)}{d.stationIds.length ? ` · station free ~${clock(d.freeMs)}` : ''}</p>
              </div>
              <div className="text-right"><p className="text-[30px] font-[800] leading-none tabular-nums" style={{ color: RED }}>+{d.delayMin}</p><p className="text-[11px] font-[600]" style={{ color: RED }}>min behind</p></div>
            </button>
            {/* booked → now: the solid part is the booked finish, the stripes are the overrun, grey is the reset */}
            <div className="mx-4 mb-3 flex h-1.5 overflow-hidden rounded-full" style={{ background: '#f1ece5' }} aria-hidden>
              <div style={{ flex: '3 0 0', background: INK }} />
              <div style={{ flex: `${Math.max(0.4, (d.delayMin * 60000) / span * 3)} 0 0`, background: `repeating-linear-gradient(-45deg, ${RED} 0 4px, color-mix(in srgb, ${RED} 35%, transparent) 4px 8px)` }} />
              {d.stationIds.length > 0 && <div style={{ flex: `${Math.max(0.3, (d.freeMs - d.clientEndMs) / span * 3)} 0 0`, background: '#cfc8bd' }} />}
            </div>
            <div className="space-y-2 px-4 pb-4" style={{ borderTop: '1px solid #f1ece5' }}>
              {d.next.length === 0 ? <p className="pt-3 text-[13px]" style={{ color: 'var(--muted, #6a655d)' }}>No one after is affected — there’s room in the schedule.</p> :
                d.next.map((k) => { const ap: any = appts.find((x) => x.id === k.id) || {}; const toldMin = Math.max(Number(ap.delayTold?.min) || 0, Number(ap.providerDelay?.minutes) || 0); const reply = ap.providerDelay?.reply;
                  const told = said[k.id] || (reply === 'keep' ? 'Keeping it' : reply === 'cancel' ? 'They cancelled' : toldMin && toldMin >= k.lateMin - 4 ? `Told · ~${toldMin} min${ap.delayTold?.by === 'Automatic' ? ' · auto' : ''}` : ap.delaySkipped && !ap.delayToConfirm ? 'Not messaged' : '');
                  return (
                    <div key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px]" style={{ color: INK }}><b className="font-[700]">{first(k.clientName)}</b> <span className="text-[12px] font-[600] uppercase-none" style={{ color: 'var(--muted, #6a655d)' }}>· {k.why === 'station' ? 'same station' : staffName(k.staffId) || 'same provider'}</span></p>
                        <p className="text-[14px] tabular-nums"><s style={{ color: '#a39d93' }}>{clock(k.startMs)}</s> <span aria-hidden style={{ color: '#a39d93' }}>→</span> <b className="font-[800]" style={{ color: INK }}>~{clock(k.expectedMs)}</b> <span className="ml-1 rounded-full px-2 py-0.5 text-[12px] font-[700]" style={{ background: 'color-mix(in srgb, #b42318 9%, transparent)', color: RED }}>+{k.lateMin}</span></p>
                      </div>
                      {told ? <span className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-[700]" style={{ background: reply === 'cancel' ? '#fbeae8' : '#e3f3e7', color: reply === 'cancel' ? RED : '#1f6b3a' }}>{reply === 'cancel' ? '×' : '✓'} {told}</span>
                        : k.lateMin < margin ? <span className="text-[13px]" style={{ color: 'var(--muted, #6a655d)' }}>A few minutes — no message needed</span> : <div className="flex gap-2">
                        <button type="button" disabled={busy === k.id} onClick={() => act(k.id, k.expectedMs)} className="h-10 rounded-full px-4 text-[14px] font-[700] text-white shadow-sm disabled:opacity-50" style={{ background: INK }}>{busy === k.id ? 'Sending…' : `Tell ${first(k.clientName)}`}</button>
                        <button type="button" disabled={busy === k.id} onClick={() => act(k.id, k.expectedMs, true)} className="h-10 rounded-full px-3 text-[14px] font-[600] disabled:opacity-50" style={{ border: '1px solid #ddd6cc', color: INK }}>No need</button></div>}
                    </div>); })}
            </div>
          </article>); })}
      </div>
    </section>);
}
