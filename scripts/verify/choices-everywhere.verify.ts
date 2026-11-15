// Checks choices everywhere (round 26, design canvas "Choices everywhere"): lib/menu-choices (picks kept on a line, one
// key for the same choices in any order, an order already made settled even if a choice sold out since, a line's
// choices priced from the menu now or as ordered when a choice is gone), lib/table-tab (a tab line and its ticket
// carry the choices and their price), lib/kitchen and lib/printing (each choice on its own line of a printed ticket),
// lib/table-bill (paying at the table: each line with choices its own item, at the menu's price), api/checkout/complete
// (a desk sale's choices checked against the menu; a table's line read from its tab, once; the kitchen ticket says
// them), and the screens (the table's tab and the front desk ask before adding; the desk carries a tab line's choices).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/choices-everywhere.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
class StripeMock { paymentIntents = { create: async () => ({ id: 'pi_x' }), retrieve: async () => ({ id: 'pi_x' }) }; refunds = { create: async () => ({}) }; }
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const r2 = (n: number) => Math.round(n * 100) / 100;

const burger: any = { id: 'burger', name: 'Burger', type: 'refreshment', price: 15, msrp: 15, totalStock: 0, choices: [
  { id: 'cook', name: 'Cook it', pick: 'one', required: true, options: [{ id: 'mr', name: 'Medium rare' }, { id: 'md', name: 'Medium' }, { id: 'wd', name: 'Well done' }] },
  { id: 'side', name: 'Side', pick: 'one', required: true, options: [{ id: 'fr', name: 'Fries' }, { id: 'sl', name: 'Salad', price: 1.5 }] },
  { id: 'ex', name: 'Extras', pick: 'any', required: false, max: 3, options: [{ id: 'bc', name: 'Bacon', price: 2.5 }, { id: 'av', name: 'Avocado', price: 2, soldOut: true }] }] };
const latte: any = { id: 'latte', name: 'Latte', type: 'refreshment', price: 4.25, msrp: 4.25, totalStock: 0, choices: [
  { id: 'size', name: 'Size', pick: 'one', required: true, options: [{ id: 'sm', name: 'Small' }, { id: 'lg', name: 'Large', price: 0.75 }] },
  { id: 'milk', name: 'Milk', pick: 'one', required: false, options: [{ id: 'oat', name: 'Oat', price: 0.75 }] }] };
const fries: any = { id: 'fries', name: 'Fries', type: 'refreshment', price: 6, msrp: 6, totalStock: 0 };

(async () => {
  const MC = await import('../../src/lib/menu-choices');
  console.log('choices on a line');
  check('picks kept on a line: only real ids, nothing else', JSON.stringify(MC.cleanPicks({ cook: ['md', 'md', 'x y'], side: 'fr', '': ['a'], ex: [] })) === '{"cook":["md"]}' && JSON.stringify(MC.cleanPicks(['md'])) === '{}');
  check('the same choices in any order are the same line', MC.picksKey({ ex: ['bc'], cook: ['md'] }) === MC.picksKey({ cook: ['md'], ex: ['bc'] }) && MC.picksKey({ cook: ['md'] }) !== MC.picksKey({ cook: ['wd'] }));
  const p1 = MC.priceChoices(burger, { cook: ['md'], side: ['fr'], ex: ['bc'] });
  check('picked now: priced from the menu, the kitchen’s words in the menu’s order', p1.ok && p1.extra === 2.5 && p1.text === 'Medium, Fries, Bacon', p1);
  check('…a sold-out extra can’t be picked, and a must-make choice can’t be left out', !MC.priceChoices(burger, { cook: ['md'], side: ['fr'], ex: ['av'] }).ok && /Choose a cook it/.test((MC.priceChoices(burger, { side: ['fr'] }) as any).error));
  const s1 = MC.settleChoices(burger, { cook: ['md'], side: ['sl'], ex: ['av'] });
  check('…but something already ordered is settled even if a choice sold out since', s1.ok && s1.extra === 3.5 && s1.text === 'Medium, Salad, Avocado', s1);
  check('the picks behind kept lines', JSON.stringify(MC.picksOf((p1 as any).lines)) === JSON.stringify({ cook: ['md'], side: ['fr'], ex: ['bc'] }));
  const lc = MC.lineChoices({ ...burger, choices: burger.choices.map((g: any) => g.id === 'ex' ? { ...g, options: [{ id: 'bc', name: 'Bacon', price: 3 }] } : g) }, { picks: { cook: ['md'], side: ['fr'], ex: ['bc'] } });
  check('a tab line’s choices: from the menu as it is now', lc?.extra === 3 && lc?.text === 'Medium, Fries, Bacon', lc);
  const gone = MC.lineChoices({ ...burger, choices: burger.choices.filter((g: any) => g.id !== 'ex') }, { picks: { cook: ['md'], side: ['fr'], ex: ['bc'] }, choices: (p1 as any).lines });
  check('…a choice taken off the menu since goes at what it was when it was ordered', gone?.extra === 2.5 && gone?.text === 'Medium, Fries, Bacon', gone);
  const forged = MC.lineChoices({ ...burger, choices: [] }, { picks: { x: ['y'] }, choices: [{ groupId: 'x', group: 'X', optionId: 'y', option: 'Discount', price: -50 }] });
  check('…what a line kept is never less than nothing (a screen wrote it)', forged?.extra === 0, forged);
  check('…none on the line: none', MC.lineChoices(burger, { picks: {} }) === null && MC.lineChoices(fries, {}) === null && MC.hasChoices(burger) && !MC.hasChoices(fries));

  console.log('a table’s tab');
  const TT = await import('../../src/lib/table-tab');
  const ch = { picks: { cook: ['md'], side: ['fr'], ex: ['bc'] }, lines: (p1 as any).lines, text: 'Medium, Fries, Bacon', extra: 2.5 };
  const line = await TT.addToTab({} as any, 't1', 'v9', { tableName: 'Table 12', guestName: 'Marsh' }, { id: 'burger', type: 'product', name: 'Burger', price: 15, station: 'Grill' }, { by: 'Sam Lee', lineId: 'ln1abc', seat: '2', choice: ch });
  const tk: any = webMock.read('tenants/t1/kdsTickets/tab_v9_ln1abc');
  check('the line carries its choices, and its price includes them', line.price === 17.5 && line.listPrice === 17.5 && line.choicesText === 'Medium, Fries, Bacon' && JSON.stringify(line.picks) === JSON.stringify(ch.picks) && (line.choices || []).length === 3, line);
  check('…the kitchen’s ticket says them', tk?.choicesText === 'Medium, Fries, Bacon' && tk.choices.length === 3, tk);
  const plain = await TT.addToTab({} as any, 't1', 'v9', { tableName: 'Table 12', guestName: 'Marsh' }, { id: 'fries', type: 'product', name: 'Fries', price: 6 }, { by: 'Sam Lee', lineId: 'ln2abc' });
  check('…an item with none is as before', plain.price === 6 && plain.choicesText === undefined && !webMock.read('tenants/t1/kdsTickets/tab_v9_ln2abc')?.choicesText);
  const K = await import('../../src/lib/kitchen'); const PR = await import('../../src/lib/printing');
  const view: any = K.ticketFrom(tk, 'kdsTickets');
  check('the kitchen screen reads them together; each on its own for a printed ticket', view.choices === 'Medium, Fries, Bacon' && view.choiceList.join('|') === 'Medium|Fries|Bacon');
  check('…an older order with only the words keeps them as one line', (K.ticketFrom({ choicesText: 'Large, Oat' }, 'refreshmentRequests') as any).choiceList.join('|') === 'Large, Oat');
  const slip = PR.ticketDoc([view], { tz: null, at: new Date().toISOString(), station: null, buzz: false });
  const item: any = slip.blocks.find((b: any) => b.k === 'item');
  check('the printed ticket: each choice on its own line, then the seat', item?.sub.join('|') === 'Medium|Fries|Bacon|Seat 2', item);

  console.log('paying at the table');
  const TB = await import('../../src/lib/table-bill');
  const cat = new Map<string, any>([['burger', burger], ['latte', latte], ['fries', fries]]);
  const catalog = { item: (id: string) => cat.get(id) || null, price: (x: any) => Number(x.msrp), name: (x: any) => x.name };
  const tenant: any = { name: 'Linden', businessType: 'hospitality', salesTax: { configured: true, productsPct: 0 } };
  const L = (id: string, itemId: string, seat: number | null, o: any = {}) => ({ lineId: id, itemId, itemType: 'product', name: cat.get(itemId)?.name, price: 1, quantity: 1, seat, kdsId: `k_${id}`, firedAt: '2026-11-14T20:00:00Z', ...o });
  const visit: any = { tableName: '12', tab: [
    L('a', 'burger', 1, { picks: { cook: ['md'], side: ['fr'], ex: ['bc'] }, choices: (p1 as any).lines, choicesText: 'Medium, Fries, Bacon' }),
    L('b', 'latte', 2, { picks: { size: ['lg'], milk: ['oat'] } }), L('c', 'fries', null), L('d', 'fries', null),
    L('e', 'latte', 2, { picks: { size: ['lg'] }, comp: { amount: 2, approvalId: 'ap1' } })] };
  const bill = TB.billFrom('v1', visit, catalog, { tenant, client: null, memberships: [] });
  check('each line with choices at the menu’s price with them, its own item, read from its line at the desk', bill.subtotal === r2(17.5 + 5.75 + 12 + 3) && bill.lines.find((l) => l.lineId === 'a')!.price === 17.5 && bill.lines.find((l) => l.lineId === 'a')!.name === 'Burger, Medium, Fries, Bacon'
    && bill.items.some((i: any) => i.id === 'burger~tab~a' && i.itemId === 'burger' && i.tabLineId === 'a' && i.tabVisitId === 'v1' && i.price === 17.5) && bill.items.some((i: any) => i.id === 'fries' && i.quantity === 2), bill);
  const old = TB.billFrom('v1', { tab: [L('o', 'latte', null)] }, catalog, { tenant, client: null, memberships: [] });
  check('…a line rung in before the item had choices is its own item too, at its plain price (not asked for them now)', old.items.length === 1 && (old.items[0] as any).tabLineId === 'o' && old.items[0].price === 4.25, old.items);
  check('…a comp comes off the price with its choices', bill.lines.find((l) => l.lineId === 'e')!.price === 3 && bill.items.some((i: any) => i.compLineId === 'e' && i.price === 3));

  console.log('the front desk');
  await db.doc(T).set({ ...tenant, modules: { hospitality: true } });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez' });
  for (const [id, x] of cat) await db.doc(`${T}/inventory/${id}`).set(x);
  const CO = await import('../../src/app/api/checkout/complete/route');
  let r: any = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'latte~ch~x', itemId: 'latte', picks: { size: ['lg'], milk: ['oat'] }, type: 'product', quantity: 2, price: 0.01, name: 'Latte' }], expectedTotal: 11.5, payment: { method: 'cash', amountTendered: 11.5 } }));
  const rc: any = (await all(`${T}/receipts`))[0]; const pos: any = (await all(`${T}/kdsTickets`)).find((t: any) => t.source === 'pos');
  check('a latte with choices: priced by the server from the menu (never the screen’s price), named with them', r.status === 200 && r2(r.body.total) === 11.5, { s: r.status, b: r.body });
  check('…the kitchen’s ticket says them', pos?.choicesText === 'Large, Oat' && (pos.choices || []).length === 2 && pos.menuItemId === 'latte', pos);
  check('…and the receipt', JSON.stringify(rc || {}).includes('Latte, Large, Oat'), rc && rc.lines);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'burger~ch~y', itemId: 'burger', picks: { cook: ['md'], side: ['fr'], ex: ['av'] }, type: 'product', quantity: 1, price: 17, name: 'Burger' }], expectedTotal: 19, payment: { method: 'cash', amountTendered: 19 } }));
  check('a sold-out choice is refused at the desk', r.status === 400 && /Avocado is sold out/.test(r.body.error), r.body);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'burger~ch~z', itemId: 'burger', picks: { size: ['lg'] }, type: 'product', quantity: 1, price: 15, name: 'Burger' }], expectedTotal: 15, payment: { method: 'cash', amountTendered: 15 } }));
  check('…and one that isn’t on the item', r.status === 400 && /isn’t on this item/.test(r.body.error), r.body);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'latte', type: 'product', quantity: 1, price: 4.25, name: 'Latte' }], expectedTotal: 4.25, payment: { method: 'cash', amountTendered: 4.25 } }));
  check('…an item with a choice it must have isn’t sold without it (scanned, say)', r.status === 400 && /needs a size/.test(r.body.error), r.body);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', items: [{ id: 'fries', type: 'product', quantity: 1, price: 6, name: 'Fries' }], expectedTotal: 6, payment: { method: 'cash', amountTendered: 6 } }));
  check('…one with none sells as before', r.status === 200, r.body);

  console.log('checking out a table’s tab at the desk');
  await db.doc(`${T}/appointments/v1`).set({ ...visit, isTable: true, partyId: 'p1', clientId: 'c1', clientName: 'Marsh', status: 'servicing', source: 'host' });
  const tabItems = (o: any = {}) => [{ id: 'burger~tab~a', itemId: 'burger', tabLineId: 'a', tabVisitId: 'v1', type: 'product', quantity: 1, price: 1, name: 'Burger', ...o }];
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['v1'], items: [...tabItems(), ...tabItems({ id: 'x', tabLineId: 'a' })], expectedTotal: 35, payment: { method: 'cash', amountTendered: 35 } }));
  check('a table’s line can’t be rung up twice', r.status === 409 && /check out from the table again/.test(r.body.error), r.body);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['v1'], items: tabItems({ tabLineId: 'zz' }), expectedTotal: 17.5, payment: { method: 'cash', amountTendered: 17.5 } }));
  check('…nor one that isn’t on its tab', r.status === 409);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['v1'], items: tabItems(), expectedTotal: 17.5, payment: { method: 'cash', amountTendered: 17.5 } }));
  check('the line as the table ordered it, priced from the menu with its choices', r.status === 200 && r2(r.body.total) === 17.5, { s: r.status, b: r.body });
  check('…and it isn’t sent to the kitchen again (it already was)', (await all(`${T}/kdsTickets`)).filter((t: any) => t.source === 'pos' && t.menuItemId === 'burger').length === 0);
  const before = new Set((await all(`${T}/kdsTickets`)).map((t: any) => t.id));
  await db.doc(`${T}/appointments/v2`).set({ tableName: '7', isTable: true, clientId: 'c1', status: 'servicing', source: 'host', tab: [L('t1', 'burger', 1, { picks: { cook: ['md'], side: ['fr'] }, choicesText: 'Medium, Fries' }), L('t2', 'fries', 1)] });
  r = await CO.POST(req({ tenantId: 't1', clientId: 'c1', appointmentIds: ['v2'], items: [
    { id: 'burger~ch~n', itemId: 'burger', picks: { cook: ['wd'], side: ['sl'] }, type: 'product', quantity: 1, price: 1, name: 'Burger' },
    { id: 'fries', type: 'product', quantity: 1, price: 6, name: 'Fries' },
    { id: 'burger~tab~t1', itemId: 'burger', tabLineId: 't1', tabVisitId: 'v2', type: 'product', quantity: 1, price: 1, name: 'Burger' },
    { id: 'fries~tab~t2', itemId: 'fries', tabLineId: 't2', tabVisitId: 'v2', type: 'product', quantity: 1, price: 1, name: 'Fries' }], expectedTotal: 16.5 + 15 + 12, payment: { method: 'cash', amountTendered: 43.5 } }));
  const made = (await all(`${T}/kdsTickets`)).filter((t: any) => t.source === 'pos' && !before.has(t.id));
  const burgers = made.filter((t: any) => t.menuItemId === 'burger'); const friesMade = made.filter((t: any) => t.menuItemId === 'fries');
  check('a new burger at the desk beside the table’s own is made, with its own choices; the table’s isn’t made again', r.status === 200 && burgers.length === 1 && burgers[0].choicesText === 'Well done, Salad', { s: r.status, b: r.body, burgers });
  check('…and new fries at the desk are made even though the table’s fries were sent (counted by its own line first)', friesMade.length === 1 && friesMade[0].quantity === 1, friesMade);

  console.log('the screens');
  const tab = src('src/components/host/TableTab.tsx'), sheet = src('src/components/menu/ChoiceSheet.tsx'), cat2 = src('src/components/pos/PosCatalog.tsx'), eng = src('src/components/pos/usePosEngine.tsx'), desk = src('src/components/pos/desk/DeskPOS.tsx');
  check('the table’s tab asks for the choices before ringing it in, then the allergy check with them, then the ticket', /if \(!choice && it\.type === 'product' && hasChoices\(it\)\) \{ setChoose\(it\); return; \}/.test(tab) && /setWarn\(\{ it, keys: c\.keys, who: c\.who, choice \}\)/.test(tab) && /void ringIn\(it, ch\)/.test(tab) && /lineId, choice \}\)/.test(tab) && /\{l\.choicesText && <span/.test(tab));
  check('…the menu’s choices come with each item, and the paper ticket carries them', /\{ choices: x\.choices \}/.test(tab) && /choicesText: l\.choicesText \|\| null, choices: own \? l\.choices \|\| \[\] : \[\]/.test(tab));
  check('the sheet: the guests’ own picker, priced as they pick, a must-make choice said before Add', /<ChoicePicker item=\{item\}/.test(sheet) && /priceChoices\(item, picks\)/.test(sheet) && /if \(!r\.ok\) \{ setTried\(true\); return; \}/.test(sheet) && /Add, \{money\(each\)\}/.test(sheet) && /defaultPicks\(item\)/.test(sheet)
    && !/uppercase|font-black| · /.test(sheet) && /min-h-\[52px\]/.test(sheet) && /h-11 w-11/.test(sheet));
  check('the front desk asks too; each set of choices is its own line, and the server gets the picks', /i\?\.type === 'refreshment' && hasChoices\(i\)\) \{ setChooseFor\(i\)/.test(cat2) && /__picks: c\.picks/.test(cat2) && /`\$\{item\.id\}~ch~\$\{picksKey\(picks\)\}`/.test(eng) && /it\.picks \? \{ itemId: it\.itemId, picks: it\.picks \}/.test(eng));
  check('…a table’s line keeps its choices when it’s checked out at the desk (priced the server’s way), each line on its own', /__tabLine: \{ lineId: String\(l\.lineId\), visitId: id, picks: l\.picks \|\| null, choices:/.test(desk) && /lineChoices\(item, \{ picks: item\.__tabLine\?\.picks, choices: item\.__tabLine\?\.choices \}\)/.test(eng) && /tabLineId: it\.tabLineId, tabVisitId: it\.tabVisitId/.test(eng));
  check('…a check that would ring up short isn’t opened; a line from the tab never goes above what the table had', /if \(missed\.length\) \{ setTabMissed\(missed\); return; \}/.test(desk) && /This check isn’t ready/.test(desk) && /line\?\.tabLineId && newQuantity > line\.quantity/.test(src('src/components/pos/CheckoutHub.tsx')) && /That’s all the table had/.test(src('src/components/pos/CheckoutHub.tsx')));
  check('…an item scanned without its choices is asked to be picked in the list; held stock, member discounts and shelf counts count choice lines as their item', /Choose first/.test(eng) && /it\.itemId \? \{ \.\.\.it, id: it\.itemId \} : it/.test(eng) && /String\(\(item as any\)\.itemId \|\| item\.id\)/.test(eng) && /String\(\(it as any\)\.itemId \|\| it\.id\)/.test(src('src/lib/checkout-calc.ts')));
  check('…the sheet keeps focus inside, gives it back, holds the page still, says the price as it changes, and a stray tap doesn’t lose choices', /title\.current\?\.focus\(\)/.test(sheet) && /back\?\.focus\?\.\(\)/.test(sheet) && /document\.body\.style\.overflow = 'hidden'/.test(sheet) && /aria-live="polite"/.test(sheet) && /&& !changed\) onClose\(\)/.test(sheet));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
