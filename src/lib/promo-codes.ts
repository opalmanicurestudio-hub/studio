// src/lib/promo-codes.ts — PROMO CODES IN THE ONLINE SHOP. The same codes the business keeps under Discounts, with a
// "where it works" choice (visits at the desk, the online shop, or both). In the shop a code comes off the order as its
// own line: item prices never change. The discount is shared across the items it covers (largest remainder, to the
// cent) and written on each line, so a refund of one item gives back what was actually paid for it, never more.
//
// Checked the same way twice: when the customer applies it (api/retail/promo) and again when they pay
// (api/retail/checkout), so what they saw is what they get, and a code can't be stretched past its rules.

export type PromoWhere = 'services' | 'shop' | 'both';
export interface PromoLine { id: string; productId: string; unitPriceCents: number; qtyOrdered: number }
export interface PromoResult {
  ok: boolean;
  error?: string;
  code?: string;
  discountId?: string;
  label?: string;
  cents: number;              // taken off the items
  freeShipping: boolean;
  byLine: Record<string, number>;   // line id → cents of the discount on that line (all units)
}

export const normalizeCode = (c: unknown) => String(c ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const ms = (v: any) => { const t = v ? Date.parse(String(v)) : NaN; return Number.isFinite(t) ? t : null; };

export function worksInShop(d: any): boolean {
  const w = String(d?.appliesTo || 'services');
  return w === 'shop' || w === 'both';
}

/** What a code is worth on this cart, or why it can't be used. `email` is the customer's, for once-per-customer codes. */
export function evaluatePromo(d: any, lines: PromoLine[], o: { email?: string; now?: number; shippingCents?: number } = {}): PromoResult {
  const none: PromoResult = { ok: false, cents: 0, freeShipping: false, byLine: {} };
  const now = o.now ?? Date.now();
  if (!d || !worksInShop(d)) return { ...none, error: 'We couldn’t find that code.' };
  if (d.isActive === false) return { ...none, error: 'That code isn’t active right now.' };
  const from = ms(d.validFrom), until = ms(d.validUntil);
  if (from != null && now < from) return { ...none, error: 'That code hasn’t started yet.' };
  if (until != null && now > until) return { ...none, error: 'That code has ended.' };
  if (Number(d.usageLimit) > 0 && (Number(d.usageCount) || 0) >= Number(d.usageLimit)) return { ...none, error: 'That code has been used up.' };
  const email = String(o.email || '').trim().toLowerCase();
  if (d.limitOnePerCustomer && email && Array.isArray(d.usedByEmails) && d.usedByEmails.includes(email)) return { ...none, error: 'You’ve already used this code.' };

  const only: string[] = Array.isArray(d.applicableProductIds) ? d.applicableProductIds.map(String) : [];
  const eligible = lines.filter((l) => !only.length || only.includes(String(l.productId)));
  if (!eligible.length) return { ...none, error: 'This code doesn’t cover the items in your cart.' };
  const base = eligible.reduce((s, l) => s + l.unitPriceCents * l.qtyOrdered, 0);
  const min = Math.max(0, Math.round(Number(d.minOrderCents) || 0));
  if (min > 0 && base < min) return { ...none, error: `Add ${money(min - base)} more to use this code.` };

  const code = normalizeCode(d.code);
  if (d.type === 'free_shipping') {
    return { ok: true, code, discountId: String(d.id), label: `${code} (free shipping)`, cents: 0, freeShipping: true, byLine: {} };
  }
  const value = Number(d.value) || 0;
  let cents = d.type === 'percentage' ? Math.round(base * Math.min(100, Math.max(0, value)) / 100) : Math.round(value * 100);
  cents = Math.max(0, Math.min(cents, base));
  if (!cents) return { ...none, error: 'That code doesn’t take anything off this order.' };
  const label = d.type === 'percentage' ? `${code} (${value}% off)` : `${code} (${money(Math.round(value * 100))} off)`;
  return { ok: true, code, discountId: String(d.id), label, cents, freeShipping: false, byLine: shareAcross(eligible, cents) };
}

/** Shares `cents` across lines in proportion to what each costs, to the exact cent (largest remainder). */
export function shareAcross(lines: PromoLine[], cents: number): Record<string, number> {
  const total = lines.reduce((s, l) => s + l.unitPriceCents * l.qtyOrdered, 0);
  if (!total || cents <= 0) return {};
  const parts = lines.map((l) => { const exact = (cents * l.unitPriceCents * l.qtyOrdered) / total; return { id: l.id, floor: Math.floor(exact), rem: exact - Math.floor(exact) }; });
  let left = cents - parts.reduce((s, p) => s + p.floor, 0);
  for (const p of [...parts].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; p.floor++; left--; }
  return Object.fromEntries(parts.filter((p) => p.floor > 0).map((p) => [p.id, p.floor]));
}

/** Lower a discount so the card still has the processor's minimum (50¢) to collect. */
export function capForMinimum(r: PromoResult, chargeableBeforeCents: number): PromoResult {
  const room = Math.max(0, chargeableBeforeCents - 50);
  if (r.cents <= room) return r;
  if (room <= 0) return { ...r, ok: false, error: 'This code can’t be used on an order this small.', cents: 0, byLine: {} };
  const lines = Object.entries(r.byLine).map(([id, c]) => ({ id, productId: id, unitPriceCents: c, qtyOrdered: 1 }));
  return { ...r, cents: room, byLine: shareAcross(lines, room) };
}

/** What one unit of a line refunds: its price less its share of any promo code. */
export function refundUnitCents(line: any): number {
  const unit = Math.max(0, Math.round(Number(line?.unitPriceCents) || 0));
  const qty = Math.max(1, Math.round(Number(line?.qtyOrdered) || 1));
  const off = Math.max(0, Math.round(Number(line?.promoCents) || 0));
  return Math.max(0, unit - Math.round(off / qty));
}
