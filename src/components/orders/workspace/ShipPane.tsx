'use client';
// src/components/orders/workspace/ShipPane.tsx — GETTING IT TO THE CUSTOMER, INSIDE THE ORDER. For a ship order: the
// boxes and labels (bought, printed, voided and replaced box by box, lib ShipSheet in place), then the shipment as the
// carrier sees it. For a pickup: the shelf, whether they're outside, bringing it out and handing it over.
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { bringingOut } from '@/lib/orders-flow';
import { curbsideWaitMinutes } from '@/lib/retail-orders';
import { firstName, itemCount, money } from '@/lib/orders-view';
import { methodWords } from '@/lib/order-method';
import { formatTime } from '@/lib/tenant-time';
import { packBoxesOf } from '@/lib/ship-run';
import { packPhotosOf } from '@/lib/pack-photo';
import { boxTrail, labelSlots } from '@/lib/label-boxes';
import { labelDoubt } from '@/lib/label-doubt';
import { isZplLabel } from '@/lib/label-format';
import type { Actor } from '@/lib/retail-fulfill';
import { ShipSheet } from '../ShipSheet';
import { AddressCard } from '../AddressCard';
import { LabelHistory, labelTotals } from '../LabelHistory';
import { Btn, C, feel, muted } from '../ui';

const MOVED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const shortDay = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const statusWord = (s: string) => (s === 'DELIVERED' ? 'Delivered' : s === 'TRANSIT' ? 'On its way' : s === 'RETURNED' ? 'Coming back to you' : s === 'FAILURE' ? 'Couldn’t be delivered' : s === 'PRE_TRANSIT' ? 'Label made, not scanned yet' : 'Not scanned yet');

/** Ship orders: what's left to do before the label, the labels themselves, then the shipment. */
export function ShipPane({ fs, tenantId, order, inventory, rs, actor, recs, canShip, addressBeside, onToast }: {
  fs: Firestore; tenantId: string; order: any; inventory: any[]; rs: any; actor: Actor; recs: any[] | null; canShip: boolean;
  /** The address is already in the customer column beside the order. */
  addressBeside: boolean; onToast: (m: string) => void;
}) {
  const addr = addressBeside ? null : <AddressCard order={order} compact />;
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const relabel = labelDoubt(order) === 'relabel';
  const buying = order.stage === 'packed' || (relabel && ['paid', 'picking', 'packed', 'shipped'].includes(String(order.stage)));
  const photos = packPhotosOf(order);
  const money$ = labelTotals(recs || []);

  if (buying) {
    if (!canShip) return (
      <div>
        {addr}
        <p className={`m-0 ${addr ? 'mt-4' : ''} rounded-2xl p-4 text-[15px]`} style={{ background: C.soft }}>Labels are bought by someone who ships. It’s packed and waiting for one.</p>
      </div>);
    return (
      <div>
        <ShipSheet inline hideAddress={addressBeside} fs={fs} tenantId={tenantId} order={order} inventory={inventory} rs={rs} actor={actor} onToast={onToast} onClose={() => undefined} onDone={(m) => onToast(m)} />
        {recs && recs.length > 0 && <button type="button" onClick={() => setLabelsOpen(true)} className="mt-4 h-11 text-[14.5px] font-semibold underline underline-offset-4">Every label on this order{money$.postage ? ` · postage ${money(money$.postage)}` : ''}</button>}
        {labelsOpen && <LabelHistory order={order} recs={recs} onClose={() => setLabelsOpen(false)} />}
      </div>);
  }

  const slots = labelSlots(order);
  const boxes = packBoxesOf(order);
  if (['paid', 'picking'].includes(String(order.stage))) return (
    <div>
      {addr}
      <div className={`${addr ? 'mt-4 ' : ''}rounded-2xl p-4`} style={{ background: C.soft }}>
        <p className="m-0 text-[15px] font-semibold">Pack it first</p>
        <p className="m-0 mt-1 text-[14px]" style={muted}>The label is bought for the box it’s packed in, so it goes to the right place at the right price.{boxes.length ? ` Chosen so far: ${boxes.map((b) => b.name).join(', ')}.` : ''}</p>
      </div>
    </div>);

  // Shipped (or done): each box as the carrier sees it.
  return (
    <div>
      {addr}
      <p className={`m-0 ${addr ? 'mt-5 ' : ''}text-[13px] font-semibold`} style={muted}>{slots.length > 1 ? `${slots.length} boxes` : 'The box'}{order.carrier ? ` · ${order.carrier}` : ''}</p>
      <div className="mt-2 flex flex-col gap-2">
        {(slots.length ? slots : [{ slot: 0, tracking: order.trackingNumber || '', labelUrl: order.labelUrl || '', trackingUrl: order.trackingUrl || '', voided: false } as any]).map((s: any) => {
          const t = boxTrail(order, s.slot);
          const b = boxes[s.slot];
          const n = photos.filter((p) => p.box === s.slot + 1).length;
          return (
            <div key={s.slot} className="rounded-2xl px-4 py-3.5" style={{ border: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-[15px] font-semibold">Box {s.slot + 1}{b ? ` · ${b.name}` : ''}</p>
                <span className="shrink-0 text-[13px] font-semibold" style={{ color: s.voided ? C.warn : t.status === 'DELIVERED' ? C.ok : MOVED.includes(t.status) ? C.ink : C.muted }}>{s.voided ? 'Label voided' : statusWord(t.status || String(order.carrierTrail?.carrierStatus || ''))}</span>
              </div>
              <p className="m-0 mt-1 text-[14px]" style={muted}>{[s.tracking ? s.tracking : 'No tracking number', b ? `${+b.lengthIn.toFixed(1)} × ${+b.widthIn.toFixed(1)} × ${+b.heightIn.toFixed(1)} in` : '', n ? `${n} photo${n === 1 ? '' : 's'}` : '', t.at ? `${shortDay(t.at)}${t.where ? `, ${t.where}` : ''}` : ''].filter(Boolean).join(' · ')}</p>
              <div className="mt-2 flex flex-wrap gap-x-4">
                {(s.trackingUrl || order.trackingUrl) && <a href={s.trackingUrl || order.trackingUrl} target="_blank" rel="noreferrer" className="h-9 content-center text-[14px] font-semibold underline underline-offset-4">Track it</a>}
                {s.labelUrl && !s.voided && <button type="button" onClick={() => window.open(s.labelUrl, '_blank')} className="h-9 text-[14px] font-semibold underline underline-offset-4">{isZplLabel(s.labelUrl) ? 'Printer file' : 'Print the label'}</button>}
              </div>
            </div>);
        })}
      </div>
      {order.deliveredAt && <p className="m-0 mt-3 text-[14px] font-semibold" style={{ color: C.ok }}>Delivered {shortDay(order.deliveredAt)}, confirmed by the carrier</p>}
      {recs && recs.length > 0 && <button type="button" onClick={() => setLabelsOpen(true)} className="mt-3 h-11 text-[14.5px] font-semibold underline underline-offset-4">Every label on this order · postage {money(money$.postage)}{money$.waiting ? ` · ${money(money$.waiting)} on the way back` : ''}</button>}
      {labelsOpen && <LabelHistory order={order} recs={recs} onClose={() => setLabelsOpen(false)} />}
    </div>);
}

/** Pickup and curbside: the shelf, whether they're here, bringing it out, and handing it over. */
export function PickupPane({ fs, tenantId, order, actor, shopZone, rs, onHandover, onToast }: {
  fs: Firestore; tenantId: string; order: any; actor: Actor; shopZone: string; rs?: any; onHandover: () => void; onToast: (m: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const who = firstName(order.customerName);
  const stage = String(order.stage || '');
  const mins = curbsideWaitMinutes(order, new Date()) ?? 0;
  const out = !!order.curbside?.bringingOutAt;
  const outside = stage === 'arrived' || (order.method === 'curbside' && !!order.curbside?.arrivedAt && stage === 'ready');
  const goOut = async () => { setBusy(true); const r = await bringingOut(fs, tenantId, order, actor); setBusy(false); feel(r.ok); onToast(r.ok ? `${who} has been told you’re on your way out.` : r.message); };

  if (['paid', 'picking', 'packed'].includes(stage)) return (
    <div className="rounded-2xl p-4" style={{ background: C.soft }}>
      <p className="m-0 text-[15px] font-semibold">Once it’s packed</p>
      <p className="m-0 mt-1 text-[14px]" style={muted}>It gets a shelf spot, and {who} is told it’s ready{order.method === 'curbside' ? ', with a link to say when they’re outside' : ''}.{(order as any).pickupWindow?.label ? ` They chose ${(order as any).pickupWindow.label}.` : order.pickupAt && formatTime(order.pickupAt, shopZone) ? ` They asked for ${formatTime(order.pickupAt, shopZone)}.` : order.pickupAt ? ` They asked for ${order.pickupAt}.` : ''}</p>
    </div>);
  if (['completed'].includes(stage)) return (
    <div className="rounded-2xl p-4" style={{ background: C.okSoft }}>
      <p className="m-0 text-[15px] font-semibold" style={{ color: C.ok }}>Picked up{order.completedAt ? ` ${shortDay(order.completedAt)}, ${formatTime(order.completedAt, shopZone)}` : ''}</p>
    </div>);
  if (stage === 'cancelled') return <p className="m-0 text-[15px]" style={muted}>This order was canceled.</p>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>Shelf</p>
          <p className="m-0 mt-0.5 text-[28px] font-light tracking-[-0.02em]">{order.shelfSlot || '—'}</p>
          <p className="m-0 text-[13px]" style={muted}>{itemCount(order)} item{itemCount(order) === 1 ? '' : 's'}{order.readyAt ? ` · ready ${formatTime(order.readyAt, shopZone)}` : ''}</p>
        </div>
        <div className="rounded-2xl p-4" style={{ background: outside && !out ? C.warnSoft : C.soft }}>
          <p className="m-0 text-[13px] font-semibold" style={outside && !out ? { color: C.warn } : muted}>{order.method === 'curbside' ? methodWords('curbside', rs).short : 'At the counter'}</p>
          <p className="m-0 mt-0.5 text-[17px] font-semibold" style={outside && !out ? { color: C.warn } : undefined}>{out ? 'On the way out' : outside ? (mins < 1 ? 'Outside now' : `Outside ${mins} min`) : 'Not here yet'}</p>
          <p className="m-0 text-[13px]" style={muted}>{order.curbside?.spotOrVehicle || (order.method === 'curbside' ? 'They tap I’m here when they arrive' : 'They show their code at the counter')}</p>
        </div>
      </div>
      {order.collector?.name && <p className="m-0 mt-3 rounded-2xl px-4 py-3 text-[15px] font-medium" style={{ background: C.okSoft, color: C.ok }}>{order.collector.name} is collecting for {order.customerName || who}.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {outside && !out && <Btn kind="primary" className="flex-1" disabled={busy} onClick={() => void goOut()}>{busy ? 'Telling them…' : 'I’m bringing it out'}</Btn>}
        <Btn kind={outside && !out ? 'soft' : 'primary'} className="flex-1" onClick={onHandover}>Hand over to {order.collector?.name ? firstName(order.collector.name) : who}</Btn>
      </div>
      <p className="m-0 mt-3 text-[13px]" style={muted}>Hand over by scanning the code on their phone, or by checking their name and the last four digits of their phone.</p>
    </div>);
}
