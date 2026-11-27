// /api/payroll/taxes — Money › Payday › Payroll taxes (lib/payroll-owed): mark a payroll tax payment as paid ("I paid
// it"), or take the mark back. Kept as payrollRuns/taxpay_{key} (kind 'taxpayment'), which only payroll reads and only
// the server writes; the bank sync marks one paid on its own when the payment comes through for the amount owed.
// Nothing is booked here: the payment itself comes from the bank, sorted as Payroll Tax Deposit.
// Each payment toward one is a part of it: `add` puts another (the rest, after a payday recorded later added to it).
// POST { tenantId, key, amount, paidOn, add? } → { ok } · DELETE { tenantId, key } → { ok }
// For the owner and anyone whose role runs payroll.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';

const KEY = /^(irs|state|sui|futa|other)_[A-Za-z0-9_-]{1,40}$/;
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function body(req: NextRequest) { try { return await req.json(); } catch { return null; } }

export async function POST(req: NextRequest) {
  const b: any = await body(req); const tenantId = String(b?.tenantId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  const key = String(b?.key || ''); const amount = Math.round((Number(b?.amount) || 0) * 100) / 100; const paidOn = String(b?.paidOn || '');
  if (!KEY.test(key)) return NextResponse.json({ ok: false, error: 'That payment isn’t one of your payroll taxes.' }, { status: 400 });
  if (!(amount > 0) || amount > 1e7) return NextResponse.json({ ok: false, error: 'Put in what you paid.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Date.parse(`${paidOn}T00:00:00Z`) > Date.now() + 2 * 86400000) return NextResponse.json({ ok: false, error: 'Pick the day you paid it.' }, { status: 400 });
  const db = getAdminDb(); const nowIso = new Date().toISOString(); const ref = db.doc(`tenants/${tenantId}/payrollRuns/taxpay_${key}`);
  const by = { id: g.actor?.uid || g.actor?.id || null, name: g.actor?.name || null };
  const part = { amount, paidOn, source: 'hand', bankTransactionId: null, recordedAt: nowIso, by };
  await db.runTransaction(async (tx) => {
    const was: any = b?.add === true ? (await tx.get(ref)).data() : null;
    if (!was) { tx.set(ref, { kind: 'taxpayment', key, amount, paidOn, recordedAt: nowIso, source: 'hand', bankTransactionId: null, parts: [part], by }); return; }
    const parts = Array.isArray(was.parts) ? was.parts : [{ amount: Number(was.amount) || 0, paidOn: String(was.paidOn || ''), source: String(was.source || 'hand'), bankTransactionId: was.bankTransactionId || null }];
    const all = [...parts, part]; const total = Math.round(all.reduce((n: number, x: any) => n + (Number(x.amount) || 0), 0) * 100) / 100;
    tx.set(ref, { ...was, amount: total, paidOn: all.map((x: any) => String(x.paidOn)).sort().pop(), recordedAt: nowIso, parts: all });
  });
  await logAuditAdmin(db, tenantId, { action: 'payroll.tax_paid', targetType: 'payroll', targetId: `taxpay_${key}`, summary: `Marked a payroll tax payment paid: ${usd(amount)} on ${paidOn} (${key})`,
    amount, actor: { type: 'user', id: g.actor?.uid || g.actor?.id, name: g.actor?.name || 'Team member', via: 'payday-tab' } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const b: any = await body(req); const tenantId = String(b?.tenantId || '');
  const g = await requireCan(req, tenantId, 'money.payroll'); if (g.deny) return g.deny;
  const key = String(b?.key || ''); if (!KEY.test(key)) return NextResponse.json({ ok: false, error: 'That payment isn’t one of your payroll taxes.' }, { status: 400 });
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/payrollRuns/taxpay_${key}`); const was: any = (await ref.get()).data();
  if (!was) return NextResponse.json({ ok: true });
  await ref.delete();
  await logAuditAdmin(db, tenantId, { action: 'payroll.tax_unpaid', targetType: 'payroll', targetId: `taxpay_${key}`, summary: `Took back a payroll tax payment: ${usd(Number(was.amount) || 0)} on ${was.paidOn} (${key})`,
    amount: Number(was.amount) || 0, actor: { type: 'user', id: g.actor?.uid || g.actor?.id, name: g.actor?.name || 'Team member', via: 'payday-tab' } });
  return NextResponse.json({ ok: true });
}
