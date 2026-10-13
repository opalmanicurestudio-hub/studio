// scripts/verify/renter-inbox.verify.ts — replies to a renter's texts go to the renter (lib/renter-inbox).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/renter-inbox.verify.ts
import { makeDb, check, failures } from './fake-db';

const NOW = Date.parse('2026-10-13T15:00:00-04:00'); const ago = (h: number) => new Date(NOW - h * 3600e3).toISOString();
(async () => {
  const RI = await import('../../src/lib/renter-inbox');
  const db = makeDb(); const T = 'tenants/t1';
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York' });
  await db.doc(`${T}/staff/rs1`).set({ id: 'rs1', name: 'Rosa Diaz', role: 'renter', renterId: 'rent1' });
  await db.doc(`${T}/renters/rent1`).set({ businessName: 'Rosa Nails', phone: '+15555550700' });
  await db.doc(`${T}/clients/g1`).set({ id: 'g1', name: 'Gwen Park', phone: '+15555550901', ownerRenterId: 'rent1' });
  await db.doc(`${T}/clients/s1`).set({ id: 's1', name: 'Sue Studio', phone: '+15555550902' });
  await db.doc(`${T}/clients/b1`).set({ id: 'b1', name: 'Bea Both', phone: '+15555550903' });
  await db.doc(`${T}/clients/b2`).set({ id: 'b2', name: 'Bea Both', phone: '+15555550903', ownerRenterId: 'rent1' });
  console.log('Renter messages — who a reply belongs to');
  const g = await RI.replyOwner(db, 't1', '+15555550901', NOW);
  check('a number that only belongs to a renter’s own client → the renter', g.owner === 'renter' && (g as any).renterId === 'rent1' && (g as any).staffId === 'rs1' && (g as any).clientId === 'g1', g);
  check('a studio client → the studio', (await RI.replyOwner(db, 't1', '+15555550902', NOW)).owner === 'studio');
  check('a client of both, nobody wrote lately → the studio', (await RI.replyOwner(db, 't1', '+15555550903', NOW)).owner === 'studio');
  await db.doc(`${T}/messageLog/m1`).set({ to: '+15555550903', channel: 'sms', kind: 'opportunity', renterId: 'rent1', sentAt: ago(3) });
  check('…but the renter wrote to them 3 hours ago → the renter', (await RI.replyOwner(db, 't1', '+15555550903', NOW)).owner === 'renter');
  await db.doc(`${T}/messageLog/m2`).set({ to: '+15555550903', channel: 'sms', kind: 'appointment_reminder', sentAt: ago(1) });
  check('…and the studio wrote after that → the latest conversation wins (studio)', (await RI.replyOwner(db, 't1', '+15555550903', NOW)).owner === 'studio');
  await db.doc(`${T}/appointments/a9`).set({ isRenterBooking: true, staffId: 'rs1' });
  await db.doc(`${T}/messageLog/m3`).set({ to: '+15555550902', channel: 'sms', kind: 'appointment_reminder', appointmentId: 'a9', sentAt: ago(2) });
  check('a reminder about one of the renter’s bookings → the renter', (await RI.replyOwner(db, 't1', '+15555550902', NOW)).owner === 'renter');
  await db.doc(`${T}/messageLog/m4`).set({ to: '+15555550901', channel: 'sms', kind: 'campaign', sentAt: new Date(NOW - 20 * 864e5).toISOString() });
  check('older than 14 days doesn’t count; falls back to whose client it is', (await RI.replyOwner(db, 't1', '+15555550901', NOW)).owner === 'renter');
  console.log('Renter messages — the inbox');
  await RI.recordRenterSent(db, 't1', 'rent1', '+15555550901', 'Rosa Nails: Would you like a time?', { clientId: 'g1', clientName: 'Gwen Park', kind: 'opportunity' }, NOW - 3600e3);
  const r = await RI.routeToRenter(db, 't1', g as any, '+15555550901', 'Yes! Thursday?', 0, NOW);
  const r2 = await RI.routeToRenter(db, 't1', g as any, '+15555550901', 'Or Friday', 0, NOW + 5 * 60e3);
  const th = await RI.renterThreads(db, 't1', 'rent1', NOW + 6 * 60e3);
  check('her text and Gwen’s two replies read as one conversation, two unread', th.length === 1 && th[0].messages.length === 3 && th[0].unread === 2 && th[0].messages[0].direction === 'out' && th[0].clientName === 'Gwen Park', th);
  check('one alert for a quick back-and-forth, not one per line', r.alerted === true && r2.alerted === false);
  check('the studio keeps only a count', Number(((await db.doc(`${T}/private/renterRouting`).get()).data() || {})['2026-10-13']) === 2 && !(await db.collection(`${T}/smsInbox`).get()).docs.length);
  check('another renter never sees it', (await RI.renterThreads(db, 't1', 'rent2', NOW)).length === 0);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
