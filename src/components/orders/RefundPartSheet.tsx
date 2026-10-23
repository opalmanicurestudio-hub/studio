'use client';
// src/components/orders/RefundPartSheet.tsx — REFUND PART OF THIS ORDER: some of the items (each at what was paid for
// it, with its tax), the shipping, or another amount, with the reason. Sent straight away by someone allowed to send
// refunds (api/retail/refund with `add`): it goes back the way they paid, and the order, the books and the customer's
// email all show it. The amount shown is the one the server works out from the order (lib/part-refund).
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { itemsRefund, shippingLeft, unitsLeft, type PartKind } from '@/lib/part-refund';
import { money } from '@/lib/orders-view';
import { Btn, C, Seg, Sheet, feel, muted } from './ui';

const field = 'h-12 w-full rounded-2xl border px-4 text-[17px] font-normal';

export function RefundPartSheet({ tenantId, order, onClose, onDone }: { tenantId: string; order: any; onClose: () => void; onDone: (message: string) => void }) {
  const lines = (order.lines || []).filter((l: any) => unitsLeft(l) > 0);
  const shipLeft = shippingLeft(order);
  const kinds = [
    ...(lines.length ? [{ id: 'items' as PartKind, label: 'Items' }] : []),
    ...(shipLeft ? [{ id: 'shipping' as PartKind, label: order.method === 'ship' ? 'Shipping' : 'Delivery' }] : []),
    { id: 'amount' as PartKind, label: 'Amount' },
  ];
  const [kind, setKind] = React.useState<PartKind>(kinds[0].id);
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [ship, setShip] = React.useState((shipLeft / 100).toFixed(2));
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  // This ask's own id: tapping Refund twice, or retrying after a dropped answer, sends one refund.
  const [askId] = React.useState(() => `pr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  const pending = Math.max(0, Number(order.pendingRefundCents) || 0);
  const who = String(order.customerName || '').trim().split(/\s+/)[0] || 'They';

  const picks = Object.entries(qty).filter(([, q]) => q > 0).map(([lineId, q]) => ({ lineId, qty: q }));
  const items = kind === 'items' && picks.length ? itemsRefund(order, picks) : null;
  const cents = kind === 'items' ? (items && items.ok ? items.itemsCents + items.taxCents : 0)
    : kind === 'shipping' ? Math.round((Number(ship) || 0) * 100) : Math.round((Number(amount) || 0) * 100);
  const total = cents + pending;

  const send = async () => {
    setErr('');
    if (!note.trim()) { setErr('Say why it’s being refunded. It goes on the order’s record.'); return; }
    if (cents <= 0) { setErr(kind === 'items' ? 'Choose what to refund.' : 'Enter how much to refund.'); return; }
    setBusy(true);
    const add = kind === 'items' ? { kind, lines: picks, note: note.trim(), id: askId } : { kind, cents, note: note.trim(), id: askId };
    const r = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', add }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false); feel(!!r?.ok);
    if (r?.ok) onDone(d.message || 'Refund sent.'); else setErr(d.error || 'The refund didn’t go through. Nothing was sent.');
  };

  return (
    <Sheet title="Refund part of this order" sub={`It goes back the way ${who === 'They' ? 'they' : who} paid: to the card, and to a gift card or store credit if they used one.`} onClose={onClose}>
      <div className="mt-2"><Seg value={kind} options={kinds} onChange={(v) => { setKind(v); setErr(''); }} /></div>

      {kind === 'items' && (
        <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: C.line }}>
          {lines.map((l: any, i: number) => {
            const left = unitsLeft(l); const q = qty[l.lineId] || 0;
            return (
              <div key={l.lineId} className="flex items-center gap-3 px-4 py-3" style={i ? { borderTop: `1px solid ${C.line}` } : undefined}>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[15px] font-semibold">{l.name}</p>
                  <p className="m-0 text-[13px]" style={muted}>{left} can be refunded{l.optionsLabel ? ` · ${l.optionsLabel}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label={`One fewer ${l.name}`} disabled={!q} onClick={() => setQty({ ...qty, [l.lineId]: Math.max(0, q - 1) })} className="cf-press grid h-11 w-11 place-items-center rounded-full text-[20px] disabled:opacity-40" style={{ background: C.soft }}>−</button>
                  <span className="w-6 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{q}</span>
                  <button type="button" aria-label={`One more ${l.name}`} disabled={q >= left} onClick={() => setQty({ ...qty, [l.lineId]: Math.min(left, q + 1) })} className="cf-press grid h-11 w-11 place-items-center rounded-full text-[20px] disabled:opacity-40" style={{ background: C.soft }}>+</button>
                </div>
              </div>);
          })}
        </div>)}
      {kind === 'items' && items && items.ok && items.taxCents > 0 && <p className="m-0 mt-2 text-[13px]" style={muted}>{money(items.itemsCents)} for the items and {money(items.taxCents)} of sales tax that went with them.</p>}
      {kind === 'items' && items && !items.ok && <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{items.error}</p>}

      {kind === 'shipping' && (
        <label className="mt-4 block text-[13px] font-semibold" style={muted}>How much of the {order.method === 'ship' ? 'shipping' : 'delivery'} ({money(shipLeft)} left)
          <input inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value.replace(/[^0-9.]/g, ''))} className={`mt-1 ${field}`} style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
        </label>)}
      {kind === 'amount' && (
        <label className="mt-4 block text-[13px] font-semibold" style={muted}>Amount
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" className={`mt-1 ${field}`} style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          <span className="mt-1 block font-normal">For a goodwill gesture or a price matched. The sales tax part is worked out from the order.</span>
        </label>)}

      <label className="mt-4 block text-[13px] font-semibold" style={muted}>Reason (on the order’s record)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: arrived damaged, they kept it" className={`mt-1 ${field}`} style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
      </label>

      {pending > 0 && cents > 0 && <p className="m-0 mt-3 text-[14px]" style={muted}>The {money(pending)} already waiting goes with it: {money(total)} in all.</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || cents <= 0} onClick={() => void send()}>{busy ? 'Sending…' : cents > 0 ? `Refund ${money(total)}` : 'Refund'}</Btn>
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
    </Sheet>);
}
