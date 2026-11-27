// src/lib/trip-log.ts — THE BUSINESS'S MILEAGE LOG (pure; design board "Mileage: logged as you go, with proof"). Drives
// for the business are hard to add up and harder to prove, so they often go unclaimed. Here each one is kept as it
// happens, with what the IRS asks a mileage log to show (Publication 463): the date, where from and to, why, and the
// miles. The miles come from the map by road, so nobody adds them up.
//   - Start a drive when leaving and end it on arrival (the two places only: the phone doesn't follow the whole way);
//     or add a trip after, from places kept here (the business, home, places driven to before) or a typed address.
//   - Suggested trips: card purchases made in a store and off-site events, each a tap to log with the purchase or event
//     kept as proof the drive happened (lib/trip-log-server).
//   - Home to the business is commuting, which isn't a write-off, unless home is the main place of business.
//   - The year: business miles at the IRS rate for that year (`IRS_RATES`, updated each December with the tax tables),
//     commuting miles, and two odometer readings (January 1 and December 31) for the total and the other miles the
//     return's vehicle questions ask for (Schedule C, Part IV).
// Kept server only: tenants/{t}/private/trip_{id} (one a trip), private/tripSetup (home, the readings, suggestions
// passed over), private/drive_{userId} (a drive under way). Miles are kept in tenths.

/** The IRS business standard mileage rate, in tenths of a cent a mile, by year (Notice 2026-10: 72.5¢ for 2026). Each
 *  December, add the next year's once the IRS announces it; a year with none uses the latest and says so. */
export const IRS_RATES: Record<number, number> = { 2024: 670, 2025: 700, 2026: 725 };
const LATEST_RATE_YEAR = Math.max(...Object.keys(IRS_RATES).map(Number));

export function rateFor(year: number): { year: number; tenthCents: number; stale: boolean; label: string } {
  const y = IRS_RATES[year] ? year : LATEST_RATE_YEAR; const t = IRS_RATES[y];
  return { year: y, tenthCents: t, stale: !IRS_RATES[year], label: `${t % 10 ? (t / 10).toFixed(1) : String(t / 10)}¢` };
}

/** What `tenths` of a mile come to at the year's rate, in cents. */
export const amountCents = (tenths: number, year: number) => Math.round((Math.max(0, tenths) * rateFor(year).tenthCents) / 100);

/** "6.4", "1,284" (whole miles once it's long), from tenths. */
export function milesText(tenths: number, whole = false): string {
  const m = Math.max(0, Math.round(Number(tenths) || 0)) / 10;
  return whole || m >= 1000 ? Math.round(m).toLocaleString('en-US') : m.toFixed(1);
}

export const PURPOSES = [
  { id: 'supplies', label: 'Supplies' },
  { id: 'bank', label: 'Bank' },
  { id: 'client', label: 'A client’s place' },
  { id: 'event', label: 'An event' },
  { id: 'class', label: 'Class' },
  { id: 'post', label: 'Post office' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'other', label: 'Something else' },
] as const;
export type Purpose = (typeof PURPOSES)[number]['id'];
export const purposeLabel = (id: string) => PURPOSES.find((p) => p.id === id)?.label || 'Something else';

/** A place on a trip: its name or address, where it is on the map when known, and which kept place it is ('home', or
 *  'biz:<locationId>'), if any. */
export type TripPlace = { label: string; lat?: number; lng?: number; ref?: string | null };
export type TripProof = { kind: 'card' | 'event'; id: string; label: string; amountCents?: number | null; at?: string | null };
export type Trip = {
  kind: 'trip'; id: string; year: number; day: string;
  /** Business, or commuting (kept for the return's commuting miles, never counted as a write-off). */
  use: 'business' | 'commute';
  purpose: Purpose; note: string;
  from: TripPlace; to: TripPlace;
  oneWayTenths: number; roundTrip: boolean; tenths: number;
  /** Where the miles came from: a drive (its two ends, by road), the map between two places, or typed. `road`: by road
   *  on the map (else the straight line, a little more for roads). */
  how: 'drive' | 'map' | 'typed'; road: boolean;
  started?: string | null; ended?: string | null;
  proof?: TripProof | null;
  by: { id: string; name: string }; at: string;
  edits?: { at: string; by: string; was: string }[];
  removed?: { at: string; by: string } | null;
};
export type TripSetup = {
  home?: TripPlace | null;
  /** Home is the main place of business (a business run from home): drives from home count. */
  homeIsMain?: boolean;
  odometer?: Record<string, { start?: number | null; end?: number | null }>;
  /** Suggestions passed over ('Not a drive'), newest last. */
  dismissed?: string[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/** A place as sent: a name or address (needed), and where it is when it's on the map. */
export function cleanPlace(p: any): TripPlace | null {
  const label = clip(p?.label, 160); if (!label) return null;
  const lat = num(p?.lat), lng = num(p?.lng);
  const on = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const ref = typeof p?.ref === 'string' && /^(home|biz:[A-Za-z0-9_-]{1,80})$/.test(p.ref) ? p.ref : null;
  return { label, ...(on ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : {}), ref };
}

/** Tenths of a mile from typed miles ("6.4"): 0.1 to 1,000 miles one way. */
export function tenthsOf(v: unknown): number | null {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!/^\d{1,4}(\.\d)?$/.test(s)) return null;
  const t = Math.round(Number(s) * 10);
  return t >= 1 && t <= 10000 ? t : null;
}

/** The days a trip can be logged for: this year and last (a return is filed the spring after), never a day to come. */
export function dayOk(day: string, today: string): boolean {
  if (!DAY.test(day) || day > today) return false;
  return Number(day.slice(0, 4)) >= Number(today.slice(0, 4)) - 1;
}

/** Commuting: home and the business's own place, either way, when home isn't the main place of business. */
export function isCommute(from: TripPlace, to: TripPlace, setup: TripSetup | null | undefined): boolean {
  if (setup?.homeIsMain) return false;
  const ends = [from.ref || '', to.ref || ''];
  return ends.includes('home') && ends.some((r) => r.startsWith('biz:'));
}

/** What the owner chose on the save screen, checked: why, a few words, the day, round trip, and business or commute. */
export function cleanChoice(b: any, today: string): { ok: true; purpose: Purpose; note: string; day: string; roundTrip: boolean; use: 'business' | 'commute' } | { ok: false; error: string } {
  const purpose = String(b?.purpose || '') as Purpose;
  const use = b?.use === 'commute' ? 'commute' : 'business';
  if (use === 'business' && !PURPOSES.some((p) => p.id === purpose)) return { ok: false, error: 'Pick what the trip was for.' };
  const day = String(b?.day || today);
  if (!dayOk(day, today)) return { ok: false, error: 'A trip from this year or last, up to today.' };
  return { ok: true, purpose: use === 'commute' ? 'other' : purpose, note: clip(b?.note, 120), day, roundTrip: b?.roundTrip === true, use };
}

/** One way's miles, and the trip's in all (round trip: twice). */
export const tripTenths = (oneWay: number, roundTrip: boolean) => Math.max(0, Math.round(oneWay)) * (roundTrip ? 2 : 1);

export type YearSummary = {
  /** `sameDay`: business trips logged within a day of the drive (records made at the time count most). */
  year: number; trips: number; backed: number; sameDay: number; businessTenths: number; commuteTenths: number; amountCents: number;
  rate: ReturnType<typeof rateFor>;
  odometer: { start: number | null; end: number | null };
  /** From the two readings: every mile the car went, and those neither business nor commuting. */
  totalTenths: number | null; otherTenths: number | null;
};

export function yearSummary(trips: Trip[], year: number, setup?: TripSetup | null): YearSummary {
  const live = trips.filter((t) => t && t.kind === 'trip' && !t.removed && t.year === year);
  const biz = live.filter((t) => t.use === 'business');
  const businessTenths = biz.reduce((a, t) => a + (Number(t.tenths) || 0), 0);
  const commuteTenths = live.filter((t) => t.use === 'commute').reduce((a, t) => a + (Number(t.tenths) || 0), 0);
  const o = setup?.odometer?.[String(year)] || {};
  const start = Number.isFinite(Number(o.start)) && o.start != null ? Number(o.start) : null;
  const end = Number.isFinite(Number(o.end)) && o.end != null ? Number(o.end) : null;
  const totalTenths = start != null && end != null && end >= start ? (end - start) * 10 : null;
  return {
    year, trips: biz.length, backed: biz.filter((t) => !!t.proof).length, businessTenths, commuteTenths,
    sameDay: biz.filter((t) => t.how === 'drive' || Math.abs(Date.parse(String(t.at)) - Date.parse(`${t.day}T12:00:00Z`)) <= 36 * 3600e3).length,
    amountCents: amountCents(businessTenths, year), rate: rateFor(year), odometer: { start, end }, totalTenths,
    otherTenths: totalTenths != null ? Math.max(0, totalTenths - businessTenths - commuteTenths) : null,
  };
}

/** An odometer reading as typed: whole miles, up to 9,999,999. */
export function cleanReading(v: unknown): number | null | undefined {
  if (v === null || v === '') return null;
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!/^\d{1,7}$/.test(s)) return undefined;
  return Number(s);
}

/** What changed on an edit, said for the trip's history ("miles 6.4 → 7.0"). */
export function editWords(was: Trip, now: Partial<Trip>): string {
  const out: string[] = [];
  if (now.purpose && now.purpose !== was.purpose) out.push(`for ${purposeLabel(was.purpose)} → ${purposeLabel(now.purpose)}`);
  if (now.day && now.day !== was.day) out.push(`day ${was.day} → ${now.day}`);
  if (now.tenths != null && now.tenths !== was.tenths) out.push(`miles ${milesText(was.tenths)} → ${milesText(now.tenths)}`);
  if (now.use && now.use !== was.use) out.push(`${was.use} → ${now.use}`);
  if (now.note != null && now.note !== was.note) out.push('note');
  return out.join(', ');
}

/* ─── For the accountant ─────────────────────────────────────────────────────── */

const csvCell = (v: unknown) => { const s = String(v ?? ''); const f = /^[=+\-@\t\r]/.test(s); return /[",\n\r\t]/.test(s) || f ? `"${(f ? `'${s}` : s).replace(/"/g, '""')}"` : s; };

/** The year's log as a spreadsheet: one row a trip, business and commuting, oldest first. */
export function logCsv(trips: Trip[], year: number): string {
  const rows = trips.filter((t) => !t.removed && t.year === year).sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  const head = ['Date', 'From', 'To', 'Business or commuting', 'What for', 'Note', 'Miles', 'Round trip', 'Miles from', 'Proof', 'Logged at', 'Logged by'];
  const body = rows.map((t) => [t.day, t.from.label, t.to.label, t.use === 'commute' ? 'Commuting' : 'Business', t.use === 'commute' ? '' : purposeLabel(t.purpose), t.note,
    milesText(t.tenths), t.roundTrip ? 'Yes' : 'No', t.how === 'typed' ? 'Typed' : t.road ? 'Map, by road' : 'Map, estimated', t.proof ? t.proof.label : '', t.at, t.by.name]);
  return [head, ...body].map((r) => r.map(csvCell).join(',')).join('\n');
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

/** The printable log's body (lib/print-style printPage wraps it): the year's figures, then every trip. */
export function logBodyHtml(trips: Trip[], year: number, setup?: TripSetup | null): string {
  const s = yearSummary(trips, year, setup);
  const rows = trips.filter((t) => !t.removed && t.year === year).sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  const fig = (k: string, v: string) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`;
  const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `<table class="t"><tbody>
${fig('Business miles', milesText(s.businessTenths))}
${fig(`At the IRS rate for ${s.rate.year} (${s.rate.label} a mile)`, money(s.amountCents))}
${fig('Commuting miles (not counted)', milesText(s.commuteTenths))}
${fig('Odometer, January 1', s.odometer.start != null ? s.odometer.start.toLocaleString('en-US') : 'Not entered')}
${fig('Odometer, December 31', s.odometer.end != null ? s.odometer.end.toLocaleString('en-US') : 'Not entered')}
${s.totalTenths != null ? fig('All miles this year', milesText(s.totalTenths)) + fig('Other miles', milesText(s.otherTenths || 0)) : ''}
${fig('Business trips, and those with a purchase or event as proof', `${s.trips}, ${s.backed}`)}
</tbody></table>
<table class="t"><thead><tr><th>Date</th><th>From</th><th>To</th><th>For</th><th class="num">Miles</th><th>Proof</th></tr></thead><tbody>
${rows.map((t) => `<tr><td>${esc(t.day)}</td><td>${esc(t.from.label)}</td><td>${esc(t.to.label)}${t.roundTrip ? ' and back' : ''}</td><td>${esc(t.use === 'commute' ? 'Commuting' : purposeLabel(t.purpose))}${t.note ? `: ${esc(t.note)}` : ''}</td><td class="num">${milesText(t.tenths)}</td><td>${esc(t.proof?.label || '')}</td></tr>`).join('\n')}
</tbody></table>`;
}
