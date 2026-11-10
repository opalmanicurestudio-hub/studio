// Checks the lease written from the business's settings (lib/lease-builder) and the six-step builder that makes it
// (components/renters/LeaseBuilder):
// - Its lease settings, with sensible defaults; insurance and license follow the paperwork already asked for.
// - Every lease has its 28 sections in order and its key terms, in the business's words (never "studio"), and each
//   section says what the setting says: rent and its first part-month, late fees (set amount, percentage, none), the
//   deposit, term and renewal, shared days, time away, repairs, collections, what renters get, insurance, the law.
// - What to sort out before sending; a lease's end date; shared days that clash; the fingerprint is a true SHA-256.
// - Grace days on a lease from the builder are its own, even with no fee.
// - Making the lease keeps its words, the settings version, a fingerprint and the terms the record doesn't otherwise
//   hold; the document to sign carries the fingerprint.
// - The builder's words and look, and that the Spaces page opens it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lease-builder.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const writes: any[] = [];
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return {
    collection: (_f: any, ...p: string[]) => ({ path: p.join('/') }),
    doc: (a: any, ...p: string[]) => ({ path: p.length ? [a?.path, ...p].filter(Boolean).join('/') : `${a.path}/new${writes.length}`, id: p.length ? p[p.length - 1] : `new${writes.length}` }),
    writeBatch: () => { const ops: any[] = []; return { set: (r: any, v: any) => ops.push({ op: 'set', r, v }), update: (r: any, v: any) => ops.push({ op: 'update', r, v }), commit: async () => { writes.push(...ops); } }; },
    getDocs: async () => ({ docs: [] }), query: (c: any) => c, where: () => null, orderBy: () => null, limit: () => null, runTransaction: async () => null, updateDoc: async () => {}, getDoc: async () => ({ exists: () => false }), setDoc: async () => {},
  };
  return load.call(this, request, ...rest);
};

(async () => {
  const L = await import('../../src/lib/lease-builder');
  const { resolveOffers } = await import('../../src/lib/renter-offers');
  const { responseCommitments } = await import('../../src/lib/maintenance');
  const { resolveLeavePolicy } = await import('../../src/lib/leave-policy');
  const { resolveCollectionsPolicy } = await import('../../src/lib/collections-policy');

  const fresh = L.resolveLeasePolicy({ name: 'Northside Studio' });
  check('defaults: 30 days’ notice, 60 for rent changes, deposit back in 14 days, version 1', fresh.noticeDays === 30 && fresh.rentChangeNoticeDays === 60 && fresh.depositReturnDays === 14 && fresh.version === 1 && fresh.legalName === 'Northside Studio');
  check('insurance and license follow what renters are already asked for', !fresh.insurance.required && L.resolveLeasePolicy({ bookingPageSettings: { automationRules: { requireInsurance: true, requireLicense: true } } }).insurance.required === true
    && L.resolveLeasePolicy({ bookingPageSettings: { automationRules: { requireLicense: true } } }).licenseRequired === true);
  check('the state comes from the business’s address until it’s set', L.resolveLeasePolicy({ address: { state: 'Ohio' } }).governingState === 'Ohio' && L.resolveLeasePolicy({ address: { state: 'Ohio' }, leasePolicy: { governingState: 'Texas' } }).governingState === 'Texas');
  check('out-of-range settings fall back', L.resolveLeasePolicy({ leasePolicy: { noticeDays: -5, depositReturnDays: 900, earlyEndFee: 'huge' } }).noticeDays === 30 && L.resolveLeasePolicy({ leasePolicy: { depositReturnDays: 900 } }).depositReturnDays === 14);

  const tenant: any = { name: 'Northside Studio', legalName: 'Northside Studio LLC', address: { state: 'Pennsylvania' }, leavePolicy: { offered: ['pause', 'reduced'] }, collectionsPolicy: { dunningDays: [3, 7, 14], autoBarAfterDaysLate: 30 },
    bookingPageSettings: { automationRules: { requireInsurance: true, requireLicense: true } }, renterOffers: { addons: { swaps: true }, prices: { swaps: 1500 } } };
  const policy = L.resolveLeasePolicy(tenant);
  const ctx = (t: any = tenant, over: any = {}) => ({ businessName: t.name, policy: L.resolveLeasePolicy(t), repairs: responseCommitments(null), leave: resolveLeavePolicy(t), collections: resolveCollectionsPolicy(t), offers: resolveOffers(t), ...over });
  const base: any = { renterName: 'Maya Ortiz', renterBusinessName: 'Lash Lab by Maya', renterNoticeAddress: '12 Elm St, Pittsburgh, PA', spaceName: 'Suite 4', spaceAddress: '1200 Main St', isShared: false, slot: null,
    accessHours: 'Monday to Saturday, 7:00 AM to 10:00 PM', amenities: ['Storage cabinet', 'Wi-Fi'], keyType: 'own_code', startDate: '2026-11-14', endDate: '2027-11-13', autoRenew: true, noticeDays: 30, earlyEndFee: 'none', holdover: 'same',
    rentCents: 90000, frequency: 'monthly', dueDay: 1, prorateFirst: true, rentChangeNoticeDays: 60, graceDays: 3, lateFee: { type: 'flat', amountCents: 2500 }, declinedFeeCents: 0, payByCard: true, payByAutopay: true, payOffline: true,
    depositCents: 90000, depositRefundable: true, depositReturnDays: 14, depositAsLastMonth: false, agreedCharges: [{ label: 'Lost key', capCents: 2500 }], sellProducts: true, noPoach: false,
    insurance: policy.insurance, licenseRequired: true, houseRules: 'House rules, version 2', changesNeedOk: true, damageByRenter: true, propertyClause: true };
  const b = L.buildLease(base, ctx());
  const sec = (k: string, x = b) => x.sections.find((s: any) => s.key === k)!.text;
  check('27 sections, in order, numbered (a lease that renews on its own has no staying-on section)', b.sections.length === 27 && !b.sections.some((x: any) => x.key === 'holdover') && b.sections.map((s: any) => s.n).join() === Array.from({ length: 27 }, (_, i) => i + 1).join() && b.sections[0].title === 'Parties' && b.sections[26].title === 'The whole agreement');
  check('key terms at the top: space, term, rent, late, deposit, insurance, closures, ending early', b.keyTerms.map((k: any) => k.label).join() === 'Space,Term,Rent,Late,Deposit,Insurance,Closures,Ending early' && b.text.indexOf('Key terms') < b.text.indexOf('1. Parties'));
  check('the business’s own words, never "studio"', !/studio/i.test(b.text.replace(/Northside Studio/g, '')));
  check('parties by legal name and trading name', sec('parties') === 'This agreement is between Northside Studio LLC (the Business) and Maya Ortiz, doing business as Lash Lab by Maya (the Renter).');
  check('the first part-month: the rule (from signing if that’s later), with the start date’s figure', sec('rent').includes('The first bill is charged by the day, from the start date (or the day the Renter signs, if that’s later) to the day before the next due date: starting on November 14, that’s $510.00.'));
  check('…rent changes only at renewal, or with notice when there’s no end date', /only at renewal, with at least 60 days’ written notice/.test(sec('rent')) && /Rent can change only with at least 60 days’ written notice/.test(sec('rent', L.buildLease({ ...base, endDate: null }, ctx()))));
  check('…or a full month when that’s chosen', !/first bill/.test(sec('rent', L.buildLease({ ...base, prorateFirst: false }, ctx()))));
  check('the late fee: a set amount, once per bill', sec('late') === 'Rent not paid within 3 days of the due date is late, and a fee of $25.00 is added once to that bill.');
  check('…a percentage with its cap', /a fee of 5% of the amount due, up to \$40\.00 is added/.test(sec('late', L.buildLease({ ...base, lateFee: { type: 'percent', percent: 5, maxFeeCents: 4000 } }, ctx()))));
  check('…or none', /No late fee is charged\./.test(sec('late', L.buildLease({ ...base, lateFee: null }, ctx()))));
  check('…and a declined-payment fee only when set, which the business may add', !/declined/.test(sec('late')) && /declined or returned, the Business may add a fee of \$25\.00/.test(sec('late', L.buildLease({ ...base, declinedFeeCents: 2500 }, ctx()))));
  const g0 = L.buildLease({ ...base, graceDays: 0 }, ctx());
  check('…with no grace days, late from the day after it’s due', /^Rent not paid by the due date is late/.test(sec('late', g0)) && g0.keyTerms.find((k: any) => k.label === 'Late')!.text === '$25.00 if not paid by the due date, once per bill');
  check('the deposit: back within the days set, with each deduction listed', /refundable deposit of \$900\.00/.test(sec('deposit')) && /Within 14 days after move-out/.test(sec('deposit')));
  check('…none held', sec('deposit', L.buildLease({ ...base, depositCents: 0 }, ctx())) === 'No deposit is held.');
  check('…a non-refundable one never says it covers the last month', !/last/.test(sec('deposit', L.buildLease({ ...base, depositRefundable: false, depositAsLastMonth: true }, ctx()))));
  check('renewal on its own, with the notice', /renews for the same length unless either side gives written notice at least 30 days before it ends/.test(sec('term')));
  const open = L.buildLease({ ...base, endDate: null, autoRenew: false }, ctx());
  check('…an open-ended lease, with no staying-on section and its ending in its own words', /continues until either side ends it/.test(sec('term', open)) && open.sections.length === 27 && !open.sections.some((x: any) => x.key === 'holdover')
    && /^Either side may end the lease with 30 days’ written notice/.test(sec('early', open)) && open.keyTerms.some((k: any) => k.label === 'Ending'));
  const fixed = L.buildLease({ ...base, autoRenew: false, holdover: 'plus10' }, ctx());
  check('ending early: a fee only when chosen, which they owe; staying on only for a lease that doesn’t renew, which the business may charge', /they owe one month’s rent as an early-end fee/.test(sec('early', L.buildLease({ ...base, earlyEndFee: 'one_period' }, ctx())))
    && fixed.sections.length === 28 && /the Business may charge the rent plus 10% for each month or part of one they stay, until they leave/.test(sec('holdover', fixed)));
  check('notice reads naturally for one day or many', /with 1 day’s written notice/.test(sec('early', L.buildLease({ ...base, noticeDays: 1 }, ctx()))) && /with 30 days’ written notice/.test(sec('early')));
  check('the hours read exactly as set', /Monday to Saturday, 7:00 AM to 10:00 PM/.test(sec('space')));
  check('a shared space: its days and times', /on Tuesday and Thursday from 9:00 AM to 1:00 PM/.test(sec('space', L.buildLease({ ...base, isShared: true, slot: { days: [4, 2], startTime: '09:00', endTime: '13:00' } }, ctx()))));
  check('things that come with it read naturally', /with storage cabinet and Wi-Fi/.test(sec('space')));
  check('how rent is paid follows the choices', /by card in the Renter’s portal, by autopay if the Renter turns it on or by cash/.test(sec('pay')) && !/autopay/.test(sec('pay', L.buildLease({ ...base, payByAutopay: false }, ctx()))));
  check('agreed charges, each with its cap, and only those', /^Only these charges may be made/.test(sec('charges')) && /lost key \(up to \$25\.00\)/.test(sec('charges')));
  check('time away from the options offered', /pause rent for up to 16 weeks .* or pay 50% of the rent/.test(sec('away')) && /doesn’t change the rent/.test(sec('away', L.buildLease(base, ctx({ ...tenant, leavePolicy: { offered: [] } })))));
  check('repairs from the response-time promise', /answers within 1 hour for urgent problems, 4 hours for high/.test(sec('repairs')));
  check('collections from the steps set', /Reminders are sent 3, 7 and 14 days after a bill is late\. If rent is 30 days late, the Renter’s bookings pause/.test(sec('unpaid')));
  check('what renters get: included, add-ons with their price, and the gift card credit', /along with packages and memberships and Northside Studio gift cards/.test(sec('tools')) && /may add swap days at \$15\.00 a month/.test(sec('tools')) && /credits the amount redeemed/.test(sec('tools')));
  check('…no gift card credit when renters can’t take them', !/credits the amount redeemed/.test(sec('tools', L.buildLease(base, ctx({ ...tenant, giftCardSettings: { renters: { salonCards: false } } })))));
  check('insurance minimums in round dollars, the business named', /at least \$1,000,000 per claim and \$2,000,000 per year, naming the Business as additional insured/.test(sec('insurance')));
  check('…or encouraged when not required', /isn’t required/.test(sec('insurance', L.buildLease({ ...base, insurance: { ...policy.insurance, required: false } }, ctx()))));
  const noMin = L.buildLease({ ...base, insurance: { ...policy.insurance, perClaimCents: 0, perYearCents: 0 } }, ctx());
  check('…no minimums written when none is set; a lapse lets the business pause bookings until a copy is on file', !/\$0/.test(sec('insurance', noMin)) && /may pause the Renter’s bookings \d+ days after written notice, until a current copy is on file/.test(sec('insurance')));
  check('no hiring away the team only when chosen, and only where the law allows', !/hire away/.test(sec('independent')) && /where the law allows it, the Renter will not hire away/.test(sec('independent', L.buildLease({ ...base, noPoach: true }, ctx()))));
  check('the law of the state set; the notice address', /The law of Pennsylvania applies/.test(sec('law')) && /by mail to the Renter at 12 Elm St/.test(sec('notices')));
  check('…a state written as its code reads as its name', L.stateName('pa') === 'Pennsylvania' && L.stateName('Ohio') === 'Ohio' && /The law of Texas applies/.test(sec('law', L.buildLease(base, ctx({ ...tenant, leasePolicy: { governingState: 'TX' } })))));
  check('house rules attached when chosen', /attached house rules \(House rules, version 2\)/.test(sec('care')) && /^This lease and the attached house rules are the whole agreement/.test(sec('whole')) && /^This lease is the whole agreement/.test(sec('whole', L.buildLease({ ...base, houseRules: null }, ctx()))));
  check('signed in the portal, or with lines to sign on paper', /electronically, as recorded with this lease\.$/.test(b.text) && /Signed by the Renter: _+ {2}Date/.test(L.buildLease({ ...base, signedOnPaper: true }, ctx()).text));
  check('a lease’s end: the day before the same date, a shorter month’s last day', L.leaseEndAfter('2026-11-14', 12) === '2027-11-13' && L.leaseEndAfter('2026-08-31', 6) === '2027-02-27' && L.leaseEndAfter('2026-01-31', 1) === '2026-02-27' && L.leaseEndAfter('2028-01-31', 1) === '2028-02-28');
  check('shared days clash only where days and times overlap (no times is the whole day)', L.slotsClash({ days: [2] }, { days: [2], startTime: '13:00', endTime: '17:00' })
    && !L.slotsClash({ days: [2], startTime: '09:00', endTime: '13:00' }, { days: [2], startTime: '13:00', endTime: '17:00' })
    && L.slotsClash({ days: [2, 4], startTime: '09:00', endTime: '14:00' }, { days: [4], startTime: '13:00', endTime: '17:00' }) && !L.slotsClash({ days: [1] }, { days: [2] }));

  // The fingerprint is a true SHA-256, the same as the server's.
  const { sha256Hex } = await import('../../src/lib/sha256');
  const { createHash } = await import('crypto');
  check('the lease fingerprint matches SHA-256 exactly', [b.text, '', 'abc', 'x'.repeat(55), 'y'.repeat(64), 'Café ’quoted’ 🙂'].every((t) => sha256Hex(t) === createHash('sha256').update(t, 'utf8').digest('hex')));

  const checks = L.leaseChecks({ ...base, renterNoticeAddress: '' }, ctx(), { houseRulesAvailable: true });
  check('before sending: what’s missing, and how to fix it', checks.some((c: any) => !c.ok && c.fix === 'address') && checks.some((c: any) => !c.ok && c.fix === 'review') && checks.some((c: any) => c.ok && /Pennsylvania law applies/.test(c.text)));
  check('…the District of Columbia reads properly', L.leaseChecks(base, ctx({ ...tenant, leasePolicy: { governingState: 'DC' } }), { houseRulesAvailable: true }).some((c: any) => c.ok && c.text === 'The law of the District of Columbia applies'));
  check('…a recorded review is noted', L.leaseChecks(base, ctx({ ...tenant, leasePolicy: { attorneyReview: { at: '2026-10-20', by: 'Smith Law' } } }), { houseRulesAvailable: true }).some((c: any) => c.ok && /Attorney review recorded Oct 20, 2026/.test(c.text)));
  const sl = L.leaseChecks(base, ctx(), { houseRulesAvailable: true, staffLike: ['Their booking record pays them a commission on their services. The lease says they run their own business.'] });
  check('…a booking record that pays them like staff is a check to sort out before sending, with the way to it', sl.some((c: any) => !c.ok && c.fix === 'staff' && /pays them a commission/.test(c.text)) && L.leaseChecks(base, ctx(), { houseRulesAvailable: true }).every((c: any) => c.fix !== 'staff')
    && /where\('renterId', '==', renter\.id\)/.test(readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8')) && /c\.fix === 'staff' && staffLike\.providerId/.test(readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8')));
  check('…a bad date', L.leaseChecks({ ...base, endDate: '2026-01-01' }, ctx(), { houseRulesAvailable: false }).some((c: any) => !c.ok && c.fix === 'amounts'));

  // Making the lease.
  const { createLease } = await import('../../src/lib/booth-rental-service');
  await createLease({} as any, { tenantId: 't1', locationId: 'l1', boothId: 'b1', renterId: 'r1', rentAmountCents: 90000, frequency: 'monthly', dueDay: 1, firstChargeDate: '2026-11-14', startDate: '2026-11-14', endDate: null, autoRenew: true,
    earlyTerminationNoticeDays: 30, deposit: null, lateFeePolicy: { enabled: false, graceDays: 3, type: 'flat' }, scheduleSlot: null, perks: [], includedAmenities: [], houseRules: '', signedDocumentUrl: null, isShared: false,
    leaseTerms: b.text, requireSignature: true, renterName: 'Maya Ortiz', extra: { leaseFrom: 'builder', leaseVersion: 3, termsSha256: 'abc123', leaseTermsSnapshot: { depositReturnDays: 14 }, status: 'active', rentAmountCents: 1 } } as any);
  const leaseW = writes.find((w) => w.v?.leaseTerms);
  const docW = writes.find((w) => w.v?.kind === 'lease');
  check('the lease keeps its words, its settings version, its fingerprint and its extra terms', leaseW?.v.leaseTerms === b.text && leaseW.v.leaseVersion === 3 && leaseW.v.termsSha256 === 'abc123' && leaseW.v.leaseTermsSnapshot?.depositReturnDays === 14);
  check('…and the extras never replace a core field', leaseW?.v.status === 'pending_signature' && leaseW.v.rentAmountCents === 90000);

  // Grace days: a lease from the builder keeps its own, even with no late fee; older leases keep three.
  const { lateness } = await import('../../src/lib/rent-cycle');
  const inv = { dueDate: '2026-12-01', amountCents: 90000 };
  check('a builder lease with no fee and no grace days is late the day after it’s due', lateness({ leaseFrom: 'builder', lateFeePolicy: { enabled: false, graceDays: 0 } }, inv, '2026-12-02').late === true
    && lateness({ leaseFrom: 'builder', lateFeePolicy: { enabled: false, graceDays: 5 } }, inv, '2026-12-05').late === false && lateness({ leaseFrom: 'builder', lateFeePolicy: { enabled: false, graceDays: 5 } }, inv, '2026-12-05').feeCents === 0);
  check('…an older lease with no fee keeps three days', lateness({ lateFeePolicy: { enabled: false, graceDays: 0 } }, inv, '2026-12-03').late === false && lateness({ lateFeePolicy: { enabled: false } }, inv, '2026-12-05').late === true);
  check('the nightly late check reads grace days the same way', /policy\.enabled \|\| lease\.leaseFrom === 'builder' \? \(Number\(policy\.graceDays\) \|\| 0\) : 3/.test(readFileSync('src/app/api/cron/nightly/route.ts', 'utf8')));
  check('…the document to sign carries the fingerprint', docW?.v.meta?.termsSha256 === 'abc123' && docW.v.body === b.text);

  // The builder's words and look.
  const src = readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8');
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  check('no tool names', !AI.test(src) && !AI.test(readFileSync('src/lib/lease-builder.ts', 'utf8')));
  check('never says to call or contact', !/call us|contact us/i.test(src));
  check('no emoji or check marks', !/[✓✔✅❌]|\p{Extended_Pictographic}/u.test(src));
  check('no JSX comments, no escaped quotes left in the words', !/\{\/\*/.test(src) && !/\\u2019/.test(src));
  check('no red (nothing here is destructive)', !/#b42318/i.test(src));
  check('says it’s a starting point and to have an attorney review it', /starting point, not legal advice\. Have an attorney in your state review it once/.test(src));
  const buttons = src.split('<button').slice(1).map((x) => { const i = x.indexOf('className='); return i < 0 ? '' : x.slice(i, i + 200); });
  check('every button at least 44px tall', buttons.every((x) => /h-11|min-h-\[44px\]|\{btn\}|\{dark\}|\$\{btn\}|\$\{dark\}/.test(x)), buttons.filter((x) => !/h-11|min-h-\[44px\]|\{btn\}|\{dark\}|\$\{btn\}|\$\{dark\}/.test(x)));
  const booths = readFileSync('src/app/(app)/booths/page.tsx', 'utf8');
  check('a space already rented whole, overlapping shared days, or theirs already, can’t be leased again; shared needs days', /Someone already rents this whole space/.test(src) && /slotsClash\(/.test(src) && /!!boothId && !clash/.test(src)
    && /already \$\{d\.renterName \? 'has' : 'have'\} a lease on this space/.test(src) && /d\.isShared && !d\.slot\?\.days\?\.length \? 'Choose their days\.'/.test(src));
  check('only free or part-used spaces are offered', /\['vacant', 'partial', 'available'\]\.includes/.test(src));
  check('money fields take typing as typed and tidy up after', /function MoneyInput/.test(src) && (src.match(/<MoneyInput /g) || []).length >= 5 && !/value=\{dollars\(d\./.test(src));
  check('choosing a space fills in its rent, a deposit of one period and its own address', /const pickBooth = /.test(src) && /depositCents: rent \}\)\);/.test(src) && /spaceAddress: loc\?\.address \|\| ''/.test(src));
  check('a draft comes back as left (its space and length too), and the end date isn’t reset on opening', /saved\?\.boothId/.test(src) && /saved\?\.length/.test(src) && /firstRun\.current/.test(src));
  check('perks can be added', /function Perks/.test(src) && /perks: \(own\.on \? \[\] : perks\)\.map/.test(src) && /buildLease\(\{ \.\.\.d, signedOnPaper: !sign, perks \}/.test(src));
  check('lease settings that can’t be saved still let the lease go, and say so', /' Your changes to the lease settings apply to this lease only: the owner keeps them for every lease\.'/.test(src) && /JSON\.stringify\(policy\.attorneyReview\) !== JSON\.stringify\(basePolicy\.attorneyReview\)/.test(src));
  check('the fingerprint never comes back empty; an attorney’s own lease keeps no builder terms; paper gets lines to sign', /const fingerprint = \(text: string\) => sha256Hex\(text\)/.test(src) && /leaseTermsSnapshot: own\.on \? null :/.test(src) && /signedOnPaper: !sign/.test(src));
  check('a proper dialog: Escape closes, focus starts on the title and stays inside, the page behind holds still', /e\.key === 'Escape'/.test(src) && /titleRef\.current\?\.focus\(\)/.test(src) && /e\.key !== 'Tab'/.test(src) && /document\.body\.style\.overflow = 'hidden'/.test(src));
  check('the dialog sits over the page, which goes inert, and focus goes back where it was', /createPortal\(/.test(src) && /el\.setAttribute\('inert', ''\)/.test(src) && /opener\.focus\(\)/.test(src) && /at === first \|\| !inside/.test(src));
  check('nothing closes it while a lease is being made', /const close = \(\) => \{ if \(!busyRef\.current\) p\.onClose\(\); \}/.test(src) && /e\.key === 'Escape'\) \{ e\.preventDefault\(\); close\(\)/.test(src) && (src.match(/onClick=\{close\} disabled=\{busy\}/g) || []).length === 2);
  check('the draft keeps the signing choice, a pasted lease and lease settings changed here', /JSON\.stringify\(\{ d, boothId, length, perks, sign, own, bizSig, bookings, policy: pickPolicy\(policy\)/.test(src) && /saved\?\.sign !== false/.test(src) && /saved\?\.own/.test(src) && /saved\?\.policy/.test(src));
  check('lease settings that don’t save leave no settings version on the lease, and say why', /version = null;/.test(src) && /permission-denied/.test(src) && /didn’t save, so they apply to this lease only/.test(src));
  check('a new space replaces everything from the last one; clearing it clears them', /rentCents: rent, frequency: rent \?/.test(src) && /depositCents: rent \}\)\);/.test(src) && /isShared: String\(b\.status\) === 'partial', slot: null/.test(src) && /spaceName: '', spaceAddress: '', amenities: \[\], isShared: false, slot: null, rentCents: 0, depositCents: 0/.test(src));
  check('shared times: both or neither, and the end after the start', /Add both times, or neither for the whole day\./.test(src) && /The end time has to be after the start time\./.test(src));
  check('labels match the lease: holdover only when it doesn’t renew, “may add” for a declined payment, rent changes with notice', /\{d\.endDate && !d\.autoRenew && <Row label="If they stay past the end without renewing"/.test(src) && /You may add it when a card or bank payment is declined/.test(src) && /'With written notice first'/.test(src));
  // Renewal: one rule for the nightly job and the owner's Renew button.
  const nt = (l: any) => L.nextTermEnd(l)?.end ?? null;
  check('a lease in whole months renews a full term from its end: a year stays a year', nt({ startDate: '2026-11-10', endDate: '2027-11-09', termMonths: 12 }) === '2028-11-09' && nt({ startDate: '2026-11-10', endDate: '2028-11-09', termMonths: 12 }) === '2029-11-09');
  check('…a start on the 31st comes back to its own day after a short month', nt({ startDate: '2026-08-31', endDate: '2027-02-27', termMonths: 6 }) === '2027-08-30' && nt({ startDate: '2026-08-31', endDate: '2027-08-30', termMonths: 6 }) === '2028-02-28' && nt({ startDate: '2026-08-31', endDate: '2028-02-28', termMonths: 6 }) === '2028-08-30');
  check('…a pause that moved the end, or a signed renewal, carries forward: the next term is still full', nt({ startDate: '2026-11-10', endDate: '2027-11-19', termMonths: 12 }) === '2028-11-19' && nt({ startDate: '2026-11-10', endDate: '2028-06-30', termMonths: 12, previousEndDate: '2027-11-09' }) === '2029-06-30');
  const firstRenew: any = L.nextTermEnd({ startDate: '2026-01-01', endDate: '2026-06-30' });
  check('…other leases keep their first term in days, so a second renewal never doubles it', firstRenew.end === '2026-12-27' && firstRenew.termDays === 180 && nt({ startDate: '2026-01-01', endDate: '2026-12-27', termDays: 180, renewedAt: 'x' }) === '2027-06-25');
  check('…after a signed renewal, the days since the end before it', (L.nextTermEnd({ startDate: '2026-01-01', endDate: '2027-06-30', previousEndDate: '2026-12-31', renewedAt: 'x' }) as any).termDays === 181);
  check('…a lease renewed before the term was kept: half its length so far, at most a year', (L.nextTermEnd({ startDate: '2025-01-01', endDate: '2026-12-31', renewedAt: '2025-12-31' }) as any).termDays === 365
    && (L.nextTermEnd({ startDate: '2026-01-01', endDate: '2026-02-28', renewedAt: 'x' }) as any).termDays === 29 && L.nextTermEnd({ endDate: '' }) === null);
  const nightlySrc = readFileSync('src/app/api/cron/nightly/route.ts', 'utf8');
  check('the nightly renewal and the Renew button both use it, and keep the term in days', /const nt = nextTermEnd\(l\);/.test(nightlySrc) && /\.\.\.\(nt\.termDays \? \{ termDays: nt\.termDays \} : \{\}\)/.test(nightlySrc)
    && /const nt = nextTermEnd\(l\);/.test(booths) && /\.\.\.\(nt\.termDays \? \{ termDays: nt\.termDays \} : \{\}\)/.test(booths) && !/const termDays = l\.startDate/.test(booths) && !/const termDays = l\.startDate/.test(nightlySrc));
  check('…days a pause added to the end aren’t counted in the term', (L.nextTermEnd({ startDate: '2026-01-01', endDate: '2027-01-10', endDateExtendedByLeaveDays: 10 }) as any).termDays === 364);
  check('…a signed renewal that only changed the rent doesn’t halve the next term', (L.nextTermEnd({ startDate: '2026-01-01', endDate: '2026-12-31', renewedAt: 'x', renewalDocumentId: 'd1' }) as any).termDays === 364);
  check('signing a renewal keeps the lease’s own term (worked out before the signing) for renewing on its own', /if \(!\(Number\(lease\.termMonths\) > 0\) && !\(Number\(lease\.termDays\) > 0\)\) \{ const t = nextTermEnd\(lease\); if \(t\?\.termDays\) upd\.termDays = t\.termDays; \}/.test(readFileSync('src/app/api/portal/renter/route.ts', 'utf8')));
  check('the Renew button says when there’s nothing to renew', /title: 'Nothing to renew', description: 'A lease with no end date runs until either side ends it\.'/.test(booths) && !/if \(!l\.endDate\) return;/.test(booths.slice(booths.indexOf('const renewLease'), booths.indexOf('const renewLease') + 400)));
  check('perks set before switching to an attorney’s lease are said not to be added', /won’t be added\. Put \{perks\.length === 1/.test(src));
  check('steps open only once the ones before are filled in, and say why Send waits', /disabled=\{!reachable\(i\)\}/.test(src) && /<span className="sr-only">, done<\/span>/.test(src) && /step === 5 && !valid\.every\(Boolean\)/.test(src));
  check('the Spaces page opens the builder for a new lease', /const openLeaseWizard = \(renterId: string, boothId\?: string \| null\) => \{ setBuilderBoothId\(boothId \|\| null\); setBuilderRenterId\(renterId\); \}/.test(booths) && /defaultBoothId=\{builderBoothId\}/.test(booths) && /<LeaseBuilder/.test(booths) && /leases=\{\(leases\.data/.test(booths) && !/handleCreateLease|leaseDialogOpen/.test(booths));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
