// /api/retail/delivery-photo — THE PHOTO OF A DELIVERY, taken at the door by the driver (lib/delivery-run). POST
// { tenantId, orderId, dataUrl } stores it under the order (tenants/{t}/delivery-photos/{order}/…) and answers its
// address (a link with its own access key, like the packing photos), which the driver then sends with "Delivered"
// (api/retail/fulfil deliveryDone checks it's this order's). The customer sees it on their order page.
// Only while the order is out for delivery, by its driver or a manager; the shop's team only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in to add a photo.', auth.status || 401);
  const a: any = auth.actor;
  if (a.isRenter) return bad('Deliveries are made by the shop’s team.', 403);
  const o: any = (await getAdminDb().doc(`tenants/${tenantId}/retailOrders/${orderId}`).get()).data();
  if (!o) return bad('That order wasn’t found.', 404);
  if (o.method !== 'delivery' || o.delivery?.status !== 'out') return bad('This order isn’t out for delivery.', 409);
  const boss = a.isTenantOwner === true || a.isManager === true;
  if (!boss && String(o.delivery?.driverId || '') !== String(a.uid || a.id || '')) return bad(`This delivery is with ${String(o.delivery?.driverName || 'another driver').split(' ')[0]}.`, 403);
  const up = await uploadClaimPhotoFromDataUrl(tenantId, orderId, b.dataUrl, 'delivery-photos');
  if (!up.url) return bad(up.error || 'The photo didn’t save. Try again.', 422);
  // Kept on the order (only the server writes it), so "Delivered" accepts only a photo this route stored for it.
  const ref = getAdminDb().doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  await getAdminDb().runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const list = Array.isArray(cur.delivery?.photos) ? cur.delivery.photos.filter((u: any) => typeof u === 'string') : [];
    tx.update(ref, { 'delivery.photos': [...list, up.url].slice(-6) });
  });
  return NextResponse.json({ ok: true, url: up.url });
}
