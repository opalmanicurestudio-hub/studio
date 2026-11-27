// Checks printed paychecks and each person's own tax forms (design boards "Print checks", "A printed paycheck" and
// "Your own W-4"):
//   Checks: the amount in words; one sheet per check on voucher paper, the check on top or in the middle, a stub for the
//   person (earned, taxes this payday and this year, take-home) and one for the business (its own payroll taxes); never
//   an account number; numbered on from the first check number; a test page and a nudge in sixteenths of an inch, kept
//   for the business. Only the people paid by check, only when payroll is run in ClarityFlow.
//   Own forms: a person fills in their own W-4 and state form on the Pay tab, signs with their typed name and sends it;
//   only their own, only the tax forms (what's taken out before taxes and how they're paid stay as the business set
//   them), only when payroll is run here; the owner is told; never a Social Security number. Their W-2 from January to
//   April.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/payroll-checks.verify.ts
import fs from 'fs';
import { check, failures } from './fake-db';
import { amountInWords, checksHtml, addressLines } from '../../src/lib/payroll-checks';

const src = (f: string) => fs.readFileSync(f, 'utf8');
(async () => {
  console.log('The amount in words');
  check('dollars in words and cents over 100', amountInWords(1335.61) === 'One thousand three hundred thirty-five and 61/100' && amountInWords(100000.05) === 'One hundred thousand and 05/100'
    && amountInWords(0.5) === 'Zero and 50/100' && amountInWords(19.99) === 'Nineteen and 99/100' && amountInWords(2000) === 'Two thousand and 00/100', [amountInWords(1335.61), amountInWords(2000)]);

  console.log('The sheets');
  const c: any = { no: '1042', date: '2026-12-03', payee: 'Rae Lin', amount: 1335.61, memo: 'Pay for November 16 to 29', span: 'Pay for November 16 to 29, paid December 3, 2026',
    earned: [{ label: 'Pay', now: 1240 }, { label: 'Tips', now: 386 }, { label: 'Of the tips, cash you took home', now: 120, minus: true }],
    taxes: [{ label: 'Social Security', now: 100.81, year: 2381.54 }], employer: [{ label: 'Your Social Security', now: 100.81 }] };
  const h = checksHtml({ business: { name: 'North Loft', lines: ['12 Main Street', 'Raleigh, NC 27601'] }, checks: [c, { ...c, no: '1043', payee: 'Kim Tran' }], layout: 'top', nudge: { x: -1, y: 2 } });
  check('one sheet per check: the payee, the date, the amount in figures and words, the memo, the number', (h.match(/class="sheet"/g) || []).length === 2 && /Rae Lin/.test(h) && /December 3, 2026/.test(h) && /\$1,335\.61/.test(h) && /One thousand three hundred thirty-five and 61\/100/.test(h) && /Pay for November 16 to 29/.test(h) && />1042</.test(h));
  check('the person’s stub: taxes this payday and this year, and take-home', /Taxes taken out/.test(h) && /2,381\.54/.test(h) && /Take-home pay, this check/.test(h));
  check('the business’s stub: its own payroll taxes', /For your records/.test(h) && /Your payroll taxes/.test(h));
  check('the nudge moves everything printed, in sixteenths of an inch', /translate\(-0\.0625in, 0\.125in\)/.test(h));
  const mid = checksHtml({ business: { name: 'X', lines: [] }, checks: [c], layout: 'middle', nudge: { x: 0, y: 0 } });
  check('check in the middle: the check’s part sits a third of the way down', /<div class="part" style="top:3\.6667in"><div class="chk">/.test(mid) && /<div class="part" style="top:0in"><div class="chk">/.test(h));
  check('never an account or routing number', !/account number|routing|MICR|⑆|⑈/i.test(h.replace(/never your account number/g, '')));
  const test = checksHtml({ business: { name: 'X', lines: [] }, checks: [], layout: 'top', nudge: { x: 0, y: 0 }, test: true });
  check('a test page: a box where each thing goes', ['Date', 'Pay to the order of', 'Amount', 'Amount in words', 'Memo', 'Signature'].every((k) => test.includes(`>${k}<`)));
  check('the business’s address, from either way it’s kept', addressLines({ line1: '12 Main Street', city: 'Raleigh', state: 'NC', postalCode: '27601' }).join('|') === '12 Main Street|Raleigh, NC 27601' && addressLines({ street: '1 A St', city: 'X', state: 'NC', zip: '1' }).length === 2);

  console.log('On Payday');
  const dlg = src('src/components/money/PrintChecksDialog.tsx'); const page = src('src/app/(app)/money/page.tsx'); const screen = src('src/components/money/PaydayScreen.tsx');
  check('only the people paid by check with something to pay, only when payroll is run here', /methodsNow\[o\.id\]\?\.method === 'check' && \(o\.contractor \|\| \(selfTaxes\?\.by\[o\.id\]\?\.takeHome \|\| 0\) > 0\)/.test(page) && /\{self && p\.onPrintChecks && !!p\.checks && /.test(screen));
  check('once payday is recorded, from what was recorded, so the check matches its stub and the books', /if \(recordedRun\) return \(recordedRun\.people/.test(page) && /o\.recorded \? \(o\.recorded\.taxes \? \{ \.\.\.o\.recorded\.taxes, takeHome/.test(page));
  const forms = src('src/app/api/payroll/forms/route.ts');
  check('numbered by the server, in a transaction, for anyone who runs payroll; the next one never moves back; a recorded payday gets them too', /requireCan\(req, tenantId, 'money\.payroll'\)/.test(forms) && /db\.runTransaction/.test(forms)
    && /nextCheckNo: String\(Math\.max\(next, start \+ count\)\)/.test(forms) && /method: 'check', checkNo: byId\.get\(p\.staffId\)/.test(forms) && /await p\.onNumbers\(/.test(dlg));
  check('the nudge and the paper are kept for the business, within three inches, by the server', /Math\.max\(-48, Math\.min\(48, Math\.round\(Number\(v\) \|\| 0\)\)\)/.test(forms) && /action: 'checkSettings'/.test(page));
  check('the stub’s year so far is the pay stub’s own (lib/payroll-taxes stubTaxes)', /const st = stubTaxes\(\{ tenant: selectedTenant, staffId: o\.id, periodKey, payDate, runs: yearRuns/.test(page));

  console.log('Your own tax forms');
  const route = src('src/app/api/pay/tax-forms/route.ts'); const tf = src('src/components/staff/TaxFormsDialog.tsx'); const home = src('src/components/pay/PayHome.tsx'); const hr = src('src/app/api/pay/home/route.ts');
  check('only your own: the person signed in, never a staff id sent', /const staffId = who\.actor\.staffId;/.test(route) && !/b\?\.staffId/.test(route));
  check('signed with a typed name; only when payroll is run here; employees only', /if \(signedName\.length < 2\)/.test(route) && /runByOf\(tenant\) !== 'clarityflow'/.test(route) && /employmentType === 'contractor'/.test(route));
  check('only the W-4 and the state’s form: what’s taken out before taxes and how they’re paid stay', /cleanTaxForms\(\{ federal: fed, state: b\?\.forms\?\.state \}\)/.test(route) && /was\.pretax \? \{ pretax: was\.pretax \}/.test(route) && /was\.payMethod \? \{ payMethod: was\.payMethod \}/.test(route));
  check('the signature and the last versions kept, the owner told', /signed = \{ name: signedName, at: nowIso, by: 'self' \}/.test(route) && /\.slice\(0, 8\)/.test(route) && /type: 'tax_forms_changed'/.test(route) && /ownerId !== staffId/.test(route));
  check('never a Social Security number', !/\bssn\b/i.test(route) && !/<input[^>]*social/i.test(tf) && /Your Social Security number isn’t asked for here/.test(tf));
  check('the form in your own words, no plans or how you’re paid, signed and sent', /\{!me && <><Section title="Taken out before taxes"/.test(tf) && /Type your full name/.test(tf) && /'Sign and send'/.test(tf) && /disabled=\{busy \|\| p\.notReady \|\| \(me && signed\.trim\(\)\.length < 2\)\}/.test(tf));
  check('on the Pay tab, with last year’s W-2 from January to April once the business has put them in the app', /aria-label="Your tax forms"/.test(home) && /if \(month <= 4 && tenant\?\.payrollTax\?\.w2Given\?\.\[String\(year\)\]\)/.test(hr) && /staffId === who\.actor\.staffId && m\.employmentType !== 'contractor'/.test(hr) && /action: 'giveW2s'/.test(page));
  check('always the 2020 W-4; a form not sent stays as it was', /form: '2020', allowances: undefined/.test(route) && /clean\.federal \? \{ federal: clean\.federal \} : was\.federal \? \{ federal: was\.federal \}/.test(route));
  for (const [n, f] of [['checks dialog', dlg], ['tax forms', tf], ['pay tab', home]] as const)
    check(`house style: ${n}`, !/className="[^"]*\buppercase\b/.test(f) && !/ · /.test(f) && !/\{\/\*/.test(f) && !/font-black/.test(f));

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); } else console.log('\nAll passed');
})();
