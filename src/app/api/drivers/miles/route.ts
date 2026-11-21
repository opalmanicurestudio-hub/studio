// src/app/api/drivers/miles/route.ts — MILES DRIVEN (lib/mileage, lib/mileage-server; design board "Sold out on the apps
// too, and every driver's miles kept").
//   today    { tenantId }                        → the driver's own day: odometer readings and hot food trips
//   odometer { tenantId, which: 'start'|'end', value } → their reading for the start or the end of the day
//   month    { tenantId, month: 'YYYY-MM' }      → managers: every driver's days that month, and the rate a mile
//   rate     { tenantId, cents | null }          → managers: the rate a mile they pay back (none: miles only)
// The business's drivers (or anyone on the team when it keeps no list); never a renter or a shared tablet.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { deliveryFrom } from '@/lib/delivery-plan';
import { businessMonths, milesMonth, milesToday, odometer } from '@/lib/mileage-server';
import { rateOf } from '@/lib/mileage';
import { logAuditAdmin } from '@/lib/audit';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || ''); const action = String(b.action || 'today');
    if (!ID.test(tenantId) || !['today', 'odometer', 'month', 'rate'].includes(action)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const auth: any = await verifyStaffActor(req, tenantId);
    if (!auth?.ok) return reply({ ok: false, error: auth?.error || 'Sign in again.' }, auth?.status || 401);
    const a = auth.actor; const db = getAdminDb(); const tenant: any = auth.tenant || (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const boss = a.isManager || a.isTenantOwner;
    if (action === 'month' || action === 'rate') {
      if (!boss) return reply({ ok: false, error: 'Managers only.' }, 403);
      if (action === 'rate') {
        const c = b.cents === null || b.cents === '' ? null : Math.round(Number(b.cents));
        if (c !== null && (!Number.isFinite(c) || c < 1 || c > 500)) return reply({ ok: false, error: 'A rate a mile from $0.01 to $5.00, or empty.' }, 400);
        await db.doc(`tenants/${tenantId}`).set({ mileage: { rateCents: c, rateBy: String(a.name || '').slice(0, 60), rateAt: new Date().toISOString() } }, { merge: true });
        await logAuditAdmin(db, tenantId, { action: 'mileage.rate', targetType: 'tenant', targetId: tenantId, summary: c ? `${a.name} set the mileage rate to $${(c / 100).toFixed(2)} a mile.` : `${a.name} cleared the mileage rate.`, actor: { type: 'user', id: String(a.uid || 'manager'), name: String(a.name || '') } } as any).catch(() => {});
        return reply({ ok: true, rateCents: c });
      }
      // This month and last by the business's own day (so the last evening of a month is still that month).
      const months = businessMonths(tenant);
      const month = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? String(b.month) : months[0];
      return reply({ ok: true, month, months, rateCents: rateOf(tenant), days: await milesMonth(db, tenantId, month) });
    }
    if (a.isRenter || a.screen) return reply({ ok: false, error: 'This is for the business’s own drivers.' }, 403);
    const plan = deliveryFrom(tenant.retailSettings);
    if (!(boss || !plan.drivers.length || plan.drivers.includes(a.uid))) return reply({ ok: false, error: 'You aren’t one of the drivers here.' }, 403);
    if (action === 'today') return reply({ ok: true, day: await milesToday(db, tenantId, tenant, String(a.uid)) });
    const r: any = await odometer(db, tenantId, tenant, { id: String(a.uid), name: String(a.name || '') }, b.which, b.value);
    return reply(r, r.ok ? 200 : r.status);
  } catch (e: any) {
    console.error('[drivers/miles]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
