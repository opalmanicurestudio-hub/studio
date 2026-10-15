// scripts/verify/pay-clarity-server.verify.ts — "What my time is worth" and the owner's pay plan check, end to end on an
// in-memory database: real pay stubs, clocked hours, bookings; private notes kept under a hashed key only.
import { makeDb, check, failures } from './fake-db';

(async () => {
  console.log('Pay clarity — server');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', payRules: { minimumWage: 15 }, payroll: { cadence: 'weekly' }, workweekStartsOn: 1 });
  await db.doc(`${T}/staff/maya`).set({ name: 'Maya Reyes', role: 'stylist', payStructure: 'commission' });
  await db.doc(`${T}/staffPay/maya`).set({ commissionRate: 40, retailCommissionRate: 10 });
  await db.doc(`${T}/services/gel`).set({ name: 'Gel', price: 100, duration: 60 });
  // Two weeks back: Mon Oct 5 – Sun Oct 11, 2026. Clock 9–5 Mon–Fri (40 h), $1,000 in services, $100 tips, 6 booked hours a day.
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
  let n = 0;
  for (const d of days) {
    await db.doc(`${T}/activityLogs/i${n}`).set({ staffId: 'maya', type: 'clock_in', timestamp: `${d}T13:00:00.000Z` });
    await db.doc(`${T}/activityLogs/o${n}`).set({ staffId: 'maya', type: 'clock_out', timestamp: `${d}T21:00:00.000Z` });
    await db.doc(`${T}/transactions/s${n}`).set({ type: 'income', category: 'Service Revenue', staffId: 'maya', amount: 200, date: `${d}T15:00:00.000Z`, serviceId: 'gel', clientId: `c${n}`, appointmentId: `a${n}` });
    await db.doc(`${T}/transactions/t${n}`).set({ type: 'income', category: 'Tips', staffId: 'maya', amount: 20, date: `${d}T15:00:00.000Z`, taxBucket: 'gratuity' });
    await db.doc(`${T}/appointments/a${n}`).set({ staffId: 'maya', clientId: `c${n}`, startTime: `${d}T14:00:00.000Z`, duration: 360, status: 'completed' });
    n++;
  }
  const S = await import('../../src/lib/pay-clarity-server');
  const periods = await S.periodsFor(db, 't1', 'maya', 28);
  const wk = periods.find((p) => p.from === '2026-10-05');
  check('a period built from the real stub: 40 hours, $1,000 in sales, $100 tips', !!wk && wk.hours === 40 && wk.serviceSales === 1000 && wk.tips === 100, wk);
  check('booked hours from the bookings', wk?.bookedHours === 30, wk?.bookedHours);
  // 40% of $1,000 = $400 for 40 hours = $10/h < $15 minimum → $200 top-up.
  check('pay before tips topped up to minimum wage that week', wk?.topUp === 200 && (wk?.weeks || []).some((w) => w.topUp === 200), { topUp: wk?.topUp, weeks: wk?.weeks });
  const saved = await S.savePrivate(db, 't1', 'maya', { goalMonthly: 4000, costs: [{ label: 'Tools', amount: 40, per: 'once' }], plans: [{ kind: 'hourly', rate: 20 }] });
  check('private notes saved, cleaned', saved.goalMonthly === 4000 && saved.costs.length === 1 && saved.plans[0].kind === 'hourly');
  const key = S.privateKey('t1', 'maya');
  check('kept under a one-way key, nowhere in the business’s records', (await db.doc(`privatePay/${key}`).get()).exists && !key.includes('maya') && !key.includes('t1') && !(await db.collection(`${T}/privatePay`).get()).docs.length);
  const mine: any = await S.myClarity(db, 't1', 'maya', '4w');
  check('her view: per hour with tips includes the top-up', mine.ok && mine.clarity.hours >= 40 && mine.compare.length === 2 && mine.private.goalMonthly === 4000, { hours: mine.clarity.hours, per: mine.clarity.perHour, compare: mine.compare.map((x: any) => x.label) });
  const pc: any = await S.planCheck(db, 't1', { days: 28, simulate: { kind: 'greater_of', rate: 16, pct: 40 } });
  const row = pc.people.find((p: any) => p.staffId === 'maya');
  check('owner: flagged week, and no private notes anywhere', row && row.toppedUpAmount >= 200 && !JSON.stringify(pc).includes('Tools') && !JSON.stringify(pc).includes('4000'), row);
  check('owner: “$16 or 40%” would pay her more than minimum wage', row?.simulated && row.simulated.delta > 0, row?.simulated);
  await S.savePrivate(db, 't1', 'maya', { ...saved, perks: { offClockMonthly: 6, commuteMin: 20 } });
  const pc2: any = await S.planCheck(db, 't1', { days: 28 });
  check('off the clock: the owner sees a count, not who or how much', pc2.offClock === 1 && !JSON.stringify(pc2).includes('"offClockMonthly"'));
  const mine2: any = await S.myClarity(db, 't1', 'maya', '4w');
  check('her all-in view counts the extra hours', mine2.allIn && mine2.allIn.offClockHours > 0 && mine2.allIn.perHourAllIn < mine2.clarity.perHour, mine2.allIn);
  await S.savePrivate(db, 't1', 'maya', { ...saved, perks: { offClockMonthly: 0 } });
  check('and the count drops when she clears it', (await S.planCheck(db, 't1', { days: 28 })).offClock === 0);
  // Tip credit (payroll): an hourly server at $2.13 with $300 in tips over 40 hours, minimum $7.25.
  for (const [st, want] of [['TX', 0], ['CA', 7.25 * 40 - 2.13 * 40]] as const) {
    const d2 = makeDb(); const T2 = 'tenants/t2';
    await d2.doc(T2).set({ name: 'Diner', timezone: 'America/New_York', payRules: { minimumWage: 7.25, state: st, tipCredit: { on: true, cashWage: 2.13 } }, payroll: { cadence: 'weekly' }, workweekStartsOn: 1 });
    await d2.doc(`${T2}/staff/sv`).set({ name: 'Sol', role: 'server', payStructure: 'hourly' }); await d2.doc(`${T2}/staffPay/sv`).set({ hourlyRate: 2.13 });
    let k = 0; for (const d of days) { await d2.doc(`${T2}/activityLogs/i${k}`).set({ staffId: 'sv', type: 'clock_in', timestamp: `${d}T13:00:00.000Z` }); await d2.doc(`${T2}/activityLogs/o${k}`).set({ staffId: 'sv', type: 'clock_out', timestamp: `${d}T21:00:00.000Z` });
      await d2.doc(`${T2}/transactions/t${k}`).set({ type: 'income', category: 'Tips', staffId: 'sv', amount: 60, date: `${d}T18:00:00.000Z` }); k++; }
    const p2 = (await S.periodsFor(d2, 't2', 'sv', 28)).find((p) => p.from === '2026-10-05');
    check(`tip credit in ${st}: top-up ${want ? 'to the full minimum (no tip credit there)' : 'none, tips cover it'}`, Math.abs((p2?.topUp || 0) - want) < 0.01, p2?.topUp);
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
