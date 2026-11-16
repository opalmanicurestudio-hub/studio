// src/lib/records.ts — RECORDS, A MONTH AT A TIME (design canvas "Food numbers": Records). What an accountant, a payroll
// check or the IRS asks for, worked out the same way on the server (lib/records-server, api/records) and the screens:
// the month's days, its records as spreadsheet rows, the cash tips each person declares, and tips against sales.
//   Cash tips declared: anyone who gets $20 or more in cash tips in a month reports all their tips to the business in
//   writing, by the 10th of the next month. Each person declares on their phone (the staff portal's pay tab); the
//   business keeps the signed copy: tenants/{t}/tipDeclarations/{staffId}_{YYYY-MM} = { staffId, name, month, cashCents,
//   paidOutCents, recordedCashCents, signedName, signedAt, earlier: [the copies it replaced] }. Never a tax number.
//   Tips against sales: a large food or beverage business (tipping customary, more than 10 people on a typical day)
//   reports on the IRS's Form 8027, and when the tips its people report come to less than 8% of food and drink sales the
//   shortfall is allocated among those tipped directly. This says where the month stands; the accountant allocates.
// Pure.

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const TIP_FLOOR = 0.08, CASH_TIP_MIN_CENTS = 2000, MAX_DECLARED_CENTS = 10_000_000;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** A month as typed ("2026-10"), or null. */
export const cleanMonth = (v: unknown): string | null => (MONTH_RE.test(String(v || '')) ? String(v) : null);
/** The month a business day is in. */
export const monthOfDay = (day: string) => day.slice(0, 7);
/** The month before. */
export function prevMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
/** The month's days, up to `today` when it's the month in progress (none for a month still to come). */
export function monthDays(month: string, today: string): string[] {
  const [y, m] = month.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); const out: string[] = [];
  for (let d = 1; d <= n; d++) { const day = `${month}-${String(d).padStart(2, '0')}`; if (day > today) break; out.push(day); }
  return out;
}
/** "October 2026". */
export function monthWords(month: string): string { const [y, m] = month.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`; }
/** The last twelve months, newest first, this one included. */
export function recentMonths(today: string, n = 12): string[] { const out = [monthOfDay(today)]; while (out.length < n) out.push(prevMonth(out[out.length - 1])); return out; }

/** Cents typed as dollars ("$212.50", "212"), or null; up to $100,000. */
export function cleanDollars(v: unknown): number | null {
  const s = String(v ?? '').replace(/[$,\s]/g, ''); if (!s) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100); return c >= 0 && c <= MAX_DECLARED_CENTS ? c : null;
}
/** A signed name: what the person typed, as their signature (2 to 80 characters, letters in it). */
export function cleanSignature(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80); return s.length >= 2 && /\p{L}/u.test(s) ? s : null;
}
/** Whether a month's stock value can still be kept from what's on the shelf now: the month in progress, or the one
 *  before it until the 10th (after that, today's shelf is too far from what it was at the month's end). */
export const keepable = (month: string, today: string) => month === monthOfDay(today) || (month === prevMonth(monthOfDay(today)) && Number(today.slice(8, 10)) <= 10);
/** Whether this month can still be declared for: the month in progress and the one before it. */
export const declarable = (month: string, today: string) => month === monthOfDay(today) || month === prevMonth(monthOfDay(today));
/** The 10th of the month after: when a month's cash tips are due to the business. */
export function declareBy(month: string): string { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, '0')}-10`; }

export type TipCheck = { sales: number; reported: number; pct: number | null; shortfall: number; under: boolean };
/** Tips the team reported (charged tips, and cash as declared) against food and drink sales, and what's short of 8%. */
export function tipCheck(sales: number, chargedTips: number, declaredCash: number): TipCheck {
  const s = Math.max(0, num(sales)); const reported = Math.round((Math.max(0, num(chargedTips)) + Math.max(0, num(declaredCash))) * 100) / 100;
  const pct = s > 0 ? reported / s : null; const short = s > 0 ? Math.max(0, Math.round((s * TIP_FLOOR - reported) * 100) / 100) : 0;
  return { sales: Math.round(s * 100) / 100, reported, pct, shortfall: short, under: short > 0 };
}

/** One cell of a spreadsheet: text safe to open (a value starting with = + - @ or a control character is kept as text,
 *  never run as a formula), numbers as numbers, as precise as the caller gave them. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\u0000-\u001f]/.test(s)) s = `'${s}`;
  s = s.replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Rows as a spreadsheet file (CSV), a header row first. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}
