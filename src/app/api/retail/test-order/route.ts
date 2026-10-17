// src/app/api/retail/test-order/route.ts — A TEST ORDER. Puts a practice order on the Orders screen so the owner can
// walk it through packing, the shelf and handing over before real customers arrive. It costs nothing, takes no stock
// (its items point at no real product), sends nothing to anyone, and is labelled Test everywhere. Managers only.
// POST { tenantId }
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { makeQrToken } from '@/lib/retail-webhook';
import { isStorefrontVisible } from '@/lib/retail-orders';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim();
  if (!tenantId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager) return NextResponse.json({ error: 'Only a manager can place a test order.' }, { status: 403 });
  const db = getAdminDb();
  const inv = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'retail').limit(60).get();
  const live = inv.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((i: any) => isStorefrontVisible(i)).slice(0, 2);
  const picks = live.length ? live : [{ id: 'sample', name: 'Sample item', msrp: 10 }];
  const ref = db.collection(`tenants/${tenantId}/retailOrders`).doc();
  const now = new Date().toISOString();
  const lines = picks.map((i: any, n: number) => ({
    lineId: `line-test${n}`, productId: `test-${i.id}`, sku: '', barcode: '', name: `${i.name} (test)`, optionsLabel: '',
    unitPriceCents: Math.round((Number(i.msrp) || 0) * 100), qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending',
  }));
  const subtotal = lines.reduce((a: number, l: any) => a + l.unitPriceCents, 0);
  await ref.set({
    id: ref.id, tenantId, isTest: true, orderNumber: 0, stage: 'paid', method: 'counter', priceTier: 'retail',
    lines, subtotalCents: subtotal, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: subtotal, chargedCents: 0,
    customerName: `Test order (${String(auth.actor.name || 'you').split(' ')[0]})`, customerEmail: '', customerPhone: '',
    shippingAddress: null, curbside: null, placedAt: now, paidAt: now, qrToken: makeQrToken(ref.id), ifUnavailable: 'refund',
  });
  const ev = ref.collection('events').doc();
  await ev.set({ id: ev.id, type: 'note', at: now, actorId: auth.actor.uid, actorName: auth.actor.name, meta: { kind: 'test_order', text: 'Test order placed. Nothing was charged and no stock is used.' } });
  await db.doc(`tenants/${tenantId}`).set({ retailSettings: { testOrderAt: now } }, { merge: true });
  return NextResponse.json({ ok: true, orderId: ref.id, message: 'A test order is on the Orders screen. Pack it, put it on the shelf and hand it over.' });
}
