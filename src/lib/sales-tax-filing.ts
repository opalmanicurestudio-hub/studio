// src/lib/sales-tax-filing.ts — WHEN SALES TAX IS PAID TO THE STATE (pure). Settings → Payments → Sales tax, "Paying
// the state" (design board "Sales tax: settings, the filing report and checkout"):
//   salesTax.filing = { every: 'month' | 'quarter' | 'year', dueDay: 1–31, remind: boolean }
// The state says how often when the business registers; each period's return and payment is due on `dueDay` of the
// month after it ends (the last day of that month when it's shorter). A period is paid once it's recorded as paid
// (api/money/sales-tax, "I paid it"): tenants/{t}/private/salesTaxPaid_{period} = { period, cents, at, by, lineId }.
// The reminder shows from a week before it's due until it's paid, on the Money page and in the morning brief.

export type FilingEvery = 'month' | 'quarter' | 'year';
export type Filing = { every: FilingEvery; dueDay: number; remind: boolean; set: boolean };
export type TaxPeriod = { key: string; start: string; end: string; due: string; label: string; dueLabel: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m: 1–12
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dayName = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}${y !== new Date().getUTCFullYear() ? `, ${y}` : ''}`; };

/** How often the business files, from its settings: monthly with the 20th unless it says otherwise. */
export function filingOf(t: any): Filing {
  const f = t?.salesTax?.filing || {};
  const every: FilingEvery = f.every === 'quarter' || f.every === 'year' ? f.every : 'month';
  const n = Math.round(Number(f.dueDay));
  return { every, dueDay: Number.isFinite(n) && n >= 1 && n <= 31 ? n : 20, remind: f.remind !== false, set: !!t?.salesTax?.filing };
}

/** A period by its key: '2026-10' (a month), '2026-Q4' (three months) or '2026' (a year). */
export function periodOf(key: string, dueDay = 20): TaxPeriod | null {
  let y: number, m1: number, m2: number, label: string;
  const mo = /^(\d{4})-(\d{2})$/.exec(key), q = /^(\d{4})-Q([1-4])$/.exec(key), yr = /^(\d{4})$/.exec(key);
  if (mo) { y = +mo[1]; m1 = m2 = +mo[2]; if (m1 < 1 || m1 > 12) return null; label = `${MONTHS[m1 - 1]} ${y}`; }
  else if (q) { y = +q[1]; m1 = (+q[2] - 1) * 3 + 1; m2 = m1 + 2; label = `${MONTHS[m1 - 1]} to ${MONTHS[m2 - 1]} ${y}`; }
  else if (yr) { y = +yr[1]; m1 = 1; m2 = 12; label = String(y); }
  else return null;
  const dy = m2 === 12 ? y + 1 : y, dm = m2 === 12 ? 1 : m2 + 1;
  const due = iso(dy, dm, Math.min(dueDay, lastDay(dy, dm)));
  return { key, start: iso(y, m1, 1), end: iso(y, m2, lastDay(y, m2)), due, label, dueLabel: dayName(due) };
}

/** The period a day is in. */
export function periodKeyFor(day: string, every: FilingEvery): string {
  const [y, m] = day.split('-').map(Number);
  return every === 'year' ? String(y) : every === 'quarter' ? `${y}-Q${Math.floor((m - 1) / 3) + 1}` : `${y}-${pad(m)}`;
}

/** The period before this one. */
export function previousPeriod(key: string, every: FilingEvery): string {
  const p = periodOf(key); if (!p) return key;
  const [y, m] = p.start.split('-').map(Number);
  const back = every === 'year' ? 12 : every === 'quarter' ? 3 : 1;
  const mm = m - back; const yy = mm < 1 ? y - 1 : y; const m2 = mm < 1 ? mm + 12 : mm;
  return periodKeyFor(iso(yy, m2, 1), every);
}

/** The period after this one. */
export function nextPeriod(key: string, every: FilingEvery): string {
  const p = periodOf(key); if (!p) return key;
  const [y, m] = p.end.split('-').map(Number);
  return periodKeyFor(m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1), every);
}

/** The last period that has ended by `today` (the one to file next, or the one most recently filed). */
export function lastEnded(today: string, f: Filing): TaxPeriod {
  return periodOf(previousPeriod(periodKeyFor(today, f.every), f.every), f.dueDay)!;
}

/** Days from `today` until `day` (negative once it's past). */
export const daysUntil = (today: string, day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

/** Whether the reminder shows for a period: from a week before it's due until it's paid, when the business wants it. */
export function remindNow(today: string, p: TaxPeriod, f: Filing, paid: boolean): boolean {
  return f.remind && !paid && daysUntil(today, p.due) <= 7;
}

/** What the reminder says: "October’s sales tax is due November 20" (or "was due", once it's past). */
export function reminderText(today: string, p: TaxPeriod, cents: number): string {
  const left = daysUntil(today, p.due);
  const amt = `$${(Math.max(0, cents) / 100).toFixed(2)}`;
  const what = /^\d{4}-\d{2}$/.test(p.key) ? `${p.label.split(' ')[0]}’s sales tax` : `Sales tax for ${p.label}`;
  // (Nothing to pay: the return is still due.)
  if (cents <= 0) { const ret = /^\d{4}-\d{2}$/.test(p.key) ? `${p.label.split(' ')[0]}’s sales tax return` : `The sales tax return for ${p.label}`;
    return `${ret}, with nothing to pay, ${left < 0 ? 'was' : 'is'} due ${left === 0 ? 'today' : p.dueLabel}`; }
  return left < 0 ? `${what}, ${amt}, was due ${p.dueLabel}` : left === 0 ? `${what}, ${amt}, is due today` : `${what}, ${amt}, is due ${p.dueLabel}`;
}
