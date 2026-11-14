// src/lib/table-bill.ts — PAY AT THE TABLE, worked out (pure). The server (lib/table-pay-server) and the guest's page
// (app/bill) both use it, so what a guest is asked to pay is what the server takes.
// - Settings: off until the business turns it on; which ways guests may split (by seat, by item, evenly), the tip
//   choices, whether tips are worked out before or after tax, and the one already picked.
// - The bill: each line on the table's tab at the price the desk would ring it up at, comps taken off, with tax and any
//   discount the guest's own profile brings, worked out by the same checkout calculation the desk uses (lib/checkout-calc),
//   so the sale recorded later comes to the same total.
// - A share: the lines a guest picks (their seat, some items) or an even part, priced as that part of the whole bill
//   (tax and discounts shared fairly); the last share is exactly what's left, so the shares add up to the bill to the
//   cent. Lines someone has paid for, or is paying for right now, can't be picked again; the first payment sets the way
//   the table splits.

import { computeCheckout } from '@/lib/checkout-calc';

export type SplitWay = 'seat' | 'item' | 'even';
export type TipBase = 'pre' | 'post';
export type TablePaySettings = { on: boolean; ways: SplitWay[]; tips: number[]; tipBase: TipBase; suggest: number | null };
export const DEFAULT_TABLE_PAY: TablePaySettings = { on: false, ways: ['seat', 'item', 'even'], tips: [18, 20, 22], tipBase: 'pre', suggest: 20 };
const WAYS: SplitWay[] = ['seat', 'item', 'even'];
export const MAX_WAYS = 12;

export function tablePayOf(tenant: any): TablePaySettings { return cleanTablePay(tenant?.kitchenSettings?.tablePay); }
export function cleanTablePay(raw: any): TablePaySettings {
  const out: TablePaySettings = { ...DEFAULT_TABLE_PAY, ways: [...DEFAULT_TABLE_PAY.ways], tips: [...DEFAULT_TABLE_PAY.tips] };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.on === 'boolean') out.on = raw.on;
  if (Array.isArray(raw.ways)) { const w = WAYS.filter((x) => raw.ways.includes(x)); if (w.length) out.ways = w; }
  if (Array.isArray(raw.tips)) {
    const t = Array.from(new Set(raw.tips.map((x: any) => Math.round(Number(x))).filter((n: number) => Number.isFinite(n) && n >= 1 && n <= 50))).sort((a: any, b: any) => a - b).slice(0, 4) as number[];
    out.tips = t;
  }
  if (raw.tipBase === 'pre' || raw.tipBase === 'post') out.tipBase = raw.tipBase;
  if (raw.suggest === null) out.suggest = null;
  else if (raw.suggest !== undefined) { const n = Math.round(Number(raw.suggest)); out.suggest = Number.isFinite(n) && out.tips.includes(n) ? n : null; }
  if (out.suggest !== null && !out.tips.includes(out.suggest)) out.suggest = out.tips.includes(20) ? 20 : out.tips[0] ?? null;
  return out;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A short fingerprint of what's on a tab (each line, how many and any comp): "paid in full" holds only while the tab
 *  is the one that was paid for. */
export function tabSig(tab: unknown): string {
  const ls = (Array.isArray(tab) ? tab : []).filter((l: any) => l && l.lineId)
    .map((l: any) => `${l.lineId}:${l.itemId || ''}:${Math.max(1, Math.round(num(l.quantity) || 1))}:${l.comp ? r2(num(l.comp.amount)) : 0}`).sort().join('|');
  let h = 5381; for (let i = 0; i < ls.length; i++) h = ((h * 33) ^ ls.charCodeAt(i)) >>> 0;
  return `${ls.length ? ls.split('|').length : 0}.${h.toString(36)}`;
}

// ── The bill ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type BillLine = { lineId: string; itemId: string; name: string; seat: number | null; price: number; comped: boolean; type: 'product' | 'service' };
export type Bill = { lines: BillLine[]; items: any[]; subtotal: number; discount: number; tax: number; total: number; unfired: string[]; missing: string[] };
export type Catalog = { item: (id: string) => any | null; price: (item: any) => number; name: (item: any) => string };

/** The table's bill from its tab, as the desk would ring it up: each item at its price now, a comped one at what's left
 *  of it, plus tax and the guest's own discounts (the same calculation as the desk's). `items` is what the sale is
 *  recorded with. `unfired`: dishes held and never sent to the kitchen (the sale can't be recorded until they're fired
 *  or voided). `missing`: lines whose item is gone from the menu. */
export function billFrom(visitId: string, visit: any, cat: Catalog, ctx: { tenant: any; client: any | null; memberships: any[] }): Bill {
  const tab: any[] = (Array.isArray(visit?.tab) ? visit.tab : []).filter((l: any) => l && l.lineId);
  const lines: BillLine[] = []; const unfired: string[] = []; const missing: string[] = [];
  const plain = new Map<string, any>(); const comps: any[] = [];
  for (const l of tab) {
    if (l.kdsId && l.firedAt === null) unfired.push(String(l.name || 'An item'));
    const isService = l.itemType === 'service';
    const x = cat.item(String(l.itemId || ''));
    if (!x) { missing.push(String(l.name || 'An item')); continue; }
    const each = isService ? num(x.price) : cat.price(x);
    const name = isService ? String(x.name || l.name || 'Item') : cat.name(x);
    const qty = Math.max(1, Math.round(num(l.quantity) || 1));
    const seat = Number.isFinite(Number(l.seat)) && Number(l.seat) > 0 ? Number(l.seat) : null;
    const compAmt = l.comp && num(l.comp.amount) > 0 && !isService ? num(l.comp.amount) : 0;
    if (compAmt > 0) {
      const price = Math.max(0, r2(each - compAmt));
      comps.push({ id: `${x.id}~comp~${l.lineId}`, type: 'product', quantity: 1, price, name: `${name}, comped`, itemId: x.id, compLineId: String(l.lineId), compVisitId: visitId });
      lines.push({ lineId: String(l.lineId), itemId: x.id, name: `${name}, comped`, seat, price, comped: true, type: 'product' });
      continue;
    }
    const key = `${isService ? 'service' : 'product'}:${x.id}`;
    const cur = plain.get(key) || { id: x.id, type: isService ? 'service' : 'product', quantity: 0, price: each, name };
    cur.quantity += qty; plain.set(key, cur);
    for (let i = 0; i < qty; i++) lines.push({ lineId: qty > 1 ? `${l.lineId}.${i}` : String(l.lineId), itemId: x.id, name, seat, price: each, comped: false, type: isService ? 'service' : 'product' });
  }
  const items = [...plain.values(), ...comps];
  const calc: any = computeCheckout({ tenant: ctx.tenant, visits: [{ appointment: { ...(visit || {}), id: visitId }, service: { id: visit?.serviceId, name: 'Table', price: num(visit?.price) }, addOnServices: [] }],
    staff: [], redeemedOffer: null, waivedIds: [], items, fees: [], discounts: [], client: ctx.client, memberships: ctx.memberships || [], tip: 0, storeCredit: 0 });
  return { lines, items, subtotal: r2(num(calc.subtotal)), discount: r2(num(calc.discount) + num(calc.memberDiscount)), tax: r2(num(calc.tax)), total: r2(num(calc.total)), unfired, missing };
}

// ── Who's paid for what ───────────────────────────────────────────────────────────────────────────────────────────────
/** One guest's payment, or one being made right now: the lines it covers (or an even part), and how much. */
export type Claim = { id: string; way: SplitWay | 'rest' | 'cash'; lineIds: string[]; parts: number; ways: number; amount: number; tip: number; label: string; piId: string | null;
  at: string; until: string | null; paid: boolean; stuck?: boolean };
export type PayState = { covered: Set<string>; busy: Set<string>; paid: number; claimed: number; way: SplitWay | null; ways: number; partsTaken: number };

/** What's paid and what's being paid: from the claims (a paid one is one whose payment is on the ticket). */
export function payState(claims: Claim[], now: number): PayState {
  const covered = new Set<string>(); const busy = new Set<string>();
  let paid = 0; let claimed = 0; let way: SplitWay | null = null; let ways = 0; let partsTaken = 0;
  for (const c of claims) {
    // (One that went through and couldn't go on the check is left for a manager: it holds nothing.)
    const live = c.paid || (!c.stuck && !!c.until && Date.parse(c.until) > now);
    if (!live) continue;
    for (const id of c.lineIds) (c.paid ? covered : busy).add(id);
    if (c.paid) paid += c.amount; else claimed += c.amount;
    if (c.way === 'seat' || c.way === 'item' || c.way === 'even') { way = way || c.way; if (c.way === 'even') { ways = ways || c.ways; partsTaken += c.parts; } }
  }
  for (const id of covered) busy.delete(id);
  return { covered, busy, paid: r2(paid), claimed: r2(claimed), way, ways, partsTaken };
}

export type Choice = { way: 'seat'; seats: number[] } | { way: 'item'; lineIds: string[] } | { way: 'even'; ways: number; parts: number } | { way: 'rest' };
export type Share = { ok: true; amount: number; preTax: number; lineIds: string[]; parts: number; ways: number; label: string } | { ok: false; error: string };

const seatWords = (seats: number[]) => {
  const named = seats.filter((s) => s > 0).sort((a, b) => a - b); const table = seats.includes(0);
  const s = named.length === 0 ? '' : named.length === 1 ? `Seat ${named[0]}` : `Seats ${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return table ? (s ? `${s}, and for the table` : 'For the table') : s;
};

/** What a guest's choice comes to now, given what's paid and being paid. The share that leaves nothing unpaid is exactly
 *  what's left, so every share together comes to the bill. */
export function shareFor(bill: Bill, st: PayState, choice: Choice, s: TablePaySettings): Share {
  const left = r2(bill.total - st.paid - st.claimed);
  if (!(bill.total > 0) || left <= 0) return { ok: false, error: st.claimed > 0 ? 'The rest of the check is being paid right now.' : 'This check is all paid.' };
  const open = bill.lines.filter((l) => !st.covered.has(l.lineId) && !st.busy.has(l.lineId));
  const preTaxOf = (amt: number) => (bill.total > 0 ? r2(amt * Math.max(0, bill.total - bill.tax) / bill.total) : amt);
  if (choice.way !== 'rest' && !s.ways.includes(choice.way)) return { ok: false, error: 'That way of splitting isn’t offered here.' };
  if (choice.way !== 'rest' && st.way && st.way !== choice.way) return { ok: false, error: st.way === 'even' ? 'This table is splitting evenly.' : st.way === 'seat' ? 'This table is splitting by seat.' : 'This table is splitting by item.' };
  const byLines = (ids: string[], label: string, everythingLeft: boolean): Share => {
    if (!ids.length) return { ok: false, error: 'Pick what you’re paying for.' };
    const sub = bill.lines.reduce((a, l) => a + l.price, 0);
    const mine = bill.lines.filter((l) => ids.includes(l.lineId)).reduce((a, l) => a + l.price, 0);
    // The last of it, with nobody else paying right now: exactly what's left.
    const last = everythingLeft && st.claimed === 0;
    const amount = last ? left : Math.min(left, r2(sub > 0 ? bill.total * (mine / sub) : 0));
    if (!(amount > 0)) return { ok: false, error: 'There’s nothing to pay for that.' };
    return { ok: true, amount, preTax: preTaxOf(amount), lineIds: ids, parts: 0, ways: 0, label };
  };
  if (choice.way === 'rest') {
    if (st.claimed > 0) return { ok: false, error: 'Someone at the table is paying right now. Try again in a moment.' };
    return { ok: true, amount: left, preTax: preTaxOf(left), lineIds: open.map((l) => l.lineId), parts: st.way === 'even' ? Math.max(0, st.ways - st.partsTaken) : 0, ways: st.ways, label: 'The rest of the check' };
  }
  if (choice.way === 'seat') {
    const seats = Array.from(new Set((choice.seats || []).map((x) => Math.max(0, Math.floor(num(x)))))).slice(0, 20);
    const ids = open.filter((l) => seats.includes(l.seat ?? 0)).map((l) => l.lineId);
    if (seats.some((x) => !bill.lines.some((l) => (l.seat ?? 0) === x))) return { ok: false, error: 'That seat isn’t on this check.' };
    if (!ids.length) return { ok: false, error: seats.length === 1 ? `${seatWords(seats)} is paid already.` : 'Those seats are paid already.' };
    return byLines(ids, seatWords(seats), ids.length === open.length);
  }
  if (choice.way === 'item') {
    const want = Array.from(new Set(choice.lineIds || [])).slice(0, 60);
    if (want.some((id) => !bill.lines.some((l) => l.lineId === id))) return { ok: false, error: 'Something you picked isn’t on this check any more.' };
    if (want.some((id) => st.covered.has(id) || st.busy.has(id))) return { ok: false, error: 'Something you picked is paid already, or being paid right now.' };
    const names = bill.lines.filter((l) => want.includes(l.lineId)).map((l) => l.name);
    const label = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
    return byLines(want, label, want.length === open.length);
  }
  // Evenly: the number of ways is set by the first payment; a guest can pay for more than one part.
  const ways = st.ways || Math.max(2, Math.min(MAX_WAYS, Math.floor(num(choice.ways))));
  if (st.ways && Math.floor(num(choice.ways)) && Math.floor(num(choice.ways)) !== st.ways) return { ok: false, error: `This table is splitting ${st.ways} ways.` };
  const partsLeft = ways - st.partsTaken;
  const parts = Math.max(1, Math.min(partsLeft, Math.floor(num(choice.parts)) || 1));
  if (partsLeft <= 0) return { ok: false, error: 'Every part is paid, or being paid right now.' };
  const each = r2(bill.total / ways);
  const last = parts === partsLeft && st.claimed === 0;
  const amount = last ? left : Math.min(left, r2(each * parts));
  const k = st.partsTaken + 1;
  const label = parts === 1 ? `Share ${k} of ${ways}` : `Shares ${k} to ${k + parts - 1} of ${ways}`;
  return { ok: true, amount, preTax: preTaxOf(amount), lineIds: [], parts, ways, label };
}

/** The tip for a share: a percent of it before or after tax, as the business set (or an amount the guest typed). */
export function tipFor(share: { amount: number; preTax: number }, tip: { pct?: number | null; amount?: number | null }, s: TablePaySettings): number {
  if (tip.amount !== undefined && tip.amount !== null) return Math.max(0, Math.min(r2(share.amount * 2), r2(num(tip.amount))));
  const pct = Math.max(0, Math.min(50, num(tip.pct)));
  return r2((s.tipBase === 'pre' ? share.preTax : share.amount) * (pct / 100));
}
