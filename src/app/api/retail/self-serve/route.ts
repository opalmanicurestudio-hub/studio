import { NextRequest, NextResponse } from 'next/server';
import { sendOrderConfirmation } from '@/lib/retail-webhook';

// ─── /api/retail/self-serve/route.ts ──────────────────────────────────────────
// Customer self-service, gated by possession of the order's qrToken — the
// same proof the tracking page itself runs on. Two actions:
//
//   { action: 'cancel', tenantId, orderId, qrToken, reason? }
//     Allowed ONLY while unpicked (placed | paid). The transaction re-checks
//     the stage INSIDE the write, so the race — customer taps Cancel the
//     moment staff hits Take Next — always resolves honestly: whoever's
//     write lands second sees the new state and backs off with a clear
//     message. Paid cancels release every reserved unit and queue the full
//     amount in the staff refund banner. Actor is recorded as the customer.
//
//   { action: 'start_return', tenantId, orderId, qrToken,
//     selections: [{ lineId, qty, reason }], resolution, notes? }
//     Allowed once goods are out (shipped | handed_off | completed). Creates
//     a status:'open' return — identical shape to staff-opened ones — so it
//     lands in the Returns inbox BEFORE the customer walks in. Quantities
//     validated against what's still returnable per line; resolution limited
//     to refund | store_credit (replacements stay a staff judgment call).
//
//   { action: 'update_address', tenantId, orderId, qrToken, address }
//     Allowed ONLY while unpicked (placed | paid) on ship orders — the same
//     window as cancel, because once a picker claims the order the label is
//     minutes away. The old address is preserved in the event record, so a
//     correction is an EVENT in the order's history, never an overwrite of it.
//
//   { action: 'resend_receipt', tenantId, orderId, qrToken }
//     Re-sends the original confirmation email. Capped at 5 per order inside
//     the transaction, so a stuck retry button can't become a mail cannon.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-selfserve';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const RETURN_STAGES = ['shipped', 'handed_off', 'completed'];
const CANCEL_STAGES = ['placed', 'paid'];
const REASONS = ['damaged_in_transit', 'defective', 'wrong_item', 'changed_mind', 'other'];

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const action = String(body.action || '').trim();

  if (!tenantId || !orderId || !qrToken || !['cancel', 'start_return', 'update_address', 'resend_receipt'].includes(action)) {
    return NextResponse.json({ error: 'Missing order details' }, { status: 400 });
  }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

  try {
    if (action === 'cancel') {
      const reason = String(body.reason || '').slice(0, 200);
      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };

        if (!CANCEL_STAGES.includes(order.stage)) {
          if (['cancelled', 'refunded'].includes(order.stage)) {
            return { status: 409, error: 'This order is already cancelled.' };
          }
          return {
            status: 409,
            error: 'Packing has already started, so it can\u2019t be cancelled online \u2014 send us a note below and we\u2019ll sort it out.',
          };
        }

        // Reads before writes: reservation release per product (paid only).
        const releases = new Map<string, number>();
        if (order.stage === 'paid') {
          for (const l of order.lines || []) {
            const open = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
            if (open > 0) releases.set(l.productId, (releases.get(l.productId) || 0) + open);
          }
        }
        const itemReads: { ref: any; qty: number; snap: any }[] = [];
        for (const [pid, qty] of releases) {
          const ref = db.collection(`tenants/${tenantId}/inventory`).doc(pid);
          itemReads.push({ ref, qty, snap: await txn.get(ref) });
        }

        for (const { ref, qty, snap: itemSnap } of itemReads) {
          if (!itemSnap.exists) continue;
          const item = itemSnap.data() as any;
          txn.update(ref, { stockReserved: Math.max(0, (Number(item.stockReserved) || 0) - qty) });
        }

        const pending = order.stage === 'paid'
          ? Math.max(0, (order.totalCents || 0) - (order.refundedCents || 0))
          : 0;

        txn.update(orderRef, {
          stage: 'cancelled',
          cancelledAt: new Date().toISOString(),
          cancelReason: reason ? `Customer: ${reason}` : 'Cancelled by customer',
          pendingRefundCents: Math.max(pending, order.pendingRefundCents || 0),
          batchId: null, claimedBy: null, claimedByName: null,
        });
        const evRef = orderRef.collection('events').doc();
        txn.set(evRef, {
          id: evRef.id, type: 'order_cancelled', at: new Date().toISOString(),
          actorId: 'customer', actorName: order.customerName || 'Customer',
          meta: { reason: reason || 'self-serve', pendingRefundCents: pending },
        });
        return { status: 200, pending };
      });

      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({
        ok: true,
        message: result.pending > 0
          ? 'Order cancelled. Your refund has been queued and the shop will process it shortly.'
          : 'Order cancelled.',
      });
    }

    if (action === 'update_address') {
      const a = body.address || {};
      const clean = {
        name: String(a.name || '').trim().slice(0, 80),
        line1: String(a.line1 || '').trim().slice(0, 120),
        line2: String(a.line2 || '').trim().slice(0, 120),
        city: String(a.city || '').trim().slice(0, 60),
        state: String(a.state || '').trim().slice(0, 30),
        postalCode: String(a.postalCode || '').trim().slice(0, 15),
        country: 'US',
      };
      if (!clean.name || !clean.line1 || !clean.city || !clean.state || !clean.postalCode) {
        return NextResponse.json({ error: 'Please fill in the full corrected address.' }, { status: 400 });
      }

      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };
        if (order.method !== 'ship') {
          return { status: 409, error: 'This order isn\u2019t being shipped, so there\u2019s no address to change.' };
        }
        if (!CANCEL_STAGES.includes(order.stage)) {
          return {
            status: 409,
            error: 'Packing has already started, so the address can\u2019t change online \u2014 send us a note below right away and we\u2019ll try to catch it.',
          };
        }

        txn.update(orderRef, { shippingAddress: clean });
        const evRef = orderRef.collection('events').doc();
        txn.set(evRef, {
          id: evRef.id, type: 'address_updated', at: new Date().toISOString(),
          actorId: 'customer', actorName: order.customerName || 'Customer',
          meta: { from: order.shippingAddress || null, to: clean, selfServe: true },
        });
        return { status: 200 };
      });

      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, message: 'Address updated \u2014 your package will ship to the corrected address.' });
    }

    if (action === 'resend_receipt') {
      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };
        if (order.stage === 'placed') {
          return { status: 409, error: 'The receipt is sent once payment confirms \u2014 this order hasn\u2019t been paid yet.' };
        }
        if (!String(order.customerEmail || '').trim()) {
          return { status: 409, error: 'There\u2019s no email address on this order.' };
        }
        const sends = Number(order.receiptResends) || 0;
        if (sends >= 5) {
          return { status: 429, error: 'That receipt has been re-sent several times already \u2014 check your spam folder, or message us below.' };
        }
        txn.update(orderRef, { receiptResends: sends + 1 });
        return { status: 200, order };
      });

      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      await sendOrderConfirmation(db, tenantId, orderId, result.order, null);
      return NextResponse.json({ ok: true, message: 'Receipt re-sent \u2014 it should be in your inbox in a minute.' });
    }

    // ── start_return ──
    const selections = Array.isArray(body.selections) ? body.selections : [];
    const resolution = ['refund', 'store_credit'].includes(body.resolution) ? body.resolution : 'refund';
    const notes = String(body.notes || '').slice(0, 400);
    if (selections.length === 0) return NextResponse.json({ error: 'Pick at least one item to return.' }, { status: 400 });

    const snap = await orderRef.get();
    if (!snap.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = snap.data() as any;
    if (order.qrToken !== qrToken) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    if (!RETURN_STAGES.includes(order.stage)) {
      return NextResponse.json({ error: 'Returns open once your order has been picked up or delivered.' }, { status: 409 });
    }

    // The settings toggle is only honest if the SERVER refuses too — a hidden
    // button is not a policy. Claims stay open regardless: a shop can decline
    // changed minds, never defects.
    const tenantSnapR = await db.collection('tenants').doc(tenantId).get();
    const rsR = (tenantSnapR.exists ? (tenantSnapR.data() as any).retailSettings : {}) || {};
    if (rsR.returnsEnabled === false) {
      return NextResponse.json({
        error: 'This shop doesn\u2019t take returns \u2014 but if something\u2019s wrong with what arrived, use \u201cReport a problem\u201d and it goes straight to the shop with your order\u2019s packing record.',
      }, { status: 409 });
    }
    const windowDays = Math.max(0, Math.floor(Number(rsR.returnWindowDays) || 0));
    if (windowDays > 0 && order.completedAt) {
      const ageDays = (Date.now() - new Date(order.completedAt).getTime()) / 86400000;
      if (Number.isFinite(ageDays) && ageDays > windowDays) {
        return NextResponse.json({
          error: `The ${windowDays}-day return window for this order has closed \u2014 message the shop below if something exceptional happened.`,
        }, { status: 409 });
      }
    }

    const lines: any[] = [];
    for (const sel of selections) {
      const qty = Math.floor(Number(sel.qty) || 0);
      if (qty <= 0) continue;
      const orig = (order.lines || []).find((l: any) => l.lineId === sel.lineId);
      if (!orig) return NextResponse.json({ error: 'Item not found on this order.' }, { status: 400 });
      const returnable = (orig.qtyOrdered || 0) - (orig.qtyShorted || 0) - (orig.qtyReturned || 0);
      if (qty > returnable) {
        return NextResponse.json({ error: `Only ${returnable} of ${orig.name} can still be returned.` }, { status: 400 });
      }
      lines.push({
        lineId: orig.lineId, sku: orig.sku || '', name: orig.name, qty,
        reason: REASONS.includes(sel.reason) ? sel.reason : 'other',
      });
    }
    if (lines.length === 0) return NextResponse.json({ error: 'Pick at least one item to return.' }, { status: 400 });

    const value = lines.reduce((sum, rl) => {
      const orig = (order.lines || []).find((l: any) => l.lineId === rl.lineId);
      return sum + rl.qty * (orig?.unitPriceCents || 0);
    }, 0);

    const retRef = db.collection(`tenants/${tenantId}/retailReturns`).doc();
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.set(retRef, JSON.parse(JSON.stringify({
      id: retRef.id, tenantId, orderId, orderNumber: order.orderNumber,
      lines, resolution, status: 'open', photoUrls: [],
      refundCents: resolution === 'refund' ? value : undefined,
      storeCreditCents: resolution === 'store_credit' ? value : undefined,
      openedBy: `Customer — ${order.customerName || 'self-serve'}`,
      openedAt: now,
      notes: notes || undefined,
    })));
    const evRef = orderRef.collection('events').doc();
    batch.set(evRef, {
      id: evRef.id, type: 'return_opened', at: now,
      actorId: 'customer', actorName: order.customerName || 'Customer',
      meta: { returnId: retRef.id, units: lines.reduce((a, l) => a + l.qty, 0), selfServe: true },
    });
    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: 'Return started. Bring the items by (or ship them back) and the shop will verify and finish it \u2014 you can watch progress right here.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Request failed').slice(0, 200) }, { status: 500 });
  }
}
