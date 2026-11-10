// Checks What renters get (lib/renter-offers): each tool off, included, or an add-on a renter chooses.
// - A business that never saved it keeps exactly what it had, read from where each switch has always lived.
// - What the owner sends is checked; saving writes each tool's on/off where it's always been kept, and reads back the same.
// - A renter can use a tool when it's included, or when it's an add-on they have (time already paid for counts).
// - The owner's save (api/renters/offers): a stale save is refused, add-ons need card payments, renters are told what
//   changed, and add-ons a change ends are stopped.
// - The portal (api/portal/renter): the list, adding at the price shown (a changed price is shown first, a card is
//   needed), stopping; and swap days, gift cards, packages and campaigns each follow it.
// - Studio gift cards at checkout follow it renter by renter; the agreement summary lists it; the screens' words.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-offers.verify.ts
import Module from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
import {
  resolveOffers, readOffersInput, offersPatch, offerAllows, offerBlocked, offerChanges, offersForLease, renterOfferLines,
  addOnsEnded, activeAddOn, OFFER_KEYS, type Offers,
} from '../../src/lib/renter-offers';
import { planGiftUse } from '../../src/lib/gift-cards';
import { renterDocVars, RENTER_DOC_TEMPLATES } from '../../src/lib/renter-documents';

const db: any = makeDb();
const audits: any[] = []; const sent: any[] = []; const campaignSends: string[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, fns: any) => { const mock = { __esModule: true, ...fns, default: fns }; const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const is = (request: string, name: string) => request === `@/lib/${name}` || new RegExp(`/src/lib/${name}(\\.ts)?$`).test(request);
let canManage = true;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe' || /node_modules\/stripe\//.test(request)) return fake(request, function () { return {}; });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (is(request, 'firebase-admin')) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}), getAdminStorage: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === './audit' || is(request, 'audit')) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (is(request, 'route-guard')) return fake(request, {
    requireRole: async () => ({ actor: { uid: 'o1', isManager: true, name: 'Dana' } }),
    requireCan: async () => (canManage ? { actor: { uid: 'o1', name: 'Dana', role: 'owner' } } : { deny: { status: 403, body: { ok: false } } }),
  });
  if (is(request, 'notify')) return fake(request, { sendNotification: async (_db: any, i: any) => { sent.push(i); return { status: 'sent', ok: true }; }, resolveFromAddress: () => 'hello@example.com' });
  if (is(request, 'sms')) return fake(request, { smsConfigured: () => false, sendTenantSms: async () => ({ ok: true }) });
  if (is(request, 'cron-auth')) return fake(request, { refuseCron: () => null });
  if (is(request, 'cron-heartbeat')) return fake(request, { recordCronRun: async () => {} });
  if (is(request, 'text-report')) return fake(request, { textReportSweep: async () => {} });
  if (is(request, 'campaign-engine')) return fake(request, { sendCampaignBatch: async (_db: any, _t: string, id: string) => { campaignSends.push(id); return { ok: true, done: true }; }, runAutomation: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN = 'tok-maya-0123456789abcdef'; const KIM = 'tok-kim-0123456789abcdef0';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const today = new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

(async () => {
  // ── The setting itself ───────────────────────────────────────────────────
  const fresh = resolveOffers({ name: 'Northside' });
  check('never saved: swap days, studio gift cards and packages on; own gift cards and campaigns off, as before', fresh.modes.swaps === 'included' && fresh.modes.salonGiftCards === 'included' && fresh.modes.packages === 'included' && fresh.modes.ownGiftCards === 'off' && fresh.modes.campaigns === 'off', fresh.modes);
  check('never saved: nothing is an add-on', OFFER_KEYS.every((k) => fresh.modes[k] !== 'addon'));
  const legacy = resolveOffers({ renterSwapsEnabled: false, giftCardSettings: { renters: { salonCards: false, ownCards: true } }, renterCampaigns: { mode: 'business_covers', monthlyTexts: 40, priceCentsPerText: 3 } });
  check('the older switches are read where they live', legacy.modes.swaps === 'off' && legacy.modes.salonGiftCards === 'off' && legacy.modes.ownGiftCards === 'included' && legacy.modes.campaigns === 'included' && legacy.campaignPayer === 'business_covers' && legacy.monthlyTexts === 40 && legacy.perTextCents === 3);
  check('an add-on with no price saved counts as included (it couldn’t be charged)', resolveOffers({ renterOffers: { addons: { swaps: true }, prices: { swaps: 0 } } }).modes.swaps === 'included');

  check('a mode that isn’t one of the three is refused', !readOffersInput({ modes: { swaps: 'maybe' } }, fresh).ok);
  const noPrice = readOffersInput({ modes: { swaps: 'addon' } }, fresh);
  check('an add-on needs a monthly price of at least $1', !noPrice.ok && /Swap days needs a monthly price of at least \$1/.test((noPrice as any).error), noPrice);
  check('who pays for campaign texts has to be one of the two', !readOffersInput({ campaignPayer: 'nobody' }, fresh).ok);
  const r1 = readOffersInput({ modes: { swaps: 'addon', ownGiftCards: 'addon', campaigns: 'included', packages: 'off' }, prices: { swaps: 1500, ownGiftCards: 999 }, campaignPayer: 'renter_pays', perTextCents: 500 }, fresh);
  check('a good setting reads, its version one on', r1.ok && (r1 as any).after.version === fresh.version + 1);
  const after1 = (r1 as any).after as Offers;
  check('numbers are kept in range (texts up to 50¢ each)', after1.perTextCents === 50);
  const patch = offersPatch(after1, { at: '2026-11-09T00:00:00Z', by: 'o1' });
  check('saving keeps each tool’s on/off where it always lived', patch.renterSwapsEnabled === true && patch.giftCardSettings.renters.ownCards === true && patch.giftCardSettings.renters.salonCards === true && patch.renterCampaigns.mode === 'renter_pays' && patch.renterOffers.packagesOff === true);
  const back = resolveOffers(patch);
  check('what’s saved reads back the same', JSON.stringify(back.modes) === JSON.stringify(after1.modes) && back.prices.swaps === 1500 && back.prices.ownGiftCards === 999 && back.version === after1.version, back);
  check('campaigns off is written as off, whoever paid', offersPatch({ ...after1, modes: { ...after1.modes, campaigns: 'off' } }, { at: '', by: null }).renterCampaigns.mode === 'off');

  // ── Who can use what ─────────────────────────────────────────────────────
  check('included: everyone', offerAllows(after1, 'campaigns', {}));
  check('off: nobody', !offerAllows(after1, 'packages', { addOns: { packages: { status: 'active' } } }));
  check('an add-on: only a renter who has it', !offerAllows(after1, 'swaps', {}) && offerAllows(after1, 'swaps', { addOns: { swaps: { status: 'active', priceCents: 1500 } } }));
  check('stopped with time already paid for: still works until then', offerAllows(after1, 'swaps', { addOns: { swaps: { status: 'stopped', paidThrough: addDays(5) } } }, today));
  check('stopped and run out: no longer', !offerAllows(after1, 'swaps', { addOns: { swaps: { status: 'stopped', paidThrough: today } } }, today) && !activeAddOn({ addOns: { swaps: { status: 'stopped' } } }, 'swaps'));
  check('why, for a plural one that’s an add-on', offerBlocked(after1, 'swaps', {}, 'Northside') === 'Swap days are an add-on here. You can add them in Space, under What comes with your space.');
  check('why, for a singular one', offerBlocked(after1, 'ownGiftCards', {}, 'Northside') === 'Selling your own gift cards is an add-on here. You can add it in Space, under What comes with your space.');
  check('why, for one that’s off', offerBlocked(after1, 'packages', {}, 'Northside') === 'Northside doesn’t offer packages and memberships right now.');
  check('no reason when they can', offerBlocked(after1, 'campaigns', {}, 'Northside') === null);

  const lines = renterOfferLines(after1, { addOns: { swaps: { status: 'active', priceCents: 1200, startedAt: '2026-11-01T10:00:00Z' } } }, { businessName: 'Northside', booksHere: true });
  const line = (k: string) => lines.find((l) => l.key === k)!;
  check('their list: included, add-on, added at their own price, off', line('campaigns').state === 'included' && line('ownGiftCards').state === 'addon' && line('ownGiftCards').priceCents === 999 && line('swaps').state === 'added' && line('swaps').priceCents === 1200 && line('packages').state === 'off');
  check('the business’s own gift cards are named after it', line('salonGiftCards').title === 'Northside gift cards');
  check('someone who doesn’t book here has none of these', renterOfferLines(after1, {}, { businessName: 'Northside', booksHere: false }).length === 0);
  const leftOver = renterOfferLines(after1, { addOns: { swaps: { status: 'active', priceCents: 1200 } } }, { businessName: 'Northside', booksHere: false });
  check('…except an add-on still being charged, so they can stop it', leftOver.length === 1 && leftOver[0].key === 'swaps' && leftOver[0].state === 'added');
  const pm = await import('../../src/components/rent/portal-map');
  const w = { booksHere: false, hasRenter: true, hasLease: true, swapsOn: false };
  check('…and the screen opens for them only then', !pm.viewAllowed('tools', w) && pm.viewAllowed('tools', { ...w, addOns: true }) && pm.viewAllowed('tools', { ...w, booksHere: true }));

  const ch = offerChanges(fresh, after1, 'Northside');
  check('the notice says what changed, and what it was', ch.some((l) => l === 'Swap days: now an add-on at $15 a month, was included with your space.') && ch.some((l) => /^Packages and memberships: now not offered/.test(l)) && ch.some((l) => /^Win-back campaigns: now included/.test(l)), ch);
  const repriced = { ...after1, prices: { ...after1.prices, swaps: 2000 } };
  check('a new price tells those who have it theirs stays', offerChanges(after1, repriced).some((l) => /If you already have it, your price stays the same\./.test(l)));
  const inc = { ...after1, modes: { ...after1.modes, swaps: 'included' as const } };
  check('an add-on now included: no longer charged', offerChanges(after1, inc).some((l) => /no longer charged/.test(l)));
  check('nothing changed: no notice', offerChanges(after1, { ...after1, version: 9 }).length === 0);
  check('campaigns turned on: the notice says what texts cost', ch.some((l) => /^Win-back campaigns: now included with your space, was not offered\. Each campaign text is 50¢ to your card\. Emails are free\.$/.test(l)), ch);
  const covers = { ...after1, campaignPayer: 'business_covers' as const, monthlyTexts: 80 };
  check('who pays for texts changing is its own line', offerChanges(after1, covers, 'Northside').includes('Campaign texts have changed. Northside covers 80 campaign texts a month for you, then each one is 50¢ to your card. Emails are free.'));
  check('the add-ons a change ends', JSON.stringify(addOnsEnded(after1, { ...inc, modes: { ...inc.modes, ownGiftCards: 'off' } })) === JSON.stringify([{ key: 'ownGiftCards', why: 'off' }, { key: 'swaps', why: 'included' }]));
  const lease = offersForLease(after1, 'Northside');
  check('the agreement says what comes with it, what can be added, what isn’t offered', /come with the space\./.test(lease) && /You can add your own gift cards at \$9\.99 a month and swap days at \$15 a month\./.test(lease) && /Not offered: packages and memberships\./.test(lease), lease);
  const vars = renterDocVars({ tenant: { name: 'Northside', ...patch }, renter: {}, lease: {}, booth: {} });
  check('the agreement summary carries it', RENTER_DOC_TEMPLATES.agreement_summary.body.includes('{{toolsLine}}') && vars.toolsLine === lease);

  // ── Studio gift cards at checkout, renter by renter ─────────────────────
  const plan = planGiftUse({ cards: [{ id: 'g1', code: 'AAAA', wantCents: 5000, holdId: null, owner: null }], byRenter: { r1: 3000, r2: 3000 }, studioLeft: 0, salonForRenters: (rid) => rid === 'r2' });
  check('a studio card pays only for the renters who can take it', !plan.error && plan.uses[0].cents === 3000 && plan.uses[0].forRenters.r2 === 3000 && !plan.uses[0].forRenters.r1, plan);
  const none = planGiftUse({ cards: [{ id: 'g1', code: 'AAAA', wantCents: 5000, holdId: null, owner: null }], byRenter: { r1: 3000 }, studioLeft: 0, salonForRenters: () => false });
  check('…and says so when none of them can', /can’t pay for a renter’s service here/.test(String(none.error)));
  check('…and true still means every renter', planGiftUse({ cards: [{ id: 'g1', code: 'A', wantCents: 1000, holdId: null, owner: null }], byRenter: { r1: 3000 }, studioLeft: 0, salonForRenters: true }).uses[0].cents === 1000);

  // ── The owner's save ─────────────────────────────────────────────────────
  await db.doc(T).set({ name: 'Northside', stripeAccountId: 'acct_1', publicOrigin: 'https://northside.test' });
  for (const [id, first] of [['r1', 'Maya'], ['r2', 'Kim'], ['r3', 'Lee']]) await db.doc(`${T}/renters/${id}`).set({ firstName: first, lastName: 'X', email: `${first.toLowerCase()}@example.com` });
  await db.doc(`${T}/staff/s1`).set({ isRenter: true, renterId: 'r1', name: 'Maya X' });
  await db.doc(`${T}/staff/s2`).set({ isRenter: true, renterId: 'r2', name: 'Kim X' });
  await db.doc(`${T}/leases/l1`).set({ renterId: 'r1', status: 'active' });
  await db.doc(`${T}/leases/l2`).set({ renterId: 'r2', status: 'active' });
  await db.doc(`${T}/leases/l3`).set({ renterId: 'r3', status: 'active' });   // r3 doesn't book here
  const owner = await import('../../src/app/api/renters/offers/route');
  const oreq = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://northside.test', searchParams: new URLSearchParams('tenantId=t1') } }) as any;
  const g0 = await owner.GET(oreq({})) as any;
  check('the owner sees the setting and who it reaches', g0.status === 200 && g0.body.renters === 2 && g0.body.paymentsReady === true && g0.body.offers.version === 0, g0.body);
  canManage = false;
  check('someone who can’t change settings can’t see or save it', (await owner.GET(oreq({})) as any).status === 403 && (await owner.POST(oreq({ tenantId: 't1', version: 0 })) as any).status === 403);
  canManage = true;
  const stale = await owner.POST(oreq({ tenantId: 't1', version: 7, modes: { swaps: 'off' } })) as any;
  check('a save made on an older copy is refused, with the current one', stale.status === 409 && stale.body.offers?.version === 0 && (await get(T)).renterSwapsEnabled !== false);
  await db.doc(T).set({ stripeAccountId: '' }, { merge: true });
  const noPay = await owner.POST(oreq({ tenantId: 't1', version: 0, modes: { swaps: 'addon' }, prices: { swaps: 1500 } })) as any;
  check('add-ons need card payments set up first', noPay.status === 400 && /card payments need to be set up first/.test(noPay.body.error));
  await db.doc(T).set({ stripeAccountId: 'acct_1' }, { merge: true });
  sent.length = 0;
  const s1 = await owner.POST(oreq({ tenantId: 't1', version: 0, modes: { swaps: 'addon', ownGiftCards: 'addon', campaigns: 'addon', packages: 'addon' }, prices: { swaps: 1500, ownGiftCards: 1000, campaigns: 500, packages: 800 }, campaignPayer: 'renter_pays' })) as any;
  const t1 = await get(T);
  check('it saves', s1.status === 200 && s1.body.ok && s1.body.offers.version === 1, s1.body);
  check('each tool’s on/off is where the older checks read it', t1.renterSwapsEnabled === true && t1.giftCardSettings?.renters?.ownCards === true && t1.renterCampaigns?.mode === 'renter_pays' && t1.renterOffers?.addons?.swaps === true);
  const alerts = (await db.collection(`${T}/renterAlerts`).get()).docs.map((d: any) => d.data());
  check('the two renters who book here are told, in their portal', alerts.length === 2 && alerts.every((a: any) => a.kind === 'space_tools' && a.tab === 'studio' && /changed what comes with your space/.test(a.text)) && !alerts.some((a: any) => a.renterId === 'r3'));
  check('…and by email, with a link to the list', sent.length === 2 && sent.every((x) => x.kind === 'renter_offers_change' && x.recipientType === 'renter' && /\?view=tools/.test(x.html)));
  check('the history says who changed what', audits.some((a) => a.action === 'renters.offers_update' && /^Dana changed what renters get: .*Swap days: now an add-on at \$15 a month/.test(a.summary)));
  check('the answer says how many were told', s1.body.told === 2);

  // ── The portal ───────────────────────────────────────────────────────────
  await db.doc(`${T}/private/renterSessions`).set({
    [sha(TOKEN)]: { contactKey: '5551234567', name: 'Maya X', renterId: 'r1', expiresAt: Date.now() + 3600e3 },
    [sha(KIM)]: { contactKey: '5557654321', name: 'Kim X', renterId: 'r2', expiresAt: Date.now() + 3600e3 },
  });
  const { POST } = await import('../../src/app/api/portal/renter/route');
  const req = (body: any) => ({ json: async () => body, headers: { get: () => null }, nextUrl: { origin: 'https://northside.test' } }) as any;
  const portal = (x: any, token = TOKEN) => POST(req({ tenantId: 't1', token, ...x })) as any;
  const orig = { e: console.error, w: console.warn };
  console.error = () => {}; console.warn = () => {};

  const tg = await portal({ action: 'tools-get' });
  check('their list, every one an add-on they don’t have yet', tg.status === 200 && tg.body.lines.length === 5 && tg.body.lines.filter((l: any) => l.state === 'addon').length === 4 && tg.body.card === null, tg.body);
  const sw0 = await portal({ action: 'swap-options', today });
  check('swap days: not theirs until they add it', sw0.status === 200 && sw0.body.enabled === false);
  const req0 = await portal({ action: 'swap-request', today, toStaffId: 's2', giveDate: addDays(3) });
  check('…a swap can’t be asked for, and they’re told why', req0.status === 403 && /Swap days are an add-on here/.test(req0.body.error));
  const pk0 = await portal({ action: 'package-save', name: 'Five fills', credits: 5, price: 200 });
  check('packages: a new one can’t be made', pk0.status === 403 && /Packages and memberships are an add-on here/.test(pk0.body.error));
  const pl0 = await portal({ action: 'packages-list' });
  check('…the list says why, and that it can be added', pl0.body.ok && /add-on here/.test(pl0.body.blocked) && pl0.body.addPriceCents === 800);
  const gs0 = await portal({ action: 'gift-sell', amountCents: 5000 });
  check('own gift cards: can’t sell one', gs0.status === 403 && /Selling your own gift cards is an add-on here/.test(gs0.body.error));
  const gi0 = await portal({ action: 'gift-info' });
  check('…gift-info says what can be added', gi0.body.ok && gi0.body.ownCards === false && gi0.body.salonCards === true && gi0.body.addable.length === 1 && gi0.body.addable[0].key === 'ownGiftCards' && gi0.body.addable[0].priceCents === 1000);
  const rc0 = await portal({ action: 'rc-save', name: 'Come back', body: 'Hi {first}, we miss you here.', type: 'email', subject: 'Hello' });
  check('campaigns: can’t save one', rc0.status === 403 && /Win-back campaigns are an add-on here/.test(rc0.body.error));
  const rl0 = await portal({ action: 'rc-list' });
  check('…the list reads as off, with why and the price', rl0.body.policy.mode === 'off' && rl0.body.policy.addPriceCents === 500);

  // Adding needs a card, at the price shown.
  const a0 = await portal({ action: 'addon-add', key: 'swaps', priceCents: 1500 });
  check('adding needs a saved card', a0.status === 400 && /Save a card first/.test(a0.body.error) && Array.isArray(a0.body.lines));
  await db.doc(`${T}/renters/r1`).set({ cardOnFile: true, stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeCustomerAccount: 'acct_1', cardBrand: 'visa', cardLast4: '4242' }, { merge: true });
  const a1 = await portal({ action: 'addon-add', key: 'swaps', priceCents: 1200 });
  check('a price that changed since they looked is shown first, nothing added', a1.status === 409 && /The price is now \$15 a month/.test(a1.body.error) && !(await get(`${T}/renters/r1`)).addOns);
  check('unknown or included ones are refused', (await portal({ action: 'addon-add', key: 'texts', priceCents: 0 })).status === 400);
  const a2 = await portal({ action: 'addon-add', key: 'swaps', priceCents: 1500 });
  const mine = (await get(`${T}/renters/r1`)).addOns?.swaps;
  check('added: running, at its price, charged from today', a2.status === 200 && mine?.status === 'active' && mine.priceCents === 1500 && mine.nextBillOn === today && mine.version === 1, mine);
  check('…the list shows it added, and the card', a2.body.lines.find((l: any) => l.key === 'swaps').state === 'added' && a2.body.card?.last4 === '4242');
  check('…the owner hears of it', audits.some((a) => a.action === 'renters.addon_add' && /added Swap days \(\$15 a month\)/.test(a.summary)) && (await db.collection(`${T}/notifications`).get()).docs.some((d: any) => d.data().type === 'renter_addon'));
  check('adding it twice is refused', (await portal({ action: 'addon-add', key: 'swaps', priceCents: 1500 })).status === 409);
  check('someone else’s session can’t stop it', (await portal({ action: 'addon-stop', key: 'swaps' }, KIM)).status === 409 && (await get(`${T}/renters/r1`)).addOns.swaps.status === 'active');
  const sw1 = await portal({ action: 'swap-options', today });
  check('swap days work for them now', sw1.body.enabled === true);
  const req1 = await portal({ action: 'swap-request', today, toStaffId: 's2', giveDate: addDays(3) });
  check('…but Kim, who hasn’t added it, isn’t someone to swap with', req1.status === 400 && /Pick who you want to swap with/.test(req1.body.error));
  await portal({ action: 'addon-add', key: 'packages', priceCents: 800 });
  const pk1 = await portal({ action: 'package-save', name: 'Five fills', credits: 5, price: 200 });
  check('packages: with it added, a new one can be made', pk1.status === 200 && pk1.body.ok, pk1.body);
  await portal({ action: 'addon-add', key: 'campaigns', priceCents: 500 });
  const rc1 = await portal({ action: 'rc-save', name: 'Come back', body: 'Hi {first}, we miss you here.', type: 'email', subject: 'Hello' });
  check('campaigns: with it added, one can be saved', rc1.status === 200 && rc1.body.ok, rc1.body);

  // Stopping.
  const st1 = await portal({ action: 'addon-stop', key: 'swaps' });
  const stopped = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('stopped: no more charges', st1.status === 200 && stopped.status === 'stopped' && stopped.nextBillOn === null && stopped.stoppedWhy === 'renter');
  check('…and with nothing paid for yet, it stops working', (await portal({ action: 'swap-options', today })).body.enabled === false);
  check('stopping one they don’t have is refused', (await portal({ action: 'addon-stop', key: 'swaps' })).status === 409);
  await db.doc(`${T}/renters/r1`).set({ addOns: { swaps: { paidThrough: addDays(10) } } }, { merge: true });
  check('stopped with time paid for: it still works until then', (await portal({ action: 'swap-options', today })).body.enabled === true);
  const again = await portal({ action: 'addon-add', key: 'swaps', priceCents: 1500 });
  const re = (await get(`${T}/renters/r1`)).addOns.swaps;
  check('added again before it runs out: the next charge waits until then', again.status === 200 && re.status === 'active' && re.nextBillOn === addDays(10));

  // The owner changes it again: add-ons that end are stopped.
  const v = (await owner.GET(oreq({})) as any).body.offers.version;
  const s2 = await owner.POST(oreq({ tenantId: 't1', version: v, modes: { swaps: 'included', packages: 'off' } })) as any;
  const after = (await get(`${T}/renters/r1`)).addOns;
  check('…marked so it’s never charged again', after.swaps.nextBillOn === null && after.packages.nextBillOn === null);
  check('a tool now included or off ends the add-ons for it', s2.status === 200 && s2.body.stopped === 1 && after.swaps.status === 'stopped' && after.swaps.stoppedWhy === 'included' && after.packages.stoppedWhy === 'off' && after.campaigns.status === 'active');
  check('…and swap days work for everyone, packages for no one', (await portal({ action: 'swap-options', today }, KIM)).body.enabled === true && (await portal({ action: 'package-save', name: 'Ten', credits: 10, price: 300 })).status === 403);
  // Adding needs a lease now; stopping always works.
  await db.doc(`${T}/leases/l1`).set({ status: 'ended' }, { merge: true });
  const nl = await portal({ action: 'addon-add', key: 'ownGiftCards', priceCents: 1000 });
  check('adding one needs a current lease', nl.status === 403 && /isn’t current/.test(nl.body.error));
  await db.doc(`${T}/staff/s1`).set({ isActive: false }, { merge: true });
  const sc = await portal({ action: 'addon-stop', key: 'campaigns' });
  check('someone who no longer books here can still stop one', sc.status === 200 && (await get(`${T}/renters/r1`)).addOns.campaigns.status === 'stopped');
  await db.doc(`${T}/staff/s1`).set({ isActive: true }, { merge: true }); await db.doc(`${T}/leases/l1`).set({ status: 'active' }, { merge: true });
  // A stopped one still running out is added again at today's price.
  const v2 = (await owner.GET(oreq({})) as any).body.offers.version;
  await owner.POST(oreq({ tenantId: 't1', version: v2, prices: { campaigns: 700 } }));
  await db.doc(`${T}/renters/r1`).set({ addOns: { campaigns: { paidThrough: addDays(4) } } }, { merge: true });
  const tl = (await portal({ action: 'tools-get' })).body.lines.find((l: any) => l.key === 'campaigns');
  check('a stopped one shows today’s price for adding it again', tl.state === 'added' && tl.stopped === true && tl.priceCents === 700);
  check('…and adding it again at that price works', (await portal({ action: 'addon-add', key: 'campaigns', priceCents: 700 })).status === 200 && (await get(`${T}/renters/r1`)).addOns.campaigns.priceCents === 700);

  // A renter's scheduled campaign waits while campaigns aren't theirs.
  await db.doc(`${T}/campaigns/k1`).set({ ownerRenterId: 'r2', status: 'scheduled', scheduledFor: '2026-01-01T00:00:00Z' });
  await db.doc(`${T}/campaigns/k2`).set({ ownerRenterId: 'r1', status: 'scheduled', scheduledFor: '2026-01-01T00:00:00Z' });
  const cron = await import('../../src/app/api/cron/campaigns/route');
  await cron.GET({ headers: { get: () => null }, nextUrl: { searchParams: new URLSearchParams() } } as any);
  check('a renter without the add-on: their scheduled campaign waits, and says why', !campaignSends.includes('k1') && /aren’t on for you right now/.test((await get(`${T}/campaigns/k1`)).heldWhy || ''));
  check('a renter with it: it goes', campaignSends.includes('k2'));
  console.error = orig.e; console.warn = orig.w;

  // ── The words and the look ──────────────────────────────────────────────
  const files = ['src/lib/renter-offers.ts', 'src/components/rent/RenterTools.tsx', 'src/components/renters/WhatRentersGet.tsx', 'src/app/api/renters/offers/route.ts'];
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    check(`${f}: no tool names`, !AI.test(src));
    check(`${f}: never says to call or contact`, !/call us|contact us/i.test(src));
    check(`${f}: no emoji or check marks`, !/[✓✔✅❌]|\p{Extended_Pictographic}/u.test(src));
    check(`${f}: US spelling`, !/cancelled|licence/.test(src.replace(/'cancelled'/g, '')));
    if (f.endsWith('.tsx')) {
      check(`${f}: no JSX comments`, !/\{\/\*/.test(src));
      check(`${f}: red only on Stop`, (src.match(/#b42318/g) || []).length === (f.includes('RenterTools') ? 2 : 0));
      const buttons = src.split('<button').slice(1).map((b) => { const i = b.indexOf('className='); return i < 0 ? '' : b.slice(i, i + 220); });
      check(`${f}: every button at least 44px tall`, buttons.length > 0 && buttons.every((b) => /h-11|\$\{btn\}|\$\{dark\}|\{btn\}|\{dark\}/.test(b)), buttons.filter((b) => !/h-11|\$\{btn\}|\$\{dark\}|\{btn\}|\{dark\}/.test(b)));
    }
  }
  const tools = readFileSync('src/components/rent/RenterTools.tsx', 'utf8');
  check('the renter is told the price and the card before adding', /charged to your \$\{card\} today, then on the same day each month/.test(tools));
  const portalMap = readFileSync('src/components/rent/portal-map.ts', 'utf8');
  check('the screen is in Space, first among the papers, and notices about it open it', /views: \['tools', 'lease', 'rules', 'insurance', 'w9'\]/.test(portalMap) && /space_tools: \['space', 'tools'\]/.test(portalMap));
  const gifts = readFileSync('src/app/api/gift-cards/route.ts', 'utf8');
  check('gift card settings no longer write renters’ switches', !/renters:\s*\{\s*salonCards: v\.renters/.test(gifts) && /never from here/.test(gifts));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
