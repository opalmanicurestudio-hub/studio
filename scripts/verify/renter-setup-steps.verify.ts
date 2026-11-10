// Checks a renter's setup steps and their W-9 in the portal:
// - Getting set up lists the lease, deposit, card, required insurance and license, a W-9, and (for someone who books
//   here) hours, a service and card deposits, each worked out from what's on file now, each opening the exact screen.
// - Optional steps never hold up "done"; a step comes back when its reason does (an insurance date runs out).
// - A W-9 is checked the same way wherever it's sent from, the number is encrypted at once, and only the last 4
//   digits ever come back. The portal saves it through its own session; nothing logs the request.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-setup-steps.verify.ts
import { readFileSync } from 'fs';
import { check, failures } from './fake-db';

const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  process.env.W9_ENCRYPTION_KEY = 'a'.repeat(64);
  const S = await import('../../src/lib/renter-setup-steps');
  const M = await import('../../src/components/rent/portal-map');
  const W = await import('../../src/lib/w9-record');
  const C = await import('../../src/lib/tin-crypto');
  const today = '2026-11-09';
  const base = { renter: { id: 'r1', bookingMode: 'studio' }, lease: null, deposit: null, provider: null, serviceCount: 0, rules: null, todayIso: today, businessTakesCards: false, cardUsable: false, businessName: 'Northside Studio' };
  const keys = (c: any) => (c?.items || []).map((i: any) => i.key);
  const step = (c: any, k: string) => (c?.items || []).find((i: any) => i.key === k);

  check('no renter record: no steps', S.renterSetupSteps({ ...base, renter: null }) === null);

  // Lease, deposit, card.
  const pending = S.renterSetupSteps({ ...base, lease: { status: 'pending_signature' }, deposit: { status: 'not_collected', agreedCents: 90000, canPayOnline: false }, businessTakesCards: true });
  check('a lease waiting to be signed is a step, opening the lease', step(pending, 'lease')?.done === false && step(pending, 'lease')?.view === 'lease' && step(pending, 'lease')?.place === 'space');
  check('the deposit is a step, opening Money, payable once the lease is signed', step(pending, 'deposit')?.done === false && step(pending, 'deposit')?.place === 'money' && /\$900\.00, once your lease is signed/.test(step(pending, 'deposit')?.hint));
  check('a card is an optional step, only where the business takes cards', step(pending, 'card')?.optional === true && !keys(S.renterSetupSteps({ ...base, lease: { status: 'active' } })).includes('card'));
  const active = S.renterSetupSteps({ ...base, lease: { status: 'active' }, deposit: { status: 'held', agreedCents: 90000, collectedCents: 90000 }, businessTakesCards: true, cardUsable: true });
  check('signed, paid and a card on file: those steps are done', step(active, 'lease')?.done && step(active, 'deposit')?.done && step(active, 'card')?.done);
  check('done steps say what’s done', step(active, 'lease')?.doneLabel === 'Lease signed' && step(active, 'deposit')?.doneLabel === 'Deposit paid' && step(active, 'card')?.doneLabel === 'Card saved for rent');
  const part = S.renterSetupSteps({ ...base, lease: { status: 'active' }, deposit: { status: 'held', agreedCents: 90000, collectedCents: 30000 } });
  check('part of the deposit paid: the rest is still a step, saying how much is in', step(part, 'deposit')?.done === false && step(part, 'deposit')?.label === 'Pay the rest of your deposit' && /\$300\.00 of \$900\.00 paid so far/.test(step(part, 'deposit')?.hint));
  check('a deposit already returned, partly returned or kept is settled', ['returned', 'partly_returned', 'forfeited'].every((st) => step(S.renterSetupSteps({ ...base, lease: { status: 'active' }, deposit: { status: st, agreedCents: 90000, collectedCents: 0 } }), 'deposit')?.done === true));
  check('on leave still counts as their lease', step(S.renterSetupSteps({ ...base, lease: { status: 'on_leave' } }), 'lease')?.done === true);
  check('a deposit payable here says so', /payable here by card/.test(step(S.renterSetupSteps({ ...base, lease: { status: 'active' }, deposit: { status: 'not_collected', agreedCents: 50000, canPayOnline: true } }), 'deposit')?.hint));
  check('no deposit agreed: no deposit step', !keys(S.renterSetupSteps({ ...base, lease: { status: 'active' }, deposit: { status: 'none', agreedCents: 0 } })).includes('deposit'));
  check('an ended lease asks for nothing', !keys(S.renterSetupSteps({ ...base, lease: { status: 'ended' } })).includes('lease'));

  // Papers.
  const req = { requireInsurance: true, requireLicense: true };
  const papers = S.renterSetupSteps({ ...base, rules: req, renter: { id: 'r1', insuranceExpiry: '2026-10-01', licenseExpiry: '2027-06-01', licenseDocUrl: 'x' } });
  check('required insurance that ran out: Renew, opening Insurance and license', step(papers, 'insurance')?.label === 'Renew your liability insurance' && step(papers, 'insurance')?.done === false && step(papers, 'insurance')?.view === 'insurance');
  check('a current license: done', step(papers, 'license')?.done === true);
  check('nothing required: no insurance or license steps', !keys(S.renterSetupSteps(base)).some((k: string) => k === 'insurance' || k === 'license'));
  const soon = S.renterSetupSteps({ ...base, rules: req, renter: { id: 'r1', insuranceExpiry: '2026-11-20' } });
  check('expiring soon: listed to renew, but it holds nothing up', step(soon, 'insurance')?.done === false && step(soon, 'insurance')?.optional === true && step(soon, 'insurance')?.label === 'Renew your liability insurance' && /expires in 11 days/.test(step(soon, 'insurance')?.hint));
  check('a missing required license: Add, with why', step(S.renterSetupSteps({ ...base, rules: req, renter: { id: 'r1' } }), 'license')?.label === 'Add your license' && /Northside Studio needs it on file to rent here\./.test(step(S.renterSetupSteps({ ...base, rules: req, renter: { id: 'r1' } }), 'license')?.hint));
  check('a W-9 is always offered, optional, opening the tax form', step(papers, 'w9')?.optional === true && step(papers, 'w9')?.view === 'w9' && step(papers, 'w9')?.done === false);
  check('…and done once one is on file, however it was stored', step(S.renterSetupSteps({ ...base, renter: { id: 'r1', w9: { tinLast4: '6789' } } }), 'w9')?.done === true && step(S.renterSetupSteps({ ...base, renter: { id: 'r1', w9OnFile: true } }), 'w9')?.done === true);
  check('only someone signed in as their renter record is asked for one', !keys(S.renterSetupSteps({ ...base, linked: false })).includes('w9'));

  // Bookings.
  const books = S.renterSetupSteps({ ...base, renter: { id: 'r1', bookingMode: 'studio' }, provider: { week: {} }, serviceCount: 0 });
  check('booking here: hours and a service hold up booking, and open their setup screens', step(books, 'hours')?.blocksBooking && step(books, 'services')?.blocksBooking && step(books, 'hours')?.view === 'setup:hours' && step(books, 'services')?.view === 'setup:services' && books?.bookingReady === false);
  check('card deposits are optional and open Card payments', step(books, 'deposits')?.optional === true && step(books, 'deposits')?.view === 'setup:payments');
  const ready = S.renterSetupSteps({ ...base, renter: { id: 'r1', bookingMode: 'studio' }, provider: { week: { mon: { enabled: true, start: '09:00', end: '17:00' } } }, serviceCount: 2 });
  check('hours and a service set: ready to be booked', ready?.bookingReady === true && step(ready, 'hours')?.done && step(ready, 'services')?.done);
  check('their own system: no booking steps', !keys(S.renterSetupSteps({ ...base, renter: { id: 'r1', bookingMode: 'own' }, provider: { week: {} } })).some((k: string) => ['hours', 'services', 'deposits'].includes(k)));
  check('not chosen yet: no booking steps, and not all done', !keys(S.renterSetupSteps({ ...base, renter: { id: 'r1' }, provider: { week: {} } })).includes('hours') && S.renterSetupSteps({ ...base, renter: { id: 'r1' }, provider: { week: {} } })?.allDone === false);

  // Counting.
  check('only required steps count toward what’s left', pending?.remaining === 2 && active?.remaining === 0);
  check('optional steps still open are counted, so they can be shown', pending?.optionalLeft === 2 && active?.optionalLeft === 1);
  check('bookable means hours and a service, even before the booking choice is made', S.renterSetupSteps({ ...base, renter: { id: 'r1' }, provider: { week: { mon: { enabled: true, start: '09:00', end: '17:00' } } }, serviceCount: 1 })?.bookingReady === true && S.renterSetupSteps({ ...base, renter: { id: 'r1' }, provider: { week: {} }, serviceCount: 1 })?.bookingReady === false);
  check('all done needs the required steps and a booking choice', active?.allDone === true && S.renterSetupSteps({ ...base, renter: { id: 'r1' }, lease: { status: 'active' }, provider: { week: {} } })?.allDone === false);
  check('not set up to book here: no booking choice to make, and nothing holds up done', S.renterSetupSteps({ ...base, renter: { id: 'r1' }, provider: null })?.canBook === false && S.renterSetupSteps({ ...base, renter: { id: 'r1' }, provider: null })?.allDone === true);
  check('the card offers the booking choice only to someone set up to book here', /const canBook = cl\.canBook !== false;/.test(src('src/components/rent/setup.tsx')) && /\{canBook && \(!cl\.modeChosen \|\| switching\) && <div/.test(src('src/components/rent/setup.tsx')));
  check('hiding is remembered', S.renterSetupSteps({ ...base, renter: { id: 'r1', checklistDismissedAt: '2026-11-01' } })?.dismissed === true);

  // Every step opens a screen the portal has, in a place that renter has.
  const full = { booksHere: true, hasRenter: true, hasLease: true, swapsOn: false };
  const all = [pending, active, papers, books].flatMap((c: any) => c.items);
  check('every step opens a real screen this renter can use', all.every((i: any) => (i.view === null || M.viewAllowed(i.view, full)) && M.placesFor(full).includes(i.place)), all.filter((i: any) => i.view && !M.viewAllowed(i.view, full)).map((i: any) => i.key));
  check('the W-9 is a Space screen with its own row', M.VIEW_TITLES.w9 === 'Tax form (W-9)' && M.VIEW_PARENT.w9 === 'space' && M.placeRows('space', full).some((g: any) => g.views.includes('w9')) && M.RENTER_ONLY.has('w9'));

  // W-9 checks and sealing.
  check('a nine-digit SSN or EIN, with or without dashes', W.validTin('123-45-6789', 'ssn') && W.validTin('12-3456789', 'ein') && W.validTin('123456789', 'ssn') && !W.validTin('12345678', 'ssn') && !W.validTin('12345678x', 'ssn') && !W.validTin('123456789', 'itin'));
  check('what’s missing is said plainly', W.w9Problem({}) === 'Your SSN or EIN is needed.' && W.w9Problem({ tin: '123', tinType: 'ssn' }) === 'An SSN has nine digits.'
    && W.w9Problem({ tin: '123456789', tinType: 'ssn' }) === 'Your legal name is needed.' && W.w9Problem({ tin: '123456789', tinType: 'ssn', legalName: 'Maya' }) === 'Check the box to sign it.'
    && W.w9Problem({ tin: '123456789', tinType: 'ssn', legalName: 'Maya', certifiedUnderPenalty: true }) === null);
  const sealed = W.sealW9({ tin: '123-45-6789', tinType: 'ssn', legalName: '  Maya Ortiz ', businessName: 'Lash Lab', address: { street: '1 Main', city: 'Austin', state: 'TX', zip: '78701' }, entityType: 'Single-member LLC', certifiedUnderPenalty: true }, '2026-11-09T10:00:00.000Z');
  check('the number is stored encrypted, with only its last 4 readable', !JSON.stringify(sealed).includes('123456789') && !JSON.stringify(sealed).includes('123-45-6789') && sealed.tinLast4 === '6789' && C.decryptTin(sealed.encryptedTin) === '123456789');
  check('the rest is kept tidy', sealed.legalName === 'Maya Ortiz' && sealed.address.city === 'Austin' && sealed.entityType === 'Single-member LLC' && sealed.certifiedAt === '2026-11-09T10:00:00.000Z');
  const view = W.w9View(sealed);
  check('what may be shown never carries the encrypted number', !!view && !('encryptedTin' in (view as any)) && view!.tinMasked === '***-**-6789' && !JSON.stringify(view).includes(sealed.encryptedTin));
  check('nothing on file shows as nothing', W.w9View(null) === null && W.w9View({}) === null);
  check('an EIN masks as one', W.w9View(W.sealW9({ tin: '12-3456789', tinType: 'ein', legalName: 'X', certifiedUnderPenalty: true }, 'n'))!.tinMasked === '**-***6789');

  // The server and the screens.
  const route = src('src/app/api/portal/renter/route.ts');
  const w9Block = route.slice(route.indexOf("if (action === 'w9-status')"), route.indexOf("// ═══ swap-options"));
  check('the portal reads and saves a W-9 through its own session', /if \(!session\.renterId\)/.test(w9Block) && /w9View\(await readW9\(db, tenantId, session\.renterId\)\)/.test(w9Block) && /await writeW9\(db, tenantId, session\.renterId, w9\)/.test(w9Block) && /const problem = w9Problem\(body \|\| \{\}\)/.test(w9Block) && /const w9 = sealW9\(body, now\)/.test(w9Block));
  check('…without ever logging the request', !/console\.[a-z]+\([^)]*body/.test(w9Block) && /Never the request or the error itself/.test(w9Block));
  check('…and records who added it, with only the last 4 digits', /renter\.w9_saved/.test(w9Block) && /ending \$\{w9\.tinLast4\}/.test(w9Block));
  check('the portal says whether one is on file, never the number', /w9OnFile: hasW9\(renter\),/.test(route));
  check('setup steps come from the one place, once the deposit is known', /checklist = renterSetupSteps\(\{/.test(route) && route.indexOf('checklist = renterSetupSteps({') > route.indexOf('const { depositPosition }'));
  const old = src('src/app/api/booths/w9/route.ts');
  check('the staff-portal W-9 route uses the same checks and sealing', /w9Problem\(body \|\| \{\}\)/.test(old) && /sealW9\(body, now\)/.test(old) && /w9View\(stored\)/.test(old) && /writeW9\(db, String\(tenantId\), String\(renterId\), w9\)/.test(old) && !/encryptTin\(/.test(old));
  const form = src('src/components/shared/W9Form.tsx');
  check('the W-9 form can be sent through the portal, and still posts to the staff route by default', /submit\?: \(payload: Record<string, any>\) => Promise/.test(form) && /submit \? await submit\(payload\) : await \(await fetch\('\/api\/booths\/w9'/.test(form));
  check('the form is in the one look, without check marks', !/slate-|emerald-|font-black|uppercase|tracking-widest|✓/.test(form));
  const screen = src('src/components/rent/RenterW9.tsx');
  check('the portal’s W-9 screen saves through w9-save and shows only the masked number', /action: 'w9-save'/.test(screen) && /w9\.tinMasked/.test(screen) && !/encryptedTin|tinLast4/.test(screen));
  const page = src('src/app/rent/[tenantId]/page.tsx');
  check('the page has the W-9 screen and row', /case 'w9': return <RenterW9 /.test(page) && /case 'w9': return \{ title: 'Tax form \(W-9\)'/.test(page));
  check('a setup step opens its screen', /onOpen=\{\(t, v\) => go\(tabFor\(t\), v, 'step'\)\}/.test(page));
  const setup = src('src/components/rent/setup.tsx');
  const gs = setup.slice(setup.indexOf('export function GettingSetUp('), setup.indexOf('// ─── My Brand'));
  check('each step is a button that opens it', /onClick=\{\(\) => onOpen\?\.\(it\.place, it\.view\)\}/.test(gs) && /min-h-\[44px\]/.test(gs));
  check('optional steps say so; done steps show a check', /· optional/.test(gs) && /CheckCircle2/.test(gs));
  check('choosing how they take bookings sits in the same card until it’s chosen', /canBook && \(!cl\.modeChosen \|\| switching\) && <div/.test(gs));
  check('hidden steps can be shown again, optional ones too', /setShown\(true\)/.test(gs) && /Show</.test(gs) && /optionalLeft === 1 \? 'One optional step'/.test(gs));
  check('nothing to do or choose: no card at all', /if \(cl\.allDone && optionalLeft === 0 && !canBook\) return null;/.test(gs));
  check('a booking choice that didn’t save stays open with the reason', /if \(!d\.ok\) \{ setErr\(d\.error \|\| 'That didn’t save\. Try again\.'\); return; \}[^\n]*\n\s*setSwitching\(false\);/.test(gs));
  check('a done step says what’s done', /it\.done \? \(it\.doneLabel \|\| it\.label\) : it\.label/.test(gs));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
