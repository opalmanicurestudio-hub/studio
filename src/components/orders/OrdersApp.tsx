'use client';
// src/components/orders/OrdersApp.tsx — THE ORDERS SCREEN. One list with three tabs (To pack, Ready, Done), search, and
// one line for the few things a person must decide. On a phone, the order opens full screen and the shop's four places
// sit in a tab bar; on a computer, the order opens beside the list. A one-person shop leads with the next order.
// Live from Firestore; the packing engine is lib/retail-fulfill, the screen's own rules are lib/orders-view.
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { collection, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { permissionsFor } from '@/lib/fulfilment-access';
import { notifyCurbside, sweepStaleClaims, type Actor } from '@/lib/retail-fulfill';
import { curbsideWaitMinutes } from '@/lib/retail-orders';
import { startPacking } from '@/lib/orders-flow';
import { ACTIVE_STAGES, dueLine, firstName, itemCount, matchesSearch, methodLabel, needsYou, packQueue, soloShop, tabOf, type OrdersTab } from '@/lib/orders-view';
import { Btn, C, Empty, IconBtn, Initials, LargeTitle, ListRow, Seg, Sheet, UndoBar, feel, muted, Ic } from './ui';
import { OrderPanel } from './OrderPanel';
import { PackMode } from './PackMode';
import { MissingSheet } from './MissingSheet';
import { ShipSheet } from './ShipSheet';
import { HandoverSheet } from './HandoverSheet';

const DONE_STAGES = ['shipped', 'handed_off', 'completed', 'cancelled'];

function useWide() {
  const [w, setW] = React.useState(false);
  React.useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const f = () => setW(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return w;
}

export function OrdersApp() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, can } = useTenant() as any; const { user } = useUser() as any;
  const { inventory, staff } = useInventory() as any;
  const perms = useFulfilmentPerms();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant as any)?.retailSettings || {};
  const actor: Actor = React.useMemo(() => ({ id: user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user]);
  const wide = useWide();

  const [orders, setOrders] = React.useState<any[]>([]);
  const [done, setDone] = React.useState<any[]>([]);
  const [batches, setBatches] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<OrdersTab>('pack');
  const [q, setQ] = React.useState(''); const [searching, setSearching] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [packId, setPackId] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState<any | null>(null);
  const [shipId, setShipId] = React.useState<string | null>(null);
  const [handId, setHandId] = React.useState<string | null>(null);
  const [needsOpen, setNeedsOpen] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const u1 = onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE_STAGES)), (s) => { setOrders(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); setLoading(false); }, () => setLoading(false));
    const u2 = onSnapshot(query(collection(fs, `tenants/${tenantId}/fulfillmentBatches`), where('active', '==', true)), (s) => setBatches(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setBatches([]));
    return () => { u1(); u2(); };
  }, [fs, tenantId]);
  React.useEffect(() => {
    if (!fs || !tenantId || tab !== 'done') return;
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', DONE_STAGES), limit(80)), (s) => {
      const t = (o: any) => Date.parse(String(o.completedAt || o.cancelledAt || o.paidAt || o.placedAt || '')) || 0;
      setDone(s.docs.map((d) => ({ ...(d.data() as any), id: d.id })).sort((a, b) => t(b) - t(a)));
    }, () => setDone([]));
  }, [fs, tenantId, tab]);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const run = () => { void sweepStaleClaims(fs, tenantId).catch(() => 0); };
    run(); const t = setInterval(run, 60000); return () => clearInterval(t);
  }, [fs, tenantId]);

  const photoFor = React.useMemo(() => { const m = new Map<string, string>(); (inventory || []).forEach((i: any) => { const u = (Array.isArray(i.imageUrls) && i.imageUrls.find((x: any) => typeof x === 'string' && x.trim())) || (typeof i.imageUrl === 'string' && i.imageUrl.trim() ? i.imageUrl : ''); if (u) m.set(i.id, String(u)); }); return m; }, [inventory]);
  const shelfFor = React.useMemo(() => { const m = new Map<string, string>(); (inventory || []).forEach((i: any) => { const s = String(i.storageLocation || i.shelf || i.binLocation || '').trim(); if (s) m.set(i.id, s); }); return m; }, [inventory]);

  const byId = React.useMemo(() => new Map([...orders, ...done].map((o) => [o.id, o])), [orders, done]);
  const solo = React.useMemo(() => soloShop(staff || [], (m: any) => permissionsFor(m)), [staff]);
  const queue = React.useMemo(() => packQueue(orders, rs, now), [orders, rs, now]);
  const needs = React.useMemo(() => needsYou(orders, now, Math.max(1, Number(rs.readyStaleHours) || 48)), [orders, now, rs.readyStaleHours]);
  const counts = React.useMemo(() => ({ pack: orders.filter((o) => tabOf(o) === 'pack').length, ready: orders.filter((o) => tabOf(o) === 'ready').length }), [orders]);
  const list = React.useMemo(() => {
    const src = tab === 'done' ? done : orders.filter((o) => tabOf(o) === tab);
    const f = src.filter((o) => matchesSearch(o, q));
    if (tab === 'pack') { const order = new Map(queue.map((o, i) => [o.id, i])); return f.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)); }
    if (tab === 'ready') { const r = (o: any) => (o.stage === 'arrived' ? 0 : o.curbside?.arrivedAt ? 1 : o.method === 'ship' ? 3 : 2); return f.sort((a, b) => r(a) - r(b)); }
    return f;
  }, [tab, orders, done, q, queue]);

  const arrivedKey = orders.filter((o) => o.stage === 'arrived').map((o) => o.id).join(',');
  const announced = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const fresh = orders.filter((o) => o.stage === 'arrived' && !announced.current.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => announced.current.add(o.id)); feel(true);
    setToast(`${firstName(fresh[0].customerName)} is outside${fresh[0].curbside?.spotOrVehicle ? ` in ${fresh[0].curbside.spotOrVehicle}` : ''}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedKey]);
  const escalated = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    for (const o of orders) {
      if (o.stage !== 'arrived' || escalated.current.has(o.id) || o.curbside?.bringingOutAt) continue;
      const m = curbsideWaitMinutes(o, new Date(now)); if (m === null || m < 5) continue;
      escalated.current.add(o.id); notifyCurbside(tenantId, o.id, 'staff_escalation');
    }
  }, [orders, now, tenantId]);

  const open = openId ? byId.get(openId) || null : null;
  const packing = packId ? byId.get(packId) || null : null;
  React.useEffect(() => { if (packId && packing && !['paid', 'picking', 'packed'].includes(packing.stage)) setPackId(null); }, [packId, packing]);
  React.useEffect(() => { if (wide && !openId && list.length && tab !== 'done') setOpenId(list[0].id); }, [wide, list, openId, tab]);

  const beginPack = async (o: any) => {
    if (!perms.canPick) { setToast('Packing isn’t part of your role. Ask a manager to add it.'); return; }
    const r = await startPacking(fs, tenantId, o, actor);
    if (!r.ok) { feel(false); setToast(r.message); return; }
    setPackId(o.id); setOpenId(o.id);
  };
  const packNext = () => { const o = queue[0]; if (!o) { setToast('Nothing is waiting to be packed.'); return; } void beginPack(o); };
  const canRefund = typeof can === 'function' ? can('checkout.refund') : false;

  const row = (o: any) => {
    const d = dueLine(o, rs, now);
    const extra = o.stage === 'picking' && o.claimedByName ? `${o.claimedBy === actor.id ? 'You’re' : `${firstName(o.claimedByName)} is`} packing` : o.holdForReview ? 'Held for review' : o.stage === 'cancelled' ? 'Cancelled' : '';
    return <ListRow key={o.id} onClick={() => setOpenId(o.id)} active={wide && openId === o.id} lead={<Initials name={o.customerName} />}
      title={o.customerName || 'Customer'} detail={[methodLabel(o.method), `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`, extra].filter(Boolean).join(' · ')}
      trail={<span className="shrink-0 text-[14px]" style={d.late ? { color: C.warn, fontWeight: 600 } : muted}>{tab === 'done' ? (o.stage === 'cancelled' ? 'Cancelled' : o.stage === 'shipped' ? 'Shipped' : 'Done') : d.text}</span>} />;
  };

  const nextUp = solo && tab === 'pack' && !q && queue[0] ? queue[0] : null;
  const listBody = loading ? <p className="px-4 py-10 text-center text-[15px]" style={muted}>Loading orders…</p>
    : list.length === 0 ? <Empty title={q ? 'No orders match' : tab === 'pack' ? 'Nothing to pack' : tab === 'ready' ? 'Nothing waiting' : 'No finished orders yet'} sub={q ? 'Try a name, an order number or an item.' : tab === 'pack' ? 'New orders appear here the moment they’re paid.' : tab === 'ready' ? 'Packed orders wait here for pickup or a label.' : 'Shipped, picked up and cancelled orders show here.'} />
    : (<>
      {nextUp && (
        <div className="mx-4 mt-3 rounded-3xl border-2 p-4" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>Next up</p>
          <div className="mt-1 flex items-start justify-between gap-2"><div><p className="m-0 text-[22px] font-light">{nextUp.customerName}</p><p className="m-0 mt-0.5 text-[14px]" style={muted}>{methodLabel(nextUp.method)} · {itemCount(nextUp)} item{itemCount(nextUp) === 1 ? "" : "s"}</p></div><span className="text-[14px] font-semibold" style={dueLine(nextUp, rs, now).late ? { color: C.warn } : muted}>{dueLine(nextUp, rs, now).text}</span></div>
          <Btn kind="primary" className="mt-3 w-full" onClick={() => void beginPack(nextUp)}>Start packing</Btn>
        </div>)}
      {tab === 'pack' && !nextUp && <p className="m-0 px-4 pb-1 pt-4 text-[13px] font-semibold" style={muted}>Due first</p>}
      {nextUp && list.length > 1 && <p className="m-0 px-4 pb-1 pt-4 text-[13px] font-semibold" style={muted}>After this</p>}
      {list.filter((o) => o.id !== nextUp?.id).map(row)}
    </>);

  const header = (
    <div className="px-4 pt-3">
      <div className="flex items-center justify-end gap-2 lg:hidden">
        <IconBtn label="Search orders" onClick={() => setSearching((s) => !s)}>{Ic.search}</IconBtn>
      </div>
      <LargeTitle title="Orders" sub={`${counts.pack} to pack · ${counts.ready} ready`} right={wide ? <div className="flex items-center gap-2">
        <label className="flex h-11 w-72 items-center gap-2 rounded-full border px-4" style={{ borderColor: C.line }}><span style={muted}>{Ic.search}</span><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" placeholder="Name, order number or item" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" /></label>
        {perms.canPick && <Btn kind="primary" onClick={packNext}>Pack the next order</Btn>}
      </div> : undefined} />
      {searching && !wide && <label className="mt-3 flex h-11 items-center gap-2 rounded-full px-4" style={{ background: C.soft }}><span style={muted}>{Ic.search}</span><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" placeholder="Name, order number or item" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" /></label>}
      {needs.length > 0 && (
        <button type="button" onClick={() => needs.length === 1 ? setOpenId(needs[0].orderId) : setNeedsOpen(true)} className="mt-3.5 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-[15px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>
          <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full${needs.some((n) => n.kind === 'outside') ? ' cf-anim-pulse' : ''}`} style={{ background: C.warn }} />{needs.length} need{needs.length === 1 ? 's' : ''} you</span>
          <span className="flex min-w-0 items-center gap-1.5 font-medium"><span className="truncate">{needs[0].text}</span>{Ic.chev}</span>
        </button>)}
      <div className="mt-3 lg:max-w-md"><Seg value={tab} onChange={(v) => { setTab(v); if (wide) setOpenId(null); }} options={[{ id: 'pack', label: `To pack ${counts.pack || ''}`.trim() }, { id: 'ready', label: `Ready ${counts.ready || ''}`.trim() }, { id: 'done', label: 'Done' }]} /></div>
    </div>);

  const panel = open && (
    <OrderPanel key={open.id} fs={fs} tenantId={tenantId} order={open} actor={actor} rs={rs} photoFor={photoFor} canRefund={canRefund} inline={wide}
      onClose={() => setOpenId(null)} onPack={() => void beginPack(open)} onShip={() => setShipId(open.id)} onHandover={() => setHandId(open.id)} onToast={setToast} />);

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      {wide ? (
        <div className="flex h-[100dvh]">
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-8">{header}<div key={tab} className="cf-stagger mt-1">{listBody}</div></div>
          <div className="w-[440px] shrink-0 overflow-y-auto border-l" style={{ borderColor: C.line }}>{panel || <Empty title="Pick an order" sub="Its items, history and next step show here." />}</div>
        </div>
      ) : (
        <div className="pb-48">{header}<div key={tab} className="cf-stagger mt-1">{listBody}</div></div>
      )}
      {!wide && !open && <PhoneShopBar onPackNext={perms.canPick && tab === 'pack' && !nextUp ? packNext : undefined} problems={needs.filter((n) => n.kind === 'refund').length} />}
      {!wide && panel}

      {packing && <PackMode fs={fs} tenantId={tenantId} order={packing} all={orders} actor={actor} rs={rs} photoFor={photoFor} shelfFor={shelfFor} batch={batches.find((b) => b.id === packing.batchId) || null}
        onClose={() => setPackId(null)} onDetails={() => { setOpenId(packing.id); setPackId(null); }} onMissing={(l) => setMissing({ order: packing, line: l })}
        onFinished={(m) => { setToast(m); setPackId(null); }} />}
      {missing && <MissingSheet fs={fs} tenantId={tenantId} order={missing.order} line={missing.line} shelf={shelfFor.get(missing.line.productId)} actor={actor} onClose={() => setMissing(null)} onDone={(m) => { setMissing(null); setToast(m); }} />}
      {shipId && byId.get(shipId) && <ShipSheet fs={fs} tenantId={tenantId} order={byId.get(shipId)} inventory={inventory || []} rs={rs} actor={actor} onClose={() => setShipId(null)} onDone={(m) => { setShipId(null); setToast(m); }} />}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); setToast(m); }} />}
      {needsOpen && (
        <Sheet title={`${needs.length} need you`} onClose={() => setNeedsOpen(false)} closeLabel="Done">
          <div className="mt-1">{needs.map((n) => <ListRow key={n.key} onClick={() => { setNeedsOpen(false); setOpenId(n.orderId); }} title={n.text} detail={byId.get(n.orderId)?.customerName} trail={<span style={muted}>{Ic.chev}</span>} />)}</div>
        </Sheet>)}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 150} />}
    </div>);
}

function PhoneShopBar({ onPackNext, problems }: { onPackNext?: () => void; problems: number }) {
  const path = usePathname() || '';
  const I = (d: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
  const tabs: [string, string, React.ReactNode, number][] = [
    ['/retail-orders', 'Orders', I(<><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /></>), 0],
    ['/retail-orders/support', 'Problems', I(<path d="M4 5h16v11H8l-4 4z" />), problems],
    ['/retail-orders/customers', 'Shoppers', I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>), 0],
    ['/retail-orders/settings', 'Setup', I(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>), 0],
  ];
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t" style={{ borderColor: C.line, background: 'color-mix(in srgb, var(--paper, #fff) 86%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {onPackNext && <div className="px-4 pt-3"><Btn kind="primary" className="w-full text-[17px]" onClick={onPackNext}>Pack the next order</Btn></div>}
      <nav aria-label="Online shop" className="flex h-14">
        {tabs.map(([href, label, icon, badge]) => { const on = href === '/retail-orders' ? path === href : path.startsWith(href); return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined} className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold" style={{ color: on ? C.ink : C.muted }}>
            {icon}<span>{label}</span>
            {badge > 0 && <span className="absolute left-[56%] top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] text-white" style={{ background: C.warn }}>{badge}</span>}
          </Link>); })}
      </nav>
    </div>);
}
