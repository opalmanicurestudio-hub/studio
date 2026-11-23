// Checks item stickers on food orders (design board "A sticker on each item, scanned into the bag", A: drinks first;
// lib/item-stickers, lib/item-stickers-server, lib/printing-server, lib/food-bags-server, api/counter, api/curbside,
// the scan sheet, Settings → Printers):
// - the rules: whose sticker it is, which orders scan theirs (to go, not for here), what a sticker says, codes that can't
//   be made up, what's kept once an item is taken off
// - a printer set to print item stickers prints one for each item made at its stations as the order comes in (two
//   lattes, two stickers), once only; an Epson's carry a code, a Star's are words only; the kitchen's tickets keep
//   their station, so the bar's printer prints the bar's
// - the handover waits until each sticker is scanned, with the bags; another order's sticker says whose; printed again,
//   the old one stops scanning; a manager's PIN lets it go, with why
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/item-stickers.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm9', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (f: any) => { void Promise.resolve().then(f); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: (await db.doc('tenants/t1').get()).data() }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, _t: any, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const qrOf = (j: any) => j.doc.blocks.find((b: any) => b.k === 'qr')?.data || null;

(async () => {
  const S = await import('../../src/lib/item-stickers');
  const Q = await import('../../src/lib/order-qr');
  const P = await import('../../src/lib/printing');

  console.log('the rules');
  const o = (x: any = {}) => ({ status: 'sent', channel: 'drive-thru', stickers: { list: [{ k: 't1.1', name: 'Large oat latte', v: 1, c: true }, { k: 't1.2', name: 'Large oat latte', v: 1, c: true }, { k: 't2.1', name: 'Iced tea', v: 1, c: false }], scanned: ['t1.2', 'zz.9'] }, ...x });
  check('an order’s stickers as kept: one scanned (a key that isn’t one is dropped)', S.stickersOf(o())!.list.length === 3 && S.stickersOf(o())!.scanned.join() === 't1.2' && S.stickersOf({}) === null);
  check('left to scan before a to-go order goes: only those with a code, not yet scanned', S.stickersLeft(o(), {}).map((x) => x.k).join() === 't1.1');
  check('…none for an order for here, with the scan turned off, or let go by a manager', S.stickersLeft(o({ channel: 'counter', toGo: false }), {}).length === 0 && S.stickersLeft(o(), { bagCheck: { off: true } }).length === 0 && S.stickersLeft(o({ bags: { skipped: { by: 'Ana', at: 'x' } } }), {}).length === 0);
  check('…to go at the counter or the kiosk, ordered ahead, or a delivery app’s: scanned', S.stickersLeft(o({ channel: 'counter', toGo: true }), {}).length === 1 && S.stickersLeft(o({ channel: 'kiosk', toGo: true }), {}).length === 1 && S.stickersLeft(o({ channel: 'ahead' }), {}).length === 1 && S.stickersLeft(o({ channel: 'counter', app: { code: '4F2A' } }), {}).length === 1);
  check('the scan sheet’s ticks: each sticker with a code, done or not', JSON.stringify(S.stickersToScan(o(), {})) === JSON.stringify([{ k: 't1.1', name: 'Large oat latte', done: false }, { k: 't1.2', name: 'Large oat latte', done: true }]));
  check('…handed over unscanned: how many (whatever the scan setting)', S.stickersUnscanned(o()) === 1 && S.stickersUnscanned(o({ channel: 'counter' })) === 0);
  const after = S.stickersAfter(o(), [{ id: 't1', quantity: 1, cancelled: false }, { id: 't2', quantity: 0, cancelled: true }])!;
  check('an item taken off takes its stickers; one for fewer keeps the first ones (and what was scanned of them)', after.list.map((x) => x.k).join() === 't1.1' && after.scanned.length === 0);
  const lab = S.stickerOf({ number: 'D14', guestName: 'Lucia Ortiz' }, { item: 'Oat latte', choiceList: ['Large', 'Extra shot'], note: 'Extra hot' }, ['Allergy: tree nuts, severe'], 1, 2, 'clarityflow://item/o1.t1.1.1.0123456789abcdef');
  const d = S.stickerDoc(lab);
  check('a sticker: the number and first name, the item, its choices and note, the allergy set off, “1 of 2”, the code', d.blocks[0].k === 'head' && (d.blocks[0] as any).left === 'D14' && (d.blocks[1] as any).text === 'Lucia' && d.blocks.some((b: any) => b.k === 'text' && b.bold && b.text === 'Oat latte')
    && d.blocks.some((b: any) => b.text === 'Large, Extra shot') && d.blocks.some((b: any) => b.text === 'Note: Extra hot') && d.blocks.some((b: any) => b.k === 'alert' && /tree nuts/.test(b.text)) && d.blocks.some((b: any) => b.text === '1 of 2') && d.blocks.some((b: any) => b.k === 'qr'));
  check('…words only without a code', !S.stickerDoc({ ...lab, code: null }).blocks.some((b: any) => b.k === 'qr'));
  const code = Q.makeItemCode('t1', 'o1', 'tk1.2', 3);
  check('a sticker’s code: this business, order, item and print, and nothing else', JSON.stringify(Q.checkItemCode('t1', 'o1', code)) === JSON.stringify({ k: 'tk1.2', v: 3 }) && Q.checkItemCode('t2', 'o1', code) === null && Q.checkItemCode('t1', 'o2', code) === null
    && Q.checkItemCode('t1', 'o1', code.replace('.3.', '.4.')) === null && JSON.stringify(S.parseItemCode(code)) === JSON.stringify({ orderId: 'o1', k: 'tk1.2', v: 3 }) && S.parseItemCode(Q.makeBagCode('t1', 'o1', 1)) === null);
  check('a printer can print item stickers, said with its stations', P.cleanPrinter({ stickers: true }).stickers === true && P.cleanPrinter({}).stickers === false && P.printsWords(P.cleanPrinter({ stations: ['Bar'], stickers: true, tickets: false })) === 'Bar item stickers');

  console.log('printed as the order comes in');
  await db.doc(T).set({ name: 'Juniper Coffee', timezone: 'UTC', ownerId: 'own1', kitchenSettings: { stations: ['Kitchen', 'Bar'] }, orderAhead: { on: true, curbside: true } });
  await db.doc(`${T}/staff/m9`).set({ name: 'Ana Ruiz', role: 'manager', pin: '4821' });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Coffee', price: 5.5, totalStock: 80, station: 'Bar' });
  await db.doc(`${T}/inventory/tea`).set({ type: 'refreshment', name: 'Iced tea', category: 'Drinks', price: 3, totalStock: 80, station: 'Bar' });
  await db.doc(`${T}/inventory/biscuit`).set({ type: 'refreshment', name: 'Egg biscuit', category: 'Breakfast', price: 4, totalStock: 80, station: 'Kitchen' });
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: printersApi } = await import('../../src/app/api/printers/route');
  const { POST: curbApi } = await import('../../src/app/api/curbside/route');
  const PS = await import('../../src/lib/printing-server');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Lane', kind: 'drive-thru' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  let r: any = await printersApi(req({ tenantId: 't1', action: 'save', name: 'Bar stickers', kind: 'epson', stations: ['Bar'], stickers: true, tickets: false }));
  const bar = r.body.id;
  r = await printersApi(req({ tenantId: 't1', action: 'list' }));
  check('Settings, Printers: a printer set to print the bar’s item stickers', (await get(`${T}/printers/${bar}`)).stickers === true && r.body.printers?.[0]?.stickers === true && r.body.printers[0].prints === 'Bar item stickers', r.body.printers?.[0]);
  await db.doc(`${T}/printers/${bar}`).set({ addedAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  PS.forgetPrinter(T, bar);
  actor = { uid: 's1', name: 'Kai Park', role: 'staff', isManager: false, caps: [] };
  const carWith = async (k: string) => {
    const c = (await L({ action: 'car', carKey: k })).body;
    await L({ action: 'add', orderId: c.orderId, itemId: 'latte', quantity: 2, tapKey: `${k}-a` });
    await L({ action: 'add', orderId: c.orderId, itemId: 'biscuit', quantity: 1, tapKey: `${k}-b` });
    await L({ action: 'name', orderId: c.orderId, name: 'Lucia Ortiz' });
    await L({ action: 'send', orderId: c.orderId });
    await L({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 100 });
    return c;
  };
  const tenantNow = async () => (await get(T));
  const ask = async () => { PS.forgetPending(T); const p = await PS.printerOf(db, T, bar, { fresh: true }); return PS.nextJob(db, T, tenantNow, p!); };
  const c1 = await carWith('stk-1');
  const tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId);
  check('each ticket keeps its station as it’s sent (the bar’s latte, the kitchen’s biscuit)', tix.find((t: any) => t.menuItemId === 'latte')?.madeAt === 'Bar' && tix.find((t: any) => t.menuItemId === 'biscuit')?.madeAt === 'Kitchen', tix.map((t: any) => [t.menuItemId, t.madeAt]));
  await ask();
  let jobs = (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'sticker' && j.orderId === c1.orderId);
  let o1: any = await get(`${T}/counterOrders/${c1.orderId}`);
  check('the bar’s printer: a sticker for each latte (two), none for the biscuit, each with its own code', jobs.length === 2 && jobs.every((j: any) => j.printerId === bar && !!qrOf(j)) && qrOf(jobs[0]) !== qrOf(jobs[1]) && o1.stickers?.list?.length === 2 && o1.stickers.list.every((x: any) => x.c === true && x.v === 1 && /Oat latte/.test(x.name)), { jobs: jobs.length, st: o1.stickers });
  check('…two of the same item numbered, with the guest’s first name (one alone isn’t)', jobs.map((j: any) => j.doc.blocks.find((b: any) => /of 2$/.test(String(b.text || '')))?.text).sort().join() === '1 of 2,2 of 2' && jobs.every((j: any) => j.doc.blocks[1].text === 'Lucia' && j.doc.blocks[0].mark === 'J' && j.doc.qrBeside === true)
    && !S.stickerDoc({ ...lab, n: 1, of: 1 }).blocks.some((b: any) => /of 1$/.test(String(b.text || ''))));
  await ask();
  check('…once only (the tickets are marked as stickered)', (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'sticker' && j.orderId === c1.orderId).length === 2 && (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId && t.menuItemId === 'latte').every((t: any) => t.sticker?.printer === bar));

  console.log('scanned before it goes');
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('the handover waits on the stickers, by name', r.status === 409 && r.body.code === 'bags' && r.body.bags?.[0]?.items?.length === 2 && r.body.bags[0].items.every((i: any) => !i.done) && /^For \w+, scan 2 item stickers first\.$/.test(r.body.error), r.body);
  r = await L({ action: 'lane' });
  check('…and the lane says how many are left', JSON.stringify(r.body.orders?.[c1.orderId]?.stickers) === JSON.stringify({ of: 2, left: 2 }), r.body.orders?.[c1.orderId]?.stickers);
  const c2 = await carWith('stk-2'); await ask();
  const j2 = (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'sticker' && j.orderId === c2.orderId);
  r = await L({ action: 'bagScan', carId: c1.carId, code: qrOf(j2[0]) });
  check('another order’s sticker says whose it is', r.status === 409 && /^Wrong item\. This one is \w+’s, for Lucia\.$/.test(r.body.error), r.body);
  r = await L({ action: 'bagScan', carId: c1.carId, code: qrOf(jobs[0]) });
  check('one scanned: kept, and one left', r.body.ok && r.body.k && r.body.itemsLeft?.length === 1 && /Oat latte/.test(r.body.name) && (await get(`${T}/counterOrders/${c1.orderId}`)).stickers.scanned.length === 1, r.body);
  r = await L({ action: 'bagScan', carId: c1.carId, code: qrOf(jobs[0]) });
  check('…the same one again changes nothing', r.body.ok && r.body.already === true && r.body.itemsLeft.length === 1);
  const second = jobs.find((j: any) => j.stickerKey !== S.parseItemCode(qrOf(jobs[0]))!.k);
  r = await L({ action: 'sticker', carId: c1.carId, orderId: c1.orderId, k: second.stickerKey });
  const again = (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'sticker' && j.stickerKey === second.stickerKey && j.orderId === c1.orderId);
  check('printed again (a remake): a new sticker on the same printer, the next print', r.body.ok && r.body.printer === 'Bar stickers' && again.length === 2 && S.parseItemCode(qrOf(again.find((j: any) => j.id !== second.id)))!.v === 2, r.body);
  r = await L({ action: 'bagScan', carId: c1.carId, code: qrOf(second) });
  check('…the old one no longer scans', r.status === 409 && /was replaced\. Scan the new one\./.test(r.body.error), r.body);
  r = await L({ action: 'bagScan', carId: c1.carId, code: qrOf(again.find((j: any) => j.id !== second.id)) });
  check('…the new one does: nothing left', r.body.ok && r.body.itemsLeft.length === 0, r.body);
  r = await L({ action: 'move', carId: c1.carId, to: 'gone' });
  check('every sticker scanned: handed over', r.body.ok && (await get(`${T}/counterOrders/${c1.orderId}`)).status === 'done', r.body);

  console.log('let go without, and for here');
  r = await L({ action: 'move', carId: c2.carId, to: 'gone', bagOverride: true, pin: '4821' });
  check('a skip without a reason is refused', r.status === 400 && /Say why/.test(r.body.error) && (await get(`${T}/counterOrders/${c2.orderId}`)).status === 'sent', r.body);
  r = await L({ action: 'move', carId: c2.carId, to: 'gone', bagOverride: true, pin: '4821', bagReason: 'printer' });
  const o2: any = await get(`${T}/counterOrders/${c2.orderId}`);
  check('a manager’s PIN lets it go, with why, kept on the order and on the record', r.body.ok && o2.status === 'done' && o2.bags?.skipped?.by === 'Ana Ruiz' && o2.bags.skipped.reason === 'The printer is down' && audits.some((a) => a.action === 'counter.bags_skipped' && /: the printer is down\.$/.test(a.summary)), { o2: o2.bags, a: audits.map((a) => a.summary) });
  // A counter order for here: its stickers print (the barista's ticket), and it's handed over without a scan.
  const CT = (b: any) => LANE(req({ tenantId: 't1', channel: 'counter', ...b })) as Promise<any>;
  const c3 = (await CT({ action: 'car', carKey: 'stk-3' })).body;
  await CT({ action: 'add', orderId: c3.orderId, itemId: 'latte', quantity: 1, tapKey: 'stk-3-a' });
  await CT({ action: 'send', orderId: c3.orderId }); await CT({ action: 'paid', orderId: c3.orderId, method: 'cash', tendered: 20 });
  await ask();
  const o3: any = await get(`${T}/counterOrders/${c3.orderId}`);
  r = await CT({ action: 'move', carId: c3.carId, to: 'gone' });
  check('an order for here: its sticker prints, and it’s handed across without a scan', o3.stickers?.list?.length === 1 && r.body.ok && o3.channel === 'counter' && o3.toGo !== true, { st: o3.stickers, r: r.body, ch: o3.channel, status: o3.status });
  // A Star at the bar prints words only: nothing to scan.
  await db.doc(`${T}/printers/${bar}`).set({ kind: 'star' }, { merge: true }); PS.forgetPrinter(T, bar);
  const c4 = await carWith('stk-4'); await ask();
  const o4: any = await get(`${T}/counterOrders/${c4.orderId}`); const j4 = (await all(`${T}/printJobs`)).filter((j: any) => j.kind === 'sticker' && j.orderId === c4.orderId);
  r = await L({ action: 'move', carId: c4.carId, to: 'gone' });
  check('a Star’s stickers: words only, and the order goes as before', j4.length === 2 && j4.every((j: any) => !qrOf(j)) && o4.stickers.list.every((x: any) => x.c === false) && r.body.ok, r.body);
  await db.doc(`${T}/printers/${bar}`).set({ kind: 'epson' }, { merge: true }); PS.forgetPrinter(T, bar);

  console.log('curbside');
  await db.doc(`${T}/counterOrders/cb1`).set({ id: 'cb1', number: 'A7', channel: 'ahead', status: 'sent', ahead: { way: 'curbside' }, guestName: 'Sam Lee', paidAt: new Date().toISOString(), lines: [],
    stickers: { list: [{ k: 'tkx.1', name: 'Iced tea', v: 1, c: true }], scanned: [] } });
  actor = { uid: 'm9', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  r = await curbApi(req({ tenantId: 't1', action: 'handed', orderId: 'cb1' }));
  check('curbside waits on the stickers too', r.status === 409 && r.body.code === 'bags' && r.body.bags?.[0]?.items?.[0]?.name === 'Iced tea', r.body);
  r = await curbApi(req({ tenantId: 't1', action: 'bagScan', orderId: 'cb1', code: Q.makeItemCode('t1', 'cb1', 'tkx.1', 1) }));
  check('…scanned there the same way', r.body.ok && r.body.itemsLeft?.length === 0, r.body);

  console.log('taken off, and the screens');
  const take = src('src/lib/counter-takeoff-server.ts');
  check('an item taken off takes its stickers with it (or keeps the first ones for fewer)', /stickersAfter\(o, tix\.map/.test(take) && /stickers: \{ list: stk\.list, scanned: stk\.scanned \}/.test(take));
  check('an order handed over with stickers unscanned (the exit sensor, the scan off) says how many', /stickersUnscanned\(o\)/.test(src('src/lib/counter-handover.ts')));
  const sheets = src('src/components/drive-thru/BagSheets.tsx'); const counter = src('src/app/(app)/counter/page.tsx'), lane = src('src/app/drive-thru/[tenantId]/page.tsx'), curb = src('src/components/orders/CurbsideScreen.tsx');
  check('the scan sheet ticks each sticker by name, hands over once everything’s scanned, and prints one again', /<Tick done=\{done\}>\{it\.name\}<\/Tick>/.test(sheets) && /setGood\('Everything scanned\. Handing it over\.'\); onDone\(\);/.test(sheets) && /aria-label=\{`Print again, \$\{it\.name\}`\}/.test(sheets));
  check('…a manager lets it go only with a reason picked', /role="group" aria-labelledby="bag-skip-why"/.test(sheets) && /aria-pressed=\{why === r\.id\}/.test(sheets) && /disabled=\{pin\.length !== 4 \|\| !why \|\| busy\}/.test(sheets) && [counter, lane, curb].every((s) => /bagReason: reason/.test(s) && /printItem=\{stickerAgain\}/.test(s) && /scanReplyOf\(/.test(s)));
  check('Settings, Printers says when a station’s tickets have no printer (each ticket now goes by its own station)', /function uncoveredOf\(list: P\[\], stations: string\[\]\)/.test(src('src/app/(app)/settings/printers/page.tsx')) && /\{uncoveredOf\(list, stations\) && <div role="note"/.test(src('src/app/(app)/settings/printers/page.tsx')));
  check('Settings, Printers: Prints item stickers, with its stations', /label="Prints item stickers"/.test(src('src/app/(app)/settings/printers/page.tsx')) && /\(edit\.tickets \|\| edit\.stickers\) && stations\.length > 0/.test(src('src/app/(app)/settings/printers/page.tsx')));
  for (const f of ['src/components/drive-thru/BagSheets.tsx', 'src/lib/item-stickers.ts', 'src/lib/item-stickers-server.ts']) check(`${f}: no comments in markup, no uppercase, no " · "`, !/\{\/\*/.test(src(f)) && !/\buppercase\b/.test(src(f)) && !/ · /.test(src(f)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
