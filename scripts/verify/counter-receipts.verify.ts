// Checks "receipts at the counter" (design board of that name; lib/counter-receipt, lib/printing receiptDoc and the
// drawer, api/receipts for a counter order's receipt, api/printers' receipt setting, lib/day-sales, components/pos/
// ReceiptAsk, the counter page, Today's sales, the receipt page).
// - A paid counter order (not a staff meal, not a delivery app's) has a receipt, built from the order whenever it's asked
//   for and never kept a second time; its private link works with its key only.
// - Print: on the receipt printer picked, or the only one; with none (or several and none picked), the slip comes back
//   for this device's own print dialog. The cash drawer opens only for a cash sale, once, just after it.
// - Text and email send the private link, and are kept on the order.
// - Today's sales: each counter sale once (its ledger lines and its receipt together), by its number.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-receipts.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: true, isTenantOwner: false, caps: [] };
const sent: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { void Promise.resolve().then(fn); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams() } }) as any;
const getReq = (q: Record<string, string>) => ({ headers: { get: () => null }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams(q) } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const jobs = async () => (await db.collection(`${T}/printJobs`).get()).docs.map((d: any) => d.data());

const order = (x: any = {}) => ({ number: 'C14', channel: 'counter', status: 'sent', guestName: 'Mia', toGo: false, paidAt: ago(1), payMethod: 'cash', paidBy: 'Kai Park',
  lines: [{ lineId: 'a', itemId: 'latte', name: 'Oat latte', quantity: 1, unitPrice: 6.25, choicesText: 'Large, extra shot' }, { lineId: 'b', itemId: 'cro', name: 'Almond croissant', quantity: 2, unitPrice: 4.5, choicesText: null }, { lineId: 'c', itemId: 'drip', name: 'Drip coffee', quantity: 1, unitPrice: 3, choicesText: null }],
  itemsTotal: 18.25, discount: 3, reward: { id: 'r1', name: 'Free drink', points: 100, cents: 300 }, subtotal: 15.25, tax: 1.37, taxLabel: 'Sales tax', total: 16.62, cashTendered: 20, changeGiven: 3.38, ...x });

(async () => {
  const CR = await import('../../src/lib/counter-receipt');
  const P = await import('../../src/lib/printing');

  console.log('the receipt, built from the order');
  const r = CR.counterReceipt(order(), 'o1');
  check('its id, its order and where it was sold', r.id === 'co_o1' && r.source === 'counter' && r.orderNumber === 'C14' && r.channelName === 'Counter' && r.clientName === 'Mia' && r.cashierName === 'Kai Park');
  check('…each line (choices on it), the reward, the tax and the total', r.detail.lines.length === 3 && r.detail.lines[0].label === 'Oat latte (Large, extra shot)' && r.detail.lines[1].amount === 9 && r.subtotal === 18.25
    && r.discounts[0].label === 'Reward' && r.discounts[0].amount === 3 && r.tax === 1.37 && r.total === 16.62, r);
  check('…cash handed over and the change', r.paymentMethod === 'cash' && r.amountTendered === 20 && r.change === 3.38);
  check('a card sale has no cash on it; a delivery’s tip is shown, and the total is what was charged (the tip already in it)', (() => { const c = CR.counterReceipt(order({ payMethod: 'card', tipCents: 200, total: 18.62 }), 'o2'); return c.paymentMethod === 'card' && c.amountTendered === null && c.change === null && c.tip === 2 && c.total === 18.62 && c.detail.payments[0].amount === 16.62; })());
  const can = CR.counterReceipt(order({ payMethod: 'card', status: 'voided', voidReason: 'Canceled by the guest', voidedAt: ago(1), refundedAt: ago(1), refundedCents: 1662 }), 'o5');
  check('cancelled and refunded after it was paid: marked so, with the refund', can.voided === true && can.voidRefunded === true && can.refunds[0].cents === 1662 && can.voidReason === 'Canceled by the guest' && CR.counterSaleRow(order({ status: 'voided', refundedAt: ago(1), refundedCents: 1662 }), 'o5').voided === true);
  const part = CR.counterReceipt(order({ payMethod: 'card', refundedAt: ago(1), refundedCents: 1262, ahead: { delivery: { state: 'refunded' } } }), 'o6');
  check('…part of it refunded (a delivery’s fee kept): still a sale, the refund on it, what was kept in Today’s sales', !part.voided && part.refunds[0].reason === 'Delivery refunded' && CR.counterSaleRow(order({ refundedAt: ago(1), refundedCents: 1262 }), 'o6').total === 4);
  check('…and on the slip', P.receiptDoc(can, { business: 'x', tz: null }).blocks.some((b: any) => b.k === 'alert' && b.text === 'Refunded') && P.receiptDoc(part, { business: 'x', tz: null }).blocks.some((b: any) => b.k === 'money' && b.left === 'Refunded, delivery refunded' && b.right === '-$12.62'));
  check('only a paid order has one: not a staff meal, not a delivery app’s', CR.hasReceipt(order()) && !CR.hasReceipt(order({ paidAt: null })) && !CR.hasReceipt(order({ payMethod: 'staff' })) && !CR.hasReceipt(order({ payMethod: 'app' })));

  console.log('the slip');
  const doc = P.receiptDoc(r, { business: 'Linden Coffee', address: '12 Harbor Rd, Portland', tz: 'America/Los_Angeles', url: 'https://app.example/r/t1/co_o1?k=x' });
  const words = doc.blocks.map((b: any) => [b.left, b.right, b.text, b.data].filter(Boolean).join(' ')).join('\n');
  check('the business, the order number and for here', doc.blocks[0].k === 'text' && (doc.blocks[0] as any).text === 'Linden Coffee' && doc.blocks.some((b: any) => b.k === 'head' && b.left === 'C14' && b.right === 'For here'));
  check('…each line with its choices under it, the reward taken off, the tax and the total', /1  Oat latte \$6\.25/.test(words) && /Large, extra shot/.test(words) && /2  Almond croissant \$9\.00/.test(words)
    && /Reward -\$3\.00/.test(words) && /Sales tax \$1\.37/.test(words) && /Total \$16\.62/.test(words), words);
  check('…the cash and the change, then the link to it online', /Cash \$20\.00/.test(words) && /Change \$3\.38/.test(words) && doc.blocks.some((b: any) => b.k === 'qr') && /Your receipt online/.test(words) && !doc.drawer);
  check('the drive-thru’s and one to go say so', P.receiptDoc(CR.counterReceipt(order({ channel: 'drive-thru', number: 'D31' }), 'o3'), { business: 'x', tz: null }).blocks.some((b: any) => b.k === 'head' && b.right === 'Drive-thru')
    && P.receiptDoc(CR.counterReceipt(order({ toGo: true }), 'o4'), { business: 'x', tz: null }).blocks.some((b: any) => b.k === 'head' && b.right === 'To go'));
  const ep = P.renderEpos({ ...doc, drawer: true }, 42);
  check('Epson: the drawer opens first, then the slip', ep.indexOf('<pulse drawer="drawer_1" time="pulse_100"/>') > 0 && ep.indexOf('<pulse') < ep.indexOf('Linden Coffee') && !P.renderEpos(doc, 42).includes('<pulse'));
  check('…just the drawer: nothing printed', P.renderEpos(P.drawerDoc(), 42) === '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><pulse drawer="drawer_1" time="pulse_100"/></epos-print>');
  const star = src('src/app/api/printer/star/[tenantId]/[printerId]/[key]/route.ts'); const epson = src('src/app/api/printer/epson/[tenantId]/[printerId]/[key]/route.ts');
  check('Star: the drawer opens with the job (only a printer set to), and a drawer alone isn’t cut', /X-Star-Cashdrawer/.test(star) && star.includes("if (j.doc?.drawer && a.p.drawer) headers['X-Star-Cashdrawer'] = 'start';") && star.includes("if (j.doc?.blocks?.length) headers['X-Star-Cut']"));
  check('Epson: only a printer set to open the drawer sends it', epson.includes('renderEpos(p.drawer ? job.doc : { ...job.doc, drawer: false }, p.cols)'));
  check('a printer prints receipts and opens the drawer only when set to', (() => { const a = P.cleanPrinter({}); const b = P.cleanPrinter({ receipts: true, drawer: true }); return !a.receipts && !a.drawer && b.receipts && b.drawer; })());
  check('after a sale: ask, unless set to print one or not to', P.receiptAfterOf({}) === 'ask' && P.receiptAfterOf({ receiptSettings: { after: 'print' } }) === 'print' && P.receiptAfterOf({ receiptSettings: { after: 'none' } }) === 'none' && P.receiptAfterOf({ receiptSettings: { after: 'x' } }) === 'ask');

  const seed = async (printers: any[]) => {
    db = strictTransactions(makeDb()); sent.length = 0;
    await db.doc(T).set({ name: 'Linden Coffee', timezone: 'America/Los_Angeles', address: '12 Harbor Rd, Portland' });
    await db.doc(`${T}/counterOrders/o1`).set(order());
    await db.doc(`${T}/counterOrders/card1`).set(order({ number: 'C15', payMethod: 'card', cashTendered: null, changeGiven: null }));
    await db.doc(`${T}/counterOrders/old1`).set(order({ number: 'C9', paidAt: ago(40) }));
    await db.doc(`${T}/counterOrders/staff1`).set(order({ number: 'C16', payMethod: 'staff' }));
    await db.doc(`${T}/counterOrders/app1`).set(order({ number: 'C17', payMethod: 'app' }));
    await db.doc(`${T}/counterOrders/open1`).set(order({ number: 'C18', paidAt: null, payMethod: null }));
    for (const p of printers) await db.doc(`${T}/printers/${p.id}`).set({ kind: 'star', cols: 48, stations: [], tickets: false, checks: false, buzz: false, receipts: false, drawer: false, key: 'k'.repeat(32), ...p });
  };
  const R = await import('../../src/app/api/receipts/route');
  const call = async (b: any) => (await R.POST(req({ tenantId: 't1', ...b }))) as any;

  console.log('its private link');
  await seed([{ id: 'front', name: 'Front counter', receipts: true, drawer: true }]);
  const l1 = await call({ action: 'link', receiptId: 'co_o1' }); const k1 = (await get(`${T}/counterOrders/o1`)).receiptKey;
  const l2 = await call({ action: 'link', receiptId: 'co_o1' });
  check('made once, on the order (never a receipt of its own)', l1.body.ok && typeof k1 === 'string' && k1.length >= 20 && l1.body.url === l2.body.url && l1.body.url.endsWith(`/r/t1/co_o1?k=${k1}`) && (await db.collection(`${T}/receipts`).get()).docs.length === 0, l1.body);
  const g1: any = await R.GET(getReq({ tenantId: 't1', id: 'co_o1', k: k1 }));
  check('the page reads it with its key: the order, where, cash and change', g1.body.ok && g1.body.receipt.orderNumber === 'C14' && g1.body.receipt.channelName === 'Counter' && g1.body.receipt.amountTendered === 20 && g1.body.receipt.change === 3.38 && g1.body.receipt.total === 16.62, g1.body);
  const g2: any = await R.GET(getReq({ tenantId: 't1', id: 'co_o1', k: 'wrong' }));
  check('…and not without it', g2.status === 404);
  const none = await Promise.all(['co_staff1', 'co_app1', 'co_open1', 'co_nope', 'co_../x'].map((id) => call({ action: 'link', receiptId: id })));
  check('a staff meal, an app’s order, an unpaid one, none and a bad id: no receipt', none.every((x: any) => x.status === 404), none.map((x: any) => x.status));

  console.log('printing it, and the drawer');
  let p = await call({ action: 'print', receiptId: 'co_o1', drawer: true });
  let j = await jobs();
  check('on the only receipt printer, the drawer with it (cash, just paid)', p.body.ok && p.body.printer === 'Front counter' && p.body.drawer === true && j.length === 1 && j[0].kind === 'receipt' && j[0].printerId === 'front' && j[0].doc.drawer === true && j[0].receiptId === 'co_o1', [p.body, j]);
  check('…kept on the order: when and by whom', !!(await get(`${T}/counterOrders/o1`)).drawerOpenedAt && (await get(`${T}/counterOrders/o1`)).drawerOpenedBy === 'Kai Park');
  p = await call({ action: 'print', receiptId: 'co_o1', drawer: true }); j = await jobs();
  check('a reprint doesn’t open it again', p.body.ok && p.body.drawer === false && j.length === 2 && !j[1].doc.drawer);
  const d1 = await call({ action: 'drawer', receiptId: 'co_o1' });
  check('…nor does asking for the drawer again', d1.status === 409 && /already opened/.test(d1.body.error));
  const d2 = await call({ action: 'drawer', receiptId: 'co_card1' }); const d3 = await call({ action: 'drawer', receiptId: 'co_old1' });
  check('never for a card sale, or a cash sale from a while ago', d2.status === 409 && d3.status === 409 && /only for a cash sale/.test(d2.body.error) && /only for a cash sale/.test(d3.body.error));
  p = await call({ action: 'print', receiptId: 'co_card1', drawer: true }); j = await jobs();
  check('…a card sale’s receipt prints without it', p.body.ok && p.body.drawer === false && !j[j.length - 1].doc.drawer);
  await seed([{ id: 'front', name: 'Front counter', receipts: true, drawer: true }]);
  const d4 = await call({ action: 'drawer', receiptId: 'co_o1' }); j = await jobs();
  check('a cash sale with no receipt: just the drawer', d4.body.ok && d4.body.printer === 'Front counter' && j.length === 1 && j[0].kind === 'drawer' && j[0].doc.drawer === true && j[0].doc.blocks.length === 0);

  await seed([{ id: 'rec', name: 'Receipts', receipts: true }, { id: 'till', name: 'Till printer', drawer: true }]);
  p = await call({ action: 'print', receiptId: 'co_o1', drawer: true }); j = await jobs();
  check('the drawer on another printer: opened there, the receipt on its own', p.body.ok && p.body.drawer === true && j.length === 2 && j.some((x: any) => x.kind === 'drawer' && x.printerId === 'till') && j.some((x: any) => x.kind === 'receipt' && x.printerId === 'rec' && !x.doc.drawer), j);

  await seed([{ id: 'a', name: 'Bar', receipts: true }, { id: 'b', name: 'Window', receipts: true }]);
  p = await call({ action: 'print', receiptId: 'co_o1' });
  check('two receipt printers, none picked: nothing queued, the slip comes back with both to pick from', p.body.ok && Array.isArray(p.body.doc?.blocks) && p.body.printers.length === 2 && (await jobs()).length === 0);
  p = await call({ action: 'print', receiptId: 'co_o1', printerId: 'b' });
  check('…picked: on that one', p.body.ok && p.body.printer === 'Window' && (await jobs())[0].printerId === 'b');
  await seed([{ id: 'k', name: 'Kitchen', tickets: true }]);
  p = await call({ action: 'print', receiptId: 'co_o1', drawer: true });
  check('no receipt printer: the slip for this device’s print dialog, and no drawer to open', p.body.ok && p.body.doc.blocks.length > 5 && p.body.drawer === false && (await jobs()).length === 0);
  const d5 = await call({ action: 'drawer', receiptId: 'co_o1' });
  check('…asking for the drawer says why', d5.status === 409 && /No printer here opens a cash drawer/.test(d5.body.error));
  await seed([{ id: 'rec', name: 'Receipts', receipts: true }, { id: 'd1', name: 'Till one', drawer: true }, { id: 'd2', name: 'Till two', drawer: true }]);
  p = await call({ action: 'print', receiptId: 'co_o1', printerId: 'rec', drawer: true });
  const d6 = await call({ action: 'drawer', receiptId: 'co_o1', printerId: 'rec' });
  check('two printers with a drawer and the picked one has none: no drawer guessed, and asking says which to pick', p.body.ok && p.body.drawer === false && d6.status === 409 && /More than one printer opens a drawer/.test(d6.body.error) && !(await get(`${T}/counterOrders/o1`)).drawerOpenedAt);
  const d7 = await call({ action: 'drawer', receiptId: 'co_o1', printerId: 'd2' }); j = await jobs();
  check('…the picked printer’s own drawer', d7.body.ok && d7.body.printer === 'Till two' && j.some((x: any) => x.kind === 'drawer' && x.printerId === 'd2'));
  const rs = src('src/lib/receipt-actions-server.ts');
  check('a drawer that couldn’t be sent takes its mark back (tried again), and a receipt that couldn’t be says so', rs.includes("const unmark = async () => { if (opened && !drawerQueued) await ref.set({ drawerOpenedAt: null, drawerOpenedBy: null }, { merge: true })") && rs.includes('The drawer didn’t open. Try again.') && rs.includes('The receipt didn’t reach the printer. Try again.'));
  await seed([{ id: 'front', name: 'Front counter', receipts: true, drawer: true }]);
  actor.isRenter = true;
  const rn = await Promise.all([call({ action: 'link', receiptId: 'co_o1' }), call({ action: 'print', receiptId: 'co_o1' }), call({ action: 'drawer', receiptId: 'co_o1' }), call({ action: 'send', receiptId: 'co_o1', channel: 'sms', to: '5035550142' })]);
  await db.doc(`${T}/receipts/rd9`).set({ checkoutSessionId: 'cs9', date: ago(1), total: 30, paymentMethod: 'cash', clientName: 'Rae Lin' });
  const rd = await call({ action: 'drawer', receiptId: 'rd9' }); const rpr = await call({ action: 'print', receiptId: 'rd9', drawer: true });
  const rt = await call({ action: 'today', from: new Date(Date.now() - 12 * 3600e3).toISOString(), to: new Date(Date.now() + 12 * 3600e3).toISOString() });
  actor.isRenter = false;
  check('a renter working here: none of the counter’s receipts, never the drawer, and no counter sales in Today’s sales', rn.every((x: any) => x.status === 403) && rd.status === 403 && rpr.body.ok && rpr.body.drawer === false && (await jobs()).every((x: any) => !x.doc.drawer)
    && (rt.body.receipts || []).every((x: any) => x.source !== 'counter') && (rt.body.receipts || []).some((x: any) => x.id === 'rd9'), [rn.map((x: any) => x.status), rd.status, rpr.body]);

  console.log('texting and emailing it');
  await seed([]);
  const s1 = await call({ action: 'send', receiptId: 'co_o1', channel: 'sms', to: '(503) 555-0142' });
  const o1 = await get(`${T}/counterOrders/o1`);
  check('a text with the private link', s1.body.ok && sent.length === 1 && sent[0].channel === 'sms' && sent[0].to === '(503) 555-0142' && sent[0].text.includes(`/r/t1/co_o1?k=${o1.receiptKey}`) && /^Hi Mia, here is your receipt/.test(sent[0].text), sent);
  check('…kept on the order', Array.isArray(o1.receiptSends) && o1.receiptSends.length === 1 && o1.receiptSends[0].channel === 'sms' && o1.receiptSends[0].ok === true && o1.receiptSends[0].by === 'Kai Park');
  const s2 = await call({ action: 'send', receiptId: 'co_o1', channel: 'email', to: 'not-an-address' });
  const s3 = await call({ action: 'send', receiptId: 'co_o1', channel: 'email', to: 'mia@example.com' });
  check('an email needs an address; then it goes', s2.status === 400 && s3.body.ok && sent.length === 2 && sent[1].channel === 'email' && sent[1].to === 'mia@example.com');

  console.log('Today’s sales');
  const day0 = new Date(Date.now() - 12 * 3600e3).toISOString(); const day1 = new Date(Date.now() + 12 * 3600e3).toISOString();
  await db.doc(`${T}/receipts/rd1`).set({ checkoutSessionId: 'cs1', date: ago(5), total: 40, paymentMethod: 'card', clientName: 'Rae Lin' });
  const t = await call({ action: 'today', from: day0, to: day1 });
  const ids = (t.body.receipts || []).map((x: any) => x.id).sort();
  check('the counter’s paid sales beside the front desk’s (no staff meal, app order or unpaid one)', t.body.ok && JSON.stringify(ids) === JSON.stringify(['co_card1', 'co_o1', 'co_old1', 'rd1']), ids);
  const DS = await import('../../src/lib/day-sales');
  const lines = [
    { id: 'counter_o1', orderId: 'o1', channel: 'counter', type: 'income', category: 'Retail', amount: 15.25, paymentMethod: 'cash', clientOrVendor: 'Counter C14', date: ago(1) },
    { id: 'counter_o1_tax', orderId: 'o1', channel: 'counter', type: 'income', category: 'Tax Collected', amount: 1.37, paymentMethod: 'cash', clientOrVendor: 'Counter C14', date: ago(1) },
    { id: 'counter_card1', orderId: 'card1', channel: 'counter', type: 'income', category: 'Retail', amount: 15.25, paymentMethod: 'card', clientOrVendor: 'Counter C15', date: ago(1), stripePaymentIntentId: 'pi_9' },
    { id: 'counter_card1_tax', orderId: 'card1', channel: 'counter', type: 'income', category: 'Tax Collected', amount: 1.37, paymentMethod: 'card', clientOrVendor: 'Counter C15', date: ago(1), stripePaymentIntentId: 'pi_9' },
    { id: 'counter_app1', orderId: 'app1', channel: 'counter', type: 'income', category: 'Retail', amount: 19, paymentMethod: 'app', clientOrVendor: 'Uber Eats', date: ago(2) },
    { id: 'counter_app1_appfee', orderId: 'app1', channel: 'counter', type: 'expense', category: 'Delivery App Fees', amount: 5, paymentMethod: 'Deducted from payout', clientOrVendor: 'Uber Eats', date: ago(2) },
  ];
  const day = DS.groupDaySales(lines, t.body.receipts, new Date(day0), new Date(day1));
  const one = day.sales.filter((s: any) => s.key === 'ct:o1');
  check('each counter sale once: its lines and its receipt together, by its number', one.length === 1 && one[0].label === 'Counter C14' && one[0].clientName === 'Mia' && one[0].total === 16.62 && one[0].method === 'cash' && one[0].receipt?.id === 'co_o1' && one[0].source === 'counter', one);
  check('…a card reader’s sale too (not as a card payment of its own)', day.sales.filter((s: any) => s.key === 'ct:card1').length === 1 && !day.sales.some((s: any) => s.key === 'pi:pi_9'));
  check('…one just paid, with no lines yet, from its receipt', day.sales.filter((s: any) => s.key === 'ct:old1').length === 1 && day.sales.find((s: any) => s.key === 'ct:old1')!.total === 16.62);
  check('…an app’s order from its lines (no receipt), and the front desk’s sale as before', day.sales.find((s: any) => s.key === 'ct:app1')?.total === 19 && day.sales.filter((s: any) => s.key === 'co:cs1').length === 1);
  check('…counted once in the day’s totals', day.summary.count === 5 && day.summary.total === Math.round((16.62 * 3 + 19 + 40) * 100) / 100, day.summary);

  console.log('the setting, in Printers');
  await seed([{ id: 'front', name: 'Front counter', receipts: true, drawer: true }]);
  const PR = await import('../../src/app/api/printers/route');
  const pr = async (b: any) => (await PR.POST(req({ tenantId: 't1', ...b }))) as any;
  const a1 = await pr({ action: 'after', after: 'print' });
  check('“Print one” is kept (a manager’s)', a1.body.ok && (await get(T)).receiptSettings.after === 'print' && (await get(T)).receiptSettings.updatedBy === 'Kai Park', a1.body);
  const ls = await pr({ action: 'list' });
  check('…and listed with each printer’s receipts and drawer', ls.body.receiptAfter === 'print' && ls.body.printers[0].receipts === true && ls.body.printers[0].drawer === true);
  const sv = await pr({ action: 'save', id: 'front', name: 'Front counter', kind: 'star', receipts: false, drawer: true });
  check('…a printer set not to print receipts', sv.body.ok && (await get(`${T}/printers/front`)).receipts === false && (await get(`${T}/printers/front`)).drawer === true);
  const pp = src('src/app/api/printers/route.ts');
  check('…only a manager changes it', pp.includes("requireRole(req, tenantId, action === 'list' ? 'staff' : 'manager')") && pp.includes("'test', 'after'].includes(action)"));

  console.log('the screens');
  const lane = src('src/app/api/counter/route.ts');
  check('the counter’s lane says what to do after a sale, and which printers print receipts', lane.includes('receipt: await (async () =>') && lane.includes('after: receiptAfterOf(tenant), printers: ps.filter((p: any) => p.receipts)'));
  const ask = src('src/components/pos/ReceiptAsk.tsx');
  check('ReceiptAsk: Print, Text, Email, No receipt (Done once one went)', /'Printing…' : 'Print'/.test(ask) && />Text<\/button>/.test(ask) && />Email<\/button>/.test(ask) && ask.includes("{done || later ? 'Done' : 'No receipt'}"));
  check('…“Print one” prints by itself on this screen’s printer; otherwise a cash sale just opens the drawer', ask.includes("if (setup.after === 'print' && printer) void print(cash);") && ask.includes('else if (cash && setup.drawer) void openDrawer();') && ask.includes('if (later || !auto || started.current || !setup) return;'));
  check('…several receipt printers: this screen picks its own, kept on it', ask.includes('aria-label="Receipt printer"') && ask.includes('localStorage.setItem(RECEIPT_PRINTER_KEY, id)') && ask.includes('Pick this screen’s receipt printer first.'));
  check('…no networked printer: this device’s print dialog with the same slip', ask.includes('if (r.doc && printHere(r.doc))') && ask.includes("w.document.write(renderHtml(doc, { font: PRINT_FONT_STACK, fontHref: PRINT_FONT_HREF }))"));
  check('…text and email send the private link', ask.includes("await ask({ action: 'send', channel: way, to: to.trim() })") && ask.includes('It sends a private link to the full receipt.'));
  const page = src('src/app/(app)/counter/page.tsx');
  check('…paid already (asked again): nothing prints or opens by itself', ask.includes('if (later || !auto || started.current || !setup) return;') && page.includes('auto={slip.auto !== false}'));
  check('the counter: the receipt after cash (with the change), the card machine and the reader', page.includes("if (!d.paidOtherwise) setSlip({ orderId: order.id, title: titleOf(order), cash: (d.payMethod || method) === 'cash', change: Number(d.change) > 0 ? Number(d.change) : null, auto: !d.already });")
    && page.includes("if (d.state === 'paid') setSlip({ orderId: order.id, title: titleOf(order), cash: false, change: null });") && page.includes("if (order) setSlip({ orderId: id, title: titleOf(order), cash: false, change: null });"));
  check('…shown above the order, with the lane’s setting', page.includes('<ReceiptAsk key={`${slip.orderId}${slip.later ? \'-later\' : \'\'}`} tenantId={tenantId} receiptId={`co_${slip.orderId}`}') && page.includes('setup={lane?.receipt || null}'));
  check('…Waiting: Receipt again (not an app’s order or a staff meal), nothing printed by itself', page.includes("{o && !o.app?.code && o.paidAt && !o.staffMeal && <button") && page.includes('later: true })} className'));
  const ts = src('src/components/pos/desk/TodaysSales.tsx');
  check('Today’s sales: Print on this screen’s receipt printer; a counter sale isn’t voided there', ts.includes("printReceipt(deskCall(tenantId, String(r.id)), { printerId: savedReceiptPrinter() || null })") && ts.includes("x.source === 'counter' && <p") && ts.includes("x.source === 'planner' || x.source === 'counter')"));
  const rp = src('src/app/r/[tenantId]/[id]/page.tsx');
  check('the receipt page: the order and where', rp.includes("r.orderNumber && row('Order', `${r.channelName ? `${r.channelName} ` : ''}${r.orderNumber}`)"));
  const sp = src('src/app/(app)/settings/printers/page.tsx');
  check('Printers: Prints receipts, Opens the cash drawer, and after a sale', sp.includes('Prints receipts') && sp.includes('Opens the cash drawer') && sp.includes('label="After a sale"'));
  check('house style', [ask, src('src/lib/counter-receipt.ts')].every((x) => !/ · |\buppercase\b|font-black|\{\/\*/.test(x)) && !/[Ss]alon|[Ss]tylist|\bbooth|\bchair\b|\bstudio\b/.test(ask));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
