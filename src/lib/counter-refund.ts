// src/lib/counter-refund.ts — A REFUND AFTER A COUNTER ORDER IS PAID (pure; design board "Register tools", part 1;
// lib/counter-refund-server does it). All of what's left, or some items with their share of the tax; the tip too on a
// full refund unless they say not, and on some items only when they say so. It goes back the way it was paid: a card
// payment to that card, then gift cards and store credit back onto them, then another card machine's (given back on
// that machine), then cash out of the drawer. A split bill gives each part back the same way.
// Kept on the order: refundCents (all refunds so far, tip included), refundTipCents, refundTaxCents, refundedLines
// ({ lineId: qty }), refundBack ({ source key: cents }), refunds (each one, with why and who okayed it).
import { tendersOf, itemsCentsOf, codeEnd } from '@/lib/counter-money';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const c0 = (v: unknown) => Math.max(0, Math.round(num(v)));

export type RefundAsk = { all: boolean; lines?: { lineId: string; qty: number }[]; tip?: boolean; reason: string };
export type RefundPlan = { cents: number; netCents: number; taxCents: number; tipCents: number; lines: { lineId: string; qty: number; name: string }[]; full: boolean };
export type SourceKind = 'card' | 'gift' | 'credit' | 'machine' | 'cash';
export type Source = { key: string; kind: SourceKind; cents: number; pi?: string; giftCardId?: string; code?: string; clientId?: string };
export type Back = Source & { back: number };

/** The reasons offered (another one can be typed). */
export const REFUND_REASONS = ['Wrong order', 'Made wrong', 'Didn’t like it', 'Took too long', 'Charged twice'];

/** What's left to give back on it, in cents (tip included). */
export const refundLeftOf = (o: any) => Math.max(0, Math.round(num(o?.total) * 100) - c0(o?.refundCents));
/** How many of a line are left to refund. */
export const unitsLeftOf = (o: any, lineId: string) => {
  const l = (Array.isArray(o?.lines) ? o.lines : []).find((x: any) => x.lineId === lineId);
  return l ? Math.max(0, Math.round(num(l.quantity)) - c0(o?.refundedLines?.[lineId])) : 0;
};

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
  if (refundLeftOf(o) <= 0) return 'All of it was refunded already.';
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
    if (cents <= 0) return { ok: false, error: 'Only the tip is left to give back.' };
    const taxC = Math.min(taxLeft, cents - tipC);
    return { ok: true, plan: { cents, taxCents: taxC, tipCents: tipC, netCents: cents - tipC - taxC, full: cents >= left,
      lines: lines.map((l) => ({ lineId: String(l.lineId), qty: unitsLeftOf(o, l.lineId), name: String(l.name || 'Item') })).filter((l) => l.qty > 0) } };
  }
  const picks = (Array.isArray(ask.lines) ? ask.lines : []).map((p) => ({ lineId: String(p?.lineId || ''), qty: Math.round(num(p?.qty)) })).filter((p) => p.qty > 0);
  if (!picks.length) return { ok: false, error: 'Pick what to refund.' };
  let itemsC = 0; const out: RefundPlan['lines'] = [];
  for (const p of picks) {
    const l = lines.find((x) => x.lineId === p.lineId); if (!l) return { ok: false, error: 'That item isn’t on the order.' };
    if (p.qty > unitsLeftOf(o, p.lineId)) return { ok: false, error: `Only ${unitsLeftOf(o, p.lineId)} of ${l.name || 'that'} ${unitsLeftOf(o, p.lineId) === 1 ? 'is' : 'are'} left to refund.` };
    itemsC += Math.round(num(l.unitPrice) * p.qty * 100); out.push({ lineId: p.lineId, qty: p.qty, name: String(l.name || 'Item') });
  }
  // Their share of what the items came to after any reward or discount, and of the tax.
  const itemsAll = itemsCentsOf(o); const sub = Math.round(num(o.subtotal) * 100);
  const netC = itemsAll > 0 ? Math.round(itemsC * Math.min(1, sub / itemsAll)) : 0;
  const taxC = sub > 0 ? Math.min(taxLeft, Math.round(netC * taxAll / sub)) : 0;
  const tipC = ask.tip ? tipLeft : 0;
  const cents = Math.min(left, netC + taxC + tipC);
  if (cents <= 0) return { ok: false, error: 'Nothing to give back for that.' };
  return { ok: true, plan: { cents, netCents: Math.max(0, cents - taxC - tipC), taxCents: taxC, tipCents: tipC, lines: out, full: cents >= left } };
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

/** `cents` given back across the sources, in order. */
export function allocate(sources: Source[], cents: number): Back[] {
  let left = Math.max(0, Math.round(cents)); const out: Back[] = [];
  for (const s of sources) { if (left <= 0) break; const b = Math.min(s.cents, left); left -= b; out.push({ ...s, back: b }); }
  return out;
}

/** How a refund's part reads on the screen. */
export const backWords = (b: Pick<Back, 'kind' | 'code'>) => (b.kind === 'card' ? 'To their card' : b.kind === 'gift' ? `Back on gift card ${b.code || ''}`.trim() : b.kind === 'credit' ? 'Back to their store credit'
  : b.kind === 'machine' ? 'Give back on your card machine' : 'Cash, from the drawer');
