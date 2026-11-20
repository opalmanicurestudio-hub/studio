// src/app/api/curbside/route.ts — THE CURBSIDE SCREEN's café half (lib/curbside-server; the screen is
// components/orders/CurbsideScreen). Signed in: the app, or the team app with a PIN. The shop's curbside orders the
// screen reads and moves itself, through the shop's own steps (lib/orders-flow).
//   list    { tenantId }          → café orders placed ahead for curbside, not handed over yet
//   out     { tenantId, orderId } → someone's taking it out (ready, and they're here): their page says so
//   handed  { tenantId, orderId } → handed over: done
// Renters, who run their own business here, don't see or move the business's orders.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { cafeCurbside, cafeHanded, cafeOut } from '@/lib/curbside-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
  if (!ID.test(tenantId)) return fail('Which business?');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (auth.actor.isRenter) return fail('Renters don’t take the business’s orders out.', 403);
  const db = getAdminDb();
  if (action === 'list') return NextResponse.json({ ok: true, cafe: await cafeCurbside(db, tenantId, auth.tenant), on: auth.tenant?.orderAhead?.curbside === true });
  const orderId = String(b.orderId || ''); if (!ID.test(orderId)) return fail('Which order?');
  if (action === 'out' || action === 'handed') {
    const r = action === 'out' ? await cafeOut(db, tenantId, orderId, auth.actor) : await cafeHanded(db, tenantId, orderId, auth.actor);
    return r.ok ? NextResponse.json(r) : fail(r.error, r.status);
  }
  return fail('Unknown action.');
}
