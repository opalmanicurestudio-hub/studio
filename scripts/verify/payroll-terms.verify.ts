// Checks what a business agrees to before running payroll in ClarityFlow, and what happens when the tax tables are for
// another year (design boards "Before you run payroll here" and "Tables from another year"):
//   The platform terms have a payroll section (10): the figures are estimates, the business is the employer and pays and
//   files, nothing is sent or filed for it, tables change and updates can lag, an accountant should check; the
//   disclaimers, liability limit and indemnity cover payroll; the terms' version moved on with it.
//   In the app the owner or an admin agrees once (api/payroll/forms 'agreeTerms', lib/payroll-terms): the version and
//   day on the business, who and from where kept privately; anyone else is turned away; an old copy of the points is
//   refused. Until then payday isn't recorded with taxes worked out here (api/payroll/record), and Payday shows who does
//   what first (design board "Payroll trust wording", A: what ClarityFlow handles, what the employer handles, one plain
//   line on advice, penalties and interest), with recording held and no bonus.
//   A payday in a year the tables aren't for (federal or state) is marked calmly (a year's tables on the way), and
//   recorded only once the business ticks to use the tables there are and have its accountant confirm it
//   (lib/payday-record), on Payday and in Pay a bonus.
//   Short lines on the screens and printed forms say where the figures come from and what the business does next, and
//   the person's own W-4 points to the IRS's Tax Withholding Estimator. Settings never writes back what the server keeps.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-terms.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures } from './fake-db';
import { recordPayday, cleanPayday } from '../../src/lib/payday-record';
import { tablesFor, tablesInfo, staleWords, staleNote } from '../../src/lib/withholding';
import { STATE_TABLES_YEAR } from '../../src/lib/state-payroll';
import { PAYROLL_TERMS, PAYROLL_TERMS_VERSION, PAYROLL_TERMS_HREF, payrollTerms, payrollTermsOk, canAgreeFor } from '../../src/lib/payroll-terms';
import { TERMS_VERSION, TERMS_EFFECTIVE, TERMS_CHANGES } from '../../src/lib/legal';
import { PAYROLL_TERMS_ALSO } from '../../src/lib/payroll-terms';

const src = (f: string) => fs.readFileSync(f, 'utf8');
// The routes run against an in-memory database, with sign-in stood in for.
const db = makeDb(); let actor: any = { uid: 'u1', id: 'u1', name: 'Jess Marshall', email: 'jess@north.example', isTenantOwner: true, role: 'owner' };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/route-guard') return { requireCan: async () => ({ actor, tenant: {} }), requireRole: async () => ({ actor, tenant: {} }) };
  if (request === '@/lib/audit') return { logAuditAdmin: async (_d: any, _t: any, e: any) => { audits.push(e); } };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) } };
  return load.call(this, request, ...rest);
};
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? '10.1.2.3, 10.0.0.1' : k.toLowerCase() === 'user-agent' ? 'Safari' : null) } }) as any;
const get = async (p: string) => (await db.doc(p).get()).data() || null;

const tenant = { name: 'North Loft', timezone: 'America/New_York', workweekStartsOn: 1, payroll: { cadence: 'bi-weekly', periodAnchor: '2026-11-02', paydayAfterDays: 4 }, taxState: 'NC', payrollTax: { runBy: 'clarityflow' } };
const forms: any = { jo: { federal: { status: 'single' }, state: { status: 'single' } } };
const pay = (from: string, to: string, extra: any = {}) => ({ periodKey: `${from}_${to}`, from, to, setAsides: [], people: [{ staffId: 'jo', name: 'Jo Park', amount: 1500, cash: 0, contractor: false, method: 'transfer' }], ...extra });

(async () => {
  console.log('The platform terms');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = await import('react'); (globalThis as any).React = React;
  const T = (await import('../../src/app/legal/terms/page')).default as any;
  const th = renderToStaticMarkup(React.createElement(T));
  const heads = [...th.matchAll(/<h2[^>]*>(\d+)\. /g)].map((m) => Number(m[1]));
  check('a payroll section, 10, where the app links to it, and every section numbered in order', /<section id="payroll-taxes"/.test(th) && />10\. Payroll and tax figures/.test(th) && PAYROLL_TERMS_HREF === '/legal/terms#payroll-taxes'
    && heads.join(',') === Array.from({ length: heads.length }, (_, i) => i + 1).join(','), heads);
  const sec = th.slice(th.indexOf('id="payroll-taxes"'), th.indexOf('</section>', th.indexOf('id="payroll-taxes"')));
  check('it says: estimates, not advice; the business is the employer, pays and files, penalties and all; nothing sent or filed for it; tables lag; check with an accountant',
    /estimates to help you/.test(sec) && /not a payroll service, tax preparation, or tax, legal, or accounting advice/.test(sec) && /you alone are responsible/.test(sec) && /penalties,\s+interest/.test(sec)
    && /does not pay your people, deposit or pay\s+taxes, or file anything/.test(sec) && /an update can arrive after the change takes effect/.test(sec) && /qualified accountant or tax professional/.test(sec));
  check('the disclaimers, the liability limit and the indemnity cover payroll and tax figures', /Sections 15, 16, and 17/.test(sec) && />15\. Disclaimers/.test(th) && />16\. Limitation of liability/.test(th) && />17\. Indemnity/.test(th)
    && /pay,\s+withholding, tax, or deposit figures/.test(th) && /taxes, penalties, interest, fines, or back pay you owe/.test(th) && /the taxes and forms you pay and file/.test(th) && /payroll and tax\s+responsibilities/.test(th));
  check('the terms’ version and date moved on together', TERMS_VERSION === '2026-11-27' && new Date(`${TERMS_EFFECTIVE} 12:00`).toISOString().slice(0, 10) === TERMS_VERSION);
  check('a business that accepted an earlier version gets notice: the changes apply to it a month on, or when it agrees in the app', th.includes(`take\n            effect ${TERMS_CHANGES.existingFrom}`) || new RegExp(`For a business that accepted an earlier version of these terms, the changes made ${TERMS_EFFECTIVE} \\(section 10, and the payroll parts of sections 9 and 14 through 17\\)\\s+take effect ${TERMS_CHANGES.existingFrom}, or sooner if it agrees to them in the Service`).test(th));
  check('the app never says “an earlier year’s” tables: pay dated before the tables’ year is marked too', !/earlier year’s/.test(th) && ![PAYROLL_TERMS.intro, ...PAYROLL_TERMS.handles, ...PAYROLL_TERMS.yours, PAYROLL_TERMS.fine].some((x) => /earlier year/.test(x)) && /another year’s/.test(sec));
  check('the payroll section names no business and no person', !/North Loft|Opal|salon|stylist/i.test(sec));

  console.log('What the app asks a business to agree to');
  const tx = payrollTerms('Texas', true), oh = payrollTerms('Ohio');
  check('who does what: what ClarityFlow handles, what the employer handles, and one plain line on advice, penalties and interest', PAYROLL_TERMS.handles.length === 6 && PAYROLL_TERMS.yours.length === 5
    && PAYROLL_TERMS.handles.some((x) => /checked line by line against the IRS’s and the states’ own guides/.test(x)) && PAYROLL_TERMS.yours.some((x) => /Sending pay and tax deposits from your bank/.test(x)) && PAYROLL_TERMS.yours.some((x) => /city or county payroll tax Payday doesn’t show/.test(x))
    && PAYROLL_TERMS.yours.some((x) => /accountant at your first payday/.test(x)) && /aren’t tax, legal or accounting advice/.test(PAYROLL_TERMS.fine) && /only as right as the tables and what’s entered/.test(PAYROLL_TERMS.fine) && /New tables can arrive after a change takes effect/.test(PAYROLL_TERMS.fine)
    && /penalties or interest stay with you, even when they come from figures worked out here/.test(PAYROLL_TERMS.fine) && /never sends money or files anything/.test(PAYROLL_TERMS.intro)
    && /You stay the employer/.test(PAYROLL_TERMS.intro) && [...PAYROLL_TERMS.handles, ...PAYROLL_TERMS.yours].every((x) => x.length < 100));
  check('the agreement names the business’s state, and says when it has no income tax to withhold', /the IRS’s and Ohio’s official tables/.test(oh.intro) && oh.noTax === null && /the IRS’s official tables/.test(tx.intro) && /Texas has no state income tax/.test(tx.noTax || '')
    && /the IRS’s and your state’s official tables/.test(PAYROLL_TERMS.intro));
  check('agreed only to the version shown now', payrollTermsOk({ payrollTax: { termsAgreed: { version: PAYROLL_TERMS_VERSION } } }) && !payrollTermsOk({ payrollTax: { termsAgreed: { version: '2026-01-01' } } }) && !payrollTermsOk({}));
  check('the owner or an admin agrees for the business; a manager doesn’t', canAgreeFor({ isTenantOwner: true }) && canAgreeFor({ role: 'admin' }) && canAgreeFor({ role: 'Owner' }) && !canAgreeFor({ role: 'manager', isManager: true }) && !canAgreeFor(null));

  await db.doc('tenants/t1').set(tenant);
  const { POST: FORMS } = await import('../../src/app/api/payroll/forms/route');
  actor = { uid: 'u2', id: 'u2', name: 'Mo', role: 'manager', isManager: true, caps: ['money.payroll'] };
  let r: any = await FORMS(req({ tenantId: 't1', action: 'agreeTerms', version: PAYROLL_TERMS_VERSION }));
  check('a manager who runs payroll can’t agree for the business', r.status === 403 && !(await get('tenants/t1')).payrollTax.termsAgreed, r.body);
  actor = { uid: 'u1', id: 'u1', name: 'Jess Marshall', email: 'jess@north.example', isTenantOwner: true, role: 'owner' };
  r = await FORMS(req({ tenantId: 't1', action: 'agreeTerms', version: '2026-01-01' }));
  check('an old copy of the points is refused: read them again', r.status === 409 && /Reload/.test(r.body.error) && !(await get('tenants/t1')).payrollTax.termsAgreed);

  console.log('Recording payday before it’s agreed');
  const { POST: RECORD } = await import('../../src/app/api/payroll/record/route');
  await db.doc('tenants/t1/staffPay/jo').set({ taxForms: forms.jo });
  r = await RECORD(req({ tenantId: 't1', ...pay('2026-11-16', '2026-11-29') }));
  const none = (await db.collection('tenants/t1/payrollRuns').get()).docs.length === 0 && (await db.collection('tenants/t1/transactions').get()).docs.length === 0;
  check('refused, saying who agrees and where, with nothing recorded', r.status === 428 && r.body.code === 'payroll_terms' && /owner or an admin/.test(r.body.error) && /Nothing was recorded/.test(r.body.error) && none, r.body);
  const gustoT = { ...tenant, payrollTax: { runBy: 'company' } }; await db.doc('tenants/t2').set(gustoT);
  r = await RECORD(req({ tenantId: 't2', ...pay('2026-11-16', '2026-11-29') }));
  check('a business with a payroll company isn’t asked: its payroll company works out the taxes', r.status === 200 && r.body.ok === true, r.body);

  r = await FORMS(req({ tenantId: 't1', action: 'agreeTerms', version: PAYROLL_TERMS_VERSION }));
  const t1: any = await get('tenants/t1'); const priv: any = await get('tenants/t1/private/payrollTerms');
  check('the owner agrees: the version and day on the business, nothing about who', r.status === 200 && t1.payrollTax.termsAgreed?.version === PAYROLL_TERMS_VERSION && !!t1.payrollTax.termsAgreed.at
    && Object.keys(t1.payrollTax.termsAgreed).sort().join() === 'at,version' && t1.payrollTax.runBy === 'clarityflow', t1.payrollTax);
  check('who agreed, when and from where, kept privately', priv?.latest === PAYROLL_TERMS_VERSION && priv.agreed[PAYROLL_TERMS_VERSION].userId === 'u1' && priv.agreed[PAYROLL_TERMS_VERSION].ip === '10.1.2.3'
    && priv.agreed[PAYROLL_TERMS_VERSION].email === 'jess@north.example' && priv.agreed[PAYROLL_TERMS_VERSION].platformTerms === TERMS_VERSION && audits.some((a) => a.action === 'payroll.terms_agreed'), priv);
  check('agreeing also accepts the platform terms as updated, said on the card', PAYROLL_TERMS_ALSO.includes(`as updated ${TERMS_EFFECTIVE}`) && /also: PAYROLL_TERMS_ALSO/.test(src('src/app/(app)/money/page.tsx')) && /platform terms<\/a>\. \{t\.also\}/.test(src('src/components/money/PaydayScreen.tsx')));
  r = await RECORD(req({ tenantId: 't1', ...pay('2026-11-16', '2026-11-29') }));
  check('agreed: payday is recorded, its taxes worked out here', r.status === 200 && r.body.ok === true && !!r.body.taxes, r.body);

  console.log('Tax tables for another year');
  check('the tables here are for one year, federal and state alike; any other year is marked', tablesFor(STATE_TABLES_YEAR).stale === false && tablesFor(STATE_TABLES_YEAR + 1).stale === true && tablesFor(STATE_TABLES_YEAR - 1).stale === true
    && tablesInfo(STATE_TABLES_YEAR + 1).federal === STATE_TABLES_YEAR);
  check('said with the years', staleWords(2027) === 'This payday is in 2027, and the tax tables here are 2026’s.' && staleWords(2027, 'This pay').startsWith('This pay is in 2027'));
  const n27 = staleNote(2027), n25 = staleNote(2025, 'this pay');
  check('said calmly: a year’s tables on the way, or a year’s not kept here, and the tick to go ahead with the ones there are', n27.title === '2027’s tables are on the way' && /added here once they’ve been checked\. Until then, this payday is worked out with 2026’s, so a few amounts may come out a little different\./.test(n27.text)
    && n27.tick === 'Use 2026’s tables for this payday. I’ll have my accountant confirm it.' && n25.title === 'Worked out with 2026’s tables' && /^This pay is in 2025, and that year’s tables aren’t kept here, so a few amounts may come out a little different\.$/.test(n25.text) && !/may be off/.test(n27.text + n25.text), [n27, n25]);
  check('only a real yes counts as the tick', (cleanPayday(pay('2027-01-04', '2027-01-17', { staleOk: true })) as any).staleOk === true && !('staleOk' in (cleanPayday(pay('2027-01-04', '2027-01-17', { staleOk: 'yes' })) as any))
    && (cleanPayday({ ...pay('2027-01-08', '2027-01-08'), periodKey: 'bonus_2027-01-08_abc123', offCycle: { date: '2027-01-08', supplemental: true }, staleOk: true }) as any).staleOk === true);
  const d2 = makeDb(); const agreed = { ...tenant, payrollTax: { runBy: 'clarityflow', termsAgreed: { version: PAYROLL_TERMS_VERSION, at: 'x' } } }; await d2.doc('tenants/t1').set(agreed);
  const jan = '2027-01-19T15:00:00.000Z';
  const s1: any = await recordPayday(d2, 't1', agreed, cleanPayday(pay('2027-01-04', '2027-01-17')) as any, {}, jan, forms);
  const empty = (await d2.collection('tenants/t1/payrollRuns').get()).docs.length === 0 && (await d2.collection('tenants/t1/transactions').get()).docs.length === 0;
  check('a 2027 payday with 2026’s tables, not ticked: not recorded, saying why', !s1.ok && s1.status === 428 && s1.code === 'stale_tables' && /This payday is in 2027/.test(s1.error) && /accountant/.test(s1.error) && empty, s1);
  const s2: any = await recordPayday(d2, 't1', agreed, cleanPayday(pay('2027-01-04', '2027-01-17', { staleOk: true })) as any, {}, jan, forms);
  check('ticked: recorded', s2.ok === true && !!s2.taxes, s2);
  const s3: any = await recordPayday(d2, 't1', agreed, cleanPayday({ ...pay('2027-01-08', '2027-01-08'), periodKey: 'bonus_2027-01-08_abc123', offCycle: { date: '2027-01-08', supplemental: true } }) as any, {}, jan, forms);
  check('a bonus too', !s3.ok && s3.code === 'stale_tables' && /This pay is in 2027/.test(s3.error), s3);
  const s4: any = await recordPayday(d2, 't1', { ...agreed, payrollTax: { runBy: 'company' } }, cleanPayday(pay('2027-01-18', '2027-01-31')) as any, {}, '2027-02-03T15:00:00.000Z', forms);
  check('with a payroll company no taxes are worked out here, so no tick is needed', s4.ok === true, s4);

  console.log('On Payday and in Pay a bonus');
  const screen = src('src/components/money/PaydayScreen.tsx'); const page = src('src/app/(app)/money/page.tsx'); const bd = src('src/components/money/BonusDialog.tsx');
  check('the points come first on Payday until it’s agreed, with “I agree” only for the owner or an admin', /\{runBy === 'clarityflow' && p\.terms && <TermsCard t=\{p\.terms\} \/>\}\{period\}/.test(screen)
    && /terms=\{selfRunOn && selectedTenant && !termsOk \? \{ terms: payrollTerms\(hasTaxLocation \? stateProfile\.name : '', hasTaxLocation && NO_WAGE_TAX\.includes\(String\(taxState\)\)\)/.test(page) && /onAgree: canAgreeFor\(\{ role: payRole \}\)/.test(page) && /action: 'agreeTerms', version: PAYROLL_TERMS_VERSION/.test(page)
    && /The owner or an admin agrees to this once, for \{t\.business\}/.test(screen));
  check('recording waits for the agreement, and for the tick when the tables are another year’s; no bonus until it’s agreed', /const waits = runBy === 'clarityflow' && p\.terms \?/.test(screen) && /self\?\.stale && !self\.stale\.ok && employees\.length > 0/.test(screen)
    && /\|\| !!p\.blocked \|\| !!waits\}/.test(screen) && /onBonus=\{selfRunOn && termsOk && !adjustmentsError/.test(page));
  check('agreed just now counts for that business only, and not once the server says otherwise', /\(!!tenantId && termsAgreedFor === tenantId\)/.test(page) && (page.match(/if \(r\?\.code === 'payroll_terms'\) setTermsAgreedFor\(null\);/g) || []).length === 2);
  check('the tick goes with the payday, for these dates and this business only', /\.\.\.\(selfRun\?\.stale\?\.ok \? \{ staleOk: true \} : \{\}\)/.test(page) && /useEffect\(\(\) => \{ setStaleOk\(false\); \}, \[periodKey, tenantId\]\);/.test(page)
    && /\{self\.stale\.tick\}<\/label>/.test(screen) && /\{ \.\.\.staleNote\(taxYear\), ok: staleOk, onOk: setStaleOk \}/.test(page) && /Tick to use these tables first, under Your team\./.test(screen) && /'Agree and continue'/.test(screen));
  check('Pay a bonus: the same note and tick, recorded only once it’s ticked', /const ready = !!person && amt > 0 && dateOk && \(!stale \|\| staleOk\);/.test(bd) && /\.\.\.\(stale && staleOk \? \{ staleOk: true \} : \{\}\)/.test(bd) && /staleNote\(Number\(date\.slice\(0, 4\)\), 'this pay'\)/.test(bd) && /\{n\.tick\}<\/label>/.test(bd));

  console.log('Short lines where the figures are used');
  check('Payday: whose tables and the year; the business sends the money and files', /Taxes worked out from the IRS’s/.test(screen) && /\$\{self\.tablesYear\}/.test(screen) && /You send the pay and the taxes from your bank, and file the forms or hand them to your accountant\./.test(screen)
    && !/estimates for you to check/.test(screen));
  check('Payroll taxes: a notice from the IRS or the state comes first', /ever sends you a notice, it comes first: pass it to your accountant/.test(screen));
  const pf = src('src/components/money/PayrollFormsDialog.tsx'), ye = src('src/components/money/YearEndDialog.tsx');
  check('the quarter’s and the year’s forms, on screen and printed: prepared from the paydays recorded, looked over before filing', /Review before filing/.test(pf) && /Look them over against your bank statements before you file/.test(pf)
    && (ye.match(/Review before (giving or )?filing|before you hand them out and file/g) || []).length >= 3 && !/only as right as/.test(pf + ye));
  check('Pay a bonus and printed checks', /rules for bonuses, from the/.test(bd) && /Worked out as a paycheck of its own/.test(bd) && /Look each one over as you sign it/.test(src('src/components/money/PrintChecksDialog.tsx')));
  const tf = src('src/components/staff/TaxFormsDialog.tsx');
  check('your own W-4: your choice, with the IRS’s estimator', /What you choose is up to you/.test(tf) && /href="https:\/\/www\.irs\.gov\/individuals\/tax-withholding-estimator"/.test(tf));
  const st = src('src/app/(app)/settings/page.tsx');
  check('Settings, Payroll: whose tables, who sends and files, and whether it’s agreed', /withholding tables\. You send the payments and file the forms\./.test(st) && /payrollTermsOk\(selectedTenant\) \? `Agreed to how payroll works here/.test(st));
  check('Settings writes payroll’s settings by path, never what the server keeps (the agreement, check numbers, W-2s given)', /changed\[`payrollTax\.\$\{k\}`\] = a\[k\] \?\? null/.test(st)
    && /\['termsAgreed', 'nextCheckNo', 'checkLayout', 'checkNudge', 'w2Given'\]\.includes\(k\)/.test(st) && /delete changed\.payrollTax;/.test(st));

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
