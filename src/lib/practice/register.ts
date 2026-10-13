// Practice a shift: the register (front desk point of view).
// Pure rules, no browser APIs, so the page and the tests share them.
// Follows ClarityFlow's real checkout rules: prices never change on a line
// (a manager approves a discount instead), voids need a reason, and every
// slip is allowed to go through, then shows up later in the shift review.

import * as $ from './currency';
import type { CurrencyCode } from './currency';

// ── Products and barcodes ───────────────────────────────────────────────
export type Sku = { key: string; name: string; size?: string; price: number; code: string; color: string; fragrance?: boolean };

/** UPC-A check digit for 11 digits. */
export function upcCheck(d11: string) {
  let odd = 0, even = 0;
  for (let i = 0; i < 11; i++) { const n = +d11[i]; if (i % 2 === 0) odd += n; else even += n; }
  return String((10 - ((odd * 3 + even) % 10)) % 10);
}
const upc = (item: number) => { const d = `084221${String(item).padStart(5, '0')}`; return d + upcCheck(d); };

export const SKUS: Sku[] = [
  { key: 'cuticle', name: 'Cuticle oil', price: 17.5, code: upc(10041), color: '#e8b4b8', fragrance: true },
  { key: 'handcream', name: 'Hand cream', price: 24, code: upc(10058), color: '#f3e3c3', fragrance: true },
  { key: 'shampoo', name: 'Bond shampoo', price: 28, code: upc(10065), color: '#d9d3ea' },
  { key: 'serum2', name: 'Scalp serum', size: '2 oz', price: 32, code: upc(10072), color: '#bcd3e8', fragrance: true },
  { key: 'serum4', name: 'Scalp serum', size: '4 oz', price: 54, code: upc(10089), color: '#a9c4de', fragrance: true },
  { key: 'beardoil', name: 'Beard oil', price: 21.99, code: upc(10096), color: '#d8b48a' },
  { key: 'vitc', name: 'Vitamin C serum', price: 45, code: upc(10102), color: '#f2c38b' },
  { key: 'footcream', name: 'Foot cream', price: 22, code: upc(10119), color: '#cfe3d4' },
  { key: 'lashwash', name: 'Lash cleanser', price: 16, code: upc(10126), color: '#e7c3c9' },
  { key: 'fffserum', name: 'Scalp serum', size: 'fragrance-free', price: 34, code: upc(10133), color: '#dfe9f2' },
];
export const skuBy = (key: string) => SKUS.find((s) => s.key === key)!;
/** Find a product by what a scanner sent. Scanners differ: some send UPC-A as 13 digits
 *  (EAN-13 with a leading 0), some leave off the check digit or the leading system digit. */
export function skuByCode(raw: string) {
  const d = raw.replace(/\D/g, '');
  return SKUS.find((s) => d === s.code || d === `0${s.code}` || d === s.code.slice(0, 11) || d === s.code.slice(1));
}
export const skuLabel = (s: Sku) => (s.size ? `${s.name} (${s.size})` : s.name);

/** UPC-A bars as a list of 95 modules (1 = bar), for drawing. */
export function upcModules(code: string): number[] {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map((p) => p.replace(/./g, (c) => (c === '0' ? '1' : '0')));
  let s = '101';
  for (let i = 0; i < 6; i++) s += L[+code[i]];
  s += '01010';
  for (let i = 6; i < 12; i++) s += R[+code[i]];
  s += '101';
  return s.split('').map(Number);
}

// ── People ──────────────────────────────────────────────────────────────
export type Look = { skin: string; hair: string; top: string; style: 'bun' | 'curls' | 'short' | 'long' | 'fade' | 'braids' };
export type Slip =
  | { kind: 'unreadable'; sku: string }            // the scanner can't read this label
  | { kind: 'double'; sku: string }                // the scanner reads this one twice
  | { kind: 'shelf'; sku: string; claim: number }  // "the sign said $X"
  | { kind: 'allergy'; allergy: string };          // has an allergy on file
export type Customer = {
  id: string; name: string; pron: 'she' | 'he' | 'they'; look: Look;
  service: { label: string; price: number; provider: string };
  items: { sku: string; n: number }[];
  slips: Slip[]; arrive: number; hello: string; visits: number;
  /** Cash payers: how they hand it over, and whether they keep the change as a tip. */
  pays?: { cash: 'one' | 'round'; keep: 'none' | 'all' | number };
};
export type Line = { id: number; kind: 'service' | 'retail' | 'discount'; label: string; price: number; sku?: string; voided?: string; via?: 'gun' | 'typed' | 'usb' | 'name'; approvedBy?: string };
export type Mistake = { at: number; who: string; what: string; later: string; right: string; minor?: boolean };
export type Checkout = { who: string; seconds: number; clean: boolean; total: number; points: number };

export type RegState = {
  t: number; end: number; queue: Customer[]; waiting: Record<string, number>;   // patience of people in line
  currency: CurrencyCode; drawer: Record<number, number>; float: number; cashSales: number; tipJar: number;   // cents
  close: null | CloseOut;
  cur: null | { c: Customer; lines: Line[]; start: number; mood: number; claim: null | 'open' | 'discount' | 'refused'; tries: Record<string, number>; read: Record<string, number>; said: string; note: string | null; given?: number[]; kept?: number };
  nextLine: number; done: Checkout[]; mistakes: Mistake[]; streak: number; bestStreak: number; points: number; log: string[]; coach: number; sfx: string[];
};

const PEOPLE: Customer[] = [
  { id: 'rosa', name: 'Rosa', pron: 'she', look: { skin: '#c68a62', hair: '#2b1d16', top: '#e9a7a0', style: 'bun' }, service: { label: 'Gel manicure', price: 45, provider: 'Ana' },
    items: [{ sku: 'cuticle', n: 1 }], slips: [], arrive: 0, hello: 'Hi! Just this cuticle oil too, please.', visits: 4 },
  { id: 'theo', name: 'Theo', pron: 'he', look: { skin: '#e7c3a4', hair: '#6b4a2f', top: '#9fc2a8', style: 'short' }, service: { label: 'Fade', price: 40, provider: 'Diego' },
    items: [{ sku: 'beardoil', n: 1 }], slips: [{ kind: 'unreadable', sku: 'beardoil' }], arrive: 20, hello: 'And the beard oil. The label got a little wet, sorry.', visits: 2, pays: { cash: 'round', keep: 3 } },
  { id: 'grace', name: 'Grace', pron: 'she', look: { skin: '#8d5a3b', hair: '#1d1612', top: '#c9b6e4', style: 'curls' }, service: { label: 'Silk press', price: 95, provider: 'Mei' },
    items: [{ sku: 'serum2', n: 1 }, { sku: 'shampoo', n: 1 }], slips: [{ kind: 'double', sku: 'shampoo' }], arrive: 45, hello: 'The serum and the shampoo, please.', visits: 6 },
  { id: 'lena', name: 'Lena', pron: 'she', look: { skin: '#f0d2b8', hair: '#c9a24f', top: '#a7c7e7', style: 'long' }, service: { label: 'Facial', price: 85, provider: 'Hana' },
    items: [{ sku: 'vitc', n: 1 }], slips: [{ kind: 'shelf', sku: 'vitc', claim: 39 }], arrive: 70, hello: 'Oh, and the shelf sign said this serum was $39.', visits: 1 },
  { id: 'marcus', name: 'Marcus', pron: 'he', look: { skin: '#5c3b2a', hair: '#0f0b09', top: '#f2c38b', style: 'fade' }, service: { label: 'Beard trim', price: 25, provider: 'Diego' },
    items: [{ sku: 'beardoil', n: 2 }], slips: [], arrive: 95, hello: 'Two of the beard oils. One’s a gift.', visits: 3, pays: { cash: 'one', keep: 'none' } },
  { id: 'priya', name: 'Priya', pron: 'she', look: { skin: '#b07a52', hair: '#1a1210', top: '#e7c3c9', style: 'braids' }, service: { label: 'Color', price: 150, provider: 'Jordan' },
    items: [{ sku: 'serum4', n: 1 }], slips: [{ kind: 'unreadable', sku: 'serum4' }, { kind: 'allergy', allergy: 'fragrance' }], arrive: 120, hello: 'The big scalp serum, please.', visits: 5 },
];

export const they = (c: Customer) => c.pron;
export const their = (c: Customer) => (c.pron === 'she' ? 'her' : c.pron === 'he' ? 'his' : 'their');

export function newRegister(currency: CurrencyCode = 'USD'): RegState {
  const queue = PEOPLE.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i })), slips: [...p.slips] }));
  const drawer = { ...$.CURRENCIES[currency].float };
  return { t: 0, end: 240, queue, waiting: {}, currency, drawer, float: $.drawerTotal(drawer), cashSales: 0, tipJar: 0, close: null, cur: null, nextLine: 1, done: [], mistakes: [], streak: 0, bestStreak: 0, points: 0, log: [], coach: 0, sfx: [] };
}

// ── Time and the line ───────────────────────────────────────────────────
/** People who have arrived and are waiting (not the one at the counter). */
export const line = (s: RegState) => s.queue.filter((c) => c.arrive <= s.t);
export function advance(s: RegState, dt: number) {
  s.t += dt;
  for (const c of line(s)) s.waiting[c.id] = Math.max(0, (s.waiting[c.id] ?? 1) - dt * 0.006);
  if (s.cur) s.cur.mood = Math.max(0, s.cur.mood - dt * 0.002);
  if (!s.cur && line(s).length) callNext(s);
}
export function callNext(s: RegState) {
  const c = line(s)[0]; if (!c || s.cur) return false;
  s.queue = s.queue.filter((x) => x !== c);
  const mood = s.waiting[c.id] ?? 1; delete s.waiting[c.id];
  s.cur = { c, lines: [{ id: s.nextLine++, kind: 'service', label: `${c.service.label} · ${c.service.provider}`, price: c.service.price }], start: s.t, mood, claim: c.slips.some((x) => x.kind === 'shelf') ? 'open' : null, tries: {}, read: {}, said: c.hello, note: null };
  s.sfx.push('bell');
  return true;
}
export const slip = <K extends Slip['kind']>(c: Customer, kind: K) => c.slips.find((x) => x.kind === kind) as Extract<Slip, { kind: K }> | undefined;
export const allergy = (c: Customer) => slip(c, 'allergy')?.allergy || null;

// ── Scanning ────────────────────────────────────────────────────────────
export type ScanResult = { ok: boolean; kind: 'added' | 'unreadable' | 'unknown' | 'none'; lines?: Line[]; flag?: string };
function addRetail(s: RegState, sku: Sku, via: Line['via']) {
  const l: Line = { id: s.nextLine++, kind: 'retail', label: skuLabel(sku), price: sku.price, sku: sku.key, via };
  s.cur!.lines.push(l); return l;
}
/** Scan a barcode. `via` says how: the on-screen gun, typing the number, a real USB scanner, or a name lookup. */
export function scan(s: RegState, code: string, via: 'gun' | 'typed' | 'usb'): ScanResult {
  const cur = s.cur; if (!cur) return { ok: false, kind: 'none' };
  const sku = skuByCode(code);
  if (!sku) { s.sfx.push('err'); return { ok: false, kind: 'unknown' }; }
  if (via === 'gun') {
    const un = cur.c.slips.find((x) => x.kind === 'unreadable' && x.sku === sku.key);
    if (un) { cur.tries[sku.key] = (cur.tries[sku.key] || 0) + 1; s.sfx.push('err'); return { ok: false, kind: 'unreadable' }; }
  }
  const lines = [addRetail(s, sku, via)];
  cur.read[sku.key] = (cur.read[sku.key] || 0) + 1;
  const dbl = cur.c.slips.find((x) => x.kind === 'double' && x.sku === sku.key);
  if (dbl && via === 'gun' && cur.read[sku.key] === 1) { lines.push(addRetail(s, sku, via)); s.sfx.push('beep'); }
  s.sfx.push('beep');
  const al = allergy(cur.c);
  return { ok: true, kind: 'added', lines, flag: al && sku.fragrance ? `${cur.c.name} has a ${al} allergy on file. This product has ${al}.` : undefined };
}
/** Search by name (what people do when a label won't read). Similar names come back together. */
export const lookup = (q: string) => { const w = q.trim().toLowerCase(); return w ? SKUS.filter((x) => skuLabel(x).toLowerCase().includes(w)) : []; };
export function addByName(s: RegState, key: string) { if (!s.cur) return null; const l = addRetail(s, skuBy(key), 'name'); s.sfx.push('beep'); return l; }

export const VOID_REASONS = ['Scanned twice', 'Wrong item', 'Client changed mind'];
export function voidLine(s: RegState, id: number, reason: string) {
  const l = s.cur?.lines.find((x) => x.id === id); if (!l || l.kind === 'service' || l.voided) return false;
  l.voided = reason; s.sfx.push('tap'); return true;
}
/** Staff can't change a price on a line. It's blocked and noted as a training moment. */
export function editPrice(s: RegState, id: number) {
  const cur = s.cur; if (!cur) return { ok: false, note: '' };
  if (!s.mistakes.some((m) => m.who === cur.c.name && m.what.startsWith('Tried to edit')))
    s.mistakes.push({ at: s.t, who: cur.c.name, what: 'Tried to edit a price on the ticket', later: 'Blocked. Price edits would break the sales and stock records.', right: 'Prices never change on a line. Ask a manager to approve a discount.', minor: true });
  s.sfx.push('err');
  return { ok: false, note: 'Prices can’t be changed on a line. Ask a manager to approve a discount.' };
}

/** The allergy flag's right move: suggest the fragrance-free option. The client agrees and swaps. */
export function suggestSafe(s: RegState, id: number) {
  const cur = s.cur; const l = cur?.lines.find((x) => x.id === id); const al = cur && allergy(cur.c);
  if (!cur || !l?.sku || !al || l.voided) return null;
  const safe = SKUS.find((x) => x.name === skuBy(l.sku!).name && !x.fragrance); if (!safe) return null;
  l.voided = 'Client changed mind';
  cur.c.items = cur.c.items.map((i) => (i.sku === l.sku ? { ...i, sku: safe.key } : i));
  const nl = addRetail(s, safe, 'typed'); cur.mood = Math.min(1, cur.mood + 0.15);
  cur.said = 'Oh, I didn’t even think of that. Thank you!'; s.sfx.push('chime');
  return nl;
}

// ── Shelf price claim ───────────────────────────────────────────────────
export const MANAGER = 'Dana';
/** Ask the manager to approve a discount for the shelf price difference. She approves by PIN from her phone. */
export function askDiscount(s: RegState) {
  const cur = s.cur; const sh = cur && slip(cur.c, 'shelf'); if (!cur || !sh || cur.claim !== 'open') return null;
  const sku = skuBy(sh.sku); const amt = sku.price - sh.claim;
  const l: Line = { id: s.nextLine++, kind: 'discount', label: `Discount: shelf label price (approved · ${MANAGER})`, price: -amt, approvedBy: MANAGER };
  cur.lines.push(l); cur.claim = 'discount'; cur.mood = Math.min(1, cur.mood + 0.15); cur.said = 'Thank you, that’s kind.'; s.sfx.push('chime');
  return l;
}
export function refuseClaim(s: RegState) {
  const cur = s.cur; if (!cur || cur.claim !== 'open') return;
  cur.claim = 'refused'; cur.mood = Math.max(0, cur.mood - 0.25); cur.said = 'Oh. Okay, I guess.';
}

// ── Paying ──────────────────────────────────────────────────────────────
export const live = (cur: NonNullable<RegState['cur']>) => cur.lines.filter((l) => !l.voided);
export const totalOf = (cur: NonNullable<RegState['cur']>) => Math.round(live(cur).reduce((a, l) => a + l.price, 0) * 100) / 100;
/** Format a major-unit amount in the register's currency. */
export const fm = (s: RegState, major: number) => $.fmt(s.currency, $.cents(major));
export const tipFor = (cur: NonNullable<RegState['cur']>) => { const pct = cur.mood > 0.75 ? 0.2 : cur.mood > 0.45 ? 0.18 : cur.mood > 0.2 ? 0.15 : 0; return { pct: Math.round(pct * 100), amount: Math.round(cur.c.service.price * pct) }; };

/** Check the ticket against what's on the counter. Anything wrong goes through and is found later. */
function ticketChecks(s: RegState) {
  const cur = s.cur!; const c = cur.c, who = c.name, at = s.t;
  const scanned: Record<string, number> = {};
  for (const l of live(cur)) if (l.sku) scanned[l.sku] = (scanned[l.sku] || 0) + 1;
  for (const it of c.items) {
    const n = scanned[it.sku] || 0; const sku = skuBy(it.sku);
    if (n > it.n) {
      const dbl = slip(c, 'double')?.sku === it.sku;
      s.mistakes.push({ at, who, what: `Charged ${who} for ${n} × ${skuLabel(sku)} (${they(c)} bought ${it.n})`, later: `${who} saw it on the receipt and came back for a ${fm(s, (n - it.n) * sku.price)} refund.`, right: dbl ? 'Two beeps, two lines, one bottle: void the extra line before payment.' : 'Count the items on the counter against the lines on the ticket.' });
    } else if (n < it.n) {
      const wrongVariant = SKUS.find((x) => x.name === sku.name && x.key !== sku.key && scanned[x.key]);
      if (wrongVariant) s.mistakes.push({ at, who, what: `Rang up ${skuLabel(wrongVariant)} instead of ${skuLabel(sku)}`, later: `${who} paid ${fm(s, wrongVariant.price)} for a ${fm(s, sku.price)} product. The stock count for both is now off.`, right: 'When a label won’t scan, type the number under the barcode instead of guessing by name.' });
      else s.mistakes.push({ at, who, what: `${it.n - n} × ${skuLabel(sku)} not rung up`, later: `${who} left with it unpaid: ${fm(s, (it.n - n) * sku.price)} lost, and the shelf count is off.`, right: it.n > 1 ? `${who} had ${it.n} of them. Scan each one.` : 'Scan everything on the counter before you take payment.' });
    }
  }
  for (const key of Object.keys(scanned)) if (!c.items.some((i) => i.sku === key) && !SKUS.some((x) => x.key !== key && x.name === skuBy(key).name && c.items.some((i) => i.sku === x.key)))
    s.mistakes.push({ at, who, what: `Charged ${who} for ${skuLabel(skuBy(key))} ${they(c)} didn’t buy`, later: `${who} disputed it the next week. A refund and an apology.`, right: 'Only scan what the client put on the counter.' });
  const sh = slip(c, 'shelf');
  if (sh && cur.claim === 'open') { cur.mood = Math.max(0, cur.mood - 0.3); s.mistakes.push({ at, who, what: `Didn’t answer ${who} about the shelf price`, later: `${who} felt brushed off and left a 3-star review.`, right: `Ask ${MANAGER} to approve a discount for the difference. Prices never change on a line.` }); }
  const al = allergy(c);
  if (al && live(cur).some((l) => l.sku && skuBy(l.sku).fragrance)) s.mistakes.push({ at, who, what: `Sold ${who} a product with ${al}`, later: `${who} had a reaction two days later and called the salon.`, right: `Check the allergy flag. Suggest the ${al}-free option.` });
}
function finalize(s: RegState, before: number, paid: number, tip: number, how: string) {
  const cur = s.cur!; const who = cur.c.name;
  const seconds = Math.round(s.t - cur.start);
  const clean = s.mistakes.slice(before).filter((m) => !m.minor).length === 0;
  let points = clean ? 100 + Math.max(0, 60 - seconds) : 40;
  if (slip(cur.c, 'shelf') && cur.claim === 'discount') points += 20;
  s.streak = clean ? s.streak + 1 : 0; s.bestStreak = Math.max(s.bestStreak, s.streak); if (clean && s.streak > 1) points += 10 * (s.streak - 1);
  s.points += points;
  const total = Math.round((paid + tip) * 100) / 100;
  s.done.push({ who, seconds, clean, total, points });
  s.log.push(`${who} paid ${fm(s, paid)} ${how}${tip ? `, plus a ${fm(s, tip)} tip` : ''}.`);
  s.sfx.push('coin'); s.cur = null;
  return { total, tip: { amount: tip, pct: 0 }, seconds, clean, points };
}

/** Card payment. The tip is chosen by the client on the client screen. */
export function pay(s: RegState) {
  const cur = s.cur; if (!cur) return null;
  const before = s.mistakes.length; ticketChecks(s);
  const tip = tipFor(cur);
  const r = finalize(s, before, totalOf(cur), tip.amount, 'by card');
  return { ...r, tip };
}

// ── Cash ────────────────────────────────────────────────────────────────
export const paysCash = (c: Customer) => !!c.pays;
/** What's due in cash, in cents (rounded to 5 cents in Canada). */
export const cashDue = (s: RegState) => $.cashRound(s.currency, $.cents(totalOf(s.cur!)));
/** The notes the client hands over. */
export function handOver(s: RegState) { const cur = s.cur!; if (!cur.given) cur.given = $.clientCash(s.currency, cashDue(s), cur.c.pays?.cash || 'round'); return cur.given; }
/** After seeing the total: keep the change as a tip, keep part of it, or "my change, please". Cents. */
export function keepChoice(s: RegState) {
  const cur = s.cur!; if (cur.kept !== undefined) return cur.kept;
  const extra = $.sum(handOver(s)) - cashDue(s); const k = cur.c.pays?.keep ?? 'none';
  cur.kept = k === 'all' ? extra : k === 'none' ? 0 : Math.min(extra, $.cents(k));
  return cur.kept;
}
/** Quick buttons for "cash received", like a real register: next dollar, next 5, 10, 20, 50, 100. */
export function tenderOptions(s: RegState) {
  const due = cashDue(s); const given = $.sum(handOver(s));
  const opts = new Set<number>([given]);
  for (const step of [100, 500, 1000, 2000, 5000, 10000]) opts.add(Math.ceil(due / step) * step);
  return [...opts].filter((x) => x >= due).sort((a, b) => a - b).slice(0, 6);
}
/** Change the register shows for what you entered. */
export const changeShown = (s: RegState, tendered: number) => tendered - cashDue(s) - keepChoice(s);

export function payCash(s: RegState, tendered: number, change: number[]) {
  const cur = s.cur; if (!cur) return null;
  const code = s.currency, who = cur.c.name, at = s.t;
  const given = handOver(s), due = cashDue(s), kept = keepChoice(s);
  const have = { ...s.drawer };
  for (const d of change) { if (!have[d]) return { ok: false as const, error: `There’s no ${$.denomLabel(code, d)} left in the drawer.` }; have[d]--; }
  for (const g of given) have[g] = (have[g] || 0) + 1;                       // her notes go in after the change is out
  if (kept > 0) { const t = $.makeChange(code, kept, have); if (t) { for (const x of t) have[x]--; s.tipJar += kept; } else s.cashSales += kept; }
  s.drawer = have; s.cashSales += due;
  const before = s.mistakes.length; ticketChecks(s);
  const right = $.sum(given) - due - kept, gave = $.sum(change), diff = gave - right;
  const f = (x: number) => $.fmt(code, x);
  if (tendered !== $.sum(given)) s.mistakes.push({ at, who, what: `Entered ${f(tendered)} received; ${they(cur.c)} handed you ${f($.sum(given))}`, later: diff === 0 ? 'You still counted the right change, but the sale record is wrong.' : 'The register worked out the change from the wrong amount.', right: 'Leave the client’s notes on the drawer ledge and read them before you type the amount.', minor: diff === 0 });
  if (diff > 0) s.mistakes.push({ at, who, what: `Gave ${f(gave)} change instead of ${f(right)}`, later: `The drawer came out ${f(diff)} short at close.`, right: `Count it back up from the total: ${f(due + kept)} to ${f($.sum(given))}.` });
  if (diff < 0) s.mistakes.push({ at, who, what: `Gave ${f(gave)} change instead of ${f(right)}`, later: `${who} noticed at home and called. The drawer came out ${f(-diff)} over.`, right: `Count it back up from the total: ${f(due + kept)} to ${f($.sum(given))}.` });
  const r = finalize(s, before, due / 100, kept / 100, 'in cash');
  return { ok: true as const, ...r, change: gave, right };
}

// ── Closing the drawer ──────────────────────────────────────────────────
export type CloseOut = { expected: number; actual: number; counted: number; overShort: number; countOff: number; off: number[] };
export function closeOut(s: RegState, counted: Record<number, number>): CloseOut {
  const expected = s.float + s.cashSales, actual = $.drawerTotal(s.drawer), c = $.drawerTotal(counted);
  const off = $.denoms(s.currency).filter((d) => (counted[d] || 0) !== (s.drawer[d] || 0));
  s.close = { expected, actual, counted: c, overShort: actual - expected, countOff: c - actual, off };
  if (c !== actual) s.mistakes.push({ at: s.t, who: 'Drawer', what: `Counted ${$.fmt(s.currency, c)}; the drawer held ${$.fmt(s.currency, actual)}`, later: 'A recount at close took extra time.', right: 'Count each slot twice and face the notes the same way.', minor: true });
  return s.close;
}

export const finished = (s: RegState) => !s.cur && s.queue.length === 0;
export function review(s: RegState) {
  const n = s.done.length, clean = s.done.filter((d) => d.clean).length;
  const avg = n ? Math.round(s.done.reduce((a, d) => a + d.seconds, 0) / n) : 0;
  const fastest = [...s.done].filter((d) => d.clean).sort((a, b) => a.seconds - b.seconds)[0];
  return { drawer: s.close, tipJar: s.tipJar, checkouts: n, accuracy: n ? Math.round((clean / n) * 100) : 100, avgSeconds: avg, bestStreak: s.bestStreak, points: s.points, mistakes: s.mistakes, best: fastest ? `${fastest.who}’s checkout: clean in ${fastest.seconds} seconds.` : null, stars: n ? (clean === n ? 3 : clean / n >= 0.6 ? 2 : 1) : 0 };
}
