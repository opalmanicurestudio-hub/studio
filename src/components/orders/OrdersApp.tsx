'use client';
// src/components/orders/OrdersApp.tsx — THE ORDERS SCREEN. One list with three tabs (To pack, Ready, Done), search, and
// one line for the few things a person must decide. Opening an order opens its workspace (components/orders/workspace):
// packing, shipping or handing over, the customer and the conversation, and the whole record, in one place. On a phone
// it fills the screen and the shop's four places sit in a tab bar; on a computer it sits beside the list, with the
// customer beside it on a wide screen. A one-person shop leads with the next order.
// Live from Firestore; the packing engine is lib/retail-fulfill, the screen's own rules are lib/orders-view.
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { tenantTimeZone } from '@/lib/tenant-time';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import { benchScanTarget, looksLikeTracking, markLabelChecked, parseTote } from '@/lib/totes';
import { useWedgeScanner } from '@/lib/use-wedge-scanner';
import { useFirebase, useUser } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useFulfilmentPerms } from '@/hooks/use-fulfilment-perms';
import { permissionsFor } from '@/lib/fulfilment-access';
import { notifyCurbside, sweepStaleClaims, type Actor } from '@/lib/fulfil-client';
import { curbsideWaitMinutes, lineMatchesScan } from '@/lib/retail-orders';
import { scanInto, startPacking } from '@/lib/orders-flow';
import { orderTags } from '@/lib/order-tags';
import { ACTIVE_STAGES, dueLine, firstName, itemCount, matchesSearch, methodLabel, money, needsYou, packQueue, soloShop, tabOf, type NeedItem, type OrdersTab } from '@/lib/orders-view';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { Btn, C, Empty, IconBtn, Initials, LargeTitle, ListRow, Seg, Sheet, UndoBar, feel, muted, Ic } from './ui';
import { OrderWorkspace, type Layout, type WorkTab } from './workspace/OrderWorkspace';
import { lineProductId } from '@/lib/product-codes';
import { codeBook, lookupCode } from '@/lib/code-lookup';
import { ShipSheet } from './ShipSheet';
import { HandoverSheet } from './HandoverSheet';
import { PhoneShopBar, useWide, useWidest } from './shell';
import { mayEditContact } from '@/lib/contact-change';
import { SelectBar } from './SelectBar';
import { ShipToday } from './ShipToday';
import { bringingOut } from '@/lib/orders-flow';
import { shipTogetherGroups, togetherRefunds } from '@/lib/ship-together';
import { cardRefundableCents } from '@/lib/retail-money';
import { addressLines } from './AddressCard';
import { useLabelFlagOrders } from './use-label-flags';
import { dayPicture, labelWork, tellableNow, whenWord, type CarrierItem, type LateItem, type Step } from '@/lib/ship-day';
import { busyOn, nextShipDay, scheduleFrom } from '@/lib/ship-promise';
import { addDays, dayKey } from '@/lib/tenant-time';
import { CAPACITY_DAYS, dayLoads, overDays, overTitle, packedOn, teamCapacity } from '@/lib/capacity';
import { TodayCard, type DayList } from './Today';
import { CarrierSheet, LateSheet, RiskSheet } from './DaySheets';
import { BusyBanner, CatchUpNote } from './BusyBanner';
import { ClaimSheet, StalledSheet, monthDay } from './LossSheets';
import { claimsToFile, type ClaimToFile } from '@/lib/lost-recovered';
import { protectionPolicy } from '@/lib/shipment-protection';

const DONE_STAGES = ['shipped', 'completed', 'cancelled'];

/** What the message to a customer starts as, for a parcel the carrier is having trouble with. */
function carrierMessage(it: CarrierItem): string | null {
  const o = it.order; const who = firstName(o.customerName); const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const carrier = String(o.carrierIssue?.carrier || o.carrier || 'The carrier').split(/\s+/)[0];
  const why = String(o.carrierIssue?.detail || '').trim().replace(/\.$/, '');
  if (it.kind === 'returned') return `Hi ${who}, ${carrier} is sending your order ${num} back to us${why ? ` (${why.charAt(0).toLowerCase()}${why.slice(1)})` : ''}. Would you like us to send it again, or refund you? If the address needs a change, tell us here.`;
  if (it.kind === 'failed') return `Hi ${who}, ${carrier} couldn’t deliver your order ${num}${why ? ` (${why.charAt(0).toLowerCase()}${why.slice(1)})` : ''}. Can you check the address for us here, so we can get it to you?`;
  return null;
}

export function OrdersApp() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, can, role, staffId } = useTenant() as any; const { user } = useUser() as any;
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const { inventory, staff } = useInventory() as any;
  const perms = useFulfilmentPerms();
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant as any)?.retailSettings || {};
  const shopZone = tenantTimeZone(selectedTenant);
  // The person as the server knows them: their staff record (the same id the order steps stamp on what they claim).
  const actor: Actor = React.useMemo(() => ({ id: staffId || user?.uid || 'staff', name: user?.displayName || user?.email || 'Team' }), [user, staffId]);
  const wide = useWide();
  const widest = useWidest();
  // A phone (or a narrow window), a computer screen with the list beside the order, or a wide one with the customer too.
  const layout: Layout = !wide ? 'phone' : widest ? 'three' : 'two';
  const canEditContact = mayEditContact(selectedTenant, { role, isTenantOwner: !!user?.uid && (selectedTenant as any)?.userId === user.uid });

  const [orders, setOrders] = React.useState<any[]>([]);
  const [done, setDone] = React.useState<any[]>([]);
  const [batches, setBatches] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<OrdersTab>('pack');
  // One tag at a time narrows the list (a backorder, a gift, the shop's own tags); "waiting" is orders waiting on stock.
  const [tagOn, setTagOn] = React.useState<string>('');
  const [q, setQ] = React.useState(''); const [searching, setSearching] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  // Open an order on one of its tabs (packing it, buying its label); n tells a second ask from the first.
  const [focus, setFocus] = React.useState<{ tab: WorkTab; n: number } | null>(null);
  const openOn = (id: string, tab: WorkTab) => { setOpenId(id); setFocus((f) => ({ tab, n: (f?.n || 0) + 1 })); };
  const [shipGroup, setShipGroup] = React.useState<string[] | null>(null);   // orders shipped together (lib/ship-together)
  const [handId, setHandId] = React.useState<string | null>(null);
  const [needsOpen, setNeedsOpen] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [selecting, setSelecting] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set());
  const [shipToday, setShipToday] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const [daySheet, setDaySheet] = React.useState<'late' | 'risk' | 'carrier' | null>(null);
  const [dayBusy, setDayBusy] = React.useState('');
  const [startMessage, setStartMessage] = React.useState<{ orderId: string; text: string } | null>(null);
  const router = useRouter();
  const [recent, setRecent] = React.useState<any[]>([]);

  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const u1 = onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('stage', 'in', ACTIVE_STAGES)), (s) => { setOrders(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))); setLoading(false); }, () => setLoading(false));
    const u2 = onSnapshot(query(collection(fs, `tenants/${tenantId}/fulfillmentBatches`), where('active', '==', true)), (s) => setBatches(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setBatches([]));
    return () => { u1(); u2(); };
  }, [fs, tenantId]);
  // Orders a label has put under Needs you, shipped and closed ones included (labels nobody has scanned, voids that
  // didn't finish, boxes waiting for a new label, refunds turned down, carrier adjustments).
  const unscanned = useLabelFlagOrders(fs, tenantId);
  // DONE: the most recently finished orders and the most recently cancelled ones, newest first, each read by its own
  // date (one field each, so no index to set up). A checkout left unpaid isn't an order anyone finished.
  const [doneSent, setDoneSent] = React.useState<any[]>([]); const [doneCancelled, setDoneCancelled] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!fs || !tenantId || tab !== 'done') return;
    const col = collection(fs, `tenants/${tenantId}/retailOrders`);
    const rows = (s: any) => s.docs.map((d: any) => ({ ...(d.data() as any), id: d.id })).filter((o: any) => DONE_STAGES.includes(String(o.stage)));
    const u1 = onSnapshot(query(col, orderBy('completedAt', 'desc'), limit(80)), (s) => setDoneSent(rows(s)), () => setDoneSent([]));
    const u2 = onSnapshot(query(col, orderBy('cancelledAt', 'desc'), limit(40)), (s) => setDoneCancelled(rows(s).filter((o: any) => o.paidAt || Number(o.orderNumber) > 0)), () => setDoneCancelled([]));
    return () => { u1(); u2(); };
  }, [fs, tenantId, tab]);
  // Search reaches past those: an order number, or an email, is looked up directly.
  const [found, setFound] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!fs || !tenantId || tab !== 'done') { setFound([]); return; }
    const s = q.trim().replace(/^#/, ''); const n = /^\d{1,9}$/.test(s) ? Number(s) : 0; const email = /@/.test(s) ? s : '';
    if (!n && !email) { setFound([]); return; }
    const col = collection(fs, `tenants/${tenantId}/retailOrders`);
    const t = setTimeout(() => {
      const asks = n ? [query(col, where('orderNumber', '==', n), limit(10))] : [...new Set([email, email.toLowerCase()])].map((e) => query(col, where('customerEmail', '==', e), limit(20)));
      void Promise.all(asks.map((a) => getDocs(a).catch(() => null)))
        .then((snaps) => setFound(snaps.flatMap((x: any) => (x ? x.docs.map((d: any) => ({ ...(d.data() as any), id: d.id })) : [])).filter((o: any) => DONE_STAGES.includes(String(o.stage)))));
    }, 300);
    return () => clearTimeout(t);
  }, [fs, tenantId, tab, q]);
  React.useEffect(() => {
    const t = (o: any) => Date.parse(String(o.completedAt || o.cancelledAt || o.paidAt || o.placedAt || '')) || 0;
    const m = new Map<string, any>(); for (const o of [...doneSent, ...doneCancelled, ...found]) m.set(o.id, o);
    setDone([...m.values()].sort((a, b) => t(b) - t(a)));
  }, [doneSent, doneCancelled, found]);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const run = () => { void sweepStaleClaims(fs, tenantId).catch(() => 0); };
    run(); const t = setInterval(run, 60000); return () => clearInterval(t);
  }, [fs, tenantId]);
  // Orders packed in the last two weeks: the team's own pace, and what has gone out today (lib/ship-day).
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    // The last two weeks, for the team's pace and what went today; newest first, so a busy fortnight keeps today's.
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('packedAt', '>=', since), orderBy('packedAt', 'desc'), limit(300)), (s) => setRecent(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setRecent([]));
  }, [fs, tenantId]);
  // The team's capacity (lib/capacity), from the same 30 days the capacity screen reads, so both say the same.
  const [capHistory, setCapHistory] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    if (!fs || !tenantId) return;
    const since = new Date(Date.now() - (CAPACITY_DAYS + 1) * 864e5).toISOString();
    getDocs(query(collection(fs, `tenants/${tenantId}/retailOrders`), where('packedAt', '>=', since), orderBy('packedAt', 'desc'), limit(1500)))
      .then((s) => setCapHistory(s.docs.map((d) => d.data()))).catch(() => setCapHistory([]));
  }, [fs, tenantId]);

  const photoFor = React.useMemo(() => { const m = new Map<string, string>(); (inventory || []).forEach((i: any) => { const u = (Array.isArray(i.imageUrls) && i.imageUrls.find((x: any) => typeof x === 'string' && x.trim())) || (typeof i.imageUrl === 'string' && i.imageUrl.trim() ? i.imageUrl : ''); if (u) m.set(i.id, String(u)); }); return m; }, [inventory]);
  const shelfFor = React.useMemo(() => { const m = new Map<string, string>(); (inventory || []).forEach((i: any) => { const s = String(i.storageLocation || i.shelf || i.binLocation || '').trim(); if (s) m.set(i.id, s); }); return m; }, [inventory]);

  const byId = React.useMemo(() => new Map([...unscanned, ...done, ...orders].map((o) => [o.id, o])), [orders, done, unscanned]);
  const solo = React.useMemo(() => soloShop(staff || [], (m: any) => permissionsFor(m)), [staff]);
  const queue = React.useMemo(() => packQueue(orders, rs, now, shopZone), [orders, rs, now, shopZone]);
  const needs = React.useMemo(() => needsYou([...orders, ...unscanned.filter((u) => !orders.some((o) => o.id === u.id))], now, Math.max(1, Number(rs.readyStaleHours) || 24)), [orders, unscanned, now, rs.readyStaleHours]);
  const counts = React.useMemo(() => ({ pack: orders.filter((o) => tabOf(o) === 'pack').length, ready: orders.filter((o) => tabOf(o) === 'ready').length }), [orders]);
  // TODAY (lib/ship-day): the cutoff, the next pickup, what has to ship today, and what's late, at risk or stuck with
  // the carrier. Shown once the shop ships: a saved shipping schedule, or ship orders in play.
  const schedule = React.useMemo(() => scheduleFrom(rs), [rs]);
  const day = React.useMemo(() => {
    const today = dayKey(new Date(now), shopZone);
    const sentToday = recent.filter((o) => o.method === 'ship' && ['shipped', 'completed'].includes(String(o.stage)) && o.completedAt && dayKey(new Date(Date.parse(o.completedAt)), shopZone) === today && !o.labelFromOrderId && !o.shippedWithOrderId).length;
    return dayPicture({ orders, flagged: unscanned, recentPacked: recent, sentToday, rs, schedule, now, timeZone: shopZone });
  }, [orders, unscanned, recent, rs, schedule, now, shopZone]);
  // A coming ship day with more to pack than the team can ship goes under Needs you (lib/capacity), when the shop wants.
  const overs = React.useMemo(() => {
    if (!schedule.savedAt || !schedule.capacity.tell || !capHistory) return [];
    const today = dayKey(new Date(now), shopZone);
    // Today's packing so far comes off today's capacity; the live list has today's, the 30-day read the rest.
    return overDays(dayLoads(orders, rs, shopZone, schedule, now, teamCapacity(capHistory, now, shopZone), 5, packedOn(recent, today, shopZone)));
  }, [orders, rs, shopZone, schedule, now, recent, capHistory]);
  // CLAIMS TO FILE (lib/lost-recovered): a parcel lost, stolen from the porch or damaged that the carrier or Shippo's
  // insurance may owe the shop for, with the date to file by (Policies → Claims: "Remind me before a claim deadline").
  const claimReminders = rs.policies?.claimReminders !== false;
  const [claimRows, setClaimRows] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!fs || !tenantId || !claimReminders) { setClaimRows([]); return; }
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/inventoryExceptions`), where('recovery.status', '==', 'candidate'), limit(200)),
      (s) => setClaimRows(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), () => setClaimRows([]));
  }, [fs, tenantId, claimReminders]);
  // Their orders (shipped ones aren't in the live lists): read once each, again when the list of orders changes.
  const claimOrderKey = [...new Set(claimRows.map((r) => String(r.orderId || '')).filter(Boolean))].sort().join(',');
  const [claimOrders, setClaimOrders] = React.useState<Map<string, any>>(() => new Map());
  React.useEffect(() => {
    if (!fs || !tenantId || !claimOrderKey) { setClaimOrders(new Map()); return; }
    let live = true;
    void Promise.all(claimOrderKey.split(',').map((id) => getDoc(doc(fs, `tenants/${tenantId}/retailOrders`, id)).then((d) => (d.exists() ? { ...(d.data() as any), id: d.id } : null)).catch(() => null)))
      .then((list) => { if (live) setClaimOrders(new Map(list.filter(Boolean).map((o: any) => [o.id, o]))); });
    return () => { live = false; };
  }, [fs, tenantId, claimOrderKey]);
  const claims = React.useMemo(() => claimsToFile(claimRows, claimOrders, (v) => monthDay(v, shopZone), now, shopZone), [claimRows, claimOrders, shopZone, now]);
  const [claimId, setClaimId] = React.useState<string | null>(null);
  // A parcel gone quiet opens its choices (send a replacement, tell the customer, or wait), not the order.
  const [stalledId, setStalledId] = React.useState<string | null>(null);
  const protect = React.useMemo(() => protectionPolicy(rs), [rs]);
  // NEEDS YOU, in order: a customer outside, then claims due within a week (or past their date), then everything else
  // on the orders, then days over capacity, then the other claims to file.
  type NeedRow = { key: string; title: string; detail?: string; urgent?: boolean; go: () => void };
  const needRows: NeedRow[] = (() => {
    const stalled = (n: NeedItem) => n.kind === 'carrier' && String(byId.get(n.orderId)?.carrierIssue?.status || '') === 'STALLED';
    const fromNeed = (n: NeedItem): NeedRow => ({ key: n.key, title: n.text, detail: byId.get(n.orderId)?.customerName, go: () => (stalled(n) ? setStalledId(n.orderId) : setOpenId(n.orderId)) });
    const soon = (c: ClaimToFile) => c.due === 'soon' || c.due === 'overdue';
    const fromClaim = (c: ClaimToFile): NeedRow => ({ key: `claim-${c.exc.id}`, title: c.title, detail: c.detail, urgent: soon(c), go: () => setClaimId(c.exc.id) });
    return [
      ...needs.filter((n) => n.kind === 'outside').map(fromNeed),
      ...claims.filter(soon).map(fromClaim),
      ...needs.filter((n) => n.kind !== 'outside').map(fromNeed),
      ...overs.map((o) => ({ key: `cap-${o.day}`, title: overTitle(o, day.today, shopZone), detail: `${o.due} to pack, against about ${o.cap}. See what would help.`, go: () => router.push(`/retail-orders/capacity?over=${o.day}`) })),
      ...claims.filter((c) => !soon(c)).map(fromClaim),
    ];
  })();
  const needCount = needRows.length;
  const firstNeed = needRows[0]?.title || '';
  const busyNow = (() => { const b = schedule.savedAt ? busyOn(day.today, schedule) : null; return b && !b.auto ? b : null; })();
  const catchUp = schedule.savedAt ? schedule.busy.find((b) => b.auto && b.from <= day.today && day.today <= b.to) || null : null;
  const labelCount = React.useMemo(() => labelWork([...orders, ...unscanned]), [orders, unscanned]);
  const showToday = !!schedule.savedAt || orders.some((o) => o.method === 'ship') || day.carrier.length > 0;
  const list = React.useMemo(() => {
    const src = tab === 'done' ? done : orders.filter((o) => tabOf(o) === tab);
    const f = src.filter((o) => matchesSearch(o, q) && (!tagOn || hasTag(o, tagOn, rs)));
    if (tab === 'pack') { const order = new Map(queue.map((o, i) => [o.id, i])); return f.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)); }
    if (tab === 'ready') { const r = (o: any) => (o.stage === 'arrived' ? 0 : o.curbside?.arrivedAt ? 1 : o.method === 'ship' ? 3 : 2); return f.sort((a, b) => r(a) - r(b)); }
    return f;
  }, [tab, orders, done, q, queue, tagOn, rs]);
  // The tags on this tab's orders, for the filter (only shown when there's more than nothing to sort by).
  const tabTags = React.useMemo(() => tagChoices(tab === 'done' ? done : orders.filter((o) => tabOf(o) === tab), rs), [tab, orders, done, rs]);
  React.useEffect(() => { if (tagOn && !tabTags.some((t) => t.id === tagOn)) setTagOn(''); }, [tabTags, tagOn]);

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

  const endSelect = React.useCallback(() => { setSelecting(false); setPicked(new Set()); }, []);
  React.useEffect(() => { endSelect(); }, [tab, endSelect]);
  React.useEffect(() => { if (!selecting) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') endSelect(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [selecting, endSelect]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedOrders = React.useMemo(() => [...picked].map((id) => byId.get(id)).filter(Boolean) as any[], [picked, byId]);
  const shipPacked = orders.filter((o) => o.method === 'ship' && o.stage === 'packed' && !o.holdForReview);
  // A customer's packed orders going to the same address: suggested as one shipment; staff decide.
  const togetherGroups = React.useMemo(() => shipTogetherGroups(orders), [orders]);
  const keepSeparate = async (g: any[]) => { try { await fetch('/api/retail/ship-together', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action: 'decline', orderIds: g.map((o) => o.id) }) }); } catch { /* the card stays */ } };
  const outside = tab === 'ready' && !q ? orders.filter((o) => o.stage === 'arrived') : [];

  // ?order=<id> opens that order (with &tab=pack, ship, customer or record, on that part of it); ?ship=today opens Ship
  // today (the Labels screen's "Buy labels"); ?view=late, risk or carrier opens that Today list (an order alert's link,
  // lib/order-alerts; see ViewParam). Closing the list takes ?view off the address, so the same alert opens it again.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search); const id = q.get('order'); const t = q.get('tab');
    if (id) { if (t === 'pack' || t === 'ship' || t === 'customer' || t === 'record') openOn(id, t); else setOpenId(id); }
    if (q.get('ship') === 'today') setShipToday(true);
  }, []);
  const hadSheet = React.useRef(false);
  React.useEffect(() => {
    if (daySheet) { hadSheet.current = true; return; }
    if (!hadSheet.current) return;
    hadSheet.current = false;
    const u = new URL(window.location.href);
    if (u.searchParams.has('view')) { u.searchParams.delete('view'); router.replace(`${u.pathname}${u.search}`, { scroll: false }); }
  }, [daySheet, router]);
  // A link to an order that isn't in today's lists (an older one, from Problems, Labels or a message): opened by itself,
  // and kept live while it's open.
  const [single, setSingle] = React.useState<any | null>(null);
  const inLists = !!openId && byId.has(openId);
  React.useEffect(() => {
    if (!openId || inLists) { setSingle(null); return; }
    return onSnapshot(doc(fs, `tenants/${tenantId}/retailOrders`, openId), (d) => setSingle(d.exists() ? { ...(d.data() as any), id: d.id } : null), () => setSingle(null));
  }, [fs, tenantId, openId, inLists]);
  const open = openId ? byId.get(openId) || (single?.id === openId ? single : null) : null;
  // On a computer the first order opens beside the list: the first one that isn't someone else's to pack, so a scan at
  // this screen never lands on a colleague's order.
  React.useEffect(() => {
    if (!wide || openId || !list.length || tab === 'done') return;
    const free = list.find((o: any) => !(o.stage === 'picking' && o.claimedBy && o.claimedBy !== actor.id)) || list[0];
    setOpenId(free.id);
  }, [wide, list, openId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Packing happens inside the order (components/orders/workspace): claim it, then open it on its Pack tab.
  const beginPack = async (o: any) => {
    if (!perms.canPick) { setToast('Packing isn’t part of your role. Ask a manager to add it.'); return; }
    const r = await startPacking(fs, tenantId, o, actor);
    if (!r.ok) { feel(false); setToast(r.message); return; }
    openOn(o.id, 'pack');
  };
  // The next order to pack: the most urgent one waiting (an order in a wave walk is packed from its tote instead).
  const packNext = () => { const o = queue.find((x: any) => x.stage === 'paid' && !x.waveId); if (!o) { setToast('Nothing is waiting to be packed.'); return; } void beginPack(o); };
  const canRefund = typeof can === 'function' ? can('checkout.refund') : false;

  // THE TODAY LISTS' NEXT STEPS. A new date goes through the delay notice (one message with the date and the right to
  // cancel, lib/delay-notice); "Pack these first" moves orders to the front of the queue.
  const tellCustomer = async (o: any, revisedDate: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/retail/delay-notice', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, orderId: o.id, revisedDate }) });
      const d = await r.json().catch(() => ({}));
      return r.ok && d.sent === true;
    } catch { return false; }
  };
  const lateStep = async (it: LateItem, s: Step) => {
    const o = it.order;
    if (s.kind === 'pack') { setDaySheet(null); void beginPack(o); return; }
    if (s.kind === 'open') { setDaySheet(null); setOpenId(o.id); return; }
    if (s.kind === 'label') { setDaySheet(null); openOn(o.id, 'ship'); return; }
    setDayBusy(`${o.id}:${s.kind}`);
    try {
      if (s.kind === 'tell' && s.day) {
        const ok = await tellCustomer(o, s.day); feel(ok);
        setToast(ok ? `${firstName(o.customerName)} has the new date, with their right to cancel.` : 'That didn’t go through. They may already have this date.');
      }
    } finally { setDayBusy(''); }
  };
  const packFirst = async () => {
    const list = day.atRisk.filter((i) => i.why === 'not_started' || i.why === 'packing').map((i) => i.order);
    if (!list.length) return;
    setDayBusy('rush');
    try {
      const at = new Date().toISOString();
      await Promise.all(list.map((o) => updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, o.id), { rushAt: at, rushBy: actor.name }).catch(() => null)));
      setDaySheet(null);
      const first = list.find((o) => o.stage === 'paid');
      if (first && perms.canPick) void beginPack(first);
      else setToast(`${list.length === 1 ? 'It’s' : 'They’re'} at the front of the queue.`);
    } finally { setDayBusy(''); }
  };
  const tellAtRisk = async () => {
    const list = tellableNow(day.atRisk, Date.now());
    if (!list.length) return;
    setDayBusy('tell');
    let sent = 0;
    try { for (const i of list) if (await tellCustomer(i.order, i.tellDay)) sent++; } finally { setDayBusy(''); }
    feel(sent > 0);
    setToast(sent === list.length ? `${sent === 1 ? `${firstName(list[0].order.customerName)} has` : `${sent} customers have`} the new date.` : `${sent} of ${list.length} told. The rest already had this date, or it didn’t go through.`);
  };
  const carrierSeen = async (it: CarrierItem) => {
    setDayBusy(it.order.id);
    try { await updateDoc(doc(fs, `tenants/${tenantId}/retailOrders`, it.order.id), { 'carrierIssue.open': false, 'carrierIssue.seenAt': new Date().toISOString(), 'carrierIssue.seenBy': actor.name }); }
    catch { setToast('That didn’t save. Try again.'); } finally { setDayBusy(''); }
  };
  const openDay = (k: DayList) => { if (k === 'labels') router.push('/retail-orders/labels'); else setDaySheet(k); };

  const row = (o: any) => {
    const d = dueLine(o, rs, now, shopZone);
    const live = ['paid', 'picking', 'packed'].includes(String(o.stage));
    const addrNote = !live || o.method !== 'ship' ? ''
      : ['waiting', 'approving'].includes(String(o.addressRequest?.status)) ? 'Address change to approve'
      : o.addressConfirm?.status === 'waiting' ? `Waiting on ${firstName(o.customerName)} to confirm the address`
      : o.addressChanged && ['picking', 'packed', 'label'].includes(String(o.addressChanged.after)) && !o.labelUrl ? 'New address' : '';
    const extra = o.isTest ? 'Test order' : o.stage === 'picking' && o.claimedByName ? `${o.claimedBy === actor.id ? 'You’re' : `${firstName(o.claimedByName)} is`} packing` : o.holdForReview ? 'Held for review' : o.stage === 'cancelled' ? 'Cancelled' : o.holdUntilRestock && o.stage === 'paid' ? 'Waiting on stock' : addrNote;
    // Up to two of its tags (a backorder, a gift, the shop's own), so the row says what's different about it.
    const tg = orderTags(o, rs).filter((t) => !['test', 'tip'].includes(t.id)).slice(0, 2).map((t) => t.label);
    const on = picked.has(o.id);
    const lead = selecting
      ? <span key={on ? 'on' : 'off'} className={`${on ? 'cf-anim-pop ' : ''}grid h-11 w-11 shrink-0 place-items-center`}><span className="grid h-6 w-6 place-items-center rounded-full border-2" style={on ? { background: C.ink, borderColor: C.ink } : { borderColor: '#c7c8cc' }}>{on ? Ic.check : null}</span></span>
      : <Initials name={o.customerName} />;
    return <ListRow key={o.id} onClick={() => (selecting ? toggle(o.id) : setOpenId(o.id))} active={selecting ? on : wide && openId === o.id} lead={lead}
      title={o.customerName || 'Customer'} detail={[methodLabel(o.method, rs), `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`, extra, ...tg].filter(Boolean).join(' · ')}
      trail={<span className="shrink-0 text-[14px]" style={d.late ? { color: C.warn, fontWeight: 600 } : muted}>{tab === 'done' ? (o.stage === 'cancelled' ? 'Cancelled' : o.stage === 'shipped' ? 'Shipped' : 'Done') : d.text}</span>} />;
  };

  const nextUp = solo && tab === 'pack' && !q && queue[0] ? queue[0] : null;
  const listBody = loading ? <p className="px-4 py-10 text-center text-[15px]" style={muted}>Loading orders…</p>
    : list.length === 0 ? <Empty title={q ? 'No orders match' : tab === 'pack' ? 'Nothing to pack' : tab === 'ready' ? 'Nothing waiting' : 'No finished orders yet'} sub={q ? 'Try a name, an order number or an item.' : tab === 'pack' ? 'New orders appear here the moment they’re paid.' : tab === 'ready' ? 'Packed orders wait here for pickup, a driver or a label.' : 'Shipped, picked up and cancelled orders show here.'} />
    : (<>
      {nextUp && (
        <div className="mx-4 mt-3 rounded-3xl border-2 p-4" style={{ borderColor: C.ink }}>
          <p className="m-0 text-[13px] font-semibold" style={muted}>Next up</p>
          <div className="mt-1 flex items-start justify-between gap-2"><div><p className="m-0 text-[22px] font-light">{nextUp.customerName}</p><p className="m-0 mt-0.5 text-[14px]" style={muted}>{methodLabel(nextUp.method, rs)} · {itemCount(nextUp)} item{itemCount(nextUp) === 1 ? "" : "s"}</p></div><span className="text-[14px] font-semibold" style={dueLine(nextUp, rs, now, shopZone).late ? { color: C.warn } : muted}>{dueLine(nextUp, rs, now, shopZone).text}</span></div>
          <Btn kind="primary" className="mt-3 w-full" onClick={() => void beginPack(nextUp)}>Start packing</Btn>
        </div>)}
      {selecting && <div className="flex items-center justify-between px-4 pb-1 pt-3"><span className="text-[13px] font-semibold" style={muted}>{picked.size ? `${picked.size} of ${list.length}` : 'Tap orders to pick them'}</span><button type="button" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((o) => o.id)))} className="h-11 text-[15px] font-semibold">{picked.size === list.length ? 'Clear' : `Select all ${list.length}`}</button></div>}
      {!selecting && outside.length > 0 && <div className="px-4 pt-3"><p className="m-0 pb-2 text-[13px] font-semibold" style={muted}>Outside now</p><div className="grid gap-2.5">{outside.map((o) => <Arrival key={o.id} o={o} now={now} onOut={async () => { const r = await bringingOut(fs, tenantId, o, actor); feel(r.ok); setToast(r.ok ? `${firstName(o.customerName)} knows you’re on the way.` : r.message); }} onHand={() => setHandId(o.id)} />)}</div></div>}
      {!selecting && tab === 'ready' && !q && perms.canShip && togetherGroups.map((g) => (
        <div key={g[0].id} className="mx-4 mt-3 rounded-2xl p-4" style={{ border: `2px solid ${C.ink}` }}>
          <p className="m-0 text-[17px] font-semibold">{firstName(g[0].customerName)} has {g.length} orders going to the same address</p>
          <p className="m-0 mt-1 text-[14px]" style={muted}>{g.map((o) => `#${String(o.orderNumber ?? '').padStart(4, '0')} (${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}${o.shippingCents ? `, paid ${money(o.shippingCents)} shipping` : ''})`).join(' and ')}. Ship them in one box to save postage{(() => { const back = Object.values(togetherRefunds(g, cardRefundableCents)).reduce((s: number, c: number) => s + c, 0); return back ? `; ${money(back)} of the shipping they paid is refunded automatically` : ''; })()}.</p>
          <p className="m-0 mt-2 text-[14px]">{addressLines(g[0].shippingAddress).join(' · ')}</p>
          <div className="mt-3 flex gap-2">
            <Btn kind="primary" onClick={() => setShipGroup(g.map((o) => o.id))}>Ship together</Btn>
            <Btn kind="soft" onClick={() => void keepSeparate(g)}>Keep separate</Btn>
          </div>
        </div>))}
      {!selecting && tab === 'ready' && !q && shipPacked.length > 0 && perms.canShip && (
        <button type="button" onClick={() => setShipToday(true)} className="cf-press mx-4 mt-3 flex min-h-[64px] w-[calc(100%-2rem)] items-center gap-3 rounded-2xl px-4 text-left" style={{ background: C.soft }}>
          <span className="min-w-0 flex-1"><span className="block text-[17px] font-semibold tracking-[-0.01em]">Ship today</span><span className="block text-[14px]" style={muted}>{(() => { const nl = shipPacked.filter((o) => !o.trackingNumber && !o.labelUrl).length; return nl ? `${nl} need${nl === 1 ? 's' : ''} a label · ${shipPacked.length - nl} labeled` : `${shipPacked.length} labeled, ready to hand over`; })()}</span></span>
          <span style={muted}>{Ic.chev}</span>
        </button>)}
      {tab === 'pack' && !nextUp && <p className="m-0 px-4 pb-1 pt-4 text-[13px] font-semibold" style={muted}>Due first</p>}
      {nextUp && list.length > 1 && <p className="m-0 px-4 pb-1 pt-4 text-[13px] font-semibold" style={muted}>After this</p>}
      {(outside.length && !selecting ? list.filter((o) => o.stage !== 'arrived') : list).filter((o) => o.id !== nextUp?.id).map(row)}
    </>);

  const header = (
    <div className="px-4 pt-3">
      <div className="flex items-center justify-end gap-2 lg:hidden">
        {tab !== 'done' && list.length > 0 && <button type="button" onClick={() => (selecting ? endSelect() : setSelecting(true))} className="h-11 px-2 text-[17px] font-semibold">{selecting ? 'Done' : 'Select'}</button>}
        <IconBtn label="Search orders" onClick={() => setSearching((s) => !s)}>{Ic.search}</IconBtn>
      </div>
      <LargeTitle title="Orders" sub={`${counts.pack} to pack · ${counts.ready} ready`} />
      {wide && (<>
        <label className="mt-3 flex h-11 items-center gap-2 rounded-full border px-4" style={{ borderColor: C.line }}><span style={muted}>{Ic.search}</span><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" placeholder="Name, order number or item" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" /></label>
        <div className="mt-2.5 flex gap-2">
          {perms.canPick && !selecting && <Btn kind="primary" className="h-11 min-w-0 flex-1" onClick={packNext}>Pack the next order</Btn>}
          {tab !== 'done' && list.length > 0 && <Btn kind="soft" className="h-11" onClick={() => (selecting ? endSelect() : setSelecting(true))}>{selecting ? 'Done' : 'Select'}</Btn>}
        </div>
      </>)}
      {searching && !wide && <label className="mt-3 flex h-11 items-center gap-2 rounded-full px-4" style={{ background: C.soft }}><span style={muted}>{Ic.search}</span><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" placeholder="Name, order number or item" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" /></label>}
      {busyNow && !q && <BusyBanner period={busyNow} schedule={schedule} today={day.today} tz={shopZone} tenantId={tenantId} canEnd={isManager} onToast={setToast} />}
      {catchUp && !q && <CatchUpNote period={catchUp} today={day.today} tz={shopZone} tenantId={tenantId} canEnd={isManager} onToast={setToast} />}
      {showToday && !q && <TodayCard day={day} labels={labelCount} onOpen={openDay} canPack={perms.canPick} onPackNext={!wide && !nextUp ? packNext : undefined}
        nextShipWord={whenWord(nextShipDay(addDays(day.today, 1), schedule), day.today, shopZone)} />}
      {needCount > 0 && (
        <button type="button" onClick={() => (needCount > 1 ? setNeedsOpen(true) : needRows[0]?.go())} className="mt-3.5 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left text-[15px] font-semibold" style={{ background: C.warnSoft, color: C.warn }}>
          <span className="flex shrink-0 items-center gap-2 whitespace-nowrap"><span className={`h-2 w-2 rounded-full${needs.some((n) => n.kind === 'outside') ? ' cf-anim-pulse' : ''}`} style={{ background: C.warn }} />{needCount} need{needCount === 1 ? 's' : ''} you</span>
          <span className="flex min-w-0 items-center gap-1.5 font-medium"><span className="truncate">{firstNeed}</span>{Ic.chev}</span>
        </button>)}
      <div className="mt-3 lg:max-w-md"><Seg value={tab} onChange={(v) => { setTab(v); if (wide) setOpenId(null); }} options={[{ id: 'pack', label: `To pack ${counts.pack || ''}`.trim() }, { id: 'ready', label: `Ready ${counts.ready || ''}`.trim() }, { id: 'done', label: 'Done' }]} /></div>
      {tabTags.length > 0 && (
        <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Show only">
          {tabTags.map((t) => { const sel = tagOn === t.id; return <button key={t.id} type="button" aria-pressed={sel} onClick={() => setTagOn(sel ? '' : t.id)} className="h-9 shrink-0 rounded-full px-3.5 text-[14px] font-semibold" style={sel ? { background: C.ink, color: C.paper } : { background: C.soft, color: t.warn ? C.warn : C.ink }}>{t.label} <span style={sel ? undefined : muted}>{t.n}</span></button>; })}
        </div>)}
    </div>);

  // AN ITEM SCANNED ON THE BOARD (no order open for packing): it's counted into the order of yours that still needs it,
  // or the most urgent waiting order that needs it becomes yours, and opens on its Pack tab. Either way the scan
  // happened at the box. On someone else's order, it says whose.
  const claiming = React.useRef(new Map<string, Promise<boolean>>());
  const itemScan = async (raw: string) => {
    const v = String(raw || '').trim();
    if (v.length < 3) return;
    const numOf = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;
    // The products this code belongs to today (lib/code-lookup), so a code added after an order was placed still finds
    // it, and a listing's own code finds its variants.
    const found = lookupCode(codeBook(inventory || []), v);
    const owners = new Set<string>(found.kind === 'product' ? [String(found.item.id)] : found.kind === 'choose' ? found.variants.map((x: any) => String(x.id)) : found.kind === 'clash' ? found.items.map((x: any) => String(x.id)) : []);
    const matches = (l: any) => lineMatchesScan(l, v) || owners.has(lineProductId(l));
    const toPick = (l: any) => !['shorted', 'refunded', 'backordered'].includes(l.status) && (l.qtyScanned || 0) < (l.qtyOrdered || 0);
    // With the second scan on, a unit picked at the shelf and not yet in the box is still wanted by its order.
    const toBox = (l: any) => rs?.requirePackScan === true && l.digital !== true && (l.qtyPacked || 0) < (l.qtyOrdered || 0) - (l.qtyShorted || 0);
    const wants = (o: any) => (o.lines || []).some((l: any) => matches(l) && toPick(l));
    const wantsHere = (o: any) => (o.lines || []).some((l: any) => matches(l) && (toPick(l) || (!o.waveId && toBox(l))));
    const count = async (o: any, claimed: boolean) => {
      const r = await scanInto(fs, tenantId, o.id, v, actor, rs);
      feel(r.ok);
      setToast(r.ok ? `${claimed ? `${numOf(o)} is yours. ` : `${numOf(o)}: `}${r.name || 'Item'} counted.` : `${claimed ? `${numOf(o)} is yours. ` : ''}${r.message}`);
      openOn(o.id, 'pack');
    };
    const mineOpen = orders.find((o) => o.stage === 'picking' && o.claimedBy === actor.id && wantsHere(o));
    if (mineOpen) { await count(mineOpen, false); return; }
    const waiting = perms.canPick ? queue.find((o: any) => o.stage === 'paid' && !o.waveId && wants(o)) : null;
    if (waiting) {
      // Two items scanned back to back for the same order share one claim, and both count.
      let claim = claiming.current.get(waiting.id);
      if (!claim) {
        claim = startPacking(fs, tenantId, waiting, actor).then((r) => { if (!r.ok) { feel(false); setToast(r.message); } return r.ok; });
        claiming.current.set(waiting.id, claim);
        void claim.finally(() => setTimeout(() => claiming.current.delete(waiting.id), 4000));
      }
      if (await claim) await count(waiting, true);
      return;
    }
    const theirs = orders.find((o) => o.stage === 'picking' && o.claimedBy !== actor.id && wantsHere(o));
    if (theirs) { feel(false); setToast(`That’s for ${numOf(theirs)}, which ${theirs.claimedByName ? firstName(theirs.claimedByName) : 'someone else'} is packing.`); return; }
    feel(false); setToast('No order waiting to be packed needs that item.');
  };

  // A handheld scanner on the board: a tote tag or slip code opens that order; a shipping label is checked against its box.
  // The box in front of someone is the one whose slip (or tote) they scanned in the last two minutes: a label that isn't
  // that box's is the wrong box, and it says whose label it is instead of ticking it off. Orders shipped together share
  // their box's label (lib/ship-together), so both sides are the order holding the label, and that one is ticked off.
  // Once every label of the box in front is checked, nothing is in front any more.
  const inFront = React.useRef<{ orderId: string; at: number } | null>(null);
  const holderOf = (o: any) => { const h = o?.labelFromOrderId || o?.shippedWithOrderId; return h ? byId.get(String(h)) || o : o; };
  useWedgeScanner(async (v) => {
    const t = benchScanTarget(v, orders);
    if (!t) {
      // A tote tag, slip code or label that isn't for anything here isn't an item: say what it is.
      const tote = parseTote(v);
      if (tote) { feel(false); setToast(`Tote ${tote} is empty.`); return; }
      // The customer's order code (their order page, or the slip in the bag) for an order that's finished: looked up and
      // opened, so a return can be started on it at the counter (StartReturnSheet).
      const code = String(v).trim().match(/^clarityflow:\/\/order\/([A-Za-z0-9._-]{1,160})$/i)?.[1];
      if (code) {
        const col = collection(fs, `tenants/${tenantId}/retailOrders`);
        // A backorder or replacement shares the code with the order it came from: the order they paid on is opened (its
        // record links the others).
        const byToken = await getDocs(query(col, where('qrToken', '==', code), limit(10))).catch(() => null);
        if (!byToken) { feel(false); setToast('That order couldn’t be looked up just now. Try the scan again.'); return; }
        const rows = byToken.docs.map((d: any) => ({ ...(d.data() as any), id: d.id }));
        const hit = rows.find((o: any) => !o.parentOrderId) || rows[0] || null;
        if (hit) { feel(true); setOpenId(hit.id); setToast(`#${String(hit.orderNumber ?? '').padStart(4, '0')} is open.`); return; }
        feel(false); setToast('That order code isn’t for an order here.'); return;
      }
      if (looksLikeTracking(v)) { feel(false); setToast('That label isn’t for any box waiting to ship.'); return; }
      await itemScan(v); return;
    }
    if (t.kind === 'foreignLabel') { feel(false); setToast('That label isn’t for any box waiting to ship.'); return; }
    const numOf = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;
    if (t.kind === 'label') {
      const mine = holderOf(t.order);
      const front = inFront.current && Date.now() - inFront.current.at < 120e3 ? byId.get(inFront.current.orderId) || null : null;
      const box = front ? holderOf(front) : null;
      if (box && box.id !== mine.id) {
        feel(false);
        setToast(`Wrong box: that’s ${firstName(mine.customerName)}’s label (${numOf(mine)}). This box is ${firstName(box.customerName)}’s (${numOf(box)}).`);
        return;
      }
      const num = numOf(mine);
      const r = await markLabelChecked(fs, tenantId, mine, actor, v).catch(() => null); feel(true);
      if (box && (!r || r.done)) inFront.current = null;
      setToast(r && r.total > 1 ? (r.done ? `All ${r.total} boxes for ${num} checked. They can go out.` : `Box ${r.checked} of ${r.total} for ${num} checked. Scan the other label${r.total - r.checked > 1 ? 's' : ''}.`) : `Right box: ${num}. It can go out.`); return;
    }
    inFront.current = { orderId: t.order.id, at: Date.now() };
    feel(true); setOpenId(t.order.id); setToast(t.kind === 'tote' ? `Tote ${t.tote}: ${numOf(t.order)}` : `${numOf(t.order)} is open`);
  }, true, { layer: 'background' });

  const panel = open && (
    <OrderWorkspace key={open.id} fs={fs} tenantId={tenantId} order={open} all={orders} actor={actor} rs={rs} photoFor={photoFor} shelfFor={shelfFor}
      batch={batches.find((b) => b.id === open.batchId) || null} inventory={inventory || []} perms={perms} canRefund={canRefund} isManager={isManager} canEditContact={canEditContact}
      shopZone={shopZone} layout={layout} requestTab={focus} startMessage={startMessage && startMessage.orderId === open.id ? startMessage.text : null}
      onClose={() => { setOpenId(null); setStartMessage(null); }} onToast={setToast} onOpenOrder={(id) => setOpenId(id)} />);

  return (
    <div className="cf-settings min-h-[100dvh]" style={{ background: C.paper, color: C.ink }}>
      <React.Suspense fallback={null}><ViewParam onView={(v) => { if (v === 'late' || v === 'risk' || v === 'carrier') setDaySheet(v); }} /></React.Suspense>
      {wide ? (
        <div className="flex h-[100dvh]">
          <div className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-r pb-8 xl:w-[340px] 2xl:w-[380px]" style={{ borderColor: C.line }}>{header}<div key={tab} className="cf-stagger mt-1">{listBody}</div></div>
          <div className="min-w-0 flex-1">{panel || <Empty title="Pick an order" sub="Pack it, ship it, talk to the customer and see its whole record here." />}</div>
        </div>
      ) : (
        <div className="pb-48">{header}<div key={tab} className="cf-stagger mt-1">{listBody}</div></div>
      )}
      {!wide && !open && !selecting && <PhoneShopBar onPackNext={perms.canPick && tab === 'pack' && !nextUp && !(showToday && !q && day.ship.toGo > 0) ? packNext : undefined} problems={needs.filter((n) => n.kind !== 'outside').length} />}
      {!wide && panel}

      {shipGroup && byId.get(shipGroup[0]) && <ShipSheet fs={fs} tenantId={tenantId} order={byId.get(shipGroup[0])} together={shipGroup.slice(1).map((id) => byId.get(id)).filter(Boolean)} inventory={inventory || []} rs={rs} actor={actor} onClose={() => setShipGroup(null)} onDone={(m) => { setShipGroup(null); setToast(m); }} />}
      {handId && byId.get(handId) && <HandoverSheet fs={fs} tenantId={tenantId} order={byId.get(handId)} actor={actor} onClose={() => setHandId(null)} onDone={(m) => { setHandId(null); setToast(m); }} />}
      {selecting && <SelectBar fs={fs} tenantId={tenantId} picked={pickedOrders} actor={actor} rs={rs} perms={perms} onDone={endSelect} onToast={setToast} />}
      {shipToday && <ShipToday fs={fs} tenantId={tenantId} orders={orders} actor={actor} rs={rs} onClose={() => setShipToday(false)} onToast={setToast} />}
      {daySheet === 'late' && <LateSheet items={day.late} today={day.today} tz={shopZone} now={now} busy={dayBusy} onStep={(it, s) => void lateStep(it, s)} onClose={() => setDaySheet(null)} />}
      {daySheet === 'risk' && <RiskSheet items={day.atRisk} pickupWords={day.lastPickup ? `the ${day.lastPickup.label} pickup` : 'the end of the shipping day'}
        pace={day.pace} now={now} tz={shopZone}
        busy={dayBusy} canPack={perms.canPick} onPackFirst={() => void packFirst()} onTell={() => void tellAtRisk()} onOpenOrder={(id) => { setDaySheet(null); setOpenId(id); }} onClose={() => setDaySheet(null)} />}
      {daySheet === 'carrier' && <CarrierSheet items={day.carrier} busy={dayBusy} onSeen={(it) => void carrierSeen(it)} onClose={() => setDaySheet(null)} onStalled={(it) => { setDaySheet(null); setStalledId(it.order.id); }}
        onOpenOrder={(id) => { const it = day.carrier.find((c) => c.order.id === id); const text = it ? carrierMessage(it) : null; setStartMessage(text ? { orderId: id, text } : null); setDaySheet(null); setOpenId(id); }} />}
      {needsOpen && (
        <Sheet title={`${needCount} need you`} onClose={() => setNeedsOpen(false)} closeLabel="Done">
          <div className="mt-1">
            {needRows.map((r) => <ListRow key={r.key} onClick={() => { setNeedsOpen(false); r.go(); }} title={r.urgent ? <span style={{ color: C.warn }}>{r.title}</span> : r.title} detail={r.detail} trail={<span style={muted}>{Ic.chev}</span>} />)}
          </div>
        </Sheet>)}
      {stalledId && byId.get(stalledId) && <StalledSheet fs={fs} tenantId={tenantId} order={byId.get(stalledId)} tz={shopZone} canReplace={isManager || canRefund} insureOverCents={protect.insuranceEnabled ? protect.insuranceOverCents : null} onClose={() => setStalledId(null)} onToast={setToast} />}
      {claimId && (() => { const c = claims.find((x) => x.exc.id === claimId); return c ? <ClaimSheet fs={fs} tenantId={tenantId} exc={c.exc} order={c.order} tz={shopZone} canFile={isManager} actor={actor} onClose={() => setClaimId(null)} onToast={setToast} /> : null; })()}
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={wide ? (selecting ? 100 : 32) : selecting ? 168 : 150} />}
    </div>);
}

/** Opens a Today list named in the address (?view=late, an order alert's link) on arrival, and again whenever the
 *  address changes to name one: tapping an alert while already on Orders. */
function ViewParam({ onView }: { onView: (v: string) => void }) {
  const v = useSearchParams()?.get('view') || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (v) onView(v); }, [v]);
  return null;
}

function Arrival({ o, now, onOut, onHand }: { o: any; now: number; onOut: () => Promise<void>; onHand: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const mins = curbsideWaitMinutes(o, new Date(now)) ?? 0;
  const out = !!o.curbside?.bringingOutAt;
  return (
    <div className="cf-anim-rise rounded-2xl border-2 p-4" style={{ borderColor: mins >= 5 && !out ? C.warn : C.ink }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="m-0 truncate text-[22px] font-light">{o.customerName || 'Customer'}</p><p className="m-0 mt-0.5 text-[14px]" style={muted}>{[o.curbside?.spotOrVehicle, o.shelfSlot ? `Shelf ${o.shelfSlot}` : '', `${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
          {o.collector?.name && <p className="m-0 mt-0.5 text-[14px] font-semibold" style={{ color: C.ok }}>{o.collector.name} is collecting</p>}</div>
        <span className={`shrink-0 text-[14px] font-semibold${mins >= 5 && !out ? ' cf-anim-pulse rounded-full px-2' : ''}`} style={{ color: out ? C.ok : mins >= 5 ? C.warn : C.muted }}>{out ? 'On the way' : mins < 1 ? 'Just now' : `${mins} min`}</span>
      </div>
      <div className="mt-3 flex gap-2">
        {!out && <Btn kind="primary" className="flex-1" disabled={busy} onClick={async () => { setBusy(true); await onOut(); setBusy(false); }}>{busy ? 'Telling them…' : 'Bringing it out'}</Btn>}
        <Btn kind={out ? 'primary' : 'soft'} className="flex-1" onClick={onHand}>Hand over</Btn>
      </div>
    </div>);
}


/** Whether an order carries a tag (by its id), or is waiting on stock ("waiting"). */
function hasTag(o: any, id: string, rs: any): boolean {
  if (id === 'waiting') return o?.holdUntilRestock === true && o?.stage === 'paid';
  return orderTags(o, rs).some((t) => t.id === id);
}
/** The tags on a list of orders, with how many carry each, for the filter. */
function tagChoices(list: any[], rs: any): { id: string; label: string; n: number; warn: boolean }[] {
  const m = new Map<string, { id: string; label: string; n: number; warn: boolean }>();
  const bump = (id: string, label: string, warn: boolean) => { const x = m.get(id) || { id, label, n: 0, warn }; x.n++; m.set(id, x); };
  for (const o of list) {
    if (o?.holdUntilRestock === true && o?.stage === 'paid') bump('waiting', 'Waiting on stock', true);
    for (const t of orderTags(o, rs)) if (!['tip', 'test'].includes(t.id)) bump(t.id, t.id === 'part_backorder' ? 'Part on backorder' : t.label, t.tone === 'warn');
  }
  return [...m.values()].sort((a, b) => Number(b.warn) - Number(a.warn) || b.n - a.n).slice(0, 12);
}
