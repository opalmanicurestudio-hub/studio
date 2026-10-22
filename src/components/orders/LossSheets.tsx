'use client';
// src/components/orders/LossSheets.tsx — LOST AND RECOVERED, ONE PARCEL AT A TIME (lib/lost-recovered).
//   · StalledSheet: a parcel the carrier hasn't scanned for days. Its last scan and where, how it's insured, and three
//     choices: send a replacement now (api/retail/lost-parcel: a $0 order with the same items, and the lost box becomes
//     a claim to file), tell the customer on their order page that the shop is on it, or wait 3 more days.
//   · ClaimSheet: a claim to file (who covers it, whether porch theft is covered, the date to file by, then open the
//     claim, copy the details, download the claim pack, and the claim number), and once filed, its story to paid, with
//     a payment recorded in Money (lib/inventory-exceptions advanceRecovery). Managers file and record; everyone sees.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { openPrint } from '@/lib/open-print';
import { advanceRecovery } from '@/lib/inventory-exceptions';
import { boxTrail, labelSlots, tail } from '@/lib/label-boxes';
import { carrierName } from '@/lib/ship-promise';
import { choseService } from '@/lib/paid-service';
import { firstName, money, orderNum } from '@/lib/orders-view';
import { claimDetails, claimStage, claimTimeline, coverFor, dueState, fileBy, whatHappened } from '@/lib/lost-recovered';
import { Btn, C, Sheet, feel, muted, Ic } from './ui';

const whole = (c: number) => (Math.round(c) % 100 === 0 ? `$${Math.round(c) / 100}` : money(c));
export const monthDay = (v: string, tz: string) => { const d = new Date(Date.parse(v)); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(d) : ''; };
const clock = (v: string, tz: string) => { const d = new Date(Date.parse(v)); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d) : ''; };

function Line({ left, right, strong, tone }: { left: React.ReactNode; right: React.ReactNode; strong?: boolean; tone?: string }) {
  return <span className="flex justify-between gap-2.5 text-[15px] leading-snug"><span>{left}</span><span className="shrink-0 text-right" style={{ fontWeight: strong ? 600 : 400, color: tone }}>{right}</span></span>;
}

const STATUS_WORDS: Record<string, string> = { TRANSIT: 'In transit', PRE_TRANSIT: 'Label made, not scanned', DELAYED: 'Delayed', OUT_FOR_DELIVERY: 'Out for delivery', '': 'No scans yet' };

export function StalledSheet({ fs, tenantId, order, tz, canReplace, insureOverCents, onClose, onToast }: {
  fs: Firestore; tenantId: string; order: any; tz: string; canReplace: boolean; insureOverCents: number | null; onClose: () => void; onToast: (m: string) => void;
}) {
  const [busy, setBusy] = React.useState('');
  const ci = order.carrierIssue || {};
  const who = firstName(order.customerName);
  const carrier = carrierName(order.carrier || ci.carrier) || 'The carrier';
  const trail = boxTrail(order, 0);
  const lastAt = trail.at || ci.at || '';
  const quiet = Math.max(1, Number(ci.quietDays) || 0);
  const insured = Number(order.shipmentProtection?.insuranceCents) || 0;
  const told = ci.customerTold === true;
  const shipped = order.completedAt || order.shippedAt || '';
  const lastDay = lastAt ? monthDay(lastAt, tz) : '';
  const boxes = labelSlots(order).filter((x) => !x.voided).length;
  const riders = Array.isArray(order.shippedWithOrderIds) ? order.shippedWithOrderIds.length : 0;

  const message = async (text: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, text }) });
      return r.ok;
    } catch { return false; }
  };
  const replace = async () => {
    setBusy('replace');
    try {
      const r = await fetch('/api/retail/lost-parcel', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { feel(false); onToast(d.error || 'The replacement didn’t go through. Try again.'); return; }
      const sent = d.already ? true : await message(`Hi ${who}, ${carrier} hasn’t scanned your order ${orderNum(order)}${lastDay ? ` since ${lastDay}` : ' in a while'}, so we’re sending you a new one. You’ll get its tracking as soon as it ships. Nothing is needed from you.`);
      feel(true);
      onToast(d.already ? 'A replacement was already made for this order.' : `Replacement made: it’s in To pack. ${sent ? `${who} has been told.` : `Tell ${who} from the order.`} The claim is under Needs you.`);
      onClose();
    } finally { setBusy(''); }
  };
  const tell = async () => {
    setBusy('tell');
    try {
      const ok = await message(`Hi ${who}, ${carrier} hasn’t scanned your order ${orderNum(order)}${lastDay ? ` since ${lastDay}` : ' in a few days'}. We’re keeping an eye on it, and if it doesn’t move soon we’ll make it right with a replacement or a refund. Nothing is needed from you.`);
      if (!ok) { feel(false); onToast('That didn’t send. Try again.'); return; }
      await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { 'carrierIssue.customerTold': true, 'carrierIssue.toldAt': new Date().toISOString() }).catch(() => {});
      feel(true); onToast(`${who} has a message on their order page, and a nudge to read it.`);
    } finally { setBusy(''); }
  };
  const wait = async () => {
    setBusy('wait');
    try {
      await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, order.id), { 'carrierIssue.snoozeUntil': new Date(Date.now() + 3 * 86400e3).toISOString() });
      onToast('It’s off the list for 3 days. If it still hasn’t moved, it comes back.'); onClose();
    } catch { onToast('That didn’t save. Try again.'); } finally { setBusy(''); }
  };

  return (
    <Sheet title={order.customerName || 'Customer'} sub={[orderNum(order), carrier, tail(order.trackingNumber)].filter(Boolean).join(' · ')} onClose={onClose}>
      <p className="m-0 text-[15px]" style={muted}>{[shipped ? `Shipped ${monthDay(shipped, tz)}` : '', choseService(order.shippingService) ? order.shippingService : ''].filter(Boolean).join(' · ')}</p>
      <div className="mt-3 flex flex-col gap-2.5 rounded-[18px] p-4" style={{ background: C.warnSoft }}>
        <span className="text-[15px] font-semibold" style={{ color: C.warn }}>No carrier scan for {quiet} day{quiet === 1 ? '' : 's'}</span>
        <Line left="Last scan" right={[lastDay, trail.where].filter(Boolean).join(', ') || 'None yet'} />
        <Line left="Status" right={STATUS_WORDS[trail.status] ?? (trail.status ? trail.status.charAt(0) + trail.status.slice(1).toLowerCase() : 'No scans yet')} />
        <Line left="Insured" right={insured > 0 ? `Yes, ${whole(insured)}` : `No${insureOverCents ? ` (under ${whole(insureOverCents)})` : ''}`} />
        {told && <Line left={`${who} knows`} right={ci.toldAt ? monthDay(ci.toldAt, tz) : 'Yes'} />}
        {canReplace
          ? <Btn kind="primary" className="mt-1 h-12 w-full text-[15px]" disabled={!!busy} onClick={() => void replace()}>{busy === 'replace' ? 'Sending…' : 'Send a replacement now'}</Btn>
          : <p className="m-0 text-[14px]" style={muted}>A manager, or someone who can give refunds, sends a replacement.</p>}
        <Btn kind="soft" className="h-12 w-full text-[15px]" style={{ background: C.paper }} disabled={!!busy} onClick={() => void tell()}>{busy === 'tell' ? 'Sending…' : told ? `Tell ${who} again` : `Tell ${who} we’re on it`}</Btn>
        <Btn kind="plain" className="h-11 w-full text-[15px]" disabled={!!busy} onClick={() => void wait()}>Wait 3 more days</Btn>
        {(boxes > 1 || riders > 0) && <span className="text-[13px] leading-snug">{boxes > 1 ? `This order went in ${boxes} boxes, and a replacement sends everything again.` : ''}{riders > 0 ? `${boxes > 1 ? ' ' : ''}${riders === 1 ? 'Another order' : `${riders} other orders`} rode in the same box: ${riders === 1 ? 'its items go' : 'their items go'} in the replacement too.` : ''}</span>}
        <span className="text-[13px] leading-snug" style={muted}>A replacement starts a claim for the first box, so you can get the cost back {insured > 0 ? `from Shippo’s insurance (${whole(insured)})` : `from ${carrier} (up to the included $100)`}.</span>
      </div>
    </Sheet>);
}

export function ClaimSheet({ fs, tenantId, exc, order, tz, canFile, actor, onClose, onToast }: {
  fs: Firestore; tenantId: string; exc: any; order: any | null; tz: string; canFile: boolean; actor: { id: string; name: string }; onClose: () => void; onToast: (m: string) => void;
}) {
  const [busy, setBusy] = React.useState('');
  const [ref, setRef] = React.useState('');
  const [paying, setPaying] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const stage = claimStage(exc);
  const cover = coverFor(exc, order);
  const by = fileBy(exc, order, tz);
  const due = dueState(by);
  const day = (v: string) => monthDay(v, tz);
  const who = firstName(order?.customerName);
  const recovered = Number(exc?.recovery?.recoveredCents) || 0;
  const claimed = Number(exc?.recovery?.claimAmountCents) || cover.amountCents;
  const num = order ? orderNum(order) : `#${String(exc.orderNumber ?? '').padStart(4, '0')}`;

  const act = async (k: string, action: 'file' | 'deny' | 'abandon' | 'payment', payload: any, done: string) => {
    setBusy(k);
    try {
      const r = await advanceRecovery(fs, tenantId, exc.id, action, payload, actor);
      feel(r.ok); onToast(r.ok ? done : r.message);
      return r.ok;
    } finally { setBusy(''); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(claimDetails(exc, order, day)); onToast('Copied. Paste them into the claim form.'); }
    catch { onToast('Couldn’t copy here. Download the claim pack instead.'); }
  };
  const pack = async () => { const e = await openPrint(tenantId, `claim-pack:${exc.id}`, `/print/claim-pack/${tenantId}/${exc.id}`); if (e) onToast(e); };

  if (stage === 'to_file') {
    const delivered = order?.deliveredAt && exc.reason !== 'carrier_lost';
    return (
      <Sheet title={`File the claim for ${num}`} sub={delivered ? `Delivered ${day(order.deliveredAt)}, ${clock(order.deliveredAt, tz)}. ${who} says it never arrived.` : `${whatHappened(exc, order)}.`} onClose={onClose}>
        <div className="mt-2 flex flex-col gap-2 rounded-[18px] p-4" style={{ background: C.soft }}>
          <Line left={cover.line} right={`${cover.upTo ? 'up to ' : ''}${money(cover.amountCents)}`} />
          <Line left="Covers porch theft" right={cover.theft ? 'yes' : 'no'} />
          <Line left="File by" right={by ? day(by) : 'As soon as you can'} strong tone={due === 'soon' || due === 'overdue' ? C.warn : undefined} />
          {due === 'overdue' && <span className="text-[13px]" style={{ color: C.warn }}>The usual window has passed. File anyway: some claims are still taken.</span>}
        </div>
        {!cover.theft && exc.reason === 'stolen_after_delivery' && <p className="m-0 mt-2 text-[14px]" style={muted}>{cover.who} doesn’t pay for a box it marked delivered. Without insurance, this one is usually yours to cover.</p>}
        <div className="mt-3 flex flex-col gap-2">
          {cover.portalUrl
            ? <a href={cover.portalUrl} target="_blank" rel="noreferrer" className="cf-press inline-flex h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold" style={{ border: `1px solid ${C.ink}`, color: C.ink }}>1. {cover.portalLabel}</a>
            : <p className="m-0 text-[14px]" style={muted}>1. Open a claim with {cover.who}.</p>}
          <Btn kind="plain" className="h-11 w-full text-[15px]" style={{ border: `1px solid ${C.ink}` }} onClick={() => void copy()}>2. Copy the details</Btn>
          {canFile && <Btn kind="plain" className="h-11 w-full text-[15px]" style={{ border: `1px solid ${C.ink}` }} onClick={() => void pack()}>3. Download the claim pack</Btn>}
        </div>
        <p className="m-0 mt-2 text-[13px] leading-snug" style={muted}>The claim pack has the packing photos, the weights, every carrier scan, what {who} paid{exc.note ? ` and ${order?.customerName ? 'their' : 'the'} report` : ''}.{cover.by === 'shippo' ? ' In Shippo, find the shipment by its tracking number and choose File a claim.' : ''}</p>
        {canFile ? (<>
          <label className="mt-4 block">
            <span className="text-[13px] font-semibold" style={muted}>Claim number</span>
            <input value={ref} onChange={(e) => setRef(e.target.value.slice(0, 60))} aria-label="Claim number" placeholder="From the claim form" className="mt-1 block h-12 w-full rounded-xl border-0 px-3.5 text-[17px] outline-none ring-0 focus:ring-0" style={{ background: C.soft, color: C.ink }} />
          </label>
          <Btn kind="primary" className="mt-3 h-12 w-full text-[15px]" disabled={!!busy} onClick={() => void act('file', 'file', { amountCents: cover.amountCents, refNumber: ref.trim(), deadlineAt: null }, 'Filed. It’s under Lost and recovered until it’s paid.').then((ok) => { if (ok) onClose(); })}>{busy === 'file' ? 'Saving…' : 'I filed it'}</Btn>
          <Btn kind="plain" className="mt-1 h-11 w-full text-[14px]" style={{ color: C.muted }} disabled={!!busy} onClick={() => void act('abandon', 'abandon', { note: 'Not filed' }, 'Closed without a claim.').then((ok) => { if (ok) onClose(); })}>Not filing this one</Btn>
        </>) : <p className="m-0 mt-4 text-[14px]" style={muted}>A manager files claims and records what comes back.</p>}
      </Sheet>);
  }

  const steps = claimTimeline(exc, order, day);
  return (
    <Sheet title={`${who}’s claim`} sub={`${cover.line} · ${money(claimed)}`} onClose={onClose} closeLabel="Done">
      <div className="mt-2 flex flex-col gap-3.5 rounded-[18px] p-4" style={{ border: `1px solid ${C.line}` }}>
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="mt-[6px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.good ? C.ok : C.line }} />
            <span className="min-w-0 flex-1"><span className="block text-[15px]">{s.text}</span>{s.sub ? <span className="block text-[13px]" style={muted}>{s.sub}</span> : null}</span>
          </div>))}
      </div>
      {recovered > 0 && (
        <div className="mt-3 flex flex-col gap-1 rounded-[18px] px-4 py-3" style={{ background: C.okSoft }}>
          <span className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: C.ok }}><span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: C.ok }}>{Ic.check}</span>Recovered {money(recovered)}</span>
          <span className="text-[14px]">Recorded in Money as a claim payout, against this order’s loss.</span>
        </div>)}
      {canFile && ['filed', 'approved', 'paid'].includes(stage) && (paying ? (
        <div className="mt-3 flex items-center gap-2">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-1 rounded-xl px-3.5" style={{ background: C.soft }}>
            <span className="text-[17px]" style={muted}>$</span>
            <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount paid" placeholder={(Math.max(0, claimed - recovered) / 100).toFixed(2)} className="min-w-0 flex-1 border-0 bg-transparent text-[17px] outline-none ring-0 focus:ring-0" />
          </label>
          <Btn kind="primary" className="h-12" disabled={!!busy} onClick={() => { const cents = Math.round(Number(String(amount || (Math.max(0, claimed - recovered) / 100)).replace(/[^0-9.]/g, '')) * 100); void act('pay', 'payment', { amountCents: cents }, `${money(cents)} recorded in Money.`).then((ok) => { if (ok) { setPaying(false); setAmount(''); } }); }}>{busy === 'pay' ? 'Saving…' : 'Record'}</Btn>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Btn kind="soft" className="h-11 flex-1 text-[14.5px]" onClick={() => setPaying(true)}>Record a payment</Btn>
          {stage !== 'paid' && <Btn kind="soft" className="h-11 flex-1 text-[14.5px]" disabled={!!busy} onClick={() => void act('deny', 'deny', {}, 'Marked as turned down.')}>{busy === 'deny' ? 'Saving…' : 'Mark denied'}</Btn>}
        </div>))}
    </Sheet>);
}
