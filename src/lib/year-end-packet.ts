// src/lib/year-end-packet.ts — CLOSING THE YEAR (components/money/YearEndPacket, on the Money page's Reports tab).
// What's left before the year goes to the accountant, from what's been read (yearItems), and the packet's pages
// (packetBody): profit and loss, the tax summary by Schedule C line, write-offs and the mileage log, the owner's
// estimated tax payments, the team's W-2 and 1099 totals, and the year's sales tax. Pure, so each is checked on its own.
import { booksSummary } from '@/lib/books-summary';
import { pnlRows, rowsHtml, taxSummaryRows } from '@/lib/report-builders';
import { CHECKLIST, writeOffsBodyHtml } from '@/lib/write-offs';
import { logBodyHtml, milesText } from '@/lib/trip-log';
import { yearEndDue } from '@/lib/payroll-yearend';
import { dueDay, paidToward } from '@/lib/renter-taxes';
import { esc } from '@/lib/print-style';

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export type YearItem = { key: string; title: string; sub: string; state: 'ok' | 'todo' | 'info'; href?: string };

/** The year to close: last year until the end of April, then this one. */
export const yearToClose = (today: string) => (Number(today.slice(5, 7)) <= 4 ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4)));

/** The estimated tax payments recorded toward a year, when they're known: the plan year's own, or last year's until
 *  April 15 (api/owner-taxes). Null when they can't be read from here. */
export function paymentsToward(ot: any, year: number): any[] | null {
  if (!ot) return null;
  if (ot.year === year) return Array.isArray(ot.payments) ? ot.payments : [];
  if (ot.year === year + 1 && Array.isArray(ot.lastYearRecorded)) return ot.lastYearRecorded;
  if (ot.year === year + 1 && ot.lastYearOpen) return Array.isArray(ot.lastYearPayments) ? ot.lastYearPayments : [];
  return null;
}

/** How the business filed for a year: last year's own while closing it, else what's said now. */
export const structureFor = (ot: any, year: number): string | null => (ot?.year === year + 1 && ot.lastYearStructure ? ot.lastYearStructure : ot?.settings?.structure ?? null);

/** What's left for a year, from what's been read (pure, so it's checked on its own). `closedThrough` is the last month
 *  closed (yyyy-mm, closing is in order); `began` the business's first month, so months before it aren't asked about. */
export function yearItems(g: { year: number; s: any; bankWaiting: number | null; bankCapped?: boolean; wo: any; mi: any; ot: any; owner: boolean; payroll: { w2s: number; necs: number } | null;
  tax: any; closedThrough: string; began: string; today: string; unread?: string[] }): YearItem[] {
  const out: YearItem[] = []; const y = g.year;
  // (Something that couldn't be read is never taken for finished.)
  for (const u of g.unread || []) out.push({ key: `unread-${u}`, state: 'todo', title: `${u} couldn’t be read just now`, sub: 'Check again in a moment, so nothing is left out.' });
  const n = Number(g.s?.unsorted?.count) || 0;
  out.push(n ? { key: 'unsorted', state: 'todo', title: `${plural(n, 'line')} without a category`, sub: 'They’re counted as other expenses until each is sorted.', href: '/money?tab=ledger' }
    : { key: 'unsorted', state: 'ok', title: 'Every line has a category', sub: `In the books for ${y}.` });
  // (More waiting than could be read: never said to be done.)
  if (g.bankWaiting != null && g.bankCapped) out.push({ key: 'bank', state: 'todo', title: g.bankWaiting ? `At least ${plural(g.bankWaiting, 'bank line')} to sort` : 'Bank lines to check',
    sub: 'More lines are waiting from your bank than can be counted here. Open Bank to see them all.', href: '/money?tab=bank' });
  else if (g.bankWaiting != null) out.push(g.bankWaiting ? { key: 'bank', state: 'todo', title: `${plural(g.bankWaiting, 'bank line')} to sort`, sub: 'From your bank, waiting to be matched or added to the books.', href: '/money?tab=bank' }
    : { key: 'bank', state: 'ok', title: 'Nothing waiting from the bank', sub: 'Every bank line is matched or added.' });
  if (g.wo?.found) {
    const f = g.wo.found;
    out.push(f.toFinish ? { key: 'writeoffs', state: 'todo', title: `${plural(f.toFinish, 'write-off')} to finish`, sub: 'Meals without who and why, costs of $75 or more without a receipt, gifts without how many people.', href: '/money?tab=writeoffs' }
      : { key: 'writeoffs', state: 'ok', title: 'Write-offs finished', sub: 'Every meal, receipt and gift has what the IRS asks for.' });
    // (Only the owner answers these: they're about the owner's own taxes.)
    const asks = g.owner ? CHECKLIST.filter((c) => !g.wo.checklist?.[c.id]).length : 0;
    if (asks) out.push({ key: 'missed', state: 'todo', title: `${plural(asks, 'often-missed write-off')} to answer`, sub: 'A home office, your phone, health insurance, retirement, tips: ask your accountant, or doesn’t apply.', href: '/money?tab=writeoffs' });
  }
  if (g.mi?.summary) {
    const sm = g.mi.summary; const o = sm.odometer || {};
    const yearOver = g.today >= `${y}-12-31`;
    if (!sm.trips) out.push({ key: 'miles', state: 'info', title: `No business miles logged for ${y}`, sub: 'Drives for supplies, the bank, classes and clients count. Add any you remember.', href: '/mileage' });
    else if (o.start == null || (o.end == null && yearOver)) out.push({ key: 'miles', state: g.owner ? 'todo' : 'info', title: 'Odometer readings for the year',
      sub: `${milesText(sm.businessTenths)} business miles logged. The return asks for the car’s total miles, from January 1 and December 31${g.owner ? '' : ': the owner enters them in the mileage log'}.`, href: '/mileage' });
    else if (o.end == null) out.push({ key: 'miles', state: 'info', title: `${milesText(sm.businessTenths)} business miles so far`, sub: 'Write down the odometer on December 31, for the year’s total miles.', href: '/mileage' });
    else out.push({ key: 'miles', state: 'ok', title: `${milesText(sm.businessTenths)} business miles, with the odometer`, sub: 'Logged with the date, place and reason for each.' });
  }
  if (g.payroll && (g.payroll.w2s || g.payroll.necs)) {
    // (Information, not a to-do: ClarityFlow makes the forms; it doesn't know when they've gone out.)
    out.push({ key: 'payroll', state: 'info', title: [g.payroll.w2s ? `W-2s for ${plural(g.payroll.w2s, 'person', 'people')}` : '', g.payroll.necs ? plural(g.payroll.necs, '1099-NEC') : ''].filter(Boolean).join(' and '),
      sub: `${g.today > yearEndDue(y) ? 'They were due' : 'Due'} ${longDay(yearEndDue(y))}. They’re in Payday, under the year’s forms.`, href: '/money?tab=payday' });
  }
  if (g.owner && g.ot) {
    const due = dueDay(y + 1, 1); const pays = paymentsToward(g.ot, y);
    const st = structureFor(g.ot, y);
    if (st === 'other') out.push({ key: 'estimated', state: 'info', title: 'Estimated taxes', sub: 'The business files its own return, so your accountant works out those payments.' });
    else if (st !== 'schedule_c') out.push({ key: 'estimated', state: 'info', title: 'Estimated taxes', sub: 'Say how the business files on the Taxes tab to see what’s due and keep the payments you make.', href: '/money?tab=taxes' });
    else if (pays && paidToward(pays, due)) out.push({ key: 'estimated', state: 'ok', title: 'Last estimated tax payment recorded', sub: `Toward ${y}, due ${longDay(due)}.` });
    else if (pays) out.push({ key: 'estimated', state: g.today > due ? 'info' : 'todo', title: `Last estimated tax payment, due ${longDay(due)}`, sub: 'See what to send on the Taxes tab, then mark it paid.', href: '/money?tab=taxes' });
  }
  // (The year's own return: one from a later year is never taken for it.)
  if (g.tax && !g.tax.unset && g.tax.last && String(g.tax.last.period || '').slice(0, 4) === String(y)) out.push(g.tax.last.paid ? { key: 'salestax', state: 'ok', title: `Sales tax for ${g.tax.last.label} paid`, sub: 'Its return is below, under Taxes.' }
    : g.tax.owed ? { key: 'salestax', state: 'todo', title: `Sales tax for ${g.tax.last.label}, due ${g.tax.owed.due}`, sub: 'Its return is below, under Taxes.' }
    : { key: 'salestax', state: 'ok', title: `Sales tax for ${g.tax.last.label}: nothing owed`, sub: `File by ${g.tax.last.due}.` });
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`).filter((m) => m < g.today.slice(0, 7) && (!g.began || m >= g.began));
  const closed = months.filter((m) => g.closedThrough && m <= g.closedThrough).length;
  if (months.length) out.push(closed === months.length ? { key: 'months', state: 'ok', title: `Every month of ${y} closed`, sub: 'Each one’s statement is below, under Closed months.' }
    : { key: 'months', state: 'info', title: `${closed} of ${plural(months.length, 'month')} closed`, sub: 'Closing a month keeps its figures as they are. Close each on the Overview.', href: '/money?tab=overview' });
  return out;
}

/** The packet's pages, after its heading (pure). */
export function packetBody(o: { year: number; items: YearItem[]; ls: any[]; lookup: any[]; wo: any; mi: any; ot: any; owner: boolean; w2s: any[]; necs: any[] }): string {
  const s = booksSummary(o.ls, { lookup: o.lookup, businessOnly: true });
  const open = o.items.filter((i) => i.state === 'todo');
  const sec = (title: string, html: string) => `<h2 style="margin-top:28px">${esc(title)}</h2>${html}`;
  // (Amounts, the columns after the first, to the right; a last row that totals in bold.)
  const R = ' class="num" style="text-align:right"';
  const table = (head: string[], rows: string[][], total = false) => `<table class="t"><thead><tr>${head.map((h, i) => `<th${i ? R : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, ri) => `<tr${total && ri === rows.length - 1 ? ' style="font-weight:600"' : ''}>${r.map((c, i) => `<td${i ? R : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const parts: string[] = [];
  parts.push(open.length ? sec('Still to finish', `<p class="sub">Not finished in ClarityFlow when this was printed:</p><ul>${open.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul>`) : '<p class="sub">Everything ClarityFlow checks for the year is finished.</p>');
  parts.push(sec('Profit and loss', rowsHtml(pnlRows(s))));
  parts.push(sec('Tax summary, by Schedule C line', rowsHtml(taxSummaryRows(o.ls, { lookup: o.lookup }))));
  if (o.wo?.found) {
    const m = o.mi?.summary?.trips ? { tenths: o.mi.summary.businessTenths, cents: o.mi.summary.amountCents, rate: o.mi.summary.rate.label, trips: o.mi.summary.trips } : null;
    // (The owner's own answers only in the owner's packet.)
    parts.push(sec('Write-offs that are easy to miss', '<p class="sub">Meals, gifts, classes, equipment and spoilage here are lines in the books, already counted in the tax summary above: they’re here for the details. Business miles and the tip credit aren’t in it.</p>'
      + writeOffsBodyHtml(o.wo.found, m, o.owner ? o.wo.checklist || {} : {}, { tipCredit: o.wo.tipCredit, stockLoss: o.wo.stockLoss, missing: o.wo.missing })));
  }
  if (o.mi?.trips?.length) parts.push(sec('Mileage log', logBodyHtml(o.mi.trips, o.year, o.mi.setup)));
  const pays = o.owner && structureFor(o.ot, o.year) === 'schedule_c' ? paymentsToward(o.ot, o.year) : null;
  if (pays) {
    const total = pays.reduce((a, p) => a + (Number(p?.cents) || 0), 0);
    parts.push(sec('Estimated tax payments recorded', pays.length
      ? table(['Paid to', 'On', 'Amount'], [...pays].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((p) => [p.to === 'irs' ? 'The IRS' : o.ot.settings.stateName || 'The state', longDay(p.date), usd((Number(p.cents) || 0) / 100)]).concat([['Total', '', usd(total / 100)]]), true)
      : '<p class="sub">None recorded in ClarityFlow.</p>'));
  }
  if (o.w2s.length || o.necs.length) {
    parts.push(sec('The team', [
      o.w2s.length ? table(['W-2', 'Wages (box 1)', 'Federal tax withheld (box 2)'], o.w2s.map((w) => [w.name, usd(w.b1), usd(w.b2)]).concat([['Total', usd(o.w2s.reduce((a, w) => a + w.b1, 0)), usd(o.w2s.reduce((a, w) => a + w.b2, 0))]]), true) : '',
      o.necs.length ? table(['1099-NEC', 'Paid as a contractor'], o.necs.map((x) => [x.name, usd(x.amount)])) : '',
    ].join('')));
  }
  parts.push(sec('Sales tax for the year', table(['', 'Amount'], [['Collected', usd(s.taxCollected)], ...(s.taxRefunded ? [['Given back on refunds and voids', usd(-s.taxRefunded)]] : []), ['To pay the state', usd(s.taxOwed)], ['Paid to the state', usd(s.taxPaid)]])));
  return parts.join('\n');
}
