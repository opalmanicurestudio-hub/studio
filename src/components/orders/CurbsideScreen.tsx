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
import { BagLabelsSheet, BagScanSheet, printLabelsHere, scanReplyOf, type BagWait } from '@/components/drive-thru/BagSheets';
import { atHere } from '@/lib/business-locations';

/** With more than one location, the one picked in the app (lib/here-server). */
const hereAsked = () => { try { const v = localStorage.getItem('selectedLocationId'); return v ? { locationId: v } : {}; } catch { return {}; } };
const clock = (iso: string | null) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; };
/** The mobile pickup spots' note: cars parked whose guest hasn't said they're here (`mins`: since the first parked). */
export const parkedWords = (n: number, mins: number | null) => n === 1
  ? `A car parked in mobile pickup${mins ? ` ${mins} min ago` : ''} and its guest hasn’t said they’re here. Check the spots.`
  : `${n} cars parked in mobile pickup${mins ? `, the first ${mins} min ago,` : ''} and their guests haven’t said they’re here. Check the spots.`;

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
  // The printer that prints bag labels, if one does (lib/food-bags-server).
  const [labelPrinterName, setLabelPrinterName] = React.useState<string | null>(null);
  const [cafe, setCafe] = React.useState<CafeCurb[]>([]); const [cafeLoaded, setCafeLoaded] = React.useState(false); const [cafeErr, setCafeErr] = React.useState('');
  const [cafeOn, setCafeOn] = React.useState(true);   // ordering ahead offers curbside, or a car is parked: kept asking; otherwise asked once
  // Cars the mobile pickup sensor saw park whose guest hasn't said they're here (lib/lane-entry-server parkedNow).
  const [parked, setParked] = React.useState<{ n: number; since: string | null } | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [openId, setOpenId] = React.useState<string | null>(null); const [focus, setFocus] = React.useState<{ tab: WorkTab; n: number } | null>(null);
  const [handId, setHandId] = React.useState<string | null>(null);
  const [here, setHere] = React.useState('');
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
      if (d.ok) { setCafe(d.cafe || []); setHere(typeof d.here === 'string' ? d.here : ''); setCafeErr(''); setParked(d.parked || null); setLabelPrinterName(typeof d.labelPrinter === 'string' ? d.labelPrinter : null); setCafeOn(d.on === true || (d.cafe || []).length > 0 || !!d.parked); } else setCafeErr(d.error || 'Café orders didn’t load.');
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
  // At one of several stores (lib/shop-stores-server): only this store's shop pickups (the location picked in the app, as
  // the server checked it with the café's list: one since closed shows everything), and any from before there were stores.
  const mine = React.useMemo(() => (here ? orders.filter((o) => atHere(o, here)) : orders), [orders, here]);
  // (Arrivals are said once the store is known, never another store's in the first moment.)
  useArrivalAlerts(cafeLoaded ? mine : [], now, tenantId, (o) => setToast(`${firstName(o.customerName)} is outside${o.curbside?.spotOrVehicle ? `: ${o.curbside.spotOrVehicle}` : ''}.`), (o) => isShopCurb(o) && (o?.stage === 'arrived' || !!o?.curbside?.arrivedAt));

  const board = curbsideBoard(mine, cafe, now);
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
  const curb = async (body: any) => {
    try {
      const r = await fetch('/api/curbside', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
      return await r.json().catch(() => ({ ok: false, error: 'That didn’t go through. Try again.' }));
    } catch { return { ok: false, error: 'No connection. Try again.' }; }
  };
  const cafeAct = async (c: CafeCurb, action: 'out' | 'handed') => {
    const d = await curb({ action, orderId: c.id });
    // Its bags' labels scanned first (lib/food-bags): the scan opens, and hands it over once they're done.
    if (!d.ok && d.code === 'bags' && Array.isArray(d.bags)) { setBagHold({ c, waiting: d.bags }); return; }
    feel(!!d.ok); setToast(d.ok ? (action === 'out' ? `${firstName(c.name) || 'They'} know${c.name ? 's' : ''} you’re on the way.` : `Handed over to ${firstName(c.name) || 'them'}.`) : d.error || 'That didn’t go through. Try again.');
    if (d.ok) void loadCafe();
  };
  // Bag labels on café orders (lib/food-bags; components/drive-thru/BagSheets): scanned before it's handed over, and
  // printed here or on the bag-label printer.
  const [bagHold, setBagHold] = React.useState<{ c: CafeCurb; waiting: BagWait[] } | null>(null);
  const [labelsFor, setLabelsFor] = React.useState<CafeCurb | null>(null);
  const bagScan = async (code: string) => {
    if (!bagHold) return { ok: false as const, error: 'Pick the order again.' };
    return scanReplyOf(await curb({ action: 'bagScan', orderId: bagHold.c.id, code }));
  };
  // One item's sticker printed again (a remake, a torn one): lib/item-stickers-server.
  const stickerAgain = async (_orderId: string, k: string) => { if (!bagHold) return { ok: false, error: 'Pick the order again.' }; const d = await curb({ action: 'sticker', orderId: bagHold.c.id, k }); return d.ok ? { ok: true } : { ok: false, error: d.error || 'That didn’t print.' }; };
  const extraIn = async (_orderId: string, k: string, on: boolean) => { if (!bagHold) return { ok: false, error: 'Pick the order again.' }; const d = await curb({ action: 'extra', orderId: bagHold.c.id, k, on }); return d.ok ? { ok: true } : { ok: false, error: d.error || 'That didn’t go through. Try again.' }; };
  const bagsDone = () => { if (!bagHold) return; const c = bagHold.c; setBagHold(null); void cafeAct(c, 'handed'); };
  const bagSkip = async (pin: string, reason: string) => {
    if (!bagHold) return { ok: false, error: 'Pick the order again.' };
    const d = await curb({ action: 'handed', orderId: bagHold.c.id, bagOverride: true, pin, bagReason: reason });
    if (!d.ok) return { ok: false, error: d.error || 'That didn’t go through. Try again.' };
    feel(true); setToast(`Handed over to ${firstName(bagHold.c.name) || 'them'}, okayed by a manager.`); setBagHold(null); void loadCafe(); return { ok: true };
  };
  const printBags = async (count: number, where: 'here' | 'printer') => {
    if (!labelsFor) return 'Pick the order again.';
    const d = await curb({ action: 'bags', orderId: labelsFor.id, count, here: where === 'here' });
    if (!d.ok) return d.error || 'That didn’t print. Try again.';
    if (where === 'here' && !(await printLabelsHere(d.labels || []))) return 'This device couldn’t open its print dialog.';
    setToast(where === 'here' ? `${labelsFor.number}: ${d.count === 1 ? 'its label' : `${d.count} bag labels`} sent to this device’s printer.` : `${labelsFor.number}: ${d.count === 1 ? 'its label' : `${d.count} bag labels`} printing on ${d.printer}.`);
    void loadCafe(); return null;
  };

  const loading = !shopLoaded || !cafeLoaded;
  const card = (r: CurbRow) => r.kind === 'shop'
    ? <HereCard key={r.key} carFirst o={r.o} rs={rs} now={now} active={r.o.id === openId} onBag={() => { setOpenId(r.o.id); setFocus((f) => ({ tab: 'pack', n: (f?.n || 0) + 1 })); }}
        onText={(m) => text(r.o, m)} onOut={() => shopOut(r.o)} onHand={() => (canHand ? setHandId(r.o.id) : notYours())} />
    : <CafeCard key={r.key} c={r.c} since={r.since} now={now} onOut={() => cafeAct(r.c, 'out')} onHanded={() => cafeAct(r.c, 'handed')} onLabels={() => setLabelsFor(r.c)} />;

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-[560px] pb-32">
        <div className="px-4 pt-5"><LargeTitle title="Curbside" sub={board.outside.length ? `${board.outside.length} outside` : `${selectedTenant?.businessName || selectedTenant?.name || ''}`.trim() || undefined} /></div>
        <section aria-label="Outside now" className="px-4 pt-4">
          <h2 className="m-0 pb-2 text-[13px] font-semibold" style={muted}>Outside now</h2>
          {!!parked?.n && (
            <p role="status" className="m-0 mb-2.5 rounded-2xl px-4 py-3 text-[14.5px] font-medium" style={{ background: C.warnSoft, color: C.warn }}>
              {parkedWords(parked.n, parked.since ? Math.max(1, Math.round((now - Date.parse(parked.since)) / 60000)) : null)}
            </p>
          )}
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
      {bagHold && <BagScanSheet key={bagHold.waiting.map((w) => `${w.orderId}:${w.of}:${w.left.join('.')}`).join('|')} title={`Hand over ${bagHold.c.number}`} waiting={bagHold.waiting} scan={bagScan} onDone={bagsDone} skip={bagSkip} printItem={stickerAgain} tick={extraIn} onClose={() => setBagHold(null)} print={() => { const c = bagHold.c; setBagHold(null); setLabelsFor(c); }} />}
      {labelsFor && <BagLabelsSheet number={labelsFor.number} start={labelsFor.bags?.of || labelsFor.bagsStart || 1} printer={labelPrinterName} onPrint={printBags} onClose={() => setLabelsFor(null)} />}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor} lookup={(id) => byId.get(id)} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); setToast(m); }} />}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={40} />}
    </div>);
}

/** A café order placed ahead for curbside, with its guest outside: where they are, what they asked, how long they've
 *  waited, whether the kitchen's done, and Bringing it out (once it's ready) and Hand over (done in one tap). */
export function CafeCard({ c, since, now, onOut, onHanded, onLabels }: { c: CafeCurb; since: number; now: number; onOut: () => Promise<void>; onHanded: () => Promise<void>; onLabels?: () => void }) {
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
      {onLabels && <button type="button" onClick={onLabels} className="mt-2 h-11 text-[15px] font-semibold underline underline-offset-4" style={muted}>
        {c.bags ? (c.bags.left.length ? `Bag labels, ${c.bags.of - c.bags.left.length} of ${c.bags.of} scanned` : c.bags.of === 1 ? 'Bag label' : `Bag labels, ${c.bags.of}`) : 'Print bag labels'}</button>}
    </div>);
}
