'use client';
// src/components/orders/HandoverSheet.tsx — HAND IT OVER. Scan the code on the customer's phone, or check their name
// and the last four digits of their phone. Scanning a different order's code says so instead of handing over the
// wrong bag.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { ScanGate } from '@/components/retail/ScanGate';
import { handOver } from '@/lib/orders-flow';
import { parseOrderQr } from '@/lib/retail-orders';
import { firstName, itemCount } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, feel, muted } from './ui';

export function HandoverSheet({ fs, tenantId, order, actor, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; actor: Actor; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const who = firstName(order.customerName);
  const last4 = String(order.customerPhone || '').replace(/\D/g, '').slice(-4);
  const finish = (r: { ok: boolean; message: string }) => { feel(r.ok); if (r.ok) onDone(`Handed over to ${who}. Their receipt is on its way.`); else setErr(r.message); };
  const onScan = async (v: string) => {
    if (busy) return;
    const token = parseOrderQr(v) ?? v.trim();
    if (order.qrToken && token !== order.qrToken) { feel(false); setErr('That code is for a different order. Check the name on their phone.'); return; }
    setBusy(true); finish(await handOver(fs, tenantId, order, actor, { scan: v })); setBusy(false);
  };
  const byName = async () => { setBusy(true); finish(await handOver(fs, tenantId, order, actor, { verifiedBy: `Name${last4 ? ` and phone ending ${last4}` : ''} checked by ${actor.name}` })); setBusy(false); };
  return (
    <Sheet title={`Hand over to ${order.customerName || who}`} sub={`${order.shelfSlot ? `Shelf ${order.shelfSlot} · ` : ''}${itemCount(order)} item${itemCount(order) === 1 ? '' : 's'}`} onClose={onClose}>
      <div className="mt-2 overflow-hidden rounded-2xl"><ScanGate onScan={(v) => void onScan(v)} paused={busy} label="Point at the code on their phone" /></div>
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <p className="m-0 mt-4 text-[15px]" style={muted}>No code? Ask their name{last4 ? ` and the last 4 of their phone: ending ${last4}` : ''}.</p>
      <Btn kind="primary" className="mt-3 w-full text-[17px]" disabled={busy} onClick={() => void byName()}>Checked, hand over to {who}</Btn>
    </Sheet>);
}
