// /api/retail/delivery-route — A DRIVER'S STOPS IN THE BEST ORDER (lib/route-server; design board "Routes in the best
// order"). The staff app asks when the driver sets out and again whenever their stops change (a stop added, taken or
// brought back): { tenantId, again? } → the plan, kept on each stop, so their list and the customers' pages follow it.
// The business's own drivers only (its listed drivers, anyone on the team when it lists none, or a manager); never a
// renter or a shared tablet, and only for the person signed in.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { deliveryFrom } from '@/lib/delivery-plan';
import { routeFor } from '@/lib/route-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return reply({ ok: false, error: 'Missing details.' }, 400);
    const auth: any = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return reply({ ok: false, error: auth.error || 'Sign in again.' }, auth.status || 401);
    const a: any = auth.actor;
    if (a.isRenter || a.screen) return reply({ ok: false, error: 'Deliveries are made by the business’s own drivers.' }, 403);
    const staffId = String(a.uid || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(staffId)) return reply({ ok: false, error: 'Sign in again.' }, 401);
    const plan = deliveryFrom(auth.tenant?.retailSettings);
    if (!plan.on) return reply({ ok: false, error: 'Delivery isn’t on here.' }, 409);
    if (!(a.isManager || !plan.drivers.length || plan.drivers.includes(staffId))) return reply({ ok: false, error: 'You aren’t one of the drivers here.' }, 403);
    const view = await routeFor(getAdminDb(), tenantId, auth.tenant || {}, staffId, { again: b.again === true });
    return reply(view || { ok: true, id: null, stops: [] });
  } catch (e: any) {
    console.error('[delivery-route]', e?.message);
    return reply({ ok: false, error: 'The route couldn’t be planned just now. Your stops are in time order.' }, 500);
  }
}
