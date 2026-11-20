// Checks what the drive-thru's voice assistant offers (lib/voice-offer, api/counter/assistant add_item and size_up,
// api/counter/voice, api/menu 'voice', the Menu page, and the assistant's instructions and tools).
// - What each item offers (Offered at the end), as one short question with the menu's prices: the next size up and one
//   thing to go with it, or two things to go with it; never something sold out, off the menu or already on the order.
// - How often is the business's choice: with each item (the first time it's added on the call; the default), once per
//   order, or never; and never while the line is long.
// - "Yes" to the size: size_up makes what was just added bigger (only that many), priced from the menu, marked as
//   taken from an offer; "yes" to the other thing: add_item, marked too. A tool call sent again offers nothing more.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/voice-offers.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

const db: any = makeDb();
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  process.env.VOICE_AGENT_SECRET = 'vs_1';
  const { POST: tool } = await import('../../src/app/api/counter/assistant/route');
  const V = await import('../../src/lib/voice-offer');
  const size = { id: 'sz', name: 'Size', pick: 'one', required: true, options: [{ id: 's', name: '12 oz', price: 0 }, { id: 'm', name: '16 oz', price: 0.75 }, { id: 'l', name: '20 oz', price: 1.25 }] };
  await db.doc(T).set({ name: 'North Pier', timezone: 'UTC', driveThru: { voiceAgentId: 'agent_own', voiceVersion: 3 } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 4.5, totalStock: 50, choices: [size], upgrades: { size: true, items: ['crois', 'muffin', 'cookie'] } });
  await db.doc(`${T}/inventory/tea`).set({ type: 'refreshment', name: 'Iced tea', category: 'Coffee', price: 3, totalStock: 50, upgrades: { size: false, items: ['oat', 'cookie'] } });
  await db.doc(`${T}/inventory/crois`).set({ type: 'refreshment', name: 'Butter croissant', category: 'Pastries', price: 3.25, totalStock: 20 });
  await db.doc(`${T}/inventory/muffin`).set({ type: 'refreshment', name: 'Blueberry muffin', category: 'Pastries', price: 3.5, totalStock: 20 });
  await db.doc(`${T}/inventory/oat`).set({ type: 'refreshment', name: 'Oat bar', category: 'Pastries', price: 2.75, totalStock: 0 });
  await db.doc(`${T}/inventory/cookie`).set({ type: 'refreshment', name: 'Cookie', category: 'Pastries', price: 2, totalStock: 20 });
  let n = 0;
  const callFor = async (o: { busy?: boolean } = {}) => {
    n++; const id = `call_${n}xyz`; const orderId = `o${n}`;
    await db.doc(`${T}/counterOrders/${orderId}`).set({ channel: 'drivethru', number: `B${n}`, status: 'building', lines: [], subtotal: 0, tax: 0, total: 0 });
    await db.doc(`driveThruCalls/${id}`).set({ callId: id, tenantId: 't1', carId: `car${n}`, orderId, status: 'live', ...(o.busy ? { busy: true } : {}) });
    let turn = 1;
    return { id, orderId, say: (name: string, args: any = {}, again = false) => tool(req({ name, args, call: { call_id: id, transcript_object: Array.from({ length: again ? turn : ++turn }) } }, { 'x-voice-secret': 'vs_1' })) as Promise<any> };
  };
  const lines = async (orderId: string) => ((await get(`${T}/counterOrders/${orderId}`)).lines || []) as any[];

  console.log('what’s offered');
  let c = await callFor();
  let r = await c.say('add_item', { item: 'latte', quantity: 2, choices: ['12 oz'] });
  check('a latte just added: the bigger size for the two of them and one thing to go with it, as one question with the menu’s prices',
    /^Added 2 Latte, 12 oz\. Offer it once, as one short question: "Would you like to make those 16 oz for \$1\.50 more, or add a butter croissant for \$3\.25\?" If they want the bigger size, call size_up\. If they want the Butter croissant, call add_item for it\. If they say no, don’t offer again: ask if there’s anything else\.$/.test(r.body.result)
    && r.body.offer === 'Would you like to make those 16 oz for $1.50 more, or add a butter croissant for $3.25?', r.body);
  r = await c.say('size_up', {});
  let ls = await lines(c.orderId);
  check('“yes” to the size: what was just added made bigger, priced from the menu, marked as taken from an offer', /^Made it Latte, 16 oz\. Ask if there’s anything else\.$/.test(r.body.result) && ls.length === 1 && ls[0].choicesText === '16 oz' && ls[0].quantity === 2 && ls[0].unitPrice === 5.25 && ls[0].offer === 'size', { r: r.body, ls });
  r = await c.say('add_item', { item: 'butter croissant' });
  ls = await lines(c.orderId);
  check('“yes” to the croissant: added, marked as taken from an offer, and nothing more offered with it', /^Added Butter croissant\. Ask if there’s anything else\.$/.test(r.body.result) && ls[1].offer === 'item', r.body);
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  check('with each item: a second latte on the same call isn’t offered again', /^Added Latte, 12 oz\. Ask if there’s anything else\.$/.test(r.body.result) && !r.body.offer, r.body);
  r = await c.say('add_item', { item: 'iced tea' });
  check('…but the next item is: no size up when it doesn’t offer one, never sold out, the next thing it offers', r.body.offer === 'Would you like to add a cookie for $2.00?', r.body);
  r = await c.say('add_item', { item: 'iced tea' }, true);
  check('the same tool call sent again adds nothing more, and says the same offer again (in case that answer was lost)', r.body.offer === 'Would you like to add a cookie for $2.00?' && (await lines(c.orderId)).filter((l) => l.itemId === 'tea').length === 1 && (await lines(c.orderId)).find((l) => l.itemId === 'tea').quantity === 1
    && JSON.stringify((await get(`driveThruCalls/${c.id}`)).lastOffer) === '["cookie"]', r.body);
  r = await c.say('add_item', { item: 'cookie' });
  check('…so “yes” after it is still marked as taken from the offer', (await lines(c.orderId)).find((l) => l.itemId === 'cookie')?.offer === 'item');
  const c2 = await callFor();
  await c2.say('add_item', { item: 'latte', choices: ['12 oz'] });
  r = await c2.say('size_up', {});
  const big = await lines(c2.orderId);
  r = await c2.say('size_up', {}, true);
  check('a size up sent again: said as done, nothing more changed', /^Made it bigger\./.test(r.body.result) && JSON.stringify(await lines(c2.orderId)) === JSON.stringify(big) && big[0].choicesText === '16 oz', r.body);

  console.log('how often');
  await db.doc(T).set({ driveThru: { offers: 'order' } }, { merge: true });
  c = await callFor();
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  const firstOffer = r.body.offer;
  r = await c.say('add_item', { item: 'iced tea' });
  check('once per order: the first thing offers, nothing after', !!firstOffer && !r.body.offer, r.body);
  await db.doc(T).set({ driveThru: { offers: 'off' } }, { merge: true });
  c = await callFor();
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  check('don’t offer: nothing offered', !r.body.offer && /Ask if there’s anything else\.$/.test(r.body.result));
  r = await c.say('size_up', {});
  check('…a guest can still ask to make it bigger', /^Made it Latte, 16 oz/.test(r.body.result) && (await lines(c.orderId))[0].choicesText === '16 oz', r.body);
  await db.doc(T).set({ driveThru: { offers: 'item' } }, { merge: true });
  c = await callFor({ busy: true });
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  check('a long line: nothing offered, whatever was chosen', !r.body.offer, r.body);
  c = await callFor();
  await c.say('add_item', { item: 'butter croissant' });
  r = await c.say('add_item', { item: 'latte', choices: ['20 oz'] });
  check('the biggest size and the croissant already on the order: what’s left to go with it (an item offers two things at most)', r.body.offer === 'Would you like to add a blueberry muffin for $3.50?', r.body);
  r = await c.say('size_up', {});
  check('size up at the biggest size: said plainly, nothing changes', /^There’s no bigger size of the Latte\./.test(r.body.result) && (await lines(c.orderId)).find((l) => l.itemId === 'latte').choicesText === '20 oz', r.body);
  r = await c.say('size_up', { item: 'butter croissant' });
  check('size up of something without sizes: said plainly', /no bigger size|isn’t/i.test(r.body.result) && (await lines(c.orderId)).length === 2, r.body);

  console.log('an assistant that can’t offer yet');
  await db.doc(T).set({ driveThru: { voiceVersion: 2 } }, { merge: true });
  c = await callFor();
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  check('an older assistant of its own (no size_up, older instructions): nothing offered until it’s updated', !r.body.offer && /Ask if there’s anything else\.$/.test(r.body.result), r.body);
  await db.doc(T).set({ driveThru: { voiceAgentId: '', voiceVersion: 3 } }, { merge: true });
  delete process.env.RETELL_DRIVETHRU_AGENT_VERSION;
  c = await callFor();
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  check('…nor the shared assistant when its version isn’t said', !r.body.offer, r.body);
  process.env.RETELL_DRIVETHRU_AGENT_VERSION = '3';
  c = await callFor();
  r = await c.say('add_item', { item: 'latte', choices: ['12 oz'] });
  check('…and the shared one when it is', !!r.body.offer, r.body);
  await db.doc(T).set({ driveThru: { voiceAgentId: 'agent_own', voiceVersion: 3 } }, { merge: true });

  console.log('the words');
  const menu: any[] = [{ id: 'a', name: 'Latte', price: 4.5, soldOut: false, onMenu: true, membersOnly: false, inStock: true, choices: [size], upgrades: { size: true, items: ['b', 'c'] } },
    { id: 'b', name: 'Iced coffee', price: 3, soldOut: false, onMenu: true, membersOnly: false, inStock: true }, { id: 'c', name: 'BLT', price: 6, from: true, startPrice: 6, soldOut: false, onMenu: true, membersOnly: false, inStock: true }];
  const o = V.voiceOffer({ mode: 'item', busy: false, offered: [], item: { ...menu[0], upgrades: { size: false, items: ['b', 'c'] } }, picks: {}, quantity: 1, menu, have: () => false });
  check('“an iced coffee”, “the BLT”, and “starting at” for something with choices', o?.say === 'Would you like to add an iced coffee for $3.00, or add the BLT starting at $6.00?', o);
  const fries = V.voiceOffer({ mode: 'item', busy: false, offered: [], item: { ...menu[0], upgrades: { size: false, items: ['f', 'g'] } }, picks: {}, quantity: 1, have: () => false,
    menu: [...menu, { id: 'f', name: 'Fries', price: 2, soldOut: false, onMenu: true, membersOnly: false, inStock: true }, { id: 'g', name: 'Onion rings', price: 3, soldOut: false, onMenu: true, membersOnly: false, inStock: true }] });
  check('…“fries”, “onion rings”: no “a” before a plural', fries?.say === 'Would you like to add fries for $2.00, or add onion rings for $3.00?', fries);
  check('not said: with each item; anything else saved is read as that', V.voiceOfferMode({}) === 'item' && V.voiceOfferMode({ driveThru: { offers: 'order' } }) === 'order' && V.voiceOfferMode({ driveThru: { offers: 'off' } }) === 'off' && V.voiceOfferMode({ driveThru: { offers: 'x' } }) === 'item');

  console.log('settings and instructions');
  const { POST: menuApi } = await import('../../src/app/api/menu/route');
  r = await menuApi(req({ action: 'voice', tenantId: 't1', offers: 'order' }));
  check('the Menu page saves how often', r.body.ok && r.body.offers === 'order' && (await get(T)).driveThru.offers === 'order', r.body);
  r = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('the Menu page is told whether this assistant can offer yet', r.body.voice?.offersReady === true, r.body.voice);
  await db.doc(T).set({ driveThru: { voiceVersion: 2 } }, { merge: true });
  r = await menuApi(req({ action: 'list', tenantId: 't1' }));
  check('…and when it can’t', r.body.voice?.offersReady === false, r.body.voice);
  await db.doc(T).set({ driveThru: { voiceVersion: 3 } }, { merge: true });
  r = await menuApi(req({ action: 'voice', tenantId: 't1', offers: 'always' }));
  check('…only the three choices', r.status === 400 && (await get(T)).driveThru.offers === 'order');
  const page = src('src/app/(app)/menu/page.tsx'), setup = src('src/lib/drive-thru-voice-setup.ts'), vr = src('src/app/api/counter/voice/route.ts');
  check('the Menu page: “What the assistant offers”, three choices, each pressed or not (kept focusable while saving), and “update first” for an older assistant', /What the assistant offers/.test(page) && /VOICE_OFFER_MODES\.map/.test(page) && /aria-pressed=\{on\} aria-disabled=\{busy === 'offers'\}/.test(page) && /role="group" aria-labelledby="voice-offers"/.test(page)
    && /voice\.offersReady === false \? \(voice\.outdated \? ' Update the assistant first: until then it doesn’t offer\.' : ' This assistant doesn’t offer yet\.'\) : ''/.test(page)
    && /label: 'With each item' \}, \{ value: 'order', label: 'Once per order' \}, \{ value: 'off', label: 'Don’t offer' \}/.test(src('src/lib/voice-offer.ts')));
  check('the assistant: offers only what a tool says, has size_up, and an older one is offered the update', /VOICE_VERSION = 3/.test(setup) && /only when add_item's answer tells you to/.test(setup) && /tool\('size_up'/.test(setup) && !/you may offer one drink or side/.test(setup)
    && /it offers a bigger size or something to go with it, only as you choose below/.test(page));
  check('a call keeps whether the line was long when it started', /status: 'live', busy \}/.test(vr) && /let busy = false;/.test(vr));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
