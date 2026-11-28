// Checks working out a home office (lib/home-office; components/money/HomeOfficeCalc, on the often-missed home office in
// the owner's Write-offs and a renter's): the simple way is $5 a square foot, up to 300 square feet, for the months used
// 15 days or more; the regular way an estimate from the home's size and its costs for the year. Kept with the answers
// (the owner's only by the owner), marked as answered, printed with the write-offs and in the year-end packets, and
// marking it another way leaves no figures to print. Also the loose ends from the One Money page and the year-end
// packet: a month's bank check for someone who can't read the bank, what an action on the bank did said wherever Books
// is scrolled to, and the year counted in the business's time zone.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/home-office.verify.tsx
import fs from 'fs';
import Module from 'module';
import { createHash } from 'crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as F from './fake-db';

const { check } = F;
const src = (f: string) => fs.readFileSync(f, 'utf8');
const db = F.makeDb(); let actor: any = { id: 'u1', name: 'Jess', isTenantOwner: true };
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor, tenant: { timezone: 'America/New_York', niche: 'nails' } }) };
  if (request === '@/lib/inspo-photos') return { ourBuckets: async () => ['cf-app.firebasestorage.app'] };
  if (request === '@/lib/audit') return { logAuditAdmin: async () => {} };
  if (request === '@/lib/here-server') return { bizLocationsOf: async () => [] };
  if (request === '@/lib/geocode-server') return { geocode: async () => null, reverseGeocode: async () => null, preciseEnough: () => false };
  if (request === '@/lib/route-server') return { roadLegs: async () => null };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

(async () => {
  const H = await import('../../src/lib/home-office');
  console.log('Working it out');
  const ok = (b: any) => { const r = H.cleanHomeOffice(b); if (!r.ok) throw new Error(r.error); return r.h; };
  check('the simple way: $5 a square foot for the year', H.homeOfficeFigures(ok({ officeSqft: '120', months: 12 })).simpleCents === 60000);
  check('up to 300 square feet ($1,500 for a whole year)', H.homeOfficeFigures(ok({ officeSqft: '400', months: 12 })).simpleCents === 150000 && H.homeOfficeFigures(ok({ officeSqft: '400', months: 12 })).sqftCounted === 300);
  check('for the months used', H.homeOfficeFigures(ok({ officeSqft: '200', months: 6 })).simpleCents === 50000);
  const reg = H.homeOfficeFigures(ok({ officeSqft: '200', months: 12, homeSqft: '1,000', costs: { housing: '18,000', utilities: '2400', insurance: '600', repairs: '1000.50' } }));
  check('the regular way, an estimate: the office’s share of the home times its costs', reg.sharePct === 20 && reg.costsCents === 2200050 && reg.regularCents === 440010, reg);
  check('no regular way without the home’s size or a cost', H.homeOfficeFigures(ok({ officeSqft: '200', months: 12, homeSqft: '1000' })).regularCents === null && H.homeOfficeFigures(ok({ officeSqft: '200', months: 12, costs: { housing: '900' } })).regularCents === null);
  check('what’s typed is checked: a size, 1 to 12 months, a home at least as big as the office, costs in dollars',
    !H.cleanHomeOffice({ officeSqft: '' }).ok && !H.cleanHomeOffice({ officeSqft: '0' }).ok && !H.cleanHomeOffice({ officeSqft: '100', months: 13 }).ok && !H.cleanHomeOffice({ officeSqft: '100', months: 0 }).ok
    && !H.cleanHomeOffice({ officeSqft: '100', homeSqft: '80' }).ok && !H.cleanHomeOffice({ officeSqft: '100', costs: { housing: 'lots' } }).ok && !H.cleanHomeOffice({ officeSqft: '100', costs: { housing: '-5' } }).ok);
  check('anything odd kept is never counted', H.homeOfficeOf({ officeSqft: 'x' }) === null && H.homeOfficeOf(null) === null && H.homeOfficeOf({ officeSqft: 150, months: 12, homeSqft: null, costs: { housing: 0 } })?.officeSqft === 150);
  const rows = H.homeOfficeRows(ok({ officeSqft: '400', months: 6, homeSqft: '1600', costs: { housing: '24000' } }));
  check('printed: the simple way, saying 300 counted, the months, the profit limit; the regular way as an estimate', rows.length === 2 && rows[0][1] === '$750.00' && /400 square feet, 300 of them counted, used 6 months/.test(rows[0][2]) && /profit/.test(rows[0][2])
    && /an estimate/.test(rows[1][0]) && rows[1][1] === '$3,000.00' && /25% of a home of 1,600 square feet, times \$24,000\.00/.test(rows[1][2]), rows);
  check('the regular way counts real estate taxes and HOA dues too', H.homeOfficeFigures(ok({ officeSqft: '100', months: 12, homeSqft: '1000', costs: { housing: '10000', taxes: '4000', hoa: '1200' } })).regularCents === 152000
    && /Use one way or the other, not both/.test(H.homeOfficeRows(ok({ officeSqft: '100', months: 12, homeSqft: '1000', costs: { taxes: '4000' } }))[1][2]));
  check('a short line for the screen', H.homeOfficeLine(ok({ officeSqft: '120', months: 12 })) === '$600.00 the simple way. From 120 square feet, used the whole year.');

  console.log('The calculator');
  const { HomeOfficeCalc } = await import('../../src/components/money/HomeOfficeCalc');
  const html = renderToStaticMarkup(<HomeOfficeCalc initial={ok({ officeSqft: '150', months: 12, homeSqft: '1500', costs: { housing: '12000' } })} onSave={() => {}} onCancel={() => {}} />);
  check('it opens with what was saved, worked out', /value="150"/.test(html) && />\$750\.00</.test(html) && /About <span[^>]*>\$1,200\.00<\/span> the regular way/.test(html) && /aria-expanded="true"/.test(html));
  check('says who it counts for, and that the accountant confirms it', /used regularly and only for the business/.test(html) && /Your accountant confirms it/.test(html) && /15 days or more/.test(html));
  const empty = renderToStaticMarkup(<HomeOfficeCalc onSave={() => {}} onCancel={() => {}} />);
  check('empty: asks for the size, and Save waits for it', /Put in the office’s size/.test(empty) && /disabled="" class="[^"]*"[^>]*>Save it</.test(empty) && /aria-expanded="false"/.test(empty));
  const calcSrc = src('src/components/money/HomeOfficeCalc.tsx');
  check('the house style, the portal’s too (no bold), 44px everywhere you tap', !/\buppercase\b|font-black|font-bold|\{\/\*| · /.test(calcSrc) && ![...calcSrc.matchAll(/>([^<>{}\n]*)</g)].some((m) => m[1].includes("'")) && (html.match(/min-h-\[44px\]|h-11/g) || []).length >= 8);

  console.log('The owner’s');
  const POST: (r: any) => Promise<any> = (await import('../../src/app/api/writeoffs/route')).POST as any;
  const req = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
  const Y = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date()));
  let r: any = await POST(req({ action: 'homeoffice', year: Y, officeSqft: '120', months: 12 }));
  const kept: any = (await db.doc('tenants/t1/private/writeOffs').get()).data();
  check('worked out: kept with the answers, and the home office marked answered', r.status === 200 && kept.homeOffice[String(Y)].officeSqft === 120 && kept.checklist[String(Y)].homeOffice === 'figured');
  r = await POST(req({ action: 'list', year: Y }));
  check('listed for the owner', r.body.homeOffice?.officeSqft === 120 && r.body.checklist.homeOffice === 'figured');
  actor = { id: 'u2', name: 'Kim', isManager: true };
  r = await POST(req({ action: 'list', year: Y }));
  check('anyone else who keeps the books never sees it', r.body.homeOffice === null && !r.body.checklist.homeOffice);
  r = await POST(req({ action: 'homeoffice', year: Y, officeSqft: '99', months: 12 }));
  check('and can’t change it', r.status === 403 && (await db.doc('tenants/t1/private/writeOffs').get()).data()!.homeOffice[String(Y)].officeSqft === 120);
  actor = { id: 'u1', name: 'Jess', isTenantOwner: true };
  r = await POST(req({ action: 'homeoffice', year: Y, officeSqft: '120', months: 14 }));
  check('a wrong one refused, saying why', r.status === 400 && /months/.test(r.body.error));
  r = await POST(req({ action: 'homeoffice', year: Y - 5, officeSqft: '120', months: 12 }));
  check('only this year or last', r.status === 400);
  await POST(req({ action: 'check', year: Y, item: 'homeOffice', answer: 'no' }));
  r = await POST(req({ action: 'list', year: Y }));
  check('marked Doesn’t apply after: nothing to print, but what was worked out is kept to start from again', r.body.homeOffice === null && r.body.checklist.homeOffice === 'no' && r.body.homeOfficeKept?.officeSqft === 120);
  actor = { id: 'u2', name: 'Kim', isManager: true };
  check('kept for the owner only', (await POST(req({ action: 'list', year: Y }))).body.homeOfficeKept === null);
  actor = { id: 'u1', name: 'Jess', isTenantOwner: true };
  await POST(req({ action: 'homeoffice', year: Y, officeSqft: '200', months: 12 }));
  await POST(req({ action: 'homeoffice', year: Y, clear: true }));
  r = await POST(req({ action: 'list', year: Y }));
  check('cleared: back to unanswered, nothing kept', r.body.homeOffice === null && !r.body.checklist.homeOffice && r.body.homeOfficeKept === null);

  const W = await import('../../src/lib/write-offs');
  const found = W.findWriteOffs([], Y, []);
  const body = W.writeOffsBodyHtml(found, null, { homeOffice: 'figured', phone: 'ask' }, { homeOffice: ok({ officeSqft: '120', months: 12 }) });
  check('printed with the write-offs; asked about only what was marked to ask', /Home office, the simple way/.test(body) && /\$600\.00/.test(body) && /<b>Your phone and internet<\/b>/.test(body) && !/<b>A home office<\/b>/.test(body));
  const P = await import('../../src/lib/year-end-packet');
  const wo = { found, checklist: { homeOffice: 'figured' }, homeOffice: { officeSqft: 120, months: 12, homeSqft: null, costs: { housing: 0, utilities: 0, insurance: 0, repairs: 0 } } };
  const pk = (owner: boolean) => P.packetBody({ year: Y, items: [], ls: [], lookup: [], wo, mi: null, ot: null, owner, w2s: [], necs: [] });
  check('the packet says it isn’t in the tax summary', /Business miles, the tip credit and a home office aren’t in it/.test(pk(true)));
  check('in the owner’s year-end packet, never in anyone else’s', /Home office, the simple way/.test(pk(true)) && !/Home office/.test(pk(false)));
  const items = P.yearItems({ year: Y, s: (await import('../../src/lib/books-summary')).booksSummary([], { businessOnly: true }), bankWaiting: 0, bankCapped: false, wo: { ...wo, checklist: { homeOffice: 'figured', phone: 'no', health: 'no', retirement: 'no', tips: 'no' } }, mi: null, ot: null, owner: true, payroll: null, tax: null, closedThrough: '', began: '', today: `${Y}-06-01`, unread: [] } as any);
  check('worked out counts as answered when closing the year', !items.some((i: any) => i.key === 'missed'));

  console.log('A renter’s');
  await db.doc('tenants/t1').set({ name: 'Glow Studio', timezone: 'America/New_York' });
  await db.doc('tenants/t1/private/renterSessions').set({ [sha('tok-ana')]: { renterId: 'r1', name: 'Ana', expiresAt: Date.now() + 3600e3 } });
  const RP: (r: any) => Promise<any> = (await import('../../src/app/api/portal/renter-writeoffs/route')).POST as any;
  const rq = (body: any) => ({ json: async () => ({ tenantId: 't1', token: 'tok-ana', ...body }), headers: { get: () => null } }) as any;
  r = await RP(rq({ action: 'homeoffice', year: Y, officeSqft: '90', months: 10, homeSqft: '900', costs: { housing: '15000' } }));
  const theirs: any = (await db.doc('tenants/t1/private/renter_r1/writeOffs/checklist').get()).data();
  check('kept privately with their own answers, marked answered', r.status === 200 && theirs.homeOffice[String(Y)].officeSqft === 90 && theirs[String(Y)].homeOffice === 'figured');
  r = await RP(rq({ action: 'list', year: Y }));
  check('listed back to them, worked out', r.body.homeOffice?.months === 10 && r.body.checklist.homeOffice === 'figured');
  const RW = await import('../../src/lib/renter-write-offs');
  const rhtml = RW.renterWriteOffsHtml({ found: r.body.found, rent: r.body.rent, space: r.body.space, miles: null, deskTipsCents: 0, checklist: r.body.checklist, missing: [], homeOffice: r.body.homeOffice });
  check('printed for their accountant, both ways', /Home office, the simple way/.test(rhtml) && /\$375\.00/.test(rhtml) && /the regular way, an estimate/.test(rhtml) && /\$1,250\.00/.test(rhtml));
  check('in their year-end packet too', /Home office, the simple way/.test(P.renterPacketBody({ year: Y, items: [], earnedByMonth: null, wo: r.body, mi: null, tx: null })));
  await RP(rq({ action: 'check', year: Y, item: 'homeOffice', answer: 'ask' }));
  r = await RP(rq({ action: 'list', year: Y }));
  check('marked Ask my accountant after: asked about, nothing printed, the figures kept to start from', r.body.homeOffice === null && r.body.checklist.homeOffice === 'ask' && r.body.homeOfficeKept?.officeSqft === 90
    && !/Home office/.test(RW.renterWriteOffsHtml({ found: r.body.found, rent: r.body.rent, space: r.body.space, miles: null, deskTipsCents: 0, checklist: r.body.checklist, missing: [], homeOffice: r.body.homeOffice })));

  console.log('The screens');
  const owner = src('src/components/money/WriteOffsScreen.tsx'); const renter = src('src/components/rent/RenterWriteOffs.tsx');
  for (const [name, s] of [['the owner’s', owner], ['a renter’s', renter]] as const) {
    check(`${name}: Work it out on the home office, Change it once it’s worked out, with what it comes to`, /\{figured \? 'Change it' : 'Work it out'\}/.test(s) && /homeOfficeLine\([a-z]\.homeOffice!\)/.test(s) && /<HomeOfficeCalc key=\{([a-z])\.year\} initial=\{\1\.homeOffice \|\| \1\.homeOfficeKept\}/.test(s) && /action: 'homeoffice', year: [a-z]\.year/.test(s));
    check(`${name}: printed with the rest`, /homeOffice: [a-z]\.homeOffice \}\)/.test(s));
  }
  check('a renter’s screen stays in the portal’s weights', !/font-bold/.test(renter));

  console.log('Loose ends');
  const close = src('src/lib/books-close-server.ts');
  check('closing a month: someone who can’t read the bank is told the owner sorts its lines, with nowhere to go', /\(owner \? \{ detail: 'Each has a category picked, waiting at the top of Books', href: '\/money\?tab=bank' \} : \{ detail: 'The owner sorts these, at the top of Books' \}\)/.test(close)
    && /closeOverview\(db, tenantId, tenant, b\.month, Date\.now\(\), !!auth\.actor\.isTenantOwner\)/.test(src('src/app/api/money/close/route.ts')));
  const BC = await import('../../src/lib/books-close-server');
  await db.doc('tenants/t2/bankTransactions/b1').set({ status: 'unmatched', date: '2026-10-05', amount: 40 });
  const asOwner = (await BC.monthView(db, 't2', { timezone: 'America/New_York' }, '2026-10', Date.parse('2026-11-20T12:00:00Z'))).checks.find((c) => c.id === 'bank')!;
  const asManager = (await BC.monthView(db, 't2', { timezone: 'America/New_York' }, '2026-10', Date.parse('2026-11-20T12:00:00Z'), false)).checks.find((c) => c.id === 'bank')!;
  check('and so it is, when a month is looked at', asOwner.href === '/money?tab=bank' && !asManager.href && asManager.detail === 'The owner sorts these, at the top of Books' && !asManager.ok);
  const bank = src('src/components/money/BankScreen.tsx');
  const quiet = bank.slice(bank.indexOf('if (inBooks && none && n === 0) return ('), bank.indexOf('\n  );', bank.indexOf('if (inBooks && none && n === 0) return (')));
  check('with no bank connected, an error is said once (the note), not twice', quiet.length > 100 && !quiet.includes('{error}'));
  check('in Books, what an action on the bank did is said wherever the page is scrolled to', /if \(error\) toast\(\{ variant: 'destructive', title: error \}\); else if \(note\) toast\(\{ title: note \}\);/.test(bank) && /\{!inBooks && note && !error && <p role="status"/.test(bank));
  const T = await import('../../src/lib/tenant-time');
  const U = await import('../../src/hooks/use-transactions');
  const from = T.wallToUtc(`${Y}-01-01`, 0, 0, 'America/Los_Angeles'), to = T.wallToUtc(`${Y + 1}-01-01`, 0, 0, 'America/Los_Angeles');
  const got = U.mergeInRange([{ id: 'a', date: `${Y}-01-01` }, { id: 'b', date: `${Y - 1}-12-31` }, { id: 'c', date: `${Y}-01-01T03:00:00Z` }, { id: 'd', date: `${Y}-12-31` }, { id: 'e', date: `${Y + 1}-01-01T07:30:00Z` }], null, from.getTime(), to.getTime(), 'date', 'America/Los_Angeles');
  check('the year counted where the business is: a day-only line by its day, one with a time by the instant', got.map((t: any) => t.id).sort().join() === 'a,d,e', got.map((t: any) => t.id));
  const packet = src('src/components/money/YearEndPacket.tsx');
  check('the year-end packet reads the business’s year', /readDatedRange\(firestore, tenantId, 'transactions', 'date', wallToUtc\(`\$\{y\}-01-01`, 0, 0, tz\), wallToUtc\(`\$\{y \+ 1\}-01-01`, 0, 0, tz\), tz\)/.test(packet) && /const tz = React\.useMemo\(\(\) => calendarZone\(tenant\), \[tenant\]\);/.test(packet));
  const R = await import('../../src/components/money/ReportsScreen');
  const late = new Date(`${Y}-01-01T02:00:00Z`);   // still December 31 in Los Angeles
  const ly = R.rangeOf('lastYear', late, '', '', 'America/Los_Angeles')!;
  check('Reports: which year it is, the business’s', ly.from.getFullYear() === Y - 2 && ly.to.getMonth() === 11 && ly.to.getDate() === 31);
  const sp = R.readSpan(R.rangeOf('thisYear', new Date(`${Y}-06-01T12:00:00Z`), '', '', 'America/Los_Angeles')!, 'America/Los_Angeles');
  check('Reports: its days read from midnight where the business is', sp.from.toISOString() === T.wallToUtc(`${Y}-01-01`, 0, 0, 'America/Los_Angeles').toISOString() && sp.to.toISOString() === T.wallToUtc(`${Y + 1}-01-01`, 0, 0, 'America/Los_Angeles').toISOString());
  check('without a time zone set, this device’s calendar, as before', T.calendarZone({}) === (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') && T.calendarZone({ timezone: 'America/Chicago' }) === 'America/Chicago');

  console.log(F.failures ? `\n${F.failures} failed` : '\nAll passed');
  process.exit(F.failures ? 1 : 0);
})();
