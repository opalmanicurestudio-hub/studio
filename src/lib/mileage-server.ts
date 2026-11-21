// src/lib/mileage-server.ts — MILES DRIVEN (server; lib/mileage is the rules). The driver's odometer readings for their
// day (api/drivers/miles, from the staff app's Deliveries tab), each hot food trip counted as it ends (lib/food-delivery-
// server deliveryEnd), and a month for the Money page. The day is the business's (from its cutover hour).
import { cleanOdo, hotTripTenths, MAX_DAY_MILES, mileageId, type MileDay } from '@/lib/mileage';
import { tonight } from '@/lib/night-close-server';

type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const asDay = (x: any): MileDay => ({ day: String(x.day || ''), driverId: String(x.driverId || ''), driverName: String(x.driverName || 'A driver'), startOdo: x.startOdo ?? null, endOdo: x.endOdo ?? null,
  hotTrips: Math.round(num(x.hotTrips)), hotMilesTenths: Math.round(num(x.hotMilesTenths)), edited: Array.isArray(x.edits) && x.edits.length > 0 });

/** The driver's day so far. */
export async function milesToday(db: any, tenantId: string, tenant: any, driverId: string, now = Date.now()): Promise<MileDay & { startAt: string | null; endAt: string | null }> {
  const day = tonight(tenant, new Date(now));
  const x: any = (await db.doc(`tenants/${tenantId}/private/${mileageId(day, driverId)}`).get()).data() || {};
  return { ...asDay({ ...x, day, driverId }), startAt: x.startAt || null, endAt: x.endAt || null };
}

/** An odometer reading for the start or the end of their day (typed again: changed). */
export async function odometer(db: any, tenantId: string, tenant: any, who: { id: string; name: string }, which: unknown, value: unknown, now = Date.now()): Promise<{ ok: true; day: MileDay } | Fail> {
  if (!ID.test(who.id)) return fail('Sign in again.', 401);
  if (which !== 'start' && which !== 'end') return fail('The start of the day, or the end?', 400);
  const v = cleanOdo(value); if (v === null) return fail('Type the odometer’s miles, numbers only.', 400);
  const day = tonight(tenant, new Date(now)); const ref = db.doc(`tenants/${tenantId}/private/${mileageId(day, who.id)}`);
  return db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data() || {};
    const start = which === 'start' ? v : x.startOdo ?? null; const end = which === 'end' ? v : x.endOdo ?? null;
    if (start !== null && end !== null && end < start) return fail(`That’s less than this morning’s ${start.toLocaleString('en-US')}. Check the numbers.`, 400);
    if (start !== null && end !== null && end - start > MAX_DAY_MILES) return fail(`That’s more than ${MAX_DAY_MILES.toLocaleString('en-US')} miles in a day. Check the numbers.`, 400);
    const at = new Date(now).toISOString();
    // (Typed again: what it was is kept beside it.)
    const was = x[`${which}Odo`]; const edits = Array.isArray(x.edits) ? x.edits : [];
    const edit = was !== undefined && was !== null && was !== v ? [...edits, { which, was, at }].slice(-20) : null;
    tx.set(ref, { kind: 'mileage', day, month: day.slice(0, 7), driverId: who.id, driverName: String(who.name || 'A driver').slice(0, 60), [`${which}Odo`]: v, [`${which}At`]: at, [`${which}FirstAt`]: x[`${which}FirstAt`] || at, ...(edit ? { edits: edit } : {}) }, { merge: true });
    return { ok: true as const, day: asDay({ ...x, day, driverId: who.id, driverName: who.name, startOdo: start, endOdo: end, edits: edit || edits }) };
  });
}

/** A hot food trip ended (delivered or brought back): counted on the driver's day, there and back. Orders taken out
 *  together (the same time out) are one trip: the farthest of them. Best effort. */
export async function logHotTrip(db: any, tenantId: string, driver: { id: string | null; name: string }, d: { miles?: unknown; driveMin?: unknown; outAt?: unknown; orderId?: string }, now = Date.now()) {
  if (!driver.id || !ID.test(driver.id)) return;
  try {
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const day = tonight(tenant, new Date(now)); const ref = db.doc(`tenants/${tenantId}/private/${mileageId(day, driver.id)}`);
    // (Keyed by when it went out; orders taken out within a couple of minutes of each other, as Take both does one after
    // the other, are the same trip.)
    const outMs = Date.parse(String(d.outAt || ''));
    const tenths = hotTripTenths(d.miles, d.driveMin);
    await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data() || {};
      const trips = { ...(x.trips && typeof x.trips === 'object' ? x.trips : {}) };
      const near = Number.isFinite(outMs) ? Object.keys(trips).find((k) => /^t\d+$/.test(k) && Math.abs(Number(k.slice(1)) - outMs) <= 2 * 60000) : undefined;
      const key = near || (Number.isFinite(outMs) ? `t${outMs}` : `o${String(d.orderId || now).replace(/[^0-9A-Za-z]/g, '').slice(0, 40)}`);
      trips[key] = Math.max(num(trips[key]), tenths);
      const keys = Object.keys(trips).slice(-200);
      tx.set(ref, { kind: 'mileage', day, month: day.slice(0, 7), driverId: driver.id, driverName: String(driver.name || 'A driver').slice(0, 60), trips,
        hotTrips: keys.length, hotMilesTenths: keys.reduce((n, k) => n + num(trips[k]), 0) }, { merge: true });
    });
  } catch (e: any) { console.error('[mileage] trip', e?.message); }
}

/** This month and last, by the business's day (for the Money page's choice). */
export function businessMonths(tenant: any, now = Date.now()): string[] {
  const m = tonight(tenant, new Date(now)).slice(0, 7); const [y, mo] = m.split('-').map(Number);
  const prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  return [m, prev];
}

/** A month's days, every driver (the Money page). */
export async function milesMonth(db: any, tenantId: string, month: string): Promise<MileDay[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const snap = await db.collection(`tenants/${tenantId}/private`).where('kind', '==', 'mileage').where('month', '==', month).limit(3000).get();
  return snap.docs.map((d: any) => asDay(d.data() || {})).filter((x: MileDay) => x.day && x.driverId);
}
