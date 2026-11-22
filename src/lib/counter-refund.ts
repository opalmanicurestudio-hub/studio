// src/lib/counter-refund.ts — A REFUND AFTER A COUNTER ORDER IS PAID (pure; design board "Register tools", part 1;
// lib/counter-refund-server does it). All of what's left, or some items with their share of the tax; the tip too on a
// full refund unless they say not, and on some items only when they say so. It goes back the way it was paid: a card
// payment to that card, then gift cards and store credit back onto them, then another card machine's (given back on
// that machine), then cash out of the drawer. A split bill gives each part back the same way.
// Kept on the order: refundCents (all refunds so far, tip included), refundTipCents, refundTaxCents, refundedLines
// ({ lineId: qty }), refundBack ({ source key: cents }), refunds (each one, with why and who okayed it).
import { tendersOf, itemsCentsOf, codeEnd, giftCentsOf } from '@/lib/counter-money';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const c0 = (v: unknown) => Math.max(0, Math.round(num(v)));

export type RefundAsk = { all: boolean; lines?: { lineId: string; qty: number }[]; tip?: boolean; reason: string };
export type RefundPlan = { cents: number; netCents: number; taxCents: number; tipCents: number; lines: { lineId: string; qty: number; name: string }[]; full: boolean;
  /** Gift cards sold with it, refunded while nothing's been spent from them (lib/counter-gift): cancelled as it's
   *  refunded, their money back to the card or cash it was paid with. In `cents`, never in `netCents`. */
  giftCents?: number; gifts?: { lineId: string; giftCardId: string; cents: number; code: string | null }[] };
export type SourceKind = 'card' | 'gift' | 'credit' | 'machine' | 'cash';
export type Source = { key: string; kind: SourceKind; cents: number; pi?: string; giftCardId?: string; code?: string; clientId?: string };
export type Back = Source & { back: number };

/** The reasons offered (another one can be typed). */
export const REFUND_REASONS = ['Wrong order', 'Made wrong', 'Didn’t like it', 'Took too long', 'Charged twice'];

/** A gift card on it not refunded yet. */
const giftUnrefunded = (o: any, l: any) => !!l?.giftCard && typeof l.giftCard === 'object' && c0(o?.refundedLines?.[l.lineId]) < 1;
/** What its gift cards not refunded yet come to, in cents (made or not). */
export const giftsHeldCentsOf = (o: any) => giftCentsOf((Array.isArray(o?.lines) ? o.lines : []).filter((l: any) => giftUnrefunded(o, l)));
/** What's left to give back on what it sold, in cents (tip included). Never its gift cards: each is refunded on its own,
 *  while nothing's been spent from it (lib/counter-gift). */
export const refundLeftOf = (o: any) => Math.max(0, Math.round(num(o?.total) * 100) - giftsHeldCentsOf(o) - c0(o?.refundCents));
/** How many of a line are left to refund (a gift card: itself, once it's made and until it's refunded). */
export const unitsLeftOf = (o: any, lineId: string) => {
  const l = (Array.isArray(o?.lines) ? o.lines : []).find((x: any) => x.lineId === lineId); if (!l) return 0;
  if (l.giftCard) return giftUnrefunded(o, l) && l.giftCard.id ? 1 : 0;
  return Math.max(0, Math.round(num(l.quantity)) - c0(o?.refundedLines?.[lineId]));
};
/** Its gift cards that can be asked about refunding (made, not refunded yet). */
export const giftsToRefundOf = (o: any) => (Array.isArray(o?.lines) ? o.lines : []).filter((l: any) => giftUnrefunded(o, l) && l.giftCard.id);
export const GIFT_PICK_WORDS = 'Only its gift card is left. Pick it under Some items.';

/** Why it can't be refunded here (null: it can). */
export function cantRefund(o: any): string | null {
  if (!o) return 'That order is gone.';
  if (!o.paidAt) return 'It isn’t paid yet. Void it instead.';
  if (o.status === 'voided') return 'That order was voided.';
  if (o.staffMeal) return 'A staff meal took no money.';
  if (o.app?.code || o.payMethod === 'app') return 'A delivery app’s order is refunded on the app.';
  if (o.ahead?.way === 'delivery') return 'A delivery is refunded from Deliveries.';
  // (An order for another day, not made yet: canceled from Orders ahead, which gives it all back: lib/ahead-days-server.)
  if (o.status === 'scheduled') return 'It’s for another day. Cancel it from Orders ahead.';
  if (o.refundedAt) return 'It was refunded already.';
  if (refundLeftOf(o) <= 0 && !giftsToRefundOf(o).length) return giftsHeldCentsOf(o) > 0 && c0(o.refundCents) <= 0 ? 'Its gift card isn’t made yet. Make it first.' : 'All of it was refunded already.';
  return null;
}

/** How much a refund gives back: all of what's left, or some items with their share of the tax (and the tip if asked). */
export function refundPlan(o: any, ask: RefundAsk): { ok: true; plan: RefundPlan } | { ok: false; error: string } {
  const no = cantRefund(o); if (no) return { ok: false, error: no };
  const left = refundLeftOf(o);
  const tipLeft = Math.max(0, c0(o.tipCents) - c0(o.refundTipCents));
  const taxAll = Math.round(num(o.tax) * 100); const taxLeft = Math.max(0, taxAll - c0(o.refundTaxCents));
  const lines: any[] = Array.isArray(o.lines) ? o.lines : [];
  if (ask.all) {
    const tipC = ask.tip === false ? 0 : tipLeft;
    const cents = ask.tip === false ? left - tipLeft : left;
    if (left <= 0 && giftsToRefundOf(o).length) return { ok: false, error: GIFT_PICK_WORDS };
    if (cents <= 0) return { ok: false, error: 'Only the tip is left to give back.' };
    const taxC = Math.min(taxLeft, cents - tipC);
    return { ok: true, plan: { cents, taxCents: taxC, tipCents: tipC, netCents: cents - tipC - taxC, full: cents >= left,
      lines: lines.filter((l) => !l.giftCard).map((l) => ({ lineId: String(l.lineId), qty: unitsLeftOf(o, l.lineId), name: String(l.name || 'Item') })).filter((l) => l.qty > 0) } };
  }
  const picks = (Array.isArray(ask.lines) ? ask.lines : []).map((p) => ({ lineId: String(p?.lineId || ''), qty: Math.round(num(p?.qty)) })).filter((p) => p.qty > 0);
  if (!picks.length) return { ok: false, error: 'Pick what to refund.' };
  let itemsC = 0, taxedC = 0; const out: RefundPlan['lines'] = []; const gifts: NonNullable<RefundPlan['gifts']> = [];
  for (const p of picks) {
    const l = lines.find((x) => x.lineId === p.lineId); if (!l) return { ok: false, error: 'That item isn’t on the order.' };
    // (A gift card: all of it, as it was sold, no tax or discount on it.)
    if (l.giftCard) { if (unitsLeftOf(o, p.lineId) < 1) return { ok: false, error: l.giftCard.id ? 'That gift card was refunded already.' : 'That gift card isn’t made yet. Make it first.' };
      if (gifts.some((g) => g.lineId === p.lineId)) continue;
      gifts.push({ lineId: p.lineId, giftCardId: String(l.giftCard.id), cents: Math.round(num(l.unitPrice) * 100), code: l.giftCard.code ? String(l.giftCard.code) : null }); out.push({ lineId: p.lineId, qty: 1, name: String(l.name || 'Gift card') }); continue; }
    if (p.qty > unitsLeftOf(o, p.lineId)) return { ok: false, error: `Only ${unitsLeftOf(o, p.lineId)} of ${l.name || 'that'} ${unitsLeftOf(o, p.lineId) === 1 ? 'is' : 'are'} left to refund.` };
    const c = Math.round(num(l.unitPrice) * p.qty * 100); itemsC += c; if (l.untaxed !== true) taxedC += c;
    out.push({ lineId: p.lineId, qty: p.qty, name: String(l.name || 'Item') });
  }
  // Their share of what the items came to after any reward or discount, and of the tax (something rung in as not taxed,
  // lib/counter-oneoff, takes no tax back).
  const itemsAll = itemsCentsOf(o); const sub = Math.round(num(o.subtotal) * 100); const share = itemsAll > 0 ? Math.min(1, sub / itemsAll) : 0;
  const netC = Math.round(itemsC * share);
  const taxedAll = Math.round((itemsAll - lines.reduce((t, l) => t + (l.untaxed === true && !l.giftCard ? Math.round(num(l.unitPrice) * num(l.quantity) * 100) : 0), 0)) * share);
  const taxC = taxedAll > 0 ? Math.min(taxLeft, Math.round(Math.round(taxedC * share) * taxAll / taxedAll)) : 0;
  const tipC = ask.tip ? tipLeft : 0;
  const giftC = gifts.reduce((n, g) => n + g.cents, 0);
  const sold = Math.min(left, netC + taxC + tipC);
  const cents = sold + giftC;
  if (cents <= 0) return { ok: false, error: 'Nothing to give back for that.' };
  return { ok: true, plan: { cents, netCents: Math.max(0, sold - taxC - tipC), taxCents: taxC, tipCents: tipC, lines: out, full: sold >= left && giftC >= giftsToRefundOf(o).reduce((n: number, l: any) => n + Math.round(num(l.unitPrice) * 100), 0),
    ...(gifts.length ? { giftCents: giftC, gifts } : {}) } };
}

/** How it was paid, and what each can still take back (cents), in the order money goes back. */
export function sourcesOf(o: any): Source[] {
  const out: Source[] = [];
  const total = Math.round(num(o?.total) * 100);
  const tenders = tendersOf(o);
  for (const t of tenders) {
    if (t.kind === 'gift') out.push({ key: `gift:${t.giftCardId}`, kind: 'gift', cents: t.cents, giftCardId: t.giftCardId, code: codeEnd(t.code) });
    else if (t.kind === 'credit') out.push({ key: `credit:${t.clientId}`, kind: 'credit', cents: t.cents, clientId: t.clientId });
    else if (t.kind === 'card') out.push(t.id ? { key: `pi:${t.id}`, kind: 'card', cents: t.cents, pi: t.id } : { key: `machine:${t.partId}`, kind: 'machine', cents: t.cents });
    else out.push({ key: `cash:${t.partId}`, kind: 'cash', cents: t.cents });
  }
  const rest = total - tenders.reduce((n, t) => n + t.cents, 0);
  if (rest > 0) {
    if (o?.cardPaymentId) out.push({ key: `pi:${o.cardPaymentId}`, kind: 'card', cents: rest, pi: String(o.cardPaymentId) });
    else if (o?.payMethod === 'cash' || (o?.payMethod === 'split' && String((o.payments || []).slice(-1)[0]?.method) === 'cash')) out.push({ key: 'cash', kind: 'cash', cents: rest });
    else out.push({ key: 'machine', kind: 'machine', cents: rest });
  }
  const rank: Record<SourceKind, number> = { card: 0, gift: 1, credit: 2, machine: 3, cash: 4 };
  return out.map((s) => ({ ...s, cents: Math.max(0, s.cents - c0(o?.refundBack?.[s.key])) })).filter((s) => s.cents > 0)
    .sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const CASHISH = (k: SourceKind) => k === 'card' || k === 'machine' || k === 'cash';
/** `cents` given back across the sources, in order, of which `giftCents` (gift cards sold with it) only to the card or
 *  cash they were paid with; the rest leaves `reserve` (its gift cards not refunded yet) on the card and cash, so each
 *  of them can still go back that way later. */
export function allocateWith(sources: Source[], cents: number, giftCents = 0, reserve = 0): Back[] {
  const room = new Map(sources.map((s) => [s.key, Math.max(0, s.cents)])); const took = new Map<string, number>();
  const take = (s: Source, b: number) => { if (b <= 0) return; room.set(s.key, (room.get(s.key) || 0) - b); took.set(s.key, (took.get(s.key) || 0) + b); };
  let g = Math.max(0, Math.min(Math.round(giftCents), Math.round(cents)));
  for (const s of sources) { if (g <= 0) break; if (!CASHISH(s.kind)) continue; const b = Math.min(room.get(s.key) || 0, g); take(s, b); g -= b; }
  let rest = Math.max(0, Math.round(cents) - Math.max(0, Math.min(Math.round(giftCents), Math.round(cents))));
  let cashRoom = Math.max(0, sources.filter((s) => CASHISH(s.kind)).reduce((n, s) => n + (room.get(s.key) || 0), 0) - Math.max(0, Math.round(reserve)));
  for (const s of sources) {
    if (rest <= 0) break;
    const b = Math.min(room.get(s.key) || 0, rest, CASHISH(s.kind) ? cashRoom : Infinity);
    take(s, b); rest -= b; if (CASHISH(s.kind)) cashRoom -= b;
  }
  return sources.filter((s) => (took.get(s.key) || 0) > 0).map((s) => ({ ...s, back: took.get(s.key)! }));
}

/** `cents` given back across the sources, in order. */
export function allocate(sources: Source[], cents: number): Back[] {
  let left = Math.max(0, Math.round(cents)); const out: Back[] = [];
  for (const s of sources) { if (left <= 0) break; const b = Math.min(s.cents, left); left -= b; out.push({ ...s, back: b }); }
  return out;
}

/** How a refund's part reads on the screen. */
export const backWords = (b: Pick<Back, 'kind' | 'code'>) => (b.kind === 'card' ? 'To their card' : b.kind === 'gift' ? `Back on gift card ${b.code || ''}`.trim() : b.kind === 'credit' ? 'Back to their store credit'
  : b.kind === 'machine' ? 'Give back on your card machine' : 'Cash, from the drawer');
