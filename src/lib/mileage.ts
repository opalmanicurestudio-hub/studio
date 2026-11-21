// src/lib/mileage.ts — MILES DRIVEN, DAY BY DAY (pure; design board "Sold out on the apps too, and every driver's miles
// kept"). Each driver types their odometer when they start delivering and when they're done (the staff app's Deliveries
// tab); the day's miles are the difference. Hot food trips are counted too, there and back from the map (or from the
// drive when the map had no miles), as a check, and as the day's miles when a reading is missing. The Money page shows
// each driver's month, and what's owed at the business's rate a mile (its own choice; none: miles only).
// A reading typed again is kept with what it was before (`edits`), and a day whose readings come to far more than its
// trips is marked to check.
//   tenants/{t}/private/mileage_{day}_{driverId} = { kind: 'mileage', day, month, driverId, driverName, startOdo?, endOdo?,
//     startAt?, endAt?, edits?: { which, was, at }[], trips: { [out]: tenths }, hotTrips, hotMilesTenths }
//     (one trip a time out: orders taken out together are one trip there and back; read and written by the server only)
//   tenants/{t}.mileage = { rateCents }

/** The most a day's odometer readings can be apart (more is a typing slip). */
export const MAX_DAY_MILES = 1000;
export const mileageId = (day: string, driverId: string) => `mileage_${day}_${driverId}`;

/** An odometer reading as typed (commas and spaces fine): whole miles, or null. */
export function cleanOdo(v: unknown): number | null {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!/^\d{1,7}(\.\d)?$/.test(s)) return null;
  return Math.floor(Number(s));
}

/** One hot food trip there and back, in tenths of a mile: the map's miles each way, or from the drive (lib/food-delivery
 *  driveMinutes, about 4 minutes to get going and 2.5 a mile). */
export function hotTripTenths(oneWayMiles: unknown, driveMin: unknown): number {
  const m = Number(oneWayMiles);
  const one = oneWayMiles !== null && oneWayMiles !== undefined && Number.isFinite(m) && m > 0 ? m : Math.max(0.5, ((Number(driveMin) || 15) - 4) / 2.5);
  return Math.round(one * 2 * 10);
}

export type MileDay = { day: string; driverId: string; driverName: string; startOdo: number | null; endOdo: number | null; hotTrips: number; hotMilesTenths: number; edited?: boolean };

/** The odometer says far more than the day's hot food trips (more than three times, and ten miles over): one to check. */
export function dayToCheck(d: MileDay): boolean {
  const m = dayMiles(d); if (m.from !== 'odometer' || !d.hotTrips) return false;
  return m.miles > (d.hotMilesTenths / 10) * 3 + 10;
}

/** A day's miles: the odometer's difference when both readings are there; else its hot food trips. */
export function dayMiles(d: MileDay): { miles: number; from: 'odometer' | 'trips' | 'none' } {
  if (d.startOdo !== null && d.endOdo !== null && d.endOdo >= d.startOdo && d.endOdo - d.startOdo <= MAX_DAY_MILES) return { miles: d.endOdo - d.startOdo, from: 'odometer' };
  if (d.hotTrips > 0) return { miles: Math.round(d.hotMilesTenths) / 10, from: 'trips' };
  return { miles: 0, from: 'none' };
}

/** Each driver's month: days driven, miles, days without both readings, and what's owed at the rate (cents a mile). */
export function monthByDriver(days: MileDay[], rateCents: number | null) {
  const by = new Map<string, { driverId: string; name: string; days: number; miles: number; missing: number; toCheck: number; edited: number; owedCents: number | null }>();
  for (const d of days) {
    const m = dayMiles(d); if (m.from === 'none' && d.startOdo === null) continue;
    const g = by.get(d.driverId) || { driverId: d.driverId, name: d.driverName, days: 0, miles: 0, missing: 0, toCheck: 0, edited: 0, owedCents: null };
    g.days++; g.miles = Math.round((g.miles + m.miles) * 10) / 10; if (m.from !== 'odometer') g.missing++; if (dayToCheck(d)) g.toCheck++; if (d.edited) g.edited++;
    g.owedCents = rateCents ? Math.round(g.miles * rateCents) : null;
    by.set(d.driverId, g);
  }
  return Array.from(by.values()).sort((a, b) => b.miles - a.miles);
}

/** The log for a bookkeeper: one line a driver a day. */
export function mileageCsv(days: MileDay[]): string {
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [...days].sort((a, b) => a.day.localeCompare(b.day) || a.driverName.localeCompare(b.driverName)).map((d) => {
    const m = dayMiles(d);
    return [d.day, d.driverName, d.startOdo ?? '', d.endOdo ?? '', m.miles, m.from === 'odometer' ? 'Odometer' : m.from === 'trips' ? 'Hot food trips, from the map' : '', d.hotTrips, d.edited ? 'Yes' : ''].map(q).join(',');
  });
  return ['Day,Driver,Odometer start,Odometer end,Miles,How,Hot food trips,Reading changed', ...rows].join('\n');
}

/** The rate a mile as kept (cents, 1 to 500), or null. */
export const rateOf = (tenant: any): number | null => { const n = Math.round(Number(tenant?.mileage?.rateCents)); return Number.isFinite(n) && n >= 1 && n <= 500 ? n : null; };
