// Checks gift cards and store credit at the counter and the drive-thru (design board "Money at the counter", part 2;
// lib/counter-money tendersOf / dueCentsOf, lib/counter-money-server addTender / removeTender, lib/counter-server
// payOrder, api/counter 'tender' and paid { method: 'tender' }, the card reader and scan to pay, the receipt, the night).
// - A gift card is held on the card for what's left (two registers can't spend the same money), and taken when it's paid;
//   one that can't cover its part any more stops the payment, with nothing taken.
// - Store credit (a guest with their rewards number on it) is taken once it's paid, as at the front desk.
// - What's left is paid by cash or card: the reader and scan to pay ask only that; the drawer counts only the cash.
// - Covered in full: finished with it, never charged as cash or card.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-tenders.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
const db: any = makeDb();
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { void Promise.resolve().then(fn); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async () => ({ ok: true }) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams() } }) as any;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const lines = [{ lineId: 'a', itemId: 'latte', name: 'Oat latte', quantity: 1, unitPrice: 6.25, choicesText: null }, { lineId: 'b', itemId: 'cro', name: 'Almond croissant', quantity: 2, unitPrice: 4.5, choicesText: null }, { lineId: 'c', itemId: 'drip', name: 'Drip coffee', quantity: 1, unitPrice: 3, choicesText: null }];
const card = (id: string, code: string, cents: number, x: any = {}) => db.doc(`${T}/giftCards/${id}`).set({ id, code, codeKey: code.replace(/[^A-Z0-9]/g, ''), initialCents: cents, balanceCents: cents, status: 'active', history: [], ...x });

(async () => {
  const CO = await import('../../src/lib/counter-orders');
  const CM = await import('../../src/lib/counter-money');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const tenant: any = { name: 'North Pier Coffee', timezone: 'UTC', businessType: 'hospitality', plan: 'pro', retailSettings: { taxRatePercent: 9 }, salesTax: { configured: true } };
  await db.doc(T).set(tenant);
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const money = CO.totalsOf(tenant, lines as any); const totalC = Math.round(money.total * 100);
  const seed = async (id: string, x: any = {}) => db.doc(`${T}/counterOrders/${id}`).set({ number: `D${id.slice(1)}`, channel: 'drive-thru', status: 'sent', guestName: 'Lee', paidAt: null, lines, ...money, day: new Date().toISOString().slice(0, 10), createdAt: ago(3), ...x });
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });

  console.log('a gift card that covers all of it');
  await card('g1', 'KQ7M-24RT', 2500); await seed('o1');
  let r = await L({ action: 'tender', orderId: 'o1', do: 'gift', code: 'kq7m 24rt' });
  let o1 = await get(`${T}/counterOrders/o1`); let g1 = await get(`${T}/giftCards/g1`);
  check('found by its code however it’s typed, set aside for all of it, held on the card', r.body.ok && r.body.due === 0 && r.body.code === '••24RT' && o1.tenders.length === 1 && o1.tenders[0].cents === totalC && g1.holds?.counter_o1?.cents === totalC && g1.balanceCents === 2500, [r.body, g1.holds]);
  check('…the lane says nothing is left to pay', CM.dueCentsOf(o1) === 0 && CM.tenderCentsOf(o1) === totalC);
  check('…twice: refused', (await L({ action: 'tender', orderId: 'o1', do: 'gift', code: 'KQ7M-24RT' })).status === 409);
  r = await L({ action: 'paid', orderId: 'o1', method: 'card' });
  check('covered: never charged as a card', r.status === 409 && r.body.code === 'covered' && !(await get(`${T}/counterOrders/o1`)).paidAt);
  r = await L({ action: 'paid', orderId: 'o1', method: 'tender' }); o1 = await get(`${T}/counterOrders/o1`); g1 = await get(`${T}/giftCards/g1`);
  check('finished with it: paid, the card’s balance down, its hold gone, the spend on its history', r.body.ok && o1.paidAt && o1.payMethod === 'gift_card' && g1.balanceCents === 2500 - totalC && !g1.holds?.counter_o1 && g1.history.some((h: any) => h.type === 'spend' && h.cents === -totalC && h.ref === 'counter_o1'), [r.body, g1]);
  check('…booked as sales, paid by gift card; nothing in the drawer', (await get(`${T}/transactions/counter_o1`)).paymentMethod === 'gift_card' && (await get(`${T}/transactions/counter_o1`)).amount === money.subtotal && (await get(`${T}/tillSessions/till1`)).expectedCash === 100
    && o1.payments.length === 1 && o1.payments[0].method === 'gift_card' && o1.payments[0].code === '••24RT');

  console.log('part on a gift card, the rest in cash');
  await card('g2', 'AAAA-5555', 500); await seed('o2');
  r = await L({ action: 'tender', orderId: 'o2', do: 'gift', code: 'AAAA-5555' });
  check('it covers what it has; the rest is left', r.body.ok && r.body.cents === 500 && Math.abs(r.body.due - (totalC - 500) / 100) < 0.001);
  r = await L({ action: 'paid', orderId: 'o2', method: 'cash', tendered: (totalC - 600) / 100 });
  check('cash less than what’s left: refused', r.status === 400 && /less than what’s left/.test(r.body.error));
  r = await L({ action: 'paid', orderId: 'o2', method: 'cash', tendered: 20 }); const o2 = await get(`${T}/counterOrders/o2`);
  const till = await get(`${T}/tillSessions/till1`);
  check('the change is from what’s left; the drawer takes only the cash', r.body.ok && Math.abs(r.body.change - (2000 - (totalC - 500)) / 100) < 0.001 && Math.abs(till.expectedCash - (100 + (totalC - 500) / 100)) < 0.001, [r.body, till]);
  check('…each part kept, the sale booked as split', o2.payMethod === 'cash' && o2.payments.length === 2 && o2.payments[0].method === 'gift_card' && o2.payments[0].amount === 5 && o2.payments[1].method === 'cash' && Math.abs(o2.payments[1].amount - (totalC - 500) / 100) < 0.001
    && (await get(`${T}/transactions/counter_o2`)).paymentMethod === 'split' && (await get(`${T}/giftCards/g2`)).balanceCents === 0 && (await get(`${T}/giftCards/g2`)).status === 'used');

  console.log('two registers, one card');
  await card('g3', 'BBBB-7777', 2500); await seed('o3'); await seed('o4');
  await L({ action: 'tender', orderId: 'o3', do: 'gift', code: 'BBBB-7777' });
  r = await L({ action: 'tender', orderId: 'o4', do: 'gift', code: 'BBBB-7777' });
  check('the second gets only what isn’t held for the first', r.body.ok && r.body.cents === 2500 - totalC, r.body);
  r = await L({ action: 'tender', orderId: 'o3', do: 'remove', giftCardId: 'g3' });
  check('taken off: its hold is let go', r.body.ok && Math.abs(r.body.due - totalC / 100) < 0.001 && !(await get(`${T}/giftCards/g3`)).holds?.counter_o3 && (await get(`${T}/counterOrders/o3`)).tenders.length === 0);
  await L({ action: 'tender', orderId: 'o3', do: 'gift', code: 'BBBB-7777' });
  const CS = await import('../../src/lib/counter-server');
  await db.doc(`${T}/giftCards/g3`).set({ balanceCents: 100 }, { merge: true });
  const short: any = await CS.payOrder(db, 't1', 'o3', { method: 'tender', by: 'Window' } as any);
  check('a card that can’t cover its part any more: the payment stops, nothing taken', short.error && /left on gift card/.test(short.error) && !(await get(`${T}/counterOrders/o3`)).paidAt && (await get(`${T}/giftCards/g3`)).balanceCents === 100, short);
  await db.doc(`${T}/counterOrders/o4`).set({ status: 'sent' }, { merge: true });
  const v: any = await CS.voidOrder(db, 't1', 'o4', 'Drove off', { id: null, name: 'Window' } as any);
  check('an order voided before it’s paid lets its gift card hold go', v.ok && !(await get(`${T}/giftCards/g3`)).holds?.counter_o4, v);

  console.log('a bonus card');
  await card('g5', 'PROM-0001', 300, { promo: true }); await seed('o5');
  await L({ action: 'tender', orderId: 'o5', do: 'gift', code: 'PROM-0001' });
  r = await L({ action: 'paid', orderId: 'o5', method: 'card' });
  const bonus = await get(`${T}/transactions/counter_o5_giftbonus`);
  check('its money is a discount it gave, as at the front desk', r.body.ok && bonus && bonus.type === 'expense' && bonus.category === 'Discounts' && bonus.amount === 3 && bonus.discountKind === 'gift_offer', bonus);

  console.log('store credit');
  await seed('o6');
  check('only for a guest with their rewards on it', (await L({ action: 'tender', orderId: 'o6', do: 'credit' })).status === 409);
  await db.doc(`${T}/clients/c1`).set({ name: 'Mia Ross', storeCredits: [{ id: 'sc1', amount: 8, status: 'available', createdAt: ago(5000) }], totalStoreCredit: 8 });
  await seed('o7', { clientId: 'c1', points: { phone: '0142', verified: true } });
  r = await L({ action: 'tender', orderId: 'o7', do: 'credit' });
  check('set aside: what they have, up to what’s left', r.body.ok && r.body.cents === 800 && (await get(`${T}/clients/c1`)).totalStoreCredit === 8, r.body);
  r = await L({ action: 'paid', orderId: 'o7', method: 'card' });
  const c1 = await get(`${T}/clients/c1`); const used = (await db.collection(`${T}/transactions`).get()).docs.map((d: any) => d.data()).find((t: any) => t.type === 'store_credit_redemption');
  check('taken once it’s paid', r.body.ok && c1.totalStoreCredit === 0 && c1.storeCredits[0].status === 'used' && used && used.amount === -8 && !(await get(`${T}/counterOrders/o7`)).creditShort, [r.body, c1]);

  await seed('o8', { clientId: 'c1', points: { phone: '0142', verified: false } });
  r = await L({ action: 'tender', orderId: 'o8', do: 'credit' });
  check('…by their rewards code only, never a number someone said', r.status === 409 && r.body.code === 'needs_code', r.body);
  await db.doc(`${T}/clients/c2`).set({ name: 'Jo Park', storeCredits: [{ id: 'sc2', amount: 8, status: 'available', createdAt: ago(5000) }], totalStoreCredit: 8 });
  await seed('o9', { clientId: 'c2', points: { phone: '0199', verified: true } });
  await L({ action: 'tender', orderId: 'o9', do: 'credit' });
  await db.doc(`${T}/clients/c2`).set({ storeCredits: [{ id: 'sc2', amount: 3, status: 'available', createdAt: ago(5000) }], totalStoreCredit: 3 }, { merge: true });
  const cashBefore = (await get(`${T}/tillSessions/till1`)).expectedCash;
  r = await L({ action: 'paid', orderId: 'o9', method: 'cash', tendered: 40 });
  check('used up somewhere else meanwhile: the payment stops, nothing taken, nothing in the drawer', r.status === 409 && /store credit changed/.test(r.body.error) && !(await get(`${T}/counterOrders/o9`)).paidAt
    && (await get(`${T}/clients/c2`)).totalStoreCredit === 3 && (await get(`${T}/tillSessions/till1`)).expectedCash === cashBefore, r.body);
  await L({ action: 'tender', orderId: 'o9', do: 'remove', credit: true });
  await db.doc(`${T}/clients/c2`).set({ storeCredits: [{ id: 'sc2', amount: 8, status: 'available', createdAt: ago(5000) }], totalStoreCredit: 8 }, { merge: true });
  await L({ action: 'tender', orderId: 'o9', do: 'credit' });
  await db.doc(`${T}/counterOrders/o9`).set({ points: { phone: '0300', verified: false } }, { merge: true });
  const swapped: any = await CS.payOrder(db, 't1', 'o9', { method: 'cash', tendered: 40, by: 'Window' } as any);
  check('someone else’s number put on it meanwhile: their credit isn’t spent', swapped.code === 'credit' && !(await get(`${T}/counterOrders/o9`)).paidAt && (await get(`${T}/clients/c2`)).totalStoreCredit === 8, swapped);

  console.log('a gift card the order no longer needs');
  await card('g6', 'CCCC-1111', 500); await card('g7', 'DDDD-2222', 2500); await seed('o11');
  await L({ action: 'tender', orderId: 'o11', do: 'gift', code: 'CCCC-1111' }); await L({ action: 'tender', orderId: 'o11', do: 'gift', code: 'DDDD-2222' });
  await db.doc(`${T}/counterOrders/o11`).set({ total: 4 }, { merge: true });
  r = await L({ action: 'paid', orderId: 'o11', method: 'tender' });
  const g6 = await get(`${T}/giftCards/g6`), g7 = await get(`${T}/giftCards/g7`);
  check('paid by the first; the second’s hold is let go, its balance untouched', r.body.ok && g6.balanceCents === 100 && g7.balanceCents === 2500 && !g7.holds?.counter_o11 && !g6.holds?.counter_o11, [r.body, g6.holds, g7.holds]);
  await card('g8', 'EEEE-3333', 2500); await seed('o12', { status: 'done' });
  r = await L({ action: 'tender', orderId: 'o12', do: 'gift', code: 'EEEE-3333' });
  check('an order the kitchen has finished takes one too', r.body.ok, r.body);

  console.log('before the guest is asked for the rest');
  const CMS = await import('../../src/lib/counter-money-server');
  const still = async (id: string) => db.runTransaction(async (tx: any) => CMS.tendersStillCover(tx, db, 't1', await get(`${T}/counterOrders/${id}`), id));
  check('its gift card still covers its part: nothing to say', (await still('o12')) === null);
  await db.doc(`${T}/giftCards/g8`).set({ balanceCents: 100 }, { merge: true });
  check('…not any more: the reader and scan to pay don’t start, and say which', /Gift card ••3333 doesn’t cover its part any more/.test(String(await still('o12'))));
  await db.doc(`${T}/giftCards/g8`).set({ balanceCents: 2500, expiresAt: ago(60) }, { merge: true });
  check('…an expired card: the same', /Gift card ••3333 doesn’t cover its part any more/.test(String(await still('o12'))));
  check('…store credit with someone else’s number on the order now: the same', /used with their rewards code/.test(String(await still('o9'))));
  const cc0 = src('src/lib/counter-card.ts'), cp0 = src('src/lib/counter-phone.ts');
  check('the reader and scan to pay check it in the same step that starts them', cc0.includes('const tenderBad = await tendersStillCover(tx, db, tenantId, or, orderId);') && cp0.includes('const tenderBad = await tendersStillCover(tx, db, tenantId, o, orderId);') && cp0.includes('if (await tendersStillCover(tx, db, tenantId, x, orderId)) return { tender: true };'));
  check('one that fails as it’s paid: the card payment goes back, and that one comes off the order', cc0.includes("if (!r.ok && (r.code === 'gift' || r.code === 'credit')) {\n    await giveBack(db, stripe, acct, tenantId, orderId, taken, claim.number);\n    const off: any = await removeTender(") && cc0.includes("off?.ok ? 'Take the payment again.'")
    && cp0.includes("if (!r.ok && (r.code === 'gift' || r.code === 'credit')) {") && cp0.includes('return { ok: true, paid: false, notKept: true, changed: true };') && src('src/app/api/counter/pay/route.ts').includes('error: r.changed ? CHANGED : NOT_KEPT'));

  console.log('the reader, scan to pay, the receipt and the night');
  const cc = src('src/lib/counter-card.ts'), cp = src('src/lib/counter-phone.ts');
  check('the card reader and scan to pay ask only what’s left', cc.includes('const amount = dueCentsOf(or);') && cc.includes('if (dueCentsOf(o) !== cents) return { notKept: true, number: o.number };') && cp.includes('const cents = dueCentsOf(or);') && cp.includes("total: or.paidAt ? num(or.total) : dueCentsOf(or) / 100"));
  const CR = await import('../../src/lib/counter-receipt'); const PR = await import('../../src/lib/printing');
  const rc = CR.counterReceipt(o2, 'o2'); const words = PR.receiptDoc(rc, { business: 'x', tz: null }).blocks.map((b: any) => `${b.left || ''} ${b.right || ''}`).join('\n');
  check('the receipt: each part, then the cash handed over', rc.detail.payments.length === 2 && rc.detail.payments[0].label === 'Gift card ••5555' && /Gift card ••5555 \$5\.00/.test(words) && /Cash handed over \$20\.00/.test(words), words);
  check('Today’s sales: split, each part under its way', CR.counterSaleRow(o2, 'o2').paymentMethod === 'split' && CR.counterSaleRow(o2, 'o2').payments.length === 2);
  const NC = await import('../../src/lib/night-close-server');
  const day = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const { report } = await NC.buildNightReport(db, 't1', tenant, day, {});
  const by = Object.fromEntries((report as any).sales.byMethod.map((m: any) => [m.method, m.amount]));
  check('the night: gift cards and store credit each by themselves', by['Gift card'] > 0 && by['Store credit'] === 8 && by['Cash'] > 0, by);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'), dt = src('src/app/drive-thru/[tenantId]/page.tsx'), cm = src('src/components/pos/CounterMoney.tsx');
  check('the counter: Gift card, each one on the order with Take off, Left to pay, and Finish when it’s all covered', page.includes("onClick={() => setMoneyOpen('gift')}") && page.includes('>Take off</button>') && page.includes('<span>Left to pay</span>') && page.includes("method: 'tender' }") && page.includes('Finish: it’s all covered'));
  check('…cash and the reader on what’s left', page.includes("disabled={!!busy || (cash !== '' && !(tendered >= due))} onClick={() => pay('cash', cash === '' ? due : tendered)}") && page.includes('On the card reader: {usd(due)}'));
  check('the drive-thru: the same', dt.includes("onClick={() => setMoneyOpen('gift')}") && dt.includes('Finish: it’s all covered') && dt.includes("{reader ? `Card sends ${usd(dueNow)} to ${reader.label}"));
  check('the panel: the code, scanned or typed; their store credit when they’re a member by their code', cm.includes('>Use the gift card</button>') && cm.includes('{member ? <button') && cm.includes('>Use their store credit</button>') && cm.includes('used with the rewards code on their rewards page')
    && page.includes('member={!!order.points?.verified} needsCode={!!order.points && !order.points.verified}') && dt.includes('member={!!order.points?.verified} needsCode={!!order.points && !order.points.verified}'));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(cm) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b/.test(cm));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
