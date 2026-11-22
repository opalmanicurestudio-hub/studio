// src/lib/counter-money.ts — TIPS AND DISCOUNTS AT THE COUNTER (pure; design board "Money at the counter"). Used by the
// screens and the server alike (lib/counter-money-server).
// - Tips: off until the business turns them on (tenant.counterTips: on, three percents, at the counter or the drive-thru
//   too). The guest picks one on the screen before paying; it's on the order (tipCents) and in its total, so the card is
//   charged once with it, and cash counts it in the drawer. Handing over cash and keeping the change makes the change
//   the tip.
// - Discounts: the business's own list (tenant.counterDiscounts: a name, a percent or an amount off), which anyone at the
//   counter can use; any other amount takes a manager (lib/counter-money-server). One discount on an order at a time,
//   beside a reward (lib/counter-points), never more off than the items come to; off before tax.

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export type TipSettings = { on: boolean; pcts: [number, number, number]; where: 'counter' | 'both' };
export const TIP_PCTS_DEFAULT: [number, number, number] = [15, 18, 20];
/** A tip is never more than this (or the order itself). */
export const TIP_MAX_CENTS = 50000;

const pctOk = (v: unknown) => { const n = Math.round(num(v)); return n >= 1 && n <= 50 ? n : null; };
/** The business's tip settings (off unless turned on). */
export function tipsOf(tenant: any): TipSettings {
  const t = tenant?.counterTips || {};
  const p = Array.isArray(t.pcts) ? t.pcts.map(pctOk) : [];
  const pcts = (p.length === 3 && p.every((x: number | null) => x !== null) ? [...(p as number[])].sort((a, b) => a - b) : TIP_PCTS_DEFAULT) as [number, number, number];
  return { on: t.on === true, pcts, where: t.where === 'both' ? 'both' : 'counter' };
}
/** Whether this screen asks for tips: the counter always when on; the drive-thru only when the business says so. */
export const tipsHere = (s: TipSettings, channel: string) => s.on && (channel === 'counter' || s.where === 'both');

/** Each percent as an amount of `baseCents` (what the order comes to before any tip). */
export const tipChoices = (baseCents: number, pcts: number[]) => pcts.map((pct) => ({ pct, cents: Math.round(Math.max(0, baseCents) * pct / 100) }));

/** A tip typed in: whole cents, never below zero, never more than the order or the cap; null for one that isn't a number. */
export function cleanTip(v: unknown, baseCents: number): number | null {
  const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, TIP_MAX_CENTS, Math.max(0, Math.round(baseCents)));
}

export type Discount = { id: string; label: string; kind: 'pct' | 'off'; value: number };
/** Up to this many on the list. */
export const DISCOUNTS_MAX = 8;

/** One discount, as kept: a name, and a percent (1 to 100) or an amount off in cents (up to $500). */
export function cleanDiscount(raw: any): Discount | null {
  const label = clip(raw?.label, 32); if (!label) return null;
  const kind = raw?.kind === 'off' ? 'off' : raw?.kind === 'pct' ? 'pct' : null; if (!kind) return null;
  const v = Math.round(num(raw?.value));
  if (kind === 'pct' ? v < 1 || v > 100 : v < 1 || v > 50000) return null;
  const id = ID.test(String(raw?.id || '')) ? String(raw.id) : label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'discount';
  return { id, label, kind, value: v };
}
/** The business's list (each name once). */
export function discountsOf(tenant: any): Discount[] {
  const out: Discount[] = []; const seen = new Set<string>();
  for (const x of Array.isArray(tenant?.counterDiscounts) ? tenant.counterDiscounts : []) {
    const d = cleanDiscount(x); if (!d || seen.has(d.id)) continue; seen.add(d.id); out.push(d);
    if (out.length >= DISCOUNTS_MAX) break;
  }
  return out;
}
/** How it reads: "10%" or "$1.00 off". */
export const discountWords = (d: Pick<Discount, 'kind' | 'value'>) => (d.kind === 'pct' ? `${d.value}%` : `$${(d.value / 100).toFixed(2)} off`);

/** What it takes off items coming to `itemsCents`, after a reward of `rewardCents` (never past zero). */
export function discountCents(d: Pick<Discount, 'kind' | 'value'>, itemsCents: number, rewardCents = 0): number {
  const room = Math.max(0, Math.round(itemsCents) - Math.max(0, Math.round(rewardCents)));
  const want = d.kind === 'pct' ? Math.round(Math.max(0, itemsCents) * d.value / 100) : Math.round(d.value);
  return Math.max(0, Math.min(want, room));
}

/** An order's items, in cents (before any reward or discount). */
export const itemsCentsOf = (o: any) => Math.round((Array.isArray(o?.lines) ? o.lines : []).reduce((t: number, l: any) => t + num(l.unitPrice) * num(l.quantity), 0) * 100);
/** Its reward, in cents. */
export const rewardCentsOf = (o: any) => (o?.reward ? Math.max(0, Math.round(num(o.reward.cents))) : 0);
/** Its discount (the business's or a manager's), in cents, as it comes out now beside its reward. */
export const markdownCentsOf = (o: any) => {
  const m = o?.markdown; if (!m || (m.kind !== 'pct' && m.kind !== 'off')) return 0;
  return discountCents({ kind: m.kind, value: num(m.value) }, itemsCentsOf(o), rewardCentsOf(o));
};
/** Its tip, in cents. */
export const tipCentsOf = (o: any) => Math.max(0, Math.round(num(o?.tipCents)));

// GIFT CARDS AND STORE CREDIT ON AN ORDER (design board "Money at the counter", part 2; lib/counter-money-server
// addTender): set aside before the rest is paid, and taken when it's paid (lib/counter-server payOrder). A gift card's
// amount is held on the card meanwhile (lib/gift-cards), so two registers can't spend the same money.
// SPLIT BILLS (design board "Money at the counter", part 3; lib/counter-split-server): a part paid in cash or by card
// before the rest is taken now, so it's on the order with the gift cards and store credit (`part`: one guest's share).
// It goes to the kitchen as one order and counts as paid when the parts add up (lib/counter-server payOrder).
export type Tender = ({ kind: 'gift'; giftCardId: string; code: string; cents: number; promo?: boolean } | { kind: 'credit'; clientId: string; cents: number }
  | { kind: 'cash'; partId: string; cents: number; tendered: number; at: string; by: string; tillId: string | null }
  | { kind: 'card'; partId: string; cents: number; id: string | null; at: string; by: string }) & { part?: boolean };
/** The gift cards, store credit and paid parts on it. */
export function tendersOf(o: any): Tender[] {
  return (Array.isArray(o?.tenders) ? o.tenders : []).filter((t: any) => (t?.kind === 'gift' && t.giftCardId) || (t?.kind === 'credit' && t.clientId) || ((t?.kind === 'cash' || t?.kind === 'card') && t.partId))
    .map((t: any) => ({ ...t, cents: Math.max(0, Math.round(num(t.cents))) }));
}
/** A part taken already (cash in the drawer, or a card charged), never set aside. */
export const isPaidPart = (t: Pick<Tender, 'kind'>) => t.kind === 'cash' || t.kind === 'card';
/** Its parts taken already. */
export const paidPartsOf = (o: any) => tendersOf(o).filter(isPaidPart);
/** A card part being given back right now (its refund asked of the card company): nothing pays the order meanwhile, so
 *  it's never paid with a part that's then refunded. Two minutes at most while it's asked (a step that stopped halfway
 *  is let go); once it's refunded, until the part is off the order (giving it back again finishes it). */
export const partBackOpen = (o: any, now = Date.now()) => !!o?.partBack?.at && (o.partBack.refunded === true || now - (Date.parse(String(o.partBack.at)) || 0) < 120000);
export const PART_BACK_WORDS = 'A part is being given back to their card. Try again in a moment.';
/** How many guests have paid their share (a paid part, or a gift card or store credit used for one). */
export const sharesPaidOf = (o: any) => tendersOf(o).filter((t) => isPaidPart(t) || t.part === true).length;
/** Up to this many ways, and this many parts on an order. */
export const SPLIT_WAYS_MAX = 10;
export const PARTS_MAX = 12;
/** The next share of `dueCents` split `ways` ways with `paid` shares paid: the last one is whatever's left. */
export function nextShare(dueCents: number, ways: number, paid: number): number {
  const due = Math.max(0, Math.round(dueCents)); const left = Math.max(1, Math.round(ways) - Math.max(0, Math.round(paid)));
  return left <= 1 ? due : Math.round(due / left);
}
/** How a tender reads on a screen or a slip. */
export const tenderWords = (t: Tender) => (t.kind === 'gift' ? `Gift card ${codeEnd(t.code)}` : t.kind === 'credit' ? 'Store credit' : t.kind === 'cash' ? 'Cash' : 'Card');
/** What they cover now, in cents (never more than the order). */
export const tenderCentsOf = (o: any) => Math.min(tendersOf(o).reduce((s, t) => s + t.cents, 0), Math.max(0, Math.round(num(o?.total) * 100)));
/** What's left to pay by cash or card, in cents. */
export const dueCentsOf = (o: any) => Math.max(0, Math.round(num(o?.total) * 100) - tenderCentsOf(o));
/** A gift card's code as shown on a screen or a slip: its last four. */
export const codeEnd = (code: unknown) => { const k = String(code || '').replace(/[^A-Za-z0-9]/g, ''); return k ? `••${k.slice(-4).toUpperCase()}` : '••'; };
