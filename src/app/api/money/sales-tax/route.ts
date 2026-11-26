// src/app/api/money/sales-tax/route.ts — THE SALES TAX REPORT (managers; lib/sales-tax-server).
//   view     { tenantId, period? }          → a period's report (the last one that ended, without one), and whether it's paid
//   remind   { tenantId }                   → the reminder for the one due next, while it shows
//   paid     { tenantId, period, cents }    → paid to the state: recorded once, its payment in the books
//   unpaid   { tenantId, period }           → recorded by mistake: taken back
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { markTaxPaid, salesTaxView, taxReminder, unmarkTaxPaid } from '@/lib/sales-tax-server';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const auth: any = await verifyStaffActor(req, tenantId);
    if (!auth?.ok || !(auth.actor.isManager || auth.actor.isTenantOwner)) return reply({ ok: false, error: 'Managers only.' }, 403);
    const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const by = String(auth.actor.name || 'A manager').slice(0, 60);
    const actor = { type: 'user', id: String(auth.actor.uid || 'manager'), name: by } as any;
    const action = String(b.action || 'view');
    if (action === 'view') { const r: any = await salesTaxView(db, tenantId, tenant, b.period); return reply(r, r.ok ? 200 : r.status); }
    if (action === 'remind') return reply({ ok: true, reminder: await taxReminder(db, tenantId, tenant).catch(() => null) });
    if (action === 'paid') {
      const r: any = await markTaxPaid(db, tenantId, tenant, b.period, b.cents, by);
      if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'salestax.paid', targetType: 'tenant', targetId: tenantId, summary: `${by} recorded $${(r.paid.cents / 100).toFixed(2)} of sales tax for ${b.period} as paid to the state.`, amount: r.paid.cents / 100, actor } as any).catch(() => {});
      return reply(r, r.ok ? 200 : r.status);
    }
    if (action === 'unpaid') {
      const r: any = await unmarkTaxPaid(db, tenantId, b.period);
      if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'salestax.unpaid', targetType: 'tenant', targetId: tenantId, summary: `${by} took back the sales tax payment recorded for ${b.period}.`, actor } as any).catch(() => {});
      return reply(r, r.ok ? 200 : r.status);
    }
    return reply({ ok: false, error: 'Something went wrong.' }, 400);
  } catch (e: any) {
    console.error('[money/sales-tax]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
