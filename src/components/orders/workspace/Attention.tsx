'use client';
// src/components/orders/workspace/Attention.tsx — WHAT THIS ORDER NEEDS FROM SOMEONE, AT THE TOP OF THE ORDER. Each card
// says what's wrong in plain words and has its fix on it: the ship-by date (and a new one), a hold for review (release
// it or ask for ID), waiting on stock (release it), a refund to send (or one already sent from the dashboard), an
// address change to answer, and label trouble (unused, voided, refused refunds, carrier adjustments). Nothing here
// opens another page.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { releaseHeld } from '@/lib/orders-flow';
import { markRefundExecuted } from '@/lib/retail-returns';
import { firstName, money, orderNum } from '@/lib/orders-view';
import { arrivalLabel, customerDates, dayLabel, longDayLabel, promisedDay } from '@/lib/ship-promise';
import { todayIn } from '@/lib/tenant-time';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { changePolicy, oneLine, openRequest } from '@/lib/address-flow';
import { slotsKnown, tail, voidedSlots } from '@/lib/label-boxes';
import { labelDoubt } from '@/lib/label-doubt';
import { isFollowUp } from '@/lib/order-family';
import type { Actor } from '@/lib/retail-fulfill';
import { setHold } from '../bulk';
import { LabelHistory } from '../LabelHistory';
import { Btn, C, Sheet, feel, muted } from '../ui';

const day = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'a few days ago'; };
const card = 'rounded-2xl p-4';

export function Attention({ fs, tenantId, order, actor, rs, shopZone, canRefund, isManager, recs, onToast, onShip, onMessage }: {
  fs: Firestore; tenantId: string; order: any; actor: Actor; rs: any; shopZone: string; canRefund: boolean; isManager: boolean; recs: any[] | null;
  onToast: (m: string) => void; onShip: () => void; onMessage: (text: string) => void;
}) {
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const [keepOpen, setKeepOpen] = React.useState(false); const [keepWhy, setKeepWhy] = React.useState('');
  const [confirmRefund, setConfirmRefund] = React.useState(false);
  const [newDate, setNewDate] = React.useState<{ day: string; note: string } | null>(null);
  const [releaseAsk, setReleaseAsk] = React.useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  React.useEffect(() => { setErr(''); setKeepOpen(false); setKeepWhy(''); setConfirmRefund(false); setNewDate(null); setReleaseAsk(null); }, [order.id]);

  const who = firstName(order.customerName);
  const terminal = ['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'].includes(order.stage);
  const post = async (url: string, body: any) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, ...body }) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.ok !== false, d };
  };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(''); try { await fn(); } catch { setErr('That didn’t go through. Try again.'); } setBusy(''); };

  // THE SHIP-BY DAY (lib/ship-promise): what the customer was told, if they were, and a way to tell them a new one.
  const tz = String(order.promise?.timeZone || shopZone);
  const shown = order.method === 'ship' ? customerDates(order, shopZone) : null;
  const shipDay = order.method === 'ship' && order.promise ? promisedDay(order, tz) : null;
  const sendNewDate = () => run('date', async () => {
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate.day)) { setErr('Choose the new ship-by day.'); return; }
    const { ok, d } = await post('/api/retail/delay-notice', { revisedDate: newDate.day, note: newDate.note.trim() });
    if (!ok) { setErr(d.error || 'The new date didn’t go out.'); return; }
    setNewDate(null); onToast(d.sent ? `${who} has the new date, and can cancel if it doesn’t work for them.` : 'They already have that date.');
  });

  // HELD FOR REVIEW: a manager releases it, or asks the customer to confirm their ID (Stripe identity).
  const reasons: string[] = Array.isArray(order.riskCheck?.reasons) && order.riskCheck.reasons.length ? order.riskCheck.reasons : order.holdReason ? [String(order.holdReason)] : [];
  const idc = String(order.idCheck?.status || '');
  const idLine = idc === 'verified' ? 'ID check passed' : idc === 'failed' ? 'ID check didn’t pass' : idc === 'sent' || idc === 'processing' ? 'ID check sent, waiting for them' : idc === 'canceled' ? 'They didn’t finish the ID check' : '';

  // WAITING ON STOCK: it isn't packed until it's released, by itself when stock comes in, or here.
  const held = order.holdUntilRestock === true && order.stage === 'paid';
  const release = (anyway: boolean) => run('release', async () => {
    const r = await releaseHeld(fs, tenantId, order, actor, anyway);
    feel(r.ok);
    if (r.ok) { setReleaseAsk(null); onToast(r.message); return; }
    if (!anyway && r.short?.length) { setReleaseAsk(r.message); return; }
    setReleaseAsk(null); setErr(r.message);
  });

  // A REFUND TO SEND. Within the shop's automatic amount anyone on the team can send it (api/retail/refund); never a
  // lost parcel's replacement, which the first parcel turning up would make a second refund.
  const pending = Number(order.pendingRefundCents) || 0;
  const follow = isFollowUp(order);
  const autoBelow = Math.max(0, Number(rs?.policies?.refundAutoBelowCents) || 0);
  const inAuto = autoBelow > 0 && pending > 0 && pending <= autoBelow && order.replacementFor !== 'lost_in_transit';
  const paidOther = !follow && ((Number(order.giftCardCents) || 0) > 0 || (Number(order.storeCreditRequestedCents) || 0) > 0);
  const shortLines = (order.lines || []).filter((l: any) => ['refunded', 'backordered', 'shorted'].includes(l.status));
  const doRefund = () => run('refund', async () => {
    const r = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', ...(inAuto ? { reason: 'policy' } : {}) }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setConfirmRefund(false); feel(true); onToast(d.message || 'Refund sent.'); } else setErr(d.error || 'The refund didn’t go through.');
  });
  // Refunded already in the card processor's own dashboard: recorded here, without charging anything (lib/retail-returns).
  const refundDoneByHand = () => run('manual', async () => {
    const r = await markRefundExecuted(fs, tenantId, order.id, actor);
    feel(r.ok); if (r.ok) { setConfirmRefund(false); onToast(r.message || 'Recorded as refunded.'); } else setErr(r.message);
  });

  // AN ADDRESS CHANGE TO ANSWER: one tap either way (api/retail/address). A held order's change is a manager's call.
  const req = order.method === 'ship' ? openRequest(order) : null;
  const labelled = !!(order.labelUrl || order.shippoTransactionId);
  const managerOnly = !!req && order.holdForReview === true && changePolicy(rs).heldNeedsManager && !isManager;
  const answerChange = (action: 'approve_change' | 'keep_old') => run(action, async () => {
    const { ok, d } = await post('/api/retail/address', { action, reason: keepWhy.trim() });
    if (ok) { feel(true); setKeepOpen(false); onToast(d.message || 'Done.'); } else setErr(d.error || 'That didn’t go through. Try again.');
  });

  // LABEL TROUBLE (lib/label-sweep): nobody has scanned it for days, a void didn't finish, or a closed order's label
  // couldn't be voided automatically. Void it for the postage, or say what happened.
  const unscannedLabel = order.labelUnscannedOpen === true && !!order.shippoTransactionId && ['packed', 'shipped', 'cancelled', 'refunded'].includes(order.stage);
  const lw = String(order.labelUnscanned?.why || '');
  const closedOrder = ['cancelled', 'refunded'].includes(order.stage);
  const leftOn = String(order.labelUnscanned?.on || '');
  const lbl = lw === 'void_unfinished'
    ? (order.stage === 'shipped'
      ? { title: 'Voiding this label didn’t finish', text: `A void was started ${day(order.labelUnscanned?.startedAt)}, before the box was marked shipped, and Shippo never confirmed it. Check the label in Shippo: if the refund went through, the carrier may charge the postage back.`, keep: 'Got it' }
      : { title: 'Voiding this label didn’t finish', text: `A void was started ${day(order.labelUnscanned?.startedAt)} and Shippo never confirmed it, so this label may no longer work. Void it again so the postage is sure to come back${closedOrder ? '' : ', then buy a new one if the box is still going'}.`, keep: closedOrder ? 'Leave it' : 'Keep the label' })
    : closedOrder
      ? { title: `This ${order.stage === 'refunded' ? 'refunded' : 'cancelled'} order still has a label`, text: `Bought ${day(order.labelUnscanned?.boughtAt)}. ${leftOn === 'form' ? 'It’s on a USPS form, so it wasn’t voided automatically.' : leftOn === 'shared' ? 'Every order in its box was cancelled, and a shared label isn’t voided automatically.' : 'It couldn’t be voided automatically.'} If the box didn’t go out, void it here and the postage comes back.`, keep: 'Leave it' }
      : order.stage === 'shipped'
        ? { title: 'The carrier hasn’t scanned this box', text: `Marked shipped ${day(order.completedAt)}, with no carrier scan since. If the box is still here, hand it over: the label works for 30 days after it was bought.`, keep: 'It went out' }
        : { title: 'This label hasn’t been used', text: lw === 'void_refused' ? `Bought ${day(order.labelUnscanned?.boughtAt)}. It couldn’t be voided automatically: if this box isn’t going out, void it here and the postage comes back.` : `Bought ${day(order.labelUnscanned?.boughtAt)}. If this box isn’t going out, void the label and the postage comes back.`, keep: 'It’s going out today' };
  const labelAction = (action: 'void' | 'unscanned_ok' | 'voided_seen' | 'refund_seen' | 'charge_seen') => run(action, async () => {
    const { ok, d } = await post('/api/retail/shipping-label', { qrToken: order.qrToken || '', action });
    if (ok) { feel(true); onToast(d.message || 'Done.'); } else setErr(d.error || 'That didn’t go through. Try again.');
  });
  const relabel = order.method === 'ship' && slotsKnown(order) && labelDoubt(order) === 'relabel' ? voidedSlots(order) : [];
  const denied = order.labelRefundDenied?.open === true ? order.labelRefundDenied : null;
  const deniedRec = denied ? (recs || []).find((r) => r.id === denied.labelId) : null;
  const charge = order.labelCharge?.open === true ? order.labelCharge : null;
  const reachable = !!(order.customerEmail || order.customerPhone);
  const carrierOpen = order.carrierIssue?.open === true ? order.carrierIssue : null;

  const warn = { background: C.warnSoft };
  const items: React.ReactNode[] = [];

  if (shipDay && !terminal) items.push(
    <div key="date" className={card} style={{ background: order.lateNeedsStaff?.open ? C.warnSoft : C.soft }}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[15px] font-semibold">Ships by {longDayLabel(shipDay, tz)}</p>
        <span className="shrink-0 text-[13px]" style={muted}>{shown ? 'They were told' : 'Your team’s date'}</span>
      </div>
      {shown?.arriveFrom && !order.trackingNumber && <p className="m-0 mt-1 text-[14px]" style={muted}>Arrives {arrivalLabel(shown, tz)}{shown.service ? ` with ${shown.service}` : ''}</p>}
      {shown?.originalShipBy && <p className="m-0 mt-1 text-[14px]" style={muted}>Moved from {dayLabel(shown.originalShipBy, tz)}{Number(order.autoDelayNotices) > 0 ? `, told by itself ${Number(order.autoDelayNotices) === 1 ? 'once' : `${order.autoDelayNotices} times`}` : ''}. They can cancel for a full refund until it ships.</p>}
      {order.lateNeedsStaff?.open && <p className="m-0 mt-1 text-[14px] font-semibold" style={{ color: C.warn }}>{order.lateNeedsStaff.why === 'held' ? 'It missed its date while held for review.' : 'It missed its new date again.'} Send them a new one, or ship it today.</p>}
      {shown && !order.trackingNumber && !order.shippoTransactionId && <Btn kind="soft" className="mt-3 h-11 w-full" style={{ background: C.paper }} onClick={() => setNewDate({ day: '', note: '' })}>Send a new date</Btn>}
    </div>);

  if (order.holdForReview && !terminal) items.push(
    <div key="held" className={card} style={warn}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>Held for review</p>
      <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{order.holdAuto ? 'Held by the automatic check.' : `Held by ${order.heldBy || 'the team'}.`} It isn’t packed until someone decides. The customer hasn’t been told.</p>
      {reasons.length > 0 && <ul className="m-0 mt-2 list-none space-y-1 p-0">{reasons.map((r) => <li key={r} className="flex gap-2 text-[14px]"><span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.warn }} />{r}</li>)}</ul>}
      {idLine && <p className="m-0 mt-2 text-[14px] font-semibold" style={{ color: idc === 'verified' ? C.ok : idc === 'failed' ? C.bad : C.ink }}>{idLine}</p>}
      {isManager ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="primary" className="h-11 flex-1" disabled={!!busy} onClick={() => void run('hold', async () => { onToast(await setHold(fs, tenantId, [order], actor, false)); })}>{busy === 'hold' ? 'Releasing…' : 'Looks fine, release to pack'}</Btn>
          {(!idc || idc === 'canceled' || idc === 'failed') && <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => void run('id', async () => { const { ok, d } = await post('/api/retail/id-check', {}); feel(ok); onToast(d.message || d.error || 'Done.'); })}>{busy === 'id' ? 'Sending…' : 'Ask them to confirm their ID'}</Btn>}
        </div>) : <p className="m-0 mt-2 text-[14px]" style={muted}>A manager decides on held orders.</p>}
    </div>);

  if (held) items.push(
    <div key="stock" className={card} style={{ background: C.soft }}>
      <p className="m-0 text-[15px] font-semibold">Waiting on stock</p>
      <p className="m-0 mt-1 text-[14px]" style={muted}>It goes into the packing queue by itself once everything it needs is on the shelf. If it’s there already, release it now.</p>
      <Btn kind="primary" className="mt-3 h-11 w-full" disabled={!!busy} onClick={() => void release(false)}>{busy === 'release' ? 'One moment…' : 'Release it to packing'}</Btn>
    </div>);

  if (pending > 0) items.push(
    <div key="refund" className={card} style={warn}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{money(pending)} to refund to {who}</p>
      <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{shortLines.length ? `${shortLines.map((l: any) => l.name).join(', ')} couldn’t be sent.` : order.stage === 'cancelled' ? 'The order was cancelled.' : 'A return or a problem they reported.'}</p>
      {canRefund || inAuto ? <Btn kind="primary" className="mt-3 h-11" onClick={() => setConfirmRefund(true)}>Review the refund</Btn> : <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>Waiting for someone allowed to send refunds.</p>}
    </div>);

  if (req) items.push(
    <div key="addr" className={card} style={warn}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{labelled ? `${who} changed the address after the label was bought` : `${who} asked to change the address`}</p>
      <div className="mt-2 gap-x-2.5 gap-y-1.5 text-[14px]" style={{ display: 'grid', gridTemplateColumns: '44px 1fr' }}>
        <span style={muted}>From</span><span style={{ color: C.muted, textDecoration: 'line-through' }}>{oneLine(order.shippingAddress)}</span>
        <span style={muted}>To</span><span>{[req.to?.name && req.to.name !== order.shippingAddress?.name ? req.to.name : '', oneLine(req.to)].filter(Boolean).join(', ')}</span>
      </div>
      {req.check?.verdict === 'valid' && <p className="m-0 mt-2 text-[14px] font-semibold" style={{ color: C.ok }}>Confirmed by the carrier address check</p>}
      {['unconfirmed', 'undeliverable', 'corrected'].includes(String(req.check?.verdict || '')) && <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>The carrier address check couldn’t confirm the new address.</p>}
      {(Number(req.cost?.diffCents) || 0) > 0 && <p className="m-0 mt-2 text-[14px]" style={muted}>{req.paid?.cents ? `It costs ${money(Number(req.cost.diffCents))} more to ship there. ${who} paid ${money(Number(req.paid.cents))} of it; if you keep the old address, that’s refunded to their card.` : `It costs about ${money(Number(req.cost.diffCents))} more to ship there. Approving it adds that to what you’ve covered for address changes.`}</p>}
      {!(Number(req.cost?.diffCents) || 0) && (Number(req.paid?.cents) || 0) > 0 && <p className="m-0 mt-2 text-[14px]" style={muted}>{who} paid {money(Number(req.paid.cents))} for shipping to the new address; if you keep the old one, it’s refunded to their card.</p>}
      {managerOnly ? <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>This order is held for review, so a manager approves the change.</p> : keepOpen ? (<>
        <label className="mt-3 block text-[13px] font-semibold" style={muted}>Why it stays (they see this)<input value={keepWhy} onChange={(e) => setKeepWhy(e.target.value)} placeholder="For example: it’s already packed and on the truck" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
        <Btn kind="primary" className="mt-3 h-11 w-full" disabled={!!busy} onClick={() => void answerChange('keep_old')}>Keep it and tell {who}</Btn>
        <Btn kind="plain" className="mt-1 h-11 w-full" onClick={() => setKeepOpen(false)}>Back</Btn>
      </>) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="primary" className="h-11 flex-1" disabled={!!busy} onClick={() => void answerChange('approve_change')}>{busy === 'approve_change' ? 'One moment…' : labelled ? 'Void label and buy a new one' : 'Use the new address'}</Btn>
          <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => setKeepOpen(true)}>Keep the old address</Btn>
        </div>)}
      <p className="m-0 mt-2 text-[13px]" style={muted}>{labelled ? 'The unused label is refunded by the carrier. Then buy the new one and put it over the old label.' : `${who} sees your answer on their order page.`}</p>
    </div>);

  if (unscannedLabel) items.push(
    <div key="unscanned" className={card} style={warn}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{lbl.title}</p>
      <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{lbl.text}{order.stage !== 'shipped' && Array.isArray(order.shippedWithOrderIds) && order.shippedWithOrderIds.length ? ' This label covers other orders in the same box, so voiding it takes it off all of them.' : ''}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {order.stage !== 'shipped' && <Btn kind="primary" className="h-11 flex-1" disabled={!!busy} onClick={() => void labelAction('void')}>Void the label</Btn>}
        <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => void labelAction('unscanned_ok')}>{lbl.keep}</Btn>
      </div>
    </div>);

  if (order.voidedLabelMoving?.open === true) {
    const n = Number(order.voidedLabelMoving.voidedBoxes) || 0; const u = Number(order.voidedLabelMoving.unconfirmedBoxes) || 0;
    items.push(
      <div key="moving" className={card} style={warn}>
        <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{n + u > 0 ? 'A box went out while other labels were being voided' : order.voidedLabelMoving.unsure ? 'The carrier scanned a label that was being voided' : 'The carrier scanned a label that was voided'}</p>
        <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{n + u > 0
          ? `The carrier has a box from this order.${n ? ` ${n} other box label${n === 1 ? ' was' : 's were'} voided.` : ''}${u ? ` Shippo didn’t answer for ${u === 1 ? 'another box' : `${u} other boxes`}, so ${u === 1 ? 'its label' : 'their labels'} may be voided too: check in Shippo.` : ''} ${relabel.length ? 'Any box that’s still here and whose label was voided needs a new one before it goes out: buy it on the Ship tab.' : 'Any box that’s still here and whose label was voided needs a new one bought in Shippo before it goes out; it won’t show on this order.'}`
          : `${order.voidedLabelMoving.unsure ? `A void of tracking ${order.voidedLabelMoving.trackingNumber || ''} didn’t finish, and the carrier has scanned the box since.` : `Tracking ${order.voidedLabelMoving.trackingNumber || ''} is moving.`} Check the label in Shippo: if the refund was turned down, the box is fine and on its way. If the refund went through, the carrier may charge the postage back.`}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {relabel.length > 0 && <Btn kind="primary" className="h-11 flex-1" onClick={onShip}>Buy {relabel.length === 1 ? `box ${relabel[0].slot + 1}’s` : 'the'} new label</Btn>}
          <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => void labelAction('voided_seen')}>Got it</Btn>
        </div>
      </div>);
  }

  if (relabel.length > 0 && order.voidedLabelMoving?.open !== true && ['paid', 'picking', 'packed', 'shipped'].includes(order.stage)) items.push(
    <div key="relabel" className={card} style={warn}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{relabel.length === 1 ? `Box ${relabel[0].slot + 1} needs a new label` : `${relabel.length} boxes need new labels`}</p>
      <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{relabel.length === 1 ? `Its label (${tail(relabel[0].tracking)}) was voided while the other box${(order.packageCount || 2) > 2 ? 'es' : ''} kept theirs.` : 'Their labels were voided while the other boxes kept theirs.'} Buy {relabel.length === 1 ? 'its' : 'their'} new label{relabel.length === 1 ? '' : 's'} on the Ship tab, or take {relabel.length === 1 ? 'it' : 'them'} off the order there. It can’t be marked shipped until then.</p>
      <Btn kind="primary" className="mt-3 h-11 w-full" onClick={onShip}>Go to the Ship tab</Btn>
    </div>);

  if (denied) items.push(
    <div key="denied" className={card} style={{ border: `2px solid ${C.ink}` }}>
      <p className="m-0 text-[16px] font-semibold">A refund was turned down</p>
      <p className="m-0 mt-1 text-[14px]" style={muted}>Shippo turned down the refund for the label{denied.tracking ? ` ending ${String(denied.tracking).slice(-4)}` : ''}. That means the carrier scanned it, so the {money(Number(denied.cents) || 0)} stays in the books as postage.</p>
      {deniedRec && (
        <div className="mt-3 flex flex-col gap-2">
          {[deniedRec.voidedAt ? { t: `Voided${deniedRec.voidWhy ? `: ${String(deniedRec.voidWhy).replace(/^voided by hand/, 'by hand')}` : ''}`, at: deniedRec.voidedAt, tone: 'plain' } : deniedRec.replacedBy ? { t: 'Replaced with a new label', at: deniedRec.replacedAt, tone: 'plain' } : null,
            { t: 'Refund requested', at: deniedRec.refunds?.[denied.txn]?.requestedAt, tone: 'plain' },
            { t: 'Turned down: the carrier scanned it', at: denied.at, tone: 'warn' }].filter(Boolean).map((x: any, i: number) => (
            <div key={i} className="flex items-start gap-3"><span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.tone === 'warn' ? C.warn : C.line }} /><span className="flex-1"><span className="block text-[14.5px]">{x.t}</span><span className="block text-[12.5px]" style={muted}>{day(x.at)}</span></span></div>))}
        </div>)}
      <p className="m-0 mt-2 text-[12.5px]" style={muted}>If that box went out, {who} may get two boxes. Check with {who} before sending anything else.</p>
      <div className="mt-3 flex gap-2">
        {reachable && <Btn kind="soft" className="h-11 flex-1" onClick={() => onMessage(`Hi ${who}, a quick check on your order ${orderNum(order)}: an earlier box may have gone out as well as the one you’re expecting. If two arrive, let us know here and we’ll sort it out.`)}>Message {who}</Btn>}
        <Btn kind="soft" className="h-11 flex-1" disabled={!!busy} onClick={() => void labelAction('refund_seen')}>Got it</Btn>
      </div>
    </div>);

  if (charge) items.push(
    <div key="charge" className={card} style={warn}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>Carrier adjustment: {Number(charge.cents) > 0 ? '+' : '−'}{money(Math.abs(Number(charge.cents) || 0))}</p>
      <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{Number(charge.cents) > 0 ? `${order.carrier || 'The carrier'} charged more for this shipment after the label was bought, usually because it weighed or measured a box differently.` : `${order.carrier || 'The carrier'} gave some postage back on this shipment.`} Recorded in Money as shipping.</p>
      <div className="mt-3 flex gap-2">
        <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} onClick={() => setLabelsOpen(true)}>See the labels</Btn>
        <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => void labelAction('charge_seen')}>Got it</Btn>
      </div>
    </div>);

  if (carrierOpen && ['shipped', 'completed'].includes(order.stage)) {
    const carrier = String(carrierOpen.carrier || order.carrier || 'The carrier').split(/\s+/)[0];
    const why = String(carrierOpen.detail || '').trim().replace(/\.$/, '');
    const kind = String(carrierOpen.status || '');
    const text = kind === 'RETURNED' ? `Hi ${who}, ${carrier} is sending your order ${orderNum(order)} back to us${why ? ` (${why.charAt(0).toLowerCase()}${why.slice(1)})` : ''}. Would you like us to send it again, or refund you? If the address needs a change, tell us here.`
      : kind === 'FAILURE' ? `Hi ${who}, ${carrier} couldn’t deliver your order ${orderNum(order)}${why ? ` (${why.charAt(0).toLowerCase()}${why.slice(1)})` : ''}. Can you check the address for us here, so we can get it to you?` : '';
    items.push(
      <div key="carrier" className={card} style={warn}>
        <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{kind === 'RETURNED' ? `${carrier} is sending it back` : kind === 'FAILURE' ? `${carrier} couldn’t deliver it` : kind === 'STALLED' ? 'No carrier scan for a while' : `${carrier} reported a problem`}</p>
        {why && <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{why}.</p>}
        <div className="mt-3 flex gap-2">
          {reachable && text && <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} onClick={() => onMessage(text)}>Message {who}</Btn>}
          <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={!!busy} onClick={() => void run('seen', async () => {
            await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { 'carrierIssue.open': false, 'carrierIssue.seenAt': new Date().toISOString(), 'carrierIssue.seenBy': actor.name });
          })}>Got it</Btn>
        </div>
      </div>);
  }

  if (!items.length && !err) return null;
  return (
    <div className="flex flex-col gap-3">
      {items}
      {err && <p role="alert" className="m-0 text-[15px]" style={{ color: C.warn }}>{err}</p>}

      {confirmRefund && (
        <Sheet title={`Refund ${money(pending)} to ${who}?`} sub={`${orderNum(order)} · back to the card they paid with${follow ? ' on the original order' : ''}${paidOther ? ', and what a gift card or store credit paid goes back that way' : ''}`} onClose={() => setConfirmRefund(false)}>
          <div className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[15px]">
            <span style={muted}>Why</span><span>{shortLines.length ? `${shortLines.map((l: any) => l.name).join(', ')} couldn’t be sent` : order.stage === 'cancelled' ? 'The order was cancelled' : 'A return or a problem they reported'}</span>
            <span style={muted}>They paid</span><span>{follow ? `On the original order${order.refundedCents ? `, ${money(order.refundedCents)} refunded on this one already` : ''}` : `${money(order.chargedCents ?? order.totalCents)}${order.refundedCents ? `, ${money(order.refundedCents)} refunded already` : ''}`}</span>
            <span style={muted}>{who} gets</span><span>An email with the amount and when to expect it</span>
          </div>
          <Btn kind="danger" className="mt-4 w-full text-[17px]" disabled={!!busy} onClick={() => void doRefund()}>{busy === 'refund' ? 'Sending…' : `Send ${money(pending)} refund`}</Btn>
          {(isManager || canRefund) && <Btn kind="plain" className="mt-1 w-full" style={muted} disabled={!!busy} onClick={() => void refundDoneByHand()}>{busy === 'manual' ? 'Recording…' : 'Already refunded it in the payments dashboard? Record it'}</Btn>}
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
      {releaseAsk !== null && (
        <Sheet title="Release it anyway?" sub={`${releaseAsk} It goes into the packing queue now. Whoever packs it can send what’s missing later or refund it.`} onClose={() => setReleaseAsk(null)} closeLabel="Wait for stock">
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={!!busy} onClick={() => void release(true)}>Release it</Btn>
        </Sheet>)}
      {newDate && (
        <Sheet title="Send a new date" sub={`${who} gets the new ship-by day and can cancel for a full refund if it doesn’t work for them.`} onClose={() => setNewDate(null)}>
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Ships by
            <input type="date" value={newDate.day} min={todayIn(tz)} onChange={(e) => setNewDate({ ...newDate, day: e.target.value })} className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <label className="mt-3 block text-[13px] font-semibold" style={muted}>A note for them (optional)
            <textarea value={newDate.note} maxLength={400} rows={3} onChange={(e) => setNewDate({ ...newDate, note: e.target.value })} placeholder="For example: the new batch arrives Thursday" className="mt-1 w-full rounded-2xl border px-4 py-3 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={!!busy || !newDate.day} onClick={() => void sendNewDate()}>{busy === 'date' ? 'Sending…' : 'Send the new date'}</Btn>
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
      {labelsOpen && <LabelHistory order={order} recs={recs} onClose={() => setLabelsOpen(false)} />}
    </div>);
}
