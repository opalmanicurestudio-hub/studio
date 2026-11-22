// Checks the Activity page and Who can do what (design boards "Activity", layout B, and "Who can do what"): api/activity
// 'list', 'rules' and 'saveRules'; the online shop's refunds as lines in Activity (api/retail/refund); the page, its tabs,
// the sidebar's link; and the screens saying when only the owner will do.
// - Only the owner and admins see it. A day in the business's own time, newest first, with totals and what's worth a look.
// - The rules change only here, each change a line too; the audit log itself is never changed.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/activity-page.verify.ts
import { readFileSync } from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
let actor: any = { uid: 'u-owner', name: 'Rae Lin', role: 'owner', isTenantOwner: true, caps: [] };
let allow = true;
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async (_r: any, _t: any, level: string) => (allow || level !== 'owner' ? { actor } : { deny: { status: 403, body: { ok: false, error: 'Only the owner or an admin can do that.' } } }) };
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const { POST } = await import('../../src/app/api/activity/route');
  const P = (b: any) => POST(req({ tenantId: 't1', ...b })) as Promise<any>;
  const { logMoney } = await import('../../src/lib/activity-server');
  await db.doc(T).set({ name: 'Linden Coffee', timezone: 'America/New_York', retailSettings: { policies: { refundAutoBelowCents: 2500 } } });
  const by = { id: 's4', name: 'Kai Park' }, mo = { id: 'm9', name: 'Mo Diaz' };
  await logMoney(db, 't1', { action: 'counter.refund', kind: 'refund', targetType: 'order', targetId: 'o1', summary: 'Refund', cents: 2400, where: 'window', by, okBy: mo, reason: 'Wrong order', ref: 'B18' });
  await logMoney(db, 't1', { action: 'counter.void', kind: 'void', targetType: 'order', targetId: 'o2', summary: 'Void', cents: 940, where: 'window', by, okBy: mo, reason: 'Guest left', ref: 'B11', afterKitchen: true });
  await logMoney(db, 't1', { action: 'retail.refund', kind: 'refund', targetType: 'retailOrder', targetId: 'r1', summary: 'Automatic', cents: 840, where: 'online', by: { id: null, name: 'Automatic refund' }, auto: true, reason: 'Item out of stock', ref: 'Order #1042' });
  await db.collection(`${T}/auditLogs`).doc('older').set({ action: 'counter.comp', amount: 4.5, summary: 'On the house', actor: { type: 'user', name: 'Mo Diaz' }, at: new Date(Date.now() - 60000).toISOString() });
  await db.collection(`${T}/auditLogs`).doc('notmoney').set({ action: 'payroll.submit', summary: 'Payroll', actor: { type: 'user', name: 'Rae Lin' }, at: new Date().toISOString() });
  await db.collection(`${T}/auditLogs`).doc('lastweek').set({ action: 'counter.refund', kind: 'refund', cents: 100, summary: 'Old', actor: { type: 'user', name: 'Mo Diaz' }, at: new Date(Date.now() - 8 * 86400000).toISOString() });

  console.log('the day');
  let r = await P({ action: 'list' });
  check('today, newest first: the money moments only (not payroll, not last week), with an older line read by its name', r.body.ok && r.body.lines.length === 4 && r.body.lines.every((l: any, i: number, a: any[]) => !i || a[i - 1].at >= l.at)
    && r.body.lines.some((l: any) => l.id === 'older' && l.kind === 'comp' && l.cents === 450) && !r.body.lines.some((l: any) => l.id === 'notmoney' || l.id === 'lastweek'), r.body.lines);
  check('…the day’s totals, what’s worth a look, and who', r.body.totals.refund.n === 2 && r.body.totals.refund.cents === 3240 && r.body.totals.void.n === 1 && r.body.flagged.length === 1
    && r.body.people.join(',') === 'Kai Park,Mo Diaz' && r.body.timeZone === 'America/New_York', r.body);
  const auto = r.body.lines.find((l: any) => l.ref === 'Order #1042');
  check('…an automatic refund says so', auto?.auto === true && auto.where === 'online');
  r = await P({ action: 'list', day: '2099-01-01' });
  check('a day after today is today', r.body.day === r.body.today);
  actor = { uid: 'u-admin', name: 'Dee Admin', role: 'admin', caps: [] };
  r = await P({ action: 'list' });
  const ra = await P({ action: 'rules' });
  const rs = await P({ action: 'saveRules', rules: { comp: 'anyone', refundSelfCents: 10000 } });
  check('an admin sees Activity and the rules, but only the owner changes them (an admin can’t loosen “only you”)', r.body.ok && r.body.canChange === false && ra.body.ok && ra.body.canChange === false && rs.status === 403 && !(await get(T)).moneyRules, [rs.body]);
  actor = { uid: 'u-owner', name: 'Rae Lin', role: 'owner', isTenantOwner: true, caps: [] };
  allow = false;
  r = await P({ action: 'list' });
  const r2 = await P({ action: 'saveRules', rules: { comp: 'anyone' } });
  check('only the owner and admins', r.status === 403 && r2.status === 403 && !(await get(T)).moneyRules);
  allow = true;

  for (let i = 0; i < 1200; i++) await db.collection(`${T}/auditLogs`).doc(`noise${i}`).set({ action: 'stock.count', summary: 'Counted', actor: { type: 'user', name: 'Kai Park' }, at: new Date(Date.now() - 1000 + i / 10).toISOString() });
  r = await P({ action: 'list' });
  check('a busy day of other lines never crowds out the money ones', r.body.lines.length === 4 && r.body.totals.refund.n === 2, r.body.lines.map((l: any) => [l.id, l.kind, l.action]));
  for (let i = 0; i < 1200; i++) await db.doc(`${T}/auditLogs/noise${i}`).delete();

  console.log('who can do what');
  r = await P({ action: 'rules' });
  check('as today until changed, with what’s worth a look and the online shop’s automatic refunds', r.body.ok && r.body.rules.comp === 'manager' && r.body.rules.noSale === 'anyone' && r.body.alerts.refundOverCents === 5000 && r.body.auto.cents === 2500, r.body);
  r = await P({ action: 'saveRules', rules: { comp: 'anyone', refundSelfCents: 1000 } });
  check('changed: kept, and a line in the audit log saying what changed', r.body.ok && r.body.rules.comp === 'anyone' && r.body.rules.refundSelfCents === 1000 && (await get(T)).moneyRules.comp === 'anyone'
    && (await db.collection(`${T}/auditLogs`).get()).docs.some((d: any) => d.data().action === 'rule.money' && /On the house: Anyone/.test(d.data().summary) && /\$10\.00/.test(d.data().summary)), r.body);
  const rl = (await P({ action: 'list' })).body.lines.find((l: any) => l.kind === 'rules');
  check('…and the change is in Activity, by the owner', rl && rl.by === 'Rae Lin' && /On the house: Anyone/.test(rl.reason || '') && (await import('../../src/lib/activity')).lineTitle(rl) === 'Who can do what changed', rl);
  r = await P({ action: 'saveRules', rules: { comp: 'everyone' } });
  const r3 = await P({ action: 'saveRules', rules: { refundSelfCents: 50000 } });
  check('only the choices there are', r.status === 400 && r3.status === 400 && (await get(T)).moneyRules.comp === 'anyone');
  r = await P({ action: 'saveRules', alerts: { refundOverCents: 2500 } });
  check('big refunds from $25', r.body.alerts.refundOverCents === 2500 && (await get(T)).moneyRules.comp === 'anyone' && (await get(T)).moneyRules.refundSelfCents === 1000, r.body);
  r = await P({ action: 'saveRules', alerts: { refundOverCents: null } });
  check('…or none', r.body.alerts.refundOverCents === null);
  r = await P({ action: 'saveRules', autoBelowCents: 5000 });
  check('the online shop’s automatic refunds, up to $50', r.body.auto.cents === 5000 && (await get(T)).retailSettings.policies.refundAutoBelowCents === 5000, r.body);
  await db.doc('tenants/t2').set({ name: 'No shop' });
  r = await POST(req({ tenantId: 't2', action: 'saveRules', autoBelowCents: 1000 }));
  const r4 = await POST(req({ tenantId: 't2', action: 'rules' }));
  check('…only for a business with an online shop', r.status === 409 && r4.body.auto === null);
  const before = (await db.collection(`${T}/auditLogs`).get()).docs.length;
  r = await P({ action: 'saveRules' });
  check('nothing to change: said, nothing written', r.status === 400 && (await db.collection(`${T}/auditLogs`).get()).docs.length === before);

  console.log('every refund, online too');
  const rr = src('src/app/api/retail/refund/route.ts');
  check('the online shop’s refunds are lines in Activity: who sent them, or the shop’s rules on their own', /logMoney\(db, tenantId, \{ action: 'retail\.refund', kind: 'refund'/.test(rr) && /where: 'online'/.test(rr) && /auto: autoLine/.test(rr)
    && /const autoLine = actor\.uid === 'system' \|\| actor\.uid === 'customer';/.test(rr));
  const A = await import('../../src/lib/activity');
  const t = (action: string, kind: any) => A.lineTitle({ id: 'x', at: '', kind, action, cents: null, where: null, by: null, okBy: null, reason: null, ref: null, summary: '', auto: false, flag: null });
  check('cash moves by what they were; on the house charged again; a menu price again', t('counter.drawer_in', 'cash') === 'Cash in' && t('counter.drawer_out', 'cash') === 'Paid out' && t('counter.drawer_safe', 'cash') === 'Cash to the safe'
    && t('counter.uncomp', 'comp') === 'Charged again' && t('counter.price_back', 'price') === 'Menu price again' && t('counter.void', 'void') === 'Void');

  console.log('the page');
  const pg = src('src/app/(app)/activity/page.tsx');
  check('two tabs: Activity and Who can do what', /\['activity', 'Activity'\], \['rules', 'Who can do what'\]/.test(pg) && /role="tablist"/.test(pg));
  check('layout B: today at a glance (a tap shows just those), worth a look, then everything by kind or by person', /at a glance/.test(pg) && /Worth a look/.test(pg) && /Everything/.test(pg) && /setKind\(on \? 'all' : k\.id\)/.test(pg) && /<option value="all">Everyone<\/option>/.test(pg));
  check('today’s, as it happens: read again every minute while it’s on screen', /setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) void load\(\); \}, 60000\)/.test(pg) && /Only the owner changes who can do what/.test(pg));
  check('each rule a radio group of three, 44px', /role="radiogroup" aria-label=\{x\.label\}/.test(pg) && /min-h-\[44px\]/.test(pg));
  const side = src('src/components/shared/AppSidebar.tsx');
  check('in the sidebar, beside Money', /\{ href: '\/activity',\s+icon: [A-Za-z]+,\s+label: 'Activity'\s*\}/.test(side));

  console.log('only the owner will do');
  for (const f of ['src/components/pos/CounterComp.tsx', 'src/components/pos/CounterRefund.tsx', 'src/components/pos/CounterPrice.tsx', 'src/components/pos/CounterTakeOff.tsx', 'src/components/pos/DrawerMove.tsx']) {
    const s = src(f);
    check(`${f}: the PIN asked for is the owner’s when only they will do`, /pinTitle\(owner\)/.test(s) && /setOwner\(!!d\.owner\)/.test(s));
  }
  const cp = src('src/app/(app)/counter/page.tsx'), dp = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('…and on the counter and the window’s own prompts', (cp.match(/setPinOwner\(!!d\.owner\)/g) || []).length === 4 && (cp.match(/title=\{pinTitle\(pinOwner\)\}/g) || []).length === 5
    && (dp.match(/setPinOwner\(!!d\.owner\)/g) || []).length === 3 && (dp.match(/title=\{pinTitle\(pinOwner\)\}/g) || []).length === 3 && /pinTitle = \(owner\?: boolean\) => \(owner \? 'The owner’s PIN' : 'A manager’s PIN'\)/.test(src('src/components/kitchen/PinPad.tsx')));

  console.log('house style');
  for (const f of ['src/app/(app)/activity/page.tsx', 'src/app/api/activity/route.ts']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no old trade words, no comments in markup`, !/\buppercase\b|font-black| · |\{\/\*/.test(s) && !/\b(salon|stylist|booth|chair|studio)s?\b/i.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
