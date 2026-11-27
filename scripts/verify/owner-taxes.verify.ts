// Checks the owner's tax set-aside (the Money page's Taxes tab; api/owner-taxes, lib/owner-taxes-server,
// lib/report-builders scheduleCTotals and profitByMonth, components/money/TaxSetAside and OwnerTaxes):
//   For a business that files on Schedule C: the books' tentative profit month by month, the same as the Tax summary in
//   Reports (meals in part, owner draws not a cost, a take-back read as what it takes back, a line from before the year
//   it takes back found), less business miles from the owner's mileage log. A business that files its own return gets
//   a note to ask its accountant. The owner's alone (not others who keep the books). What they say and the payments they
//   record kept with the business, server only. The week before each date: a note in ClarityFlow for the owner and, if
//   they asked, an email, each once, tried again if it didn't go; the business's message log keeps only that it went.
//   The Taxes tab is the owner's only.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/owner-taxes.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { scheduleCTotals, profitByMonth, taxSummaryRows, rowsCsv } from '../../src/lib/report-builders';

const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = makeDb(); let actor: any = { id: 'u1', uid: 'u1', name: 'Jess', isTenantOwner: true };
const sent: any[] = []; let failMail = false;
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor, tenant: null }) };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [] };
  if (request === '@/lib/geocode-server') return { geocode: async () => null, reverseGeocode: async () => null, preciseEnough: () => false };
  if (request === '@/lib/route-server') return { roadLegs: async () => null };
  if (request === '@/lib/notify') return { sendNotification: async (_d: any, x: any) => { if (failMail) { failMail = false; return { ok: false, status: 'failed' }; } sent.push(x); return { ok: true }; } };
  if (request === '@/lib/email-template') return { brandedEmailHtml: (x: any) => `<h1>${x.title}</h1>${x.bodyLines.join('<br>')}` };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const req = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;

(async () => {
  console.log('Profit, as the Tax summary works it out');
  const Y = 2026;
  const lines: any[] = [
    { id: 's1', type: 'income', category: 'Services', amount: 5000, date: `${Y}-01-10T15:00:00.000Z`, context: 'Business' },
    { id: 'e1', type: 'expense', category: 'Supplies', amount: 800, date: `${Y}-01-12T15:00:00.000Z`, context: 'Business' },
    { id: 'm1', type: 'expense', category: 'Meals & Entertainment', amount: 200, date: `${Y}-01-15T15:00:00.000Z`, context: 'Business' },
    { id: 'd1', type: 'expense', category: 'Distribution', taxBucket: 'transfer', amount: 1500, date: `${Y}-01-20T15:00:00.000Z`, context: 'Business' },
    { id: 'p1', type: 'expense', category: 'Supplies', amount: 300, date: `${Y}-01-21T15:00:00.000Z`, context: 'Personal' },
    { id: 's2', type: 'income', category: 'Services', amount: 4000, date: `${Y}-02-03T15:00:00.000Z`, context: 'Business' },
    { id: 'r1', type: 'reversal', reversalOf: 's0', reversedType: 'income', category: 'Services', amount: 250, date: `${Y}-02-05T15:00:00.000Z`, context: 'Business' },
  ];
  const old = { id: 's0', type: 'income', category: 'Services', amount: 250, date: `${Y - 1}-12-20T15:00:00.000Z`, context: 'Business' };
  const jan = scheduleCTotals(lines.filter((l) => l.date.startsWith(`${Y}-01`)), { lookup: [...lines, old] });
  const rows = rowsCsv(taxSummaryRows(lines.filter((l) => l.date.startsWith(`${Y}-01`)), { lookup: [...lines, old] }));
  check('a month’s profit: sales less costs, half of a meal, an owner draw and a personal purchase not costs; the same as the Tax summary’s', Math.round(jan.profit) === 5000 - 800 - 100
    && rows.some((r: any) => /Tentative profit/.test(String(r[1])) && Math.round(Number(r[2])) === Math.round(jan.profit)), jan.profit);
  const byM = profitByMonth(lines, Y, [...lines, old]);
  check('month by month; a take-back reads the line from before the year it takes back', byM[`${Y}-01`] === 410000 && byM[`${Y}-02`] === (4000 - 250) * 100, byM);

  console.log('The route');
  await db.doc('tenants/t1').set({ name: 'North Loft', timezone: 'America/New_York', taxState: 'NC', ownerId: 'u1', ownerEmail: 'jess@example.com' });
  for (const l of lines) await db.doc(`tenants/t1/transactions/${l.id}`).set({ ...l, date: l.date.slice(0, 10) });
  await db.doc('tenants/t1/transactions/s0').set({ ...old, date: old.date.slice(0, 10) });
  await db.doc('tenants/t1/private/trip_a').set({ kind: 'trip', id: 'a', year: Y, day: `${Y}-01-05`, use: 'business', tenths: 200, removed: null });
  await db.doc('tenants/t1/private/trip_b').set({ kind: 'trip', id: 'b', year: Y, day: `${Y}-01-06`, use: 'commute', tenths: 200, removed: null });
  const POST: (r: any) => Promise<any> = (await import('../../src/app/api/owner-taxes/route')).POST as any;
  actor = { id: 'u2', uid: 'u2', name: 'Sam', isTenantOwner: false };
  let r: any = await POST(req({ action: 'list' }));
  check('someone else who keeps the books: not theirs to see', r.status === 403);
  actor = { id: 'u1', uid: 'u1', name: 'Jess', isTenantOwner: true };
  r = await POST(req({ action: 'list' }));
  const b = r.body; const PY = b.year;
  check('the owner: the books’ profit by month and business miles at the rate, not commuting', r.status === 200 && (PY !== Y || (b.earnedByMonth[`${Y}-01`] === 410000 && b.writeOffsByMonth[`${Y}-01`] === 1450)), b);
  check('not set up yet: how the business files to be said; the state from the business’s', b.settings.structure === null && b.settings.state === 'NC' && b.hasEmail === true);
  r = await POST(req({ action: 'settings', structure: 'llc' }));
  const ok: any = await POST(req({ action: 'settings', structure: 'schedule_c', filing: 'joint', other: '40,000' }));
  const kept: any = (await db.doc(`tenants/t1/private/ownerTaxes_${PY}`).get()).data();
  check('how the business files: Schedule C or its own return; kept with the business, server only', r.status === 400 && ok.status === 200 && kept.structure === 'schedule_c' && kept.filing === 'joint' && kept.otherCents === 4000000);
  r = await POST(req({ action: 'pay', date: `${PY}-04-10`, amount: '1,000', to: 'irs' }));
  check('a payment recorded', r.status === 200 && (await db.doc(`tenants/t1/private/ownerTaxes_${PY}`).get()).data().payments.length === 1);
  r = await POST(req({ action: 'remind', channel: 'email' }));
  check('reminders chosen', r.status === 200 && (await db.doc('tenants/t1/private/ownerTaxReminders').get()).data().channel === 'email');

  r = await POST(req({ action: 'list', figures: false }));
  check('after a save, what was said and paid without reading the books again', r.status === 200 && r.body.earnedByMonth === undefined && r.body.payments.length === 1);
  const fig: any = (await db.doc(`tenants/t1/private/ownerTaxes_${PY}`).get()).data().figures;
  const today = new Date().toISOString().slice(0, 10); const [ty, tm] = today.split('-').map(Number); const two = new Date(Date.UTC(ty, tm - 3, 1)).toISOString().slice(0, 7);
  check('months before last month kept once worked out, so a visit reads only the latest lines', PY !== ty || tm < 3 || (fig?.upTo === two && fig.months[`${Y}-01`] === 410000), fig);
  if (PY === Y && tm >= 3 && two >= `${Y}-02`) {
    await db.doc('tenants/t1/transactions/late').set({ id: 'late', type: 'income', category: 'Services', amount: 100, date: `${Y}-01-25`, context: 'Business' });
    const kept1: any = await POST(req({ action: 'list' })); const fresh1: any = await POST(req({ action: 'list', fresh: true }));
    check('a line added since to a kept month: counted when the year’s counted again', kept1.body.earnedByMonth[`${Y}-01`] === 410000 && fresh1.body.earnedByMonth[`${Y}-01`] === 420000 && !!fresh1.body.countedAt);
    await db.doc('tenants/t1/transactions/gas').set({ id: 'gas', type: 'expense', category: 'Vehicle', amount: 60, date: `${Y}-${String(tm).padStart(2, '0')}-01`, context: 'Business', description: 'Gas' });
    const car: any = await POST(req({ action: 'list' }));
    check('car costs in the books: miles aren’t taken off as well', car.body.milesLeftOut === true && Object.keys(car.body.writeOffsByMonth).length === 0);
    await db.doc('tenants/t1/transactions/gas').delete();
    await POST(req({ action: 'list', fresh: true }));
  }

  console.log('Reminders');
  const { remindOwnerTaxes, ownerTaxDueSoon } = await import('../../src/lib/owner-taxes-server');
  const tenant = (await db.doc('tenants/t1').get()).data();
  await db.doc(`tenants/t1/private/ownerTaxes_${Y}`).set({ structure: 'schedule_c', payments: [] }, { merge: true });
  const own = async () => 'jess@example.com';
  let o = await remindOwnerTaxes(db, 't1', tenant, `${Y}-06-09`, own);
  check('a week before: an email to the owner’s own address; the log keeps only that it went; nothing in the team’s notices', o === 1 && sent.length === 1 && sent[0].to === 'jess@example.com' && sent[0].privateToRecipient === true && /To stop these emails/.test(sent[0].html)
    && (await db.collection('tenants/t1/notifications').get()).docs.length === 0);
  o = await remindOwnerTaxes(db, 't1', tenant, `${Y}-06-10`, own);
  check('once per date', o === 0 && sent.length === 1);
  failMail = true; o = await remindOwnerTaxes(db, 't1', tenant, `${Y}-09-09`, own);
  const o2 = await remindOwnerTaxes(db, 't1', tenant, `${Y}-09-10`, own);
  check('an email that didn’t go is tried again', o === 0 && o2 === 1);
  check('the Money page’s reminder, for the owner: the week before, unless off or paid toward it', (await ownerTaxDueSoon(db, 't1', `${Y}-06-10`))?.due === `${Y}-06-15` && (await ownerTaxDueSoon(db, 't1', `${Y}-05-10`)) === null);
  await db.doc('tenants/t1/private/ownerTaxReminders').set({ channel: 'off' }, { merge: true });
  check('switched off: no reminder on the page', (await ownerTaxDueSoon(db, 't1', `${Y}-06-10`)) === null);
  await db.doc('tenants/t1/private/ownerTaxReminders').set({ channel: 'email' }, { merge: true });
  await db.doc(`tenants/t1/private/ownerTaxes_${Y}`).set({ structure: 'other' }, { merge: true });
  o = await remindOwnerTaxes(db, 't1', tenant, `${Y + 1}-01-10`, own);
  check('not for a business that files its own return', o === 0 && (await ownerTaxDueSoon(db, 't1', `${Y + 1}-01-10`)) === null);
  // (A new year with nothing said yet: last year's answer carries, so April's reminder still goes.)
  await db.doc(`tenants/t1/private/ownerTaxes_${Y + 1}`).set({ structure: 'schedule_c', payments: [] }, { merge: true });
  const { dueDay: dd } = await import('../../src/lib/renter-taxes'); const april = dd(Y + 2, 4); const weekBefore = new Date(Date.parse(`${april}T12:00:00Z`) - 6 * 86400e3).toISOString().slice(0, 10);
  o = await remindOwnerTaxes(db, 't1', tenant, weekBefore, own);
  check('a new year carries how the business files: its first reminder still goes', o === 1 && (await ownerTaxDueSoon(db, 't1', weekBefore))?.due === april);
  check('…and keeps it, so the year after still has it', (await db.doc(`tenants/t1/private/ownerTaxes_${Y + 2}`).get()).data()?.structure === 'schedule_c');
  const april3 = dd(Y + 3, 4); const wb3 = new Date(Date.parse(`${april3}T12:00:00Z`) - 6 * 86400e3).toISOString().slice(0, 10);
  await db.doc(`tenants/t1/private/ownerTaxes_${Y + 2}`).set({ structure: null }, { merge: true });
  check('a year nobody opened doesn’t break the chain', (await ownerTaxDueSoon(db, 't1', wb3))?.due === april3);
  r = await POST(req({ action: 'status' }));
  check('the page asks for it without reading the books', r.status === 200 && 'soon' in r.body);

  console.log('Where it is');
  const page = src('src/app/(app)/money/page.tsx'); const view = src('src/components/money/TaxSetAside.tsx');
  check('the Taxes tab, for the owner only', /const isOwner = hubRole === 'owner';/.test(page) && /\(t\.key !== 'taxes' \|\| isOwner\)/.test(page) && /isOwner && visitedTabs\.has\('taxes'\)/.test(page) && /if \(tab === 'taxes' && !isOwner\) return;/.test(page));
  check('a business with its own return: how its profit is taxed, and that its accountant works out the payments', /A partnership or an S corporation passes its profit to its owners’ own returns/.test(view) && /a corporation pays its own tax\. Your accountant works out those payments\./.test(view));
  check('the renter’s page is the same screen', /<TaxSetAside who="renter"/.test(src('src/components/rent/RenterTaxes.tsx')) && /<TaxSetAside key=\{tenantId\} who="owner"/.test(src('src/components/money/OwnerTaxes.tsx')));
  check('the nightly job sends the owner’s; the overview shows the owner alone the reminder', /remindOwnerTaxes\(db, tDoc\.id/.test(src('src/app/api/cron/nightly/route.ts')) && /\{isOwner && <OwnerTaxDueCard tenantId=\{tenantId\}/.test(page));
  const srv = src('src/lib/owner-taxes-server.ts');
  check('a failed read of the books is an error, never a year with nothing in it', /add\(await col\.where\('date', '>=', from\)\.where\('date', '<', `\$\{year \+ 1\}-01-01`\)\.get\(\)\);/.test(srv));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
