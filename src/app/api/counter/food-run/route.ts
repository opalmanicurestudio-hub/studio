// src/app/api/counter/food-run/route.ts — HOT FOOD ON THE DRIVER'S PHONE (the staff app's Deliveries tab; design board
// "Hot food on the driver's phone"; lib/food-delivery-server). Team only, and only those who can deliver for the business
// (its drivers, or anyone on the team when it keeps no list of drivers); never a renter or a shared tablet.
// POST { tenantId, action, orderId?, why? }:
//   list     → { ok, on, rows }: their own hot food out with them, then what's ready to take, then what's being made
//   take     the food goes out with them (the guest is texted it's on its way)
//   outside  one text to the guest from the business's number: their driver is outside ({ sent, why: 'soon' | 'no_phone' |
//            'failed' } when it didn't go)
//   done     delivered (their tip is booked as theirs) { left?, dataUrl?, tappedAt? }: handed over or left at the door, with
//            the photo the business asks for (Delivery settings' proof, as for shop deliveries: on every delivery, or when
//            it's left); tapped with no signal, it's sent later with when it was tapped (lib/outbox)
//   failed   couldn't deliver, and why (back to the counter, where a manager refunds it or sends it again)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { foodDeliveryOf } from '@/lib/food-delivery';
import { deliveryFrom } from '@/lib/delivery-plan';
import { proofOf } from '@/lib/delivery-run';
import { tonight } from '@/lib/night-close-server';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
import { deliveryEnd, deliveryOut, deliveryOutside, foodRun } from '@/lib/food-delivery-server';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); const action = String(b.action || ''); const orderId = String(b.orderId || '');
    if (!ID.test(tenantId) || !['list', 'take', 'outside', 'done', 'failed'].includes(action)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    if (action !== 'list' && !ID.test(orderId)) return reply({ ok: false, error: 'Which order?' }, 400);
    const auth: any = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return reply({ ok: false, error: auth.error || 'Sign in again.' }, auth.status || 401);
    const a = auth.actor; const tenant = auth.tenant || {};
    if (a.isRenter || a.screen) return reply({ ok: false, error: 'This is for the business’s own drivers.' }, 403);
    const plan = deliveryFrom(tenant.retailSettings);
    const on = foodDeliveryOf(tenant).on && plan.on;
    if (!on) return action === 'list' ? reply({ ok: true, on: false, rows: [] }) : reply({ ok: false, error: 'Hot food delivery isn’t on here.' }, 409);
    // Drivers on the business's list, or anyone on the team when it keeps none (a manager can step in either way).
    if (!(a.isManager || !plan.drivers.length || plan.drivers.includes(a.uid))) return reply({ ok: false, error: 'You aren’t one of the drivers here. A manager can add you in Delivery settings.' }, 403);
    const db = getAdminDb();
    if (action === 'list') return reply({ ok: true, on: true, rows: await foodRun(db, tenantId, tenant, a.uid), photo: proofOf(plan).photo });
    const me = { id: String(a.uid), manager: !!a.isManager };
    if (action === 'done') {
      const left = b.left === true; const proof = proofOf(plan);
      const needPhoto = proof.photo === 'always' || (left && proof.photo === 'left');
      const cur: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data(); const cd = cur?.ahead?.delivery || {};
      // (Sent again from the phone after it went through: as it was, with no second photo.)
      if (cd.state === 'delivered') return reply({ ok: true, already: true });
      if (cd.state === 'out') {
        // Theirs (or a manager's), before any photo is kept; and the trip the tap was for (one sent out again since is a
        // trip of its own: an old tap kept on a phone doesn't finish it).
        if (!a.isManager && String(cd.driverId || '') !== String(a.uid)) return reply({ ok: false, error: 'That delivery is out with someone else.' }, 403);
        if (typeof b.outAt === 'string' && b.outAt && String(cd.outAt || '') !== b.outAt) return reply({ ok: false, error: 'It was sent out again since. Mark it delivered from the trip it’s on now.' }, 409);
      }
      let photo: string | null = null;
      if (typeof b.dataUrl === 'string' && b.dataUrl && cd.state === 'out') {
        const up = await uploadClaimPhotoFromDataUrl(tenantId, orderId, b.dataUrl, 'delivery-photos');
        // (Storage not answering is tried again from the phone; a photo it can't read is said so.)
        if (!up.url) return /couldn.t be saved/.test(String(up.error || '')) ? reply({ ok: false, error: 'The photo didn’t save yet. It’ll try again.' }, 503) : reply({ ok: false, error: up.error || 'That photo couldn’t be read. Take it again.' }, 422);
        photo = up.url;
      } else if (needPhoto && cd.state === 'out') return reply({ ok: false, code: 'photo', error: left ? 'Take a photo of where you left it.' : 'Take a photo of the delivery.' }, 400);
      // A tap kept with no signal counts from when it was tapped, on the same business night only (a night already
      // reported keeps its numbers).
      const tappedMs = Date.parse(String(b.tappedAt || ''));
      const tappedAt = Number.isFinite(tappedMs) && tonight(tenant, new Date(tappedMs)) === tonight(tenant, new Date()) ? b.tappedAt : null;
      const r: any = await deliveryEnd(db, tenantId, orderId, { done: true, left, photo }, a.name, me, undefined, { tappedAt });
      if (r.ok && !r.already) await logAuditAdmin(db, tenantId, { action: 'counter.delivery_done', targetType: 'order', targetId: orderId, summary: `${a.name} delivered an order${left ? ', left at the door' : ''}.`, actor: { type: 'user', id: a.uid, name: a.name } } as any).catch(() => {});
      return r.ok ? reply({ ok: true, already: !!r.already }) : reply({ ok: false, error: r.error }, r.status || 400);
    }
    const r: any = action === 'take' ? await deliveryOut(db, tenantId, orderId, { name: a.name, id: a.uid }, undefined, { fromWaiting: !a.isManager })
      : action === 'outside' ? await deliveryOutside(db, tenantId, orderId, me)
      : await deliveryEnd(db, tenantId, orderId, action === 'done' ? { done: true } : { done: false, why: b.why }, a.name, me);
    if (r.ok && !r.already && action !== 'outside') await logAuditAdmin(db, tenantId, { action: action === 'take' ? 'counter.delivery_out' : action === 'done' ? 'counter.delivery_done' : 'counter.delivery_failed', targetType: 'order', targetId: orderId,
      summary: action === 'take' ? `${a.name} took a delivery out.` : action === 'done' ? `${a.name} delivered an order.` : `${a.name} couldn’t deliver an order.`, actor: { type: 'user', id: a.uid, name: a.name } } as any).catch(() => {});
    return r.ok ? reply({ ok: true, already: !!r.already, ...(action === 'outside' ? { sent: !!r.sent, why: r.why || null } : {}) }) : reply({ ok: false, error: r.error }, r.status || 400);
  } catch (e: any) {
    console.error('[food-run]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
