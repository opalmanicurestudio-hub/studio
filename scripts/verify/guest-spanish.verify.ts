// Checks the guest screens and the voice assistant in Spanish (design board "The boards and the assistant in Spanish",
// A: each screen picks its language; lib/guest-lang, api/menu 'spanish', api/counter 'menuBoard' / 'board' / 'window',
// the TV menu board, the order board, the window screen, lib/voice-order, lib/drive-thru-voice-setup, the Menu page):
// - the words: Spanish where there is some, English otherwise; "a la 1 PM", "a las 7 AM"; points and punches
// - the Menu page's Spanish column: an item's name and description each saved by itself, empty takes it off; a section's
//   name and a menu by time of day's; only a manager; the count of items still without one
// - the TV board gets each item's, section's and menu's Spanish beside the English; an order line carries its item's
//   Spanish name to the order board and the window screen; the team's screens keep the English
// - the voice assistant: knows each item's Spanish name (and finds an item by it, accents or not), is told to answer in
//   Spanish and call its tools in English; set up to hear both, English alone when the voice service won't; turned off
//   and on from the Menu page only once the voice service takes it
// - every word the three screens say has its Spanish
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/guest-spanish.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let manager = true;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, role: string) => (role === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Managers only.' } } } : { actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

// The voice service, as this app talks to it: every call kept, and an answer per path.
const calls: { path: string; method: string; body: any }[] = [];
let answer: (path: string, body: any) => { status: number; data: any } = () => ({ status: 200, data: {} });
(globalThis as any).fetch = async (url: string, init: any) => {
  const path = String(url).replace('https://api.retellai.com', ''); const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ path, method: init?.method || 'GET', body }); const a = answer(path, body);
  return { status: a.status, text: async () => JSON.stringify(a.data) } as any;
};
process.env.RETELL_API_KEY = 'k'; process.env.VOICE_AGENT_SECRET = 's'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

(async () => {
  const L = await import('../../src/lib/guest-lang');

  console.log('the words');
  check('Spanish where there is some, English otherwise; what’s filled in, filled in', L.gt('es', 'Sold out') === 'Agotado' && L.gt('en', 'Sold out') === 'Sold out' && L.gt('es', 'Order {n}', { n: 'B2' }) === 'Pedido B2' && L.gt('es', 'Something new') === 'Something new');
  check('one o’clock takes “la”, every other hour “las”; English says “at” and “until”', L.atTime('es', '1 PM') === 'a la 1 PM' && L.atTime('es', '1:30 PM') === 'a la 1:30 PM' && L.atTime('es', '11 AM') === 'a las 11 AM' && L.untilTime('es', '1 PM') === 'hasta la 1 PM'
    && L.untilTime('es', '10 AM') === 'hasta las 10 AM' && L.atTime('en', '7 AM') === 'at 7 AM' && L.untilTime('en', '11 AM') === 'until 11 AM');
  check('points and punches, one and more', L.earnedWords('es', 1, 'points') === 'Ganó 1 punto' && L.earnedWords('es', 4, 'punches') === 'Ganó 4 sellos' && L.earnedWords('en', 1, 'punches') === 'You earned 1 punch' && L.earnedWords('en', 12, 'points') === 'You earned 12 points');
  check('the business’s Spanish when it set some, the English when it didn’t', L.inLang('es', 'Hash browns', 'Papas') === 'Papas' && L.inLang('es', 'Hash browns', null) === 'Hash browns' && L.inLang('en', 'Hash browns', 'Papas') === 'Hash browns');
  check('a screen’s language: only Español or English, kept per kind of screen', L.cleanGuestLang('es') === 'es' && L.cleanGuestLang('fr') === 'en' && L.guestLangKey('board', 't1') !== L.guestLangKey('window', 't1'));

  const H = new Date().getUTCHours();
  await db.doc(T).set({ name: 'Corner Cafe', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true },
    menuSettings: { dayparts: [{ id: 'bk', name: 'Breakfast', from: hh(H - 1), to: hh(H + 1) }], happyHour: { on: false, days: [], from: '16:00', to: '18:00' } } });
  await db.doc(`${T}/inventory/biscuit`).set({ type: 'refreshment', name: 'Egg biscuit', category: 'Breakfast', description: 'With cheese', price: 5.25, totalStock: 50, dayparts: ['bk'] });
  await db.doc(`${T}/inventory/browns`).set({ type: 'refreshment', name: 'Hash browns', category: 'Breakfast', price: 2.5, totalStock: 50 });
  await db.doc(`${T}/inventory/olla`).set({ type: 'refreshment', name: 'Spiced coffee', category: 'Coffee', price: 3.5, totalStock: 50 });
  await db.doc(`${T}/inventory/flour`).set({ type: 'ingredient', name: 'Flour', totalStock: 50 });
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  const MA = (x: any) => menuApi(req({ tenantId: 't1', ...x })) as Promise<any>;

  console.log('the Menu page’s Spanish column');
  let r = await MA({ action: 'list' });
  check('the list carries each item’s Spanish (none yet) and the sections’ and menus’ (none yet)', r.body.ok && r.body.menu.every((m: any) => m.nameEs === null && m.wordsEs === null) && JSON.stringify(r.body.spanish) === '{"sections":{},"dayparts":{}}', r.body.spanish);
  check('…so every item on the menu still needs one', L.spanishLeft(r.body.menu) === 3);
  r = await MA({ action: 'spanish', itemId: 'browns', name: '  Papas   hash brown ' });
  check('an item’s Spanish name, saved tidied', r.status === 200 && r.body.nameEs === 'Papas hash brown' && (await get(`${T}/inventory/browns`))?.nameEs === 'Papas hash brown', r.body);
  r = await MA({ action: 'spanish', itemId: 'biscuit', name: 'Biscuit con huevo' });
  r = await MA({ action: 'spanish', itemId: 'biscuit', words: 'Con queso' });
  const bis = await get(`${T}/inventory/biscuit`);
  check('…its description by itself, never touching the name (a name saved a moment before stays), and the reply carries only what was sent', r.status === 200 && bis?.nameEs === 'Biscuit con huevo' && bis?.descriptionEs === 'Con queso' && r.body.wordsEs === 'Con queso' && !('nameEs' in r.body), { bis, body: r.body });
  r = await MA({ action: 'spanish', itemId: 'olla', name: 'Café de olla' });
  r = await MA({ action: 'spanish', itemId: 'flour', name: 'Harina' });
  check('…only an item on the menu', r.status === 404 && !(await get(`${T}/inventory/flour`))?.nameEs);
  r = await MA({ action: 'spanish', section: 'Breakfast', name: 'Desayuno' });
  check('a section’s Spanish name', r.status === 200 && r.body.spanish.sections.Breakfast === 'Desayuno');
  r = await MA({ action: 'spanish', daypart: 'bk', name: 'Desayuno' });
  const r2 = await MA({ action: 'spanish', daypart: 'nope', name: 'Cena' });
  check('a menu by time of day’s, only one the business has', r.status === 200 && r.body.spanish.dayparts.bk === 'Desayuno' && r2.status === 400 && !('nope' in ((await get(T))?.menuSpanish?.dayparts || {})));
  await MA({ action: 'spanish', section: 'Coffee', name: 'Café' }); r = await MA({ action: 'spanish', section: 'Coffee', name: '' });
  check('…empty takes it off (the English shows)', r.status === 200 && !('Coffee' in r.body.spanish.sections) && r.body.spanish.sections.Breakfast === 'Desayuno', r.body.spanish);
  manager = false; r = await MA({ action: 'spanish', itemId: 'browns', name: 'Otra cosa' }); manager = true;
  check('…only a manager changes it', r.status === 403 && (await get(`${T}/inventory/browns`))?.nameEs === 'Papas hash brown');
  r = await MA({ action: 'list' });
  check('the count goes down as names go in', L.spanishLeft(r.body.menu) === 0 && r.body.menu.find((m: any) => m.id === 'biscuit')?.wordsEs === 'Con queso');

  console.log('the TV board');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Board', kind: 'drive-thru-board' }))).body.key;
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'menuBoard' }));
  const its = (r.body.sections || []).flatMap((s: any) => s.items);
  const b = its.find((i: any) => i.id === 'biscuit'); const brk = r.body.sections?.find((s: any) => s.name === 'Breakfast'); const cof = r.body.sections?.find((s: any) => s.name === 'Coffee');
  check('each item’s Spanish name and description beside the English', b?.name === 'Egg biscuit' && b.nameEs === 'Biscuit con huevo' && b.words === 'With cheese' && b.wordsEs === 'Con queso' && its.find((i: any) => i.id === 'olla')?.nameEs === 'Café de olla', b);
  check('…each section’s (none when it has none), and the menu that’s on', brk?.nameEs === 'Desayuno' && cof && !('nameEs' in cof) && r.body.dayparts?.[0]?.name === 'Breakfast' && r.body.dayparts[0].nameEs === 'Desayuno', { brk: brk?.nameEs, dp: r.body.dayparts });
  await db.doc('tenants/t2').set({ name: 'Dawn Bakery', timezone: 'UTC', menuSettings: { dayparts: [{ id: 'bk', name: 'Breakfast', from: hh(H + 2), to: hh(H + 4) }], happyHour: { on: false, days: [], from: '16:00', to: '18:00' } }, menuSpanish: { dayparts: { bk: 'Desayuno' } } });
  await db.doc('tenants/t2/inventory/roll').set({ type: 'refreshment', name: 'Cinnamon roll', category: 'Bakery', price: 4, totalStock: 20, dayparts: ['bk'] });
  const key2 = (await kitchen(req({ action: 'pair', tenantId: 't2', name: 'Board', kind: 'drive-thru-board' }))).body.key;
  r = await POST(req({ tenantId: 't2', key: key2, action: 'menuBoard' }));
  check('…and with nothing served now, the next menu’s Spanish name (its id never sent)', r.body.next?.name === 'Breakfast' && r.body.next.nameEs === 'Desayuno' && !('id' in r.body.next), r.body.next);

  console.log('the order board and the window');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const P = (x: any) => POST(req({ tenantId: 't1', key, ...x })) as Promise<any>;
  const A = (await P({ action: 'car', carKey: 'escar-0001' })).body;
  await P({ action: 'add', orderId: A.orderId, itemId: 'browns', tapKey: 'estap-0001' });
  await P({ action: 'add', orderId: A.orderId, itemId: 'olla', tapKey: 'estap-0002' });
  const o = await get(`${T}/counterOrders/${A.orderId}`);
  check('an order line carries its item’s Spanish name; its name stays the English for the team, the kitchen and the receipt', o?.lines?.[0]?.name === 'Hash browns' && o.lines[0].nameEs === 'Papas hash brown' && o.lines[1].nameEs === 'Café de olla', o?.lines);
  await db.doc(`${T}/inventory/plain`).set({ type: 'refreshment', name: 'Water', category: 'Drinks', price: 1, totalStock: 50 });
  await P({ action: 'add', orderId: A.orderId, itemId: 'plain', tapKey: 'estap-0003' });
  check('…a line from an item with none carries none', !('nameEs' in ((await get(`${T}/counterOrders/${A.orderId}`))?.lines?.[2] || { nameEs: 1 })));
  r = await POST(req({ tenantId: 't1', key: bkey, action: 'board' }));
  check('the order board gets each line’s Spanish name beside its name', r.body.order?.lines?.[0]?.name === 'Hash browns' && r.body.order.lines[0].nameEs === 'Papas hash brown' && !('nameEs' in r.body.order.lines[2]), r.body.order?.lines);
  const teamScreens = ['src/app/drive-thru/[tenantId]/page.tsx', 'src/app/(app)/counter/page.tsx', 'src/app/kds/[tenantId]/page.tsx', 'src/lib/printing.ts', 'src/lib/food-bags.ts'];
  check('…the team’s screens, the kitchen, the receipts and the bag labels never read it: they show the English', teamScreens.every((f) => !src(f).includes('nameEs')));
  check('the window screen’s lines carry it the same way', /show:[\s\S]{0,400}lines: shown\.mode === 'pay' \|\| shown\.mode === 'paid' \? \(o\.lines \|\| \[\]\)\.map\(\(l: any\) => \(\{ name: l\.name, \.\.\.\(l\.nameEs \? \{ nameEs/.test(src('src/app/api/counter/route.ts')));

  console.log('the voice assistant');
  const V = await import('../../src/lib/voice-order');
  const { readMenu } = await import('../../src/lib/menu-server');
  const menu = await readMenu(db, 't1');
  const said = V.menuForVoice(menu);
  check('it reads each item’s Spanish name beside the English', said.includes('Hash browns (in Spanish: Papas hash brown)') && said.includes('Spiced coffee (in Spanish: Café de olla)'), said);
  const m1: any = V.matchItem(menu, 'papas hash brown'); const m2: any = V.matchItem(menu, 'un cafe de olla'); const m3: any = V.matchItem(menu, 'hash browns');
  check('an item is found by its Spanish name, with or without the accents; the English still finds it', m1.item?.id === 'browns' && m2.item?.id === 'olla' && m3.item?.id === 'browns', { m1, m2, m3 });
  check('…and accents are folded in English names too ("creme brulee" is the Crème brûlée)', V.matchItem([{ id: 'cb', name: 'Crème brûlée', section: 'S', price: 6, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true }], 'creme brulee') as any !== null
    && (V.matchItem([{ id: 'cb', name: 'Crème brûlée', section: 'S', price: 6, choices: [], soldOut: false, onMenu: true, membersOnly: false, inStock: true }], 'creme brulee') as any).item?.id === 'cb');
  const S = await import('../../src/lib/drive-thru-voice-setup');
  check('its instructions: answer a guest who speaks Spanish in Spanish (usted), call the tools in English, every price as the tool says it; off, English', S.VOICE_VERSION === 5 && /\{\{spanish\}\}/.test(S.DRIVE_THRU_PROMPT) && /answer in Spanish/.test(S.DRIVE_THRU_PROMPT) && /call every tool in English/.test(S.DRIVE_THRU_PROMPT) && /usted/.test(S.DRIVE_THRU_PROMPT) && /price and number exactly as given/.test(S.DRIVE_THRU_PROMPT) && /If this says no, answer in English/.test(S.DRIVE_THRU_PROMPT));
  check('…and a food allergy goes to its tool by the allergen’s English name, the rest in their words', /A food allergy goes to set_allergy in English too/.test(S.DRIVE_THRU_PROMPT) && /"shellfish"/.test(S.DRIVE_THRU_PROMPT));
  const AL = await import('../../src/lib/allergens'); const OA = await import('../../src/lib/order-allergy');
  const k = (w: string) => AL.keysFromWords(w).join();
  check('an allergy said in Spanish still sets the allergen, accents or not (“maní” only with its accent: “mani” is a manicure)', k('cacahuates') === 'peanuts' && k('camarón') === 'shellfish' && k('camaron') === 'shellfish' && k('mariscos') === 'fish,shellfish' && k('nueces') === 'treenuts,peanuts'
    && k('ajonjolí') === 'sesame' && k('leche y huevo') === 'milk,eggs' && k('celíaca') === 'wheat,gluten' && k('maní') === 'peanuts' && k('mani\u0301') === 'peanuts' && k('mani pedi') === '' && k('soja') === 'soy' && k('soya') === 'soy'
    && k('alergia al piñón') === 'treenuts' && k('nuez moscada') === '', ['cacahuates', 'mariscos', 'nueces', 'mani pedi', 'nuez moscada'].map(k));
  const heard: any = OA.allergyFromWords(['cacahuates', 'kiwi'], true);
  check('…and the guest’s own words are kept beside it for the kitchen', heard && heard.keys.join() === 'peanuts' && /cacahuates/.test(String(heard.other)) && /kiwi/.test(String(heard.other)) && heard.severe === true, heard);
  check('the voice service hears English and Latin American Spanish, or English alone', JSON.stringify(S.voiceLanguages(true)) === '["en-US","es-419"]' && S.voiceLanguages(false) === 'en-US');

  console.log('set up, updated, turned on and off');
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  // Too many requests: said as it is, never taken for a voice that can't speak Spanish.
  answer = (path) => path === '/create-retell-llm' ? { status: 201, data: { llm_id: 'llm_0' } } : path === '/create-agent' ? { status: 429, data: { message: 'rate limited' } } : { status: 200, data: {} };
  calls.length = 0; r = await MA({ action: 'voiceSetup' });
  check('set up: a refusal for any other reason (too many requests) isn’t tried again in English, and nothing is kept', r.status === 502 && calls.filter((c) => c.path === '/create-agent').length === 1 && !(await get(T))?.driveThru?.voiceAgentId, r.body);
  await db.doc(T).set({ driveThru: { voiceSettingUpAt: null } }, { merge: true });
  // Turned down as it stands, and in English alone too: the first error is said, nothing kept.
  answer = (path) => path === '/create-retell-llm' ? { status: 201, data: { llm_id: 'llm_0' } } : path === '/create-agent' ? { status: 400, data: { message: 'bad webhook' } } : { status: 200, data: {} };
  calls.length = 0; r = await MA({ action: 'voiceSetup' });
  check('…turned down as it stands: tried once in English alone, and when that’s turned down too, nothing is kept', r.status === 502 && calls.filter((c) => c.path === '/create-agent').length === 2 && !(await get(T))?.driveThru?.voiceAgentId, r.body);
  await db.doc(T).set({ driveThru: { voiceSettingUpAt: null } }, { merge: true });
  // A voice that speaks English only: the voice service refuses both languages, and says why.
  answer = (path, body) => path === '/create-retell-llm' ? { status: 201, data: { llm_id: 'llm_1' } } : path === '/create-agent' ? (Array.isArray(body?.language) ? { status: 400, data: { message: 'voice does not support es-419' } } : { status: 201, data: { agent_id: 'agent_1' } }) : { status: 200, data: {} };
  calls.length = 0; r = await MA({ action: 'voiceSetup' });
  const made = calls.filter((c) => c.path === '/create-agent');
  check('set up: both languages asked for first; a voice that won’t takes English alone: the business’s choice stays on, what the service hears is kept apart', r.status === 200 && made.length === 2 && JSON.stringify(made[0].body.language) === '["en-US","es-419"]' && made[1].body.language === 'en-US' && r.body.spanish === true && r.body.spanishHeard === false
    && (await get(T))?.driveThru?.spanishHeard === false && (await get(T))?.driveThru?.spanish === undefined, { made: made.map((c) => c.body.language), r: r.body });
  check('…so each call is told no Spanish while the service can’t hear it', /spanish: tenant\.driveThru\?\.spanish === false \|\| tenant\.driveThru\?\.spanishHeard === false \? 'no' : 'yes'/.test(src('src/app/api/counter/voice/route.ts')));
  r = await MA({ action: 'list' });
  check('…and the Menu page says so beside the switch', r.body.voice?.spanish === true && r.body.voice?.spanishHeard === false && /voice\.spanish !== false && voice\.spanishHeard === false/.test(src('src/app/(app)/menu/page.tsx')), r.body.voice);
  answer = () => ({ status: 200, data: {} });
  calls.length = 0; r = await MA({ action: 'voice', spanish: true });
  check('turned on from the Menu page: the voice service is told first, then it’s kept', r.status === 200 && r.body.spanish === true && r.body.spanishHeard === true && calls[0]?.path === '/update-agent/agent_1' && calls[0].method === 'PATCH' && JSON.stringify(calls[0].body.language) === '["en-US","es-419"]' && (await get(T))?.driveThru?.spanish === true && (await get(T))?.driveThru?.spanishHeard === true, calls);
  answer = (path) => path.startsWith('/update-agent') ? { status: 422, data: {} } : { status: 200, data: {} };
  r = await MA({ action: 'voice', spanish: false });
  check('…refused by the voice service, nothing changes and it says so', r.status === 502 && /didn’t take the change/.test(r.body.error) && (await get(T))?.driveThru?.spanish === true && (await get(T))?.driveThru?.spanishHeard === true, r.body);
  answer = () => ({ status: 200, data: {} });
  r = await MA({ action: 'list' });
  check('the Menu page sees Spanish on, and that it can change it here', r.body.voice?.spanish === true && r.body.voice?.spanishHere === true, r.body.voice);
  // An older assistant: updated, then set to hear both.
  await db.doc(T).set({ driveThru: { voiceVersion: 4, spanish: FV.delete() } }, { merge: true });
  r = await MA({ action: 'list' });
  check('an assistant made before Spanish: offered the update, and no Spanish switch until then', r.body.voice?.outdated === true && r.body.voice?.spanishHere === false, r.body.voice);
  r = await MA({ action: 'voice', spanish: true });
  check('…the switch itself asks for the update first', r.status === 409 && /Update the assistant first/.test(r.body.error));
  calls.length = 0; r = await MA({ action: 'voiceUpdate' });
  check('updated: the new instructions, then both languages; Spanish on', r.status === 200 && r.body.spanish === true && r.body.spanishHeard === true && calls.some((c) => c.path === '/update-retell-llm/llm_1' && /\{\{spanish\}\}/.test(c.body.general_prompt) && c.body.default_dynamic_variables?.spanish === 'yes')
    && calls.some((c) => c.path === '/update-agent/agent_1' && Array.isArray(c.body.language)) && (await get(T))?.driveThru?.voiceVersion === 5 && (await get(T))?.driveThru?.spanishHeard === true, calls.map((c) => c.path));
  await db.doc(T).set({ driveThru: { voiceVersion: 4 } }, { merge: true });
  answer = (path) => path.startsWith('/update-agent') ? { status: 422, data: { message: 'language es-419 not supported by this voice' } } : { status: 200, data: {} };
  r = await MA({ action: 'voiceUpdate' });
  check('…a voice that won’t take Spanish: the rest of the update is in, it hears English alone and says why, and the business’s choice stays on', r.status === 200 && r.body.spanish === true && r.body.spanishHeard === false && /stays in English/.test(String(r.body.note)) && (await get(T))?.driveThru?.voiceVersion === 5 && (await get(T))?.driveThru?.spanishHeard === false && (await get(T))?.driveThru?.spanish !== false, r.body);
  answer = () => ({ status: 200, data: {} });

  console.log('the screens');
  const pages = ['src/app/drive-thru/[tenantId]/menu/page.tsx', 'src/app/drive-thru/[tenantId]/board/page.tsx', 'src/app/drive-thru/[tenantId]/window/page.tsx'];
  const words: string[] = [];
  for (const p of pages) {
    const s = src(p);
    for (const m of s.matchAll(/\bt\(((?:[^()]|\([^()]*\))*)\)/g)) for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) if (/^[A-Z{]/.test(q[1])) words.push(q[1]);
  }
  words.push('You earned 1 point', 'You earned {n} points', 'You earned 1 punch', 'You earned {n} punches');
  check('every word the TV board, the order board and the window screen say has its Spanish', words.length > 70 && words.every((w) => L.hasGuestSpanish(w)), words.filter((w) => !L.hasGuestSpanish(w)));
  for (const p of pages) {
    const s = src(p);
    check(`${p.split('/').slice(-2).join('/')}: picked on the screen, kept on it, or from ?lang= in its address; the page says which language it’s in`, /guestLangKey\('(menuboard|board|window)', tenantId\)/.test(s) && /get\('lang'\)/.test(s) && /GUEST_LANGS\.map/.test(s) && /<main lang=\{lang\}/.test(s));
  }
  const board = src(pages[0]);
  check('the TV board shows the business’s Spanish for items, sections and menus, and goes by the English name for a screen set to one section', /inLang\(lang, i\.name, i\.nameEs\)/.test(board) && /label: inLang\(lang, x\.name, x\.nameEs\)/.test(board) && /x\.name === show/.test(board) && /\{s\.label\}<\/h2>/.test(board));
  check('…and fits itself again when the language changes (Spanish runs longer)', /fitKey = `[^`]*#\$\{lang\}`/.test(board));
  const win = src(pages[2]);
  check('the window screen: what the card reader said only in English; in Spanish, that the card didn’t go through', /lang === 'en' && s\.cardMessage \? s\.cardMessage : t\('The card didn’t go through\.'\)/.test(win));

  console.log('the Menu page');
  const page = src('src/app/(app)/menu/page.tsx'); const col = src('src/components/menu/SpanishMenu.tsx');
  check('the count and the Spanish column, for a manager; the search finds Spanish names too', /canEdit && spanish && menu && menu\.length > 0 && <SpanishBar/.test(page) && /canEdit && spanish && spanishOn \? <SpanishMenu/.test(page) && /m\.nameEs \|\| ''/.test(page));
  check('…each field saves when it’s left, only when it changed, says Saved out loud too, and is marked as Spanish; ids never carry a section’s spaces', /onBlur=\{\(\) => \{ if \(v\.trim\(\) !== value\.trim\(\)\) onSave/.test(col) && /'Saved'/.test(col) && /lang="es"/.test(col) && /aria-label=\{label\}/.test(col)
    && /role="status"/.test(col) && /id=\{`es-s-\$\{si\}`\}/.test(col) && !/es-s-\$\{section\}/.test(col));
  check('…a save applies only the field it saved', /onItem\(m\.id, \{ nameEs: r\.nameEs \?\? null \}\)/.test(col) && /onItem\(m\.id, \{ wordsEs: r\.wordsEs \?\? null \}\)/.test(col));
  check('…the description by itself (never sending the name with it)', /\{ itemId: m\.id, words: v \}/.test(col));
  check('the voice assistant’s Spanish switch, shown only when it can change here, and the update says it answers in Spanish', /voice\?\.setUp && voice\.spanishHere &&/.test(page) && /Answers in Spanish/.test(page) && /it answers in Spanish when a guest speaks Spanish/.test(page));
  for (const f of [...pages, 'src/components/menu/SpanishMenu.tsx', 'src/lib/guest-lang.ts']) {
    const s = src(f);
    check(`${f.split('/').slice(-2).join('/')}: no comments in markup, no uppercase, no new " · "`, !/\{\/\*/.test(s) && !/\buppercase\b/.test(s) && (f.includes('board/page') || f.includes('window/page') ? (s.match(/ · /g) || []).length <= 1 : !/ · /.test(s)));
  }

  console.log('the kiosk');
  const kioskPage = src('src/app/drive-thru/[tenantId]/kiosk/page.tsx'), picker = src('src/components/menu/ChoicePicker.tsx'), oa = src('src/components/menu/OrderAllergy.tsx');
  // Every line put through the dictionary (t('…') on the kiosk, gt(lang, '…') in the pieces it uses) has its Spanish.
  const kioskSaid = [...Array.from(kioskPage.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)).map((m) => m[1]), ...Array.from((picker + oa).matchAll(/gt\(lang, '((?:[^'\\]|\\.)+)'/g)).map((m) => m[1]),
    ...Array.from(kioskPage.matchAll(/sayIn\(lang, [^,]+, '((?:[^'\\]|\\.)+)'\)/g)).map((m) => m[1]), ...Array.from(kioskPage.matchAll(/sayIn\(lang, [^,]+, [^?]+\? '((?:[^'\\]|\\.)+)' : '((?:[^'\\]|\\.)+)'\)/g)).flatMap((m) => [m[1], m[2]])];
  const kioskMissing = Array.from(new Set(kioskSaid)).filter((w) => !L.hasGuestSpanish(w));
  check(`every line the kiosk shows a guest has its Spanish (${new Set(kioskSaid).size} of them)`, kioskSaid.length > 80 && !kioskMissing.length, kioskMissing);
  check('…and none of its English left showing to a guest in Spanish (its words go through the dictionary)', !/>(Start your order|Your order|Review and pay|Tap something to add it\.|Add more|Get a receipt|Text me when it’s ready)</.test(kioskPage));
  check('each guest picks on the start screen; the next guest gets the kiosk’s own (?lang=es, kept on the tablet)', /role="group" aria-label=\{t\('Language'\)\}/.test(kioskPage) && /GUEST_LANGS\.map/.test(kioskPage) && /setStep\('start'\); setLang\(home\);/.test(kioskPage)
    && /write\(guestLangKey\('kiosk', tenantId\), cleanGuestLang\(asked\)\)/.test(kioskPage) && /document\.documentElement\.lang = lang/.test(kioskPage));
  check('the business’s Spanish: items, descriptions, sections and what was placed', /nameEs: m\.nameEs, wordsEs: m\.wordsEs/.test(src('src/lib/kiosk.ts')) && /nameEs: es\[m\.section\] \|\| null/.test(src('src/lib/kiosk.ts')) && /nameEs: l\.nameEs \|\| null/.test(src('src/lib/kiosk.ts'))
    && /const nm = \(m: \{ name: string; nameEs\?: string \| null \}\) => inLang\(lang, m\.name, m\.nameEs\)/.test(kioskPage));
  check('choices, allergies and notes in Spanish on the kiosk, and as before everywhere else', /<ChoicePicker item=\{item\} picks=\{picks\} onChange=\{[^}]+\}\} lang=\{lang\} \/>/.test(kioskPage) && /lang=\{lang\} \/>/.test(kioskPage) && /lang = 'en' \}: \{ item: any/.test(picker) && /big = false, lang = 'en' \}/.test(oa));
  check('allergens in Spanish for a guest', OA.containsLine({ allergens: ['milk', 'wheat'], allergensSet: true }, 'es') === 'Contiene leche y trigo' && OA.containsLine({ allergens: ['milk', 'wheat'], allergensSet: true }) === 'Contains milk and wheat'
    && OA.containsLine({ allergens: [], allergensSet: true }, 'es') === 'No se indica ningún alérgeno principal' && OA.containsLine({ allergens: [], allergensSet: true }) === 'None of the major allergens listed' && OA.conflictWords(['peanuts', 'sesame', 'eggs'], { keys: ['peanuts'] }, 'guest', 'es') === 'Contiene cacahuate (maní), ajonjolí y huevo' && OA.conflictWords(['peanuts', 'eggs'], { keys: ['peanuts'] }, 'guest') === 'Contains peanuts and eggs'
    && OA.conflictWords('unknown', { keys: ['peanuts'] }, 'guest', 'es') === 'No se indican sus alérgenos. La cocina ve su alergia en el pedido.' && L.allergenIn('es', 'treenuts', 'Tree nuts') === 'Nueces de árbol' && L.allergenIn('en', 'treenuts', 'Tree nuts') === 'Tree nuts');
  check('what the server says: its Spanish when known, else the Spanish of what to do; in English as it said', L.sayIn('es', 'Add something first.', 'That didn’t go through. Try again.') === 'Primero agregue algo.' && L.sayIn('es', 'Iced tea is sold out right now.', 'That didn’t go through. Try again.') === 'No se pudo completar. Inténtelo de nuevo.'
    && L.sayIn('en', 'Iced tea is sold out right now.', 'x') === 'Iced tea is sold out right now.' && L.sayIn('en', '', 'Fallback.') === 'Fallback.');
  check('what the team sees on the kiosk stays in English (Team, the card reader)', /aria-label="This kiosk’s card reader"|<Modal label="This kiosk’s card reader"/.test(kioskPage) && />Team<\/button>/.test(kioskPage));
  check('the kiosk’s number pad says Delete (Back is for going back), and an order placed in Spanish keeps it for its text', /k === 'back' \? t\('Delete'\)/.test(kioskPage) && L.gt('es', 'Delete') === 'Borrar' && L.gt('es', 'Back') === 'Volver'
    && /\.\.\.\(lang === 'es' \? \{ lang \} : \{\}\)/.test(kioskPage) && /\.\.\.\(cleanGuestLang\(b\?\.lang\) === 'es' \? \{ guestLang: 'es' \} : \{\}\)/.test(src('src/lib/kiosk.ts')) && /lang: b\.lang \}/.test(src('src/app/api/kiosk/route.ts')));

  console.log('the order-ahead page');
  const aheadPage = src('src/app/order/[tenantId]/page.tsx');
  const aheadObj = (name: string) => { const m = new RegExp(`const ${name}[^=]*= \\{([^}]+)\\}`).exec(aheadPage); return m ? Array.from(m[1].matchAll(/:\s*'((?:[^'\\]|\\.)+)'/g)).map((x) => x[1]) : []; };
  // Every line put through the dictionary (tr('…'), gt(lang, '…'), what the server said and what to say instead), and
  // the ways to get it and the server's codes, has its Spanish.
  const aheadSaid = [...Array.from(aheadPage.matchAll(/\btr\('((?:[^'\\]|\\.)+)'/g)).map((m) => m[1]), ...Array.from(aheadPage.matchAll(/gt\((?:lang|'es'), '((?:[^'\\]|\\.)+)'/g)).map((m) => m[1]),
    ...Array.from(aheadPage.matchAll(/(?:sayIn\(lang, [^,]+|said\(lang, d), '((?:[^'\\]|\\.)+)'\)/g)).map((m) => m[1]), ...Array.from(aheadPage.matchAll(/sayIn\(lang, [^,]+, [^?]+\? '((?:[^'\\]|\\.)+)' : '((?:[^'\\]|\\.)+)'\)/g)).flatMap((m) => [m[1], m[2]]),
    ...Array.from(aheadPage.matchAll(/\btr\([a-z.!=' ]+\? '((?:[^'\\]|\\.)+)' : '((?:[^'\\]|\\.)+)'/g)).flatMap((m) => [m[1], m[2]]), ...aheadObj('WAY_WORDS'), ...aheadObj('WAY_BUTTON'), ...aheadObj('BY_CODE'),
    ...Array.from(aheadPage.matchAll(/setHeld\('((?:[^'\\]|\\.)+)'\)/g)).map((m) => m[1])];
  const aheadMissing = Array.from(new Set(aheadSaid)).filter((w) => !L.hasGuestSpanish(w));
  check(`every line the order-ahead page shows a guest has its Spanish (${new Set(aheadSaid).size} of them)`, new Set(aheadSaid).size > 300 && !aheadMissing.length, aheadMissing);
  check('…and none of its English left showing to a guest in Spanish (only the tip and people examples, which are numbers)', !/>[A-Z][a-z’' ,.!?]{3,}</.test(aheadPage)
    && Array.from(aheadPage.matchAll(/(?:aria-label|placeholder|alt|title)="([^"]+)"/g)).every((m) => /^[\d.]+$/.test(m[1])));
  check('English or Español at the top of every step: ?lang=es first, then what was picked on this phone, then the phone’s own language', /<Lang\.Provider value=\{lang\}>/.test(aheadPage) && /<LangSwitch lang=\{lang\} onPick=\{setLang\} \/>/.test(aheadPage)
    && /GUEST_LANGS\.map\(\(x\) => <button key=\{x\.id\} type="button" lang=\{x\.id\} aria-pressed=\{lang === x\.id\}/.test(aheadPage) && /min-h-\[44px\]/.test(aheadPage.slice(aheadPage.indexOf('function LangSwitch'), aheadPage.indexOf('const earnedLine')))
    && /setLangNow\(q === 'es' \|\| q === 'en' \? q : kept === 'es' \|\| kept === 'en' \? kept : \/\^es\\b\/i\.test\(own\) \? 'es' : 'en'\)/.test(aheadPage) && /write\(guestLangKey\('ahead', tenantId\), l\)/.test(aheadPage) && /document\.documentElement\.lang = lang/.test(aheadPage));
  check('the business’s Spanish: items, descriptions and sections on the menu; lines on the order and its page; Order again', /nameEs: m\.nameEs, wordsEs: m\.wordsEs/.test(src('src/lib/counter-ahead.ts')) && /nameEs: es\[m\.section\] \|\| null/.test(src('src/lib/counter-ahead.ts')) && /nameEs: l\.nameEs \|\| null/.test(src('src/lib/counter-ahead.ts'))
    && /const name = inLang\(lang, item\.name, item\.nameEs\); const words = inLang\(lang, item\.words \|\| '', item\.wordsEs\)/.test(aheadPage) && /inLang\(lang, s\.name, s\.nameEs\)/.test(aheadPage) && /inLang\(lang, l\.name, l\.nameEs\)/.test(aheadPage) && /pastWords\(p, \(l\) => nmOf\(l\.itemId, l\.name\)\)/.test(aheadPage));
  check('choices, allergies, notes and what a dish contains in Spanish; the allergy told to the kitchen too', /<ChoicePicker item=\{item\} picks=\{picks\} onChange=\{setPicks\} lang=\{lang\} \/>/.test(aheadPage) && /<NoteField [^>]*lang=\{lang\} \/>/.test(aheadPage) && /<AllergyChips [^>]*lang=\{lang\} \/>/.test(aheadPage)
    && /containsLine\(item, lang\)/.test(aheadPage) && /allergy, 'guest', lang\)/.test(aheadPage) && /lang === 'es' && t\.allergyOf \? allergyIn\(lang, t\.allergyOf\) : t\.allergy/.test(aheadPage));
  check('the card form in Spanish too (no switch while paying: the form takes its language when it opens); the menu questions box (English only) left out in Spanish', /clientSecret: pay\.clientSecret, locale: lang,/.test(aheadPage) && /\{!paying && <div className="mb-3 flex justify-end"><LangSwitch/.test(aheadPage)
    && /<\/div>, undefined, true\);/.test(aheadPage) && /menu\.klair && lang === 'en' && <section/.test(aheadPage));
  check('nothing shown until the language is read (no English flash); a message said in one language is taken down on a switch', /if \(!langRead\) return <main/.test(aheadPage) && (aheadPage.match(/useClearOnSwitch\(lang, /g) || []).length >= 6
    && /useClearOnSwitch\(lang, \(\) => setPlaceErr\(''\), \(\) => setCheckErr\(''\), \(\) => setAgainSaid\(null\)\)/.test(aheadPage) && /held \? tr\(held\) :/.test(aheadPage));
  check('the drive-thru keeps its name in Spanish for guests (“autoservicio” reads as self-service)', L.gt('es', 'Drive-thru') === 'Drive-thru' && L.gt('es', 'at the drive-thru') === 'en el drive-thru' && !/autoservicio/i.test(src('src/lib/guest-lang.ts').replace(/\/\/[^\n]*/g, '')));
  check('what the server says: its Spanish, or for words made up around an item’s name, what its code means', /const said = \(lang: GuestLang, d: any, fallback: string\) => \(lang === 'es' && d\?\.code && BY_CODE\[d\.code\] && !hasGuestSpanish/.test(aheadPage)
    && /setPlaceErr\(said\(lang, d, 'That didn’t go through\. Try again\.'\)\)/.test(aheadPage) && /\.\.\.\(lang === 'es' \? \{ lang \} : \{\}\), name: name\.trim\(\)/.test(aheadPage));
  const AD = await import('../../src/lib/ahead-days');
  check('days and times in Spanish: “viernes 8 de mayo”, “vie 8”, “la 1:00 PM”, and a phone’s own “1:00 p. m.”; English as before', AD.dayWords('2026-05-08', false, 'es') === 'viernes 8 de mayo' && AD.dayWords('2026-05-08', true, 'es') === 'vie 8'
    && AD.dayWords('2026-05-08') === 'Friday, May 8' && AD.dayWords('2026-05-08', true) === 'Fri 8' && L.theHour('es', '1:00 PM') === 'la 1:00 PM' && L.theHour('es', '7:00 PM') === 'las 7:00 PM' && L.theHour('en', '7:00 PM') === '7:00 PM'
    && L.atTime('es', '1:00 p. m.') === 'a la 1:00 p. m.' && L.atTime('es', '11:30 a. m.') === 'a las 11:30 a. m.' && L.capFirst('viernes') === 'Viernes',
    [AD.dayWords('2026-05-08', false, 'es'), AD.dayWords('2026-05-08', true, 'es'), L.atTime('es', '1:00 p. m.')]);
  const RT = await import('../../src/lib/ready-text');
  check('the text when it’s ready, in Spanish for an order placed in Spanish (ahead, each way, and the kiosk)', RT.readyWords({ number: '12', channel: 'ahead', guestLang: 'es', ahead: { way: 'drive-thru' } }, 'L') === 'Su pedido 12 está listo. Entre al drive-thru y diga su código en la bocina. Su pedido: L'
    && RT.readyWords({ number: '12', channel: 'ahead', guestLang: 'es', ahead: { way: 'delivery' } }, null) === 'Su pedido 12 va en camino.' && RT.readyWords({ number: '7', channel: 'kiosk', guestLang: 'es' }, null) === 'Su pedido 7 está listo. Recójalo en el mostrador.'
    && RT.readyWords({ number: '12', channel: 'ahead', ahead: { way: 'curbside' } }, null) === 'Order 12 is ready. Tap I’m here when you park, and we’ll bring it out.' && /&lang=es' : ''/.test(src('src/lib/ready-text.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
