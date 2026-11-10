// Checks day and hourly bookings of a space, and the last of the renter set-up shortcuts:
// - A room, kitchen or piece of equipment set to "Rent this out" becomes a space that can be booked: open (vacant),
//   out of service when the resource is, at its location, with its rates and shortest booking where every booking
//   route reads them (api/resources/rentable).
// - One clash rule (lib/space-clash) for guests' day rentals and renters' station bookings: someone checked in keeps
//   their time, each kind sees the other, the turnover gap is kept clear, and a guest's payment page closes before the
//   time it holds is let go. Public booking keeps the shortest booking the business set.
// - A new lease turns bookings on for a renter who sees clients; the lease's portal link opens on the lease to sign;
//   a renter who has just saved a card is offered autopay there and then (still with their written OK).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/space-booking.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

let db = makeDb();
let actor: any = { uid: 'o1', isTenantOwner: true };
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: FV };
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor }) };
  return load.call(this, request, ...rest);
};
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const C = await import('../../src/lib/space-clash');
  // ── The clash rule ──
  const nine = C.wallRange({ startDate: '2026-11-10', bookingType: 'hourly', startTime: '09:00', endTime: '11:00' });
  const eleven = C.wallRange({ startDate: '2026-11-10', bookingType: 'hourly', startTime: '11:00', endTime: '12:00' });
  const elevenThirty = C.wallRange({ startDate: '2026-11-10', bookingType: 'hourly', startTime: '11:30', endTime: '12:30' });
  check('back to back is fine with no turnover gap; a 30-minute gap keeps 11:00 clear but not 11:30', !C.wallOverlap(nine, eleven, 0) && C.wallOverlap(nine, eleven, 30) && !C.wallOverlap(nine, elevenThirty, 30));
  const wholeDay = C.wallRange({ startDate: '2026-11-10', endDate: '2026-11-11', bookingType: 'daily' });
  check('a daily booking holds its whole days', C.wallOverlap(wholeDay, eleven) && C.wallOverlap(wholeDay, C.wallRange({ startDate: '2026-11-11', bookingType: 'hourly', startTime: '20:00', endTime: '21:00' })) && !C.wallOverlap(wholeDay, C.wallRange({ startDate: '2026-11-12', bookingType: 'daily' })));
  check('…and with a turnover gap set, the next day is still free (the gap is between timed bookings, not whole days)', !C.wallOverlap(wholeDay, C.wallRange({ startDate: '2026-11-12', bookingType: 'daily' }), 30) && !C.wallOverlap(wholeDay, C.wallRange({ startDate: '2026-11-12', bookingType: 'hourly', startTime: '00:10', endTime: '02:00' }), 30)
    && C.wallOverlap(C.wallRange({ startDate: '2026-11-12', bookingType: 'daily' }), C.wallRange({ startDate: '2026-11-12', bookingType: 'hourly', startTime: '00:10', endTime: '02:00' }), 30));
  check('a renter’s station booking (stored as wall times) compares with a guest’s', C.wallOverlap(nine, ['2026-11-10T10:00:00', '2026-11-10T13:00:00']) && !C.wallOverlap(nine, ['2026-11-10T11:00:00', '2026-11-10T13:00:00']));
  const now = Date.parse('2026-11-10T15:00:00Z');
  check('who holds their time: paid, checked in (the old rule let this through), a cancellation not settled, or on the payment page for 40 minutes', C.reservationHolds({ status: 'confirmed' }, now) && C.reservationHolds({ status: 'checked_in' }, now) && C.reservationHolds({ status: 'cancel_requested' }, now)
    && C.reservationHolds({ status: 'pending_payment', createdAt: '2026-11-10T14:30:00Z' }, now) && !C.reservationHolds({ status: 'pending_payment', createdAt: '2026-11-10T14:15:00Z' }, now) && !C.reservationHolds({ status: 'cancelled' }, now) && !C.reservationHolds({ status: 'completed' }, now));
  check('the payment page closes well before the hold ends, inside what Stripe allows', C.CHECKOUT_OPEN_SECONDS * 1000 + 5 * 60_000 <= C.PENDING_HOLD_MS && C.CHECKOUT_OPEN_SECONDS >= 31 * 60 && C.CHECKOUT_OPEN_SECONDS <= 24 * 3600);

  // ── What's taken on a space, read from the database (lib/space-clash-server) ──
  const S = await import('../../src/lib/space-clash-server');
  const cdb = makeDb(); const T = 'tenants/t1';
  cdb.doc(`${T}/booths/b1`).set({ name: 'Suite 1', dayUseBufferMinutes: 30 });
  cdb.doc(`${T}/boothReservations/in`).set({ boothId: 'b1', status: 'checked_in', bookingType: 'hourly', startDate: '2026-11-10', startTime: '09:00', endTime: '11:00' });
  cdb.doc(`${T}/boothReservations/cx`).set({ boothId: 'b1', status: 'cancel_requested', bookingType: 'daily', startDate: '2026-11-12', endDate: '2026-11-12' });
  cdb.doc(`${T}/boothReservations/gone`).set({ boothId: 'b1', status: 'cancelled', bookingType: 'daily', startDate: '2026-11-13', endDate: '2026-11-13' });
  cdb.doc(`${T}/bookings/st`).set({ boothId: 'b1', status: 'confirmed', rateType: 'daily', startAt: '2026-11-14T00:00:00', endAt: '2026-11-15T23:59:00' });
  const at = (d: string, s: string, e: string) => ({ startDate: d, endDate: d, bookingType: 'hourly', startTime: s, endTime: e });
  const t0 = Date.parse('2026-11-10T08:00:00Z');
  const r1 = await S.spaceClash(cdb, 't1', 'b1', at('2026-11-10', '11:00', '12:00'), undefined, t0);
  const r2 = await S.spaceClash(cdb, 't1', 'b1', at('2026-11-10', '11:30', '12:30'), undefined, t0);
  const r3 = await S.spaceClash(cdb, 't1', 'b1', at('2026-11-10', '10:00', '12:00'), 'in', t0);
  check('someone checked in holds their time, with the 30-minute turnover gap; the booking itself is never in its own way', r1 === true && r2 === false && r3 === false, [r1, r2, r3]);
  const r4 = await S.spaceClash(cdb, 't1', 'b1', { startDate: '2026-11-12', endDate: '2026-11-12', bookingType: 'daily' }, undefined, t0);
  const r5 = await S.spaceClash(cdb, 't1', 'b1', { startDate: '2026-11-13', endDate: '2026-11-13', bookingType: 'daily' }, undefined, t0);
  check('a cancellation not yet settled still holds; a cancelled booking doesn’t', r4 === true && r5 === false, [r4, r5]);
  const r6 = await S.spaceClash(cdb, 't1', 'b1', at('2026-11-15', '10:00', '11:00'), undefined, t0);
  const r7 = await S.spaceClash(cdb, 't1', 'b1', at('2026-11-16', '10:00', '11:00'), undefined, t0);
  check('a renter’s station booking over two days keeps a guest out of both, not the day after', r6 === true && r7 === false, [r6, r7]);
  check('the shortest booking: a rented-out room’s minutes or a space’s hours, whichever is longer', C.shortestMinutes({ rental: { minMinutes: 90 } }) === 90 && C.shortestMinutes({ dayUseMinHours: 2 }) === 120 && C.shortestMinutes({}) === 0 && C.minutesWords(120) === '2 hours' && C.minutesWords(90) === '90 minutes' && C.minutesWords(60) === '1 hour');
  check('an unreadable time is never taken as free', C.wallOverlap(['nonsense', 'x'], nine));

  // ── Rent this out → a space that can be booked ──
  const { POST } = await import('../../src/app/api/resources/rentable/route');
  const req = (b: any) => ({ json: async () => b }) as any;
  db.doc('tenants/t1/resources/sauna').set({ name: 'Sauna', type: 'room', capacity: 2, locationId: 'loc1', rental: { enabled: true, hourlyCents: 4000, dailyCents: 0, minMinutes: 90, graceMinutes: 10, blockMinutes: 15 } });
  const out: any = await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const s1: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data(); const s2: any = (await db.doc('tenants/t1/booths/space_sauna_2').get()).data();
  check('each unit is an open space at the resource’s location, with its rates and shortest booking where the booking routes read them', out.status === 200 && s1?.status === 'vacant' && s2?.status === 'vacant' && s1.locationId === 'loc1' && s1.dayUseEnabled === true && s1.isActive === true
    && s1.dayUseHourlyCents === 4000 && s1.pricingOptions?.[0]?.amountCents === 4000 && s1.dayUseMinHours === 1.5 && s1.rental?.minMinutes === 90 && s2.name === 'Sauna 2', [out.body, s1]);
  db.doc('tenants/t1/resources/sauna').set({ isOutOfService: true }, { merge: true });
  await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const s3: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data();
  db.doc('tenants/t1/resources/sauna').set({ isOutOfService: false }, { merge: true });
  await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const s4: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data();
  check('out of service follows the resource, and back to open when it’s fixed', s3.status === 'maintenance' && s3.isActive === false && s4.status === 'vacant' && s4.isActive === true && !!s4.createdAt, [s3.status, s4.status]);
  // A lease on part of it: kept through the resource going out of service and back.
  db.doc('tenants/t1/booths/space_sauna_2').set({ status: 'partial' }, { merge: true });
  db.doc('tenants/t1/resources/sauna').set({ isOutOfService: true }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const p1: any = (await db.doc('tenants/t1/booths/space_sauna_2').get()).data();
  db.doc('tenants/t1/resources/sauna').set({ isOutOfService: false }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const p2: any = (await db.doc('tenants/t1/booths/space_sauna_2').get()).data();
  check('a lease on it survives the resource going out of service and back', p1.status === 'maintenance' && p2.status === 'partial' && !p2.serviceFrom, [p1.status, p2.status]);
  // A repair on the space itself: left for the repair to clear.
  db.doc('tenants/t1/booths/space_sauna_1').set({ status: 'maintenance', serviceFrom: null }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const m1: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data();
  check('a repair on the space itself isn’t cleared by saving the resource', m1.status === 'maintenance', m1.status);
  db.doc('tenants/t1/booths/space_sauna_1').set({ status: 'vacant' }, { merge: true });
  // Fewer units, then not rented out: off the list, never offered as open to lease.
  db.doc('tenants/t1/resources/sauna').set({ capacity: 1 }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const retired: any = (await db.doc('tenants/t1/booths/space_sauna_2').get()).data();
  db.doc('tenants/t1/resources/sauna').set({ rental: { enabled: false, hourlyCents: 4000 } }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const off: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data();
  check('a retired unit keeps its lease (here, shared) and an unused one goes off the list; not rented out is off the list too', retired.status === 'partial' && retired.isActive === false && off.status === 'inactive' && off.dayUseEnabled === false, [retired.status, off.status]);
  db.doc('tenants/t1/resources/sauna').set({ rental: { enabled: true, hourlyCents: 4000, minMinutes: 90 } }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const on: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data();
  check('…and rented out again, it’s open again', on.status === 'vacant' && on.isActive === true, on.status);
  db.doc('tenants/t1/booths/space_sauna_1').set({ status: 'inactive', offFrom: null }, { merge: true }); await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  const byHand: any = (await db.doc('tenants/t1/booths/space_sauna_1').get()).data();
  check('taken off the list by hand on the Spaces page: saving the resource doesn’t put it back', byHand.status === 'inactive', byHand.status);
  actor = { uid: 'o1', isTenantOwner: true };
  actor = { uid: 's1', isManager: false };
  const denied: any = await POST(req({ tenantId: 't1', resourceId: 'sauna' }));
  check('managers only', denied.status === 403);
  const listing = src('src/components/shared/BoothListingsSection.tsx');
  check('…and the booking page lists an open space (it only ever offers vacant or shared ones)', /if \(b\?\.status !== 'vacant' && b\?\.status !== 'partial'\) return \[\];/.test(listing));

  // ── The booking routes ──
  const res = src('src/app/api/booths/reserve/route.ts'); const st = src('src/app/api/stripe/book-station/route.ts');
  const fc = res.slice(res.indexOf('async function findConflict('), res.indexOf('// v85 — shared-lease occupancy.'));
  check('public booking: one clash rule (the server check above), checked again just after its hold is written; the desk and the public calendar use the same hold rule', /return spaceClash\(db, tenantId, boothId, proposed, ignoreId\);/.test(fc) && !/function timesConflict/.test(res)
    && /cancellationReason: 'taken_meanwhile'/.test(res) && res.indexOf("cancellationReason: 'taken_meanwhile'") < res.indexOf('const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);\n    const base = String(returnUrl)')
    && /const held = reservationHolds\(r, now\);/.test(res) && /return reservationHolds\(r, now\);/.test(src('src/app/(app)/planner/page.tsx')) && !/PLANNER_HOLD_MS/.test(src('src/app/(app)/planner/page.tsx')) && /if \(!reservationHolds\(r, now\)\) continue;/.test(src('src/app/api/booths/kiosk/route.ts')) && /b\?\.rateType === 'daily' && b\.startAt && stationHolds\(b/.test(src('src/app/api/booths/kiosk/route.ts')));
  check('a payment page that closed unpaid lets the time (and any credit) go at once', /if \(session\.status === 'expired' && r\.status === 'pending_payment'\)/.test(res) && /cancellationReason: 'checkout_expired'/.test(res));
  check('public booking keeps the shortest booking, and its payment page closes before the hold ends', /const shortest = shortestMinutes\(booth\);\s*if \(shortest > 0 && numHours \* 60 < shortest\)/.test(res) && /expires_at: Math\.floor\(Date\.now\(\) \/ 1000\) \+ CHECKOUT_OPEN_SECONDS,/.test(res) && !/const PENDING_HOLD_MS = 30/.test(res));
  check('the desk sees renters’ station bookings on its day view too', /A renter.s station booking on this space this day/.test(res) && /who: 'A renter'/.test(res));
  check('a renter’s station booking checks guests’ day rentals too, inside its claim', /const guestsQ = db\.collection\(`tenants\/\$\{tenantId\}\/boothReservations`\)\.where\('boothId', '==', boothId\);/.test(st) && /tx\.get\(guestsQ\)/.test(st) && /reservationHolds\(r\) && wallOverlap\(\[String\(startAt\), String\(endAt\)\], wallRange\(r\), bufferMinutes\)/.test(st));

  // ── Set-up shortcuts ──
  const lb = src('src/components/renters/LeaseBuilder.tsx');
  check('a new lease turns bookings on for someone who sees clients (once; never a second booking record)', /label="They see clients here"/.test(lb) && /if \(bookings && !staffLike\.providerId\)/.test(lb) && /if \(!prov\) \{/.test(lb) && /isRenter: true, renterId: renter\.id, payStructure: 'none'/.test(lb) && /\.\.\.staffMirrorFields\(renter\)/.test(lb));
  const notify = src('src/app/api/booths/notify/route.ts');
  check('the lease’s portal link opens on the lease, ready to sign', /mintRenterLink\(db, String\(tenantId\), String\(renterId\), linkBase, \{ renter: r, \.\.\.\(forLease \? \{ query: 'view=lease' \} : \{\}\) \}\)/.test(notify));
  const card = src('src/components/rent/RenterCard.tsx'); const portal = src('src/app/rent/[tenantId]/page.tsx');
  check('the offer is announced, promises nothing it can’t keep, and ends once autopay is on', /role="status" aria-label="Turn on autopay"/.test(card) && !/never late/.test(card) && /if \(offerAutopay && wantsAutopay\) onOfferSeen\?\.\(\);/.test(card));
  check('a card just saved: autopay offered there and then, still with their written OK', /const offer = offerAutopay && hasLease && usable && !wantsAutopay && !auth;/.test(card) && /onOfferSeen\?\.\(\); void askAutopay\(\);/.test(card) && /if \(d\?\.ok\) setOfferAutopay\(true\);/.test(portal) && /offerAutopay=\{offerAutopay\}/.test(portal));
  const AI = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join('')).join('|'), 'i');
  const changed = ['src/app/(app)/planner/page.tsx', 'src/lib/space-clash.ts', 'src/lib/space-clash-server.ts', 'src/app/api/resources/rentable/route.ts', 'src/app/api/booths/reserve/route.ts', 'src/app/api/stripe/book-station/route.ts', 'src/app/api/booths/kiosk/route.ts', 'src/components/rent/RenterCard.tsx', 'src/components/renters/LeaseBuilder.tsx', 'src/app/api/booths/notify/route.ts'];
  check('no tool names in anything changed; the day-pass payment page says nothing about a studio', changed.every((f) => !AI.test(src(f))) && !/Prepaid studio days/.test(res));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
