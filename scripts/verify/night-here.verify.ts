// Checks each location's own night (design board "Sold out here or everywhere, each location's own night, and its own
// lane sensor", part 2; lib/night-close-server closeId / buildNightReport at / nightTills at / recordCheck at, api/close
// at, the kitchen and back screens' Closing sheets, lib/records-server monthNights, lib/food-safety-server monthSafety,
// api/checkout/complete and the desk's drawer).
// - With more than one location, each closes on its own: its night on its own clock, its own checklist, its own report
//   from its own sales, counter orders, tables, comps and drawers, emailed with its name.
// - The whole business's night is still there, with everything (sales from before there were locations too); tips are
//   shared out and approved with it.
// - Each front desk sale and drawer keeps where it was.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/night-here.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const boss: any = { uid: 'm1', name: 'Dana Fox', role: 'manager', isManager: true, caps: [] };
let actor: any = boss;
const sent: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: any) => (level === 'manager' && !actor.isManager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor }),
    requireCan: async () => ({ actor }), staffOrServer: async () => true,
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, x: any) => { sent.push(x); return { ok: true }; } });
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { brandFromTenant: (t: any) => ({ shopName: t?.name || 'Shop', brandColor: '#16171a' }), brandedEmail: (_b: any, html: string, o: any) => `<h1>${o?.title}</h1>${html}` });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const NS = await import('../../src/lib/night-close-server');
  const HS = await import('../../src/lib/here-server');
  const { POST: CLOSE } = await import('../../src/app/api/close/route');
  const { POST: KITCHEN } = await import('../../src/app/api/kitchen/route');

  // Two locations, Harbor Rd a day ahead on its own clock; a checklist of one fridge; tips shared by the day.
  await db.doc(T).set({ name: 'Northside', timezone: 'Etc/UTC', closingSettings: { items: [{ id: 'walkin', label: 'Walk-in', kind: 'temp', maxF: 41, area: 'kitchen' }], requireChecklist: true, approveTips: true },
    tipSharing: { mode: 'pool', period: 'day' } });
  await db.doc(`${T}/private/closing`).set({ reportTo: ['owner@northside.test'] });
  await db.doc(`${T}/staff/m1`).set({ name: 'Dana Fox', role: 'manager' });
  await db.doc(`${T}/locations/main`).set({ name: 'Main St', isActive: true, address: '1 Main St' });
  await db.doc(`${T}/locations/harbor`).set({ name: 'Harbor Rd', isActive: true, address: '88 Harbor Rd', timezone: 'Pacific/Kiritimati' });
  HS.forgetLocations('t1');
  const house = await get(T); const harborT = HS.zonedFor(house, { timezone: 'Pacific/Kiritimati' });
  const dayH = NS.tonight(harborT); const dayW = NS.tonight(house);
  const inNight = (t: any, day: string, h: number) => new Date(Date.parse(NS.nightBounds(t, day).start) + h * 3600000).toISOString();
  // (A time in one night and not the other, whatever the clock: the two nights overlap by some hours.)
  const BH = NS.nightBounds(harborT, dayH), BW = NS.nightBounds(house, dayW);
  const inside = (x: string, b: any) => x >= b.start && x < b.end;
  const only = (t: any, day: string, other: any) => { for (let h = 0.5; h < 24; h += 1) { const x = inNight(t, day, h); if (!inside(x, other)) return x; } return inNight(t, day, 1); };
  // Harbor Rd's night: a desk sale, a paid counter order, a table with a comp, an open drawer. Main St's and the
  // business's: a desk sale at Main St, one from before there were locations, a drawer closed.
  const aH = only(harborT, dayH, BW);
  await db.doc(`${T}/receipts/rH`).set({ date: aH, subtotal: 40, total: 44, tax: 4, tip: 0, paymentMethod: 'card', locationId: 'harbor' });
  await db.doc(`${T}/counterOrders/oH`).set({ paidAt: aH, subtotal: 10, total: 11, tax: 1, payMethod: 'card', status: 'done', locationId: 'harbor' });
  await db.doc(`${T}/appointments/vH`).set({ startTime: aH, isTable: true, partySize: 3, locationId: 'harbor' });
  // (A comp's day is the business's; one location's night reads them by when they were used. One on a table seated before
  // the night began counts where that table was.)
  await db.doc(`${T}/approvals/cH`).set({ kind: 'comp', used: true, usedAt: aH, day: '1999-01-01', amount: 6, reason: 'Took too long', askedBy: 'Jo', approverName: 'Dana', visitId: 'vH' });
  await db.doc(`${T}/appointments/vEarly`).set({ startTime: '2020-01-01T00:00:00.000Z', isTable: true, partySize: 2, locationId: 'harbor' });
  await db.doc(`${T}/approvals/cEarly`).set({ kind: 'void_item', used: true, usedAt: aH, day: '1999-01-01', amount: 9, reason: 'Rung in by mistake', askedBy: 'Jo', approverName: 'Jo', visitId: 'vEarly', started: false });
  await db.doc(`${T}/counterOrders/oX`).set({ paidAt: aH, subtotal: 7, total: 7.7, tax: 0.7, payMethod: 'card', status: 'done' });
  await db.doc(`${T}/tillSessions/tH`).set({ openedAt: aH, status: 'open', openedBy: 'Jo', openingFloat: 100, expectedCash: 100, locationId: 'harbor' });
  const aW = only(house, dayW, BH);
  await db.doc(`${T}/receipts/rM`).set({ date: aW, subtotal: 25, total: 27, tax: 2, tip: 3, paymentMethod: 'cash', locationId: 'main' });
  await db.doc(`${T}/receipts/rOld`).set({ date: aW, subtotal: 15, total: 16, tax: 1, tip: 0, paymentMethod: 'cash' });
  await db.doc(`${T}/tillSessions/tM`).set({ openedAt: aW, status: 'closed', closedAt: aW, openedBy: 'Ana', openingFloat: 100, expectedCash: 125, actualCash: 125, locationId: 'main' });
  const C = (b: any) => CLOSE(req({ tenantId: 't1', ...b })) as any;

  console.log('each location’s night');
  let r = await C({ action: 'state', at: 'harbor', tips: true });
  check('Harbor Rd’s night: on its own clock, its name, and the locations to pick from', r.body.ok && r.body.day === dayH && r.body.at === 'harbor' && r.body.place === 'Harbor Rd' && r.body.places.map((p: any) => p.name).sort().join(',') === 'Harbor Rd,Main St', r.body);
  const rep = r.body.report;
  check('…its report: its own desk sale and counter order, its table, its comp and void (by when they were used), and its drawer, nothing else', rep.sales.total === 50 && rep.sales.count === 2 && rep.guests.covers === 3 && rep.comps.total === 6 && rep.voids.total === 9 && rep.drawers.length === 1 && rep.drawers[0].openedBy === 'Jo' && rep.place === 'Harbor Rd', { total: rep.sales.total, n: rep.sales.count, comps: rep.comps.total, drawers: rep.drawers.length });
  check('…its tips are shared out on the whole business’s report', rep.tips.rows.length === 0);
  check('…and it says what was sold that night at no location, on the whole business’s report only', rep.unplaced?.count === 1 && rep.unplaced?.total === 7, rep.unplaced);
  check('…and its drawer still open holds it up', r.body.openTills === 1 && r.body.can.ok === false);
  r = await C({ action: 'state', at: 'main' });
  check('Main St’s night: its sale and its drawer only', r.body.ok && r.body.report.sales.total === 25 && r.body.report.drawers.length === 1 && r.body.openTills === 0, r.body.report?.sales);
  r = await C({ action: 'state' });
  check('the whole business: everything on its night, the sale from before there were locations too', r.body.ok && r.body.at === null && r.body.place === null && r.body.report.sales.total === 40 && r.body.report.place === null, r.body.report?.sales);
  r = await C({ action: 'state', at: 'nowhere' });
  check('…a location that isn’t one of the business’s: the whole business', r.body.ok && r.body.at === null);

  console.log('its own checklist');
  r = await C({ action: 'check', at: 'harbor', itemId: 'walkin', value: 45, note: 'Door left open, moved the dairy' });
  const cH = await get(`${T}/nightCloses/${dayH}_harbor`);
  check('a reading at Harbor Rd goes on its own night, not the business’s', r.body.ok && cH?.locationId === 'harbor' && cH?.checks?.walkin?.value === 45 && !(await get(`${T}/nightCloses/${dayH}`))?.checks?.walkin, cH);
  const KIT = (b: any) => KITCHEN(req({ tenantId: 't1', ...b })) as any;
  const keyM = (await KIT({ action: 'pair', name: 'Main pass', locationId: 'main' })).body.key;
  r = await KIT({ action: 'closing', key: keyM });
  check('the kitchen screen at Main St shows Main St’s checklist', r.body.ok && r.body.day === dayW && !r.body.checks?.walkin, r.body);
  r = await KIT({ action: 'closingCheck', key: keyM, itemId: 'walkin', value: 38 });
  check('…and ticks it there', r.body.ok && (await get(`${T}/nightCloses/${dayW}_main`))?.checks?.walkin?.value === 38 && (await get(`${T}/nightCloses/${dayW}_main`))?.locationId === 'main');

  console.log('closing it');
  r = await C({ action: 'close', at: 'gone' });
  check('a location that isn’t one any more is never closed as the whole business by mistake', r.status === 404 && !(await get(`${T}/nightCloses/${dayW}`))?.status, r.body);
  r = await C({ action: 'close', at: 'harbor' });
  check('Harbor Rd won’t close with its drawer open', r.status === 409 && /drawer/i.test(r.body.error), r.body);
  await db.doc(`${T}/tillSessions/tH`).update({ status: 'closed', closedAt: aH, actualCash: 100 });
  sent.length = 0;
  r = await C({ action: 'close', at: 'harbor' });
  const kept = await get(`${T}/nightCloses/${dayH}_harbor`);
  check('…then closes on its own: kept with its report, the business’s night still open', r.body.ok && kept?.status === 'closed' && kept?.locationId === 'harbor' && kept?.report?.sales?.total === 50 && (await get(`${T}/nightCloses/${dayH}`))?.status !== 'closed', r.body);
  check('…its report emailed with its name', sent.length === 1 && /Northside, Harbor Rd: /.test(sent[0].subject) && /Northside, Harbor Rd, /.test(sent[0].text), sent[0]?.subject);
  check('…tips aren’t approved with one location’s close, and it says when they are', r.body.tipsApproved === false && /approved when the whole business’s night is closed/.test(r.body.tipsNote || '') && !(await get(`${T}/tipShareRuns/night_${dayH}`)), r.body.tipsNote);
  r = await C({ action: 'state', at: 'harbor' });
  check('…shown closed, as it was kept', r.body.closed === true && r.body.report.sales.total === 50);
  r = await C({ action: 'history', at: 'harbor' }); const r2: any = await C({ action: 'history' });
  check('its history lists its own closes; the business’s, the business’s', r.body.rows.some((x: any) => x.day === dayH) && !r2.body.rows.some((x: any) => x.day === dayH && x.sales === 50), [r.body.rows, r2.body.rows]);
  r = await C({ action: 'send', at: 'harbor', day: dayH });
  check('…and sends again', r.body.ok && /Harbor Rd/.test(sent[sent.length - 1].subject));

  console.log('the month');
  const FS = await import('../../src/lib/food-safety-server');
  const month = dayH.slice(0, 7);
  const bind = await FS.monthSafety(db, 't1', house, month);
  check('the inspector’s binder: each location’s closing readings, the one out of its limit named with its location', bind.closing.readings >= (dayH.slice(0, 7) === dayW.slice(0, 7) ? 2 : 1) && bind.closing.out.some((o: any) => o.label === 'Harbor Rd: Walk-in' && o.tempF === 45), bind.closing);
  const recs = src('src/lib/records-server.ts');
  const RS = await import('../../src/lib/records-server');
  const rowW = (await RS.monthNights(db, 't1', house, dayW.slice(0, 7))).find((x: any) => x.day === dayW);
  check('records: Main St sold that night and hasn’t closed, so the night isn’t closed', rowW && rowW.closed === false, rowW);
  check('…closed once every location that sold or started its checklist that night has', recs.includes('Array.from(x.need).every((id) => x.done.has(id))') && recs.includes('of(day).need.add(id)'));

  console.log('each sale and drawer keeps where it was');
  const desk = src('src/app/api/checkout/complete/route.ts'); const engine = src('src/components/pos/usePosEngine.tsx');
  check('a front desk sale: its location on the receipt (the desk’s, while it’s one of the business’s; else the visit’s)', desk.includes('...(saleLocation ? { locationId: saleLocation } : {})') && desk.includes('(await hereOf(db, tenantId, b.locationId)) || visits[0]?.appointment?.locationId')
    && desk.indexOf('const saleLocation') < desk.indexOf('batch.create(receiptRef'));
  check('a drawer opened at the desk: the desk’s location, while it’s one of the business’s', /places\.some\(\(p: any\) => p\.id === v\) \? v : null/.test(engine) && engine.includes("...(deskLoc ? { locationId: deskLoc } : {}), ...data"));

  console.log('one location');
  await db.doc(`${T}/locations/harbor`).update({ isActive: false }); HS.forgetLocations('t1');
  r = await C({ action: 'state', at: 'main' });
  check('with one location: the business’s night, no picker', r.body.ok && r.body.at === null && r.body.places.length === 0 && r.body.day === dayW);

  console.log('the page');
  const page = src('src/app/(app)/close/page.tsx'); const view = src('src/components/close/NightReportView.tsx');
  check('the close page: each location and Whole business, starting on the one picked in the app, and every call says which', page.includes("{ id: '', name: 'Whole business' }") && page.includes("localStorage.getItem('selectedLocationId')")
    && page.includes("action: 'check', at: s.at") && page.includes("action: 'close', at: s.at") && page.includes("action: 'send', at: s.at") && page.includes('Close the night{s?.place ?'));
  check('the report: a location’s points its tips to the whole business’s', view.includes('Each person’s tips are on the whole business’s report, with every location’s.'));
  check('house style', ![page, view].some((x) => / · |\buppercase\b|font-black|call us|contact us|\{\/\*/i.test(x)) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
