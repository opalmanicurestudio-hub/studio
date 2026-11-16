// src/lib/records-server.ts — RECORDS, A MONTH AT A TIME (lib/records; api/records; the page at /records). Each record
// worked out from what the business already keeps:
//   nights      each day's close (lib/night-close: sales, tax, tips, comps, voids, the drawers), the kept report for a
//               night that was closed, worked out again for one that wasn't
//   tips        tips by person (lib/tip-share), and the cash tips each person declared (lib/records)
//   tip check   tips the team reported against food and drink sales (the IRS's 8%)
//   stock       what's on the shelf at what the business pays (Inventory), now, and as kept for a month: on the 1st for the
//               month before (api/cron/nightly), or by a manager after the month-end count (tenants/{t}/stockValues/{month})
//   purchases   orders received in the month, by supplier, with the invoice when one is attached
//   comps/voids by who asked for each (tenants/{t}/approvals)
//   money       the month's money lines (tenants/{t}/transactions), for the profit and loss (lib/books-summary)
import { buildNightReport, nightBounds, tonight } from '@/lib/night-close-server';
import { isMenuItem } from '@/lib/menu-server';
import { computeTipShares } from '@/lib/tip-share';
import { unitCost, unitLabel, usesLeft } from '@/lib/product-cost';
import { keepable, monthDays, prevMonth, tipCheck, type TipCheck } from '@/lib/records';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export type NightRow = { day: string; closed: boolean; closedBy: string | null; count: number; sales: number; taken: number; tax: number; tips: number; refunds: number; comps: number; voids: number; overShort: number | null };

/** The month's sales as they came in (the front desk's receipts and the counter's paid orders), read once: which days
 *  had any (only those are worked out night by night), and what of it was food and drink (lib/records tipCheck's base:
 *  a counter order is all menu; at the desk, the lines that were menu items). */
export async function monthSales(db: any, tenantId: string, tenant: any, days: string[]): Promise<{ busy: Set<string>; foodDrink: number; partial: boolean }> {
  const T = `tenants/${tenantId}`; const b = monthBounds(tenant, days); const busy = new Set<string>(); if (!b) return { busy, foodDrink: 0, partial: false };
  const [rc, co, inv] = await Promise.all([
    db.collection(`${T}/receipts`).where('date', '>=', b.start).where('date', '<', b.end).limit(20000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/counterOrders`).where('paidAt', '>=', b.start).where('paidAt', '<', b.end).limit(20000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(3000).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const menu = new Set<string>(inv.docs.filter((d: any) => isMenuItem(d.data() || {}) || (d.data() || {}).type === 'refreshment').map((d: any) => d.id));
  const bounds = days.map((d) => ({ d, ...nightBounds(tenant, d) }));
  const dayOf = (iso: string) => bounds.find((x) => iso >= x.start && iso < x.end)?.d || null;
  let fd = 0;
  for (const d of rc.docs) {
    const r: any = d.data() || {}; if (r.voided) continue; const day = dayOf(String(r.date || '')); if (day) busy.add(day);
    const ids: any[] = Array.isArray(r.reversal?.products) ? r.reversal.products : [];
    const lines: any[] = (Array.isArray(r.detail?.lines) ? r.detail.lines : []).filter((l: any) => l?.kind === 'product'); const taken = new Set<number>();
    let f = 0;
    ids.forEach((p: any, i: number) => {
      let k = lines.findIndex((l: any, j: number) => !taken.has(j) && String(l?.label || '') === String(p?.name || '')); if (k < 0 && !taken.has(i)) k = i; if (k >= 0) taken.add(k);
      if (menu.has(String(p?.id || '')) && k >= 0 && lines[k]) f += num(lines[k].amount);
    });
    // What was refunded on it comes off, in the same share.
    const refunded = (Array.isArray(r.refunds) ? r.refunds : []).reduce((s: number, x: any) => s + num(x?.cents), 0) / 100;
    fd += num(r.subtotal) > 0 ? f * Math.max(0, 1 - refunded / num(r.subtotal)) : f;
  }
  for (const d of co.docs) {
    const o: any = d.data() || {}; if (!o.paidAt || o.staffMeal || o.refundedAt || ['refunded', 'cancelled', 'canceled', 'voided'].includes(String(o.status || ''))) continue;
    const day = dayOf(String(o.paidAt)); if (day) busy.add(day); fd += num(o.subtotal ?? (num(o.total) - num(o.tax)));
  }
  // A month with more sales than are read at once says so, rather than totals that look complete.
  return { busy, foodDrink: r2(fd), partial: rc.docs.length >= 20000 || co.docs.length >= 20000 };
}

/** The month's nights: each day's close as kept; a day with sales that wasn't closed, worked out now (and kept for six
 *  hours, so opening the page again doesn't work the month out again); a day with no sales, nothing. */
export async function monthNights(db: any, tenantId: string, tenant: any, month: string, busy?: Set<string>): Promise<NightRow[]> {
  const T = `tenants/${tenantId}`; const today = tonight(tenant); const days = monthDays(month, today); if (!days.length) return [];
  // (A month too big to read at once: every day is worked out, so none is missed.)
  const sold: Set<string> = busy || await monthSales(db, tenantId, tenant, days).then((m) => (m.partial ? new Set(days) : m.busy));
  const kept: any[] = await db.getAll(...days.map((d) => db.doc(`${T}/nightCloses/${d}`)));
  const rows: NightRow[] = new Array(days.length);
  const rowOf = (day: string, rep: any, c: any): NightRow => {
    const drawers: any[] = Array.isArray(rep?.drawers) ? rep.drawers : []; const os = drawers.filter((t) => t?.overShort !== null && t?.overShort !== undefined);
    return { day, closed: c?.status === 'closed' || !!c?.closedAt, closedBy: c?.closedBy ? words(c.closedBy, 60) : null, count: num(rep?.sales?.count), sales: r2(num(rep?.sales?.total)), taken: r2(num(rep?.sales?.taken)), tax: r2(num(rep?.sales?.tax)),
      tips: r2(num(rep?.sales?.tips)), refunds: r2(num(rep?.sales?.refunds)), comps: r2(num(rep?.comps?.total)), voids: r2(num(rep?.voids?.total)), overShort: os.length ? r2(os.reduce((s, t) => s + num(t.overShort), 0)) : null };
  };
  const todo: number[] = [];
  days.forEach((d, i) => {
    const c = kept[i]?.exists ? kept[i].data() || {} : null;
    if (c?.report && (c.status === 'closed' || c.closedAt)) rows[i] = rowOf(d, c.report, c);
    else if (!sold.has(d)) rows[i] = rowOf(d, null, c);
    else todo.push(i);
  });
  // The nights with sales that weren't closed: as worked out in the last six hours (a past night), else now, a few at a
  // time.
  const fresh = Date.now() - 6 * 3600000;
  const cached: any[] = todo.length ? await db.getAll(...todo.map((i) => db.doc(`${T}/recordsNights/${days[i]}`))) : [];
  const build: number[] = [];
  todo.forEach((i, k) => { const x = cached[k]?.exists ? cached[k].data() || {} : null; if (x?.row && days[i] < today && Date.parse(String(x.at || '')) > fresh) rows[i] = x.row; else build.push(i); });
  for (let k = 0; k < build.length; k += 6) {
    await Promise.all(build.slice(k, k + 6).map(async (i) => {
      const c = kept[i]?.exists ? kept[i].data() || {} : null;
      const r = await buildNightReport(db, tenantId, tenant, days[i], {}, { tips: false }).catch(() => null);
      rows[i] = rowOf(days[i], r?.report || null, c);
      if (r && days[i] < today) await db.doc(`${T}/recordsNights/${days[i]}`).set({ row: rows[i], at: new Date().toISOString() }).catch(() => undefined);
    }));
  }
  return rows;
}

export type StockLine = { id: string; name: string; left: number; unit: string; unitCost: number; value: number; typical: boolean };
/** What's on the shelf, at what the business pays: everything counted that has a cost (a menu item made from its recipe
 *  is its ingredients, already counted; equipment isn't stock). */
export function stockNow(items: [string, any][]): { total: number; lines: StockLine[]; typical: number } {
  const lines: StockLine[] = [];
  for (const [id, x] of items) {
    if (!x || x.archived === true || x.status === 'archived' || x.isActive === false || x.type === 'equipment' || x.countStock === false) continue;
    if (x.type === 'refreshment' && Array.isArray(x.formula) && x.formula.length) continue;
    const left = usesLeft(x); const u = unitCost(x); if (left === null || u === null || !(left > 0)) continue;
    lines.push({ id, name: words(x.name, 80) || 'Item', left: Math.round(left * 1000) / 1000, unit: unitLabel(x), unitCost: Math.round(u * 10000) / 10000, value: r2(left * u), typical: x.typicalCost === true });
  }
  lines.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { total: r2(lines.reduce((s, l) => s + l.value, 0)), lines, typical: r2(lines.filter((l) => l.typical).reduce((s, l) => s + l.value, 0)) };
}
export const STOCK_LINES_KEPT = 1500;
/** Keeps what's on the shelf as a month's value, as of now (the automatic one once, never over a manager's; a manager's
 *  after a count replaces it, the value it replaced kept with it). */
export async function keepStockValue(db: any, tenantId: string, month: string, by: string, auto = false): Promise<{ total: number; kept: boolean }> {
  const T = `tenants/${tenantId}`; const inv = await db.collection(`${T}/inventory`).limit(5000).get();
  const s = stockNow(inv.docs.map((d: any) => [d.id, d.data() || {}]));
  const doc = { month, at: new Date().toISOString(), by, auto, total: s.total, typical: s.typical, count: s.lines.length, lines: s.lines.slice(0, STOCK_LINES_KEPT) };
  const ref = db.doc(`${T}/stockValues/${month}`);
  if (auto) { const made = await ref.create(doc).then(() => true).catch(() => false); return { total: s.total, kept: made }; }
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || null;
    const earlier = cur ? [...(Array.isArray(cur.earlier) ? cur.earlier : []), { total: cur.total, at: cur.at, by: cur.by, auto: cur.auto === true }].slice(-5) : [];
    tx.set(ref, { ...doc, earlier });
  });
  return { total: s.total, kept: true };
}
/** The nightly run, on the business's first three days of a month: the month before's value, if nobody kept one. */
export async function stockSnapshotSweep(db: any, tenantId: string, tenant: any): Promise<boolean> {
  const today = tonight(tenant); if (Number(today.slice(8, 10)) > 3) return false;
  const month = prevMonth(today.slice(0, 7));
  if ((await db.doc(`tenants/${tenantId}/stockValues/${month}`).get()).exists) return false;
  const inv = await db.collection(`tenants/${tenantId}/inventory`).limit(1).get(); if (inv.empty) return false;
  return (await keepStockValue(db, tenantId, month, 'Kept automatically', true)).kept;
}

export type Purchase = { orderId: string; number: string; supplier: string; at: string; lines: number; total: number; invoice: boolean };
/** Orders received in the month, newest first, and by supplier. */
export async function monthPurchases(db: any, tenantId: string, start: string, end: string): Promise<{ list: Purchase[]; bySupplier: { supplier: string; count: number; total: number; invoices: number }[]; total: number }> {
  const snap = await db.collection(`tenants/${tenantId}/orders`).where('receivedAt', '>=', start).where('receivedAt', '<', end).limit(2000).get()
    .catch(() => db.collection(`tenants/${tenantId}/orders`).limit(2000).get()).catch(() => ({ docs: [] as any[] }));
  const list: Purchase[] = [];
  for (const d of snap.docs) {
    const o: any = d.data() || {}; const at = String(o.receivedAt || ''); if (!(at >= start && at < end)) continue;
    const items: any[] = Array.isArray(o.items) ? o.items : []; const got = items.filter((i) => num(i?.receivedQuantity) > 0);
    list.push({ orderId: d.id, number: words(o.number, 20) || d.id.slice(-6), supplier: words(o.supplier, 60) || 'A supplier', at, lines: got.length, total: r2(got.reduce((s, i) => s + num(i.receivedQuantity) * num(i.costPerUnit), 0)), invoice: !!o.invoiceUrl });
  }
  list.sort((a, b) => b.at.localeCompare(a.at));
  const by = new Map<string, { supplier: string; count: number; total: number; invoices: number }>();
  for (const p of list) { const k = p.supplier.toLowerCase(); const x = by.get(k) || { supplier: p.supplier, count: 0, total: 0, invoices: 0 }; x.count++; x.total = r2(x.total + p.total); if (p.invoice) x.invoices++; by.set(k, x); }
  return { list, bySupplier: Array.from(by.values()).sort((a, b) => b.total - a.total), total: r2(list.reduce((s, p) => s + p.total, 0)) };
}

export type PersonAdjust = { name: string; comps: number; compCount: number; voids: number; voidCount: number; remakes: number };
/** Comps, voids and remakes in the month, by who asked for each. */
export async function monthAdjustments(db: any, tenantId: string, firstDay: string, lastDay: string): Promise<PersonAdjust[]> {
  const snap = await db.collection(`tenants/${tenantId}/approvals`).where('day', '>=', firstDay).where('day', '<=', lastDay).limit(5000).get().catch(() => ({ docs: [] as any[] }));
  const by = new Map<string, PersonAdjust>();
  for (const d of snap.docs) {
    const a: any = d.data() || {}; if (a.used !== true || !['comp', 'void_item', 'remake'].includes(a.kind)) continue;
    const name = words(a.askedBy || a.requestedBy, 60) || 'Someone'; const x = by.get(name.toLowerCase()) || { name, comps: 0, compCount: 0, voids: 0, voidCount: 0, remakes: 0 };
    if (a.kind === 'comp') { x.comps = r2(x.comps + num(a.amount)); x.compCount++; } else if (a.kind === 'void_item') { x.voids = r2(x.voids + num(a.amount)); x.voidCount++; } else x.remakes++;
    by.set(name.toLowerCase(), x);
  }
  return Array.from(by.values()).sort((a, b) => b.comps + b.voids - (a.comps + a.voids) || a.name.localeCompare(b.name));
}

export type TipPerson = { staffId: string; name: string; chargedCents: number; cashCents: number; shareCents: number; declared: { cashCents: number; paidOutCents: number; signedName: string; signedAt: string; changed: boolean } | null; due: boolean };
/** Tips in the month by person, with what each declared; who's due to declare (cash tips of $20 or more recorded, or
 *  any tips at all: cash handed over that the till never saw counts too). */
export async function monthTips(db: any, tenantId: string, tenant: any, month: string, start: string, end: string): Promise<{ people: TipPerson[]; chargedCents: number; cashCents: number; declaredCashCents: number; mode: string }> {
  const t = await computeTipShares(db, tenantId, tenant, start, end).catch(() => null);
  const decl = await db.collection(`tenants/${tenantId}/tipDeclarations`).where('month', '==', month).limit(500).get().catch(() => ({ docs: [] as any[] }));
  const declared = new Map<string, any>(decl.docs.map((d: any) => { const x = d.data() || {}; return [String(x.staffId || ''), x]; }));
  const people: TipPerson[] = [];
  const said = (x: any) => ({ cashCents: num(x.cashCents), paidOutCents: num(x.paidOutCents), signedName: words(x.signedName, 80), signedAt: String(x.signedAt || ''), changed: Array.isArray(x.earlier) && x.earlier.length > 0 });
  for (const r of (t?.rows || []) as any[]) {
    const gross = num(r.earnedCents); if (!(gross > 0) && !declared.has(r.staffId)) continue;
    const x = declared.get(r.staffId);
    people.push({ staffId: r.staffId, name: words(r.name, 60) || 'Team member', chargedCents: Math.max(0, gross - num(r.cashEarnedCents)), cashCents: num(r.cashEarnedCents), shareCents: num(r.shareCents), declared: x ? said(x) : null, due: true });
  }
  // Anyone who declared without tips on record (cash handed to them directly) is listed too.
  for (const [sid, x] of declared) if (!people.some((p) => p.staffId === sid)) people.push({ staffId: sid, name: words(x.name, 60) || 'Team member', chargedCents: 0, cashCents: 0, shareCents: 0, declared: said(x), due: false });
  people.sort((a, b) => Number(!!a.declared) - Number(!!b.declared) || a.name.localeCompare(b.name));
  const chargedCents = Math.max(0, num(t?.totalCents) + num(t?.feeCents) - num(t?.cashCents));
  return { people, chargedCents, cashCents: num(t?.cashCents), declaredCashCents: people.reduce((s, p) => s + (p.declared?.cashCents || 0), 0), mode: String(t?.mode || 'direct') };
}

/** The month's bounds in the business's own days (its first night's start to its last night's end). */
export function monthBounds(tenant: any, days: string[]): { start: string; end: string } | null {
  if (!days.length) return null; return { start: nightBounds(tenant, days[0]).start, end: nightBounds(tenant, days[days.length - 1]).end };
}

/** When a money line happened: its date as kept (an ISO string, a day, or a timestamp). A day with no time, or a time
 *  with no zone (typed in by hand), is the business's own day: the middle of it (lib/night-close-server nightBounds), so
 *  a line dated the 1st is in the month that starts that day wherever the business is. */
export function lineTime(v: any, tenant?: any): number {
  if (!v) return NaN;
  if (tenant && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]*)?$/.test(v.trim())) {
    const b = nightBounds(tenant, v.trim().slice(0, 10)); return (Date.parse(b.start) + Date.parse(b.end)) / 2;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v === 'object' && 'seconds' in v) return Number(v.seconds) * 1000;
  return Date.parse(String(v));
}
export const MONEY_LINES_READ = 20000;
/** The money lines dated in [start, end) (a date is kept as text or as a timestamp, so both are read: the text a day wider
 *  each side, then each kept to the stretch by its own time), and the lines they undo from before it (a refund this month
 *  of a sale last month), for lib/books-summary to look up. `partial`: more than can be read at once. */
export async function monthMoney(db: any, tenantId: string, tenant: any, start: string, end: string): Promise<{ lines: any[]; lookup: any[]; partial: boolean }> {
  const col = db.collection(`tenants/${tenantId}/transactions`); const s = Date.parse(start), e = Date.parse(end);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const [a, b]: any[] = await Promise.all([
    col.where('date', '>=', day(s - 86400000)).where('date', '<', day(e + 2 * 86400000)).limit(MONEY_LINES_READ).get(),
    col.where('date', '>=', new Date(s - 86400000)).where('date', '<', new Date(e + 86400000)).limit(MONEY_LINES_READ).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const byId = new Map<string, any>();
  for (const d of [...a.docs, ...b.docs]) { const x = { id: d.id, ...(d.data() || {}) }; const t = lineTime(x.date, tenant); if (t >= s && t < e) byId.set(d.id, x); }
  const lines = Array.from(byId.values());
  // What they undo, when it isn't in the month itself (one step: a reversal also says what it undid, for one not found).
  const wanted = Array.from(new Set(lines.flatMap((x) => [x.reversalOf, x.voidOf].map((v) => String(v || '')).filter((v) => /^[A-Za-z0-9_-]{1,160}$/.test(v) && !byId.has(v))))).slice(0, 500);
  const snaps: any[] = wanted.length ? await db.getAll(...wanted.map((id) => db.doc(`tenants/${tenantId}/transactions/${id}`))) : [];
  const lookup = snaps.filter((d) => d?.exists).map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return { lines, lookup: [...lines, ...lookup], partial: a.docs.length >= MONEY_LINES_READ || b.docs.length >= MONEY_LINES_READ };
}

export type MonthRecords = {
  month: string; today: string; days: number; partial: boolean;
  nights: NightRow[]; closes: { closed: number; open: string[] };
  sales: { total: number; tax: number; tips: number; refunds: number };
  tips: Awaited<ReturnType<typeof monthTips>> & { check: TipCheck };
  stock: { now: number; nowTypical: number; kept: { total: number; at: string; by: string; auto: boolean } | null; lines: number; keepable: boolean };
  purchases: Awaited<ReturnType<typeof monthPurchases>>;
  adjustments: PersonAdjust[];
};
/** Everything on the Records page for a month. */
export async function monthRecords(db: any, tenantId: string, tenant: any, month: string): Promise<MonthRecords> {
  const T = `tenants/${tenantId}`; const today = tonight(tenant); const days = monthDays(month, today); const b = monthBounds(tenant, days);
  const ms = await monthSales(db, tenantId, tenant, days);
  const [nights, tips, purchases, adjustments, inv, keptSnap] = await Promise.all([
    monthNights(db, tenantId, tenant, month, ms.partial ? new Set(days) : ms.busy),
    b ? monthTips(db, tenantId, tenant, month, b.start, b.end) : Promise.resolve({ people: [], chargedCents: 0, cashCents: 0, declaredCashCents: 0, mode: 'direct' }),
    b ? monthPurchases(db, tenantId, b.start, b.end) : Promise.resolve({ list: [], bySupplier: [], total: 0 }),
    days.length ? monthAdjustments(db, tenantId, days[0], days[days.length - 1]) : Promise.resolve([]),
    db.collection(`${T}/inventory`).limit(5000).get(),
    db.doc(`${T}/stockValues/${month}`).get(),
  ]);
  const sales = { total: r2(nights.reduce((s, n) => s + n.sales, 0)), tax: r2(nights.reduce((s, n) => s + n.tax, 0)), tips: r2(nights.reduce((s, n) => s + n.tips, 0)), refunds: r2(nights.reduce((s, n) => s + n.refunds, 0)) };
  // A night with sales that wasn't closed (today is still open, so it isn't counted).
  const open = nights.filter((n) => !n.closed && n.count > 0 && n.day < today).map((n) => n.day);
  const s = stockNow(inv.docs.map((d: any) => [d.id, d.data() || {}]));
  const k: any = keptSnap.exists ? keptSnap.data() || {} : null;
  return {
    month, today, days: days.length, partial: ms.partial, nights, closes: { closed: nights.filter((n) => n.closed).length, open }, sales,
    tips: { ...tips, check: tipCheck(ms.foodDrink, tips.chargedCents / 100, tips.declaredCashCents / 100) },
    stock: { now: s.total, nowTypical: s.typical, kept: k ? { total: num(k.total), at: String(k.at || ''), by: words(k.by, 60), auto: k.auto === true } : null, lines: s.lines.length, keepable: keepable(month, today) },
    purchases, adjustments,
  };
}
