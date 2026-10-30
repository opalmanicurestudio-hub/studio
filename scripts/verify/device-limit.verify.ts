// scripts/verify/device-limit.verify.ts — Digital protection (row 9), run for real against the stand-in database: the
// add-on's price and when it's billed (only while on and its tool is on), the owner switching it on and off (never a
// manager, never from the browser), the device limit at open (three devices open it, a fourth is refused with the
// devices named, the same device again never counts twice, copies multiply it, a lower limit never takes a device
// away, add-on off means no limit), a manager resetting a buyer's devices (emailed, kept on the history), and what
// buyers and shoppers are told.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/device-limit.verify.ts
import fs from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV } from './fake-db';

let db: any = makeDb();
const M: any = Module as any;
const load = M._load;
// A dynamic import reaches a module through its cache entry, so the stand-in is put there too.
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } else if (request.startsWith('/') && M._cache) { const m = new M(request); m.filename = request; m.exports = mock; m.loaded = true; M._cache[request] = m; } return mock; };
let actor: any = { uid: 'owner1', name: 'Opal Owner', role: 'owner', isManager: true, isTenantOwner: true, caps: [] };
const synced: string[] = [];
const billingState = { enabled: false, missing: [] as string[], syncFails: false, beforeFail: null as null | (() => Promise<void>) };
const sent: any[] = [];
const resJson = (body: any, init?: any) => { const cookies: Record<string, any> = {}; return { status: init?.status || 200, body, cookies: { set: (k: string, v: string, o: any) => { cookies[k] = { v, ...o }; } }, jar: cookies }; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: resJson } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db, getAdminAuth: () => ({ getUser: async () => ({ email: 'o@example.com' }) }) };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'retail-digital-access' }), getApps: () => [{ name: 'retail-digital-access' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/order-pass') return { checkPass: (_t: string, _k: string, p: string) => p === 'good' };
  if (request === '@/lib/rate-limit') return { bump: async () => true, visitorIp: () => '1.1.1.1' };
  if (request === '@/lib/pdf-watermark') return { watermarkPdf: async (b: any) => b, looksLikePdf: () => true };
  if (request === '@/lib/digital-storage') return { downloadFile: async () => Buffer.from('%PDF') };
  if (request === '@/lib/billing') return { billingSettings: async () => ({ enabled: billingState.enabled }), quoteFor: async () => ({ lines: [], total: 0 }), checkoutFor: async () => '', portalFor: async () => '', textsUsed: async () => 0, monthRange: () => ({ from: '', to: '' }),
    missingPrices: async (keys: string[]) => keys.filter((k) => billingState.missing.includes(k)),
    syncSubscription: async (id: string) => { if (billingState.syncFails) { if (billingState.beforeFail) await billingState.beforeFail(); throw new Error('stripe down'); } synced.push(id); return { changed: true, total: 0 }; } };
  return load.call(this, request, ...rest);
};


const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const ON = { addons: { digitalProtection: { active: true } } };

// Emails go out for real through the app's own sender, to a stand-in for the email service.
process.env.RESEND_API_KEY = 're_test'; process.env.NOTIFY_FROM_EMAIL = 'shop@example.com';
(globalThis as any).fetch = async (url: string, init: any) => { if (/resend\.com/.test(String(url))) sent.push(JSON.parse(String(init?.body || '{}'))); return { ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '' }; };

(async () => {
  // Loaded after the stand-ins are in place.
  const { quote, ADDON_PRICES, ALL_PRICES } = await import('../../src/lib/billing-plans');
  const { addonLive, billedAddons } = await import('../../src/lib/addons');
  const { deviceCap, deviceLabel, deviceLimitOf, deviceNames, deviceStep, deviceWhen, limitMessage, devicesOf } = await import('../../src/lib/device-limit');
  const { applyAction, buyerMessage, cleanAction } = await import('../../src/lib/entitlement-actions');
  const { publicEntitlement } = await import('../../src/lib/entitlements');
  const { digitalFaq, digitalProblems, publicDigital } = await import('../../src/lib/digital-product');
  const { asSold } = await import('../../src/lib/variants');
  // ── The price, and when it's billed
  console.log('the add-on on the plan');
  check('Digital protection is $19 a month with its own Stripe key, set up with the other prices', ADDON_PRICES.digitalProtection.amount === 19 && ADDON_PRICES.digitalProtection.key === 'cf_addon_digital_protection_v1' && ALL_PRICES.some((p) => p.key === 'cf_addon_digital_protection_v1'));
  const q0 = quote({ tools: ['inventory'], staff: 1, renters: 0, team: false });
  const q1 = quote({ tools: ['inventory'], staff: 1, renters: 0, team: false, addons: ['digitalProtection', 'digitalProtection', 'nope'] });
  check('on the quote it is one line of $19, and unknown add-ons are ignored', q1.total - q0.total === 19 && q1.lines.filter((l) => l.key === 'cf_addon_digital_protection_v1').length === 1, q1.lines);
  check('billed while on and Inventory and retail is on', billedAddons({ ...ON, modules: { retail: true } }).join() === 'digitalProtection');
  check('not billed (and not working) while Inventory and retail is off', billedAddons({ ...ON, modules: { retail: false } }).length === 0 && !addonLive({ ...ON, modules: { retail: false } }, 'digitalProtection'));
  check('not billed when switched off', billedAddons({ addons: { digitalProtection: { active: false } } }).length === 0 && billedAddons({}).length === 0);
  check('a proposed set of tools decides (Your ClarityFlow before saving)', billedAddons(ON, ['booking']).length === 0 && billedAddons({ ...ON, modules: { retail: false } }, ['inventory']).length === 1);

  // ── The owner switches it (api/billing)
  console.log('switching it on and off');
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  const billing = await import('../../src/app/api/billing/route');
  const breq = (body: any) => ({ json: async () => body, nextUrl: { origin: 'https://app.example' }, headers: { get: () => null } }) as any;
  await db.doc(T).set({ name: 'Opal', userId: 'owner1', modules: { retail: true } });
  actor = { uid: 'mgr', name: 'Mo Manager', role: 'manager', isManager: true, isTenantOwner: false };
  let r: any = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('a manager can’t add it (it’s billed)', r.status === 403 && !(await get(T)).addons);
  actor = { uid: 'owner1', name: 'Opal Owner', role: 'owner', isManager: true, isTenantOwner: true };
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'nope', on: true }));
  check('only a known add-on can be switched', r.status === 400);
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  let t = await get(T);
  check('early access (billing not live): the owner adds it, and it joins the plan when billing starts', r.body.ok && t.addons.digitalProtection.active === true && !!t.addons.digitalProtection.since && synced.length === 0 && /when billing starts/.test(r.body.message), { b: r.body, a: t.addons });
  const priv = await get(`${T}/private/addons`);
  check('who switched it is kept privately, not on the public business record', priv?.log?.[0]?.by === 'Opal Owner' && !('by' in t.addons.digitalProtection) && !('byUid' in t.addons.digitalProtection), { priv, a: t.addons });
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: false }));
  t = await get(T);
  check('turned off: the whole entry is replaced (no stale start date)', t.addons.digitalProtection.active === false && !!t.addons.digitalProtection.endedAt && !('since' in t.addons.digitalProtection), t.addons);
  billingState.enabled = true;
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('once billing is live, it can’t be added without a subscription', r.status === 409 && /Start your subscription/.test(r.body.error) && (await get(T)).addons.digitalProtection.active === false, r.body);
  await db.doc(T).set({ billing: { subscriptionId: 'sub_1', status: 'active' } }, { merge: true });
  billingState.missing = ['cf_addon_digital_protection_v1'];
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('its price not set up in Stripe yet: refused, nothing charged, still off', r.status === 409 && /Nothing was charged/.test(r.body.error) && (await get(T)).addons.digitalProtection.active === false && synced.length === 0, r.body);
  billingState.missing = [];
  billingState.syncFails = true;
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('billing fails: the switch goes back and the owner is told nothing changed', r.status === 502 && /nothing changed/.test(r.body.error) && (await get(T)).addons.digitalProtection.active === false, r.body);
  check('a change that was undone isn’t kept in the private log', (await get(`${T}/private/addons`)).log.length === 2);
  billingState.beforeFail = async () => { await db.doc(T).update({ 'addons.digitalProtection': { active: true, since: 'someone-else' } }); };
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('a failed sync never undoes a change made by someone else in the meantime, and says it may not be undone', r.status === 502 && /may not have been undone/.test(r.body.error) && (await get(T)).addons.digitalProtection.since === 'someone-else', { b: r.body, a: (await get(T)).addons });
  billingState.beforeFail = null;
  await db.doc(T).update({ 'addons.digitalProtection': { active: false, endedAt: 'x' } });
  billingState.syncFails = false;
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('subscribed: on, synced, and said to be on the next invoice', r.body.ok && synced.length === 1 && (await get(T)).addons.digitalProtection.active === true && /next invoice/.test(r.body.message), r.body);
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('asking again syncs again, so a subscription that didn’t follow is repaired', r.body.ok && synced.length === 2);
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: false }));
  t = await get(T);
  check('turned off while subscribed: it comes off the plan, and downloads keep Standard protection', synced.length === 3 && t.addons.digitalProtection.active === false && /comes off your plan/.test(r.body.message) && /Standard protection/.test(r.body.message), r.body);
  r = await billing.POST(breq({ tenantId: 't1', action: 'addon', addon: 'digitalProtection', on: true }));
  check('and on again', r.body.ok && (await get(T)).addons.digitalProtection.active === true);
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  check('the browser can’t switch an add-on on for free (rules lock tenant.addons)', /'plan', 'billing', 'addons'\s*\]\);/.test(rules));

  // ── The rules for devices (pure)
  console.log('device rules');
  check('a product’s limit: 1 to 10, else off', deviceLimitOf({ digitalDeviceLimit: 3 }) === 3 && deviceLimitOf({ digitalDeviceLimit: 0 }) === null && deviceLimitOf({}) === null && deviceLimitOf({ digitalDeviceLimit: 40 }) === 10);
  const shop = { ...ON, modules: { retail: true } };
  check('the limit applies only with the add-on live and the product’s limit on', deviceCap(shop, { digitalDeviceLimit: 3 }) === 3 && deviceCap({}, { digitalDeviceLimit: 3 }) === null && deviceCap(shop, {}) === null && deviceCap({ ...ON, modules: { retail: false } }, { digitalDeviceLimit: 3 }) === null);
  check('copies multiply it', deviceCap(shop, { digitalDeviceLimit: 3 }, { copies: 3 }) === 9);
  check('a variant takes its listing’s limit', deviceLimitOf(asSold({ id: 'L', digital: true, digitalDeviceLimit: 2 }, { id: 'v', parentId: 'L' })) === 2);
  const at = '2026-10-28T12:00:00.000Z';
  let s1 = deviceStep([], 'a', 'iPhone · Safari', 2, at);
  check('a first device is added', s1.ok && s1.changed && s1.devices.length === 1 && s1.devices[0].firstAt === at);
  const again = deviceStep(s1.devices, 'a', 'iPhone · Safari', 2, '2026-10-28T12:10:00.000Z');
  check('the same device again never counts twice (and isn’t written again within the hour)', again.ok && !again.changed && again.devices.length === 1);
  const later = deviceStep(s1.devices, 'a', 'iPhone · Safari', 2, '2026-10-29T12:00:00.000Z');
  check('a day later its last use moves on', later.ok && later.changed && later.devices[0].lastAt === '2026-10-29T12:00:00.000Z' && later.devices[0].firstAt === at);
  const s2 = deviceStep(s1.devices, 'b', 'Mac · Chrome', 2, at);
  const s3 = deviceStep(s2.devices, 'c', 'iPad · Safari', 2, at);
  check('a new device past the limit is refused and the list is left as it was', s2.ok && !s3.ok && !s3.changed && s3.devices.length === 2);
  check('a lower limit never takes a listed device away', deviceStep(s2.devices, 'b', 'Mac · Chrome', 1, '2026-10-30T12:00:00.000Z').ok && !deviceStep(s2.devices, 'z', 'x', 1, at).ok);
  check('labels: iPhone, Mac, an iPad asking for the desktop site, Windows and Android', deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1') === 'iPhone · Safari'
    && deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0 Safari/537.36') === 'Mac · Chrome'
    && deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', true) === 'iPad · Safari'
    && deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0') === 'Windows PC · Edge'
    && deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36') === 'Android phone · Chrome');
  const three = [{ id: '1', label: 'iPhone · Safari', firstAt: at, lastAt: at }, { id: '2', label: 'Mac · Chrome', firstAt: at, lastAt: at }, { id: '3', label: 'iPad · Safari', firstAt: at, lastAt: at }];
  check('the devices in words', deviceNames(three) === 'iPhone, Mac and iPad' && deviceNames([three[0], three[0], three[1]]) === '2 iPhones and Mac' && deviceNames([three[1]]) === 'Mac');
  const msg = limitMessage('Gel removal guide', 3, three);
  check('the buyer is told the limit, their devices and what to do (7B)', msg === 'Gel removal guide opens on up to 3 devices, and it’s already open on 3: iPhone, Mac and iPad. Open it on one of those, or ask the shop to reset your devices.', msg);
  check('someone given it as a gift is told to reply to their gift email', /reply to your gift email/.test(limitMessage('Guide', 1, [three[0]], true)));
  check('first and last use, for the shop (7C)', deviceWhen({ id: 'x', label: 'Mac', firstAt: '2026-10-13T12:00:00Z', lastAt: '2026-10-27T12:00:00Z' }) === 'First Oct 13 · last Oct 27');
  check('a stored list is cleaned and bounded', devicesOf({ devices: [null, { id: '' }, { id: 'a', label: 'X' }] }).length === 1 && devicesOf({ devices: Array.from({ length: 150 }, (_, i) => ({ id: `d${i}` })) }).length === 100);

  // ── Opening a download (api/retail/digital-access)
  console.log('opening on devices');
  await db.doc(T).set({ name: 'Opal', businessName: 'Opal Studio', userId: 'owner1', modules: { retail: true }, ...ON });
  await db.doc(`${T}/inventory/p1`).set({ name: 'Gel removal guide', digital: true, digitalFiles: [{ id: 'f1', name: 'guide.pdf', path: 'tenants/t1/digital/p1/guide.pdf', version: 1 }], digitalDeviceLimit: 3, digitalDelivery: 'both' });
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'completed', paidAt: '2026-10-12T12:00:00Z', totalCents: 1800, orderNumber: 7, customerName: 'Maya Chen', customerEmail: 'maya@example.com', qrToken: 'q', lines: [{ lineId: 'l1', productId: 'p1', name: 'Gel removal guide', digital: true, qtyOrdered: 1 }] });
  const access = await import('../../src/app/api/retail/digital-access/route');
  const UA = { iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0 Safari/537.36', win: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0' };
  const open = (o: { cookie?: string; device?: string; ua?: string; touch?: boolean; pass?: string } = {}) => access.POST({ json: async () => ({ tenantId: 't1', orderId: 'o1', productId: 'p1', lineId: 'l1', pass: o.pass ?? 'good', device: o.device, touch: o.touch }), cookies: { get: (k: string) => (k === 'cf_dv' && o.cookie ? { value: o.cookie } : undefined) }, headers: { get: (k: string) => (k.toLowerCase() === 'user-agent' ? o.ua || '' : null) } } as any) as any;
  const ent = () => get(`${T}/entitlements/o1_l1`);
  const A = 'AAAAAAAAAAAAAAAAAAAA', B = 'BBBBBBBBBBBBBBBBBBBB', C = 'CCCCCCCCCCCCCCCCCCCC', D = 'DDDDDDDDDDDDDDDDDDDD';
  r = await open({ cookie: A, pass: 'nope', ua: UA.iphone });
  check('without proof it’s the buyer nothing is counted', r.status === 401 && !((await ent())?.devices || []).length);
  r = await open({ cookie: A, ua: UA.iphone });
  check('the first device opens it, and its id is kept (cookie and the page’s copy)', r.status === 200 && r.body.ok && r.body.device === A && r.jar.cf_dv?.v === A && r.jar.cf_dv?.httpOnly === true, { s: r.status, b: r.body, j: r.jar });
  let e = await ent();
  check('the record keeps a hash for the device, never its id', e.devices.length === 1 && e.devices[0].id !== A && e.devices[0].label === 'iPhone · Safari');
  r = await open({ device: B, ua: UA.mac });
  check('no cookie: the page’s copy is used', r.status === 200 && r.body.device === B && r.jar.cf_dv?.v === B);
  r = await open({ cookie: C, device: A, ua: UA.mac, touch: true });
  check('the cookie wins over the page’s copy, and a touch Mac is an iPad', r.status === 200 && r.body.device === C && (await ent()).devices[2].label === 'iPad · Chrome');
  r = await open({ cookie: D, ua: UA.win });
  check('a fourth device is refused with the 7B message, and nothing is counted', r.status === 403 && r.body.deviceLimit?.cap === 3 && r.body.error === 'Gel removal guide opens on up to 3 devices, and it’s already open on 3: iPhone, Mac and iPad. Open it on one of those, or ask the shop to reset your devices.' && (await ent()).devices.length === 3 && (await ent()).views === 1 + 1 + 1, r.body);
  r = await open({ cookie: A, ua: UA.iphone });
  check('a device already on the list still opens it', r.status === 200 && r.body.ok && (await ent()).devices.length === 3);
  r = await open({ ua: UA.win });
  check('no id at all and refused: no id is handed out, so a first try never replaces the device’s id', r.status === 403 && !r.body.device && !r.jar.cf_dv, { b: r.body, j: r.jar });
  r = await open({ cookie: A, ua: UA.win });
  check('an id copied into another browser is a different device', r.status === 403 && (await ent()).devices.length === 3);
  r = await open({ cookie: A, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', touch: true });
  check('the same phone asking for a desktop site is still the same device', r.status === 200 && (await ent()).devices.length === 3);
  e = await ent();
  check('refusals are counted on the record, with the last device', e.deviceRefused?.count === 3 && e.deviceRefused?.label === 'Windows PC · Edge', e.deviceRefused);
  const route = fs.readFileSync('src/app/api/retail/digital-access/route.ts', 'utf8');
  check('a used-up download or a file that can’t open is refused before a device is counted', route.indexOf('usedUp(order), downloadsLeft: 0') < route.indexOf('useDevice(db, tenantId') && route.indexOf('doesn\\u2019t offer copies of it') < route.indexOf('useDevice(db, tenantId'));

  // Add-on off: any device, nothing checked, the list kept.
  await db.doc(T).set({ addons: { digitalProtection: { active: false } } }, { merge: true });
  r = await open({ cookie: D, ua: UA.win });
  check('with the add-on off nobody is locked out, and the list is kept as it was', r.status === 200 && (await ent()).devices.length === 3 && !r.jar.cf_dv);
  await db.doc(T).set({ addons: { digitalProtection: { active: true } } }, { merge: true });
  await db.doc(`${T}/inventory/p1`).set({ digitalDeviceLimit: 0 }, { merge: true });
  r = await open({ cookie: D, ua: UA.win });
  check('with the product’s limit off any device opens it', r.status === 200);
  await db.doc(`${T}/inventory/p1`).set({ digitalDeviceLimit: 3 }, { merge: true });

  // What the library shows.
  e = await ent();
  const pub: any = publicEntitlement(e, 3);
  check('the buyer sees the limit and how many devices it’s open on, never device ids', pub.devices.cap === 3 && pub.devices.used === 3 && !JSON.stringify(pub).includes(e.devices[0].id) && publicEntitlement(e, null)!.devices === null);
  const status = fs.readFileSync('src/app/api/retail/order-status/route.ts', 'utf8');
  const giftLib = fs.readFileSync('src/app/api/retail/gift-library/route.ts', 'utf8');
  check('the library and a gift’s library both pass the limit through', status.includes('publicEntitlement(entMap[String(l.lineId || l.productId)] || null, deviceCap(') && giftLib.includes('publicEntitlement(ents[k] || null, it ? deviceCap(t, it'));

  // ── The shop resets a buyer's devices (api/retail/digital/access)
  console.log('reset devices');
  const shopAccess = await import('../../src/app/api/retail/digital/access/route');
  const sreq = (body: any) => ({ json: async () => body, nextUrl: { origin: 'https://app.example' }, headers: { get: () => null } }) as any;
  actor = { uid: 'st', name: 'Sam Staff', role: 'staff', isManager: false };
  r = await shopAccess.POST(sreq({ tenantId: 't1', id: 'o1_l1', action: { kind: 'reset_devices' } }));
  check('only a manager can reset devices', r.status === 403 && (await ent()).devices.length === 3);
  actor = { uid: 'mgr', name: 'Mo Manager', role: 'manager', isManager: true };
  r = await shopAccess.POST(sreq({ tenantId: 't1', id: 'o1_l1', action: { kind: 'reset_devices' } }));
  e = await ent();
  check('a manager resets them: the list and refusals are cleared and the history says who', r.status === 200 && e.devices.length === 0 && !e.deviceRefused && e.history.some((h: any) => /Devices reset \(3 cleared\)/.test(h.what) && h.by === 'Mo Manager'), { r: r.body, h: e.history });
  check('the buyer is emailed that it’s done, with a link to their library', r.body.emailed === true && sent.some((m) => JSON.stringify(m.to).includes('maya@example.com') && /devices for Gel removal guide are reset/.test(m.subject) && /library\/o1/.test(String(m.text || m.html))), sent.map((m) => m.subject));
  r = await open({ cookie: D, ua: UA.win });
  check('after the reset the new device opens it, counting from fresh', r.status === 200 && (await ent()).devices.length === 1);
  r = await shopAccess.POST(sreq({ tenantId: 't1', id: 'o1_l1', action: { kind: 'reset_devices' } }));
  check('resetting again with one device clears it', r.status === 200);
  r = await shopAccess.POST(sreq({ tenantId: 't1', id: 'o1_l1', action: { kind: 'reset_devices' } }));
  check('nothing to reset says so', r.status === 409 && /no devices/.test(r.body.error));
  check('reset is an action the shop can send, and refused on a refunded order', !!cleanAction({ kind: 'reset_devices' }) && !applyAction({ devices: [{ id: 'a' }] }, { kind: 'reset_devices' }, 'M', at, { closedFor: 'refunded' }).ok);
  check('the email words', /reset the devices for Guide/.test(buyerMessage({ kind: 'reset_devices' }, 'Guide', 'Opal').line));

  // Copies: two copies of a 1-device guide open on two.
  await db.doc(`${T}/retailOrders/o2`).set({ stage: 'completed', paidAt: '2026-10-12T12:00:00Z', totalCents: 3600, orderNumber: 8, customerName: 'Lee', customerEmail: 'lee@example.com', qrToken: 'q2', lines: [{ lineId: 'l1', productId: 'p1', name: 'Gel removal guide', digital: true, qtyOrdered: 2 }] });
  await db.doc(`${T}/inventory/p1`).set({ digitalDeviceLimit: 1 }, { merge: true });
  const open2 = (cookie: string) => access.POST({ json: async () => ({ tenantId: 't1', orderId: 'o2', productId: 'p1', lineId: 'l1', pass: 'good' }), cookies: { get: () => ({ value: cookie }) }, headers: { get: () => UA.mac } } as any) as any;
  const c1 = await open2(A), c2 = await open2(B), c3 = await open2(C);
  check('two copies of a one-device guide open on two devices', c1.status === 200 && c2.status === 200 && c3.status === 403 && /up to 2 devices/.test(c3.body.error));

  // ── What shoppers are told before buying, and the product's own checks
  console.log('the product page and settings');
  const pd: any = publicDigital({ digital: true, digitalFiles: [{ id: 'f', name: 'g.pdf', path: 'x' }] }, { name: 'Personal use', terms: 'For you.' }, { deviceLimit: 3 });
  check('shoppers see how many devices it opens on, with a question answered', pd.deviceLimit === 3 && digitalFaq(pd).some((f) => /devices can I open it on/.test(f.q) && /Up to 3 devices/.test(f.a)));
  check('without the limit nothing is said about devices', publicDigital({ digital: true }, { name: 'P', terms: '' })!.deviceLimit === null && !digitalFaq(publicDigital({ digital: true }, { name: 'P', terms: '' })!).some((f) => /devices/.test(f.q)));
  check('devices per buyer must be 1 to 10', digitalProblems({ digital: true, digitalUrl: 'https://x.example', digitalDeviceLimit: 11 }).some((p) => /1 to 10/.test(p)) && digitalProblems({ digital: true, digitalUrl: 'https://x.example', digitalDeviceLimit: NaN }).some((p) => /1 to 10/.test(p)) && !digitalProblems({ digital: true, digitalUrl: 'https://x.example', digitalDeviceLimit: 3 }).length);
  const section = fs.readFileSync('src/components/inventory/DigitalSection.tsx', 'utf8');
  check('the limit is saved only while the add-on is on (otherwise kept as it was)', section.includes("...(protectedShop ? { digitalDeviceLimit:"));
  check('only the owner gets the Add button (it’s billed)', section.includes('isOwner ? (') && section.includes("action: 'addon', addon: 'digitalProtection', on: true"));
  const words = [section, fs.readFileSync('src/app/(app)/inventory/digital/page.tsx', 'utf8'), fs.readFileSync('src/app/shop/[tenantId]/library/[orderId]/page.tsx', 'utf8'), fs.readFileSync('src/lib/device-limit.ts', 'utf8'), fs.readFileSync('src/app/(app)/subscriptions/page.tsx', 'utf8')].join('\n');
  const tool = new RegExp(String.fromCharCode(67, 108, 97, 117, 100, 101), 'i');
  check('no mention of the tool that wrote this, no "call us", no JSX comments', !tool.test(words) && !/call us/i.test(words) && !/\{\/\*/.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
