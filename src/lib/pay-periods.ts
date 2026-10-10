// src/lib/pay-periods.ts — THE BUSINESS'S PAY PERIODS AND PAYDAYS, the same way everywhere (staff Pay tab, stubs, PDFs).
//   tenant.payroll.cadence      'weekly' | 'bi-weekly' (default) | 'monthly'
//   tenant.payroll.periodAnchor 'YYYY-MM-DD' — the first day of any one pay period (weekly / bi-weekly). Default: the
//                               start of a workweek in early 2026, so periods line up with overtime weeks.
//   tenant.payroll.paydayAfterDays  days after a period ends that it's paid (default 4).
// Dates are the business's local days.
const DAY = 86400000;
const toDay = (t: number, tz: string) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY);

export type PayPeriod = { from: string; to: string; payday: string; key: string };

export function periodSettings(tenant: any) {
  const p = tenant?.payroll || {}; const ws = Number.isInteger(tenant?.workweekStartsOn) ? tenant.workweekStartsOn : 1;
  // 2026-01-04 is a Sunday; the anchor is the first workweek start on/after it.
  const defAnchor = addDays('2026-01-04', ws);
  return { cadence: String(p.cadence || 'bi-weekly'), anchor: /^\d{4}-\d{2}-\d{2}$/.test(String(p.periodAnchor || '')) ? String(p.periodAnchor) : defAnchor,
    after: Number.isFinite(Number(p.paydayAfterDays)) ? Math.max(0, Math.min(30, Number(p.paydayAfterDays))) : 4, tz: tenant?.timezone || 'America/New_York' };
}

/** The pay period holding a given local day. */
export function periodOf(tenant: any, day: string): PayPeriod {
  const s = periodSettings(tenant);
  let from: string, to: string;
  if (s.cadence === 'monthly') { from = `${day.slice(0, 7)}-01`; const [y, m] = day.split('-').map(Number); to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
  else { const len = s.cadence === 'weekly' ? 7 : 14; const k = Math.floor(diffDays(day, s.anchor) / len); from = addDays(s.anchor, k * len); to = addDays(from, len - 1); }
  return { from, to, payday: addDays(to, s.after), key: from };
}

/** This period and the ones before it, newest first. */
export function recentPeriods(tenant: any, count = 8, now = Date.now()): PayPeriod[] {
  const s = periodSettings(tenant); const out: PayPeriod[] = []; let day = toDay(now, s.tz);
  for (let i = 0; i < count; i++) { const p = periodOf(tenant, day); out.push(p); day = addDays(p.from, -1); }
  return out;
}

/** The instants a period covers, for queries (local midnight to local end of day, in the business's zone). */
export function periodRange(tenant: any, p: { from: string; to: string }) {
  const tz = periodSettings(tenant).tz;
  const off = (d: string) => { const t = Date.parse(`${d}T12:00:00Z`); const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).formatToParts(new Date(t)); const h = Number(parts.find((x) => x.type === 'hour')?.value || 12) % 24; return (h - 12) * 3600000; };
  return { fromIso: new Date(Date.parse(`${p.from}T00:00:00Z`) - off(p.from)).toISOString(), toIso: new Date(Date.parse(`${p.to}T23:59:59.999Z`) - off(p.to)).toISOString() };
}

export const isPaid = (tenant: any, p: PayPeriod, now = Date.now()) => toDay(now, periodSettings(tenant).tz) >= p.payday;
