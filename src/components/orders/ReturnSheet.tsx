'use client';
// src/components/orders/ReturnSheet.tsx — CHECK IN A RETURN. For each item, say what condition it came back in. The
// sheet shows the money as you go: what they paid for those items, minus return shipping if they pay it, minus the
// restocking fee for that condition (never when the shop was at fault). One button checks it all in and, for a refund,
// sends it to their card.
import * as React from 'react';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { receiveReturnLine, resolveReturn } from '@/lib/retail-returns';
import { restockingFee } from '@/lib/restocking';
import { returnRefundCents } from '@/lib/retail-orders';
import { money } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Seg, Sheet, feel, muted } from './ui';

type Cond = 'restock' | 'open_box' | 'damaged';
const REASONS: Record<string, string> = { damaged_in_transit: 'Arrived damaged', defective: 'Doesn’t work', wrong_item: 'Wrong item', changed_mind: 'Changed their mind', other: 'Other' };

export function ReturnSheet({ fs, tenantId, ret, initialOrder, actor, rs, canRefund, onClose, onDone }: { fs: Firestore; tenantId: string; ret: any; initialOrder?: any | null; actor: Actor; rs: any; canRefund: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [order, setOrder] = React.useState<any | null>(initialOrder || null);
  const [cond, setCond] = React.useState<Record<string, Cond>>(() => Object.fromEntries((ret.lines || []).map((l: any) => [l.lineId, (l.disposition === 'restock' || l.disposition === 'open_box' ? l.disposition : l.disposition ? 'damaged' : 'restock') as Cond])));
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { void getDoc(doc(fs, `tenants/${tenantId}/retailOrders`, ret.orderId)).then((s) => { if (s.exists()) setOrder({ ...(s.data() as any), id: s.id }); }).catch(() => {}); }, [fs, tenantId, ret.orderId]);

  const lines = (ret.lines || []).map((l: any) => ({ ...l, disposition: l.disposition || cond[l.lineId] }));
  const isRefund = ret.resolution === 'refund';
  // What they paid for these items, with their tax: worked out the same way the return is settled (lib/retail-returns).
  const paidBack = order ? returnRefundCents(order, ret.lines || []) : 0;
  const gross = Math.max(isRefund ? Number(ret.refundCents) || 0 : Number(ret.storeCreditCents) || 0, ret.resolution === 'replacement' ? 0 : paidBack);
  const label = Math.max(0, Number(ret.labelDeductCents) || 0);
  const fee = isRefund && order ? restockingFee(order.lines || [], lines, rs?.policies || {}) : { cents: 0, lines: [], waived: false };
  const net = Math.max(0, gross - label - Math.min(Math.max(0, gross - label), fee.cents));
  const first = String(order?.customerName || '').split(' ')[0] || 'them';
  const autoBelow = Math.max(0, Number(rs?.policies?.refundAutoBelowCents) || 0);

  const go = async () => {
    setBusy(true); setErr('');
    try {
      for (const l of ret.lines || []) {
        if (l.disposition) continue;
        const r = await receiveReturnLine(fs, tenantId, { ...ret, id: ret.id }, l.lineId, cond[l.lineId] as any, actor);
        if (!r.ok) { setErr(r.message); feel(false); return; }
      }
      const snap = await getDoc(doc(fs, `tenants/${tenantId}/retailReturns`, ret.id));
      const cur = snap.exists() ? { ...(snap.data() as any), id: ret.id } : ret;
      const res = await resolveReturn(fs, tenantId, cur, actor);
      if (!res.ok) { setErr(res.message); feel(false); return; }
      let msg = res.message;
      // Sent now by someone allowed to refund, or by anyone when it's within the shop's automatic amount (the order's
      // whole queued refund; api/retail/refund checks it again). Otherwise it waits on Problems.
      const queued = res.refundQueuedCents || 0;
      const total = queued + Math.max(0, Number(order?.pendingRefundCents) || 0);
      const inAuto = autoBelow > 0 && total <= autoBelow;
      if (isRefund && queued > 0 && (canRefund || inAuto)) {
        const r = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: ret.orderId, qrToken: res.orderQrToken || order?.qrToken || '', ...(inAuto ? { reason: 'policy' } : {}) }) });
        const d = await r.json().catch(() => ({}));
        const plain = (Number(d.cardCents) || 0) > 0 && !(Number(d.otherCents) || 0) && !(Number(d.overCardCents) || 0) && d.recorded !== false;
        msg = !r.ok ? `Checked in. The refund didn’t send: ${d.error || 'try again from Problems'}.`
          : plain ? `Checked in. ${money(d.amountCents || res.refundQueuedCents || 0)} is on its way back to ${first}’s card.` : `Checked in. ${d.message || 'Refund sent.'}`;
      }
      feel(true); onDone(msg);
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Check in the return" sub={`${order ? `${order.customerName} · ` : ''}${isRefund ? 'Refund' : ret.resolution === 'store_credit' ? 'Store credit' : 'Replacement'}`} onClose={onClose}>
      <div className="mt-2">
        {(ret.lines || []).map((l: any) => (
          <div key={l.lineId} className="border-b py-3.5" style={{ borderColor: C.line }}>
            <div className="flex items-baseline justify-between gap-3"><p className="m-0 min-w-0 truncate text-[17px] font-semibold">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</p><span className="shrink-0 text-[13px]" style={muted}>{REASONS[String(l.reason)] || 'Other'}</span></div>
            {l.disposition ? <p className="m-0 mt-1 text-[14px]" style={muted}>Already checked in</p> : (
              <div className="mt-2.5"><Seg value={cond[l.lineId]} onChange={(v) => setCond((c) => ({ ...c, [l.lineId]: v }))} options={[{ id: 'restock', label: 'As new' }, { id: 'open_box', label: 'Opened' }, { id: 'damaged', label: 'Damaged' }]} /></div>)}
          </div>))}
      </div>
      {ret.resolution !== 'replacement' && (
        <div className="mt-3 space-y-1.5 text-[15px]">
          <div className="flex justify-between"><span style={muted}>Paid for these items, with tax</span><span>{money(gross)}</span></div>
          {label > 0 && <div className="flex justify-between"><span style={muted}>Return shipping</span><span>−{money(label)}</span></div>}
          {isRefund && (fee.waived ? <div className="flex justify-between"><span style={muted}>Restocking fee</span><span style={muted}>None, shop’s fault</span></div>
            : fee.cents > 0 ? <div className="flex justify-between"><span style={muted}>Restocking fee</span><span>−{money(fee.cents)}</span></div> : null)}
          <div className="flex justify-between border-t pt-2 text-[17px] font-semibold" style={{ borderColor: C.line }}><span>{isRefund ? 'Refund' : 'Store credit'}</span><span>{money(net)}</span></div>
        </div>)}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || !order} onClick={() => void go()}>
        {busy ? 'Checking in…' : isRefund && canRefund ? `Check in and refund ${money(net)}` : 'Check in'}
      </Btn>
      {isRefund && !canRefund && <p className="m-0 mt-2 text-center text-[13px]" style={muted}>A manager sends the refund once it’s checked in.</p>}
    </Sheet>);
}
