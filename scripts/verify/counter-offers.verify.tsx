// Checks what's offered at the end, at the counter and the drive-thru lane (lib/counter-server 'add' with offer and
// 'sizeUp', api/counter, components/menu/OfferAsk, the counter and lane screens).
// - Size up: only for an item that offers it, the next size that can be had, for what was just added (the rest of the
//   line stays), priced from the menu; it joins a line already in that size; one tap is one change.
// - Something to go with it: marked as taken from an offer only when another line's item offers it.
// - The line the team sees: what the item offers, once each, never what's on the order already or can't be had; on the
//   order it was added to only; Size up, Add, No thanks / Done.
// - Both screens close it when anything else changes on the order, or it's sent.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-offers.verify.tsx
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const TENANT = { name: 'North Pier', timezone: 'UTC' };
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const C = await import('../../src/lib/counter-server');
  const size = { id: 'sz', name: 'Size', pick: 'one', required: true, options: [{ id: 's', name: '12 oz', price: 0 }, { id: 'm', name: '16 oz', price: 0.75 }, { id: 'l', name: '20 oz', price: 1.25 }] };
  const milk = { id: 'milk', name: 'Milk', pick: 'one', required: true, options: [{ id: 'w', name: 'Whole', price: 0 }, { id: 'o', name: 'Oat', price: 0.75 }] };
  await db.doc(T).set(TENANT);
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 4.5, totalStock: 50, choices: [size, milk], upgrades: { size: true, items: ['croissant', 'muffin'] } });
  await db.doc(`${T}/inventory/tea`).set({ type: 'refreshment', name: 'Tea', category: 'Coffee', price: 3, totalStock: 50, choices: [size] });
  await db.doc(`${T}/inventory/croissant`).set({ type: 'refreshment', name: 'Butter croissant', category: 'Pastries', price: 3.25, totalStock: 20 });
  await db.doc(`${T}/inventory/cookie`).set({ type: 'refreshment', name: 'Cookie', category: 'Pastries', price: 2, totalStock: 20 });
  const order = async (id: string) => db.doc(`${T}/counterOrders/${id}`).set({ channel: 'counter', number: 'C14', status: 'building', lines: [], subtotal: 0, tax: 0, total: 0 });
  const lines = async (id: string) => ((await get(`${T}/counterOrders/${id}`)).lines || []) as any[];
  const edit = (id: string, op: any) => C.editOrder(db, 't1', TENANT, id, op) as Promise<any>;

  console.log('size up');
  await order('o1');
  let r = await edit('o1', { action: 'add', itemId: 'latte', quantity: 1, choices: { sz: ['s'], milk: ['o'] } });
  const first = r.line.lineId;
  r = await edit('o1', { action: 'add', itemId: 'latte', quantity: 2, choices: { sz: ['s'], milk: ['o'] } });
  check('two more of the same latte join its line (the screen offers with that line)', r.line.lineId === first && (await lines('o1'))[0].quantity === 3);
  r = await edit('o1', { action: 'sizeUp', lineId: first, quantity: 2, tapKey: 'tap-size-1' });
  let ls = await lines('o1');
  check('size up: the two just added go to 16 oz, priced from the menu, marked; the one before stays, and the new line sits right after it',
    ls.length === 2 && ls[0].lineId === first && ls[0].quantity === 1 && ls[0].choicesText === '12 oz, Oat' && ls[1].quantity === 2 && ls[1].choicesText === '16 oz, Oat' && ls[1].unitPrice === 6 && ls[1].offer === 'size' && !ls[0].offer
    && r.line.lineId === ls[1].lineId && r.order.subtotal === 5.25 + 12, ls);
  r = await edit('o1', { action: 'sizeUp', lineId: first, quantity: 2, tapKey: 'tap-size-1' });
  check('…the same tap twice changes it once', (await lines('o1')).length === 2 && (await lines('o1'))[1].quantity === 2);
  r = await edit('o1', { action: 'sizeUp', lineId: first, quantity: 5 });
  ls = await lines('o1');
  check('…into a line already in that size: joined (never more than the line had)', ls.length === 1 && ls[0].quantity === 3 && ls[0].choicesText === '16 oz, Oat' && ls[0].offer === 'size', ls);
  await edit('o1', { action: 'sizeUp', lineId: ls[0].lineId, quantity: 3 });
  ls = await lines('o1');
  r = await edit('o1', { action: 'sizeUp', lineId: ls[0].lineId, quantity: 3 });
  check('…from 16 oz, the 20 oz; nobody at the biggest is offered more', ls[0].choicesText === '20 oz, Oat' && r.status === 409 && /no bigger size of Latte/.test(r.error), { ls, r });
  await order('o2');
  r = await edit('o2', { action: 'add', itemId: 'tea', quantity: 1, choices: { sz: ['s'] } });
  r = await edit('o2', { action: 'sizeUp', lineId: r.line.lineId });
  check('…not for an item that doesn’t offer a size up', r.status === 409 && (await lines('o2'))[0].choicesText === '12 oz');
  await db.doc(`${T}/inventory/latte`).set({ choices: [{ ...size, options: size.options.map((o) => (o.id === 'm' ? { ...o, soldOut: true } : o)) }, milk] }, { merge: true });
  r = await edit('o2', { action: 'add', itemId: 'latte', quantity: 1, choices: { sz: ['s'], milk: ['w'] } });
  r = await edit('o2', { action: 'sizeUp', lineId: r.line.lineId });
  check('…a size sold out is passed over for the next one', r.line && (await lines('o2')).find((l) => l.lineId === r.line.lineId)?.choicesText === '20 oz, Whole', await lines('o2'));
  await db.doc(`${T}/inventory/latte`).set({ choices: [size, milk] }, { merge: true });
  await order('o5');
  r = await edit('o5', { action: 'add', itemId: 'latte', quantity: 19, choices: { sz: ['m'], milk: ['w'] } });
  r = await edit('o5', { action: 'add', itemId: 'latte', quantity: 3, choices: { sz: ['s'], milk: ['w'] } });
  const small = r.line.lineId;
  r = await edit('o5', { action: 'sizeUp', lineId: small, quantity: 3 });
  ls = await lines('o5');
  check('…into a line that can’t take them all: said, and nothing changes (one tap is all of it or nothing)', r.status === 400 && /as many as one line takes/.test(r.error)
    && ls.find((l) => l.choicesText === '16 oz, Whole')?.quantity === 19 && ls.find((l) => l.choicesText === '12 oz, Whole')?.quantity === 3, ls);
  r = await edit('o5', { action: 'sizeUp', lineId: small, quantity: 1 });
  ls = await lines('o5');
  check('…one that fits joins it, nothing lost', !r.error && ls.find((l) => l.choicesText === '16 oz, Whole')?.quantity === 20 && ls.find((l) => l.choicesText === '12 oz, Whole')?.quantity === 2 && ls.reduce((n, l) => n + l.quantity, 0) === 22, ls);
  await db.doc(`${T}/counterOrders/o6`).set({ channel: 'counter', number: 'C15', status: 'building', subtotal: 0, tax: 0, total: 0,
    lines: Array.from({ length: 40 }, (_, k) => ({ lineId: `x${k}`, itemId: k ? 'cookie' : 'latte', name: k ? 'Cookie' : 'Latte', quantity: k ? 1 : 2, unitPrice: 2, choices: k ? [] : [{ groupId: 'sz', group: 'Size', optionId: 's', option: '12 oz', price: 0 }, { groupId: 'milk', group: 'Milk', optionId: 'w', option: 'Whole', price: 0 }], choicesText: k ? `n${k}` : '12 oz, Whole', makeSeconds: 60 })) });
  r = await edit('o6', { action: 'sizeUp', lineId: 'x0', quantity: 1 });
  check('…an order with no room for another line: a part can’t split off', r.status === 400 && /big order/.test(r.error) && (await lines('o6')).length === 40);
  r = await edit('o6', { action: 'sizeUp', lineId: 'x0', quantity: 2 });
  check('…but all of it can move', !r.error && (await lines('o6')).length === 40 && (await lines('o6'))[0].choicesText === '16 oz, Whole', r);
  r = await edit('o2', { action: 'sizeUp', lineId: 'nope' });
  check('…a line that isn’t on the order', r.status === 404);
  await db.doc(`${T}/counterOrders/o2`).set({ status: 'sent' }, { merge: true });
  r = await edit('o2', { action: 'sizeUp', lineId: (await lines('o2'))[0].lineId });
  check('…not once it’s gone to the kitchen', r.status === 409 && /gone to the kitchen/.test(r.error));

  console.log('something to go with it');
  await order('o3');
  await edit('o3', { action: 'add', itemId: 'latte', quantity: 1, choices: { sz: ['s'], milk: ['w'] } });
  r = await edit('o3', { action: 'add', itemId: 'croissant', quantity: 1, offer: 'item' });
  check('taken from what the latte offers: marked', r.line.offer === 'item' && (await lines('o3'))[1].offer === 'item');
  r = await edit('o3', { action: 'add', itemId: 'cookie', quantity: 1, offer: 'item' });
  check('…something nothing on the order offers isn’t marked (a stale or made-up claim)', !r.line.offer && r.line.unitPrice === 2);
  await order('o4');
  r = await edit('o4', { action: 'add', itemId: 'croissant', quantity: 1, offer: 'item' });
  check('…nor on an order with nothing else on it', !r.line.offer);
  r = await edit('o4', { action: 'add', itemId: 'croissant', quantity: 1 });
  check('…the price is the menu’s either way', r.line.unitPrice === 3.25 && r.line.quantity === 2);

  console.log('the line the team sees');
  const { renderToStaticMarkup } = await import('react-dom/server'); const React = await import('react');
  const { OfferAsk } = await import('../../src/components/menu/OfferAsk');
  const menu: any[] = [{ id: 'latte', name: 'Latte', choices: [size, milk], upgrades: { size: true, items: ['croissant', 'muffin'] }, price: 4.5 },
    { id: 'croissant', name: 'Butter croissant', choices: [], price: 3.25 }, { id: 'muffin', name: 'Blueberry muffin', choices: [], price: 3.5, from: false }];
  const just: any = { orderId: 'o9', itemId: 'latte', name: 'Latte', picks: { sz: ['s'], milk: ['o'] }, quantity: 2, lineId: 'L1', took: false, sized: false };
  const view = (j: any, o: any = {}) => renderToStaticMarkup(React.createElement(OfferAsk as any, { just: j, orderId: 'o9', item: menu.find((m) => m.id === j?.itemId), find: (id: string) => menu.find((m) => m.id === id),
    have: () => false, price: (m: any) => m.price, busy: false, onSizeUp: () => {}, onAdd: () => {}, onClose: () => {}, ...o }));
  const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let h = view(just);
  check('just added: what to offer with the latte, the size up for the two just added, what goes with it, and No thanks', /Offer with the latte/.test(text(h)) && /16 oz instead \+\$1\.50/.test(text(h)) && /Butter croissant \$3\.25/.test(text(h)) && /Blueberry muffin \$3\.50/.test(text(h))
    && /aria-label="Size up to 16 oz, \$1\.50 more"/.test(h) && /aria-label="Add Butter croissant, \$3\.25"/.test(h) && />No thanks</.test(h) && /role="group"/.test(h), text(h));
  h = view({ ...just, sized: true, took: true });
  check('…once the size is taken: what goes with it, and Done', /Anything with it\?/.test(text(h)) && !/instead/.test(text(h)) && />Done</.test(h));
  h = view(just, { have: (id: string) => id === 'croissant', find: (id: string) => (id === 'muffin' ? undefined : menu.find((m) => m.id === id)) });
  check('…never what’s on the order already, or can’t be had now', !/croissant|muffin/i.test(text(h)) && /16 oz instead/.test(text(h)));
  const none = (x: string) => x === '<div aria-live="polite"></div>';
  check('…nothing to offer: no line at all (the biggest size, nothing else set), just the place it’s read out from', none(view({ ...just, picks: { sz: ['l'] } }, { have: () => true })));
  check('…only on the order it was added to', none(view({ ...just, orderId: 'other' })) && none(view(null)));
  check('…read out as it appears (the wrapper stays), labelled by a heading that doesn’t change with the line', /^<div aria-live="polite"><div role="group" aria-labelledby="offer-ask"/.test(h) && /id="offer-ask"/.test(h));
  check('names: “the blueberry muffin”; one with other capitals is kept as it is', /Offer with the blueberry muffin/.test(text(view({ ...just, name: 'Blueberry muffin' }))) && /Offer with the BLT/.test(text(view({ ...just, name: 'BLT' })))
    && /Offer with the Caesar Salad/.test(text(view({ ...just, name: 'Caesar Salad' }))));

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'); const lane = src('src/app/drive-thru/[tenantId]/page.tsx');
  for (const [name, s] of [['counter', counter], ['lane', lane]] as const) {
    check(`${name}: shown under the order while it’s being taken, with the add’s line and the menu’s prices`, /<OfferAsk just=\{just\} orderId=\{order\.id\}/.test(s) && /onSizeUp=\{sizeUp\} onAdd=\{takeOffer\}/.test(s) && /lineId: d\.line\.lineId, took: false, sized: false/.test(s));
    check(`${name}: size up for what was just added; something with choices opens its choices first, still as an offer`, /action: 'sizeUp', orderId: order\.id, lineId: just\.lineId, quantity: just\.quantity/.test(s) && /setChoiceOffer\(true\); setChoiceFor\(m\)/.test(s) && /add\(choiceFor, p, q, choiceOffer \? 'item' : undefined\)/.test(s));
    check(`${name}: closed when anything else changes on the order, or it’s sent`, /if \(!order\) return; setJust\(null\);/.test(s) && (/setJust\(null\); void act\('send'/.test(s) || /\(setJust\(null\), act\('send'/.test(s)));
    check(`${name}: a sized-up line says so while the order is being taken, and another order picked closes it`, />Sized up</.test(s) && (/setJust\(null\); \}, \[order\?\.id\]\)/.test(s) || /setJust\(null\); if \(order && nameFor/.test(s)));
  }
  const rt = src('src/app/api/counter/route.ts');
  check('the screens’ route: size up is the lane’s own action (its order checked as this screen’s), and an add says which line it went on', /'add', ('oneOff', )?'sizeUp', 'remove', 'qty', ('note', 'allergy', )?'name', 'send'/.test(rt) && /\['add', ('oneOff', )?'sizeUp', 'remove', 'qty', ('note', 'allergy', )?'name', 'send', ('scan', 'codeOn', )?'paid'/.test(rt) && /line: r\.line \? \{ lineId: r\.line\.lineId \} : null/.test(rt) && /offer: b\.offer/.test(rt));
  const mine = src('src/components/menu/OfferAsk.tsx');
  check('in the app’s own words and look', !/uppercase|font-black|\{\/\*| · |call us|contact us/i.test(mine) && !/min-h-\[(?:[0-3]\d|4[0-3])px\]/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
