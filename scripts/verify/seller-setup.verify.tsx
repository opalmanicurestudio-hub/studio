// Checks setting up a business that sells and doesn't take bookings (design canvas: Seller setup): lib/business-shape
// takesBookings, the steps in lib/setup-guide, the counts in api/getting-started, the question at sign-up (page and
// api/signup), How your business works, and the setup page.
// - Asked at sign-up (a shop starts on "No, they buy"; never asked of food and drink), kept as tenant.shape.books, and
//   changeable in How your business works. Not said: books, as every business always did.
// - A seller's steps: details (customers), hours, products, payments, then while the shop's tools are on how customers
//   get their orders and opening the online shop, then the team if it's a team. No services or booking steps.
// - A business that books and chose the shop gets the products and opening steps too; one that never said keeps its list.
// - Done means really there: a product with a price; the shop open and not paused.
// - The setup page: the shop link instead of the booking link, no starter service menus, and where to say it books too.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/seller-setup.verify.tsx
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
class NR { status: number; body: any; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; } static json(body: any, init?: any) { return new NR(body, init); } }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor: { uid: 'u1', name: 'Ana Ruiz', isManager: true } }) };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer x' }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const ids = (s: { id: string }[]) => s.map((x) => x.id).join(',');

(async () => {
  const S = await import('../../src/lib/setup-guide');
  const B = await import('../../src/lib/business-shape');
  const none = { livePriced: 0, teamCount: 1 };

  console.log('who books');
  check('not said: books, as every business always did; only “no” says otherwise', B.takesBookings({}) && B.takesBookings({ shape: { books: true } }) && !B.takesBookings({ shape: { books: false } }) && B.takesBookings({ shape: { books: 'no' } }));
  check('which list: food keeps its own, a seller its own, everyone else the booking one', S.guideKind({ shape: { books: false } }) === 'sell' && S.guideKind({}) === 'book'
    && S.guideKind({ businessType: 'hospitality', shape: { books: false } }) === 'food');

  console.log('a seller’s steps');
  const seller = { shape: { books: false, solo: true }, modules: { retail: true } };
  let s = S.guideSteps(seller, none);
  check('with the shop: details, hours, products, payments, how customers get their orders, opening the shop; no booking steps', ids(s) === 'details,hours,products,payments,shop,open', ids(s));
  check('…in a seller’s words', s.find((x) => x.id === 'details')!.meaning.includes('customers see') && s.find((x) => x.id === 'shop')!.title === 'How customers get their orders' && s.find((x) => x.id === 'products')!.title === 'Your products and prices');
  check('…with the shop’s tools off (they’re what prices products): details, hours, payments', ids(S.guideSteps({ shape: { books: false }, teamSize: 'solo', modules: { retail: false } }, none)) === 'details,hours,payments');
  const team = S.guideSteps({ shape: { books: false, solo: false }, modules: { retail: true } }, { livePriced: 0, teamCount: 3 });
  check('…a team: the team step last, with nothing about booking people', ids(team).endsWith(',open,team') && team.at(-1)!.meaning === 'Add the people who work with you.' && team.at(-1)!.done);
  check('…every step opens a page that exists', s.every((x) => fs.existsSync(`src/app/(app)${x.href.split(/[?#]/)[0]}/page.tsx`)), s.map((x) => x.href));

  console.log('done means really there');
  s = S.guideSteps(seller, { ...none, productsToPrice: 4 });
  check('no product with a price yet: not done, and it says how many wait for one', !s.find((x) => x.id === 'products')!.done && s.find((x) => x.id === 'products')!.note === '4 ready for your prices');
  s = S.guideSteps(seller, { ...none, productsPriced: 6, productsToPrice: 2 });
  check('a product with a price: done, counted', s.find((x) => x.id === 'products')!.done && s.find((x) => x.id === 'products')!.note === '6 for sale, 2 still need a price');
  check('pressing Next can’t tick products or opening the shop', !S.guideSteps({ ...seller, setupGuide: { done: { products: 'x', open: 'x' } } }, none).some((x) => (x.id === 'products' || x.id === 'open') && x.done));
  const open = (rs: any) => S.guideSteps({ ...seller, retailSettings: rs }, none).find((x) => x.id === 'open')!;
  check('…already selling (products online, payments connected) counts as open, as Shop setup counts it; not while paused, nor online without payments',
    S.guideSteps({ ...seller, stripeAccountId: 'acct' }, { ...none, productsOnline: 2 }).find((x) => x.id === 'open')!.done && !S.guideSteps({ ...seller }, { ...none, productsOnline: 2 }).find((x) => x.id === 'open')!.done
    && !S.guideSteps({ ...seller, stripeAccountId: 'acct', retailSettings: { storePaused: true } }, { ...none, productsOnline: 2 }).find((x) => x.id === 'open')!.done);
  check('the shop opened: done; paused: not done, and it says so', open({ shopOpenedAt: '2026-11-01' }).done && !open({ shopOpenedAt: '2026-11-01', storePaused: true }).done && open({ shopOpenedAt: '2026-11-01', storePaused: true }).note === 'Paused: customers can’t buy right now' && !open({}).done);
  check('the guide’s Next and Skip keep these steps (the mark action knows them)', S.ALL_GUIDE_STEP_IDS.has('products') && S.ALL_GUIDE_STEP_IDS.has('open'));

  console.log('a business that books');
  check('one that chose the shop: products after services, opening after the shop’s ways', ids(S.guideSteps({ modules: { retail: true, team: false } }, none)) === 'details,hours,services,products,payments,booking,changes,messages,shop,open');
  check('one that never said (the shop’s tools only never switched off): its list as it was', ids(S.guideSteps({ modules: { team: false } }, none)) === 'details,hours,services,payments,booking,changes,messages,shop');
  const food = (t: any) => ids(S.guideSteps({ businessType: 'hospitality', modules: { team: false }, ...t }, none));
  check('food and drink: its own list, whatever was said about booking', food({ shape: { books: false } }) === food({}) && food({}).startsWith('details,hours,menu,payments') && !food({}).includes('products'), food({}));

  console.log('the counts');
  await db.doc(T).set({ name: 'Fern & Fig', shape: { books: false }, modules: { retail: true } });
  const inv = (id: string, x: any) => db.doc(`${T}/inventory/${id}`).set({ type: 'retail', ...x });
  await inv('a', { msrp: 24, showOnline: true }); await inv('b', { msrp: 18 }); await inv('c', { msrp: 0 }); await inv('a-red', { msrp: 24, parentId: 'a' }); await inv('d', { msrp: 9, status: 'archived' });
  await db.doc(`${T}/inventory/e`).set({ type: 'refreshment', price: 4 });
  const GS = await import('../../src/app/api/getting-started/route');
  let r: any = await GS.POST(req({ tenantId: 't1', action: 'guide' }));
  check('a seller: products with a price and still to price, each listing once (not its sizes, not archived, not food)', r.body.ok && r.body.facts.productsPriced === 2 && r.body.facts.productsToPrice === 1 && r.body.facts.productsOnline === 1 && r.body.kind === 'sell' && r.body.shopPath === '/shop/t1', r.body);
  await db.doc(T).set({ name: 'Opal', modules: {} });
  r = await GS.POST(req({ tenantId: 't1', action: 'guide' }));
  check('a business that books and never chose the shop: no product counts asked for', r.body.ok && r.body.facts.productsPriced === undefined && r.body.kind === 'book');
  r = await GS.POST(req({ tenantId: 't1', action: 'mark', step: 'products', as: 'skipped' }));
  check('a seller’s step can be put off for later', r.body.ok && !!(await db.doc(T).get()).data().setupGuide.skipped.products);

  console.log('sign-up');
  const page = src('src/app/(auth)/signup/page.tsx'); const api = src('src/app/api/signup/route.ts');
  check('the question: “Do people book time with you?”, a shop starting on “No, they buy”, never asked of food and drink', /Do people book time with you\?/.test(page) && /'Yes, they book'\], \[false, 'No, they buy'\]/.test(page)
    && /const booksNow = books \?\? type !== 'shop'; const asksBooks = !!type && type !== 'hospitality';/.test(page) && /aria-pressed=\{booksNow === k\}/.test(page) && /role="group" aria-labelledby="books-q"/.test(page));
  check('…sent only when asked; a seller gets the shop’s tools unless they chose their own', /\.\.\.\(asksBooks \? \{ books: booksNow \} : \{\}\)/.test(page) && /!booksNow && !rec\.includes\('inventory'\) \? \[\.\.\.rec, 'inventory'\] : rec/.test(page) && /'Getting your shop ready'/.test(page));
  check('…kept only when said, and never for food and drink; a seller always gets the shop’s tools (whatever was picked)', /const books = typeof b\.books === 'boolean' && type !== 'hospitality' \? b\.books : null;/.test(api) && /\.\.\.\(books !== null \? \{ shape: \{ books \} \} : \{\}\)/.test(api)
    && /if \(books === false && !tools\.includes\('inventory' as ToolId\)\) tools\.push\('inventory' as ToolId\);/.test(api) && api.indexOf('const tools = ') < api.indexOf('tools.push(\'inventory\''));
  check('the guide keeps which list it is and the shop’s link from the answer', /kind: r\.kind, shopPath: r\.shopPath/.test(src('src/components/settings/SetupGuide.tsx')));

  console.log('settings and the setup page');
  const card = src('src/components/settings/BusinessShapeCard.tsx'); const setup = src('src/app/(app)/settings/setup/page.tsx');
  check('How your business works: “People book time with you”, Yes or “No, they buy”, saved as shape.books, put back to worked out', /label="People book time with you"/.test(card) && /\{ value: 'no', label: 'No, they buy' \}/.test(card)
    && /save\('shape\.books', v === 'yes'/.test(card) && /reset\('shape\.books'/.test(card));
  check('the setup page: the shop link (and its own QR file) instead of the booking link, the shop’s look to design, no starter service menus, and where to say it books too',
    /\{sell \? <p className="text-\[13px\] font-semibold" style=\{\{ color: C\.muted \}\}>Your shop link<\/p> : <p className="text-\[13px\] font-semibold" style=\{\{ color: C\.muted \}\}>Your booking link<\/p>\}/.test(setup) && /download=\{sell \? 'shop-qr\.png' : 'booking-qr\.png'\}/.test(setup) && /href="\/retail-orders\/designer"/.test(setup)
    && /!food && !sell && g\.data\.facts\.livePriced === 0/.test(setup) && /Take bookings too\? Say so in/.test(setup) && /showBooking = sell \? shopOn :/.test(setup) && /useEffect\(\(\) => \{ setQr\(null\); \}, \[link\]\)/.test(setup));
  const mine = [page.split('Do people book time with you?')[0].slice(-800) + page.split('Do people book time with you?')[1].slice(0, 800), card, setup, src('src/lib/setup-guide.ts')].join('\n');
  check('in the app’s own words', !/font-black|call us|contact us/i.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
