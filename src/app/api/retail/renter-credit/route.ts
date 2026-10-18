// src/app/api/retail/renter-credit/route.ts — KEEP RENTERS' SHOP CREDITS IN STEP WITH AN ORDER. Called after an order
// is handed over or shipped, and after a return is checked in. For each line sold for a renter, the credit on their
// rent account (one per line, `rs-{orderId}-{lineId}`) is set to their share of what reached the customer and wasn't
// returned (lib/renter-sales). If a credit already came off their rent and is now too big, the difference is flagged
// for the owner rather than taken back silently. Staff only. POST { tenantId, orderId }
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { FINAL_STAGES, creditChange, renterShareCents } from '@/lib/renter-sales';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!tenantId || !orderId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getAdminDb();
  const oSnap = await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get();
  if (!oSnap.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  const o: any = oSnap.data() || {};
  if (o.isTest) return NextResponse.json({ ok: true, changed: 0 });
  const final = FINAL_STAGES.includes(String(o.stage));
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const now = new Date().toISOString();
  let changed = 0;
  for (const l of (o.lines || [])) {
    if (!l?.soldFor?.renterId) continue;
    const desired = final ? renterShareCents(l) : 0;
    const ref = db.doc(`tenants/${tenantId}/rentLedger/rs-${orderId}-${l.lineId}`);
    const r = await db.runTransaction(async (tx: any) => {
      const cur = await tx.get(ref); const ex = cur.exists ? cur.data() : null;
      const c = creditChange(desired, ex); if (!c) return null;
      const units = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0) - (Number(l.qtyReturned) || 0));
      tx.set(ref, {
        id: ref.id, renterId: l.soldFor.renterId, type: 'retail_sale_credit', status: c.status, amountCents: c.amountCents, appliedCents: c.appliedCents,
        note: `Online sale ${num}: ${units} × ${l.name}, after the shop’s ${Number(l.soldFor.shopCutPct) || 0}%`,
        retailOrderId: orderId, lineId: l.lineId, date: ex?.date || now, createdAt: ex?.createdAt || now, updatedAt: now, createdBy: auth.actor.name,
        ...(c.clawbackCents ? { clawbackCents: c.clawbackCents } : {}),
      }, { merge: true });
      return c;
    });
    if (!r) continue;
    changed++;
    if (r.clawbackCents > 0) {
      const n = db.collection(`tenants/${tenantId}/notifications`).doc();
      await n.set({ id: n.id, type: 'renter_clawback', read: false, createdAt: now, link: '/rent', message: `${l.soldFor.renterName || 'A renter'} was already credited for ${l.name} on order ${num}, which came back. $${(r.clawbackCents / 100).toFixed(2)} to settle with them.` });
    }
  }
  return NextResponse.json({ ok: true, changed });
}
