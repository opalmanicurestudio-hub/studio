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
