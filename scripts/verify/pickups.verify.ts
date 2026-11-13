// Checks the Pickups screen (components/orders/PickupsScreen, lib/pickups-view, lib/use-window-numbers,
// components/orders/use-arrival-alerts) and what it adds to the bag list, the handover and the order message route.
// - Which orders are picked up; who's here (checked in, or arrived early); who's on the way and about how far; which
//   list each order is in; the lists' order (longest wait first, soonest expected first, the packing order with whoever's
//   on the way first, held ones counted not listed), kept as the clock ticks; the short name; the one-tap message, and
//   that it counts as sent for a while once it's on the order.
// - The order message route marks the one-tap message on the order, even when only the nudge failed.
// - A line's window number: its listing's first; a failed read isn't kept.
// - The bag list shows each item's number (and says it to a screen reader), the license an order was sold on with the
//   holder's name, in amber once it's past its date, or a reminder to check one; the handover names the holder.
// - The screen: every active order kept (the lists are pickups), the list it opens on chosen once, an order that leaves
//   the lists stays open, arrivals said and escalated the same way as on Orders (one shared hook), handing over and
//   telling the customer follow the role, the buttons name the customer, the tabs are 44px, held ones point to Orders.
// - It's reached from the shop's menu and pages, and the copy follows the house rules.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pickups.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures } from './fake-db';

let db: any = makeDb();
let nudge: any = { ok: true };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { uid: 's1', name: 'Sam Cole' } }) };
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { getEmailBrand: async () => ({ shopName: 'Polished Supply' }), brandedEmail: (_b: any, h: string) => h, emailButton: () => '' });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => nudge });
  return load.call(this, request, ...rest);
};

const src = (p: string) => readFileSync(p, 'utf8');
const now = Date.parse('2026-11-13T15:00:00Z');
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const V = await import('../../src/lib/pickups-view');
  const { lineNumber } = await import('../../src/lib/use-window-numbers');

  console.log('the lists');
  check('picked up: the window, curbside, inside; not shipped, delivered or downloads', V.isPickup({ method: 'curbside' }) && V.isPickup({ method: 'in_store' }) && V.isPickup({ method: 'counter' }) && V.isPickup({})
    && !V.isPickup({ method: 'ship' }) && !V.isPickup({ method: 'delivery' }) && !V.isPickup({ method: 'digital' }));
  check('here: checked in, or arrived before it was bagged', V.isHere({ stage: 'arrived' }) && V.isHere({ stage: 'picking', curbside: { arrivedAt: ago(2) } }) && !V.isHere({ stage: 'ready' }) && !V.isHere({ stage: 'paid', curbside: { onWayAt: ago(1) } }));
  check('on the way: left and not here yet', V.onTheWay({ stage: 'paid', curbside: { onWayAt: ago(1) } }) && !V.onTheWay({ stage: 'arrived', curbside: { onWayAt: ago(9) } }) && !V.onTheWay({ stage: 'paid' }));
  check('about how far: what they said, less the time since they left; none when they didn’t say', V.minutesAway({ curbside: { onWayAt: ago(2), etaMinutes: 5 } }, now) === 3
    && V.minutesAway({ curbside: { onWayAt: ago(9), etaMinutes: 5 } }, now) === 0 && V.minutesAway({ curbside: { onWayAt: ago(2) } }, now) === null && V.minutesAway({}, now) === null);
  check('each order in one list: here first, then bagged, else to bag', V.pickupTab({ stage: 'arrived' }) === 'here' && V.pickupTab({ stage: 'picking', curbside: { arrivedAt: ago(1) } }) === 'here'
    && V.pickupTab({ stage: 'ready' }) === 'bagged' && V.pickupTab({ stage: 'paid' }) === 'bag' && V.pickupTab({ stage: 'packed' }) === 'bag' && V.BAGGED.join() === 'ready,arrived');
  const orders = [
    { id: 'h2', method: 'curbside', stage: 'arrived', readyAt: ago(30), curbside: { arrivedAt: ago(1) } },
    { id: 'h1', method: 'curbside', stage: 'picking', curbside: { arrivedAt: ago(6) } },
    { id: 'h0', method: 'curbside', stage: 'arrived', readyAt: ago(40) },
    { id: 'w1', method: 'curbside', stage: 'paid', paidAt: ago(5), curbside: { onWayAt: ago(1), etaMinutes: 10 } },
    { id: 'w2', method: 'curbside', stage: 'ready', readyAt: ago(3), curbside: { onWayAt: ago(2), etaMinutes: 4 } },
    { id: 'b1', method: 'counter', stage: 'paid', paidAt: ago(20) },
    { id: 'b2', method: 'counter', stage: 'paid', paidAt: ago(2), holdForReview: true },
    { id: 'b3', method: 'counter', stage: 'paid', paidAt: ago(2), holdUntilRestock: true },
    { id: 'r1', method: 'in_store', stage: 'ready', readyAt: ago(9) },
    { id: 's1', method: 'ship', stage: 'paid', paidAt: ago(30) },
  ];
  const L = V.pickupLists(orders, {}, now, 'UTC');
  check('here: longest wait first (one checked in without a time goes last: its wait isn’t known)', L.here.map((o) => o.id).join() === 'h1,h2,h0', L.here.map((o) => o.id));
  check('on the way: soonest expected first', L.coming.map((o) => o.id).join() === 'w2,w1', L.coming.map((o) => o.id));
  check('to bag: whoever’s on the way first, held ones counted not listed, shipping left out', L.toBag.map((o) => o.id).join() === 'w1,b1' && L.held === 2, [L.toBag.map((o) => o.id), L.held]);
  check('bagged: on the shelf longest first', L.bagged.map((o) => o.id).join() === 'r1,w2', L.bagged.map((o) => o.id));
  const later = V.pickupLists(orders, {}, now + 12 * 60_000, 'UTC');
  check('…and the lists keep their order as the clock ticks', ['here', 'coming', 'toBag', 'bagged'].every((k) => (later as any)[k].map((o: any) => o.id).join() === (L as any)[k].map((o: any) => o.id).join()));
  check('a short name for a card: first name and last initial', V.shortName('Dana Reyes') === 'Dana R.' && V.shortName('  marisol de la torres ') === 'marisol T.' && V.shortName('Cher') === 'Cher' && V.shortName('') === 'Customer' && V.shortName(null) === 'Customer');
  check('products for licensed pros on it', V.hasProsOnly({ lines: [{}, { prosOnly: true }] }) && !V.hasProsOnly({ lines: [{ prosOnly: 'yes' }] }) && !V.hasProsOnly({}));
  check('the one-tap message: their first name and how long', V.soonText({ customerName: 'Dana Reyes' }, 2) === 'Hi Dana, we’ll have it out to you in about 2 minutes.' && /about 1 minute\.$/.test(V.soonText({ customerName: 'Kim' }, 1)));
  check('a license past its date by today, and today on the device’s own calendar', V.licenseLapsed({ proLicense: { expiresOn: '2026-11-12' } }, '2026-11-13') && !V.licenseLapsed({ proLicense: { expiresOn: '2026-11-13' } }, '2026-11-13') && !V.licenseLapsed({}, '2026-11-13')
    && V.localDay(new Date(2026, 0, 5, 23, 30)) === '2026-01-05');
  check('…counts as sent for 20 minutes once it’s on the order', V.soonSent({ curbside: { soonSentAt: ago(3) } }, now) && !V.soonSent({ curbside: { soonSentAt: ago(25) } }, now) && !V.soonSent({}, now));

  console.log('the order message route');
  const { POST: MSG } = await import('../../src/app/api/retail/order-message/route');
  await db.doc('tenants/t1/retailOrders/o1').set({ orderNumber: 42, customerName: 'Dana Reyes', customerEmail: 'dana@example.com', customerPhone: '5125550101', curbside: { arrivedAt: ago(2), spotOrVehicle: 'Spot 2' } });
  let r: any = await MSG(req({ tenantId: 't1', orderId: 'o1', text: 'Hi Dana, we’ll have it out to you in about 2 minutes.', soon: true }));
  let o: any = (await db.doc('tenants/t1/retailOrders/o1').get()).data();
  check('the one-tap message is marked on the order (what was there kept)', r.status === 200 && Number.isFinite(Date.parse(o.curbside?.soonSentAt)) && o.curbside.spotOrVehicle === 'Spot 2' && o.curbside.arrivedAt === ago(2), [r, o.curbside]);
  await db.doc('tenants/t1/retailOrders/o1').set({ curbside: { soonSentAt: null } }, { merge: true });
  nudge = { ok: false };
  r = await MSG(req({ tenantId: 't1', orderId: 'o1', text: 'Hi Dana, about 5 minutes.', soon: true }));
  o = (await db.doc('tenants/t1/retailOrders/o1').get()).data();
  check('…marked even when only the nudge failed (it’s on their order page): 502, and the screen counts it sent', r.status === 502 && !!o.curbside?.soonSentAt && /r\.status === 502/.test(src('src/components/orders/PickupsScreen.tsx')), [r.status, o.curbside]);
  await db.doc('tenants/t1/retailOrders/o2').set({ orderNumber: 43, customerName: 'Kim', customerEmail: 'kim@example.com' });
  nudge = { ok: true };
  await MSG(req({ tenantId: 't1', orderId: 'o2', text: 'A note about your order.' }));
  check('…and an ordinary message doesn’t mark it', !(await db.doc('tenants/t1/retailOrders/o2').get()).data()?.curbside);

  console.log('window numbers');
  const nums = new Map([['gel', 7], ['mono', 10], ['gel-b', 99]]);
  check('a variant’s line takes its listing’s number; a product its own; none when it isn’t on the window', lineNumber(nums, { listingId: 'gel', productId: 'gel-b' }) === 7 && lineNumber(nums, { productId: 'mono' }) === 10 && lineNumber(nums, { productId: 'cot' }) === null && lineNumber(nums, {} as any) === null);
  const hook = src('src/lib/use-window-numbers.ts');
  check('…read from the window’s numbers, kept a few minutes; a failed read isn’t kept, so the next screen asks again', /action: 'numbers'/.test(hook) && /FRESH_MS = 5 \* 60_000/.test(hook) && /if \(seen\.get\(tenantId\)\?\.p === p\) seen\.delete\(tenantId\)/.test(hook) && /throw new Error/.test(hook));

  console.log('the bag list and the handover');
  const pack = src('src/components/orders/workspace/PackPane.tsx');
  check('each item shows its window number, and a screen reader hears it with the name', /const num = lineNumber\(nums, l\)/.test(pack) && /aria-hidden="true"[^>]*>\{num\}<\/span>/.test(pack) && /`No\. \$\{num\}, `/.test(pack));
  check('the license it was sold on with the holder’s name, amber once past its date, or a reminder to check one', /License on file\./.test(pack) && /License past its date\./.test(pack) && /lic\.name \?/.test(pack) && /licLapsed \? \{ background: C\.warnSoft/.test(pack)
    && /For licensed pros only\.<\/span> Check their license before you hand it over\./.test(pack));
  const hand = src('src/components/orders/HandoverSheet.tsx');
  check('the handover names the license holder (never the buyer in its place), its date, amber once it’s past, or says to check one', /the license of \$\{holder\}/.test(hand) && /'the license on file'/.test(hand) && !/\|\| order\.customerName \|\| who\}: \{stateName/.test(hand)
    && /Check the name matches\./.test(hand) && /licenseLapsed\(order, localDay\(\)\)/.test(hand) && /Check a current one before you hand it over\./.test(hand) && /check their license before you hand it over/.test(hand));
  check('…the bag list says it’s past its date only while the order’s still to go out', /!\['shipped', 'completed', 'cancelled'\]\.includes\(String\(order\.stage\)\)/.test(pack));
  check('checkout keeps the holder’s name with the license it sold on', /name: String\(lic\.name \|\| ''\)\.slice\(0, 80\)/.test(src('src/app/api/retail/checkout/route.ts')));

  console.log('the screen');
  const scr = src('src/components/orders/PickupsScreen.tsx');
  check('every active order kept (shipping ones too, for the bag list and an order’s links); only the lists are pickups', /where\('stage', 'in', ACTIVE_STAGES\)/.test(scr) && !/\.filter\(isPickup\)\); setLoading/.test(scr) && /pickupLists\(orders, rs, now, shopZone\)/.test(scr) && /all=\{orders\}/.test(scr));
  check('the list it opens on is chosen once, with the first orders, then stays where the person put it', /if \(someoneHere \|\| !\(s as any\)\.metadata\?\.fromCache\) setTab\(\(t\) => t \?\? \(someoneHere \? 'here' : 'bag'\)\)/.test(scr) && /const shown: Tab = tab \?\? 'bag'/.test(scr) && !/setTab\(here\.length/.test(scr));
  check('an order that leaves the lists stays open, live', /onSnapshot\(doc\(fs, `tenants\/\$\{tenantId\}\/retailOrders`, openId\)/.test(scr));
  const alerts = src('src/components/orders/use-arrival-alerts.ts');
  check('arrivals said and escalated after five minutes by one shared hook, here and on Orders', /useArrivalAlerts\(orders, now, tenantId,/.test(scr) && /useArrivalAlerts\(orders, now, tenantId,/.test(src('src/components/orders/OrdersApp.tsx'))
    && /notifyCurbside\(tenantId, o\.id, 'staff_escalation'\)/.test(alerts) && /ESCALATE_AFTER_MIN = 5/.test(alerts) && !/staff_escalation/.test(src('src/components/orders/OrdersApp.tsx'))
    && /if \(!isArrival\(o\) \|\| escalated\.current\.has\(o\.id\)/.test(alerts) && /\(o\) => isHere\(o\) && isPickup\(o\)\);/.test(scr));
  check('handing over, bringing it out and telling the customer follow the role', /const canHand = perms\.canPack !== false/.test(scr) && (scr.match(/if \(!canHand\) \{ notYours\(\);/g) || []).length === 3);
  check('every step through the order engine: bagging in the order’s own workspace, bringing it out, handing over', /<OrderWorkspace /.test(scr) && /bringingOut\(fs, tenantId, o, actor\)/.test(scr) && /<HandoverSheet /.test(scr));
  check('the message goes through the order message route, signed in, marked as the one-tap one', /\/api\/retail\/order-message/.test(scr) && /staffAuthHeader\(\)/.test(scr) && /soon: true/.test(scr));
  check('the card’s buttons name the customer for a screen reader, starting with what they say', /aria-label=\{`Hand over to \$\{who\}`\}/.test(scr) && /aria-label=\{`Bringing it out to \$\{who\}`\}/.test(scr) && /aria-label=\{`Message: \$\{left > 4 \? 5 : 2\} min, for \$\{who\}`\}/.test(scr));
  check('the tag says when the license is past its date', /licenseLapsed\(o, localDay\(\)\)/.test(scr) && /'license past its date'/.test(scr));
  check('held ones point to Orders', /waiting on stock or a review/.test(scr) && /href="\/retail-orders"/.test(scr));
  check('the tabs are 44px tall', /role="tab"[\s\S]{0,120}className="relative z-\[1\] min-h-11 /.test(src('src/components/orders/ui.tsx')));
  const bar = src('src/components/shared/AppSidebar.tsx');
  check('in the shop’s menu, and Orders doesn’t light up for it', /href: '\/retail-orders\/pickups', +icon: ShoppingBasket, +label: 'Pickups'/.test(bar) && /'setup', 'pickups', \.\.\.SHOP_SETUP_UNDER/.test(bar));
  check('one of the shop’s pages (it comes and goes with the shop)', /'\/retail-orders\/pickups'\]/.test(src('src/lib/modules.ts')));
  check('the page', /<PickupsScreen \/>/.test(src('src/app/(app)/retail-orders/pickups/page.tsx')));
  // (What a person reads: the screen's text and strings, not the notes in the code.)
  const copy = [scr, src('src/lib/pickups-view.ts')].join('\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const shown: string[] = [...(copy.match(/>[^<>{}]{3,}</g) || []), ...(copy.match(/'[A-Z][^']{3,}'|`[A-Z][^`]{3,}`/g) || [])];
  const words = shown.join(' ');
  check('house rules: no business-type words, no “call us”, no emoji, the real apostrophe, no all-caps or heaviest weight', !/\b(studio|salon|stylist|booth|chair)\b/i.test(words) && !/(call|contact) us/i.test(words) && !/[\u{1F300}-\u{1FAFF}]/u.test(copy)
    && !/\b(we|they|it|you|don|isn|can)'(ll|re|s|t|ve)\b/i.test(words) && !/\buppercase\b|font-black/.test(scr));
  const banned = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('no tool names', ![scr, pack, hand, hook, alerts, src('src/lib/pickups-view.ts')].some((t) => banned.some((b) => t.toLowerCase().includes(b))));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
