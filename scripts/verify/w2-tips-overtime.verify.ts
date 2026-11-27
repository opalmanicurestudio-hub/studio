// Checks the 2026 W-2's tips and overtime (Money › Payday › Year-end forms; lib/payroll-yearend, lib/pay-period,
// lib/tipped-occupations, components/money/YearEndDialog, api/payroll/forms):
//   Box 12 code TP: every tip reported, cash and card, pay from before ClarityFlow included. Box 14b: the occupation the
//   tips were received in, the business's usual one (605 for nails) unless one is picked for the person, "000" for an
//   occupation not on the list. Code TT: the overtime the federal law requires, the "half" of time and a half at the
//   week's regular rate for hours past 40 that overtime was paid on, kept on paydays from now on; a W-2 says how many
//   paydays were recorded before it was kept. None of it before 2026. The employee's notice explains the codes.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/w2-tips-overtime.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { w2sFor, TIPS_OT_FROM } from '../../src/lib/payroll-yearend';
import { paydayTaxes } from '../../src/lib/payroll-taxes';
import { keepOf } from '../../src/lib/withholding';
import { cleanTtoc, usualTtoc, ttocOf, ttocsOf, ttocTitle, TTOC, NOT_LISTED } from '../../src/lib/tipped-occupations';
import { periodPay } from '../../src/lib/pay-period';
import { sessionsFrom } from '../../src/lib/timeclock';
import { cleanPayday } from '../../src/lib/payday-record';

const src = (f: string) => fs.readFileSync(f, 'utf8');
// (The forms route runs against an in-memory database, with sign-in stood in for.)
const db = makeDb(); const audits: any[] = []; const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor: { uid: 'u1', id: 'u1', name: 'Owner', isTenantOwner: true }, tenant: {} }) };
  if (request === '@/lib/audit') return { logAuditAdmin: async (_d: any, _t: any, e: any) => { audits.push(e); } };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
const T = (extra: any = {}, niche = 'nails') => ({ timezone: 'America/New_York', niche, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-01-05', paydayAfterDays: 4 }, taxState: 'NC', payrollTax: { runBy: 'clarityflow', ...extra } });
const forms: any = { jo: { federal: { status: 'single' }, state: { state: 'NC', status: 'single' } }, rae: { federal: { status: 'single' }, state: { state: 'NC', status: 'single' } } };
const run = (tenant: any, d: string, ppl: { id: string; name: string; gross: number; tips: number; ot?: number }[], otKept = true) => {
  const t = paydayTaxes({ tenant, payDate: d, forms, ytd: {}, people: ppl.map((x) => ({ staffId: x.id, gross: x.gross, inHand: 0 })) });
  return { kind: 'payday', runBy: 'clarityflow', periodKey: d, payDate: d, from: d, to: d, recordedAt: `${d}T15:00:00Z`, ...(otKept ? { otKept: true } : {}),
    people: ppl.map((x) => ({ staffId: x.id, name: x.name, paid: x.gross, cashTips: 0, tips: x.tips, ...(x.ot ? { otQualified: x.ot } : {}), taxes: keepOf(t.by[x.id]), takeHome: t.by[x.id].takeHome })) };
};

(async () => {
  console.log('Tipped occupation codes');
  check('the IRS’s list, with the beauty codes as published', TTOC.find((t) => t.code === '605')?.title === 'Manicurists and pedicurists' && ttocTitle('603') === 'Barbers, hairdressers, hairstylists, and cosmetologists'
    && ttocTitle('606') === 'Eyebrow and eyelash technicians' && ttocTitle('102') === 'Wait staff' && TTOC.length === 71 && new Set(TTOC.map((t) => t.code)).size === 71);
  check('a code is one on the list or “000”, nothing else', cleanTtoc('605') === '605' && cleanTtoc(NOT_LISTED) === '000' && cleanTtoc('999') === null && cleanTtoc('') === null && cleanTtoc(null) === null);
  check('the usual one for the business’s kind; one picked for a person wins', usualTtoc({ niche: 'nails' }) === '605' && usualTtoc({ niche: 'hair' }) === '603' && usualTtoc({ niche: 'lash' }) === '606' && usualTtoc({ niche: 'hospitality' }) === '102'
    && usualTtoc({ niche: 'shop' }) === null && ttocOf({ niche: 'nails', payrollTax: { ttoc: { rae: '603' } } }, 'rae') === '603' && ttocOf({ niche: 'nails' }, 'jo') === '605');
  check('up to two codes: “000” as well when some tips were for work not on the list', ttocsOf({ niche: 'nails', payrollTax: { ttoc000: { jo: true } } }, 'jo').join() === '605,000' && ttocsOf({ niche: 'nails' }, 'jo').join() === '605'
    && ttocsOf({ niche: 'nails', payrollTax: { ttoc: { jo: '000' }, ttoc000: { jo: true } } }, 'jo').join() === '000');

  console.log('Box 12 TP and TT, box 14b');
  const nails = T({ ttoc: { rae: '603' } });
  const runs = [
    run(nails, '2026-03-12', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 400, ot: 37.5 }, { id: 'rae', name: 'Rae Lin', gross: 2500, tips: 900 }]),
    run(nails, '2026-08-13', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 400 }], false),
    { kind: 'prior', year: 2026, lastPayDate: '2026-02-01', people: [{ staffId: 'jo', name: 'Jo Park', wages: 1000, tips: 100, federal: 50, ss: 62, medicare: 14.5 }] },
  ];
  const w = w2sFor(runs, nails, 2026); const jo = w.find((x) => x.staffId === 'jo')!; const rae = w.find((x) => x.staffId === 'rae')!;
  const code = (x: any, c: string) => x.b12.find((y: any) => y.code === c)?.amount;
  check('TP: every tip reported, cash and card, from before ClarityFlow too', code(jo, 'TP') === 900 && code(rae, 'TP') === 900, [jo.b12, rae.b12]);
  check('TT: the overtime the law requires, from paydays that keep it', code(jo, 'TT') === 37.5 && code(rae, 'TT') === undefined);
  check('14b: the business’s usual occupation, or the one picked for the person', jo.b14b.join() === '605' && rae.b14b.join() === '603');
  check('how many paydays were recorded before overtime was kept (pay between paydays not counted)', jo.otNotKept === 1 && rae.otNotKept === 0
    && w2sFor([...runs, { ...run(nails, '2026-09-04', [{ id: 'jo', name: 'Jo Park', gross: 500, tips: 0 }], false), offCycle: true }], nails, 2026).find((x) => x.staffId === 'jo')!.otNotKept === 1);
  const ex = w2sFor([run(nails, '2026-04-09', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 0, ot: 60 }])].map((r: any) => ({ ...r, people: r.people.map((p: any) => ({ ...p, otMaybeExempt: 45 })) })), nails, 2026)[0];
  check('the part of code TT from weeks a commissioned person may be exempt is said', ex.ttMaybeExempt === 45 && code(ex, 'TT') === 60);
  const plain = w2sFor([run(T({}, 'shop'), '2026-03-12', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 50 }])], T({}, 'shop'), 2026)[0];
  check('no usual occupation for the business’s kind: 14b waits to be picked', code(plain, 'TP') === 50 && plain.b14b.length === 0);
  const y25 = w2sFor([run(nails, '2025-03-12', [{ id: 'jo', name: 'Jo Park', gross: 3000, tips: 400, ot: 20 }], false)], nails, 2025)[0];
  check('none of it before 2026', TIPS_OT_FROM === 2026 && !y25.b12.some((x) => x.code === 'TP' || x.code === 'TT') && y25.b14b.length === 0 && y25.otNotKept === 0, y25);

  console.log('On the form');
  const YE = await import('../../src/components/money/YearEndDialog');
  const rows = YE.w2Rows(jo, { businessName: 'North Loft', first: 'Jo' });
  check('the rows: codes TP and TT, and 14b with the occupation', rows.some((r) => r.box.startsWith('12') && r.label === 'Code TP' && r.value === '$900.00') && rows.some((r) => r.label === 'Code TT')
    && rows.some((r) => r.box === '14b' && r.value === '605' && r.detail === 'Manicurists and pedicurists'));
  const html = YE.w2Html(jo, 2026, 'North Loft'), html25 = YE.w2Html(y25, 2025, 'North Loft');
  const five = { ...jo, b12: [{ code: 'A', label: '', amount: 10 }, { code: 'B', label: '', amount: 5 }, { code: 'D', label: '', amount: 200 }, { code: 'TP', label: '', amount: 900 }, { code: 'TT', label: '', amount: 37.5 }] };
  const h5 = YE.w2Html(five, 2026, 'North Loft');
  check('a fifth box 12 code prints on a second W-2 that repeats boxes a to f', /second form: box 12 only/.test(h5) && /TT  \$37\.50/.test(h5) && !/second form/.test(html));
  check('printed: 14a and 14b, and the notice explains TP and TT; 2025’s keeps box 14 as it was', /14a, 14b/.test(html) && /14b 605/.test(html) && /TP, tips reported to your employer/.test(html) && /TT, overtime pay above your regular rate/.test(html)
    && !/14b/.test(html25) && !/TP, tips/.test(html25));

  console.log('The overtime the law requires');
  const tz = 'America/New_York'; const at = (d: string, hm: string) => new Date(`${d}T${hm}:00-04:00`).toISOString();
  const P = (type: string, d: string, hm: string) => ({ staffId: 'a', type, timestamp: at(d, hm), timesheetStatus: 'approved' });
  // (Nine hours a day Monday to Friday: 45 hours in the week, at $20 an hour.)
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
  const ss = sessionsFrom(days.flatMap((d) => [P('clock_in', d, '08:00'), P('clock_out', d, '17:00')]), { timeZone: tz, now: Date.parse(at('2026-10-12', '12:00')) });
  const pay = (m: any, tenant: any = {}) => periodPay({ member: m, from: at('2026-10-05', '00:00'), to: at('2026-10-11', '23:59'), incomeTxns: [], services: [], tenant: { timezone: tz, ...tenant }, sessions: ss, shifts: [] } as any);
  const h = pay({ id: 'a', name: 'Ana', payStructure: 'hourly', hourlyRate: 20 });
  check('hourly: half the $20 rate for the 5 hours past 40', h.qualifiedOvertime === 50 && h.overtimeHours === 5, { q: h.qualifiedOvertime, ot: h.overtimeHours });
  const daily = pay({ id: 'a', name: 'Ana', payStructure: 'hourly', hourlyRate: 20 }, { payRules: { dailyOvertimeHours: 8 } });
  check('a state’s daily overtime isn’t the law’s: still only the hours past 40', daily.qualifiedOvertime <= 50, { q: daily.qualifiedOvertime, ot: daily.overtimeHours });
  const c = pay({ id: 'a', name: 'Ana', payStructure: 'hourly', hourlyRate: 20, contractor: true, employmentType: 'contractor' });
  check('a contractor has none', !c.qualifiedOvertime);
  const kept: any = cleanPayday({ periodKey: '2026-10-05_2026-10-11', from: '2026-10-05', to: '2026-10-11', people: [{ staffId: 'a', name: 'Ana', amount: 950, cash: 0, otQualified: 50 }], setAsides: [] });
  check('paydays keep it, and say they do', kept.people[0].otQualified === 50 && /otKept: true,/.test(src('src/lib/payday-record.ts')) && /otQualified: Math\.round\(Number\(o\.line\.qualifiedOvertime\) \* 100\) \/ 100/.test(src('src/app/(app)/money/page.tsx')));

  console.log('Working out overtime for earlier paydays, from the time clock');
  const FORMS: (r: any) => Promise<any> = (await import('../../src/app/api/payroll/forms/route')).POST as any;
  const rq = (body: any) => ({ json: async () => ({ tenantId: 't1', ...body }), headers: { get: () => null } }) as any;
  const ten = { name: 'North Loft', timezone: tz, niche: 'nails', taxState: 'NC', payroll: { cadence: 'weekly', periodAnchor: '2026-10-05', paydayAfterDays: 4 }, payrollTax: { runBy: 'clarityflow' } };
  await db.doc('tenants/t1').set(ten); await db.doc('tenants/t1/staff/a').set({ name: 'Ana', payStructure: 'hourly', isActive: true }); await db.doc('tenants/t1/staffPay/a').set({ hourlyRate: 20, staffId: 'a' });
  for (const d of days) { await db.doc(`tenants/t1/activityLogs/in_${d}`).set(P('clock_in', d, '08:00')); await db.doc(`tenants/t1/activityLogs/out_${d}`).set(P('clock_out', d, '17:00')); }
  await db.doc('tenants/t1/payrollRuns/payday_old').set({ kind: 'payday', runBy: 'clarityflow', periodKey: '2026-10-05_2026-10-11', payDate: '2026-10-15', from: '2026-10-05', to: '2026-10-11', people: [{ staffId: 'a', name: 'Ana', paid: 950, tips: 0 }] });
  await db.doc('tenants/t1/payrollRuns/payday_bonus').set({ kind: 'payday', runBy: 'clarityflow', offCycle: true, periodKey: 'b', payDate: '2026-10-20', from: '2026-10-20', to: '2026-10-20', people: [{ staffId: 'a', name: 'Ana', paid: 100 }] });
  let r = await FORMS(rq({ action: 'otBackfill', year: 2026 }));
  const old: any = (await db.doc('tenants/t1/payrollRuns/payday_old').get()).data(); const bonus: any = (await db.doc('tenants/t1/payrollRuns/payday_bonus').get()).data();
  check('each earlier payday worked out again from the clock, once, and said; pay between paydays left alone', r.status === 200 && r.body.paydays === 1 && old.otKept === true && old.people[0].otQualified === 50 && old.people[0].paid === 950 && !bonus.otKept
    && audits.some((e) => e.action === 'payroll.ot_worked_out'), { body: r.body, old });
  r = await FORMS(rq({ action: 'otBackfill', year: 2026 }));
  check('done once: a second time finds nothing to do', r.body.paydays === 0 && r.body.left === 0);
  // (A payday whose pay comes out different now, a rate change since: no figure, and said.)
  await db.doc('tenants/t1/payrollRuns/payday_old').set({ kind: 'payday', runBy: 'clarityflow', periodKey: '2026-10-05_2026-10-11', payDate: '2026-10-15', from: '2026-10-05', to: '2026-10-11', people: [{ staffId: 'a', name: 'Ana', paid: 800, tips: 0 }] });
  r = await FORMS(rq({ action: 'otBackfill', year: 2026 }));
  const changed: any = (await db.doc('tenants/t1/payrollRuns/payday_old').get()).data();
  check('pay different from what was recorded: left without a figure, named, and said on the W-2', r.body.unsure === 1 && changed.otKept === true && !changed.people[0].otQualified && changed.otUnsure.join() === 'a'
    && w2sFor([{ ...changed, people: [{ ...changed.people[0], taxes: { wages: { federal: 800, socialSecurity: 800, medicare: 800 }, employee: {}, short: {} } }] }], ten, 2026)[0].otUnsure === 1, changed);
  await db.doc('tenants/t1/payrollRuns/payday_new').set({ kind: 'payday', runBy: 'clarityflow', periodKey: 'n', payDate: '2026-10-29', from: '2026-10-19', to: '2026-10-25', people: [{ staffId: 'a', name: 'Ana', paid: 0 }] });
  await db.doc('tenants/t1').set({ payrollTax: { w2Given: { '2026': '2027-01-20T12:00:00Z' } } }, { merge: true });
  r = await FORMS(rq({ action: 'otBackfill', year: 2026 }));
  check('different pay with no overtime to work out isn’t flagged', /if \(Number\(l\.qualifiedOvertime\) > 0 \|\| Number\(l\.overtimeHours\) > 0\) off\.push/.test(src('src/app/api/payroll/forms/route.ts')));
  check('not once the year’s W-2s are in each person’s app (a change then is a W-2c)', r.status === 409 && /W-2c/.test(r.body.error) && !(await db.doc('tenants/t1/payrollRuns/payday_new').get()).data()?.otKept);
  await db.doc('tenants/t1').set({ payrollTax: { w2Given: { '2026': null } } }, { merge: true });
  const api0 = src('src/app/api/payroll/forms/route.ts');
  check('a few at a time, each in a transaction, saying how many are left', /const todo = all\.slice\(0, 12\)/.test(api0) && /db\.runTransaction\(async \(tx: any\) =>/.test(api0) && /left: Math\.max\(0, all\.length - todo\.length\)/.test(api0));
  r = await FORMS(rq({ action: 'ttoc', staffId: 'a', code: '605', notListed: true }));
  const pt: any = (await db.doc('tenants/t1').get()).data()?.payrollTax;
  check('the occupation and “000 as well” are saved; a code not on the list is refused', r.status === 200 && pt.ttoc.a === '605' && pt.ttoc000.a === true && (await FORMS(rq({ action: 'ttoc', staffId: 'a', code: '999' }))).status === 400);

  console.log('Picking the occupation');
  const api = src('src/app/api/payroll/forms/route.ts'); const dlg = src('src/components/money/YearEndDialog.tsx');
  check('saved by the server for anyone who runs payroll, only a code on the list, in the activity', /if \(action === 'ttoc'\)/.test(api) && /cleanTtoc\(b\.code\)/.test(api) && /payrollTax: \{ ttoc: \{ \[staffId\]: code \}, ttoc000: \{ \[staffId\]: b\?\.notListed === true \} \}/.test(api) && /action: 'payroll\.ttoc'/.test(api));
  check('the W-2 tab asks for it when there are tips, offers “000” as well, says to add tips reported some other way, warns before printing without it, and offers to work out earlier overtime',
    /Box 14b: the occupation \{first\}’s tips were received in/.test(dlg) && /tips were for work not on the list \(adds 000\)/.test(dlg) && /Cash tips \{first\} reported to you some other way belong in it too/.test(dlg)
    && /Pick the occupation for box 14b first/.test(dlg) && /recorded before overtime was kept for code TT/.test(dlg) && /It uses today’s pay rates/.test(dlg) && /'Work out overtime'/.test(dlg) && /came out at different pay when worked out again from the time clock/.test(dlg) && /may be exempt from federal overtime \(section 7\(i\)/.test(dlg));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
