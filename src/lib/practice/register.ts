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
  | { kind: 'allergy'; allergy: string }           // has an allergy on file
  | { kind: 'decline' }                            // the first card is declined
  | { kind: 'chip' }                               // the chip fails the first time it's inserted
  | { kind: 'offline' };                           // the card reader drops off Wi-Fi
export type Customer = {
  id: string; name: string; pron: 'she' | 'he' | 'they'; look: Look;
  service: { label: string; price: number; provider: string };
  items: { sku: string; n: number }[];
  slips: Slip[]; arrive: number; hello: string; visits: number;
  /** Cash payers: how they hand it over, and whether they keep the change as a tip. */
  pays?: { cash: 'one' | 'round'; keep: 'none' | 'all' | number };
  kind: 'new' | 'returning' | 'regular' | 'group';
  /** Who they are, for talking out loud: personality and background, and the kind of voice that fits. */
  persona: string; voiceHint: { gender: 'female' | 'male'; age: 'young' | 'middle_aged' | 'old' };
  receipt: 'print' | 'text' | 'email' | 'none';
  voice: { pitch: number; rate: number };
  /** First visit: the details they'll read out, and whether they want promo texts. */
  details?: { phone: string; email: string; promo: boolean; sayPhone: string; sayEmail: string };
  /** A group checking out together. */
  /** Weeks until they'd like to come back, or 'no' if they'd rather book later. */
  rebook: number | 'no';
  /** A membership or package they'd say yes to, if offered. */
  wants?: string;
  party?: { members: { name: string; look: Look; service: { label: string; price: number; provider: string } }[]; split: Split; payer?: string; methods: ('card' | 'cash')[]; ask: string };
};
export type Split = 'own' | 'even' | 'one';
export type Part = { who: string; amount: number; method: 'card' | 'cash'; paid: boolean; tip: number };   // cents
export type Tender = { who: string; method: 'card' | 'cash'; amount: number; given?: number; change?: number; tip: number };
export type Line = { id: number; kind: 'service' | 'retail' | 'discount' | 'membership' | 'package'; label: string; price: number; sku?: string; voided?: string; via?: 'gun' | 'typed' | 'usb' | 'camera' | 'name'; approvedBy?: string };
export type Mistake = { at: number; who: string; what: string; later: string; right: string; minor?: boolean };
export type Checkout = { who: string; seconds: number; clean: boolean; total: number; points: number };

export type RegState = {
  t: number; end: number; queue: Customer[]; waiting: Record<string, number>;   // patience of people in line
  currency: CurrencyCode; drawer: Record<number, number>; float: number; cashSales: number; tipJar: number;   // cents
  close: null | CloseOut;
  cur: null | { c: Customer; lines: Line[]; start: number; mood: number; claim: null | 'open' | 'discount' | 'refused'; tries: Record<string, number>; read: Record<string, number>; said: string; note: string | null; given?: number[]; kept?: number;
    greeted?: 'great' | 'ok' | 'poor'; contact?: { phone: string; email: string; promo: boolean }; asked: { phone: number; email: number };
    parts?: Part[]; partIdx: number; split?: Split; tenders: Tender[]; method?: 'card' | 'cash'; mStart: number;
    tipPick?: number; rebooked?: string | 'no'; offered: string[]; card: { tries: number; declined: boolean; other: boolean; reconnected: boolean; chipFailed: boolean }; receiptPick?: Customer['receipt'];
    history: { who: 'you' | 'client'; text: string }[] };
  lastReceipt: null | Receipt; receiptNo: number; busy: boolean; sales: { rebooks: number; rebookChances: number; members: number; packages: number };
  /** Talking out loud: each thing you said, how the client answered, and the coach's view. */
  talk: { who: string; you: string; reply: string; scores: { awareness: number; confidence: number; warmth: number; retention: number }; tip: string; fillers: number; wpm: number | null }[];   // busy: finishing up (receipt), the next client waits
  nextLine: number; done: Checkout[]; mistakes: Mistake[]; streak: number; bestStreak: number; points: number; log: string[]; coach: number; sfx: string[];
};

const V = (pitch: number, rate: number) => ({ pitch, rate });
const PEOPLE: Customer[] = [
  { id: 'rosa', name: 'Rosa', pron: 'she', persona: 'Warm, chatty regular in her 40s. Adores Ana and her gel manicures every 3 weeks. Loves a good deal and would happily join a nail membership that saves her money.', voiceHint: { gender: 'female', age: 'middle_aged' }, kind: 'regular', receipt: 'none', voice: V(1.15, 1), look: { skin: '#c68a62', hair: '#2b1d16', top: '#e9a7a0', style: 'bun' }, service: { label: 'Gel manicure', price: 45, provider: 'Ana' },
    items: [{ sku: 'cuticle', n: 1 }], slips: [], arrive: 0, hello: 'Hi! Just this cuticle oil too, please.', visits: 4, rebook: 3, wants: 'nailclub' },
  { id: 'theo', name: 'Theo', pron: 'he', persona: 'Easygoing guy in his 20s, on his lunch break and a little pressed for time. Pays cash. Friendly but brief.', voiceHint: { gender: 'male', age: 'young' }, kind: 'returning', receipt: 'print', voice: V(0.9, 1.05), look: { skin: '#e7c3a4', hair: '#6b4a2f', top: '#9fc2a8', style: 'short' }, service: { label: 'Fade', price: 40, provider: 'Diego' },
    items: [{ sku: 'beardoil', n: 1 }], slips: [{ kind: 'unreadable', sku: 'beardoil' }], arrive: 20, hello: 'And the beard oil. The label got a little wet, sorry. I’ll pay cash.', visits: 2, rebook: 4, pays: { cash: 'round', keep: 3 } },
  { id: 'ava', name: 'Ava', pron: 'she', persona: 'Excited first-time client in her early 20s, a bit shy. Found the salon on Instagram and loved her gel manicure. Wants reminders but no promo texts.', voiceHint: { gender: 'female', age: 'young' }, kind: 'new', receipt: 'email', voice: V(1.25, 1.08), look: { skin: '#f3d6c2', hair: '#3b2a20', top: '#bfe0d2', style: 'long' }, service: { label: 'Gel manicure', price: 45, provider: 'Ana' },
    items: [], slips: [], arrive: 40, hello: 'Hi! It’s my first time here. That was amazing.', visits: 1, rebook: 3,
    details: { phone: '9195550142', email: 'ava.reyes@mailbox.com', promo: false, sayPhone: 'It’s 919, 555, 0142.', sayEmail: 'It’s ava dot reyes at mailbox dot com. Reminders are fine, but no promo texts, please.' } },
  { id: 'grace', name: 'Grace', pron: 'she', persona: 'Busy professional in her 30s, friendly but efficient. Gets a silk press with Mei every 2 weeks and would value a membership that keeps her on schedule.', voiceHint: { gender: 'female', age: 'middle_aged' }, kind: 'regular', receipt: 'text', voice: V(1.05, 0.98), look: { skin: '#8d5a3b', hair: '#1d1612', top: '#c9b6e4', style: 'curls' }, service: { label: 'Silk press', price: 95, provider: 'Mei' },
    items: [{ sku: 'serum2', n: 1 }, { sku: 'shampoo', n: 1 }], slips: [{ kind: 'double', sku: 'shampoo' }, { kind: 'chip' }], arrive: 60, hello: 'The serum and the shampoo, please.', visits: 6, rebook: 2, wants: 'hairclub' },
  { id: 'party', name: 'Maya’s bridal party', pron: 'they', persona: 'Maya, speaking for her bridal party of three (Maya, Jo, Sam). Giddy and celebratory after getting ready together. They want to split the bill evenly three ways, and Jo pays her share in cash. They’re not booking again today.', voiceHint: { gender: 'female', age: 'young' }, kind: 'group', receipt: 'print', voice: V(1.2, 1.12), look: { skin: '#a8714f', hair: '#2a1a12', top: '#f3c6d0', style: 'bun' }, service: { label: 'Bridal party', price: 175, provider: 'Ana, Mei, Hana' },
    items: [{ sku: 'handcream', n: 1 }], slips: [], arrive: 85, hello: 'Hi! We’re the bridal party. We had the best time!', visits: 2, rebook: 'no',
    party: { members: [
      { name: 'Maya', look: { skin: '#a8714f', hair: '#2a1a12', top: '#f3c6d0', style: 'bun' }, service: { label: 'Gel manicure', price: 45, provider: 'Ana' } },
      { name: 'Jo', look: { skin: '#e9c9a8', hair: '#8a5a2b', top: '#c9dcef', style: 'short' }, service: { label: 'Blowout', price: 55, provider: 'Mei' } },
      { name: 'Sam', look: { skin: '#6b4430', hair: '#120c09', top: '#f2e2b0', style: 'braids' }, service: { label: 'Lash lift', price: 75, provider: 'Hana' } } ],
      split: 'even', methods: ['card', 'cash', 'card'], ask: 'Can we split it three ways, evenly? Jo’s paying her part in cash.' } },
  { id: 'lena', name: 'Lena', pron: 'she', persona: 'Polite but particular, in her 50s. Noticed the shelf sign said the vitamin C serum was $39, but it rings up higher. Values her skin routine and would buy a facial package.', voiceHint: { gender: 'female', age: 'old' }, kind: 'returning', receipt: 'email', voice: V(1.1, 0.95), look: { skin: '#f0d2b8', hair: '#c9a24f', top: '#a7c7e7', style: 'long' }, service: { label: 'Facial', price: 85, provider: 'Hana' },
    items: [{ sku: 'vitc', n: 1 }], slips: [{ kind: 'shelf', sku: 'vitc', claim: 39 }, { kind: 'decline' }], arrive: 115, hello: 'Oh, and the shelf sign said this serum was $39.', visits: 2, rebook: 6, wants: 'facial5' },
  { id: 'marcus', name: 'Marcus', pron: 'he', persona: 'Quiet regular with a dry sense of humor, in his 30s. Buying two beard oils, one as a gift. Pays cash. Rather book online later.', voiceHint: { gender: 'male', age: 'middle_aged' }, kind: 'returning', receipt: 'none', voice: V(0.8, 0.95), look: { skin: '#5c3b2a', hair: '#0f0b09', top: '#f2c38b', style: 'fade' }, service: { label: 'Beard trim', price: 25, provider: 'Diego' },
    items: [{ sku: 'beardoil', n: 2 }], slips: [], arrive: 140, hello: 'Two of the beard oils. One’s a gift. Cash is fine.', visits: 3, rebook: 'no', pays: { cash: 'one', keep: 'none' } },
  { id: 'priya', name: 'Priya', pron: 'she', persona: 'Thoughtful and health-conscious regular in her 30s. Has a fragrance allergy she takes seriously and appreciates staff who notice.', voiceHint: { gender: 'female', age: 'middle_aged' }, kind: 'regular', receipt: 'print', voice: V(1.0, 1.0), look: { skin: '#b07a52', hair: '#1a1210', top: '#e7c3c9', style: 'braids' }, service: { label: 'Color', price: 150, provider: 'Jordan' },
    items: [{ sku: 'serum4', n: 1 }], slips: [{ kind: 'unreadable', sku: 'serum4' }, { kind: 'allergy', allergy: 'fragrance' }, { kind: 'offline' }], arrive: 165, hello: 'The big scalp serum, please.', visits: 5, rebook: 6 },
];

export const they = (c: Customer) => c.pron;
export const their = (c: Customer) => (c.pron === 'she' ? 'her' : c.pron === 'he' ? 'his' : 'their');

export function newRegister(currency: CurrencyCode = 'USD'): RegState {
  const queue = PEOPLE.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i })), slips: [...p.slips], party: p.party ? { ...p.party, members: p.party.members.map((m) => ({ ...m })) } : undefined }));
  const drawer = { ...$.CURRENCIES[currency].float };
  return { t: 0, end: 240, queue, waiting: {}, currency, drawer, float: $.drawerTotal(drawer), cashSales: 0, tipJar: 0, close: null, lastReceipt: null, receiptNo: 1041, busy: false, sales: { rebooks: 0, rebookChances: 0, members: 0, packages: 0 }, talk: [], cur: null, nextLine: 1, done: [], mistakes: [], streak: 0, bestStreak: 0, points: 0, log: [], coach: 0, sfx: [] };
}

// ── Time and the line ───────────────────────────────────────────────────
/** People who have arrived and are waiting (not the one at the counter). */
export const line = (s: RegState) => s.queue.filter((c) => c.arrive <= s.t);
export function advance(s: RegState, dt: number) {
  s.t += dt;
  for (const c of line(s)) s.waiting[c.id] = Math.max(0, (s.waiting[c.id] ?? 1) - dt * 0.006);
  if (s.cur) s.cur.mood = Math.max(0, s.cur.mood - dt * 0.002);
  if (!s.cur && !s.busy && line(s).length) callNext(s);
}
export function callNext(s: RegState) {
  const c = line(s)[0]; if (!c || s.cur) return false;
  s.queue = s.queue.filter((x) => x !== c);
  const mood = s.waiting[c.id] ?? 1; delete s.waiting[c.id];
  const lines: Line[] = c.party ? c.party.members.map((m) => ({ id: s.nextLine++, kind: 'service' as const, label: `${m.name}: ${m.service.label} · ${m.service.provider}`, price: m.service.price }))
    : [{ id: s.nextLine++, kind: 'service', label: `${c.service.label} · ${c.service.provider}`, price: c.service.price }];
  s.cur = { c, lines, start: s.t, mood, claim: c.slips.some((x) => x.kind === 'shelf') ? 'open' : null, tries: {}, read: {}, said: c.hello, note: null, asked: { phone: 0, email: 0 }, partIdx: 0, tenders: [], mStart: s.mistakes.length, offered: [], card: { tries: 0, declined: false, other: false, reconnected: false, chipFailed: false }, history: [] };
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
export function scan(s: RegState, code: string, via: 'gun' | 'typed' | 'usb' | 'camera'): ScanResult {
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
// ── Greeting and first-visit details ───────────────────────────────────
export type Greeting = { text: string; q: 'great' | 'ok' | 'poor' };
export function greetOptions(c: Customer): Greeting[] {
  const g: Greeting[] = c.kind === 'new' ? [{ text: 'Welcome! Is this your first time with us?', q: 'great' }, { text: 'Hi, all done?', q: 'ok' }, { text: 'Name?', q: 'poor' }]
    : c.kind === 'group' ? [{ text: 'Hi everyone, congratulations! How did everything turn out?', q: 'great' }, { text: 'Hi, who’s paying?', q: 'ok' }, { text: 'One at a time, please.', q: 'poor' }]
    : [{ text: `Welcome back, ${c.name}! How was your ${c.service.label.toLowerCase()}?`, q: 'great' }, { text: 'Hi there, all set?', q: 'ok' }, { text: 'Next!', q: 'poor' }];
  const k = c.id.length % 3; return [...g.slice(k), ...g.slice(0, k)];
}
export function greet(s: RegState, q: Greeting['q']) {
  const cur = s.cur; if (!cur || cur.greeted) return;
  cur.greeted = q; cur.mood = Math.max(0, Math.min(1, cur.mood + (q === 'great' ? 0.12 : q === 'poor' ? -0.15 : 0)));
  const c = cur.c;
  cur.said = q === 'poor' ? (c.kind === 'new' ? 'Oh… it’s Ava. It’s my first time.' : 'Oh. Okay.') : c.kind === 'new' ? 'Yes! It was so good. I’ll definitely be back.' : c.kind === 'group' ? `${c.party?.ask}` : c.hello;
  if (q === 'great') s.points += 15;
  if (q === 'poor') s.mistakes.push({ at: s.t, who: c.name, what: `Greeted ${c.name} with “${greetOptions(c).find((x) => x.q === 'poor')!.text}”`, later: c.kind === 'regular' ? `${c.name} has been coming for months and felt like a number.` : `${c.name} felt rushed.`, right: c.kind === 'new' ? 'Welcome first-timers warmly and ask about their visit.' : 'Use their name and ask how their service went.', minor: true });
}
/** Ask a first-time client for a detail. They read it out (once; asking again is fine but costs a little patience). */
export function askDetail(s: RegState, k: 'phone' | 'email') {
  const cur = s.cur; const d = cur?.c.details; if (!cur || !d) return null;
  cur.asked[k]++; if (cur.asked[k] > 1) cur.mood = Math.max(0, cur.mood - 0.04);
  cur.said = (cur.asked[k] > 1 ? 'Sure. ' : '') + (k === 'phone' ? d.sayPhone : d.sayEmail);
  return cur.said;
}
export function saveContact(s: RegState, v: { phone: string; email: string; promo: boolean }) {
  const cur = s.cur; if (!cur) return; cur.contact = { phone: v.phone.replace(/\D/g, ''), email: v.email.trim().toLowerCase(), promo: v.promo };
  cur.said = 'Perfect, thank you!';
}
function peopleChecks(s: RegState) {
  const cur = s.cur!; const c = cur.c, who = c.name, at = s.t, d = c.details;
  if (c.rebook !== 'no') s.sales.rebookChances++;
  if (c.rebook !== 'no' && !cur.rebooked) s.mistakes.push({ at, who, what: `Didn’t offer ${who} ${their(c)} next visit`, later: `${who} meant to book online and forgot. ${their(c)[0].toUpperCase() + their(c).slice(1)} usual spot went to someone else.`, right: 'Offer the next visit before payment: suggest the service’s usual return time.', minor: true });
  if (c.wants && !cur.offered.includes(c.wants) && !cur.lines.some((l) => l.kind === 'membership' || l.kind === 'package')) s.mistakes.push({ at, who, what: `Didn’t mention the ${offerBy(c.wants).name}`, later: `${who} would have joined. ${they(c)[0].toUpperCase() + they(c).slice(1)} found out from a friend later.`, right: `Mention the membership or package that fits today’s service, once.`, minor: true });
  if (d) {
    if (!cur.contact) s.mistakes.push({ at, who, what: `Didn’t take ${who}’s details on ${their(c)} first visit`, later: `${who} never got a reminder or ${their(c)} receipt, and isn’t in the client list to rebook.`, right: 'On a first visit, ask for a phone number and email, read them back, and save them before payment.' });
    else {
      if (cur.contact.phone !== d.phone) s.mistakes.push({ at, who, what: `Saved ${who}’s phone as ${cur.contact.phone || '(blank)'}`, later: `${their(c)[0].toUpperCase() + their(c).slice(1)} reminder went to a stranger and ${they(c)} missed the next visit.`, right: 'Read the number back to the client before saving it.' });
      if (cur.contact.email !== d.email) s.mistakes.push({ at, who, what: `Saved ${who}’s email as ${cur.contact.email || '(blank)'}`, later: `The emailed receipt bounced, and ${they(c)} called asking for it.`, right: 'Spell the email back letter by letter.' });
      if (cur.contact.promo && !d.promo) s.mistakes.push({ at, who, what: `Signed ${who} up for promo texts`, later: `${who} had said no. ${they(c)[0].toUpperCase() + they(c).slice(1)} unsubscribed and complained.`, right: 'Never turn on marketing unless the client says yes.' });
    }
  }
  if (c.party) {
    const want = c.party.split, got = cur.split || 'one';
    const name = (x: Split) => (x === 'even' ? 'split evenly' : x === 'own' ? 'each pay their own' : 'have one person pay');
    if (got !== want) s.mistakes.push({ at, who, what: `Charged the party to ${name(got)}; they asked to ${name(want)}`, later: 'They had to stop at the desk while you refunded and re-charged. The line waited.', right: `Listen for how a group wants to pay before you start: “${c.party.ask}”` });
  }
}

function finalize(s: RegState, before: number) {
  const cur = s.cur!; const who = cur.c.name;
  const seconds = Math.round(s.t - cur.start);
  const clean = s.mistakes.slice(Math.min(before, cur.mStart)).filter((m) => !m.minor).length === 0;
  let points = clean ? 100 + Math.max(0, 60 - seconds) : 40;
  if (slip(cur.c, 'shelf') && cur.claim === 'discount') points += 20;
  s.streak = clean ? s.streak + 1 : 0; s.bestStreak = Math.max(s.bestStreak, s.streak); if (clean && s.streak > 1) points += 10 * (s.streak - 1);
  s.points += points;
  const paid = $.sum(cur.tenders.map((t) => t.amount)), tip = $.sum(cur.tenders.map((t) => t.tip));
  const total = (paid + tip) / 100;
  s.done.push({ who, seconds, clean, total, points });
  const how = [...new Set(cur.tenders.map((t) => (t.method === 'card' ? 'by card' : 'in cash')))].join(' and ');
  s.log.push(`${who} paid ${$.fmt(s.currency, paid)} ${how}${tip ? `, plus ${$.fmt(s.currency, tip)} in tips` : ''}.`);
  s.lastReceipt = { no: s.receiptNo++, who, t: s.t, lines: live(cur).map((l) => ({ label: l.label, price: l.price })), total: totalOf(cur), tenders: cur.tenders, currency: s.currency, choice: cur.receiptPick || cur.c.receipt, email: cur.contact?.email || null, rebooked: cur.rebooked && cur.rebooked !== 'no' ? cur.rebooked : null };
  s.sfx.push('coin'); s.cur = null;
  return { total, tip: { amount: tip / 100, pct: 0 }, seconds, clean, points };
}
export type Receipt = { no: number; who: string; t: number; lines: { label: string; price: number }[]; total: number; tenders: Tender[]; currency: CurrencyCode; choice: Customer['receipt']; email: string | null; rebooked: string | null };

// ── Rebooking ───────────────────────────────────────────────────────────
const GAME_DAY = Date.UTC(2026, 9, 17);   // Saturday, October 17
/** Rebook presets: 2, 4, 6 and 8 weeks, plus the service's own recommended return. */
export function rebookOptions(s: RegState) {
  const c = s.cur?.c; if (!c) return [];
  const rec = c.party ? [] : [c.rebook === 'no' ? 4 : c.rebook];
  return [...new Set([2, 4, 6, 8, ...rec])].sort((a, b) => a - b).map((w) => ({ weeks: w, label: slotLabel(c, w), recommended: rec.includes(w) && ![2, 4, 6, 8].includes(w) ? true : rec[0] === w }));
}
export function slotLabel(c: Customer, weeks: number) {
  const d = new Date(GAME_DAY + weeks * 7 * 864e5);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day} · 11:00 AM with ${c.service.provider.split(',')[0]}`;
}
/** What the client would pick from the options (the desk asks; the client answers). */
export function rebookAnswer(s: RegState): number | 'no' {
  const c = s.cur!.c; if (c.rebook === 'no') return 'no';
  const opts = rebookOptions(s).map((o) => o.weeks); return opts.includes(c.rebook) ? c.rebook : opts.reduce((a, b) => (Math.abs(b - (c.rebook as number)) < Math.abs(a - (c.rebook as number)) ? b : a));
}
/** Book the next visit (weeks), or 'no' if the client would rather book later. */
export function rebook(s: RegState, pick: number | 'no') {
  const cur = s.cur; if (!cur || cur.rebooked) return null;
  if (pick === 'no') { cur.rebooked = 'no'; cur.said = 'I’ll book online later, thanks.'; return null; }
  const slot = slotLabel(cur.c, pick); cur.rebooked = slot; cur.said = `Perfect, ${slot.split(' · ')[0]} works.`; s.points += 25; s.sales.rebooks++; s.sfx.push('chime');
  return slot;
}

// ── Memberships and packages ────────────────────────────────────────────
export type Offer = { key: string; name: string; kind: 'membership' | 'package'; price: number; per?: string; desc: string; fits: string[] };
export const OFFERS: Offer[] = [
  { key: 'nailclub', name: 'Nail Club', kind: 'membership', price: 39, per: 'month', desc: 'A gel manicure every month and 10% off retail.', fits: ['Gel manicure'] },
  { key: 'hairclub', name: 'Silk Press Club', kind: 'membership', price: 79, per: 'month', desc: 'A silk press or blowout every month.', fits: ['Silk press', 'Blowout'] },
  { key: 'barber', name: 'Barber Club', kind: 'membership', price: 35, per: 'month', desc: 'A fade a month and beard trims anytime.', fits: ['Fade', 'Beard trim'] },
  { key: 'facial5', name: 'Facial package', kind: 'package', price: 375, desc: '5 facials, save $50.', fits: ['Facial'] },
  { key: 'lash3', name: 'Lash lift package', kind: 'package', price: 200, desc: '3 lash lifts, save $25.', fits: ['Lash lift'] },
];
export const offerBy = (k: string) => OFFERS.find((o) => o.key === k)!;
const servicesOf = (c: Customer) => (c.party ? c.party.members.map((m) => m.service.label) : [c.service.label]);
/** Offers that fit what the client had done today, best first. */
export const offersFor = (s: RegState) => { const c = s.cur?.c; if (!c) return []; const sv = servicesOf(c); return [...OFFERS].sort((a, b) => Number(b.fits.some((f) => sv.includes(f))) - Number(a.fits.some((f) => sv.includes(f)))); };
export const fits = (c: Customer, o: Offer) => o.fits.some((f) => servicesOf(c).includes(f));
/** What the client would say to an offer. */
export function offerAnswer(s: RegState, key: string): 'yes' | 'no' { const c = s.cur!.c; return c.wants === key && fits(c, offerBy(key)) && s.cur!.offered.length <= 1 ? 'yes' : 'no'; }
/** Offer a membership or package. A yes adds it to the ticket. Offering one that doesn't fit, or a second one, costs goodwill. */
export function offer(s: RegState, key: string, answer: 'yes' | 'no') {
  const cur = s.cur; if (!cur) return null; const o = offerBy(key); const c = cur.c;
  cur.offered.push(key);
  if (!fits(c, o)) { cur.mood = Math.max(0, cur.mood - 0.08); cur.said = 'Hmm, that’s not really for me.'; }
  if (cur.offered.length > 1) { cur.mood = Math.max(0, cur.mood - 0.1); }
  if (answer === 'no') { if (fits(c, o)) cur.said = cur.offered.length > 1 ? 'No thanks, I’m all set.' : 'Not today, but thank you!'; return null; }
  const l: Line = { id: s.nextLine++, kind: o.kind, label: `${o.name}${o.per ? ' · first month' : ''}`, price: o.price };
  cur.lines.push(l); cur.said = o.kind === 'membership' ? `Yes, sign me up for ${o.name}!` : 'Yes, that’s a great deal. I’ll take it.';
  s.points += 40; if (o.kind === 'membership') s.sales.members++; else s.sales.packages++; s.sfx.push('chime');
  return l;
}

// ── The card reader ─────────────────────────────────────────────────────
export type CardWay = 'tap' | 'insert' | 'swipe';
export type CardResult = 'approved' | 'declined' | 'chip-error' | 'offline';
/** Try the card. Scenarios: a decline (until another card is used), a chip that fails once, a reader that's offline until reconnected. */
export function cardAttempt(s: RegState, way: CardWay | 'onfile', which: 'same' | 'another' = 'same'): CardResult {
  const cur = s.cur!; const c = cur.c; const k = cur.card; k.tries++;
  if (which === 'another') k.other = true;
  if (slip(c, 'offline') && !k.reconnected && way !== 'onfile') return 'offline';
  if (slip(c, 'decline') && !k.other && !part(s)) {
    if (k.declined) { cur.mood = Math.max(0, cur.mood - 0.12); if (!s.mistakes.some((m) => m.who === c.name && /same card/.test(m.what))) s.mistakes.push({ at: s.t, who: c.name, what: 'Ran the same declined card again', later: `${c.name} was embarrassed while the line watched.`, right: 'After a decline, offer another way to pay instead of trying the same card.', minor: true }); }
    k.declined = true; return 'declined';
  }
  if (slip(c, 'chip') && way === 'insert' && !k.chipFailed) { k.chipFailed = true; return 'chip-error'; }
  return 'approved';
}
export function reconnect(s: RegState) { if (s.cur) s.cur.card.reconnected = true; }
/** A security slip: writing a card number on paper when the reader is down. */
export function writeDownCard(s: RegState) {
  const c = s.cur!.c; s.mistakes.push({ at: s.t, who: c.name, what: 'Wrote a card number on paper', later: 'Card numbers on paper are a security risk; the manager had to shred it and report it.', right: 'Reconnect the reader, or use the card on file with the client’s OK. Never write card numbers down.' });
}
export type DeclineLine = { text: string; q: 'great' | 'loud' | 'pry' };
export const DECLINE_LINES: DeclineLine[] = [
  { text: 'Hmm, that one didn’t go through. It happens! Want to try another card, or tap with your phone?', q: 'great' },
  { text: 'Your card was declined.', q: 'loud' },
  { text: 'Do you have enough on that card?', q: 'pry' },
];
/** What you say after a decline. */
export function declineReply(s: RegState, q: DeclineLine['q']) {
  const cur = s.cur!; const c = cur.c;
  if (q === 'great') { cur.mood = Math.min(1, cur.mood + 0.05); cur.said = 'Oh, thank you. Let me use my other card.'; s.points += 20; return; }
  cur.mood = Math.max(0, cur.mood - 0.25); cur.said = q === 'loud' ? 'Oh… okay. Sorry. I’ll try another one.' : 'Excuse me? I’ll just use another card.';
  s.mistakes.push({ at: s.t, who: c.name, what: q === 'loud' ? 'Said “declined” out loud' : 'Asked about the money on the card', later: `${c.name} was embarrassed in front of the line and didn’t book again.`, right: 'Keep it private, no blame: “That one didn’t go through. Want to try another card?”' });
}
export const setTip = (s: RegState, pct: number) => { if (s.cur) s.cur.tipPick = pct; };
export const setKeep = (s: RegState, cents: number) => { if (s.cur) { const extra = $.sum(handOver(s)) - cashDue(s); s.cur.kept = Math.max(0, Math.min(extra, cents)); } };
export const setReceipt = (s: RegState, r: Customer['receipt']) => { if (s.cur) s.cur.receiptPick = r; else if (s.lastReceipt) s.lastReceipt.choice = r; };

// ── Who pays, how, and splitting the bill ───────────────────────────────
export const part = (s: RegState) => (s.cur?.parts ? s.cur.parts[s.cur.partIdx] : null);
export const payerName = (s: RegState) => part(s)?.who || s.cur?.c.name || '';
/** How the person paying now would like to pay. */
export const prefers = (s: RegState): 'card' | 'cash' => part(s)?.method || (s.cur?.c.pays ? 'cash' : 'card');
/** What's due from the person paying now, in cents (before cash rounding). */
export const dueNow = (s: RegState) => part(s)?.amount ?? $.cents(totalOf(s.cur!));
/** Split a group's bill. Each pays their own (retail goes with the first guest), evenly, or one person pays it all. */
export function setSplit(s: RegState, mode: Split, payer?: string) {
  const cur = s.cur; const pty = cur?.c.party; if (!cur || !pty) return null;
  const T = $.cents(totalOf(cur)); const n = pty.members.length; let parts: Part[];
  if (mode === 'even') { const each = Math.floor(T / n); parts = pty.members.map((m, i) => ({ who: m.name, amount: each + (i === 0 ? T - each * n : 0), method: pty.methods[i], paid: false, tip: 0 })); }
  else if (mode === 'own') { const svc = pty.members.map((m) => $.cents(m.service.price)); svc[0] += T - $.sum(svc); parts = pty.members.map((m, i) => ({ who: m.name, amount: svc[i], method: pty.methods[i], paid: false, tip: 0 })); }
  else { const i = Math.max(0, pty.members.findIndex((m) => m.name === payer)); parts = [{ who: pty.members[i].name, amount: T, method: pty.methods[i], paid: false, tip: 0 }]; }
  cur.parts = parts; cur.partIdx = 0; cur.split = mode; cur.given = undefined; cur.kept = undefined;
  cur.said = mode === pty.split ? 'Perfect, thank you!' : 'Oh… that’s not quite what we said.';
  return parts;
}
function cardTip(s: RegState, amountCents: number) {
  const cur = s.cur!; const pct = cur.tipPick !== undefined ? cur.tipPick / 100 : cur.mood > 0.75 ? 0.2 : cur.mood > 0.45 ? 0.18 : cur.mood > 0.2 ? 0.15 : 0;
  if (!cur.parts) return { pct: Math.round(pct * 100), amount: $.cents(Math.round(cur.c.service.price * pct)) };
  return { pct: Math.round(pct * 100), amount: Math.round((amountCents * pct * 0.85) / 100) * 100 };
}
/** The tip the person paying now chooses on the client screen. */
export const tipNow = (s: RegState) => cardTip(s, dueNow(s));
function nextPart(s: RegState, t: Tender) {
  const cur = s.cur!; cur.tenders.push(t); cur.given = undefined; cur.kept = undefined;
  cur.tipPick = undefined;
  if (cur.parts) { cur.parts[cur.partIdx].paid = true; cur.parts[cur.partIdx].tip = t.tip; if (cur.partIdx < cur.parts.length - 1) { cur.partIdx++; s.sfx.push('coin'); return true; } }
  return false;
}

/** Card payment for whoever is paying now. The tip is chosen on the client screen. */
export function pay(s: RegState) {
  const cur = s.cur; if (!cur) return null;
  const amount = dueNow(s); const tip = cardTip(s, amount);
  if (nextPart(s, { who: payerName(s), method: 'card', amount, tip: tip.amount })) return { partial: true as const, tip: { amount: tip.amount / 100, pct: tip.pct }, total: (amount + tip.amount) / 100, clean: true, seconds: 0, points: 0 };
  const before = s.mistakes.length; ticketChecks(s); peopleChecks(s);
  const r = finalize(s, before);
  return { ...r, partial: false as const, tip: { amount: tip.amount / 100, pct: tip.pct } };
}

// ── Cash ────────────────────────────────────────────────────────────────
export const paysCash = (c: Customer) => !!c.pays;
/** What's due in cash, in cents (rounded to 5 cents in Canada). */
export const cashDue = (s: RegState) => $.cashRound(s.currency, dueNow(s));
/** The notes the client hands over. */
export function handOver(s: RegState) { const cur = s.cur!; if (!cur.given) cur.given = $.clientCash(s.currency, cashDue(s), part(s) ? 'round' : cur.c.pays?.cash || 'round'); return cur.given; }
/** After seeing the total: keep the change as a tip, keep part of it, or "my change, please". Cents. */
export function keepChoice(s: RegState) {
  const cur = s.cur!; if (cur.kept !== undefined) return cur.kept;
  const extra = $.sum(handOver(s)) - cashDue(s); const k = part(s) ? 'none' : cur.c.pays?.keep ?? 'none';
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
  const code = s.currency, who = payerName(s), at = s.t;
  const given = handOver(s), due = cashDue(s), kept = keepChoice(s);
  const have = { ...s.drawer };
  for (const d of change) { if (!have[d]) return { ok: false as const, error: `There’s no ${$.denomLabel(code, d)} left in the drawer.` }; have[d]--; }
  for (const g of given) have[g] = (have[g] || 0) + 1;                       // their notes go in after the change is out
  if (kept > 0) { const t = $.makeChange(code, kept, have); if (t) { for (const x of t) have[x]--; s.tipJar += kept; } else s.cashSales += kept; }
  s.drawer = have; s.cashSales += due;
  const before = s.mistakes.length;
  const right = $.sum(given) - due - kept, gave = $.sum(change), diff = gave - right;
  const f = (x: number) => $.fmt(code, x);
  if (tendered !== $.sum(given)) s.mistakes.push({ at, who, what: `Entered ${f(tendered)} received; ${who} handed you ${f($.sum(given))}`, later: diff === 0 ? 'You still counted the right change, but the sale record is wrong.' : 'The register worked out the change from the wrong amount.', right: 'Leave the client’s notes on the drawer ledge and read them before you type the amount.', minor: diff === 0 });
  if (diff > 0) s.mistakes.push({ at, who, what: `Gave ${f(gave)} change instead of ${f(right)}`, later: `The drawer came out ${f(diff)} short at close.`, right: `Count it back up from the total: ${f(due + kept)} to ${f($.sum(given))}.` });
  if (diff < 0) s.mistakes.push({ at, who, what: `Gave ${f(gave)} change instead of ${f(right)}`, later: `${who} noticed at home and called. The drawer came out ${f(-diff)} over.`, right: `Count it back up from the total: ${f(due + kept)} to ${f($.sum(given))}.` });
  const tender: Tender = { who, method: 'cash', amount: due, given: $.sum(given), change: gave, tip: kept };
  if (nextPart(s, tender)) return { ok: true as const, partial: true as const, change: gave, right, clean: true, total: due / 100, seconds: 0, points: 0, tip: { amount: kept / 100, pct: 0 } };
  ticketChecks(s); peopleChecks(s);
  const r = finalize(s, before);
  return { ok: true as const, partial: false as const, ...r, change: gave, right };
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

export const finished = (s: RegState) => !s.cur && !s.busy && s.queue.length === 0;
export function review(s: RegState) {
  const n = s.done.length, clean = s.done.filter((d) => d.clean).length;
  const avg = n ? Math.round(s.done.reduce((a, d) => a + d.seconds, 0) / n) : 0;
  const fastest = [...s.done].filter((d) => d.clean).sort((a, b) => a.seconds - b.seconds)[0];
  return { sales: s.sales, drawer: s.close, tipJar: s.tipJar, checkouts: n, accuracy: n ? Math.round((clean / n) * 100) : 100, avgSeconds: avg, bestStreak: s.bestStreak, points: s.points, mistakes: s.mistakes, best: fastest ? `${fastest.who}’s checkout: clean in ${fastest.seconds} seconds.` : null, stars: n ? (clean === n ? 3 : clean / n >= 0.6 ? 2 : 1) : 0 };
}
