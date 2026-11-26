// src/lib/night-close-server.ts — CLOSING THE NIGHT, the server half (rules in lib/night-close). Reads what the night took
// and writes the close. The night is the business's day (lib/hosting-sessions: a 1am sale belongs to the night before),
// from its cutover hour to the next day's, in its time zone.
// - tenants/{t}/nightCloses/{day}: the checklist marks as they're made, then the close (who, when, the report kept as
//   it stood, who it was emailed to). With more than one location, each closes on its own as well:
//   nightCloses/{day}_{locationId} (`locationId` on it), its night on its own clock, its own checklist, and its report
//   from its own sales, orders, tables and drawers (each keeps where it was). The whole business's night is still there,
//   with everything, sales from before there were locations too; tips are shared out on it.
// - Sales come from the front desk's receipts and the counter's paid orders; comps, voids and remakes from their records
//   (api/tab, kept with the approvals); guests from the tables seated; drawers from the till; tips as the business shares
//   them (lib/tip-share), for the same day the Money page uses, so approving here and there is the one approval.
import { tenantTimeZone, wallToUtc } from '@/lib/tenant-time';
import { businessDayFor, DEFAULT_DAY_CUTOVER_HOUR } from '@/lib/hosting-sessions';
import { cleanReportTo, closeSettingsOf, nightReport, reportText, weekdayOf, type Adjustment, type CheckMark, type CloseArea, type DeliveryNight, type NightReport, type Sale, type Till, type TipRow } from '@/lib/night-close';
import { appBooksOn } from '@/lib/app-orders';
import { paidPartsOf, giftCentsOf } from '@/lib/counter-money';
import { giftLineCount } from '@/lib/counter-gift';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cutoverOf = (tenant: any) => { const h = Math.floor(Number(tenant?.hostingSettings?.dayCutoverHour ?? tenant?.hostingSettings?.cutoverHour)); return Number.isInteger(h) && h >= 0 && h <= 12 ? h : DEFAULT_DAY_CUTOVER_HOUR; };

/** Tonight, as the business counts it. */
export const tonight = (tenant: any, now = new Date()) => businessDayFor(now, tenantTimeZone(tenant), cutoverOf(tenant));
/** When a night starts and ends (ISO), cutover to cutover in the business's time zone. */
export function nightBounds(tenant: any, day: string) {
  const tz = tenantTimeZone(tenant); const h = cutoverOf(tenant);
  return { start: wallToUtc(day, h, 0, tz).toISOString(), end: wallToUtc(addDays(day, 1), h, 0, tz).toISOString(), timeZone: tz };
}

/** A night's close: the whole business's, or one location's (`at`). */
export const closeId = (day: string, at?: string | null) => (at ? `${day}_${at}` : day);

/** The drawers that were open during the night (opened before it ended, and not closed before it began). `at`: one
 *  location's only. */
export async function nightTills(db: any, T: string, b: { start: string; end: string }, at: string | null = null): Promise<(Till & { id: string })[]> {
  const since = new Date(Date.parse(b.start) - 36 * 3600000).toISOString();
  const s = await db.collection(`${T}/tillSessions`).where('openedAt', '>=', since).limit(200).get().catch(() => ({ docs: [] as any[] }));
  return s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((t: any) => String(t.openedAt || '') < b.end && (t.status === 'open' || String(t.closedAt || '') >= b.start) && (!at || String(t.locationId || '') === at))
    .map((t: any) => ({ id: t.id, openedBy: String(t.openedBy || 'Drawer'), openingFloat: num(t.openingFloat), expectedCash: num(t.expectedCash), actualCash: t.status === 'closed' && t.actualCash !== undefined ? num(t.actualCash) : null, status: t.status === 'open' ? 'open' : 'closed',
      // (Opened with no sale: how many times, and by who, from its own list: lib/drawer-moves-server drawerNoSale.)
      ...(num(t.noSales) > 0 ? { noSales: { count: Math.round(num(t.noSales)), by: (Array.isArray(t.noSaleLog) ? t.noSaleLog : []).map((m: any) => String(m?.by || 'Someone').slice(0, 60)) } } : {}),
      // (Cash paid out, put in, or taken to the safe: lib/drawer-moves-server.)
      moves: (Array.isArray(t.cashMoves) ? t.cashMoves : []).filter((m: any) => !m?.undoneAt).slice(-40).map((m: any) => ({ kind: String(m.kind || ''), cents: Math.max(0, Math.round(num(m.cents))), note: m.note ? String(m.note).slice(0, 80) : null, by: String(m.by || 'Someone').slice(0, 60), approvedBy: m.approvedBy ? String(m.approvedBy).slice(0, 60) : null })) }));
}

/** An approved tip run that covers any of this stretch (lib/tip-share runs, approved here or on the Money page). Payroll
 *  pays every approved run, so two that overlap would pay the same tips twice. */
export async function approvedTipRunOver(db: any, T: string, start: string, end: string, exceptId?: string): Promise<{ id: string; start: string; end: string } | null> {
  const s = await db.collection(`${T}/tipShareRuns`).where('status', '==', 'approved').limit(2000).get().catch(() => ({ docs: [] as any[] }));
  for (const d of s.docs) { if (d.id === exceptId) continue; const r: any = d.data() || {}; if (String(r.start || '') <= end && String(r.end || '') >= start) return { id: d.id, start: String(r.start), end: String(r.end) }; }
  return null;
}

/** The night's tip shares, as lib/tip-share works them out for the night itself (cutover to cutover), so they match its
 *  sales. Only when asked: it reads every tip, so the report builds it on open and at close, not on every refresh. */
export async function nightTips(db: any, tenantId: string, tenant: any, day: string): Promise<{ mode: string; rows: TipRow[]; start: string; end: string }> {
  const b = nightBounds(tenant, day); const start = b.start, end = new Date(Date.parse(b.end) - 1).toISOString();
  try {
    const { computeTipShares } = await import('@/lib/tip-share');
    const r: any = await computeTipShares(db, tenantId, tenant, start, end);
    return { mode: String(r.mode || 'direct'), start, end, rows: (r.rows || []).filter((x: any) => num(x.earnedCents) || num(x.shareCents)).map((x: any) => ({ name: String(x.name || 'Team member'), role: String(x.role || ''), earned: num(x.earnedCents) / 100, shared: (num(x.inCents) - num(x.outCents)) / 100, takesHome: num(x.shareCents) / 100 })) };
  } catch { return { mode: 'direct', rows: [], start, end }; }
}

/** Who gets the night's report: kept where only the server reads it (tenants/{t}/private/closing). */
export async function reportToOf(db: any, T: string): Promise<string[]> { return cleanReportTo(((await db.doc(`${T}/private/closing`).get().catch(() => null))?.data() || {}).reportTo); }

/** The night's deliveries and app orders, from the counter's orders paid that night (lib/night-close DeliveryNight). */
export function deliveryNight(orders: any[]): DeliveryNight {
  const c = (v: any) => Math.max(0, Math.round(num(v) * 100));
  const hot = orders.filter((o) => o.paidAt && o.status !== 'voided' && o.ahead?.way === 'delivery' && o.ahead?.delivery);
  const st = (o: any) => String(o.ahead.delivery.state || 'waiting');
  const tips = new Map<string, number>();
  for (const o of hot.filter((o) => st(o) === 'delivered')) { const t = Math.max(0, Math.round(num(o.tipCents))); if (t > 0) { const n = String(o.ahead.delivery.driverName || 'A driver').slice(0, 60); tips.set(n, (tips.get(n) || 0) + t); } }
  const apps = new Map<string, { label: string; orders: number; grossCents: number; feeCents: number }>();
  for (const o of orders.filter((o) => o.paidAt && o.app?.code && o.payMethod === 'app')) {
    const am = appBooksOn(o); const label = String(o.app.label || 'Delivery app');
    const g = apps.get(label) || { label, orders: 0, grossCents: 0, feeCents: 0 };
    g.orders++; g.grossCents += am.appCents + am.taxCents; g.feeCents += am.feeCents; apps.set(label, g);
  }
  return {
    delivered: hot.filter((o) => st(o) === 'delivered').length, refunded: hot.filter((o) => st(o) === 'refunded').length,
    pickedUp: hot.filter((o) => st(o) === 'pickup' || st(o) === 'picked_up').length, notSettled: hot.filter((o) => st(o) === 'failed').length,
    // (One for another day isn't going yet: it's counted under For another day.)
    going: hot.filter((o) => (st(o) === 'waiting' || st(o) === 'out') && o.status !== 'scheduled').length,
    // The fees kept: every delivery's, less those given back after it couldn't be made (lib/food-delivery-settle-server).
    feeCents: hot.filter((o) => !o.ahead.delivery.feeBack).reduce((n, o) => n + c(o.deliveryFee), 0),
    tips: Array.from(tips, ([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
    tipsWaitingCents: hot.filter((o) => st(o) === 'waiting' || st(o) === 'out').reduce((n, o) => n + Math.max(0, Math.round(num(o.tipCents))), 0),
    apps: Array.from(apps.values()).sort((a, b) => b.grossCents - a.grossCents),
    // Orders for another day paid tonight (lib/ahead-days): in tonight's sales, made on their own day.
    later: (() => { const l = orders.filter((o) => o.paidAt && o.ahead?.forDay && o.status !== 'voided'); return { orders: l.length, cents: l.reduce((n, o) => n + c(o.total), 0) }; })(),
  };
}

/** Everything the report reads for a night, and the report. `at` (with more than one location): that location's night
 *  only, from what was stamped there (the tenant given on its clock: lib/here-server zonedFor); `place`, its name. */
export async function buildNightReport(db: any, tenantId: string, tenant: any, day: string, checks: Record<string, CheckMark | undefined>, opts: { tips?: boolean; at?: string | null; place?: string | null } = {}): Promise<{ report: NightReport; tills: (Till & { id: string })[] }> {
  const T = `tenants/${tenantId}`; const b = nightBounds(tenant, day); const at = opts.at || null;
  const mine = (x: any) => !at || String(x?.locationId || '') === at;
  const [rc, co, ap, tb, tills, tips, usual] = await Promise.all([
    db.collection(`${T}/receipts`).where('date', '>=', b.start).where('date', '<', b.end).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    // Counted when paid (a quick-service order's own day is the calendar day it was started).
    db.collection(`${T}/counterOrders`).where('paidAt', '>=', b.start).where('paidAt', '<', b.end).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    // (One location's night, on its own clock: by when each was used, since its day is the business's.)
    (at ? db.collection(`${T}/approvals`).where('usedAt', '>=', b.start).where('usedAt', '<', b.end) : db.collection(`${T}/approvals`).where('day', '==', day)).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/appointments`).where('startTime', '>=', b.start).where('startTime', '<', b.end).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    nightTills(db, T, b, at),
    // (One location's night: tips are shared out on the whole business's.)
    opts.tips && !at ? nightTips(db, tenantId, tenant, day) : Promise.resolve({ mode: String(tenant?.tipSharing?.mode || 'direct'), rows: [] as TipRow[] }),
    // A usual night like this one: the same weekday's closes over the last four weeks (at this location, for one).
    Promise.all([7, 14, 21, 28].map((n) => db.doc(`${T}/nightCloses/${closeId(addDays(day, -n), at)}`).get().then((s: any) => s.data()?.report?.comps?.total).catch(() => undefined))),
  ]);
  const sales: Sale[] = [
    // A receipt's sales: its items less discounts (before tax and tips); refunds on it come off; total is what was taken.
    ...rc.docs.map((d: any) => d.data() || {}).filter((r: any) => !r.voided && mine(r)).map((r: any) => ({ at: String(r.date), net: Math.max(0, num(r.subtotal) - num(r.discount)), refunded: (Array.isArray(r.refunds) ? r.refunds : []).reduce((s: number, x: any) => s + num(x?.cents), 0) / 100,
      total: num(r.total), tip: num(r.tip), tax: num(r.tax), method: String(r.paymentMethod || 'other'),
      payments: Array.isArray(r.payments) ? r.payments.map((p: any) => ({ method: String(p.method || 'other'), amount: num(p.amount), tip: num(p.tip) })) : null })),
    // (A staff meal is settled with no money, lib/counter-server staffMeal: never a sale.)
    // (An app's order at the app's price, with any sales tax the business pays: lib/app-orders. A delivery's driver tip
    // is its tip; its fee is in what was taken, never food sales.)
    ...co.docs.map((d: any) => d.data() || {}).filter((o: any) => mine(o) && o.paidAt && !o.staffMeal && !o.refundedAt && !['refunded', 'cancelled', 'canceled'].includes(String(o.status || '')))
      .map((o: any) => { const am = o.app?.code && o.payMethod === 'app' ? appBooksOn(o) : null;
        // A delivery's tip is a tip once it's delivered (until then, the report lists it as waiting); what went back to
        // the card after it couldn't be delivered (the tip, the fee) is off what was taken.
        const dl = o.ahead?.way === 'delivery' ? o.ahead?.delivery : null;
        const dtip = dl ? (dl.state === 'delivered' ? Math.max(0, num(o.tipCents)) / 100 : 0) : Math.max(0, num(o.tipCents)) / 100;
        const back = dl ? Math.max(0, num(dl.backCents)) / 100 : 0;
        return { at: String(o.paidAt), net: am ? am.appCents / 100 : num(o.subtotal ?? (num(o.total) - num(o.tax))), total: am ? (am.appCents + am.taxCents) / 100 : Math.round((num(o.total) - back) * 100) / 100,
          tip: num(o.tip) + dtip, tax: am ? am.taxCents / 100 : num(o.tax), method: String(o.payMethod || 'other'),
          // (Part by gift card or store credit: each part under its own way of paying, lib/counter-money.)
          payments: Array.isArray(o.payments) && o.payments.length ? o.payments.map((p: any) => ({ method: String(p.method || 'other'), amount: num(p.amount) })) : null,
          // (Gift cards sold with it, lib/counter-gift: in what was taken, not in sales. Its subtotal leaves them out.)
          giftCards: giftCentsOf(o.lines) > 0 ? { count: giftLineCount(o.lines), amount: giftCentsOf(o.lines) / 100 } : null,
          // (Its reward and its discount, by name: lib/counter-money.)
          offs: [...(o.reward && num(o.reward.cents) > 0 ? [{ label: 'Rewards', amount: num(o.reward.cents) / 100 }] : []),
            ...(o.markdown && num(o.markdown.cents) > 0 ? [{ label: o.markdown.custom ? 'Other amounts' : String(o.markdown.label || 'Discount').slice(0, 40), amount: num(o.markdown.cents) / 100, okBy: o.markdown.okBy || null }] : [])] }; }),
  ];
  const deliveries = deliveryNight(co.docs.map((d: any) => d.data() || {}).filter(mine));
  // Split bills still open (lib/counter-split-server): shares paid, the order not yet. The cash is in the drawer already.
  const heldDocs = ((await db.collection(`${T}/counterOrders`).where('partsOpen', '==', true).limit(200).get().catch(() => ({ docs: [] as any[] }))).docs as any[])
    .map((d: any) => d.data() || {}).filter((o: any) => mine(o) && !o.paidAt && o.status !== 'voided');
  // Refunds given tonight on paid counter orders (lib/counter-refund-server), whatever night they were paid.
  const refundDocs = ((await db.collection(`${T}/counterOrders`).where('lastRefundAt', '>=', b.start).where('lastRefundAt', '<', b.end).limit(300).get().catch(() => ({ docs: [] as any[] }))).docs as any[])
    .map((d: any) => d.data() || {}).filter(mine);
  const tonight = refundDocs.flatMap((o: any) => (Array.isArray(o.refunds) ? o.refunds : []).filter((f: any) => String(f.at) >= b.start && String(f.at) < b.end)
    // (A gift card given back is never off sales: it was never a sale, lib/counter-gift.)
    .map((f: any) => ({ number: String(o.number || ''), cents: Math.max(0, Math.round(num(f.cents))), gift: Math.max(0, Math.round(num(f.giftCents))), net: Math.max(0, Math.round(num(f.cents) - num(f.tipCents) - num(f.taxCents) - num(f.giftCents))), reason: String(f.reason || 'No reason').slice(0, 80), approvedBy: String(f.approvedBy || 'A manager').slice(0, 60) })));
  if (tonight.length) deliveries.refunds = { count: tonight.length, cents: tonight.reduce((n, f) => n + f.cents, 0), rows: tonight.slice(0, 40).map((f) => ({ number: f.number, cents: f.cents, reason: f.reason, approvedBy: f.approvedBy })) };
  // (Off tonight's sales by when it was given back, not when it was paid.)
  const counterRefunds = tonight.reduce((n, f) => n + f.net, 0) / 100;
  // Gift cards sold at the counter given back tonight (lib/counter-refund-server): apart from sales, as they were sold.
  const giftBack = tonight.filter((f) => f.gift > 0);
  const giftRefunds = giftBack.length ? { count: giftBack.length, amount: giftBack.reduce((n, f) => n + f.gift, 0) / 100 } : null;
  if (heldDocs.length) {
    const parts = heldDocs.flatMap((o: any) => paidPartsOf(o));
    deliveries.held = { orders: heldDocs.length, cashCents: parts.filter((p) => p.kind === 'cash').reduce((n, p) => n + p.cents, 0), cardCents: parts.filter((p) => p.kind === 'card').reduce((n, p) => n + p.cents, 0),
      numbers: heldDocs.map((o: any) => String(o.number || '')).filter(Boolean).slice(0, 12) };
  }
  // (A comp, void or remake is where its table was: lib/table-tab keeps the visit with it. A table seated before the
  // night began is read on its own.)
  const visitAt = new Map<string, string>(tb.docs.map((d: any) => [d.id, String((d.data() || {}).locationId || '')]));
  if (at) {
    const missing = Array.from(new Set(ap.docs.map((d: any) => String((d.data() || {}).visitId || '')).filter((v: string) => /^[A-Za-z0-9_-]{1,160}$/.test(v) && !visitAt.has(v)))) as string[];
    for (let i = 0; i < missing.length; i += 100) {
      const snaps: any[] = await db.getAll(...missing.slice(i, i + 100).map((v) => db.doc(`${T}/appointments/${v}`))).catch(() => []);
      snaps.forEach((s: any, k: number) => visitAt.set(missing[i + k], String(s?.data?.()?.locationId || '')));
    }
  }
  const adjustments: Adjustment[] = ap.docs.map((d: any) => d.data() || {}).filter((a: any) => ['comp', 'void_item', 'remake'].includes(a.kind) && a.used === true)
    .filter((a: any) => !at || (String(a.locationId || '') || visitAt.get(String(a.visitId || '')) || '') === at)
    .map((a: any) => ({ kind: a.kind, amount: num(a.amount), reason: String(a.reason || 'No reason'), askedBy: String(a.askedBy || a.requestedBy || 'Someone'), approverName: String(a.approverName || ''), started: a.started === true, wasteCost: a.wasteCost === null || a.wasteCost === undefined ? null : num(a.wasteCost), itemName: String(a.itemName || 'Item') }));
  // Items charged less than the menu's price at the counter and the window (lib/counter-price-server), on orders paid
  // tonight: what it took off, by why.
  const priceOffs = co.docs.map((d: any) => d.data() || {}).filter((o: any) => mine(o) && o.paidAt && !o.staffMeal && o.status !== 'voided')
    .flatMap((o: any) => (Array.isArray(o.lines) ? o.lines : []).filter((l: any) => l?.priceChange && num(l.priceChange.to) < num(l.priceChange.from))
      .map((l: any) => ({ amount: Math.round((num(l.priceChange.from) - num(l.priceChange.to)) * num(l.quantity) * 100) / 100, reason: String(l.priceChange.reason || 'No reason').slice(0, 60) })));
  // On the house at the counter and the window (lib/counter-comp-server), on orders paid tonight: comps like the floor's.
  for (const o of co.docs.map((d: any) => d.data() || {}).filter((x: any) => mine(x) && x.paidAt && !x.staffMeal && x.status !== 'voided'))
    for (const l of Array.isArray(o.lines) ? o.lines : []) if (l?.comp && num(l.comp.from) > 0)
      adjustments.push({ kind: 'comp', amount: Math.round(num(l.comp.from) * num(l.quantity) * 100) / 100, reason: String(l.comp.reason || 'No reason').slice(0, 60), askedBy: String(l.comp.by || 'Someone'), approverName: String(l.comp.approvedBy || ''), started: false, wasteCost: null, itemName: String(l.name || 'Item') });
  const tables = tb.docs.map((d: any) => d.data() || {}).filter((a: any) => a.isTable === true && mine(a)).map((a: any) => ({ covers: Math.max(1, num(a.partySize) || 1) }));
  const prev = (usual as any[]).filter((v) => typeof v === 'number');
  // (One location's: what was sold tonight at no location, on the whole business's report only, so the two add up.)
  const unplaced = at ? [...rc.docs.map((d: any) => d.data() || {}).filter((r: any) => !r.voided && !r.locationId).map((r: any) => Math.max(0, num(r.subtotal) - num(r.discount))),
    ...co.docs.map((d: any) => d.data() || {}).filter((o: any) => !o.locationId && o.paidAt && !o.staffMeal && !o.refundedAt && !['refunded', 'cancelled', 'canceled'].includes(String(o.status || ''))).map((o: any) => num(o.subtotal ?? (num(o.total) - num(o.tax))))] : [];
  const report = nightReport({ day, timeZone: b.timeZone, counterRefunds, giftRefunds, priceOffs, place: at ? opts.place || null : null, unplaced: unplaced.length ? { count: unplaced.length, total: Math.round(unplaced.reduce((n, v) => n + v, 0) * 100) / 100 } : null, sales, tables, adjustments, tills, tips: { mode: tips.mode, rows: tips.rows }, items: closeSettingsOf(tenant).items, checks, usualComps: prev.length >= 2 ? prev.reduce((s, v) => s + v, 0) / prev.length : null, deliveries });
  // What was worth a look tonight (lib/activity), on the whole business's report: why, what, who.
  if (!at) {
    try {
      const { worthRows } = await import('@/lib/activity'); const { moneyLinesIn } = await import('@/lib/activity-server');
      // (Read back a page at a time, as Activity does, so a busy night's other lines never crowd these out.)
      const { lines } = await moneyLinesIn(db, tenantId, b.start, b.end, { max: 2000, endIncluded: false });
      const worth = worthRows(lines);
      if (worth.length) (report as any).worth = worth;
    } catch { /* the report stands without it */ }
  }
  return { report, tills };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Who gets the report: the addresses the business listed, or team members by id; else the business's own email; else
 *  the owner's own (a new business with neither set yet). */
export async function reportRecipients(db: any, T: string, tenant: any, list: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const x of list) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) out.add(x.toLowerCase());
    else if (/^[A-Za-z0-9_-]{1,120}$/.test(x)) { const m: any = (await db.doc(`${T}/staff/${x}`).get().catch(() => null))?.data(); const e = String(m?.email || '').trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e); }
  }
  if (!out.size) { const e = String(tenant?.email || tenant?.businessEmail || tenant?.ownerEmail || '').trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e); }
  // Nobody listed and no business email yet (a new business): the owner's own sign-in email, so the night's report
  // still reaches someone. Never shown anywhere; it's only where this email goes.
  if (!out.size) {
    const uid = String(tenant?.userId || '');
    const u: any = /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? (await db.doc(`users/${uid}`).get().catch(() => null))?.data?.() : null;
    let e = String(u?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { const o: any = (await db.collection(`${T}/staff`).where('role', '==', 'owner').limit(1).get().catch(() => null))?.docs?.[0]?.data?.(); e = String(o?.email || '').trim().toLowerCase(); }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e);
  }
  return Array.from(out).slice(0, 10);
}

/** Email the report to each recipient in the business's own email look. Returns who it went to. */
export async function emailNightReport(db: any, tenantId: string, tenant: any, rep: NightReport, to: string[]): Promise<string[]> {
  if (!to.length) return [];
  const { brandFromTenant, brandedEmail } = await import('@/lib/email-shell');
  const { sendNotification } = await import('@/lib/notify');
  const brand = brandFromTenant(tenant); const text = reportText(brand.shopName, rep); const place = (rep as any).place ? `, ${(rep as any).place}` : '';
  const html = brandedEmail(brand, text.split('\n\n').map((p) => `<p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join(''),
    { preheader: `Sales $${rep.sales.total.toFixed(2)}, comps $${rep.comps.total.toFixed(2)}, voids $${rep.voids.total.toFixed(2)}.`, title: `${weekdayOf(rep.day)} night${place}`, tag: rep.day });
  const sent: string[] = [];
  for (const addr of to) {
    const r: any = await sendNotification(db, { tenantId, channel: 'email', to: addr, subject: `${brand.shopName}${place}: ${weekdayOf(rep.day)} night, $${rep.sales.total.toFixed(2)}`, html, text, recipientType: 'staff', recipientName: addr } as any).catch(() => null);
    if (r?.ok) sent.push(addr);
  }
  return sent;
}

/** Tick an item on tonight's checklist, or log a reading (or take a tick back with done: false). Refused once the night
 *  is closed. Shared by /close and the kitchen screen's Closing sheet. */
export async function recordCheck(db: any, T: string, tenant: any, day: string, itemId: string, input: { done?: unknown; value?: unknown; note?: unknown }, by: string, areas?: CloseArea[], at: string | null = null): Promise<{ ok: true; mark: CheckMark | null } | { ok: false; error: string; status?: number }> {
  const { checkMark } = await import('@/lib/night-close');
  const item = closeSettingsOf(tenant).items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'That isn’t on the checklist any more.', status: 404 };
  if (areas && !areas.includes(item.area)) return { ok: false, error: 'That one is done from the front.', status: 403 };
  // (One location's own checklist, with more than one: `at`.)
  const ref = db.doc(`${T}/nightCloses/${closeId(day, at)}`); const where = at ? { locationId: at } : {};
  const cur: any = (await ref.get()).data() || {};
  if (cur.status === 'closed') return { ok: false, error: 'The night is already closed.', status: 409 };
  const now = new Date().toISOString();
  if (input.done === false) { const { FieldValue } = await import('firebase-admin/firestore'); await ref.set({ day, ...where, checks: { [itemId]: FieldValue.delete() }, updatedAt: now }, { merge: true }); return { ok: true, mark: null }; }
  const m = checkMark(item, input); if (!m.ok) return { ok: false, error: m.error };
  const mark: CheckMark = { ...m.mark, by: String(by || 'Someone').slice(0, 60), at: now };
  await ref.set({ day, ...where, checks: { [itemId]: mark }, updatedAt: now }, { merge: true });
  return { ok: true, mark };
}
