// src/lib/renter-write-offs.ts — A RENTER'S OWN WRITE-OFFS (pure; the renter portal's Money, Your business, Write-offs;
// api/portal/renter-writeoffs; included in rent). A renter is self-employed and files their own return, so what they
// can write off is theirs to gather. From what ClarityFlow already holds for them:
//   - Rent and space fees paid to the business they rent from (their payments in the business's books,
//     lib/renter-rent-history), less refunds to their card. A security deposit is their money held, not rent.
//   - Business miles from their own mileage log (lib/trip-log, kept apart: lib/trip-log-server LogOf).
//   - Costs they log (tenants/{t}/renterExpenses, theirs only): a meal with someone they do business with, or on an
//     overnight work trip, half counts, and the IRS asks who was there and what it was about; a gift counts up to $25 a
//     person a year; equipment of $2,500 or more is the accountant's choice, this year or over several; meals, travel
//     and gifts of $75 or more need a receipt kept.
//   - Tips the business collected for them at the front desk (rentLedger desk_collected, kind tip), for the deduction
//     for tips (2025 to 2028).
//   - What's often missed and isn't in ClarityFlow at all (lib/write-offs CHECKLIST), asked once a year, kept privately
//     with their log, and printed for their accountant.
// A starting point for their accountant, who decides what goes on the return.
import { CHECKLIST, GIFT_LIMIT_CENTS, EQUIPMENT_AT_CENTS, RECEIPT_AT_CENTS } from './write-offs';
import { rentLineCents, rentCreditsUsed } from './renter-rent-history';

/** What a renter's cost can be (the portal's Earnings and expenses and Write-offs). */
export const RENTER_COST_KINDS = ['Supplies', 'Products', 'Equipment', 'Education', 'Meals', 'Gifts', 'Marketing', 'Insurance', 'Licenses and fees', 'Software', 'Travel', 'Other'] as const;
export type RenterCostKind = (typeof RENTER_COST_KINDS)[number];
const LEGACY: Record<string, RenterCostKind> = { 'Licence & fees': 'Licenses and fees', 'License & fees': 'Licenses and fees' };

/** A cost's kind as kept, in today's words; one not on the list is Other. */
export function costKindOf(category: unknown): RenterCostKind {
  const c = String(category ?? '').trim();
  return LEGACY[c] || ((RENTER_COST_KINDS as readonly string[]).includes(c) ? (c as RenterCostKind) : 'Other');
}

export type RenterCost = { id: string; day: string; title: string; kind: RenterCostKind; cents: number; note: string; people: number | null };
const costOf = (e: any): RenterCost => ({ id: String(e.id), day: String(e.date || '').slice(0, 10), kind: costKindOf(e.category), cents: Math.max(0, Math.round(Number(e.cents) || 0)),
  note: String(e.note || ''), people: Number(e.people) >= 1 ? Math.floor(Number(e.people)) : null, title: String(e.note || costKindOf(e.category)).slice(0, 80) });

/** How much of a cost counts, and why the rest doesn't. */
export function renterCounts(c: RenterCost): { counts: number; why: string | null } {
  if (c.kind === 'Meals') return { counts: Math.round(c.cents / 2), why: 'half of a business meal' };
  if (c.kind === 'Gifts') { const counts = Math.min(c.cents, (c.people || 1) * GIFT_LIMIT_CENTS); return { counts, why: counts < c.cents ? 'gifts over $25 a person' : null }; }
  return { counts: c.cents, why: null };
}

export type RenterFound = {
  year: number;
  kinds: { kind: RenterCostKind; spent: number; counts: number; lines: number }[];
  costs: { spent: number; counts: number };
  meals: { spent: number; counts: number; needNote: RenterCost[] };
  gifts: { needPeople: RenterCost[] };
  equipment: RenterCost[];
  /** Meals, travel and gifts of $75 or more: the receipt is to keep. */
  receipts: number;
  toFinish: number;
};

/** What the year's logged costs show (`expenses`: the renter's own, any year). */
export function renterFound(expenses: any[], year: number): RenterFound {
  const mine = expenses.map(costOf).filter((c) => c.day.slice(0, 4) === String(year) && c.cents > 0);
  const kinds = RENTER_COST_KINDS.map((kind) => { const xs = mine.filter((c) => c.kind === kind); return { kind, spent: sum(xs, (c) => c.cents), counts: sum(xs, (c) => renterCounts(c).counts), lines: xs.length }; }).filter((k) => k.lines > 0);
  const meals = mine.filter((c) => c.kind === 'Meals'); const gifts = mine.filter((c) => c.kind === 'Gifts');
  const needNote = meals.filter((c) => c.note.trim().length < 3); const needPeople = gifts.filter((c) => !c.people);
  return {
    year, kinds,
    costs: { spent: sum(mine, (c) => c.cents), counts: sum(mine, (c) => renterCounts(c).counts) },
    meals: { spent: sum(meals, (c) => c.cents), counts: sum(meals, (c) => renterCounts(c).counts), needNote },
    gifts: { needPeople },
    equipment: mine.filter((c) => c.kind === 'Equipment' && c.cents >= EQUIPMENT_AT_CENTS),
    receipts: mine.filter((c) => (c.kind === 'Meals' || c.kind === 'Gifts' || c.kind === 'Travel') && c.cents >= RECEIPT_AT_CENTS).length,
    toFinish: needNote.length + needPeople.length,
  };
}
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
const dayOfAny = (v: any) => String(v || '').slice(0, 10);

/** Rent and space fees paid in the year to the business they rent from. `lines`: their payments in the business's books
 *  (lib/renter-rent-history renterRentPayments) and the lines that take them back or correct them (rentTakeBacks): a
 *  payment counts, a refund to their card, an undo or a void comes off, a security deposit held isn't rent (one applied
 *  to what they owe is booked as rent). `ledger`: their rent-ledger lines, for money the business owed them that went
 *  toward their rent instead of being paid out (lib/renter-rent-history rentCreditsUsed), as it's used. */
export function rentPaidOf(lines: any[], year: number, ledger: any[] = []): { cents: number; payments: number; creditsCents: number } {
  const byId = new Map<string, any>(); for (const t of lines) if (t?.id) byId.set(String(t.id), t);
  // (A payment undone, voided or taken out in full isn't one of the payments counted.)
  const undone = new Set<string>();
  for (const t of byId.values()) { const c = rentLineCents(t, byId); const o = byId.get(String(t.reversalOf || t.voidOf || '')); if (c < 0 && o && -c >= rentLineCents(o, byId)) undone.add(String(o.id)); }
  let cents = 0, n = 0;
  for (const t of byId.values()) {
    if (dayOfAny(t.date || t.createdAt).slice(0, 4) !== String(year)) continue;
    const c = rentLineCents(t, byId); cents += c;
    if (c > 0 && !t.correctionOf && !undone.has(String(t.id))) n++;
  }
  const creditsCents = rentCreditsUsed(ledger, year).reduce((a, r) => a + r.cents, 0);
  return { cents: Math.max(0, cents) + creditsCents, payments: n, creditsCents };
}

/** Tips the business collected for them at the front desk in the year (a rent-ledger line, kind tip, not voided). */
export function deskTipsOf(ledger: any[], year: number): number {
  return ledger.filter((r) => r?.type === 'desk_collected' && r?.kind === 'tip' && r?.status !== 'voided' && dayOfAny(r.date || r.createdAt).slice(0, 4) === String(year))
    .reduce((a, r) => a + Math.max(0, Math.round(Number(r.amountCents) || 0)), 0);
}

/** Costs most renters pay each year and easily never log: none logged for the year is worth a look. */
export const RENTER_USUAL = [
  { id: 'insurance', kind: 'Insurance' as RenterCostKind, title: 'Your insurance', text: 'Liability insurance for your work. Add what you paid this year.' },
  { id: 'licenses', kind: 'Licenses and fees' as RenterCostKind, title: 'Your license', text: 'Your professional license renewal, and any business license or permit fees.' },
] as const;
export function missingRenterUsual(expenses: any[], year: number): string[] {
  const had = new Set(expenses.map(costOf).filter((c) => c.day.slice(0, 4) === String(year) && c.cents > 0).map((c) => c.kind));
  return RENTER_USUAL.filter((u) => !had.has(u.kind)).map((u) => u.id);
}

/** The checklist asked of a renter: the same often-missed write-offs. */
export const RENTER_CHECKLIST = CHECKLIST;

/** A cost as sent from the portal: its day (this year or last, up to today), amount, kind, what it was, and for a
 *  gift how many people it was for. */
export function cleanRenterCost(b: any, today: string): { ok: true; cost: { date: string; cents: number; category: RenterCostKind; note: string; people: number | null } } | { ok: false; error: string } {
  const date = String(b?.date || '');
  const y = Number(today.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || Number(date.slice(0, 4)) < y - 1 || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return { ok: false, error: 'A day this year or last, up to today.' };
  const cents = Math.round(Number(String(b?.amount ?? '').replace(/[$,\s]/g, '')) * 100);
  if (!(cents > 0) || cents > 10_000_000) return { ok: false, error: 'An amount, like 24.50.' };
  const kind = String(b?.kind || '');
  if (!(RENTER_COST_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Pick what it was.' };
  const note = String(b?.note ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const people = kind === 'Gifts' && b?.people != null && b.people !== '' ? Math.floor(Number(b.people)) : null;
  if (people != null && !(people >= 1 && people <= 999)) return { ok: false, error: 'How many people, like 3.' };
  return { ok: true, cost: { date, cents, category: kind as RenterCostKind, note, people } };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type RenterYear = { found: RenterFound; rent: { cents: number; payments: number; creditsCents?: number }; space: string;
  miles: { tenths: number; cents: number; rate: string; trips: number } | null; deskTipsCents: number; checklist: Record<string, string>; missing: string[] };

/** The year's write-offs for their accountant (lib/print-style printPage wraps it). */
export function renterWriteOffsHtml(y: RenterYear): string {
  const row = (k: string, v: string, sub = '') => `<tr><td>${esc(k)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</td><td class="num">${esc(v)}</td></tr>`;
  const f = y.found; const asks = RENTER_CHECKLIST.filter((c) => y.checklist[c.id] === 'ask'); const missing = RENTER_USUAL.filter((u) => y.missing.includes(u.id));
  return `<table class="t"><tbody>
${y.rent.cents > 0 ? row(`Rent and space fees paid to ${y.space}`, usd(y.rent.cents), `${y.rent.payments} payment${y.rent.payments === 1 ? '' : 's'}${y.rent.creditsCents ? `, and ${usd(y.rent.creditsCents)} of money owed to you used toward your rent (any not used yet isn’t in it)` : ''}, less any refunds; a security deposit isn’t in it`) : ''}
${y.miles ? row('Business miles', usd(y.miles.cents), `${(y.miles.tenths / 10).toLocaleString('en-US')} miles in ${y.miles.trips} trips at ${y.miles.rate} a mile, from the mileage log`) : ''}
${f.kinds.map((k) => row(k.kind, usd(k.counts), `${k.lines} cost${k.lines === 1 ? '' : 's'}${k.counts !== k.spent ? `, ${usd(k.spent)} spent; ${k.kind === 'Meals' ? 'half of a business meal counts' : 'up to $25 a person a year counts, worked out gift by gift, so cap anyone who got more than one at $25 in all'}` : ''}`)).join('\n')}
${f.equipment.map((e) => row(`Equipment: ${e.title}`, usd(e.cents), `${e.day}. Written off this year or over several: your choice`)).join('\n')}
${y.deskTipsCents > 0 ? row('Tips collected for you at the front desk', usd(y.deskTipsCents), 'For the deduction for tips. Tips paid to you directly aren’t in it') : ''}
</tbody></table>
${missing.length ? `<h2>Nothing logged this year for</h2><ul>${missing.map((u) => `<li><b>${esc(u.title)}</b>: ${esc(u.text)}</li>`).join('')}</ul>` : ''}
${asks.length ? `<h2>To ask about</h2><ul>${asks.map((c) => `<li><b>${esc(c.title)}</b>: ${esc(c.text)}</li>`).join('')}</ul>` : ''}
${f.receipts ? `<p class="sub">Keep the receipt${f.receipts === 1 ? '' : 's'} for ${f.receipts} meal, gift or travel cost${f.receipts === 1 ? '' : 's'} of $75 or more: the IRS asks for ${f.receipts === 1 ? 'it' : 'them'}.</p>` : ''}
${f.toFinish ? `<p class="sub">Still to finish: ${f.meals.needNote.length} meal${f.meals.needNote.length === 1 ? '' : 's'} without who was there and what it was about, ${f.gifts.needPeople.length} gift${f.gifts.needPeople.length === 1 ? '' : 's'} without how many people.</p>` : ''}`;
}
