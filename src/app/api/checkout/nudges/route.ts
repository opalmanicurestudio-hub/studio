// src/app/api/checkout/nudges/route.ts — "WORTH MENTIONING" AT CHECKOUT. Staff only.
//   suggest { clientId } — the most valuable honest suggestion(s) for this client (lib/checkout-nudges)
//   decline { clientId, key } — "not now": quiet for this client for the business's chosen days
//   accepted { clientId, key } — they took it (added to the sale / booked): recorded, and quiet too
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { nudgesFor, nudgeSettingsOf } from '@/lib/checkout-nudges';

export const dynamic = 'force-dynamic';
const LIVE = ['confirmed', 'pending_payment', 'requested', 'checked_in', 'servicing'];

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || ''), action = String(b.action || 'suggest');
  if (!tenantId || !clientId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const cRef = db.doc(`${T}/clients/${clientId}`); const client: any = (await cRef.get()).data();
  if (!client) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });

  if (action === 'decline' || action === 'accepted') {
    const key = String(b.key || '').slice(0, 80); if (!key) return NextResponse.json({ ok: false, error: 'Missing suggestion.' }, { status: 400 });
    await cRef.set({ nudgeDeclines: { ...(client.nudgeDeclines || {}), [key]: new Date().toISOString() } }, { merge: true });
    if (action === 'accepted') await logAuditAdmin(db, tenantId, { action: 'checkout.nudge_accepted', targetType: 'client', targetId: clientId, summary: `${client.name || 'Client'} took a checkout suggestion (${key})`, actor: { type: 'user', id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role } } as any).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const settings = nudgeSettingsOf(tenant);
  if (!settings.membership && !settings.package && !settings.rebook) return NextResponse.json({ ok: true, nudges: [] });
  const [apSnap, svSnap, mSnap, pSnap] = await Promise.all([
    db.collection(`${T}/appointments`).where('clientId', '==', clientId).get(),
    db.collection(`${T}/services`).get(), db.collection(`${T}/memberships`).get(), db.collection(`${T}/packages`).get(),
  ]);
  const services = svSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const appts = apSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  const now = Date.now();
  const visits = appts.filter((a: any) => ['completed', 'checked_out', 'paid'].includes(String(a.status)) || (LIVE.includes(String(a.status)) && Date.parse(a.startTime) <= now))
    .map((a: any) => ({ serviceId: String(a.serviceId || ''), startTime: String(a.startTime), price: Number(a.price) || Number(services.find((s: any) => s.id === a.serviceId)?.price) || 0 }))
    .filter((v: any) => v.serviceId && Number.isFinite(Date.parse(v.startTime)));
  const upcoming = appts.filter((a: any) => LIVE.includes(String(a.status)) && Date.parse(a.startTime) > now + 2 * 3600000).length;   // today's visit doesn't count
  const nudges = nudgesFor({ client, visits, upcoming, services, settings, now,
    memberships: mSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })), packages: pSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) });
  return NextResponse.json({ ok: true, nudges });
}
