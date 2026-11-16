// Checks the inspection binder (round 36, design canvas "Food numbers": the binder):
// - lib/food-safety: temperatures as typed and their limits, where a batch cooling stands (70°F by 2 hours, 41°F by 6),
//   a log as typed (a reading outside its limit asks what was done), certificates and permits (never a license number;
//   a person's own names them), how long each has left, incidents (who was sent home, never why)
// - the kitchen screen (api/kitchen): readings with a PIN on a shared tablet, or a cook signed in on their own phone; a
//   cooling batch checked at its marks; one that misses asks what was done; one nobody checked is marked and the
//   managers told once, and still takes what was done afterwards
// - the Binder (api/binder, managers only): the month's logs with the closing temperatures and the dish machine, a
//   manager's reading, certificates and permits (reminders 60 and 14 days before and once run out, again after a new
//   date), equipment service as Maintenance plans (each once, the last resolved ticket shown), incidents and cleared to
//   work, the allergen chart from the menu
// - the screens, the sidebar, the nightly and hourly runs, the push tiers, and the database rules
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/food-safety.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

const db: any = strictTransactions(makeDb()); const audits: any[] = [];
let manager = true; let signedIn = true;
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminMessaging: () => ({ sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) }) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (_r: any, _t: any, level: string) => (!signedIn ? { deny: { status: 401, body: { ok: false, error: 'Please sign in again.' } } }
      : level === 'manager' && !manager ? { deny: { status: 403, body: { ok: false, error: 'Only a manager can do that.' } } } : { actor: { ...actor, isManager: manager } }),
    requireCan: async () => ({ actor }),
  });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_d: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const notices = async (type: string) => (await db.collection(`${T}/notifications`).where('type', '==', type).get()).docs.map((d: any) => d.data());
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const F = await import('../../src/lib/food-safety');

  console.log('temperatures, limits and cooling');
  check('a temperature as typed, to a tenth; nonsense and the impossible aren’t', F.cleanTemp('38') === 38 && F.cleanTemp('140.5') === 140.5 && F.cleanTemp('-10') === -10 && F.cleanTemp('1000') === null && F.cleanTemp('abc') === null && F.cleanTemp('-41') === null && F.cleanTemp('') === null && F.cleanTemp('38.25') === null);
  check('cold at 41°F or below, frozen at 0°F or below, hot at 135°F or above', F.tempOk('cold', 41) && !F.tempOk('cold', 41.1) && F.tempOk('frozen', 0) && !F.tempOk('frozen', 1) && F.tempOk('hot', 135) && !F.tempOk('hot', 134.9));
  const t0 = Date.parse('2026-11-15T14:00:00Z'); const at = (min: number) => new Date(t0 + min * 60000).toISOString(); const start = at(0);
  const c1 = F.coolState(start, [], t0 + 60 * 60000, 'UTC');
  check('a batch an hour off the heat works to 70°F by the 2-hour mark', c1.state === 'cooling' && c1.stage === 1 && c1.dueWords === '70°F by 4:00 PM' && c1.missedWords === null, c1);
  const c2 = F.coolState(start, [{ at: at(100), tempF: 68, by: 'Kim' }], t0 + 110 * 60000, 'UTC');
  check('…at 68°F by 100 minutes it works to 41°F by the 6-hour mark', c2.state === 'cooling' && c2.stage === 2 && c2.dueWords === '41°F by 8:00 PM', c2);
  check('…at 40°F by 5 hours it’s cooled', F.coolState(start, [{ at: at(100), tempF: 68, by: 'Kim' }, { at: at(300), tempF: 40, by: 'Kim' }], t0 + 301 * 60000, 'UTC').state === 'done');
  const m1 = F.coolState(start, [], t0 + 121 * 60000, 'UTC');
  check('nothing under 70°F by 2 hours: missed, reheat to 165°F or throw it out', m1.state === 'missed' && m1.stage === 1 && /Reheat it to 165°F/.test(m1.missedWords || ''), m1);
  check('…a reading under 70°F taken after the mark doesn’t count', F.coolState(start, [{ at: at(125), tempF: 66, by: 'Kim' }], t0 + 126 * 60000, 'UTC').state === 'missed');
  check('…nor 41°F after 6 hours', F.coolState(start, [{ at: at(100), tempF: 68, by: 'Kim' }], t0 + 361 * 60000, 'UTC').state === 'missed' && F.coolState(start, [{ at: at(100), tempF: 68, by: 'Kim' }], t0 + 361 * 60000, 'UTC').stage === 2);
  check('the clock is the business’s own', F.coolState(start, [], t0, 'America/New_York').dueWords === '70°F by 11:00 AM');

  console.log('a log as typed');
  const now = Date.now();
  check('which log, what it is and the temperature are needed', 'error' in F.cleanLog({ kind: 'fridge', item: 'x', tempF: '38' }) && 'error' in F.cleanLog({ kind: 'cold', item: '', tempF: '38' }) && 'error' in F.cleanLog({ kind: 'cold', item: 'Reach-in', tempF: 'cold' }));
  const d1: any = F.cleanLog({ kind: 'delivery', item: 'Chicken', tempF: '46', supplier: 'Valley Foods' }, now);
  check('a cold delivery over 41°F asks what was done (refused)', 'error' in d1 && /over 41°F or below/.test(d1.error), d1);
  const d2: any = F.cleanLog({ kind: 'delivery', item: 'Chicken', tempF: '46', supplier: 'Valley Foods', note: 'Sent back' }, now);
  check('…with it said, it’s taken; a delivery is cold unless said otherwise', !('error' in d2) && d2.deliveryKind === 'cold' && d2.note === 'Sent back' && d2.supplier === 'Valley Foods');
  check('…frozen at 5°F asks too; frozen at -2°F doesn’t', 'error' in F.cleanLog({ kind: 'delivery', deliveryKind: 'frozen', item: 'Fries', tempF: '5' }, now) && !('error' in F.cleanLog({ kind: 'delivery', deliveryKind: 'frozen', item: 'Fries', tempF: '-2' }, now)));
  check('hot holding under 135°F asks to reheat or throw out, and say which', /Reheat it to 165°F/.test((F.cleanLog({ kind: 'hot', item: 'Soup', tempF: '128' }, now) as any).error || '') && !('error' in F.cleanLog({ kind: 'hot', item: 'Soup', tempF: '128', note: 'Reheated to 165°F' }, now)));
  const cl: any = F.cleanLog({ kind: 'cooling', item: 'Stock', tempF: '180' }, now);
  check('cooling starts now unless it came off the heat earlier, within the last 6 hours', cl.startedAt === new Date(now).toISOString() && !('error' in F.cleanLog({ kind: 'cooling', item: 'Stock', tempF: '180', startedAt: ago(90) }, now)) && 'error' in F.cleanLog({ kind: 'cooling', item: 'Stock', tempF: '180', startedAt: ago(7 * 60) }, now) && 'error' in F.cleanLog({ kind: 'cooling', item: 'Stock', tempF: '180', startedAt: new Date(now + 3600000).toISOString() }, now));
  check('…from 135°F or above, unless it’s said why not', 'error' in F.cleanLog({ kind: 'cooling', item: 'Rice', tempF: '120' }, now) && !('error' in F.cleanLog({ kind: 'cooling', item: 'Rice', tempF: '120', note: 'Came from the other kitchen' }, now)));

  console.log('certificates, permits and incidents as typed');
  check('a person’s own (a food handler card) needs whose it is; a business’s doesn’t keep a person', 'error' in F.cleanPermit({ kind: 'handler' }) && (F.cleanPermit({ kind: 'health', staffId: 'k1' }) as any).staffId === null && (F.cleanPermit({ kind: 'handler', staffId: 'k1' }) as any).staffId === 'k1');
  const pm: any = F.cleanPermit({ kind: 'liquor', expires: '2027-01-15', number: 'LIC-55512', licenseNumber: '55512', note: 'State board' });
  check('its name is the kind’s unless given; a date or nothing; never a license number', pm.label === 'Liquor license' && pm.expires === '2027-01-15' && !JSON.stringify(pm).includes('55512') && 'error' in F.cleanPermit({ kind: 'health', expires: '15/01/2027' }) && 'error' in F.cleanPermit({ kind: 'parking' }));
  check('days left, and how it stands: current, renew soon (within 60 days), ran out, no date', F.daysLeft('2026-12-15', '2026-11-15') === 30 && F.permitState({ expires: '2027-03-01' }, '2026-11-15') === 'ok' && F.permitState({ expires: '2026-12-20' }, '2026-11-15') === 'soon' && F.permitState({ expires: '2026-11-14' }, '2026-11-15') === 'out' && F.permitState({ expires: null }, '2026-11-15') === 'none');
  const sh: any = F.cleanIncident({ kind: 'sent_home', staffId: 'k1', what: 'Fever and vomiting', reason: 'stomach bug' });
  check('someone sent home sick: who, never why', !('error' in sh) && sh.staffId === 'k1' && sh.what === 'Sent home sick, off food until cleared' && !/vomit|fever|stomach/i.test(JSON.stringify(sh)) && 'error' in F.cleanIncident({ kind: 'sent_home' }));
  check('a guest’s incident needs what happened', 'error' in F.cleanIncident({ kind: 'guest', what: ' ' }) && (F.cleanIncident({ kind: 'guest', what: 'Slipped by the door', person: 'Dana', done: 'First aid' }) as any).person === 'Dana');
  check('the usual services, each with how often', F.SERVICE_PRESETS.map((p) => `${p.id}:${p.everyDays}`).join() === 'hood:180,suppression:180,grease:90,pest:30,extinguishers:365');

  console.log('the kitchen screen');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: binder } = await import('../../src/app/api/binder/route');
  await db.doc(T).set({ name: 'North Loft', timezone: 'UTC', userId: 'owner1', modules: { hospitality: true } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kim Lee', role: 'staff', job: 'cook', pin: '4821', isActive: true });
  await db.doc(`${T}/staff/s2`).set({ name: 'Sam Ortiz', role: 'staff', job: 'server', pin: '7777', isActive: true });
  await db.doc(`${T}/staff/s3`).set({ name: 'Lina Park', role: 'staff', isActive: true });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kitchen', kind: 'kitchen' }))).body.key;
  manager = false; signedIn = false;
  const kim = (await kitchen(req({ action: 'pin', tenantId: 't1', key, pin: '4821' }))).body.pass;
  const K = async (b: any, pass?: string) => { const r: any = await kitchen(req({ tenantId: 't1', key, ...(pass ? { staffPass: pass } : {}), ...b })); return { status: r.status, ...r.body }; };
  check('a screen and a PIN to start', typeof key === 'string' && typeof kim === 'string');
  let r: any = await K({ action: 'safetyLog', kind: 'cold', item: 'Line reach-in', tempF: '38' });
  check('a reading on a shared tablet asks for a PIN first, so the log shows who', r.status === 409 && r.code === 'pin' && (await db.collection(`${T}/safetyLogs`).get()).docs.length === 0, r);
  r = await K({ action: 'safetyLog', kind: 'delivery', item: 'Chicken thighs', supplier: 'Valley Foods', tempF: '46' }, kim);
  check('a delivery over the limit without what was done isn’t taken', r.status === 422 && /Refuse it/.test(r.error), r);
  r = await K({ action: 'safetyLog', kind: 'delivery', item: 'Chicken thighs', supplier: 'Valley Foods', tempF: '46', note: 'Sent back with the driver' }, kim);
  const del = r.log;
  check('…with it said, it’s logged under Kim’s name, marked out', r.ok && del.by === 'Kim Lee' && del.ok === false && del.limit === '41°F or below' && (await get(`${T}/safetyLogs/${del.id}`)).byId === 'k1', r);
  const ds = await notices('food_safety');
  check('…and the managers hear: what, from whom, how warm, who, what was done', ds.length === 2 && ds.every((n: any) => n.link === '/binder') && /Chicken thighs from Valley Foods came in at 46°F/.test(ds[0].message) && /Sent back with the driver/.test(ds[0].message) && ds.some((n: any) => n.userId === 'owner1') && ds.some((n: any) => n.userId === 'm1'), ds);
  r = await K({ action: 'safetyLog', kind: 'hot', item: 'Soup of the day', tempF: '142' }, kim);
  check('a reading within its limit tells nobody', r.ok && r.log.ok && (await notices('food_safety')).length === 2);
  r = await K({ action: 'safetyLog', kind: 'cooling', item: 'Chicken stock', tempF: '185', startedAt: ago(30) }, kim);
  const stock = r.log;
  check('a batch starts cooling, its next mark shown', r.ok && stock.cooling.state === 'cooling' && stock.cooling.stage === 1 && /^70°F by /.test(stock.cooling.dueWords), r);
  r = await K({ action: 'coolCheck', logId: stock.id, tempF: '66' }, kim);
  check('checked at 66°F: on to 41°F', r.ok && r.log.cooling.state === 'cooling' && r.log.cooling.stage === 2 && r.log.cooling.checks.length === 1 && r.log.cooling.checks[0].by === 'Kim Lee', r);
  r = await K({ action: 'coolCheck', logId: stock.id, tempF: '39' }, kim);
  check('…then 39°F: cooled', r.ok && r.log.cooling.state === 'done' && (await get(`${T}/safetyLogs/${stock.id}`)).cooling.state === 'done');
  r = await K({ action: 'coolCheck', logId: stock.id, tempF: '38' }, kim);
  check('…and it’s done with', r.status === 409 && /already cooled/.test(r.error));
  r = await K({ action: 'coolCheck', logId: stock.id }, kim);
  check('…a check needs a temperature', r.status === 409 || r.status === 400);
  r = await K({ action: 'safetyLog', kind: 'cooling', item: 'Rice', tempF: '170', startedAt: ago(170) }, kim);
  const rice = r.log;
  r = await K({ action: 'coolCheck', logId: rice.id, tempF: '75' }, kim);
  check('a batch that missed its 2-hour mark asks what was done', r.status === 422 && /didn’t reach 70°F within 2 hours/.test(r.error) && /Say which/.test(r.error), r);
  r = await K({ action: 'coolCheck', logId: rice.id, tempF: '75', done: 'Thrown out' }, kim);
  check('…thrown out: kept with the reading, marked out (and handled), the managers told', r.ok && r.log.cooling.state === 'missed' && r.log.cooling.done === 'Thrown out' && r.log.ok === false && (await get(`${T}/safetyLogs/${rice.id}`)).cooling.state === 'handled' && (await notices('food_safety')).some((n: any) => /Rice missed its mark \(75°F\)\. What was done: Thrown out/.test(n.message)), r);
  r = await K({ action: 'safetyLog', kind: 'cooling', item: 'Short rib braise', tempF: '190', startedAt: ago(150) }, kim);
  const rib = r.log; const before = (await notices('food_safety')).length;
  r = await K({ action: 'safety' });
  check('the screen’s list: today’s readings; the braise nobody checked by its mark is waiting for what was done', r.ok && r.logs.length === 5 && r.cooling.length === 0 && r.undone.length === 1 && r.undone[0].id === rib.id && r.day, r);
  const told = await notices('food_safety');
  check('…marked missed, and the managers told it wasn’t checked', told.length === before + 2 && told.some((n: any) => /nobody checked Short rib braise by its mark/.test(n.message)) && (await get(`${T}/safetyLogs/${rib.id}`)).cooling.toldLate === true && (await get(`${T}/safetyLogs/${rib.id}`)).ok === false);
  await K({ action: 'safety' });
  check('…once', (await notices('food_safety')).length === before + 2);
  r = await K({ action: 'coolCheck', logId: rib.id }, kim);
  check('…what was done can still be said, no reading needed; nothing said isn’t taken', r.status === 422 && /Say which/.test(r.error));
  r = await K({ action: 'coolCheck', logId: rib.id, done: 'Reheated to 165°F' }, kim);
  check('…reheated to 165°F, written down with who said it', r.ok && r.log.cooling.done === 'Reheated to 165°F' && (await get(`${T}/safetyLogs/${rib.id}`)).cooling.doneBy === 'Kim Lee' && (await K({ action: 'safety' })).undone.length === 0, r);
  r = await K({ action: 'coolCheck', logId: rib.id, done: 'Thrown out' }, kim);
  check('…once', r.status === 409 && /been dealt with/.test(r.error));
  // A cook signed in on their own phone; a server isn't the kitchen.
  signedIn = true; Object.assign(actor, { uid: 'k1', name: 'Kim Lee', role: 'staff', isManager: false });
  r = await kitchen(req({ tenantId: 't1', action: 'safetyLog', kind: 'cold', item: 'Prep fridge', tempF: '37' }));
  check('a cook on their own phone logs without a PIN, under their own name', r.body.ok && r.body.log.by === 'Kim Lee', r.body);
  Object.assign(actor, { uid: 's2', name: 'Sam Ortiz' });
  r = await kitchen(req({ tenantId: 't1', action: 'safetyLog', kind: 'cold', item: 'Bar fridge', tempF: '37' }));
  check('…a server can’t', r.status === 403 && /the kitchen’s/.test(r.body.error), r.body);
  r = await kitchen(req({ tenantId: 't1', action: 'safety' }));
  check('…but can see today’s list', r.body.ok && Array.isArray(r.body.logs));

  console.log('the binder');
  const B = async (b: any) => { const x: any = await binder(req({ tenantId: 't1', ...b })); return { status: x.status, ...x.body }; };
  r = await B({ action: 'view' });
  check('managers only', r.status === 403);
  manager = true; Object.assign(actor, { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true });
  r = await B({ action: 'log', kind: 'cooling', item: 'Stock', tempF: '180' });
  check('cooling is logged on the kitchen screen, which asks at each mark', r.status === 400 && /kitchen screen/.test(r.error));
  r = await B({ action: 'log', kind: 'cold', item: 'Walk-in', tempF: '44' });
  check('a manager’s reading over the limit asks what was done too', r.status === 422);
  r = await B({ action: 'log', kind: 'cold', item: 'Walk-in', tempF: '44', note: 'Door left open, moved stock to the reach-in' });
  check('…then it’s logged under the manager’s name', r.ok && r.log.by === 'Ana Ruiz' && r.log.ok === false);
  const view0 = await B({ action: 'view' });
  const today = view0.today; const month = today.slice(0, 7);
  // The closing list’s temperatures and the dish machine’s readings this month.
  await db.doc(`${T}/nightCloses/${today}`).set({ day: today, status: 'closed', checks: { walkin: { value: 38 }, freezer: { value: 4, out: true, note: 'Called for service' }, floors: { done: true } } });
  await db.doc(`${T}/machineChecks/mc1`).set({ day: today, ok: true, value: 182 });
  await db.doc(`${T}/machineChecks/mc2`).set({ day: today, ok: false, value: 160 });
  await db.doc(`${T}/safetyLogs/old`).set({ id: 'old', kind: 'cold', day: '2025-01-05', at: '2025-01-05T12:00:00Z', by: 'Kim', item: 'Old', tempF: 50, ok: false, note: 'x' });
  r = await B({ action: 'view', month });
  check('the month: every reading taken, the closing temperatures (one out) and the dish machine (one out)', r.ok && r.month === month && r.safety.logs.length === 7 && r.safety.closing.nights === 1 && r.safety.closing.readings === 2 && r.safety.closing.out.length === 1 && r.safety.closing.out[0].label === 'Freezer' && r.safety.closing.out[0].tempF === 4 && r.safety.closing.out[0].note === 'Called for service' && r.safety.closing.out[0].day === today && r.safety.machine.readings === 2 && r.safety.machine.out === 1 && r.timeZone === 'UTC' && r.business === 'North Loft', r.safety);
  check('…in the order they were taken, the cooling with its checks and what was done', r.safety.logs[0].kind === 'delivery' && r.safety.logs.find((l: any) => l.id === rice.id).cooling.done === 'Thrown out' && r.safety.logs.find((l: any) => l.id === stock.id).cooling.checks.length === 2);
  check('a month to come isn’t one', (await B({ action: 'view', month: '2099-01' })).status === 400);

  console.log('certificates and permits');
  r = await B({ action: 'permit', kind: 'handler' });
  check('a food handler card needs whose', r.status === 400 && /Whose/.test(r.error));
  check('…someone on the team', (await B({ action: 'permit', kind: 'handler', staffId: 'nobody' })).status === 404);
  r = await B({ action: 'permit', kind: 'handler', staffId: 'k1', expires: addDays(today, 30) });
  const kimCard = r.id;
  await B({ action: 'permit', kind: 'health', label: 'County health permit', expires: addDays(today, 200), note: 'County health department' });
  await B({ action: 'permit', kind: 'liquor', expires: addDays(today, -3) });
  r = await B({ action: 'view' });
  const byLabel = (l: string) => r.permits.find((p: any) => p.label === l);
  check('each with how it stands, soonest first; a person’s names them', r.permits.length === 3 && r.permits[0].label === 'Liquor license' && byLabel('Liquor license').state === 'out' && byLabel('Food handler card').state === 'soon' && byLabel('Food handler card').person === 'Kim Lee' && byLabel('County health permit').state === 'ok', r.permits);
  check('food handler cards: 1 of the team on file, the rest named', r.handlers.onFile === 1 && r.handlers.team === 4 && r.handlers.missing.includes('Lina Park') && !r.handlers.missing.includes('Kim Lee'), r.handlers);
  check('…written in the record of who did what', audits.some((a) => a.action === 'binder.permit' && /Ana Ruiz put County health permit on the binder/.test(a.summary)));
  const FS = await import('../../src/lib/food-safety-server');
  const tenantNow = await get(T);
  await FS.permitSweep(db, 't1', tenantNow);
  let due = await notices('permit_due');
  check('the nightly run: Kim’s card runs out in 30 days, the liquor license ran out (each told to the managers)', due.length === 4 && due.some((n: any) => /Kim Lee’s Food handler card runs out on .*, in 30 days\. Renew it/.test(n.message)) && due.some((n: any) => /Liquor license ran out on/.test(n.message)) && due.every((n: any) => n.link === '/binder'), due.map((n: any) => n.message));
  await FS.permitSweep(db, 't1', tenantNow);
  check('…once each', (await notices('permit_due')).length === 4);
  await B({ action: 'permit', id: kimCard, kind: 'handler', staffId: 'k1', expires: addDays(today, 10) });
  await FS.permitSweep(db, 't1', tenantNow);
  due = await notices('permit_due');
  check('a new date starts its reminders again: 10 days left', due.length === 6 && due.some((n: any) => /in 10 days/.test(n.message)) && !!(await get(`${T}/permits/${kimCard}`)).reminded['14']);
  await B({ action: 'permit', id: kimCard, kind: 'handler', staffId: 'k1', expires: addDays(today, 10), note: 'From the county' });
  check('…the same date keeps them', !!(await get(`${T}/permits/${kimCard}`)).reminded['14']);
  const liquor = byLabel('Liquor license').id;
  r = await B({ action: 'permitRemove', id: liquor });
  check('taken off the binder, written down', r.ok && !(await get(`${T}/permits/${liquor}`)) && audits.some((a) => a.action === 'binder.permit_remove'));
  check('a person’s certificate keeps their name as it was saved', (await get(`${T}/permits/${kimCard}`)).person === 'Kim Lee');
  await db.doc(`${T}/staff/s9`).set({ name: 'Rosa Diaz', role: 'staff', isActive: true });
  await B({ action: 'permit', kind: 'manager', staffId: 's9' });
  await db.doc(`${T}/staff/s9`).delete();
  check('…so one for someone who has left still says whose', (await B({ action: 'view' })).permits.some((p: any) => p.person === 'Rosa Diaz, no longer on the team'));

  console.log('equipment and service');
  r = await B({ action: 'service', preset: 'hood', lastDone: addDays(today, -100) });
  const hood = await get(`${T}/maintenancePlans/${r.id}`);
  check('hood cleaning added to Maintenance’s plans, its first ticket 180 days after it was last done', r.ok && hood.binder === true && hood.binderKind === 'hood' && hood.category === 'safety' && hood.everyDays === 180 && hood.nextRunAt === addDays(today, 80) && hood.active === true, hood);
  check('…once', (await B({ action: 'service', preset: 'hood' })).status === 409);
  check('…a usual one only', (await B({ action: 'service', preset: 'disco-ball' })).status === 400);
  r = await B({ action: 'service', preset: 'pest', lastDone: addDays(today, 5) });
  check('a date to come is no last-done date: the first ticket opens today', (await get(`${T}/maintenancePlans/${r.id}`)).nextRunAt === today);
  await db.doc(`${T}/tickets/tk1`).set({ planId: r.id, status: 'resolved', resolvedAt: `${addDays(today, -2)}T15:00:00.000Z`, updates: [{ note: 'No activity found' }] });
  await db.doc(`${T}/tickets/tk0`).set({ planId: r.id, status: 'resolved', resolvedAt: `${addDays(today, -40)}T15:00:00.000Z`, updates: [{ note: 'Old visit' }] });
  r = await B({ action: 'view' });
  const pest = r.service.find((s: any) => s.binderKind === 'pest');
  check('each with how often, when it was last done (its latest resolved ticket, with the note) and when it’s next due', r.service.length === 2 && pest.lastDone === addDays(today, -2) && pest.note === 'No activity found' && r.service.find((s: any) => s.binderKind === 'hood').lastDone === addDays(today, -100), r.service);

  console.log('incidents and illness');
  r = await B({ action: 'incident', kind: 'guest' });
  check('a guest’s incident needs what happened', r.status === 400);
  r = await B({ action: 'incident', kind: 'guest', what: 'Guest said the soup had nuts; mild reaction', person: 'Dana Wu', ate: 'Soup of the day', done: 'Comped the table, kept the soup' });
  check('…written down today', r.ok && (await get(`${T}/safetyIncidents/${r.id}`)).ate === 'Soup of the day');
  r = await B({ action: 'incident', kind: 'sent_home', staffId: 'k1', what: 'Vomiting', reason: 'stomach bug' });
  const home = r.id; const hx = await get(`${T}/safetyIncidents/${home}`);
  check('someone sent home sick: who and when, never why', r.ok && hx.name === 'Kim Lee' && hx.clearedAt === null && !/vomit|stomach/i.test(JSON.stringify(hx)) && audits.some((a) => a.action === 'binder.sent_home' && !/Kim/.test(a.summary)), hx);
  r = await B({ action: 'incidentClear', id: home });
  check('cleared to work, with who said so', r.ok && (await get(`${T}/safetyIncidents/${home}`)).clearedBy === 'Ana Ruiz');
  const guestId = (await B({ action: 'view' })).incidents.find((x: any) => x.kind === 'guest').id;
  check('…only someone sent home is cleared', (await B({ action: 'incidentClear', id: guestId })).status === 404);

  console.log('the allergen chart');
  await db.doc(`${T}/inventory/burger`).set({ name: 'Burger', type: 'refreshment', category: 'Mains', price: 14, allergens: ['wheat', 'milk'] });
  await db.doc(`${T}/inventory/salad`).set({ name: 'Green salad', type: 'refreshment', category: 'Starters', price: 9, allergens: [] });
  await db.doc(`${T}/inventory/soup`).set({ name: 'Soup of the day', type: 'refreshment', category: 'Starters', price: 7 });
  await db.doc(`${T}/inventory/gone`).set({ name: 'Old special', type: 'refreshment', archived: true, allergens: ['fish'] });
  r = await B({ action: 'view' });
  check('every dish on the menu with what it contains, by section; “none of these” kept apart from not said', r.allergens.rows.length === 2 && r.allergens.rows[0].name === 'Burger' && r.allergens.rows[0].keys.join() === 'milk,wheat' && r.allergens.rows[1].keys.length === 0 && r.allergens.unset.join() === 'Soup of the day' && r.allergens.columns.length === 10, r.allergens);

  console.log('cooling, past the edges');
  const FS2 = await import('../../src/lib/food-safety-server');
  await db.doc(`${T}/safetyLogs/old1`).set({ id: 'old1', kind: 'cooling', day: '2026-01-01', at: ago(26 * 60), by: 'Kim', item: 'Old rice', tempF: 180, ok: false, cooling: { startedAt: ago(26 * 60), checks: [], state: 'missed', toldLate: true } });
  manager = false; signedIn = false;
  r = await K({ action: 'safety' });
  check('a batch nobody dealt with for a day leaves the kitchen screen’s list (it stays missed on the Binder)', r.ok && !r.undone.some((x: any) => x.id === 'old1') && (await get(`${T}/safetyLogs/old1`)).cooling.state === 'lapsed');
  manager = true; signedIn = true; Object.assign(actor, { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true });
  r = await B({ action: 'coolDone', logId: 'old1' });
  check('…where a manager can still write down what was done, once', r.status === 400);
  r = await B({ action: 'coolDone', logId: 'old1', done: 'Thrown out' });
  check('…thrown out, under the manager’s name', r.ok && r.log.cooling.done === 'Thrown out' && (await get(`${T}/safetyLogs/old1`)).cooling.state === 'handled' && (await get(`${T}/safetyLogs/old1`)).cooling.doneBy === 'Ana Ruiz' && !!(await get(`${T}/safetyLogs/old1`)).cooling.doneAt && audits.some((a) => a.action === 'binder.cool_done' && /Old rice/.test(a.summary)) && (await B({ action: 'coolDone', logId: 'old1', done: 'Reheated' })).status === 409);
  await db.doc(`${T}/safetyLogs/warm`).set({ id: 'warm', kind: 'cooling', day: today, at: ago(20), by: 'Kim', item: 'Soup base', tempF: 185, ok: true, cooling: { startedAt: ago(20), checks: [], state: 'cooling' } });
  check('…not for a batch still cooling (that check is the kitchen’s)', (await B({ action: 'coolDone', logId: 'warm', done: 'Thrown out' })).status === 400 && (await get(`${T}/safetyLogs/warm`)).cooling.state === 'cooling');
  await db.doc(`${T}/safetyLogs/warm`).delete();
  manager = false; signedIn = false;
  await db.doc(`${T}/safetyLogs/late2`).set({ id: 'late2', kind: 'cooling', day: today, at: ago(130), by: 'Kim', item: 'Beans', tempF: 185, ok: true, cooling: { startedAt: ago(130), checks: [], state: 'cooling' } });
  const realBatch = db.batch; db.batch = () => ({ set: () => undefined, update: () => undefined, delete: () => undefined, commit: async () => { throw new Error('down'); } });
  await FS2.coolingSweep(db, 't1', await get(T));
  db.batch = realBatch;
  const l2 = (await get(`${T}/safetyLogs/late2`)).cooling;
  check('when the managers couldn’t be told, it goes back to cooling, to be marked and told next time', l2.state === 'cooling' && l2.toldLate === false, l2);
  await FS2.coolingSweep(db, 't1', await get(T));
  check('…and next time they are', (await get(`${T}/safetyLogs/late2`)).cooling.toldLate === true && (await notices('food_safety')).some((n: any) => /nobody checked Beans/.test(n.message)));

  console.log('the screens');
  const page = src('src/app/(app)/binder/page.tsx'); const sheet = src('src/components/kitchen/SafetySheet.tsx'); const kds = src('src/app/kds/[tenantId]/page.tsx');
  check('the Binder page: the month, print, each part, through the binder’s own server route', /'\/api\/binder'/.test(page) && />Print the binder</.test(page) && /window\.print\(\)/.test(page) && /Temperature logs, \{words\}/.test(page) && /Certificates and permits/.test(page) && /Equipment and service/.test(page) && /Allergens, dish by dish/.test(page) && /Incidents and illness/.test(page) && /recentMonths/.test(page));
  check('…printed without the app around it, forms left off, every reading on paper', /\[data-sidebar\], \.group\.peer, header \{ display: none !important; \}/.test(page) && /'hidden print:block'/.test(page) && (page.match(/print:hidden/g) || []).length >= 6);
  check('…a missed batch with nothing written asks what was done, right there, and asks again before writing it', /action: 'coolDone', logId: l\.id, done: coolPick\.done/.test(page) && /what was done\?/.test(page) && /It can’t be changed after/.test(page) && /\(written later, by /.test(page));
  check('…no license numbers asked for, and only who and when for someone sent home', /No license or ID numbers here/.test(page) && /Only who and when is kept, never why/.test(page));
  check('…on paper, a guest and a team member, unless the manager puts names on; never a diagnosis asked for', /const \[printNames, setPrintNames\] = useState\(false\)/.test(page) && /'A team member sent home sick'/.test(page) && /named\(` \(\$\{x\.person\}\)`, ''\)/.test(page) && /Not a diagnosis or a medical detail/.test(page));
  const kit = [page, sheet].join('\n');
  check('…in the app’s own words and look: no capitals, no heavy type, 44px targets, white as #fff', !/uppercase|font-black|\{\/\*| · /.test(kit) && !/\b(salon|stylist|booth|chair)s?\b/i.test(page) && /min-h-\[44px\]/.test(page) && /bg-\[#fff\]/.test(page) && !/[\u{1F300}-\u{1FAFF}]/u.test(kit) && !/\b(call|contact) us\b/i.test(kit));
  check('the kitchen screen: Food safety beside Closing, a banner when a check is due or a missed batch needs what was done, the sheet with this screen’s PIN pass', /say\('Food safety'\)/.test(kds) && /say\('Cooling check due'\)/.test(kds) && /say\('Say what was done'\)/.test(kds) && /<SafetySheet post=\{\(body\) => post\(\{ \.\.\.body, \.\.\.\(staff \? \{ staffPass: staff\.pass \} : \{\}\) \}\)\}/.test(kds));
  check('…the sheet asks for a PIN when the server does, and what was done for a missed batch', /d\?\.code === 'pin'/.test(sheet) && /onPin\(\)/.test(sheet) && /setUndone\(d\.undone/.test(sheet) && /'Reheated to 165°F', 'Thrown out'/.test(sheet));
  const L = await import('../../src/lib/screen-lang');
  const words = Array.from(sheet.matchAll(/say\('((?:[^'\\]|\\.)*)'/g)).map((x) => x[1]);
  const missing = words.filter((w) => !L.hasSpanish(w));
  check('…every word on it has its Spanish, the cooling marks’ words too', words.length > 40 && missing.length === 0 && L.tr('es', F.coolState(start, [], t0 + 121 * 60000).missedWords!) !== F.coolState(start, [], t0 + 121 * 60000).missedWords && L.hasSpanish(`${F.coolState(start, [{ at: at(100), tempF: 68, by: 'K' }], t0 + 361 * 60000).missedWords} Say which.`), missing);
  const side = src('src/components/shared/AppSidebar.tsx'); const mods = src('src/lib/modules.ts'); const theme = src('src/lib/app-theme.ts');
  check('the sidebar, the hospitality pages and the app’s own routes have it', /href: '\/binder',\s+icon: ClipboardList, label: 'Inspection binder'/.test(side) && /'\/food-cost', '\/binder'/.test(mods) && /'binder'/.test(theme));
  check('Records points to it', /openBtn\('\/binder'\)/.test(src('src/app/(app)/records/page.tsx')));
  const tiers = (await import('../../src/lib/push-tier')).PUSH_TIER;
  check('a reading out buzzes a manager now; a permit running out, today', tiers.food_safety === 'now' && tiers.permit_due === 'today');
  check('the nightly run sends the permit reminders; the hourly one catches a batch nobody checked', /permitSweep\(db, tDoc\.id, tDoc\.data\(\)\)/.test(src('src/app/api/cron/nightly/route.ts')) && /coolingSweep\(db, tid, tDoc\.data\(\)\)/.test(src('src/app/api/cron/reminders/route.ts')));
  const rules = src('firestore.rules');
  const closed = rules.slice(rules.indexOf('match /tenants/{tenantId}/{collection}/{rest=**}'), rules.indexOf('match /tenants/{tenantId}/jobListings'));
  check('the database: the logs, permits and incidents (and the records kept for the books) only through the server', ['safetyLogs', 'permits', 'safetyIncidents', 'tipDeclarations', 'stockValues', 'recordsNights', 'priceAlerts'].every((c) => closed.includes(`'${c}'`)));
  const fp = src('src/lib/rules-fingerprint.ts'); const { createHash } = await import('crypto');
  const norm = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
  check('…and the rules’ fingerprint is the one in the repo', fp.includes(createHash('sha256').update(norm(rules)).digest('hex').slice(0, 16)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
