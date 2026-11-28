// Checks the shared texting number and a paused business (sweep before launch, part 4): lib/sms, api/sms/inbound,
// lib/notify's noHold, the waitlist's Notify, and what a paused business can't do.
// - A business without its own number texts from the shared one: who texted each person last is kept where no browser
//   reads it, so a reply, a STOP or a START reaches that business, not another or nowhere.
// - The carrier refusing a number that said STOP to the shared number: opted out for this business, said so.
// - A waitlist offer tapped during quiet hours isn't held for the morning: the desk is told to call.
// - A paused business takes no money: rent autopay and add-ons skip it, the payment routes refuse, an open team app
//   closes, and the paused page has a way back in.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/shared-number.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
class NR { status: number; body: any; constructor(body: any, init: any = {}) { this.body = body; this.status = init.status || 200; } static json(body: any, init?: any) { return new NR(body, init); } }
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: NR };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  return load.call(this, request, ...rest);
};
const src = (p: string) => fs.readFileSync(p, 'utf8');
const get = async (p: string) => (await db.doc(p).get()).data() || null;
let twilio: 'ok' | 'stopped' = 'ok'; const sent: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  if (/api\.twilio\.com/.test(String(url))) { const p = new URLSearchParams(init.body); sent.push({ to: p.get('To'), body: p.get('Body'), from: p.get('From') });
    return twilio === 'ok' ? { ok: true, status: 201, json: async () => ({ sid: `SM${sent.length}` }) } : { ok: false, status: 400, json: async () => ({ code: 21610, message: 'Attempt to send to unsubscribed recipient' }) }; }
  return { ok: true, status: 200, json: async () => ({}) };
};
process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+15550000000';

(async () => {
  const S = await import('../../src/lib/sms');
  await db.doc('tenants/t1').set({ name: 'North Loft' });
  await db.doc('tenants/t2').set({ name: 'Harbor Nails' });
  await db.doc('tenants/t3').set({ name: 'Own Number Co', sms: { fromNumber: '+15559990000' } });

  console.log('replies on the shared number');
  let r: any = await S.sendTenantSms(db, 't1', '(555) 201-3344', 'A spot opened up.');
  r = await S.sendTenantSms(db, 't2', '+15552013344', 'Your visit is tomorrow.');
  await S.sendTenantSms(db, 't1', '+15554445555', 'Your order is ready.');
  const own: any = await S.sendTenantSms(db, 't3', '+15558887777', 'Hi.');
  const route: any = await get('smsSharedRoutes/15552013344');
  check('every business on the shared number that texts someone is kept, with when (one with its own number isn’t)', r.ok && own.ok && !!route?.by?.t1 && !!route?.by?.t2 && !(await get('smsSharedRoutes/15558887777')), route);

  const IN = await import('../../src/app/api/sms/inbound/route');
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const { createHmac } = await import('crypto');
  const URL_IN = 'https://app.example/api/sms/inbound';
  const inbound = (from: string, body: string, to = '+15550000000') => {   // (signed the way the carrier signs, so the route's own check passes)
    const params: Record<string, string> = { From: from, To: to, Body: body }; const f = new FormData(); for (const k of Object.keys(params)) f.set(k, params[k]);
    const sig = createHmac('sha1', 'tok').update(URL_IN + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
    return IN.POST({ formData: async () => f, url: URL_IN, headers: { get: (h: string) => (h === 'x-twilio-signature' ? sig : null) } } as any);
  };
  const unsigned: any = await IN.POST({ formData: async () => { const f = new FormData(); f.set('From', '+15552013344'); f.set('To', '+15550000000'); f.set('Body', 'STOP'); return f; }, url: URL_IN, headers: { get: () => null } } as any);
  check('a request the carrier didn’t sign is refused', unsigned.status === 403 && !(await get('tenants/t1/private/smsOptOuts')));
  const optedAt = async (t: string, k: string) => { const v = (await get(`tenants/${t}/private/smsOptOuts`))?.[k]; return typeof v === 'string' && !!v; };   // (START deletes the field; a real database drops it)
  await inbound('+15554445555', 'STOP');
  check('only one business texted them: a STOP reaches it', await optedAt('t1', '15554445555') && !(await optedAt('t2', '15554445555')));
  await inbound('+15552013344', 'STOP');
  check('two businesses texted them: a STOP reaches both, as the carrier stops the whole number', await optedAt('t1', '15552013344') && await optedAt('t2', '15552013344'));
  await inbound('+15552013344', 'START');
  check('…and START lifts it for both', !(await optedAt('t1', '15552013344')) && !(await optedAt('t2', '15552013344')));
  const before = sent.length;
  const msgsBefore = (await db.collection('tenants/t1/smsInbox').get()).size + (await db.collection('tenants/t2/smsInbox').get()).size;
  await inbound('+15552013344', 'Can we do 3 instead?'); await inbound('+15552013344', 'Hello?');
  const told = sent.slice(before).filter((x) => x.to === '+15552013344');
  const msgsAfter = (await db.collection('tenants/t1/smsInbox').get()).size + (await db.collection('tenants/t2/smsInbox').get()).size;
  check('a reply when two businesses texted them reaches neither (it can’t be told whose), and they’re told once, not every time, to contact the business', told.length === 1 && /more than one business, so replies here aren't read\. Please contact the business directly\./.test(told[0].body) && msgsAfter === msgsBefore && !!(await get('smsSharedRoutes/15552013344'))?.toldAt, { told, msgsBefore, msgsAfter });
  const one = (await db.collection('tenants/t1/smsInbox').get()).size;
  await inbound('+15554445555', 'Running 5 late');
  check('…and a reply when only one business texted them goes to it', (await db.collection('tenants/t1/smsInbox').get()).size === one + 1, { one });
  await db.doc('smsSharedRoutes/15553334444').set({ by: { t1: new Date(Date.now() - 31 * 86400e3).toISOString() } });
  process.env.DEFAULT_SMS_TENANT_ID = 't2';
  const in1 = (await db.collection('tenants/t1/smsInbox').get()).size, in2 = (await db.collection('tenants/t2/smsInbox').get()).size;
  await inbound('+15553334444', 'Is it still on?');
  check('a reply from someone only one business has ever texted (more than 30 days ago) still goes to it, not to a default business',
    (await db.collection('tenants/t1/smsInbox').get()).size === in1 + 1 && (await db.collection('tenants/t2/smsInbox').get()).size === in2);
  await db.doc('smsSharedRoutes/15557778888').set({ by: { t1: new Date(Date.now() - 40 * 86400e3).toISOString(), t2: new Date(Date.now() - 35 * 86400e3).toISOString() } });
  const b3 = sent.length; const j1 = (await db.collection('tenants/t1/smsInbox').get()).size, j2 = (await db.collection('tenants/t2/smsInbox').get()).size;
  await inbound('+15557778888', 'Is it still on?');
  check('…but with two businesses, both long ago, it reaches neither (not even a default one), and they’re told to contact the business',
    (await db.collection('tenants/t1/smsInbox').get()).size === j1 && (await db.collection('tenants/t2/smsInbox').get()).size === j2 && sent.slice(b3).some((x) => x.to === '+15557778888' && /more than one business/.test(x.body)));
  await inbound('+15557778888', 'STOP');
  check('…while a STOP reaches both, as the carrier stops the whole number', await optedAt('t1', '15557778888') && await optedAt('t2', '15557778888'));
  await db.doc('smsSharedRoutes/15556660000').set({ by: { t1: new Date().toISOString(), t2: new Date(Date.now() - 45 * 86400e3).toISOString() } });
  await inbound('+15556660000', 'STOP');
  const stopOne = await optedAt('t1', '15556660000') && await optedAt('t2', '15556660000');
  await inbound('+15556660000', 'START');
  check('a STOP or START when one business texted them lately and another long ago reaches both (so a START never leaves the older one stopped)', stopOne && !(await optedAt('t1', '15556660000')) && !(await optedAt('t2', '15556660000')));
  delete process.env.DEFAULT_SMS_TENANT_ID;
  await db.doc('tenants/t1/clients/c1').set({ name: 'Rae Lin', phone: '+15552013344' });
  await db.doc('tenants/t2/clients/c2').set({ name: 'Rae Lin', phone: '(555) 201-3344' });
  await inbound('+15552013344', 'STOP');
  check('a STOP to two businesses shows on their client record at each', (await get('tenants/t1/clients/c1'))?.smsOptOut === true && (await get('tenants/t2/clients/c2'))?.smsOptOut === true, [await get('tenants/t1/clients/c1'), await get('tenants/t2/clients/c2')]);
  await inbound('+15552013344', 'START');

  console.log('a STOP the carrier enforces');
  twilio = 'stopped';
  r = await S.sendTenantSms(db, 't1', '+15556667777', 'Your order is ready.');
  check('refused by the carrier because they said STOP to the shared number: opted out, said so, and kept for this business', !r.ok && r.optedOut === true && /STOP/.test(r.error) && !!(await get('tenants/t1/private/smsOptOuts'))?.['15556667777'], r);
  twilio = 'ok';

  console.log('quiet hours and the waitlist');
  const N = src('src/lib/notify.ts'); const W = src('src/app/api/waitlist/route.ts');
  check('a message that can’t wait isn’t held for the morning in quiet hours; the waitlist offer is one, and the desk is told to call',
    /\} else if \(quietDeferred && input\.noHold\) \{[\s\S]{0,400}quiet: true \};/.test(N) && N.indexOf('quietDeferred && input.noHold') < N.indexOf('} else if (quietDeferred) {')
    && /kind: 'waitlist_opening', noHold: true,/.test(W) && /It’s your quiet hours for texts, so nothing was sent\. Give them a call instead\./.test(W));

  console.log('a paused business takes no money');
  const auto = src('src/app/api/cron/autopay-leases/route.ts');
  check('rent autopay and renters’ add-ons skip a paused business', (auto.match(/if \(accessLockOf\(tenantDoc\.data\(\)\)\.locked\) continue;/g) || []).length === 2);
  const routes = ['src/app/api/stripe/terminal/create-payment-intent/route.ts', 'src/app/api/stripe/pos-payment-intent/route.ts'];
  check('the card reader, the desk’s card form and a saved card refuse to take money for a paused business', routes.every((f) => /if \(accessLockOf\(tenantSnap\.data\(\) \|\| \{\}\)\.locked\) return NextResponse\.json\(\{ ok: false, closed: true, error: CLOSED_FOR_TEAM \}, \{ status: 403 \}\);/.test(src(f)))
    && /if \(accessLockOf\(\(await db\.doc\(`tenants\/\$\{tenantId\}`\)\.get\(\)\)\.data\(\) \|\| \{\}\)\.locked\) return NextResponse\.json\(\{ ok: false, closed: true, error: CLOSED_FOR_TEAM, code: 'paused' \}/.test(src('src/app/api/stripe/charge-card/route.ts')));
  const co = src('src/app/api/checkout/complete/route.ts');
  check('…the desk can’t start or charge a checkout, but saving a card payment already taken, letting a ticket go and giving back still work',
    /const savesPaidCard = action === 'complete' && !!String\(b\.payment\?\.stripePaymentIntentId \|\| ''\)\.trim\(\);\n  if \(\['prepare', 'tender', 'reader_extra', 'complete'\]\.includes\(action\) && !savesPaidCard && accessLockOf\(auth\.tenant \|\| \{\}\)\.locked\)/.test(co)
    && co.indexOf('savesPaidCard') < co.indexOf('let verified: any = null;') && /checkDeskPayment\(vStripe, vAcct, incomingPi/.test(co));
  const has = (f: string, re: RegExp) => re.test(src(`src/app/api/${f}`));
  const moneyRoutes: [string, RegExp][] = [
    ['client-screen/route.ts', /if \(kind === 'pay' && accessLockOf\(t\)\.locked\) return/],
    ['client-screen/route.ts', /if \(action !== 'pay_done' && !q\.answeredAt && accessLockOf\(t\)\.locked\) return NextResponse\.json\(\{ ok: false, code: 'closed', error: CLOSED_FOR_PAYERS \}/],
    ['desk/collect/route.ts', /if \(accessLockOf\(tenant\)\.locked\) return NextResponse\.json\(\{ ok: false, closed: true, error: CLOSED_FOR_TEAM \}/],
    ['stripe/book-station/route.ts', /if \(accessLockOf\(tenantSnap\.data\(\) \|\| \{\}\)\.locked\) problem = \{ ok: false, closed: true, reason: CLOSED_FOR_TEAM \};\n    else if \(!spacePayAccount/],
    ['booths/setup-card/route.ts', /if \(accessLockOf\(tenantDoc\)\.locked\) \{[\s\S]{0,200}\['charging', 'charged'\]\.includes/],
    ['portal/pay-balance/route.ts', /if \(accessLockOf\(tenant\)\.locked\) return NextResponse\.json\(\{ ok: false, code: 'closed', error: CLOSED_FOR_PAYERS \}/],
    ['counter/pay/route.ts', /if \(accessLockOf\(tv\.data\(\) \|\| \{\}\)\.locked && !\(ov\.data\(\) as any\)\?\.paidAt\) return reply/],
    ['portal/renter/route.ts', /if \(inv\.status === 'paid'\) return NextResponse\.json\(\{ ok: true, alreadyPaid: true \}\);\n        if \(accessLockOf\(/],
    ['portal/renter/route.ts', /if \(pos\.status !== 'not_collected'\) return NextResponse\.json\(\{ ok: true, alreadyPaid: true \}\);\n        if \(accessLockOf\(tenant\)\.locked\)/],
    ['portal/renter/route.ts', /if \(c\?\.textCharge\?\.status !== 'charging' && accessLockOf\(/],
    ['cron/collect-fees/route.ts', /\|\| accessLockOf\(tenant\)\.locked\) continue;/],
    ['table-book/route.ts', /if \(action === 'book'\) \{\n      \{ const shut = closedReply\(tenant\); if \(shut\) return shut; \}/],
    ['booking/offers/route.ts', /\{ const shut = closedReply\(t\); if \(shut\) return shut; \}\n      \/\/ Where the client comes back to/],
    ['prep-check/route.ts', /if \(action === 'topup'\) \{[^\n]*if \(accessLockOf\(tenant\)\.locked\) return/],
    ['retail/self-serve/route.ts', /if \(action === 'address_pay' && accessLockOf\(tenant\)\.locked\) return/],
    ['retail/delivery-choice/route.ts', /if \(accessLockOf\(tenant\)\.locked && retryCents\(order, deliveryFrom\(tenant\.retailSettings\)\) > 0\) return bad\(CLOSED_FOR_PAYERS, 403\)/],
    ['gift-cards/route.ts', /if \(action === 'bulk-send'\) \{ const \{ accessLockOf, CLOSED_FOR_TEAM \} = await import\('@\/lib\/tenant-access'\); if \(accessLockOf\(/],
  ];
  moneyRoutes.push(['host/floor/route.ts', /if \(action === 'booking_charge'\) \{ const \{ accessLockOf, CLOSED_FOR_TEAM \} = await import\('@\/lib\/tenant-access'\); if \(accessLockOf\(tenant\)\.locked\) return/]);
  const missing = moneyRoutes.filter(([f, re]) => !has(f, re)).map(([f]) => f);
  check('every other way money is taken refuses for a paused business: the client’s screen, desk pay links and saved cards, space bookings and renters’ extra charges, a client’s balance, paying by phone at the window, rent, deposits and renters’ paid texts, fee collection, table bookings, memberships online, prep top-ups, address changes, redelivery and company gift card invoices (each one already under way still finishes)', missing.length === 0, missing);
  check('…a guest can’t start paying at the table (a payment already made still goes on the check)', /if \(action === 'start' && accessLockOf\(tenant\)\.locked\) return bad\('Paying here isn’t open right now\. Your server can help\.', 403\);/.test(src('src/app/api/table-pay/route.ts')));
  check('an open team app closes when the business is paused; the paused page has Check again', /\{portalTenant && accessLockOf\(portalTenant\)\.locked && <div role="alertdialog"/.test(src('src/app/staff-portal/[tenantId]/StaffPortalPage.tsx'))
    && /\{reason === 'paused' && <Link href="\/dashboard"[^>]*>Check again<\/Link>\}/.test(src('src/app/suspended/page.tsx')));
  console.log('nothing automatic charges a paused business, or treats it as a declined card');
  {
    const R = await import('../../src/lib/memberships/renewals');
    await db.doc('tenants/tp').set({ name: 'Paused Co', accessLocked: true, accessLockedAt: new Date().toISOString(), stripeAccountId: 'acct_p' });
    const due = new Date(Date.now() - 86400e3).toISOString();
    await db.doc('tenants/tp/clients/m1').set({ name: 'Member', subscription: { status: 'active', membershipId: 'gold', nextBillingDate: due } });
    const fetches: string[] = []; const f0 = (globalThis as any).fetch; (globalThis as any).fetch = async (u: string, i: any) => { fetches.push(String(u)); return f0(u, i); };
    const rr: any = await R.runRenewals(db, 'tp', { appUrl: 'https://app.example' });
    (globalThis as any).fetch = f0;
    const m: any = await get('tenants/tp/clients/m1');
    check('membership renewals wait while it’s paused: nothing tried, no one past due or sent a card link', rr.paused === true && rr.charged === 0 && !fetches.some((u) => /charge-card/.test(u)) && m.subscription.status === 'active' && !m.subscription.pastDueSince, { rr, m, fetches });
    const SW = await import('../../src/lib/retail-sweeps');
    await db.doc('tenants/tp/appointments/a1').set({ status: 'pending_payment', paymentDueAt: new Date(Date.now() - 3600e3).toISOString(), depositAttempts: 1, clientEmail: 'x@example.com', depositAmount: 20 });
    const sr: any = await SW.sweepUnpaidAccepted(db, 'tp', { origin: 'https://app.example' });
    const a1: any = await get('tenants/tp/appointments/a1');
    check('…and unpaid deposits aren’t retried, chased or released (a refused try isn’t counted as a failed card)', sr.scanned === 0 && a1.status === 'pending_payment' && a1.depositAttempts === 1, { sr, a1 });
    const RU = await import('../../src/lib/release-unpaid');
    const H = 3600e3, now0 = Date.now();
    // An accepted request whose card was declined: 24 hours to pay, which ran out while the business was paused.
    await db.doc('tenants/tp/appointments/h1').set({ status: 'pending_payment', staffId: 's1', decidedAt: new Date(now0 - 30 * H).toISOString(), paymentDueAt: new Date(now0 - 6 * H).toISOString(),
      startTime: new Date(now0 + 5 * 24 * H).toISOString(), endTime: new Date(now0 + 5 * 24 * H + H).toISOString(), clientName: 'Hold', clientEmail: 'h@example.com' });
    // Another, whose time was booked by someone else before the pause.
    await db.doc('tenants/tp/appointments/h2').set({ status: 'pending_payment', staffId: 's1', decidedAt: new Date(now0 - 30 * H).toISOString(), paymentDueAt: new Date(now0 - 6 * H).toISOString(),
      startTime: new Date(now0 + 6 * 24 * H).toISOString(), endTime: new Date(now0 + 6 * 24 * H + H).toISOString(), clientName: 'Hold two' });
    await db.doc('tenants/tp/appointments/o2').set({ status: 'confirmed', staffId: 's1', startTime: new Date(now0 + 6 * 24 * H).toISOString(), endTime: new Date(now0 + 6 * 24 * H + H).toISOString() });
    await db.doc('tenants/tp/systemMarkers/unpaid-nudge-h1').set({ at: new Date(now0 - 20 * H).toISOString() });
    const ru1: any = await RU.releaseUnpaidHolds(db, 'tp', {});
    check('…and a hold whose time ran out isn’t let go while it’s paused (the client can’t pay or book again)', ru1.released === 0 && (await get('tenants/tp/appointments/h1')).status === 'pending_payment');
    const tpBefore: any = await get('tenants/tp');
    await db.doc('tenants/tp').set({ accessLocked: false, accessLockedAt: null }, { merge: true });
    const mv: any = await RU.reopenHolds(db, 'tp', tpBefore);
    const h1: any = await get('tenants/tp/appointments/h1'), h2: any = await get('tenants/tp/appointments/h2');
    const newDue = Date.parse(h1.paymentDueAt);
    check('once it’s open again, the accepted request gets its 24 hours to pay again, on its own deadline (so the calendar, the release and the reminder all read one date), and the reminder goes again',
      mv.moved >= 1 && Math.abs(newDue - (Date.now() + 24 * H)) < 60000 && !(await get('tenants/tp/systemMarkers/unpaid-nudge-h1')), { mv, h1 });
    check('…but not one whose time someone else booked meanwhile', Date.parse(h2.paymentDueAt) < now0, h2);
    const ru2: any = await RU.releaseUnpaidHolds(db, 'tp', {});
    check('…and the release reads that same deadline: the first is kept, the second let go', (await get('tenants/tp/appointments/h1')).status === 'pending_payment' && (await get('tenants/tp/appointments/h2')).status === 'cancelled', ru2);
    const ru3: any = await RU.releaseUnpaidHolds(db, 'tp', { now: newDue + 60000 });
    check('…which lets the first go once its new time runs out', (await get('tenants/tp/appointments/h1')).status === 'cancelled', ru3);
    const mv2: any = await RU.reopenHolds(db, 'tp', tpBefore);
    check('a checkout someone walked away from, or a hold already let go, isn’t brought back', mv2.moved === 0);
    await db.doc('tenants/tp').set({ accessLocked: true, accessLockedAt: new Date().toISOString() }, { merge: true });
    check('reopening gives the time again only when it was actually locked, by HQ and by billing',
      /if \(fix === 'restore' && accessLockOf\(before\)\.locked && !accessLockOf\(\{ \.\.\.before, accessLocked: false, accessLockedAt: null \}\)\.locked\) \{\n        const \{ reopenHolds \}/.test(src('src/app/api/hq/route.ts'))
      && /if \(accessLockOf\(t\)\.locked && !accessLockOf\(\{ \.\.\.t, \.\.\.patch \}\)\.locked\) \{\n      const \{ reopenHolds \}/.test(src('src/app/api/stripe/billing-webhook/route.ts'))
      && !/accessRestoredAt/.test(src('src/lib/release-unpaid.ts') + src('src/app/api/hq/route.ts') + src('src/app/api/stripe/billing-webhook/route.ts')));
    const CE = src('src/lib/cancellation-events.ts');
    check('a late-cancel fee at a paused business goes on their balance, not their card', /if \(accessLockOf\(tenant\)\.locked\) \{ updates\.chargeStatus = 'balance'; await owedLine\([^)]*\); await owe\('Cancellation fee'\); \}\n    else if \(!tenant\.stripeAccountId\)/.test(CE)
      && CE.indexOf('accessLockOf(tenant).locked') < CE.indexOf('stripe.paymentIntents.create'));
  }
  check('no example in the app uses the founder’s own business names', !/placeholder="[^"]*Opal[^"]*"/.test(['src/components/settings/GuestWifiRows.tsx', 'src/app/(app)/settings/page.tsx', 'src/components/academy/SchoolIdentity.tsx', 'src/components/inventory/LicenseManager.tsx'].map(src).join('\n')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
