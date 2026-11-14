// Checks closing the night (L20 round 2): lib/night-close, lib/night-close-server, api/close, the kitchen screen's Closing
// sheet, and where it shows.
// - The checklist is the business's own (cleaned), or the usual one. A temperature needs a reading; one outside its
//   limit needs a few words and is flagged. Ticks can be taken back until the night closes.
// - The night closes only with no drawer open and (unless the business allows) the checklist done; once, by a manager.
// - The report adds up: sales by hour and by how guests paid (a split counted by its parts), guests at tables, comps and
//   voids by reason and person, waste, drawers over or short, and what's worth a look.
// - Closing approves the night's tip shares when tips are shared by the day (the same run the Money page uses), and
//   emails the report to whoever the business picked, else the business's own email.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/night-close.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const server: any = { uid: 's1', name: 'Mo Diaz', role: 'staff', isManager: false, caps: [] };
const boss: any = { uid: 'm1', name: 'Dana Fox', role: 'manager', isManager: true, caps: [] };
let actor: any = server;
const sent: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, x: any) => { sent.push(x); return { ok: true }; } });
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { brandFromTenant: (t: any) => ({ shopName: t?.name || 'Shop', brandColor: '#16171a' }), brandedEmail: (_b: any, body: string) => `<html>${body}</html>` });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: () => 'Bearer test' }, nextUrl: { origin: 'https://x.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const N = await import('../../src/lib/night-close');
  console.log('the checklist');
  const d = N.closeSettingsOf({});
  check('the usual checklist offered by default (fridges at most 41°F, the freezer at most 0°F), not holding up closing until the business saves its own', d.items.length === 6 && d.items.find((i) => i.id === 'walkin')?.maxF === 41 && d.items.find((i) => i.id === 'freezer')?.maxF === 0 && !d.requireChecklist && d.approveTips
    && N.closeSettingsOf({ closingSettings: { items: [{ label: 'Floors' }] } }).requireChecklist && !N.closeSettingsOf({ closingSettings: { items: [{ label: 'Floors' }], requireChecklist: false } }).requireChecklist);
  const own = N.closeSettingsOf({ closingSettings: { items: [{ label: '  Ice machine  ', kind: 'check', area: 'bar' }, { label: 'Ice machine', kind: 'check' }, { label: '' }, { label: 'Hot well', kind: 'temp', minF: 135, area: 'nowhere' }], requireChecklist: false, reportTo: ['a@x.com', 'a@x.com', ''] } });
  check('a business’s own list, cleaned: names, no repeated ids, a known area, its limits', own.items.length === 3 && own.items[0].label === 'Ice machine' && own.items[0].id !== own.items[1].id && own.items[2].area === 'anyone' && own.items[2].minF === 135 && !own.requireChecklist && own.reportTo.length === 1, own);
  const walk = d.items.find((i) => i.id === 'walkin')!;
  check('limits in words', N.limitWords(walk) === 'at most 41°F' && N.limitWords({ minF: 135, maxF: null }) === 'at least 135°F' && N.limitWords({ minF: 33, maxF: 41 }) === 'between 33°F and 41°F');
  const a = N.checkMark(walk, {}), b2 = N.checkMark(walk, { value: 44 }), c = N.checkMark(walk, { value: 44, note: 'Moved dairy to the walk-in' }), e = N.checkMark(walk, { value: '38' });
  check('a temperature needs a reading; outside its limit it needs a few words', !a.ok && !b2.ok && /outside at most 41°F/.test((b2 as any).error) && c.ok && (c as any).mark.out === true && e.ok && (e as any).mark.out === false && (e as any).mark.value === 38);
  const dr = { ...d, requireChecklist: true };
  check('the night won’t close with a drawer open, or with the checklist undone (unless allowed)', !N.canClose(dr, {}, 1).ok && /drawer is still open/.test(N.canClose(dr, {}, 1).why!) && !N.canClose(dr, {}, 0).ok && N.canClose(d, {}, 0).ok);

  console.log('the report');
  const rep = N.nightReport({ day: '2026-11-14', timeZone: 'America/New_York',
    sales: [{ at: '2026-11-14T23:10:00.000Z', net: 77, total: 100, tip: 15, tax: 8, method: 'card' }, { at: '2026-11-14T23:40:00.000Z', net: 46, refunded: 6, total: 50, tip: 0, tax: 4, method: 'cash' },
      { at: '2026-11-15T01:05:00.000Z', net: 64, total: 80, tip: 10, tax: 6, method: 'split', payments: [{ method: 'card', amount: 40, tip: 10 }, { method: 'cash', amount: 30 }] }],
    tables: [{ covers: 4 }, { covers: 2 }],
    adjustments: [{ kind: 'comp', amount: 16, reason: 'Took too long', askedBy: 'Sam', approverName: 'Dana', itemName: 'Burrata' }, { kind: 'comp', amount: 9, reason: 'Took too long', askedBy: 'Jo', approverName: 'Jo', itemName: 'Fries' },
      { kind: 'void_item', amount: 4, reason: 'Rung in by mistake', askedBy: 'Sam', approverName: 'Sam', started: false, itemName: 'Espresso' }, { kind: 'void_item', amount: 34, reason: 'Changed their mind', askedBy: 'Sam', approverName: 'Priya', started: true, wasteCost: 11.4, itemName: 'Steak' },
      { kind: 'remake', amount: 0, reason: 'Dropped or spilled', askedBy: 'Jo', approverName: 'Jo', started: true, wasteCost: 5.2, itemName: 'Risotto' }],
    tills: [{ openedBy: 'Dana', openingFloat: 200, expectedCash: 280, actualCash: 276, status: 'closed' }],
    tips: { mode: 'tipout', rows: [{ name: 'Sam', role: 'provider', earned: 25, shared: -2.5, takesHome: 22.5 }] },
    items: d.items, checks: { walkin: { done: true, value: 44, note: 'Moved dairy', out: true, by: 'Mo', at: '' } }, usualComps: 5 });
  check('sales are what was sold (before tax and tips, after discounts, less refunds); taken, tips and tax beside them', rep.sales.total === 181 && rep.sales.taken === 230 && rep.sales.refunds === 6 && rep.sales.tips === 25 && rep.sales.tax === 18 && rep.sales.count === 3, rep.sales);
  check('by hour, in the business’s time zone', rep.sales.byHour.map((h) => `${h.hour}:${h.amount}`).join(',') === '6p:123,8p:64', rep.sales.byHour);
  check('how guests paid counts a split by its parts', JSON.stringify(rep.sales.byMethod) === JSON.stringify([{ method: 'Card', amount: 150 }, { method: 'Cash', amount: 80 }]), rep.sales.byMethod);
  check('guests at tables, and the average per guest', rep.guests.covers === 6 && rep.guests.tables === 2 && rep.guests.perGuest === 30.17, rep.guests);
  check('comps by reason and by person', rep.comps.total === 25 && rep.comps.byReason[0].label === 'Took too long' && rep.comps.byReason[0].count === 2 && rep.comps.byPerson.length === 2);
  check('voids before and after the kitchen started, and waste from voids and remakes', rep.voids.before.count === 1 && rep.voids.after.amount === 34 && rep.waste === 16.6 && rep.remakes.count === 1);
  check('the drawer over or short', rep.drawers[0].overShort === -4);
  check('worth a look: a reading out of its limit, a short drawer, comps well above a usual night', rep.flags.length === 3 && /Walk-in fridge read 44°F, at most 41°F\. Moved dairy/.test(rep.flags[0]) && /Dana’s drawer was short \$4\.00/.test(rep.flags[1]) && /about 5 times a usual Saturday/.test(rep.flags[2]), rep.flags);
  const txt = N.reportText('Linden', rep);
  check('the email says it plainly', /Sales \$181\.00 from 3 sales, after discounts and \$6\.00 refunded\. Taken \$230\.00 with tax \$18\.00 and tips \$25\.00\./.test(txt) && /Voids \$38\.00 \(2\): 1 before the kitchen started, 1 after\./.test(txt) && /Waste, cost to make: \$16\.60\./.test(txt) && /Worth a look/.test(txt), txt);

  console.log('closing, on the server');
  const R = await import('../../src/app/api/close/route');
  const S = await import('../../src/lib/night-close-server');
  const call = async (body: any) => R.POST(req({ tenantId: 't1', ...body })) as any;
  await db.doc(T).set({ name: 'Linden', email: 'owner@linden.test', timeZone: 'America/New_York', tipSharing: { mode: 'tipout', period: 'day', tipouts: [{ to: 'assistant', pct: 10 }] }, closingSettings: { requireChecklist: true } });
  const day = S.tonight({ timeZone: 'America/New_York' });
  const b = S.nightBounds({ timeZone: 'America/New_York' }, day);
  check('the night runs cutover to cutover in the business’s time zone', b.start < b.end && Date.parse(b.end) - Date.parse(b.start) >= 23 * 3600000 && Date.parse(b.end) - Date.parse(b.start) <= 25 * 3600000, b);
  const mid = new Date((Date.parse(b.start) + Date.parse(b.end)) / 2).toISOString();
  await db.doc(`${T}/receipts/r1`).set({ date: mid, subtotal: 95, discount: 4, total: 120, tip: 20, tax: 9, paymentMethod: 'card', refunds: [{ cents: 500, at: mid }] });
  await db.doc(`${T}/receipts/r2`).set({ date: mid, total: 999, tip: 0, tax: 0, paymentMethod: 'card', voided: true });
  await db.doc(`${T}/receipts/r3`).set({ date: new Date(Date.parse(b.start) - 3600000).toISOString(), total: 500, tip: 0, tax: 0, paymentMethod: 'cash' });
  await db.doc(`${T}/counterOrders/o1`).set({ day: '2099-01-01', paidAt: mid, subtotal: 11.5, total: 12.5, tax: 1, payMethod: 'cash' });
  await db.doc(`${T}/counterOrders/o2`).set({ day, total: 30 });
  await db.doc(`${T}/counterOrders/o3`).set({ day, paidAt: new Date(Date.parse(b.end) + 60000).toISOString(), subtotal: 40, total: 40 });
  await db.doc(`${T}/approvals/c1`).set({ kind: 'comp', day, used: true, amount: 16, reason: 'Took too long', askedBy: 'Sam' });
  await db.doc(`${T}/approvals/c2`).set({ kind: 'comp', day, used: false, amount: 99, reason: 'Pending' });
  await db.doc(`${T}/approvals/t9`).set({ kind: 'tally', day, cents: 1600 });
  await db.doc(`${T}/appointments/v1`).set({ isTable: true, partySize: 4, startTime: mid });
  await db.doc(`${T}/appointments/v2`).set({ startTime: mid, clientName: 'A facial' });
  await db.doc(`${T}/tillSessions/till1`).set({ openedAt: b.start, openedBy: 'Dana', status: 'open', openingFloat: 200, expectedCash: 212.5 });

  let r = await call({ action: 'state' });
  check('anyone sees tonight’s checklist; only a manager sees the report', r.body.ok && r.body.day === day && r.body.settings.items.length === 6 && r.body.report === null && r.body.openTills === 1 && !r.body.manager, r.body);
  r = await call({ action: 'check', itemId: 'walkin', value: 45 });
  check('a reading over its limit without a word is refused', r.status === 400 && /What was done|Say what was done/.test(r.body.error), r.body);
  r = await call({ action: 'check', itemId: 'walkin', value: 45, note: 'Door was open, closed it, rechecked at 40' });
  check('…with a few words it’s kept, flagged, under the person’s name', r.body.ok && r.body.mark.out === true && r.body.mark.by === 'Mo Diaz' && (await get(`${T}/nightCloses/${day}`)).checks.walkin.value === 45);
  r = await call({ action: 'check', itemId: 'floors' });
  check('a tick', r.body.ok && r.body.mark.done === true);
  r = await call({ action: 'check', itemId: 'floors', done: false });
  check('…and it can be taken back', r.body.ok && r.body.mark === null && !(await get(`${T}/nightCloses/${day}`)).checks?.floors);
  r = await call({ action: 'check', itemId: 'nope' });
  check('something not on the list is refused', r.status === 404);
  r = await call({ action: 'close' });
  check('only a manager closes', r.status === 403);
  r = await call({ action: 'check', day: '2020-01-01', itemId: 'floors' });
  check('only a manager changes an earlier night', r.status === 403);

  actor = boss;
  r = await call({ action: 'state' });
  const live = r.body.report;
  check('a manager sees the report building: tonight’s receipts and counter orders paid tonight (whatever day they were started), less discounts and refunds, not voided or other nights', live.sales.total === 97.5 && live.sales.taken === 132.5 && live.sales.refunds === 5 && live.sales.tips === 20 && live.sales.count === 2, live.sales);
  check('…used comps only, guests from tables only, and the open drawer', live.comps.total === 16 && live.comps.count === 1 && live.guests.covers === 4 && live.guests.tables === 1 && live.drawers.length === 1 && live.drawers[0].status === 'open');
  r = await call({ action: 'close' });
  check('it won’t close with a drawer open', r.status === 409 && /drawer is still open/.test(r.body.error), r.body);
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'closed', closedAt: mid, actualCash: 210 }, { merge: true });
  r = await call({ action: 'close' });
  check('…or with the checklist undone', r.status === 409 && /5 items are left/.test(r.body.error), r.body);
  for (const id of ['reachin', 'freezer', 'barfridge']) await call({ action: 'check', itemId: id, value: id === 'freezer' ? -2 : 38 });
  for (const id of ['equipment', 'floors']) await call({ action: 'check', itemId: id });
  r = await call({ action: 'close' });
  const nc = await get(`${T}/nightCloses/${day}`);
  check('closed: the report kept as it stood, under the manager’s name', r.body.ok && nc.status === 'closed' && nc.closedBy === 'Dana Fox' && nc.report.sales.total === 97.5 && nc.report.drawers[0].overShort === -2.5, nc);
  check('…the flags kept with it', nc.report.flags.some((f: string) => /Walk-in fridge read 45°F/.test(f)) && nc.report.flags.some((f: string) => /short \$2\.50/.test(f)));
  check('…the report emailed to the business’s own email when nobody is listed', sent.length === 1 && sent[0].to === 'owner@linden.test' && /Linden: \w+ night, \$97\.50/.test(sent[0].subject) && nc.emailedTo?.[0] === 'owner@linden.test', sent[0]?.subject);
  const run = await get(`${T}/tipShareRuns/night_${day}`);
  check('…and the night’s tip shares approved for the night itself, cutover to cutover', r.body.tipsApproved === true && run?.status === 'approved' && run.approvedAtClose === true && run.start === b.start && run.end < b.end && nc.tipsApproved === true, run);
  check('…so a Money page run over any part of that night is refused, and a night already in an approved run isn’t approved again', !!(await S.approvedTipRunOver(db, T, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)) && !(await S.approvedTipRunOver(db, T, b.start, run.end, `night_${day}`))
    && /approvedTipRunOver\(db, T, start, end, key\(start, end\)\)/.test(src('src/app/api/tips/share/route.ts')) && /already in a run approved for/.test(src('src/app/api/close/route.ts')));
  r = await call({ action: 'close' });
  check('a night closes once', r.status === 409);
  actor = server;
  r = await call({ action: 'check', itemId: 'floors', done: false });
  check('a closed night’s checklist stays as it was', r.status === 409);
  actor = boss;
  r = await call({ action: 'send' });
  check('send again', r.body.ok && sent.length === 2);
  r = await call({ action: 'history' });
  check('closed nights listed', r.body.ok && r.body.rows.length === 1 && r.body.rows[0].sales === 97.5);

  r = await call({ action: 'settings', items: [{ label: 'Hot well', kind: 'temp' }] });
  check('a temperature needs a limit', r.status === 400 && /limit/.test(r.body.error));
  r = await call({ action: 'settings', items: [{ label: 'Ice machine cleaned', kind: 'check', area: 'bar' }, { label: 'Hot well', kind: 'temp', minF: 135, area: 'kitchen' }], requireChecklist: false, reportTo: ['dana@linden.test', 'bad'], approveTips: false });
  const ts = (await get(T)).closingSettings;
  check('a manager sets the checklist, the rule and the tips at close', r.body.ok && ts.items.length === 2 && ts.items[1].minF === 135 && ts.requireChecklist === false && ts.approveTips === false, ts);
  check('…and who gets the report, kept where only the server reads it (the business’s record is public)', !ts.reportTo && JSON.stringify((await get(`${T}/private/closing`)).reportTo) === JSON.stringify(['dana@linden.test', 'bad']) && JSON.stringify(r.body.settings.reportTo) === JSON.stringify(['dana@linden.test', 'bad']));
  check('…and the report only goes to real addresses', JSON.stringify(await S.reportRecipients(db, T, { email: 'o@x.test' }, ['dana@linden.test', 'bad'])) === JSON.stringify(['dana@linden.test']));
  actor = server;
  r = await call({ action: 'settings', requireChecklist: true });
  check('…a server can’t', r.status === 403);

  console.log('where it shows');
  const kr = src('src/app/api/kitchen/route.ts');
  check('the kitchen screen has its own Closing list (the kitchen’s, the bar’s and anyone’s), saved the same way, and can’t tick the front’s', /action === 'closing' \|\| action === 'closingCheck'/.test(kr) && /items: closeSettingsOf\(tenant\)\.items\.filter\(\(i\) => i\.area !== 'front'\)/.test(kr) && /staff\?\.name \|\| screen\.name, \['kitchen', 'bar', 'anyone'\]\)/.test(kr));
  const fr = await S.recordCheck(db, T, { closingSettings: { items: [{ id: 'menus', label: 'Menus wiped', area: 'front' }] } }, '2099-12-31', 'menus', {}, 'Kitchen screen', ['kitchen', 'bar', 'anyone']);
  check('…refused for a front item', !fr.ok && (fr as any).status === 403);
  check('a tip run is paid in the period it starts in (a night’s run ends after midnight), in payroll, pay stubs, statements and Money',
    [src('src/lib/payroll-draft.ts'), src('src/lib/pay-stub.ts'), src('src/lib/pay-statement.ts'), src('src/app/(app)/money/page.tsx')].every((x) => /String\(r\.start \|\| ''\) > (periodEnd\.toISOString\(\)|toIso|to|b)\) continue;/.test(x) && !/String\(r\.end \|\| ''\) > (periodEnd\.toISOString\(\)|toIso|to|b)\) continue;/.test(x)));
  const rules = src('firestore.rules');
  check('closing records and tip runs: no browser writes; managers (and people who see the money) read', /match \/tenants\/\{tenantId\}\/nightCloses\/\{day\} \{\s+allow read: if isManager\(tenantId\);\s+allow write: if false;/.test(rules)
    && /match \/tenants\/\{tenantId\}\/tipShareRuns\/\{runId\} \{\s+allow read: if isManager\(tenantId\) \|\| \(inDirectory\(tenantId\) && 'money\.view' in dirEntry\(\)\.data\.get\('caps', \[\]\)\);\s+allow write: if false;/.test(rules) && /'payrollRuns', 'nightCloses', 'tipShareRuns',/.test(rules));
  check('a business that saves its own checklist has it required unless it says otherwise', /else if \(!Array\.isArray\(tenant\?\.closingSettings\?\.items\)\) next\.requireChecklist = true;/.test(src('src/app/api/close/route.ts')) && /requireChecklist: true \}\); setItems/.test(src('src/app/(app)/settings/closing/page.tsx')));
  check('comps, voids and the night’s report count the same night', /const day = tonight\(tenant\);/.test(src('src/app/api/tab/route.ts')));
  const kds = src('src/app/kds/[tenantId]/page.tsx');
  check('…behind a Closing button', /setClosingOpen\(true\)\} className=\{btn\} style=\{quiet\}>Closing</.test(kds) && /<ClosingSheet /.test(kds));
  check('Close the night is in the sidebar and part of Lounge & hospitality', /href: '\/close',\s+icon: Moon,\s+label: 'Close the night'/.test(src('src/components/shared/AppSidebar.tsx')) && /'\/close', '\/settings\/closing'/.test(src('src/lib/modules.ts')));
  const reg = src('src/lib/settings-registry.ts');
  check('both settings can be found in Settings', /id: 'closing', title: 'Closing the night'/.test(reg) && /id: 'tableservice', title: 'Tables, kitchen and bar'/.test(reg));
  const ui = [src('src/app/(app)/close/page.tsx'), src('src/components/close/NightReportView.tsx'), src('src/components/kitchen/ClosingSheet.tsx'), src('src/app/(app)/settings/closing/page.tsx')];
  check('new screens keep to the house style', !ui.some((x) => /\{\/\*|uppercase|font-black| · /.test(x)) && !ui.some((x) => /\b(studio|salon|stylist|booth)\b/i.test(x.replace(/\/\/.*$/gm, ''))));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
