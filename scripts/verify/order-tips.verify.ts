// scripts/verify/order-tips.verify.ts — an online order's tip goes to the people who fulfilled it, once.
import { makeDb, check, failures, strictTransactions } from './fake-db';
import { shareOrderTip, evenShares, tipLineId } from '../../src/lib/order-tips';
import { booksSummary } from '../../src/lib/books-summary';

const T = 'tenants/t1';
async function setup(o: any, events: { type: string; actorId: string; at: string }[]) {
  const db = makeDb(); strictTransactions(db);
  await db.doc(T).set({ name: 'Shop', userId: 'owner-uid' });
  await db.doc(`${T}/staff/s-ann`).set({ name: 'Ann Lee', role: 'staff' });
  await db.doc(`${T}/staff/s-bo`).set({ name: 'Bo Kim', role: 'staff' });
  await db.doc(`${T}/staff/s-rent`).set({ name: 'Rae Renter', role: 'renter', isRenter: true });
  await db.doc('staffDirectory/uid-ann').set({ tenantId: 't1', staffId: 's-ann' });
  await db.doc('staffDirectory/uid-bo').set({ tenantId: 't1', staffId: 's-bo' });
  await db.doc('staffDirectory/uid-rent').set({ tenantId: 't1', staffId: 's-rent' });
  await db.doc(`${T}/retailOrders/o1`).set({ orderNumber: 42, customerName: 'Maya Chen', stage: 'shipped', completedAt: '2026-10-20T15:00:00.000Z', tipCents: 501, totalCents: 5621, booksAt: '2026-10-19T10:00:00.000Z', ...o });
  let i = 0; for (const e of events) await db.doc(`${T}/retailOrders/o1/events/e${++i}`).set({ ...e });
  return db;
}
const lines = (db: any) => [...db._store.entries()].filter(([p]: any) => p.startsWith(`${T}/transactions/`)).map(([, d]: any) => d);

(async () => {
  console.log('even shares');
  check('to the cent, remainder first', JSON.stringify(evenShares(501, 2)) === '[251,250]' && JSON.stringify(evenShares(500, 3)) === '[167,167,166]' && evenShares(0, 2).length === 0);

  console.log('shared between the packer and the sender');
  let db = await setup({}, [
    { type: 'payment_confirmed', actorId: 'system', at: '2026-10-19T10:00:00Z' },
    { type: 'item_scanned', actorId: 'uid-ann', at: '2026-10-20T09:00:00Z' },
    { type: 'packed', actorId: 'uid-ann', at: '2026-10-20T09:05:00Z' },
    { type: 'label_generated', actorId: 'uid-bo', at: '2026-10-20T14:00:00Z' },
    { type: 'shipped', actorId: 'uid-bo', at: '2026-10-20T15:00:00Z' },
  ]);
  check('shared', (await shareOrderTip(db, 't1', 'o1')) === 'shared');
  let ls = lines(db);
  check('one line each, named after the order and the person', ls.length === 2 && !!db._store.get(`${T}/transactions/${tipLineId('o1', 's-ann')}`) && !!db._store.get(`${T}/transactions/${tipLineId('o1', 's-bo')}`), ls.map((l: any) => l.id));
  check('Tips lines dated when it went out, adding up to the tip', ls.every((l: any) => l.category === 'Tips' && l.taxBucket === 'gratuity' && l.date === '2026-10-20T15:00:00.000Z') && Math.round(ls.reduce((a: number, l: any) => a + l.amount, 0) * 100) === 501, ls);
  check('the order says who', JSON.stringify(db._store.get(`${T}/retailOrders/o1`).tipSharedWith) === '["s-ann","s-bo"]' && !!db._store.get(`${T}/retailOrders/o1/events/tip-shared`));
  check('in the books as tips', Math.abs(booksSummary(ls).tips - 5.01) < 0.001);
  check('asked again: nothing more', (await shareOrderTip(db, 't1', 'o1')) === 'already' && lines(db).length === 2);

  console.log('two asks at once');
  db = await setup({}, [{ type: 'shipped', actorId: 'uid-bo', at: '2026-10-20T15:00:00Z' }]);
  const both = await Promise.all([shareOrderTip(db, 't1', 'o1'), shareOrderTip(db, 't1', 'o1')]);
  check('written once', both.filter((r) => r === 'shared').length === 1 && lines(db).length === 1 && Math.round(lines(db)[0].amount * 100) === 501, both);

  console.log('not yet, no tip, renters, nobody to credit');
  db = await setup({ stage: 'packed' }, [{ type: 'packed', actorId: 'uid-ann', at: '2026-10-20T09:05:00Z' }]);
  check('not gone out yet', (await shareOrderTip(db, 't1', 'o1')) === 'not_yet' && lines(db).length === 0);
  db = await setup({ tipCents: 0 }, [{ type: 'shipped', actorId: 'uid-ann', at: '2026-10-20T15:00:00Z' }]);
  check('no tip', (await shareOrderTip(db, 't1', 'o1')) === 'no_tip' && lines(db).length === 0);
  db = await setup({}, [{ type: 'packed', actorId: 'uid-rent', at: '2026-10-20T09:05:00Z' }, { type: 'shipped', actorId: 'uid-ann', at: '2026-10-20T15:00:00Z' }]);
  await shareOrderTip(db, 't1', 'o1');
  check('a renter isn’t given a shop order’s tip', lines(db).length === 1 && lines(db)[0].staffId === 's-ann');
  db = await setup({ stage: 'completed' }, [{ type: 'payment_confirmed', actorId: 'system', at: '2026-10-19T10:00:00Z' }]);
  check('nobody on the team: one line with no one on it', (await shareOrderTip(db, 't1', 'o1')) === 'unassigned' && lines(db).length === 1 && lines(db)[0].staffId === null && db._store.get(`${T}/retailOrders/o1`).tipUnassigned === true);

  console.log('a tip given back');
  db = await setup({ refundedTipCents: 201 }, [{ type: 'shipped', actorId: 'uid-ann', at: '2026-10-20T15:00:00Z' }]);
  await shareOrderTip(db, 't1', 'o1');
  check('only what’s left is shared', Math.round(lines(db)[0].amount * 100) === 300, lines(db));
  db = await setup({ refundedTipCents: 501 }, [{ type: 'shipped', actorId: 'uid-ann', at: '2026-10-20T15:00:00Z' }]);
  check('all of it given back: nothing to share', (await shareOrderTip(db, 't1', 'o1')) === 'no_tip');
  db = await setup({ booksAt: null }, [{ type: 'shipped', actorId: 'uid-ann', at: '2026-10-20T15:00:00Z' }]);
  check('an order whose tip was booked when it was paid isn’t booked again', (await shareOrderTip(db, 't1', 'o1')) === 'booked_at_payment' && lines(db).length === 0);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('order-tips ok');
})();
