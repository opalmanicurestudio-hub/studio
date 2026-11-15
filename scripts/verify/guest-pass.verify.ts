// Checks the guest pass (L20 round 15, design canvas "Guest pass"): lib/guest-pass (their order course by course, what
// they can ask for and what they see once it's sent and once someone has it), lib/nudges (an ask is first on the
// server's phone until someone says "On it"), api/table-pay (the check's link opens the table's page: where the order
// is, what they've asked, a regular's usual; asking, once per kind while it's open; the check asked for shows on the
// host stand), api/wait (a seated guest's wait link leads to it), and the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/guest-pass.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 's1', name: 'Ana Ruiz', role: 'staff', isManager: false, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, ip = '10.2.2.2') => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'x-real-ip' ? ip : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const TOKEN = 'abcdefghijklmnopqrstuv';

(async () => {
  const G = await import('../../src/lib/guest-pass');
  const TS = await import('../../src/lib/table-service');
  console.log('their order, course by course');
  check('each dish: held until they’re ready, ordered, being made, on its way, served; taken off isn’t shown', G.itemState({ kdsId: 'k', firedAt: null }, { status: 'unfired' }) === 'held' && G.itemState({ kdsId: 'k', firedAt: 'x' }, { status: 'pending' }) === 'ordered'
    && G.itemState({ kdsId: 'k' }, { status: 'in_progress' }) === 'making' && G.itemState({ kdsId: 'k' }, { status: 'ready' }) === 'on_way' && G.itemState({ kdsId: 'k' }, { status: 'delivered' }) === 'served' && G.itemState({ kdsId: 'k' }, { status: 'cancelled' }) === null);
  const L = (id: string, name: string, course: number, seat: number | null, o: any = {}) => ({ lineId: id, itemId: id, itemType: 'product', name, price: 10, quantity: 1, seat, course, kdsId: `k_${id}`, firedAt: '2026-11-14T20:00:00Z', ...o });
  const tab = [L('a', 'Burrata', 2, 1), L('b', 'Crudo', 2, 2), L('c', 'Steak frites', 3, 1), L('d', 'Grilled bream', 3, 2), L('e', 'Tart', 4, null, { firedAt: null }), L('f', 'Old fashioned', 1, 1), { lineId: 's', itemType: 'service', name: 'Corkage' }];
  const tickets: any = { k_a: { status: 'delivered' }, k_b: { status: 'delivered' }, k_c: { status: 'in_progress' }, k_d: { status: 'ready' }, k_e: { status: 'unfired' }, k_f: { status: 'cancelled' } };
  const cs = G.passCourses(tab, tickets, TS.DEFAULT_COURSES);
  check('by course in order; a course says the least far along of what’s in it; taken off and services left out', cs.map((c) => `${c.name}:${c.state}`).join() === 'Starters:served,Mains:making,Dessert:held', cs.map((c) => [c.name, c.state]));
  check('…each dish with its seat and where it is', cs[1].items.map((i) => `${i.name}/${i.seat}/${i.state}`).join() === 'Steak frites/1/making,Grilled bream/2/on_way');
  check('…a course of things all on their way says so; words for each', G.passCourses([L('x', 'A', 3, 1), L('y', 'B', 3, 2)], { k_x: { status: 'ready' }, k_y: { status: 'ready' } }, TS.DEFAULT_COURSES)[0].state === 'on_way' && G.STATE_WORDS.held === 'When you’re ready' && G.STATE_WORDS.on_way === 'On its way');

  console.log('asking');
  check('what the server’s phone says for each', G.askText({ what: 'water' }, 'Table 5') === 'Table 5 would like water.' && G.askText({ what: 'check' }, 'Table 5') === 'Table 5 would like the check.' && G.askText({ what: 'server' }, 'Table 5') === 'Table 5 is asking for their server.' && G.askText({ what: 'usual', item: 'Oat latte' }, 'Table 5') === 'Table 5 would like their usual: Oat latte.');
  check('what they see once it’s sent, and once someone has it (by first name)', G.askSaid({ what: 'water' }, null) === 'We let your server know you’d like water.' && G.askSaid({ what: 'water' }, 'Ana') === 'Water is on its way. Ana has it.'
    && G.askSaid({ what: 'server' }, 'Ana') === 'Ana is on the way.' && G.askSaid({ what: 'check' }, 'Ana') === 'Ana is bringing the check.' && G.askSaid({ what: 'usual', item: 'Oat latte' }, null) === 'We let your server know you’d like Oat latte.' && G.firstName('Ana Ruiz') === 'Ana');
  const a1 = { id: 'aaaa1111', what: 'water' as const, at: '2026-11-14T20:00:00Z' };
  check('…seen once marked done; put off a few minutes isn’t seen; one open of a kind at a time', !G.askSeen(a1, {}) && G.askSeen(a1, { 'ask:aaaa1111': { at: 'x' } }) && !G.askSeen(a1, { 'ask:aaaa1111': { at: 'x', until: 'y' } })
    && G.openOfKind([a1], 'water', {})?.id === 'aaaa1111' && G.openOfKind([a1], 'water', { 'ask:aaaa1111': { at: 'x' } }) === null && G.openOfKind([a1], 'check', {}) === null);

  console.log('on the server’s phone');
  const N = await import('../../src/lib/nudges');
  const now = Date.parse('2026-11-14T20:03:00Z');
  const nt: any = { visitId: 'v1', partyId: 'p1', table: 'Table 5', seatedAt: '2026-11-14T19:30:00Z', tab: [], tickets: {}, allergies: [], done: {}, courses: TS.DEFAULT_COURSES, asks: [a1, { id: 'bbbb2222', what: 'check', at: '2026-11-14T20:02:30Z' }] };
  let ns = N.nudgesFor(nt, N.DEFAULT_NUDGES, now);
  check('what the table asked for comes first, urgent, with how long ago', ns[0].kind === 'asked' && ns[0].key === 'ask:aaaa1111' && ns[0].urgent && ns[0].text === 'Table 5 would like water. Asked 3 min ago.' && ns[1].text === 'Table 5 would like the check.', ns.map((n) => n.text));
  ns = N.nudgesFor({ ...nt, done: { 'ask:aaaa1111': { at: '2026-11-14T20:02:00Z' } } }, N.DEFAULT_NUDGES, now);
  check('…gone once someone says On it; the server can mark one done', !ns.some((n) => n.key === 'ask:aaaa1111') && N.NUDGE_KEY.test('ask:aaaa1111') && !N.NUDGE_KEY.test('ask:AA') && !N.NUDGE_KEY.test('ask:x/y'));

  console.log('the table’s page');
  await db.doc(T).set({ id: 't1', name: 'Linden', salesTax: { configured: true, productsPct: 10 }, kitchenSettings: { tablePay: { on: true } }, stripeAccountId: 'acct_1' });
  for (const [id, name, msrp] of [['a', 'Burrata', 14], ['b', 'Crudo', 16], ['c', 'Steak frites', 30], ['d', 'Grilled bream', 28], ['e', 'Tart', 10], ['f', 'Old fashioned', 15]] as [string, string, number][])
    await db.doc(`${T}/inventory/${id}`).set({ id, name, msrp, type: 'refreshment' });
  await db.doc(`${T}/appointments/v1`).set({ id: 'v1', isTable: true, tableName: '5', partyId: 'p1', status: 'servicing', source: 'host', payToken: TOKEN, tab: tab.filter((l: any) => l.itemType === 'product') });
  await db.doc(`${T}/serviceSessions/s1`).set({ id: 's1', status: 'open', opensAt: '2026-11-14T16:00:00Z', units: [{ id: 'u5', name: '5', staffIds: ['s1'] }] });
  await db.doc(`${T}/parties/p1`).set({ id: 'p1', sessionId: 's1', status: 'seated', name: 'Ruiz', size: 2, seatedAt: '2026-11-14T19:30:00Z', guestIds: ['appt:v1'], unitIds: ['u5'] });
  for (const [k, st] of Object.entries(tickets)) await db.doc(`${T}/kdsTickets/${k}`).set({ id: k, visitId: 'v1', status: (st as any).status });
  const P = await import('../../src/app/api/table-pay/route');
  let r: any = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'view' }));
  const pass = r.body.pass;
  check('the check’s link opens the table’s page: their order as it’s made, nothing asked yet, paying on', r.body.ok && r.body.table === 'Table 5' && pass.courses.map((c: any) => `${c.name}:${c.state}`).join() === 'Starters:served,Mains:making,Dessert:held' && pass.asks.length === 0 && pass.payOn === true && pass.usual === null, { body: r.body });
  check('…and what the check comes to so far, for paying when they’re ready', r.body.state === 'wait' && /hasn’t gone to the kitchen/.test(r.body.why) && r.body.total > 0);
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'water' }));
  let v1: any = await get(`${T}/appointments/v1`);
  check('asking for water: kept on the table, said back to them', r.body.ok && v1.guestAsks.length === 1 && v1.guestAsks[0].what === 'water' && G.ASK_ID.test(v1.guestAsks[0].id) && r.body.ask.said === 'We let your server know you’d like water.' && !r.body.ask.seen);
  const r2: any = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'water' }));
  check('…asking again while it’s open is the same ask', r2.body.ok && r2.body.already && (await get(`${T}/appointments/v1`)).guestAsks.length === 1);
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'check' }));
  check('the check asked for: kept, and the host stand sees the table asked for the check', r.body.ok && !!(await get(`${T}/parties/p1`)).checkAt && (await get(`${T}/parties/p1`)).checkBy === 'The table');
  const r3: any = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'usual' }));
  const r4: any = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'champagne' }));
  check('…a usual only when the business offers it and knows them; nothing that isn’t on the list', r3.status === 400 && r4.status === 400);
  const Floor = await import('../../src/lib/floor-server');
  Floor.forgetFloor('t1');
  const Tab = await import('../../src/app/api/tab/route');
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudges' }));
  const asked = (r.body.nudges || []).filter((n: any) => n.kind === 'asked');
  check('the server’s phone shows both, first', r.body.ok && asked.length === 2 && r.body.nudges[0].kind === 'asked' && asked.some((n: any) => /would like water/.test(n.text)), r.body.nudges?.map((n: any) => n.text));
  const waterKey = asked.find((n: any) => /water/.test(n.text)).key;
  r = await Tab.POST(req({ tenantId: 't1', action: 'nudge', key: waterKey, partyId: 'p1', op: 'done' }));
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'view' }));
  const water = r.body.pass.asks.find((a: any) => a.what === 'water');
  check('“On it” on the server’s phone: the table sees someone has it, by first name', water.seen && water.said === 'Water is on its way. Ana has it.' && r.body.pass.checkAsked === true, r.body.pass.asks);
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'water' }));
  check('…and can ask for water again', r.body.ok && !r.body.already && (await get(`${T}/appointments/v1`)).guestAsks.length === 3);
  await db.doc(T).set({ hostingSettings: { memory: { on: true, offerUsual: true } } }, { merge: true });
  await db.doc(`${T}/parties/p1`).set({ clientId: 'c1', guestMatch: 'host' }, { merge: true });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Ruiz', firstName: 'Maya' });
  for (const [i, when] of ['2026-10-01', '2026-10-15', '2026-11-01'].entries())
    await db.doc(`${T}/appointments/old${i}`).set({ id: `old${i}`, clientId: 'c1', isTable: true, status: 'completed', startTime: `${when}T19:00:00Z`, tab: [{ lineId: `o${i}`, itemId: 'latte', itemType: 'product', name: 'Oat latte', price: 5, quantity: 1 }] });
  await db.doc(`${T}/inventory/latte`).set({ id: 'latte', name: 'Oat latte', msrp: 5, type: 'refreshment' });
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'view' }));
  check('a regular the host knows, when the business offers it: their usual', r.body.pass.usual === 'Oat latte', r.body.pass.usual);
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'usual' }));
  check('…asked for, named on the server’s phone', r.body.ok && r.body.ask.said === 'We let your server know you’d like Oat latte.' && (await get(`${T}/appointments/v1`)).guestAsks.some((a: any) => a.what === 'usual' && a.item === 'Oat latte'));
  {
    const many = Array.from({ length: 19 }, (_, i) => ({ id: `seen${String(i).padStart(4, '0')}`, what: 'water', at: `2026-11-14T19:${String(10 + i).padStart(2, '0')}:00Z` }));
    const done: any = Object.fromEntries(many.map((a) => [`ask:${a.id}`, { at: 'x', by: 'Ana Ruiz' }]));
    await db.doc(`${T}/appointments/v1`).set({ guestAsks: many }, { merge: true });
    await db.doc(`${T}/parties/p1`).set({ nudges: done }, { merge: true });
    r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'server' }, '10.9.9.9'));
    const kept = (await get(`${T}/appointments/v1`)).guestAsks;
    check('a long night never runs out of asks: the oldest ones someone has seen make room', r.body.ok && kept.length === 20 && kept[kept.length - 1].what === 'server' && kept.filter((a: any) => /^seen/.test(a.id)).length === 19, kept.length);
  }
  await db.doc(`${T}/appointments/v1`).set({ status: 'completed' }, { merge: true });
  r = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'ask', what: 'server' }));
  const rv: any = await P.POST(req({ tenantId: 't1', token: TOKEN, action: 'view' }));
  check('a closed check: nothing more to ask, and the page says it’s closed', r.status === 409 && rv.body.state === 'closed');

  console.log('from the wait link');
  await db.doc(`${T}/appointments/v1`).set({ status: 'servicing' }, { merge: true });
  await db.doc(`${T}/parties/p1`).set({ waitToken: 'w'.repeat(24), source: 'waitlist' }, { merge: true });
  const Wait = await import('../../src/app/api/wait/route');
  const ws = src('src/app/api/wait/route.ts');
  check('a seated guest’s wait link leads to their table’s page', /if \(state === 'seated'\)/.test(ws) && /pass: token \? `\/bill\/\$\{encodeURIComponent\(tenantId\)\}\/\$\{token\}`/.test(ws) && /visitIdForParty\(p\)/.test(ws) && typeof Wait.POST === 'function');

  console.log('the screens');
  const bill = src('src/app/bill/[tenantId]/[token]/page.tsx'), card = src('src/components/host/TablePayCard.tsx'), tt = src('src/components/host/TableTab.tsx'), tables = src('src/app/(app)/tables/page.tsx'), wait = src('src/app/wait/[tenantId]/[token]/page.tsx');
  check('the table’s page first: their order, Need something?, their usual, so far, Pay or split; and back from paying', /function TablePass/.test(bill) && /Need something\?/.test(bill) && /Your usual\?/.test(bill) && /So far/.test(bill) && /Pay or split/.test(bill) && /Back to your table/.test(bill) && /post\('ask', \{ what \}\)/.test(bill));
  check('the server shows the table’s code at any time; paying only when it’s on', /visitId && <TablePayCard[^\n]*payOn=\{tab\.length > 0 && tablePayOf\(tenant\)\.on\}/.test(tt) && /Show the table’s code/.test(card) && /\{payOn && <>/.test(card));
  check('“On it” for an ask on My tables; the wait link opens the table’s page', /n\.kind === 'asked'/.test(tables) && /Open your table’s page/.test(wait));
  check('the wait link reads the table’s link it already has (no write on every look); the code is read once when paying is off', /typeof v\.payToken === 'string'/.test(ws) && /if \(!payOn\) return;/.test(card));
  check('asking is limited per table, not per address (a room on the same Wi-Fi isn’t one guest)', /tooMany\(`ask\|\$\{tenantId\}\|\$\{token\}`, 8\)/.test(src('src/app/api/table-pay/route.ts')));
  check('…the house words', ![bill, card, wait].some((x) => /uppercase|font-black| · |[\u{1F300}-\u{1FAFF}]|call us|contact us/u.test(x)));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
