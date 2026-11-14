'use client';
// src/components/shared/ConnectionBar.tsx — THE CONNECTION, on a floor screen (lib/outbox; design canvas "When the
// Wi-Fi drops"). Down: since when, how old what's on the screen is, and how many taps are kept on this device. Back:
// sending them, then how many went. Any the server turned down when they arrived are listed until read.
import * as React from 'react';
import { dismissMissed, useOutbox } from '@/lib/outbox';

const AMBER = '#b45309', AMBER_TINT = '#fff7ed', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0';
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
const taps = (n: number) => `${n} ${n === 1 ? 'tap' : 'taps'}`;

/** `down`: the screen's own refresh can't reach the server. `asOf`: when what it shows came from the server. */
export function ConnectionBar({ tenantId, down, asOf, kitchen }: { tenantId: string; down?: boolean; asOf?: number | null; kitchen?: boolean }) {
  const o = useOutbox(tenantId);
  const isDown = !!down || o.down;
  const since = asOf || o.since;
  return (
    <>
      {isDown && (
        <div role="status" className="rounded-2xl px-4 py-3 text-[14.5px] leading-snug" style={{ background: AMBER_TINT, color: AMBER }}>
          <b className="font-semibold">{since ? `No connection since ${clock(since)}.` : 'No connection.'}</b>
          {kitchen ? ' New tickets can’t reach this screen until it’s back; servers can print paper tickets.' : since && asOf ? ' This is what the screen had then.' : ''}
          {` Taps are kept on this device and sent when it’s back${o.waiting ? `: ${o.waiting} waiting.` : '.'}`}
        </div>
      )}
      {!isDown && o.waiting > 0 && <div role="status" className="rounded-2xl px-4 py-3 text-[14.5px] font-semibold" style={{ background: AMBER_TINT, color: AMBER }}>Back online. Sending {taps(o.waiting)} kept while offline.</div>}
      {!isDown && !o.waiting && o.sent > 0 && <div role="status" className="rounded-2xl px-4 py-3 text-[14.5px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Back online. Sent {taps(o.sent)} kept while offline.</div>}
      {o.missed.length > 0 && (
        <div role="alert" className="rounded-2xl px-4 py-3 text-[14.5px] leading-snug space-y-1" style={{ background: AMBER_TINT, color: AMBER }}>
          <p className="font-semibold">{o.missed.length === 1 ? '1 didn’t go through.' : `${o.missed.length} didn’t go through.`}</p>
          {o.missed.slice(-5).map((m) => <p key={m.id}>{m.label}: {m.error.replace(/\.$/, '')}.</p>)}
          <button type="button" onClick={() => dismissMissed(tenantId)} className="mt-1 min-h-[44px] rounded-xl border bg-[#fff] px-4 text-[14px] font-semibold" style={{ borderColor: '#ececee', color: '#16171a' }}>OK</button>
        </div>
      )}
    </>
  );
}
