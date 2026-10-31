'use client';
// src/components/orders/workspace/OrderWorkspace.tsx — ONE ORDER, EVERY JOB ON IT, IN ONE PLACE. Pack it (scan or tap
// items in, the boxes, a photo of each box), ship it (labels box by box) or hand it over, talk to the customer and
// change their details when allowed, and see every document and everything that happened, without leaving the order.
//   phone  — the order fills the screen: Pack, Ship (or Pickup), Customer, Record, with the next step at the bottom
//   two    — beside the list on a smaller computer screen, the same four parts
//   three  — on a wide screen, the customer and the conversation sit beside the order all the time
// What needs someone (a hold, a refund, an address change, label trouble) is at the top with its fix on it.
import * as React from 'react';
import { collection, limit, onSnapshot, orderBy, query, where, type Firestore } from 'firebase/firestore';
import { cancelIt, releaseHeld, startPacking, takeOverPacking } from '@/lib/orders-flow';
import { splitReadyFromWaiting, type Actor } from '@/lib/fulfil-client';
import { dueLine, firstName, methodLabel, money, orderNum } from '@/lib/orders-view';
import { formatTime } from '@/lib/tenant-time';
import { openRequest } from '@/lib/address-flow';
import { isFollowUp } from '@/lib/order-family';
import type { FulfilmentPermissions } from '@/lib/fulfilment-access';
import { setHold } from '../bulk';
import { MissingSheet } from '../MissingSheet';
import { HandoverSheet } from '../HandoverSheet';
import { RefundPartSheet } from '../RefundPartSheet';
import { StartReturnSheet, hasReturnable } from '../StartReturnSheet';
import { ReturnSheet } from '../ReturnSheet';
import { NoteSheet, TagsSheet } from '../TagsSheet';
import { OrderFacts } from './OrderFacts';
import { useLabelRecords } from '../LabelHistory';
import { BottomBar, Btn, C, IconBtn, Sheet, feel, muted, Ic } from '../ui';
import { PackPane, type PackMode } from './PackPane';
import { PickupPane, ShipPane } from './ShipPane';
import { DeliveryPane, deliveryWhen } from './DeliveryPane';
import { CustomerPane } from './CustomerPane';
import { Documents, RecordPane } from './RecordPane';
import { Attention } from './Attention';
import { BoxSizesSheet } from './BoxSizes';

/** The service they paid for, with its carrier when the order keeps it apart ("USPS Ground Advantage"). */
const paidService = (o: any) => {
  const svc = String(o?.shippingService || '').trim(); const carrier = String(o?.shippingCarrier || '').trim();
  return carrier && !svc.toLowerCase().startsWith(carrier.toLowerCase()) ? `${carrier} ${svc}` : svc;
};

export type Layout = 'phone' | 'two' | 'three';
export type WorkTab = 'pack' | 'ship' | 'customer' | 'record';

const DONE = ['shipped', 'completed', 'cancelled'];
/** "9:02 AM" today, "Oct 17, 9:02 AM" before. */
function paidWhen(iso: string, tz: string): string {
  const t = Date.parse(String(iso || '')); if (!Number.isFinite(t)) return '';
  const day = (d: number) => new Date(d).toLocaleDateString('en-US', { timeZone: tz || undefined });
  return day(t) === day(Date.now()) ? formatTime(iso, tz) : `${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz || undefined })}, ${formatTime(iso, tz)}`;
}

/** The tab an order opens on: the next job on it. */
export function defaultTab(o: any): WorkTab {
  const s = String(o?.stage || '');
  if (DONE.includes(s)) return 'record';
  if (s === 'paid' || s === 'picking') return 'pack';
  if (o?.method === 'digital') return 'record';
  return 'ship';
}

/** What's live about one order besides the order itself: its conversation, its returns, and (when asked) its record. */
function useFeeds(fs: Firestore, tenantId: string, orderId: string, wantEvents: boolean) {
  const [inbox, setInbox] = React.useState<any[]>([]);
  const [tickets, setTickets] = React.useState<any[]>([]);
  const [returns, setReturns] = React.useState<any[]>([]);
  const [events, setEvents] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    setInbox([]); setTickets([]); setReturns([]);
    if (!fs || !tenantId || !orderId) return;
    const rows = (s: any) => s.docs.map((d: any) => ({ ...(d.data() as any), id: d.id }));
    const u1 = onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders/${orderId}/inbox`), orderBy('at', 'desc'), limit(40)), (s) => setInbox(rows(s)), () => setInbox([]));
    const u2 = onSnapshot(query(collection(fs, `tenants/${tenantId}/retailSupport`), where('orderId', '==', orderId), limit(20)), (s) => setTickets(rows(s)), () => setTickets([]));
    const u3 = onSnapshot(query(collection(fs, `tenants/${tenantId}/retailReturns`), where('orderId', '==', orderId), limit(10)), (s) => setReturns(rows(s)), () => setReturns([]));
    return () => { u1(); u2(); u3(); };
  }, [fs, tenantId, orderId]);
  React.useEffect(() => {
    setEvents(null);
    if (!fs || !tenantId || !orderId || !wantEvents) return;
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders/${orderId}/events`), orderBy('at', 'desc'), limit(150)), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setEvents([]));
  }, [fs, tenantId, orderId, wantEvents]);
  return { inbox, tickets, returns, events };
}

export function OrderWorkspace({ fs, tenantId, order, all, actor, rs, photoFor, shelfFor, batch, inventory, perms, canRefund, isManager, canEditContact, shopZone, layout, requestTab, startMessage, onClose, onToast, onDone, onOpenOrder }: {
  fs: Firestore; tenantId: string; order: any; all: any[]; actor: Actor; rs: any; photoFor: Map<string, string>; shelfFor: Map<string, string>; batch: any | null; inventory: any[];
  perms: FulfilmentPermissions; canRefund: boolean; isManager: boolean; canEditContact: boolean; shopZone: string; layout: Layout;
  /** Open on this tab (the list's "Ship today", a label to buy, a message to answer); changes with each ask. */
  requestTab?: { tab: WorkTab; n: number } | null;
  /** The message to the customer, already started (a carrier problem). */
  startMessage?: string | null;
  onClose: () => void; onToast: (m: string) => void;
  /** Packing finished: the list can move on to the next order. */
  onDone?: (message: string) => void;
  /** Open another order (a backorder, the order it came from). */
  onOpenOrder?: (orderId: string) => void;
}) {
  const phone = layout === 'phone';
  const [tab, setTab] = React.useState<WorkTab>(() => defaultTab(order));
  const [missing, setMissing] = React.useState<any | null>(null);
  const [handing, setHanding] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [boxSizes, setBoxSizes] = React.useState(false);
  const [partRefund, setPartRefund] = React.useState(false);
  const [startReturn, setStartReturn] = React.useState(false);
  const [checkRet, setCheckRet] = React.useState<any | null>(null);
  const [tagsOpen, setTagsOpen] = React.useState(false); const [noteOpen, setNoteOpen] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false); const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const [msgStart, setMsgStart] = React.useState<string | null>(startMessage ?? null);
  // A new order, or the order moving on (packed, shipped, picked up): the tab follows its next job.
  const stageKey = `${order.id}|${order.stage}`;
  React.useEffect(() => { setTab(defaultTab(order)); setErr(''); setMore(false); setConfirmCancel(false); setReason(''); }, [stageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setMsgStart(startMessage ?? null); if (startMessage && layout !== 'three') setTab('customer'); }, [order.id, startMessage]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (requestTab) setTab(requestTab.tab === 'customer' && layout === 'three' ? defaultTab(order) : requestTab.tab); }, [requestTab?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // On a wide screen the customer is always beside the order, so there's no Customer tab.
  React.useEffect(() => { if (layout === 'three' && tab === 'customer') setTab(defaultTab(order)); }, [layout, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const feeds = useFeeds(fs, tenantId, order.id, tab === 'record');
  const recs = useLabelRecords(fs, tenantId, order.method === 'ship' ? order.id : '');
  const who = firstName(order.customerName);
  const ship = order.method === 'ship';
  const delivery = order.method === 'delivery';
  const dStatus = String(order.delivery?.status || 'waiting');
  const stage = String(order.stage || '');
  const terminal = DONE.includes(stage);
  const due = dueLine(order, rs, Date.now(), shopZone);

  // PACKING: being packed by you, not started, or done. Someone else's order in packing is shown, not counted into: its
  // scanner stays off (so a scan at this screen can't land on a colleague's order) until you take it over.
  const theirs = stage === 'picking' && !!order.claimedBy && order.claimedBy !== actor.id;
  const packMode: PackMode = stage === 'picking' ? (theirs ? 'review' : 'active') : stage === 'paid' ? 'preview' : 'review';
  const takeOver = async () => {
    if (!perms.canPick) { onToast('Packing isn’t part of your role. Ask a manager to add it.'); return; }
    setBusy('pack'); setErr('');
    const r = await takeOverPacking(fs, tenantId, order, actor);
    setBusy(''); feel(r.ok);
    if (!r.ok) { setErr(r.message); return; }
    setTab('pack'); onToast(`You’re packing #${String(order.orderNumber ?? '').padStart(4, '0')} now.`);
  };
  const beginPack = async () => {
    if (!perms.canPick) { onToast('Packing isn’t part of your role. Ask a manager to add it.'); return; }
    setBusy('pack'); setErr('');
    const r = await startPacking(fs, tenantId, order, actor);
    setBusy(''); feel(r.ok);
    if (!r.ok) { setErr(r.message); return; }
    setTab('pack');
  };
  const held = order.holdUntilRestock === true && stage === 'paid';
  const release = async () => { setBusy('release'); const r = await releaseHeld(fs, tenantId, order, actor, false); setBusy(''); feel(r.ok); if (r.ok) onToast(r.message); else setErr(r.message); };

  // Gone out, and something on it can still come back: a return is started on the order itself (mockup 10D), by anyone
  // whose role checks returns in (not a picker; api/retail/fulfil 'returns' rules the same). One on its way back is
  // checked in from here too.
  const doesReturns = perms.canPack || perms.canManage || canRefund || isManager;
  const returnable = doesReturns && hasReturnable(order, feeds.returns);
  const openRet = doesReturns ? (feeds.returns || []).find((r: any) => ['open', 'received'].includes(String(r.status))) || null : null;
  // THE NEXT STEP, at the bottom: whatever this order needs next, unless the tab in front has its own.
  const main: { label: string; run: () => void } | null =
    openRet ? { label: 'Check in the return', run: () => setCheckRet(openRet) }
    : returnable ? { label: 'Start a return', run: () => setStartReturn(true) }
    : order.holdForReview || (ship && openRequest(order)) || terminal ? null
    : held ? { label: 'Release it to packing', run: () => void release() }
    : stage === 'paid' ? { label: 'Start packing', run: () => void beginPack() }
    : stage === 'picking' ? (theirs ? { label: `Take over from ${firstName(order.claimedByName) || 'them'}`, run: () => void takeOver() } : tab === 'pack' ? null : { label: 'Continue packing', run: () => setTab('pack') })
    : stage === 'packed' && ship ? (tab === 'ship' ? null : { label: order.labelUrl ? 'Mark as shipped' : 'Ship it', run: () => setTab('ship') })
    // A delivery: its steps (out, delivered, brought back) are on its Delivery tab.
    : delivery && (stage === 'ready' || (stage === 'packed' && dStatus !== 'out')) ? (tab === 'ship' ? null : { label: dStatus === 'out' ? 'Delivered?' : 'Out for delivery', run: () => setTab('ship') })
    : stage === 'packed' ? { label: 'Continue packing', run: () => setTab('pack') }
    : ['ready', 'arrived'].includes(stage) ? (tab === 'ship' ? null : { label: `Hand over to ${who}`, run: () => setHanding(true) })
    : null;

  // Where it is: the steps before `now` are done, `now` is the one under way.
  const steps = ship ? ['Paid', 'Packed', 'Labeled', 'Shipped', 'Delivered'] : delivery ? ['Paid', 'Packed', 'Ready', 'Out', 'Delivered'] : ['Paid', 'Packed', 'Ready', 'Picked up'];
  const now = ship
    ? ({ paid: 1, picking: 1, packed: order.labelUrl || order.shippoTransactionId ? 3 : 2, shipped: 4, completed: 5 } as Record<string, number>)[stage] ?? 1
    : delivery
      ? ({ paid: 1, picking: 1, packed: 2, ready: dStatus === 'out' ? 4 : 3, completed: 5 } as Record<string, number>)[stage] ?? 1
      : ({ paid: 1, picking: 1, packed: 2, ready: 3, arrived: 3, completed: 4, } as Record<string, number>)[stage] ?? 1;

  // MORE: the rarer jobs, kept off the screen until they're needed.
  const follow = isFollowUp(order);
  const canSplit = ['paid', 'picking'].includes(stage) && !order.parentOrderId
    && (order.lines || []).some((l: any) => l.preorder === true && !['refunded', 'cancelled'].includes(String(l.status)))
    && (order.lines || []).some((l: any) => l.preorder !== true);
  const canCancel = !terminal && (perms.canManage || canRefund || isManager);
  // Refund part of it (some items, the shipping, an amount): someone allowed to send refunds, once it's paid.
  const canRefundPart = canRefund && !!order.qrToken && !['placed', 'cancelled'].includes(stage) && !order.isTest;
  const doCancel = async () => { setBusy('cancel'); const r = await cancelIt(fs, tenantId, order, actor, reason.trim() || 'Cancelled by the shop'); setBusy(''); if (r.ok) { setConfirmCancel(false); onToast(r.message); } else setErr(r.message); };
  const split = async () => { setBusy('split'); setMore(false); const r = await splitReadyFromWaiting(fs, tenantId, order.id, actor); setBusy(''); feel(r.ok); if (r.ok) onToast(r.message); else setErr(r.message); };
  const hold = async () => { setBusy('hold'); setMore(false); onToast(await setHold(fs, tenantId, [order], actor, true)); setBusy(''); };
  const slip = () => window.open(`/print/packing-slip/${tenantId}/${order.id}?t=${encodeURIComponent(order.qrToken || '')}`, '_blank');
  const message = (text: string) => { setMsgStart(text); if (layout !== 'three') setTab('customer'); };

  const tabs: [WorkTab, string][] = [['pack', 'Pack'], [order.method === 'digital' ? 'record' : 'ship', ship ? 'Ship' : delivery ? 'Delivery' : 'Pickup'], ...(layout === 'three' ? [] : [['customer', 'Customer'] as [WorkTab, string]]), ['record', 'Record']];
  const uniqTabs = tabs.filter((t, i) => tabs.findIndex((x) => x[0] === t[0]) === i);
  const customer = (aside: boolean) => (
    <CustomerPane fs={fs} tenantId={tenantId} order={order} canEdit={canEditContact} tickets={feeds.tickets} inbox={feeds.inbox} startMessage={msgStart} aside={aside} onToast={onToast}
      documents={aside && tab !== 'record' ? <Documents tenantId={tenantId} order={order} recs={recs} returns={feeds.returns} list onToast={onToast} /> : undefined} />);

  const body = (
    <div className={phone ? 'mx-auto w-full max-w-xl px-4 pb-44 pt-3' : 'px-6 pb-8 pt-5'}>
      <div className="flex items-center justify-between gap-2">
        {phone ? <IconBtn label="Back to orders" onClick={onClose}>{Ic.back}</IconBtn> : null}
        <span className="min-w-0 flex-1 truncate text-[14px]" style={muted}>{[orderNum(order), order.paidAt ? `paid ${paidWhen(order.paidAt, shopZone)}` : '', order.totalCents ? money(order.totalCents) : ''].filter(Boolean).join(' · ')}</span>
        <div className="flex shrink-0 gap-2">
          {!phone && order.qrToken && order.method !== 'digital' && <Btn kind="soft" className="h-10 px-4 text-[14px]" onClick={slip}>Print slip</Btn>}
          <Btn kind="soft" className="h-10 px-4 text-[14px]" onClick={() => setMore(true)} aria-label="More for this order">More</Btn>
        </div>
      </div>
      <p className="m-0 mt-2.5 text-[28px] font-light leading-tight tracking-[-0.02em] lg:text-[30px]">{order.customerName || 'Customer'}</p>
      <p className="m-0 mt-0.5 text-[15px]" style={muted}>
        {ship && order.shippingAddress ? `Ships to ${order.shippingAddress.city}, ${order.shippingAddress.state}` : delivery && order.shippingAddress ? `Delivers to ${order.shippingAddress.city}${deliveryWhen(order, shopZone) ? ` · ${deliveryWhen(order, shopZone)}` : ''}` : methodLabel(order.method, rs)}
        {order.shippingService && ship ? ` · ${paidService(order)}` : ''} · <span style={due.late && !terminal ? { color: C.warn, fontWeight: 600 } : undefined}>{stage === 'cancelled' ? 'Cancelled' : due.text}</span>
        {order.claimedByName && stage === 'picking' ? ` · ${order.claimedBy === actor.id ? 'you’re packing' : `${firstName(order.claimedByName)} is packing`}` : ''}
      </p>
      <OrderFacts fs={fs} tenantId={tenantId} order={order} all={all} rs={rs} onOpen={(id) => (onOpenOrder ? onOpenOrder(id) : window.location.assign(`/retail-orders?order=${encodeURIComponent(id)}`))} />
      {stage !== 'cancelled' && (
        <div className="mt-4 flex gap-1.5" aria-label="Where this order is">
          {steps.map((s, i) => (
            <div key={s} className="flex-1 text-[12px] font-semibold" style={{ color: i === now ? C.ink : C.muted }}><div className="mb-1.5 h-1 rounded-full" style={{ background: i < now ? C.ink : i === now ? C.mint : C.line }} />{s}</div>))}
        </div>)}

      <div className="mt-4"><Attention fs={fs} tenantId={tenantId} order={order} actor={actor} rs={rs} shopZone={shopZone} canRefund={canRefund} isManager={isManager} recs={recs} onToast={onToast} onShip={() => setTab('ship')} onMessage={message} /></div>

      <div role="tablist" aria-label="This order" className="mt-4 flex rounded-full p-[3px]" style={{ background: C.soft, maxWidth: phone ? undefined : 420 }}>
        {uniqTabs.map(([id, label]) => {
          const on = tab === id;
          return <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)} className="h-9 flex-1 rounded-full px-3 text-[14px] font-semibold transition-colors duration-200" style={on ? { background: C.paper, color: C.ink, boxShadow: '0 1px 3px rgba(0,0,0,.08)' } : { color: C.muted }}>{label}</button>;
        })}
      </div>

      <div className="mt-5" role="tabpanel" aria-label={uniqTabs.find((t) => t[0] === tab)?.[1] || ''}>
        {tab === 'pack' && <PackPane fs={fs} tenantId={tenantId} order={order} all={all} actor={actor} rs={rs} photoFor={photoFor} shelfFor={shelfFor} batch={batch} mode={packMode} wide={!phone}
          canManage={isManager} onMissing={(l) => setMissing(l)} onFinished={(m) => { onToast(m); onDone?.(m); }} onPutDown={() => { onToast('Put back in the queue.'); if (phone) onClose(); }} onBoxSizes={() => setBoxSizes(true)} onToast={onToast} inventory={inventory} />}
        {tab === 'ship' && (delivery ? <DeliveryPane tenantId={tenantId} order={order} shopZone={shopZone} onToast={onToast} /> : ship
          ? <ShipPane fs={fs} tenantId={tenantId} order={order} inventory={inventory} rs={rs} actor={actor} recs={recs} canShip={perms.canShip} addressBeside={layout === 'three'} onToast={onToast} />
          : <PickupPane fs={fs} tenantId={tenantId} order={order} actor={actor} shopZone={shopZone} rs={rs} onHandover={() => setHanding(true)} onToast={onToast} />)}
        {tab === 'customer' && customer(false)}
        {tab === 'record' && <RecordPane tenantId={tenantId} order={order} events={feeds.events} inbox={feeds.inbox} tickets={feeds.tickets} recs={recs} returns={feeds.returns} onToast={onToast} />}
      </div>
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      {main && !phone && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t px-6 pb-4 pt-3" style={{ borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 92%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}>
          <Btn kind="primary" className="w-full text-[17px]" disabled={!!busy} onClick={main.run}>{busy === 'pack' ? 'One moment…' : main.label}</Btn>
        </div>)}
    </div>);

  return (
    <>
      {phone ? (
        <div className="cf-anim-push fixed inset-0 z-30 overflow-y-auto" style={{ background: C.paper, color: C.ink }}>
          {body}
          {main && <BottomBar><Btn kind="primary" className="mx-auto flex w-full max-w-xl text-[17px]" disabled={!!busy} onClick={main.run}>{busy === 'pack' ? 'One moment…' : main.label}</Btn></BottomBar>}
        </div>
      ) : layout === 'three' ? (
        <div className="flex h-full min-w-0">
          <div className="min-w-0 flex-1 overflow-y-auto">{body}</div>
          <aside aria-label="Customer" className="w-[380px] shrink-0 overflow-y-auto border-l px-6 pb-8 pt-5 2xl:w-[420px]" style={{ borderColor: C.line }}>{customer(true)}</aside>
        </div>
      ) : <div className="h-full overflow-y-auto">{body}</div>}

      {missing && <MissingSheet fs={fs} tenantId={tenantId} order={order} line={missing} shelf={shelfFor.get(missing.productId)} inventory={inventory} actor={actor} autoBelow={Math.max(0, Number(rs.policies?.refundAutoBelowCents) || 0)} onClose={() => setMissing(null)} onDone={(m) => { setMissing(null); onToast(m); }} />}
      {handing && <HandoverSheet fs={fs} tenantId={tenantId} order={order} actor={actor} onClose={() => setHanding(false)} onDone={(m) => { setHanding(false); onToast(m); }} />}
      {boxSizes && <BoxSizesSheet tenantId={tenantId} rs={rs} onClose={() => setBoxSizes(false)} onToast={onToast} />}
      {tagsOpen && <TagsSheet fs={fs} tenantId={tenantId} order={order} all={all} rs={rs} actor={actor} onClose={() => setTagsOpen(false)} onDone={(m) => { setTagsOpen(false); onToast(m); }} />}
      {noteOpen && <NoteSheet fs={fs} tenantId={tenantId} order={order} actor={actor} onClose={() => setNoteOpen(false)} onDone={(m) => { setNoteOpen(false); onToast(m); }} />}
      {checkRet && <ReturnSheet fs={fs} tenantId={tenantId} ret={checkRet} initialOrder={order} actor={actor} rs={rs} canRefund={canRefund} onClose={() => setCheckRet(null)} onDone={(m) => { setCheckRet(null); onToast(m); }} />}
      {startReturn && <StartReturnSheet fs={fs} tenantId={tenantId} order={order} returns={feeds.returns} actor={actor} rs={rs} canRefund={canRefund} onClose={() => setStartReturn(false)} onDone={(m) => { setStartReturn(false); onToast(m); }} />}
      {partRefund && <RefundPartSheet tenantId={tenantId} order={order} onClose={() => setPartRefund(false)} onDone={(m) => { setPartRefund(false); onToast(m); }} />}
      {more && (
        <Sheet title={`${orderNum(order)} · ${who}`} sub="More for this order" onClose={() => setMore(false)} closeLabel="Done">
          <div className="mt-2 flex flex-col gap-2">
            {order.qrToken && order.method !== 'digital' && <Btn kind="soft" className="w-full" onClick={() => { setMore(false); slip(); }}>Print the packing slip</Btn>}
            <Btn kind="soft" className="w-full" onClick={() => { setMore(false); window.open(`/shop/${tenantId}/order/${order.id}`, '_blank'); }}>Open their order page</Btn>
            {canSplit && <Btn kind="soft" className="w-full" disabled={!!busy} onClick={() => void split()}>Ship what’s ready now, the rest when it comes in</Btn>}
            {isManager && !order.holdForReview && ['paid', 'picking'].includes(stage) && <Btn kind="soft" className="w-full" disabled={!!busy} onClick={() => void hold()}>Hold it for review</Btn>}
            {isManager && <Btn kind="soft" className="w-full" onClick={() => { setMore(false); setBoxSizes(true); }}>Box sizes</Btn>}
            <Btn kind="soft" className="w-full" onClick={() => { setMore(false); setTagsOpen(true); }}>Tags{Array.isArray(order.tags) && order.tags.length ? ` · ${order.tags.length}` : ''}</Btn>
            <Btn kind="soft" className="w-full" onClick={() => { setMore(false); setNoteOpen(true); }}>{order.staffNote?.text ? 'Change the note' : 'Add a note for the team'}</Btn>
            {openRet && <Btn kind="soft" className="w-full" onClick={() => { setMore(false); setCheckRet(openRet); }}>Check in the return</Btn>}
            {returnable && <Btn kind="soft" className="w-full" onClick={() => { setMore(false); setStartReturn(true); }}>Start a return</Btn>}
            {canRefundPart && <Btn kind="soft" className="w-full" onClick={() => { setMore(false); setPartRefund(true); }}>Refund part of this order</Btn>}
            {canCancel && <Btn kind="danger" className="w-full" onClick={() => { setMore(false); setConfirmCancel(true); }}>Cancel the order</Btn>}
          </div>
        </Sheet>)}
      {confirmCancel && (
        <Sheet title={`Cancel ${who}’s order?`} sub={follow
          ? order.replacementFor === 'lost_in_transit'
            ? 'Stock goes back on the shelf. If the first parcel never arrived, what they paid for these items goes back to the card they used on the original order.'
            : order.holdUntilRestock
              ? 'Nothing was set aside for it yet. What they paid for these items goes back to the card they used on the original order.'
              : 'Stock goes back on the shelf, and what they paid for these items goes back to the card they used on the original order.'
          : `${stage === 'paid' ? 'Their card is refunded and stock goes back on the shelf.' : 'Put the items back on the shelf. Their card is refunded.'}${(order.lines || []).some((l: any) => l.status === 'backordered') || order.splitChildOrderId ? ' Anything still to follow is cancelled with it.' : ''}`} onClose={() => setConfirmCancel(false)} closeLabel="Keep it">
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Reason (they see this)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: we can’t get it in time" className="mt-1 h-12 w-full rounded-2xl border px-4 text-[17px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
          <Btn kind="danger" className="mt-4 w-full text-[17px]" disabled={!!busy} onClick={() => void doCancel()}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel the order'}</Btn>
          {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
        </Sheet>)}
    </>);
}
