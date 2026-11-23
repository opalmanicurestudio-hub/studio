// Checks the breakfast switch on the TV menu boards (design board "The breakfast switch", A: switches on its own;
// api/counter 'menuBoard', app/drive-thru/[tenantId]/menu, lib/voice-order menuForVoice):
// - the board shows only what's served now by the menus by time of day, says which one is on and until when, and drops
//   a section with nothing served now; an item in no menu by time of day is served all day
// - during happy hour, the happy-hour price beside the usual one, and how long it lasts; outside it, neither
// - an item's menus and happy-hour price are never sent to the board as they are
// - the voice assistant reads only what's served now, says what isn't and when it's back, and the happy-hour price
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/board-dayparts.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

(async () => {
  const H = new Date().getUTCHours();
  const MT = await import('../../src/lib/menu-time');
  // Breakfast now (an hour either side), lunch after it; happy hour now.
  const times = { dayparts: [{ id: 'bk', name: 'Breakfast', from: hh(H - 1), to: hh(H + 1) }, { id: 'ln', name: 'Lunch', from: hh(H + 1), to: hh(H + 3) }], happyHour: { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: hh(H - 1), to: hh(H + 1) } };
  await db.doc(T).set({ name: 'Corner Cafe', timezone: 'UTC', menuSettings: times });
  await db.doc(`${T}/inventory/biscuit`).set({ type: 'refreshment', name: 'Egg biscuit', category: 'Breakfast', price: 5.25, happyPrice: 4, totalStock: 50, dayparts: ['bk'] });
  await db.doc(`${T}/inventory/melt`).set({ type: 'refreshment', name: 'Turkey melt', category: 'Lunch', price: 9.5, totalStock: 50, dayparts: ['ln'] });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Coffee', price: 5.5, happyPrice: 6, totalStock: 50 });
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Board', kind: 'drive-thru-board' }))).body.key;
  const MB = () => POST(req({ tenantId: 't1', key, action: 'menuBoard' })) as Promise<any>;

  console.log('the board');
  let r = await MB();
  const names = (r.body.sections || []).flatMap((s: any) => s.items.map((i: any) => i.name));
  check('only what’s served now: breakfast and what’s served all day, not lunch', r.body.ok && names.includes('Egg biscuit') && names.includes('Oat latte') && !names.includes('Turkey melt'), names);
  check('…a section with nothing served now isn’t shown', !(r.body.sections || []).some((s: any) => s.name === 'Lunch'), (r.body.sections || []).map((s: any) => s.name));
  check('…and it says which menu is on, and until when', r.body.dayparts?.length === 1 && r.body.dayparts[0].name === 'Breakfast' && r.body.dayparts[0].until === MT.timeWords(hh(H + 1)) && r.body.next === null, r.body.dayparts);
  const biscuit = r.body.sections.flatMap((s: any) => s.items).find((i: any) => i.name === 'Egg biscuit');
  const latte = r.body.sections.flatMap((s: any) => s.items).find((i: any) => i.name === 'Oat latte');
  check('happy hour: its price beside the usual one, and until when; a happy-hour price that isn’t lower isn’t one', biscuit?.happyPrice === 4 && biscuit.price === 5.25 && latte && latte.happyPrice === undefined && r.body.happyHour?.until === MT.timeWords(hh(H + 1)), { biscuit, latte, hh: r.body.happyHour });
  check('…an item’s menus by time of day are never sent as they are', !r.body.sections.some((s: any) => s.items.some((i: any) => 'dayparts' in i)));
  await db.doc(T).set({ menuSettings: { dayparts: [{ id: 'bk', name: 'Breakfast', from: hh(H - 3), to: hh(H - 1) }, { id: 'ln', name: 'Lunch', from: hh(H - 1), to: hh(H + 2) }], happyHour: { on: false, days: [], from: '16:00', to: '18:00' } } }, { merge: true });
  r = await MB();
  const n2 = (r.body.sections || []).flatMap((s: any) => s.items.map((i: any) => i.name));
  check('at the time, the next menu comes in by itself (the board asks again within seconds)', n2.includes('Turkey melt') && !n2.includes('Egg biscuit') && r.body.dayparts?.[0]?.name === 'Lunch', { n2, dp: r.body.dayparts });
  check('…no happy hour: no happy-hour prices, nothing said', r.body.happyHour === null && !r.body.sections.some((s: any) => s.items.some((i: any) => i.happyPrice !== undefined)));
  await db.doc(T).set({ menuSettings: { dayparts: [{ id: 'bk', name: 'Breakfast', from: hh(H - 1), to: hh(H + 1) }, { id: 'ln', name: 'Brunch', from: hh(H), to: hh(H + 2) }], happyHour: { on: false, days: [], from: '16:00', to: '18:00' } } }, { merge: true });
  r = await MB();
  check('two menus on at once (they overlap): both said, each with its own time', r.body.dayparts?.map((d: any) => d.name).join() === 'Breakfast,Brunch' && (r.body.sections || []).flatMap((s: any) => s.items).length === 3, r.body.dayparts);
  // (Another business whose menu is all by time of day, none of it on now.)
  await db.doc('tenants/t2').set({ name: 'Dawn Bakery', timezone: 'UTC', menuSettings: { dayparts: [{ id: 'lt', name: 'Late night', from: hh(H + 1), to: hh(H + 2) }, { id: 'bk', name: 'Breakfast', from: hh(H + 2), to: hh(H + 4) }, { id: 'ln', name: 'Lunch', from: hh(H + 5), to: hh(H + 7) }], happyHour: { on: false, days: [], from: '16:00', to: '18:00' } } });
  await db.doc('tenants/t2/inventory/roll').set({ type: 'refreshment', name: 'Cinnamon roll', category: 'Bakery', price: 4, totalStock: 20, dayparts: ['bk'] });
  const key2 = (await kitchen(req({ action: 'pair', tenantId: 't2', name: 'Board', kind: 'drive-thru-board' }))).body.key;
  r = await POST(req({ tenantId: 't2', key: key2, action: 'menuBoard' }));
  check('nothing served just now: an empty board says when the next menu with something on it is back (not an empty one that starts sooner)', (r.body.sections || []).length === 0 && r.body.next?.name === 'Breakfast' && r.body.next.from === MT.timeWords(hh(H + 2)) && r.body.next.tomorrow === (H + 2 >= 24), r.body.next);
  await db.doc(T).set({ menuSettings: { dayparts: [], happyHour: { on: false, days: [], from: '16:00', to: '18:00' } } }, { merge: true });
  r = await MB();
  check('a business with no menus by time of day: everything, as before', (r.body.sections || []).flatMap((s: any) => s.items).length === 3 && r.body.dayparts?.length === 0);

  console.log('the voice assistant');
  const V = await import('../../src/lib/voice-order');
  const tn = { timezone: 'UTC', menuSettings: times };
  const menu = [
    { id: 'biscuit', name: 'Egg biscuit', section: 'Breakfast', price: 5.25, happyPrice: 4, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true, dayparts: ['bk'] },
    { id: 'melt', name: 'Turkey melt', section: 'Lunch', price: 9.5, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true, dayparts: ['ln'] },
    { id: 'latte', name: 'Oat latte', section: 'Coffee', price: 5.5, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true, dayparts: [] },
    { id: 'soup', name: 'Soup', section: 'Lunch', price: 6, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true, dayparts: ['ln'] },
    { id: 'steak', name: 'Steak', section: 'Dinner', price: 30, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true, dayparts: ['dn'] },
  ] as any[];
  const tn2 = { ...tn, menuSettings: { ...times, dayparts: [...times.dayparts, { id: 'dn', name: 'Dinner', from: hh(H - 4), to: hh(H - 2) }] } };
  const said = V.menuForVoice(menu, { tenant: tn2 });
  check('it reads what’s served now, at the happy-hour price, and says happy hour is on', /Egg biscuit \$4\.00/.test(said) && /Oat latte \$5\.50/.test(said) && !/Lunch: /.test(said) && new RegExp(`Happy hour prices are on until ${MT.timeWords(hh(H + 1))}`).test(said), said);
  check('…and never offers what isn’t, together by when it’s back, today or tomorrow', new RegExp(`Turkey melt, Soup \\(Lunch, back at ${MT.timeWords(hh(H + 1))}\\)`).test(said) && new RegExp(`Steak \\(Dinner, back ${((H - 4 + 24) % 24) <= H ? 'tomorrow ' : ''}at ${MT.timeWords(hh(H - 4))}\\)`).test(said), said);
  check('…without the business (an old caller), as before', /Turkey melt \$9\.50/.test(V.menuForVoice(menu)));
  check('the assistant and the call read the menu on the business’s clock (the order’s location’s)', /menuForVoice\(menu, \{ tenant: await zonedHere\(db, tenantId, tenant, String\(order\.locationId \|\| ''\) \|\| null\) \}\)/.test(src('src/app/api/counter/assistant/route.ts'))
    && /menuForVoice\(menuItems\.filter\(\(m\) => !m\.byWeight\), \{ tenant \}\)/.test(src('src/app/api/counter/voice/route.ts')));

  console.log('the screen');
  const page = src('src/app/drive-thru/[tenantId]/menu/page.tsx');
  check('the board says every menu that’s on and happy hour, and shows the happy-hour price with the usual one crossed out (read as “usually”, its color its card’s)', /\{d\.name\} until \{d\.until\}/.test(page) && /Happy hour until \{board\.happyHour\.until\}/.test(page)
    && /<s className="ml-\[0\.4em\]" style=\{\{ fontSize: '0\.62em', fontWeight: 600, opacity: 0\.7 \}\}><span className="sr-only">usually <\/span>/.test(page));
  check('…and with nothing being served, when the next menu is back (only then: a board with nothing set up looks as before)', /\{board\.next\.name\} is back \{board\.next\.tomorrow \? 'tomorrow ' : ''\}at \{board\.next\.from\}/.test(page) && /\{!all\.length && board\.next && \(/.test(page));
  check('…no comments in markup, no uppercase', !/\{\/\*/.test(page) && !/\buppercase\b/.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
