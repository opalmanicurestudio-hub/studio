'use client';
// src/components/orders/CurbsideScreen.tsx — CURBSIDE (design canvas: Curbside; the page is /curbside). A screen of its
// own for whoever runs orders out to cars, built for a phone in one hand: the shop's curbside orders (live, as on
// Pickups) and café orders placed ahead for curbside (api/curbside, every few seconds), in one list (lib/curbside).
//   Outside now — longest wait first: the car and spot in big type, what they asked (a guest who can't come in shows
//                 first), how long they've waited (amber at five minutes), whether it's ready, and two taps: Bringing
//                 it out (tells them) and Hand over. A shop order hands over as at the shelf (HandoverSheet: their
//                 code or their name checked); a café order in one tap. A new arrival sounds and buzzes once.
//   On the way  — shop customers who said they've set off, and how far.
//   Later today — how many more, and the next time.
import * as React from 'react';
import { collection, doc, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { tenantTimeZone } from '@/lib/tenant-time';
import { type Actor } from '@/lib/fulfil-client';
import { bringingOut } from '@/lib/orders-flow';
import { ACTIVE_STAGES, firstName } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { mayEditContact } from '@/lib/contact-change';
import { minutesAway, shortName, soonText } from '@/lib/pickups-view';
import { cafeMinutesAway, curbsideBoard, isShopCurb, waitedMin, WAIT_WARN_MIN, type CurbRow } from '@/lib/curbside';
import type { CafeCurb } from '@/lib/curbside-server';
import { Btn, C, Empty, LargeTitle, UndoBar, feel, muted } from './ui';
import { OrderWorkspace, type WorkTab } from './workspace/OrderWorkspace';
import { HandoverSheet } from './HandoverSheet';
import { HereCard } from './PickupsScreen';
import { useArrivalAlerts } from './use-arrival-alerts';

/** With more than one location, the one picked in the app (lib/here-server). */
const hereAsked = () => { try { const v = localStorage.getItem('selectedLocationId'); return v ? { locationId: v } : {}; } catch { return {}; } };
const clock = (iso: string | null) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; };

export function CurbsideScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, can, role, staffId } = useTenant() as any; const { user } = useUser() as any;
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const { inventory } = useInventory() as any;
  const perms = useFulfilmentPerms();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant as any)?.retailSettings || {};
  const shopZone = tenantTimeZone(selectedTenant);
  const actor: Actor = React.useMemo(() => ({ id: staffId || user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user, staffId]);
  const canEditContact = mayEditContact(selectedTenant, { role, isTenantOwner: !!user?.uid && (selectedTenant as any)?.userId === user.uid });
  const canRefund = typeof can === 'function' ? can('checkout.refund') : false;
  const canHand = perms.canPack !== false;

  const [orders, setOrders] = React.useState<any[]>([]); const [shopLoaded, setShopLoaded] = React.useState(false);
  const [cafe, setCafe] = React.useState<CafeCurb[]>([]); const [cafeLoaded, setCafeLoaded] = React.useState(false); const [cafeErr, setCafeErr] = React.useState('');
  const [cafeOn, setCafeOn] = React.useState(true);   // ordering ahead offers curbside: kept asking; otherwise asked once
  const [now, setNow] = React.useState(() => Date.now());
  const [openId, setOpenId] = React.useState<string | null>(null); const [focus, setFocus] = React.useState<{ tab: WorkTab; n: number } | null>(null);
  const [handId, setHandId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  // The shop's orders, live (the team can read them).
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE_STAGES)), (s) => { setOrders(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); setShopLoaded(true); }, () => setShopLoaded(true));
  }, [fs, tenantId]);
  // The café's, every few seconds (they're server-only).
  const loadCafe = React.useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await fetch('/api/curbside', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action: 'list', ...hereAsked() }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setCafe(d.cafe || []); setCafeErr(''); setCafeOn(d.on === true || (d.cafe || []).length > 0); } else setCafeErr(d.error || 'Café orders didn’t load.');
    } catch { setCafeErr('No connection. Café orders will show again when it’s back.'); } finally { setCafeLoaded(true); }
  }, [tenantId]);
  React.useEffect(() => { void loadCafe(); }, [loadCafe]);
  React.useEffect(() => { if (!cafeOn) return; const t = setInterval(() => { if (document.visibilityState === 'visible') void loadCafe(); }, 5000); return () => clearInterval(t); }, [loadCafe, cafeOn]);

  // A new café arrival is said once, like the shop's (use-arrival-alerts).
  const saidCafe = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!cafeLoaded) return;
    const here = cafe.filter((c) => c.hereAt);
    if (!saidCafe.current) { saidCafe.current = new Set(here.map((c) => c.id)); return; }   // already here when the screen opened: not news
    const fresh = here.filter((c) => !saidCafe.current!.has(c.id)); if (!fresh.length) return;
    fresh.forEach((c) => saidCafe.current!.add(c.id)); feel(true);
    setToast(`${firstName(fresh[0].name) || 'A guest'} is outside${fresh[0].where ? `: ${fresh[0].where}` : ''}.`);
  }, [cafe, cafeLoaded]);
  useArrivalAlerts(orders, now, tenantId, (o) => setToast(`${firstName(o.customerName)} is outside${o.curbside?.spotOrVehicle ? `: ${o.curbside.spotOrVehicle}` : ''}.`), (o) => isShopCurb(o) && (o?.stage === 'arrived' || !!o?.curbside?.arrivedAt));

  const board = curbsideBoard(orders, cafe, now);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const [single, setSingle] = React.useState<any | null>(null);
  const inList = !!openId && byId.has(openId);
  React.useEffect(() => {
    if (!fs || !tenantId || !openId || inList) { setSingle(null); return; }
    return onSnapshot(doc(fs, `tenants/${tenantId}/retailOrders`, openId), (d) => setSingle(d.exists() ? { ...(d.data() as any), id: d.id } : null), () => setSingle(null));
  }, [fs, tenantId, openId, inList]);
  const open = openId ? byId.get(openId) || (single?.id === openId ? single : null) : null;

  const notYours = () => { feel(false); setToast('Handing orders over isn’t part of your role. Ask a manager to add it.'); };
  const text = async (o: any, mins: number) => {
    if (!canHand) { notYours(); return false; }
    try {
      const r = await fetch('/api/retail/order-message', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: o.id, text: soonText(o, mins), soon: true }) });
      const d = await r.json().catch(() => ({})); const sent = !!d.ok || r.status === 502;
      feel(sent); setToast(d.ok ? `Sent to ${firstName(o.customerName)}: about ${mins} minute${mins === 1 ? '' : 's'}.` : d.error || 'That didn’t send. Try again.');
      return sent;
    } catch { feel(false); setToast('No connection. Try again.'); return false; }
  };
  const shopOut = async (o: any) => { if (!canHand) { notYours(); return; } const r = await bringingOut(fs, tenantId, o, actor); feel(r.ok); setToast(r.ok ? `${firstName(o.customerName)} knows you’re on the way.` : r.message); };
  const cafeAct = async (c: CafeCurb, action: 'out' | 'handed') => {
    try {
      const r = await fetch('/api/curbside', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action, orderId: c.id }) });
      const d = await r.json().catch(() => ({}));
      feel(!!d.ok); setToast(d.ok ? (action === 'out' ? `${firstName(c.name) || 'They'} know${c.name ? 's' : ''} you’re on the way.` : `Handed over to ${firstName(c.name) || 'them'}.`) : d.error || 'That didn’t go through. Try again.');
      if (d.ok) void loadCafe();
    } catch { feel(false); setToast('No connection. Try again.'); }
  };

  const loading = !shopLoaded || !cafeLoaded;
  const card = (r: CurbRow) => r.kind === 'shop'
    ? <HereCard key={r.key} carFirst o={r.o} rs={rs} now={now} active={r.o.id === openId} onBag={() => { setOpenId(r.o.id); setFocus((f) => ({ tab: 'pack', n: (f?.n || 0) + 1 })); }}
        onText={(m) => text(r.o, m)} onOut={() => shopOut(r.o)} onHand={() => (canHand ? setHandId(r.o.id) : notYours())} />
    : <CafeCard key={r.key} c={r.c} since={r.since} now={now} onOut={() => cafeAct(r.c, 'out')} onHanded={() => cafeAct(r.c, 'handed')} />;

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-[560px] pb-32">
        <div className="px-4 pt-5"><LargeTitle title="Curbside" sub={board.outside.length ? `${board.outside.length} outside` : `${selectedTenant?.businessName || selectedTenant?.name || ''}`.trim() || undefined} /></div>
        <section aria-label="Outside now" className="px-4 pt-4">
          <h2 className="m-0 pb-2 text-[13px] font-semibold" style={muted}>Outside now</h2>
          {loading && !board.outside.length ? <p className="m-0 text-[15px]" style={muted}>Loading…</p>
            : !board.outside.length ? <Empty title="Nobody’s outside yet" sub="When a customer taps I’m here on a curbside order, they show up here with their car and how long they’ve waited." />
            : <div className="grid gap-2.5">{board.outside.map(card)}</div>}
          {cafeErr && <p role="status" className="m-0 mt-2 text-[14px]" style={{ color: C.warn }}>{cafeErr}</p>}
        </section>
        {board.coming.length > 0 && (
          <section aria-label="On the way" className="px-4 pt-5">
            <h2 className="m-0 pb-2 text-[13px] font-semibold" style={muted}>On the way</h2>
            <ul className="m-0 list-none overflow-hidden rounded-2xl p-0" style={{ background: C.soft }}>{board.coming.map((r) => {
              const shop = r.kind === 'shop'; const m = shop ? minutesAway(r.o, now) : cafeMinutesAway(r.c, now);
              const who = shop ? shortName(r.o.customerName) : shortName(r.c.name || 'Guest'); const car = shop ? r.o.curbside?.spotOrVehicle : r.c.where;
              return <li key={r.key} className="flex min-h-[52px] items-center justify-between gap-3 border-b px-4 last:border-b-0" style={{ borderColor: C.line }}>
                <span className="min-w-0 truncate text-[15px] font-semibold">{who}<span className="font-normal" style={muted}>{car ? `, ${car}` : ''}{shop ? '' : `, café order ${r.c.number}`}</span></span>
                <span className="shrink-0 text-[14px]" style={muted}>{m == null ? 'On the way' : m <= 1 ? 'Almost here' : `About ${m} min away`}</span></li>; })}</ul>
          </section>)}
        {board.later.count > 0 && <p className="m-0 px-4 pt-5 text-[14px]" style={muted}>Later today: {board.later.count} more curbside order{board.later.count === 1 ? '' : 's'}{board.later.next ? `, next at ${clock(board.later.next)}` : ''}.</p>}
      </div>
      {open && <OrderWorkspace key={open.id} fs={fs} tenantId={tenantId} order={open} all={orders} actor={actor} rs={rs} photoFor={new Map()} shelfFor={new Map()}
        batch={null} inventory={inventory || []} perms={perms} canRefund={canRefund} isManager={isManager} canEditContact={canEditContact}
        shopZone={shopZone} layout="phone" requestTab={focus} startMessage={null} onClose={() => setOpenId(null)} onToast={setToast} onOpenOrder={(id) => setOpenId(id)} />}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor} lookup={(id) => byId.get(id)} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); setToast(m); }} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={40} />}
    </div>);
}

/** A café order placed ahead for curbside, with its guest outside: where they are, what they asked, how long they've
 *  waited, whether the kitchen's done, and Bringing it out (once it's ready) and Hand over (done in one tap). */
export function CafeCard({ c, since, now, onOut, onHanded }: { c: CafeCurb; since: number; now: number; onOut: () => Promise<void>; onHanded: () => Promise<void> }) {
  const [busy, setBusy] = React.useState('');
  const mins = waitedMin(since, now); const out = !!c.outAt; const ready = c.state === 'ready';
  const long = mins >= WAIT_WARN_MIN && !out;
  const who = firstName(c.name) || 'the guest';
  const run = async (k: string, f: () => Promise<void>) => { setBusy(k); try { await f(); } finally { setBusy(''); } };
  return (
    <div className="cf-anim-rise rounded-2xl border-2 p-4" style={{ borderColor: long ? C.warn : C.line }}>
      {c.note && <p className="m-0 mb-2"><span className="inline-block rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>{c.note}</span></p>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[22px] font-semibold leading-tight">{c.where || 'Just pulled in'}</p>
          <p className="m-0 mt-1 text-[15px]" style={muted}>{c.name || 'Guest'}, café order {c.number}{c.summary ? `, ${c.summary}` : ''}</p>
          {c.found && <p className="m-0 mt-1 text-[13.5px]" style={muted}>Found by their phone’s location{c.where ? '' : '. They haven’t said their car yet: look for them, or ask them to add it.'}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[14px] font-semibold tabular-nums${long ? ' cf-anim-pulse' : ''}`} style={out ? { background: C.okSoft, color: C.ok } : long ? { background: C.warnSoft, color: C.warn } : { background: C.soft, color: C.muted }}>
          {out ? 'On the way out' : mins < 1 ? 'Just now' : `Waiting ${mins} min`}</span>
      </div>
      <p className="m-0 mt-2"><span className="inline-block rounded-full px-2.5 py-1 text-[13px] font-semibold" style={ready ? { background: C.okSoft, color: C.ok } : { background: C.soft, color: C.ink }}>
        {out ? `${c.outBy ? `${c.outBy} is` : 'Someone’s'} taking it out` : ready ? 'Ready' : c.state === 'later' ? 'Not started yet' : 'Being made'}</span></p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!out && <Btn kind={ready ? 'primary' : 'soft'} className="flex-1" disabled={!ready || !!busy} aria-label={`Bringing it out to ${who}`} onClick={() => void run('out', onOut)}>{busy === 'out' ? 'Telling them…' : 'Bringing it out'}</Btn>}
        <Btn kind={out ? 'primary' : 'soft'} className="flex-1" disabled={!ready || !!busy} aria-label={`Hand over to ${who}`} onClick={() => void run('hand', onHanded)}>{busy === 'hand' ? 'Saving…' : 'Hand over'}</Btn>
      </div>
      {!ready && <p className="m-0 mt-2 text-[13px]" style={muted}>Both open up once the kitchen marks it ready.</p>}
    </div>);
}
