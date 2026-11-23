// Checks what's offered at the end (lib/menu-upgrades, api/menu 'save', the guest's menu and placing in lib/counter-ahead).
// - The rules: the next size up is the next size listed that isn't sold out, when it costs more (nobody who picked the
//   biggest is asked); something to go with it only when it can be had (on the guest's menu, not sold out, not the item
//   itself, not in the order already); up to two, each once.
// - Saving on an item: the size up on or off, up to two of the business's own menu items, never itself; cleared with null.
// - The guest's menu carries them, with only items on that same menu.
// - Placing: a line taken as an offer is marked so only when the menu says it was offered; prices are the menu's either way.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/menu-upgrades.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

const S: any = { pis: new Map<string, any>(), n: 0 };
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => { const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', metadata: { ...p.metadata }, client_secret: `${id}_secret`, account: o?.stripeAccount }; S.pis.set(id, pi); return { ...pi }; },
    retrieve: async (id: string) => ({ ...S.pis.get(id) }),
    cancel: async (id: string) => ({ ...S.pis.get(id), status: 'canceled' }),
  };
  paymentMethodDomains = { list: async () => ({ data: [] }), create: async (p: any) => ({ id: 'pmd_1', domain_name: p.domain_name, enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' } }), update: async () => ({}), validate: async () => ({}) };
}
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const U = await import('../../src/lib/menu-upgrades');

  console.log('the rules');
  const size = { id: 'sz', name: 'Size', pick: 'one', required: true, options: [{ id: 's', name: '12 oz', price: 0 }, { id: 'm', name: '16 oz', price: 0.75 }, { id: 'l', name: '20 oz', price: 1.25 }] };
  const latte = { id: 'latte', choices: [size, { id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'w', name: 'Whole', price: 0 }, { id: 'o', name: 'Oat', price: 0.75 }] }], upgrades: { size: true, items: ['croissant', 'muffin'] } };
  const up = U.nextSize(latte, { sz: ['s'], milk: ['o'] });
  check('the next size up: the next one listed, and what it adds', up?.toId === 'm' && up.to === '16 oz' && up.from === '12 oz' && up.adds === 0.75, up);
  check('…from the middle size, the biggest', U.nextSize(latte, { sz: ['m'] })?.toId === 'l' && U.nextSize(latte, { sz: ['m'] })?.adds === 0.5);
  check('…nobody who picked the biggest is asked', U.nextSize(latte, { sz: ['l'] }) === null);
  const outMid = { choices: [{ ...size, options: size.options.map((o) => (o.id === 'm' ? { ...o, soldOut: true } : o)) }] };
  check('…a size sold out is passed over for the next one', U.nextSize(outMid, { sz: ['s'] })?.toId === 'l' && U.nextSize(outMid, { sz: ['s'] })?.adds === 1.25);
  const flat = { choices: [{ ...size, options: size.options.map((o) => ({ ...o, price: 0 })) }] };
  check('…sizes that cost the same: nothing to offer', U.nextSize(flat, { sz: ['s'] }) === null);
  check('…no size choice (a Milk choice isn’t a size), or none picked: nothing', U.nextSize({ choices: [latte.choices[1]] }, { milk: ['w'] }) === null && U.nextSize(latte, {}) === null);
  check('sized up: only the size changes', JSON.stringify(U.sizedUp({ sz: ['s'], milk: ['o'] }, up!)) === JSON.stringify({ sz: ['m'], milk: ['o'] }));
  check('kept on an item: at most two, each once, never itself, ids only', JSON.stringify(U.upgradesOf({ size: 'yes', items: ['a', 'a', 'latte', 'b c', 'b', 'c'] }, 'latte')) === JSON.stringify({ size: false, items: ['a', 'b'] }) && JSON.stringify(U.upgradesOf(null)) === JSON.stringify({ size: false, items: [] }));
  const menu = new Map<string, any>([['croissant', { id: 'croissant', soldOut: false }], ['muffin', { id: 'muffin', soldOut: true }]]);
  let o = U.offersFor(latte, { sz: ['s'] }, (id) => menu.get(id));
  check('offered: the size up and what can be had (a sold-out muffin isn’t)', o.size?.toId === 'm' && o.items.map((x) => x.id).join() === 'croissant', o);
  o = U.offersFor(latte, { sz: ['s'] }, (id) => menu.get(id), (id) => id === 'croissant');
  check('…something already in the order isn’t offered again', o.items.length === 0 && !!o.size);
  o = U.offersFor({ ...latte, upgrades: { size: false, items: ['croissant', 'gone'] } }, { sz: ['s'] }, (id) => menu.get(id));
  check('…the size up only when it’s on; an item not on the guest’s menu isn’t offered', o.size === null && o.items.length === 1);
  check('a line taken as an offer: something to go with it only when another line offers it', U.offerOf('item', { id: 'croissant' }, {}, [latte]) === 'item' && U.offerOf('item', { id: 'croissant' }, {}, [{ id: 'tea', upgrades: { items: ['muffin'] } }]) === null && U.offerOf('item', { id: 'croissant' }, {}, []) === null);
  check('…a size up only when its item offers one and a size past the first was picked', U.offerOf('size', latte, { sz: ['m'] }, []) === 'size' && U.offerOf('size', latte, { sz: ['s'] }, []) === null
    && U.offerOf('size', { ...latte, upgrades: { items: [] } }, { sz: ['m'] }, []) === null && U.offerOf('anything', latte, { sz: ['m'] }, [latte]) === null);

  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  await db.doc(T).set({ name: 'North Pier', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 0 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 4.5, totalStock: 50, choices: [size] });
  await db.doc(`${T}/inventory/croissant`).set({ type: 'refreshment', name: 'Butter croissant', category: 'Pastries', price: 3.25, totalStock: 20 });
  await db.doc(`${T}/inventory/muffin`).set({ type: 'refreshment', name: 'Blueberry muffin', category: 'Pastries', price: 3.5, totalStock: 20, isMembersOnly: true });
  await db.doc(`${T}/inventory/cup`).set({ type: 'retail', name: 'Paper cups', category: 'Supplies', price: 0.1, totalStock: 900 });
  await db.doc(`${T}/inventory/old`).set({ type: 'refreshment', name: 'Old scone', category: 'Pastries', price: 3, archived: true });
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b }));
  const save = (upgrades: any) => Mn({ action: 'save', itemId: 'latte', item: { name: 'Latte', section: 'Coffee', price: 4.5, choices: [size], upgrades } });

  console.log('saving on an item');
  let r: any = await save({ size: true, items: ['croissant', 'muffin'] });
  check('saved: the size up and two items to go with it', r.body.ok && JSON.stringify((await get(`${T}/inventory/latte`)).upgrades) === JSON.stringify({ size: true, items: ['croissant', 'muffin'] }) && r.body.item.upgrades.size === true && r.body.item.upgrades.items.length === 2, r.body);
  const self = await save({ size: true, items: ['latte'] });
  const three = await save({ size: false, items: ['croissant', 'muffin', 'old'] });
  const notMenu = await save({ size: false, items: ['cup'] });
  const archived = await save({ size: false, items: ['old'] });
  const junk = await save({ size: false, items: ['a b'] });
  check('refused: itself, more than two, something that isn’t on the menu (stock, or put away), and anything else', self.status === 400 && /itself/.test(self.body.error) && three.status === 400 && /Up to 2/.test(three.body.error)
    && notMenu.status === 400 && archived.status === 400 && /isn’t on the menu/.test(archived.body.error) && junk.status === 400, [self.body, three.body, notMenu.body, archived.body, junk.body]);
  check('…and what was saved stays as it was', JSON.stringify((await get(`${T}/inventory/latte`)).upgrades) === JSON.stringify({ size: true, items: ['croissant', 'muffin'] }));
  await Mn({ action: 'save', itemId: 'latte', item: { name: 'Latte', section: 'Coffee', price: 4.75, choices: [size] } });
  check('a save that doesn’t send them keeps them', JSON.stringify((await get(`${T}/inventory/latte`)).upgrades) === JSON.stringify({ size: true, items: ['croissant', 'muffin'] }) && (await get(`${T}/inventory/latte`)).price === 4.75);
  r = await save(null);
  check('null clears them', JSON.stringify((await get(`${T}/inventory/latte`)).upgrades) === JSON.stringify({ size: false, items: [] }), r.body);
  await save({ size: true, items: ['croissant', 'muffin'] });

  console.log('the guest’s menu');
  await Mn({ action: 'ahead', on: true, laterHours: 2 });
  r = await AHEAD(req({ tenantId: 't1', action: 'menu' }));
  const items = r.body.sections.flatMap((s: any) => s.items); const lt = items.find((i: any) => i.id === 'latte');
  check('the latte carries what’s offered with it: the members-only muffin isn’t on this menu, so it isn’t offered', JSON.stringify(lt?.upgrades) === JSON.stringify({ size: true, items: ['croissant'] }) && items.find((i: any) => i.id === 'croissant')?.upgrades?.items.length === 0, lt);

  console.log('placing');
  let k = 0; const place = (lines: any[]) => AHEAD(req({ tenantId: 't1', action: 'place', key: `keykeykey${++k}`, name: 'Jo', way: 'inside', lines }));
  r = await place([{ itemId: 'latte', quantity: 1, choices: { sz: ['m'] }, offer: 'size' }, { itemId: 'croissant', quantity: 1, offer: 'item' }]);
  let ord = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('taken as offers: both lines say so, at the menu’s prices', r.body.ok && ord.lines[0].offer === 'size' && ord.lines[1].offer === 'item' && ord.lines[0].unitPrice === 5.25 && ord.lines[1].unitPrice === 3.25 && r.body.total === 8.5, { body: r.body, lines: ord?.lines });
  r = await place([{ itemId: 'latte', quantity: 1, choices: { sz: ['s'] }, offer: 'size' }, { itemId: 'croissant', quantity: 1, offer: 'size' }]);
  ord = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('…not marked when it wasn’t one: the first size, or a kind that doesn’t fit', r.body.ok && ord.lines.every((l: any) => l.offer === undefined), ord?.lines);
  r = await place([{ itemId: 'croissant', quantity: 1, offer: 'item' }]);
  ord = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('…something to go with it, on its own: nothing in the order offers it, so it isn’t marked', r.body.ok && ord.lines[0].offer === undefined, ord?.lines);
  await save({ size: false, items: [] });
  r = await place([{ itemId: 'latte', quantity: 1, choices: { sz: ['l'] }, offer: 'size' }, { itemId: 'croissant', quantity: 1, offer: 'item' }]);
  ord = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('…and once the business stops offering them, neither is marked', r.body.ok && ord.lines.every((l: any) => l.offer === undefined), ord?.lines);

  console.log('the guest’s sheet (order ahead)');
  const fs = await import('fs'); const pg = fs.readFileSync('src/app/order/[tenantId]/page.tsx', 'utf8');
  check('right after Add: what’s offered, asked once on the same sheet (No thanks until something’s taken, then Done)', /<Sheet title=\{tr\('Added to your order'\)\}/.test(pg) && /tr\('Anything with it\?'\)/.test(pg) && /after\.took\.length \? tr\('Done'\) : tr\('No thanks'\)/.test(pg));
  check('…only what can be had: offersFor with the guest’s own menu and what’s in the order already; not again after a No thanks', /offersFor\(item, picks, \(id\) => byId\.get\(id\), \(id\) => cart\.some\(\(l\) => l\.itemId === id\)\)/.test(pg) && /if \(passed\.includes\(item\.id\)\) return;/.test(pg) && /setPassed\(\(p\) => \[\.\.\.p, after\.itemId\]\)/.test(pg));
  check('…the size up changes the line just added (priced by the menu’s rules); something with choices opens its own sheet, added without asking again', /const picks = sizedUp\(line\.picks, a\.size\); const p = priceChoices\(item, picks\)/.test(pg) && /if \(x\.choices\.length\) \{ setAfter\(null\); setOffered\(true\); setOpen\(x\); return; \}/.test(pg) && /if \(offered\) \{ setOffered\(false\); return; \}/.test(pg));
  check('…and each line says whether it was taken as an offer (the server checks it)', /\.\.\.\(l\.offer \? \{ offer: l\.offer \} : \{\}\)/.test(pg));
  const ib = fs.readFileSync('src/components/menu/ItemBuilder.tsx', 'utf8'); const lib = fs.readFileSync('src/lib/menu-upgrades.ts', 'utf8');
  check('in the app’s own words and look', !/uppercase|font-black|\{\/\*| · |call us|contact us|[\u{1F300}-\u{1FAFF}]/u.test(lib + pg.slice(pg.indexOf('function AfterSheet'), pg.indexOf('function PayForm')) + ib) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(pg + ib));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
