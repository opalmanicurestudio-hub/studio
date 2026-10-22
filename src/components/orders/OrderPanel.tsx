'use client';
// src/components/orders/OrderPanel.tsx — ONE ORDER, EVERYTHING IN ONE PLACE. On a phone it fills the screen; on a
// computer it sits beside the list. The main button is always the next step for this order (start packing, ship it,
// hand it over, bring it out). The record tab is the order's whole history in plain words.
import * as React from 'react';
import { collection, limit, onSnapshot, orderBy, query, type Firestore } from 'firebase/firestore';
import { cancelIt, bringingOut } from '@/lib/orders-flow';
import { dueLine, eventLine, firstName, methodLabel, money, orderNum, packProgress } from '@/lib/orders-view';
import { useTenant } from '@/context/TenantContext';
import { formatTime, tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { arrivalLabel, customerDates, dayLabel, longDayLabel, promisedDay } from '@/lib/ship-promise';
import { staffAuthHeader } from '@/lib/staff-fetch';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, IconBtn, Sheet, Thumb, feel, muted, Ic } from './ui';
import { AddressCard } from './AddressCard';
import { changePolicy, oneLine, openRequest } from '@/lib/address-flow';
import { LabelHistory, labelTotals, useLabelRecords } from './LabelHistory';
import { slotsKnown, tail, voidedSlots } from '@/lib/label-boxes';
import { labelDoubt } from '@/lib/label-doubt';
import { isFollowUp } from '@/lib/order-family';

const STEPS: Record<string, string[]> = { ship: ['New', 'Packing', 'Ready to ship', 'Shipped'], curbside: ['New', 'Packing', 'Ready', 'Picked up'], counter: ['New', 'Packing', 'Ready', 'Picked up'] };
const stepIndex = (o: any) => ({ paid: 0, picking: 1, packed: o.method === 'ship' ? 2 : 1, ready: 2, arrived: 2, shipped: 3, handed_off: 3, completed: 3 } as Record<string, number>)[o.stage] ?? 0;

export function OrderPanel({ fs, tenantId, order, actor, rs, photoFor, canRefund, isManager, onClose, onPack, onShip, onHandover, onToast, inline, startMessage }: {
  fs: Firestore; tenantId: string; order: any; actor: Actor; rs: any; photoFor: Map<string, string>; canRefund: boolean; isManager?: boolean;
  onClose: () => void; onPack: () => void; onShip: () => void; onHandover: () => void; onToast: (msg: string) => void; inline?: boolean;
  /** Opens with the message to the customer already started (a carrier problem, from the Today counts). */
  startMessage?: string | null;
}) {
  const [tab, setTab] = React.useState<'order' | 'record'>('order');
  const [events, setEvents] = React.useState<any[]>([]);
  const [confirm, setConfirm] = React.useState<'cancel' | 'refund' | null>(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [keepOpen, setKeepOpen] = React.useState(false); const [keepWhy, setKeepWhy] = React.useState('');
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  React.useEffect(() => { setTab('order'); setErr(''); setKeepOpen(false); setKeepWhy(''); setLabelsOpen(false); setMsg(startMessage ?? null); }, [order.id, startMessage]);
  // Every label the order has had (lib/label-records), for the Shipping labels sheet and its money.
  const recs = useLabelRecords(fs, tenantId, order.method === 'ship' ? order.id : '');
  const labelMoney = labelTotals(recs || []);
  React.useEffect(() => {
    if (tab !== 'record') return;
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders/${order.id}/events`), orderBy('at', 'desc'), limit(120)), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setEvents([]));
  }, [fs, tenantId, order.id, tab]);

  const who = firstName(order.customerName);
  const prog = packProgress(order);
  const { selectedTenant } = useTenant() as any;
  const shopZone = tenantTimeZone(selectedTenant);
  const due = dueLine(order, rs, Date.now(), shopZone);
  // The ship-by day (lib/ship-promise): what the customer was told, if they were, and a way to tell them a new one.
  const tz = String(order.promise?.timeZone || shopZone);
  const shown = order.method === 'ship' ? customerDates(order, shopZone) : null;
  const shipDay = order.method === 'ship' && order.promise ? promisedDay(order, tz) : null;
  const [newDate, setNewDate] = React.useState<{ day: string; note: string } | null>(null);
  async function sendNewDate() {
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate.day)) { setErr('Choose the new ship-by day.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/delay-notice', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, revisedDate: newDate.day, note: newDate.note.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'The new date didn’t go out.'); return; }
      setNewDate(null); onToast(d.sent ? `${who} has the new date, and can cancel if it doesn’t work for them.` : 'They already have that date.');
    } finally { setBusy(false); }
  }
  const steps = STEPS[order.method] || STEPS.counter;
  const idx = stepIndex(order);
  const pending = Number(order.pendingRefundCents) || 0;
  // Made from another order (a backorder, a replacement): its money is on that order's card (lib/order-family).
  const follow = isFollowUp(order);
  // Within the shop's automatic amount anyone on the team can send it (api/retail/refund); never a lost parcel's
  // replacement, which the first parcel turning up would make a second refund.
  const autoBelow = Math.max(0, Number(rs?.policies?.refundAutoBelowCents) || 0);
  const inAuto = autoBelow > 0 && pending > 0 && pending <= autoBelow && order.replacementFor !== 'lost_in_transit';
  const paidOther = !follow && ((Number(order.giftCardCents) || 0) > 0 || (Number(order.storeCreditRequestedCents) || 0) > 0);
  const shortLines = (order.lines || []).filter((l: any) => ['refunded', 'backordered', 'shorted'].includes(l.status));
  const terminal = ['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'].includes(order.stage);

  const main: { label: string; run: () => void } | null =
    order.holdForReview || (order.method === 'ship' && openRequest(order)) ? null
    : order.stage === 'paid' ? { label: 'Start packing', run: onPack }
    : order.stage === 'picking' ? { label: order.claimedBy && order.claimedBy !== actor.id ? `Take over from ${firstName(order.claimedByName)}` : 'Continue packing', run: onPack }
    : order.stage === 'packed' && order.method === 'ship' ? { label: order.labelUrl ? 'Mark as shipped' : 'Ship it', run: onShip }
    : order.stage === 'packed' ? { label: 'Continue packing', run: onPack }
    : (order.stage === 'arrived' || (order.stage === 'ready' && order.method === 'curbside' && order.curbside?.arrivedAt)) && !order.curbside?.bringingOutAt ? { label: 'I’m bringing it out', run: () => void out() }
    : ['ready', 'arrived'].includes(order.stage) ? { label: `Hand over to ${who}`, run: onHandover }
    : null;

  async function out() { setBusy(true); const r = await bringingOut(fs, tenantId, order, actor); setBusy(false); feel(r.ok); if (r.ok) onToast(`${who} has been told you’re on your way out.`); else setErr(r.message); }
  // A customer's address change that came in after the label (or on a held order): one tap either way (api/retail/address).
  const req = order.method === 'ship' ? openRequest(order) : null;
  const labelled = !!(order.labelUrl || order.shippoTransactionId);
  const managerOnly = !!req && order.holdForReview === true && changePolicy(rs).heldNeedsManager && !isManager;
  const answerChange = async (action: 'approve_change' | 'keep_old') => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/address', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, action, reason: keepWhy.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { feel(true); setKeepOpen(false); onToast(d.message || 'Done.'); } else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('That didn’t go through. Try again.'); }
    setBusy(false);
  };
  // A label someone should look at (lib/label-sweep): nobody has scanned it for days, a void of it didn't finish, or a
  // cancelled order's label couldn't be voided automatically. Void it for the postage, or say what happened.
  const unscannedLabel = order.labelUnscannedOpen === true && !!order.shippoTransactionId && ['packed', 'shipped', 'cancelled', 'refunded'].includes(order.stage);
  const day = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'a few days ago'; };
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
  const labelAction = async (action: 'void' | 'unscanned_ok' | 'voided_seen' | 'refund_seen' | 'charge_seen') => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/shipping-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', action }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { feel(true); onToast(d.message || 'Done.'); } else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('That didn’t go through. Try again.'); }
    setBusy(false);
  };
  // A message from the shop, on the customer's order page (api/retail/order-message).
  const sendMsg = async () => {
    if (!msg || !msg.trim()) { setErr('Write the message first.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, text: msg.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { feel(true); setMsg(null); onToast(d.message || 'Sent.'); } else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('That didn’t go through. Try again.'); }
    setBusy(false);
  };
  const reachable = !!(order.customerEmail || order.customerPhone);
  // A box whose label was voided while the others kept theirs (lib/label-boxes): it needs a new label, or to come off.
  const relabel = order.method === 'ship' && slotsKnown(order) && labelDoubt(order) === 'relabel' ? voidedSlots(order) : [];
  const denied = order.labelRefundDenied?.open === true ? order.labelRefundDenied : null;
  const deniedRec = denied ? (recs || []).find((r) => r.id === denied.labelId) : null;
  const charge = order.labelCharge?.open === true ? order.labelCharge : null;
  const doCancel = async () => { setBusy(true); const r = await cancelIt(fs, tenantId, order, actor, reason.trim() || 'Cancelled by the shop'); setBusy(false); if (r.ok) { setConfirm(null); onToast(r.message); } else setErr(r.message); };
  const doRefund = async () => {
    setBusy(true); setErr('');
    const res = await fetch('/api/retail/refund', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', ...(inAuto ? { reason: 'policy' } : {}) }) });
    const d = await res.json().catch(() => ({})); setBusy(false);
    if (res.ok) { setConfirm(null); onToast(d.message || 'Refund sent.'); } else setErr(d.error || 'The refund didn’t go through.');
  };

  return (
    <div className={inline ? 'cf-anim-rise flex h-full flex-col' : 'cf-anim-push fixed inset-0 z-30 flex flex-col overflow-y-auto lg:static lg:z-auto'} style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto w-full max-w-xl flex-1 px-4 pb-40 pt-3 lg:max-w-none lg:px-6 lg:pb-6">
        <div className="flex items-center justify-between gap-2">
          <IconBtn label="Close" onClick={onClose}>{inline ? <span className="text-[18px] leading-none">×</span> : Ic.back}</IconBtn>
          <span className="text-[14px]" style={muted}>{orderNum(order)}{order.paidAt ? ` · paid ${formatTime(order.paidAt, shopZone)}` : ''}</span>
          <button type="button" onClick={() => setTab(tab === 'order' ? 'record' : 'order')} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={{ background: C.soft }}>{tab === 'order' ? 'Record' : 'Order'}</button>
        </div>
        <p className="m-0 mt-3.5 text-[28px] font-light tracking-[-0.02em]">{order.customerName || 'Customer'}</p>
        <p className="m-0 mt-0.5 text-[15px]" style={muted}>{order.method === 'ship' && order.shippingAddress ? `Ships to ${order.shippingAddress.city}, ${order.shippingAddress.state}` : methodLabel(order.method)} · <span style={due.late ? { color: C.warn, fontWeight: 600 } : undefined}>{order.stage === 'cancelled' ? 'Cancelled' : due.text}</span>{order.claimedByName && order.stage === 'picking' ? ` · ${firstName(order.claimedByName)} is packing` : ''}</p>

        {tab === 'order' ? (<>
          {order.stage !== 'cancelled' && (
            <div className="mt-4 flex gap-1.5">
              {steps.map((s, i) => <div key={s} className="flex-1 text-center text-[12px] font-semibold" style={{ color: i === idx ? C.ink : C.muted }}><div className="mb-1.5 h-1 rounded-full" style={{ background: i < idx ? C.ink : i === idx ? C.mint : C.line }} />{s}</div>)}
            </div>)}
          {shipDay && !terminal && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: order.lateNeedsStaff?.open ? C.warnSoft : C.soft }}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="m-0 text-[15px] font-semibold">Ships by {longDayLabel(shipDay, tz)}</p>
                <span className="shrink-0 text-[13px]" style={muted}>{shown ? 'They were told' : 'Your team’s date'}</span>
              </div>
              {shown?.arriveFrom && !order.trackingNumber && <p className="m-0 mt-1 text-[14px]" style={muted}>Arrives {arrivalLabel(shown, tz)}{shown.service ? ` with ${shown.service}` : ''}</p>}
              {shown?.originalShipBy && <p className="m-0 mt-1 text-[14px]" style={muted}>Moved from {dayLabel(shown.originalShipBy, tz)}{Number(order.autoDelayNotices) > 0 ? `, told by itself ${Number(order.autoDelayNotices) === 1 ? 'once' : `${order.autoDelayNotices} times`}` : ''}. They can cancel for a full refund until it ships.</p>}
              {order.lateNeedsStaff?.open && <p className="m-0 mt-1 text-[14px] font-semibold" style={{ color: C.warn }}>{order.lateNeedsStaff.why === 'held' ? 'It missed its date while held for review.' : 'It missed its new date again.'} Send them a new one, or ship it today.</p>}
              {shown && !order.trackingNumber && !order.shippoTransactionId && (
                <Btn kind="soft" className="mt-3 h-11 w-full" style={{ background: C.paper }} onClick={() => setNewDate({ day: '', note: '' })}>Send a new date</Btn>)}
            </div>)}
          {order.holdForReview && <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}><p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>Held for review</p><p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>This order won’t be packed until someone decides on it.</p></div>}
          {pending > 0 && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}>
              <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{money(pending)} to refund to {who}</p>
              {canRefund || inAuto ? <Btn kind="primary" className="mt-3 h-11" onClick={() => setConfirm('refund')}>Review the refund</Btn> : <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>Waiting for someone allowed to send refunds.</p>}
            </div>)}
          {req && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}>
              <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{labelled ? `${who} changed the address after the label was bought` : `${who} asked to change the address`}</p>
              <div className="mt-2 gap-x-2.5 gap-y-1.5 text-[14px]" style={{ display: 'grid', gridTemplateColumns: '44px 1fr' }}>
                <span style={muted}>From</span><span style={{ color: C.muted, textDecoration: 'line-through' }}>{oneLine(order.shippingAddress)}</span>
                <span style={muted}>To</span><span>{[req.to?.name && req.to.name !== order.shippingAddress?.name ? req.to.name : '', oneLine(req.to)].filter(Boolean).join(', ')}</span>
              </div>
              {req.check?.verdict === 'valid' && <p className="m-0 mt-2 text-[14px] font-semibold" style={{ color: C.ok }}>Confirmed by the carrier address check</p>}
              {['unconfirmed', 'undeliverable', 'corrected'].includes(String(req.check?.verdict || '')) && <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>The carrier address check couldn’t confirm the new address.</p>}
              {managerOnly ? <p className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>This order is held for review, so a manager approves the change.</p> : keepOpen ? (<>
                <label className="mt-3 block text-[13px] font-semibold" style={muted}>Why it stays (they see this)<input value={keepWhy} onChange={(e) => setKeepWhy(e.target.value)} placeholder="For example: it’s already packed and on the truck" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
                <Btn kind="primary" className="mt-3 h-11 w-full" disabled={busy} onClick={() => void answerChange('keep_old')}>Keep it and tell {who}</Btn>
                <Btn kind="plain" className="mt-1 h-11 w-full" onClick={() => setKeepOpen(false)}>Back</Btn>
              </>) : (<>
                <Btn kind="primary" className="mt-3 h-11 w-full" disabled={busy} onClick={() => void answerChange('approve_change')}>{busy ? 'One moment…' : labelled ? 'Void label and buy a new one' : 'Use the new address'}</Btn>
                <Btn kind="soft" className="mt-2 h-11 w-full" disabled={busy} onClick={() => setKeepOpen(true)}>Keep the old address</Btn>
              </>)}
              <p className="m-0 mt-2 text-[13px]" style={muted}>{labelled ? 'The unused label is refunded by the carrier. Then buy the new one and put it over the old label.' : `${who} sees your answer on their order page.`}</p>
            </div>)}
          {unscannedLabel && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}>
              <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{lbl.title}</p>
              <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{lbl.text}{order.stage !== 'shipped' && Array.isArray(order.shippedWithOrderIds) && order.shippedWithOrderIds.length ? ' This label covers other orders in the same box, so voiding it takes it off all of them.' : ''}</p>
              {order.stage !== 'shipped' && <Btn kind="primary" className="mt-3 h-11 w-full" disabled={busy} onClick={() => void labelAction('void')}>Void the label</Btn>}
              <Btn kind="soft" className="mt-2 h-11 w-full" disabled={busy} onClick={() => void labelAction('unscanned_ok')}>{lbl.keep}</Btn>
            </div>)}
          {order.voidedLabelMoving?.open === true && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}>
              {(() => { const n = Number(order.voidedLabelMoving.voidedBoxes) || 0; const u = Number(order.voidedLabelMoving.unconfirmedBoxes) || 0; return (<>
              <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{n + u > 0 ? 'A box went out while other labels were being voided' : order.voidedLabelMoving.unsure ? 'The carrier scanned a label that was being voided' : 'The carrier scanned a label that was voided'}</p>
              <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{n + u > 0
                ? `The carrier has a box from this order.${n ? ` ${n} other box label${n === 1 ? ' was' : 's were'} voided.` : ''}${u ? ` Shippo didn’t answer for ${u === 1 ? 'another box' : `${u} other boxes`}, so ${u === 1 ? 'its label' : 'their labels'} may be voided too: check in Shippo.` : ''} ${relabel.length ? 'Any box that’s still here and whose label was voided needs a new one before it goes out: buy it on the ship sheet.' : 'Any box that’s still here and whose label was voided needs a new one bought in Shippo before it goes out; it won’t show on this order.'}`
                : `${order.voidedLabelMoving.unsure ? `A void of tracking ${order.voidedLabelMoving.trackingNumber || ''} didn’t finish, and the carrier has scanned the box since.` : `Tracking ${order.voidedLabelMoving.trackingNumber || ''} is moving.`} Check the label in Shippo: if the refund was turned down, the box is fine and on its way. If the refund went through, the carrier may charge the postage back.`}</p>
              </>); })()}
              {relabel.length > 0 && <Btn kind="primary" className="mt-3 h-11 w-full" onClick={onShip}>Buy {relabel.length === 1 ? `box ${relabel[0].slot + 1}’s` : 'the'} new label</Btn>}
              <Btn kind="soft" className="mt-2 h-11 w-full" disabled={busy} onClick={() => void labelAction('voided_seen')}>Got it</Btn>
            </div>)}
          {relabel.length > 0 && order.voidedLabelMoving?.open !== true && ['paid', 'picking', 'packed', 'shipped'].includes(order.stage) && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}>
              <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>{relabel.length === 1 ? `Box ${relabel[0].slot + 1} needs a new label` : `${relabel.length} boxes need new labels`}</p>
              <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{relabel.length === 1 ? `Its label (${tail(relabel[0].tracking)}) was voided while the other box${(order.packageCount || 2) > 2 ? 'es' : ''} kept theirs.` : 'Their labels were voided while the other boxes kept theirs.'} Buy {relabel.length === 1 ? 'its' : 'their'} new label{relabel.length === 1 ? '' : 's'} on the ship sheet, or take {relabel.length === 1 ? 'it' : 'them'} off the order there. It can’t be marked shipped until then.</p>
              <Btn kind="primary" className="mt-3 h-11 w-full" onClick={onShip}>Open the ship sheet</Btn>
            </div>)}
          {denied && (
            <div className="mt-4 rounded-[18px] p-4" style={{ border: `2px solid ${C.ink}` }}>
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
                {reachable && <Btn kind="soft" className="h-11 flex-1" onClick={() => setMsg(`Hi ${who}, a quick check on your order ${orderNum(order)}: an earlier box may have gone out as well as the one you’re expecting. If two arrive, let us know here and we’ll sort it out.`)}>Message {who}</Btn>}
                <Btn kind="soft" className="h-11 flex-1" disabled={busy} onClick={() => void labelAction('refund_seen')}>Got it</Btn>
              </div>
            </div>)}
          {charge && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: C.warnSoft }}>
              <p className="m-0 text-[15px] font-semibold" style={{ color: C.warn }}>Carrier adjustment: {Number(charge.cents) > 0 ? '+' : '−'}{money(Math.abs(Number(charge.cents) || 0))}</p>
              <p className="m-0 mt-1 text-[14px]" style={{ color: C.warn }}>{Number(charge.cents) > 0 ? `${order.carrier || 'The carrier'} charged more for this shipment after the label was bought, usually because it weighed or measured a box differently.` : `${order.carrier || 'The carrier'} gave some postage back on this shipment.`} Recorded in Money as shipping.</p>
              <div className="mt-3 flex gap-2">
                <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} onClick={() => setLabelsOpen(true)}>See the labels</Btn>
                <Btn kind="soft" className="h-11 flex-1" style={{ background: C.paper }} disabled={busy} onClick={() => void labelAction('charge_seen')}>Got it</Btn>
              </div>
            </div>)}
          {order.method === 'ship' && ['paid', 'picking', 'packed'].includes(order.stage) && <div className="mt-4"><AddressCard order={order} tenantId={tenantId} onToast={onToast} /></div>}
          <p className="m-0 mt-5 text-[13px] font-semibold" style={muted}>{['paid', 'picking'].includes(order.stage) ? `In the box · ${prog.done} of ${prog.total}` : 'Items'}</p>
          <div className="mt-1">
            {(order.lines || []).map((l: any) => {
              const closed = ['refunded', 'backordered', 'shorted'].includes(l.status);
              const full = l.qtyScanned >= l.qtyOrdered;
              return (
                <div key={l.lineId} className="flex items-center gap-3 border-t py-2.5" style={{ borderColor: C.line }}>
                  <Thumb src={photoFor.get(l.productId)} size={40} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]" style={closed ? { textDecoration: 'line-through', color: C.muted } : undefined}>{l.name}{l.qtyOrdered > 1 ? ` × ${l.qtyOrdered}` : ''}</span>{l.optionsLabel ? <span className="block truncate text-[13px]" style={muted}>{l.optionsLabel}</span> : null}</span>
                  <span className="shrink-0 text-[14px] font-semibold" style={{ color: closed ? C.warn : l.digital ? C.muted : !['paid', 'picking'].includes(order.stage) ? C.ink : full ? C.ok : C.muted }}>{l.digital ? 'Download' : closed ? (l.status === 'backordered' ? 'Sending later' : 'Refunded') : ['paid', 'picking'].includes(order.stage) ? `${l.qtyScanned} of ${l.qtyOrdered}` : money((l.unitPriceCents || 0) * (l.qtyOrdered || 0))}</span>
                </div>);
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
            {order.method === 'ship' && <div><p className="m-0 text-[13px] font-semibold" style={muted}>Shipping</p><p className="m-0 mt-0.5">{order.trackingNumber ? `${order.carrier || ''} ${order.trackingNumber}` : order.shippingCents ? `They paid ${money(order.shippingCents)}` : 'Free shipping'}</p></div>}
            {order.shelfSlot && ['ready', 'arrived'].includes(order.stage) && <div><p className="m-0 text-[13px] font-semibold" style={muted}>Shelf</p><p className="m-0 mt-0.5">{order.shelfSlot}</p></div>}
            {order.method === 'curbside' && order.curbside?.spotOrVehicle && <div><p className="m-0 text-[13px] font-semibold" style={muted}>Outside</p><p className="m-0 mt-0.5">{order.curbside.spotOrVehicle}</p></div>}
            <div><p className="m-0 text-[13px] font-semibold" style={muted}>Total</p><p className="m-0 mt-0.5">{money(order.totalCents)}{(order.refundedCents || 0) > 0 ? ` · ${money(order.refundedCents)} refunded` : ''}</p></div>
          </div>
          {order.method === 'ship' && recs && recs.length > 0 && (
            <button type="button" onClick={() => setLabelsOpen(true)} className="cf-press mt-4 flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left" style={{ background: C.soft, color: C.ink }}>
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Shipping labels</span><span className="block text-[13px]" style={muted}>{recs.length} label{recs.length === 1 ? '' : 's'} · postage {money(labelMoney.postage)}{labelMoney.waiting ? ` · ${money(labelMoney.waiting)} on the way back` : ''}{labelMoney.charges ? ` · ${money(labelMoney.charges)} extra` : ''}</span></span>
              <span style={muted}>{Ic.chev}</span>
            </button>)}
          <div className="mt-5 grid grid-cols-2 gap-2">
            {order.qrToken && order.method !== 'digital' && <Btn kind="soft" onClick={() => window.open(`/print/packing-slip/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken || '')}`, '_blank')}>Print slip</Btn>}
            {reachable && <Btn kind="soft" onClick={() => setMsg('')}>Message {who}</Btn>}
            {!terminal && <Btn kind="danger" onClick={() => setConfirm('cancel')}>Cancel order</Btn>}
          </div>
        </>) : (
          <div className="mt-4">
            {events.length === 0 && <p className="m-0 py-6 text-[15px]" style={muted}>Nothing recorded yet.</p>}
            {events.map((e) => { const l = eventLine(e); return (
              <div key={e.id} className="flex gap-3 py-2.5">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.tone === 'ok' ? C.ok : l.tone === 'warn' ? C.warn : C.line }} />
                <div className="min-w-0"><p className="m-0 text-[15px]">{l.text}</p><p className="m-0 mt-0.5 text-[13px]" style={muted}>{e.at ? new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</p></div>
              </div>); })}
          </div>)}
        {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        {main && inline && <Btn kind="primary" className="mt-5 w-full text-[17px]" disabled={busy} onClick={main.run}>{main.label}</Btn>}
      </div>
      {main && !inline && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 lg:hidden" style={{ borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 86%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <Btn kind="primary" className="mx-auto flex w-full max-w-xl text-[17px]" disabled={busy} onClick={main.run}>{main.label}</Btn>
        </div>)}

      {confirm === 'cancel' && (
        <Sheet title={`Cancel ${who}’s order?`} sub={follow
          ? order.replacementFor === 'lost_in_transit'
            ? 'Stock goes back on the shelf. If the first parcel never arrived, what they paid for these items goes back to the card they used on the original order.'
            : order.holdUntilRestock
              ? 'Nothing was set aside for it yet. What they paid for these items goes back to the card they used on the original order.'
              : 'Stock goes back on the shelf, and what they paid for these items goes back to the card they used on the original order.'
          : `${order.stage === 'paid' ? 'Their card is refunded and stock goes back on the shelf.' : 'Put the items back on the shelf. Their card is refunded.'}${(order.lines || []).some((l: any) => l.status === 'backordered') || order.splitChildOrderId ? ' Anything still to follow is cancelled with it.' : ''}`} onClose={() => setConfirm(null)} closeLabel="Keep it">
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Reason (they see this)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: we can’t get it in time" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <Btn kind="danger" className="mt-4 w-full text-[17px]" disabled={busy} onClick={() => void doCancel()}>Cancel the order</Btn>
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
      {confirm === 'refund' && (
        <Sheet title={`Refund ${money(pending)} to ${who}?`} sub={`${orderNum(order)} · back to the card they paid with${follow ? ' on the original order' : ''}${paidOther ? ', and what a gift card or store credit paid goes back that way' : ''}`} onClose={() => setConfirm(null)}>
          <div className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[15px]">
            <span style={muted}>Why</span><span>{shortLines.length ? `${shortLines.map((l: any) => l.name).join(', ')} couldn’t be sent` : order.stage === 'cancelled' ? 'The order was cancelled' : 'A return or a problem they reported'}</span>
            <span style={muted}>They paid</span><span>{follow
              ? `On the original order${order.refundedCents ? `, ${money(order.refundedCents)} refunded on this one already` : ''}`
              : `${money(order.chargedCents ?? order.totalCents)}${order.refundedCents ? `, ${money(order.refundedCents)} refunded already` : ''}`}</span>
            <span style={muted}>{who} gets</span><span>An email with the amount and when to expect it</span>
          </div>
          <Btn kind="danger" className="mt-4 w-full text-[17px]" disabled={busy} onClick={() => void doRefund()}>Send {money(pending)} refund</Btn>
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
      {labelsOpen && <LabelHistory order={order} recs={recs} onClose={() => setLabelsOpen(false)} />}
      {msg !== null && (
        <Sheet title={`Message ${who}`} sub="It goes on their order page, and they get a text or email to look. They answer there." onClose={() => setMsg(null)}>
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Message
            <textarea value={msg} maxLength={1500} rows={5} onChange={(e) => setMsg(e.target.value)} placeholder={`For example: your order ${orderNum(order)} has a new tracking number`} className="mt-1 w-full rounded-2xl border px-4 py-3 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || !msg.trim()} onClick={() => void sendMsg()}>{busy ? 'Sending…' : 'Send'}</Btn>
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
      {newDate && (
        <Sheet title="Send a new date" sub={`${who} gets the new ship-by day and can cancel for a full refund if it doesn’t work for them.`} onClose={() => setNewDate(null)}>
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Ships by
            <input type="date" value={newDate.day} min={todayIn(tz)} onChange={(e) => setNewDate({ ...newDate, day: e.target.value })} className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <label className="mt-3 block text-[13px] font-semibold" style={muted}>A note for them (optional)
            <textarea value={newDate.note} maxLength={400} rows={3} onChange={(e) => setNewDate({ ...newDate, note: e.target.value })} placeholder="For example: the new batch arrives Thursday" className="mt-1 w-full rounded-2xl border px-4 py-3 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || !newDate.day} onClick={() => void sendNewDate()}>{busy ? 'Sending…' : 'Send the new date'}</Btn>
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
    </div>);
}
