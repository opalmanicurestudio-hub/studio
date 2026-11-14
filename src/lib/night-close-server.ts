// src/lib/night-close-server.ts — CLOSING THE NIGHT, the server half (rules in lib/night-close). Reads what the night took
// and writes the close. The night is the business's day (lib/hosting-sessions: a 1am sale belongs to the night before),
// from its cutover hour to the next day's, in its time zone.
// - tenants/{t}/nightCloses/{day}: the checklist marks as they're made, then the close (who, when, the report kept as
//   it stood, who it was emailed to).
// - Sales come from the front desk's receipts and the counter's paid orders; comps, voids and remakes from their records
//   (api/tab, kept with the approvals); guests from the tables seated; drawers from the till; tips as the business shares
//   them (lib/tip-share), for the same day the Money page uses, so approving here and there is the one approval.
import { tenantTimeZone, wallToUtc } from '@/lib/tenant-time';
import { businessDayFor, DEFAULT_DAY_CUTOVER_HOUR } from '@/lib/hosting-sessions';
import { cleanReportTo, closeSettingsOf, nightReport, reportText, weekdayOf, type Adjustment, type CheckMark, type CloseArea, type NightReport, type Sale, type Till, type TipRow } from '@/lib/night-close';

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

/** The drawers that were open during the night (opened before it ended, and not closed before it began). */
export async function nightTills(db: any, T: string, b: { start: string; end: string }): Promise<(Till & { id: string })[]> {
  const since = new Date(Date.parse(b.start) - 36 * 3600000).toISOString();
  const s = await db.collection(`${T}/tillSessions`).where('openedAt', '>=', since).limit(200).get().catch(() => ({ docs: [] as any[] }));
  return s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((t: any) => String(t.openedAt || '') < b.end && (t.status === 'open' || String(t.closedAt || '') >= b.start))
    .map((t: any) => ({ id: t.id, openedBy: String(t.openedBy || 'Drawer'), openingFloat: num(t.openingFloat), expectedCash: num(t.expectedCash), actualCash: t.status === 'closed' && t.actualCash !== undefined ? num(t.actualCash) : null, status: t.status === 'open' ? 'open' : 'closed' }));
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

/** Everything the report reads for a night, and the report. */
export async function buildNightReport(db: any, tenantId: string, tenant: any, day: string, checks: Record<string, CheckMark | undefined>, opts: { tips?: boolean } = {}): Promise<{ report: NightReport; tills: (Till & { id: string })[] }> {
  const T = `tenants/${tenantId}`; const b = nightBounds(tenant, day);
  const [rc, co, ap, tb, tills, tips, usual] = await Promise.all([
    db.collection(`${T}/receipts`).where('date', '>=', b.start).where('date', '<', b.end).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    // Counted when paid (a quick-service order's own day is the calendar day it was started).
    db.collection(`${T}/counterOrders`).where('paidAt', '>=', b.start).where('paidAt', '<', b.end).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/approvals`).where('day', '==', day).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/appointments`).where('startTime', '>=', b.start).where('startTime', '<', b.end).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    nightTills(db, T, b),
    opts.tips ? nightTips(db, tenantId, tenant, day) : Promise.resolve({ mode: String(tenant?.tipSharing?.mode || 'direct'), rows: [] as TipRow[] }),
    // A usual night like this one: the same weekday's closes over the last four weeks.
    Promise.all([7, 14, 21, 28].map((n) => db.doc(`${T}/nightCloses/${addDays(day, -n)}`).get().then((s: any) => s.data()?.report?.comps?.total).catch(() => undefined))),
  ]);
  const sales: Sale[] = [
    // A receipt's sales: its items less discounts (before tax and tips); refunds on it come off; total is what was taken.
    ...rc.docs.map((d: any) => d.data() || {}).filter((r: any) => !r.voided).map((r: any) => ({ at: String(r.date), net: Math.max(0, num(r.subtotal) - num(r.discount)), refunded: (Array.isArray(r.refunds) ? r.refunds : []).reduce((s: number, x: any) => s + num(x?.cents), 0) / 100,
      total: num(r.total), tip: num(r.tip), tax: num(r.tax), method: String(r.paymentMethod || 'other'),
      payments: Array.isArray(r.payments) ? r.payments.map((p: any) => ({ method: String(p.method || 'other'), amount: num(p.amount), tip: num(p.tip) })) : null })),
    ...co.docs.map((d: any) => d.data() || {}).filter((o: any) => o.paidAt && !o.refundedAt && !['refunded', 'cancelled', 'canceled'].includes(String(o.status || '')))
      .map((o: any) => ({ at: String(o.paidAt), net: num(o.subtotal ?? (num(o.total) - num(o.tax))), total: num(o.total), tip: num(o.tip), tax: num(o.tax), method: String(o.payMethod || 'other'), payments: null })),
  ];
  const adjustments: Adjustment[] = ap.docs.map((d: any) => d.data() || {}).filter((a: any) => ['comp', 'void_item', 'remake'].includes(a.kind) && a.used === true)
    .map((a: any) => ({ kind: a.kind, amount: num(a.amount), reason: String(a.reason || 'No reason'), askedBy: String(a.askedBy || a.requestedBy || 'Someone'), approverName: String(a.approverName || ''), started: a.started === true, wasteCost: a.wasteCost === null || a.wasteCost === undefined ? null : num(a.wasteCost), itemName: String(a.itemName || 'Item') }));
  const tables = tb.docs.map((d: any) => d.data() || {}).filter((a: any) => a.isTable === true).map((a: any) => ({ covers: Math.max(1, num(a.partySize) || 1) }));
  const prev = (usual as any[]).filter((v) => typeof v === 'number');
  const report = nightReport({ day, timeZone: b.timeZone, sales, tables, adjustments, tills, tips: { mode: tips.mode, rows: tips.rows }, items: closeSettingsOf(tenant).items, checks, usualComps: prev.length >= 2 ? prev.reduce((s, v) => s + v, 0) / prev.length : null });
  return { report, tills };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Who gets the report: the addresses the business listed, or team members by id; else the business's own email. */
export async function reportRecipients(db: any, T: string, tenant: any, list: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const x of list) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) out.add(x.toLowerCase());
    else if (/^[A-Za-z0-9_-]{1,120}$/.test(x)) { const m: any = (await db.doc(`${T}/staff/${x}`).get().catch(() => null))?.data(); const e = String(m?.email || '').trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e); }
  }
  if (!out.size) { const e = String(tenant?.email || tenant?.businessEmail || tenant?.ownerEmail || '').trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e); }
  return Array.from(out).slice(0, 10);
}

/** Email the report to each recipient in the business's own email look. Returns who it went to. */
export async function emailNightReport(db: any, tenantId: string, tenant: any, rep: NightReport, to: string[]): Promise<string[]> {
  if (!to.length) return [];
  const { brandFromTenant, brandedEmail } = await import('@/lib/email-shell');
  const { sendNotification } = await import('@/lib/notify');
  const brand = brandFromTenant(tenant); const text = reportText(brand.shopName, rep);
  const html = brandedEmail(brand, text.split('\n\n').map((p) => `<p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join(''),
    { preheader: `Sales $${rep.sales.total.toFixed(2)}, comps $${rep.comps.total.toFixed(2)}, voids $${rep.voids.total.toFixed(2)}.`, title: `${weekdayOf(rep.day)} night`, tag: rep.day });
  const sent: string[] = [];
  for (const addr of to) {
    const r: any = await sendNotification(db, { tenantId, channel: 'email', to: addr, subject: `${brand.shopName}: ${weekdayOf(rep.day)} night, $${rep.sales.total.toFixed(2)}`, html, text, recipientType: 'staff', recipientName: addr } as any).catch(() => null);
    if (r?.ok) sent.push(addr);
  }
  return sent;
}

/** Tick an item on tonight's checklist, or log a reading (or take a tick back with done: false). Refused once the night
 *  is closed. Shared by /close and the kitchen screen's Closing sheet. */
export async function recordCheck(db: any, T: string, tenant: any, day: string, itemId: string, input: { done?: unknown; value?: unknown; note?: unknown }, by: string, areas?: CloseArea[]): Promise<{ ok: true; mark: CheckMark | null } | { ok: false; error: string; status?: number }> {
  const { checkMark } = await import('@/lib/night-close');
  const item = closeSettingsOf(tenant).items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'That isn’t on the checklist any more.', status: 404 };
  if (areas && !areas.includes(item.area)) return { ok: false, error: 'That one is done from the front.', status: 403 };
  const ref = db.doc(`${T}/nightCloses/${day}`);
  const cur: any = (await ref.get()).data() || {};
  if (cur.status === 'closed') return { ok: false, error: 'The night is already closed.', status: 409 };
  const now = new Date().toISOString();
  if (input.done === false) { const { FieldValue } = await import('firebase-admin/firestore'); await ref.set({ day, checks: { [itemId]: FieldValue.delete() }, updatedAt: now }, { merge: true }); return { ok: true, mark: null }; }
  const m = checkMark(item, input); if (!m.ok) return { ok: false, error: m.error };
  const mark: CheckMark = { ...m.mark, by: String(by || 'Someone').slice(0, 60), at: now };
  await ref.set({ day, checks: { [itemId]: mark }, updatedAt: now }, { merge: true });
  return { ok: true, mark };
}
