'use client';
// src/components/orders/workspace/OrderFacts.tsx — THE ORDER AT A GLANCE, under its name: where it is and how it stands
// with the money (lib/order-tags), its tags (the order's own and the shop's), and how it's tied to other orders: a
// backorder says which order it's for, whether it's waiting on stock and when that's expected; the order it came from
// lists what's still to come. The team's note on the order sits here too. Each linked order opens with a tap.
import * as React from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import { followUpKind, orderStatus, orderTags, paymentStatus, restockExpected, unitsOnBackorder, type Tone } from '@/lib/order-tags';
import { C, muted } from '../ui';

const tones: Record<string, React.CSSProperties> = {
  '': { background: C.soft, color: C.ink }, ok: { background: C.okSoft, color: C.ok }, warn: { background: C.warnSoft, color: C.warn }, bad: { background: C.badSoft, color: C.bad },
};
const Pill = ({ label, tone = '' }: { label: string; tone?: Tone }) => <span className="inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold" style={tones[tone || '']}>{label}</span>;
const num = (n: any) => `#${String(n ?? '').padStart(4, '0')}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function OrderFacts({ fs, tenantId, order, all, rs, onOpen }: { fs: Firestore; tenantId: string; order: any; all: any[]; rs: any; onOpen: (orderId: string) => void }) {
  const f = followUpKind(order);
  const childIds: string[] = Array.isArray(order.backorderOrderIds) ? order.backorderOrderIds : order.splitChildOrderId ? [order.splitChildOrderId] : [];
  const [linked, setLinked] = React.useState<Record<string, any>>({});
  const [expected, setExpected] = React.useState<{ at: string; from: string } | null | undefined>(undefined);
  // The linked orders: from the list when they're in it, read on their own when they aren't.
  const want = [...(f ? [f.parentId] : []), ...childIds].filter(Boolean).join(',');
  React.useEffect(() => {
    let live = true; const ids = want ? want.split(',') : [];
    const have: Record<string, any> = {};
    const missing = ids.filter((id) => { const o = all.find((x) => x.id === id); if (o) have[id] = o; return !o; });
    setLinked(have);
    if (missing.length) Promise.all(missing.map((id) => getDoc(doc(fs, `tenants/${tenantId}/retailOrders`, id)).then((s) => (s.exists() ? { ...(s.data() as any), id: s.id } : null)).catch(() => null)))
      .then((rows) => { if (live) setLinked((m) => ({ ...m, ...Object.fromEntries(rows.filter(Boolean).map((o: any) => [o.id, o])) })); });
    return () => { live = false; };
  }, [fs, tenantId, want]); // eslint-disable-line react-hooks/exhaustive-deps
  // When a backorder waiting on stock can expect it: an open supplier order with its items, or a pre-order date.
  const waiting = !!f?.waiting || (order.holdUntilRestock === true && order.stage === 'paid');
  React.useEffect(() => {
    if (!waiting) { setExpected(undefined); return; }
    let live = true;
    getDocs(query(collection(fs, `tenants/${tenantId}/orders`), where('status', 'in', ['Placed', 'Shipped', 'Partially Received']), limit(60)))
      .then((s) => { if (live) setExpected(restockExpected(order, s.docs.map((d) => d.data()))); })
      .catch(() => { if (live) setExpected(restockExpected(order, [])); });
    return () => { live = false; };
  }, [fs, tenantId, order.id, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = orderStatus(order); const pay = paymentStatus(order);
  const tags = orderTags(order, rs).filter((t) => !(f && t.id === f.kind));
  const parent = f ? linked[f.parentId] : null;
  const kids = childIds.map((id) => linked[id]).filter(Boolean);
  const bo = unitsOnBackorder(order);
  const link = (o: any, text: string) => <button key={o?.id || text} type="button" onClick={() => o?.id && onOpen(o.id)} className="text-[14px] font-semibold underline underline-offset-4">{text}</button>;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label="About this order">
        <Pill label={status.label} tone={status.tone} />
        <Pill label={pay.label} tone={pay.tone} />
        {f && <Pill label={f.label} tone={f.waiting ? 'warn' : ''} />}
        {tags.map((t) => <Pill key={t.id} label={t.label} tone={t.tone} />)}
      </div>
      {f && (
        <p className="m-0 text-[14px]" style={muted}>
          {f.kind === 'backorder' ? 'Made because items were short on ' : f.kind === 'later' ? 'The pre-order items from ' : 'A replacement for '}
          {parent ? link(parent, `order ${num(parent.orderNumber)}`) : `order ${num(order.orderNumber)}`}
          {f.waiting ? (expected === undefined ? '. Waiting on stock.' : expected ? `. Waiting on stock, expected ${day(expected.at)} (${expected.from}).` : '. Waiting on stock; nothing is on order yet.') : '.'}
          {' '}Paid for on the first order.
        </p>)}
      {!f && waiting && <p className="m-0 text-[14px]" style={muted}>{expected === undefined ? 'Waiting on stock.' : expected ? `Waiting on stock, expected ${day(expected.at)} (${expected.from}).` : 'Waiting on stock; nothing is on order yet.'}</p>}
      {(bo > 0 || kids.length > 0) && (
        <p className="m-0 text-[14px]" style={muted}>
          {bo > 0 ? `${bo} item${bo === 1 ? '' : 's'} on backorder` : 'Still to come'}
          {kids.length ? <>: {kids.map((k: any, i: number) => <React.Fragment key={k.id}>{i ? ', ' : ''}{link(k, `${k.hasPreorder ? 'sent later' : 'backorder'} (${orderStatus(k).label.toLowerCase()})`)}</React.Fragment>)}</> : '.'}
        </p>)}
      {order.staffNote?.text && (
        <div className="rounded-2xl px-4 py-2.5 text-[14.5px]" style={{ background: C.soft }}>
          <span className="font-semibold">Note</span> · {order.staffNote.text}
          <span className="block text-[12.5px]" style={muted}>{[order.staffNote.by, order.staffNote.at ? day(order.staffNote.at) : ''].filter(Boolean).join(' · ')}</span>
        </div>)}
    </div>);
}
