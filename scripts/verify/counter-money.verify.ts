// Checks tips and discounts at the counter and the drive-thru (design board "Money at the counter"; lib/counter-money,
// lib/counter-money-server, api/counter 'tip' / 'discount' / 'paid' keepChange, lib/counter-server payOrder, the reward
// beside a discount (lib/counter-points), the receipt, the night's report, the Menu page's settings, the screens).
// - Tips: off until the business turns them on; at the counter, or the drive-thru too. The guest's tip is in the order's
//   total, so the card is charged once and cash counts it; kept change is a tip; each is a Tips line under whoever took
//   the payment.
// - Discounts: the business's list for anyone; another amount only with a manager, a reason, and a record. Off before tax,
//   beside a reward, never more than the items; never once it's paid or while the reader is asking.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-money.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
const db: any = makeDb();
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const audits: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { void Promise.resolve().then(fn); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
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

(async () => {
  const CM = await import('../../src/lib/counter-money');
  const CO = await import('../../src/lib/counter-orders');
  console.log('the rules');
  check('tips are off until turned on; three percents, the counter only by default', !CM.tipsOf({}).on && CM.tipsOf({}).pcts.join() === '15,18,20' && CM.tipsOf({}).where === 'counter'
    && CM.tipsOf({ counterTips: { on: true, pcts: [20, 10, 15], where: 'both' } }).pcts.join() === '10,15,20' && CM.tipsOf({ counterTips: { on: true, pcts: [10, 99, 15] } }).pcts.join() === '15,18,20');
  check('…asked at the drive-thru only when the business says so', CM.tipsHere({ on: true, pcts: [15, 18, 20], where: 'counter' }, 'counter') && !CM.tipsHere({ on: true, pcts: [15, 18, 20], where: 'counter' }, 'drive-thru') && CM.tipsHere({ on: true, pcts: [15, 18, 20], where: 'both' }, 'drive-thru') && !CM.tipsHere({ on: false, pcts: [15, 18, 20], where: 'both' }, 'counter'));
  check('each percent of what the order comes to', JSON.stringify(CM.tipChoices(1662, [15, 18, 20])) === JSON.stringify([{ pct: 15, cents: 249 }, { pct: 18, cents: 299 }, { pct: 20, cents: 332 }]));
  check('a typed tip: never below zero, more than the order, or the cap', CM.cleanTip(-5, 1000) === null && CM.cleanTip('x', 1000) === null && CM.cleanTip(250, 1000) === 250 && CM.cleanTip(5000, 1000) === 1000 && CM.cleanTip(90000, 200000) === CM.TIP_MAX_CENTS);
  check('a discount needs a name and a percent from 1 to 100 or an amount off up to $500', !CM.cleanDiscount({ label: '', kind: 'pct', value: 10 }) && !CM.cleanDiscount({ label: 'X', kind: 'pct', value: 101 }) && !CM.cleanDiscount({ label: 'X', kind: 'off', value: 50001 }) && CM.cleanDiscount({ label: 'Student', kind: 'pct', value: 10 })?.id === 'student');
  check('…the list: each name once, eight at most', CM.discountsOf({ counterDiscounts: [{ label: 'A', kind: 'pct', value: 5 }, { label: 'A', kind: 'pct', value: 6 }, ...Array.from({ length: 10 }, (_, i) => ({ label: `D${i}`, kind: 'off', value: 100 }))] }).length === 8);
  check('off the items, after a reward, never past zero', CM.discountCents({ kind: 'pct', value: 10 }, 1825) === 183 && CM.discountCents({ kind: 'off', value: 500 }, 1825, 1500) === 325 && CM.discountCents({ kind: 'pct', value: 50 }, 1000, 1000) === 0);

  console.log('a tip and a discount, at the drive-thru with its own key');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const tenant: any = { name: 'North Pier Coffee', timezone: 'UTC', businessType: 'hospitality', plan: 'pro', retailSettings: { taxRatePercent: 8 }, salesTax: { configured: true },
    counterDiscounts: [{ id: 'student', label: 'Student', kind: 'pct', value: 10 }, { id: 'team', label: 'Team', kind: 'pct', value: 50 }] };
  await db.doc(T).set(tenant);
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/b1`).set({ name: 'Bo Lin', role: 'barista', isActive: true });
  const P = await import('../../src/lib/pin'); await P.setStaffPin(db, 't1', 'm9', '4321'); await P.setStaffPin(db, 't1', 'b1', '1111');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const L = (b: any) => LANE(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const seed = async (id: string, x: any = {}) => db.doc(`${T}/counterOrders/${id}`).set({ number: 'D31', channel: 'drive-thru', status: 'sent', guestName: 'Lee', paidAt: null, lines, ...CO.totalsOf(tenant, lines as any), day: new Date().toISOString().slice(0, 10), createdAt: ago(3), ...x });
  await seed('o1');
  const base = (await get(`${T}/counterOrders/o1`)).total;
  let r = await L({ action: 'tip', orderId: 'o1', cents: 300 });
  check('tips off: refused', r.status === 409 && /Tips aren’t taken here/.test(r.body.error) && !(await get(`${T}/counterOrders/o1`)).tipCents);
  await db.doc(T).set({ counterTips: { on: true, pcts: [15, 18, 20], where: 'counter' } }, { merge: true });
  r = await L({ action: 'tip', orderId: 'o1', cents: 300 });
  check('on at the counter only: still not at the drive-thru', r.status === 409);
  await db.doc(T).set({ counterTips: { on: true, pcts: [15, 18, 20], where: 'both' } }, { merge: true });
  r = await L({ action: 'tip', orderId: 'o1', cents: 300 });
  let o1 = await get(`${T}/counterOrders/o1`);
  check('the tip is on the order and in its total', r.body.ok && o1.tipCents === 300 && Math.abs(o1.total - (base + 3)) < 0.001 && o1.tipBy?.name === 'Window', [r.body, o1.total, base]);
  r = await L({ action: 'tip', orderId: 'o1', cents: 200 }); o1 = await get(`${T}/counterOrders/o1`);
  check('…changed, not added twice', r.body.ok && o1.tipCents === 200 && Math.abs(o1.total - (base + 2)) < 0.001);
  r = await L({ action: 'discount', orderId: 'o1', discountId: 'student' }); o1 = await get(`${T}/counterOrders/o1`);
  const off = Math.round(1825 * 0.1);
  check('a discount from the list: off before tax, the tip kept', r.body.ok && o1.markdown.label === 'Student' && o1.markdown.cents === off && o1.subtotal === (1825 - off) / 100 && o1.discount === off / 100 && o1.itemsTotal === 18.25
    && Math.abs(o1.total - (CO.totalsOf(tenant, lines as any, off / 100).total + 2)) < 0.001 && o1.tipCents === 200, o1);
  r = await L({ action: 'discount', orderId: 'o1', custom: { kind: 'off', value: 300, reason: 'Wrong drink' } });
  check('another amount with no manager: asks for one, nothing changes', r.status === 403 && r.body.needsManager && (await get(`${T}/counterOrders/o1`)).markdown.id === 'student');
  r = await L({ action: 'discount', orderId: 'o1', custom: { kind: 'off', value: 300, reason: 'Wrong drink' }, pin: '1111' });
  check('…a PIN that isn’t a manager’s: refused', r.status === 403 && /isn’t a manager’s PIN/.test(r.body.error));
  r = await L({ action: 'discount', orderId: 'o1', custom: { kind: 'off', value: 300, reason: '' }, pin: '4321' });
  check('…a reason is needed', r.status === 400 && /Say why/.test(r.body.error));
  r = await L({ action: 'discount', orderId: 'o1', custom: { kind: 'off', value: 300, reason: 'Wrong drink' }, pin: '4321' }); o1 = await get(`${T}/counterOrders/o1`);
  check('…with a manager’s PIN: taken off, who okayed it kept, and on record', r.body.ok && r.body.approvedBy === 'Mo Diaz' && o1.markdown.custom === true && o1.markdown.okBy === 'Mo Diaz' && o1.markdown.cents === 300 && o1.subtotal === 15.25
    && audits.some((a) => a.action === 'counter.discount' && /Mo Diaz okayed \$3\.00 off D31 \(Wrong drink\)/.test(a.summary)), [r.body, audits]);
  check('…the guest sees just “Discount”: the reason is for the record', o1.markdown.label === 'Discount' && o1.markdown.reason === 'Wrong drink'
    && (await import('../../src/lib/counter-receipt')).counterReceipt({ ...o1, paidAt: ago(1), payMethod: 'card' }, 'o1').discounts.every((d: any) => d.label !== 'Wrong drink'));
  r = await L({ action: 'discount', orderId: 'o1' }); o1 = await get(`${T}/counterOrders/o1`);
  check('…none takes it off (the tip stays)', r.body.ok && !o1.markdown && o1.subtotal === 18.25 && o1.discount === 0 && Math.abs(o1.total - (base + 2)) < 0.001);
  await seed('o2', { status: 'building' }); await seed('o3', { paidAt: ago(1), payMethod: 'card' }); await seed('o4', { card: { id: 'pi_1', state: 'on_reader', at: new Date().toISOString() }, cardOpen: true });
  const no = await Promise.all([L({ action: 'tip', orderId: 'o2', cents: 100 }), L({ action: 'tip', orderId: 'o3', cents: 100 }), L({ action: 'discount', orderId: 'o4', discountId: 'student' }), L({ action: 'discount', orderId: 'o3', discountId: 'student' })]);
  check('never before it’s sent, once it’s paid, or while the reader is asking', no.every((x: any) => x.status === 409), no.map((x: any) => [x.status, x.body.error]));
  await seed('o5k', { channel: 'kiosk', kiosk: { screen: 'x' } });
  const kk: any = await (await import('../../src/lib/counter-money-server')).setTip(db, 't1', 'o5k', 100, { id: null, name: 'Window' });
  check('a kiosk’s order is paid at the kiosk: no tip or discount from a lane screen', kk.status === 409 && kk.code === 'kiosk', kk);
  await seed('o5', { ahead: { way: 'delivery' }, tipCents: 300 });
  check('a delivery’s tip is the driver’s, chosen when it was ordered', (await L({ action: 'tip', orderId: 'o5', cents: 100 })).status === 409);

  console.log('paid with the tip in it');
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  o1 = await get(`${T}/counterOrders/o1`);
  r = await L({ action: 'paid', orderId: 'o1', method: 'cash', tendered: 30 });
  const tipLine = await get(`${T}/transactions/ctip_o1`); const till = await get(`${T}/tillSessions/till1`);
  check('cash against the total with the tip; the drawer counts it all', r.body.ok && Math.abs(r.body.change - (30 - o1.total)) < 0.001 && Math.abs(till.expectedCash - (100 + o1.total)) < 0.001, [r.body, till]);
  check('…a Tips line, apart from the sale (no name on the screen: no one on it yet)', tipLine && tipLine.category === 'Tips' && tipLine.amount === 2 && tipLine.staffId === null && tipLine.taxBucket === 'gratuity' && /^Tip, Drive-thru D31/.test(tipLine.description)
    && (await get(`${T}/transactions/counter_o1`)).amount === 18.25, tipLine);
  await seed('o6', { number: 'D32' });
  const o6 = await get(`${T}/counterOrders/o6`);
  r = await L({ action: 'paid', orderId: 'o6', method: 'cash', tendered: 20, keepChange: true, staffPass: undefined });
  const k6 = await get(`${T}/counterOrders/o6`); const kl = await get(`${T}/transactions/ctip_o6`);
  check('kept the change: the total is what was handed over, no change, the rest a tip', r.body.ok && r.body.keptChange && r.body.change === 0 && k6.total === 20 && k6.keptChange && k6.tipCents === Math.round(2000 - o6.total * 100) && kl.amount === Math.round(2000 - o6.total * 100) / 100 && /kept the change/.test(kl.description), [r.body, k6]);
  await seed('o6b', { number: 'D35' });
  r = await L({ action: 'paid', orderId: 'o6b', method: 'cash', tendered: 200, keepChange: true });
  check('kept change more than the order (a mistyped amount): refused, nothing paid', r.status === 400 && /a lot to keep as a tip/.test(r.body.error) && !(await get(`${T}/counterOrders/o6b`)).paidAt && !(await get(`${T}/transactions/ctip_o6b`)));
  await db.doc(T).set({ counterTips: { on: false } }, { merge: true }); await seed('o7', { number: 'D33' });
  check('…not when the business doesn’t take tips', (await L({ action: 'paid', orderId: 'o7', method: 'cash', tendered: 50, keepChange: true })).status === 409 && !(await get(`${T}/counterOrders/o7`)).paidAt);
  await db.doc(T).set({ counterTips: { on: true, pcts: [15, 18, 20], where: 'both' } }, { merge: true });
  const CS = await import('../../src/lib/counter-server');
  await seed('o8', { number: 'D34' }); await L({ action: 'tip', orderId: 'o8', cents: 250 });
  const o8 = await get(`${T}/counterOrders/o8`);
  const wrong = await CS.payOrder(db, 't1', 'o8', { method: 'card', by: 'Window', byId: 'b1', card: { id: 'pi_9', cents: Math.round((o8.total - 2.5) * 100) } } as any);
  const right = await CS.payOrder(db, 't1', 'o8', { method: 'card', by: 'Bo Lin', byId: 'b1', card: { id: 'pi_9', cents: Math.round(o8.total * 100) } } as any);
  check('the card reader is charged once, the tip in it (not the total without it)', (wrong as any).error && (right as any).ok && (await get(`${T}/transactions/ctip_o8`)).staffId === 'b1', [wrong, right]);

  console.log('a reward beside a discount');
  const CMS = await import('../../src/lib/counter-money-server');
  const withBoth = { lines, reward: { cents: 300 }, markdown: { kind: 'pct', value: 10 }, tipCents: 200 };
  const md = CM.markdownCentsOf(withBoth); const m2 = CMS.moneyWith(tenant, withBoth, md);
  check('both off before tax, the tip on top', md === 183 && m2.discount === 4.83 && m2.subtotal === 13.42 && Math.abs(m2.total - (CO.totalsOf(tenant, lines as any, 4.83).total + 2)) < 0.001);
  const cp = src('src/lib/counter-points.ts');
  check('…using or taking off a reward keeps the discount and the tip', (cp.match(/moneyWith\(tenant, o2, md\)/g) || []).length === 2 && cp.includes('markdown: { ...o.markdown, cents: md }'));

  console.log('the receipt and the night');
  const CR = await import('../../src/lib/counter-receipt'); const PR = await import('../../src/lib/printing');
  const rc = CR.counterReceipt({ ...k6, reward: { name: 'Free drink', cents: 300 }, markdown: { label: 'Student', cents: 183 }, paidAt: ago(1) }, 'o6');
  check('each by name on the receipt; the tip kept from the change', rc.discounts.length === 2 && rc.discounts[0].label === 'Reward' && rc.discounts[1].label === 'Student' && rc.discounts[1].amount === 1.83 && rc.keptChange === true
    && PR.receiptDoc(rc, { business: 'x', tz: null }).blocks.some((b: any) => b.k === 'money' && b.left === 'Tip, kept the change'));
  const NC = await import('../../src/lib/night-close-server');
  await db.doc(`${T}/counterOrders/o1`).set({ markdown: { label: 'Wrong drink', custom: true, cents: 300, okBy: 'Mo Diaz' }, reward: { name: 'Free drink', cents: 250 } }, { merge: true });
  await db.doc(`${T}/counterOrders/o8`).set({ markdown: { label: 'Student', cents: 183 } }, { merge: true });
  // (The night runs from 4 in the morning to 4 the next: lib/night-close-server nightBounds.)
  const day = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const { report } = await NC.buildNightReport(db, 't1', { ...tenant, timezone: 'UTC' }, day, {});
  const dsc: any = (report as any).discounts;
  check('the night’s report: discounts by name, another amount as one, and who okayed them', dsc && dsc.count === 3 && dsc.total === 7.33 && dsc.byLabel.some((x: any) => x.label === 'Other amounts' && x.amount === 3) && dsc.byLabel.some((x: any) => x.label === 'Rewards' && x.amount === 2.5)
    && dsc.okayed.length === 1 && dsc.okayed[0].label === 'Mo Diaz', dsc);
  const NCL = await import('../../src/lib/night-close');
  check('…in the emailed text too', /Discounts \$7\.33 \(3\): .*Okayed by Mo Diaz \$3\.00\./.test(NCL.reportText('North Pier Coffee', report as any)));
  check('…and on the screen (an older report without it still shows)', src('src/components/close/NightReportView.tsx').includes('{(r.discounts?.count || 0) > 0 && <Card title="Discounts"'));

  console.log('the settings');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  const mu = (b: any) => MENU(req({ tenantId: 't1', action: 'laneSettings', ...b })) as Promise<any>;
  r = await mu({ tips: { on: true, pcts: [18, 20, 25], where: 'counter' } });
  check('tips: on, the percents, the counter only', r.body.ok && r.body.lane.tips.pcts.join() === '18,20,25' && (await get(T)).counterTips.on === true && (await get(T)).counterTips.where === 'counter');
  check('…a percent past 50 is refused', (await mu({ tips: { on: true, pcts: [18, 20, 60] } })).status === 400);
  r = await mu({ discounts: [{ label: 'Student', kind: 'pct', value: 10 }, { label: 'Student', kind: 'off', value: 100 }, { label: 'Neighbor', kind: 'off', value: 100 }] });
  check('discounts: saved, a name used twice kept apart', r.body.ok && r.body.lane.discounts.length === 3 && new Set(r.body.lane.discounts.map((d: any) => d.id)).size === 3);
  check('…one with no amount is refused', (await mu({ discounts: [{ label: 'Bad', kind: 'pct', value: 0 }] })).status === 400);
  const ml = await MENU(req({ tenantId: 't1', action: 'list' })) as any;
  check('the Menu page reads them', ml.body.money?.tips?.pcts.join() === '18,20,25' && ml.body.money.discounts.length === 3);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'), dt = src('src/app/drive-thru/[tenantId]/page.tsx'), cmc = src('src/components/pos/CounterMoney.tsx'), card = src('src/components/menu/CounterMoneyCard.tsx');
  check('the counter: Tip and Discount before paying, Keep the change, a manager’s PIN for another amount', page.includes("onClick={() => setMoneyOpen('tip')}") && page.includes("onClick={() => setMoneyOpen('discount')}") && page.includes("onClick={() => pay('cash', tendered, true)}")
    && page.includes('{discountPin && <PinPad check={discountPinCheck}'));
  check('…the tip and the discount on the order', page.includes('{order.markdown && <div className="flex justify-between gap-3" style={{ color: GREEN }}>') && page.includes("Tip{order.keptChange ? ', kept the change' : ''}"));
  check('the drive-thru: the same, with a manager’s pass', dt.includes("onClick={() => setMoneyOpen('discount')}") && dt.includes("onClick={() => paid('cash', cash, true)}") && dt.includes('void customOff(c, s.pass);'));
  const win = src('src/app/drive-thru/[tenantId]/window/page.tsx'), capi = src('src/app/api/counter/route.ts');
  check('the screen at the window shows the discount and the tip, each by itself', capi.includes("off: num(o.reward.cents) / 100 || num(o.discount)") && capi.includes("markdown: (shown.mode === 'pay' || shown.mode === 'paid') && o.markdown") && win.includes('{s.markdown && <p') && win.includes('{(s.tip || 0) > 0 && <p'));
  check('Add a tip? turned to the guest: three percents, another amount, no tip', cmc.includes('>Add a tip?</p>') && cmc.includes('>Other amount</button>') && cmc.includes('>No tip</button>') && cmc.includes('Another amount takes a manager. It’s kept on record with who okayed it.'));
  check('Menu: Tips and discounts', card.includes('>Tips and discounts</span>') && card.includes('Save the percents') && card.includes('Save the discounts') && src('src/app/(app)/menu/page.tsx').includes('<CounterMoneyCard start={moneySet} call={call} />'));
  check('house style', [cmc, card].every((x) => !/ · |\buppercase\b|font-black|\{\/\*/.test(x)) && ![cmc, card, src('src/lib/counter-money.ts')].some((x) => /[Ss]alon|[Ss]tylist|\bbooth|\bchair\b/.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
