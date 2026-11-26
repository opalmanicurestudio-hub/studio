// Checks setting up for food and drink (L20 round 12, design canvas "Food setup"): lib/food-starters (starter menus
// with recipes and typical ingredient costs), lib/food-setup (the questions and the plan), api/food-setup (the plan,
// and applying it), the food steps in lib/setup-guide, uncounted starter ingredients in lib/menu-stock, a first count in
// lib/stock-count, the menu's starter fields in lib/menu-server, and the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/food-setup.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
let manager = true;
class NR { status: number; body: any; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; } static json(body: any, init?: any) { return new NR(body, init); } }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => (manager ? { actor: { uid: 'u1', name: 'Ana Ruiz', isManager: true } } : { deny: NR.json({ ok: false, error: 'Only a manager can do that.' }, { status: 403 }) }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const S = await import('../../src/lib/food-starters');
  const F = await import('../../src/lib/food-setup');
  console.log('starter menus');
  const kinds = Object.keys(S.FOOD_STARTERS) as (keyof typeof S.FOOD_STARTERS)[];
  check('every kind has a menu, and every recipe uses ingredients that exist', kinds.length === 5 && kinds.every((k) => S.FOOD_STARTERS[k].length >= 7 && S.FOOD_STARTERS[k].every((x: any) => x.recipe.length && x.recipe.every(([key, q]: any) => S.INGREDIENT_BY_KEY.has(key) && q > 0))));
  check('every ingredient is bought in a container with a cost, measured in ml or g or counted', S.STARTER_INGREDIENTS.every((i) => i.cost > 0 && (i.how === 'size' ? (i.size || 0) > 0 && !!i.unit : (i.uses || 0) > 0 && !!i.useUnit)) && new Set(S.STARTER_INGREDIENTS.map((i) => i.key)).size === S.STARTER_INGREDIENTS.length);
  const latte = S.FOOD_STARTERS.cafe.find((x) => x.key === 'latte')!; const burger = S.FOOD_STARTERS.truck.find((x) => x.key === 'cheeseburger')!;
  check('what one costs to make, from its recipe (a latte about a dollar, a cheeseburger about $2.45)', Math.abs(S.starterCost(latte) - 0.99) < 0.02 && Math.abs(S.starterCost(burger) - 2.45) < 0.03, [S.starterCost(latte), S.starterCost(burger)]);
  check('a suggested price keeps the cost at its usual share, up to the next quarter', S.suggestPrice(0.99, 0.2) === 5 && S.suggestPrice(2.45, 0.3) === 8.25 && S.suggestPrice(1, 0.25) === 4 && S.suggestPrice(0, 0.3) === 0);
  check('every item’s suggested price is more than it costs', kinds.every((k) => S.FOOD_STARTERS[k].every((x: any) => S.suggestPrice(S.starterCost(x), x.target) > S.starterCost(x))));
  check('what an item likely contains comes from its ingredients', S.likelyAllergens(latte).join() === 'milk' && S.likelyAllergens(S.FOOD_STARTERS.cafe.find((x) => x.key === 'bagel')!).sort().join() === 'gluten,milk,sesame,soy,wheat' && S.likelyAllergens(S.FOOD_STARTERS.cafe.find((x) => x.key === 'espresso')!).length === 0);

  console.log('the questions and the plan');
  check('the usual ways to order for each kind; the answers cleaned', F.usualWays('restaurant').join() === 'table' && F.usualWays('cafe').join() === 'counter,ahead' && F.cleanAnswers({ kind: 'nope' }) === null
    && JSON.stringify(F.cleanAnswers({ kind: 'bar', ways: ['table', 'table', 'x'], team: 'huge' })) === JSON.stringify({ kind: 'bar', ways: ['table'], team: 'small' }) && F.cleanAnswers({ kind: 'truck', ways: [] })!.ways.join() === 'counter');
  const cafe = F.foodPlan({ kind: 'cafe', ways: ['counter', 'ahead'], team: 'solo' }, {});
  check('a café: a bar and a kitchen, no courses, its menu with costs and suggested prices', cafe.stations.join() === 'Bar,Kitchen' && cafe.courses === null && cafe.items.length === 14 && cafe.items.every((x) => x.course === null && x.suggested > x.cost)
    && cafe.items.find((x) => x.key === 'latte')!.lines.find((l) => l.name === 'Whole milk')?.unit === 'ml' && cafe.ingredients.length === new Set(cafe.items.flatMap((x) => x.lines.map((l) => l.name))).size);
  const rest = F.foodPlan({ kind: 'restaurant', ways: ['table'], team: 'mid' }, { kitchenSettings: { stations: ['Hot line', 'Bar'] }, modules: { team: false } });
  check('a restaurant: courses with table service, and the stations it already set are offered to keep', !!rest.courses && rest.items.some((x) => x.course === 3) && rest.ownStations?.join() === 'Hot line,Bar');
  const tools = (p: any) => Object.fromEntries(p.tools.map((t: any) => [t.id, `${t.fit}:${t.on}`]));
  check('the tools that fit, as they’re switched now (never switched here): a team for a team, not for one person', tools(rest).team === 'needed:false' && tools(cafe).team === 'not needed:true' && tools(cafe).lounge === 'needed:true');
  check('a food business, by what it said it is, or its food setup when it’s nothing else', F.isFoodBusiness({ foodSetup: { kind: 'cafe', primary: true } }) && !F.isFoodBusiness({ foodSetup: { kind: 'cafe' } }) && F.isFoodBusiness({ niche: 'hospitality' }) && F.isFoodBusiness({ businessType: 'hospitality' }) && !F.isFoodBusiness({ niche: 'nails' }));
  check('…a spa with a tea bar set up here stays a spa (its own setup steps)', !F.isFoodBusiness({ niche: 'spa', foodSetup: { kind: 'cafe', primary: true } }) && !F.isFoodBusiness({ name: 'Opal Manicure Studio', foodSetup: { kind: 'cafe' } })
    && F.foodIsMain({ name: 'Linden' }, false) && !F.foodIsMain({ name: 'Glow Collective' }, true) && !F.foodIsMain({ niche: 'spa' }, false) && F.foodIsMain({ name: 'Glow Collective', businessType: 'hospitality' }, true));

  console.log('its own setup steps');
  const G = await import('../../src/lib/setup-guide');
  const ids = (s: any[]) => s.map((x) => x.id).join(',');
  const none = { livePriced: 0, teamCount: 1, menuLive: 0, menuToPrice: 14 };
  const cafeSteps = G.guideSteps({ foodSetup: { kind: 'cafe', ways: ['counter', 'ahead'], team: 'solo', primary: true }, shape: { solo: true } }, none);
  check('a café that orders ahead: its menu in place of services, ordering ahead, kitchen screens and closing; no booking or cancellation steps', ids(cafeSteps) === 'details,hours,menu,payments,salestax,ordering,kitchen,closing', ids(cafeSteps));
  check('…a restaurant with a team: its tables and its team too', ids(G.guideSteps({ foodSetup: { kind: 'restaurant', ways: ['table'], team: 'mid', primary: true }, shape: { solo: false } }, none)) === 'details,hours,menu,payments,salestax,tables,kitchen,closing,team');
  check('the menu step is done once something is on the menu with a price, and counts what’s still to price', cafeSteps.find((s) => s.id === 'menu')!.note === '14 ready for your prices' && G.guideSteps({ foodSetup: { kind: 'cafe', ways: ['counter'], primary: true } }, { ...none, menuLive: 3, menuToPrice: 11 }).find((s) => s.id === 'menu')!.done);
  check('a food business that hasn’t said how guests order sees ordering ahead and tables both', ids(G.guideSteps({ niche: 'hospitality', shape: { solo: true } }, none)) === 'details,hours,menu,payments,salestax,ordering,tables,kitchen,closing', ids(G.guideSteps({ niche: 'hospitality', shape: { solo: true } }, none)));
  check('every food step opens a page that exists', G.FOOD_GUIDE_STEPS.every((s) => fs.existsSync(`src/app/(app)${s.href.split(/[?#]/)[0]}/page.tsx`)) && G.ALL_GUIDE_STEP_IDS.has('menu') && G.ALL_GUIDE_STEP_IDS.has('booking'));

  console.log('applying it');
  await db.doc(T).set({ name: 'Linden', businessType: 'hospitality', modules: { team: false, marketing: false } });
  await db.doc(`${T}/inventory/mymilk`).set({ name: 'Whole milk', type: 'professional', costingMethod: 'size', size: 3785, unit: 'ml', costPerUnit: 5.1, totalStock: 4 });
  await db.doc(`${T}/inventory/mybeans`).set({ name: 'Espresso beans', type: 'professional', costPerUnit: 70, totalStock: 2 });
  await db.doc(`${T}/inventory/mytea`).set({ name: 'Hot tea', type: 'refreshment', price: 3, showInConcierge: true });
  const R = await import('../../src/app/api/food-setup/route');
  manager = false;
  let r: any = await R.POST(req({ tenantId: 't1', action: 'plan', answers: { kind: 'cafe' } }));
  check('for owners and managers', r.status === 403);
  manager = true;
  r = await R.POST(req({ tenantId: 't1', action: 'plan', answers: { kind: 'cafe', ways: ['counter', 'ahead'], team: 'solo' } }));
  check('the plan says what the business already has (kept as it is)', r.body.ok && r.body.have.items.join() === 'tea' && r.body.have.ingredients.sort().join() === 'beans,milk' && r.body.plan.items.length === 14);
  r = await R.POST(req({ tenantId: 't1', action: 'apply', answers: { kind: 'cafe', ways: ['counter', 'ahead'], team: 'solo' }, skip: ['avotoast'] }));
  const t = await get(T); const inv = await all(`${T}/inventory`);
  const items = inv.filter((x: any) => x.createdVia === 'food-starter' && x.type === 'refreshment'); const ings = inv.filter((x: any) => x.createdVia === 'food-starter' && x.type !== 'refreshment');
  check('set up: its kind and answers kept, its stations set, no courses without table service', r.body.ok && t.foodSetup.kind === 'cafe' && t.foodSetup.ways.join() === 'counter,ahead' && t.kitchenSettings.stations.join() === 'Bar,Kitchen' && !t.kitchenSettings.courses && t.shape.solo === true && t.niche === 'hospitality');
  check('…its tools untouched (they’re chosen, and paid for, in Your ClarityFlow)', JSON.stringify(t.modules) === JSON.stringify({ team: false, marketing: false }));
  check('the menu items it didn’t have, less the one left out: no price, off the menu, with their recipes', r.body.added.items === 12 && items.length === 12 && !items.some((x: any) => x.name === 'Avocado toast' || x.name === 'Hot tea')
    && items.every((x: any) => x.price === 0 && x.showInConcierge === false && x.formula.length > 0 && x.isActive === true && x.course === null) && r.body.kept.items === 1);
  const lat = items.find((x: any) => x.name === 'Latte');
  check('…its milk is the business’s own milk (measured the same way); its likely allergens are only likely', lat.formula.find((l: any) => l.name === 'Whole milk')?.id === 'mymilk' && lat.allergensLikely.join() === 'milk' && !('allergens' in lat));
  check('…beans the business counts another way aren’t used with the starter’s amount: it says to add them itself', !lat.formula.some((l: any) => l.id === 'mybeans') && lat.recipeGaps.join() === 'Espresso beans');
  check('ingredients it didn’t have: typical costs, marked as typical, not counted yet', ings.length === r.body.added.ingredients && ings.every((x: any) => x.typicalCost === true && x.countStock === false && x.totalStock === 0 && x.costPerUnit > 0 && !!x.costingMethod)
    && !ings.some((x: any) => ['Whole milk', 'Espresso beans'].includes(x.name)) && !ings.some((x: any) => x.name === 'Avocados'));
  r = await R.POST(req({ tenantId: 't1', action: 'apply', answers: { kind: 'cafe', ways: ['counter', 'ahead'], team: 'solo' } }));
  check('applied again: only what’s missing (the one left out before)', r.body.ok && r.body.added.items === 1 && (await all(`${T}/inventory`)).filter((x: any) => x.name === 'Latte').length === 1);
  r = await R.POST(req({ tenantId: 't1', action: 'apply', answers: { kind: 'restaurant', ways: ['table'], team: 'mid' }, menu: false }));
  const t2 = await get(T);
  check('a restaurant keeps the stations it set, gets the usual courses, and adds no menu when asked not to', r.body.ok && t2.kitchenSettings.stations.join() === 'Bar,Kitchen' && t2.kitchenSettings.courses.length === 4 && r.body.added.items === 0);
  r = await R.POST(req({ tenantId: 't1', action: 'apply', answers: { kind: 'restaurant', ways: ['table'], team: 'mid' }, stations: ['  ', ''], menu: false }));
  check('…and won’t be left with nowhere to make things', r.status === 400);
  await db.doc('tenants/t2').set({ name: 'Calm Spa', niche: 'spa', shape: { solo: false } });
  const two = await Promise.all([1, 2].map(() => R.POST(req({ tenantId: 't2', action: 'apply', answers: { kind: 'cafe', ways: ['counter'], team: 'solo' } }))));
  const inv2 = await all('tenants/t2/inventory');
  check('two taps at once add each item and ingredient once', two.every((x: any) => x.body.ok) && inv2.filter((x: any) => x.name === 'Latte').length === 1 && inv2.filter((x: any) => x.name === 'Whole milk').length === 1, inv2.length);
  const spa = await get('tenants/t2');
  check('a spa setting up its tea bar stays a spa: what it is and its team answer aren’t changed', spa.niche === 'spa' && spa.shape.solo === false && spa.foodSetup.kind === 'cafe' && spa.foodSetup.primary === false);
  await db.doc('tenants/t3').set({ name: 'Glow Collective', shape: { solo: true } }); await db.doc('tenants/t3/services/s1').set({ name: 'Facial', status: 'active' });
  await R.POST(req({ tenantId: 't3', action: 'apply', answers: { kind: 'cafe', ways: ['counter'], team: 'small' }, menu: false }));
  const glow = await get('tenants/t3'); const G2 = await import('../../src/lib/setup-guide');
  check('…so does a business with services of its own that never said what it is (no food steps, nothing about it changed)', !glow.niche && glow.shape.solo === true && glow.foodSetup.primary === false && G2.guideSteps(glow, none).some((x: any) => x.id === 'services'));

  await db.doc(`${T}/inventory/starter-item-latte`).delete?.();
  if ((await get(`${T}/inventory/starter-item-latte`))) await db.doc(`${T}/inventory/starter-item-latte`).set({ archived: true }, { merge: true });
  r = await R.POST(req({ tenantId: 't1', action: 'plan', answers: { kind: 'cafe', ways: ['counter'], team: 'solo' } }));
  const rem = r.body.have.removed;
  r = await R.POST(req({ tenantId: 't1', action: 'apply', answers: { kind: 'cafe', ways: ['counter'], team: 'solo' } }));
  const back1 = (await all(`${T}/inventory`)).filter((x: any) => x.name === 'Latte' && x.archived !== true).length;
  r = await R.POST(req({ tenantId: 't1', action: 'apply', answers: { kind: 'cafe', ways: ['counter'], team: 'solo' }, restore: ['latte'] }));
  const back2 = (await all(`${T}/inventory`)).filter((x: any) => x.name === 'Latte' && x.archived !== true).length;
  check('a starter item taken off isn’t put back by itself, only when ticked again', rem.includes('latte') && back1 === 0 && back2 === 1, { rem, back1, back2 });

  console.log('on the menu');
  const MS = await import('../../src/lib/menu-stock');
  const MV = await import('../../src/lib/menu-server');
  const ing = ings[0];
  check('a starter ingredient not counted yet never holds an item back', MS.ingredientLeft(ing) === null && MS.stockOf(lat, lat.id, new Map(ings.map((x: any) => [x.id, x]))).inStock === true);
  const mi = MV.menuItemOf(lat.id, lat, new Map());
  check('the menu item: from the starter, likely allergens until someone says, its recipe gaps, off the menu', mi.starter && mi.allergensLikely.join() === 'milk' && !mi.allergensSet && mi.recipeGaps.join() === 'Espresso beans' && !mi.onMenu && mi.price === 0);
  const SC = await import('../../src/lib/stock-count');
  const cr = await SC.recordCount(db, 't1', ing.id, 3, { id: 'u1', name: 'Ana Ruiz' });
  check('its first count: counted from now on', (cr as any).ok && (await get(`${T}/inventory/${ing.id}`)).countStock === true && MS.ingredientLeft(await get(`${T}/inventory/${ing.id}`)) !== null);

  const CO = await import('../../src/lib/counter-orders');
  check('an item off the menu can’t be ordered at the counter or ahead, even from a screen that still shows it', !CO.lineFor(lat, lat.id, 1, [], 'l1').ok && CO.lineFor({ ...lat, showInConcierge: true, price: 5 }, lat.id, 1, [], 'l1').ok);
  check('…nor a starter item switched on somewhere else at no price', !CO.lineFor({ ...lat, showInConcierge: true, price: 0 }, lat.id, 1, [], 'l1').ok && !MV.menuItemOf(lat.id, { ...lat, showInConcierge: true, price: 0 }).onMenu);
  const MR = await import('../../src/app/api/menu/route');
  r = await MR.POST(req({ tenantId: 't1', action: 'save', itemId: lat.id, item: { name: 'Latte', section: 'Coffee', price: 0, onMenu: true, choices: [] } }));
  const r2: any = await MR.POST(req({ tenantId: 't1', action: 'save', itemId: lat.id, item: { name: 'Latte', section: 'Coffee', price: 5, onMenu: true, choices: [] } }));
  check('a starter item goes on the menu only once it has a price', r.status === 400 && /price first/.test(r.body.error) && r2.body.ok && (await get(`${T}/inventory/${lat.id}`)).showInConcierge === true, [r.body, r2.body]);

  console.log('setup counts');
  const GS = await import('../../src/app/api/getting-started/route');
  r = await GS.POST(req({ tenantId: 't1', action: 'guide' }));
  check('the guide counts the food menu: on it with a price, and still to price', r.body.ok && r.body.facts.menuLive === 2 && r.body.facts.menuToPrice === 12 && r.body.food.set && r.body.food.kind === 'cafe' && r.body.food.ways.join() === 'counter', r.body.facts);
  r = await GS.POST(req({ tenantId: 't1', action: 'mark', step: 'closing', as: 'done' }));
  check('a food step can be marked done', r.body.ok && (await get(T)).setupGuide.done.closing);

  console.log('the screens');
  const page = src('src/app/(app)/settings/setup/food/page.tsx'), setup = src('src/app/(app)/settings/setup/page.tsx'), menu = (src('src/app/(app)/menu/page.tsx') + src('src/components/menu/ItemBuilder.tsx'));
  check('the food setup page: three questions, the plan, typical prices said so, tools changed only in Your ClarityFlow', /What do you run\?/.test(page) && /How do guests order\?/.test(page) && /Who’s working\?/.test(page) && /Nothing changes until you tap Set it up/.test(page) && /typical US prices/.test(page) && /href="\/subscriptions"/.test(page) && /action: 'apply'/.test(page));
  check('the setup page: set up for food in place of the services menu; the booking link only with tables', /Set up for food and drink/.test(setup) && /!food && !sell && g\.data\.facts\.livePriced === 0/.test(setup) && /showBooking = sell \? shopOn : !food \|\| food\.ways\.includes\('table'\)/.test(setup));
  check('the menu: “Needs a price”, likely allergens confirmed by a tap, recipe gaps, ordering ahead to link to', /Needs a price/.test(menu) && /Start from these/.test(menu) && /Anything not listed may still be in it/.test(menu) && /recipeGaps/.test(menu) && /id="order-ahead"/.test(menu));
  const fresh = [src('src/lib/food-setup.ts'), src('src/lib/food-starters.ts'), page, src('src/app/api/food-setup/route.ts')].join('\n');
  check('no emoji, all caps, niche words in what’s new', !/[\u{1F300}-\u{1FAFF}]/u.test(fresh) && !/\buppercase\b|font-black/.test(fresh) && !/\b(salon|stylist|booth|chair)\b/i.test(fresh.replace(/Booth and suite rental/g, '')));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
