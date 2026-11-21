// Checks allergies and notes on quick-service orders (design board "Allergies and notes on every food order";
// lib/order-allergy, lib/counter-server editOrder note / setAllergy / sendOrder, api/counter 'note' and 'allergy',
// lib/counter-ahead placeAhead, lib/kiosk kioskPlace).
// - The order's allergies (the major ones, another in their words, severe) go on every kitchen ticket, with what the
//   menu says the dish contains of them; a dish's note goes on its own tickets only.
// - A note is part of the line: the same dish with another note is a line of its own.
// - Allergies and notes are set while the order is being taken; once it's sent, the kitchen is told instead.
// - A dish nobody has filled in its allergens for is never said to have none.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-allergy.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') { class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }), retrieve: async () => ({ id: 'pi_x' }) }; refunds = { create: async () => ({}) }; } return Object.assign(StripeMock, { default: StripeMock }); }
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (p: any) => p };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null, limitByKey: async () => null });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const A = await import('../../src/lib/order-allergy');
  console.log('the rules');
  check('allergies: the major ones in the menu’s order, another in their words, severe; nothing picked is none', JSON.stringify(A.cleanOrderAllergy({ keys: ['sesame', 'peanuts', 'bogus'], other: '  mustard <b> ', severe: true })) === JSON.stringify({ keys: ['peanuts', 'sesame'], other: 'mustard b', severe: true })
    && A.cleanOrderAllergy({ keys: [], other: ' ' }) === null && A.cleanOrderAllergy(null) === null);
  check('…in words for a chip', A.allergyWords({ keys: ['peanuts', 'treenuts'], other: 'Mustard', severe: true }) === 'Tree nuts, Peanuts, Mustard, severe' || A.allergyWords({ keys: ['treenuts', 'peanuts'], other: 'Mustard', severe: true }) === 'Tree nuts, Peanuts, Mustard, severe');
  check('a dish’s note: tidied and kept short; empty is none', A.cleanLineNote('  no\u0000 onions  ') === 'no onions' && A.cleanLineNote('   ') === null && (A.cleanLineNote('x'.repeat(300)) || '').length === A.NOTE_MAX);
  check('what a dish contains of their allergens; never “none” when nobody filled it in', JSON.stringify(A.dishConflict({ allergens: ['peanuts', 'soy'], allergensSet: true }, { keys: ['peanuts'] })) === '["peanuts"]'
    && A.dishConflict({ allergens: [], allergensSet: false }, { keys: ['peanuts'] }) === 'unknown' && A.dishConflict({ allergens: null }, { keys: ['milk'] }) === 'unknown' && JSON.stringify(A.dishConflict({ allergens: ['soy'] }, { keys: ['milk'] })) === '[]');
  check('…said for the team and for a guest', A.conflictWords(['peanuts'], { keys: ['peanuts'] }) === 'Contains peanuts' && /check peanuts with the kitchen/.test(A.conflictWords('unknown', { keys: ['peanuts'] })) && /The kitchen sees your allergy/.test(A.conflictWords('unknown', { keys: ['peanuts'] }, 'guest')));
  check('what a guest said, in their words: every part kept (a major allergen, or as they said it)', JSON.stringify(A.allergyFromWords(['peanuts and kiwi'])) === JSON.stringify({ keys: ['peanuts'], other: 'kiwi', severe: false })
    && JSON.stringify(A.allergyFromWords(['shellfish/sesame', 'Kiwi'], true)) === JSON.stringify({ keys: ['shellfish', 'sesame'], other: 'Kiwi', severe: true }) && A.allergyFromWords(['  ']) === null);
  check('two sets as one: each once, severe if either, and never cut off', JSON.stringify(A.mergeAllergy({ keys: ['milk'], other: 'Mustard', severe: false }, { keys: ['peanuts'], other: 'mustard, kiwi', severe: true })) === JSON.stringify({ keys: ['milk', 'peanuts'], other: 'Mustard, kiwi', severe: true })
    && (A.mergeAllergy({ keys: ['peanuts'], other: 'x'.repeat(150), severe: true }, { keys: ['milk'], other: 'y'.repeat(100), severe: false }) as any)?.cut === true
    && JSON.stringify((A.mergeAllergy({ keys: ['peanuts'], other: 'x'.repeat(150), severe: true }, { keys: ['milk'], other: 'y'.repeat(100), severe: false }) as any).keys) === '["milk","peanuts"]'
    && (A.mergeAllergy({ keys: ['peanuts'], other: 'x'.repeat(150), severe: true }, { keys: ['milk'], other: 'y'.repeat(100), severe: false }) as any).severe === true);
  check('…one long phrase said in one go: never saved cut short', A.allergyFromWords(['I had a bad reaction last time to some kind of unusual tropical fruit blend']) === 'too_long');
  check('…what a guest said that’s more than an order keeps: never saved cut short', A.allergyFromWords(['peanuts', 'k'.repeat(55), 'm'.repeat(55), 'n'.repeat(55), 'o'.repeat(55)]) === 'too_long');
  check('a menu’s contains line', A.containsLine({ allergens: ['milk', 'wheat'], allergensSet: true }) === 'Contains milk and wheat' && A.containsLine({ allergens: [], allergensSet: true }) === 'None of the major allergens listed' && A.containsLine({ allergens: null }) === null);

  await db.doc(T).set({ name: 'Corner Cafe', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });
  await db.doc(`${T}/inventory/padthai`).set({ type: 'refreshment', name: 'Pad thai', category: 'Mains', price: 14.5, totalStock: 50, makeSeconds: 300, allergens: ['peanuts', 'eggs', 'soy', 'fish'] });
  await db.doc(`${T}/inventory/rolls`).set({ type: 'refreshment', name: 'Spring rolls', category: 'Sides', price: 6, totalStock: 40, makeSeconds: 120 });
  const { POST } = await import('../../src/app/api/counter/route');
  const P = (b: any) => POST(req({ tenantId: 't1', channel: 'counter', ...b }));

  console.log('at the counter');
  const c1: any = (await P({ action: 'car', carKey: 'c1' })).body;
  let r: any = await P({ action: 'add', orderId: c1.orderId, itemId: 'padthai', tapKey: 'a1', note: 'No bean sprouts' });
  check('a dish added with a note', r.body.ok && r.body.order.lines[0].note === 'No bean sprouts', r.body);
  r = await P({ action: 'add', orderId: c1.orderId, itemId: 'padthai', tapKey: 'a2' });
  check('…the same dish with no note is a line of its own', r.body.ok && r.body.order.lines.length === 2 && !r.body.order.lines[1].note, r.body.order?.lines);
  r = await P({ action: 'add', orderId: c1.orderId, itemId: 'padthai', tapKey: 'a3', note: 'no bean sprouts ' });
  check('…and with the same note, more of the line with that note', r.body.ok && r.body.order.lines.length === 2 && r.body.order.lines[0].quantity === 2, r.body.order?.lines);
  r = await P({ action: 'add', orderId: c1.orderId, itemId: 'rolls', tapKey: 'a4' });
  const rollLine = r.body.order.lines.find((l: any) => l.itemId === 'rolls');
  r = await P({ action: 'note', orderId: c1.orderId, lineId: rollLine.lineId, note: 'Extra sauce', tapKey: 'n1' });
  check('a note added to a line already on the order', r.body.ok && r.body.order.lines.find((l: any) => l.itemId === 'rolls').note === 'Extra sauce', r.body);
  const plain = r.body.order.lines.find((l: any) => l.itemId === 'padthai' && !l.note);
  r = await P({ action: 'remove', orderId: c1.orderId, lineId: plain.lineId, tapKey: 'rm1' });
  r = await P({ action: 'allergy', orderId: c1.orderId, allergy: { keys: ['peanuts'], other: 'Mustard', severe: true } });
  check('the guest’s allergies on the order', r.body.ok && JSON.stringify(r.body.allergy.keys) === '["peanuts"]' && r.body.allergy.other === 'Mustard' && r.body.allergy.severe === true && r.body.allergy.by === 'Ana Ruiz', r.body);
  const lane: any = (await P({ action: 'lane' })).body;
  check('…shown with the order on the counter', lane.orders[c1.orderId]?.allergy?.severe === true && lane.menu.find((m: any) => m.id === 'padthai')?.allergensSet === true, lane.orders[c1.orderId]?.allergy);
  r = await P({ action: 'send', orderId: c1.orderId });
  const tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId);
  const pad = tix.find((t: any) => t.menuItemId === 'padthai'); const roll = tix.find((t: any) => t.menuItemId === 'rolls');
  check('sent: every ticket carries the allergies, severe', r.body.ok && tix.length === 2 && tix.every((t: any) => Array.isArray(t.allergies) && t.allergies.some((a: any) => a.name === 'Peanuts' && a.severity === 'severe') && t.allergies.some((a: any) => a.name === 'Mustard')), tix.map((t: any) => t.allergies));
  check('…what the menu says the dish contains of them (and nothing claimed for a dish with no list)', JSON.stringify(pad.contains) === '["Peanuts"]' && JSON.stringify(roll.contains || []) === '[]', [pad.contains, roll.contains]);
  check('…each dish’s note on its own ticket only', pad.note === 'No bean sprouts' && roll.note === 'Extra sauce', [pad.note, roll.note]);
  const K = await import('../../src/lib/kitchen');
  check('…and the kitchen shows it big and asks for Allergy noted', K.allergyFlags(pad).severe === true && K.needsAllergyNote({ ...pad, col: 'kdsTickets' } as any) === true);
  r = await P({ action: 'allergy', orderId: c1.orderId, allergy: { keys: ['milk'] } });
  const late = await P({ action: 'note', orderId: c1.orderId, lineId: rollLine.lineId, note: 'x', tapKey: 'n2' });
  check('once it’s sent: an allergy said now is added to it (with what was there), a dish’s note isn’t changed', r.body.ok && r.body.tickets === 2 && r.body.allergy.keys.join() === 'milk,peanuts' && r.body.allergy.other === 'Mustard' && late.status === 409, [r.body, late.body]);
  for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId)) check(`…${t.menuItemName}: milk too, to be noted again`, t.allergies.some((a: any) => a.name === 'Milk') && !t.allergyNotedAt);
  const c2: any = (await P({ action: 'car', carKey: 'c2' })).body;
  await P({ action: 'add', orderId: c2.orderId, itemId: 'rolls', tapKey: 'b1' });
  await P({ action: 'allergy', orderId: c2.orderId, allergy: { keys: ['milk'] } });
  r = await P({ action: 'allergy', orderId: c2.orderId, allergy: { keys: [] } });
  await P({ action: 'send', orderId: c2.orderId });
  check('allergies taken off before sending: none on the tickets', r.body.ok && r.body.allergy === null && (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c2.orderId).every((t: any) => !t.allergies || !t.allergies.length));

  console.log('handed over');
  r = await P({ action: 'paid', orderId: c1.orderId, method: 'card' });
  const paidOk = r.body.ok;
  r = await P({ action: 'move', carId: c1.carId, to: 'gone' });
  check('handed over before the kitchen noted the allergy: refused, nothing handed over', paidOk && r.status === 409 && r.body.code === 'allergy' && /hasn’t noted/.test(r.body.error)
    && (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId).every((t: any) => t.status !== 'delivered') && (await get(`${T}/driveThruCars/${c1.carId}`)).stage !== 'gone', r.body);
  for (const t of (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c1.orderId)) await db.doc(`${T}/kdsTickets/${t.id}`).set({ allergyNotedAt: new Date().toISOString(), allergyNotedBy: 'Grill', status: 'ready' }, { merge: true });
  r = await P({ action: 'move', carId: c1.carId, to: 'gone' });
  check('…once it’s noted: handed over', r.body.ok && (await get(`${T}/driveThruCars/${c1.carId}`)).stage === 'gone', r.body);
  const c3: any = (await P({ action: 'car', carKey: 'c3' })).body;
  await P({ action: 'add', orderId: c3.orderId, itemId: 'rolls', tapKey: 'c3a', note: 'no peanuts please' });
  await P({ action: 'send', orderId: c3.orderId }); await P({ action: 'paid', orderId: c3.orderId, method: 'card' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'staff', isActive: true });
  await db.doc(`${T}/staff/rosa`).set({ name: 'Rosa Diaz', role: 'manager', isActive: true, pin: '1357' });
  r = await P({ action: 'move', carId: c3.carId, to: 'gone' });
  const noPin: any = await P({ action: 'move', carId: c3.carId, to: 'gone', allergyOverride: true });
  check('an allergy only in a note counts too; a manager’s okay is asked for', r.status === 409 && r.body.code === 'allergy' && noPin.status === 403 && noPin.body.needsManager === true, [r.body, noPin.body]);
  r = await P({ action: 'move', carId: c3.carId, to: 'gone', allergyOverride: true, pin: '1357' });
  check('…handed over with a manager’s PIN', r.body.ok && (await get(`${T}/driveThruCars/${c3.carId}`)).stage === 'gone', r.body);
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager', job: 'manager' });

  console.log('said at the window, after it was sent');
  const c4: any = (await P({ action: 'car', carKey: 'c4' })).body;
  await P({ action: 'add', orderId: c4.orderId, itemId: 'padthai', tapKey: 'c4a' }); await P({ action: 'add', orderId: c4.orderId, itemId: 'rolls', tapKey: 'c4b' });
  await P({ action: 'send', orderId: c4.orderId });
  const t4 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c4.orderId);
  await db.doc(`${T}/kdsTickets/${t4.find((t: any) => t.menuItemId === 'rolls').id}`).set({ status: 'delivered' }, { merge: true });
  r = await P({ action: 'allergy', orderId: c4.orderId, allergy: { keys: ['peanuts'], severe: true } });
  const t4b = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c4.orderId); const pad4 = t4b.find((t: any) => t.menuItemId === 'padthai'); const roll4 = t4b.find((t: any) => t.menuItemId === 'rolls');
  check('added after it was sent: on what’s still being made (with what the dish contains), the kitchen asked to note it again', r.body.ok && r.body.tickets === 1 && pad4.allergies?.some((a: any) => a.name === 'Peanuts' && a.severity === 'severe') && JSON.stringify(pad4.contains) === '["Peanuts"]' && !pad4.allergyNotedAt && !roll4.allergies?.length, { r: r.body, pad4, roll4 });
  r = await P({ action: 'allergy', orderId: c4.orderId, allergy: { keys: [] } });
  check('…never taken off once the kitchen has it', r.status === 409, r.body);
  r = await P({ action: 'allergy', orderId: c4.orderId, allergy: { keys: ['peanuts'] } });
  check('…the same again: on it already, nothing changed', r.body.ok && r.body.already === true && r.body.tickets === 0, r.body);
  await db.doc(`${T}/kdsTickets/${pad4.id}`).set({ status: 'ready', readyAt: new Date().toISOString(), allergyNotedAt: new Date().toISOString() }, { merge: true });
  r = await P({ action: 'allergy', orderId: c4.orderId, allergy: { keys: ['sesame'] } });
  const pad4b = await get(`${T}/kdsTickets/${pad4.id}`);
  check('…one already ready goes back to being made (not handed over, taken out or delivered until it’s noted and ready again)', r.body.ok && pad4b.status === 'in_progress' && !pad4b.allergyNotedAt && pad4b.allergies.some((a: any) => a.name === 'Sesame') && pad4b.allergies.some((a: any) => a.name === 'Peanuts'), pad4b);

  console.log('added at the speaker to an order placed ahead');
  await db.doc(`${T}/counterOrders/ahead1`).set({ id: 'ahead1', number: 'A9', channel: 'ahead', status: 'sent', paidAt: new Date().toISOString(), allergy: { keys: ['milk'], other: null, severe: false, by: 'The guest', at: new Date().toISOString() } });
  const c5: any = (await P({ action: 'car', carKey: 'c5' })).body;
  await db.doc(`${T}/driveThruCars/${c5.carId}`).set({ aheadId: 'ahead1', aheadNumber: 'A9' }, { merge: true });
  await P({ action: 'add', orderId: c5.orderId, itemId: 'rolls', tapKey: 'c5a' });
  await P({ action: 'allergy', orderId: c5.orderId, allergy: { keys: ['soy'] } });
  await P({ action: 'send', orderId: c5.orderId });
  const t5 = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === c5.orderId);
  check('the guest’s allergy on the order placed ahead goes on what’s added at the speaker, with any said here', t5.length === 1 && t5[0].allergies?.some((a: any) => a.name === 'Milk') && t5[0].allergies?.some((a: any) => a.name === 'Soy') && (await get(`${T}/counterOrders/${c5.orderId}`)).allergy?.from === 'ahead', t5.map((t: any) => t.allergies));

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'); const parts = src('src/components/menu/OrderAllergy.tsx');
  const order = src('src/app/order/[tenantId]/page.tsx'); const kiosk = src('src/app/drive-thru/[tenantId]/kiosk/page.tsx'); const lanePage = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('the parts: allergy chips, another allergy, severe, and a note for a dish', /Any allergies\?/.test(parts) && /Another allergy/.test(parts) && /It’s severe/.test(parts) && /A note for the kitchen/.test(parts));
  check('the counter and the drive-thru: allergies for the order and a note on a line', [page, lanePage].every((s) => /action: 'allergy'/.test(s) && /action: 'note'/.test(s) && /AllergySheet/.test(s)));
  check('ordering ahead and the kiosk: allergies before paying, a note on a dish, what a dish contains', [order, kiosk].every((s) => /AllergyChips/.test(s) && /allergy:/.test(s) && /containsLine/.test(s) && /note:/.test(s)));
  const voice = src('src/lib/drive-thru-voice-setup.ts'); const asst = src('src/app/api/counter/assistant/route.ts');
  check('the voice assistant saves an allergy said at the speaker, and never says a dish is safe', /tool\('set_allergy'/.test(voice) && /Never say a dish is safe/.test(voice) && /name === 'set_allergy'/.test(asst) && /allergyFromWords/.test(asst));
  check('handing over: a manager’s PIN when the kitchen hasn’t noted the allergy', /allergyOverride: true/.test(page) && /allergyOverride: true/.test(lanePage) && /hasn’t noted/.test(page));
  check('the new screens keep the house style', ![page, parts, order, kiosk, lanePage].some((s) => /\buppercase\b|font-black/.test(s)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
