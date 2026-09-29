// src/lib/day-sales.ts — THE DAY'S SALES, from the ledger (pure).
// Money comes in through many paths — POS checkout, the planner, online deposits, card-on-file charges, owed balances,
// no-show / late-cancel fees, online orders, memberships, rent. Every one writes payment lines, so the day's sales are
// built from those lines: grouped into one sale each (a POS checkout, a card payment, a visit, or a single line),
// labelled by where the money came from and how it was paid. POS checkouts are matched to their receipts.
export type SaleSource = 'checkout' | 'planner' | 'deposit' | 'fee' | 'balance' | 'order' | 'membership' | 'rent' | 'other';
export type SaleMethod = 'cash' | 'card' | 'online' | 'other';
export interface DaySale { key: string; at: string; clientName: string | null; clientId: string | null; paidBy: string | null; source: SaleSource; label: string; method: SaleMethod;
  total: number; tips: number; voided: boolean; lines: any[]; receipt: any | null; staffIds: string[] }
export const SOURCE_LABEL: Record<SaleSource, string> = { checkout: 'Checkout', planner: 'Completed in the planner', deposit: 'Deposit', fee: 'Fee', balance: 'Owed balance', order: 'Online order', membership: 'Membership', rent: 'Rent', other: 'Payment' };
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

const methodOf = (m: any): SaleMethod => { const x = String(m || '').toLowerCase();
  if (x === 'cash') return 'cash'; if (/card|terminal|tap|chip|swipe|cof/.test(x)) return 'card'; if (/online|stripe|link|deposit|web|checkout/.test(x)) return 'online'; return 'other'; };
function sourceOf(lines: any[]): SaleSource {
  if (lines.some((t) => t.checkoutSessionId)) return 'checkout';
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
    const key = t.checkoutSessionId ? `co:${t.checkoutSessionId}` : t.stripePaymentIntentId ? `pi:${t.stripePaymentIntentId}` : t.appointmentId && t.type === 'income' ? `ap:${t.appointmentId}` : `tx:${t.id}`;
    (groups.get(key) || groups.set(key, []).get(key)!).push(t);
  }
  const byCheckout = new Map((receipts || []).map((r: any) => [String(r.checkoutSessionId || ''), r]));
  const sales: DaySale[] = [];
  for (const [key, lines] of groups) {
    const income = lines.filter((t) => t.type === 'income');
    if (!income.length) continue;                                   // e.g. a card-fee line on its own isn't a sale
    const receipt = key.startsWith('co:') ? byCheckout.get(key.slice(3)) || null : null;
    const off = lines.filter((t) => t.type === 'expense' && ['Discounts', 'Deposit Applied'].includes(String(t.category))).reduce((s, t) => s + num(t.amount), 0);
    const total = receipt ? num(receipt.total) : round2(income.reduce((s, t) => s + num(t.amount), 0) - off);
    const voided = receipt ? !!receipt.voided : income.every((t) => t.voided);
    const source = sourceOf(lines);
    const first = lines.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
    sales.push({ key, at: receipt?.date || first.date, clientName: receipt?.clientName || first.clientOrVendor || null, clientId: receipt?.clientId || first.clientId || null, paidBy: receipt?.paidBy || first.paidBy || null,
      source, label: SOURCE_LABEL[source], method: methodOf(receipt?.paymentMethod || income[0]?.paymentMethod), total: round2(total), voided,
      tips: round2(income.filter((t) => t.category === 'Tips').reduce((s, t) => s + num(t.amount), 0)), lines, receipt, staffIds: Array.from(new Set(income.map((t) => t.staffId).filter(Boolean))) });
  }
  // POS receipts with no lines yet (e.g. a sale recorded moments ago) still count.
  for (const r of receipts || []) if (!groups.has(`co:${r.checkoutSessionId}`) && inDay(r.date))
    sales.push({ key: `co:${r.checkoutSessionId}`, at: r.date, clientName: r.clientName || null, clientId: r.clientId || null, paidBy: r.paidBy || null, source: 'checkout', label: 'Checkout', method: methodOf(r.paymentMethod), total: num(r.total), tips: num(r.tip), voided: !!r.voided, lines: [], receipt: r, staffIds: [] });
  sales.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const live = sales.filter((s) => !s.voided);
  const sum = (f: (s: DaySale) => boolean) => round2(live.filter(f).reduce((a, s) => a + s.total, 0));
  return { sales, summary: { total: sum(() => true), count: live.length, cash: sum((s) => s.method === 'cash'), card: sum((s) => s.method === 'card'), online: sum((s) => s.method === 'online'), other: sum((s) => s.method === 'other'),
    tips: round2(live.reduce((a, s) => a + s.tips, 0)), voidedCount: sales.length - live.length, voidedTotal: round2(sales.filter((s) => s.voided).reduce((a, s) => a + s.total, 0)), average: live.length ? round2(sum(() => true) / live.length) : 0 } };
}
