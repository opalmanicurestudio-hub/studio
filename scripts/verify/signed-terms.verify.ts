// Checks that a signed lease keeps what it says comes with the space (lib/renter-offers offersFor), when the business
// later changes What renters get:
// - The better of the signed terms and today's settings, tool by tool, until the lease's term ends; a lease with no end
//   date keeps them through the notice it gives from the day a change is announced. After that, today's settings.
// - Every check follows it (offerAllows, why it's blocked, the renter's list with "as your lease says, until"), and an
//   add-on the signed terms keep isn't ended or skipped by billing.
// - Saving a change names the renters who keep their terms, tells them until when, and can send each an amendment to
//   sign; signing it in their portal replaces what they hold. Signing a lease from the builder starts it; a renewal and
//   a paper-signed lease too.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/signed-terms.verify.ts
import Module from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const sent: any[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, function () { return {}; });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (is(request, 'route-guard')) return fake(request, { requireCan: async () => ({ actor: { uid: 'o1', name: 'Dana', role: 'owner' } }), requireRole: async () => ({ actor: { uid: 'o1', name: 'Dana' } }) });
  if (is(request, 'notify')) return fake(request, { sendNotification: async (_db: any, i: any) => { sent.push(i); return { status: 'sent', ok: true }; }, resolveFromAddress: () => 'hello@example.com' });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => false, sendTenantSms: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const get = async (p: string) => (await db.doc(p).get()).data() || null;

(async () => {
  const O = await import('../../src/lib/renter-offers');
  const base = O.resolveOffers({ name: 'Northside', giftCardSettings: { renters: { ownCards: true } }, renterOffers: { addons: { swaps: true, ownGiftCards: true }, prices: { swaps: 1500, ownGiftCards: 1000 } }, renterCampaigns: { mode: 'business_covers' } });
  // Later: swaps off, own gift cards dearer, campaigns now an add-on.
  const later = O.resolveOffers({ name: 'Northside', renterSwapsEnabled: false, giftCardSettings: { renters: { ownCards: true } }, renterOffers: { addons: { ownGiftCards: true, campaigns: true }, prices: { ownGiftCards: 2500, campaigns: 900 } }, renterCampaigns: { mode: 'business_covers' } });
  const so = O.signedOffersFrom(base.modes, base.prices, '2027-11-09', { leaseId: 'L1', at: 'x', from: 'lease' })!;
  const maya = { signedOffers: so, addOns: { swaps: { status: 'active', priceCents: 1500 } } };
  const eff = O.offersFor(later, maya, '2027-01-01');
  check('the better of signed and today’s, tool by tool: swaps kept, the lower price kept, campaigns still included', eff.modes.swaps === 'addon' && eff.prices.swaps === 1500 && eff.modes.ownGiftCards === 'addon' && eff.prices.ownGiftCards === 1000 && eff.modes.campaigns === 'included', eff.modes);
  check('…only until the term ends; then today’s', O.offersFor(later, maya, '2027-11-10').modes.swaps === 'off' && O.offersFor(later, maya, '2027-11-09').modes.swaps === 'addon');
  check('…a better setting today wins over what was signed', O.offersFor(O.resolveOffers({ renterOffers: { addons: {} } }), { signedOffers: O.signedOffersFrom({ swaps: 'addon' }, { swaps: 1500 }, null, { at: 'x', from: 'lease' }) }, '2027-01-01').modes.swaps === 'included');
  check('every check follows it: allowed, and not blocked', O.offerAllows(later, 'swaps', maya, '2027-01-01') && O.offerBlocked(later, 'campaigns', maya, 'Northside', '2027-01-01') === null && !O.offerAllows(later, 'swaps', { addOns: maya.addOns }, '2027-01-01'));
  const lines = O.renterOfferLines(later, maya, { businessName: 'Northside', booksHere: true, today: '2027-01-01' });
  const L = (k: string) => lines.find((x) => x.key === k)!;
  check('their list shows what their lease keeps, and until when', L('swaps').state === 'added' && L('swaps').held === true && L('swaps').heldUntil === '2027-11-09' && L('campaigns').state === 'included' && L('campaigns').held === true && !L('salonGiftCards').held, lines.map((x) => [x.key, x.state, x.held]));
  check('a renter without signed terms gets today’s settings', O.offersFor(later, { addOns: {} }, '2027-01-01') === later && O.heldBetter(later, {}, '2027-01-01').length === 0);
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); const yUtc = d.toISOString().slice(0, 10);
  check('with no day given, a hold is checked against yesterday in UTC: never dropped before the business’s own day does', O.offerAllows(later, 'swaps', { ...maya, signedOffers: { ...so, until: yUtc } }) && !O.offerAllows(later, 'swaps', { ...maya, signedOffers: { ...so, until: '2020-01-01' } }));
  check('settings differ: a mode or an add-on price', O.offersDiffer(base, later) && !O.offersDiffer(base, { modes: { ...base.modes }, prices: { ...base.prices } }));

  // Billing reads it too.
  const bill = readFileSync('src/lib/renter-addon-billing.ts', 'utf8');
  check('billing: an add-on is charged and kept by what this renter gets', /offersFor\(offers, r, today\)\.modes\[key\] !== 'addon'/.test(bill) && /const mine = offersFor\(offers, r, today\);/.test(bill));

  // Saving a change.
  await db.doc(T).set({ name: 'Northside', timezone: 'America/New_York', stripeAccountId: 'acct_1', stripeChargesEnabled: true, renterOffers: { addons: { swaps: true }, prices: { swaps: 1500 } } });
  for (const [id, first, signed] of [['r1', 'Maya', O.signedOffersFrom({ swaps: 'addon', packages: 'included' }, { swaps: 1500 }, '2027-11-09', { leaseId: 'L1', at: 'x', from: 'lease' })], ['r2', 'Kim', O.signedOffersFrom({ swaps: 'addon', packages: 'included' }, { swaps: 1500 }, null, { leaseId: 'L2', at: 'x', from: 'lease' })], ['r3', 'Bo', null]] as const) {
    await db.doc(`${T}/renters/${id}`).set({ firstName: first, lastName: 'X', email: `${id}@example.com`, addOns: { swaps: { status: 'active', priceCents: 1500, nextBillOn: '2026-12-01' } }, ...(signed ? { signedOffers: signed } : {}) });
    await db.doc(`${T}/staff/s${id}`).set({ isRenter: true, renterId: id, isActive: true });
    await db.doc(`${T}/leases/L${id.slice(1)}`).set({ renterId: id, status: 'active', endDate: id === 'r1' ? '2027-11-09' : null, earlyTerminationNoticeDays: 30, leaseFrom: signed ? 'builder' : undefined });
  }
  const route = await import('../../src/app/api/renters/offers/route');
  const req = (b: any) => ({ json: async () => b, headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams() } }) as any;
  const v = O.resolveOffers(await get(T)).version;
  const orig = { e: console.error, w: console.warn }; console.error = () => {}; console.warn = () => {};
  const res: any = await route.POST(req({ tenantId: 't1', version: v, modes: { swaps: 'off', packages: 'off', campaigns: 'off', ownGiftCards: 'off', salonGiftCards: 'included' }, prices: {} }));
  const rr = async (id: string) => get(`${T}/renters/${id}`);
  check('a change keeps what signed leases say: their add-on isn’t ended; a renter without one loses it', res.status === 200 && (await rr('r1')).addOns.swaps.status === 'active' && (await rr('r2')).addOns.swaps.status === 'active' && (await rr('r3')).addOns.swaps.status === 'stopped', res.body);
  const kim = await rr('r2');
  check('…a lease with no end date keeps it through its notice from today', typeof kim.signedOffers.until === 'string' && kim.signedOffers.until > new Date().toISOString().slice(0, 10));
  check('…the owner is told who keeps their terms, and until when', Array.isArray(res.body.held) && res.body.held.length === 2 && res.body.held.some((h: any) => h.name === 'Maya X' && h.until === '2027-11-09'));
  const told = sent.filter((x) => x.kind === 'renter_offers_change');
  check('…and those renters are told their lease keeps what they signed for, until when', told.some((x) => x.to === 'r1@example.com' && /Your lease keeps what you signed for until November 9, 2027\./.test(x.text)) && told.some((x) => x.to === 'r3@example.com' && !/Your lease keeps/.test(x.text)), told.map((x) => x.text));
  const g: any = await route.GET({ nextUrl: { searchParams: new URLSearchParams('tenantId=t1') }, headers: { get: () => null } } as any);
  check('the owner’s card can always list who keeps their terms (not only right after saving)', g.status === 200 && g.body.held.length === 2 && g.body.held.every((h: any) => h.amendmentWaiting === false));
  const am: any = await route.POST(req({ tenantId: 't1', action: 'amend', renterIds: ['r1', 'r1'] }));
  const docs = (await db.collection(`${T}/renterDocuments`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const a = docs.find((d: any) => d.kind === 'amendment');
  check('an amendment to sign: today’s setting, from the day they sign, signed for the business, with its fingerprint', am.body.sent === 1 && a && a.renterId === 'r1' && a.action === 'sign' && a.meta.amendOffers.modes.swaps === 'off' && a.meta.termsSha256 === sha(a.body) && a.meta.businessSignature.name === 'Dana' && /From the day the Renter signs it, what comes with the space is as follows\./.test(a.body) && /Everything else in the lease stays the same\./.test(a.body));
  check('…they’re told in their portal and by email', sent.some((x) => x.to === 'r1@example.com' && /amendment to your lease/.test(x.subject)) && ((await db.collection(`${T}/renterAlerts`).get()).docs.some((d: any) => d.data().kind === 'document' && d.data().renterId === 'r1')));
  await route.POST(req({ tenantId: 't1', action: 'amend', renterIds: ['r1'] }));
  const docs2 = (await db.collection(`${T}/renterDocuments`).get()).docs.map((d: any) => d.data()).filter((d: any) => d.kind === 'amendment');
  check('…sending again replaces the one waiting', docs2.filter((d: any) => d.status === 'sent').length === 1 && docs2.filter((d: any) => d.status === 'withdrawn').length === 1);
  const g2: any = await route.GET({ nextUrl: { searchParams: new URLSearchParams('tenantId=t1') }, headers: { get: () => null } } as any);
  check('…and the card shows it waiting for their signature', g2.body.held.find((h: any) => h.renterId === 'r1')?.amendmentWaiting === true);

  // An amendment for a lease that has ended can't be signed.
  await db.doc(`${T}/leases/L9`).set({ renterId: 'r1', status: 'ended' });
  await db.doc(`${T}/renterDocuments/old9`).set({ renterId: 'r1', leaseId: 'L9', kind: 'amendment', title: 'An amendment to your lease', body: 'Old', action: 'sign', status: 'sent', meta: { termsSha256: sha('Old'), amendOffers: { modes: { swaps: 'included' }, prices: {} } } });

  // Signing it in the portal.
  const TOKEN = 'tok-maya-0123456789abcdef';
  await db.doc(`${T}/private/renterSessions`).set({ [sha(TOKEN)]: { contactKey: '5551234567', name: 'Maya X', renterId: 'r1', expiresAt: Date.now() + 3600e3 } });
  await db.doc(`${T}/renters/r1`).set({ phone: '5551234567' }, { merge: true });
  const { POST } = await import('../../src/app/api/portal/renter/route');
  const preq = (b: any) => ({ json: async () => b, headers: { get: () => null }, nextUrl: { origin: 'https://northside.test' } }) as any;
  const portal = (x: any) => POST(preq({ tenantId: 't1', token: TOKEN, ...x })) as any;
  const { esignConsentText } = await import('../../src/lib/esign-consent');
  const live = (await db.collection(`${T}/renterDocuments`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).find((d: any) => d.kind === 'amendment' && d.status === 'sent');
  const signed = await portal({ action: 'document-sign', documentId: live.id, signedName: 'Maya X', consent: true, shownSha: sha(live.body), consentSha: sha(esignConsentText('Northside')) });
  const m2 = await rr('r1');
  check('signing the amendment replaces what they hold with it, until their term ends', signed.status === 200 && m2.signedOffers.from === 'amendment' && m2.signedOffers.modes.swaps === 'off' && m2.signedOffers.until === '2027-11-09', { s: signed.body, so: m2.signedOffers });
  check('…so the change applies to them now', !O.offerAllows(O.resolveOffers(await get(T)), 'swaps', m2));
  const gone = await portal({ action: 'document-sign', documentId: 'old9', signedName: 'Maya X', consent: true, shownSha: sha('Old'), consentSha: sha(esignConsentText('Northside')) });
  check('an amendment to a lease that has ended can’t be signed, and changes nothing', gone.status === 409 && /has ended or changed/.test(gone.body.error) && (await rr('r1')).signedOffers.from === 'amendment' && (await get(`${T}/renterDocuments/old9`)).status === 'sent');
  // A change to the settings takes back an amendment still waiting (it was written for the old settings).
  await route.POST(req({ tenantId: 't1', action: 'amend', renterIds: ['r2'] }));
  const v2 = O.resolveOffers(await get(T)).version;
  await route.POST(req({ tenantId: 't1', version: v2, modes: { swaps: 'off', packages: 'included', campaigns: 'off', ownGiftCards: 'off', salonGiftCards: 'included' }, prices: {} }));
  const kimDocs = (await db.collection(`${T}/renterDocuments`).get()).docs.map((x: any) => x.data()).filter((x: any) => x.renterId === 'r2' && x.kind === 'amendment');
  check('a later change to the settings takes back an amendment still waiting', kimDocs.length === 1 && kimDocs[0].status === 'withdrawn' && kimDocs[0].withdrawnWhy === 'settings_changed');
  check('…and tells them', (await db.collection(`${T}/renterAlerts`).get()).docs.some((x: any) => x.data().renterId === 'r2' && /took back the amendment to your lease/.test(x.data().text)));
  await route.POST(req({ tenantId: 't1', action: 'amend', renterIds: ['r2'] }));
  const v3 = O.resolveOffers(await get(T)).version;
  await route.POST(req({ tenantId: 't1', version: v3, modes: { swaps: 'off', packages: 'included', campaigns: 'off', ownGiftCards: 'off', salonGiftCards: 'included' }, prices: {} }));
  const kimLive = (await db.collection(`${T}/renterDocuments`).get()).docs.map((x: any) => ({ id: x.id, ...x.data() })).find((x: any) => x.renterId === 'r2' && x.kind === 'amendment' && x.status === 'sent');
  check('…a save that changes nothing leaves it waiting', !!kimLive);
  await db.doc(T).set({ renterSwapsEnabled: true }, { merge: true });   // the settings change without the sweep
  const TK = 'tok-kim-0123456789abcdef000';
  await db.doc(`${T}/renters/r2`).set({ phone: '5557654321' }, { merge: true });
  await db.doc(`${T}/private/renterSessions`).set({ [sha(TK)]: { contactKey: '5557654321', name: 'Kim X', renterId: 'r2', expiresAt: Date.now() + 3600e3 } }, { merge: true });
  const stale = await POST(preq({ tenantId: 't1', token: TK, action: 'document-sign', documentId: kimLive.id, signedName: 'Kim X', consent: true, shownSha: sha(kimLive.body), consentSha: sha(esignConsentText('Northside')) })) as any;
  check('…and one that no longer matches the settings can’t be signed', stale.status === 409 && /has changed since this amendment was sent/.test(stale.body.error));
  await db.doc(T).set({ renterSwapsEnabled: false }, { merge: true });

  // Signing a lease from the builder starts what they hold.
  const body = 'Space Lease\n1. Parties';
  await db.doc(`${T}/renters/r4`).set({ firstName: 'Ana', lastName: 'Diaz', phone: '5550000004', email: 'r4@example.com' });
  await db.doc(`${T}/leases/L4`).set({ renterId: 'r4', status: 'pending_signature', leaseFrom: 'builder', endDate: '2027-12-31', earlyTerminationNoticeDays: 30, leaseTermsSnapshot: { offersModes: { swaps: 'addon', packages: 'included' }, offersPrices: { swaps: 1500 } } });
  await db.doc(`${T}/renterDocuments/dl4`).set({ renterId: 'r4', leaseId: 'L4', kind: 'lease', title: 'Your lease', body, action: 'sign', status: 'sent', meta: { termsSha256: sha(body) } });
  const T4 = 'tok-ana-0123456789abcdef00';
  await db.doc(`${T}/private/renterSessions`).set({ [sha(T4)]: { contactKey: '5550000004', name: 'Ana Diaz', renterId: 'r4', expiresAt: Date.now() + 3600e3 } }, { merge: true });
  const s4 = await POST(preq({ tenantId: 't1', token: T4, action: 'document-sign', documentId: 'dl4', signedName: 'Ana Diaz', consent: true, shownSha: sha(body), consentSha: sha(esignConsentText('Northside')) })) as any;
  const ana = await rr('r4');
  check('signing a builder lease keeps what it says comes with the space, until its term ends', s4.status === 200 && ana.signedOffers?.from === 'lease' && ana.signedOffers.modes.swaps === 'addon' && ana.signedOffers.until === '2027-12-31' && ana.signedOffers.leaseId === 'L4', ana.signedOffers);
  console.error = orig.e; console.warn = orig.w;

  // Renewals and paper-signed leases.
  const nightly = readFileSync('src/app/api/cron/nightly/route.ts', 'utf8');
  check('a renewal takes today’s setting, held for the new term (nightly and a signed renewal)', /signedOffersFrom\(now\.modes, now\.prices, newEnd, \{ leaseId: ld\.id, at: new Date\(\)\.toISOString\(\), from: 'renewal' \}\)/.test(nightly)
    && /from: 'renewal' \}\);\n\s+if \(so\) await db\.doc\(`tenants\/\$\{tenantId\}\/renters\/\$\{session\.renterId\}`\)\.update\(\{ signedOffers: so \}\)/.test(readFileSync('src/app/api/portal/renter/route.ts', 'utf8')));
  check('a lease signed on paper in the builder starts it too', /if \(!sign && !own\.on\) \{\n\s+const so = signedOffersFrom\(offers\.modes, offers\.prices, d\.endDate \|\| null/.test(readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8')));
  const card = readFileSync('src/components/renters/WhatRentersGet.tsx', 'utf8');
  check('the owner’s card lists who keeps their terms and offers the amendment to those without one waiting', /Send \{toAmend\.length === 1 \? 'an amendment' : 'amendments'\} to sign/.test(card) && /action: 'amend', renterIds: toAmend\.map/.test(card) && /amendment waiting for their signature/.test(card));
  const svc = readFileSync('src/lib/booth-rental-service.ts', 'utf8');
  check('ending the lease ends what it kept; a new lease not from the builder doesn’t carry it', /heldHere \? \{ updatedAt: now, signedOffers: null \} : \{ updatedAt: now \}/.test(svc) && /\.\.\.\(heldHere \? \{ signedOffers: null \} : \{\}\)/.test(svc) && /input\.extra\?\.leaseFrom === 'builder' \? \{\} : \{ signedOffers: null \}/.test(svc));
  check('the renter’s list says it', /As your lease says, until/.test(readFileSync('src/components/rent/RenterTools.tsx', 'utf8')));

  // Agreed charges: only what a builder lease lists, at no more than its cap.
  const I = await import('../../src/lib/incidentals');
  const nowCats = [{ label: 'Cleaning fee', capCents: 10000 }, { label: 'Damage', capCents: 30000 }, { label: 'Key replacement', capCents: 2500 }];
  const leaseB = { leaseFrom: 'builder', leaseTermsSnapshot: { agreedCharges: [{ label: 'Cleaning fee', capCents: 7500 }, { label: 'Damage', capCents: 50000 }] } };
  const fl = I.incidentalsForLease(nowCats, leaseB);
  check('agreed charges: only the ones the signed lease lists, at the lower of the two caps', fl.signed && fl.cats.length === 2 && fl.cats[0].capCents === 7500 && fl.cats[1].capCents === 30000 && !fl.cats.some((c) => c.label === 'Key replacement'));
  check('…a charge type added later can’t be made, and a raised cap doesn’t apply', !I.validateIncidental(fl.cats, 'Key replacement', 1000).ok && !I.validateIncidental(fl.cats, 'Cleaning fee', 9000).ok && I.validateIncidental(fl.cats, 'Cleaning fee', 7000).ok);
  check('…any other lease: today’s list; a builder lease listing none allows none', I.incidentalsForLease(nowCats, { leaseFrom: 'own' }).cats === nowCats && !I.incidentalsForLease(nowCats, null).signed
    && I.incidentalsForLease(nowCats, { leaseFrom: 'builder', leaseTermsSnapshot: { agreedCharges: [] } }).cats.length === 0);
  check('the charge is checked against their lease when it’s made, and the drawer offers only those', /const forLease = incidentalsForLease\(resolveIncidentalPolicy\(tenantDoc\), liveLease\);/.test(readFileSync('src/app/api/booths/setup-card/route.ts', 'utf8')) && /doesn’t list that charge, so it can’t be made to their card/.test(readFileSync('src/app/api/booths/setup-card/route.ts', 'utf8'))
    && /const chargePolicy = incidentalsForLease\(/.test(readFileSync('src/components/renters/RenterProfileDrawer.tsx', 'utf8')));

  // Late rent and time away: a later, stricter setting doesn't apply to a builder lease; a kinder one does.
  const C = await import('../../src/lib/collections-policy');
  const lb30 = { leaseFrom: 'builder', leaseTermsSnapshot: { collections: { autoBarAfterDaysLate: 30 } } };
  check('bookings pause no earlier than the lease says; a later or no pause from the shop still applies', C.autoBarDayFor(10, lb30) === 30 && C.autoBarDayFor(45, lb30) === 45 && C.autoBarDayFor(null, lb30) === null
    && C.autoBarDayFor(10, { leaseFrom: 'builder', leaseTermsSnapshot: { collections: { autoBarAfterDaysLate: null } } }) === null && C.autoBarDayFor(10, { leaseFrom: 'own' }) === 10 && C.autoBarDayFor(10, null) === 10
    && C.autoBarDayFor(10, { leaseFrom: 'builder', leaseTermsSnapshot: { collections: { autoBarAfterDaysLate: 'x' } } }) === 10);
  const nightlySrc2 = readFileSync('src/app/api/cron/nightly/route.ts', 'utf8');
  check('…the nightly pause and its reminder use that day for each renter, from the leases their late bills are for (whatever their status), the kindest of them', /const barDay = barDayOf\(invs\);/.test(nightlySrc2) && /const barDayOf = \(invs: any\[\]\) =>/.test(nightlySrc2) && /barDay !== null && step < barDay/.test(nightlySrc2) && /if \(barDay !== null && oldestDays >= barDay/.test(nightlySrc2));
  const LP = await import('../../src/lib/leave-policy');
  const nowLeave = { ...LP.resolveLeavePolicy({ leavePolicy: { offered: ['reduced'], reducedPercent: 60, maxWeeks: 8, noticeDays: 30 } }) };
  const signedLeave = { offered: ['pause', 'reduced'], reducedPercent: 50, bankDaysPerWeek: 0, maxWeeks: 16, noticeDays: 14 };
  const eff2 = LP.leaveForLease(nowLeave as any, { leaseFrom: 'builder', leaseTermsSnapshot: { leave: signedLeave } });
  check('time away: every option either offers, the lower holding rate, the longer leave; what the lease doesn’t state stays today’s', eff2.offered.includes('pause' as any) && eff2.offered.includes('reduced' as any) && eff2.reducedPercent === 50 && eff2.maxWeeks === 16 && eff2.noticeDays === nowLeave.noticeDays && eff2.bankDaysPerWeek === nowLeave.bankDaysPerWeek);
  check('…and the bills follow it, not only the screen', /const myLeave = leaveForLease\(leavePolicy, lease\);/.test(nightlySrc2) && /rentUnderLeave\(leave, Number\(lease\.rentAmountCents\) \|\| 0, myLeave\)/.test(nightlySrc2) && /myLeave\.bankDaysPerWeek/.test(nightlySrc2)
    && /rentUnderLeave\(leave, n\(lease\.rentAmountCents\), leaveForLease\(leavePolicy, lease\)\)/.test(readFileSync('src/lib/rent-cycle.ts', 'utf8')));
  check('…any other lease: today’s settings', LP.leaveForLease(nowLeave as any, { leaseFrom: 'own' }) === nowLeave);
  check('the portal’s time-away list and request use it; the builder keeps both with the lease', (readFileSync('src/app/api/portal/renter/route.ts', 'utf8').match(/leaveForLease\(resolveLeavePolicy\(tenantDoc\), myLease\)/g) || []).length === 2
    && /collections: \{ autoBarAfterDaysLate: ctx\.collections\.autoBarAfterDaysLate \?\? null \}, leave: \{ offered: ctx\.leave\.offered, reducedPercent: ctx\.leave\.reducedPercent, maxWeeks: ctx\.leave\.maxWeeks \},/.test(readFileSync('src/components/renters/LeaseBuilder.tsx', 'utf8')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
