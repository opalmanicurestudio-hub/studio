// Checks food cost and what the counts find (L20 round 13, design canvas "Food cost"): lib/food-cost (each item's cost
// to make from its recipe, a stretch's cost against its sales, what counts found, what was thrown away), lib/recipe-stock-
// server (a made dish uses up its ingredients), api/kitchen (a table's, the desk's and an event's tickets take their
// ingredients once, when made; a held batch's portions and what's thrown out), api/tab (a started dish voided or made
// again is waste, at its recipe's cost), lib/stock-count (a first count is where history starts), api/food-cost, the
// Menu page's cost lines, and the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/food-cost.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
function StripeMock(this: any) { return { paymentIntents: { retrieve: async () => { throw new Error('no card here'); } } }; }
let db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager, role: manager ? 'manager' : 'staff' }, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const near = (a: number | null | undefined, b: number, e = 0.006) => typeof a === 'number' && Math.abs(a - b) < e;
const nowIso = () => new Date().toISOString();

// Ingredients as Inventory keeps them, and the menu made from them.
const MILK = { name: 'Whole milk', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 4.5, totalStock: 2, partialContainerSize: 0, container: 'gallon' };
const BEANS = { name: 'Espresso beans', type: 'professional', costingMethod: 'size', size: 1000, unit: 'g', costPerUnit: 18, totalStock: 3, partialContainerSize: 0, typicalCost: true, countStock: true, createdVia: 'food-starter', container: 'bag' };
const AVO = { name: 'Avocado', type: 'professional', costPerUnit: 2.5, totalStock: 20, unit: 'units' };
const BREAD = { name: 'Sourdough', type: 'professional', costingMethod: 'uses', estimatedUses: 20, useUnit: 'slices', costPerUnit: 4, totalStock: 0, typicalCost: true, countStock: false, createdVia: 'food-starter', container: 'loaf' };
const FREE = { name: 'Cookie dough', type: 'professional', costPerUnit: 0, totalStock: 5 };
const LATTE = { name: 'Latte', type: 'refreshment', price: 5, isActive: true, category: 'Coffee', formula: [{ id: 'beans', name: 'Espresso beans', quantityUsed: 18, unit: 'g' }, { id: 'milk', name: 'Whole milk', quantityUsed: 240, unit: 'ml' }] };
const TOAST = { name: 'Avocado toast', type: 'refreshment', price: 4.5, isActive: true, category: 'Food', formula: [{ id: 'avo', name: 'Avocado', quantityUsed: 0.5, unit: 'each' }, { id: 'bread', name: 'Sourdough', quantityUsed: 2, unit: 'slices' }], recipeGaps: ['Olive oil'] };
const SODA = { name: 'Sparkling water', type: 'refreshment', price: 2.5, costPerUnit: 0.6, isActive: true, category: 'Drinks' };
const COOKIE = { name: 'Cookie', type: 'refreshment', price: 3, isActive: true, category: 'Food', formula: [{ id: 'dough', name: 'Cookie dough', quantityUsed: 1, unit: 'each' }] };
const CROISSANT = { name: 'Croissant', type: 'refreshment', price: 0, isActive: true, showInConcierge: false, createdVia: 'food-starter', category: 'Pastry', formula: [{ id: 'bread', name: 'Sourdough', quantityUsed: 1, unit: 'slices' }] };
async function seed() {
  await db.doc(T).set({ id: 't1', name: 'Linden Café', niche: 'hospitality' });
  for (const [id, x] of Object.entries({ milk: MILK, beans: BEANS, avo: AVO, bread: BREAD, dough: FREE, latte: LATTE, toast: TOAST, soda: SODA, cookie: COOKIE, croissant: CROISSANT, shampoo: { name: 'Shampoo', type: 'retail', price: 20, costPerUnit: 8 } }))
    await db.doc(`${T}/inventory/${id}`).set({ id, ...x });
}
const moves = async (productId: string, type?: string) => (await all(`${T}/stockCorrections`)).filter((e: any) => e.productId === productId && (!type || e.type === type));

(async () => {
  const F = await import('../../src/lib/food-cost');
  console.log('what each item costs to make');
  const parts = new Map<string, any>(Object.entries({ milk: MILK, beans: BEANS, avo: AVO, bread: BREAD, dough: FREE }));
  check('the share an item should cost: 30% unless the business set its own (10% to 60%), typed as a percent or a share', F.targetOf({}) === 0.3 && F.targetOf({ foodCost: { target: 0.28 } }) === 0.28 && F.targetOf({ foodCost: { target: 0.9 } }) === 0.3
    && F.cleanTarget('35%') === 0.35 && F.cleanTarget(0.25) === 0.25 && F.cleanTarget(80) === null && F.cleanTarget('x') === null);
  const latte = F.itemCost('latte', LATTE, parts, 0.3);
  check('a latte: its beans and milk at what each costs per gram and per ml', near(latte.cost, 18 * 18 / 1000 + 240 * 4.5 / 3785, 0.0002) && latte.byRecipe && latte.lines.length === 2 && near(latte.share, latte.cost! / 5) && !latte.over && latte.fix === null, latte);
  check('…its beans are still at a typical price, so it says so', latte.typical && latte.lines.find((l) => l.id === 'beans')!.typical && !latte.lines.find((l) => l.id === 'milk')!.typical);
  const toast = F.itemCost('toast', TOAST, parts, 0.3);
  check('avocado toast is over 30%: the price that brings it back (to the quarter), and its biggest part', near(toast.cost, 1.25 + 0.4) && toast.over && toast.fix === 5.5 && toast.biggest?.name === 'Avocado' && near(toast.biggest?.cost, 1.25), toast);
  check('…and the starter’s ingredient measured another way, to add to the recipe', toast.missing.join() === 'Olive oil');
  const soda = F.itemCost('soda', SODA, parts, 0.3); const cookie = F.itemCost('cookie', COOKIE, parts, 0.3); const croissant = F.itemCost('croissant', CROISSANT, parts, 0.3);
  check('a bought item sold as it comes costs what one costs', soda.cost === 0.6 && !soda.byRecipe && near(soda.share, 0.24));
  check('an ingredient with no cost: no cost to make, never a wrong one, and why', cookie.cost === null && cookie.share === null && cookie.gaps[0]?.name === 'Cookie dough' && cookie.gaps[0]?.why === 'no cost');
  check('a starter item at no price yet: its cost, and it needs a price', near(croissant.cost, 0.2) && croissant.needsPrice && croissant.share === null && !croissant.over);
  check('an item whose ingredient was deleted says so', F.itemCost('x', { ...LATTE, formula: [{ id: 'gone', quantityUsed: 1 }] }, parts, 0.3).gaps[0]?.why === 'not in Inventory any more');

  console.log('a stretch: what sold, and what it cost to make');
  const costs = new Map([['latte', latte], ['toast', toast], ['cookie', cookie], ['soda', soda]]);
  const days = ['2026-11-09', '2026-11-10'];
  const pc = F.periodCost([
    { itemId: 'latte', qty: 2, amount: 10, at: '2026-11-09T15:00:00Z' }, { itemId: 'toast', qty: 1, amount: 4.5, at: '2026-11-10T15:00:00Z' },
    { itemId: 'cookie', qty: 2, amount: 6, at: '2026-11-10T16:00:00Z' }, { itemId: 'gone', qty: 1, amount: 3, at: '2026-11-10T16:00:00Z' }, { itemId: 'soda', qty: 0, amount: 2.5, at: '2026-11-10T16:00:00Z' },
  ], costs, days, (iso) => iso.slice(0, 10));
  check('sold in all, and the share is of what has a known cost', pc.sold === 23.5 && pc.covered === 14.5 && near(pc.cost, 2 * latte.cost! + toast.cost!) && near(pc.share, (2 * latte.cost! + toast.cost!) / 14.5, 0.0001), pc);
  check('…what has no cost is left out and named, an item no longer on the menu included', pc.uncovered === 9 && pc.uncoveredItems.includes('Cookie') && pc.uncoveredItems.includes('An item no longer on the menu'));
  check('…day by day', pc.days.length === 2 && pc.days[0].sold === 10 && near(pc.days[0].share, latte.cost! / 5, 0.0001) && pc.days[1].sold === 4.5 && near(pc.days[1].cost, toast.cost!));
  check('…by item, best sellers first', pc.items[0].id === 'latte' && pc.items[0].qty === 2 && pc.items.find((x) => x.id === 'cookie')!.cost === null);
  check('the stretches: this week from Monday, last week, the last 30 days', F.periodDays('week', '2026-11-14').join() === '2026-11-09,2026-11-10,2026-11-11,2026-11-12,2026-11-13,2026-11-14'
    && F.periodDays('week', '2026-11-09').join() === '2026-11-09' && F.periodDays('last', '2026-11-14')[0] === '2026-11-02' && F.periodDays('last', '2026-11-14').length === 7 && F.periodDays('last', '2026-11-14')[6] === '2026-11-08'
    && F.periodDays('30', '2026-11-14').length === 30 && F.periodDays('30', '2026-11-14')[29] === '2026-11-14' && F.cleanPeriod('x') === 'week' && F.cleanPeriod('30') === '30');

  console.log('what the counts found');
  const rows = F.countRows([
    { productId: 'milk', date: '2026-11-14T10:00:00Z', change: -3000 }, { productId: 'milk', date: '2026-11-12T10:00:00Z', change: 500 },
    { productId: 'beans', date: '2026-11-13T10:00:00Z', change: -1500 }, { productId: 'bread', date: '2026-11-13T10:00:00Z', change: 40, baseline: true },
    { productId: 'dough', date: '2026-11-13T10:00:00Z', change: -2 }, { productId: 'other', date: '2026-11-13T10:00:00Z', change: -9 },
  ], parts, new Map([['avo', '2026-11-13T09:00:00Z'], ['milk', '2026-11-01T00:00:00Z']]));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  check('each count’s difference added up, priced at what it costs, with when it was last counted', byId.milk.change === -2500 && near(byId.milk.value, 2500 * 4.5 / 3785) && byId.milk.last === '2026-11-14T10:00:00Z' && near(byId.beans.value, 27), rows);
  check('…biggest loss first; one with no cost after; a first count last; an ingredient not used is left out', rows[0].id === 'beans' && rows[1].id === 'milk' && byId.dough.value === null && rows[rows.length - 1].id === 'bread' && byId.bread.first && !byId.other);
  check('…an ingredient counted at what the record said, with nothing written, matches', byId.avo.change === 0 && byId.avo.value === 0 && F.countWords(byId.avo) === 'Matches');
  check('in words: litres and kilograms, more gone or more on the shelf, a first count', F.countWords(byId.milk) === '2.5 L more gone than sold' && F.countWords(byId.beans) === '1.5 kg more gone than sold'
    && F.countWords({ change: 3, unit: 'units', first: false }) === '3 units more on the shelf than expected' && F.countWords({ change: -1, unit: 'each', first: false }) === '1 unit more gone than sold' && F.countWords(byId.bread) === 'First count'
    && F.amountWords(240, 'ml') === '240 ml' && F.amountWords(2, 'slices') === '2 slices');
  const w = F.wasteOf([{ kind: 'remake', wasteCost: 1.2 }, { kind: 'void_item', wasteCost: 0.61 }, { kind: 'void_item', wasteCost: null }, { kind: 'comp', wasteCost: 9 }], [{ itemId: 'toast', qty: 3 }, { itemId: 'cookie', qty: 2 }], costs);
  check('thrown away: remakes and voids as recorded, and held batches at what each costs to make', w.remakes === 1.2 && w.voids === 0.61 && near(w.batches, 3 * 1.65) && near(w.total, 1.2 + 0.61 + 4.95), w);
  const w2 = F.wasteOf([], [], costs, [{ itemId: 'latte', qty: 2 }, { itemId: 'cookie', qty: 1 }]);
  check('…a counter order voided after it was made: what was made, at what it costs to make', near(w2.voids, 2 * latte.cost!) && w2.total === w2.voids, w2);

  console.log('the kitchen: a made dish uses up its ingredients, once');
  await seed();
  const Kitchen = await import('../../src/app/api/kitchen/route');
  let r: any = await Kitchen.POST(req({ action: 'pair', tenantId: 't1', name: 'Bar' }));
  const key = r.body.key;
  const ticket = (id: string, x: any) => db.doc(`${T}/kdsTickets/${id}`).set({ id, status: 'pending', createdAt: nowIso(), ...x });
  await ticket('k1', { source: 'tab', visitId: 'v0', menuItemId: 'latte', menuItemName: 'Latte', tableNumber: '4' });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k1', step: 'ready' }));
  let milk = await moves('milk', 'used'); let beans = await moves('beans', 'used');
  check('a table’s latte marked ready takes its milk and beans off, on the stock history with why', r.body.ok && milk.length === 1 && milk[0].change === -240 && beans.length === 1 && beans[0].change === -18 && /Made: Latte ×1 for 4/.test(milk[0].reason) && milk[0].refId === 'k1', milk);
  check('…the shelf moves (a gallon opened: 3,545 ml left in it)', (await get(`${T}/inventory/milk`)).totalStock === 1 && (await get(`${T}/inventory/milk`)).partialContainerSize === 3545 && (await get(`${T}/kdsTickets/k1`)).partsUsed === true);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k1', step: 'deliver' }));
  check('…served after: nothing taken again', r.body.ok && (await moves('milk', 'used')).length === 1);
  await ticket('k2', { source: 'pos', menuItemId: 'latte', menuItemName: 'Latte', quantity: 2, stockMoved: true, guestName: 'Maria' });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k2', step: 'deliver' }));
  milk = await moves('milk', 'used');
  check('a front desk sale served straight from the line takes two lattes’ worth (its own count was taken at the sale)', r.body.ok && milk.length === 2 && milk[1].change === -480 && /for Maria/.test(milk[1].reason));
  await ticket('k3', { source: 'counter', channel: 'counter', menuItemId: 'latte', menuItemName: 'Latte', stockMoved: true });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k3', step: 'ready' }));
  check('a counter order took its own when it was sent: nothing here', r.body.ok && (await moves('milk', 'used')).length === 2);
  await ticket('k4', { source: 'tab', visitId: 'v0', menuItemId: 'toast', menuItemName: 'Avocado toast' });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k4', step: 'ready' }));
  check('an ingredient not counted yet (a starter, before its first count) is left alone; the rest are taken', r.body.ok && (await moves('avo', 'used'))[0]?.change === -0.5 && (await moves('bread')).length === 0 && (await get(`${T}/inventory/bread`)).totalStock === 0);
  await ticket('k5', { source: 'event', menuItemId: 'soda', menuItemName: 'Sparkling water' });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k5', step: 'ready' }));
  check('a bought item with no recipe is taken when it’s sold, never here', r.body.ok && (await moves('soda')).length === 0);
  await ticket('k6', { source: 'tab', visitId: 'v0', menuItemId: 'latte', menuItemName: 'Latte' });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k6', step: 'cancel' }));
  check('one cancelled before it was made takes nothing', r.body.ok && (await moves('milk', 'used')).length === 2 && (await moves('milk', 'spoiled')).length === 0);
  await ticket('k6b', { source: 'event', menuItemId: 'latte', menuItemName: 'Latte', status: 'in_progress' });
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k6b', step: 'cancel' }));
  check('one stopped on the kitchen screen after it was started: what went into it is waste', r.body.ok && (await moves('milk', 'spoiled'))[0]?.change === -240 && /Stopped after it was started/.test((await moves('milk', 'spoiled'))[0]?.reason) && (await get(`${T}/kdsTickets/k6b`)).partsUsed === true);

  console.log('held batches');
  const later = new Date(Date.now() + 20 * 60000).toISOString();
  await db.doc(`${T}/holdingBins/b1`).set({ id: 'b1', itemId: 'toast', name: 'Avocado toast', quantity: 4, made: 4, startedAt: nowIso(), expiresAt: later, status: 'held' });
  await ticket('k7', { source: 'tab', visitId: 'v0', menuItemId: 'toast', menuItemName: 'Avocado toast' });
  r = await Kitchen.POST(req({ action: 'fromHold', tenantId: 't1', key, col: 'kdsTickets', id: 'k7', binId: 'b1' }));
  let avo = await moves('avo', 'used');
  check('a table’s dish from a held batch uses up its portion as it goes out', r.body.ok && avo.length === 2 && avo[1].change === -0.5 && /from a held batch/.test(avo[1].reason) && (await get(`${T}/kdsTickets/k7`)).partsUsed === true, avo);
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: 'k7', step: 'deliver' }));
  check('…served after: not again', (await moves('avo', 'used')).length === 2);
  await ticket('k8', { source: 'counter', channel: 'counter', menuItemId: 'toast', menuItemName: 'Avocado toast', stockMoved: true });
  r = await Kitchen.POST(req({ action: 'fromHold', tenantId: 't1', key, col: 'kdsTickets', id: 'k8', binId: 'b1' }));
  check('…a counter order from the batch took its own when it was sent', r.body.ok && (await moves('avo', 'used')).length === 2 && (await get(`${T}/holdingBins/b1`)).quantity === 2);
  r = await Kitchen.POST(req({ action: 'holdToss', tenantId: 't1', key, binId: 'b1' }));
  const tossed = await moves('avo', 'spoiled');
  check('what’s thrown out is waste on the stock history: its portions’ ingredients', r.body.ok && tossed.length === 1 && tossed[0].change === -1 && /Thrown out: 2 of Avocado toast/.test(tossed[0].reason) && (await get(`${T}/holdingBins/b1`)).tossedQty === 2, tossed);

  console.log('the tab: a started dish voided or made again is waste');
  const Tab = await import('../../src/app/api/tab/route');
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, tableName: '7', status: 'servicing', tab: [
    { lineId: 'l1', itemId: 'latte', itemType: 'product', name: 'Latte', price: 5, quantity: 1, kdsId: 't1a' }, { lineId: 'l2', itemId: 'latte', itemType: 'product', name: 'Latte', price: 5, quantity: 1, kdsId: 't1b' },
    { lineId: 'l3', itemId: 'toast', itemType: 'product', name: 'Avocado toast', price: 4.5, quantity: 1, kdsId: 't1c' }, { lineId: 'l4', itemId: 'latte', itemType: 'product', name: 'Latte', price: 5, quantity: 1, kdsId: 't1d' }] });
  await ticket('t1a', { source: 'tab', visitId: 'v1', lineId: 'l1', menuItemId: 'latte', menuItemName: 'Latte', status: 'in_progress' });
  await ticket('t1b', { source: 'tab', visitId: 'v1', lineId: 'l2', menuItemId: 'latte', menuItemName: 'Latte', status: 'pending' });
  await ticket('t1c', { source: 'tab', visitId: 'v1', lineId: 'l3', menuItemId: 'toast', menuItemName: 'Avocado toast', status: 'in_progress' });
  await ticket('t1d', { source: 'tab', visitId: 'v1', lineId: 'l4', menuItemId: 'latte', menuItemName: 'Latte', status: 'ready', partsUsed: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v1', lineId: 'l1', reason: 'Guest changed their mind' }));
  let spoiled = (await moves('milk', 'spoiled')).filter((e: any) => /Voided/.test(e.reason));
  check('a latte voided after the kitchen started it: its milk and beans are waste, and the record’s waste is its recipe’s cost', r.body.ok && r.body.started && near(r.body.waste, 0.61) && spoiled.length === 1 && spoiled[0].change === -240 && (await moves('beans', 'spoiled')).length === 2
    && /Voided after the kitchen started: Latte at 7/.test(spoiled[0].reason) && (await get(`${T}/kdsTickets/t1a`)).status === 'cancelled' && (await get(`${T}/kdsTickets/t1a`)).partsUsed === true, { body: r.body, spoiled });
  const rec = (await all(`${T}/approvals`)).find((a: any) => a.kind === 'void_item' && a.lineId === 'l1');
  check('…kept with the void for the night’s waste', near(rec?.wasteCost, 0.61));
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v1', lineId: 'l2', reason: 'Rang in twice' }));
  check('one voided before it was started: no waste', r.body.ok && !r.body.started && (await moves('milk', 'spoiled')).length === 2);
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v1', lineId: 'l4', reason: 'Guest left' }));
  check('one already made took its ingredients then: not again', r.body.ok && (await moves('milk', 'spoiled')).length === 2);
  r = await Tab.POST(req({ tenantId: 't1', action: 'remake', visitId: 'v1', lineId: 'l3', reason: 'Dropped or spilled' }));
  const fresh: any = await get(`${T}/kdsTickets/${r.body.ticket}`);
  check('a dish made again: the first plate’s ingredients are waste, at its recipe’s cost', r.body.ok && near(r.body.waste, 1.65) && (await moves('avo', 'spoiled')).length === 2 && (await moves('avo', 'spoiled'))[1].change === -0.5 && (await get(`${T}/kdsTickets/t1c`)).partsUsed === true, r.body);
  check('…the new plate takes its own when it’s made', fresh && !fresh.partsUsed && !fresh.fromHold && fresh.status === 'pending');
  r = await Kitchen.POST(req({ action: 'act', tenantId: 't1', key, col: 'kdsTickets', id: fresh.id, step: 'ready' }));
  check('…and does', r.body.ok && (await moves('avo', 'used')).length === 3);

  console.log('the front desk: a sale made right there');
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  db = strictTransactions(makeDb()); await seed();
  await db.doc(T).set({ salesTax: { configured: true, productsPct: 0 }, modules: { hospitality: false, classes_events: false } }, { merge: true });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez' });
  await db.doc(`${T}/inventory/latte`).set({ msrp: 5 }, { merge: true }); await db.doc(`${T}/inventory/soda`).set({ msrp: 2.5, totalStock: 10 }, { merge: true });
  await db.doc(`${T}/inventory/mocha`).set({ id: 'mocha', name: 'Mocha', type: 'refreshment', price: 5.5, msrp: 5.5, totalStock: 0, formula: [{ id: 'milk', quantityUsed: 200 }, { id: 'beans', quantityUsed: 18 }] });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'latte', type: 'product', quantity: 2, price: 5, name: 'Latte' }, { id: 'mocha', type: 'product', quantity: 1, price: 5.5, name: 'Mocha' }, { id: 'soda', type: 'product', quantity: 1, price: 2.5, name: 'Sparkling water' }], expectedTotal: 18, payment: { method: 'cash', amountTendered: 18 } }));
  milk = await moves('milk', 'used'); beans = await moves('beans', 'used');
  check('no kitchen screen: lattes and a mocha sold at the desk take their milk and beans when the sale is saved, both drinks’ milk in one', r.status === 200 && milk.length === 1 && milk[0].change === -680 && beans[0]?.change === -54 && /Sold at the front desk: Latte ×2, Mocha ×1/.test(milk[0].reason) && (await get(`${T}/inventory/milk`)).partialContainerSize === 3785 - 680, { status: r.status, body: r.body, milk });
  check('…a bought item is taken by the sale itself, as always', (await moves('soda', 'sold')).length === 1 && (await moves('soda', 'used')).length === 0);
  await db.doc(T).set({ modules: { hospitality: true } }, { merge: true });
  r = await complete(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'latte', type: 'product', quantity: 1, price: 5, name: 'Latte' }], expectedTotal: 5, payment: { method: 'cash', amountTendered: 5 } }));
  const posTicket = (await all(`${T}/kdsTickets`)).find((t: any) => t.source === 'pos');
  check('…with a kitchen screen it goes there, and takes them when it’s made', r.status === 200 && !!posTicket && (await moves('milk', 'used')).length === 1, r.body);

  console.log('a first count is where history starts');
  const SC = await import('../../src/lib/stock-count');
  await db.doc(`${T}/inventory/bread`).set({ totalStock: 0 }, { merge: true });
  let c: any = await SC.recordCount(db, 't1', 'bread', 2, { id: 'm1', name: 'Ana Ruiz' }, { open: 10 });
  let entry = (await moves('bread', 'counted'))[0];
  check('a starter ingredient’s first count is marked as where its history starts, and it’s counted from now on', c.ok && entry?.baseline === true && entry?.change === 50 && (await get(`${T}/inventory/bread`)).countStock === true, entry);
  c = await SC.recordCount(db, 't1', 'bread', 1, { id: 'm1', name: 'Ana Ruiz' }, { open: 10 });
  entry = (await moves('bread', 'counted')).find((e: any) => !e.baseline);
  check('…the next one is a difference found', c.ok && entry?.change === -20 && !entry?.baseline);
  c = await SC.recordCount(db, 't1', 'beans', 2, { id: 'm1', name: 'Ana Ruiz' }, { open: 900 });
  check('…a starter ingredient received before its first count: that count is compared with the delivery, so a loss shows', c.ok && !(await moves('beans', 'counted'))[0]?.baseline);
  c = await SC.recordCount(db, 't1', 'avo', 18, { id: 'm1', name: 'Ana Ruiz' });
  check('…one the business made itself and counted before: a difference', c.ok && !(await moves('avo', 'counted'))[0]?.baseline);

  console.log('the food cost report');
  db = strictTransactions(makeDb()); await seed();
  const now = nowIso();
  await db.doc(`${T}/receipts/r1`).set({ id: 'r1', date: now, reversal: { products: [{ id: 'latte', quantity: 2 }, { id: 'shampoo', quantity: 1 }] },
    detail: { lines: [{ kind: 'service', label: 'Facial', amount: 90 }, { kind: 'product', label: 'Latte', qty: 2, unit: 5, amount: 10 }, { kind: 'product', label: 'Shampoo', qty: 1, unit: 20, amount: 20 }] } });
  await db.doc(`${T}/receipts/r1b`).set({ id: 'r1b', date: now, reversal: { products: [{ id: 'soda', name: 'Sparkling water', quantity: 1 }] },
    detail: { lines: [{ kind: 'product', label: 'Gift wrap', qty: 1, unit: 3, amount: 3 }, { kind: 'product', label: 'Sparkling water', qty: 1, unit: 2.5, amount: 2.5 }] } });
  await db.doc(`${T}/receipts/r2`).set({ id: 'r2', date: now, voided: true, reversal: { products: [{ id: 'latte', quantity: 9 }] }, detail: { lines: [{ kind: 'product', amount: 45 }] } });
  await db.doc(`${T}/counterOrders/o1`).set({ id: 'o1', paidAt: now, status: 'sent', lines: [{ itemId: 'toast', quantity: 1, unitPrice: 4.5 }, { itemId: 'cookie', quantity: 2, unitPrice: 3 }] });
  await db.doc(`${T}/counterOrders/o2`).set({ id: 'o2', paidAt: now, status: 'refunded', refundedAt: now, lines: [{ itemId: 'toast', quantity: 5, unitPrice: 4.5 }] });
  await db.doc(`${T}/counterOrders/o3`).set({ id: 'o3', paidAt: now, status: 'voided', voidedAt: now, wastedQty: 1, wastedItems: { toast: 1 }, lines: [{ itemId: 'toast', quantity: 1, unitPrice: 4.5 }, { itemId: 'latte', quantity: 1, unitPrice: 5 }] });
  const NC = await import('../../src/lib/night-close-server');
  const day = NC.tonight(await get(T));
  await db.doc(`${T}/approvals/a1`).set({ kind: 'remake', used: true, day, wasteCost: 1.2 });
  await db.doc(`${T}/approvals/a2`).set({ kind: 'void_item', used: true, day, wasteCost: 0.61 });
  await db.doc(`${T}/approvals/a3`).set({ kind: 'void_item', used: false, day, wasteCost: 5 });
  await db.doc(`${T}/approvals/a4`).set({ kind: 'remake', used: true, day: '2020-01-01', wasteCost: 5 });
  await db.doc(`${T}/holdingBins/b9`).set({ itemId: 'toast', status: 'tossed', tossedAt: now, tossedQty: 3 });
  await db.doc(`${T}/stockCorrections/s1`).set({ productId: 'milk', type: 'counted', change: -500, date: now, unit: 'ml' });
  await db.doc(`${T}/stockCorrections/s2`).set({ productId: 'beans', type: 'counted', change: -100, date: now, unit: 'g' });
  await db.doc(`${T}/stockCorrections/s3`).set({ productId: 'bread', type: 'counted', change: 40, date: now, baseline: true });
  await db.doc(`${T}/stockCorrections/s4`).set({ productId: 'milk', type: 'counted', change: -9999, date: '2020-01-01T00:00:00Z' });
  await db.doc(`${T}/stockCorrections/s5`).set({ productId: 'milk', type: 'used', change: -240, date: now });
  await db.doc(`${T}/inventory/avo`).set({ lastCountedAt: now }, { merge: true });
  const FC = await import('../../src/app/api/food-cost/route');
  r = await FC.POST(req({ tenantId: 't1', action: 'report', period: 'week' }));
  const b = r.body;
  check('this week: food and drink sold at the desk and the counter (not a retail product, a voided sale or a refunded order), and what it cost', b.ok && b.report.sold === 23 && b.report.covered === 17 && near(b.report.cost, 2 * latte.cost! + 1.65 + 0.6) && b.report.uncovered === 6 && !b.partial, b.report);
  check('…a receipt line is matched to its item by name, so a line with no item of its own (gift wrap) doesn’t shift them', b.report.items.find((x: any) => x.id === 'soda')?.sold === 2.5);
  check('…by day, today included', b.days.includes(day) && b.report.days.find((d: any) => d.day === day)?.sold === 17);
  check('…each menu item: best sellers first, those still to be priced last, the over-target ones with a fix', b.items[0].id === 'latte' && b.items[0].sold === 2 && b.items[b.items.length - 1].id === 'croissant' && b.items.find((x: any) => x.id === 'toast').fix === 5.5 && b.items.length === 5, b.items.map((x: any) => x.id));
  check('…the ingredients the menu uses still at typical prices, with their containers', b.typical.map((t: any) => t.id).join() === 'beans,bread' && b.typical[0].container === 'bag' && b.typical[0].cost === 18);
  check('…what the counts this week found (a first count apart, one counted to match), and what was thrown away', b.counts.map((x: any) => x.id).join() === 'beans,milk,avo,bread' && b.counts[1].change === -500 && b.counts[2].change === 0 && b.counts[3].first
    && near(b.waste.total, 1.2 + 0.61 + 1.65 + 4.95) && near(b.waste.voids, 0.61 + 1.65) && near(b.waste.batches, 4.95), { counts: b.counts, waste: b.waste });
  r = await FC.POST(req({ tenantId: 't1', action: 'report', period: 'last' }));
  check('last week: nothing sold yet, nothing thrown away', r.body.ok && r.body.report.sold === 0 && r.body.waste.total === 0 && r.body.days.length === 7 && !r.body.days.includes(day));
  // The same stretch as a report anyone can read (lib/food-cost-report), and its spreadsheet.
  r = await FC.POST(req({ tenantId: 't1', action: 'view', period: 'week' })); const v = r.body.report;
  check('the report: what it is, the share against the aim, what was sold and what it cost, what was thrown away, the items over', r.body.ok && /^Food cost, /.test(v.title) && /against your aim of 30%/.test(v.what)
    && v.kpis.map((k: any) => k.label).join('|') === 'Food cost|Sold|Cost to make it|Thrown away|Over the aim' && v.kpis[1].value === '$23.00' && /\$6\.00 of it has no cost to make yet/.test(v.kpis[1].note)
    && v.kpis[2].value === `$${b.report.cost.toFixed(2)}` && v.kpis[4].value === String(b.items.filter((x: any) => x.over && !x.needsPrice).length), v.kpis);
  check('…sales by day, each day over or under the aim; what’s worth a look names what has no cost, and the item over the aim with its fix', (b.days.length > 1 ? v.chart?.bars.length === b.days.length && v.chart.bars.some((x: any) => x.value === b.report.days.find((d: any) => d.day === day)?.all && x.value === 23) : v.chart === null)
    && v.notes.some((n: any) => n.tone === 'warn' && /^Avocado toast costs 36\.7% of its price\. At \$5\.50 it’s back to 30% or less\.$/.test(n.text) && n.href === '/menu?item=toast')
    && v.notes.some((n: any) => n.tone === 'warn' && /no cost to make/.test(n.text)) && v.notes.length <= 4, { chart: v.chart, notes: v.notes });
  check('…every item sold, with its sales, cost and share; the totals are everything sold', v.rows.length === b.report.items.length && v.rows[0][0] === b.report.items[0].name && v.totals[0] === 'Everything sold' && v.totals[3] === 23 && near(v.totals[4], b.report.cost)
    && v.columns.map((c: any) => c.label).join('|') === 'Item|Section|Quantity|Sales|Cost to make|Food cost|Price now|One costs now|Against the aim'
    && (b.days.length > 1 ? v.chart.bars.reduce((n: number, x: any) => n + x.value, 0) === 23 : true) && b.report.days.find((d: any) => d.day === day)?.all === 23, v.rows);
  r = await FC.POST(req({ tenantId: 't1', action: 'csv', period: 'week' }));
  check('…the spreadsheet is the same table: a header, one row an item, plain numbers, no totals row', r.body.ok && /^[a-z0-9-]+-food-cost-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/.test(r.body.name)
    && r.body.csv.split('\r\n').filter(Boolean).length === v.rows.length + 1 && r.body.csv.startsWith('Item,Section,Quantity,Sales,Cost to make,Food cost %,Price now,One costs now,Against the aim') && !/\$/.test(r.body.csv)
    && r.body.csv.split('\r\n').slice(1).filter(Boolean).every((line: string) => { const v = line.split(',')[5]; return v === '' || (Number(v) > 1 && Number(v) < 100); }), r.body);
  r = await FC.POST(req({ tenantId: 't1', action: 'view', period: 'last' }));
  check('…a stretch with nothing sold: no picture, no rows, and it says so', r.body.ok && r.body.report.rows.length === 0 && r.body.report.chart === null && r.body.report.empty === 'Nothing was sold in this stretch yet.' && r.body.report.kpis[0].value === 'Not known');
  manager = false; r = await FC.POST(req({ tenantId: 't1', action: 'view' })); check('…managers only', !r.body.ok); manager = true;
  r = await FC.POST(req({ tenantId: 't1', action: 'target', target: '28' }));
  check('the business sets its own aim', r.body.ok && r.body.target === 0.28 && (await get(T)).foodCost.target === 0.28 && (await FC.POST(req({ tenantId: 't1', action: 'report' }))).body.target === 0.28);
  r = await FC.POST(req({ tenantId: 't1', action: 'target', target: 75 }));
  check('…between 10% and 60%', r.status === 400);
  r = await FC.POST(req({ tenantId: 't1', action: 'cost', itemId: 'beans', cost: '21.5' }));
  check('what it pays for an ingredient: no longer a typical price, and the report uses it', r.body.ok && (await get(`${T}/inventory/beans`)).costPerUnit === 21.5 && (await get(`${T}/inventory/beans`)).typicalCost === false
    && (await FC.POST(req({ tenantId: 't1', action: 'report' }))).body.typical.map((t: any) => t.id).join() === 'bread');
  r = await FC.POST(req({ tenantId: 't1', action: 'cost', itemId: 'latte', cost: 2 }));
  const r0: any = await FC.POST(req({ tenantId: 't1', action: 'cost', itemId: 'milk', cost: 0 }));
  const rx: any = await FC.POST(req({ tenantId: 't1', action: 'cost', itemId: 'nope', cost: 3 }));
  check('…not for an item made from a recipe, not at $0, not for one that isn’t there; never a menu price', r.status === 400 && r0.status === 400 && rx.status === 404 && (await get(`${T}/inventory/latte`)).price === 5);
  manager = false;
  r = await FC.POST(req({ tenantId: 't1', action: 'report' }));
  check('managers only', r.status === 403); manager = true;
  await db.doc(T).set({ modules: { hospitality: false } }, { merge: true });
  r = await FC.POST(req({ tenantId: 't1', action: 'report' }));
  check('…with the lounge and hospitality tool on', r.status === 403 && r.body.locked === true);
  await db.doc(T).set({ modules: { hospitality: true } }, { merge: true });

  console.log('the Menu page');
  const MenuApi = await import('../../src/app/api/menu/route');
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'list' }));
  check('a manager sees what each item costs to make, its share and whether it’s over', r.body.ok && near(r.body.costs?.latte?.cost, 18 * 21.5 / 1000 + 240 * 4.5 / 3785, 0.001) && r.body.costs.toast.over === true && r.body.costs.cookie.cost === null && r.body.costs.toast.target === 0.28, r.body.costs);
  manager = false;
  r = await MenuApi.POST(req({ tenantId: 't1', action: 'list' }));
  check('…the team doesn’t', r.body.ok && r.body.costs === undefined); manager = true;

  console.log('the screens');
  const page = src('src/app/(app)/food-cost/page.tsx'), menuPage = (src('src/app/(app)/menu/page.tsx') + src('src/components/menu/ItemBuilder.tsx'));
  const rp = src('src/app/(app)/food-cost/report/page.tsx');
  check('the report page: the stretch in the address, the report view, back to Food cost; Food cost links to it', /action: 'view', period/.test(rp) && /<ReportView report=\{r\}/.test(rp) && /back=\{\{ href: '\/food-cost', label: 'Food cost' \}\}/.test(rp)
    && /searchParams\.set\('period', period\)/.test(rp) && /href=\{`\/food-cost\/report\?period=\$\{period\}`\}/.test(page) && !/uppercase|font-black|\{\/\*| · /.test(rp));
  check('the page: the stretch, the share against the aim, by day, typical prices put in here, each item, the counts and what was thrown away', /PERIODS\.map/.test(page) && /Aiming for/.test(page) && /aria-label="By day"/.test(page) && /action: 'cost'/.test(page)
    && /Each item/.test(page) && /Used against counted/.test(page) && /Thrown away/.test(page) && /More gone than sold usually means/.test(page));
  check('…tap targets, the house words', !/uppercase|font-black|\{\/\*| · |[\u{1F300}-\u{1FAFF}]|call us|contact us/u.test(page) && (page.match(/min-h-\[4[46]px\]/g) || []).length >= 5);
  check('the Menu page: each item’s cost for a manager, over its aim, and a way to the food cost page', /costWords\(costs\[m\.id\]\)/.test(menuPage) && /Over \{Math\.round\(costs\[m\.id\]\.target \* 100\)\}%/.test(menuPage) && /href="\/food-cost"/.test(menuPage));
  check('the page is part of the lounge and hospitality tool, in the menu after Menu, and in Settings search', /hospitality: \{[^\n]*'\/food-cost'/.test(src('src/lib/modules.ts')) && /href: '\/food-cost',\s+icon: PieChart/.test(src('src/components/shared/AppSidebar.tsx'))
    && /id: 'foodcost', title: 'Food cost'/.test(src('src/lib/settings-registry.ts')));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
