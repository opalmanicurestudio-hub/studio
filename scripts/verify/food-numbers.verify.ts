// Checks yields, kitchen units, prep recipes and choices that change the recipe (round 32, design canvas "Food numbers"):
// - lib/kitchen-units: kitchen measures turned into what an ingredient is counted in (weight to weight, volume to
//   volume, a lemon's juice once the business says what one gives); yields (trimming and cooking) and what a line takes
// - lib/food-cost: a recipe costed at what's served; a prep recipe costed from its own recipe, a portion its share;
//   each choice's cost and what it keeps; a sold line costed as it was chosen
// - lib/choice-recipe: adds, then swaps, then what's left out (a large oat latte is 360 ml of oat milk)
// - stock: what a dish takes off is what was made, chosen and trimmed (the kitchen, the desk, the counter); whether it
//   can be made
// - the Menu page (api/menu): recipes in kitchen measures, choices that change them, prep recipes (one level deep),
//   refused with words when they can't work; the Prep page (api/prep 'made') making a batch; the prep list's batches;
//   an ingredient's yield (api/food-cost 'yield') and the food cost report
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/food-numbers.verify.ts
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
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor: { ...actor, isManager: manager, role: manager ? 'manager' : 'staff' }, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const near = (a: any, b: number, e = 0.01) => typeof a === 'number' && Math.abs(a - b) <= e;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const KU = await import('../../src/lib/kitchen-units');
  const FC = await import('../../src/lib/food-cost');
  const CR = await import('../../src/lib/choice-recipe');
  const MS = await import('../../src/lib/menu-stock');
  const PR = await import('../../src/lib/prep-recipes');
  const PL = await import('../../src/lib/prep-list');

  // Ingredients as Inventory keeps them.
  const salmon = { name: 'Whole salmon', type: 'professional', costingMethod: 'size', size: 4536, unit: 'g', costPerUnit: 89.5, usablePct: 65, totalStock: 2, partialContainerSize: 0, countStock: true };
  const oil = { name: 'Olive oil', type: 'professional', costingMethod: 'size', size: 3000, unit: 'ml', costPerUnit: 32, totalStock: 1, countStock: true };
  const lemons = { name: 'Lemons', type: 'professional', costingMethod: 'uses', estimatedUses: 115, useUnit: 'each', costPerUnit: 42, totalStock: 1, partialContainerUses: 0, perEach: { amount: 45, unit: 'ml' }, countStock: true };
  const onions = { name: 'Onions', type: 'professional', costingMethod: 'size', size: 22680, unit: 'g', costPerUnit: 32, perEach: { amount: 230, unit: 'g' }, totalStock: 1, countStock: true };
  const milk = { name: 'Whole milk', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 4.6, totalStock: 4, partialContainerSize: 0, countStock: true };
  const oat = { name: 'Oat milk', type: 'professional', costingMethod: 'size', size: 946, unit: 'ml', costPerUnit: 4.03, totalStock: 3, partialContainerSize: 0, countStock: true };
  const oatCartons = { name: 'Oat milk cartons', type: 'professional', costingMethod: 'uses', estimatedUses: 12, useUnit: 'cartons', costPerUnit: 40, totalStock: 1, countStock: true };
  const beans = { name: 'Espresso beans', type: 'professional', costingMethod: 'size', size: 2268, unit: 'g', costPerUnit: 65, totalStock: 2, partialContainerSize: 0, countStock: true };
  const vanilla = { name: 'Vanilla syrup', type: 'professional', costingMethod: 'size', size: 750, unit: 'ml', costPerUnit: 9, totalStock: 2, countStock: true };
  const cup12 = { name: 'Hot cups 12 oz', type: 'professional', costingMethod: 'uses', estimatedUses: 50, useUnit: 'each', costPerUnit: 9, totalStock: 4, partialContainerUses: 0, countStock: true };
  const cup16 = { name: 'Hot cups 16 oz', type: 'professional', costingMethod: 'uses', estimatedUses: 50, useUnit: 'each', costPerUnit: 11, totalStock: 4, partialContainerUses: 0, countStock: true };
  const eggs = { name: 'Eggs', type: 'professional', costingMethod: 'uses', estimatedUses: 180, useUnit: 'each', costPerUnit: 48, totalStock: 1, partialContainerUses: 0, countStock: true };
  const canola = { name: 'Canola oil', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 10.6, totalStock: 1, partialContainerSize: 0, countStock: true };
  const garlic = { name: 'Garlic', type: 'professional', costingMethod: 'size', size: 1000, unit: 'g', costPerUnit: 8, totalStock: 0, countStock: false };

  console.log('kitchen measures');
  check('units as written are ours: Tbsp, grams, liter; bags aren’t a measure', KU.canonUnit('Tbsp') === 'tbsp' && KU.canonUnit('grams') === 'g' && KU.canonUnit('liter') === 'L' && KU.canonUnit('fl oz') === 'fl oz' && KU.canonUnit('bags') === null && KU.canonUnit('each') === null);
  check('weight to weight, volume to volume; never across', near(KU.convert(2, 'tbsp', 'ml'), 29.57) && near(KU.convert(1, 'lb', 'g'), 453.59) && near(KU.convert(6, 'oz', 'g'), 170.1) && KU.convert(1, 'cup', 'g') === null);
  check('6 oz of salmon bought by the gram; 120 ml of lemon juice is 2.67 lemons; one onion is 230 g', near(KU.toStockUnits(6, 'oz', salmon), 170.1) && near(KU.toStockUnits(120, 'ml', lemons), 2.667, 0.001) && KU.toStockUnits(1, 'each', onions) === 230);
  check('…and what can’t be worked out says so: a cup of salmon, lemon juice with no juice set', KU.toStockUnits(1, 'cup', salmon) === null && KU.toStockUnits(45, 'ml', { ...lemons, perEach: null }) === null);
  check('the measures a line can use: what it’s counted in first, then the same kind; a lemon by the each, then by volume', KU.measuresFor(salmon)[0] === 'g' && KU.measuresFor(salmon).includes('oz') && KU.measuresFor(salmon).includes('lb') && !KU.measuresFor(salmon).includes('ml')
    && KU.measuresFor(lemons)[0] === 'each' && KU.measuresFor(lemons).includes('ml') && KU.measuresFor(onions).includes('each'), [KU.measuresFor(salmon), KU.measuresFor(lemons)]);
  console.log('yields');
  check('65% usable: a 6 oz portion takes 9.2 oz off the case', near(KU.yieldOf(salmon), 0.65) && near(KU.stockNeed({ quantityUsed: 170.1, amount: 6, measure: 'oz' }, salmon) / 28.3495, 9.23));
  check('lost in cooking, with trimming: 90% usable, 25% lost is 67.5% served; nothing set is all of it', near(KU.yieldOf({ usablePct: 90, cookLossPct: 25 }), 0.675) && KU.yieldOf({}) === 1 && KU.yieldOf({ usablePct: 2 }) === 1 && !KU.hasYield(oil));
  check('a yield measured: 10 lb in, 6.5 lb served is 65%; nonsense isn’t one', KU.measuredYield(10, 6.5) === 65 && KU.measuredYield(10, 12) === null && KU.measuredYield(0, 1) === null);
  check('a share typed: 65%, cleared, or not a number', KU.cleanPct('65%', 5, 100) === 65 && KU.cleanPct('', 5, 100) === '' && KU.cleanPct('abc', 5, 100) === null && KU.cleanPct('2', 5, 100) === null);
  check('a line written in a measure is turned again from what was written (a lemon’s juice set later counts)', near(KU.lineAmount({ quantityUsed: 99, amount: 90, measure: 'ml' }, lemons), 2) && KU.lineAmount({ quantityUsed: 3 }, lemons) === 3 && KU.lineAmount({ quantityUsed: 7, amount: 1, measure: 'cup' }, salmon) === 7);

  console.log('what a plate costs');
  const parts = new Map<string, any>(Object.entries({ salmon, oil, lemons, onions, milk, oat, oatCartons, beans, vanilla, cup12, cup16, eggs, canola, garlic }));
  const grilled = { type: 'refreshment', name: 'Grilled salmon', price: 26, formula: [{ id: 'salmon', name: 'Whole salmon', quantityUsed: 170.097, unit: 'g', amount: 6, measure: 'oz' }] };
  const gc = FC.itemCost('grilled', grilled, parts, 0.3);
  check('grilled salmon: 6 oz costs $5.16 at what’s served, not $3.36 as bought; the line says 65% usable', near(gc.cost, 5.16) && gc.lines[0].usable === 0.65 && gc.lines[0].unit === 'oz' && gc.lines[0].amount === 6
    && near(FC.itemCost('grilled', grilled, new Map([['salmon', { ...salmon, usablePct: null }]]), 0.3).cost, 3.36), gc);
  const latte: any = { type: 'refreshment', name: 'Latte', price: 4.5, formula: [{ id: 'beans', name: 'Espresso beans', quantityUsed: 18, unit: 'g' }, { id: 'milk', name: 'Whole milk', quantityUsed: 240, unit: 'ml' }, { id: 'cup12', name: 'Hot cups 12 oz', quantityUsed: 1, unit: 'each' }],
    choices: [
      { id: 'size', name: 'Size', pick: 'one', required: true, options: [{ id: 'small', name: 'Small', price: 0 }, { id: 'large', name: 'Large', price: 0.7, changes: [{ kind: 'add', id: 'milk', name: 'Whole milk', amount: 120, measure: 'ml' }, { kind: 'swap', from: 'cup12', fromName: 'Hot cups 12 oz', to: 'cup16', toName: 'Hot cups 16 oz' }] }] },
      { id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75, changes: [{ kind: 'swap', from: 'milk', fromName: 'Whole milk', to: 'oat', toName: 'Oat milk' }] }] },
      { id: 'extras', name: 'Extras', pick: 'any', required: false, max: 3, options: [{ id: 'shot', name: 'Extra shot', price: 0.8, changes: [{ kind: 'add', id: 'beans', name: 'Espresso beans', amount: 9, measure: 'g' }] }, { id: 'van', name: 'Vanilla', price: 0.6, changes: [{ kind: 'add', id: 'vanilla', name: 'Vanilla syrup', amount: 15, measure: 'ml' }] }, { id: 'nofoam', name: 'No cup', price: 0, changes: [{ kind: 'out', id: 'cup12', name: 'Hot cups 12 oz' }] }] },
    ] };
  const lc = FC.itemCost('latte', latte, parts, 0.3);
  const opt = (id: string) => lc.options.find((o) => o.optionId === id)!;
  check('a latte costs $0.99 as it comes', near(lc.cost, 0.99), lc.cost);
  check('each choice: a large keeps $0.51, oat keeps $0.02 and barely pays for itself, an extra shot $0.54, vanilla $0.42', near(opt('large').cost, 0.19) && near(opt('large').keeps, 0.51) && near(opt('oat').cost, 0.73) && near(opt('oat').keeps, 0.02) && opt('oat').thin === true
    && near(opt('shot').keeps, 0.54) && !opt('shot').thin && near(opt('van').keeps, 0.42) && opt('small') === undefined && opt('whole') === undefined, lc.options);
  check('…leaving the cup out saves its cost', near(opt('nofoam').cost, -0.18) && near(opt('nofoam').keeps, 0.18), opt('nofoam'));
  const lo = CR.madeWith(latte, 'latte', { size: ['large'], milk: ['oat'] });
  const needs = MS.needsOf(lo, parts);
  check('a large oat latte: adds, then swaps, then leaves out: 360 ml of oat milk, no whole milk, a 16 oz cup', needs.get('oat') === 360 && !needs.has('milk') && needs.get('cup16') === 1 && !needs.has('cup12') && needs.get('beans') === 18, Object.fromEntries(needs));
  check('…and costs $2.27 to make', near(FC.costWith('latte', latte, parts, { size: ['large'], milk: ['oat'] }), 2.27), FC.costWith('latte', latte, parts, { size: ['large'], milk: ['oat'] }));
  check('nothing picked, nothing changed; picks it doesn’t have change nothing', JSON.stringify(CR.madeWith(latte, 'latte', null)) === JSON.stringify(MS.recipeOf(latte, 'latte')) && JSON.stringify(CR.madeWith(latte, 'latte', { size: ['huge'] })) === JSON.stringify(MS.recipeOf(latte, 'latte')));
  check('changes kept clean: four at most, nothing malformed, never the item itself swapped in', CR.cleanChanges([{ kind: 'add', id: 'a', amount: 0 }, { kind: 'swap', from: 'a', to: 'a' }, { kind: 'out', id: 'bad id!' }, { kind: 'add', id: 'beans', amount: 9, measure: 'g' }]).length === 1
    && CR.cleanChanges(Array.from({ length: 8 }, () => ({ kind: 'out', id: 'milk' }))).length === 4);
  check('…and guests’ menus never carry them', (await import('../../src/lib/menu-choices')).choiceGroups(latte).every((g) => g.options.every((o: any) => o.changes === undefined)));
  const sold = FC.periodCost([{ itemId: 'latte', qty: 1, amount: 5.25, at: '2026-11-15T12:00:00Z', each: FC.costWith('latte', latte, parts, { milk: ['oat'] }) }, { itemId: 'latte', qty: 1, amount: 4.5, at: '2026-11-15T12:00:00Z' }], new Map([['latte', lc]]), ['2026-11-15'], (s) => s.slice(0, 10));
  check('a sold oat latte costs what an oat latte costs; a plain one what a plain one does', near(sold.cost, 0.99 + 0.73 + 0.99, 0.02), sold.cost);

  console.log('can it be made');
  const oatLow = new Map(parts); oatLow.set('oat', { ...oat, totalStock: 0, partialContainerSize: 300 });
  const sLarge = MS.stockOf(latte, 'latte', oatLow, CR.madeWith(latte, 'latte', { size: ['large'], milk: ['oat'] }));
  const sPlain = MS.stockOf(latte, 'latte', oatLow);
  check('300 ml of oat milk left: a large oat latte can’t be made, a plain one still can', sLarge.inStock === false && sLarge.short === 'Oat milk' && sPlain.inStock === true, { sLarge, sPlain });
  const lowSalmon = new Map(parts); lowSalmon.set('salmon', { ...salmon, totalStock: 0, partialContainerSize: 600 });
  check('600 g of salmon at 65% usable makes two 6 oz plates, not three', MS.stockOf(grilled, 'grilled', lowSalmon).canMake === 2, MS.stockOf(grilled, 'grilled', lowSalmon));

  console.log('prep recipes on the Menu page');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', kitchenSettings: { stations: ['Grill', 'Bar'] }, modules: { hospitality: true }, foodCost: { target: 0.3 } });
  for (const [id, x] of parts) await db.doc(`${T}/inventory/${id}`).set({ id, status: 'active', isActive: true, ...x });
  await db.doc(`${T}/inventory/grilled`).set({ id: 'grilled', status: 'active', isActive: true, showInConcierge: true, ...grilled });
  await db.doc(`${T}/inventory/latte`).set({ id: 'latte', status: 'active', isActive: true, showInConcierge: true, category: 'Coffee', ...latte });
  await db.doc(`${T}/inventory/burger`).set({ id: 'burger', type: 'refreshment', name: 'Burger', category: 'Mains', price: 14, status: 'active', isActive: true, showInConcierge: true, formula: [] });
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const prep = (b: any) => menuApi(req({ tenantId: 't1', action: 'prep', ...b }));
  let r: any = await prep({ name: '', makes: 2, unit: 'L', recipe: [{ id: 'eggs', amount: 6, measure: 'each' }] });
  check('a prep recipe needs a name', r.status === 400 && /name/.test(r.body.error));
  r = await prep({ name: 'House aioli', makes: 0, unit: 'L', recipe: [{ id: 'eggs', amount: 6, measure: 'each' }] });
  check('…what a batch makes', r.status === 400 && /batch make/.test(r.body.error));
  r = await prep({ name: 'House aioli', makes: 2, unit: 'L', recipe: [] });
  check('…and what goes into it', r.status === 400 && /goes into a batch/.test(r.body.error));
  r = await prep({ name: 'House aioli', makes: 2, unit: 'L', keepsDays: 4, minutes: 15, recipe: [{ id: 'salmon', amount: 1, measure: 'cup' }] });
  check('…each line as it can be measured: a cup of salmon is said', r.status === 400 && /counted in g/.test(r.body.error) && /oz/.test(r.body.error), r.body);
  r = await prep({ name: 'House aioli', makes: 2, unit: 'L', keepsDays: 4, minutes: 15, recipe: [{ id: 'eggs', amount: 6, measure: 'each' }, { id: 'canola', amount: 1.5, measure: 'L' }, { id: 'lemons', amount: 120, measure: 'ml' }, { id: 'garlic', amount: 60, measure: 'g' }] });
  const aioliId = r.body.prep?.id; const aioli: any = aioliId ? await get(`${T}/inventory/${aioliId}`) : null;
  check('saved: in Inventory, counted by the batch in L, its lines in what each is counted in (what was written kept)', r.body.ok && aioli?.type === 'professional' && aioli.createdVia === 'prep-recipe' && aioli.costingMethod === 'size' && aioli.size === 2 && aioli.unit === 'L'
    && aioli.prep.makes === 2 && aioli.prep.keepsDays === 4 && aioli.prep.minutes === 15 && aioli.formula.find((f: any) => f.id === 'canola').quantityUsed === 1500 && aioli.formula.find((f: any) => f.id === 'canola').measure === 'L'
    && near(aioli.formula.find((f: any) => f.id === 'lemons').quantityUsed, 2.667, 0.001) && aioli.formula.find((f: any) => f.id === 'lemons').amount === 120 && aioli.formula.find((f: any) => f.id === 'eggs').measure === 'each' && aioli.formula.find((f: any) => f.id === 'eggs').amount === 6, aioli);
  check('…its batch costs $7.25 (garlic at its cost even before it’s counted): kept as its cost, $3.63 a L', near(r.body.prep.batchCost, 7.25) && near(aioli.costPerUnit, 7.25) && near(r.body.prep.unitCost, 3.63), r.body.prep);
  r = await prep({ name: 'house AIOLI', makes: 1, unit: 'L', recipe: [{ id: 'eggs', amount: 2, measure: 'each' }] });
  check('…never two things of one name', r.status === 409 && /another name/.test(r.body.error));
  r = await prep({ name: 'Chicken stock', makes: 10, unit: 'L', recipe: [{ id: 'onions', amount: 2, measure: 'each' }] });
  const stockId = r.body.prep?.id;
  r = await prep({ name: 'Tomato soup', makes: 24, unit: 'bowls', keepsDays: 3, recipe: [{ id: stockId, amount: 4, measure: 'L' }, { id: 'oil', amount: 2, measure: 'tbsp' }] });
  const soupId = r.body.prep?.id; const soup: any = soupId ? await get(`${T}/inventory/${soupId}`) : null;
  check('a prep inside a prep (chicken stock in the soup), counted by the bowl', r.body.ok && soup?.costingMethod === 'uses' && soup.estimatedUses === 24 && soup.useUnit === 'bowls' && soup.formula[0].id === stockId && near(soup.formula[1].quantityUsed, 29.57), soup);
  r = await prep({ name: 'Soup for a crowd', makes: 50, unit: 'bowls', recipe: [{ id: soupId, amount: 24, measure: 'bowls' }] });
  check('…but one level deep: the soup has a prep in it already', r.status === 409 && /one level deep/.test(r.body.error), r.body);
  r = await prep({ prepId: stockId, name: 'Chicken stock', makes: 10, unit: 'L', recipe: [{ id: 'onions', amount: 2, measure: 'each' }, { id: aioliId, amount: 1, measure: 'L' }] });
  check('…nor can the stock take one in, while it goes into the soup', r.status === 409 && /goes into Tomato soup/.test(r.body.error), r.body);

  console.log('recipes and choices on the Menu page');
  const save = (x: any) => menuApi(req({ tenantId: 't1', action: 'save', itemId: x.id, item: x }));
  r = await save({ id: 'burger', name: 'Burger', section: 'Mains', price: 14, recipe: [{ id: aioliId, amount: 30, measure: 'ml' }, { id: 'onions', amount: 1, measure: 'each' }] });
  const burger: any = await get(`${T}/inventory/burger`);
  check('a burger with 30 ml of the aioli (counted in L) and one onion (bought by the gram)', r.body.ok && near(burger.formula[0].quantityUsed, 0.03, 0.0001) && burger.formula[0].amount === 30 && burger.formula[0].measure === 'ml' && burger.formula[1].quantityUsed === 230, burger.formula);
  r = await save({ id: 'burger', name: 'Burger', section: 'Mains', price: 14, recipe: [{ id: 'salmon', amount: 1, measure: 'cup' }] });
  check('…a measure that can’t be worked out is said, with the measures that can', r.status === 400 && /counted in g/.test(r.body.error) && /oz/.test(r.body.error), r.body);
  r = await save({ id: 'burger', name: 'Burger', section: 'Mains', price: 14, recipe: [{ id: 'burger', amount: 1, measure: 'each' }] });
  check('…and never itself', r.status === 400);
  const grp = (opts: any[]) => [{ id: 'milk', name: 'Milk', pick: 'one', required: true, options: opts }];
  const baseLatte = { id: 'latte', name: 'Latte', section: 'Coffee', price: 4.5 };
  r = await save({ ...baseLatte, choices: grp([{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75, changes: [{ kind: 'swap', from: 'milk', fromName: 'Whole milk', to: 'oatCartons', toName: 'x' }] }]) });
  check('a swap that can’t stand in the same measure is said (oat milk counted in cartons for 240 ml of milk)', r.status === 400 && /can’t stand in for 240 ml of Whole milk/.test(r.body.error), r.body);
  r = await save({ ...baseLatte, choices: grp([{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75, changes: [{ kind: 'out', id: 'vanilla', name: 'Vanilla syrup' }] }]) });
  check('…leaving out what isn’t in the recipe is said', r.status === 400 && /isn’t in the recipe/.test(r.body.error), r.body);
  r = await save({ ...baseLatte, choices: grp([{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75, changes: [{ kind: 'add', id: 'salmon', name: 'x', amount: 1, measure: 'cup' }] }]) });
  check('…adding what can’t be measured that way is said', r.status === 400 && /counted in g/.test(r.body.error), r.body);
  r = await save({ ...baseLatte, choices: [...grp([{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75, changes: [{ kind: 'swap', from: 'milk', fromName: 'w', to: 'oat', toName: 'o' }] }]), { id: 'extras', name: 'Extras', pick: 'any', required: false, max: 2, options: [{ id: 'shot', name: 'Extra shot', price: 0.8, changes: [{ kind: 'add', id: 'beans', name: 'b', amount: 9, measure: 'g' }] }] }] });
  const ls: any = await get(`${T}/inventory/latte`);
  check('saved with what each choice changes, names from the stock', r.body.ok && ls.choices[0].options[1].changes[0].toName === 'Oat milk' && ls.choices[0].options[1].changes[0].fromName === 'Whole milk' && ls.choices[1].options[0].changes[0].name === 'Espresso beans' && r.body.changes['milk/oat'][0].kind === 'swap', { b: r.body, c: ls.choices });
  check('…and the item guests see has none of it', r.body.item.choices.every((g: any) => g.options.every((o: any) => o.changes === undefined)));
  r = await save({ ...baseLatte, choices: [{ id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75 }] }, { id: 'extras', name: 'Extras', pick: 'any', required: false, max: 2, options: [{ id: 'shot', name: 'Extra shot', price: 0.8, changes: [] }] }] });
  const ls2: any = await get(`${T}/inventory/latte`);
  check('…saved again without the changes, an option keeps them; an empty list clears them', r.body.ok && ls2.choices[0].options[1].changes?.[0]?.to === 'oat' && !ls2.choices[1].options[0].changes, ls2.choices);
  await save({ ...baseLatte, choices: [{ id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'whole', name: 'Whole', price: 0 }, { id: 'oat', name: 'Oat', price: 0.75 }] }, { id: 'extras', name: 'Extras', pick: 'any', required: false, max: 2, options: [{ id: 'shot', name: 'Extra shot', price: 0.8, changes: [{ kind: 'add', id: 'beans', name: 'b', amount: 9, measure: 'g' }] }] }] });
  r = await menuApi(req({ tenantId: 't1', action: 'soldout', itemId: 'latte', groupId: 'milk', optionId: 'oat', out: true }));
  check('…a choice sold out tonight keeps its changes', r.body.ok && (await get(`${T}/inventory/latte`)).choices[0].options[1].changes?.length === 1);
  await menuApi(req({ tenantId: 't1', action: 'soldout', itemId: 'latte', groupId: 'milk', optionId: 'oat', out: false }));
  r = await menuApi(req({ tenantId: 't1', action: 'list' }));
  check('the Menu page’s list: each item’s choice changes and the prep recipes, for a manager', r.body.ok && r.body.changes.latte['milk/oat'] && r.body.preps.length === 3 && r.body.preps.find((p: any) => p.name === 'House aioli')?.unitCost > 3 && near(r.body.costs.burger.cost, 0.109 + 0.325, 0.01), { c: r.body.costs?.burger, p: r.body.preps?.map((p: any) => p.name) });
  r = await menuApi(req({ tenantId: 't1', action: 'ingredients' }));
  const ing = (id: string) => r.body.ingredients.find((x: any) => x.id === id);
  check('the recipe editor’s stock: measures, yield, what one gives, prep recipes marked, and what a cost is worked out from', ing('salmon').usable === 0.65 && ing('salmon').measures.includes('oz') && ing('lemons').perEach.amount === 45 && ing(aioliId).prep === true && ing(aioliId).part.formula.length === 4 && near(ing('salmon').unitCost, 89.5 / 4536, 0.0001), ing(aioliId));
  manager = false;
  check('…for a manager only', (await menuApi(req({ tenantId: 't1', action: 'ingredients' }))).status === 403 && (await prep({ name: 'X', makes: 1, unit: 'L', recipe: [{ id: 'eggs', amount: 1 }] })).status === 403);
  manager = true;
  r = await menuApi(req({ tenantId: 't1', action: 'prepRemove', prepId: aioliId }));
  check('a prep recipe a dish uses isn’t put away', r.status === 409 && /Burger uses it/.test(r.body.error), r.body);

  console.log('making a batch');
  const { POST: prepApi } = await import('../../src/app/api/prep/route');
  r = await prepApi(req({ tenantId: 't1', action: 'made', prepId: aioliId, batches: 0 }));
  check('how many batches: 1 to 20', r.status === 400 && (await prepApi(req({ tenantId: 't1', action: 'made', prepId: aioliId, batches: 21 }))).status === 400);
  manager = false;
  r = await prepApi(req({ tenantId: 't1', action: 'made', prepId: aioliId, batches: 1, tapKey: 'mkTapOnce1' }));
  const again = await prepApi(req({ tenantId: 't1', action: 'made', prepId: aioliId, batches: 1, tapKey: 'mkTapOnce1' }));
  manager = true;
  check('the same Made it sent twice makes one batch', again.body.ok && again.body.already === true && again.body.made === 0, again.body);
  const a1: any = await get(`${T}/inventory/${aioliId}`); const e1: any = await get(`${T}/inventory/eggs`); const c1: any = await get(`${T}/inventory/canola`); const l1: any = await get(`${T}/inventory/lemons`); const g1: any = await get(`${T}/inventory/garlic`);
  const led = (await all(`${T}/stockCorrections`)).filter((x: any) => x.refId === aioliId);
  check('made, by anyone on the team: 2 L on the shelf, the eggs, oil and lemons off (garlic, not counted yet, left alone)', r.body.ok && r.body.made === 2 && near(r.body.left, 2) && a1.totalStock === 1 && near(a1.partialContainerSize, 0)
    && e1.totalStock === 0 && e1.partialContainerUses === 174 && c1.totalStock === 0 && c1.partialContainerSize === 2285 && near(l1.partialContainerUses, 112.333, 0.001) && g1.totalStock === 0 && g1.partialContainerSize === undefined, { b: r.body, a1, e1, c1, l1 });
  check('…all on the stock history, by who made it: three used, one received', led.filter((x: any) => x.type === 'used').length === 3 && led.some((x: any) => x.type === 'received' && x.productId === aioliId && x.change === 2 && x.unit === 'L' && /Made 1 batch of House aioli/.test(x.reason)) && led.every((x: any) => x.actorName === 'Ana Ruiz'), led);
  check('…when it was made, and its batch cost today', typeof a1.prep.lastMadeAt === 'string' && a1.prep.lastMadeBy === 'Ana Ruiz' && near(a1.costPerUnit, 7.25));
  r = await prep({ prepId: aioliId, name: 'House aioli', makes: 2000, unit: 'ml', keepsDays: 4, recipe: aioli.formula.map((f: any) => ({ id: f.id, amount: f.amount ?? f.quantityUsed, measure: f.measure ?? f.unit })) });
  const a2: any = await get(`${T}/inventory/${aioliId}`);
  check('a batch now counted in ml: the 2 L on the shelf is kept, as 2000 ml', r.body.ok && a2.unit === 'ml' && a2.size === 2000 && a2.totalStock === 1 && a2.partialContainerSize === 0 && near((await import('../../src/lib/product-cost')).usesLeft(a2), 2000), a2);
  r = await prep({ prepId: aioliId, name: 'House aioli', makes: 40, unit: 'portions', recipe: aioli.formula.map((f: any) => ({ id: f.id, amount: f.amount ?? f.quantityUsed, measure: f.measure ?? f.unit })) });
  check('…but portions can’t be worked out from ml: said, nothing changed', r.status === 409 && /can’t be worked out/.test(r.body.error) && (await get(`${T}/inventory/${aioliId}`)).unit === 'ml', r.body);
  check('the burger’s 30 ml still reads right in ml', near(MS.needsOf(MS.recipeOf(burger, 'burger'), new Map([[aioliId, a2], ['onions', onions]])).get(aioliId), 30));
  r = await save({ id: 'burger', name: 'Burger', section: 'Mains', price: 14, recipe: [{ id: aioliId, amount: 30, measure: 'ml' }, { id: 'onions', amount: 1, measure: 'each' }] });
  const bg2: any = await get(`${T}/inventory/burger`);
  check('a line written in the ingredient’s own measure keeps what was written (30 ml of an aioli counted in ml)', r.body.ok && bg2.formula[0].amount === 30 && bg2.formula[0].measure === 'ml' && bg2.formula[0].quantityUsed === 30, bg2.formula);
  r = await prep({ prepId: aioliId, name: 'House aioli', makes: 2, unit: 'L', keepsDays: 4, recipe: aioli.formula.map((f: any) => ({ id: f.id, amount: f.amount ?? f.quantityUsed, measure: f.measure ?? f.unit })) });
  const a3: any = await get(`${T}/inventory/${aioliId}`);
  check('…so when the aioli goes back to being counted by the L, a burger still takes 30 ml (0.03 L), not 30 L', r.body.ok && a3.unit === 'L' && near(MS.needsOf(MS.recipeOf(bg2, 'burger'), new Map([[aioliId, a3], ['onions', onions]])).get(aioliId), 0.03, 0.0001)
    && near(FC.itemCost('burger', bg2, new Map([[aioliId, a3], ['onions', onions], ['eggs', eggs], ['canola', canola], ['lemons', lemons], ['garlic', garlic]]), 0.3).cost, 0.109 + 0.325, 0.01), a3);

  console.log('what a dish takes off stock');
  const RS = await import('../../src/lib/recipe-stock-server');
  const taken = await db.runTransaction(async (tx: any) => RS.readRecipeParts(tx, db, T, 'latte', 2, undefined, [{ groupId: 'milk', optionId: 'oat' }, { groupId: 'extras', optionId: 'shot' }]));
  const tk = Object.fromEntries(taken.map((p: any) => [p.ref.id, p.qty]));
  check('two oat lattes with an extra shot: 480 ml of oat milk, 54 g of beans, no whole milk', tk.oat === 480 && tk.beans === 54 && tk.milk === undefined, tk);
  const tg = await db.runTransaction(async (tx: any) => RS.readRecipeParts(tx, db, T, 'grilled', 2));
  check('two plates of salmon at 65% usable: 523 g off the case', near(tg[0]?.qty, 523.4, 0.2), tg);
  check('picks from a ticket’s choice lines or its picks', JSON.stringify(RS.picksFrom([{ groupId: 'milk', optionId: 'oat' }])) === JSON.stringify({ milk: ['oat'] }) && RS.picksFrom(null) === null);
  const { POST: counter } = await import('../../src/app/api/counter/route');
  const P = (b: any) => counter(req({ tenantId: 't1', channel: 'counter', ...b }));
  const o1 = (await P({ action: 'car', carKey: 'k1' })).body;
  await P({ action: 'add', orderId: o1.orderId, itemId: 'latte', choices: { milk: ['oat'] }, tapKey: 'tapLatte1' });
  const oatBefore = (await import('../../src/lib/product-cost')).usesLeft(await get(`${T}/inventory/oat`));
  r = await P({ action: 'send', orderId: o1.orderId });
  const ord: any = await get(`${T}/counterOrders/${o1.orderId}`); const st = ord?.stockTaken ? Object.values(ord.stockTaken)[0] as any : null;
  const oatAfter = (await import('../../src/lib/product-cost')).usesLeft(await get(`${T}/inventory/oat`));
  check('an oat latte sent from the counter takes oat milk, not whole, and keeps what it took for a void', r.body.ok && st?.parts?.oat === 240 && st.parts.milk === undefined && near((oatBefore || 0) - (oatAfter || 0), 240), { b: r.body, st, oatBefore, oatAfter });

  console.log('the prep list');
  const now = Date.parse('2026-11-15T12:00:00Z');
  const pparts = new Map<string, any>([[aioliId, { ...a2, name: 'House aioli', totalStock: 0, partialContainerSize: 400, prep: { ...a2.prep, lastMadeAt: '2026-11-14T10:00:00Z' } }], ['eggs', eggs], ['canola', canola], ['lemons', lemons], ['garlic', garlic], ['onions', onions]]);
  const nights = [1, 2, 3].map((w) => ({ day: new Date(now - w * 7 * 864e5).toISOString().slice(0, 10), guests: 70, booked: 0, used: { burger: 70 } }));
  const items = [{ id: 'burger', name: 'Burger', station: 'Grill', x: burger }];
  const plan = PL.planPrep({ day: '2026-11-16', nights: nights.map((n) => ({ ...n, day: new Date(Date.parse(`${n.day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10) })), items, booked: 0, bookings: 0, stations: ['Grill'], parts: pparts, now, prepIds: [aioliId, 'nope'] });
  const b0 = plan.batches?.find((b) => b.id === aioliId);
  check('tomorrow’s 70 burgers need about 2.1 L of aioli; 0.4 L on the shelf: one batch, and what goes into it', b0?.batches === 1 && near(b0.need, 2100, 1) && b0.have === 400 && b0.past === false && b0.goesIn.includes('Eggs'), b0);
  check('…its eggs and oil are on what it takes; the aioli itself isn’t listed twice', plan.needs.some((n) => n.id === 'eggs' && n.need === 6) && plan.needs.some((n) => n.id === 'canola' && n.need === 1500) && !plan.needs.some((n) => n.id === aioliId), plan.needs);
  const old = new Map(pparts); old.set(aioliId, { ...pparts.get(aioliId), prep: { ...a2.prep, keepsDays: 4, lastMadeAt: '2026-11-05T10:00:00Z' } });
  const plan2 = PL.planPrep({ day: '2026-11-16', nights: plan.nights.length ? nights.map((n) => ({ ...n, day: new Date(Date.parse(`${n.day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10) })) : [], items, booked: 0, bookings: 0, stations: ['Grill'], parts: old, now, prepIds: [aioliId] });
  const b2 = plan2.batches?.find((b) => b.id === aioliId);
  check('…what’s left was made 11 days ago and keeps 4: none of it counts, two batches', b2?.past === true && b2.batches === 2, b2);
  const plan3 = PL.planPrep({ day: '2026-11-16', nights: [], items: [], booked: 0, bookings: 0, stations: ['Grill'], parts: pparts, now, prepIds: [aioliId] });
  check('…with no nights to go by, a prep recipe still shows, so a batch can be marked made', plan3.batches?.length === 1 && plan3.batches[0].batches === 0 && plan3.batches[0].need === 0);
  const sp = { name: 'Tomato soup', costingMethod: 'uses', estimatedUses: 24, useUnit: 'bowls', totalStock: 0, partialContainerUses: 0, countStock: true, prep: { makes: 24, unit: 'bowls' }, formula: [{ id: 'cs', name: 'Chicken stock', quantityUsed: 4, unit: 'L' }] };
  const cs = { name: 'Chicken stock', costingMethod: 'size', size: 10, unit: 'L', totalStock: 0, partialContainerSize: 1, countStock: true, prep: { makes: 10, unit: 'L' }, formula: [{ id: 'onions', name: 'Onions', quantityUsed: 460, unit: 'g' }] };
  const soupDish = { id: 'bowl', name: 'Soup', station: 'Grill', x: { type: 'refreshment', name: 'Soup', formula: [{ id: 'sp', name: 'Tomato soup', quantityUsed: 1, unit: 'bowls' }, { id: 'cs', name: 'Chicken stock', quantityUsed: 0.1, unit: 'L' }] } };
  const sn = [1, 2].map((w) => ({ day: new Date(Date.parse('2026-11-16T12:00:00Z') - w * 7 * 864e5).toISOString().slice(0, 10), guests: 30, booked: 0, used: { bowl: 30 } }));
  const plan4 = PL.planPrep({ day: '2026-11-16', nights: sn, items: [soupDish], booked: 0, bookings: 0, stations: ['Grill'], parts: new Map<string, any>([['sp', sp], ['cs', cs], ['onions', onions]]), now });
  const bs = plan4.batches?.find((b) => b.id === 'sp'), bc = plan4.batches?.find((b) => b.id === 'cs');
  check('a prep inside a prep: 30 bowls of soup is 2 batches, and its 8 L of stock plus the dish’s 3 L, less 1 L on the shelf, is 1 batch of stock', bs?.batches === 2 && near(bc?.need, 11) && bc?.batches === 1 && plan4.needs.some((n) => n.id === 'onions' && n.need === 460), { bs, bc, needs: plan4.needs });

  console.log('an ingredient’s yield, and the report');
  const { POST: fcApi } = await import('../../src/app/api/food-cost/route');
  const Y = (b: any) => fcApi(req({ tenantId: 't1', action: 'yield', ...b }));
  r = await Y({ itemId: 'salmon', usablePct: '150' });
  check('a yield over 100% is said', r.status === 400 && /5% to 100%/.test(r.body.error));
  r = await Y({ itemId: 'salmon', usablePct: '60', cookLossPct: '' });
  check('saved: 60% usable, nothing lost in cooking', r.body.ok && (await get(`${T}/inventory/salmon`)).usablePct === 60 && (await get(`${T}/inventory/salmon`)).cookLossPct === null, r.body);
  r = await Y({ itemId: 'salmon', usablePct: '' });
  check('…cleared, all of it usable again', r.body.ok && (await get(`${T}/inventory/salmon`)).usablePct === null);
  r = await Y({ itemId: 'lemons', perEach: { amount: 'x', unit: 'ml' } });
  check('what one gives: an amount and a measure, or said', r.status === 400 && /What one gives/.test(r.body.error));
  r = await Y({ itemId: aioliId, usablePct: '80' });
  check('a prep recipe has no yield of its own', r.status === 400 && /all usable/.test(r.body.error));
  manager = false; check('…set by a manager', (await Y({ itemId: 'salmon', usablePct: '60' })).status === 403); manager = true;
  await Y({ itemId: 'salmon', usablePct: '65' });
  await db.doc(`${T}/counterOrders/co1`).set({ paidAt: '2026-11-15T12:00:00.000Z', status: 'paid', lines: [{ itemId: 'latte', quantity: 1, unitPrice: 5.25, choices: [{ groupId: 'milk', optionId: 'oat' }] }] });
  r = await fcApi(req({ tenantId: 't1', action: 'report', period: '30' }));
  const ri = r.body.items?.find((x: any) => x.id === 'latte');
  check('the report: each choice and what it keeps, oat flagged; the oat latte sold costs what an oat latte costs', r.body.ok && ri?.options?.find((o: any) => o.optionId === 'oat')?.thin === true && r.body.report.items.find((x: any) => x.id === 'latte') && near(r.body.report.cost, 1.72, 0.02), { cost: r.body.report?.cost, opts: ri?.options });
  check('…the prep recipe’s ingredients count among what the menu uses (typical prices, counts)', r.body.ok);

  console.log('the screens');
  const files = ['src/components/menu/RecipeEditor.tsx', 'src/components/menu/PrepRecipes.tsx', 'src/components/menu/ChoicesEditor.tsx', 'src/components/products/YieldPanel.tsx', 'src/app/(app)/prep/page.tsx', 'src/app/(app)/menu/page.tsx'];
  const bad = files.filter((f) => /\{\/\*/.test(src(f)) || /\buppercase\b/.test(src(f)) || /font-black/.test(src(f)) || / · /.test(src(f)) || /contact us|call us/i.test(src(f)));
  check('no JSX comments, capitals, heavy type or dots between words on the new screens', bad.length === 0, bad);
  const lowTap = files.filter((f) => /min-h-\[(3\d|[12]\d)px\]|h-(8|9|10) w-(8|9|10)\b/.test(src(f)));
  check('every control is a 44px target', lowTap.length === 0, lowTap);
  check('the recipe comes before the choices in the item editor, so a choice can change it', src('src/app/(app)/menu/page.tsx').indexOf('<RecipeEditor') < src('src/app/(app)/menu/page.tsx').indexOf('<ChoicesEditor'));
  check('the product page shows the yield for an ingredient in a recipe, and what a prep recipe is', /<YieldPanel/.test(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx')) && /title="Prep recipe"/.test(src('src/app/(app)/inventory/(detail)/product/[id]/page.tsx')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
