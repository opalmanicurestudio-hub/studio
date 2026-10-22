// src/app/api/retail/lost-parcel/route.ts — A PARCEL THAT STOPPED MOVING: SEND A REPLACEMENT NOW. Managers, or anyone
// who can give refunds.
// POST { tenantId, orderId } makes the replacement: a $0 order with the same items going to the same address with the
// service the customer paid for, packed and shipped like any other. The lost parcel becomes a loss record
// (lib/exception-doc: lost in transit, the carrier's to make good) carrying what the goods cost, how the box was insured
// and when it shipped, so the claim for it shows under Needs you with the date to file by (lib/lost-recovered). The
// carrier problem on the order is closed. Asking twice makes one replacement: the second answer is the first one.
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { buildExceptionDoc } from '@/lib/exception-doc';

export const dynamic = 'force-dynamic';

const newId = () => randomBytes(6).toString('hex');
const SHIPPED = ['shipped', 'handed_off'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !(auth.actor.caps || []).includes('checkout.refund')) return NextResponse.json({ error: 'Sending a replacement is up to a manager, or someone who can give refunds.' }, { status: 403 });

  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const first = await ref.get();
  if (!first.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const o0: any = first.data() || {};
  // What the goods cost, read before the transaction (prices on the order, costs from the products).
  // What went in the box: every item sent, never one refunded or taken off before it shipped.
  const lines = (Array.isArray(o0.lines) ? o0.lines : []).filter((l: any) => l && l.digital !== true && !['refunded', 'shorted', 'backordered'].includes(String(l.status)))
    .map((l: any) => ({ l, qty: Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0) - (Number(l.qtyRefunded) || 0)) }))
    .filter((x: any) => x.qty > 0);
  const costs = new Map<string, number>();
  const ids = [...new Set(lines.map((x: any) => String(x.l.productId || '')).filter(Boolean))] as string[];
  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)));
    snaps.forEach((s: any, i: number) => { if (s.exists) costs.set(ids[i], Math.max(0, Number(s.data()?.costPerUnit) || 0)); });
  }

  const now = new Date().toISOString();
  try {
    const out = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const o: any = snap.data() || {};
      if (o.replacementOrderId) return { already: true, replacementOrderId: String(o.replacementOrderId) };
      if (o.method !== 'ship' || !SHIPPED.includes(String(o.stage)) || o.isTest) return { error: 'Only a shipped order that hasn’t arrived can get a replacement here.', status: 409 };
      if (!lines.length) return { error: 'There’s nothing on this order to send again.', status: 409 };
      const excRef = db.doc(`tenants/${tenantId}/inventoryExceptions/lost-${orderId}`);
      const excSnap = await tx.get(excRef);
      const childRef = db.collection(`tenants/${tenantId}/retailOrders`).doc();
      tx.set(childRef, JSON.parse(JSON.stringify({
        id: childRef.id, tenantId, orderNumber: o.orderNumber ?? null,
        stage: 'paid', method: 'ship', priceTier: o.priceTier || 'retail',
        lines: lines.map(({ l, qty }: any) => ({ ...l, lineId: `line-${newId()}`, qtyOrdered: qty, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, qtyRefunded: 0, status: 'pending', shortReason: '' })),
        subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0,
        customerName: o.customerName || '', customerEmail: o.customerEmail || '', customerPhone: o.customerPhone || '', clientId: o.clientId || null,
        shippingAddress: o.shippingAddress || null, shippingService: o.shippingService || null, shippingCarrier: o.shippingCarrier || null,
        parentOrderId: orderId, isReplacement: true, replacementFor: 'lost_in_transit',
        qrToken: o.qrToken || null, placedAt: now, paidAt: now,
      })));
      // The loss: one record for the whole box, valued at what the goods cost (their sale price when a cost isn't set).
      const landed = lines.reduce((a: number, { l, qty }: any) => a + Math.round((costs.get(String(l.productId || '')) || 0) * 100) * qty, 0);
      const retail = lines.reduce((a: number, { l, qty }: any) => a + (Number(l.unitPriceCents) || 0) * qty, 0);
      const units = lines.reduce((a: number, x: any) => a + x.qty, 0);
      const quiet = Math.max(0, Number(o.carrierIssue?.quietDays) || 0);
      if (!excSnap.exists) {
        const docIn = buildExceptionDoc({
          dedupeId: `lost-${orderId}`, reason: 'carrier_lost', qty: 1,
          name: `Order #${String(o.orderNumber ?? '').padStart(4, '0')} contents (${units} item${units === 1 ? '' : 's'})`,
          costPerUnitDollars: landed / 100, retailPerUnitCents: retail,
          orderId, orderNumber: o.orderNumber ?? null, replacementOrderId: childRef.id,
          trackingNumber: o.trackingNumber || null, carrier: o.carrier || null,
          insuredCents: o.shipmentProtection ? Math.max(0, Number(o.shipmentProtection.insuranceCents) || 0) : null,
          shippedAt: o.completedAt || o.shippedAt || null,
          responsibleParty: 'carrier', note: quiet ? `No carrier scan for ${quiet} days` : 'Stopped moving',
          recordedBy: { id: String(auth.actor.uid || ''), name: String(auth.actor.name || '') }, source: 'carrier_watch',
        }, tenantId);
        // Costed only when every item has a cost set.
        tx.set(excRef, JSON.parse(JSON.stringify({ ...docIn, costed: lines.every(({ l }: any) => (costs.get(String(l.productId || '')) || 0) > 0) })));
      }
      tx.set(ref, {
        replacementOrderId: childRef.id,
        ...(o.carrierIssue ? { carrierIssue: { ...o.carrierIssue, open: false, closedAt: now, closedBy: String(auth.actor.name || ''), outcome: 'replaced' } } : {}),
      }, { merge: true });
      const ev = ref.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'replacement_created', at: now, actorId: String(auth.actor.uid || ''), actorName: String(auth.actor.name || ''), meta: { childOrderId: childRef.id, text: `Replacement sent: the parcel stopped moving${quiet ? ` (no carrier scan for ${quiet} days)` : ''}` } });
      return { replacementOrderId: childRef.id, landedCents: landed, retailCents: retail };
    });
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error('[lost-parcel]', tenantId, orderId, String(e?.message || e).slice(0, 200));
    return NextResponse.json({ error: 'That didn’t go through. Try again.' }, { status: 500 });
  }
}
