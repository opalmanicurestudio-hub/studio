'use client';
// src/components/orders/HandoverSheet.tsx — HAND IT OVER. Scan the code on the customer's phone, type the 4-digit
// pickup code they say (checked on the server, lib/pickup-pass), or check their name and the last four digits of their
// phone. When the customer named someone else to collect it, that's said first. Scanning a different order's code says
// so instead of handing over the wrong bag. The handoff records who handed it over, who collected it and how.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { handOver } from '@/lib/orders-flow';
import { parseOrderQr } from '@/lib/retail-orders';
import { PIN_TRIES } from '@/lib/pickup-limits';
import { firstName, itemCount } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, feel, muted } from './ui';

export function HandoverSheet({ fs, tenantId, order, actor, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; actor: Actor; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [pin, setPin] = React.useState(''); const [pinLocked, setPinLocked] = React.useState(Number(order.pinTries || 0) >= PIN_TRIES);
  const who = firstName(order.customerName);
  const other = String(order.collector?.name || '').trim();
  const collecting = other || who;
  const last4 = String(order.customerPhone || '').replace(/\D/g, '').slice(-4);
  const finish = (r: { ok: boolean; message: string; locked?: boolean }) => {
    feel(r.ok);
    if (r.ok) onDone(other ? `Handed over to ${other}. ${who} gets a note that ${other} collected it.` : `Handed over to ${who}. Their receipt is on its way.`);
    else { setErr(r.message); if (r.locked) { setPinLocked(true); setPin(''); } }
  };
  const onScan = async (v: string) => {
    if (busy) return;
    const token = parseOrderQr(v) ?? v.trim();
    if (order.qrToken && token !== order.qrToken) { feel(false); setErr('That code is for a different order. Check the name on their phone.'); return; }
    setBusy(true); finish(await handOver(fs, tenantId, order, actor, { scan: v })); setBusy(false);
  };
  const byPin = async () => { if (busy || pin.length !== 4) return; setBusy(true); setErr(''); finish(await handOver(fs, tenantId, order, actor, { pin })); setBusy(false); };
  const byName = async () => {
    setBusy(true);
    const checked = other ? `${other} collecting for ${order.customerName || who}; name checked by ${actor.name}` : `Name${last4 ? ` and phone ending ${last4}` : ''} checked by ${actor.name}`;
    finish(await handOver(fs, tenantId, order, actor, { verifiedBy: checked })); setBusy(false);
  };
  return (
    <Sheet title={`Hand over to ${other || order.customerName || who}`} sub={`${order.shelfSlot ? `Shelf ${order.shelfSlot} · ` : ''}${itemCount(order)} item${itemCount(order) === 1 ? '' : 's'}`} onClose={onClose}>
      {other && <p className="m-0 mt-1 rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: C.okSoft, color: C.ok }}>{other} is collecting for {order.customerName || who}.</p>}
      <div className="mt-3 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy} label="Point at the code on their phone" /></div>
      {!pinLocked && (
        <form className="mt-4" onSubmit={(e) => { e.preventDefault(); void byPin(); }}>
          <label htmlFor="handover-pin" className="block text-[15px] font-semibold" style={{ color: C.ink }}>Or the pickup code they say</label>
          <div className="mt-2 flex gap-2">
            <input id="handover-pin" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(''); }} placeholder="4 digits"
              className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[20px] tabular-nums outline-none" style={{ border: `1px solid ${C.line}`, background: C.paper, color: C.ink, letterSpacing: pin ? '0.2em' : undefined }} />
            <Btn kind="primary" type="submit" className="shrink-0 text-[17px]" disabled={busy || pin.length !== 4}>Check</Btn>
          </div>
        </form>
      )}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <p className="m-0 mt-4 text-[15px]" style={muted}>{other ? `No code? Ask their name: it should be ${other}.` : `No code? Ask their name${last4 ? ` and the last 4 of their phone: ending ${last4}` : ''}.`}</p>
      <Btn kind="soft" className="mt-3 w-full text-[17px]" disabled={busy} onClick={() => void byName()}>Checked, hand over to {collecting}</Btn>
    </Sheet>);
}
