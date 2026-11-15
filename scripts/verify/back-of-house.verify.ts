// Checks the dish pit and the barback (L20 round 23, design canvas "Dish and barback"): lib/back-calls and lib/back-calls-server (a
// station calls the dish pit or the barback; "On my way", "Done", "Cancel", "Not me after all", each once; a call nobody
// takes in time tells the owner and managers, once), lib/dish and lib/dish-server (plates and glasses heading its way,
// tonight's rush, the machine check with its limits, breakage), api/back (a set-up tablet's key or a team member signed
// in; the dish pit's closing items), lib/barback and lib/barback-server (what's running low at the bar, "Changed it"
// with pour loss), lib/tell-managers, the rules (the new records are server only), and the pages (the dish and barback
// screens, the kitchen screen's Call, the machine check settings).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/back-of-house.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

const db: any = strictTransactions(makeDb());
let manager = true; let signedIn = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (!signedIn ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const list = async (c: string, k: string, v: any) => (await db.collection(c).where(k, '==', v).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();

(async () => {
  const C = await import('../../src/lib/back-calls');
  const D = await import('../../src/lib/dish');

  console.log('calls, the rules');
  check('a call needs who it’s for and what', 'error' in C.cleanCall({ to: 'chef', what: 'plates' }) && 'error' in C.cleanCall({ to: 'dish', what: 'ice' }) && !('error' in C.cleanCall({ to: 'dish', what: 'plates' })));
  check('“A bottle of…” says which, “Something else” says what', 'error' in C.cleanCall({ to: 'barback', what: 'bottle' }) && 'error' in C.cleanCall({ to: 'dish', what: 'other', note: '  ' })
    && C.callWords('barback', 'bottle', 'house vodka') === 'A bottle of house vodka' && C.callWords('barback', 'ice', 'well 2') === 'Ice, well 2' && C.callWords('dish', 'other', 'Hotel pans') === 'Hotel pans');
  const now = Date.now();
  const mk = (id: string, x: any) => C.callFrom(id, { to: 'dish', what: 'plates', from: 'Kitchen', fromId: 's_k', status: 'open', at: iso(1), ...x })!;
  const q = C.callQueue([mk('a', { at: iso(2) }), mk('b', { at: iso(7) }), mk('c', { status: 'coming', at: iso(9), takenBy: 'Sam Lee' }), mk('d', { to: 'barback', what: 'ice' }), mk('e', { status: 'done', doneAt: iso(1) })], 'dish', now);
  check('the dish pit’s queue: nobody on it yet first, longest waiting at the top; then the ones on the way; never the barback’s or done ones', q.map((x) => x.id).join() === 'b,a,c' && q[0].late && !q[1].late && !q[2].late, q.map((x) => [x.id, x.mins, x.late]));
  const mine = C.myCalls([mk('a', {}), mk('e', { status: 'done', doneAt: iso(2), doneBy: 'Sam Lee' }), mk('f', { status: 'done', doneAt: iso(9) }), mk('g', { fromId: 's_other' })], 's_k', now);
  check('a station sees its own calls, and the ones done in the last few minutes', mine.map((x) => x.id).join() === 'a,e' && C.callState(mine[1], now) === 'Done, Sam' && C.callState(mk('c', { status: 'coming', takenBy: 'Sam Lee' }), now) === 'Sam’s on the way');
  check('steps only from where they make sense', C.canStep('open', 'coming') && !C.canStep('coming', 'coming') && C.canStep('coming', 'done') && C.canStep('open', 'cancel') && !C.canStep('coming', 'cancel') && C.canStep('coming', 'release') && !C.canStep('open', 'release'));

  console.log('the dish pit, the rules');
  const ds = D.dishSettingsOf({}); check('the usual machine check: hot water, 180°F or hotter, every 4 hours', ds.on && ds.machine === 'hot' && ds.minF === 180 && ds.everyHours === 4 && D.limitWords(ds) === '180°F or hotter');
  check('settings that make no sense are refused', D.cleanDishSettings({ machine: 'chemical', minF: 180, ppmMin: 100, ppmMax: 50, everyHours: 4 }) === null && D.cleanDishSettings({ minF: 400, ppmMin: 50, ppmMax: 100, everyHours: 4 }) === null && D.cleanDishSettings({ minF: 180, ppmMin: 50, ppmMax: 100, everyHours: 5 }) === null
    && D.cleanDishSettings({ machine: 'chemical', minF: 180, ppmMin: 50, ppmMax: 100, everyHours: 2 })?.machine === 'chemical');
  const chem = D.dishSettingsOf({ dishSettings: { machine: 'chemical', ppmMin: 50, ppmMax: 100 } });
  check('a reading inside the limits, or not', D.readingOk(ds, 182) && !D.readingOk(ds, 164) && D.readingOk(chem, 75) && !D.readingOk(chem, 30) && !D.readingOk(chem, 200) && D.cleanReading(ds, 'abc') === null && D.cleanReading(ds, 999) === null);
  const ck = (minAgo: number, ok = true) => ({ id: `c${minAgo}`, at: iso(minAgo), value: ok ? 182 : 160, unit: '°F', ok, note: ok ? null : 'Ran it again', by: 'Sam' });
  check('a check is due first thing; then every few hours; again after one outside the limits; once a day means once',
    D.checkDue(ds, [], now).due && !D.checkDue(ds, [ck(60)], now).due && D.checkDue(ds, [ck(250)], now).due && D.checkDue(ds, [ck(20, false)], now).due && !D.checkDue({ ...ds, everyHours: 0 }, [ck(600)], now).due && !D.checkDue({ ...ds, on: false }, [], now).due);
  const t = (minAgo: number, x: any = {}) => ({ status: 'served', madeAt: 'Kitchen', readyAt: iso(minAgo), deliveredAt: null, quantity: 1, channel: null, ...x });
  const flow = D.plateFlow([t(5, { quantity: 3 }), t(10, { madeAt: 'Bar', quantity: 2 }), t(20), t(40), t(70), t(5, { channel: 'drive-thru' }), t(5, { status: 'cancelled' }), t(5, { readyAt: null, deliveredAt: iso(3) })], 'Bar', now);
  const sum = flow.blocks.reduce((a, b) => a + b.plates + b.glasses, 0);
  check('heading your way: plates from the kitchen, glasses from the bar, by 15 minutes over the last hour; nothing for the drive-thru or cancelled', flow.blocks.length === 4 && sum === 8 && flow.lastHalf.plates === 5 && flow.lastHalf.glasses === 2, flow);
  check('tonight’s rush in words', D.rushWords([{ hour: 17, guests: 10 }, { hour: 18, guests: 30 }, { hour: 19, guests: 40 }, { hour: 20, guests: 36 }, { hour: 21, guests: 10 }]) === '6 to 9 pm'
    && D.rushWords([{ hour: 11, guests: 30 }, { hour: 12, guests: 40 }, { hour: 13, guests: 35 }]) === '11 am to 2 pm' && D.rushWords([{ hour: 22, guests: 20 }, { hour: 23, guests: 20 }]) === '10 pm to midnight' && D.rushWords([]) === null);
  check('breakage: what, how many, in words', 'error' in D.cleanBreak({ kind: 'cup', count: 1 }) && 'error' in D.cleanBreak({ kind: 'glass', count: 0 }) && 'error' in D.cleanBreak({ kind: 'other', count: 1 })
    && D.brokenWords([{ kind: 'glass', count: 2 }, { kind: 'plate', count: 1 }, { kind: 'glass', count: 1 }]) === '3 glasses and a plate');

  console.log('through the server');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/back/route');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', userId: 'owner1', kitchenSettings: { stations: ['Kitchen', 'Bar'] },
    closingSettings: { items: [{ id: 'walkin', label: 'Walk-in fridge', kind: 'temp', area: 'kitchen', maxF: 41 }, { id: 'dishmachine', label: 'Dish machine drained, traps cleaned', kind: 'check', area: 'dish' }, { id: 'floors', label: 'Floors and mats', kind: 'check', area: 'anyone' }] } });
  await db.doc(`${T}/staff/s9`).set({ name: 'Sam Lee', role: 'staff', pin: '4821' });
  await db.doc(`${T}/staff/s7`).set({ name: 'Rosa Diaz', role: 'staff', pin: '7777' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  const kKey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kitchen', kind: 'kitchen' }))).body.key;
  const dKey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Dish', kind: 'kitchen' }))).body.key;
  const dtKey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  manager = false; signedIn = false;
  const sam = (await kitchen(req({ action: 'pin', tenantId: 't1', key: dKey, pin: '4821' }))).body.pass;
  const rosa = (await kitchen(req({ action: 'pin', tenantId: 't1', key: dKey, pin: '7777' }))).body.pass;
  const K = async (b: any) => { const r: any = await POST(req({ tenantId: 't1', key: kKey, ...b })); return { status: r.status, ...r.body }; };
  const Dsh = async (b: any, pass?: string) => { const r: any = await POST(req({ tenantId: 't1', key: dKey, ...(pass ? { staffPass: pass } : {}), ...b })); return { status: r.status, ...r.body }; };

  check('a drive-thru lane’s key, a wrong key, or nobody signed in: refused', (await POST(req({ tenantId: 't1', key: dtKey, action: 'dish' }))).status === 401 && (await POST(req({ tenantId: 't1', key: 'x'.repeat(40), action: 'dish' }))).status === 401 && (await POST(req({ tenantId: 't1', action: 'dish' }))).status === 401);

  let r: any = await K({ action: 'call', to: 'dish', what: 'plates', station: 'Kitchen' });
  check('the kitchen calls for plates', r.ok && !r.already && r.call.status === 'open' && r.call.from === 'Kitchen', r);
  const plates = r.call.id;
  check('…asked again while it’s going: the same call', (await K({ action: 'call', to: 'dish', what: 'plates', station: 'Kitchen' })).already === true && (await list(`${T}/backCalls`, 'what', 'plates')).length === 1);
  check('…a bottle without saying which is refused', (await K({ action: 'call', to: 'barback', what: 'bottle' })).status === 400);
  await K({ action: 'call', to: 'barback', what: 'ice', note: 'well 2', station: 'Bar' });

  // A night under way: plates and drinks out, a table being cleared, a guest in.
  for (const [i, x] of [[1, { madeAt: 'Kitchen', quantity: 4, readyAt: iso(6) }], [2, { madeAt: 'Bar', quantity: 3, readyAt: iso(8) }], [3, { madeAt: 'Kitchen', quantity: 2, readyAt: iso(50) }]] as [number, any][])
    await db.doc(`${T}/kdsTickets/k${i}`).set({ id: `k${i}`, status: 'served', itemName: 'Dish', createdAt: iso(70), ...x });
  r = await Dsh({ action: 'dish' }, sam);
  check('the dish screen: the kitchen’s call (not the barback’s), plates and glasses heading its way, the machine check due', r.ok && r.calls.length === 1 && r.calls[0].words === 'Plates' && r.staff?.name === 'Sam Lee'
    && r.dish.flow.lastHalf.plates === 4 && r.dish.flow.lastHalf.glasses === 3 && r.dish.machine.due === true && r.dish.machine.limit === '180°F or hotter', { calls: r.calls, flow: r.dish?.flow, machine: r.dish?.machine });

  r = await Dsh({ action: 'callStep', id: plates, step: 'coming' }, sam);
  check('“On my way”, under the name of whoever’s working', r.ok && r.call.status === 'coming' && r.call.takenBy === 'Sam Lee');
  r = await Dsh({ action: 'callStep', id: plates, step: 'coming' }, rosa);
  check('…someone else taps it too: told who’s already going, nothing changes', r.ok && r.already && r.call.takenBy === 'Sam Lee');
  check('…only Sam can let it go', (await Dsh({ action: 'callStep', id: plates, step: 'release' }, rosa)).status === 409);
  check('…and it can’t be cancelled once someone’s on the way', (await K({ action: 'callStep', id: plates, step: 'cancel' })).status === 409);
  r = await K({ action: 'calls' });
  check('the kitchen sees who’s coming', r.ok && r.mine.some((c: any) => c.id === plates && C.callState(c) === 'Sam’s on the way'), r.mine);
  r = await Dsh({ action: 'callStep', id: plates, step: 'done' }, sam);
  check('“Done”, once', r.ok && r.call.status === 'done' && r.call.doneBy === 'Sam Lee' && (await Dsh({ action: 'callStep', id: plates, step: 'done' }, sam)).already === true);
  check('…the kitchen sees it was done', (await K({ action: 'calls' })).mine.some((c: any) => c.id === plates && c.status === 'done'));
  await db.doc(`${T}/backCalls/${plates}`).set({ doneAt: iso(9) }, { merge: true });
  check('…and a few minutes later it’s gone from the kitchen’s strip', !(await K({ action: 'calls' })).mine.some((c: any) => c.id === plates));

  console.log('a call nobody takes');
  const late = (await K({ action: 'call', to: 'dish', what: 'pans', station: 'Kitchen' })).call.id;
  await db.doc(`${T}/backCalls/${late}`).set({ at: iso(7) }, { merge: true });
  const B = await import('../../src/lib/back-calls-server');
  const tenant = await get(T);
  const n1 = await B.tellLate(db, 't1', tenant, await B.readCalls(db, T));
  const n2 = await B.tellLate(db, 't1', tenant, await B.readCalls(db, T));
  const told = await list(`${T}/notifications`, 'type', 'back_call_waiting');
  check('after 5 minutes the owner and managers hear, once, each addressed to them', n1 === 1 && n2 === 0 && told.length === 2 && told.some((x: any) => x.userId === 'owner1') && told.some((x: any) => x.userId === 'm1')
    && /Kitchen asked the dish pit for pans to the line 7 minutes ago/.test(told[0].message), told);
  check('…only the station that asked can cancel it', (await Dsh({ action: 'callStep', id: late, step: 'cancel' }, sam)).status === 403 && (await K({ action: 'callStep', id: late, step: 'cancel' })).call.status === 'cancelled');
  await db.doc(`${T}/backCalls/old1`).set({ id: 'old1', to: 'dish', what: 'plates', from: 'Kitchen', fromId: 'x', status: 'open', at: iso(3 * 24 * 60) });
  check('calls from before yesterday are cleared away', (await B.sweepOld(db, T)) === 1 && !(await get(`${T}/backCalls/old1`)));

  console.log('the machine check');
  r = await Dsh({ action: 'machine', value: '182' }, sam);
  check('a good reading: kept with who and when; not due again for 4 hours', r.ok && r.check.ok && r.check.by === 'Sam Lee' && (await Dsh({ action: 'dish' })).dish.machine.due === false);
  r = await Dsh({ action: 'machine', value: '164' }, sam);
  check('outside the limits: asks what was done', r.status === 422 && /what you did/.test(r.error));
  r = await Dsh({ action: 'machine', value: '164', note: 'Ran it again, called for service' }, sam);
  const out = await list(`${T}/notifications`, 'type', 'dish_machine_out');
  check('…kept, flagged, the owner and managers told at once, and due again', r.ok && !r.check.ok && out.length === 2 && /final rinse 164°F, outside 180°F or hotter \(Sam Lee\)/.test(out[0].message) && (await Dsh({ action: 'dish' })).dish.machine.due === true, out[0]);
  check('nonsense isn’t a reading', (await Dsh({ action: 'machine', value: 'hot' }, sam)).status === 400);
  const noPin = await Dsh({ action: 'machine', value: '182' });
  check('on a shared tablet a reading needs a PIN, so the log names a person', noPin.status === 409 && noPin.code === 'pin');
  r = await Dsh({ action: 'machineLog' });
  check('the log for an inspector: every reading, with its limit', r.ok && r.log.length === 2 && r.log.every((x: any) => x.limit === '180°F or hotter'));
  signedIn = true; manager = false;
  check('only a manager changes the machine settings', (await POST(req({ tenantId: 't1', action: 'settings', dish: { machine: 'chemical', minF: 180, ppmMin: 50, ppmMax: 100, everyHours: 2 } }))).status === 403);
  manager = true;
  r = await POST(req({ tenantId: 't1', action: 'settings', dish: { machine: 'chemical', minF: 180, ppmMin: 50, ppmMax: 100, everyHours: 2 } }));
  check('…a chemical machine, 50 to 100 ppm, every 2 hours', r.status === 200 && (await get(T)).dishSettings.machine === 'chemical' && (await Dsh({ action: 'dish' })).dish.machine.limit === '50 to 100 ppm');
  check('…nonsense refused', (await POST(req({ tenantId: 't1', action: 'settings', dish: { machine: 'chemical', minF: 180, ppmMin: 100, ppmMax: 50, everyHours: 2 } }))).status === 400);
  manager = false; signedIn = false;

  console.log('breakage and closing');
  await Dsh({ action: 'broke', kind: 'glass', count: 3 }, sam); await Dsh({ action: 'broke', kind: 'plate', count: 1 }, rosa);
  r = await Dsh({ action: 'dish' });
  check('breakage, with who', r.dish.broken.length === 2 && D.brokenWords(r.dish.broken) === '3 glasses and a plate' && r.dish.broken[1].by === 'Rosa Diaz' && (await Dsh({ action: 'broke', kind: 'glass', count: 99 })).status === 400);
  r = await Dsh({ action: 'closing', area: 'dish' });
  check('closing on the dish screen: the dish pit’s items and anyone’s, not the kitchen’s', r.ok && r.items.some((i: any) => i.id === 'dishmachine') && r.items.some((i: any) => i.area === 'anyone') && !r.items.some((i: any) => i.area === 'kitchen'));
  check('…ticked under the name of whoever’s working; a kitchen item isn’t done from here', (await Dsh({ action: 'closingCheck', area: 'dish', itemId: 'dishmachine', done: true }, sam)).ok && (await Dsh({ action: 'closingCheck', area: 'dish', itemId: 'walkin', value: 38 }, sam)).status === 403);

  console.log('the barback, the rules');
  const BB = await import('../../src/lib/barback');
  const MS = await import('../../src/lib/menu-stock'); const TS = await import('../../src/lib/table-service');
  const menuRows = [
    { id: 'ipaDrink', data: { type: 'refreshment', name: 'Hazy IPA', section: 'Drinks', formula: [{ id: 'ipa', name: 'Hazy IPA keg', quantityUsed: 16, unit: 'oz' }] } },
    { id: 'vsoda', data: { type: 'refreshment', name: 'Vodka soda', section: 'Cocktails', formula: [{ id: 'vodka', name: 'House vodka', quantityUsed: 45, unit: 'ml' }, { id: 'lime', name: 'Lime juice', quantityUsed: 15, unit: 'ml' }] } },
    { id: 'burger', data: { type: 'refreshment', name: 'Burger', section: 'Mains', formula: [{ id: 'bun', name: 'Bun', quantityUsed: 1, unit: 'each' }] } },
  ];
  const ingr: Record<string, any> = {
    ipa: { name: 'Hazy IPA keg', costingMethod: 'size', size: 1984, unit: 'oz', partialContainerSize: 96, totalStock: 2 },
    vodka: { name: 'House vodka', costingMethod: 'size', size: 1000, unit: 'ml', partialContainerSize: 400, totalStock: 4 },
    lime: { name: 'Lime juice', costingMethod: 'size', size: 1000, unit: 'ml', partialContainerSize: 120, totalStock: 0 },
    bun: { name: 'Bun', totalStock: 40 },
  };
  const stations = ['Kitchen', 'Bar'];
  const bp = BB.barParts(menuRows, new Map(Object.entries(ingr)), (it) => TS.stationOfItem(it, stations), 'Bar', MS.recipeOf);
  check('what the bar pours from: the bar’s drinks’ kegs and bottles, never the kitchen’s', bp.map((p) => p.id).join() === 'ipa,vodka,lime' || bp.map((p) => p.name).join() === 'Hazy IPA keg,House vodka,Lime juice', bp);
  check('a keg by its name, a bottle by its size; the usual pour from the recipes', bp.find((p) => p.id === 'ipa')?.kind === 'keg' && bp.find((p) => p.id === 'vodka')?.kind === 'bottle' && bp.find((p) => p.id === 'ipa')?.pour === 16);
  for (const p of bp) p.usedLastHour = ({ ipa: 320, vodka: 450, lime: 600 } as any)[p.id];
  const low = BB.runningLow(bp);
  check('running low: the last of the lime (none in stock) first, then the keg to change; the vodka’s fine', low.map((p) => `${p.id}:${p.state}`).join() === 'lime:last,ipa:change', low.map((p) => [p.id, p.state, p.poursLeft, p.minutesLeft]));
  check('in words: pints left on tap, the pace, what’s in stock', BB.lowWords(low[1]) === 'About 6 pints in the one on tap. At tonight’s pace, 18 minutes. 2 full in stock.' && /None in stock\.$/.test(BB.lowWords(low[0])), [BB.lowWords(low[1]), BB.lowWords(low[0])]);
  const ipaP = bp.find((p) => p.id === 'ipa')!;
  check('changed with a little left by the count: logged as pour loss; with a lot: nothing; with none: nothing', BB.changeOutcome(ipaP).loss === 96 && /about 6 pints: that’s logged as pour loss/.test(BB.changeOutcome(ipaP).words)
    && BB.changeOutcome({ ...ipaP, open: 1500 }).loss === 0 && BB.changeOutcome({ ...ipaP, open: 0 }).loss === 0);

  console.log('the barback, through the server');
  // Another business, so its tickets and menu are read fresh (the screens share reads for a few seconds).
  const T2 = 'tenants/t2';
  await db.doc(T2).set({ name: 'South Bar', timezone: 'UTC', userId: 'owner2', kitchenSettings: { stations: ['Kitchen', 'Bar'] } });
  await db.doc(`${T2}/staff/s3`).set({ name: 'Lee Park', role: 'staff', pin: '5150' });
  await db.doc(`${T2}/staff/m2`).set({ name: 'Mo Diaz', role: 'manager' });
  const gimlet = { id: 'gimlet', data: { type: 'refreshment', name: 'Gimlet', section: 'Cocktails', formula: [{ id: 'lime', name: 'Lime juice', quantityUsed: 30, unit: 'ml' }] } };
  for (const m of [...menuRows, gimlet]) await db.doc(`${T2}/inventory/${m.id}`).set({ id: m.id, ...m.data });
  for (const [id, x] of Object.entries(ingr)) await db.doc(`${T2}/inventory/${id}`).set({ id, ...x });
  // The last hour at the bar: 20 IPAs and 10 vodka sodas from tables, 15 gimlets from the lounge (no station on the
  // ticket: worked out from the menu), a burger from the kitchen, and a gimlet from yesterday.
  await db.doc(`${T2}/kdsTickets/b1`).set({ id: 'b1', status: 'served', itemId: 'ipaDrink', itemName: 'Hazy IPA', quantity: 20, madeAt: 'Bar', createdAt: iso(30), readyAt: iso(10) });
  await db.doc(`${T2}/kdsTickets/b2`).set({ id: 'b2', status: 'served', itemId: 'vsoda', itemName: 'Vodka soda', quantity: 10, madeAt: 'Bar', createdAt: iso(30), readyAt: iso(20) });
  await db.doc(`${T2}/kdsTickets/b3`).set({ id: 'b3', status: 'served', itemId: 'burger', itemName: 'Burger', quantity: 4, madeAt: 'Kitchen', createdAt: iso(30), readyAt: iso(20) });
  await db.doc(`${T2}/refreshmentRequests/l1`).set({ id: 'l1', status: 'delivered', itemId: 'gimlet', itemName: 'Gimlet', quantity: 15, requestedAt: iso(30), readyAt: iso(15) });
  await db.doc(`${T2}/refreshmentRequests/l2`).set({ id: 'l2', status: 'delivered', itemId: 'gimlet', itemName: 'Gimlet', quantity: 9, requestedAt: iso(26 * 60), readyAt: iso(26 * 60) });
  manager = true; signedIn = true;
  const bKey = (await kitchen(req({ action: 'pair', tenantId: 't2', name: 'Bar tablet', kind: 'kitchen' }))).body.key;
  manager = false; signedIn = false;
  const lee = (await kitchen(req({ action: 'pin', tenantId: 't2', key: bKey, pin: '5150' }))).body.pass;
  const Bb = async (b: any, pass?: string) => { const r: any = await POST(req({ tenantId: 't2', key: bKey, ...(pass ? { staffPass: pass } : {}), ...b })); return { status: r.status, ...r.body }; };
  await Bb({ action: 'call', to: 'barback', what: 'ice', note: 'well 2', station: 'Bar' }, lee);
  r = await Bb({ action: 'barback' }, lee);
  check('the barback’s screen: the bar’s call for ice, what’s running low (pace from the bar’s own tickets, the lounge’s too), the drinks made in the last hour', r.ok && r.calls.length === 1 && r.calls[0].words === 'Ice, well 2' && r.bar.bar === 'Bar'
    && r.bar.low.map((p: any) => p.id).join() === 'lime,ipa' && r.bar.fine === 1 && r.bar.all.length === 3 && r.bar.drinksLastHour === 45 && r.bar.paceKnown
    && /18 minutes/.test(r.bar.low[1].words) && /12 minutes/.test(r.bar.low[0].words), r.bar);
  check('…another business’s screen sees none of it', !(await Dsh({ action: 'dish' }, sam)).calls.some((c: any) => c.words === 'Ice, well 2'));
  await Bb({ action: 'barback' }, lee);
  const outN = await list(`${T2}/notifications`, 'type', 'bar_running_out');
  check('the last of the lime: the owner and managers hear, once', outN.length === 2 && /last of Lime juice/.test(outN[0].message) && outN.some((x: any) => x.userId === 'owner2'));
  const noPinBar = await Bb({ action: 'changed', itemId: 'ipa' });
  check('“Changed it” moves stock, so on a shared tablet it needs a PIN', noPinBar.status === 409 && noPinBar.code === 'pin');
  r = await Bb({ action: 'changed', itemId: 'ipa' }, lee);
  let ipaNow = await get(`${T2}/inventory/ipa`); const spoiled = (await list(`${T2}/stockCorrections`, 'productId', 'ipa')).filter((x: any) => x.type === 'spoiled');
  check('“Changed it”: what the count still had is pour loss, off the open keg and on the stock history, with who', r.ok && r.loss === 96 && ipaNow.partialContainerSize === 0 && ipaNow.totalStock === 2 && spoiled.length === 1 && spoiled[0].change === -96 && /Lee Park/.test(spoiled[0].reason), { r, ipaNow, spoiled });
  const changeId = r.id;
  check('…tapped twice, changed once', (await Bb({ action: 'changed', itemId: 'ipa' }, lee)).already === true && (await list(`${T2}/stockCorrections`, 'productId', 'ipa')).filter((x: any) => x.type === 'spoiled').length === 1 && (await list(`${T2}/barChanges`, 'itemId', 'ipa')).length === 1);
  r = await Bb({ action: 'undoChange', id: changeId }, lee);
  ipaNow = await get(`${T2}/inventory/ipa`); const back = (await list(`${T2}/stockCorrections`, 'productId', 'ipa')).filter((x: any) => x.type === 'returned');
  const counted = (await list(`${T2}/stockCorrections`, 'productId', 'ipa')).filter((x: any) => x.type === 'counted');
  check('…tapped by mistake: Undo puts it back as it was, on the stock history as put back (never as a count nobody did)', r.ok && /back as it was/.test(r.words) && ipaNow.partialContainerSize === 96 && ipaNow.totalStock === 2 && back.length === 1 && back[0].change === 96 && counted.length === 0, { r, ipaNow });
  check('…once', (await Bb({ action: 'undoChange', id: changeId }, lee)).words === 'Already undone.' && (await Bb({ action: 'changed', itemId: 'ipa' }, lee)).already === false);
  await db.doc(`${T2}/inventory/vodka`).set({ partialContainerSize: 900 }, { merge: true });
  r = await Bb({ action: 'changed', itemId: 'vodka' }, lee);
  check('…a lot left by the count: nothing logged, the count settles it', r.ok && r.loss === 0 && (await get(`${T2}/inventory/vodka`)).partialContainerSize === 900 && /too much to be pour loss/.test(r.words));
  check('…not something the bar pours from: refused', (await Bb({ action: 'changed', itemId: 'bun' }, lee)).status === 404);
  r = await Bb({ action: 'closing', area: 'bar' });
  check('closing on the barback’s screen: the bar’s items and anyone’s', r.ok && !r.items.some((i: any) => i.area === 'kitchen' || i.area === 'dish'));

  console.log('signed in on a phone');
  signedIn = true; actor.uid = 's9'; actor.name = 'Sam Lee'; actor.role = 'staff'; actor.isManager = false;
  r = await POST(req({ tenantId: 't1', action: 'dish' }));
  check('a team member on their own phone, as themselves', r.status === 200 && r.body.signedIn && r.body.staff?.name === 'Sam Lee');

  console.log('the pages');
  const rules = src('firestore.rules');
  check('the new records are server only: no browser reads or writes them', ['backCalls', 'machineChecks', 'breakage', 'barAlerts', 'barChanges', 'barLast'].every((c) => rules.includes(`'${c}'`)));
  const bpage = src('src/app/barback/[tenantId]/page.tsx');
  check('the barback screen: asked for, running low at the bar, changed it, call dish, the bar’s closing', bpage.includes('Running low at the bar') && bpage.includes('Changed it') && bpage.includes('Undo') && bpage.includes('only="dish"') && bpage.includes("area: 'bar'") && bpage.includes('<CallList'));
  const page = src('src/app/dish/[tenantId]/page.tsx'); const kds = src('src/app/kds/[tenantId]/page.tsx'); const sheet = src('src/components/kitchen/CallSheet.tsx'); const kit = src('src/components/back/screen-kit.tsx');
  const settings = src('src/app/(app)/settings/closing/page.tsx'); const kroute = src('src/app/api/kitchen/route.ts');
  check('the dish screen: asked for, heading your way, the machine check, breakage, closing; through the server only', page.includes('Asked for') && page.includes('Heading your way') && page.includes('MachineCard') && page.includes('Broke something') && page.includes("area: 'dish'") && !/from 'firebase\/firestore'/.test(page + kit));
  check('the kitchen screen calls the dish pit and the barback, and shows who’s coming', kds.includes('<CallSheet') && kds.includes('<CallStrip') && kds.includes("action: 'calls'") && sheet.includes('A few words on what you need.'));
  check('the kitchen screen can tick the dish pit’s closing items too; the machine check is set with closing', kroute.includes("['kitchen', 'bar', 'dish', 'anyone']") && settings.includes('Dish machine check'));
  const mineSrc = page + bpage + sheet + kit + src('src/components/back/CallList.tsx') + src('src/lib/barback.ts') + src('src/lib/barback-server.ts') + src('src/lib/back-calls.ts') + src('src/lib/dish.ts') + src('src/lib/dish-server.ts') + src('src/lib/back-calls-server.ts') + src('src/app/api/back/route.ts') + src('src/lib/tell-managers.ts');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mineSrc) && !/uppercase|font-black/.test(mineSrc) && !/ · /.test(mineSrc) && !/\{\/\*/.test(page + bpage + sheet + kit) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(page + bpage + sheet + kit));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
