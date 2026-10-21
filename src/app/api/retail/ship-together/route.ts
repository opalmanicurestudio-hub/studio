// src/app/api/retail/ship-together/route.ts — SHIPPING A CUSTOMER'S ORDERS IN ONE BOX (lib/ship-together). Team only.
//   decline — "Keep separate": the board stops suggesting this group.
//   apply   — after the first order's label is bought (or tracking typed): every order in the group gets the same
//             tracking and labels, each knows what it shipped with, and the shipping paid on the other orders is
//             refunded automatically (api/retail/refund, as the shop). The orders are then marked shipped on the board.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { togetherKey, togetherRefunds, orderNo } from '@/lib/ship-together';
import { cardRefundableCents } from '@/lib/retail-money';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
  const ids: string[] = (Array.isArray(b.orderIds) ? b.orderIds : []).map(String).filter(Boolean).slice(0, 10);
  if (!tenantId || ids.length < 2) return NextResponse.json({ ok: false, error: 'Choose at least two orders.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}/retailOrders`;
  const actor = { id: auth.actor.uid, name: auth.actor.name };

  if (action === 'decline') {
    const snaps = await Promise.all(ids.map((id) => db.doc(`${T}/${id}`).get()));
    const key = togetherKey(snaps[0].data() || {});
    const batch = db.batch(); for (const s of snaps) if (s.exists) batch.set(s.ref, { shipTogetherDeclined: key }, { merge: true });
    await batch.commit();
    return NextResponse.json({ ok: true });
  }
  if (action !== 'apply') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });

  const manual = b.tracking && typeof b.tracking === 'object' ? { number: String(b.tracking.number || '').trim().slice(0, 60), carrier: String(b.tracking.carrier || '').trim().slice(0, 40), extra: (Array.isArray(b.tracking.extraNumbers) ? b.tracking.extraNumbers : []).map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 9) } : null;
  let refunds: Record<string, number> = {};
  try {
    await db.runTransaction(async (tx: any) => {
      const refs = ids.map((id) => db.doc(`${T}/${id}`));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      if (snaps.some((s: any) => !s.exists)) throw new Error('One of those orders couldn’t be found.');
      const orders = snaps.map((s: any, i: number) => ({ ...(s.data() || {}), id: ids[i] }));
      const asked = orders.find((o: any) => ['waiting', 'approving'].includes(String(o.addressRequest?.status || '')));
      if (asked) throw new Error(`${String(asked.customerName || 'The customer').split(' ')[0]} asked to change the address on #${String(asked.orderNumber ?? '').padStart(4, '0')}. Answer that on the order first.`);
      const key = togetherKey(orders[0], { labelled: true });
      if (!key || orders.some((o: any) => togetherKey(o, { labelled: true }) !== key)) throw new Error('These orders aren’t going to the same person and address, so they can’t share a box.');
      if (orders.some((o: any) => !['packed', 'shipped'].includes(String(o.stage)))) throw new Error('Every order needs to be packed first.');
      if (orders.slice(1).some((o: any) => o.shippoTransactionId)) throw new Error('One of the other orders already has its own label. Void it first.');
      const p: any = orders[0];
      const label = manual
        ? { trackingNumber: manual.number, carrier: manual.carrier || null, trackingUrl: null, extraTrackingNumbers: manual.extra, packageCount: 1 + manual.extra.length }
        : { trackingNumber: p.trackingNumber || null, carrier: p.carrier || null, trackingUrl: p.trackingUrl || null, labelUrl: p.labelUrl || null, extraLabelUrls: p.extraLabelUrls || [], extraTrackingNumbers: p.extraTrackingNumbers || [], extraTrackingUrls: p.extraTrackingUrls || [], packageCount: Number(p.packageCount) || 1 };
      if (!label.trackingNumber) throw new Error('Buy the label or type the tracking number first.');
      refunds = orders[0].shippedWithOrderIds ? {} : togetherRefunds(orders, cardRefundableCents);
      const at = new Date().toISOString();
      tx.set(refs[0], { ...(manual ? label : {}), shippedWithOrderIds: ids.slice(1), shipTogetherAt: at }, { merge: true });
      orders.slice(1).forEach((o: any, i: number) => {
        const r = refunds[o.id] || 0;
        tx.set(refs[i + 1], { ...label, labelFromOrderId: p.id, shippedWithOrderId: p.id, shipTogetherAt: at, labelsChecked: p.labelsChecked || [], ...(p.labelCheckedAt ? { labelCheckedAt: p.labelCheckedAt } : {}),
          ...(r ? { pendingRefundCents: (Number(o.pendingRefundCents) || 0) + r, shipTogetherRefundCents: r } : {}) }, { merge: true });
        const ev = refs[i + 1].collection('events').doc();
        tx.set(ev, { id: ev.id, type: 'note', at, actorId: actor.id, actorName: actor.name, meta: { kind: 'shipped_together', text: `Shipped in one box with ${orderNo(p)}${r ? `; $${(r / 100).toFixed(2)} shipping to refund` : ''}` } });
      });
      const ev0 = refs[0].collection('events').doc();
      tx.set(ev0, { id: ev0.id, type: 'note', at, actorId: actor.id, actorName: actor.name, meta: { kind: 'shipped_together', text: `Shipped in one box with ${orders.slice(1).map(orderNo).join(', ')}` } });
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || 'Couldn’t put those orders together.') }, { status: 409 });
  }

  // The shipping that wasn't needed goes back to the card, as the shop (no refund limit applies to this).
  const refunded: Record<string, boolean> = {};
  for (const [id, cents] of Object.entries(refunds)) {
    try {
      const o: any = (await db.doc(`${T}/${id}`).get()).data() || {};
      const r = await fetch(`${req.nextUrl.origin}/api/retail/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': String(process.env.CRON_SECRET || '') }, body: JSON.stringify({ tenantId, orderId: id, qrToken: o.qrToken || '', reason: 'ship_together' }) });
      refunded[id] = r.ok && cents > 0;
    } catch { refunded[id] = false; }
  }
  return NextResponse.json({ ok: true, refunds, refunded });
}
