// src/lib/space-clash-server.ts — IS THIS TIME ON A SPACE ALREADY TAKEN? Reads the space's guests' day rentals and its
// renters' station bookings and asks lib/space-clash, with the turnover gap the business set for the space. Used by the
// guest booking route (api/booths/reserve) before a booking is made, again just after its hold is written (so a booking
// made at the same moment is caught), and when a payment confirms or a booking moves. Admin SDK.
import { wallRange, wallOverlap, reservationHolds, stationHolds, type DayBookingTime } from '@/lib/space-clash';

export async function spaceClash(db: any, tenantId: string, boothId: string, proposed: DayBookingTime, ignoreId?: string, now = Date.now()): Promise<boolean> {
  const T = `tenants/${tenantId}`;
  const space: any = (await db.doc(`${T}/booths/${boothId}`).get()).data() || {};
  const gap = Math.max(0, Number(space.dayUseBufferMinutes) || 0);
  const mine = wallRange(proposed);
  const guests = await db.collection(`${T}/boothReservations`).where('boothId', '==', boothId).get();
  for (const d of guests.docs) {
    if (ignoreId && d.id === ignoreId) continue;
    const r: any = d.data();
    if (reservationHolds(r, now) && wallOverlap(mine, wallRange(r), gap)) return true;
  }
  const nowIso = new Date(now).toISOString();
  const stations = await db.collection(`${T}/bookings`).where('boothId', '==', boothId).get();
  for (const d of stations.docs) {
    const b: any = d.data();
    if (b?.startAt && b?.endAt && stationHolds(b, nowIso) && wallOverlap(mine, [String(b.startAt), String(b.endAt)], gap)) return true;
  }
  return false;
}
