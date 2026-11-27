// src/lib/payroll-tax-marks.ts — A PAYROLL TAX MARKED PAID FROM THE BANK, TAKEN BACK WHEN ITS BANK LINE ISN'T ONE (server
// only). The bank sync marks a payroll tax paid when a payment for what it owes comes through (lib/plaid-sync), and keeps
// which one on the bank line (`taxPayKey`). When that line is sorted as something else after all (ignored, matched to
// other lines, booked or changed to another category), the bank's part of the mark goes: the payment it was is still to
// pay. A payment marked by hand stays. (lib/payroll-owed reads the marks.)
import { logAuditAdmin } from './audit';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Take the bank line's payment off the payroll tax it marked paid. True when a mark changed. */
export async function dropBankTaxMark(db: any, tenantId: string, bankTxnId: string, key: string | null | undefined, actor?: any): Promise<boolean> {
  if (!key || !/^(irs|state|sui|futa|other)_[A-Za-z0-9_-]{1,40}$/.test(String(key))) return false;
  const ref = db.doc(`tenants/${tenantId}/payrollRuns/taxpay_${key}`);
  const was = await db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(ref)).data(); if (!d) return null;
    const parts: any[] = Array.isArray(d.parts) ? d.parts : [{ amount: Number(d.amount) || 0, paidOn: String(d.paidOn || ''), source: String(d.source || 'hand'), bankTransactionId: d.bankTransactionId || null }];
    const left = parts.filter((x) => String(x.bankTransactionId || '') !== bankTxnId);
    if (left.length === parts.length) return null;
    if (!left.length) { tx.delete(ref); return d; }
    const bank = left.filter((x) => x.bankTransactionId).pop();
    // (`covers` came with a bank payment: what's left is what was paid, cent for cent.)
    tx.set(ref, { kind: 'taxpayment', key, amount: r2(left.reduce((n, x) => n + (Number(x.amount) || 0), 0)), paidOn: left.map((x) => String(x.paidOn)).sort().pop(), recordedAt: new Date().toISOString(),
      source: bank ? 'mixed' : 'hand', bankTransactionId: bank?.bankTransactionId || null, parts: left, ...(d.by ? { by: d.by } : {}) });
    return d;
  });
  if (!was) return false;
  await db.doc(`tenants/${tenantId}/bankTransactions/${bankTxnId}`).set({ taxPayKey: null }, { merge: true }).catch(() => {});
  await logAuditAdmin(db, tenantId, { action: 'payroll.tax_unpaid', targetType: 'payroll', targetId: `taxpay_${key}`,
    summary: `A bank payment was sorted as something other than payroll taxes, so it no longer counts as paying them (${key})`,
    actor: actor || { type: 'system', id: 'bank', name: 'Bank sorting', via: 'bank' } }).catch(() => {});
  return true;
}
