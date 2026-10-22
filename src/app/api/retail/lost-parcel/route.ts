// src/app/api/retail/lost-parcel/route.ts — A PARCEL THAT STOPPED MOVING: SEND A REPLACEMENT NOW. Managers, or anyone
// who can give refunds (within their role's refund limit, lib/money-limits).
// POST { tenantId, orderId } makes the replacement: a $0 order with what went in the box (every item sent, a partly
// shorted line's sent units included, and the items of any order that rode in the same box) going to the same address
// with the service the customer paid for, packed, scanned and shipped like any other. Its stock is held the moment it's
// made, as a paid order's is. The lost parcel becomes one loss record (lib/exception-doc: lost in transit, the carrier's
// to make good) carrying what the goods cost, how the box was insured and when it shipped, so the claim for it shows
// under Needs you with the date to file by (lib/lost-recovered). The carrier problem on each order in the box is closed.
// Not made when the customer is already being refunded for the order, or has reported it missing and that report is
// still open (a replacement and a refund for one box would pay twice). Asking twice makes one replacement.
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { buildExceptionDoc } from '@/lib/exception-doc';
import { buildEntry } from '@/lib/stock-ledger';
import { refundAllowed } from '@/lib/money-limits';
import { lineFor, taxBasisOf } from '@/lib/order-family';

export const dynamic = 'force-dynamic';

const newId = () => randomBytes(6).toString('hex');
const SHIPPED = ['shipped', 'handed_off'];
const OPEN_CLAIM = new Set(['in_review', 'needs_info', 'info_requested', 'open']);
const num = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;

/** What went in the box from one order: every physical item sent (ordered, less any shorted before it shipped). */
const sentLines = (o: any) => (Array.isArray(o?.lines) ? o.lines : [])
  .filter((l: any) => l && l.digital !== true)
  .map((l: any) => ({ l, qty: Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0)), from: o }))
  .filter((x: any) => x.qty > 0);

/** Why this order's customer shouldn't also get a replacement: a refund on its way or sent, or a report still open. */
function alreadyCovered(o: any, claims: any[]): string | null {
  if ((Number(o?.pendingRefundCents) || 0) > 0 || o?.stage === 'refunded' || ((Number(o?.totalCents) || 0) > 0 && (Number(o?.refundedCents) || 0) >= (Number(o?.totalCents) || 0))) {
    return `${num(o)} is being refunded, so a replacement would pay for it twice. Sort out the refund first.`;
  }
  if (claims.some((c) => c.orderId === o?.id && c.type === 'not_received' && OPEN_CLAIM.has(String(c.status || '')))) {
    return `${String(o?.customerName || 'The customer').split(/\s+/)[0]} reported ${num(o)} missing. Answer that under Claims first.`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !(auth.actor.caps || []).includes('checkout.refund')) return NextResponse.json({ error: 'Sending a replacement is up to a manager, or someone who can give refunds.' }, { status: 403 });

  const db = getAdminDb();
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const ref = col.doc(orderId);
  const first = await ref.get();
  if (!first.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const o0: any = { ...(first.data() || {}), id: orderId };
  if (o0.labelFromOrderId || o0.shippedWithOrderId) return NextResponse.json({ error: 'This order went in another order’s box. Send the replacement from that order.' }, { status: 409 });
  // The orders that rode in this box (lib/ship-together): their goods were in it too.
  const riderIds: string[] = (Array.isArray(o0.shippedWithOrderIds) ? o0.shippedWithOrderIds.map(String) : []).filter((id: string) => id && id !== orderId).slice(0, 9);
  const riderSnaps = riderIds.length ? await db.getAll(...riderIds.map((id) => col.doc(id))) : [];
  const riders0 = riderSnaps.filter((s: any) => s.exists).map((s: any) => ({ ...(s.data() || {}), id: s.id })).filter((r: any) => [r.labelFromOrderId, r.shippedWithOrderId].includes(orderId));
  const lines = [o0, ...riders0].flatMap(sentLines);
  if (!lines.length) return NextResponse.json({ error: 'There’s nothing on this order to send again.' }, { status: 409 });

  // Costs and prices, read before the transaction (prices on the order, costs from the products).
  const ids = [...new Set(lines.map((x: any) => String(x.l.productId || '')).filter(Boolean))] as string[];
  const costs = new Map<string, number>();
  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`)));
    snaps.forEach((s: any, i: number) => { if (s.exists) costs.set(ids[i], Math.max(0, Number(s.data()?.costPerUnit) || 0)); });
  }
  const landed = lines.reduce((a: number, { l, qty }: any) => a + Math.round((costs.get(String(l.productId || '')) || 0) * 100) * qty, 0);
  const retail = lines.reduce((a: number, { l, qty }: any) => a + (Number(l.unitPriceCents) || 0) * qty, 0);
  const units = lines.reduce((a: number, x: any) => a + x.qty, 0);
  // Within what this person's role may give back (a replacement is the goods' worth, sent again).
  const allowed = refundAllowed(auth.tenant?.retailSettings || {}, auth.actor, retail);
  if (!allowed.ok) return NextResponse.json({ error: allowed.message, limitCents: allowed.limit }, { status: 403 });
  // Reports the customer filed about these orders (one lookup per order, a few at most).
  const claims = (await Promise.all([orderId, ...riders0.map((r: any) => r.id)].map((id) => db.collection(`tenants/${tenantId}/retailClaims`).where('orderId', '==', id).limit(10).get().then((s: any) => s.docs.map((d: any) => d.data())).catch(() => []))))
    .flat();

  const now = new Date().toISOString();
  try {
    const out = await db.runTransaction(async (tx: any) => {
      // Every read first: the order, the riders, the loss record, and each product's stock.
      const snap = await tx.get(ref);
      const o: any = { ...(snap.data() || {}), id: orderId };
      const riders = riders0.length ? (await Promise.all(riders0.map((r: any) => tx.get(col.doc(r.id))))).filter((s: any) => s.exists).map((s: any) => ({ ...(s.data() || {}), id: s.id, ref: s.ref })) : [];
      const excRef = db.doc(`tenants/${tenantId}/inventoryExceptions/lost-${orderId}`);
      const excSnap = await tx.get(excRef);
      const invRefs = ids.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`));
      const invSnaps = invRefs.length ? await Promise.all(invRefs.map((r) => tx.get(r))) : [];
      if (o.replacementOrderId) return { already: true, replacementOrderId: String(o.replacementOrderId) };
      if (o.method !== 'ship' || !SHIPPED.includes(String(o.stage)) || o.isTest) return { error: 'Only a shipped order that hasn’t arrived can get a replacement here.', status: 409 };
      for (const x of [o, ...riders]) { const why = alreadyCovered(x, claims); if (why) return { error: why, status: 409 }; }

      const childRef = col.doc();
      tx.set(childRef, JSON.parse(JSON.stringify({
        id: childRef.id, tenantId, orderNumber: o.orderNumber ?? null,
        stage: 'paid', method: 'ship', priceTier: o.priceTier || 'retail',
        // Sent from the shelf like any order: nothing scanned or packed yet, and never a pre-order (that run shipped).
        // Each unit keeps the price paid for it, and the order the tax figures it was paid with, so a refund on the
        // replacement is what was paid (lib/order-family).
        lines: lines.map(({ l, qty }: any) => ({ ...lineFor(l, qty), lineId: `line-${newId()}`, qtyScanned: 0, qtyPacked: 0, qtyShorted: 0, qtyReturned: 0, qtyRefunded: 0, status: 'pending', shortReason: '', preorder: false })),
        subtotalCents: 0, taxCents: 0, shippingCents: 0, refundedCents: 0, totalCents: 0, taxBasis: taxBasisOf(o),
        customerName: o.customerName || '', customerEmail: o.customerEmail || '', customerPhone: o.customerPhone || '', clientId: o.clientId || null,
        shippingAddress: o.shippingAddress || null, shippingService: o.shippingService || null, shippingCarrier: o.shippingCarrier || null,
        parentOrderId: orderId, isReplacement: true, replacementFor: 'lost_in_transit', lostParcelOrderId: orderId, ...(riders.length ? { includesOrderIds: riders.map((r: any) => r.id) } : {}),
        qrToken: o.qrToken || null, placedAt: now, paidAt: now,
      })));
      // Its stock is held now, as a paid order's is, so the shelf isn't sold twice and shipping it releases its own hold.
      const held = new Map<string, number>();
      for (const { l, qty } of lines) if (l.productId) held.set(String(l.productId), (held.get(String(l.productId)) || 0) + qty);
      invSnaps.forEach((s: any, i: number) => {
        const pid = ids[i]; const q = held.get(pid) || 0;
        if (!s.exists || q <= 0) return;
        const item: any = s.data() || {};
        const after = Math.max(0, Number(item.stockReserved) || 0) + q;
        tx.update(invRefs[i], { stockReserved: after });
        tx.set(db.collection(`tenants/${tenantId}/stockCorrections`).doc(), buildEntry({
          productId: pid, type: 'reserved', field: 'stockReserved', delta: q, unit: item.unit || 'units',
          reason: `Held for a replacement of order ${num(o)}`, actorId: String(auth.actor.uid || ''), actorName: String(auth.actor.name || ''),
          ref: { kind: 'order', id: childRef.id }, balanceAfter: after,
        }));
      });
      // The loss: one record for the whole box, valued at what the goods cost (their sale price when a cost isn't set).
      const quiet = Math.max(0, Number(o.carrierIssue?.quietDays) || 0);
      if (!excSnap.exists) {
        const docIn = buildExceptionDoc({
          dedupeId: `lost-${orderId}`, reason: 'carrier_lost', qty: 1,
          name: `Order ${num(o)} contents (${units} item${units === 1 ? '' : 's'})`,
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
      const closed = (x: any) => (x.carrierIssue ? { carrierIssue: { ...x.carrierIssue, open: false, closedAt: now, closedBy: String(auth.actor.name || ''), outcome: 'replaced' } } : {});
      tx.set(ref, { replacementOrderId: childRef.id, ...closed(o) }, { merge: true });
      for (const r of riders) tx.set(r.ref, { replacementOrderId: childRef.id, ...closed(r) }, { merge: true });
      const ev = ref.collection('events').doc();
      tx.set(ev, { id: ev.id, type: 'replacement_created', at: now, actorId: String(auth.actor.uid || ''), actorName: String(auth.actor.name || ''), meta: { childOrderId: childRef.id, text: `Replacement sent: the parcel stopped moving${quiet ? ` (no carrier scan for ${quiet} days)` : ''}${riders.length ? `, with ${riders.map(num).join(' and ')} from the same box` : ''}` } });
      return { replacementOrderId: childRef.id, landedCents: landed, retailCents: retail };
    });
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    console.error('[lost-parcel]', tenantId, orderId, String(e?.message || e).slice(0, 200));
    return NextResponse.json({ error: 'That didn’t go through. Try again.' }, { status: 500 });
  }
}
