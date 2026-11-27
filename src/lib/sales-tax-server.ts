// src/lib/sales-tax-server.ts — THE SALES TAX REPORT AND ITS PAYMENT (server; lib/sales-tax-filing is when, lib/sales-
// tax-report is the figures). Read by api/money/sales-tax (Settings → Payments → Sales tax, and the Money page), the
// morning brief (api/cron/reminders) and the Money page's reminder.
//   tenants/{t}/private/salesTaxPaid_{period} = { period, cents, at, by, lineId }   (the server's only)
//   tenants/{t}/transactions/salestax_{period}  — the payment, as Sales Tax Paid (it settles what's owed; never an expense)
import { bizLocationsOf } from './here-server';
import { salesTaxReport, type TaxReport } from './sales-tax-report';
import { filingOf, lastEnded, periodOf, remindNow, reminderText, type TaxPeriod } from './sales-tax-filing';
import { posTaxOf } from './pos-tax';
import { todayIn, tenantTimeZone } from './tenant-time';

type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const KEY = /^\d{4}(-\d{2}|-Q[1-4])?$/;
const paidRef = (db: any, tenantId: string, key: string) => db.doc(`tenants/${tenantId}/private/salesTaxPaid_${key}`);
const lineId = (key: string) => `salestax_${key}`;

/** The period's report: its lines (and those a few months before, so a refund finds the sale it's for). */
export async function taxReportFor(db: any, tenantId: string, tenant: any, p: TaxPeriod): Promise<TaxReport> {
  // (A day either side: the report keeps the business's own days, in its time zone.)
  const before = new Date(Date.parse(`${p.start}T00:00:00Z`) - 120 * 86400000).toISOString().slice(0, 10);
  const after = new Date(Date.parse(`${p.end}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
  const snap = await db.collection(`tenants/${tenantId}/transactions`).where('date', '>=', before).where('date', '<', after).get();
  const all = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const places = (await bizLocationsOf(db, tenantId)).map((l) => ({ id: l.id, name: l.name, address: l.address }));
  return salesTaxReport(all, tenant, places, p, { lookup: all });
}

export type TaxPaid = { at: string; cents: number; by: string } | null;
async function paidOf(db: any, tenantId: string, key: string): Promise<TaxPaid> {
  const x: any = (await paidRef(db, tenantId, key).get()).data();
  return x?.at ? { at: String(x.at), cents: Math.round(Number(x.cents) || 0), by: String(x.by || '') } : null;
}

/** A period's report, whether it's paid, and the reminder for the one due next. `key`: a period, else the last one
 *  that ended. */
export async function salesTaxView(db: any, tenantId: string, tenant: any, key?: unknown, now = Date.now()) {
  const f = filingOf(tenant); const today = todayIn(tenantTimeZone(tenant), new Date(now));
  const p = typeof key === 'string' && KEY.test(key) ? periodOf(key, f.dueDay) : lastEnded(today, f);
  if (!p) return fail('Which period?', 400);
  const [report, paid] = await Promise.all([taxReportFor(db, tenantId, tenant, p), paidOf(db, tenantId, p.key)]);
  return { ok: true as const, filing: f, unset: posTaxOf(tenant).unset, today, report, paid };
}

/** The reminder for the period due next, while it shows (from a week before it's due until it's paid). */
export async function taxReminder(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<{ text: string; period: string; cents: number; due: string } | null> {
  if (posTaxOf(tenant).unset) return null;
  const f = filingOf(tenant); if (!f.remind) return null;
  const today = todayIn(tenantTimeZone(tenant), new Date(now)); const p = lastEnded(today, f);
  if (!remindNow(today, p, f, false)) return null;
  if (await paidOf(db, tenantId, p.key)) return null;
  // (Nothing to pay: still a return to file, when the business charges sales tax at all.)
  const cur = posTaxOf(tenant); const charges = cur.productsPct > 0 || cur.servicesPct > 0 || Object.keys(tenant?.salesTax?.byLocation || {}).length > 0;
  const r = await taxReportFor(db, tenantId, tenant, p);
  const cents = Math.max(0, Math.round(r.toPay * 100)); if (cents <= 0 && !charges) return null;
  return { text: reminderText(today, p, cents), period: p.key, cents, due: p.due };
}

/** For the Money page, cheaply: the reminder (while it shows) and what the last period that ended still owes (when it
 *  isn't recorded as paid). Nothing is added up when tax isn't set up or the period is paid; otherwise the figure is
 *  kept for a few hours (tenants/{t}/private/salesTaxOwed_{period}), so opening the page doesn't read months of books. */
export async function taxStatus(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<{ reminder: { text: string; period: string; cents: number; due: string } | null; owed: { period: string; label: string; due: string; cents: number } | null;
  unset?: boolean; last?: { period: string; label: string; due: string; paid: boolean } }> {
  if (posTaxOf(tenant).unset) return { reminder: null, owed: null, unset: true };
  const f = filingOf(tenant); const today = todayIn(tenantTimeZone(tenant), new Date(now)); const p = lastEnded(today, f);
  // (The last period that ended, and whether it's paid: the Reports tab's sales tax row.)
  const last = { period: p.key, label: p.label, due: p.dueLabel, paid: false };
  if (await paidOf(db, tenantId, p.key)) return { reminder: null, owed: null, last: { ...last, paid: true } };
  const cacheRef = db.doc(`tenants/${tenantId}/private/salesTaxOwed_${p.key}`);
  const kept: any = (await cacheRef.get().catch(() => null))?.data();
  let cents: number;
  if (kept && Number.isFinite(Number(kept.cents)) && now - Date.parse(String(kept.at || 0)) < 6 * 3600000) cents = Math.round(Number(kept.cents));
  else {
    const r = await taxReportFor(db, tenantId, tenant, p); cents = Math.max(0, Math.round(r.toPay * 100));
    await cacheRef.set({ period: p.key, cents, at: new Date(now).toISOString() }).catch(() => {});
  }
  const cur = posTaxOf(tenant); const charges = cur.productsPct > 0 || cur.servicesPct > 0 || Object.keys(tenant?.salesTax?.byLocation || {}).length > 0;
  const reminder = remindNow(today, p, f, false) && (cents > 0 || charges) ? { text: reminderText(today, p, cents), period: p.key, cents, due: p.due } : null;
  return { reminder, owed: cents > 0 ? { period: p.key, label: p.label, due: p.dueLabel, cents } : null, last };
}

/** Paid to the state: recorded once (its payment in the books as Sales Tax Paid). `cents`: what was paid. */
export async function markTaxPaid(db: any, tenantId: string, tenant: any, key: unknown, cents: unknown, by: string, now = Date.now()) {
  const f = filingOf(tenant); const p = typeof key === 'string' && KEY.test(key) ? periodOf(key, f.dueDay) : null;
  if (!p) return fail('Which period?', 400);
  // (0: filed with nothing to pay; recorded, with no payment in the books.)
  const c = Math.round(Number(cents));
  if (!Number.isFinite(c) || c < 0 || c > 100_000_000) return fail('How much did you pay?', 400);
  const today = todayIn(tenantTimeZone(tenant), new Date(now));
  if (today <= p.end) return fail(`${p.label} isn’t over yet.`, 409);
  const nowIso = new Date(now).toISOString(); const lineRef = db.doc(`tenants/${tenantId}/transactions/${lineId(p.key)}`);
  return db.runTransaction(async (tx: any) => {
    const r = paidRef(db, tenantId, p.key);
    const was: any = (await tx.get(r)).data();
    if (was?.at) return { ok: true as const, already: true, paid: { at: String(was.at), cents: Math.round(Number(was.cents) || 0), by: String(was.by || '') } };
    if (c > 0) tx.set(lineRef, { id: lineRef.id, tenantId, type: 'expense', context: 'Business', category: 'Sales Tax Paid', taxBucket: 'tax_remitted', amount: c / 100,
      description: `Sales tax for ${p.label}, paid to the state`, clientOrVendor: 'The state', paymentMethod: 'Bank transfer', date: nowIso, createdAt: nowIso, hasReceipt: false, salesTaxPeriod: p.key, enteredBy: by });
    tx.set(r, { period: p.key, cents: c, at: nowIso, by, ...(c > 0 ? { lineId: lineRef.id } : {}) });
    return { ok: true as const, paid: { at: nowIso, cents: c, by } };
  });
}

/** Recorded as paid by mistake: taken back, while its payment isn't matched to the bank yet. */
export async function unmarkTaxPaid(db: any, tenantId: string, key: unknown) {
  if (typeof key !== 'string' || !KEY.test(key)) return fail('Which period?', 400);
  const lineRef = db.doc(`tenants/${tenantId}/transactions/${lineId(key)}`);
  return db.runTransaction(async (tx: any) => {
    const r = paidRef(db, tenantId, key); const was: any = (await tx.get(r)).data();
    if (!was?.at) return { ok: true as const, already: true };
    const line: any = (await tx.get(lineRef)).data();
    if (line?.reconciled || line?.bankTransactionId) return fail('Its payment is matched to your bank already. Change it on the Money page.', 409);
    tx.delete(r); if (line) tx.delete(lineRef);
    return { ok: true as const };
  });
}
