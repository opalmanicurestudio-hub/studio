// Checks sold out here, or at every location (design board "Sold out here or everywhere, each location's own night, and
// its own lane sensor", part 1; lib/menu-choices outWhere / outPatch, lib/menu-server readMenu / setSoldOut,
// lib/choice-sets-server setOptionSoldOut, lib/counter-orders lineFor, lib/counter-server editOrder / sendOrder, lib/kiosk,
// lib/counter-ahead, api/kitchen, api/menu, api/counter, the kitchen screen and the Menu page).
// - With more than one location, sold out is at the location it's marked at, unless it's for every location. It comes
//   back the next morning on that location's own clock.
// - Back on at one location when it was out everywhere: back there, still out at the others.
// - Guests ordering ahead, the counter, the kiosk, the speaker and the menu board at that location all see it; the other
//   locations don't.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/sold-here.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), n: 0 };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret` };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => clone(S.pis.get(id)),
    cancel: async (id: string) => { const pi = S.pis.get(id); pi.status = 'canceled'; return clone(pi); },
  };
}
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() || {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: any) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }), staffOrServer: async () => true,
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/geocode-server' || /\/src\/lib\/geocode-server(\.ts)?$/.test(request)) {
    const real = load.call(this, request, ...rest);
    return fake(request, { ...real, hasMapsKey: () => true, geocode: async () => null });
  }
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const C = await import('../../src/lib/menu-choices');
  const MS = await import('../../src/lib/menu-server');
  const HS = await import('../../src/lib/here-server');
  const CO = await import('../../src/lib/counter-orders');
  const CS = await import('../../src/lib/counter-server');
  const TT = await import('../../src/lib/tenant-time');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: KIOSK } = await import('../../src/app/api/kiosk/route');

  console.log('where it’s sold out');
  const soon = new Date(Date.now() + 3600000).toISOString(); const past = new Date(Date.now() - 60000).toISOString();
  check('out everywhere, at this location only, or not at all', C.outWhere({ soldOut: true, soldOutUntil: soon }, 'harbor') === 'everywhere' && C.outWhere({ outAt: { harbor: soon } }, 'harbor') === 'here'
    && C.outWhere({ outAt: { harbor: soon } }, 'main') === null && C.outWhere({ outAt: { harbor: soon } }) === null && C.outWhere({ outAt: { harbor: past } }, 'harbor') === null);
  const sw = (o: any) => ({ out: true, here: 'harbor', everywhere: false, until: soon, by: 'Pass', others: ['main', 'harbor', 'bay'], ...o });
  check('marked at one location: kept for that one only', JSON.stringify(C.outPatch({}, sw({}))) === JSON.stringify({ outAt: { harbor: soon } }));
  check('…for every location: out everywhere, the locations’ own cleared', (() => { const p = C.outPatch({ outAt: { harbor: soon } }, sw({ everywhere: true })); return p.soldOut === true && p.soldOutUntil === soon && p.soldOutBy === 'Pass' && JSON.stringify(p.outAt) === '{}'; })());
  const back = C.outPatch({ soldOut: true, soldOutUntil: soon }, sw({ out: false, until: null }));
  check('back at one location when it was out everywhere: back there, still out at the others until it was coming back', back.soldOut === false && back.soldOutUntil === null && back.outAt.main === soon && back.outAt.bay === soon && !('harbor' in back.outAt), back);
  check('…back everywhere: nothing out anywhere', (() => { const p = C.outPatch({ soldOut: true, soldOutUntil: soon, outAt: { main: soon } }, sw({ out: false, everywhere: true, until: null })); return p.soldOut === false && JSON.stringify(p.outAt) === '{}'; })());
  const forever = C.outPatch({ soldOut: true }, sw({ out: false, until: null }));
  check('…out everywhere with no time it comes back, back at one location: still out at the others until switched back', forever.outAt.main === C.UNTIL_BACK && forever.outAt.bay === C.UNTIL_BACK && C.outWhere({ outAt: forever.outAt }, 'main') === 'here', forever);
  check('…out at one location with no time given: out there until switched back, never dropped', C.outPatch({}, sw({ until: null })).outAt.harbor === C.UNTIL_BACK);
  check('…one past its time is dropped', JSON.stringify(C.outAtOf({ outAt: { harbor: soon, main: past, 'bad id!': soon } })) === JSON.stringify({ harbor: soon }));

  // Two locations (Harbor Rd on its own clock), a burger with a choice of side, and a shake.
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St, Riverton', coordinates: { lat: 39.9, lng: -75.0 } });
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd, Riverton', coordinates: { lat: 39.96, lng: -75.0 }, timezone: 'Pacific/Kiritimati' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 100, makeSeconds: 240,
    choices: [{ id: 'side', name: 'Side', pick: 'one', required: true, options: [{ id: 'fries', name: 'Fries', price: 0 }, { id: 'salad', name: 'Salad', price: 1 }] }] });
  await db.doc(`${T}/inventory/shake`).set({ type: 'refreshment', name: 'Shake', category: 'Drinks', price: 4, totalStock: 100 });
  HS.forgetLocations('t1');
  const kitchen = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  const keyH = (await kitchen({ action: 'pair', name: 'Pass', locationId: 'harbor' })).body.key;
  const keyM = (await kitchen({ action: 'pair', name: 'Main pass', locationId: 'main' })).body.key;
  check('two kitchen screens, one at each location', !!keyH && !!keyM);

  console.log('the kitchen screen');
  let r = await kitchen({ action: 'menu', key: keyH });
  check('the menu as Harbor Rd sees it, with its name for the switch', r.body.ok && r.body.here?.id === 'harbor' && r.body.here?.name === 'Harbor Rd', r.body);
  r = await kitchen({ action: 'soldout', key: keyH, itemId: 'burger', out: true, where: 'here' });
  const b1 = await get(`${T}/inventory/burger`);
  const harbor4 = TT.wallToUtc(TT.todayIn('Pacific/Kiritimati', new Date()), 4, 0, 'Pacific/Kiritimati').getTime() > Date.now()
    ? TT.wallToUtc(TT.todayIn('Pacific/Kiritimati', new Date()), 4, 0, 'Pacific/Kiritimati').toISOString() : TT.wallToUtc(TT.addDays(TT.todayIn('Pacific/Kiritimati', new Date()), 1), 4, 0, 'Pacific/Kiritimati').toISOString();
  check('sold out here: at Harbor Rd only, until 4 in the morning on its own clock', r.body.ok && b1.soldOut !== true && b1.outAt?.harbor === harbor4 && r.body.item.soldOut === true && r.body.item.outWhere === 'here', { outAt: b1.outAt, harbor4, item: r.body.item?.outWhere });
  const atH = (await MS.readMenu(db, 't1', 'harbor')).find((m) => m.id === 'burger'); const atM = (await MS.readMenu(db, 't1', 'main')).find((m) => m.id === 'burger');
  const atAll = (await MS.readMenu(db, 't1')).find((m) => m.id === 'burger');
  check('…Harbor Rd’s menu has it sold out; Main St’s and the business-wide one don’t', atH?.soldOut === true && atH?.outWhere === 'here' && atM?.soldOut === false && atAll?.soldOut === false && !atAll?.outWhere);
  r = await kitchen({ action: 'soldout', key: keyM, itemId: 'shake', out: true, where: 'everywhere' });
  const s1 = await get(`${T}/inventory/shake`);
  check('sold out everywhere from Main St’s screen: out at both, on the business’s clock', r.body.ok && s1.soldOut === true && s1.soldOutUntil === MS.soldOutUntil({ timezone: 'Etc/UTC' }) && r.body.item.outWhere === 'everywhere' && (await MS.readMenu(db, 't1', 'harbor')).find((m) => m.id === 'shake')?.soldOut === true);
  r = await kitchen({ action: 'soldout', key: keyH, itemId: 'shake', out: false, where: 'here' });
  const s2 = await get(`${T}/inventory/shake`);
  check('…back on at Harbor Rd: back there, still out at Main St until the morning', r.body.ok && s2.soldOut === false && s2.outAt?.main === s1.soldOutUntil && !s2.outAt?.harbor && r.body.item.soldOut === false
    && (await MS.readMenu(db, 't1', 'main')).find((m) => m.id === 'shake')?.outWhere === 'here', s2);
  r = await kitchen({ action: 'soldout', key: keyM, itemId: 'shake', out: false, where: 'everywhere' });
  check('…and back everywhere: out nowhere', r.body.ok && JSON.stringify((await get(`${T}/inventory/shake`)).outAt) === '{}' && (await MS.readMenu(db, 't1', 'main')).find((m) => m.id === 'shake')?.soldOut === false);
  r = await kitchen({ action: 'soldout', key: keyM, itemId: 'burger', groupId: 'side', optionId: 'fries', out: true, where: 'here' });
  const b2 = await get(`${T}/inventory/burger`);
  check('a choice sold out at Main St only', r.body.ok && b2.choices[0].options[0].outAt?.main && b2.choices[0].options[0].soldOut !== true && r.body.item.choices[0].options[0].outWhere === 'here', b2.choices[0].options[0]);
  check('…priced at Main St, Fries can’t be picked; at Harbor Rd (and with no location) it can', !C.priceChoices(b2, { side: ['fries'] }, 'main').ok && C.priceChoices(b2, { side: ['salad'] }, 'main').ok && C.priceChoices(b2, { side: ['fries'] }, 'harbor').ok && C.priceChoices(b2, { side: ['fries'] }).ok);

  console.log('the Menu page');
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b })) as any;
  r = await Mn({ action: 'list', locationId: 'harbor' });
  check('the list for the location picked in the app, with its name', r.body.ok && r.body.here?.name === 'Harbor Rd' && r.body.menu.find((m: any) => m.id === 'burger')?.outWhere === 'here', r.body.here);
  r = await Mn({ action: 'list' });
  check('…with no location picked: the business’s, with no switch for where', r.body.ok && r.body.here === null && r.body.menu.find((m: any) => m.id === 'burger')?.soldOut === false);
  r = await Mn({ action: 'list', locationId: 'nowhere' });
  check('…a location that isn’t one of the business’s: the business’s', r.body.ok && r.body.here === null);
  r = await Mn({ action: 'soldout', locationId: 'harbor', where: 'here', itemId: 'shake', out: true });
  check('sold out at Harbor Rd from the Menu page', r.body.ok && (await get(`${T}/inventory/shake`)).outAt?.harbor && (await get(`${T}/inventory/shake`)).soldOut !== true);
  r = await Mn({ action: 'save', itemId: 'shake', item: { name: 'Shake', price: 4.25 } });
  check('…saving the item keeps it (and a choice’s) sold out at that location', r.body.ok && (await get(`${T}/inventory/shake`)).outAt?.harbor && (await get(`${T}/inventory/shake`)).price === 4.25, r.body);
  r = await Mn({ action: 'save', itemId: 'burger', item: { name: 'Burger', price: 5, choices: [{ id: 'side', name: 'Side', pick: 'one', required: true, options: [{ id: 'fries', name: 'Fries', price: 0 }, { id: 'salad', name: 'Salad', price: 1 }] }] } });
  check('…the choice’s, too', r.body.ok && (await get(`${T}/inventory/burger`)).choices[0].options[0].outAt?.main, (await get(`${T}/inventory/burger`)).choices[0].options[0]);
  r = await Mn({ action: 'soldout', where: 'here', itemId: 'shake', out: false });
  check('…no location picked: back everywhere', r.body.ok && JSON.stringify((await get(`${T}/inventory/shake`)).outAt) === '{}');

  console.log('every place it’s ordered at that location');
  // (Burger: out at Harbor Rd. Fries: out at Main St.)
  const tenant = await get(T);
  const lh = CO.lineFor(await get(`${T}/inventory/burger`), 'burger', 1, { side: ['salad'] }, 'l1', { tenant, here: 'harbor' });
  const lm = CO.lineFor(await get(`${T}/inventory/burger`), 'burger', 1, { side: ['salad'] }, 'l1', { tenant, here: 'main' });
  const lf = CO.lineFor(await get(`${T}/inventory/burger`), 'burger', 1, { side: ['fries'] }, 'l1', { tenant, here: 'main' });
  check('an order line at Harbor Rd: the burger is sold out; at Main St it isn’t, but its Fries are', !lh.ok && /sold out/.test((lh as any).error) && lm.ok && !lf.ok, [lh, lf]);
  const who = { id: 'm1', name: 'Ana Ruiz' };
  const carH = await CS.createCar(db, 't1', tenant, 'carkey00001', who, { locationId: 'harbor' });
  const carM = await CS.createCar(db, 't1', tenant, 'carkey00002', who, { locationId: 'main' });
  const addH: any = await CS.editOrder(db, 't1', tenant, carH.orderId, { action: 'add', itemId: 'burger', choices: { side: ['salad'] } } as any);
  const addM: any = await CS.editOrder(db, 't1', tenant, carM.orderId, { action: 'add', itemId: 'burger', choices: { side: ['salad'] } } as any);
  check('the counter and lane: adding it at Harbor Rd is refused; at Main St it’s added', addH.error && /sold out/.test(addH.error) && !!addM.order && addM.order.lines.length === 1, [addH.error, addM.error]);
  await db.doc(`${T}/inventory/burger`).update({ outAt: { harbor: soon, main: soon } });
  const sent: any = await CS.sendOrder(db, 't1', tenant, carM.orderId, who);
  check('…sold out at Main St before it’s sent: it isn’t sent', sent.error && /just sold out/.test(sent.error), sent);
  await db.doc(`${T}/inventory/burger`).update({ outAt: { harbor: soon } });
  const sent2: any = await CS.sendOrder(db, 't1', tenant, carM.orderId, who);
  check('…back at Main St (still out at Harbor Rd): sent', sent2.ok === true, sent2);

  const keyLane = (await kitchen({ action: 'pair', name: 'Lane', kind: 'drive-thru', locationId: 'harbor' })).body.key;
  const keyLaneM = (await kitchen({ action: 'pair', name: 'Lane 2', kind: 'drive-thru', locationId: 'main' })).body.key;
  const boardH: any = await LANE(req({ tenantId: 't1', key: keyLane, action: 'menuBoard' }));
  const boardM: any = await LANE(req({ tenantId: 't1', key: keyLaneM, action: 'menuBoard' }));
  const onBoard = (b: any) => (b.body.sections || []).flatMap((s: any) => s.items).find((i: any) => i.id === 'burger');
  check('the menu board at each location shows its own', onBoard(boardH)?.soldOut === true && onBoard(boardM)?.soldOut === false, [boardH.body.error, boardM.body.error]);

  const keyK = (await kitchen({ action: 'pair', name: 'Kiosk', kind: 'kiosk', locationId: 'harbor' })).body.key;
  const keyKM = (await kitchen({ action: 'pair', name: 'Kiosk 2', kind: 'kiosk', locationId: 'main' })).body.key;
  const kH: any = await KIOSK(req({ tenantId: 't1', key: keyK, action: 'menu' })); const kM: any = await KIOSK(req({ tenantId: 't1', key: keyKM, action: 'menu' }));
  const onKiosk = (b: any) => (b.body.sections || []).flatMap((s: any) => s.items).find((i: any) => i.id === 'burger');
  check('the kiosk at each location shows its own', onKiosk(kH)?.soldOut === true && onKiosk(kM)?.soldOut === false, [kH.body.error, kM.body.error]);

  await Mn({ action: 'ahead', on: true });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b })) as any;
  const mh = await A({ action: 'menu', place: 'harbor' }); const mm = await A({ action: 'menu', place: 'main' });
  const onAhead = (b: any) => (b.body.sections || []).flatMap((s: any) => s.items).find((i: any) => i.id === 'burger');
  check('ordering ahead: picked Harbor Rd, it’s sold out; picked Main St, it isn’t', onAhead(mh)?.soldOut === true && onAhead(mm)?.soldOut === false, [mh.body.error, mm.body.error, onAhead(mh)]);
  const lines = [{ itemId: 'burger', quantity: 1, choices: { side: ['salad'] } }];
  const ph = await A({ action: 'place', key: 'soldkey0001', name: 'Maya', way: 'inside', lines, place: 'harbor' });
  const pm = await A({ action: 'place', key: 'soldkey0002', name: 'Dee', way: 'inside', lines, place: 'main' });
  check('…placing it at Harbor Rd is refused; at Main St it’s placed', ph.body.ok === false && /sold out/.test(ph.body.error) && pm.body.ok === true, [ph.body, pm.body.error]);

  console.log('a choice set on more than one item');
  await db.doc(`${T}/choiceSets/sides`).set({ name: 'Sides', pick: 'one', required: true, options: [{ id: 'chips', name: 'Chips', price: 0 }, { id: 'slaw', name: 'Slaw', price: 0 }] });
  for (const id of ['wrap', 'melt']) await db.doc(`${T}/inventory/${id}`).set({ type: 'refreshment', name: id === 'wrap' ? 'Wrap' : 'Melt', category: 'Food', price: 6, totalStock: 50, choiceSetIds: ['sides'],
    choices: [{ id: 'sides', setId: 'sides', name: 'Sides', pick: 'one', required: true, options: [{ id: 'chips', name: 'Chips', price: 0 }, { id: 'slaw', name: 'Slaw', price: 0 }] }] });
  r = await kitchen({ action: 'soldout', key: keyH, itemId: 'wrap', groupId: 'sides', optionId: 'chips', out: true, where: 'here' });
  const melt = await get(`${T}/inventory/melt`);
  check('a choice from a set sold out at Harbor Rd: on every item with that set, at Harbor Rd only', r.body.ok && melt.choices[0].options[0].outAt?.harbor && melt.choices[0].options[0].soldOut !== true && (await get(`${T}/choiceSets/sides`)).options[0].outAt?.harbor, melt.choices[0].options[0]);
  r = await kitchen({ action: 'soldout', key: keyM, itemId: 'wrap', groupId: 'sides', optionId: 'chips', out: true, where: 'everywhere' });
  check('…then everywhere: out at both', r.body.ok && (await get(`${T}/inventory/melt`)).choices[0].options[0].soldOut === true && JSON.stringify((await get(`${T}/inventory/melt`)).choices[0].options[0].outAt) === '{}');

  console.log('one location');
  await db.doc(`${T}/locations/harbor`).update({ isActive: false }); HS.forgetLocations('t1');
  r = await kitchen({ action: 'menu', key: keyM });
  check('with one location: no switch for where, and the burger out at a location closed since isn’t out', r.body.ok && r.body.here === null && r.body.menu.find((m: any) => m.id === 'burger')?.soldOut === false, r.body.here);
  r = await kitchen({ action: 'soldout', key: keyM, itemId: 'shake', out: true, where: 'here' });
  check('…sold out from the kitchen screen is everywhere, as before', r.body.ok && (await get(`${T}/inventory/shake`)).soldOut === true);

  console.log('the screens');
  const kds = src('src/app/kds/[tenantId]/page.tsx'); const page = src('src/app/(app)/menu/page.tsx');
  check('the kitchen screen: Here or Every location, each switch for the place picked, and what each says', /\['here', `Here, \$\{here\.name \|\| 'this location'\}`\], \['everywhere', 'Every location'\]/.test(kds) && /where: here \? where : 'everywhere'/.test(kds)
    && kds.includes("', sold out here'") && kds.includes("', sold out everywhere'") && /sw\(isOn\(m\)/.test(kds) && kds.includes('Back on here, when it was out everywhere: back here, still out at the others.'));
  check('the Menu page: the location picked in the app, the same choice, and the team’s sheet says where it shows', /action: 'list', locationId: pickedLocation\(\)/.test(page) && /locationId: here\.id, where/.test(page) && /'Every location'/.test(page) && /Sold out shows straight away at \$\{here\.name/.test(page) && /<Switch on=\{isOn\(m\)\}/.test(page));
  check('each place reads its own location’s', /readMenu\(db, tenantId, here\)/.test(src('src/lib/kiosk.ts')) && /readMenu\(db, tenantId, place\?\.id \|\| null\)/.test(src('src/lib/counter-ahead.ts')) && /readMenu\(db, tenantId, String\(\(claim as any\)\.car\?\.locationId \|\| ''\) \|\| here\)/.test(src('src/app/api/counter/voice/route.ts'))
    && /const boardKey = `\$\{tenantId\}\|\$\{here \|\| ''\}`/.test(src('src/app/api/counter/route.ts')) && /const menuKey = `\$\{tenantId\}\|\$\{place\?\.id \|\| ''\}`/.test(src('src/lib/counter-ahead.ts')));
  const menuRoute = src('src/app/api/menu/route.ts');
  check('the Menu page’s counts never lower one sold out at this location; a save answers as this location sees it; the speaker’s assistant reads the order’s location',
    menuRoute.includes("m.soldOut = r.soldOut || m.outWhere === 'here'") && menuRoute.includes('menuItemNow(db, tenantId, itemId, r.raw, soldHere)') && /action: 'save', itemId: editing\.id, item: patch, \.\.\.\(here \? \{ locationId: here\.id \} : \{\}\)/.test(page)
    && src('src/app/api/counter/assistant/route.ts').includes("readMenu(db, tenantId, String(order.locationId || '') || null)"));
  const strings = [kds.slice(kds.indexOf('function SoldOutSheet'), kds.indexOf('function CountsSheet')), page].join('\n');
  check('house style', !/ · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(strings) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(strings) && !/[\u{1F300}-\u{1FAFF}]/u.test(strings));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
