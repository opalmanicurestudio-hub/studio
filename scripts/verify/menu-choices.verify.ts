// Checks menu choices and sold out (L20): lib/menu-choices, lib/menu-server, api/menu, the menu page, and every place a
// guest orders (the station tablet and the guest's own phone), the kitchen screen and the floor board.
// - An item's choices (size, milk, extras, "no onions") each have a price; "pick one" takes exactly one when required,
//   "pick any" up to its most. The server works out the price from the item, never from the browser, refuses a choice
//   that isn't on the item or is sold out, and keeps the lines on the order (a later menu change never rewrites it).
// - "Sold out" in one tap, for an item or one of its choices, from the menu page or the kitchen screen; a save from the
//   menu page never undoes it. Guests see a sold-out item or choice but can't pick it.
// - The kitchen reads the choices big, on the screen and on a printed ticket, and so does whoever runs it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/menu-choices.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, isTenantOwner: false, caps: [] };
let level = 'manager';
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: () => {} };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, need: string) => (need === 'manager' && level !== 'manager' ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: level === 'manager' ? actor : { ...actor, isManager: false, name: 'Kai Park' }, tenant: {} }),
    requireCan: async () => ({ actor, tenant: {} }), staffOrServer: async () => true,
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' }, nextUrl: new URL('https://app.test/api/menu') }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const latte = {
  type: 'refreshment', name: 'Latte', category: 'Coffee', price: 4.5, totalStock: 50, cost: 1.1, supplier: 'Beans Co',
  choices: [
    { id: 'size', name: 'Size', pick: 'one', required: true, options: [{ id: 's', name: 'Small', price: -0.5 }, { id: 'r', name: 'Regular', price: 0 }, { id: 'l', name: 'Large', price: 0.5 }] },
    { id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'w', name: 'Whole', price: 0 }, { id: 'o', name: 'Oat', price: 0.75 }, { id: 'a', name: 'Almond', price: 0.75, soldOut: true }] },
    { id: 'x', name: 'Extras', pick: 'any', max: 2, options: [{ id: 'sh', name: 'Extra shot', price: 1 }, { id: 'v', name: 'Vanilla', price: 0.75 }, { id: 'h', name: 'Extra hot', price: 0 }] },
  ],
};

(async () => {
  console.log('choices, priced from the item');
  const C = await import('../../src/lib/menu-choices');
  const g = C.choiceGroups(latte);
  check('groups read cleanly: pick one (required), pick any (up to 2), sold out kept', g.length === 3 && g[0].pick === 'one' && g[0].required && g[2].pick === 'any' && g[2].max === 2 && !g[2].required && g[1].options[2].soldOut, g);
  check('junk is left out (no id, no name, duplicates, no options)', C.choiceGroups({ choices: [{ id: 'a', name: '', options: [{ id: 'x', name: 'X' }] }, { id: 'b', name: 'B', options: [] }, { name: 'C', options: [{ id: 'y', name: 'Y' }] }, { id: 'd', name: 'D', options: [{ id: 'z', name: 'Z' }, { id: 'z', name: 'Z2' }, { name: 'no id' }] }] }).map((x) => `${x.id}:${x.options.length}`).join() === 'd:1');
  let r: any = C.priceChoices(latte, { size: ['l'], milk: ['o'], x: ['sh', 'h'] });
  check('Large, oat, extra shot, extra hot: +$2.25, in the menu’s order for the kitchen', r.ok && r.extra === 2.25 && r.text === 'Large, Oat, Extra shot, Extra hot' && r.lines.length === 4 && r.lines[0].group === 'Size', r);
  r = C.priceChoices(latte, { size: ['s'], milk: ['w'] });
  check('a small takes 50¢ off', r.ok && r.extra === -0.5 && r.text === 'Small, Whole', r);
  check('a required choice left empty is refused', !C.priceChoices(latte, { milk: ['w'] }).ok && /Choose a size/.test((C.priceChoices(latte, { milk: ['w'] }) as any).error));
  check('two of a pick-one, or three of a pick-up-to-two, is refused', !C.priceChoices(latte, { size: ['s', 'l'], milk: ['w'] }).ok && !C.priceChoices(latte, { size: ['s'], milk: ['w'], x: ['sh', 'v', 'h'] }).ok);
  check('a sold-out choice is refused, saying which', /Almond is sold out/.test((C.priceChoices(latte, { size: ['r'], milk: ['a'] }) as any).error || ''));
  check('a choice that isn’t on the item (or a made-up group) is refused', !C.priceChoices(latte, { size: ['xl'], milk: ['w'] }).ok && !C.priceChoices(latte, { size: ['r'], milk: ['w'], secret: ['x'] }).ok);
  check('an item with no choices prices as itself', (C.priceChoices({ price: 3 }, null) as any).ok && (C.priceChoices({ price: 3 }, {}) as any).extra === 0);
  check('what a guest sees first: “from” the cheapest a required choice allows', C.startingPrice(latte).price === 4 && C.startingPrice(latte).from === true && C.startingPrice({ price: 3 }).from === false);
  check('…and it starts on the first choice still available', JSON.stringify(C.defaultPicks(latte)) === JSON.stringify({ size: ['s'], milk: ['w'] }));
  check('saving makes ids for new groups and options', C.cleanForSave([{ name: 'Sauce', pick: 'any', options: [{ name: 'Hot', price: '0.5' }] }], () => 'n1')[0].id === 'n1' && C.cleanForSave([{ name: 'Sauce', options: [{ name: 'Hot', price: 0.5 }] }], () => 'n2')[0].options[0].price === 0.5);

  {
    const { soldOutUntil } = await import('../../src/lib/menu-server');
    const ny = { timeZone: 'America/New_York' };
    check('“sold out tonight” comes back at 4 in the morning, the business’s time', soldOutUntil(ny, new Date('2026-06-10T23:00:00Z')) === '2026-06-11T08:00:00.000Z' && soldOutUntil(ny, new Date('2026-06-11T06:00:00Z')) === '2026-06-11T08:00:00.000Z',
      [soldOutUntil(ny, new Date('2026-06-10T23:00:00Z')), soldOutUntil(ny, new Date('2026-06-11T06:00:00Z'))]);
    check('…on the night the clocks go back too (4:00 standard time, not 3:00)', soldOutUntil(ny, new Date('2026-11-01T02:00:00Z')) === '2026-11-01T09:00:00.000Z', soldOutUntil(ny, new Date('2026-11-01T02:00:00Z')));
  }

  console.log('the menu page’s server');
  await db.doc(T).set({ name: 'North Loft' });
  await db.doc(`${T}/inventory/latte`).set(latte);
  await db.doc(`${T}/inventory/muffin`).set({ type: 'refreshment', name: 'Muffin', category: 'Food', price: 2.5, totalStock: 0 });
  await db.doc(`${T}/inventory/shampoo`).set({ type: 'retail', name: 'Shampoo', price: 20 });
  await db.doc(`${T}/inventory/old`).set({ type: 'refreshment', name: 'Old', archived: true, price: 1 });
  const { POST } = await import('../../src/app/api/menu/route');
  r = await POST(req({ tenantId: 't1', action: 'list' }));
  check('the menu: refreshments only, by section, with “from” prices and nothing about cost or suppliers', r.body.ok && r.body.menu.map((m: any) => m.id).join() === 'latte,muffin' && r.body.menu[0].from && r.body.menu[1].inStock === false && !/cost|supplier|Beans Co|1\.1/.test(JSON.stringify(r.body.menu)), r.body);
  r = await POST(req({ tenantId: 't1', action: 'soldout', itemId: 'latte', groupId: 'milk', optionId: 'o', out: true }));
  check('oat milk sold out in one tap', r.body.ok && (await get(`${T}/inventory/latte`)).choices[1].options[1].soldOut === true, r.body);
  level = 'staff';
  r = await POST(req({ tenantId: 't1', action: 'soldout', itemId: 'muffin', out: true }));
  const m = await get(`${T}/inventory/muffin`);
  check('…anyone on the team can mark a whole item sold out, with who and when', r.body.ok && m.soldOut === true && m.soldOutBy === 'Kai Park' && !!m.soldOutAt, m);
  r = await POST(req({ tenantId: 't1', action: 'save', itemId: 'latte', item: { name: 'Latte', price: 9 } }));
  check('…but only a manager changes a price or choices', r.status === 403 && (await get(`${T}/inventory/latte`)).price === 4.5);
  level = 'manager';
  r = await POST(req({ tenantId: 't1', action: 'soldout', itemId: 'shampoo', out: true }));
  const r2: any = await POST(req({ tenantId: 't1', action: 'soldout', itemId: 'latte', groupId: 'milk', optionId: 'nope', out: true }));
  check('only menu items, and only choices that are on them', r.status === 404 && r2.status === 404);
  const edited = C.choiceGroups(latte).map((cg) => ({ ...cg, options: cg.options.map((o) => ({ ...o, soldOut: false })) }));
  edited.push({ id: '', name: 'Syrup', pick: 'any', required: false, max: 1, options: [{ id: '', name: 'Caramel', price: 0.75, soldOut: false }] } as any);
  r = await POST(req({ tenantId: 't1', action: 'save', itemId: 'latte', item: { name: 'Latte', section: 'Coffee', words: 'Espresso and steamed milk', price: 4.75, choices: edited, onMenu: true } }));
  const saved = await get(`${T}/inventory/latte`);
  check('a manager saves the price, words and choices (new ones get ids)', r.body.ok && saved.price === 4.75 && saved.description === 'Espresso and steamed milk' && saved.choices.length === 4 && /^[A-Za-z0-9_-]+$/.test(saved.choices[3].id) && saved.choices[3].options[0].price === 0.75, saved.choices);
  check('…and a save never undoes what the kitchen marked sold out (or brings back almond)', saved.choices[1].options[1].soldOut === true && saved.choices[1].options[2].soldOut === true, saved.choices[1]);
  check('…and keeps the cost and supplier as they were', saved.cost === 1.1 && saved.supplier === 'Beans Co');
  r = await POST(req({ tenantId: 't1', action: 'save', itemId: 'latte', item: { name: 'Latte', price: 4.75, choices: [{ name: 'Size', options: [{ name: '' }] }] } }));
  const r3: any = await POST(req({ tenantId: 't1', action: 'save', itemId: 'latte', item: { name: '', price: 4 } }));
  const r4: any = await POST(req({ tenantId: 't1', action: 'save', itemId: 'latte', item: { name: 'Latte', price: -1 } }));
  check('a choice with no options, no name, or a negative price is refused with a reason', r.status === 400 && /needs a name and at least one option/.test(r.body.error) && r3.status === 400 && r4.status === 400 && (await get(`${T}/inventory/latte`)).choices.length === 4);

  console.log('the kitchen screen');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  level = 'manager';
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Pass' }))).body.key;
  r = await kitchen(req({ action: 'menu', tenantId: 't1', key }));
  check('the kitchen screen reads the menu (on a tablet nobody is signed in on)', r.body.ok && r.body.menu.some((x: any) => x.id === 'latte'), r.body);
  r = await kitchen(req({ action: 'soldout', tenantId: 't1', key, itemId: 'latte', groupId: 'milk', optionId: 'w', out: true }));
  check('…and marks a choice sold out in one tap, under the screen’s name', r.body.ok && (await get(`${T}/inventory/latte`)).choices[1].options[0].soldOut === true, r.body);
  r = await kitchen(req({ action: 'soldout', tenantId: 't1', key, itemId: 'latte', out: true }));
  check('…or the whole item', r.body.ok && (await get(`${T}/inventory/latte`)).soldOut === true && (await get(`${T}/inventory/latte`)).soldOutBy === 'Pass');
  const K = await import('../../src/lib/kitchen');
  const tk = K.ticketFrom({ id: 'r9', itemName: 'Latte', choicesText: 'Large, Oat, Extra shot', quantity: 1, status: 'pending' }, 'refreshmentRequests');
  check('a ticket carries the guest’s choices', tk.choices === 'Large, Oat, Extra shot' && K.ticketFrom({ id: 'r8', itemName: 'Tea' }, 'refreshmentRequests').choices === null);
  const kds = src('src/app/kds/[tenantId]/page.tsx');
  check('…shown big on the kitchen screen, on a printed ticket and in course and dish groups', /\{t\.choices && <p className="mt-1 text-\[18px\] font-semibold/.test(kds) && /\.\.\.\(t\.choices \? \[\{ text: t\.choices, size: 'mid'/.test(kds) && /\{t\.choices && <p className="text-\[15px\] font-semibold"/.test(kds));
  check('…and to whoever runs it (floor board, ready to run)', /\{t\.choices && <p className="text-\[15px\] font-semibold">\{t\.choices\}<\/p>\}/.test(src('src/app/floor/[tenantId]/page.tsx')) && /\{t\.choices && <p/.test(src('src/components/kitchen/ReadyToRun.tsx')));
  check('the kitchen screen has “Sold out” for every item and each of its choices', kds.includes('function SoldOutSheet') && kds.includes("action: 'soldout'") && kds.includes("action: 'menu'") && kds.includes('>Sold out</button>'));
  check('…and its sound starts on an iPad (a real tap, not a pointer down)', /const evs = \['click', 'touchend', 'keydown'\]/.test(kds) && kds.includes('webkitAudioContext'));

  console.log('every place a guest orders');
  const lounge = src('src/app/api/guest-lounge/route.ts'); const visit = src('src/components/visit/VisitLounge.tsx');
  check('the guest’s own phone: sold out is off the list, choices shown, priced and kept by the server', /\.filter\(\(i: any\) => orderable\(i\)\)/.test(lounge) && /choices: choiceGroups\(i\)/.test(lounge) && /const picked = priceChoices\(item, body\?\.choices\)/.test(lounge)
    && /priceAtRequest: isRedemption \? 0 : Math\.max\(0, Math\.round\(\(num\(item\.price\) \+ picked\.extra\) \* 100\) \/ 100\)/.test(lounge) && /choices: picked\.lines, choicesText: picked\.text/.test(lounge));
  check('…the guest picks them on the same picker, and the price they see includes them', visit.includes('<ChoicePicker item={item}') && /choices: picks \}\)/.test(visit) && /priced\.extra/.test(visit));
  const kiosk = src('src/app/api/booths/kiosk/route.ts'); const station = src('src/app/concierge/[tenantId]/page.tsx');
  check('the station tablet: a charge to the station or a booking includes the choices (the same amount the order is checked against)', /const picked = priceChoices\(item, body\.choices\)/.test(kiosk) && /\(\(Number\(item\.price\) \|\| 0\) \+ picked\.extra\)/.test(kiosk) && /choices: picks, amountCents: Math\.round\(total \* 100\)/.test(station));
  const conc = src('src/app/api/concierge/requests/route.ts');
  check('a card charge kept for an order is only reused for the very same choices (two milks can cost the same)', /String\(c\.choiceKey \|\| ''\) === choiceKey/.test(conc) && /itemId, quantity, choiceKey, amountCents/.test(conc));
  check('an order asked for again is found before anything is re-checked (so a lost answer never turns into “sold out”)', conc.indexOf('refreshmentRequests/${KQ(tenantId, orderKey)}') > 0 && conc.indexOf('refreshmentRequests/${KQ(tenantId, orderKey)}') < conc.indexOf('itemSoldOut(item)'));
  check('…and the tablet shows “from” prices, the picker, and a total with the choices in it', station.includes('<ChoicePicker item={pick.item}') && /startingPrice\(i\)\.from \? 'from '/.test(station) && /total > 0 \? `Add, \$\{money\(total\)\}`/.test(station));

  console.log('the pages');
  const page = src('src/app/(app)/menu/page.tsx'); const editor = src('src/components/menu/ChoicesEditor.tsx'); const picker = src('src/components/menu/ChoicePicker.tsx');
  check('the menu page reads and saves through the server only', page.includes("fetch('/api/menu'") && !/firebase\/firestore/.test(page + editor + picker));
  check('the picker uses real radio buttons and checkboxes, and a sold-out choice can’t be picked', /type=\{g\.pick === 'one' \? 'radio' : 'checkbox'\}/.test(picker) && /disabled = \(o\.soldOut && !checked\)/.test(picker) && picker.includes('>Sold out</span>'));
  const strings = [page, editor, picker].join('\n').match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]+</g)?.join('\n') || '';
  const bad = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('writing rules: no all-caps, no emoji or check marks, no JSX comments, no business-type words, no tool names', !/\buppercase\b|font-black/.test(page + editor + picker) && !/[\u{1F300}-\u{1FAFF}✓✔✅]/u.test(page + editor + picker)
    && !/\{\/\*/.test(page + editor + picker) && !/\b(studio|salon|stylist|booth|chair)s?\b/i.test(strings) && !new RegExp(bad.join('|'), 'i').test(page + editor + picker), strings.match(/\b(studio|salon|stylist|booth|chair)s?\b/gi));
  check('buttons are 44px or more', !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(page + editor + picker));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
