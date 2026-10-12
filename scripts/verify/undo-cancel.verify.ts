// scripts/verify/undo-cancel.verify.ts — a client can take back their own cancellation for 15 minutes (lib/undo-cancel).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/undo-cancel.verify.ts
import { makeDb, check, failures } from './fake-db';
const MIN = 60000; const iso = (n: number) => new Date(n).toISOString();
(async () => {
  const U = await import('../../src/lib/undo-cancel'); const W = await import('../../src/lib/waitlist-server');
  const now = Date.parse('2026-10-12T09:00:00-04:00'); const start = Date.parse('2026-10-14T14:00:00-04:00');
  const base = { byClient: true, feeCharged: false, reschedule: false, series: false, usedGrace: false };
  console.log('Who can undo');
  check('a free, on-time cancel from their own link → yes', U.undoAllowed({}, base));
  check('a fee was charged → no', !U.undoAllowed({}, { ...base, feeCharged: true }));
  check('a paid deposit (already refunded or credited) → no', !U.undoAllowed({ depositStatus: 'paid' }, base));
  check('a package credit was given back → no', !U.undoAllowed({ paidByPackageId: 'p1' }, base));
  check('cancelled by the team, a reschedule, or the whole series → no', !U.undoAllowed({}, { ...base, byClient: false }) && !U.undoAllowed({}, { ...base, reschedule: true }) && !U.undoAllowed({}, { ...base, series: true }));
  const fresh = async () => { const db = makeDb(); await db.doc('tenants/t1').set({ name: 'Opal', timezone: 'America/New_York' }); await db.doc('tenants/t1/staff/maya').set({ id: 'maya', name: 'Maya', role: 'stylist' });
    await db.doc('tenants/t1/appointments/a').set({ id: 'a', status: 'cancelled', statusBeforeCancel: 'confirmed', staffId: 'maya', clientName: 'Ana Ruiz', serviceName: 'Gel fill', startTime: iso(start), endTime: iso(start + 60 * MIN), cancelledAt: iso(now), undoUntil: iso(now + 15 * MIN), checkInToken: 'tok' }); return db; };
  console.log('The waitlist waits');
  let db = await fresh();
  check('inside the 15 minutes, no opening is made', (await W.detectOpenings(db, 't1', now + 5 * MIN)).length === 0);
  check('after it, the opening is made as usual', (await W.detectOpenings(db, 't1', now + 16 * MIN)).length === 1);
  console.log('Undo');
  db = await fresh();
  check('the wrong key is refused', (await U.undoCancel(db, 't1', 'a', 'nope', now + 5 * MIN) as any).code === 'needs_link');
  const r = await U.undoCancel(db, 't1', 'a', 'tok', now + 5 * MIN); const a: any = (await db.doc('tenants/t1/appointments/a').get()).data();
  check('within 15 minutes: back to confirmed, cancellation cleared', r.ok && a.status === 'confirmed' && !a.cancelledAt && !a.undoUntil && !!a.cancellationUndoneAt, a);
  check('…and the team is told', (await db.collection('tenants/t1/notifications').get()).docs.some((d: any) => /undid their cancellation/.test(d.data().message)));
  check('tapping twice is fine', (await U.undoCancel(db, 't1', 'a', 'tok', now + 6 * MIN)).ok);
  db = await fresh();
  check('after 15 minutes → too late', (await U.undoCancel(db, 't1', 'a', 'tok', now + 16 * MIN) as any).code === 'too_late');
  db = await fresh(); await db.doc('tenants/t1/appointments/b').set({ id: 'b', status: 'confirmed', staffId: 'maya', startTime: iso(start + 30 * MIN), endTime: iso(start + 90 * MIN) });
  check('someone booked the time meanwhile → can’t undo, told why', (await U.undoCancel(db, 't1', 'a', 'tok', now + 5 * MIN) as any).code === 'taken');
  db = await fresh(); await db.doc('tenants/t1/staffBlocks/x').set({ staffId: 'maya', startTime: iso(start), duration: 60, until: iso(now + 2 * MIN) });
  check('a hold that has already lapsed doesn’t count', (await U.undoCancel(db, 't1', 'a', 'tok', now + 5 * MIN)).ok);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
