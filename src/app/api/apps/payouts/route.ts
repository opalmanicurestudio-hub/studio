// src/app/api/apps/payouts/route.ts — DELIVERY APP PAYOUTS for the Money page (managers; lib/app-payouts-server).
//   list   { tenantId }                     → the last few weeks from each app: orders, what should come in, what did
//   paid   { tenantId, app, week, cents }   → what the app paid for that week
//   adjust { tenantId, app, week }          → a payout that doesn't match: its difference booked once
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { payoutAdjust, payoutPaid, payoutWeeks } from '@/lib/app-payouts-server';
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
    const action = String(b.action || 'list');
    if (action === 'list') return reply({ ok: true, ...(await payoutWeeks(db, tenantId, tenant)) });
    if (action === 'paid') {
      const r: any = await payoutPaid(db, tenantId, tenant, b.app, b.week, b.cents, by);
      if (r.ok) await logAuditAdmin(db, tenantId, { action: 'apps.payout_paid', targetType: 'tenant', targetId: tenantId, summary: `${by} entered ${r.week.label}’s payout for the week of ${r.week.week}: $${(r.week.paidCents / 100).toFixed(2)}.`, actor: { type: 'user', id: String(auth.actor.uid || 'manager'), name: by } } as any).catch(() => {});
      return reply(r, r.ok ? 200 : r.status);
    }
    if (action === 'adjust') {
      const r: any = await payoutAdjust(db, tenantId, tenant, b.app, b.week, by);
      if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'apps.payout_adjusted', targetType: 'tenant', targetId: tenantId, summary: `${by} booked a $${(Math.abs(r.cents) / 100).toFixed(2)} app adjustment for ${r.week.label}, week of ${r.week.week}.`, actor: { type: 'user', id: String(auth.actor.uid || 'manager'), name: by } } as any).catch(() => {});
      return reply(r, r.ok ? 200 : r.status);
    }
    return reply({ ok: false, error: 'Something went wrong.' }, 400);
  } catch (e: any) {
    console.error('[apps/payouts]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
