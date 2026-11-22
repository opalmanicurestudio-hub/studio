// Checks telling the owner (design board "Who can do what", part 3): lib/activity tellModeOf, lookMessage, worthRows;
// lib/activity-server logMoney's notice (lib/tell-managers, the owners and admins only, never the people it's about);
// lib/push-tier; api/activity 'saveRules' alerts.tell; the night report (lib/night-close-server, lib/night-close
// reportText, components/close/NightReportView) with what was worth a look.
// - Worth a look: the owner's phone buzzes (until they choose the app only, or not at all).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/activity-alerts.verify.ts
import { readFileSync } from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const actor: any = { uid: 'u-owner', name: 'Rae Lin', role: 'owner', isTenantOwner: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let pushed = 0;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }) };
  if (request === '@/lib/push' || /\/src\/lib\/push(\.ts)?$/.test(request)) return fake(request, { pushNow: async () => { pushed++; } });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;
const notes = async () => (await db.collection(`${T}/notifications`).get()).docs.map((d: any) => d.data());

(async () => {
  const A = await import('../../src/lib/activity');
  const { logMoney } = await import('../../src/lib/activity-server');
  const PT = await import('../../src/lib/push-tier');

  console.log('what the owner hears');
  check('until they choose: their phone', A.tellModeOf({}) === 'push' && A.tellModeOf({ moneyRules: { alerts: { tell: 'app' } } }) === 'app' && A.tellModeOf({ moneyRules: { alerts: { tell: 'loud' } } }) === 'push');
  const line = A.activityLine('x', { kind: 'void', action: 'counter.void', cents: 940, where: 'window', by: { name: 'Kai Park' }, okBy: { name: 'Mo Diaz' }, reason: 'Guest left', ref: 'B11', flag: 'After the kitchen started' })!;
  check('the notice says why, what, where and who', A.lookMessage(line) === 'Worth a look: After the kitchen started. Void, B11, $9.40 at the window. Kai Park, okayed by Mo Diaz: Guest left.', A.lookMessage(line));
  check('a phone buzz for the owner’s notice; the quiet one waits in the app', PT.PUSH_TIER.money_look === 'now' && !PT.PUSH_TIER.money_look_quiet);

  await db.doc(T).set({ name: 'Linden Coffee', timezone: 'America/New_York', userId: 'u-owner' });
  await db.doc(`${T}/staff/a1`).set({ name: 'Dee Admin', role: 'admin', isActive: true });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/s4`).set({ name: 'Kai Park', role: 'staff', isActive: true });
  const kai = { id: 's4', name: 'Kai Park' }, mo = { id: 'm9', name: 'Mo Diaz' }, dee = { id: 'a1', name: 'Dee Admin' };
  await logMoney(db, 't1', { action: 'counter.refund', kind: 'refund', targetType: 'order', targetId: 'o1', summary: 'Refund', cents: 1200, where: 'window', by: kai, okBy: mo, reason: 'Cold', ref: 'B2' });
  check('nothing worth a look: nobody is told', (await notes()).length === 0 && pushed === 0);
  await logMoney(db, 't1', { action: 'counter.void', kind: 'void', targetType: 'order', targetId: 'o2', summary: 'Void', cents: 940, where: 'window', by: kai, okBy: mo, reason: 'Guest left', ref: 'B11', afterKitchen: true });
  let n = await notes();
  check('worth a look: the owner and admins are told at once (their phones buzz), never a manager or the people it’s about', n.length === 2 && n.every((x: any) => x.type === 'money_look' && x.link === '/activity' && x.priority === 'high')
    && n.map((x: any) => x.userId).sort().join(',') === 'a1,u-owner' && pushed === 1 && /After the kitchen started/.test(n[0].message), n);
  await logMoney(db, 't1', { action: 'counter.void', kind: 'void', targetType: 'order', targetId: 'o3', summary: 'Void', cents: 500, where: 'counter', by: dee, okBy: dee, reason: 'Wrong order', ref: 'C4', afterKitchen: true });
  n = await notes();
  check('…an admin who did it isn’t told about it themself', n.length === 3 && n[2].userId === 'u-owner', n.map((x: any) => x.userId));
  await logMoney(db, 't1', { action: 'retail.refund', kind: 'refund', targetType: 'retailOrder', targetId: 'r1', summary: 'Automatic', cents: 6000, where: 'online', by: { id: null, name: 'Automatic refund' }, auto: true, reason: 'Item out of stock', ref: 'Order #1042' });
  check('what the app did on its own by the owner’s rules: marked, but nobody is buzzed for it', (await notes()).length === 3 && pushed === 2
    && (await db.collection(`${T}/auditLogs`).get()).docs.some((d: any) => d.data().auto === true && d.data().flag === 'A refund of $50 or more'), [(await notes()).length, pushed]);
  await db.doc(T).set({ moneyRules: { alerts: { tell: 'app' } } }, { merge: true });
  await logMoney(db, 't1', { action: 'counter.void', kind: 'void', targetType: 'order', targetId: 'o4', summary: 'Void', cents: 300, where: 'window', by: kai, okBy: mo, reason: 'Left', ref: 'B12', afterKitchen: true });
  n = await notes();
  check('in the app only: it waits there, no buzz', n.length === 5 && n.slice(3).every((x: any) => x.type === 'money_look_quiet') && pushed === 2, [n.length, pushed]);
  await db.doc(T).set({ moneyRules: { alerts: { tell: 'off' } } }, { merge: true });
  await logMoney(db, 't1', { action: 'counter.void', kind: 'void', targetType: 'order', targetId: 'o5', summary: 'Void', cents: 300, where: 'window', by: kai, okBy: mo, reason: 'Left', ref: 'B13', afterKitchen: true });
  check('not at all: nobody is told, and it’s still marked in Activity', (await notes()).length === 5 && (await db.collection(`${T}/auditLogs`).get()).docs.filter((d: any) => d.data().flag).length === 5);
  const TM = src('src/lib/tell-managers.ts');
  check('the other notices for the people who run the business still go to managers too', /roles: string\[\] = \['owner', 'admin', 'manager'\]/.test(TM));

  console.log('choosing it');
  const { POST } = await import('../../src/app/api/activity/route');
  const P = (b: any) => POST(req({ tenantId: 't1', ...b })) as Promise<any>;
  let r = await P({ action: 'saveRules', alerts: { tell: 'push' } });
  check('back to the phone: kept, and the change is a line', r.body.ok && r.body.alerts.tell === 'push' && (await get(T)).moneyRules.alerts.tell === 'push'
    && (await db.collection(`${T}/auditLogs`).get()).docs.some((d: any) => /Worth a look: buzz my phone/.test(d.data().summary || '')), r.body);
  r = await P({ action: 'saveRules', alerts: { tell: 'loud' } });
  check('only the three choices', r.status === 400);
  r = await P({ action: 'rules' });
  check('the rules say how the owner hears', r.body.alerts.tell === 'push' && r.body.alerts.refundOverCents === 5000);
  const pg = src('src/app/(app)/activity/page.tsx');
  check('the page asks it, three choices, said plainly', /When something’s worth a look, tell me/.test(pg) && /TELL_MODES\.map/.test(pg) && /never to whoever it’s about/.test(pg));

  console.log('the night report');
  const NC = await import('../../src/lib/night-close-server');
  const N = await import('../../src/lib/night-close');
  const day = NC.tonight(await get(T));
  for (let i = 0; i < 1500; i++) await db.collection(`${T}/auditLogs`).doc(`noise${i}`).set({ action: 'stock.count', summary: 'Counted', actor: { type: 'user', name: 'Kai Park' }, at: new Date(Date.now() + 1000 + i).toISOString() });
  const { report } = await NC.buildNightReport(db, 't1', await get(T), day, {});
  const worth = (report as any).worth;
  check('tonight’s worth a look is on the whole business’s report, in order, even on a busy night of other lines', Array.isArray(worth) && worth.length === 5 && worth.every((w: any, i: number, a: any[]) => !i || a[i - 1].at <= w.at) && worth[0].title === 'Void, B11', worth);
  const text = N.reportText('Linden Coffee', report);
  check('…and in its email', /Worth a look \(5\), in Activity:/.test(text) && /After the kitchen started\. Void, B11, \$9\.40\. Kai Park, okayed by Mo Diaz: Guest left\./.test(text), text.split('\n').filter((x) => /Worth|kitchen/.test(x)));
  const { report: placeRep } = await NC.buildNightReport(db, 't1', await get(T), day, {}, { at: 'main', place: 'Main St' });
  check('…not on one location’s (Activity is the whole business’s)', !(placeRep as any).worth);
  const view = src('src/components/close/NightReportView.tsx');
  check('the night report in the app shows it too', /title="Worth a look"/.test(view) && /var\(--warn-ink\)/.test(view));

  console.log('house style');
  for (const f of ['src/lib/activity.ts', 'src/lib/activity-server.ts', 'src/components/close/NightReportView.tsx']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no comments in markup`, !/\buppercase\b|font-black| · |\{\/\*/.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
