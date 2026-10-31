'use client';
// src/components/orders/ReturnSheet.tsx — CHECK IN A RETURN. Scan each item (a handheld scanner, or type its code) or
// mark it, so nothing is checked in that isn't in hand; then say what condition it came back in. The sheet shows the
// money as you go: what they paid for those items, minus return shipping if they pay it, minus the restocking fee for
// that condition (never when the shop was at fault). One button checks it all in and, for a refund, sends it to their
// card. Used from Problems and straight after Start a return at the counter (StartReturnSheet).
import * as React from 'react';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { receiveReturnLine, resolveReturn } from '@/lib/fulfil-client';
import { restockingFee } from '@/lib/restocking';
import { lineMatchesScan, returnRefundCents } from '@/lib/retail-orders';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { askWhich, codeBook, lookupCode, pickFor } from '@/lib/code-lookup';
import { lineProductId } from '@/lib/product-codes';
import { useInventory } from '@/context/InventoryContext';
import { money } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, feel, muted } from './ui';

// The condition it came back in, chosen for each item (never assumed: a faulty item put back on the shelf by default
// would be sold again). Where it goes is lib/retail-returns receiveReturnLine.
type Cond = 'restock' | 'open_box' | 'damaged' | 'dispose';
const CONDS: { id: Cond; label: string }[] = [{ id: 'restock', label: 'As new' }, { id: 'open_box', label: 'Opened' }, { id: 'damaged', label: 'Damaged' }, { id: 'dispose', label: 'Throw away' }];
const REASONS: Record<string, string> = { damaged_in_transit: 'Arrived damaged', defective: 'Doesn’t work', wrong_item: 'Wrong item', changed_mind: 'Changed their mind', other: 'Other' };

export function ReturnSheet({ fs, tenantId, ret, initialOrder, actor, rs, canRefund, onClose, onDone }: { fs: Firestore; tenantId: string; ret: any; initialOrder?: any | null; actor: Actor; rs: any; canRefund: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [order, setOrder] = React.useState<any | null>(initialOrder || null);
  const [cond, setCond] = React.useState<Record<string, Cond | undefined>>({});
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  // In hand: units scanned or marked, per item (one already checked in counts in full).
  const [got, setGot] = React.useState<Record<string, number>>(() => Object.fromEntries((ret.lines || []).map((l: any) => [l.lineId, l.disposition ? Math.max(1, Number(l.qty) || 1) : 0])));
  const [heard, setHeard] = React.useState(''); const [code, setCode] = React.useState('');
  const want = (l: any) => Math.max(1, Number(l.qty) || 1);
  const allIn = (ret.lines || []).every((l: any) => (got[l.lineId] || 0) >= want(l));
  const allGraded = (ret.lines || []).every((l: any) => !!l.disposition || !!cond[l.lineId]);
  const inv: any = useInventory();
  const scan = (v: string) => {
    const t = String(v || '').trim(); if (!t) return;
    const pairs = (ret.lines || []).map((rl: any) => ({ rl, orig: (order?.lines || []).find((x: any) => x.lineId === rl.lineId) })).filter((x: any) => x.orig);
    const open = pairs.filter((x: any) => (got[x.rl.lineId] || 0) < want(x.rl));
    // The codes the item was sold with first, then the products' codes now (a barcode changed since); a listing's own
    // code with two of its variants coming back asks which (lib/code-lookup).
    let hit: any = open.find((x: any) => lineMatchesScan(x.orig, t))?.rl;
    let found: any = null;
    if (!hit) {
      found = lookupCode(codeBook(inv?.inventory || []), t);
      const picked = pickFor(found, open, (x: any) => lineProductId(x.orig));
      const ask = askWhich(found, picked, (x: any) => lineProductId(x.orig), (x: any) => [x.orig.name, x.orig.optionsLabel].filter(Boolean).join(' · '), 'this return');
      if (ask) { feel(false); setHeard(ask); return; }
      hit = (picked.pick as any)?.rl;
    }
    if (!hit) {
      const full = pairs.find((x: any) => lineMatchesScan(x.orig, t)) || (found ? (pickFor(found, pairs, (x: any) => lineProductId(x.orig)).pick as any) : null);
      feel(false);
      setHeard(full ? `${full.rl.name}: all ${want(full.rl)} already in hand.` : found?.kind === 'product' ? `That’s ${found.item?.name || 'another product'}, which isn’t on this return.` : 'That isn’t on this return.');
      return;
    }
    const n = Math.min(want(hit), (got[hit.lineId] || 0) + 1);
    feel(true); setGot((g) => ({ ...g, [hit.lineId]: Math.min(want(hit), (g[hit.lineId] || 0) + 1) })); setHeard(`${hit.name}${want(hit) > 1 ? `: ${n} of ${want(hit)}` : ''} in hand.`);
  };
  // A handheld scanner anywhere on the sheet, ahead of the screen behind it.
  useWedgeScanner((v) => scan(v), !!order, { layer: 'front' });
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
      if (!allIn) { setErr('Scan or mark every item first.'); return; }
      if (!allGraded) { setErr('Say what condition each item is in.'); return; }
      // The return as it's saved now, so a try after one that stopped part way picks up where it left off (an item
      // already checked in isn't checked in again).
      const now0 = await getDoc(doc(fs, `tenants/${tenantId}/retailReturns`, ret.id)).catch(() => null);
      const saved: any = now0?.exists() ? { ...(now0.data() as any), id: ret.id } : ret;
      for (const l of saved.lines || []) {
        if (l.disposition) continue;
        const r = await receiveReturnLine(fs, tenantId, saved, l.lineId, cond[l.lineId] as any, actor);
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
    <Sheet title="Check in the return" sub={`${order ? `${order.customerName} · ` : ''}${isRefund ? 'Refund' : ret.resolution === 'store_credit' ? 'Store credit' : 'Replacement'}`} onClose={onClose} closeLabel="Check in later">
      {ret.notes ? <p className="m-0 mt-1 rounded-xl px-3 py-2 text-[14px]" style={{ background: C.soft }}><span className="font-semibold">Note:</span> {String(ret.notes).slice(0, 500)}</p> : null}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); scan(code); setCode(''); }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Scan or type an item’s code" placeholder="Scan an item, or type its code" className="h-11 min-w-0 flex-1 rounded-full border px-4 text-[15px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
        <Btn kind="soft" type="submit" className="h-11 px-4 text-[14px]">Add</Btn>
      </form>
      <p role="status" aria-live="polite" className="m-0 mt-1.5 min-h-[18px] text-[13px]" style={muted}>{heard}</p>
      <div className="mt-1">
        {(ret.lines || []).map((l: any) => (
          <div key={l.lineId} className="border-b py-3.5" style={{ borderColor: C.line }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="m-0 truncate text-[17px] font-semibold">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</p><p className="m-0 text-[13px]" style={muted}>{REASONS[String(l.reason)] || 'Other'}</p></div>
              {!l.disposition && (
                <button type="button" aria-label={`Mark ${l.name} in hand${want(l) > 1 && (got[l.lineId] || 0) > 0 && (got[l.lineId] || 0) < want(l) ? `, ${got[l.lineId]} of ${want(l)} so far` : ''}`} aria-pressed={(got[l.lineId] || 0) >= want(l)} onClick={() => setGot((g) => ({ ...g, [l.lineId]: (g[l.lineId] || 0) >= want(l) ? 0 : want(l) }))}
                  className="cf-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold"
                  style={(got[l.lineId] || 0) >= want(l) ? { background: C.okSoft, color: C.ok } : { background: C.soft, color: C.ink }}>
                  {(got[l.lineId] || 0) >= want(l) ? <><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>In hand</> : want(l) > 1 && (got[l.lineId] || 0) > 0 ? `${got[l.lineId]} of ${want(l)}` : 'Mark'}
                </button>)}
            </div>
            {l.disposition ? <p className="m-0 mt-1 text-[14px]" style={muted}>Already checked in</p> : (
              <div className="mt-2.5">
                <div role="group" aria-label={`Condition of ${l.name}`} className="flex flex-wrap gap-1.5">
                  {CONDS.map((c) => <button key={c.id} type="button" aria-pressed={cond[l.lineId] === c.id} onClick={() => setCond((x) => ({ ...x, [l.lineId]: c.id }))}
                    className="cf-press h-11 rounded-full px-3.5 text-[14px] font-semibold" style={cond[l.lineId] === c.id ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{c.label}</button>)}
                </div>
                <p className="m-0 mt-1.5 text-[13px]" style={muted}>{!cond[l.lineId] ? 'What condition is it in?' : cond[l.lineId] === 'restock' ? 'Goes back into stock.' : cond[l.lineId] === 'open_box' ? (rs?.policies?.openedReturns === 'restock' ? 'Goes back into stock (your policy for opened items).' : 'Written off at cost (your policy for opened items).') : cond[l.lineId] === 'dispose' ? 'Thrown away and written off at cost (for anything that can’t be sold again).' : 'Written off at cost.'}</p></div>)}
          </div>))}
      </div>
      {ret.resolution !== 'replacement' && !allGraded && <p className="m-0 mt-3 text-[14px]" style={muted}>The {isRefund ? 'refund' : 'store credit'} shows once each item’s condition is chosen.</p>}
      {ret.resolution !== 'replacement' && allGraded && (
        <div className="mt-3 space-y-1.5 text-[15px]">
          <div className="flex justify-between"><span style={muted}>Paid for these items, with tax</span><span>{money(gross)}</span></div>
          {label > 0 && <div className="flex justify-between"><span style={muted}>Return shipping</span><span>−{money(label)}</span></div>}
          {isRefund && (fee.waived ? <div className="flex justify-between"><span style={muted}>Restocking fee</span><span style={muted}>None, shop’s fault</span></div>
            : fee.cents > 0 ? <div className="flex justify-between"><span style={muted}>Restocking fee</span><span>−{money(fee.cents)}</span></div> : null)}
          <div className="flex justify-between border-t pt-2 text-[17px] font-semibold" style={{ borderColor: C.line }}><span>{isRefund ? 'Refund' : 'Store credit'}</span><span>{money(net)}</span></div>
        </div>)}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      {(!allIn || !allGraded) && <p className="m-0 mt-3 text-[13px]" style={muted}>{!allIn ? 'Scan or mark each item once it’s in your hands' : 'Say what condition each item is in'}{!allIn && !allGraded ? ', and say what condition it’s in' : ''}.</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || !order || !allIn || !allGraded} onClick={() => void go()}>
        {busy ? 'Checking in…' : isRefund && canRefund ? `Check in and refund ${money(net)}` : 'Check in'}
      </Btn>
      {isRefund && !canRefund && <p className="m-0 mt-2 text-center text-[13px]" style={muted}>A manager sends the refund once it’s checked in.</p>}
    </Sheet>);
}
