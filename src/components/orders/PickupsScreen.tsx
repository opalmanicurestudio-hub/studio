'use client';
// src/components/orders/PickupsScreen.tsx — PICKUPS, on a tablet by the window or the door (retail-orders/pickups): the
// orders customers collect (at the window, curbside or inside), in three lists.
//   Here now  — they've said they're here (the order page's I'm here), longest wait first; then who's on the way.
//               A card bags it, tells them how long (by text when the order has their number, lib/order-inbox), says
//               it's coming out, and hands it over.
//   To bag    — paid and not yet bagged, in the packing order (held ones are decided on the Orders screen).
//   Bagged    — on the shelf, waiting for them.
// The lists keep their order as the clock ticks, and the screen stays on the list it's showing: a new arrival is said
// (a sound, the message at the bottom, read out by a screen reader) and asks the team again after five minutes
// (use-arrival-alerts), the same as on Orders. Opening one opens the order's own workspace on its packing tab
// (components/orders/workspace): the bag list with the window board's numbers and the bins, the license it was sold on,
// missing items, and handing it over. Handing over and telling the customer follow the person's role, as on Orders.
// Live from Firestore; every step goes through the same engine (lib/orders-flow).
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { tenantTimeZone } from '@/lib/tenant-time';
import { type Actor } from '@/lib/fulfil-client';
import { curbsideWaitMinutes } from '@/lib/retail-orders';
import { bringingOut } from '@/lib/orders-flow';
import { ACTIVE_STAGES, dueLine, firstName, itemCount, methodLabel, packProgress } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { mayEditContact } from '@/lib/contact-change';
import { Btn, C, Empty, Initials, LargeTitle, ListRow, Seg, UndoBar, feel, muted, Ic } from './ui';
import { OrderWorkspace, type Layout, type WorkTab } from './workspace/OrderWorkspace';
import { HandoverSheet } from './HandoverSheet';
import { PutAwaySheet } from './PutAwaySheet';
import { needsPutAway } from '@/lib/bag-tag';
import { useWide, useWidest } from './shell';
import { BAGGED, hasProsOnly, isHere, isPickup, licenseLapsed, localDay, minutesAway, onTheWay, pickupLists, shortName, soonSent, soonText, type PickupTab } from '@/lib/pickups-view';
import { useArrivalAlerts } from './use-arrival-alerts';

type Tab = PickupTab;

export function PickupsScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, can, role, staffId } = useTenant() as any; const { user } = useUser() as any;
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const { inventory } = useInventory() as any;
  const perms = useFulfilmentPerms();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant as any)?.retailSettings || {};
  const shopZone = tenantTimeZone(selectedTenant);
  const actor: Actor = React.useMemo(() => ({ id: staffId || user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user, staffId]);
  const wide = useWide(); const widest = useWidest();
  const layout: Layout = !wide ? 'phone' : widest ? 'three' : 'two';
  const canEditContact = mayEditContact(selectedTenant, { role, isTenantOwner: !!user?.uid && (selectedTenant as any)?.userId === user.uid });
  const canRefund = typeof can === 'function' ? can('checkout.refund') : false;

  const [orders, setOrders] = React.useState<any[]>([]);
  const [batches, setBatches] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [focus, setFocus] = React.useState<{ tab: WorkTab; n: number } | null>(null);
  const [handId, setHandId] = React.useState<string | null>(null);
  const [putting, setPutting] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const u1 = onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE_STAGES)), (s) => {
      const all = s.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
      // The list it opens on is chosen once, with the first orders: whoever's here, else what's to bag. After that it
      // stays where the person put it.
      // (Not from this device's cache alone, which can be behind: someone waiting might not be in it yet.)
      const someoneHere = all.some((o) => isHere(o) && isPickup(o));
      if (someoneHere || !(s as any).metadata?.fromCache) setTab((t) => t ?? (someoneHere ? 'here' : 'bag'));
      // (The server's answer may not come as a new update when it matches the cache: settled on To bag shortly after.)
      else setTimeout(() => setTab((t) => t ?? 'bag'), 2000);
      setOrders(all); setLoading(false); }, () => setLoading(false));
    const u2 = onSnapshot(query(collection(fs, `tenants/${tenantId}/fulfillmentBatches`), where('active', '==', true)), (s) => setBatches(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setBatches([]));
    return () => { u1(); u2(); };
  }, [fs, tenantId]);

  const photoFor = React.useMemo(() => { const m = new Map<string, string>(); (inventory || []).forEach((i: any) => { const u = (Array.isArray(i.imageUrls) && i.imageUrls.find((x: any) => typeof x === 'string' && x.trim())) || (typeof i.imageUrl === 'string' && i.imageUrl.trim() ? i.imageUrl : ''); if (u) m.set(i.id, u); }); return m; }, [inventory]);
  const shelfFor = React.useMemo(() => { const m = new Map<string, string>(); (inventory || []).forEach((i: any) => { const s = String(i.storageLocation || i.shelf || i.binLocation || '').trim(); if (s) m.set(i.id, s); }); return m; }, [inventory]);

  // (Every active order is kept, shipping ones too: the bag list says which order a scanned item belongs to, and an
  // order's links reach the customer's other orders. Only the lists are pickups.)
  const { here, coming, toBag, bagged, held } = pickupLists(orders, rs, now, shopZone);
  // Orders on the ready shelf whose bags aren't scanned onto their spot yet (lib/bag-tag), deliveries waiting there too.
  const toPut = orders.filter((o) => needsPutAway(o, rs)).length;
  const shown: Tab = tab ?? 'bag';
  const byId = new Map(orders.map((o) => [o.id, o]));
  // One that's just left the active stages (handed over, cancelled) stays open, live, until it's closed.
  const [single, setSingle] = React.useState<any | null>(null);
  const inLists = !!openId && byId.has(openId);
  React.useEffect(() => {
    if (!fs || !tenantId || !openId || inLists) { setSingle(null); return; }
    return onSnapshot(doc(fs, `tenants/${tenantId}/retailOrders`, openId), (d) => setSingle(d.exists() ? { ...(d.data() as any), id: d.id } : null), () => setSingle(null));
  }, [fs, tenantId, openId, inLists]);
  const open = openId ? byId.get(openId) || (single?.id === openId ? single : null) : null;
  const openOn = (id: string, t: WorkTab) => { setOpenId(id); setFocus((f) => ({ tab: t, n: (f?.n || 0) + 1 })); };
  // Opened from a link to one order (?open=, the Pop-ups screen's Bag it): that order, on its bag list.
  React.useEffect(() => {
    const id = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('open') || '';
    if (/^[A-Za-z0-9_-]{1,80}$/.test(id)) { setOpenId(id); setFocus((f) => ({ tab: 'pack', n: (f?.n || 0) + 1 })); }
  }, []);
  useArrivalAlerts(orders, now, tenantId, (o) => setToast(`${firstName(o.customerName)} is here${o.curbside?.spotOrVehicle ? `: ${o.curbside.spotOrVehicle}` : ''}.`), (o) => isHere(o) && isPickup(o));

  // Handing over, and telling the customer, are for the roles that hand orders over (lib/fulfilment-access).
  const canHand = perms.canPack !== false;
  const notYours = () => { feel(false); setToast('Handing orders over isn’t part of your role. Ask a manager to add it.'); };
  const text = async (o: any, mins: number) => {
    if (!canHand) { notYours(); return false; }
    try {
      const r = await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: o.id, text: soonText(o, mins), soon: true }) });
      const d = await r.json().catch(() => ({}));
      // (502: it's on their order page, only the nudge didn't go. Sent either way, so it isn't offered again.)
      const sent = !!d.ok || r.status === 502;
      feel(sent); setToast(d.ok ? `Sent to ${firstName(o.customerName)}: about ${mins} minute${mins === 1 ? '' : 's'}.` : d.error || 'That didn’t send. Try again.');
      return sent;
    } catch { feel(false); setToast('No connection. Try again.'); return false; }
  };
  const out = async (o: any) => { if (!canHand) { notYours(); return; } const r = await bringingOut(fs, tenantId, o, actor); feel(r.ok); setToast(r.ok ? `${firstName(o.customerName)} knows you’re on the way.` : r.message); };
  const hand = (o: any) => { if (!canHand) { notYours(); return; } setHandId(o.id); };

  const header = (
    <div className="px-4 pt-5">
      <LargeTitle title="Pickups" sub={`${selectedTenant?.businessName || selectedTenant?.name || ''}`.trim() || undefined}
        right={<Link href="/pos" className="cf-press inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold" style={{ background: C.soft, color: C.ink }}>New sale</Link>} />
      <div className="mt-4"><Seg value={shown} onChange={(v) => setTab(v)} options={[
        { id: 'here', label: `Here now${here.length ? ` (${here.length})` : ''}` }, { id: 'bag', label: `To bag${toBag.length ? ` (${toBag.length})` : ''}` }, { id: 'bagged', label: `Bagged${bagged.length ? ` (${bagged.length})` : ''}` }]} /></div>
    </div>);

  const row = (o: any, detail: string, trail?: React.ReactNode) => (
    <ListRow key={o.id} active={o.id === openId} onClick={() => openOn(o.id, 'pack')} lead={<Initials name={String(o.customerName || 'Customer')} />}
      title={Number(o.popupNumber) > 0 ? `${o.customerName || 'Customer'}, No. ${o.popupNumber}` : o.customerName || 'Customer'} detail={hasProsOnly(o) ? <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{detail}</span><ProsTag o={o} short /></span> : detail} trail={trail ?? <span style={muted}>{Ic.chev}</span>} />);

  const listBody = loading ? <p className="m-0 px-4 pt-6 text-[15px]" style={muted}>Loading…</p>
    : shown === 'here' ? (
      <div className="px-4 pt-3">
        {!here.length && <Empty title="Nobody’s here yet" sub="When a customer taps I’m here on their order, they show up here with their car and how long they’ve waited." />}
        <div className="grid gap-2.5">{here.map((o) => <HereCard key={o.id} o={o} rs={rs} now={now} active={o.id === openId} onBag={() => openOn(o.id, 'pack')} onText={(m) => text(o, m)} onOut={() => out(o)} onHand={() => hand(o)} />)}</div>
        {coming.length > 0 && <>
          <p className="m-0 pb-1 pt-5 text-[13px] font-semibold" style={muted}>On the way</p>
          <div className="overflow-hidden rounded-2xl" style={{ background: C.soft }}>{coming.map((o) => { const m = minutesAway(o, now); const p = packProgress(o);
            return row(o, [o.curbside?.spotOrVehicle, BAGGED.includes(o.stage) ? (o.shelfSlot ? `Bagged, shelf ${o.shelfSlot}` : 'Bagged') : `${p.done} of ${p.total} bagged`].filter(Boolean).join(', '),
              <span className="shrink-0 text-[14px] font-semibold" style={muted}>{m == null ? 'On the way' : m <= 1 ? 'Almost here' : `About ${m} min`}</span>); })}</div>
        </>}
      </div>)
    : shown === 'bag' ? (
      <div className="px-4 pt-3">
        {!toBag.length && !held ? <Empty title="Nothing to bag" sub="Paid pickup orders show here until they’re bagged." /> : !toBag.length ? null
          : <div className="overflow-hidden rounded-2xl" style={{ background: C.soft }}>{toBag.map((o) => { const p = packProgress(o); const due = dueLine(o, rs, now, shopZone); const m = onTheWay(o) ? minutesAway(o, now) : null;
            const who = o.stage === 'picking' && o.claimedBy && o.claimedBy !== actor.id ? `${firstName(o.claimedByName) || 'Someone'} is bagging it` : '';
            return row(o, [methodLabel(o.method, rs), `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`, who || (p.done ? `${p.done} of ${p.total} bagged` : '')].filter(Boolean).join(', '),
              <span className="shrink-0 text-right text-[14px] font-semibold" style={onTheWay(o) || due.late ? { color: C.warn } : muted}>{onTheWay(o) ? (m == null ? 'On the way' : `Here in ${Math.max(1, m)} min`) : due.text}</span>); })}</div>}
        {held > 0 && <p className="m-0 mt-3 text-[14px]" style={muted}>{held} more {held === 1 ? 'is' : 'are'} waiting on stock or a review. <Link href="/retail-orders" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: C.ink }}>See them on Orders</Link></p>}
      </div>)
    : (
      <div className="px-4 pt-3">
        {toPut > 0 && canHand && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: C.warnSoft }}>
            <p className="m-0 min-w-[180px] flex-1 text-[15px]" style={{ color: C.warn }}><b className="font-semibold">{toPut} to put away. </b>Scan each bag, then the spot it’s on.</p>
            <Btn kind="primary" className="shrink-0" onClick={() => setPutting(true)}>Put away</Btn>
          </div>)}
        {!bagged.length ? <Empty title="Nothing waiting" sub="Bagged orders wait here, with their shelf, until they’re collected." />
          : <div className="overflow-hidden rounded-2xl" style={{ background: C.soft }}>{bagged.map((o) => row(o, [o.shelfSlot ? `Shelf ${o.shelfSlot}` : '', methodLabel(o.method, rs), `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`].filter(Boolean).join(', '),
            needsPutAway(o, rs) ? <span className="shrink-0 text-[14px] font-semibold" style={{ color: C.warn }}>Not put away</span> : undefined))}</div>}
      </div>);

  const panel = open && (
    <OrderWorkspace key={open.id} fs={fs} tenantId={tenantId} order={open} all={orders} actor={actor} rs={rs} photoFor={photoFor} shelfFor={shelfFor}
      batch={batches.find((b) => b.id === open.batchId) || null} inventory={inventory || []} perms={perms} canRefund={canRefund} isManager={isManager} canEditContact={canEditContact}
      shopZone={shopZone} layout={layout} requestTab={focus} startMessage={null}
      onClose={() => setOpenId(null)} onToast={setToast} onOpenOrder={(id) => setOpenId(id)} />);

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      {wide ? (
        <div className="flex h-[100dvh]">
          <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r pb-8" style={{ borderColor: C.line }}>{header}<div key={shown} className="cf-stagger mt-1">{listBody}</div></div>
          <div className="min-w-0 flex-1">{panel || <Empty title="Pick an order" sub="Its bag list, with each item’s number and shelf, opens here." />}</div>
        </div>
      ) : (
        <div className="pb-32">{header}<div key={shown} className="cf-stagger mt-1">{listBody}</div></div>
      )}
      {!wide && panel}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor} lookup={(id) => byId.get(id)} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); setToast(m); }} />}
      {putting && <PutAwaySheet tenantId={tenantId} orders={orders} rs={rs} onClose={() => setPutting(false)} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? 32 : 40} />}
    </div>);
}

/** Products for licensed pros on it: green with the license it was sold on, amber without one (check it at handover). */
function ProsTag({ o, short }: { o: any; short?: boolean }) {
  const lapsed = licenseLapsed(o, localDay()); const on = !!o.proLicense && !lapsed;
  const words = on ? 'license on file' : lapsed ? 'license past its date' : 'check their license';
  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={on ? { background: C.okSoft, color: C.ok } : { background: C.warnSoft, color: C.warn }}>
    {short ? <>Pros only<span className="sr-only">, {words}</span></> : `Pros only, ${words}`}</span>;
}

/** Someone who's here: how long they've waited, where they are, how far along their bag is, and the next step. */
function HereCard({ o, rs, now, active, onBag, onText, onOut, onHand }: { o: any; rs: any; now: number; active: boolean; onBag: () => void; onText: (mins: number) => Promise<boolean>; onOut: () => Promise<void>; onHand: () => void }) {
  const [busy, setBusy] = React.useState(''); const [justSent, setJustSent] = React.useState(false);
  // (Sent from any screen: kept on the order, so switching lists or screens doesn't offer it again.)
  const sent = justSent || soonSent(o, now);
  const who = shortName(o.customerName);
  const mins = curbsideWaitMinutes(o, new Date(now)) ?? 0;
  const bagged = BAGGED.includes(String(o.stage)); const out = !!o.curbside?.bringingOutAt;
  const p = packProgress(o); const left = Math.max(0, p.total - p.done);
  const long = mins >= 5 && !out;
  const where = String(o.curbside?.spotOrVehicle || '').trim() || methodLabel(o.method, rs);
  const run = async (k: string, f: () => Promise<any>) => { setBusy(k); try { await f(); } finally { setBusy(''); } };
  return (
    <div className="cf-anim-rise rounded-2xl border-2 p-4" style={{ borderColor: long ? C.warn : active ? C.ink : C.line }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-[22px] font-light">{shortName(o.customerName)}</p>
          <p className="m-0 mt-0.5 text-[15px]">{where}</p>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]" style={muted}>{bagged ? `Bagged${o.shelfSlot ? `, shelf ${o.shelfSlot}` : ''}, ${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}` : `${p.done} of ${p.total} bagged`}{hasProsOnly(o) && <ProsTag o={o} />}</p>
          {o.collector?.name && <p className="m-0 mt-0.5 text-[14px] font-semibold" style={{ color: C.ok }}>{o.collector.name} is collecting</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[14px] font-semibold tabular-nums${long ? ' cf-anim-pulse' : ''}`} style={out ? { background: C.okSoft, color: C.ok } : long ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.muted }}>{out ? 'On the way out' : mins < 1 ? 'Just now' : `Waiting ${mins} min`}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!bagged && <Btn kind="primary" className="flex-1" aria-label={`${p.done ? `Bag ${left} more` : 'Bag it'} for ${who}`} onClick={onBag}>{p.done ? `Bag ${left} more` : 'Bag it'}</Btn>}
        {!bagged && !sent && <Btn className="flex-1" disabled={!!busy} aria-label={`Message: ${left > 4 ? 5 : 2} min, for ${who}`} onClick={() => void run('text', async () => { if (await onText(left > 4 ? 5 : 2)) setJustSent(true); })}>{busy === 'text' ? 'Sending…' : `Message: ${left > 4 ? 5 : 2} min`}</Btn>}
        {!bagged && sent && <p className="m-0 flex min-h-12 flex-1 items-center text-[14px]" style={muted}>They know how long</p>}
        {bagged && !out && <Btn kind="primary" className="flex-1" disabled={!!busy} aria-label={`Bringing it out to ${who}`} onClick={() => void run('out', onOut)}>{busy === 'out' ? 'Telling them…' : 'Bringing it out'}</Btn>}
        {bagged && <Btn kind={out ? 'primary' : 'soft'} className="flex-1" aria-label={`Hand over to ${who}`} onClick={onHand}>Hand over</Btn>}
      </div>
    </div>);
}
