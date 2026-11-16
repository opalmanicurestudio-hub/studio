// Checks prices that moved (round 34, design canvas "Food numbers": This week's numbers):
// - lib/price-creep: what each delivery cost (a count's batch isn't one), a move of 5% or more against the delivery
//   before, and what one change did to each dish (over the aim now, the price that brings it back) and each choice
// - api/food-cost: the report's moves for the stretch; 'price' (a manager's, only while the price is what was shown;
//   the desk's price follows); 'moved' (anyone on the team, after a stock screen's delivery: tells the managers once)
// - api/ordering 'receive': a delivery typed in at a new price says what moved, and the managers hear once
// - the screens: Food cost's card, the Ordering notice, the Menu opened at an item, the stock screens asking
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/price-creep.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let manager = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null, bump: async () => bumpOk });
  if (request === '@/lib/push' || /\/src\/lib\/push(\.ts)?$/.test(request)) return fake(request, { pushNow: async () => {} });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const audits: any[] = []; let bumpOk = true;

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const near = (a: any, b: number, e = 0.005) => typeof a === 'number' && Math.abs(a - b) <= e;
const src = (p: string) => readFileSync(p, 'utf8');
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

(async () => {
  const PC = await import('../../src/lib/price-creep');

  // Beef patties by the case of 40, $38.40 for months, then $43.00 on Tuesday's delivery; buns steady; oat milk up 8%.
  const batch = (id: string, cost: number, at: string, extra: any = {}) => ({ id, stock: 0, costPerUnit: cost, receivedDate: at, ...extra });
  const patties = { name: 'Beef patties', type: 'professional', container: 'case', costingMethod: 'uses', estimatedUses: 40, useUnit: 'each', costPerUnit: 43, totalStock: 2, partialContainerUses: 0, countStock: true,
    batches: [batch('b1', 38.4, ago(40)), batch('b2', 38.4, ago(20)), batch('count-x', 41, ago(10), { note: 'Found in a count' }), batch('b3', 43, ago(2))] };
  const buns = { name: 'Brioche buns', type: 'professional', container: 'case', costingMethod: 'uses', estimatedUses: 48, useUnit: 'each', costPerUnit: 18.5, totalStock: 2, partialContainerUses: 0, countStock: true,
    batches: [batch('n1', 18, ago(30)), batch('n2', 18.5, ago(3))] };
  const milk = { name: 'Whole milk', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 4.6, totalStock: 4, partialContainerSize: 0, countStock: true, batches: [batch('m1', 4.6, ago(5))] };
  const oat = { name: 'Oat milk', type: 'professional', container: 'carton', costingMethod: 'size', size: 946, unit: 'ml', costPerUnit: 3.8, totalStock: 3, partialContainerSize: 0, countStock: true,
    batches: [batch('o1', 3.4, ago(25)), batch('o2', 3.8, ago(1))] };
  const beans = { name: 'Espresso beans', type: 'professional', costingMethod: 'size', size: 1000, unit: 'g', costPerUnit: 20, totalStock: 2, partialContainerSize: 0, countStock: true };
  const burger = { type: 'refreshment', name: 'Burger', price: 14, msrp: 14, category: 'Mains', formula: [{ id: 'patties', name: 'Beef patties', quantityUsed: 3, unit: 'each' }, { id: 'buns', name: 'Brioche buns', quantityUsed: 1, unit: 'each' }] };
  const latte = { type: 'refreshment', name: 'Latte', price: 4.5, category: 'Coffee', formula: [{ id: 'beans', name: 'Espresso beans', quantityUsed: 18, unit: 'g' }, { id: 'milk', name: 'Whole milk', quantityUsed: 240, unit: 'ml' }],
    choices: [{ id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75, changes: [{ kind: 'swap', from: 'milk', fromName: 'Whole milk', to: 'oat', toName: 'Oat milk' }] }] }] };
  const parts = new Map<string, any>(Object.entries({ patties, buns, milk, oat, beans, burger, latte }));
  const menu: [string, any][] = [['burger', burger], ['latte', latte]];

  console.log('what each delivery cost');
  const ds = PC.deliveriesOf(patties);
  check('the deliveries, oldest first; a count that found more isn’t one', ds.length === 3 && ds.map((d) => d.cost).join() === '38.4,38.4,43' && !ds.some((d) => d.id === 'count-x'), ds);
  check('…nor one with no cost or date', PC.deliveriesOf({ batches: [{ id: 'x', costPerUnit: 0, receivedDate: ago(1) }, { id: 'y', costPerUnit: 5 }] }).length === 0);
  check('…nor one put away at a typical price, or dated days ahead by a wrong clock', PC.deliveriesOf({ batches: [batch('t', 9, ago(3), { typical: true }), batch('f', 9, ago(-3)), batch('ok', 9, ago(-0.5))] }).map((d) => d.id).join() === 'ok');
  const wk = ago(7);
  const mv = PC.moveOf('patties', patties, wk)!;
  check('this week: beef patties up 12%, $38.40 to $43.00 a case, on Tuesday’s delivery', !!mv && mv.up && near(mv.pct, 0.12, 0.001) && mv.from === 38.4 && mv.to === 43 && mv.batchId === 'b3' && PC.moveWords(mv) === 'up 12%, $38.40 to $43.00 a case', mv);
  check('buns up under 5% isn’t a move; nothing delivered in the stretch isn’t either', PC.moveOf('buns', buns, wk) === null && PC.moveOf('patties', patties, ago(1)) === null);
  check('…coming down is one too', PC.moveOf('x', { name: 'Cheddar', batches: [batch('c1', 50, ago(20)), batch('c2', 46, ago(2))] }, wk)?.up === false);
  check('with nothing before the stretch, the first in it is what it was', PC.moveOf('x', { batches: [batch('c1', 10, ago(5)), batch('c2', 11, ago(2))] }, wk)?.from === 10 && PC.moveOf('x', { batches: [batch('c1', 10, ago(5))] }, wk) === null);

  console.log('what it did to the menu');
  const e = PC.effectsOf(mv, parts, menu, 0.3);
  const bh = e.dishes.find((d) => d.id === 'burger')!;
  // 3 patties at $43/40 = $3.225 and a bun at $18.50/48 = $0.385: $3.61, 25.8%; at $38.40 it was $2.88 + $0.385 = $3.265, 23.3%.
  check('the burger: $3.27 to $3.61 to make, 23% to 26% of its $14', near(bh.before, 3.27) && near(bh.after, 3.61) && Math.round(bh.shareBefore! * 100) === 23 && Math.round(bh.shareAfter! * 100) === 26 && !bh.crossed, bh);
  check('…the latte, with no patties in it, isn’t listed', !e.dishes.some((d) => d.id === 'latte'));
  const kept = PC.moveOf('patties', { ...patties, costPerUnit: 38.4 }, wk)!;
  const ek = PC.effectsOf(kept, new Map([...parts, ['patties', { ...patties, costPerUnit: 38.4 }]]), menu, 0.3);
  check('put away without its new price typed: the move still says what the dishes cost at it, and that your costs still use the old one', kept.live === 38.4 && mv.live === null && near(ek.dishes[0].after, 3.61) && near(ek.dishes[0].before, 3.27), { live: kept.live, d: ek.dishes[0] });
  const e2 = PC.effectsOf(mv, parts, menu, 0.25);
  check('aiming for 25%: now over, it wasn’t before, and $14.50 brings it back', e2.dishes[0].crossed && e2.dishes[0].fix === 14.5, e2.dishes[0]);
  const om = PC.moveOf('oat', oat, wk)!;
  const eo = PC.effectsOf(om, parts, menu, 0.3);
  // 240 ml of oat at $3.80 a 946 ml carton is $0.96, less the whole milk's $0.29: $0.67 more, keeping $0.08 of $0.75.
  check('oat milk up 12%: swapping to oat now costs $0.67 more and charges $0.75, so it barely pays for itself', !!om && near(om.pct, 0.1176, 0.001) && eo.options.length === 1 && eo.options[0].option === 'Oat' && near(eo.options[0].costAfter, 0.67, 0.01) && eo.options[0].charges === 0.75, eo.options);

  console.log('the report');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', userId: 'owner1', modules: { hospitality: true }, foodCost: { target: 0.25 } });
  for (const [id, x] of parts) await db.doc(`${T}/inventory/${id}`).set({ id, status: 'active', isActive: true, ...(x.type === 'refreshment' ? { showInConcierge: true } : {}), ...x });
  const { POST: fc } = await import('../../src/app/api/food-cost/route');
  let r: any = await fc(req({ tenantId: 't1', action: 'report', period: '30' }));
  const moves = r.body.moves || [];
  check('the last 30 days: beef patties first (it pushed the burger over the aim), then oat milk; buns not at all', r.body.ok && moves.map((m: any) => m.id).join() === 'patties,oat' && moves[0].dishes[0].crossed === true && moves[1].options.length === 1, moves.map((m: any) => [m.id, m.pct]));
  r = await fc(req({ tenantId: 't1', action: 'report', period: 'last' }));
  check('…a stretch with no deliveries has none', r.body.ok && Array.isArray(r.body.moves) && !r.body.moves.some((m: any) => m.id === 'patties' && m.batchId === 'b3'));

  console.log('pricing it');
  const P = (b: any) => fc(req({ tenantId: 't1', action: 'price', ...b }));
  manager = false; check('a manager’s', (await P({ itemId: 'burger', price: 14.5, was: 14 })).status === 403); manager = true;
  r = await P({ itemId: 'burger', price: 14.5, was: 13 });
  check('only while its price is what was shown: said, nothing changed', r.status === 409 && /\$14\.00 now/.test(r.body.error) && (await get(`${T}/inventory/burger`)).price === 14, r.body);
  r = await P({ itemId: 'patties', price: 5, was: 0 });
  check('…only a menu item', r.status === 404);
  r = await P({ itemId: 'burger', price: 0, was: 14 });
  check('…a price of more than $0', r.status === 400);
  r = await P({ itemId: 'burger', price: 14.5, was: 14 });
  const bg: any = await get(`${T}/inventory/burger`);
  check('priced at $14.50: the desk’s price follows, by who and when, on the audit trail', r.body.ok && bg.price === 14.5 && bg.msrp === 14.5 && bg.menuUpdatedBy === 'Ana Ruiz' && audits.some((a) => a.action === 'menu.price' && /14\.50 \(was \$14\.00\)/.test(a.summary)), { bg, audits: audits.map((a) => a.summary) });
  await db.doc(`${T}/inventory/latte`).set({ msrp: 4.95 }, { merge: true });
  r = await P({ itemId: 'latte', price: 4.75, was: 4.5 });
  check('…unless the desk has its own price', r.body.ok && (await get(`${T}/inventory/latte`)).msrp === 4.95 && (await get(`${T}/inventory/latte`)).price === 4.75);

  console.log('a delivery put away');
  await db.doc(`${T}/inventory/burger`).set({ price: 14, msrp: 14 }, { merge: true });
  await db.doc(`${T}/orders/po1`).set({ id: 'po1', number: '0001', supplier: 'Metro Meats', status: 'Placed', items: [{ productId: 'patties', productName: 'Beef patties', quantity: 2, costPerUnit: 43, receivedQuantity: 0 }] });
  const { POST: ordering } = await import('../../src/app/api/ordering/route');
  r = await ordering(req({ tenantId: 't1', action: 'receive', orderId: 'po1', lines: [{ itemId: 'patties', qty: 2, cost: 47.5 }] }));
  const mp = (r.body.moved || [])[0];
  check('typed in at $47.50: it says so, and that the burger, already over your aim, is further over, with the price that brings it back', r.body.ok && mp?.id === 'patties' && mp.up && /up 10%, \$43\.00 to \$47\.50 a case/.test(mp.words) && mp.dishes[0]?.name === 'Burger' && mp.dishes[0].fix === 16, r.body);
  const notes1 = (await all(`${T}/notifications`)).filter((n: any) => n.type === 'price_moved');
  check('…the managers hear (two points further over is worth a word), once, with where to look', notes1.length === 1 && notes1[0].userId === 'owner1' && notes1[0].link === '/food-cost' && /Beef patties up 10%/.test(notes1[0].message) && /Burger is now 28% of its price \(it was 26%\), over your 25%\. \$16\.00 brings it back/.test(notes1[0].message), notes1);
  check('…a rise that leaves every dish where it was says nothing', PC.hurtBy({ crossed: false, over: true, shareBefore: 0.31, shareAfter: 0.315 } as any) === false && PC.hurtBy({ crossed: false, over: false, shareBefore: 0.2, shareAfter: 0.29 } as any) === false);
  const { POST: fc2 } = await import('../../src/app/api/food-cost/route');
  manager = false;
  r = await fc2(req({ tenantId: 't1', action: 'moved', itemIds: ['patties', 'bad id!'] }));
  manager = true;
  check('a stock screen asking again (anyone on the team): no costs back, and no second notice for the same delivery', r.body.ok && r.body.moved === 1 && r.body.moves === undefined && (await all(`${T}/notifications`)).filter((n: any) => n.type === 'price_moved').length === 1, r.body);
  r = await ordering(req({ tenantId: 't1', action: 'receive', orderId: 'po1' }));
  check('…an order already put away isn’t checked again', r.body.ok && r.body.already === true && (r.body.moved || []).length === 0);
  await db.doc(`${T}/orders/po2`).set({ id: 'po2', number: '0002', supplier: 'Metro Meats', status: 'Placed', items: [{ productId: 'buns', productName: 'Brioche buns', quantity: 1, costPerUnit: 18.5, receivedQuantity: 0 }] });
  r = await ordering(req({ tenantId: 't1', action: 'receive', orderId: 'po2' }));
  bumpOk = false; manager = false;
  r = await fc2(req({ tenantId: 't1', action: 'moved', itemIds: ['patties'] }));
  manager = true; bumpOk = true;
  check('a screen asking in a loop: past a few hundred an hour, nothing is read', r.body.ok && r.body.moved === 0 && r.body.later === true);
  check('a delivery at the same price: nothing moved, nobody told', r.body.ok && (r.body.moved || []).length === 0 && (await all(`${T}/notifications`)).filter((n: any) => n.type === 'price_moved').length === 1, r.body);

  console.log('the screens');
  const files = ['src/components/food/PricesMoved.tsx', 'src/app/(app)/food-cost/page.tsx', 'src/app/(app)/inventory/ordering/page.tsx'];
  const bad = files.filter((f) => /\{\/\*/.test(src(f)) || /\buppercase\b/.test(src(f)) || /font-black/.test(src(f)) || / · /.test(src(f)) || /contact us|call us/i.test(src(f)));
  check('no JSX comments, capitals, heavy type or dots between words', bad.length === 0, bad);
  const lowTap = files.filter((f) => /min-h-\[(3\d|[12]\d)px\]|h-(8|9|10) w-(8|9|10)\b/.test(src(f)));
  check('every control is a 44px target', lowTap.length === 0, lowTap);
  const pm = src('src/components/food/PricesMoved.tsx');
  check('Food cost: Prices that moved, a price set in two taps, the recipe opened on the Menu', /<PricesMoved/.test(src('src/app/(app)/food-cost/page.tsx')) && /Price it at/.test(pm) && /Change it to/.test(pm) && /\/menu\?item=/.test(pm) && /action: 'price'/.test(pm));
  check('the Menu opens at the item it’s sent to', /get\('item'\)/.test(src('src/app/(app)/menu/page.tsx')));
  check('Ordering says what moved after a delivery; the other stock screens ask', /Prices moved|A price moved/.test(src('src/app/(app)/inventory/ordering/page.tsx')) && /checkPrices\(/.test(src('src/components/inventory/QuickReceiveDialog.tsx')) && /checkPrices\(/.test(src('src/app/(app)/inventory/page.tsx')));
  check('a price that moved can buzz a phone, on the same day', /price_moved: 'today'/.test(src('src/lib/push-tier.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
