// scripts/verify/delivery-plan.verify.ts — Phase D, round 1 (lib/delivery-plan, lib/delivery-server, lib/geocode-server):
// zones by distance and by postal code, the fee with its minimum, free-over amount and express charge, delivery windows
// on the shop's prep time and closed days, sized by drivers on shift, the same-day cutoff, "within N minutes" only while
// a driver is free, the signed distance token, and the checkout, settings and board wiring.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/delivery-plan.verify.ts
import fs from 'fs';
import {
  areaWords, asapOffer, cleanDelivery, deliveryFee, deliveryProblems, deliveryWindows, driversOnNow, milesBetween, nextSlot, notReady, planErrors, rings,
  slotWords, zip5, zoneFor,
} from '../../src/lib/delivery-plan';
import { cleanPlan } from '../../src/lib/pickup-slots';
import { addressKey, asapBusy, milesFromToken, milesToken } from '../../src/lib/delivery-server';
import { readFeature, addressLine, preciseEnough } from '../../src/lib/geocode-server';
import { noticeDue } from '../../src/lib/retail-uncollected-policy';
import { canAdvance } from '../../src/lib/retail-orders';
import { orderStatus } from '../../src/lib/order-tags';
import { orderNow } from '../../src/lib/order-now';
import { dueLine, needsYou } from '../../src/lib/orders-view';
import { windowStart } from '../../src/lib/order-windows';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } else console.log('  ✓', m); };
const read = (p: string) => fs.readFileSync(p, 'utf8');
const tz = 'America/Los_Angeles';
const origin = { lat: 45.5152, lng: -122.6784, label: '12 Main St, Portland', source: 'address' };
const zones = [
  { id: 'n', name: 'North', upToMiles: 3, feeCents: 400, minimumCents: 2000, freeOverCents: 7500, expressCents: 600 },
  { id: 'e', name: 'East', upToMiles: 6, feeCents: 600, minimumCents: 3000, freeOverCents: 10000, expressCents: 800 },
  { id: 's', name: 'South', upToMiles: 10, feeCents: 900, minimumCents: 4000, freeOverCents: null, expressCents: null },
];
const plan = cleanDelivery({ on: true, by: 'distance', zones, origin, days: [1, 2, 3, 4, 5, 6], slots: [{ start: '14:00', end: '16:00' }, { start: '10:00', end: '12:00' }, { start: '17:00', end: '19:00' }], perWindow: 6, sameDayCutoff: '15:00', daysAhead: 3, asap: { on: true, minutes: 90 }, drivers: ['riley', 'sam'] });
const shop = cleanPlan({ hours: {}, prepMinutes: 60, closures: [{ from: '2026-10-31', to: '2026-10-31' }] });

// ── cleaning
ok(plan.slots.map((s) => s.start).join() === '10:00,14:00,17:00', 'windows are kept in order of the day');
ok(cleanDelivery({ slots: [{ start: '12:00', end: '11:00' }, { start: 'x', end: '1' }] }).slots.length === 0, 'a window that ends before it starts, or isn’t a time, is dropped');
ok(cleanDelivery({ zones: [{ id: 'a' }, { id: 'a' }] }).zones.map((z) => z.id).join() === 'a,a-2', 'zone ids stay unique, so editing one never changes another');
ok(cleanDelivery({ zones: [{ feeCents: -5, minimumCents: 'x', freeOverCents: '', expressCents: null }] }).zones[0].feeCents === 0, 'money that isn’t money is 0, never negative');
ok(cleanDelivery({ zones: [{ freeOverCents: '' }] }).zones[0].freeOverCents === null && cleanDelivery({ zones: [{ expressCents: undefined }] }).zones[0].expressCents === null, 'no free-over amount, and express not offered, unless set');
ok(cleanDelivery({ zones: [{ postalCodes: ['97204', '97204-1234', 'abc', ' 97205 '] }] }).zones[0].postalCodes.join() === '97204,97205', 'postal codes are five-digit ZIPs, once each');
ok(cleanDelivery({}).on === false && cleanDelivery({}).perWindow === 6 && cleanDelivery({ perWindow: null }).perWindow === null, 'delivery starts off; six a window unless the shop says no limit');
ok(cleanDelivery({ origin: { lat: 0, lng: 0 } }).origin === null && cleanDelivery({ origin: { lat: 91, lng: 0 } }).origin === null, 'a starting point that isn’t on the map is dropped');
ok(cleanDelivery({ asap: { on: true, minutes: 37 } }).asap.minutes === 90, '“within” minutes is one of the offered lengths');
ok(zip5('97204-1234') === '97204' && zip5('9720') === '' && zip5('97204x') === '', 'ZIP codes read as five digits');

// ── zones
ok(Math.abs(milesBetween(origin, { lat: 45.5152, lng: -122.6784 })) < 1e-9, 'no distance from the shop to itself');
const m1deg = milesBetween({ lat: 45, lng: -122 }, { lat: 46, lng: -122 });
ok(m1deg > 68.5 && m1deg < 69.5, 'a degree of latitude is about 69 miles', m1deg);
ok(rings(plan).map((z) => z.id).join() === 'n,e,s', 'rings from the inside out');
ok(areaWords(plan, plan.zones[0]) === 'Up to 3 mi' && areaWords(plan, plan.zones[1]) === '3 to 6 mi', 'areas read as rings');
const z42 = zoneFor(plan, { miles: 4.24 });
ok(z42.ok && z42.zone.id === 'e' && z42.miles === 4.2, 'an address 4.2 mi out is in the second ring', z42);
ok(zoneFor(plan, { miles: 3 }).ok && (zoneFor(plan, { miles: 3 }) as any).zone.id === 'n', 'the edge belongs to the inner ring');
ok(!zoneFor(plan, { miles: 10.1 }).ok, 'past the last ring: not delivered there');
const offEast = cleanDelivery({ ...plan, zones: zones.map((z) => (z.id === 'e' ? { ...z, on: false } : z)) });
ok(!zoneFor(offEast, { miles: 4 }).ok, 'a ring that’s off isn’t delivered to, never the next ring out instead');
ok((zoneFor(cleanDelivery({ ...plan, origin: null }), { miles: 1 }) as any).why === 'not_set', 'distance zones need a starting point');
const postal = cleanDelivery({ on: true, by: 'postal', zones: [{ id: 'a', postalCodes: ['97204', '97205'], feeCents: 500 }, { id: 'b', postalCodes: ['97210'], on: false }] });
ok(zoneFor(postal, { postal: '97205-0001' }).ok && !zoneFor(postal, { postal: '97210' }).ok && !zoneFor(postal, { postal: '99999' }).ok, 'postal zones: a listed code, not one that’s off or unlisted');
ok(areaWords(postal, cleanDelivery({ by: 'postal', zones: [{ postalCodes: ['1', '97201', '97202', '97203', '97204'] }] }).zones[0]) === '97201, 97202 and 2 more', 'a long list of codes reads short');

// ── fees
const east = plan.zones[1];
ok((deliveryFee(east, 2999) as any).minimumCents === 3000 && !deliveryFee(east, 2999).ok, 'under the zone’s minimum: no delivery, and the minimum is said');
ok(JSON.stringify(deliveryFee(east, 5000)) === JSON.stringify({ ok: true, feeCents: 600, expressCents: 0, free: false }), 'the zone’s fee');
ok((deliveryFee(east, 10000) as any).feeCents === 0 && (deliveryFee(east, 10000) as any).free, 'free from the free-over amount');
ok((deliveryFee(east, 10000, true) as any).expressCents === 800, 'free delivery still pays the express charge when it’s chosen');
ok((deliveryFee(plan.zones[2], 5000, true) as any).expressCents === 0, 'no express charge where it isn’t offered');

// ── windows (Thu Oct 29 2026, Los Angeles)
const thu1130 = Date.parse('2026-10-29T18:30:00Z');   // 11:30 am
const ws = deliveryWindows(plan, shop, thu1130, tz, { '2026-10-29D14:00': 6 });
ok(ws[0].key === '2026-10-29D14:00' && ws[0].full, 'a full window is listed, marked full');
ok(!ws.some((w) => w.key === '2026-10-29D10:00'), 'a window that started before the order could be ready isn’t offered');
ok(ws[1].key === '2026-10-29D17:00' && ws[1].left === 6 && ws[1].label === 'Today 5–7 pm', 'open windows say what’s left and read naturally', ws[1]);
ok(!ws.some((w) => w.day === '2026-10-31'), 'nothing on a day the shop is closed');
ok(!ws.some((w) => w.day === '2026-11-01'), 'nothing on a day deliveries don’t run (Sunday)');
ok(ws.every((w) => w.day < '2026-11-01'), 'only the days ahead the shop chose');
const thu1505 = Date.parse('2026-10-29T22:05:00Z');
ok(!deliveryWindows(plan, shop, thu1505, tz).some((w) => w.day === '2026-10-29'), 'after the same-day cutoff, today is gone');
const prep3h = cleanPlan({ prepMinutes: 180 });
ok(!deliveryWindows(plan, prep3h, thu1130, tz).some((w) => w.key === '2026-10-29D14:00'), 'prep time decides the first window (3 hours from 11:30 misses 2 pm)');
const withHours = cleanPlan({ hours: { 4: [{ open: '10:00', close: '12:00' }], 5: [{ open: '10:00', close: '18:00' }] }, prepMinutes: 60 });
ok(deliveryWindows(plan, withHours, thu1130, tz)[0].day === '2026-10-30', 'with opening hours set, prep counts only while open (11:30 to noon, then Friday)');
const sized = cleanDelivery({ ...plan, perDriver: 4 });
const drv = (s: number) => (new Date(s).getUTCHours() === 0 ? 2 : 1);   // two drivers for 5–7 pm (00:00 UTC), one otherwise
const wd = deliveryWindows(sized, shop, thu1130, tz, {}, drv);
ok(wd.find((w) => w.key === '2026-10-29D17:00')?.left === 6 && wd.find((w) => w.key === '2026-10-29D14:00')?.left === 4, 'sized by drivers: four each, never over the limit', wd.map((w) => [w.key, w.left]));
ok(deliveryWindows(sized, shop, thu1130, tz, {}, () => null)[0].left === 6, 'a day with no drivers on the schedule uses the limit');
ok(deliveryWindows(cleanDelivery({ ...plan, slots: [] }), shop, thu1130, tz).length === 0, 'no windows set: none offered');
// A clock change: 1:00–2:00 am on Nov 1 happens twice; 2:00 am on Mar 8 2026 doesn't happen.
const dst = cleanDelivery({ ...plan, days: [0], slots: [{ start: '02:00', end: '03:00' }], sameDayCutoff: null, daysAhead: 2 });
ok(!deliveryWindows(dst, shop, Date.parse('2026-03-07T20:00:00Z'), tz).some((w) => w.day === '2026-03-08'), 'a window at a wall time the clock skips isn’t offered that day');

// ── within minutes
const fri1100 = Date.parse('2026-10-30T18:00:00Z');
const a = asapOffer(plan, shop, plan.zones[0], fri1100, tz, 2, 1);
ok(a.ok && a.free === 1 && a.byIso === new Date(fri1100 + 90 * 60e3).toISOString(), 'offered while a driver is free, by now plus the minutes', a);
ok((asapOffer(plan, shop, plan.zones[0], fri1100, tz, 2, 2) as any).why === 'busy', 'not while every driver is out on one');
ok((asapOffer(plan, shop, plan.zones[0], fri1100, tz, null, 0) as any).why === 'drivers', 'not when the shop hasn’t said who drives');
ok((asapOffer(plan, shop, plan.zones[2], fri1100, tz, 2, 0) as any).why === 'zone', 'not in a zone that doesn’t offer it');
ok((asapOffer(plan, shop, plan.zones[0], Date.parse('2026-10-30T16:30:00Z'), tz, 2, 0) as any).why === 'hours', 'not before the first window starts');
ok((asapOffer(plan, shop, plan.zones[0], Date.parse('2026-10-31T01:00:00Z'), tz, 2, 0) as any).why === 'cutoff', 'not after the same-day cutoff');
ok((asapOffer(plan, shop, plan.zones[0], Date.parse('2026-10-31T18:00:00Z'), tz, 2, 0) as any).why === 'closed', 'not on a closed day');
ok((asapOffer(plan, prep3h, plan.zones[0], fri1100, tz, 2, 0) as any).why === 'prep', 'not when orders take longer than that to get ready');
ok((asapOffer(cleanDelivery({ ...plan, asap: { on: false } }), shop, plan.zones[0], fri1100, tz, 2, 0) as any).why === 'off', 'not when it’s off');
ok(driversOnNow([{ date: '2026-10-30', staffId: 'r', start: 600, end: 900 }, { date: '2026-10-30', staffId: 'r', start: 900, end: 1000 }, { date: '2026-10-30', staffId: 's', start: 630, end: 1000 }, { date: '2026-10-30', staffId: 'u', start: 700, end: 1000 }, { date: '2026-10-29', staffId: 't', start: 0, end: 1440 }], fri1100, tz) === 2, 'drivers on shift now: each once, today only');
const placed = (o: any) => ({ stage: 'paid', placedAt: new Date().toISOString(), ...o });
ok(asapBusy(placed({}), Date.now()) && !asapBusy(placed({ delivery: { status: 'delivered' } }), Date.now()) && !asapBusy(placed({ delivery: { status: 'failed' } }), Date.now()) && !asapBusy(placed({ stage: 'cancelled' }), Date.now()), 'a driver is busy until it’s delivered or brought back');

// ── problems
ok(planErrors(cleanDelivery({ zones: [{ upToMiles: 3 }, { upToMiles: 3 }] })).some((p) => /same distance/.test(p)), 'two rings ending at the same distance');
ok(planErrors(cleanDelivery({ by: 'postal', zones: [{ postalCodes: ['97204'] }, { postalCodes: ['97204'] }] })).some((p) => /97204 is in two zones/.test(p)), 'a postal code in two zones');
ok(planErrors(cleanDelivery({ slots: [{ start: '10:00', end: '12:00' }, { start: '11:00', end: '13:00' }] })).some((p) => /overlap/.test(p)), 'overlapping windows');
ok(notReady(cleanDelivery({}), { mapsReady: true }).length === 3, 'a new plan needs zones, a starting point and a window before it can be on');
ok(notReady(plan, { mapsReady: false }).some((p) => /aren’t available yet/.test(p)) && notReady(postal, { mapsReady: false }).every((p) => !/available/.test(p)), 'distance zones need the map; postal zones don’t');
ok(deliveryProblems(cleanDelivery({ on: false }), { mapsReady: true }).length === 0 && deliveryProblems(cleanDelivery({ on: true }), { mapsReady: true }).length > 0, 'what’s missing stops only delivery that’s on');
ok(slotWords({ start: '10:00', end: '12:00' }) === '10 am–12 pm' && slotWords({ start: '17:00', end: '19:00' }) === '5–7 pm' && slotWords({ start: '22:00', end: '24:00' }) === '10 pm–12 am', 'window times in words');
ok(JSON.stringify(nextSlot([{ start: '10:00', end: '12:00' }])) === JSON.stringify({ start: '12:00', end: '14:00' }) && nextSlot([{ start: '23:00', end: '24:00' }]).end === '24:00', 'a new window follows the last, never past midnight');

// ── the signed distance
process.env.RETAIL_QUOTE_SECRET = 'test-secret';
const addr = { line1: '88 Pine St', line2: 'Suite 400', city: 'Portland', state: 'OR', postalCode: '97204' };
const tok = milesToken('t1', addr, 4.237, origin, 1_000_000);
ok(milesFromToken('t1', { ...addr, line1: ' 88  pine st ' }, tok, origin, 1_000_001) === 4.24, 'the same address, however typed, reads its distance back');
ok(milesFromToken('t1', { ...addr, line1: '90 Pine St' }, tok, origin, 1_000_001) === null, 'another address doesn’t');
ok(milesFromToken('t2', addr, tok, origin, 1_000_001) === null, 'another shop doesn’t');
ok(milesFromToken('t1', addr, tok, { ...origin, lat: 45.6 }, 1_000_001) === null, 'a shop that moved its starting point measures again');
ok(milesFromToken('t1', addr, tok, origin, 1_000_000 + 61 * 60e3) === null, 'an hour on, it’s looked up again');
ok(milesFromToken('t1', addr, tok.replace(/^4\.24/, '1.00'), origin, 1_000_001) === null, 'a distance changed in the browser is refused');
ok(addressKey(addr) === addressKey({ ...addr, postalCode: '97204-1111', city: 'PORTLAND' }), 'the address key ignores case and ZIP+4');

// ── the map lookup
const f = readFeature({ features: [{ geometry: { coordinates: [-122.67, 45.52] }, properties: { full_address: '88 Pine St, Portland, Oregon 97204', match_code: { confidence: 'exact' }, context: { postcode: { name: '97204' } } } }] });
ok(f && f.lat === 45.52 && f.lng === -122.67 && f.postal === '97204' && preciseEnough(f), 'Mapbox’s answer: longitude first, the confidence kept', f);
ok(!preciseEnough(readFeature({ features: [{ geometry: { coordinates: [1, 2] }, properties: { match_code: { confidence: 'low' } } }] })), 'a low-confidence match isn’t used');
ok(readFeature({ features: [] }) === null && readFeature(null) === null, 'nothing found: nothing');
ok(addressLine({ line1: '88 Pine St;', city: 'Portland', state: 'OR', postalCode: '97204' }) === '88 Pine St, Portland, OR 97204', 'one line, with no semicolon (Mapbox refuses them)');
const geo = read('src/lib/geocode-server.ts');
ok(/process\.env\.MAPBOX_TOKEN/.test(geo) && /permanent=true/.test(geo) && /opts\.keep \? '&permanent=true' : ''/.test(geo), 'the key from MAPBOX_TOKEN; stored results asked for as permanent, checkout lookups not');
ok(/console\.warn\('\[geocode\] lookup refused', r\.status\)/.test(geo) && !/console\.\w+\([^)]*token/.test(geo), 'the key is never logged');

// ── wiring
const route = read('src/app/api/retail/checkout/route.ts');
ok(/method === 'delivery' \? rsEarly\.deliveryPlan\?\.on === true/.test(route), 'checkout takes delivery only while it’s on');
ok(/deliveryFor\(db, tenantId, tenant, body\.shippingAddress as any, \{ itemsCents: subtotalCents, sameCheckout: ckeyHash, token: body\.deliveryToken \}\)/.test(route), 'the fee is worked out on the server from the priced items, with this checkout’s own try not counted');
ok(/shippingCents = deliv\.feeCents \+ deliv\.expressCents/.test(route), 'the delivery fee is the order’s delivery charge');
ok(/promo\?\.freeShipping && shippingCents > 0 && method === 'ship'/.test(route), 'a free-shipping code doesn’t take off a delivery fee');
ok(/where\('deliveryWindowKey', '==', d\.window\.key\)/.test(route) && /where\('deliveryAsapAt', '>=', since\)/.test(route) && /tx\.set\(orderRef, orderData\)/.test(route), 'the window, or the drivers out, are counted in the same step the order is written');
ok(/name: deliv \? 'Driver tip' : 'Tip'/.test(route) && /tipFor: 'driver'/.test(route), 'a delivery’s tip is the driver’s');
const fulfil = read('src/app/api/retail/fulfil/route.ts');
ok(/o\.method !== 'ship' && o\.method !== 'delivery'\) sendMessage\('order_ready'/.test(fulfil), 'a delivery customer isn’t told to come and pick it up');
ok(/deliveryOut: 'handover', deliveryDone: 'handover', deliveryFailed: 'handover'/.test(fulfil), 'the delivery steps are hand-over steps');
const eng = read('src/lib/retail-fulfill.ts');
ok(/'delivery\.status': 'out'/.test(eng) && /convertSaleInTxn\(txn, fs, tenantId, order, itemSnaps, actor\);\n      const now = new Date\(\)\.toISOString\(\);\n[^\n]*\n      txn\.update\(oRef, clean\(\{\n        stage: 'completed'/.test(eng), 'delivered is the sale, as handing over is');
const ro = read('src/lib/retail-orders.ts');
ok(/order\.method === 'delivery' && \(order as any\)\.delivery\?\.status === 'out'/.test(ro), 'an order out for delivery can’t be canceled');
ok(/delivery\?\.readyBy/.test(ro), 'the team’s due time is when it has to go out');
const tips = read('src/lib/order-tips.ts');
ok(/forDriver = o\.tipFor === 'driver' && o\.method === 'delivery'/.test(tips), 'a driver tip goes to the driver');
const cat = read('src/app/api/retail/catalog/route.ts');
ok(/deliveryOffered: \(\(\) => \{ const d = deliveryFrom\(rs\); return d\.on && hasTimeZone\(tenant\) && !notReady/.test(cat), 'the shop offers delivery at checkout only when it can be used');
const page = read('src/app/shop/[tenantId]/checkout/page.tsx');
ok(/\/api\/retail\/delivery-quote/.test(page) && /deliveryWindowKey: deliveryAsap \? undefined : deliveryKey/.test(page) && /\(digitalOnlyCart \|\| method !== 'delivery' \|\| \(deliveryReady && phone\.replace\(\/\\D\/g, ''\)\.length >= 10\)\)/.test(page) && /Add a phone number so the driver can reach you/.test(route), 'checkout asks, shows and sends the delivery choice, and can’t pay without one');
ok(/promo\?\.freeShipping && method === 'ship' \? 0 : shippingCents/.test(page), 'the total shown matches: a free-shipping code doesn’t take off delivery');
const plRoute = read('src/app/api/retail/delivery-plan/route.ts');
ok(/if \(!auth\.actor\?\.isManager\) return NextResponse\.json\(\{ error: 'Only a manager can change delivery settings\.' \}, \{ status: 403 \}\)/.test(plRoute), 'only a manager changes delivery settings');
ok(/if \(problems\.length\) return \{ error: problems\[0\], status: 400 \}/.test(plRoute), 'a plan that contradicts itself, or delivery on without what it needs, isn’t saved');
ok(/patch\['retailSettings\.shippingOffered'\] = b\.ways\.shipping; patch\['retailSettings\.shippingEnabled'\] = b\.ways\.shipping/.test(plRoute), 'turning shipping on or off here moves both of its switches');
const quote = read('src/app/api/retail/delivery-quote/route.ts');
ok(/if \(n > 20\)/.test(quote) && !/left:/.test(quote.split('windows: v.windows.map')[1]?.slice(0, 120) || ''), 'the quote is rate limited, and never says how many places are left');
const scr = read('src/components/orders/DeliveryScreen.tsx');
ok(!/\{\/\*/.test(scr) && !/\{\/\*/.test(read('src/components/orders/workspace/DeliveryPane.tsx')), 'no JSX comments');
for (const f2 of ['src/lib/delivery-plan.ts', 'src/lib/delivery-server.ts', 'src/lib/geocode-server.ts', 'src/components/orders/DeliveryScreen.tsx', 'src/components/orders/workspace/DeliveryPane.tsx', 'src/app/api/retail/delivery-quote/route.ts', 'src/app/api/retail/delivery-plan/route.ts']) {
  const t = read(f2);
  const tool = new RegExp([[99, 108, 97, 117, 100, 101], [97, 110, 116, 104, 114, 111, 112, 105, 99]].map((c) => String.fromCharCode(...c)).join('|'), 'i');
  ok(!tool.test(t) && !/call us/i.test(t), `${f2.split('/').pop()}: neutral wording`);
}

// ── a delivery order everywhere it's read
{
  const ready = { method: 'delivery', stage: 'ready', readyAt: '2026-10-20T10:00:00Z', lines: [{ qtyOrdered: 1, qtyScanned: 1 }], delivery: { status: 'waiting', readyBy: '2026-10-30T21:00:00Z', window: { label: 'Fri Oct 30, 2–4 pm', start: '2026-10-30T21:00:00Z', end: '2026-10-30T23:00:00Z' } } };
  ok(noticeDue(ready, { firstHours: 1, secondHours: 2, holdDays: 7 } as any, Date.parse('2026-10-30T10:00:00Z')) === 0, 'a delivery waiting for its driver gets no “come and collect” reminders');
  ok(!canAdvance(ready as any, 'completed').ok && canAdvance({ ...ready, delivery: { status: 'out' } } as any, 'completed').ok, 'a delivery can’t be handed over at the counter: it’s completed by delivering it');
  ok(orderStatus(ready).label === 'Ready to go out' && orderStatus({ ...ready, delivery: { status: 'out' } }).label === 'Out for delivery' && orderStatus({ ...ready, delivery: { status: 'failed' } }).label === 'Brought back' && orderStatus({ ...ready, stage: 'completed' }).label === 'Delivered', 'the team’s status words for each step');
  const n0 = orderNow({ ...ready, stage: 'paid', delivery: { when: 'Fri Oct 30, 2–4 pm', status: 'waiting' } });
  ok(n0 && /deliver it on Fri Oct 30, 2–4 pm/.test(n0.body) && !/pickup|code/i.test(n0.title + n0.body), 'the customer is told when it comes, never to pick it up', n0);
  const n1 = orderNow({ ...ready, delivery: { when: 'x', status: 'out', driver: 'Riley' } });
  ok(n1?.title === 'On its way' && /Riley is bringing it/.test(n1.body), 'and when it’s on its way, by whom');
  const n2 = orderNow({ ...ready, delivery: { when: 'within 90 minutes, by 3:40 PM', status: 'waiting' } });
  ok(n2 && /deliver it within 90 minutes, by 3:40 PM/.test(n2.body), '“within minutes” reads naturally', n2?.body);
  ok(/Goes out|Missed/.test(dueLine(ready, {}, Date.parse('2026-10-30T19:00:00Z'), 'America/Los_Angeles').text) && dueLine({ ...ready, delivery: { status: 'out', driverName: 'Riley Chen' } }, {}, Date.now()).text === 'Out with Riley', 'the board’s due line follows the delivery');
  ok(dueLine(ready, {}, Date.parse('2026-10-31T01:00:00Z'), 'America/Los_Angeles').late, 'still on the shelf after its window: late');
  ok(windowStart({ method: 'delivery', completedAt: '2026-10-30T22:00:00Z', deliveredAt: '2026-10-30T22:00:00Z' })?.from === 'delivered', 'return windows count from the delivery');
  const needs = needsYou([{ ...ready, id: 'o1', customerName: 'Dana Lee' }, { ...ready, id: 'o2', customerName: 'Sam Roe', delivery: { status: 'failed', failReason: 'No one was there to take it' } }], Date.parse('2026-10-30T19:00:00Z'), 48);
  ok(!needs.some((x: any) => /collected/.test(x.text)) && needs.some((x: any) => x.orderId === 'o2' && /brought back: no one was there/.test(x.text)), 'a delivery is never “hasn’t collected”; one brought back needs someone', needs);
}
ok(/stage: 'completed', completedAt: now, deliveredAt: now, 'delivery\.status': 'delivered'/.test(read('src/lib/retail-fulfill.ts')), 'delivered stamps the delivered time where every reader looks');
ok(/d\.method === 'ship' \|\| d\.method === 'delivery' \|\| d\.readyNotifiedAt/.test(read('src/app/api/retail/ready-notify/route.ts')), 'the ready-for-pickup email refuses a delivery even when asked directly');
ok(/case 'out_for_delivery'/.test(read('src/lib/order-tracking.ts')) && /case 'delivered': return 'Delivered'/.test(read('src/lib/order-tracking.ts')), 'the live order page shows the delivery steps');
ok(/method === 'delivery'\n        \? `We will deliver it/.test(read('src/lib/retail-webhook.ts')), 'the confirmation email says when it’s delivered, not pickup');
ok(/o\.method !== 'delivery'\)\), \(\) => setOrders/.test(read('src/components/pos/desk/OrderPickup.tsx')) && /o\.method !== 'ship' && o\.method !== 'delivery'\)/.test(read('src/components/fulfilment/FulfilmentPanel.tsx')), 'deliveries stay off the pickup lists at the desk and on the floor');
const rules = read('firestore.rules');
ok(/'deliveryWindowKey', 'deliveryAsapAt', 'tipFor',\s+'shippingAddress', 'deliveredAt'\]/.test(rules) && /'handoff', 'delivery'\]/.test(rules), 'the rules lock what checkout and the delivery steps write');

if (bad) { console.error(`\n${bad} failed`); process.exit(1); }
console.log('\nall delivery checks passed');
