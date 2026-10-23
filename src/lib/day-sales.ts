// src/lib/day-sales.ts — THE DAY'S SALES, from the ledger (pure).
// Money comes in through many paths — POS checkout, the planner, online deposits, card-on-file charges, owed balances,
// no-show / late-cancel fees, online orders, memberships, rent. Every one writes payment lines, so the day's sales are
// built from those lines: grouped into one sale each (a POS checkout, a card payment, a visit, or a single line),
// labelled by where the money came from and how it was paid. POS checkouts are matched to their receipts.
export type SaleSource = 'checkout' | 'planner' | 'deposit' | 'fee' | 'balance' | 'order' | 'membership' | 'rent' | 'other';
export type SaleMethod = 'cash' | 'card' | 'online' | 'other' | 'split';
export interface DaySale { key: string; at: string; clientName: string | null; clientId: string | null; paidBy: string | null; source: SaleSource; label: string; method: SaleMethod;
  total: number; tips: number; voided: boolean; lines: any[]; receipt: any | null; staffIds: string[] }
export const SOURCE_LABEL: Record<SaleSource, string> = { checkout: 'Checkout', planner: 'Completed in the planner', deposit: 'Deposit', fee: 'Fee', balance: 'Owed balance', order: 'Online order', membership: 'Membership', rent: 'Rent', other: 'Payment' };
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

const methodOf = (m: any): SaleMethod => { const x = String(m || '').toLowerCase();
  if (x === 'cash') return 'cash'; if (x === 'split') return 'split'; if (/card|terminal|tap|chip|swipe|cof/.test(x)) return 'card'; if (/online|stripe|link|deposit|web|checkout/.test(x)) return 'online'; return 'other'; };
// An online order's lines carry its Stripe Checkout session (cs_…); a desk checkout's own id never starts that way.
const deskCheckout = (t: any) => !!t.checkoutSessionId && !String(t.checkoutSessionId).startsWith('cs_');
function sourceOf(lines: any[]): SaleSource {
  if (lines.some((t) => t.retailOrderId)) return 'order';
  if (lines.some(deskCheckout)) return 'checkout';
  const text = lines.map((t) => `${t.category || ''} ${t.description || ''} ${t.source || ''}`).join(' ').toLowerCase();
  if (/retainer|deposit/.test(text)) return 'deposit';
  if (/no.?show|late cancel|cancellation fee|change fee|reschedule fee/.test(text)) return 'fee';
  if (/balance|debt settlement|fee recovery/.test(text)) return 'balance';
  if (/online order|retail order|shop order/.test(text) || lines.some((t) => t.orderId || t.retailOrderId)) return 'order';
  if (/membership|package/.test(text)) return 'membership';
  if (/rent|booth|space rental|lease/.test(text)) return 'rent';
  if (lines.some((t) => t.appointmentId)) return 'planner';
  return 'other';
}
export function groupDaySales(txs: any[], receipts: any[], from: Date, to: Date) {
  const inDay = (d: any) => { const t = Date.parse(String(d || '')); return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime(); };
  const groups = new Map<string, any[]>();
  for (const t of txs || []) {
    if (!inDay(t.date) || t.category === 'Void') continue;
    // An online order is one sale (its items, shipping and tax lines); a desk checkout is one; then a card payment, a visit.
    const key = t.retailOrderId ? `ro:${t.retailOrderId}` : deskCheckout(t) ? `co:${t.checkoutSessionId}` : t.stripePaymentIntentId ? `pi:${t.stripePaymentIntentId}` : t.appointmentId && t.type === 'income' ? `ap:${t.appointmentId}` : `tx:${t.id}`;
    (groups.get(key) || groups.set(key, []).get(key)!).push(t);
  }
  const byCheckout = new Map((receipts || []).map((r: any) => [String(r.checkoutSessionId || ''), r]));
  const sales: DaySale[] = [];
  for (const [key, lines] of groups) {
    const income = lines.filter((t) => t.type === 'income');
    if (!income.length) continue;                                   // e.g. a card-fee line on its own isn't a sale
    // An online order's tips are written for the team when it's fulfilled, often another day: not a sale of their own.
    const orderSale = key.startsWith('ro:') ? lines.find((t) => String(t.id || '').startsWith('osale_')) : null;
    if (key.startsWith('ro:') && !orderSale && income.every((t) => t.category === 'Tips')) continue;
    const receipt = key.startsWith('co:') ? byCheckout.get(key.slice(3)) || null : null;
    const off = lines.filter((t) => t.type === 'expense' && ['Discounts', 'Deposit Applied'].includes(String(t.category))).reduce((s, t) => s + num(t.amount), 0);
    const nonTip = income.filter((t) => t.category !== 'Tips').reduce((s, t) => s + num(t.amount), 0);
    // An online order is what the customer paid for it, tip included (its sale line carries the whole).
    const orderTotal = orderSale && num(orderSale.grossOrderTotal) > 0 ? num(orderSale.grossOrderTotal) : 0;
    const total = receipt ? num(receipt.total) : orderTotal ? orderTotal : round2(income.reduce((s, t) => s + num(t.amount), 0) - off);
    const orderTips = orderTotal ? Math.max(0, round2(orderTotal - nonTip)) : 0;
    const voided = receipt ? !!receipt.voided : income.every((t) => t.voided);
    const source = sourceOf(lines);
    const first = lines.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
    sales.push({ key, at: receipt?.date || first.date, clientName: receipt?.clientName || first.clientOrVendor || null, clientId: receipt?.clientId || first.clientId || null, paidBy: receipt?.paidBy || first.paidBy || null,
      source, label: SOURCE_LABEL[source], method: methodOf(receipt?.paymentMethod || income[0]?.paymentMethod), total: round2(total), voided,
      tips: orderTotal ? orderTips : round2(income.filter((t) => t.category === 'Tips').reduce((s, t) => s + num(t.amount), 0)), lines, receipt, staffIds: Array.from(new Set(income.map((t) => t.staffId).filter(Boolean))) });
  }
  // POS receipts with no lines yet (e.g. a sale recorded moments ago) still count.
  for (const r of receipts || []) if (!groups.has(`co:${r.checkoutSessionId}`) && inDay(r.date))
    sales.push({ key: `co:${r.checkoutSessionId}`, at: r.date, clientName: r.clientName || null, clientId: r.clientId || null, paidBy: r.paidBy || null, source: 'checkout', label: 'Checkout', method: methodOf(r.paymentMethod), total: num(r.total), tips: num(r.tip), voided: !!r.voided, lines: [], receipt: r, staffIds: [] });
  sales.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const live = sales.filter((s) => !s.voided);
  const sum = (f: (s: DaySale) => boolean) => round2(live.filter(f).reduce((a, s) => a + s.total, 0));
  // A split bill counts each share under its own method (cash in the cash total, cards in card, …).
  const splitBy = (m: SaleMethod) => round2(live.filter((s) => s.method === 'split').reduce((a, s) => a + (s.receipt?.payments || []).filter((p: any) => methodOf(p.method) === m).reduce((b: number, p: any) => b + num(p.amount) + num(p.tip), 0), 0));
  return { sales, summary: { total: sum(() => true), count: live.length, cash: round2(sum((s) => s.method === 'cash') + splitBy('cash')), card: round2(sum((s) => s.method === 'card') + splitBy('card')), online: sum((s) => s.method === 'online'), other: round2(sum((s) => s.method === 'other') + splitBy('other')),
    tips: round2(live.reduce((a, s) => a + s.tips, 0)), voidedCount: sales.length - live.length, voidedTotal: round2(sales.filter((s) => s.voided).reduce((a, s) => a + s.total, 0)), average: live.length ? round2(sum(() => true) / live.length) : 0 } };
}
