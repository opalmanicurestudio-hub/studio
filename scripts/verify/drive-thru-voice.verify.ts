// Checks the drive-thru's voice assistant (L21, part two): api/counter/voice, api/counter/assistant, lib/voice-order,
// lib/drive-thru-voice-client, the speaker page and the lane screen's listen and take over.
// - A call is started by the server with its own secret key (never the screen's), for a car at the speaker whose order
//   is still being taken, once (two taps never start two calls); the screen gets only what it needs to join.
// - The live-call steps (listen, take over, tell the assistant, hang up) reach only this business's own calls; telling
//   the assistant carries only words; taking over is kept on the car with who did it.
// - The assistant's tools need the shared secret, find the order from the call itself, price everything from the menu,
//   ask rather than guess (which item, which size), never add a sold-out thing, add once however often a tool call is
//   sent, read back the order and total every time, and send it to the kitchen the same way the lane does. Once the
//   team has taken over, the tools change nothing.
// - Each key does only its own screen's job.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-thru-voice.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

let db: any = strictTransactions(makeDb());
let manager = true; let signedIn = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return {
    requireRole: async (_r: any, _t: any, level: string) => (!signedIn ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

// The voice service, as the server sees it.
let calls: { url: string; method: string; auth: string | null; body: any }[] = []; let nextCall = 1; let failCreate = false;
(globalThis as any).fetch = async (url: string, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, method: init?.method || 'GET', auth: init?.headers?.Authorization || null, body });
  const res = (status: number, data: any) => ({ status, ok: status < 300, text: async () => JSON.stringify(data), json: async () => data });
  if (url.endsWith('/v3/create-web-call')) return failCreate ? res(500, { message: 'down' }) : res(201, { call_id: `call_${nextCall++}abc`, access_token: 'tok', transport: 'livekit', url: 'wss://lk', ice_servers: [], expires_at: 1, agent_id: 'secret-agent', metadata: { private: true } });
  if (url.includes('/v2/stop-call/call_gone')) return res(404, { message: 'not found' });
  if (url.includes('/v2/stop-call/call_refused')) return res(401, { message: 'bad key' });
  if (url.includes('/v2/stop-call/call_busy')) return res(429, { message: 'slow down' });
  if (url.includes('/v2/take-over-live-call/call_tofail')) return res(500, { message: 'down' });
  if (url.includes('/update-retell-llm/')) return res(200, { llm_id: 'llm_new1' });
  if (/\/v2\/(listen-live-call|take-over-live-call|update-live-call|stop-call)\//.test(url)) return res(200, { access_token: 'ltok', participant_id: 'p1', room_name: 'r', expires_at: 1 });
  if (url.endsWith('/create-retell-llm')) return res(201, { llm_id: 'llm_new1' });
  if (url.endsWith('/create-agent')) return res(201, { agent_id: 'agent_new1' });
  return res(404, {});
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  process.env.RETELL_API_KEY = 'key_secret_123'; process.env.RETELL_DRIVETHRU_AGENT_ID = 'agent_dt'; process.env.VOICE_AGENT_SECRET = 'vs_1'; process.env.RETELL_PUBLIC_KEY = 'public_key_1';
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: counter } = await import('../../src/app/api/counter/route');
  const { POST: voice } = await import('../../src/app/api/counter/voice/route');
  const { POST: tool } = await import('../../src/app/api/counter/assistant/route');
  const VO = await import('../../src/lib/voice-order');
  const { menuItemOf } = await import('../../src/lib/menu-server');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc('tenants/t2').set({ name: 'Other', timezone: 'UTC' });
  await db.doc(`${T}/inventory/dbl`).set({ type: 'refreshment', name: 'Double burger', category: 'Burgers', price: 7.5, totalStock: 50, choices: [{ id: 'add', name: 'Add', pick: 'any', max: 3, options: [{ id: 'ch', name: 'Cheese', price: 1 }, { id: 'bc', name: 'Bacon', price: 1.5 }] }, { id: 'lo', name: 'Leave out', pick: 'any', max: 3, options: [{ id: 'on', name: 'No onions', price: 0 }] }] });
  await db.doc(`${T}/inventory/cls`).set({ type: 'refreshment', name: 'Classic burger', category: 'Burgers', price: 5, totalStock: 50 });
  await db.doc(`${T}/inventory/frs`).set({ type: 'refreshment', name: 'Fries', category: 'Sides', price: 2.5, totalStock: 50, choices: [{ id: 'sz', name: 'Size', pick: 'one', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }] });
  await db.doc(`${T}/inventory/rng`).set({ type: 'refreshment', name: 'Onion rings', category: 'Sides', price: 3, totalStock: 50, soldOut: true });

  console.log('matching what was said');
  const m = [menuItemOf('dbl', (await get(`${T}/inventory/dbl`))), menuItemOf('cls', await get(`${T}/inventory/cls`)), menuItemOf('frs', await get(`${T}/inventory/frs`)), menuItemOf('rng', await get(`${T}/inventory/rng`))];
  const name = (r: any) => r.item?.name || (r.ambiguous ? `?${r.ambiguous.map((x: any) => x.name).join('/')}` : r.soldOut ? `out:${r.soldOut.name}` : 'none');
  check('an item heard plainly, or with words around it, is found; “burger” alone is a question; a sold-out one says so; something not on the menu is nothing',
    name(VO.matchItem(m, 'double burger')) === 'Double burger' && name(VO.matchItem(m, 'a double cheeseburger')) === 'Double burger' && name(VO.matchItem(m, 'large fries')) === 'Fries'
    && name(VO.matchItem(m, 'burger')) === '?Double burger/Classic burger' && name(VO.matchItem(m, 'onion rings')) === 'out:Onion rings' && name(VO.matchItem(m, 'tacos')) === 'none');
  const c1 = VO.matchChoices(await get(`${T}/inventory/frs`), []);
  check('a size it must have is asked for, never filled in', !!c1.ask && VO.askFor(c1.ask) === 'Which size: Small or Large?', c1);
  check('the menu the assistant reads has prices and choices, and says what’s sold out', /Fries \$2\.50 \[Size \(must choose one\): Small, Large \+\$1\.00\]/.test(VO.menuForVoice(m)) && /Sold out right now: Onion rings/.test(VO.menuForVoice(m)));
  const MN = await import('../../src/lib/menu-numbers');
  const heard = ['3', 'number 3', '#3', 'No. 3', 'num 3', 'number three', 'the number two', 'Number  12', 'three', '0', 'number zero', 'burger 3', 'number 3 please', '', null, 1234, 'no one', 'noone', 'no two', '#two', 'no 3'].map((x) => MN.spokenNumber(x));
  check('a number heard: “3”, “number 3”, “#3”, “no. 3”, “number three”; not a bare word, not zero, not a number inside other words, not “no one”',
    JSON.stringify(heard) === JSON.stringify([3, 3, 3, 3, 3, 3, 2, 12, null, null, null, null, null, null, null, null, null, null, null, 2, 3]), heard);
  check('the menu’s numbers: section by section, members-only and items off the menu left out',
    JSON.stringify(Array.from(MN.menuNumbers([{ id: 'a', section: 'S' }, { id: 'b', section: 'D' }, { id: 'c', section: 'S', membersOnly: true }, { id: 'd', section: 'S' }, { id: 'e', section: 'D', onMenu: false }, { id: 'f', section: 'D' }]).entries()))
    === JSON.stringify([['a', 1], ['d', 2], ['b', 3], ['f', 4]]));
  check('an item asked for by its number on the menu board is found; a sold-out number says so; a number not on the board is nothing',
    name(VO.matchItem(m, 'number 2')) === 'Classic burger' && name(VO.matchItem(m, 'number three')) === 'Fries' && name(VO.matchItem(m, '#1')) === 'Double burger'
    && name(VO.matchItem(m, 'number 4')) === 'out:Onion rings' && name(VO.matchItem(m, 'number 9')) === 'none', ['number 2', 'number three', '#1', 'number 4', 'number 9'].map((x) => name(VO.matchItem(m, x))));
  const combo = [...m, { ...m[1], id: 'c3', name: 'Combo 3', section: 'Sides' }];
  check('…but with an item that has the number in its name (“Combo 3”), “number 3” is a question back, not a guess',
    name(VO.matchItem(combo, 'number 3')) === '?Fries/Combo 3' && name(VO.matchItem(combo, 'number three')) === '?Fries/Combo 3' && name(VO.matchItem(combo, 'combo 3')) === 'Combo 3', ['number 3', 'number three', 'combo 3'].map((x) => name(VO.matchItem(combo, x))));
  const combo4 = [...m, { ...m[1], id: 'c4', name: 'Combo 4', section: 'Sides' }];
  check('…asked even when the board’s number 4 is sold out and “Combo 4” isn’t (never a silent pick)', name(VO.matchItem(combo4, 'number 4')) === '?Onion rings/Combo 4', name(VO.matchItem(combo4, 'number 4')));
  check('…and the menu the assistant reads has each item’s number before its name', /No\. 1 Double burger \$7\.50/.test(VO.menuForVoice(m)) && /No\. 3 Fries \$2\.50/.test(VO.menuForVoice(m)) && /order by the number/.test(VO.menuForVoice(m)), VO.menuForVoice(m));

  console.log('starting a call');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Speaker', kind: 'drive-thru' }))).body.key;
  const kkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Grill', kind: 'kitchen' }))).body.key;
  manager = false; signedIn = false;
  const V = (b: any) => voice(req({ tenantId: 't1', key, ...b }));
  let r: any = await V({ action: 'config' });
  check('on here: the service and an assistant are set; the screen gets the public key for the transcript, never the secret one', r.body.on === true && r.body.publicKey === 'public_key_1' && !JSON.stringify(r.body).includes('key_secret'), r.body);
  r = await voice(req({ tenantId: 't1', key: kkey, action: 'config' }));
  check('…a kitchen screen’s key does nothing here', r.status === 401);
  const car = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-01' }))).body;
  r = await V({ action: 'speaker' });
  check('the speaker tablet sees the car at the speaker', r.body.car?.id === car.carId && r.body.car.voice === null, r.body);
  // A car taken in line (before the speaker) already has someone with it: never the one the speaker greets.
  const lineCar = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-line', inLine: true, looks: 'Gray Van' }))).body;
  let rl: any = await V({ action: 'speaker' });
  check('a car ordering in line is never the one the speaker greets', rl.body.car?.id === car.carId, rl.body.car);
  rl = await V({ action: 'start', carId: lineCar.carId });
  check('…and the assistant can’t be started on it', rl.status === 409 && /in line/.test(rl.body.error), rl.body);
  await db.doc(`${T}/driveThruCars/${lineCar.carId}`).set({ stage: 'gone', goneAt: new Date().toISOString() }, { merge: true });
  calls = [];
  r = await V({ action: 'start', carId: car.carId });
  const made = calls.find((c) => c.url.endsWith('/v3/create-web-call'));
  check('the call is made by the server with its own key, the assistant, the menu and the car’s number', made?.auth === 'Bearer key_secret_123' && made.body.agent_id === 'agent_dt' && made.body.retell_llm_dynamic_variables.order_number === 'B1'
    && /Double burger/.test(made.body.retell_llm_dynamic_variables.menu) && made.body.metadata.orderId === car.orderId, made);
  check('…the screen gets only what it needs to join (no assistant id, no other details)', r.body.call_id === 'call_1abc' && r.body.access_token === 'tok' && !('agent_id' in r.body) && !('metadata' in r.body), r.body);
  const callId = r.body.call_id;
  check('…kept with the car, and in the server-only list of calls', (await get(`${T}/driveThruCars/${car.carId}`)).voice.status === 'live' && (await get(`driveThruCalls/${callId}`))?.tenantId === 't1');
  r = await V({ action: 'start', carId: car.carId });
  check('a second start for the same car is refused (two tablets never start two calls)', r.status === 409 && calls.filter((c) => c.url.endsWith('/v3/create-web-call')).length === 1, r.body);

  console.log('the assistant’s tools');
  const toolCall = (n: string, args: any, turn = 1, id = callId, secret = 'vs_1') => tool(req({ name: n, args, call: { call_id: id, transcript_object: Array.from({ length: turn }) } }, { 'x-voice-secret': secret }));
  r = await toolCall('add_item', { item: 'fries' }, 1, callId, 'wrong');
  check('the tools need the shared secret', r.status === 401);
  r = await toolCall('add_item', { item: 'burger' }, 2);
  check('“a burger”: asked which one, nothing added', /Double burger/.test(r.body.result) && /Classic burger/.test(r.body.result) && r.body.ask === true && (await get(`${T}/counterOrders/${car.orderId}`)).lines.length === 0, r.body);
  r = await toolCall('add_item', { item: 'fries' }, 3);
  check('fries with no size: the size is asked for, nothing added', /Which size: Small or Large\?/.test(r.body.result) && (await get(`${T}/counterOrders/${car.orderId}`)).lines.length === 0, r.body);
  r = await toolCall('add_item', { item: 'onion rings' }, 4);
  check('something sold out is never added', /sold out/.test(r.body.result) && (await get(`${T}/counterOrders/${car.orderId}`)).lines.length === 0, r.body);
  r = await toolCall('add_item', { item: 'double burger', quantity: 2, choices: ['cheese', 'no onions'] }, 5);
  check('two double burgers with cheese, no onions: priced from the menu (7.50 + 1), and the order so far and total said back', /Added 2 Double burger, Cheese, No onions/.test(r.body.result) && r.body.total === '$18.70' && /2 Double burger, Cheese, No onions/.test(r.body.order_so_far), r.body);
  r = await toolCall('add_item', { item: 'double burger', quantity: 2, choices: ['cheese', 'no onions'] }, 5);
  check('…the same tool call sent again adds nothing more', (await get(`${T}/counterOrders/${car.orderId}`)).lines[0].quantity === 2, (await get(`${T}/counterOrders/${car.orderId}`)).lines);
  r = await toolCall('add_item', { item: 'fries', choices: ['large'] }, 6);
  r = await toolCall('change_quantity', { item: 'fries', quantity: 3 }, 7);
  check('“make that three fries”', (await get(`${T}/counterOrders/${car.orderId}`)).lines.find((l: any) => l.itemId === 'frs')?.quantity === 3, r.body);
  r = await toolCall('remove_item', { item: 'fries' }, 8);
  check('“no fries after all”', !(await get(`${T}/counterOrders/${car.orderId}`)).lines.some((l: any) => l.itemId === 'frs'), r.body);
  r = await toolCall('read_order', {}, 9);
  check('read back: the order and the total with tax', /So far: 2 Double burger, Cheese, No onions\. That’s \$18\.70 with tax/.test(r.body.result), r.body);
  r = await V({ action: 'board' });
  const board: any = await counter(req({ tenantId: 't1', key, action: 'board' }));
  check('what the assistant takes is on the order board as it’s said', board.body.order?.lines?.[0]?.name === 'Double burger', board.body);

  console.log('listening in and taking over');
  calls = [];
  const other = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-02' }))).body;
  await db.doc(`driveThruCalls/call_zz9`).set({ callId: 'call_zz9', tenantId: 't2', carId: 'x', orderId: 'y' });
  r = await V({ action: 'op', op: 'listen-live-call', callId: 'call_zz9' });
  check('a call of another business can’t be reached', r.status === 404 && calls.length === 0, r.body);
  r = await V({ action: 'op', op: 'listen-live-call', callId });
  check('listening in goes through the server with its own key', r.status === 200 && calls[0]?.url.endsWith(`/v2/listen-live-call/${callId}`) && calls[0].auth === 'Bearer key_secret_123', calls);
  r = await V({ action: 'op', op: 'update-live-call', callId, body: { call_control: { additional_context: 'We are out of shakes tonight.', trigger_response: true }, fields_to_override: { metadata: { evil: 1 } } } });
  const upd = calls.find((c) => c.url.includes('update-live-call'));
  check('telling the assistant something carries only the words (nothing else about the call can be changed)', upd?.method === 'PATCH' && JSON.stringify(upd.body) === JSON.stringify({ call_control: { additional_context: 'We are out of shakes tonight.', trigger_response: true } }), upd);
  r = await V({ action: 'op', op: 'take-over-live-call', callId, body: { participant_id: 'p1' } });
  check('taken over: kept on the car and the call', r.status === 200 && (await get(`${T}/driveThruCars/${car.carId}`)).voice.status === 'taken_over' && (await get(`driveThruCalls/${callId}`)).status === 'taken_over');
  r = await toolCall('add_item', { item: 'classic burger' }, 10);
  check('…once the team has taken over, the assistant’s tools change nothing', /taken over/.test(r.body.result) && (await get(`${T}/counterOrders/${car.orderId}`)).lines.length === 1, r.body);
  r = await V({ action: 'op', op: 'delete-call', callId });
  check('nothing but the four live-call steps is passed on', r.status === 400);
  void other;

  console.log('finishing an order');
  const car3 = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-03' }))).body;
  r = await V({ action: 'start', carId: car3.carId }); const call3 = r.body.call_id;
  await toolCall('add_item', { item: 'classic burger' }, 1, call3);
  r = await toolCall('finish_order', {}, 2, call3);
  const o3 = await get(`${T}/counterOrders/${car3.orderId}`);
  check('finished: sent to the kitchen the same way as the lane (tickets, a time it’s due), and the guest told the total and to pull forward', r.body.sent === true && /\$5\.50 with tax\. Please pull forward/.test(r.body.result) && o3.status === 'sent' && !!o3.dueAt
    && (await db.collection(`${T}/kdsTickets`).get()).docs.some((d: any) => d.data().orderId === car3.orderId), r.body);
  r = await toolCall('add_item', { item: 'fries', choices: ['small'] }, 3, call3);
  check('…and after that nothing more is added', /already gone to the kitchen/.test(r.body.result), r.body);
  r = await toolCall('add_item', { item: 'fries' }, 1, 'call_unknown1');
  check('a call that isn’t ours finds no order', /can’t find this order/.test(r.body.result));
  failCreate = true;
  const car4 = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-04' }))).body;
  r = await V({ action: 'start', carId: car4.carId });
  check('the service not answering: said plainly, so the order is taken by hand', r.status === 502 && /by hand/.test(r.body.error) && (await get(`${T}/driveThruCars/${car4.carId}`)).voice.status === 'failed', r.body);
  failCreate = false;
  await db.doc(T).set({ driveThru: { voice: false } }, { merge: true });
  r = await V({ action: 'config' });
  check('a business can switch the assistant off', r.body.on === false && r.body.publicKey === null, r.body);

  console.log('what was said, word for word');
  const burger = { choices: [
    { id: 'x', name: 'Extras', pick: 'any', max: 4, options: [{ id: 'on', name: 'Onions', price: 0.5 }, { id: 'ch', name: 'Cheese', price: 1 }] },
    { id: 'lo', name: 'Leave out', pick: 'any', max: 4, options: [{ id: 'no', name: 'No onions', price: 0 }, { id: 'np', name: 'No pickles', price: 0 }] },
    { id: 'sz', name: 'Size', pick: 'one', required: true, options: [{ id: 'l', name: 'Large', price: 1 }, { id: 'xl', name: 'Extra large', price: 2 }] }] };
  const m1 = VO.matchChoices(burger, ['no onions', 'large']);
  check('“no onions” is the No onions choice, never the Onions extra; “large” is Large, never Extra large', JSON.stringify(m1.picks) === JSON.stringify({ lo: ['no'], sz: ['l'] }) && !m1.unknown.length, m1);
  const m2 = VO.matchChoices(burger, ['hold the pickles', 'extra large']);
  check('“hold the pickles” is No pickles; “extra large” is Extra large', JSON.stringify(m2.picks) === JSON.stringify({ lo: ['np'], sz: ['xl'] }), m2);
  const m3 = VO.matchChoices({ choices: [{ id: 'x', name: 'Extras', pick: 'any', options: [{ id: 'ch', name: 'Cheese', price: 1 }] }] }, ['no cheese']);
  check('“no cheese” where cheese is only an extra: nothing added, nothing to ask', JSON.stringify(m3.picks) === '{}' && !m3.unknown.length && !m3.unsure.length, m3);
  const m4 = VO.matchChoices({ choices: [{ id: 'a', name: 'Cup', pick: 'one', options: [{ id: 'l', name: 'Large', price: 0 }] }, { id: 'b', name: 'Lid', pick: 'one', options: [{ id: 'l2', name: 'Large', price: 0 }] }] }, ['large']);
  check('a word that fits two choices is asked about, never guessed', m4.unsure.length === 1 && m4.unsure[0].options.length === 2 && JSON.stringify(m4.picks) === '{}', m4);

  console.log('calls that end, and stuck ones');
  manager = false; signedIn = false;
  await db.doc(T).set({ driveThru: { voice: true } }, { merge: true });
  const carG = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-10' }))).body;
  r = await V({ action: 'start', carId: carG.carId }); const callG = r.body.call_id;
  calls = [];
  r = await counter(req({ tenantId: 't1', key, action: 'cancel', orderId: carG.orderId }));
  check('the car leaves the lane: the assistant hangs up', r.body.ok && calls.some((c) => c.url.endsWith(`/v2/stop-call/${callG}`)) && (await get(`driveThruCalls/${callG}`)).status === 'ended' && (await get(`${T}/driveThruCars/${carG.carId}`)).voice.status === 'ended', calls);
  r = await toolCall('add_item', { item: 'classic burger' }, 1, callG);
  check('a call that has ended changes nothing', /ended/.test(r.body.result) && (await get(`${T}/counterOrders/${carG.orderId}`)).lines.length === 0, r.body);
  // The speaker tablet lost power mid-call: the service no longer knows the call, but hanging up still clears it here.
  const carH = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-11' }))).body;
  await db.doc(`driveThruCalls/call_gone`).set({ callId: 'call_gone', tenantId: 't1', carId: carH.carId, orderId: carH.orderId, status: 'live' });
  await db.doc(`${T}/driveThruCars/${carH.carId}`).set({ voice: { status: 'live', callId: 'call_gone', at: new Date(Date.now() - 12 * 60000).toISOString() } }, { merge: true });
  r = await V({ action: 'op', op: 'stop-call', callId: 'call_gone' });
  check('hanging up a call the service already ended still ends it here', r.status === 200 && (await get(`${T}/driveThruCars/${carH.carId}`)).voice.status === 'ended', r.body);
  await db.doc(`${T}/driveThruCars/${carH.carId}`).set({ voice: { status: 'live', callId: 'call_gone', at: new Date(Date.now() - 12 * 60000).toISOString() } }, { merge: true });
  r = await V({ action: 'start', carId: carH.carId });
  check('a call nobody ended is over after 11 minutes: the car can be greeted again', r.status === 200 && !!r.body.call_id, r.body);
  const { POST: events } = await import('../../src/app/api/voice/call-events/route');
  const evReq = (body: any) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams('secret=vs_1') }, headers: { get: () => null } }) as any;
  await events(evReq({ event: 'call_ended', call: { call_id: r.body.call_id, metadata: { kind: 'drive-thru', driveThruTenantId: 't1' } } }));
  check('the service saying a call ended is kept on the call and its car, and never lands in the phone call log', (await get(`driveThruCalls/${r.body.call_id}`)).status === 'ended'
    && (await get(`${T}/driveThruCars/${carH.carId}`)).voice.status === 'ended' && (await db.collection(`${T}/voiceCalls`).get()).docs.length === 0);
  // The same tool call sent again later in the call (its id kept): still one change.
  const carI = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-12' }))).body;
  const callI = (await V({ action: 'start', carId: carI.carId })).body.call_id;
  const withId = (turn: number) => tool(req({ name: 'add_item', args: { item: 'classic burger' }, call: { call_id: callI, transcript_object: Array.from({ length: turn }), transcript_with_tool_calls: [{ role: 'tool_call_invocation', name: 'add_item', tool_call_id: 'tc_1', arguments: JSON.stringify({ item: 'classic burger' }) }, ...(turn > 5 ? [{ role: 'tool_call_result', tool_call_id: 'tc_1', content: 'Added' }] : [])] } }, { 'x-voice-secret': 'vs_1' }));
  await withId(3); await withId(3);
  check('the same tool call sent twice (same id) adds once', (await get(`${T}/counterOrders/${carI.orderId}`)).lines[0]?.quantity === 1, (await get(`${T}/counterOrders/${carI.orderId}`)).lines);
  // Later the guest asks for another one, and the list doesn't show the new call yet (only the first, answered).
  await withId(7); await withId(7);
  check('…and the same thing asked for again after the guest spoke is added (never taken for a copy), once', (await get(`${T}/counterOrders/${carI.orderId}`)).lines[0]?.quantity === 2, (await get(`${T}/counterOrders/${carI.orderId}`)).lines);
  // Two things said in one breath: two tool calls at once, both still waiting, each its own id. Both are added.
  const both = [{ role: 'tool_call_invocation', name: 'add_item', tool_call_id: 'tc_f', arguments: JSON.stringify({ item: 'fries', choices: ['large'] }) }, { role: 'tool_call_invocation', name: 'add_item', tool_call_id: 'tc_s', arguments: JSON.stringify({ choices: [], item: 'double burger' }) }];
  const inBreath = (args: any) => tool(req({ name: 'add_item', args, call: { call_id: callI, transcript_object: Array.from({ length: 9 }), transcript_with_tool_calls: both } }, { 'x-voice-secret': 'vs_1' }));
  await inBreath({ item: 'fries', choices: ['large'] }); await inBreath({ item: 'double burger', choices: [] });
  let linesI = (await get(`${T}/counterOrders/${carI.orderId}`)).lines;
  check('two items said in one breath are both added (each tool call has its own id)', linesI.some((l: any) => l.name === 'Fries') && linesI.some((l: any) => l.name === 'Double burger'), linesI);
  // The same thing twice in one breath can't be told apart from a copy: each is made (a double shows in the read-back).
  const twice = [1, 2].map((n) => ({ role: 'tool_call_invocation', name: 'add_item', tool_call_id: `tc_c${n}`, arguments: JSON.stringify({ item: 'classic burger' }) }));
  const again = () => tool(req({ name: 'add_item', args: { item: 'classic burger' }, call: { call_id: callI, transcript_object: Array.from({ length: 11 }), transcript_with_tool_calls: twice } }, { 'x-voice-secret': 'vs_1' }));
  await again(); await again();
  linesI = (await get(`${T}/counterOrders/${carI.orderId}`)).lines;
  check('the same item twice in one breath is never dropped', linesI.find((l: any) => l.name === 'Classic burger')?.quantity === 4, linesI);
  // Taking over ends only the assistant's side: the service's word for that never ends the call here.
  const carK = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-14' }))).body;
  const callK = (await V({ action: 'start', carId: carK.carId })).body.call_id;
  await V({ action: 'op', op: 'take-over-live-call', callId: callK, body: { participant_id: 'p1' } });
  await events(evReq({ event: 'call_ended', call: { call_id: callK, disconnection_reason: 'call_take_over', metadata: { kind: 'drive-thru', driveThruTenantId: 't1' } } }));
  check('the team taking over isn’t the call ending (the guest is still on, with them)', (await get(`driveThruCalls/${callK}`)).status === 'taken_over' && (await get(`${T}/driveThruCars/${carK.carId}`)).voice.status === 'taken_over');
  // A refused hang-up (a bad key, too many tries) leaves the call as it is, and says so.
  for (const [id, why] of [['call_refused', 'a refused key'], ['call_busy', 'too many tries']]) {
    const carX = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: `voicecar-${id}` }))).body;
    await db.doc(`driveThruCalls/${id}`).set({ callId: id, tenantId: 't1', carId: carX.carId, orderId: carX.orderId, status: 'live' });
    await db.doc(`${T}/driveThruCars/${carX.carId}`).set({ voice: { status: 'live', callId: id, at: new Date().toISOString() } }, { merge: true });
    r = await V({ action: 'op', op: 'stop-call', callId: id });
    check(`a hang-up the service refused (${why}) is never taken as the call ending`, r.status === 502 && (await get(`driveThruCalls/${id}`)).status === 'live' && (await get(`${T}/driveThruCars/${carX.carId}`)).voice.status === 'live', r);
  }
  process.env.RETELL_DRIVETHRU_DAILY_CAP = '1';
  const carJ = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-13' }))).body;
  r = await V({ action: 'start', carId: carJ.carId });
  check('past the day’s most calls, no more are started (so nothing can run up a bill)', r.status === 429 && (await get(`${T}/driveThruCars/${carJ.carId}`)).voice?.status !== 'starting', r.body);
  delete process.env.RETELL_DRIVETHRU_DAILY_CAP;

  console.log('names, a long line, and one person on the speaker');
  const S = await import('../../src/lib/counter-server');
  check('a name is kept as said, tidied (letters, spaces, apostrophes, hyphens; 24 at most)', S.cleanName('  Mary-Jane O’Neil ') === 'Mary-Jane O’Neil' && S.cleanName('José') === 'José'
    && S.cleanName('Sam123!!') === 'Sam' && !/[<>/]/.test(S.cleanName('<b>Sam</b>')) && S.cleanName('x'.repeat(40)).length === 24 && S.cleanName('  ') === '');
  // A quiet lane first (everything earlier handed over), then a long one.
  for (const d of (await db.collection(`${T}/driveThruCars`).get()).docs) await d.ref.set({ stage: 'gone' }, { merge: true });
  const carN = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-20' }))).body;
  calls = [];
  r = await V({ action: 'start', carId: carN.carId }); const callN = r.body.call_id;
  let vars = calls.find((c) => c.url.endsWith('/v3/create-web-call'))?.body?.retell_llm_dynamic_variables || {};
  check('each call tells the assistant to ask for a name, and that the line is short', vars.ask_name === 'yes' && vars.busy === 'no', vars);
  r = await toolCall('add_item', { item: 'classic burger' }, 1, callN);
  r = await toolCall('set_name', { name: ' Sam! ' }, 2, callN);
  check('the name the guest gives is saved on the order', /Saved the name Sam/.test(r.body.result) && (await get(`${T}/counterOrders/${carN.orderId}`)).guestName === 'Sam', r.body);
  const laneN: any = await counter(req({ tenantId: 't1', key, action: 'lane' }));
  const boardN: any = await counter(req({ tenantId: 't1', key, action: 'board' }));
  check('…and shows on the lane and on the order board', laneN.body.orders[carN.orderId]?.guestName === 'Sam' && boardN.body.order?.name === 'Sam', [laneN.body.orders[carN.orderId], boardN.body.order]);
  r = await toolCall('set_name', { name: '!!!' }, 3, callN);
  check('…nothing that isn’t a name is saved', /didn’t sound like a name/.test(r.body.result) && (await get(`${T}/counterOrders/${carN.orderId}`)).guestName === 'Sam');
  r = await toolCall('finish_order', {}, 4, callN);
  const ticketsN = (await db.collection(`${T}/kdsTickets`).get()).docs.map((d: any) => d.data()).filter((t: any) => t.orderId === carN.orderId);
  check('the kitchen ticket is for “Sam, car B…”', ticketsN.length === 1 && ticketsN[0].guestName === `Sam, car ${carN.number}`, ticketsN);
  r = await counter(req({ tenantId: 't1', key, action: 'name', orderId: carN.orderId, name: 'Samantha' }));
  const t2 = (await db.collection(`${T}/kdsTickets`).get()).docs.map((d: any) => d.data()).find((t: any) => t.orderId === carN.orderId);
  check('the team can change it on the lane after it’s sent, and the ticket follows', r.body.ok && r.body.name === 'Samantha' && t2.guestName === `Samantha, car ${carN.number}`, [r.body, t2]);
  r = await counter(req({ tenantId: 't1', key, action: 'name', orderId: carN.orderId, name: '' }));
  const t3 = (await db.collection(`${T}/kdsTickets`).get()).docs.map((d: any) => d.data()).find((t: any) => t.orderId === carN.orderId);
  check('…or take it off', r.body.ok && r.body.name === null && t3.guestName === `Car ${carN.number}`, [r.body, t3]);
  await db.doc(T).set({ driveThru: { askName: false } }, { merge: true });
  const many: any[] = [];
  for (let i = 0; i < 6; i++) many.push((await counter(req({ tenantId: 't1', key, action: 'car', carKey: `voicecar-rush-${i}` }))).body);
  calls = [];
  r = await V({ action: 'start', carId: many[5].carId }); const callR = r.body.call_id;
  vars = calls.find((c) => c.url.endsWith('/v3/create-web-call'))?.body?.retell_llm_dynamic_variables || {};
  check('with names switched off and six cars in the lane, the assistant doesn’t ask, and runs in rush mode', vars.ask_name === 'no' && vars.busy === 'yes', vars);
  await db.doc(T).set({ driveThru: { askName: true } }, { merge: true });
  const old0 = new Date(Date.now() - 26 * 3600000).toISOString();
  for (const c of many.slice(0, 5)) await db.doc(`${T}/driveThruCars/${c.carId}`).set({ arrivedAt: old0 }, { merge: true });
  const carQ = (await counter(req({ tenantId: 't1', key, action: 'car', carKey: 'voicecar-quiet' }))).body;
  calls = [];
  await V({ action: 'start', carId: carQ.carId });
  vars = calls.find((c) => c.url.endsWith('/v3/create-web-call'))?.body?.retell_llm_dynamic_variables || {};
  check('…cars left behind from yesterday don’t count toward a long line', vars.busy === 'no', vars);

  r = await V({ action: 'op', op: 'take-over-live-call', callId: callR, body: { participant_id: 'p1' } });
  const r2b: any = await V({ action: 'op', op: 'take-over-live-call', callId: callR, body: { participant_id: 'p2' } });
  check('one person on the speaker at a time: the first take-over works, the second is told who has it', r.status === 200 && r2b.status === 409 && /Speaker is already on this call/.test(r2b.body.message) && (await get(`driveThruCalls/${callR}`)).status === 'taken_over', r2b.body);
  await db.doc(`driveThruCalls/${callR}`).set({ status: 'taking_over', takingBy: 'Mia Lee', takingAt: new Date().toISOString() }, { merge: true });
  r = await V({ action: 'op', op: 'take-over-live-call', callId: callR, body: { participant_id: 'p3' } });
  check('…and while someone is taking over, a second tap is told so', r.status === 409 && /Mia is taking this call/.test(r.body.message), r.body);
  r = await toolCall('read_order', {}, 1, callR);
  check('…while that happens, the assistant carries on (it isn’t cut off mid-word)', !/ended/.test(r.body.result), r.body);
  const carF = many[4];
  await db.doc('driveThruCalls/call_tofail').set({ callId: 'call_tofail', tenantId: 't1', carId: carF.carId, orderId: carF.orderId, status: 'live' });
  r = await V({ action: 'op', op: 'take-over-live-call', callId: 'call_tofail', body: { participant_id: 'p1' } });
  // A call that ended while someone was taking over stays ended.
  const carE = many[3];
  calls = [];
  const rE: any = await V({ action: 'start', carId: carE.carId }); const callE = rE.body.call_id;
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: any) => { if (url.includes(`/v2/take-over-live-call/${callE}`)) await db.doc(`driveThruCalls/${callE}`).set({ status: 'ended' }, { merge: true }); return realFetch(url, init); };
  await V({ action: 'op', op: 'take-over-live-call', callId: callE, body: { participant_id: 'p1' } });
  (globalThis as any).fetch = realFetch;
  check('a call that ended while someone was taking over stays ended (never marked taken over again)', (await get(`driveThruCalls/${callE}`)).status === 'ended', await get(`driveThruCalls/${callE}`));
  check('…and a name needs a letter in it, and is cut by letters, not bytes', S.cleanName('.-’') === '' && Array.from(S.cleanName('𝒜'.repeat(30))).length <= 24);
  check('a take-over the service couldn’t do hands the call back to the assistant', r.status === 502 && (await get('driveThruCalls/call_tofail')).status === 'live', [r.status, await get('driveThruCalls/call_tofail')]);

  console.log('setting it up, and switching it off');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  delete process.env.RETELL_DRIVETHRU_AGENT_ID; manager = true; signedIn = true; calls = [];
  await db.doc(T).set({ driveThru: { voice: null } }, { merge: true });
  r = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('with no assistant yet, the menu page offers to set one up', r.body.voice?.setUp === false && r.body.voice.canSetUp === true, r.body.voice);
  r = await menuApi(req({ action: 'voiceSetup', tenantId: 't1' }));
  const llm = calls.find((c) => c.url.endsWith('/create-retell-llm')); const agent = calls.find((c) => c.url.endsWith('/create-agent'));
  const add = llm?.body?.general_tools?.find((t: any) => t.name === 'add_item');
  check('one tap makes the assistant: its tools point at this app with the shared secret, and it’s kept on the business', r.body.ok && add?.url === 'https://app.test/api/counter/assistant' && add.headers['x-voice-secret'] === 'vs_1'
    && llm?.body?.general_tools?.some((t: any) => t.type === 'end_call') && agent?.body?.response_engine?.llm_id === 'llm_new1' && (await get(T)).driveThru.voiceAgentId === 'agent_new1' && llm.auth === 'Bearer key_secret_123', { body: r.body, llm, agent });
  r = await V({ action: 'config' });
  check('…and it’s on', r.body.on === true, r.body);
  check('…made with the newest instructions: it asks for a name, has a rush mode, and can save a name', (await get(T)).driveThru.voiceVersion === 2 && /\{\{ask_name\}\}/.test(llm?.body?.general_prompt) && /\{\{busy\}\}/.test(llm?.body?.general_prompt)
    && !!llm?.body?.general_tools?.some((t: any) => t.name === 'set_name') && llm?.body?.default_dynamic_variables?.ask_name === 'yes');
  r = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('…so it isn’t offered an update', r.body.voice.outdated === false && r.body.voice.askName === true, r.body.voice);
  await db.doc(T).set({ driveThru: { voiceVersion: 1 } }, { merge: true });
  r = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('an assistant made before names is offered an update', r.body.voice.outdated === true, r.body.voice);
  calls = [];
  r = await menuApi(req({ action: 'voiceUpdate', tenantId: 't1' }));
  const patch = calls.find((c) => c.url.includes('/update-retell-llm/llm_new1'));
  check('…one tap brings it up to date with the same instructions and tools a new one gets', r.body.ok && patch?.method === 'PATCH' && patch.body.general_tools.some((t: any) => t.name === 'set_name') && (await get(T)).driveThru.voiceVersion === 2, { body: r.body, patch });
  r = await menuApi(req({ action: 'voice', tenantId: 't1', askName: false }));
  check('a manager switches off asking for names', r.body.ok && r.body.askName === false && (await get(T)).driveThru.askName === false, r.body);
  await menuApi(req({ action: 'voice', tenantId: 't1', askName: true }));
  r = await menuApi(req({ action: 'voice', tenantId: 't1', on: false }));
  const off: any = await V({ action: 'config' });
  check('a manager switches it off (a car is then taken by hand)', r.body.ok && off.body.on === false, off.body);
  manager = false;
  r = await menuApi(req({ action: 'voice', tenantId: 't1', on: true }));
  check('…only a manager', r.status === 403);

  console.log('the pages');
  const client = src('src/lib/drive-thru-voice-client.ts'), speaker = src('src/app/drive-thru/[tenantId]/speaker/page.tsx'), lane = src('src/app/drive-thru/[tenantId]/page.tsx') + src('src/components/drive-thru/VoiceBar.tsx');
  check('the browser kit’s requests all go to our server (never to the service with a key)', client.includes("fetch('/api/counter/voice'") && client.includes("key: publicKey || 'proxied'") && !/RETELL_API_KEY|key_secret/.test(client + speaker + lane));
  check('the speaker greets a car (a tap, a key press from a car sensor, or a car added on the lane), and says when to take the order by hand', speaker.includes("e.key === 'Enter'") && speaker.includes('createWebCall') && /Take this order on the lane screen/.test(speaker));
  check('the speaker makes one car per pull-up (a held key, a double tap, a chattering sensor)', speaker.includes('!e.repeat') && speaker.includes('pulling.current = true;   // taken before anything is awaited'));
  check('the lane keeps a call it took over when someone looks at another car (and asks before the page is left)', lane.includes('const live = new Map<string, Live>()') && lane.includes("window.addEventListener('beforeunload'") && !/return \(\) => \{[^}]*disconnect/.test(src('src/components/drive-thru/VoiceBar.tsx')));
  check('the speaker keeps the guest on when the team takes over (only its transcript stops)', speaker.includes("ev?.disconnection_reason === 'call_take_over'") && speaker.includes('(s as any).monitorEnded ='));
  check('the lane shows which car someone here is on, with a way back to it', lane.includes('useOnTheSpeakerHere()') && lane.includes('You’re still on the speaker with car') && lane.includes("onAir ? ' · you’re on'"));
  check('names: typed on the lane when taking an order by hand, shown on each car and the order board', lane.includes('<NameField key={order.id}') && lane.includes("post({ action: 'name', orderId, name })") && src('src/app/drive-thru/[tenantId]/board/page.tsx').includes('`Thank you, ${o.name}`'));
  check('the Menu page: ask for a name on or off, and an update for an older assistant', src('src/app/(app)/menu/page.tsx').includes('Ask each car for a first name') && src('src/app/(app)/menu/page.tsx').includes('Update the assistant'));
  check('a take-over someone else already has says who', lane.includes("e?.status === 409 && typeof e?.message === 'string'"));
  check('saving a name never holds up Send (it’s saved on its own, and what was typed stays on screen until it’s saved)', lane.includes('onSave={(v) => saveName(order.id, v)}') && lane.includes('const saveName = async') && !/act\('name'/.test(lane));
  check('the lane screen: listen in, take over on the mic, tell the assistant, hang up', lane.includes('monitorCall') && lane.includes('s.takeOver()') && lane.includes('additional_context') && lane.includes('s.listen()') && lane.includes('<VoiceBar'));
  const ui = [speaker, lane].join('\n');
  const strings = ui.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1|>[^<>{}\n]+</g)?.join('\n') || '';
  const banned = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('writing rules: no all-caps, no emoji or check marks, no JSX comments, no business-type words, no tool names', !/\buppercase\b|font-black/.test(ui) && !/[\u{1F300}-\u{1FAFF}✓✔✅]/u.test(ui)
    && !/\{\/\*/.test(ui) && !/\b(studio|salon|stylist|booth|chair)s?\b/i.test(strings) && !new RegExp(banned.join('|'), 'i').test(ui + client), strings.match(/\b(studio|salon|stylist|booth|chair)s?\b/gi));
  check('buttons are 44px or more', !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(ui));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
