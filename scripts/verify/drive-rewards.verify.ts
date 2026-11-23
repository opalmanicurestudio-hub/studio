// Checks rewards at the drive-thru (design canvas: Rewards at the drive-thru): lib/rewards-code, the code on the member's
// rewards page (api/loyalty/public 'code'), api/counter 'rewardsCode' / 'rewards' / 'reward', lib/counter-points useReward,
// what payOrder and voidOrder do with a reward, the window screen, and the free menu item reward.
// - Six digits from the member's own page, new every 5 minutes; the one just before still works; others never do.
// - A code links the order and lets them use a reward; a phone number only earns.
// - A reward is used on a sent, unpaid order: held in the ledger, off the subtotal before tax; taken off or voided, it's
//   given back; paid, it's used; a full refund gives it back. Points are earned on what was paid.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-rewards.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret-for-codes';
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
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const src = (p: string) => fs.readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const RC = await import('../../src/lib/rewards-code');
  const LY = await import('../../src/lib/loyalty');
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: PUBLIC } = await import('../../src/app/api/loyalty/public/route');
  const { rewardsKey } = await import('../../src/lib/loyalty-link');
  const L = await import('../../src/lib/loyalty-server');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, modules: { hospitality: true },
    loyalty: { on: true, earn: { mode: 'per_dollar', perDollar: 2 }, rewards: [{ id: 'five', name: '$5 off', points: 300, kind: 'amount_off', cents: 500, on: true }, { id: 'drip', name: 'A free drip', points: 150, kind: 'free_item', itemId: 'drip', on: true }, { id: 'big', name: '$50 off', points: 5000, kind: 'amount_off', cents: 5000, on: true }] } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 100 });
  await db.doc(`${T}/inventory/drip`).set({ type: 'refreshment', name: 'Drip', category: 'Coffee', price: 2.5, totalStock: 100 });
  await db.doc(`${T}/clients/c1`).set({ name: 'Kim Park', firstName: 'Kim', phone: '(555) 123-4567', status: 'active' });
  await db.doc(`${T}/clients/c2`).set({ name: 'Dev Shah', firstName: 'Dev', phone: '(555) 999-0000', status: 'active' });
  await db.doc(`${T}/loyaltyLedger/seed1`).set({ clientId: 'c1', type: 'adjust', points: 400, at: new Date().toISOString() });
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b }));
  let n = 0;
  const newOrder = async (send = true, item = 'burger', qty = 2) => {
    const c = (await P({ action: 'car', carKey: `carkey-rw-${++n}` })).body;
    await P({ action: 'add', orderId: c.orderId, itemId: item, quantity: qty, tapKey: `tap-rw-${n}` });
    if (send) await P({ action: 'send', orderId: c.orderId });
    return c;
  };
  const balance = async (cid = 'c1') => L.balanceFor(db, 't1', cid);

  console.log('the code');
  const now = Date.now(); const w = RC.windowOf(now);
  const a = await RC.issueCode(db, 't1', 'c1', now); const a2 = await RC.issueCode(db, 't1', 'c1', now + 1000);
  const next = await RC.issueCode(db, 't1', 'c1', (w + 1) * RC.CODE_MIN * 60000 + 5);
  check('six digits, the same for a few minutes, a new one after', /^\d{6}$/.test(a!.code) && a2!.code === a!.code && next!.code !== a!.code && Date.parse(a!.until) === (w + 1) * RC.CODE_MIN * 60000, { a, a2, next });
  check('…the one just before still works; two windows back it doesn’t; never another business’s', (await RC.memberByCode(db, 't1', a!.code, (w + 1) * RC.CODE_MIN * 60000 + 5)) === 'c1'
    && (await RC.memberByCode(db, 't1', a!.code, (w + 2) * RC.CODE_MIN * 60000 + 5)) === null && (await RC.memberByCode(db, 't2', a!.code, now)) === null);
  const clash = await RC.issueCode(db, 't1', 'c2', now);
  await db.doc(`rewardCodes/t1_${w}_${clash!.code}`).set({ tenantId: 't1', clientId: 'cX', window: w }, { merge: true });
  await db.collection('rewardCodes').doc(`t1_${w}_${clash!.code}`).set({ tenantId: 't1', clientId: 'cX', window: w });
  const c2code = await RC.issueCode(db, 't1', 'c2', now);
  check('two members on the same digits: the second gets other digits', c2code!.code !== clash!.code && (await RC.memberByCode(db, 't1', c2code!.code, now)) === 'c2', { clash, c2code });
  let r: any = await PUBLIC(req({ tenantId: 't1', clientId: 'c1', k: rewardsKey('t1', 'c1'), action: 'code' }));
  const bad: any = await PUBLIC(req({ tenantId: 't1', clientId: 'c1', k: 'nope', action: 'code' }));
  check('their rewards page gets it with their private link only', r.body.ok && r.body.code === a!.code && bad.status === 403, r.body);
  const page = src('src/app/rewards/[tenantId]/[clientId]/page.tsx');
  check('…shown there for a business with a counter or drive-thru, with when it changes', /\{quick && <RewardsCode tenantId=\{tenantId\} clientId=\{clientId\} k=\{String\(sp\.k\)\} \/>\}/.test(page) && /A new one in/.test(src('src/components/loyalty/RewardsCode.tsx')));

  console.log('at the lane');
  let c = await newOrder();
  r = await P({ action: 'rewardsCode', orderId: c.orderId, code: '000000' === a!.code ? '111111' : '000000' });
  check('a code that doesn’t match: said, and nothing linked', r.status === 404 && r.body.code === 'no_match' && !(await get(`${T}/counterOrders/${c.orderId}`)).clientId, r.body);
  r = await P({ action: 'rewardsCode', orderId: c.orderId, code: `${a!.code.slice(0, 3)} ${a!.code.slice(3)}` });
  let o: any = await get(`${T}/counterOrders/${c.orderId}`);
  check('their code (spaces and all): the order is theirs, by their code; their name, balance and what they can use on it', r.body.ok && o.clientId === 'c1' && o.points.verified === true && o.points.phone === '4567'
    && r.body.member.name === 'Kim' && r.body.member.balance === 400 && r.body.member.ready.map((x: any) => x.id).join(',') === 'five', r.body);
  const lane: any = await P({ action: 'lane' });
  check('…the lane knows codes work here, and that this order was given by code', lane.body.rewardsCodes === true && lane.body.orders[c.orderId].points.verified === true);
  const b0 = await P({ action: 'car', carKey: 'carkey-rw-building' }); await P({ action: 'add', orderId: b0.body.orderId, itemId: 'burger', quantity: 1, tapKey: 'tap-rw-b0' });
  await P({ action: 'rewardsCode', orderId: b0.body.orderId, code: a!.code });
  r = await P({ action: 'reward', orderId: b0.body.orderId, rewardId: 'five' });
  check('not sent yet: a reward waits until it is', r.status === 409 && r.body.code === 'not_sent', r.body);
  r = await P({ action: 'reward', orderId: c.orderId, rewardId: 'big' });
  check('not enough points: said with the balance', r.status === 409 && r.body.code === 'short' && /400/.test(r.body.error), r.body);
  r = await P({ action: 'reward', orderId: c.orderId, rewardId: 'five' });
  o = await get(`${T}/counterOrders/${c.orderId}`); let held: any = await get(`${T}/loyaltyLedger/redeem_counter_${c.orderId}`);
  check('used: $5 off the $10 of items before tax (5.00 + 0.50 tax), the items’ own total kept', r.body.ok && o.reward.id === 'five' && o.discount === 5 && o.itemsTotal === 10 && o.subtotal === 5 && o.tax === 0.5 && o.total === 5.5 && r.body.total === 5.5, o);
  check('…its points held for the order in the ledger, so the balance shows it', held?.held === true && held.points === -300 && held.saleId === `counter_${c.orderId}` && (await balance()) === 100 && (await get(`${T}/clients/c1`)).loyalty.balance === 100, held);
  r = await P({ action: 'reward', orderId: c.orderId, rewardId: null });
  o = await get(`${T}/counterOrders/${c.orderId}`);
  check('taken off: the points come back and the total is what it was', r.body.ok && !o.reward && o.subtotal === 10 && o.total === 11 && !(await get(`${T}/loyaltyLedger/redeem_counter_${c.orderId}`)) && (await balance()) === 400, o);
  await P({ action: 'reward', orderId: c.orderId, rewardId: 'five' });
  await db.doc(`${T}/counterOrders/${c.orderId}`).set({ card: { state: 'on_reader', id: 'pi_x', at: new Date().toISOString() } }, { merge: true });
  r = await P({ action: 'reward', orderId: c.orderId, rewardId: null });
  check('while the card reader asks for the total, it stays as it is', r.status === 409 && r.body.code === 'card_busy');
  await db.doc(`${T}/counterOrders/${c.orderId}`).set({ card: { state: 'stopped' } }, { merge: true });
  r = await P({ action: 'points', orderId: c.orderId, phone: '555-999-0000' });
  check('a phone number can’t move an order with a reward on it to someone else', r.status === 409 && r.body.code === 'reward' && (await get(`${T}/counterOrders/${c.orderId}`)).clientId === 'c1', r.body);
  r = await P({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 10 });
  held = await get(`${T}/loyaltyLedger/redeem_counter_${c.orderId}`); const earn = await get(`${T}/loyaltyLedger/earn_counter_${c.orderId}`);
  check('paid: the reward is used, and points are earned on what was paid ($5 × 2 = 10)', r.body.ok && held.held === false && earn?.points === 10 && (await balance()) === 110, { held, earn });
  const sale = await get(`${T}/transactions/counter_${c.orderId}`);
  check('…the sale in the books is what was paid', sale?.amount === 5, sale);
  await L.reverseSale(db, 't1', { saleId: `counter_${c.orderId}`, full: true, by: 'Ana Ruiz' });
  check('a full refund gives the reward back (and takes back what it earned)', (await balance()) === 400);

  console.log('guessing, and a number after a code');
  const g = await newOrder();
  const wrong = a!.code === '000000' ? '111111' : '000000';
  const tries = await Promise.all(Array.from({ length: 6 }, () => P({ action: 'rewardsCode', orderId: g.orderId, code: wrong })));
  r = await P({ action: 'rewardsCode', orderId: g.orderId, code: a!.code });
  check('a few wrong codes on one order, then even the right one is refused there: their phone number instead', tries.filter((x: any) => x.body.code === 'no_match').length >= 5 && r.status === 429 && r.body.code === 'order_tries', r.body);
  const burst = await Promise.all(Array.from({ length: 40 }, async (_, i) => { const x = await newOrder(); return P({ action: 'rewardsCode', orderId: x.orderId, code: wrong }); }));
  check('tries sent all at once are each counted: no more than 30 wrong in ten minutes, for the whole business', burst.filter((x: any) => x.body.code === 'no_match').length + tries.filter((x: any) => x.body.code === 'no_match').length <= 30 && burst.some((x: any) => x.body.code === 'tries'), burst.map((x: any) => x.body.code).join(','));
  for (const d of await all(`${T}/private`)) if (String(d.id).startsWith('rewardCodeTries_')) await db.doc(`${T}/private/${d.id}`).set({ n: 0 });
  const v = await newOrder();
  await P({ action: 'rewardsCode', orderId: v.orderId, code: a!.code });
  r = await P({ action: 'points', orderId: v.orderId, phone: '555-999-0000' });
  const vo: any = await get(`${T}/counterOrders/${v.orderId}`);
  r = await P({ action: 'reward', orderId: v.orderId, rewardId: 'five' });
  check('given by code, then someone else’s phone number: it’s theirs, and it can’t spend', vo.clientId === 'c2' && vo.points.verified === false && r.status === 409 && r.body.code === 'needs_code', { vo, r: r.body });
  const first = await RC.issueCode(db, 't1', 'cZ', now);
  await db.doc(`rewardCodes/t1_${w}_${first!.code}`).delete();
  await db.doc(`rewardCodes/t1_${w - 1}_${first!.code}`).set({ tenantId: 't1', clientId: 'cOther', window: w - 1 });
  const again = await RC.issueCode(db, 't1', 'cZ', now);
  check('the same digits still good for someone else from the few minutes before: never given to anyone now', again!.code !== first!.code && (await RC.memberByCode(db, 't1', again!.code, now)) === 'cZ', { first, again });

  console.log('a phone number, a void, a staff meal');
  const c3 = await newOrder();
  await P({ action: 'points', orderId: c3.orderId, phone: '555-123-4567' });
  r = await P({ action: 'reward', orderId: c3.orderId, rewardId: 'five' });
  check('given by phone number only: it earns, but a reward needs their code', r.status === 409 && r.body.code === 'needs_code', r.body);
  const c4 = await newOrder();
  await P({ action: 'rewardsCode', orderId: c4.orderId, code: a!.code });
  await P({ action: 'reward', orderId: c4.orderId, rewardId: 'five' });
  const { voidOrder, staffMeal } = await import('../../src/lib/counter-server');
  const sm: any = await staffMeal(db, 't1', c4.orderId, 'Ana', { id: 'm1', name: 'Ana Ruiz' });
  check('no staff meal while a reward is on it', sm.error && /reward/i.test(sm.error), sm);
  await voidOrder(db, 't1', c4.orderId, 'Drove off', { id: 'm1', name: 'Ana Ruiz' });
  check('voided: the reward was never used, so it comes back', !(await get(`${T}/loyaltyLedger/redeem_counter_${c4.orderId}`)) && (await balance()) === 400 && (await get(`${T}/clients/c1`)).loyalty.balance === 400);

  console.log('a free menu item, and the window');
  const c5 = await newOrder(false, 'drip', 2); await P({ action: 'add', orderId: c5.orderId, itemId: 'burger', quantity: 1, tapKey: 'tap-rw-c5b' }); await P({ action: 'send', orderId: c5.orderId });
  await P({ action: 'rewardsCode', orderId: c5.orderId, code: a!.code });
  const lst: any = await P({ action: 'rewards', orderId: c5.orderId });
  r = await P({ action: 'reward', orderId: c5.orderId, rewardId: 'drip' });
  o = await get(`${T}/counterOrders/${c5.orderId}`);
  check('a free drip: one of them off (2.50 of 10.00), offered only where there’s one on the order', lst.body.member.ready.some((x: any) => x.id === 'drip' && x.cents === 250) && r.body.ok && o.discount === 2.5 && o.subtotal === 7.5, { o, lst: lst.body });
  const c6 = await newOrder();
  await P({ action: 'rewardsCode', orderId: c6.orderId, code: a!.code });
  r = await P({ action: 'reward', orderId: c6.orderId, rewardId: 'drip' });
  check('…and refused where there isn’t one', r.status === 409 && r.body.code === 'nothing', r.body);
  check('the free item kind is kept by the rules, and priced as one of it', LY.cleanReward({ name: 'Free drip', points: 100, kind: 'free_item', itemId: 'drip' })?.kind === 'free_item' && LY.cleanReward({ name: 'x', points: 100, kind: 'free_item' }) === null
    && LY.rewardCents({ id: 'd', name: 'd', points: 1, kind: 'free_item', itemId: 'drip', on: true }, { lines: [{ serviceId: null, itemId: 'drip', cents: 250 }, { serviceId: null, itemId: 'drip', cents: 300 }], discountableCents: 5000 }) === 300);
  const wkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Pay window', kind: 'drive-thru-board' }))).body.key;
  // (Only this car at the window: the others have gone on.)
  for (const x of await all(`${T}/driveThruCars`)) if (x.id !== c5.carId) await db.doc(`${T}/driveThruCars/${x.id}`).set({ stage: 'gone', goneAt: new Date(Date.now() - 60000).toISOString() }, { merge: true });
  await db.doc(`${T}/driveThruCars/${c5.carId}`).set({ stage: 'pay', stageAt: { pay: new Date().toISOString() } }, { merge: true });
  let wn: any = await POST(req({ tenantId: 't1', key: wkey, action: 'window', at: 'pay' }));
  check('the window screen shows the reward while they pay, and no balance', wn.body.show?.mode === 'pay' && wn.body.show.reward?.name === 'A free drip' && wn.body.show.reward.off === 2.5 && wn.body.show.reward.itemsTotal === 10 && wn.body.show.earned === null && !/balance/.test(JSON.stringify(wn.body.show)), wn.body.show);
  await P({ action: 'paid', orderId: c5.orderId, method: 'cash', tendered: 20 });
  wn = await POST(req({ tenantId: 't1', key: wkey, action: 'window', at: 'pay' }));
  check('…and once it’s paid, the points it earned', wn.body.show?.mode === 'paid' && wn.body.show.earned?.points === 15 && wn.body.show.earned.unit === 'points', wn.body.show);
  const win = src('src/app/drive-thru/[tenantId]/window/page.tsx');
  check('the window screen says the reward and You earned', /t\('Reward: \{name\}', \{ name: s\.reward\.name \}\)/.test(win) && /earnedWords\(lang, s\.earned\.points, s\.earned\.unit\)/.test(win));
  const lanePage = src('src/app/drive-thru/[tenantId]/page.tsx');
  // (The sheet and the row are shared with the counter now: components/drive-thru/Rewards.)
  const rewardsUi = src('src/components/drive-thru/Rewards.tsx');
  check('the lane: their code first, a phone number only earns; Use and Take it off', /No code\? Their phone number \(earns points only\)/.test(rewardsUi) && /Use a reward<\/p>/.test(rewardsUi) && /\{r\.name\} \(\{r\.points\}\)<\/button>/.test(rewardsUi) && /Take it off/.test(rewardsUi)
    && /<RewardsRow order=\{order\} member=\{member\} codes=\{!!lane\?\.rewardsCodes\}/.test(lanePage) && /\{pointsOpen && order && <PointsSheet /.test(lanePage));
  const counterPage = src('src/app/(app)/counter/page.tsx');
  check('the sheet’s colors are set inline, so the counter’s black look takes them over', !/bg-\[#fff\]/.test(rewardsUi) && /style=\{\{ background: '#fff', color: INK \}\}/.test(rewardsUi));
  check('the counter: the same sheet and row, the reward on the totals, and who they are read again as it’s sent and paid',
    /<RewardsRow order=\{order\} member=\{member\} codes=\{!!lane\.rewardsCodes\}/.test(counterPage) && /\{pointsOpen && order && <PointsSheet /.test(counterPage) && /action: 'rewardsCode', orderId: order\.id, code/.test(counterPage)
    && /action: 'reward', orderId: order\.id, rewardId/.test(counterPage) && /Reward: \{order\.reward\.name\}/.test(counterPage) && /\[shownId, shownVerified, shownStatus, shownPaid, memberTry, post\]/.test(counterPage) && /Their rewards didn’t load\./.test(counterPage) && /lane\?\.pointsOn && !order\.staffMeal/.test(counterPage));
  check('someone who joins at the counter is marked as from the counter', /o\.channel === 'counter' \? 'counter' : 'drive-thru'/.test(src('src/lib/counter-points.ts')));
  check('the rewards setup offers a free menu item', /\['free_item', 'A free menu item'\]/.test(src('src/components/loyalty/LoyaltySetup.tsx')));
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us|salon|stylist|booth|studio/i.test(src('src/lib/rewards-code.ts') + src('src/components/loyalty/RewardsCode.tsx')));

  console.log('at the counter');
  const CP = (b: any) => POST(req({ tenantId: 't1', channel: 'counter', ...b }));
  const cc = (await CP({ action: 'car', carKey: 'carkey-counter-rw' })).body;
  await CP({ action: 'add', orderId: cc.orderId, itemId: 'burger', quantity: 2, tapKey: 'tap-counter-rw' });
  // (Enough points for a reward again, after the lane's tests used some.)
  await db.doc(`${T}/loyaltyLedger/seed_counter`).set({ clientId: 'c1', type: 'adjust', points: 300, at: new Date().toISOString() });
  await (L as any).refreshMember?.(db, 't1', 'c1');
  const bBefore = await balance();
  const code = (await RC.issueCode(db, 't1', 'c1', Date.now()))!.code;
  r = await CP({ action: 'rewardsCode', orderId: cc.orderId, code });
  let co: any = await get(`${T}/counterOrders/${cc.orderId}`);
  check('the counter takes their code on its own order (C…): theirs, by their code', r.body.ok && co.channel === 'counter' && co.clientId === 'c1' && co.points?.verified === true && /^C/.test(String(co.number)), r.body);
  const cl: any = await CP({ action: 'lane' });
  check('…the counter knows rewards and codes are on here', cl.body.pointsOn === true && cl.body.rewardsCodes === true && cl.body.orders[cc.orderId]?.points?.verified === true);
  await CP({ action: 'send', orderId: cc.orderId });
  r = await CP({ action: 'reward', orderId: cc.orderId, rewardId: 'five' });
  co = await get(`${T}/counterOrders/${cc.orderId}`);
  check('…a reward on it once it’s sent: $5 off before tax', r.body.ok && co.reward?.id === 'five' && co.subtotal === 5 && co.total === 5.5, { body: r.body, status: r.status });
  r = await CP({ action: 'paid', orderId: cc.orderId, method: 'cash', tendered: 10 });
  const cHeld: any = await get(`${T}/loyaltyLedger/redeem_counter_${cc.orderId}`); const cEarn: any = await get(`${T}/loyaltyLedger/earn_counter_${cc.orderId}`);
  check('…paid: the reward is used and it earns on what was paid', r.body.ok && cHeld?.held === false && !!cEarn && cEarn.points > 0 && (await balance()) === bBefore - 300 + cEarn.points, { cHeld, cEarn, b: await balance(), bBefore });
  r = await POST(req({ tenantId: 't1', key, action: 'reward', orderId: cc.orderId, rewardId: null }));
  check('the drive-thru screen can’t change a counter order’s reward', r.status === 409);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
