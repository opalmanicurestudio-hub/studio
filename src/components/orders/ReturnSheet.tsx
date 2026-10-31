'use client';
// src/components/orders/ReturnSheet.tsx — CHECK IN A RETURN. Scan each item (a handheld scanner, or type its code) or
// mark it, so nothing is checked in that isn't in hand; then say what condition it came back in. The sheet shows the
// money as you go: what they paid for those items, minus return shipping if they pay it, minus the restocking fee for
// that condition (never when the shop was at fault). One button checks it all in and, for a refund, sends it to their
// card. Used from Problems and straight after Start a return at the counter (StartReturnSheet).
// Only part of it came back: count what did, say whether the rest is still coming, and check in just that (the server
// cuts the return down, lib/retail-returns trimReturn). Something to look at properly later is held to check: kept out
// of stock, and it waits in Problems until someone decides.
import * as React from 'react';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { receiveReturnLine, resolveReturn, trimReturn } from '@/lib/fulfil-client';
import { restockingFee, returnIsShopFault } from '@/lib/restocking';
import { lineMatchesScan, returnRefundCents, trimmedReturnCents } from '@/lib/retail-orders';
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
type Cond = 'restock' | 'open_box' | 'damaged' | 'dispose' | 'quarantine';
const CONDS: { id: Cond; label: string }[] = [{ id: 'restock', label: 'As new' }, { id: 'open_box', label: 'Opened' }, { id: 'damaged', label: 'Damaged' }, { id: 'dispose', label: 'Throw away' }, { id: 'quarantine', label: 'Hold to check' }];
const REASONS: Record<string, string> = { damaged_in_transit: 'Arrived damaged', defective: 'Doesn’t work', wrong_item: 'Wrong item', changed_mind: 'Changed their mind', other: 'Other' };

export function ReturnSheet({ fs, tenantId, ret, initialOrder, actor, rs, canRefund, onClose, onDone }: { fs: Firestore; tenantId: string; ret: any; initialOrder?: any | null; actor: Actor; rs: any; canRefund: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [order, setOrder] = React.useState<any | null>(initialOrder || null);
  const [cond, setCond] = React.useState<Record<string, Cond | undefined>>({});
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  // In hand: units scanned or marked, per item (one already checked in counts in full).
  const [got, setGot] = React.useState<Record<string, number>>(() => Object.fromEntries((ret.lines || []).map((l: any) => [l.lineId, l.disposition ? Math.max(1, Number(l.qty) || 1) : 0])));
  const [heard, setHeard] = React.useState(''); const [code, setCode] = React.useState('');
  // Only part of it came back: what did is counted, and the rest isn't coming ('drop') or is still coming ('keep').
  const [part, setPart] = React.useState(false); const [rest, setRest] = React.useState<'drop' | 'keep' | ''>('');
  const want = (l: any) => Math.max(1, Number(l.qty) || 1);
  const have = (l: any) => (l.disposition ? want(l) : Math.min(want(l), got[l.lineId] || 0));
  const allIn = (ret.lines || []).every((l: any) => have(l) >= want(l));
  // What's being checked in: everything, or what came back.
  const here = (ret.lines || []).filter((l: any) => !part || have(l) > 0);
  const short = part && !allIn;
  const allGraded = here.length > 0 && here.every((l: any) => !!l.disposition || !!cond[l.lineId]);
  const ready = part ? here.length > 0 && allGraded && (!short || !!rest) : allIn && allGraded;
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

  const lines = here.map((l: any) => ({ ...l, qty: part ? have(l) : l.qty, disposition: l.disposition || cond[l.lineId] }));
  const isRefund = ret.resolution === 'refund';
  // What they paid for these items, with their tax: worked out the same way the return is settled (lib/retail-returns),
  // and for only part of it, the same share of what it was started at.
  const paidBack = order ? returnRefundCents(order, lines) : 0;
  const quoted = isRefund ? Number(ret.refundCents) || 0 : Number(ret.storeCreditCents) || 0;
  const gross = Math.max(short && order ? trimmedReturnCents(order, ret.lines || [], lines, quoted) : quoted, ret.resolution === 'replacement' ? 0 : paidBack);
  const label = Math.max(0, Number(ret.labelDeductCents) || 0);
  // The shop's fault on the return waives the fee on whatever part comes back while the faulty item is still coming;
  // one that isn't coming leaves the rest as it is (lib/retail-returns trimReturn).
  const fault = ret.shopFault === true || returnIsShopFault(short && rest === 'drop' ? lines : ret.lines || []);
  const fee = isRefund && order ? restockingFee(order.lines || [], lines, rs?.policies || {}, fault) : { cents: 0, lines: [], waived: false };
  // The nightly check closes a return that never comes back after the shop's limit (lib/return-close; 0: never).
  const closeDays = rs?.policies?.returnCloseAfterDays == null ? 30 : Math.max(0, Math.floor(Number(rs.policies.returnCloseAfterDays) || 0));
  const net = Math.max(0, gross - label - Math.min(Math.max(0, gross - label), fee.cents));
  const first = String(order?.customerName || '').split(' ')[0] || 'them';
  const autoBelow = Math.max(0, Number(rs?.policies?.refundAutoBelowCents) || 0);

  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (!part && !allIn) { setErr('Scan or mark every item first.'); return; }
      if (part && !here.length) { setErr('Mark what came back first.'); return; }
      if (!allGraded) { setErr('Say what condition each item is in.'); return; }
      if (short && !rest) { setErr('Say whether the rest is still coming.'); return; }
      // Only part came back: the return is cut down to it first, on the server (asked again with the same counts,
      // nothing more changes).
      let restLine = '';
      if (short) {
        const t = await trimReturn(tenantId, ret.id, (ret.lines || []).filter((l: any) => !l.disposition).map((l: any) => ({ lineId: l.lineId, qty: have(l) })), rest as 'drop' | 'keep');
        if (!t.ok) { setErr(t.message); feel(false); return; }
        if (t.trimmed || (t as any).earlier) restLine = ` ${t.message}`;
      }
      // The return as it's saved now, so a try after one that stopped part way picks up where it left off (an item
      // already checked in isn't checked in again).
      const now0 = await getDoc(doc(fs, `tenants/${tenantId}/retailReturns`, ret.id)).catch(() => null);
      const saved: any = now0?.exists() ? { ...(now0.data() as any), id: ret.id } : ret;
      for (const l of saved.lines || []) {
        if (l.disposition) continue;
        // Never checked in without its condition (the server refuses it too).
        if (!cond[l.lineId]) { setErr(`Say what condition ${l.name} is in.`); feel(false); return; }
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
      feel(true); onDone(`${msg}${restLine && !/[.!?]$/.test(msg) ? '.' : ''}${restLine}`);
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
        {(ret.lines || []).map((l: any) => {
          const n = have(l); const back = !part || n > 0;
          return (
          <div key={l.lineId} className="border-b py-3.5" style={{ borderColor: C.line }}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="m-0 truncate text-[17px] font-semibold">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</p><p className="m-0 text-[13px]" style={muted}>{REASONS[String(l.reason)] || 'Other'}</p></div>
              {!l.disposition && !part && (
                <button type="button" aria-label={`Mark ${l.name} in hand${want(l) > 1 && n > 0 && n < want(l) ? `, ${n} of ${want(l)} so far` : ''}`} aria-pressed={n >= want(l)} onClick={() => setGot((g) => ({ ...g, [l.lineId]: (g[l.lineId] || 0) >= want(l) ? 0 : want(l) }))}
                  className="cf-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold"
                  style={n >= want(l) ? { background: C.okSoft, color: C.ok } : { background: C.soft, color: C.ink }}>
                  {n >= want(l) ? <><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>In hand</> : want(l) > 1 && n > 0 ? `${n} of ${want(l)}` : 'Mark'}
                </button>)}
              {!l.disposition && part && (
                <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`How many ${l.name} came back`}>
                  <button type="button" aria-label={`One fewer ${l.name}`} disabled={n <= 0} onClick={() => setGot((g) => ({ ...g, [l.lineId]: Math.max(0, Math.min(want(l), g[l.lineId] || 0) - 1) }))} className="cf-press h-11 w-11 rounded-full text-[18px] disabled:opacity-40" style={{ background: C.soft }}>−</button>
                  <span className="min-w-[44px] text-center text-[15px] font-semibold" aria-live="polite">{n} of {want(l)}</span>
                  <button type="button" aria-label={`One more ${l.name}`} disabled={n >= want(l)} onClick={() => setGot((g) => ({ ...g, [l.lineId]: Math.min(want(l), (g[l.lineId] || 0) + 1) }))} className="cf-press h-11 w-11 rounded-full text-[18px] disabled:opacity-40" style={{ background: C.soft }}>+</button>
                </div>)}
            </div>
            {l.disposition ? <p className="m-0 mt-1 text-[14px]" style={muted}>Already checked in</p> : !back ? <p className="m-0 mt-1 text-[14px]" style={muted}>Didn’t come back</p> : (
              <div className="mt-2.5">
                <div role="group" aria-label={`Condition of ${l.name}`} className="flex flex-wrap gap-1.5">
                  {CONDS.map((c) => <button key={c.id} type="button" aria-pressed={cond[l.lineId] === c.id} onClick={() => setCond((x) => ({ ...x, [l.lineId]: c.id }))}
                    className="cf-press h-11 rounded-full px-3.5 text-[14px] font-semibold" style={cond[l.lineId] === c.id ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{c.label}</button>)}
                </div>
                <p className="m-0 mt-1.5 text-[13px]" style={muted}>{!cond[l.lineId] ? 'What condition is it in?' : cond[l.lineId] === 'restock' ? 'Goes back into stock.' : cond[l.lineId] === 'open_box' ? (rs?.policies?.openedReturns === 'restock' ? 'Goes back into stock (your policy for opened items).' : 'Written off at cost (your policy for opened items).') : cond[l.lineId] === 'dispose' ? 'Thrown away and written off at cost (for anything that can’t be sold again).' : cond[l.lineId] === 'quarantine' ? 'Kept out of stock until someone checks it. It waits in Problems.' : 'Written off at cost.'}</p></div>)}
          </div>);
        })}
      </div>
      {!part && !allIn && <button type="button" onClick={() => { setPart(true); setErr(''); }} className="cf-press mt-2 h-11 text-[15px] font-semibold underline underline-offset-4" style={{ color: C.ink }}>Only part of it came back</button>}
      {part && (
        <div className="mt-3">
          {short && (
            <div role="group" aria-label="What about the rest?">
              <p className="m-0 text-[15px] font-semibold">What about the rest?</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {([['drop', 'It isn’t coming'], ['keep', 'It’s still coming']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={rest === id} onClick={() => setRest(id)}
                  className="cf-press h-11 rounded-full px-3.5 text-[14px] font-semibold" style={rest === id ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{label}</button>)}
              </div>
              <p className="m-0 mt-1.5 text-[13px]" style={muted}>{rest === 'drop' ? `${first === 'them' ? 'They’re' : `${first} is`} told it wasn’t checked in. It can be returned again later.` : rest === 'keep' ? `It waits in Problems as a return of its own${closeDays ? `, and closes by itself if it hasn’t come in ${closeDays} day${closeDays === 1 ? '' : 's'}` : ' until it comes or you close it'}.` : 'Is the rest still on its way?'}</p>
            </div>)}
          <button type="button" onClick={() => { setPart(false); setRest(''); setErr(''); }} className="cf-press mt-1 h-11 text-[15px] font-semibold underline underline-offset-4" style={{ color: C.ink }}>Everything came back</button>
        </div>)}
      {ret.resolution !== 'replacement' && !allGraded && here.length > 0 && <p className="m-0 mt-3 text-[14px]" style={muted}>The {isRefund ? 'refund' : 'store credit'} shows once each item’s condition is chosen.</p>}
      {ret.resolution !== 'replacement' && allGraded && (
        <div className="mt-3 space-y-1.5 text-[15px]">
          <div className="flex justify-between"><span style={muted}>Paid for {short ? 'what came back' : 'these items'}, with tax</span><span>{money(gross)}</span></div>
          {label > 0 && <div className="flex justify-between"><span style={muted}>Return shipping</span><span>−{money(label)}</span></div>}
          {isRefund && (fee.waived ? <div className="flex justify-between"><span style={muted}>Restocking fee</span><span style={muted}>None, shop’s fault</span></div>
            : fee.cents > 0 ? <div className="flex justify-between"><span style={muted}>Restocking fee</span><span>−{money(fee.cents)}</span></div> : null)}
          <div className="flex justify-between border-t pt-2 text-[17px] font-semibold" style={{ borderColor: C.line }}><span>{isRefund ? 'Refund' : 'Store credit'}</span><span>{money(net)}</span></div>
        </div>)}
      {err && <p role="alert" className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>{err}</p>}
      {!ready && <p className="m-0 mt-3 text-[13px]" style={muted}>{part
        ? (!here.length ? 'Count what came back.' : !allGraded ? 'Say what condition each item is in.' : 'Say whether the rest is still coming.')
        : `${!allIn ? 'Scan or mark each item once it’s in your hands' : 'Say what condition each item is in'}${!allIn && !allGraded ? ', and say what condition it’s in' : ''}.`}</p>}
      <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || !order || !ready} onClick={() => void go()}>
        {busy ? 'Checking in…' : `Check in${isRefund && canRefund && (!part || allGraded) ? ` and refund ${money(net)}` : short ? ' what came back' : ''}`}
      </Btn>
      {isRefund && !canRefund && <p className="m-0 mt-2 text-center text-[13px]" style={muted}>A manager sends the refund once it’s checked in.</p>}
    </Sheet>);
}
