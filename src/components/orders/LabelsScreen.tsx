'use client';
// src/components/orders/LabelsScreen.tsx — LABELS. Everything about shipping labels that needs a person, in one list:
// what to do (labels to buy, a box waiting for its new label, a void that didn't finish, labels nobody has used) and
// the money (refunds on the way, refunds Shippo turned down or never confirmed, carrier adjustments). Each row opens
// the orders behind it; each order opens where it's sorted out. Live from Firestore (lib/label-records, lib/label-boxes).
import * as React from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { ACTIVE_STAGES, firstName, money, orderNum } from '@/lib/orders-view';
import { labelDoubt } from '@/lib/label-doubt';
import { tail, voidedSlots } from '@/lib/label-boxes';
import { C, Empty, Group, Ic, LargeTitle, Sheet, muted } from './ui';
import { PhoneShopBar, useWide } from './shell';
import { useLabelFlagOrders } from './use-label-flags';

type Item = { key: string; orderId: string; title: string; detail: string; trail?: string };
type Section = { id: string; title: string; detail: string; count: number; items: Item[]; href?: string };
const day = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const num = (r: any) => (typeof r?.orderNumber === 'number' ? `#${String(r.orderNumber).padStart(4, '0')}` : 'An order');

function useRecords(fs: Firestore, tenantId: string, field: string): any[] {
  const [rows, setRows] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!fs || !tenantId) { setRows([]); return; }
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/shippingLabels`), where(field, '==', true), limit(100)), (s) => setRows(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setRows([]));
  }, [fs, tenantId, field]);
  return rows;
}

export function LabelsScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const wide = useWide();
  const [active, setActive] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE_STAGES)), (s) => { setActive(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); setLoading(false); }, () => setLoading(false));
  }, [fs, tenantId]);
  const flagged = useLabelFlagOrders(fs, tenantId);
  const waiting = useRecords(fs, tenantId, 'refundOpen');
  const denied = useRecords(fs, tenantId, 'deniedOpen');
  const unconfirmed = useRecords(fs, tenantId, 'unconfirmedOpen');
  const charged = useRecords(fs, tenantId, 'chargeOpen');
  const [open, setOpen] = React.useState<string | null>(null);

  const orders = React.useMemo(() => { const m = new Map<string, any>(); [...active, ...flagged].forEach((o) => m.set(o.id, o)); return [...m.values()]; }, [active, flagged]);
  const toBuy = active.filter((o) => o.method === 'ship' && o.stage === 'packed' && !o.holdForReview && !o.trackingNumber && !o.labelUrl);
  const relabel = orders.filter((o) => labelDoubt(o) === 'relabel' && ['paid', 'picking', 'packed', 'shipped'].includes(String(o.stage)));
  const stuck = orders.filter((o) => { const d = labelDoubt(o); return (d === 'voiding' || d === 'partial' || d === 'unfinished') || (o.labelUnscannedOpen === true && o.labelUnscanned?.why === 'void_unfinished'); });
  const unused = orders.filter((o) => o.labelUnscannedOpen === true && o.shippoTransactionId && o.labelUnscanned?.why !== 'void_unfinished' && !stuck.includes(o));
  const pendingCents = (r: any) => Object.values(r.refunds || {}).reduce((a: number, e: any) => a + (e?.status === 'requested' ? Number(e.cents) || 0 : 0), 0);
  const waitingCents = waiting.reduce((a, r) => a + pendingCents(r), 0);
  const chargeCents = charged.reduce((a, r) => a + (Number(r.chargesCents) || 0), 0);

  const todo: Section[] = [
    { id: 'buy', title: 'Buy labels', detail: `${toBuy.length} packed order${toBuy.length === 1 ? '' : 's'} without one`, count: toBuy.length, items: [], href: '/retail-orders?ship=today' },
    { id: 'relabel', title: 'A box needs a new label', detail: relabel.length === 1 ? `${orderNum(relabel[0])}, box ${voidedSlots(relabel[0]).map((s) => s.slot + 1).join(' and ')}: its label was voided` : `${relabel.length} orders with a voided box label`, count: relabel.length,
      items: relabel.map((o) => ({ key: o.id, orderId: o.id, title: `${orderNum(o)} · ${o.customerName || 'Customer'}`, detail: voidedSlots(o).map((s) => `Box ${s.slot + 1} ${tail(s.tracking)}`).join(' · '), trail: 'Needs a label' })) },
    { id: 'stuck', title: 'A void that didn’t finish', detail: stuck.length === 1 ? `${orderNum(stuck[0])}: Shippo didn’t answer. It can’t ship until it’s sorted.` : `${stuck.length} orders. They can’t ship until they’re sorted.`, count: stuck.length,
      items: stuck.map((o) => ({ key: o.id, orderId: o.id, title: `${orderNum(o)} · ${o.customerName || 'Customer'}`, detail: 'Void it again, or keep the label if it’s fine in Shippo' })) },
    { id: 'unused', title: 'Labels nobody has used', detail: `${unused.length} label${unused.length === 1 ? '' : 's'} the carrier hasn’t scanned`, count: unused.length,
      items: unused.map((o) => ({ key: o.id, orderId: o.id, title: `${orderNum(o)} · ${o.customerName || 'Customer'}`, detail: o.stage === 'shipped' ? `Marked shipped ${day(o.completedAt)}, no scan since` : ['cancelled'].includes(String(o.stage)) ? 'The order was cancelled; void it for the postage' : `Bought ${day(o.labelUnscanned?.boughtAt || o.shipmentProtection?.decidedAt)}` })) },
  ].filter((s) => s.count > 0);
  const moneyRows: Section[] = [
    { id: 'waiting', title: 'Refunds on the way', detail: `${waiting.length} label${waiting.length === 1 ? '' : 's'} · ${money(waitingCents)} · Shippo usually confirms within 2 weeks`, count: waiting.length,
      items: waiting.map((r) => ({ key: r.id, orderId: r.orderId, title: `${num(r)} · ${r.customerName || 'Customer'}`, detail: `Requested ${day(Object.values(r.refunds || {}).map((e: any) => e?.requestedAt).filter(Boolean).sort()[0])}`, trail: money(pendingCents(r)) })) },
    { id: 'denied', title: 'Refund turned down', detail: denied.length === 1 ? `${num(denied[0])}: the carrier scanned it` : `${denied.length} labels the carrier scanned`, count: denied.length,
      items: denied.map((r) => ({ key: r.id, orderId: r.orderId, title: `${num(r)} · ${r.customerName || 'Customer'}`, detail: `Turned down ${day(r.denied?.at)}${r.denied?.tracking ? ` · ${tail(r.denied.tracking)}` : ''}`, trail: money(Number(r.denied?.cents) || 0) })) },
    { id: 'unconfirmed', title: 'Refunds not confirmed', detail: `${unconfirmed.length} label${unconfirmed.length === 1 ? '' : 's'}: check ${unconfirmed.length === 1 ? 'it' : 'them'} in Shippo`, count: unconfirmed.length,
      items: unconfirmed.map((r) => ({ key: r.id, orderId: r.orderId, title: `${num(r)} · ${r.customerName || 'Customer'}`, detail: 'Shippo hasn’t confirmed the refund' })) },
    { id: 'charges', title: 'Carrier adjustments', detail: `${charged.length} order${charged.length === 1 ? '' : 's'} · ${chargeCents >= 0 ? '' : '−'}${money(Math.abs(chargeCents))} · recorded in Money`, count: charged.length,
      items: charged.map((r) => ({ key: r.id, orderId: r.orderId, title: `${num(r)} · ${r.customerName || 'Customer'}`, detail: `${r.carrier || 'Carrier'} · ${Object.keys(r.charges || {}).length} adjustment${Object.keys(r.charges || {}).length === 1 ? '' : 's'}`, trail: `${Number(r.chargesCents) > 0 ? '+' : '−'}${money(Math.abs(Number(r.chargesCents) || 0))}` })) },
  ].filter((s) => s.count > 0);
  const sheet = [...todo, ...moneyRows].find((s) => s.id === open) || null;

  const row = (s: Section, last: boolean) => {
    const body = (
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={last ? undefined : { borderBottom: `1px solid ${C.line}` }}>
        <span className="min-w-0 flex-1"><span className="block text-[17px] tracking-[-0.01em]">{s.title}</span><span className="mt-0.5 block text-[13px] leading-snug" style={muted}>{s.detail}</span></span>
        <span className="flex shrink-0 items-center gap-1.5 text-[16px]" style={muted}>{s.count}{Ic.chev}</span>
      </span>);
    return s.href
      ? <Link key={s.id} href={s.href} className="cf-press flex min-h-[60px] items-center gap-3 pl-4">{body}</Link>
      : <button key={s.id} type="button" onClick={() => setOpen(s.id)} className="cf-press flex min-h-[60px] w-full items-center gap-3 pl-4 text-left">{body}</button>;
  };

  return (
    <div className="cf-settings min-h-[100dvh] pb-32" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/retail-orders" aria-label="Back to orders" className="cf-press grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: C.soft, color: C.ink }}>{Ic.back}</Link>
          <span className="text-[14px]" style={muted}>Orders</span>
          <span className="h-11 w-11" />
        </div>
        <div className="mt-3"><LargeTitle title="Labels" sub="Everything about labels that needs a person." /></div>
        {loading ? <p className="m-0 py-10 text-center text-[15px]" style={muted}>Loading…</p>
          : todo.length === 0 && moneyRows.length === 0 ? <Empty title="Nothing needs you" sub="Labels to buy or fix, and refunds waiting on Shippo, show here." />
          : (<>
            {todo.length > 0 && <Group title="To do">{todo.map((s, i) => row(s, i === todo.length - 1))}</Group>}
            {moneyRows.length > 0 && <Group title="Money" foot="Refunds go into Money once Shippo confirms them. Shippo’s invoices are read every morning for carrier adjustments.">{moneyRows.map((s, i) => row(s, i === moneyRows.length - 1))}</Group>}
          </>)}
      </div>
      {sheet && (
        <Sheet title={sheet.title} sub={sheet.detail} onClose={() => setOpen(null)} closeLabel="Done">
          <div className="mt-1">{sheet.items.map((it) => (
            <Link key={it.key} href={`/retail-orders?order=${encodeURIComponent(it.orderId)}`} className="cf-press flex min-h-[64px] w-full items-center gap-3 pl-1" style={{ color: C.ink }}>
              <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-b py-2.5 pr-1" style={{ borderColor: C.line }}>
                <span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-semibold tracking-[-0.01em]">{it.title}</span><span className="block truncate text-[14px]" style={muted}>{it.detail}</span></span>
                <span className="flex shrink-0 items-center gap-1.5 text-[14px]" style={muted}>{it.trail || ''}{Ic.chev}</span>
              </span>
            </Link>))}</div>
          {sheet.id === 'denied' && <p className="m-0 mt-3 text-[13px] leading-snug" style={muted}>A turned-down refund means the carrier scanned the label, so that box may have gone out. Open each order to check with {sheet.items.length === 1 ? firstName(denied[0]?.customerName) : 'the customer'}.</p>}
        </Sheet>)}
      {!wide && <PhoneShopBar problems={0} />}
    </div>);
}
