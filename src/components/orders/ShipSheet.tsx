'use client';
// src/components/orders/ShipSheet.tsx — SHIP ONE ORDER. Pick a box (weight comes from the items plus the box), or add more
// boxes when it won't fit in one (the items' weight is shared across them unless you change a weight), pick a rate
// (cheapest first, covering every box), buy and print the labels, then mark it shipped. Or type tracking from labels
// bought elsewhere, one number per box.
// Insurance and signature follow the shop's shipping rules automatically (the label route applies them).
import { isZplLabel, slipAfterLabel } from '@/lib/label-format';
import * as React from 'react';
import type { Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { shipIt } from '@/lib/orders-flow';
import { firstName, money } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, muted } from './ui';
import { openPrint } from '@/lib/open-print';
import { labelProgress } from '@/lib/totes';
import { AddressCard } from './AddressCard';
import { addressKey, oneLine, openRequest } from '@/lib/address-flow';
import { paidServiceRate } from '@/lib/paid-service';
import { togetherRefunds } from '@/lib/ship-together';
import { cardRefundableCents } from '@/lib/retail-money';

type Preset = { id: string; name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number };
type Rate = { id: string; provider: string; service: string; amountCents: number; days: number | null };

export function ShipSheet({ fs, tenantId, order, inventory, rs, actor, onClose, onDone, onToast, together = [] }: { fs: Firestore; tenantId: string; order: any; inventory: any[]; rs: any; actor: Actor; onClose: () => void; onDone: (msg: string) => void; onToast?: (msg: string) => void; together?: any[] }) {
  // SHIPPED TOGETHER (lib/ship-together): the customer's other orders going in the same box. The label is bought on this
  // order; the others get the same tracking, and the shipping they paid is refunded automatically.
  const group = [order, ...together];
  const many = together.length > 0;
  const presets: Preset[] = (rs?.packagingPresets || []).slice(0, 8);
  const itemsOz = React.useMemo(() => group.flatMap((g: any) => g.lines || []).reduce((s: number, l: any) => {
    if (l.digital === true) return s;
    const w = Number(inventory.find((i: any) => i.id === l.productId)?.weightOz) || 4;
    return s + w * Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
  }, 0), [order, together, inventory]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE BOXES. Each has a size and a weight; the items' weight is shared across the boxes whose weight hasn't been typed.
  type Box = { presetId: string | null; oz: number; typed: boolean };
  const presetOf = (id: string | null) => presets.find((p) => p.id === id) || null;
  const autoOz = (list: Box[], i: number) => { const untyped = list.filter((b) => !b.typed).length || 1; const typedOz = list.reduce((s, b) => s + (b.typed ? Math.max(0, b.oz - (presetOf(b.presetId)?.weightOz || 3)) : 0), 0);
    return Math.max(4, Math.ceil(Math.max(0, itemsOz - typedOz) / untyped + (presetOf(list[i].presetId)?.weightOz ?? 3))); };
  const settle = (list: Box[]) => list.map((b, i) => (b.typed ? b : { ...b, oz: autoOz(list, i) }));
  const [boxes, setBoxes] = React.useState<Box[]>(() => settle([{ presetId: presets[0]?.id || null, oz: 0, typed: false }]));
  const [editing, setEditing] = React.useState<number | null>(null);
  const setBox = (i: number, patch: Partial<Box>) => setBoxes((list) => settle(list.map((b, j) => (j === i ? { ...b, ...patch } : b))));
  const addBox = () => setBoxes((list) => settle([...list, { presetId: presets[0]?.id || null, oz: 0, typed: false }]));
  const removeBox = (i: number) => setBoxes((list) => settle(list.filter((_, j) => j !== i)));
  const parcels = boxes.map((b) => { const d = presetOf(b.presetId) || { lengthIn: 10, widthIn: 8, heightIn: 4 } as any; return { weightOz: b.oz, lengthIn: d.lengthIn, widthIn: d.widthIn, heightIn: d.heightIn }; });
  const parcelsKey = JSON.stringify(parcels);
  const [rates, setRates] = React.useState<Rate[]>([]); const [rate, setRate] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false); const [err, setErr] = React.useState('');
  type LabelView = { url: string; carrier: string; number: string; trackUrl: string; extraUrls: string[]; extraNumbers: string[] };
  const labelOf = (o: any): LabelView | null => (o.labelUrl ? { url: o.labelUrl, carrier: o.carrier || '', number: o.trackingNumber || '', trackUrl: o.trackingUrl || '', extraUrls: o.extraLabelUrls || [], extraNumbers: o.extraTrackingNumbers || [] } : null);
  const [label, setLabel] = React.useState<LabelView | null>(labelOf(order));
  // The label as the order has it now: voided or replaced by someone else while this sheet is open, it follows.
  const labelSig = `${order.labelUrl || ''}|${order.shippoTransactionId || ''}`;
  const firstSig = React.useRef(labelSig);
  React.useEffect(() => { if (labelSig === firstSig.current) return; firstSig.current = labelSig; setLabel(labelOf(order)); }, [labelSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // A change to the address the customer asked for, on this order or any going in the same box (lib/address-flow).
  const asked = group.find((g: any) => openRequest(g)) || null;
  // Rates are priced for an address; when it changes, they're fetched again, and buying names the address they were for.
  const addrK = addressKey(order.shippingAddress);
  const [ratesFor, setRatesFor] = React.useState('');
  const [paidId, setPaidId] = React.useState(''); const [paidMissing, setPaidMissing] = React.useState(false);
  const [manual, setManual] = React.useState(!(rs?.shippoConnected || rs?.shippoApiKey) && !label);
  const [mCarrier, setMCarrier] = React.useState(''); const [mNumber, setMNumber] = React.useState('');
  const [mExtra, setMExtra] = React.useState<string[]>([]);   // more boxes, one tracking number each

  const post = async (body: any) => {
    const r = await fetch('/api/retail/shipping-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', ...body }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'That didn’t work.'); return d;
  };
  const loadRates = React.useCallback(async () => {
    if (manual || label) return; setLoading(true); setErr(''); setRates([]); setRate('');
    try {
      const d = await post({ action: 'rates', parcels, ...(many ? { withOrderIds: together.map((g: any) => g.id) } : {}) }); const rs2: Rate[] = (d.rates || []).sort((a: Rate, b: Rate) => a.amountCents - b.amountCents);
      // The service the customer paid for comes first (lib/paid-service); the cheapest when they chose plain shipping.
      const paid = paidServiceRate(rs2, order.shippingService, order.shippingCarrier);
      setRates(rs2); setRate((paid.rate || rs2[0])?.id || ''); setPaidId(paid.how === 'matched' ? paid.rate?.id || '' : ''); setPaidMissing(paid.how === 'missing'); setRatesFor(String(d.addressKey || ''));
    }
    catch (e: any) { setErr(e.message); } setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelsKey, manual, label, addrK]);
  React.useEffect(() => { void loadRates(); }, [loadRates]);

  const buy = async () => {
    setLoading(true); setErr('');
    try { const d = await post({ action: 'purchase', rateId: rate, parcels, ...(ratesFor ? { addressKey: ratesFor } : {}), ...(many ? { withOrderIds: together.map((g: any) => g.id) } : {}) });
      const extraUrls: string[] = d.extraLabelUrls || [];
      setLabel({ url: d.labelUrl || '', carrier: d.carrier || '', number: d.trackingNumber || '', trackUrl: d.trackingUrl || '', extraUrls, extraNumbers: d.extraTrackingNumbers || [] });
      if (many) await joinGroup(null);
      if (!extraUrls.length && d.labelUrl) window.open(d.labelUrl, '_blank'); }   // several labels: printed together from the button below, one tap
    catch (e: any) { setErr(e.message); if (/address changed/i.test(String(e.message))) void loadRates(); } setLoading(false);
  };
  // Several labels print together, in one stack (one page per box); orders shipped together print their slips with it.
  const printAll = () => openPrint(tenantId, 'orders', `/print/labels/${tenantId}?ids=${group.map((g: any) => g.id).join(',')}`);
  const [refundNote, setRefundNote] = React.useState('');
  const joinGroup = async (tracking: { carrier?: string; number?: string; extraNumbers?: string[] } | null) => {
    const r = await fetch('/api/retail/ship-together', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action: 'apply', orderIds: group.map((g: any) => g.id), ...(tracking ? { tracking } : {}) }) });
    const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) throw new Error(d.error || 'Those orders couldn’t be put together.');
    const cents = Object.values(d.refunds || {}).reduce((s: number, c: any) => s + (Number(c) || 0), 0);
    const sent = Object.values(d.refunded || {}).some(Boolean);
    setRefundNote(cents ? (sent ? `${money(cents)} of shipping refunded to ${firstName(order.customerName)}’s card.` : `${money(cents)} of shipping is waiting to be refunded: it’s on the order.`) : '');
  };
  const markShipped = async (t: { carrier?: string; number?: string; url?: string; extraNumbers?: string[] }) => {
    setLoading(true); setErr('');
    try { if (many && !label) await joinGroup({ carrier: t.carrier, number: t.number, extraNumbers: t.extraNumbers }); } catch (e: any) { setErr(e.message); setLoading(false); return; }
    let r = await shipIt(fs, tenantId, order, actor, t);
    // The others already carry the tracking (set when they were put together); one shipping email is enough.
    for (const g of together) { if (!r.ok) break; r = await shipIt(fs, tenantId, g, actor, {}); }
    setLoading(false);
    if (r.ok) onDone(many ? `${firstName(order.customerName)}’s ${group.length} orders are on their way in one shipment.${refundNote ? ` ${refundNote}` : ''}` : `${firstName(order.customerName)}’s order is on its way. They get tracking when the carrier scans it.`); else setErr(r.message);
  };
  // Void the label (every box's): the wrong box, the wrong rate, or the address changed. The postage comes back. A label
  // shared by orders in one box comes off all of them. A void that didn't finish (no answer from Shippo, or some boxes
  // voided and others not) leaves a label that may no longer work: it's shown, and it can't be marked shipped.
  const [voiding, setVoiding] = React.useState<'ask' | 'busy' | null>(null);
  const sharedWith = Array.isArray(order.shippedWithOrderIds) ? order.shippedWithOrderIds.length : 0;
  const inDoubt = !!order.shippoTransactionId && (String(order.labelVoiding?.txn || '') === String(order.shippoTransactionId) || (Array.isArray(order.labelVoidIds) && order.labelVoidIds.length > 0));
  const voidOpen = inDoubt && voiding !== 'busy';
  const voidLabel = async () => {
    setVoiding('busy'); setErr('');
    try { const d = await post({ action: 'void' }); setLabel(null); setRates([]); setVoiding(null); onToast?.(d.message || 'Label voided.'); }
    catch (e: any) { setErr(e.message); setVoiding('ask'); }
  };
  const chosen = rates.find((r) => r.id === rate);
  const pill = (on: boolean) => ({ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: C.paper, color: C.ink } as React.CSSProperties);

  return (
    <Sheet title={many ? `Ship ${firstName(order.customerName)}’s ${group.length} orders together` : `Ship ${firstName(order.customerName)}’s order`} sub={order.shippingAddress ? `To ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode || ''}${many ? ` · ${group.map((g: any) => `#${String(g.orderNumber ?? '').padStart(4, '0')}`).join(' + ')}` : ''}` : undefined} onClose={onClose}>
      <div className="mt-2"><AddressCard order={order} tenantId={tenantId} onToast={onToast} /></div>
      {asked && (
        <div className="mt-2 rounded-2xl p-4 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>
          <b className="font-semibold">{firstName(asked.customerName)} asked to change the address{many ? ` on #${String(asked.orderNumber ?? '').padStart(4, '0')}` : ''}</b> to {oneLine(asked.addressRequest?.to)}. Answer that on the order first, so the label goes to the right place.
        </div>)}
      {many && (
        <div className="mt-2 rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>In this shipment</p>
          {group.map((g: any) => <p key={g.id} className="m-0 mt-1 text-[15px]"><b className="font-semibold">#{String(g.orderNumber ?? '').padStart(4, '0')}</b> · {(g.lines || []).filter((l: any) => l.digital !== true).map((l: any) => `${l.name}${(l.qtyOrdered || 1) > 1 ? ` × ${l.qtyOrdered}` : ''}`).join(', ')}</p>)}
          <p className="m-0 mt-2 text-[14px]" style={muted}>{(() => { const back = Object.values(togetherRefunds(group, cardRefundableCents)).reduce((s: number, c: number) => s + c, 0); return back ? `${money(back)} of the shipping paid on the other order${together.length > 1 ? 's' : ''} is refunded automatically.` : 'One label covers every order; each gets the tracking.'; })()}</p>
        </div>)}
      {label ? (
        <div className="mt-2">
          {(() => { const n = 1 + (label.extraUrls?.length || 0); const p = labelProgress(order); return (
          <div className="rounded-2xl p-4" style={{ background: C.soft }}><p className="m-0 text-[17px] font-semibold">{n > 1 ? `${n} labels ready, one per box` : 'Label ready'}</p>
            <p className="m-0 mt-1 text-[15px]" style={muted}>{[label.carrier, [label.number, ...(label.extraNumbers || [])].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
            <p className="m-0 mt-2 text-[14px] font-semibold" style={{ color: order.labelCheckedAt ? C.ok : C.ink }}>{order.labelCheckedAt ? (n > 1 ? 'Every box’s label checked' : 'Label on the box and checked') : n > 1 ? `${p.checked} of ${n} labels checked. Scan each box’s label at the bench.` : 'Scan the label on the box at the bench to check it.'}</p></div>); })()}
          <div className="mt-3 flex flex-col gap-2">
            {label.url && <Btn kind={label.extraUrls?.length && !order.labelCheckedAt ? 'primary' : 'soft'} onClick={() => { if (label.extraUrls?.length) void printAll(); else window.open(label.url, '_blank'); }}>{isZplLabel(label.url) ? 'Download the printer file again' : label.extraUrls?.length ? `Print all ${1 + label.extraUrls.length} labels` : 'Print the label again'}</Btn>}
            {slipAfterLabel(rs) && order.qrToken && !many && <Btn kind="soft" onClick={() => window.open(`/print/packing-slip/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken || '')}`, '_blank')}>Print the packing slip</Btn>}
            {many && group.filter((g: any) => g.qrToken).map((g: any) => <Btn key={g.id} kind="soft" onClick={() => window.open(`/print/packing-slip/${tenantId}/${g.id}?t=${encodeURIComponent(g.qrToken || '')}`, '_blank')}>{`Packing slip for #${String(g.orderNumber ?? '').padStart(4, '0')}`}</Btn>)}
            {refundNote && <p className="m-0 text-[14px]" style={{ color: C.ok }}>{refundNote}</p>}
            <Btn kind="primary" className="text-[17px]" disabled={loading || !!asked || inDoubt} onClick={() => void markShipped({ carrier: label.carrier, number: label.number, url: label.trackUrl })}>{many ? `Mark all ${group.length} orders as shipped` : label.extraUrls?.length ? 'Mark all boxes as shipped' : 'Mark as shipped'}</Btn>
            {voidOpen && !voiding && (
              <div className="rounded-2xl p-4" style={{ background: C.warnSoft, color: C.warn }}>
                <p className="m-0 text-[15px] font-semibold">Voiding this label didn’t finish</p>
                <p className="m-0 mt-1 text-[14px]">It may no longer work, so it can’t be marked shipped. Void it again so the postage is sure to come back, then buy a new one.</p>
              </div>)}
            {!order.shippoTransactionId && order.labelFromOrderId && <p className="m-0 text-[14px]" style={muted}>This label was bought with another order in the same box. To void it, open that order.</p>}
            {order.shippoTransactionId && (voiding ? (
              <div className="rounded-2xl p-4" style={{ background: C.soft }}>
                <p className="m-0 text-[15px] font-semibold">Void {label.extraUrls?.length ? `all ${1 + label.extraUrls.length} labels` : 'this label'}?</p>
                <p className="m-0 mt-1 text-[14px]" style={muted}>Only if it hasn’t gone out. The postage is refunded by the carrier, which can take a few days. Take the old label off the box.{sharedWith ? ` It covers ${sharedWith === 1 ? 'another order' : `${sharedWith} other orders`} in this box, so it comes off ${sharedWith === 1 ? 'both' : 'all of them'}. Shipping refunded for sharing this box stays refunded.` : ''}</p>
                <div className="mt-3 flex gap-2"><Btn kind="danger" className="flex-1" disabled={voiding === 'busy'} onClick={() => void voidLabel()}>{voiding === 'busy' ? 'Voiding…' : 'Void it'}</Btn><Btn kind="soft" className="flex-1" disabled={voiding === 'busy'} onClick={() => setVoiding(null)}>Keep it</Btn></div>
              </div>
            ) : <Btn kind={voidOpen ? 'soft' : 'plain'} style={voidOpen ? undefined : muted} onClick={() => setVoiding('ask')}>{voidOpen ? 'Void it again' : 'Void the label'}</Btn>)}
          </div>
        </div>
      ) : manual ? (
        <div className="mt-2 flex flex-col gap-2.5">
          <label className="text-[13px] font-semibold" style={muted}>Carrier<input value={mCarrier} onChange={(e) => setMCarrier(e.target.value)} placeholder="USPS, UPS, FedEx" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, color: C.ink, background: C.paper }} /></label>
          <label className="text-[13px] font-semibold" style={muted}>{mExtra.length ? 'Tracking number, box 1' : 'Tracking number'}<input value={mNumber} onChange={(e) => setMNumber(e.target.value)} className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, color: C.ink, background: C.paper }} /></label>
          {mExtra.map((v, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-[13px] font-semibold" style={muted}>Tracking number, box {i + 2}<input value={v} onChange={(e) => setMExtra((l) => l.map((x, j) => (j === i ? e.target.value : x)))} className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, color: C.ink, background: C.paper }} /></label>
              <button type="button" onClick={() => setMExtra((l) => l.filter((_, j) => j !== i))} className="h-12 px-2 text-[14px] font-semibold" aria-label={`Remove box ${i + 2}`}>Remove</button>
            </div>))}
          {mExtra.length < 9 && <Btn kind="plain" onClick={() => setMExtra((l) => [...l, ''])} style={muted}>Add another box</Btn>}
          <p className="m-0 text-[14px]" style={muted}>{firstName(order.customerName)} gets an email with this tracking number.</p>
          <Btn kind="primary" className="text-[17px]" disabled={loading || !mNumber.trim() || !!asked} onClick={() => void markShipped({ carrier: mCarrier.trim(), number: mNumber.trim(), extraNumbers: mExtra.map((x) => x.trim()).filter(Boolean) })}>Mark as shipped</Btn>
          {(rs?.shippoConnected || rs?.shippoApiKey) && <Btn kind="plain" onClick={() => setManual(false)} style={muted}>Buy a label here instead</Btn>}
        </div>
      ) : (
        <div className="mt-2">
          {boxes.map((b, i) => (
            <div key={i} className={i ? 'mt-4' : ''}>
              <div className="flex items-center justify-between"><p className="m-0 text-[13px] font-semibold" style={muted}>{boxes.length > 1 ? `Box ${i + 1}` : 'Box'}</p>
                {boxes.length > 1 && <button type="button" onClick={() => removeBox(i)} className="h-9 px-1 text-[14px] font-semibold" aria-label={`Remove box ${i + 1}`}>Remove</button>}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {presets.map((p) => <button key={p.id} type="button" onClick={() => setBox(i, { presetId: p.id })} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={pill(b.presetId === p.id)}>{p.name}</button>)}
                {presets.length === 0 && <span className="text-[15px]" style={muted}>Standard box, 10 × 8 × 4</span>}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.soft }}>
                {editing === i ? <label className="flex items-center gap-2">Weight <input type="number" min={1} value={b.oz} onChange={(e) => setBox(i, { oz: Math.max(1, Number(e.target.value) || 1), typed: true })} className="h-10 w-20 rounded-xl border px-2 text-[17px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /> oz</label>
                  : <span><b className="font-semibold">{Math.floor(b.oz / 16) ? `${Math.floor(b.oz / 16)} lb ` : ''}{b.oz % 16} oz</b> <span style={muted}>{b.typed ? 'as you weighed it' : boxes.length > 1 ? 'its share of the items, plus the box' : 'from the items and box'}</span></span>}
                <button type="button" onClick={() => setEditing((e) => (e === i ? null : i))} className="h-11 px-1 font-semibold">{editing === i ? 'Done' : 'Change'}</button>
              </div>
            </div>))}
          {boxes.length < 10 && <Btn kind="plain" className="mt-2 w-full" onClick={addBox}>Add another box</Btn>}
          <p className="m-0 mt-4 text-[13px] font-semibold" style={muted}>Carrier{order.shippingCents ? ` · they paid ${money(order.shippingCents)} for shipping` : ''}</p>
          {paidMissing && <p className="m-0 mt-2 rounded-2xl p-3 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>They paid for {order.shippingService}, and it isn’t offered for this box today. Choose the closest service.</p>}
          <div className="mt-2 flex flex-col gap-2">
            {loading && rates.length === 0 && <p className="m-0 py-3 text-[15px]" style={muted}>Getting rates…</p>}
            {rates.map((r, i) => (
              <button key={r.id} type="button" onClick={() => setRate(r.id)} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left" style={pill(rate === r.id)}>
                <span className="h-5 w-5 shrink-0 rounded-full" style={{ border: rate === r.id ? `6px solid ${C.ink}` : `2px solid ${C.line}`, boxSizing: 'border-box' }} />
                <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{r.provider} {r.service}</span><span className="block text-[13px]" style={muted}>{r.days ? `About ${r.days} day${r.days === 1 ? '' : 's'}` : 'Delivery time varies'}{r.id === paidId ? ' · what they paid for' : i === 0 ? ' · cheapest' : ''}</span></span>
                <span className="text-[15px] font-semibold">{money(r.amountCents)}</span>
              </button>))}
          </div>
          <p className="m-0 mt-3 text-[14px]" style={muted}>Insurance and signature follow your shipping rules. {firstName(order.customerName)} gets tracking when the carrier first scans the box.</p>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={loading || !chosen || !!asked} onClick={() => void buy()}>{chosen ? (boxes.length > 1 ? `Buy ${boxes.length} labels for ${money(chosen.amountCents)} and print` : `Buy label for ${money(chosen.amountCents)} and print`) : 'Choose a rate'}</Btn>
          <Btn kind="plain" className="mt-1 w-full" style={muted} onClick={() => setManual(true)}>I already have tracking</Btn>
        </div>)}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
    </Sheet>);
}
