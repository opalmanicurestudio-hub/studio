// Checks scale labels (design board "Scale labels"): lib/scale-label, lib/counter-scan-server (a sticker scanned at the
// counter or the window), lib/counter-server editOrder (a line from a sticker), api/menu (the business's setting and an
// item's number on the scale), the Menu page card, the item editor's field, and both screens' words.
// - A sticker: 2, the item's number on the scale, the weight or the price, the check digit (12 or 13 digits).
// - The weight: priced from the menu. The price: charged what it says, its weight worked out from the menu, for stock.
// - Off until it's turned on; a code already on an item scans as that item first.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/scale-labels.verify.ts
import { readFileSync } from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

const db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
/** A barcode with its check digit on the end. */
const withCheck = (body: string) => { let s = 0; for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) s += Number(body[i]) * w; return `${body}${(10 - (s % 10)) % 10}`; };

(async () => {
  const L = await import('../../src/lib/scale-label');

  console.log('reading a sticker');
  const lb = { on: true, holds: 'weight', digits: 12, unit: 'lb' } as const;
  const w75 = withCheck('20004200075');
  check('the board’s sticker: 2 00042 00075 8', w75 === '200042000758');
  let r: any = L.readScaleLabel(w75, lb);
  check('12 digits with the weight: item 00042, 0.75 lb', r && r.itemNo === '00042' && r.weight === 0.75 && r.unit === 'lb' && r.code === w75, r);
  check('…spaces or dashes as printed, or sent as 13 with a 0 in front: the same', L.readScaleLabel('2 00042 00075 8', lb)?.itemNo === '00042' && (L.readScaleLabel(`0${w75}`, lb) as any)?.weight === 0.75);
  check('off, a wrong check digit, not starting with 2, no item, nothing weighed, or letters: not a sticker',
    L.readScaleLabel(w75, { ...lb, on: false }) === null && L.readScaleLabel('200042000759', lb) === null && L.readScaleLabel(withCheck('30004200075'), lb) === null
    && L.readScaleLabel(withCheck('20000000075'), lb) === null && L.readScaleLabel(withCheck('20004200000'), lb) === null && L.readScaleLabel('ABC', lb) === null && L.readScaleLabel(w75, { ...lb, digits: 13 }) === null);
  const p4 = withCheck('20004271347');
  r = L.readScaleLabel(p4, { ...lb, holds: 'price4' });
  check('the price, up to $99.99: the scale’s own check digit passed over, $13.47', r && r.cents === 1347 && r.itemNo === '00042', r);
  r = L.readScaleLabel(withCheck('20004201347'), { ...lb, holds: 'price5' });
  const r5 = L.readScaleLabel(withCheck('20004212999'), { ...lb, holds: 'price5' }) as any;
  check('the price, up to $999.99: five digits', r?.cents === 1347 && r5?.cents === 12999, [r, r5]);
  const ean = withCheck('210004200340');
  r = L.readScaleLabel(ean, { on: true, holds: 'weight', digits: 13, unit: 'g' });
  const kg = L.readScaleLabel(withCheck('290004200750'), { on: true, holds: 'weight', digits: 13, unit: 'kg' }) as any;
  check('13 digits (EAN): 2 and one more, then the item: 340 g; in kilograms, thousandths', r?.itemNo === '00042' && r?.weight === 340 && r?.unit === 'g' && kg?.weight === 0.75, [r, kg]);
  check('an item’s number: one to five digits, kept as five; all zeros or more digits isn’t one', L.cleanScaleNo('42') === '00042' && L.cleanScaleNo(' 00042 ') === '00042' && L.cleanScaleNo('0') === null && L.cleanScaleNo('123456') === null && L.cleanScaleNo('4a') === null);
  check('the setting, until it’s set: off, the weight, 12 digits, lb; anything else stays sensible', JSON.stringify(L.scaleSetOf({})) === JSON.stringify(L.SCALE_OFF)
    && JSON.stringify(L.scaleSetOf({ scaleLabels: { on: true, holds: 'nope', digits: 99, unit: 'stone' } })) === JSON.stringify({ on: true, holds: 'weight', digits: 12, unit: 'lb' }));
  check('what the screen says', L.scanAddedWords({ name: 'Beans', label: true, line: { unitPrice: 13.5, weight: { amount: 0.75, unit: 'lb' }, label: { kind: 'weight' } } }) === 'Beans, 0.75 lb, added from its label.'
    && L.scanAddedWords({ name: 'Beans', label: true, line: { unitPrice: 13.47, weight: { amount: 0.75, unit: 'lb' }, label: { kind: 'price' } } }) === 'Beans, $13.47 on its label, added.'
    && L.scanAddedWords({ name: 'Water', pack: 6 }) === 'Water × 6 added.' && L.scanAddedWords({ name: 'Water', pack: 1 }) === 'Water added.');

  console.log('setting it up');
  const MenuApi = await import('../../src/app/api/menu/route');
  const MP = (b: any) => MenuApi.POST(req({ tenantId: 't1', ...b })) as Promise<any>;
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/beans`).set({ type: 'refreshment', name: 'House blend beans', category: 'Coffee', price: 18, totalStock: 160, unit: 'oz', byWeight: { unit: 'lb' } });
  await db.doc(`${T}/inventory/fudge`).set({ type: 'refreshment', name: 'Fudge', category: 'Sweets', price: 2.4, totalStock: 50, byWeight: { unit: 'oz' } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Drinks', price: 5.25, totalStock: 50 });
  r = await MP({ action: 'save', itemId: 'beans', item: { name: 'House blend beans', price: 18, section: 'Coffee', scaleNo: '42' } });
  check('an item sold by weight gets its number on the scale (kept as five digits)', r.body.ok && (await get(`${T}/inventory/beans`)).scaleNo === '00042', r.body);
  r = await MP({ action: 'save', itemId: 'fudge', item: { name: 'Fudge', price: 2.4, section: 'Sweets', scaleNo: '00042' } });
  check('…one item to a number', r.status === 409 && /House blend beans has scale number 00042/.test(r.body.error) && !(await get(`${T}/inventory/fudge`)).scaleNo, r.body);
  r = await MP({ action: 'save', itemId: 'latte', item: { name: 'Oat latte', price: 5.25, section: 'Drinks', scaleNo: '7' } });
  const r2 = await MP({ action: 'save', itemId: 'fudge', item: { name: 'Fudge', price: 2.4, section: 'Sweets', scaleNo: '12a' } });
  check('…only on an item sold by weight; digits only', r.status === 400 && /sold by weight/.test(r.body.error) && r2.status === 400, [r.body, r2.body]);
  await MP({ action: 'save', itemId: 'fudge', item: { name: 'Fudge', price: 2.4, section: 'Sweets', scaleNo: '51' } });
  r = await MP({ action: 'save', itemId: 'fudge', item: { name: 'Fudge', price: 2.4, section: 'Sweets', byWeight: null } });
  check('no longer sold by weight: its number goes with it', r.body.ok && !(await get(`${T}/inventory/fudge`)).scaleNo, await get(`${T}/inventory/fudge`));
  await MP({ action: 'save', itemId: 'fudge', item: { name: 'Fudge', price: 2.4, section: 'Sweets', byWeight: 'oz', scaleNo: '51' } });
  r = await MP({ action: 'list' });
  check('the Menu page gets the setting (off) and each item’s number', r.body.scale?.on === false && r.body.menu.find((m: any) => m.id === 'beans')?.scaleNo === '00042' && r.body.menu.find((m: any) => m.id === 'latte')?.scaleNo === null, r.body.scale);
  r = await MP({ action: 'laneSettings', scaleLabels: { holds: 'nope' } });
  const r3 = await MP({ action: 'laneSettings', scaleLabels: { digits: 14 } }); const r4 = await MP({ action: 'laneSettings', scaleLabels: { unit: 'stone' } });
  check('the setting takes only what a scale prints', r.status === 400 && r3.status === 400 && r4.status === 400);

  console.log('at the counter');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Counter', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  let n = 0;
  const scanOn = async (id: string, code: string, tap = `tap-scale-${++n}-xyz`) => P({ action: 'scan', orderId: id, code, tapKey: tap });
  const lines = async (id: string) => (await get(`${T}/counterOrders/${id}`)).lines || [];
  const o1 = (await P({ action: 'car', carKey: 'scale-a' })).body.orderId;
  r = await scanOn(o1, w75);
  check('off: a sticker is a code on nothing yet (the counter asks which item it is)', r.status === 404 && r.body.code === 'unknown' && (await lines(o1)).length === 0, r.body);
  r = await MP({ action: 'laneSettings', scaleLabels: { on: true } });
  check('turned on: the weight, 12 digits, lb', r.body.ok && JSON.stringify(r.body.lane.scaleLabels) === JSON.stringify({ on: true, holds: 'weight', digits: 12, unit: 'lb' }) && (await get(T)).scaleLabels.on === true, r.body);
  r = await scanOn(o1, w75, 'tap-scale-same-1');
  await scanOn(o1, w75, 'tap-scale-same-1');
  let ls = await lines(o1);
  check('scanned: House blend beans at 0.75 lb, priced from the menu ($13.50), said as from its label; sent twice, once', r.body.ok && r.body.label === true && ls.length === 1 && ls[0].itemId === 'beans'
    && ls[0].unitPrice === 13.5 && ls[0].weight?.amount === 0.75 && ls[0].weight.stock === 12 && ls[0].label?.kind === 'weight' && ls[0].label.code === w75 && ls[0].choicesText === '0.75 lb at $18.00/lb, from its label', ls);
  await scanOn(o1, w75);
  check('another sticker: a line of its own', (await lines(o1)).length === 2);
  await db.doc(`${T}/inventory/beans`).set({ price: 20 }, { merge: true });
  r = await scanOn(o1, w75);
  check('the menu’s price now, not the price when it was weighed', r.body.line?.unitPrice === 15, r.body.line);
  await db.doc(`${T}/inventory/beans`).set({ price: 18 }, { merge: true });
  await P({ action: 'remove', orderId: o1, lineId: r.body.line.lineId, tapKey: 'tap-scale-rm-1' });
  await db.doc(`${T}/inventory/water`).set({ type: 'refreshment', name: 'Sparkling water', category: 'Drinks', price: 2, totalStock: 20, barcode: withCheck('20009900001') });
  // (Its code in the one index of codes, as saving it in Inventory does: lib/code-index.)
  const { buildCodeIndex } = await import('../../src/lib/code-index');
  await buildCodeIndex(db, 't1', { by: 'Test' });
  r = await scanOn(o1, withCheck('20009900001'));
  check('a code already on an item scans as that item, even one that starts with 2', r.body.ok && !r.body.label && r.body.name === 'Sparkling water', r.body);
  r = await scanOn(o1, withCheck('20005500075'));
  check('a number no item has: a code on nothing yet, as any code is (the counter offers to put it on an item), with the scale number it would be', r.status === 404 && r.body.code === 'unknown' && r.body.scaleNo === '00055' && /isn’t on anything yet/.test(r.body.error), r.body);
  for (let i = 0; i < 6; i++) await db.doc(`${T}/inventory/old${i}`).set({ type: 'refreshment', name: `Old beans ${i}`, price: 10, archived: true, byWeight: { unit: 'lb' }, scaleNo: '00042' });
  r = await scanOn(o1, w75);
  check('items put away that still have the number never hide the one on the menu', r.body.ok && r.body.line?.itemId === 'beans', r.body);
  await P({ action: 'remove', orderId: o1, lineId: r.body.line.lineId, tapKey: 'tap-scale-rm-2' });
  await db.doc(`${T}/inventory/latte`).set({ scaleNo: '00077' }, { merge: true });
  r = await scanOn(o1, withCheck('20007700075'));
  check('an item not sold by weight (its number set some other way): not rung in by its label', r.status === 409 && r.body.code === 'not_weighed', r.body);
  r = await scanOn(o1, withCheck('20004299999'));
  check('more than one weighing can be (999.99 lb): weigh it at the counter', r.status === 400 && r.body.code === 'scale_weight', r.body);
  r = await P({ action: 'send', orderId: o1 });
  check('sent: 24 oz of beans off stock (two 0.75 lb stickers, counted in ounces)', r.body.ok && (await get(`${T}/inventory/beans`)).totalStock === 136, [r.body, (await get(`${T}/inventory/beans`)).totalStock]);

  console.log('a sticker with the price');
  await MP({ action: 'laneSettings', scaleLabels: { holds: 'price4' } });
  const o2 = (await P({ action: 'car', carKey: 'scale-b' })).body.orderId;
  r = await scanOn(o2, p4);
  ls = await lines(o2);
  check('charged what it says ($13.47), its weight from the menu’s price for stock (0.75 lb, 12 oz)', r.body.ok && ls[0].unitPrice === 13.47 && ls[0].weight?.amount === 0.75 && ls[0].weight.stock === 12 && ls[0].label?.kind === 'price'
    && ls[0].choicesText === 'About 0.75 lb, priced on its label', ls[0]);
  const od = await get(`${T}/counterOrders/${o2}`);
  check('…the order’s money is from it ($13.47 + 10% tax)', od.subtotal === 13.47 && od.tax === 1.35 && od.total === 14.82, [od.subtotal, od.tax, od.total]);
  await MP({ action: 'laneSettings', scaleLabels: { holds: 'price5' } });
  r = await scanOn(o2, withCheck('20005100002'));
  ls = await lines(o2);
  check('a few cents of fudge: at least the least a weighing is, for stock', r.body.ok && ls[1].unitPrice === 0.02 && ls[1].weight?.amount === 0.01 && ls[1].weight.unit === 'oz', ls[1]);
  await MP({ action: 'laneSettings', scaleLabels: { holds: 'weight', digits: 13, unit: 'g' } });
  r = await scanOn(o2, ean);
  check('13 digits in grams, for an item priced by the pound: 340 g is 0.75 lb, $13.50', r.body.ok && r.body.line?.weight?.amount === 0.75 && r.body.line.unitPrice === 13.5, r.body.line);
  r = await scanOn(o2, w75);
  check('a 12-digit sticker once it’s set to 13: not one of its stickers', r.status === 404 && r.body.code === 'unknown', r.body);
  await db.doc(`${T}/inventory/fudge`).set({ scaleNo: '00042' }, { merge: true });
  r = await scanOn(o2, ean);
  check('two items with one number (set some other way): said, nothing added', r.status === 409 && r.body.code === 'many' && (await lines(o2)).length === 3, r.body);
  await db.doc(`${T}/inventory/fudge`).set({ scaleNo: '00051' }, { merge: true });
  const sent = await P({ action: 'send', orderId: o2 }); await P({ action: 'paid', orderId: o2, method: 'cash', tendered: 50 });
  const RC = await import('../../src/lib/counter-receipt');
  const rl = RC.counterReceipt(await get(`${T}/counterOrders/${o2}`), o2).detail.lines;
  check('the receipt says it was from its label', sent.body.ok && rl.some((l: any) => /House blend beans \(About 0\.75 lb, priced on its label\)/.test(l.label) && l.amount === 13.47), rl);

  console.log('the screens');
  const cp = src('src/app/(app)/counter/page.tsx'), dp = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('…and the prompt for a code on nothing yet says the scale number, the other way to it', /setCodeScale\(d\.scaleNo \|\| null\)/.test(cp) && /setCodeScale\(d\.scaleNo \|\| null\)/.test(dp) && /scaleNo=\{codeScale\}/.test(cp) && /scaleNo=\{codeScale\}/.test(dp)
    && /A sticker from your scale\? Give the item scale number \{scaleNo\} on the Menu page instead/.test(src('src/components/pos/CounterScan.tsx')));
  check('the counter and the window say what a sticker added', /setNotice\(\{ text: scanAddedWords\(d\), tone: 'good' \}\)/.test(cp) && /setNotice\(\{ text: scanAddedWords\(d\), tone: 'good' \}\)/.test(dp));
  const mp = src('src/app/(app)/menu/page.tsx'), card = src('src/components/menu/ScaleLabelsCard.tsx'), ib = src('src/components/menu/ItemBuilder.tsx');
  check('the Menu page’s settings have the card; the item editor its number, under Sold by weight', /<ScaleLabelsCard start=\{scaleSet\} call=\{call\} \/>/.test(mp) && /setScaleSet\(d\.scale \|\| null\)/.test(mp)
    && /Its number on the scale/.test(ib) && /byWeight && scaleNo\.trim\(\) !== \(item\.scaleNo \|\| ''\)/.test(ib) && /action: 'laneSettings', scaleLabels: patch/.test(card));
  check('each choice is a 44px radio; on or off is a button that says what it does', /role="radio"/.test(card) && /min-h-\[44px\]/.test(card) && /Turn them on/.test(card) && /Turn them off/.test(card));

  console.log('house style');
  for (const f of ['src/lib/scale-label.ts', 'src/components/menu/ScaleLabelsCard.tsx', 'src/lib/counter-scan-server.ts']) {
    const s = src(f);
    check(`${f}: no shouting or heavy type, no " · ", no old trade words, no comments in markup`, !/\buppercase\b|font-black| · |\{\/\*/.test(s) && !/\b(salon|stylist|booth|chair|studio)s?\b/i.test(s));
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
