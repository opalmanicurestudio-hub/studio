// Checks pacing that knows the kitchen (L20 round 16, design canvas "Kitchen pace"): lib/kitchen-pace (how far behind
// the kitchen is from its own tickets, and what that does to a table's likely free time and the first pickup time),
// lib/kitchen-pace-server (read at most every twenty seconds a business), the host stand's floor and a waiting guest's
// wait (lib/floor-server, api/host/floor), ordering ahead (lib/counter-ahead), the kitchen screen (api/kitchen), the
// setting (api/menu 'service') and the screens.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/kitchen-pace.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 's1', name: 'Sam Lee', role: 'owner', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor, tenant: {} }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-11-14T20:00:00.000Z');
const ago = (min: number, from = NOW) => new Date(from - min * 60000).toISOString();

(async () => {
  const P = await import('../../src/lib/kitchen-pace');
  console.log('the setting');
  check('on by default, busy at 5 minutes behind; the business’s own within 2 to 30', P.paceSettingsOf({}).on && P.paceSettingsOf({}).busyMin === 5
    && P.paceSettingsOf({ kitchenSettings: { pace: { on: false, busyMin: 10 } } }).on === false && P.paceSettingsOf({ kitchenSettings: { pace: { busyMin: 10 } } }).busyMin === 10
    && P.paceSettingsOf({ kitchenSettings: { pace: { busyMin: 99 } } }).busyMin === 5 && P.paceSettingsOf({ kitchenSettings: { pace: { busyMin: 'x' } } }).busyMin === 5);
  check('…saved only when it makes sense', P.cleanPace({ on: false, busyMin: 8 })?.busyMin === 8 && P.cleanPace({ on: true })?.busyMin === 5 && P.cleanPace({ busyMin: 1 }) === null
    && P.cleanPace({ busyMin: 31 }) === null && P.cleanPace({ on: 'yes' }) === null && P.cleanPace(null) === null && P.cleanPace('on') === null);

  console.log('how far behind');
  const tk = (o: any) => ({ status: 'pending', createdAt: ago(10), makeSeconds: 300, ...o });
  let p = P.kitchenPace([tk({ createdAt: ago(30) }), tk({ createdAt: ago(30) })], NOW);
  check('two late tickets aren’t enough to go on: not called behind', p.level === 'calm' && p.behindMin === 0 && p.samples === 2 && p.making === 2, p);
  p = P.kitchenPace([tk({ createdAt: ago(12) }), tk({ createdAt: ago(12) }), tk({ status: 'in_progress', createdAt: ago(12) }), tk({ createdAt: ago(12) })], NOW);
  check('a run of dishes 7 minutes past their usual time: busy, about 7 behind', p.level === 'busy' && p.behindMin === 7 && p.making === 4, p);
  p = P.kitchenPace([tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) })], NOW);
  check('…15 past with busy at 5: slammed (twice the business’s minutes)', p.level === 'slammed' && p.behindMin === 15, p);
  check('…busy at 10 instead: the same kitchen is busy, not slammed', P.kitchenPace([tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) })], NOW, { on: true, busyMin: 10 }).level === 'busy');
  check('…turned off: never behind', P.kitchenPace([tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) }), tk({ createdAt: ago(20) })], NOW, { on: false, busyMin: 5 }).level === 'calm');
  p = P.kitchenPace([tk({ createdAt: ago(3) }), tk({ createdAt: ago(4) }), tk({ createdAt: ago(2) }), tk({ createdAt: ago(30) })], NOW);
  check('one slow dish among quick ones doesn’t make a night look slammed', p.level === 'calm' && p.behindMin === 0 && p.samples === 4, p);
  p = P.kitchenPace([tk({ createdAt: ago(3) }), tk({ createdAt: ago(16) }), tk({ createdAt: ago(2) }), tk({ createdAt: ago(30) })], NOW);
  check('…two of four late is a run: behind by the quicker of the two late ones', p.level === 'slammed' && p.behindMin === 11, p);
  p = P.kitchenPace([tk({ createdAt: ago(40), holdUntil: new Date(NOW + 600000).toISOString() }), tk({ createdAt: ago(40), holdUntil: new Date(NOW + 600000).toISOString() }), tk({ createdAt: ago(40), holdUntil: new Date(NOW + 600000).toISOString() })], NOW);
  check('an order placed ahead, waiting for its time, isn’t late', p.level === 'calm' && p.making === 0 && p.samples === 0, p);
  p = P.kitchenPace([tk({ status: 'ready', firedAt: ago(17), readyAt: ago(5) }), tk({ status: 'delivered', firedAt: ago(19), readyAt: ago(7) }), tk({ status: 'served', firedAt: ago(15), readyAt: ago(3) }), tk({ status: 'ready', firedAt: ago(13), readyAt: ago(1) })], NOW);
  check('what came out in the last twenty minutes counts: 7 minutes late each', p.level === 'busy' && p.behindMin === 7 && p.making === 0 && p.samples === 4, p);
  p = P.kitchenPace([tk({ status: 'ready', firedAt: ago(50), readyAt: ago(30) }), tk({ status: 'ready', firedAt: ago(50), readyAt: ago(30) }), tk({ status: 'ready', firedAt: ago(50), readyAt: ago(30) })], NOW);
  check('…what came out longer ago doesn’t, nor does what was taken off', p.samples === 0 && P.kitchenPace([tk({ status: 'cancelled', createdAt: ago(40) }), tk({ status: 'cancelled' }), tk({ status: 'cancelled' })], NOW).samples === 0, p);
  p = P.kitchenPace([tk({ createdAt: ago(15), makeSeconds: null }), tk({ createdAt: ago(15), makeSeconds: null }), tk({ createdAt: ago(15), makeSeconds: null }), tk({ createdAt: ago(15), makeSeconds: null })], NOW);
  check('a dish whose usual time isn’t set is expected in 6 minutes', p.behindMin === 15 - P.DEFAULT_MAKE_MIN && p.level === 'busy', p);
  const tab = (id: string, mk: number, o: any = {}) => ({ id, status: 'pending', source: 'tab', visitId: 'v1', course: 3, firedAt: ago(14), makeSeconds: mk, ...o });
  const pair = [tab('steak', 900), tab('salad', 300), tab('fries', 240), tab('side', 240)];
  p = P.kitchenPace(pair, NOW);
  check('dishes sent together finish with the slowest: a salad waiting on its steak isn’t late', p.level === 'calm' && p.samples === 4, p);
  const apart = P.kitchenPace(pair, NOW, P.DEFAULT_PACE, { together: false });
  check('…with finishing together turned off, the quicker dishes started at once, so they count as late', apart.behindMin === 10 && apart.level === 'slammed', apart);
  check('…a dish sent to the same table in a later course is its own', P.kitchenPace([tab('steak', 900), tab('a', 300, { course: 4, firedAt: ago(14) }), tab('b', 300, { course: 4, firedAt: ago(14) }), tab('c', 300, { course: 4, firedAt: ago(14) })], NOW).behindMin === 9);
  p = P.kitchenPace([tk({ createdAt: ago(600) }), tk({ createdAt: ago(600) }), tk({ createdAt: ago(3) }), tk({ createdAt: ago(2) }), tk({ createdAt: ago(4) }), tk({ createdAt: ago(1) })], NOW);
  check('a ticket left open overnight (a screen turned off at close) isn’t cooking: not counted at all', p.level === 'calm' && p.behindMin === 0 && p.making === 4 && p.samples === 4, p);
  p = P.kitchenPace([tk({ createdAt: ago(100) }), tk({ createdAt: ago(100) }), tk({ createdAt: ago(100) }), tk({ createdAt: ago(100) })], NOW);
  check('…and no dish counts as more than an hour late: never called more than an hour behind', p.level === 'slammed' && p.behindMin === P.MAX_BEHIND_MIN, p);
  check('said plainly', P.paceWords({ behindMin: 8, level: 'busy', making: 3, samples: 4 }) === 'The kitchen is about 8 minutes behind.' && P.paceWords({ behindMin: 15, level: 'slammed', making: 3, samples: 4 }) === 'The kitchen is about 15 minutes behind, and slammed.' && P.paceWords(P.CALM) === '');

  console.log('what it changes');
  const slam = { behindMin: 15, level: 'slammed' as const, making: 6, samples: 6 };
  check('a table still waiting on its food is likely free that much later', P.pacedFreeIn('cooking', 30, slam) === 45 && P.pacedFreeIn('seated', 60, slam) === 75 && P.pacedFreeIn('no_order', 55, slam) === 70 && P.pacedFreeIn('between', 20, slam) === 35);
  check('…a table whose food is at the pass, or that’s eating, paying or being cleared, isn’t slowed by the kitchen; nor anything when it’s calm', P.pacedFreeIn('eating', 30, slam) === 30 && P.pacedFreeIn('check', 10, slam) === 10 && P.pacedFreeIn('paid', 3, slam) === 3
    && P.pacedFreeIn('clearing', 2, slam) === 2 && P.pacedFreeIn('at_pass', 20, slam) === 20 && P.pacedFreeIn('cooking', 30, P.CALM) === 30 && P.pacedFreeIn('cooking', null, slam) === null);
  check('ordering ahead: the first pickup time that much later (none when calm)', P.pickupDelayMin(slam) === 15 && P.pickupDelayMin(P.CALM) === 0);
  const AH = await import('../../src/lib/counter-ahead');
  const at = Date.parse('2026-11-14T18:00:00.000Z'); const ny = { timezone: 'America/New_York', orderAhead: { on: true } };
  const t0 = AH.pickupTimes(ny, at); const t15 = AH.pickupTimes(ny, at, 15); const t9 = AH.pickupTimes(ny, at, 9);
  check('…on the quarter hour: 20 minutes out as usual, 35 when 15 behind, still the same slot when 9 behind', t0[0] === '2026-11-14T18:30:00.000Z' && t15[0] === '2026-11-14T18:45:00.000Z' && t9[0] === '2026-11-14T18:30:00.000Z' && t15[t15.length - 1] === t0[t0.length - 1], [t0[0], t15[0], t9[0]]);

  console.log('read from the kitchen’s tickets');
  const PS = await import('../../src/lib/kitchen-pace-server');
  const RN = Date.now(); const rago = (m: number) => ago(m, RN);
  await db.doc(T).set({ name: 'Linden', timezone: 'UTC' });
  const busy = ['b1', 'b2', 'b3', 'b4'];
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ id, status: 'pending', source: 'counter', orderId: `o_${id}`, createdAt: rago(20), makeSeconds: 300 });
  await db.doc(`${T}/kdsTickets/old`).set({ id: 'old', status: 'delivered', createdAt: rago(200), readyAt: rago(180), makeSeconds: 300 });
  let v = await PS.paceNow(db, T, await get(T));
  check('what’s being made now, from the database: slammed, 15 behind', v.level === 'slammed' && v.behindMin === 15 && v.making === 4 && v.samples === 4, v);
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ status: 'delivered', readyAt: rago(25) }, { merge: true });
  v = await PS.paceNow(db, T, await get(T));
  check('…read at most every twenty seconds a business (the same answer straight after)', v.level === 'slammed');
  PS.forgetPace(T);
  v = await PS.paceNow(db, T, await get(T));
  check('…read again once forgotten: all out, a while ago: calm', v.level === 'calm' && v.samples === 0, v);
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ status: 'pending', readyAt: null }, { merge: true });
  PS.forgetPace(T);
  v = await PS.paceNow(db, T, { ...(await get(T)), kitchenSettings: { pace: { on: false } } });
  check('…turned off: calm, without reading anything', v.level === 'calm' && v.samples === 0);
  let reads = 0; const broken = { collection: () => { reads++; throw new Error('down'); } };
  const warn = console.warn; console.warn = () => {};
  v = await PS.paceNow(broken, 'tenants/t9', {});
  const v2 = await PS.paceNow(broken, 'tenants/t9', {});
  console.warn = warn;
  check('…a read that fails is calm (never a wrong delay), and isn’t tried again for every caller', v.level === 'calm' && v2.level === 'calm' && reads === 1, reads);
  PS.forgetPace(T);
  let asked = 0; const counting = { collection: (path: string) => { asked++; return db.collection(path); } };
  const both = await Promise.all([PS.paceNow(counting, T, await get(T)), PS.paceNow(counting, T, await get(T)), PS.paceNow(counting, T, await get(T))]);
  check('…three screens asking at once share one read', asked === 2 && both.every((x) => x.level === 'slammed'), { asked, both });
  PS.forgetPace(T);
  const slow = PS.paceNow(counting, T, await get(T)); PS.forgetPace(T);
  await slow; asked = 0; await PS.paceNow(counting, T, await get(T));
  check('…a read started before the setting changed isn’t kept', asked === 2);

  console.log('the host stand and a waiting guest');
  PS.forgetPace(T);
  await db.doc(`${T}/serviceSessions/s1`).set({ status: 'open', opensAt: rago(120), units: [{ id: 'u4', name: '4', seatCount: 4, staffIds: [] }, { id: 'u6', name: '6', seatCount: 4, staffIds: [] }] });
  await db.doc(`${T}/parties/lopez`).set({ sessionId: 's1', status: 'seated', name: 'Lopez', size: 4, unitIds: ['u4'], seatedAt: rago(20), guestIds: [] });
  await db.doc(`${T}/appointments/apt-party-lopez`).set({ tableName: '4', tab: [{ lineId: 'l1', name: 'Steak', price: 30, quantity: 1, course: 3, courseName: 'Mains', firedAt: rago(5), kdsId: 'k1' }] });
  await db.doc(`${T}/kdsTickets/k1`).set({ id: 'k1', visitId: 'apt-party-lopez', source: 'tab', status: 'in_progress' });
  await db.doc(`${T}/parties/okafor`).set({ sessionId: 's1', status: 'seated', name: 'Okafor', size: 4, unitIds: ['u6'], seatedAt: rago(70), checkAt: rago(4), guestIds: [] });
  await db.doc(`${T}/appointments/apt-party-okafor`).set({ tableName: '6', tab: [{ lineId: 'l2', name: 'Soup', price: 9, quantity: 1, course: 2, courseName: 'Starters', firedAt: rago(60), kdsId: 'k2' }] });
  await db.doc(`${T}/kdsTickets/k2`).set({ id: 'k2', visitId: 'apt-party-okafor', source: 'tab', status: 'delivered', readyAt: rago(50) });
  await db.doc(`${T}/parties/ana`).set({ sessionId: 's1', status: 'waiting', name: 'Ana', size: 4, joinedAt: rago(15), needs: [], unitIds: [], guestIds: [] });
  await db.doc(`${T}/parties/chris`).set({ sessionId: 's1', status: 'waiting', name: 'Chris Day', size: 4, joinedAt: rago(9), needs: [], unitIds: [], guestIds: [] });
  const FS = await import('../../src/lib/floor-server');
  const Floor = await import('../../src/app/api/host/floor/route');
  let r: any = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  const slamFree = r.body.stages?.u4?.freeIn; const payFree = r.body.stages?.u6?.freeIn;
  check('the floor says how far behind the kitchen is', r.body.ok && r.body.pace?.level === 'slammed' && r.body.pace.behindMin === 15, r.body.pace);
  const readSlam = await FS.readFloor(db, T, await get(T));
  const W = (read: any, id: string, joined: number) => FS.waitNow(read, { name: 'Linden', timezone: 'UTC' }, { id, size: 4, status: 'waiting', joinedAt: rago(joined), needs: [] }, Date.now());
  const waitSlam = W(readSlam, 'chris', 9); const anaSlam = W(readSlam, 'ana', 15);
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ status: 'cancelled' }, { merge: true });
  PS.forgetPace(T); FS.forgetFloor('t1');
  r = await Floor.POST(req({ tenantId: 't1', action: 'floor' }));
  const calmFree = r.body.stages?.u4?.freeIn;
  check('…and nothing when it’s keeping up', r.body.ok && r.body.pace === null, r.body.pace);
  check('a table still waiting on its mains is likely free 15 minutes later when the kitchen is 15 behind', r.body.stages.u4.key === 'cooking' && typeof calmFree === 'number' && slamFree === calmFree + 15, { slamFree, calmFree });
  check('…a table that asked for the check isn’t', r.body.stages.u6.key === 'check' && payFree === r.body.stages.u6.freeIn, { payFree, now: r.body.stages.u6 });
  const readCalm = await FS.readFloor(db, T, await get(T), { fresh: true });
  const waitCalm = W(readCalm, 'chris', 9); const anaCalm = W(readCalm, 'ana', 15);
  check('…so the wait quoted (and a waiting guest’s own link) counts it: next in line gets the table that’s paying, no later', anaSlam.place === 1 && typeof anaCalm.minutes === 'number' && anaSlam.minutes === anaCalm.minutes, { anaSlam, anaCalm });
  check('…second in line waits on the table still waiting for its mains: 15 minutes longer', waitSlam.place === 2 && typeof waitCalm.minutes === 'number' && waitSlam.minutes === waitCalm.minutes + 15, { waitSlam, waitCalm });
  check('…the host stand’s tables board gets the same likely free times', FS.tablesOf(readSlam, await get(T), Date.now()).find((t: any) => t.id === 'u4')?.freeIn === slamFree);

  console.log('ordering ahead');
  const utcH = new Date().getUTCHours(); const k = (((10 - utcH) % 24) + 36) % 24 - 12;
  const zone = k === 0 ? 'UTC' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`;
  await db.doc(T).set({ timezone: zone, orderAhead: { on: true } }, { merge: true });
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ status: 'pending' }, { merge: true });
  PS.forgetPace(T);
  const mBusy: any = await AH.aheadMenu(db, 't1', await get(T));
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ status: 'cancelled' }, { merge: true });
  PS.forgetPace(T);
  const mCalm: any = await AH.aheadMenu(db, 't1', await get(T));
  check('the menu says when the kitchen is busy, and by how much', mBusy.busy?.minutes === 15 && mCalm.busy === null, [mBusy.busy, mCalm.busy]);
  check('…and its first pickup time is that much later', mCalm.times.length > 0 && Date.parse(mBusy.times[0]) - Date.parse(mCalm.times[0]) === 15 * 60000, [mBusy.times[0], mCalm.times[0], zone]);

  console.log('the kitchen screen');
  const K = await import('../../src/app/api/kitchen/route');
  r = await K.POST(req({ action: 'pair', tenantId: 't1', name: 'Pass' }));
  const key = r.body.key;
  for (const id of busy) await db.doc(`${T}/kdsTickets/${id}`).set({ status: 'pending' }, { merge: true });
  PS.forgetPace(T);
  r = await K.POST(req({ action: 'tickets', tenantId: 't1', key }));
  check('the kitchen screen sees how far behind it is', r.body.ok && r.body.pace?.behindMin === 15 && r.body.pace.level === 'slammed' && Object.keys(r.body.pace).sort().join() === 'behindMin,level', r.body.pace);

  console.log('the setting, saved');
  const Menu = await import('../../src/app/api/menu/route');
  r = await Menu.POST(req({ tenantId: 't1', action: 'service', pace: { on: true, busyMin: 8 } }));
  check('busy at 8: saved and given back', r.body.ok && (await get(T)).kitchenSettings.pace.busyMin === 8 && r.body.service?.pace?.busyMin === 8, r.body);
  v = await PS.paceNow(db, T, await get(T));
  check('…counted at once (not after the twenty seconds): 15 behind is busy now, not slammed', v.level === 'busy' && v.behindMin === 15, v);
  r = await Menu.POST(req({ tenantId: 't1', action: 'service', pace: { busyMin: 1 } }));
  const r2: any = await Menu.POST(req({ tenantId: 't1', action: 'service', pace: { on: 'yes' } }));
  check('…nonsense isn’t saved, and says why', r.status === 400 && r2.status === 400 && /Kitchen pace/.test(r.body.error) && (await get(T)).kitchenSettings.pace.busyMin === 8, r.body);
  r = await Menu.POST(req({ tenantId: 't1', action: 'service', pace: { on: false, busyMin: 8 } }));
  check('…turned off: the kitchen is never called behind', r.body.ok && (await PS.paceNow(db, T, await get(T))).level === 'calm');

  console.log('the screens');
  const host = src('src/app/(app)/host/page.tsx'); const kds = src('src/app/kds/[tenantId]/page.tsx'); const order = src('src/app/order/[tenantId]/page.tsx'); const set = src('src/components/menu/TableServiceSettings.tsx');
  check('the host stand says the kitchen is behind and that the waits count it', /The kitchen is about \$\{floor\.pace\.behindMin\} min behind/.test(host) && host.includes('The waits you quote already count it.') && host.includes('seat slowly if you can'));
  check('the kitchen screen shows it in its header, kept from each reply', /say\('About \{n\} min behind\. The host stand and pickup times know\.', \{ n: data\.pace\.behindMin \}\)/.test(kds) && /const next: Data = \{[^\n]*\n\s*pace: d\.pace &&/.test(kds));
  check('ordering ahead tells the guest, plainly', order.includes('The kitchen is busy right now, so orders are taking about') && /menu\.busy/.test(order));
  check('the settings: on or off, and when it counts as busy', set.includes('Count the kitchen’s pace') && set.includes('min behind') && /pace\.on/.test(set) && /busyMin/.test(set));
  const reg = src('src/lib/settings-registry.ts');
  check('…found by searching settings for pace', /tableservice[^\n]*pace behind busy/.test(reg));
  const mine = src('src/lib/kitchen-pace.ts') + src('src/lib/kitchen-pace-server.ts');
  check('house style in the new code: no salon words, no all-caps styling, no shouting', !/salon|stylist|booth|chair/i.test(mine) && !/uppercase|font-black/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
