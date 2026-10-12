// scripts/verify/deposit-release.verify.ts — an unpaid deposit never cancels a visit on its own morning (lib/deposit-release).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/deposit-release.verify.ts
import { makeDb, check, failures } from './fake-db';
const H = 3600e3, MIN = 60000; const iso = (n: number) => new Date(n).toISOString();
(async () => {
  const R = await import('../../src/lib/deposit-release');
  const now = Date.parse('2026-10-12T08:27:00-04:00'); const ten = Date.parse('2026-10-12T10:00:00-04:00');
  const a = (x: any) => ({ id: 'a', status: 'pending_payment', startTime: iso(ten), createdAt: iso(now - 3 * 864e5), ...x });
  console.log('Unpaid deposits — when the system may cancel');
  check('this morning’s case: accepted yesterday 8:20, deadline today 8:20, visit at 10 → NOT cancelled; the desk decides', R.releaseCall(a({ paymentDueAt: iso(now - 7 * MIN) }), now, {}) === 'desk');
  check('the same deadline for a visit 3 days away → released (there’s time to fill it)', R.releaseCall(a({ paymentDueAt: iso(now - 7 * MIN), startTime: iso(now + 72 * H) }), now, {}) === 'release');
  check('an online checkout abandoned 40 minutes ago, even for later today → released (they never had it)', R.releaseCall(a({ createdAt: iso(now - 40 * MIN) }), now, {}) === 'release');
  check('a checkout hold that should have gone long ago but is now on the day → the desk, not a silent cancel', R.releaseCall(a({}), now, {}) === 'desk');
  check('still inside its deadline, visit within 48 hours → a one-time heads-up to the desk', R.releaseCall(a({ paymentDueAt: iso(now + 5 * H), startTime: iso(now + 30 * H) }), now, {}) === 'chase' && R.releaseCall(a({ paymentDueAt: iso(now + 5 * H), startTime: iso(now + 30 * H), depositChaseAt: iso(now - H) }), now, {}) === 'wait');
  check('paid, or already with the desk → left alone', R.releaseCall(a({ depositStatus: 'paid', paymentDueAt: iso(now - H) }), now, {}) === 'wait' && R.releaseCall(a({ depositDeskHold: true, paymentDueAt: iso(now - H) }), now, {}) === 'wait');
  check('the protected window is the shop’s setting (here 1 hour → a 10:00 visit at 8:27 is released)', R.releaseCall(a({ paymentDueAt: iso(now - 7 * MIN) }), now, { bookingMode: { depositProtectHours: 1 } }) === 'release');
  check('grace set to 0 (“no limit”): an accepted booking with an unpaid deposit is never released by the clock', R.releaseCall(a({ decidedAt: iso(now - 3 * H), createdAt: iso(now - 3 * H) }), now, { bookingMode: { paymentGraceHours: 0 } }) === 'wait');
  const db = makeDb(); await db.doc('tenants/t1').set({ name: 'Opal', timezone: 'America/New_York' });
  await db.doc('tenants/t1/staff/maya').set({ id: 'maya', name: 'Maya', role: 'stylist' }); await db.doc('tenants/t1/staff/desk').set({ id: 'desk', name: 'Jo', role: 'front_desk' });
  await db.doc('tenants/t1/appointments/a').set(a({ clientName: 'Ana Ruiz', staffId: 'maya', serviceName: 'Gel fill', paymentDueAt: iso(now - 7 * MIN) }));
  const { releaseUnpaidHolds } = await import('../../src/lib/release-unpaid');
  const r = await releaseUnpaidHolds(db, 't1', { now });
  const ap: any = (await db.doc('tenants/t1/appointments/a').get()).data(); const bell = (await db.collection('tenants/t1/notifications').get()).docs.map((d: any) => d.data());
  check('the release sweep keeps the 10:00 on the schedule, flags it, and keeps it blocking the calendar', r.released === 0 && ap.status === 'pending_payment' && ap.depositDeskHold === true && ap.needsAttention === 'deposit_unpaid' && ap.paymentDueAt === iso(ten), ap);
  check('…and the desk and Maya are told it wasn’t cancelled', bell.length === 2 && bell.every((b: any) => /nothing was cancelled/.test(b.message)) && bell.some((b: any) => b.userId === 'maya'), bell);
  await releaseUnpaidHolds(db, 't1', { now: now + 10 * MIN });
  check('told once, not every five minutes', (await db.collection('tenants/t1/notifications').get()).docs.length === 2);
  console.log('No-show fees — one calculation for the desk and the button');
  const F = await import('../../src/lib/no-show-fee');
  const svcs = [{ id: 'gel', price: 65, duration: 60, products: [{ id: 'p1', quantityUsed: 2 }] }, { id: 'art', price: 10, duration: 15 }];
  check('full price = the service and its add-ons', F.noShowFee(svcs, { tenant: { noShowFeeMode: 'full_service' } }) === 75);
  check('“No fee” charges nothing', F.noShowFee(svcs, { tenant: { noShowFeeMode: 'none' } }) === 0);
  check('a set amount', F.noShowFee(svcs, { tenant: { noShowFeeMode: 'flat', flatNoShowFee: 30 } }) === 30);
  const cost = F.noShowFee(svcs, { tenant: { noShowFeeMode: 'matrix', tmhr: 40, employerTaxBurdenPct: 10 }, inventory: [{ id: 'p1', costPerUnit: 3 }], staff: { payStructure: 'commission' } });
  check('“Your costs” = hourly overhead for the minutes + products + the provider’s pay with taxes (not the full price)', Math.abs(cost - (40 + 10 + 6 + 65 * 0.4 * 1.1 + 10 * 0.4 * 1.1)) < 0.01, cost);
  const db2 = makeDb(); await db2.doc('tenants/t1').set({ name: 'Opal', timezone: 'America/New_York', publicOrigin: 'https://opal.example' }); await db2.doc('tenants/t1/staff/desk').set({ id: 'desk', role: 'front_desk' });
  await db2.doc('tenants/t1/appointments/b').set(a({ id: 'b', clientName: 'Bo Lee', clientPhone: '+15550001111', serviceName: 'Gel fill', checkInToken: 'ckB', depositAmountCents: 2000, paymentDueAt: iso(now + 5 * H), startTime: iso(now + 30 * H) }));
  await releaseUnpaidHolds(db2, 't1', { now });
  check('48 hours out and unpaid: the heads-up runs (team told; the client is sent the pay link)', !!(await db2.doc('tenants/t1/appointments/b').get()).data().depositChaseAt);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
