// scripts/verify/store-credit.verify.ts — store credit is used when a sale is paid (lib/store-credit).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/store-credit.verify.ts
import { makeDb, check, failures } from './fake-db';
const DAY = 864e5; const NOW = Date.parse('2026-10-13T15:00:00-04:00'); const at = (d: number) => new Date(NOW + d * DAY).toISOString();
(async () => {
  const SC = await import('../../src/lib/store-credit');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(`${T}/clients/c1`).set({ id: 'c1', name: 'Hannah Kim', totalStoreCredit: 45, storeCredits: [
    { id: 'late', amount: 15, status: 'available', expiresAt: at(160), createdAt: at(-30) },
    { id: 'soon', amount: 20, status: 'available', expiresAt: at(10), createdAt: at(-60) },
    { id: 'gone', amount: 10, status: 'voided', expiresAt: at(100) },
    { id: 'old', amount: 10, status: 'available', expiresAt: at(-1) },
    { id: 'none', amount: 10, status: 'available', expiresAt: null, createdAt: at(-5) } ] });
  const c: any = (await db.doc(`${T}/clients/c1`).get()).data();
  console.log('Store credit — what’s available');
  check('voided and ended credit don’t count: $45 available', SC.creditBalance(c, NOW) === 45);
  check('soonest-ending first, credit with no end date last', SC.availableCredits(c, NOW).map((x: any) => x.id).join() === 'soon,late,none');
  console.log('Store credit — used when the sale is paid');
  const u = await SC.useCredit(db, 't1', 'c1', 30, { appointmentId: 'a1', checkoutSessionId: 's1', by: 'Jo' }, NOW);
  const c2: any = (await db.doc(`${T}/clients/c1`).get()).data();
  const left = SC.availableCredits(c2, NOW);
  check('a $30 bill uses the $20 ending soon, then $10 of the $15', u.applied === 30 && u.ids.join() === 'soon,late', u);
  check('…the other $5 stays available with the same end date, and the total drops to $15', left.some((x: any) => x.splitFrom === 'late' && x.amount === 5 && x.expiresAt === at(160)) && SC.creditBalance(c2, NOW) === 15 && c2.totalStoreCredit === 15, c2.storeCredits);
  const tx = (await db.collection(`${T}/transactions`).get()).docs.map((d: any) => d.data());
  check('a redemption line for the books', tx.length === 1 && tx[0].amount === -30 && tx[0].checkoutSessionId === 's1');
  const u2 = await SC.useCredit(db, 't1', 'c1', 100, { appointmentId: 'a2' }, NOW);
  check('never more than they have', u2.applied === 15 && SC.creditBalance((await db.doc(`${T}/clients/c1`).get()).data(), NOW) === 0, u2);
  const u3 = await SC.useCredit(db, 't1', 'c1', 10, {}, NOW);
  check('nothing left: nothing used, no line', u3.applied === 0 && (await db.collection(`${T}/transactions`).get()).docs.length === 2);

  console.log('Money — what you still owe clients');
  const O = await import('../../src/lib/owed-to-clients');
  const dbo = makeDb(); const TO = 'tenants/t9';
  await dbo.doc(`${TO}/clients/a`).set({ totalStoreCredit: 35, storeCredits: [{ id: 'r', amount: 15, amountCents: 1500, source: 'referral_reward', status: 'available', expiresAt: at(20) }, { id: 'g', amount: 20, source: 'goodwill', status: 'available', expiresAt: at(200) }, { id: 'u', amount: 9, status: 'used', usedAt: at(-1) }] });
  await dbo.doc(`${TO}/clients/b`).set({ totalStoreCredit: 10, storeCredits: [{ id: 'x', amount: 10, status: 'available', expiresAt: at(-2) }] });
  await dbo.doc(`${TO}/giftCards/g1`).set({ status: 'active', balanceCents: 4000 }); await dbo.doc(`${TO}/giftCards/g2`).set({ status: 'used', balanceCents: 0 }); await dbo.doc(`${TO}/giftCards/g3`).set({ status: 'active', balanceCents: 2500, renterId: 'rn' });
  const ow: any = await O.owedToClients(dbo, 't9', NOW);
  check('referral credit $15, other credit $20, a $40 gift card → $75 owed; used, ended and renters’ cards left out', ow.totalCents === 7500 && ow.credit.referralCents === 1500 && ow.credit.otherCents === 2000 && ow.gift.cents === 4000 && ow.gift.cards === 1 && ow.credit.clients === 1, ow);
  check('…$15 of it ends in the next 30 days', ow.credit.endingSoonCents === 1500);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
