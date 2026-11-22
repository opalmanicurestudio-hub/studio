// Checks their usual (design board "Their usual"): lib/counter-usual, lib/counter-usual-server noteUsual, lib/counter-points
// earnForOrder and rewardsOn, the rewards row at the counter and the window.
// - A paid order with a regular's rewards code adds what was on it to the tally on their record, once an order.
// - A number someone only said, a staff meal, an app's order or a voided one adds nothing.
// - Ordered at least twice, it's their usual: the staff's screen shows up to three to add in one tap, never the guest's.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-usual.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret-for-codes';
const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const U = await import('../../src/lib/counter-usual');
  const { noteUsual } = await import('../../src/lib/counter-usual-server');
  const CP = await import('../../src/lib/counter-points');
  const RC = await import('../../src/lib/rewards-code');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');

  console.log('the tally');
  const latteL = { lineId: 'a', itemId: 'latte', name: 'Latte', quantity: 2, unitPrice: 6, choices: [{ groupId: 'size', group: 'Size', optionId: 'l', option: 'Large', price: 1 }, { groupId: 'milk', group: 'Milk', optionId: 'oat', option: 'Oat', price: 0.5 }], choicesText: 'Large, Oat' };
  const latteL2 = { ...latteL, lineId: 'b', quantity: 1, choices: [latteL.choices[1], latteL.choices[0]] };
  const drip = { lineId: 'c', itemId: 'drip', name: 'Drip', quantity: 1, unitPrice: 2.5, choices: [], choicesText: null };
  check('the same thing however its choices were picked', U.usualKey('latte', { size: ['l'], milk: ['oat'] }) === U.usualKey('latte', { milk: ['oat'], size: ['l'] })
    && U.usualKey('latte', { x: ['b', 'a'] }) === U.usualKey('latte', { x: ['a', 'b'] }) && U.usualKey('latte', { size: ['l'] }) !== U.usualKey('latte', { size: ['s'] }));
  const from = U.usualFrom([latteL, latteL2, drip, { lineId: 'd', itemId: 'oneoff', name: 'Cake', quantity: 1, unitPrice: 4, oneOff: true }, { lineId: 'e', itemId: 'gc', name: 'Gift card', quantity: 1, unitPrice: 25, giftCard: { amount: 25 } },
    { lineId: 'f', itemId: 'beans', name: 'Beans', quantity: 1, unitPrice: 9, weight: { amount: 0.5, unit: 'lb', per: 18, stock: 0.5 } }, { lineId: 'g', itemId: 'bad id!', name: 'X', quantity: 1, unitPrice: 1 }]);
  check('each thing on an order once (however many of it); never rung in off the menu, a gift card or a weighing', from.length === 2 && from[0].itemId === 'latte' && from[1].itemId === 'drip' && from[0].choicesText === 'Large, Oat', from);
  let tally = U.usualAdd(null, [latteL, latteL2, drip], '2026-11-01T10:00:00.000Z');
  tally = U.usualAdd(tally, [latteL], '2026-11-02T10:00:00.000Z');
  const lk = U.usualKey('latte', { size: ['l'], milk: ['oat'] });
  check('a second order counts it again, the newest time kept', tally[lk].n === 2 && tally[lk].last === '2026-11-02T10:00:00.000Z' && tally[U.usualKey('drip', {})].n === 1, tally);
  const top = U.usualTop(tally);
  check('their usual: ordered at least twice, the most first', top.length === 1 && top[0].itemId === 'latte' && top[0].n === 2 && U.usualWords(top[0]) === 'Latte, Large, Oat', top);
  let big: any = tally;
  for (let i = 0; i < 20; i++) big = U.usualAdd(big, [{ lineId: `x${i}`, itemId: `item${i}`, name: `Item ${i}`, quantity: 1, unitPrice: 1, choices: [] }], `2026-11-03T10:${String(i).padStart(2, '0')}:00.000Z`);
  check('only the few most ordered are kept on their record (the usual ones stay)', Object.keys(big).length === U.USUAL_KEEP && big[lk]?.n === 2, Object.keys(big).length);
  const many: any = {}; for (let i = 0; i < 6; i++) many[`k${i}`] = { itemId: `i${i}`, name: `I${i}`, picks: {}, choicesText: null, n: 2 + i, last: '2026-11-01' };
  many.forged = { itemId: '../x', name: 'Bad', picks: {}, choicesText: null, n: 99, last: '' };
  check('…shown in order, up to the most asked for, never a forged item', U.usualTop(many, 3).map((e) => e.itemId).join(',') === 'i5,i4,i3' && !U.usualTop(many).some((e) => e.itemId === '../x') && U.USUAL_SHOW === 3);

  console.log('kept as they pay');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, modules: { hospitality: true },
    loyalty: { on: true, earn: { mode: 'per_dollar', perDollar: 2 }, rewards: [{ id: 'five', name: '$5 off', points: 300, kind: 'amount_off', cents: 500, on: true }] } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 5, totalStock: 100,
    choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }] });
  await db.doc(`${T}/inventory/drip`).set({ type: 'refreshment', name: 'Drip', category: 'Coffee', price: 2.5, totalStock: 100 });
  await db.doc(`${T}/clients/c1`).set({ name: 'Kim Park', firstName: 'Kim', phone: '(555) 123-4567', status: 'active', loyalty: { joined: true } });
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  let n = 0;
  const order = async (adds: { itemId: string; quantity: number; choices?: any }[]) => {
    const c = (await P({ action: 'car', carKey: `carkey-us-${++n}` })).body;
    for (const a of adds) await P({ action: 'add', orderId: c.orderId, itemId: a.itemId, quantity: a.quantity, choices: a.choices || {}, tapKey: `tap-us-${n}-${a.itemId}` });
    return c.orderId as string;
  };
  const code = async () => (await RC.issueCode(db, 't1', 'c1', Date.now()))!.code;
  const usualOf = async () => (await get(`${T}/clients/c1`))?.counterUsual || {};
  const LK = U.usualKey('latte', { size: ['l'] }), DK = U.usualKey('drip', {});

  const o1 = await order([{ itemId: 'latte', quantity: 2, choices: { size: ['l'] } }, { itemId: 'drip', quantity: 1 }]);
  let r = await P({ action: 'rewardsCode', orderId: o1, code: await code() });
  check('their code on the order', r.body.ok && (await get(`${T}/counterOrders/${o1}`)).points?.verified === true, r.body);
  await P({ action: 'send', orderId: o1 });
  r = await P({ action: 'paid', orderId: o1, method: 'cash', tendered: 20 });
  let u = await usualOf();
  check('paid: what was on it is on their record, once each', r.body.ok && u[LK]?.n === 1 && u[LK].choicesText === 'Large' && u[DK]?.n === 1 && (await get(`${T}/counterOrders/${o1}`)).usualNoted === true, { r: r.body, u });
  await CP.earnForOrder(db, 't1', null, o1); await noteUsual(db, 't1', o1);
  await P({ action: 'paid', orderId: o1, method: 'cash', tendered: 20 });
  check('…paid again, or earned again: still once', (await usualOf())[LK].n === 1);

  const o2 = await order([{ itemId: 'latte', quantity: 1, choices: { size: ['l'] } }]);
  await P({ action: 'send', orderId: o2 });
  await P({ action: 'paid', orderId: o2, method: 'cash', tendered: 10 });
  await P({ action: 'rewardsCode', orderId: o2, code: await code() });
  u = await usualOf();
  check('their code given after it was paid: it counts then', u[LK]?.n === 2 && u[DK]?.n === 1 && (await get(`${T}/counterOrders/${o2}`)).usualNoted === true, u);

  const o3 = await order([{ itemId: 'drip', quantity: 1 }]);
  r = await P({ action: 'rewardsCode', orderId: o3, code: await code() });
  check('the next time they give their code: their usual comes with them, for the staff’s screen', r.body.member?.usual?.length === 1 && r.body.member.usual[0].itemId === 'latte'
    && r.body.member.usual[0].n === 2 && r.body.member.usual[0].picks.size[0] === 'l' && r.body.member.usual[0].choicesText === 'Large', r.body.member);
  r = await P({ action: 'rewards', orderId: o3 });
  check('…and when the screen asks again', r.body.member?.usual?.[0]?.itemId === 'latte', r.body);
  const picks3 = r.body.member.usual[0].picks;
  await db.doc(`${T}/inventory/latte`).set({ name: 'Oat latte', choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Big', price: 1 }] }] }, { merge: true });
  r = await P({ action: 'rewards', orderId: o3 });
  check('…in the menu’s words as they are now', r.body.member?.usual?.[0]?.name === 'Oat latte' && r.body.member.usual[0].choicesText === 'Big', r.body.member?.usual);
  await db.doc(`${T}/inventory/latte`).set({ choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }] }] }, { merge: true });
  r = await P({ action: 'rewards', orderId: o3 });
  const gone1 = r.body.member?.usual?.length === 0;
  await db.doc(`${T}/inventory/latte`).set({ choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }, { id: 'milk', name: 'Milk', required: true, options: [{ id: 'oat', name: 'Oat', price: 0 }] }] }, { merge: true });
  r = await P({ action: 'rewards', orderId: o3 });
  const gone2 = r.body.member?.usual?.length === 0;
  await db.doc(`${T}/inventory/latte`).set({ byWeight: { unit: 'lb' } }, { merge: true });
  r = await P({ action: 'rewards', orderId: o3 });
  const gone3 = r.body.member?.usual?.length === 0;
  await db.doc(`${T}/inventory/latte`).set({ name: 'Latte', byWeight: null, choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }] }, { merge: true });
  check('…not offered when its choice was taken off, it now has to have one it didn’t, or it’s sold by weight now', gone1 && gone2 && gone3, { gone1, gone2, gone3 });
  r = await P({ action: 'add', orderId: o3, itemId: 'latte', quantity: 1, choices: picks3, tapKey: 'tap-us-usual' });
  const l3 = (await get(`${T}/counterOrders/${o3}`)).lines.find((l: any) => l.itemId === 'latte');
  check('one tap adds it as they get it', r.body.ok && l3?.choicesText === 'Large' && l3.unitPrice === 6, l3);

  const o5 = await order([{ itemId: 'drip', quantity: 1 }]);
  await P({ action: 'rewardsCode', orderId: o5, code: await code() }); await P({ action: 'send', orderId: o5 });
  await P({ action: 'paid', orderId: o5, method: 'cash', tendered: 10 });
  // (As if the first answer was lost before it was noted.)
  await db.doc(`${T}/counterOrders/${o5}`).set({ usualNoted: false }, { merge: true });
  const dn = (await usualOf())[DK].n; await db.doc(`${T}/clients/c1`).set({ counterUsual: { ...(await usualOf()), [DK]: { ...(await usualOf())[DK], n: dn - 1 } } }, { merge: true });
  r = await P({ action: 'paid', orderId: o5, method: 'cash', tendered: 10 });
  check('paid already when it’s asked for again: still noted, once', r.body.ok && (await usualOf())[DK].n === dn && (await get(`${T}/counterOrders/${o5}`)).usualNoted === true, { r: r.body, n: (await usualOf())[DK] });
  await P({ action: 'paid', orderId: o5, method: 'cash', tendered: 10 });
  check('…and asked a third time, nothing more', (await usualOf())[DK].n === dn);

  console.log('what never counts');
  const before = JSON.stringify(await usualOf());
  const o4 = await order([{ itemId: 'drip', quantity: 1 }]);
  await P({ action: 'points', orderId: o4, phone: '555-123-4567' });
  await P({ action: 'send', orderId: o4 });
  await P({ action: 'paid', orderId: o4, method: 'cash', tendered: 10 });
  const d4 = await get(`${T}/counterOrders/${o4}`);
  check('a number someone only said earns points but adds nothing to their usual', d4.clientId === 'c1' && d4.points?.verified !== true && !d4.usualNoted && JSON.stringify(await usualOf()) === before, d4.points);
  const paidAt = new Date().toISOString();
  const shapes: Record<string, any> = {
    staff: { staffMeal: { for: 'Mo' }, payMethod: 'staff' }, app: { payMethod: 'app' }, voided: { status: 'voided' }, unpaid: { paidAt: null }, noclient: { clientId: null },
  };
  const said: string[] = [];
  for (const [k, extra] of Object.entries(shapes)) {
    await db.doc(`${T}/counterOrders/x_${k}`).set({ status: 'paid', paidAt, clientId: 'c1', points: { verified: true }, lines: [drip], ...extra });
    if (await noteUsual(db, 't1', `x_${k}`)) said.push(k);
  }
  check('a staff meal, an app’s order, a voided one, an unpaid one, or one with no member: nothing', said.length === 0 && JSON.stringify(await usualOf()) === before, said);
  check('an order id that isn’t one: nothing', (await noteUsual(db, 't1', '../clients/c1')) === false);

  console.log('the screens');
  const row = src('src/components/drive-thru/Rewards.tsx');
  check('the rewards row lists their usual while the order is being taken, up to three, each a 44px button', /order\.status === 'building' && onUsual/.test(row) && /slice\(0, USUAL_SHOW\)/.test(row) && /Their usual/.test(row) && /min-h-\[44px\]/.test(row));
  for (const [name, p] of [['counter', 'src/app/(app)/counter/page.tsx'], ['window', 'src/app/drive-thru/[tenantId]/page.tsx']] as const) {
    const s = src(p);
    check(`the ${name} adds it with its choices, only when it’s on the menu, not sold out and not weighed`, /usualOk=\{\(u\) => \{[^}]*!m\.off && !outWords\(m\) && !m\.byWeight && m\.onMenu; \}\}/.test(s) && /onUsual=\{\(u\) => \{[^}]*(void )?add\(m, u\.picks\); \}\}/.test(s));
  }
  check('never on the guest’s screen', !/usual/i.test(src('src/app/drive-thru/[tenantId]/window/page.tsx')) && !/usual/i.test(src('src/app/(app)/window/page.tsx')) && !/usual/i.test(src('src/app/api/counter/route.ts')));

  console.log('house style');
  for (const f of ['src/lib/counter-usual.ts', 'src/lib/counter-usual-server.ts', 'src/components/drive-thru/Rewards.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no old trade words, no comments in markup`, !/\buppercase\b|font-black| · |\{\/\*/.test(s) && !/\b(salon|stylist|booth|chair|studio)s?\b/i.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
