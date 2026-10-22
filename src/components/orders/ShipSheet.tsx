'use client';
// src/components/orders/ShipSheet.tsx — SHIP ONE ORDER. Pick a box (weight comes from the items plus the box), or add more
// boxes when it won't fit in one (the items' weight is shared across them unless you change a weight), pick a rate
// (cheapest first, covering every box), buy and print the labels, then mark it shipped. Or type tracking from labels
// bought elsewhere, one number per box.
// A wrong label is replaced here: say why, check the boxes (they start as the old label had them), pick the new rate.
// The old label is voided first and its refund followed until Shippo confirms it (lib/label-records); if the carrier
// already has it, nothing new is bought. A box whose label was voided while the others kept theirs (lib/label-boxes)
// gets its own new label here, or comes off the order.
// Insurance and signature follow the shop's shipping rules automatically (the label route applies them).
import { isZplLabel, slipAfterLabel } from '@/lib/label-format';
import * as React from 'react';
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { shipIt } from '@/lib/orders-flow';
import { firstName, money, orderNum } from '@/lib/orders-view';
import type { Actor } from '@/lib/retail-fulfill';
import { Btn, C, Sheet, muted } from './ui';
import { openPrint } from '@/lib/open-print';
import { labelProgress } from '@/lib/totes';
import { AddressCard } from './AddressCard';
import { addressKey, oneLine, openRequest } from '@/lib/address-flow';
import { paidServiceRate } from '@/lib/paid-service';
import { togetherRefunds } from '@/lib/ship-together';
import { cardRefundableCents } from '@/lib/retail-money';
import { labelDoubt, labelHolderId } from '@/lib/label-doubt';
import { REPLACE_REASONS, VOID_REASONS, boxCents, boxTrail, labelSlots, reasonLine, recordOf, slotsKnown, tail, type Parcel } from '@/lib/label-boxes';
import { useLabelRecords } from './LabelHistory';
import { SHIPPO_INSURANCE_RATE, packBoxesOf } from '@/lib/ship-run';

type Preset = { id: string; name: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number };
type Rate = { id: string; provider: string; service: string; amountCents: number; days: number | null };
type Dims = { lengthIn: number; widthIn: number; heightIn: number };
// One box: a saved size (presetId) or a size of its own (dims: an old label's, or one chosen at the bench), and its
// weight; typed means someone weighed it. tareOz: the empty box's own weight as the bench kept it.
type Box = { presetId: string | null; oz: number; typed: boolean; dims?: Dims | null; fromOld?: boolean; tareOz?: number };
type Step = 'why' | 'rates' | 'box' | null;
const MOVED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const word = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const sameCarrier = (a: unknown, b: unknown) => { const x = word(String(a || '')); const y = word(String(b || '')); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const shortDay = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const dimsLabel = (d: Dims) => `${+d.lengthIn.toFixed(1)} × ${+d.widthIn.toFixed(1)} × ${+d.heightIn.toFixed(1)}`;

/** Live from Firestore while the sheet is open: one document, or null. */
function useDoc(fs: Firestore, path: string): any | null {
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => {
    if (!path) { setD(null); return; }
    return onSnapshot(doc(fs, path), (s) => setD(s.exists() ? { id: s.id, ...(s.data() as any) } : null), () => setD(null));
  }, [fs, path]);
  return d;
}

export function ShipSheet({ fs, tenantId, order, inventory, rs, actor, onClose, onDone, onToast, together = [] }: { fs: Firestore; tenantId: string; order: any; inventory: any[]; rs: any; actor: Actor; onClose: () => void; onDone: (msg: string) => void; onToast?: (msg: string) => void; together?: any[] }) {
  // SHIPPED TOGETHER (lib/ship-together): the customer's other orders going in the same box. The label is bought on this
  // order; the others get the same tracking, and the shipping they paid is refunded automatically.
  const group = [order, ...together];
  const many = together.length > 0;
  const who = firstName(order.customerName);
  const presets: Preset[] = (rs?.packagingPresets || []).slice(0, 8);
  const itemsOz = React.useMemo(() => group.flatMap((g: any) => g.lines || []).reduce((s: number, l: any) => {
    if (l.digital === true) return s;
    const w = Number(inventory.find((i: any) => i.id === l.productId)?.weightOz) || 4;
    return s + w * Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
  }, 0), [order, together, inventory]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE BOXES. Each has a size and a weight; the items' weight is shared across the boxes whose weight hasn't been typed.
  const presetOf = (id: string | null) => presets.find((p) => p.id === id) || null;
  const tare = (b: Box) => (Number.isFinite(Number(b.tareOz)) && b.tareOz != null ? Number(b.tareOz) : presetOf(b.presetId)?.weightOz ?? 3);
  const autoOz = (list: Box[], i: number) => { const untyped = list.filter((b) => !b.typed).length || 1; const typedOz = list.reduce((s, b) => s + (b.typed ? Math.max(0, b.oz - tare(b)) : 0), 0);
    // As the bulk buy weighs them (lib/ship-run parcelsFor): never under 4 oz a box, or 8 oz for one box alone.
    return Math.max(list.length > 1 ? 4 : 8, Math.ceil(Math.max(0, itemsOz - typedOz) / untyped + tare(list[i]))); };
  const settle = (list: Box[]) => list.map((b, i) => (b.typed ? b : { ...b, oz: autoOz(list, i) }));
  // The boxes chosen at the bench (lib/ship-run), when the packer picked them, at the size and box weight the bench kept
  // (as the bulk buy prices them, even if the saved size was changed since); otherwise the first saved size.
  const fromBench = (): Box[] => packBoxesOf(order).map((b) => {
    const p = presetOf(b.presetId);
    const same = !!p && Math.abs(p.lengthIn - b.lengthIn) <= 0.5 && Math.abs(p.widthIn - b.widthIn) <= 0.5 && Math.abs(p.heightIn - b.heightIn) <= 0.5;
    return same ? { presetId: b.presetId, oz: 0, typed: false, tareOz: b.weightOz }
      : { presetId: null, dims: { lengthIn: b.lengthIn, widthIn: b.widthIn, heightIn: b.heightIn }, oz: 0, typed: false, tareOz: b.weightOz };
  });
  const fresh = (): Box[] => { const bench = fromBench(); return settle(bench.length ? bench : [{ presetId: presets[0]?.id || null, oz: 0, typed: false }]); };
  const [boxes, setBoxes] = React.useState<Box[]>(fresh);
  const [editing, setEditing] = React.useState<number | null>(null);
  const setBox = (i: number, patch: Partial<Box>) => setBoxes((list) => settle(list.map((b, j) => (j === i ? { ...b, ...patch } : b))));
  const addBox = () => setBoxes((list) => settle([...list, { presetId: presets[0]?.id || null, oz: 0, typed: false }]));
  const removeBox = (i: number) => setBoxes((list) => settle(list.filter((_, j) => j !== i)));
  const parcels = boxes.map((b) => { const d = presetOf(b.presetId) || b.dims || { lengthIn: 10, widthIn: 8, heightIn: 4 }; return { weightOz: b.oz, lengthIn: d.lengthIn, widthIn: d.widthIn, heightIn: d.heightIn }; });
  const parcelsKey = JSON.stringify(parcels);
  // A box as an old label had it: its saved size when one matches, otherwise its own size, at the weight it was bought for.
  const boxFrom = (p: Parcel | null | undefined): Box => {
    if (!p) return { presetId: presets[0]?.id || null, oz: 0, typed: false };
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
    const match = presets.find((x) => near(x.lengthIn, p.lengthIn) && near(x.widthIn, p.widthIn) && near(x.heightIn, p.heightIn));
    return { presetId: match?.id || null, dims: match ? null : { lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn }, oz: Math.max(1, Math.round(p.weightOz)), typed: true, fromOld: true };
  };

  const [step, setStep] = React.useState<Step>(null);
  const [rep, setRep] = React.useState<{ box: number | null; kind: string; note: string }>({ box: null, kind: '', note: '' });
  const [boxSlot, setBoxSlot] = React.useState<number | null>(null);
  const [replaced, setReplaced] = React.useState<{ box: number | null; refundCents: number; newCents: number; why: string; note: string } | null>(null);

  const [rates, setRates] = React.useState<Rate[]>([]); const [rate, setRate] = React.useState<string>('');
  // How this box is covered (the shop's insurance and signature rules, as the label route applied them to the rates).
  const [cover, setCover] = React.useState<{ signature: string; insuranceCents: number } | null>(null);
  const [loading, setLoading] = React.useState(false); const [err, setErr] = React.useState('');
  type LabelView = { url: string; carrier: string; number: string; trackUrl: string; extraUrls: string[]; extraNumbers: string[] };
  const labelOf = (o: any): LabelView | null => (o.labelUrl ? { url: o.labelUrl, carrier: o.carrier || '', number: o.trackingNumber || '', trackUrl: o.trackingUrl || '', extraUrls: o.extraLabelUrls || [], extraNumbers: o.extraTrackingNumbers || [] } : null);
  const [label, setLabel] = React.useState<LabelView | null>(labelOf(order));
  // The label as the order has it now: voided or replaced by someone else while this sheet is open, it follows.
  const labelSig = `${order.labelUrl || ''}|${order.shippoTransactionId || ''}|${(order.labelTxns || []).join(',')}|${(order.labelVoidIds || []).join(',')}`;
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

  // An order in another order's box carries a copy of that order's label (lib/ship-together): it follows that label.
  const holderId = labelHolderId(order);
  const holder = useDoc(fs, holderId ? `tenants/${tenantId}/retailOrders/${holderId}` : '');
  const owner = holderId ? holder : order;
  const doubt = labelDoubt(owner);   // lib/label-doubt
  const inDoubt = doubt !== null;
  const slots = owner ? labelSlots(owner) : [];
  const known = !!owner && slotsKnown(owner);
  const voided = slots.filter((s) => s.voided);
  // The order's label records: what each box's label cost, its size and weight, who bought it (lib/label-records). A box
  // that had its own new label is on a record of its own, so each box is found by its own Shippo label.
  const recs = useLabelRecords(fs, tenantId, order.shippoTransactionId ? order.id : '');
  const firstRec = (recs || []).find((r: any) => r.id === recordOf(order, 0)) || null;
  const boxRec = (slot: number): { rec: any; i: number; n: number; parcel: Parcel | null } | null => {
    const txn = slots[slot]?.txn;
    if (!txn) return null;
    for (const r of recs || []) {
      const list: any[] = Array.isArray(r.boxes) ? r.boxes : [];
      const i = list.findIndex((b: any) => b?.txn === txn);
      if (i >= 0) return { rec: r, i, n: list.length, parcel: list[i]?.parcel || null };
    }
    return null;
  };
  // What a box's label cost: its own price when each box was bought on its own, else its share of the label's.
  const shareOf = (slot: number) => { const b = boxRec(slot); return b ? boxCents(b.rec, b.i) : 0; };
  // What the old label (or the one box's) cost: what comes back once Shippo confirms the refund. Boxes that can't be told
  // apart (bought before each box's label was kept) are priced from the label they were all bought on.
  const oldCents = (() => {
    if (rep.box !== null) return shareOf(rep.box);
    const live = slots.filter((s) => !s.voided);
    if (live.length && live.every((s) => boxRec(s.slot))) return live.reduce((a, s) => a + shareOf(s.slot), 0);
    return Number(firstRec?.amountCents) || 0;
  })();
  const service = String((boxRec(0)?.rec || firstRec)?.service || order.shippingService || '');

  // The order changed under the rates (the address, or another label landed): they're fetched again.
  const stale = (e: any) => !!e?.data?.addressChanged || /address changed/i.test(String(e?.message || ''));
  const post = async (body: any) => {
    const r = await fetch('/api/retail/shipping-label', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: order.id, qrToken: order.qrToken || '', ...body }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) { const e: any = new Error(d.error || 'That didn’t work.'); e.data = d; throw e; } return d;
  };
  // Rates for whatever is being bought: the first label, a replacement, or one box's new label.
  const oneBox = step === 'box' || (step === 'rates' && rep.box !== null);
  const wantRates = step === 'rates' || step === 'box' || (!step && !manual && !label);
  const ratesSlot = step === 'box' ? boxSlot : step === 'rates' ? rep.box : null;
  const loadRates = React.useCallback(async () => {
    if (!wantRates) return; setLoading(true); setErr(''); setRates([]); setRate('');
    try {
      const d = await post({ action: 'rates', parcels, ...(ratesSlot !== null && ratesSlot !== undefined ? { slot: ratesSlot } : {}), ...(many ? { withOrderIds: together.map((g: any) => g.id) } : {}) });
      let rs2: Rate[] = (d.rates || []).sort((a: Rate, b: Rate) => a.amountCents - b.amountCents);
      // One box of several goes with the same carrier as the rest, when it can.
      if (oneBox && rs2.some((r) => sameCarrier(r.provider, order.carrier))) rs2 = rs2.filter((r) => sameCarrier(r.provider, order.carrier));
      // The service the customer paid for comes first (lib/paid-service); the cheapest when they chose plain shipping.
      const paid = paidServiceRate(rs2, order.shippingService, order.shippingCarrier);
      setRates(rs2); setRate((paid.rate || rs2[0])?.id || ''); setPaidId(paid.how === 'matched' ? paid.rate?.id || '' : ''); setPaidMissing(paid.how === 'missing'); setRatesFor(String(d.addressKey || ''));
      setCover(d.protection ? { signature: String(d.protection.signature || 'NONE'), insuranceCents: Math.max(0, Number(d.protection.insuranceCents) || 0) } : null);
    }
    catch (e: any) { setErr(e.message); } setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelsKey, wantRates, addrK, ratesSlot, oneBox]);
  React.useEffect(() => { void loadRates(); }, [loadRates]);
  const chosen = rates.find((r) => r.id === rate);

  const buy = async () => {
    setLoading(true); setErr('');
    try { const d = await post({ action: 'purchase', rateId: rate, parcels, amountCents: chosen?.amountCents, provider: chosen?.provider, ...(ratesFor ? { addressKey: ratesFor } : {}), ...(many ? { withOrderIds: together.map((g: any) => g.id) } : {}) });
      const extraUrls: string[] = d.extraLabelUrls || [];
      setLabel({ url: d.labelUrl || '', carrier: d.carrier || '', number: d.trackingNumber || '', trackUrl: d.trackingUrl || '', extraUrls, extraNumbers: d.extraTrackingNumbers || [] });
      if (many) await joinGroup(null);
      if (!extraUrls.length && d.labelUrl) window.open(d.labelUrl, '_blank'); }   // several labels: printed together from the button below, one tap
    catch (e: any) { setErr(e.message); if (stale(e)) void loadRates(); } setLoading(false);
  };
  // REPLACE: the old label is voided first, then the new one bought and linked to it. Nothing is bought if the old one
  // can't be voided (the carrier has it).
  const openReplace = () => { setErr(''); setReplaced(null); setRep({ box: anyMoving ? replaceable[0]?.slot ?? null : null, kind: '', note: '' }); setStep('why'); };
  const toRates = () => {
    setErr('');
    // Each box as its old label had it; a box whose size wasn't kept starts from its share of the items, plus the box.
    const seed = rep.box === null ? slots.filter((s) => !s.voided).map((s) => boxFrom(boxRec(s.slot)?.parcel)) : [boxFrom(boxRec(rep.box)?.parcel)];
    setBoxes(settle(seed.length ? seed : fresh())); setEditing(null); setStep('rates');
  };
  const replace = async () => {
    setLoading(true); setErr('');
    try {
      const d = await post({ action: 'replace', rateId: rate, parcels, amountCents: chosen?.amountCents, provider: chosen?.provider, reason: { kind: rep.kind, note: rep.note.trim() }, ...(rep.box !== null ? { box: rep.box } : {}), ...(ratesFor ? { addressKey: ratesFor } : {}) });
      const extraUrls: string[] = d.extraLabelUrls || [];
      if (rep.box === null) setLabel({ url: d.labelUrl || '', carrier: d.carrier || '', number: d.trackingNumber || '', trackUrl: d.trackingUrl || '', extraUrls, extraNumbers: d.extraTrackingNumbers || [] });
      setReplaced({ box: rep.box, refundCents: Number(d.replaced?.refundCents) || 0, newCents: Number(d.costCents) || chosen?.amountCents || 0, why: reasonLine({ kind: rep.kind, note: rep.note }), note: String(d.replaced?.note || '') });
      setStep(null);
      if (!extraUrls.length && d.labelUrl) window.open(d.labelUrl, '_blank');
    } catch (e: any) {
      setErr(e.message);
      // The old label was voided and the new one didn't go through: back to buying one, or to that box's own card.
      if (e?.data?.voided) { setStep(null); if (rep.box === null) setLabel(null); }
      if (stale(e)) void loadRates();
    }
    setLoading(false);
  };
  // ONE BOX'S NEW LABEL: a box whose label was voided while the others kept theirs.
  const openBox = (slot: number) => {
    setErr(''); setReplaced(null); setBoxSlot(slot);
    const p = boxRec(slot)?.parcel;
    setBoxes(settle([p ? boxFrom(p) : { presetId: presets[0]?.id || null, oz: Math.max(4, Math.round(itemsOz / Math.max(1, slots.length)) + 3), typed: true }]));
    setEditing(null); setStep('box');
  };
  const buyBox = async () => {
    if (boxSlot === null) return;
    setLoading(true); setErr('');
    try {
      const d = await post({ action: 'box', slot: boxSlot, rateId: rate, parcels, amountCents: chosen?.amountCents, provider: chosen?.provider, ...(ratesFor ? { addressKey: ratesFor } : {}) });
      onToast?.(`Box ${boxSlot + 1} has its new label.`); setStep(null); setBoxSlot(null);
      if (d.labelUrl) window.open(d.labelUrl, '_blank');
    } catch (e: any) { setErr(e.message); if (stale(e)) void loadRates(); }
    setLoading(false);
  };
  const dropBox = async (slot: number) => {
    setLoading(true); setErr('');
    try { const d = await post({ action: 'drop_box', slot }); onToast?.(d.message || 'Done.'); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };

  // Several labels print together, in one stack (one page per box); orders shipped together print their slips with it.
  const printAll = () => openPrint(tenantId, 'orders', `/print/labels/${tenantId}?ids=${group.map((g: any) => g.id).join(',')}`);
  const [refundNote, setRefundNote] = React.useState('');
  const joinGroup = async (tracking: { carrier?: string; number?: string; extraNumbers?: string[] } | null) => {
    const r = await fetch('/api/retail/ship-together', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action: 'apply', orderIds: group.map((g: any) => g.id), ...(tracking ? { tracking } : {}) }) });
    const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) throw new Error(d.error || 'Those orders couldn’t be put together.');
    const cents = Object.values(d.refunds || {}).reduce((s: number, c: any) => s + (Number(c) || 0), 0);
    const sent = Object.values(d.refunded || {}).some(Boolean);
    setRefundNote(cents ? (sent ? `${money(cents)} of shipping refunded to ${who}’s card.` : `${money(cents)} of shipping is waiting to be refunded: it’s on the order.`) : '');
  };
  const markShipped = async (t: { carrier?: string; number?: string; url?: string; extraNumbers?: string[] }) => {
    setLoading(true); setErr('');
    try { if (many && !label) await joinGroup({ carrier: t.carrier, number: t.number, extraNumbers: t.extraNumbers }); } catch (e: any) { setErr(e.message); setLoading(false); return; }
    let r = await shipIt(fs, tenantId, order, actor, t);
    // The others already carry the tracking (set when they were put together); one shipping email is enough.
    for (const g of together) { if (!r.ok) break; r = await shipIt(fs, tenantId, g, actor, {}); }
    setLoading(false);
    if (r.ok) onDone(many ? `${who}’s ${group.length} orders are on their way in one shipment.${refundNote ? ` ${refundNote}` : ''}` : `${who}’s order is on its way. They get tracking when the carrier scans it.`); else setErr(r.message);
  };
  // Void the label (every box's): the wrong box, the wrong rate, or the address changed. The postage comes back. A label
  // shared by orders in one box comes off all of them. A void that didn't finish (no answer from Shippo, or some boxes
  // voided and others not) leaves a label that may no longer work: it's shown, and it can't be marked shipped.
  const [voiding, setVoiding] = React.useState<'ask' | 'busy' | null>(null);
  const [voidWhy, setVoidWhy] = React.useState<{ kind: string; note: string }>({ kind: '', note: '' });
  const sharedWith = Array.isArray(order.shippedWithOrderIds) ? order.shippedWithOrderIds.length : 0;
  // The "didn't finish" card is for a void under way or stopped part way; a box waiting for its new label has its own.
  const voidOpen = inDoubt && doubt !== 'relabel' && voiding !== 'busy';
  const keepLabel = async () => {
    setLoading(true); setErr('');
    try { const d = await post({ action: 'unscanned_ok' }); onToast?.(d.message || 'Noted.'); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const voidLabel = async () => {
    setVoiding('busy'); setErr('');
    try { const d = await post({ action: 'void', ...(voidWhy.kind ? { reason: { kind: voidWhy.kind, note: voidWhy.note.trim() } } : {}) }); setLabel(null); setRates([]); setVoiding(null); setReplaced(null); onToast?.(d.message || 'Label voided.'); }
    catch (e: any) { setErr(e.message); setVoiding('ask'); }
  };
  const pill = (on: boolean) => ({ border: on ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: C.paper, color: C.ink } as React.CSSProperties);
  const radio = (on: boolean) => <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full" style={{ border: on ? `6px solid ${C.ink}` : `2px solid #c9cacd`, boxSizing: 'border-box' }} />;
  const n = Math.max(1, slots.length);
  const ownLabel = !!order.shippoTransactionId && !holderId;
  // Boxes that can be replaced on their own: known apart, still unscanned. Once one is with the carrier, the whole label
  // can't be voided, so only the others can be replaced.
  const anyMoving = slots.some((s) => MOVED.includes(boxTrail(owner, s.slot).status));
  const replaceable = known && n > 1 ? slots.filter((s) => !s.voided && !MOVED.includes(boxTrail(owner, s.slot).status)) : [];
  const canReplace = ownLabel && ['paid', 'picking', 'packed'].includes(String(order.stage)) && !inDoubt && !asked && !!(rs?.shippoConnected || rs?.shippoApiKey) && (!anyMoving || replaceable.length > 0);
  const boxesTitle = (k: number) => (k > 1 ? `${k} boxes` : '1 box');
  const sub = `${orderNum(order)} · ${order.customerName || 'Customer'}${service || order.carrier ? ` · ${[order.carrier, service].filter(Boolean).join(' ')}` : ''} · ${boxesTitle(n)}`;

  const title = step === 'why' ? 'Replace the label' : step === 'rates' ? 'The new label' : step === 'box' ? `A new label for box ${(boxSlot ?? 0) + 1}` : replaced ? 'New label ready'
    : many ? `Ship ${who}’s ${group.length} orders together` : `Ship ${who}’s order`;
  const sheetSub = step ? (step === 'rates' ? (rep.box === null ? 'Box sizes and weights from the old label. Change anything that’s different.' : `Box ${rep.box + 1}’s size and weight from its old label. Change anything that’s different.`) : step === 'box' ? `${orderNum(order)} · its old label was voided` : sub)
    : replaced ? sub
    : order.shippingAddress ? `To ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode || ''}${many ? ` · ${group.map((g: any) => `#${String(g.orderNumber ?? '').padStart(4, '0')}`).join(' + ')}` : ''}` : undefined;

  // The box editor: used to buy the first label, a replacement, and one box's new label.
  const editor = (opts: { fixed?: boolean }) => (<>
    {boxes.map((b, i) => (
      <div key={i} className={i ? 'mt-4' : ''}>
        <div className="flex items-center justify-between"><p className="m-0 text-[13px] font-semibold" style={muted}>{step === 'box' ? `Box ${(boxSlot ?? 0) + 1}` : step === 'rates' && rep.box !== null ? `Box ${rep.box + 1}` : boxes.length > 1 ? `Box ${i + 1}` : 'Box'}</p>
          {boxes.length > 1 && !opts.fixed && <button type="button" onClick={() => removeBox(i)} className="h-9 px-1 text-[14px] font-semibold" aria-label={`Remove box ${i + 1}`}>Remove</button>}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {b.dims && !b.presetId && <span className="flex h-11 items-center rounded-full px-4 text-[15px] font-semibold" style={pill(true)}>{dimsLabel(b.dims)}</span>}
          {presets.map((p) => <button key={p.id} type="button" onClick={() => setBox(i, { presetId: p.id, dims: null, tareOz: undefined })} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={pill(b.presetId === p.id)}>{p.name}</button>)}
          {presets.length === 0 && !b.dims && <span className="text-[15px]" style={muted}>Standard box, 10 × 8 × 4</span>}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl px-4 py-3 text-[15px]" style={{ background: C.soft }}>
          {editing === i ? <label className="flex items-center gap-2">Weight <input type="number" min={1} value={b.oz} onChange={(e) => setBox(i, { oz: Math.max(1, Number(e.target.value) || 1), typed: true, fromOld: false })} className="h-10 w-20 rounded-xl border px-2 text-[17px]" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /> oz</label>
            : <span><b className="font-semibold">{Math.floor(b.oz / 16) ? `${Math.floor(b.oz / 16)} lb ` : ''}{b.oz % 16} oz</b> <span style={muted}>{b.fromOld ? 'as the old label had it' : b.typed ? 'as you weighed it' : boxes.length > 1 ? 'its share of the items, plus the box' : 'from the items and box'}</span></span>}
          <button type="button" onClick={() => setEditing((e) => (e === i ? null : i))} className="h-11 px-1 font-semibold">{editing === i ? 'Done' : 'Change'}</button>
        </div>
      </div>))}
    {!opts.fixed && boxes.length < 10 && <Btn kind="plain" className="mt-2 w-full" onClick={addBox}>Add another box</Btn>}
  </>);
  const rateList = (<>
    <p className="m-0 mt-4 text-[13px] font-semibold" style={muted}>Carrier{order.shippingCents && !oneBox ? ` · they paid ${money(order.shippingCents)} for shipping` : ''}</p>
    {paidMissing && !oneBox && <p className="m-0 mt-2 rounded-2xl p-3 text-[14px]" style={{ background: C.warnSoft, color: C.warn }}>They paid for {order.shippingService}, and it isn’t offered for this box today. Choose the closest service.</p>}
    <div className="mt-2 flex flex-col gap-2">
      {loading && rates.length === 0 && <p className="m-0 py-3 text-[15px]" style={muted}>Getting rates…</p>}
      {rates.map((r, i) => (
        <button key={r.id} type="button" onClick={() => setRate(r.id)} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left" style={pill(rate === r.id)}>
          <span className="h-5 w-5 shrink-0 rounded-full" style={{ border: rate === r.id ? `6px solid ${C.ink}` : `2px solid ${C.line}`, boxSizing: 'border-box' }} />
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{r.provider} {r.service}</span><span className="block text-[13px]" style={muted}>{r.days ? `About ${r.days} day${r.days === 1 ? '' : 's'}` : 'Delivery time varies'}{r.id === paidId ? ` · what ${who} paid for` : i === 0 ? ' · cheapest' : ''}</span></span>
          <span className="text-[15px] font-semibold">{money(r.amountCents)}</span>
        </button>))}
    </div>
  </>);

  return (
    <Sheet title={title} sub={sheetSub} onClose={onClose}>
      {!step && !replaced && <div className="mt-2"><AddressCard order={order} tenantId={tenantId} onToast={onToast} /></div>}
      {asked && (
        <div className="mt-2 rounded-2xl p-4 text-[15px]" style={{ background: C.warnSoft, color: C.warn }}>
          <b className="font-semibold">{firstName(asked.customerName)} asked to change the address{many ? ` on #${String(asked.orderNumber ?? '').padStart(4, '0')}` : ''}</b> to {oneLine(asked.addressRequest?.to)}. Answer that on the order first, so the label goes to the right place.
        </div>)}
      {many && !step && (
        <div className="mt-2 rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>In this shipment</p>
          {group.map((g: any) => <p key={g.id} className="m-0 mt-1 text-[15px]"><b className="font-semibold">#{String(g.orderNumber ?? '').padStart(4, '0')}</b> · {(g.lines || []).filter((l: any) => l.digital !== true).map((l: any) => `${l.name}${(l.qtyOrdered || 1) > 1 ? ` × ${l.qtyOrdered}` : ''}`).join(', ')}</p>)}
          <p className="m-0 mt-2 text-[14px]" style={muted}>{(() => { const back = Object.values(togetherRefunds(group, cardRefundableCents)).reduce((s: number, c: number) => s + c, 0); return back ? `${money(back)} of the shipping paid on the other order${together.length > 1 ? 's' : ''} is refunded automatically.` : 'One label covers every order; each gets the tracking.'; })()}</p>
        </div>)}

      {step === 'why' ? (
        <div className="mt-2 flex flex-col gap-2.5">
          {replaceable.length > 0 && (<>
            <p className="m-0 text-[13px] font-semibold" style={muted}>Which label</p>
            <div className="flex flex-wrap gap-2">
              {!anyMoving && <button type="button" onClick={() => setRep({ ...rep, box: null })} className="h-10 rounded-full px-3.5 text-[14.5px] font-semibold" style={pill(rep.box === null)}>{n === 2 ? 'Both boxes' : `All ${n} boxes`}</button>}
              {replaceable.map((s) => <button key={s.slot} type="button" onClick={() => setRep({ ...rep, box: s.slot })} className="h-10 rounded-full px-3.5 text-[14.5px] font-semibold" style={pill(rep.box === s.slot)}>Box {s.slot + 1} only</button>)}
            </div>
          </>)}
          <p className="m-0 text-[13px] font-semibold" style={muted}>Why</p>
          {REPLACE_REASONS.map((r) => (
            <button key={r.id} type="button" onClick={() => setRep({ ...rep, kind: r.id })} className="flex gap-3 rounded-[18px] p-3.5 text-left" style={pill(rep.kind === r.id)}>
              {radio(rep.kind === r.id)}
              <span className="flex flex-col gap-1"><span className="text-[15px] font-semibold">{r.title}</span><span className="text-[14px] leading-snug">{r.sub}</span></span>
            </button>))}
          {rep.kind === 'other' && (
            <label className="text-[13px] font-semibold" style={muted}>What happened (for the record)
              <input value={rep.note} maxLength={300} onChange={(e) => setRep({ ...rep, note: e.target.value })} placeholder="For example: the printer smudged the barcode" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, color: C.ink, background: C.paper }} />
            </label>)}
          <div className="rounded-2xl px-3.5 py-3 text-[14px] leading-snug" style={{ background: C.soft }}>
            The old label is voided first. {oldCents ? `Its postage, ${money(oldCents)}, comes back` : 'Its postage comes back'} once Shippo confirms the refund, usually within 2 weeks.
          </div>
          <Btn kind="primary" className="h-[52px] text-[16px]" disabled={!rep.kind || (rep.kind === 'other' && !rep.note.trim())} onClick={toRates}>Next: the new label</Btn>
          <Btn kind="plain" style={muted} onClick={() => setStep(null)}>Back</Btn>
        </div>
      ) : step === 'rates' ? (
        <div className="mt-2">
          {editor({ fixed: rep.box !== null })}
          {rateList}
          <div className="mt-3 rounded-2xl px-3.5 py-3 text-[14px]" style={{ background: C.soft }}>
            <div className="flex justify-between gap-2.5"><span>{rep.box === null ? 'Old label' : `Box ${rep.box + 1}’s old label`}</span><span className="text-right">{oldCents ? `${money(oldCents)} back, once Shippo confirms` : 'Back once Shippo confirms'}</span></div>
            <div className="flex justify-between gap-2.5"><span>New label</span><span className="text-right">{chosen ? money(chosen.amountCents) : '—'}</span></div>
            {chosen && oldCents > 0 && <div className="flex justify-between gap-2.5 font-semibold"><span>Difference</span><span className="text-right">{chosen.amountCents === oldCents ? 'the same' : chosen.amountCents < oldCents ? `you save ${money(oldCents - chosen.amountCents)}` : `${money(chosen.amountCents - oldCents)} more`}</span></div>}
          </div>
          <Btn kind="primary" className="mt-4 h-[52px] w-full text-[16px]" disabled={loading || !chosen || !!asked} onClick={() => void replace()}>{loading && chosen ? 'Voiding and buying…' : 'Void the old label and buy this one'}</Btn>
          <p className="m-0 mt-2 text-center text-[12.5px] leading-snug" style={muted}>If the carrier has already scanned the old label, it isn’t voided and nothing new is bought.</p>
          <Btn kind="plain" className="mt-1 w-full" style={muted} disabled={loading} onClick={() => setStep('why')}>Back</Btn>
        </div>
      ) : step === 'box' ? (
        <div className="mt-2">
          {editor({ fixed: true })}
          {rateList}
          <Btn kind="primary" className="mt-4 h-[52px] w-full text-[16px]" disabled={loading || !chosen || !!asked} onClick={() => void buyBox()}>{chosen ? `Buy a label for box ${(boxSlot ?? 0) + 1} for ${money(chosen.amountCents)}` : 'Choose a rate'}</Btn>
          <p className="m-0 mt-2 text-center text-[12.5px] leading-snug" style={muted}>Box {(boxSlot ?? 0) + 1}’s new label is linked to this order, and {who} sees every tracking number on their order page.</p>
          <Btn kind="plain" className="mt-1 w-full" style={muted} disabled={loading} onClick={() => { setStep(null); setBoxSlot(null); }}>Back</Btn>
        </div>
      ) : label ? (
        <div className="mt-2">
          {replaced && (<>
            <div className="rounded-2xl p-4" style={{ background: C.okSoft }}>
              <p className="m-0 text-[14px] font-semibold" style={{ color: C.ok }}>{replaced.box === null ? 'Old label voided' : `Box ${replaced.box + 1}’s old label voided`} · {replaced.refundCents ? `${money(replaced.refundCents)} refund requested` : 'refund requested'}</p>
              <p className="m-0 mt-1.5 text-[14px]">{who}’s tracking switches to the new number{replaced.box === null && n > 1 ? 's' : ''} by itself.</p>
              {replaced.note && <p className="m-0 mt-1.5 text-[14px]" style={{ color: C.warn }}>{replaced.note.replace(/ The label is off the order, so you can buy a new one\.$/, '')}</p>}
            </div>
            <p className="m-0 mt-2 rounded-2xl px-3.5 py-3 text-[14px] leading-snug" style={{ background: C.soft }}>Peel the old label{replaced.box === null && n > 1 ? 's' : ''} off, or cover {replaced.box === null && n > 1 ? 'them' : 'it'} completely. A box with two barcodes can go to the wrong place.</p>
          </>)}
          {(() => { const p = labelProgress(order); const live = slots.filter((s) => !s.voided).length || 1; return (
          <div className="mt-2 rounded-2xl p-4" style={{ background: C.soft }}><p className="m-0 text-[17px] font-semibold">{replaced ? (replaced.box === null ? (n > 1 ? `${n} new labels, one per box` : 'New label') : `Box ${replaced.box + 1} has its new label`) : n > 1 ? `${n} labels, one per box` : 'Label ready'}</p>
            <p className="m-0 mt-1 text-[15px]" style={muted}>{[label.carrier, slots.filter((s) => !s.voided).map((s) => s.tracking).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}{replaced?.newCents ? ` · ${money(replaced.newCents)}` : ''}</p>
            {replaced?.why && <p className="m-0 mt-1 text-[14px]" style={muted}>Replaced: {replaced.why} · {firstName(actor.name)}</p>}
            {voided.length === 0 && <p className="m-0 mt-2 text-[14px] font-semibold" style={{ color: order.labelCheckedAt ? C.ok : C.ink }}>{order.labelCheckedAt ? (live > 1 ? 'Every box’s label checked' : 'Label on the box and checked') : live > 1 ? `${p.checked} of ${live} labels checked. Scan each box’s label at the bench.` : 'Scan the label on the box at the bench to check it.'}</p>}</div>); })()}
          {(n > 1 || voided.length > 0) && known && (
            <div className="mt-2 flex flex-col gap-2">
              {slots.map((s) => {
                const t = boxTrail(owner, s.slot); const moving = MOVED.includes(t.status);
                const badge = s.voided ? { text: 'Voided', bg: C.warnSoft, fg: C.warn } : t.status === 'DELIVERED' ? { text: 'Delivered', bg: C.okSoft, fg: C.ok } : moving ? { text: `With ${String(order.carrier || 'the carrier').split(' ')[0]}`, bg: C.okSoft, fg: C.ok } : null;
                return (
                  <div key={s.slot} className="rounded-[20px] px-4 py-3.5" style={{ border: s.voided ? `2px solid ${C.ink}` : `1px solid ${C.line}` }}>
                    <div className="flex items-center justify-between gap-2.5"><p className="m-0 text-[14px] font-semibold">Box {s.slot + 1}{s.tracking ? ` · ${tail(s.tracking)}` : ''}</p>{badge && <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold" style={{ background: badge.bg, color: badge.fg }}>{badge.text}</span>}</div>
                    {s.voided ? <p className="m-0 mt-1 text-[12.5px] leading-snug" style={muted}>Its label was voided. It needs a new one before it goes out.</p>
                      : moving ? <p className="m-0 mt-1 text-[12.5px] leading-snug" style={muted}>{t.status === 'DELIVERED' ? 'Delivered' : 'Scanned'}{shortDay(t.at) ? ` ${shortDay(t.at)}` : ''}{t.where ? `, ${t.where}` : ''}. It keeps its label.</p>
                      : s.labelUrl && <button type="button" onClick={() => window.open(s.labelUrl, '_blank')} className="mt-1 h-9 text-[14px] font-semibold">{isZplLabel(s.labelUrl) ? 'Download its printer file' : 'Print this box’s label'}</button>}
                    {s.voided && !holderId && doubt === 'relabel' && (
                      <div className="mt-3 flex flex-col gap-1.5">
                        <Btn kind="primary" className="h-11" disabled={loading || !!asked} onClick={() => openBox(s.slot)}>Buy a label for box {s.slot + 1}</Btn>
                        {slots.length > 1 && <Btn kind="plain" className="h-10" style={muted} disabled={loading} onClick={() => void dropBox(s.slot)}>Box {s.slot + 1} isn’t going</Btn>}
                      </div>)}
                  </div>);
              })}
              {voided.length > 0 && doubt === 'relabel' && !holderId && <p className="m-0 text-center text-[12.5px] leading-snug" style={muted}>A new label is linked to this order, and {who} sees every tracking number on their order page.</p>}
            </div>)}
          <div className="mt-3 flex flex-col gap-2">
            {label.url && voided.length === 0 && <Btn kind={replaced ? 'plain' : label.extraUrls?.length && !order.labelCheckedAt ? 'primary' : 'soft'} style={replaced ? { border: `2px solid ${C.ink}` } : undefined} onClick={() => { const one = replaced && replaced.box !== null ? slots[replaced.box]?.labelUrl : ''; if (one) window.open(one, '_blank'); else if (label.extraUrls?.length) void printAll(); else window.open(label.url, '_blank'); }}>{isZplLabel(label.url) ? 'Download the printer file again' : replaced ? (replaced.box === null && n > 1 ? `Print the ${n} new labels` : replaced.box !== null ? `Print box ${replaced.box + 1}’s new label` : 'Print the new label') : label.extraUrls?.length ? `Print all ${1 + label.extraUrls.length} labels` : 'Print the label again'}</Btn>}
            {slipAfterLabel(rs) && order.qrToken && !many && <Btn kind="soft" onClick={() => window.open(`/print/packing-slip/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken || '')}`, '_blank')}>Print the packing slip</Btn>}
            {many && group.filter((g: any) => g.qrToken).map((g: any) => <Btn key={g.id} kind="soft" onClick={() => window.open(`/print/packing-slip/${tenantId}/${g.id}?t=${encodeURIComponent(g.qrToken || '')}`, '_blank')}>{`Packing slip for #${String(g.orderNumber ?? '').padStart(4, '0')}`}</Btn>)}
            {refundNote && <p className="m-0 text-[14px]" style={{ color: C.ok }}>{refundNote}</p>}
            <Btn kind="primary" className="text-[17px]" disabled={loading || !!asked || inDoubt} onClick={() => void markShipped({ carrier: label.carrier, number: slots.find((s) => !s.voided)?.tracking || label.number, url: slots.find((s) => !s.voided)?.trackingUrl || label.trackUrl })}>{many ? `Mark all ${group.length} orders as shipped` : n > 1 ? 'Mark all boxes as shipped' : 'Mark as shipped'}</Btn>
            {doubt === 'relabel' && <p className="m-0 text-center text-[13px]" style={muted}>{holderId ? 'A box in the shipment this order shares needs its new label first. Sort it out on that order.' : 'It can be marked shipped once every box has a working label.'}</p>}
            {voidOpen && !voiding && (
              <div className="rounded-2xl p-4" style={{ background: C.warnSoft, color: C.warn }}>
                <p className="m-0 text-[15px] font-semibold">{holderId ? 'Voiding this box’s label didn’t finish' : 'Voiding this label didn’t finish'}</p>
                <p className="m-0 mt-1 text-[14px]">{holderId ? 'The label it shares with another order may no longer work, so it can’t be marked shipped. Sort it out on that order first.'
                  : `It may no longer work, so it can’t be marked shipped. Void it again so the postage is sure to come back, then buy a new one.${doubt === 'unfinished' ? ' If you’ve checked it in Shippo and it’s fine, keep it.' : ''}`}</p>
                {!holderId && doubt === 'unfinished' && <Btn kind="soft" className="mt-3 w-full" disabled={loading} onClick={() => void keepLabel()}>Keep the label</Btn>}
              </div>)}
            {!order.shippoTransactionId && order.labelFromOrderId && <p className="m-0 text-[14px]" style={muted}>This label was bought with another order in the same box. To void or replace it, open that order.</p>}
            {canReplace && !voiding && <Btn kind="soft" disabled={loading} onClick={openReplace}>Replace the label</Btn>}
            {ownLabel && (!anyMoving || voiding) && (voiding ? (
              <div className="rounded-2xl p-4" style={{ background: C.soft }}>
                <p className="m-0 text-[15px] font-semibold">Void {n > 1 ? `all ${n} labels` : 'this label'}?</p>
                <p className="m-0 mt-1 text-[14px]" style={muted}>Only if it hasn’t gone out. The postage comes back once Shippo confirms the refund, usually within 2 weeks. Take the old label off the box.{sharedWith ? ` It covers ${sharedWith === 1 ? 'another order' : `${sharedWith} other orders`} in this box, so it comes off ${sharedWith === 1 ? 'both' : 'all of them'}. Shipping refunded for sharing this box stays refunded.` : ''}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {VOID_REASONS.map((r) => <button key={r.id} type="button" onClick={() => setVoidWhy({ kind: voidWhy.kind === r.id ? '' : r.id, note: voidWhy.note })} className="h-10 rounded-full px-3.5 text-[14px] font-semibold" style={pill(voidWhy.kind === r.id)}>{r.title}</button>)}
                </div>
                {voidWhy.kind === 'other' && <input aria-label="Why it’s being voided" value={voidWhy.note} maxLength={200} onChange={(e) => setVoidWhy({ ...voidWhy, note: e.target.value })} placeholder="Why, for the record" className="mt-2 h-11 w-full rounded-2xl border px-4 text-[16px]" style={{ borderColor: C.line, color: C.ink, background: C.paper }} />}
                <div className="mt-3 flex gap-2"><Btn kind="danger" className="flex-1" disabled={voiding === 'busy'} onClick={() => void voidLabel()}>{voiding === 'busy' ? 'Voiding…' : 'Void it'}</Btn><Btn kind="soft" className="flex-1" disabled={voiding === 'busy'} onClick={() => setVoiding(null)}>Keep it</Btn></div>
              </div>
            ) : <Btn kind={voidOpen ? 'soft' : 'plain'} style={voidOpen ? undefined : muted} onClick={() => { setVoidWhy({ kind: '', note: '' }); setVoiding('ask'); }}>{voidOpen ? 'Void it again' : 'Void the label'}</Btn>)}
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
          <p className="m-0 text-[14px]" style={muted}>{who} gets an email with this tracking number.</p>
          <Btn kind="primary" className="text-[17px]" disabled={loading || !mNumber.trim() || !!asked} onClick={() => void markShipped({ carrier: mCarrier.trim(), number: mNumber.trim(), extraNumbers: mExtra.map((x) => x.trim()).filter(Boolean) })}>Mark as shipped</Btn>
          {(rs?.shippoConnected || rs?.shippoApiKey) && <Btn kind="plain" onClick={() => setManual(false)} style={muted}>Buy a label here instead</Btn>}
        </div>
      ) : (
        <div className="mt-2">
          {editor({})}
          {rateList}
          <p className="m-0 mt-3 text-[14px]" style={muted}>{cover ? `${cover.insuranceCents > 0 ? `Insured with Shippo for ${money(cover.insuranceCents)}, about ${money(Math.round(cover.insuranceCents * SHIPPO_INSURANCE_RATE))} of the price.` : `Not insured: ${chosen?.provider || 'the carrier'}’s included cover applies (up to $100 with most services).`}${cover.signature !== 'NONE' ? ' Someone signs for it.' : ''} ` : 'Insurance and signature follow your shipping rules. '}{who} gets tracking when the carrier first scans the box.</p>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={loading || !chosen || !!asked} onClick={() => void buy()}>{chosen ? (boxes.length > 1 ? `Buy ${boxes.length} labels for ${money(chosen.amountCents)} and print` : `Buy label for ${money(chosen.amountCents)} and print`) : 'Choose a rate'}</Btn>
          <Btn kind="plain" className="mt-1 w-full" style={muted} onClick={() => setManual(true)}>I already have tracking</Btn>
        </div>)}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
    </Sheet>);
}
