'use client';
// src/components/orders/MissingSheet.tsx — SOMETHING ISN'T ON THE SHELF. Refund it, send it when it's back, or keep
// looking. Stock for the item is corrected so nobody else buys one, and the customer is told either way. A refund is
// queued for someone allowed to send money (it shows in "needs you"); nothing leaves the card from here.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { markMissing } from '@/lib/orders-flow';
import { firstName, money } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, muted } from './ui';

export function MissingSheet({ fs, tenantId, order, line, shelf, actor, onClose, onDone }: { fs: Firestore; tenantId: string; order: any; line: any; shelf?: string; actor: Actor; onClose: () => void; onDone: (msg: string) => void }) {
  const owed = Math.max(0, (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0));
  const [how, setHow] = React.useState<'refund' | 'backorder' | 'look'>('refund');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const who = firstName(order.customerName);
  const amount = owed * (Number(line.unitPriceCents) || 0);
  const go = async () => {
    if (how === 'look') { onClose(); return; }
    setBusy(true);
    const r = await markMissing(fs, tenantId, order.id, line.lineId, how, shelf ? `Not on shelf ${shelf}` : 'Not on the shelf', actor);
    setBusy(false);
    if (r.ok) onDone(how === 'refund' ? `${who} will get ${money(amount)} back. It’s waiting for someone to send it.` : `${line.name} will ship on its own when it’s back.`); else setErr(r.message);
  };
  const opt = (id: typeof how, title: string, sub: string) => (
    <button type="button" onClick={() => setHow(id)} className="flex w-full items-start gap-3 rounded-[18px] p-3.5 text-left" style={{ border: how === id ? `2px solid ${C.ink}` : `1px solid ${C.line}`, padding: how === id ? 13 : 14 }}>
      <span className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full" style={{ border: how === id ? `7px solid ${C.ink}` : `2px solid ${C.line}`, boxSizing: 'border-box' }} />
      <span><span className="block text-[17px] font-semibold">{title}</span><span className="mt-0.5 block text-[14px]" style={muted}>{sub}</span></span>
    </button>);
  return (
    <Sheet title={`${line.name} ${owed > 1 ? `(${owed})` : ''} isn’t ${shelf ? `on shelf ${shelf}` : 'there'}`} sub={`${order.customerName || 'Customer'} · ${owed} of ${line.qtyOrdered} missing`} onClose={onClose}>
      <div className="mt-2 flex flex-col gap-2">
        {opt('refund', `Refund ${money(amount)}`, `${who} gets a text and an email saying why. The refund waits for someone allowed to send money.`)}
        {opt('backorder', 'Send it when it’s back', 'The rest goes out now. This ships on its own at no cost to them.')}
        {opt('look', 'Keep looking', 'Nothing changes yet.')}
      </div>
      {how !== 'look' && <p className="m-0 mt-3 text-[14px]" style={muted}>Stock for this item is set to what’s really there, so nobody else buys one.</p>}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy} onClick={() => void go()}>{busy ? 'Saving…' : how === 'refund' ? `Refund ${money(amount)} and keep packing` : how === 'backorder' ? 'Send it later and keep packing' : 'Keep looking'}</Btn>
    </Sheet>);
}
