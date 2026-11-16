// src/app/api/records/route.ts — RECORDS (lib/records, lib/records-server; the page at /records; design canvas "Food
// numbers": Records). What an accountant, a payroll check or the IRS asks for, a month at a time.
//   month     { tenantId, month } → managers: the month's records (nights and their closes, sales tax, tips and what
//             each person declared, tips against sales, the shelf's value, purchases by supplier, comps and voids by
//             person)
//   csv       { tenantId, month, kind: 'nights'|'tips'|'declared'|'stock'|'purchases'|'adjustments' } → managers: that
//             record as a spreadsheet file ({ name, csv })
//   keepStock { tenantId, month } → managers: what's on the shelf now kept as the month's value, as of now (after the
//             month-end count): this month, or last month until the 10th; the value it replaces is kept with it
//   mine      { tenantId } → anyone on the team: their cash tips this month and last, as the till has them, and what they
//             declared
//   declare   { tenantId, month, cash, paidOut?, signedName } → anyone on the team: their cash tips for the month, signed
//             (this month or last; again replaces it, the earlier copy kept with it)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { tonight } from '@/lib/night-close-server';
import { computeTipShares } from '@/lib/tip-share';
import { cleanDollars, cleanMonth, cleanSignature, declarable, declareBy, keepable, monthDays, monthOfDay, monthWords, prevMonth, toCsv } from '@/lib/records';
import { keepStockValue, monthAdjustments, monthBounds, monthNights, monthPurchases, monthRecords, monthTips, stockNow, STOCK_LINES_KEPT } from '@/lib/records-server';

export const dynamic = 'force-dynamic';
// A month with many nights never closed is worked out night by night (lib/records-server monthNights), once.
export const maxDuration = 60;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const $ = (c: number) => Math.round(c) / 100;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'month');
  if (!ID.test(tenantId)) return bad('Which business?');
  if (!['month', 'csv', 'keepStock', 'mine', 'declare'].includes(action)) return bad('Unknown action.');
  const g: any = await requireRole(req, tenantId, action === 'mine' || action === 'declare' ? 'staff' : 'manager'); if (g.deny) return g.deny;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = (await db.doc(T).get()).data() || {};
  const today = tonight(tenant); const by = String(g.actor?.name || 'A manager').slice(0, 60);

  if (action === 'mine' || action === 'declare') {
    const { staffIdForLogin } = await import('@/lib/owner-staff');
    const sid = await staffIdForLogin(db, tenantId, String(g.actor?.uid || '')).catch(() => null);
    if (!sid || !ID.test(sid)) return bad('This is for people on the team.', 403);
    const st: any = (await db.doc(`${T}/staff/${sid}`).get()).data() || {};
    const name = String(st.name || [st.firstName, st.lastName].filter(Boolean).join(' ') || g.actor?.name || 'Team member').replace(/\s+/g, ' ').trim().slice(0, 60);
    // What the till has of their tips in a month: the cash, and whether they took any at all.
    const recordedOf = async (month: string) => {
      const bnd = monthBounds(tenant, monthDays(month, today)); if (!bnd) return { cash: 0, took: false };
      const t = await computeTipShares(db, tenantId, tenant, bnd.start, bnd.end).catch(() => null);
      const me: any = (t?.rows || []).find((r: any) => r.staffId === sid);
      return { cash: Math.round(Number(me?.cashEarnedCents) || 0), took: Number(me?.earnedCents) > 0 };
    };
    const recordedCash = async (month: string) => (await recordedOf(month)).cash;
    if (action === 'mine') {
      // Last month first (it's the one due by the 10th), then this one.
      const months = [prevMonth(monthOfDay(today)), monthOfDay(today)];
      const out = await Promise.all(months.map(async (m) => {
        const d: any = (await db.doc(`${T}/tipDeclarations/${sid}_${m}`).get()).data() || null; const rec = await recordedOf(m);
        return { month: m, by: declareBy(m), recordedCashCents: rec.cash, took: rec.took, declared: d ? { cashCents: Number(d.cashCents) || 0, paidOutCents: Number(d.paidOutCents) || 0, signedName: String(d.signedName || ''), signedAt: String(d.signedAt || '') } : null };
      }));
      return ok({ name, months: out });
    }
    const month = cleanMonth(b.month); if (!month || !declarable(month, today)) return bad('That month can’t be declared here now. Ask a manager.');
    const cash = cleanDollars(b.cash); if (cash === null) return bad('Cash tips: an amount in dollars, like 212.50.');
    const paidOut = cleanDollars(b.paidOut); if (paidOut === null) return bad('Tips you paid out: an amount in dollars, or leave it empty.');
    const signedName = cleanSignature(b.signedName); if (!signedName) return bad('Type your full name to sign it.');
    const now = new Date().toISOString(); const ref = db.doc(`${T}/tipDeclarations/${sid}_${month}`);
    const recorded = await recordedCash(month);
    const was: number | null = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || null;
      const earlier = cur ? [...(Array.isArray(cur.earlier) ? cur.earlier : []), { cashCents: cur.cashCents, paidOutCents: cur.paidOutCents, signedName: cur.signedName, signedAt: cur.signedAt }].slice(-5) : [];
      tx.set(ref, { staffId: sid, name, month, cashCents: cash, paidOutCents: paidOut, recordedCashCents: recorded, signedName, signedAt: now, byUid: String(g.actor?.uid || ''), earlier });
      return cur ? Number(cur.cashCents) || 0 : null;
    });
    await logAuditAdmin(db, tenantId, { action: 'records.tips_declared', targetType: 'staff', targetId: sid, summary: `${name} declared $${(cash / 100).toFixed(2)} in cash tips for ${monthWords(month)}${was !== null ? ` (changed from $${(was / 100).toFixed(2)})` : ''}.`, actor: { type: 'user', id: String(g.actor?.uid || ''), name } } as any).catch(() => {});
    return ok({ month, cashCents: cash, paidOutCents: paidOut, signedAt: now });
  }

  const month = cleanMonth(b.month) || monthOfDay(today);
  if (month > monthOfDay(today)) return bad('That month hasn’t started yet.');

  if (action === 'keepStock') {
    // Today's shelf, for this month or (until the 10th) last month: any later, it's too far from what it was then.
    if (!keepable(month, today)) return bad(`It’s too late to keep ${monthWords(month)}’s value from today’s shelf: it’s changed too much since. Your accountant can work from the count nearest the month’s end.`, 409);
    const r = await keepStockValue(db, tenantId, month, by);
    await logAuditAdmin(db, tenantId, { action: 'records.stock_value', targetType: 'tenant', targetId: tenantId, summary: `${by} kept $${r.total.toFixed(2)} on the shelf as ${month}’s stock value.`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: by } } as any).catch(() => {});
    return ok({ total: r.total });
  }

  if (action === 'csv') {
    const kind = String(b.kind || '');
    const name = (k: string) => `${String(tenant.name || 'records').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'records'}-${k}-${month}.csv`;
    if (kind === 'stock') {
      // As kept for the month (and as of when), else what's on the shelf now.
      const kept: any = (await db.doc(`${T}/stockValues/${month}`).get()).data() || null;
      const lines = kept?.lines || stockNow((await db.collection(`${T}/inventory`).limit(5000).get()).docs.map((d: any) => [d.id, d.data() || {}])).lines;
      const asOf = kept?.at ? String(kept.at).slice(0, 10) : `${today} (now)`;
      const rows: unknown[][] = lines.map((l: any) => [asOf, l.name, l.left, l.unit, l.unitCost, l.value, l.typical ? 'Yes' : '']);
      if (kept && Number(kept.count) > lines.length) rows.push([asOf, `The ${STOCK_LINES_KEPT} most valuable items are listed; the total, ${kept.total}, counts all ${kept.count}.`, '', '', '', '', '']);
      return ok({ name: name('stock-value'), csv: toCsv(['As of', 'Item', 'On hand', 'Measured in', 'Cost of one', 'Value', 'At a typical price'], rows) });
    }
    const days = monthDays(month, today); const bnd = monthBounds(tenant, days);
    if (kind === 'nights') { const nights = await monthNights(db, tenantId, tenant, month); return ok({ name: name('nightly-closes'), csv: toCsv(['Day', 'Closed', 'Closed by', 'Sales', 'Sales tax', 'Tips', 'Taken', 'Refunds', 'Comps', 'Voids', 'Drawers over or short'],
      nights.map((n) => [n.day, n.closed ? 'Yes' : 'No', n.closedBy || '', n.sales, n.tax, n.tips, n.taken, n.refunds, n.comps, n.voids, n.overShort ?? ''])) }); }
    if (kind === 'tips') { const t = bnd ? await monthTips(db, tenantId, tenant, month, bnd.start, bnd.end) : { people: [] as any[] }; return ok({ name: name('tips'), csv: toCsv(['Person', 'Tips on cards', 'Cash tips recorded', 'Cash tips declared', 'Tips paid out', 'Share after sharing', 'Declared on'],
      t.people.map((p: any) => [p.name, $(p.chargedCents), $(p.cashCents), p.declared ? $(p.declared.cashCents) : '', p.declared ? $(p.declared.paidOutCents) : '', $(p.shareCents), p.declared ? `${p.declared.signedAt.slice(0, 10)}${p.declared.changed ? ' (changed)' : ''}` : 'Not yet'])) }); }
    if (kind === 'declared') {
      const snap = await db.collection(`${T}/tipDeclarations`).where('month', '==', month).limit(500).get();
      return ok({ name: name('cash-tips-declared'), csv: toCsv(['Person', 'Month', 'Cash tips received', 'Tips paid out', 'Recorded by the till', 'Signed as', 'Signed on'],
        snap.docs.map((d: any) => d.data() || {}).map((x: any) => [x.name, x.month, $(Number(x.cashCents) || 0), $(Number(x.paidOutCents) || 0), $(Number(x.recordedCashCents) || 0), x.signedName, String(x.signedAt || '').slice(0, 10)])) });
    }
    if (kind === 'purchases') { const p = bnd ? await monthPurchases(db, tenantId, bnd.start, bnd.end) : { list: [] as any[] }; return ok({ name: name('orders-received'), csv: toCsv(['Received', 'Supplier', 'Order', 'Lines', 'Total', 'Invoice attached'],
      p.list.map((x: any) => [x.at.slice(0, 10), x.supplier, x.number, x.lines, x.total, x.invoice ? 'Yes' : 'No'])) }); }
    if (kind === 'adjustments') { const a = days.length ? await monthAdjustments(db, tenantId, days[0], days[days.length - 1]) : []; return ok({ name: name('comps-and-voids'), csv: toCsv(['Person', 'Comps', 'Comps given', 'Voids', 'Voided', 'Remakes'],
      a.map((x) => [x.name, x.compCount, x.comps, x.voidCount, x.voids, x.remakes])) }); }
    return bad('Which record?');
  }

  // MONTH
  const r = await monthRecords(db, tenantId, tenant, month);
  return ok({ ...r, business: String(tenant.name || ''), hospitality: tenant?.modules?.hospitality !== false });
}
