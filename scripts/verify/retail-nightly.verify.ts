// Checks the shop's own nightly run (api/cron/retail-nightly): every shop once a night; a run that's running out of
// time stops before it's cut off and the next run carries on from the shop it reached; once every shop is done that
// day, another run does nothing; and the next night starts a new round. Also that the per-shop checks still run each
// check when one of them fails.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/retail-nightly.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const ran: string[] = [];
let clock = 0; let step = 0;
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === '@/lib/cron-heartbeat') return { recordCronRun: async () => {} };
  if (request === '@/lib/retail-nightly') return { retailNightlyForShop: async (_db: any, t: string) => { ran.push(t); clock += step; return {}; } };
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  return load.call(this, request, ...rest);
};
process.env.CRON_SECRET = 'cron';
const realNow = Date.now;
Date.now = () => realNow() + clock;
const req = (auth = 'Bearer cron') => ({ headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null) } }) as any;

(async () => {
  const { GET } = await import('../../src/app/api/cron/retail-nightly/route');
  for (const t of ['t1', 't2', 't3', 't4']) await db.doc(`tenants/${t}`).set({ name: t });

  check('only the scheduler (holding the secret) can run it', (await GET(req('Bearer nope')) as any).status === 401 && ran.length === 0);

  let r: any = await GET(req());
  check('a quiet night: every shop once, in order, and the round is done', r.body.shops === 4 && ran.join() === 't1,t2,t3,t4' && !r.body.cutOff, { r: r.body, ran });
  r = await GET(req());
  check('…the second run that night does nothing', /Already done/.test(r.body.skipped || '') && ran.length === 4, r.body);

  // A long night: each shop takes two minutes, so a run fits two before it stops itself.
  db = makeDb(); ran.length = 0; clock = 0; step = 120_001;
  for (const t of ['t1', 't2', 't3', 't4']) await db.doc(`tenants/${t}`).set({ name: t });
  r = await GET(req());
  check('a long night: the run stops itself before its time is up, and says so', r.body.cutOff === true && ran.join() === 't1,t2', { r: r.body, ran });
  clock = 0;
  r = await GET(req());
  check('…the second run carries on from the shop it reached, and finishes the round', ran.join() === 't1,t2,t3,t4' && r.body.shops === 2 && !r.body.cutOff, { r: r.body, ran });
  r = await GET(req());
  check('…and a third does nothing', /Already done/.test(r.body.skipped || ''));

  // A night that couldn't finish: the next night starts with the shops it missed.
  db = makeDb(); ran.length = 0; clock = 0; step = 0;
  for (const t of ['t1', 't2', 't3', 't4']) await db.doc(`tenants/${t}`).set({ name: t });
  await db.doc('platformHealth/cursor_retail_nightly').set({ day: '2026-01-01', cycleStart: 't1', after: 't2', done: false });
  r = await GET(req());
  check('the next night starts just after where the last one stopped, and still reaches every shop', ran.join() === 't3,t4,t1,t2' && r.body.shops === 4, { r: r.body, ran });

  // ── The per-shop checks keep going when one fails ──
  M._load = load;
  const { retailNightlyForShop } = await import('../../src/lib/retail-nightly');
  db = makeDb();
  const broken: any = new Proxy(db, { get: (target, prop) => (prop === 'collection' ? (p: string) => { if (/retailOrders$/.test(p)) throw new Error('reads failing'); return target.collection(p); } : (target as any)[prop]) });
  const out = await retailNightlyForShop(broken, 't1', {});
  check('one check failing is reported and the rest still run', !!out.renterCredits?.error && !!out.nonCardRestored?.error && !out.returnsClosed?.error, out);

  // Cancelled orders whose gift card or store credit goes back: one that can't be checked tonight (its gift card payment
  // needs Stripe, which can't be asked) waits for tomorrow without holding up the next one.
  db = makeDb();
  delete process.env.STRIPE_SECRET_KEY;
  const T = 'tenants/t1'; const recent = new Date(realNow() - 86400e3).toISOString();
  await db.doc(T).set({ name: 'Opal', stripeAccountId: 'acct_1' });
  await db.doc(`${T}/giftCards/g1`).set({ id: 'g1', code: 'GIFT-1', balanceCents: 0, status: 'active', history: [{ at: recent, type: 'spend', cents: -1500, balanceAfter: 0, ref: 'cs_a' }] });
  await db.doc(`${T}/retailOrders/a`).set({ tenantId: 't1', orderNumber: 1, stage: 'cancelled', cancelledAt: recent, customerEmail: 'a@example.com', stripeCheckoutSessionId: 'cs_a', giftCardId: 'g1', giftCardCents: 1500, giftSpentAt: recent, totalCents: 1500 });
  await db.doc(`${T}/retailOrders/b`).set({ tenantId: 't1', orderNumber: 2, stage: 'cancelled', cancelledAt: recent, customerEmail: 'b@example.com', storeCreditRequestedCents: 1000, creditShortfallCents: 0, totalCents: 1000 });
  await db.doc(`${T}/private/nonCardPaid/orders/b`).set({ at: recent, creditCents: 1000 });
  const out2 = await retailNightlyForShop(db, 't1', {});
  check('a cancelled order that can’t be checked tonight waits for tomorrow, and the next one still gets its credit back',
    out2.nonCardRestored?.orders === 1 && out2.nonCardRestored?.waiting === 1 && !(await db.doc(`${T}/retailOrders/a`).get()).data().nonCardRestoredAt && !!(await db.doc(`${T}/retailOrders/b`).get()).data().nonCardRestoredAt, out2);

  Date.now = realNow;
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
