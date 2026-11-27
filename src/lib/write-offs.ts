// src/lib/write-offs.ts — WRITE-OFFS THAT ARE EASY TO MISS (pure; design board "Write-offs: found for you, finished by
// you"; the Money page's Write-offs tab, api/writeoffs). From what's already in the books:
//   - Meals: a business meal half counts, and so does one on an overnight work trip; a party or outing for the
//     business's employees all counts (one mainly for contractors or renters is a business meal); entertainment
//     (tickets, a show, a game) doesn't (since 2018). The IRS asks who was there and what it was about (for a work trip,
//     what the trip was for). Each meal's kind and those details are kept on its line (`writeOff.meal`).
//   - Receipts: meals, travel and gifts of $75 or more need one (Publication 463).
//   - Gifts: up to $25 a person a year counts (`writeOff.giftPeople`: how many it was for). Counted gift by gift, so
//     the accountant caps repeat gifts to one person; gifts to employees are usually pay, not gifts.
//   - Equipment of $2,500 or more on one line: the accountant chooses to write it off this year or over several
//     (`writeOff.forAccountant`).
//   - Purchases on a personal account from a place the business books costs from (not a store or a restaurant anyone
//     might use): the owner says whether each was for the business, to book it as the business's, or personal.
//   - Often missed, not in the books at all: asked once a year, kept with the business (tenants/{t}/private/writeOffs),
//     and printed with the rest for the accountant.
// The tax summary (lib/report-builders) and the books' tax line (components/money/BooksScreen) count each line as
// here (`countsOf`, `mealKindOf`), a line taken back by the line it takes back (`originalOf`); the books themselves keep
// what was paid.
import { canonicalCategory } from './categories';

export const MEAL_CATEGORY = 'Meals & Entertainment';
export const GIFT_CATEGORY = 'Business Gifts';
export const RECEIPT_AT_CENTS = 7500;
export const GIFT_LIMIT_CENTS = 2500;
export const EQUIPMENT_AT_CENTS = 250000;
/** Kinds of cost the $75 receipt rule is for. */
const RECEIPT_KINDS = new Set([MEAL_CATEGORY, GIFT_CATEGORY, 'Travel']);

export const MEAL_KINDS = [
  { id: 'business', label: 'With someone you do business with', sub: 'A client, supplier, renter, team member or someone you might hire', counts: 'Half counts', share: 0.5 },
  { id: 'travel', label: 'On an overnight work trip', sub: 'Away from home for a class, a show or the business', counts: 'Half counts', share: 0.5 },
  { id: 'team', label: 'A party or outing for your employees', sub: 'One mainly for contractors or renters is a business meal', counts: 'All counts', share: 1 },
  { id: 'entertainment', label: 'Tickets, a show or a game', sub: 'Entertainment', counts: 'Doesn’t count', share: 0 },
  { id: 'personal', label: 'Just me, not for work', sub: '', counts: 'Personal', share: 0 },
] as const;
export type MealKind = (typeof MEAL_KINDS)[number]['id'];

export const CHECKLIST = [
  { id: 'homeOffice', title: 'A home office', text: 'Space at home used only and regularly for the business. The simple way: $5 a square foot, up to 300.' },
  { id: 'phone', title: 'Your phone and internet', text: 'The business share of bills you pay personally.' },
  { id: 'health', title: 'Health insurance you pay yourself', text: 'When you’re self-employed and buy your own plan, it can usually be deducted.' },
  { id: 'retirement', title: 'Saving for retirement', text: 'Money put into a SEP IRA or a solo 401(k) can lower this year’s taxes.' },
  { id: 'tips', title: 'Tips you receive yourself', text: 'For 2025 to 2028, in jobs on the IRS’s tipped list, up to $25,000 of tips a year can be deducted. Income limits apply: it shrinks above $150,000 ($300,000 filing jointly), can’t be more than the business’s profit, and isn’t for some service businesses, like health, law or consulting.' },
] as const;
export type ChecklistId = (typeof CHECKLIST)[number]['id'];

/** A line's day (yyyy-mm-dd, UTC), dated as text or, on older lines, as a stored time. */
export function dayOf(v: any): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const ms = typeof v?.toMillis === 'function' ? v.toMillis() : typeof v?.toDate === 'function' ? v.toDate().getTime() : Number(v?.seconds ?? v?._seconds) * 1000;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '';
}
const centsOf = (t: any) => Math.round(Math.abs(Number(t?.amountCents) || Number(t?.amount) * 100 || 0));
const cat = (t: any) => canonicalCategory(String(t?.category || ''));
export const isMeal = (t: any) => cat(t) === MEAL_CATEGORY;
export const isGift = (t: any) => cat(t) === GIFT_CATEGORY;
const isExpense = (t: any) => String(t?.type || '') === 'expense' && String(t?.context || 'Business') !== 'Personal' && !t?.reversalOf && !t?.reversedBy && !t?.removed;
/** A line that takes another back (a reversal, an undo, a void: lib/books-summary), and the line it takes back. */
export const isTakeBack = (t: any) => String(t?.type || '') === 'reversal' || String(t?.category || '').toLowerCase() === 'void';
const takenBack = (t: any) => (isTakeBack(t) ? String(t?.reversalOf || t?.voidOf || '') : '');
/** The line a take-back takes back, through any take-back of a take-back; any other line, itself. */
export function originalOf(t: any, byId?: Map<string, any>): any {
  let o = t;
  for (let i = 0; i < 4 && isTakeBack(o); i++) { const n = byId?.get(takenBack(o)); if (!n || n === o) break; o = n; }
  return o;
}
/** A meal's kind as said on its line; one not said yet is counted as a business meal. */
export const mealKindOf = (t: any): MealKind => { const k = String(t?.writeOff?.meal?.kind || ''); return (MEAL_KINDS.some((m) => m.id === k) ? k : 'business') as MealKind; };
const WHY_NOT: Record<MealKind, string | null> = { business: 'the other half of business meals', travel: 'the other half of meals on work trips', team: null, entertainment: 'entertainment', personal: 'personal meals' };
/** What a meal of each kind asks for: who was there, what it was about (for a work trip, what the trip was for). */
export const MEAL_ASKS: Record<MealKind, { who: boolean; why: boolean }> = { business: { who: true, why: true }, travel: { who: false, why: true }, team: { who: true, why: true }, entertainment: { who: false, why: false }, personal: { who: false, why: false } };

/** How much of a line counts on the tax return, in cents, and why the rest doesn't (lib/report-builders' tax summary). */
export function countsOf(t: any): { counts: number; not: number; why: string | null } {
  const c = centsOf(t);
  if (isMeal(t)) {
    const kind = mealKindOf(t);
    const share = MEAL_KINDS.find((k) => k.id === kind)?.share ?? 0.5;
    const counts = Math.round(c * share);
    return { counts, not: c - counts, why: WHY_NOT[kind] };
  }
  if (isGift(t)) {
    const people = Math.max(1, Math.floor(Number(t?.writeOff?.giftPeople) || 1));
    const counts = Math.min(c, people * GIFT_LIMIT_CENTS);
    return { counts, not: c - counts, why: c > counts ? 'gifts over $25 a person' : null };
  }
  return { counts: c, not: 0, why: null };
}

/** A bank line on a personal account that's a store, a restaurant or a bill anyone might pay (the bank's own reading,
 *  Plaid's category), never asked about, even from a place the business books costs from too. */
const EVERYDAY = new Set(['FOOD_AND_DRINK', 'TRANSPORTATION', 'ENTERTAINMENT', 'TRAVEL', 'MEDICAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'RENT_AND_UTILITIES', 'BANK_FEES']);
const EVERYDAY_DETAIL = /_(SUPERSTORES|ONLINE_MARKETPLACES|DISCOUNT_STORES|DEPARTMENT_STORES|CONVENIENCE_STORES|GAS|GROCERIES|COFFEE|RESTAURANT|FAST_FOOD)$/;
export const everydayPurchase = (x: any) => EVERYDAY.has(String(x?.plaidCategory || '').toUpperCase()) || EVERYDAY_DETAIL.test(String(x?.plaidDetailed || '').toUpperCase());

export type Line = { id: string; day: string; title: string; cents: number; category: string; hasReceipt: boolean; meal?: { kind: MealKind; who: string; why: string } | null; giftPeople?: number | null; forAccountant?: boolean };
export type PersonalLine = { id: string; day: string; title: string; cents: number };

const lineOf = (t: any): Line => ({ id: String(t.id), day: dayOf(t.date), title: String(t.clientOrVendor || t.description || t.category || 'A cost').slice(0, 80), cents: centsOf(t), category: cat(t),
  hasReceipt: !!(t.hasReceipt || t.receiptUrl || t.receiptId), meal: t.writeOff?.meal || null, giftPeople: t.writeOff?.giftPeople ?? null, forAccountant: !!t.writeOff?.forAccountant });

export type Found = {
  year: number;
  meals: { spent: number; counts: number; lines: Line[]; needDetail: Line[] };
  receipts: Line[];
  gifts: { spent: number; counts: number; lines: Line[]; needPeople: Line[]; over: Line[] };
  equipment: Line[];
  education: { cents: number; count: number };
  personal: PersonalLine[];
  toFinish: number;
};

/** What the year's lines show. `lines`: the business's lines in the kinds looked at (meals, gifts, travel, equipment,
 *  education), any year (only `year`'s are used); `personal`: personal-account lines from places the business buys from. */
export function findWriteOffs(lines: any[], year: number, personal: PersonalLine[] = []): Found {
  // (A line taken back since, by a reversal, an undo or a void, isn't asked about; one put back by taking the
  // take-back back is.)
  const takeBacks = lines.filter(isTakeBack); const undone = new Set(takeBacks.map(takenBack));
  const back = new Set(takeBacks.filter((t) => !undone.has(String(t.id))).map(takenBack));
  const mine = lines.filter((t) => isExpense(t) && !back.has(String(t.id)) && dayOf(t.date).slice(0, 4) === String(year));
  const meals = mine.filter(isMeal).map(lineOf);
  const gifts = mine.filter(isGift).map(lineOf);
  const needDetail = meals.filter((m) => { if (!m.meal) return true; const ask = MEAL_ASKS[m.meal.kind] || MEAL_ASKS.business; return (ask.who && !m.meal.who) || (ask.why && !m.meal.why); });
  const receipts = mine.filter((t) => RECEIPT_KINDS.has(cat(t)) && centsOf(t) >= RECEIPT_AT_CENTS && !(t.hasReceipt || t.receiptUrl || t.receiptId)).map(lineOf);
  const needPeople = gifts.filter((g) => !(Number(g.giftPeople) >= 1));
  const over = gifts.filter((g) => Number(g.giftPeople) >= 1 && g.cents > Number(g.giftPeople) * GIFT_LIMIT_CENTS);
  const equipment = mine.filter((t) => cat(t) === 'Equipment' && centsOf(t) >= EQUIPMENT_AT_CENTS).map(lineOf);
  const edu = mine.filter((t) => cat(t) === 'Education & Training');
  const sum = (xs: any[], f: (x: any) => number) => xs.reduce((a, x) => a + f(x), 0);
  return {
    year,
    meals: { spent: sum(meals, (m) => m.cents), counts: sum(mine.filter(isMeal), (t) => countsOf(t).counts), lines: meals, needDetail },
    receipts,
    gifts: { spent: sum(gifts, (g) => g.cents), counts: sum(mine.filter(isGift), (t) => countsOf(t).counts), lines: gifts, needPeople, over },
    equipment, education: { cents: sum(edu, centsOf), count: edu.length },
    personal,
    toFinish: needDetail.length + receipts.length + needPeople.length,
  };
}

/** A meal's details as sent: its kind, and what that kind asks for (MEAL_ASKS). */
export function cleanMeal(b: any): { ok: true; meal: { kind: MealKind; who: string; why: string } } | { ok: false; error: string } {
  const kind = String(b?.kind || '') as MealKind;
  if (!MEAL_KINDS.some((k) => k.id === kind)) return { ok: false, error: 'Pick what kind of meal it was.' };
  const clip = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const ask = MEAL_ASKS[kind]; const who = ask.who ? clip(b?.who) : '', why = ask.why ? clip(b?.why) : '';
  if (kind === 'travel' && !why) return { ok: false, error: 'Say what the trip was for. The IRS asks.' };
  if ((ask.who && !who) || (ask.why && !why)) return { ok: false, error: 'Say who was there and what it was about. The IRS asks for both.' };
  return { ok: true, meal: { kind, who, why } };
}

/** A receipt photo kept in the business's own storage, nothing else: the storage service's own address, one of the
 *  app's own buckets (`buckets`: lib/inspo-photos ourBuckets), and the object filed under tenants/{t}/{sub}/ (`sub`:
 *  'uploads', ImageUpload's, from the app; a renter's own, renters/{id}/receipts, from the portal). */
export function receiptUrlOk(url: unknown, tenantId: string, buckets: string[], sub = 'uploads'): boolean {
  if (typeof url !== 'string' || url.length > 1200) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com' || u.username || u.password || u.port) return false;
    const m = /^\/v0\/b\/([A-Za-z0-9._-]+)\/o\/([^/]+)$/.exec(u.pathname);
    if (!m || !buckets.includes(m[1]) || u.searchParams.get('alt') !== 'media') return false;
    const object = decodeURIComponent(m[2]); const dir = `tenants/${tenantId}/${sub}/`;
    return object.startsWith(dir) && /^[A-Za-z0-9._-]{1,120}$/.test(object.slice(dir.length));
  } catch { return false; }
}

/** Costs most businesses pay each year that are easy to pay personally and never book: none in the books for the year
 *  is worth a look (asked on the Write-offs tab, printed for the accountant). */
export const USUAL_COSTS = [
  { id: 'insurance', category: 'Insurance', title: 'Insurance', text: 'Liability, property or workers’ comp. Paid it from a personal account? Add it in Books so it counts.' },
  { id: 'licenses', category: 'Licenses & Permits', title: 'Licenses and permits', text: 'The business license, and your own professional license renewals too.' },
  { id: 'accountant', category: 'Professional Services', title: 'Your accountant', text: 'Last year’s tax preparation, bookkeeping or legal help, paid this year, counts this year.' },
] as const;
export type UsualCost = (typeof USUAL_COSTS)[number]['id'];

/** Which usual costs have no business line in `year` (`lines`: the business's lines in those categories, any year). */
export function missingUsual(lines: any[], year: number): UsualCost[] {
  const had = new Set(lines.filter((t) => isExpense(t) && dayOf(t.date).slice(0, 4) === String(year)).map((t) => cat(t)));
  return USUAL_COSTS.filter((u) => !had.has(u.category)).map((u) => u.id);
}

/** Stock written off in the year. What Inventory writes off is booked then as a Spoilage cost (cost of goods sold), so
 *  it counts already: `bookedCents` is those lines (`lines`: the business's Spoilage lines, any year). What the kitchen or
 *  bar throws out, or a product used up early, is taken off stock with no line of its own (tenants/{t}/stockCorrections, type 'spoiled', not an
 *  Inventory write-off): `unbooked` is how many, for a year-end inventory count to pick up. */
export function stockLossOf(lines: any[], entries: any[], year: number): { bookedCents: number; unbooked: number } {
  const bookedCents = lines.filter((t) => isExpense(t) && cat(t) === 'Spoilage' && dayOf(t.date).slice(0, 4) === String(year)).reduce((a, t) => a + centsOf(t), 0);
  const unbooked = entries.filter((e) => String(e?.type || '') === 'spoiled' && String(e?.field || 'totalStock') === 'totalStock' && Number(e?.change) < 0
    && dayOf(e?.date).slice(0, 4) === String(year) && !/^Write-off/.test(String(e?.reason || ''))).length;
  return { bookedCents, unbooked };
}

/** What else the year shows, printed with the rest: the tip credit (lib/tip-credit), stock written off, and usual costs
 *  with nothing booked. */
export type Extras = { tipCredit?: { creditCents: number; tipsCents: number; minWage: number; paydays: number; noHours: number; medspa?: boolean; priorLeftOut?: boolean } | null;
  stockLoss?: { bookedCents: number; unbooked: number } | null; missing?: UsualCost[] };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The year's write-offs for the accountant (lib/print-style printPage wraps it). */
export function writeOffsBodyHtml(f: Found, miles: { tenths: number; cents: number; rate: string; trips: number } | null, checklist: Record<string, string>, x: Extras = {}): string {
  const row = (k: string, v: string, sub = '') => `<tr><td>${esc(k)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</td><td class="num">${esc(v)}</td></tr>`;
  const asks = CHECKLIST.filter((c) => checklist[c.id] === 'ask'); const tc = x.tipCredit; const sl = x.stockLoss;
  const missing = USUAL_COSTS.filter((u) => (x.missing || []).includes(u.id));
  return `<table class="t"><tbody>
${miles ? row('Business miles', usd(miles.cents), `${(miles.tenths / 10).toLocaleString('en-US')} miles in ${miles.trips} trips at ${miles.rate} a mile, from the mileage log`) : ''}
${row('Business meals', usd(f.meals.counts), `${usd(f.meals.spent)} spent; half of business meals and meals on work trips counts, all of parties for employees, none of entertainment`)}
${f.gifts.lines.length ? row('Business gifts', usd(f.gifts.counts), `${usd(f.gifts.spent)} spent; up to $25 a person a year counts, worked out here gift by gift, so if someone got more than one this year, cap them at $25 in all`) : ''}
${f.education.count ? row('Classes and education', usd(f.education.cents), `${f.education.count} line${f.education.count === 1 ? '' : 's'}`) : ''}
${f.equipment.map((e) => row(`Equipment: ${e.title}`, usd(e.cents), `${e.day}. Written off this year or over several: your choice`)).join('\n')}
${tc && tc.creditCents > 0 ? row('Tip credit (Form 8846), an estimate', usd(tc.creditCents), `7.65% (1.45% past the Social Security wage base) of the employees’ reported tips above what tops their pay up to $${tc.minWage.toFixed(2)} an hour, from ${tc.paydays} payday${tc.paydays === 1 ? '' : 's'} (${usd(tc.tipsCents)} in tips)${tc.noHours ? `; ${tc.noHours} without hours, so every tip counted` : ''}${tc.medspa ? '; tips on medical treatments don’t count, only on esthetics and spa services' : ''}${tc.priorLeftOut ? '; tips paid before ClarityFlow this year aren’t in it' : ''}. A credit, not a deduction: the same amount comes off the payroll tax deduction`) : ''}
${sl && sl.bookedCents > 0 ? row('Stock written off, booked as Spoilage', usd(sl.bookedCents), 'Written off in Inventory and booked then, with cost of goods sold: counted already, not again') : ''}
${sl && sl.unbooked > 0 ? row(`Stock thrown out or used up early: ${sl.unbooked} time${sl.unbooked === 1 ? '' : 's'}`, '', 'Taken off stock with no line of its own: a year-end inventory count picks it up') : ''}
</tbody></table>
${missing.length ? `<h2>Nothing in the books this year for</h2><ul>${missing.map((u) => `<li><b>${esc(u.title)}</b>: ${esc(u.text)}</li>`).join('')}</ul>` : ''}
${asks.length ? `<h2>To ask about</h2><ul>${asks.map((c) => `<li><b>${esc(c.title)}</b>: ${esc(c.text)}</li>`).join('')}</ul>` : ''}
${f.toFinish ? `<p class="sub">Still to finish in ClarityFlow: ${f.meals.needDetail.length} meal${f.meals.needDetail.length === 1 ? '' : 's'} without the details the IRS asks for, ${f.receipts.length} cost${f.receipts.length === 1 ? '' : 's'} of $75 or more without a receipt, ${f.gifts.needPeople.length} gift${f.gifts.needPeople.length === 1 ? '' : 's'} without how many people.</p>` : ''}`;
}
