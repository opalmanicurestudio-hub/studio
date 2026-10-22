import { restoreNonCardPayment } from '@/lib/cancel-restore';
import { cardRefundableCents } from '@/lib/retail-money';
import { reservedByOpenReturns } from '@/lib/return-reserve';
import { NextRequest, NextResponse } from 'next/server';
import { sendOrderConfirmation } from '@/lib/retail-webhook';
import { requestForensics } from '@/lib/request-forensics';
import { delayNotified, isPromiseLate } from '@/lib/retail-orders';
import { canReturnLine } from '@/lib/return-eligibility';
import { effectiveUnitCents } from '@/lib/retail-swap';

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
//   { action: 'update_address', tenantId, orderId, qrToken, address, checkToken? }
//     Checked with the carrier first (or the check the page already made, api/retail/address-check). Then, by the
//     shop's policy (lib/address-flow changeMode): straight onto the order until the label is bought (or until
//     packing starts, or never), otherwise a request staff approve in one tap. Held orders always ask, without
//     saying why. Once it has shipped, only the carrier's own options are left. The old address is kept in the
//     event record, so a correction is an EVENT in the order's history, never an overwrite of it.
//
//   { action: 'confirm_address', tenantId, orderId, qrToken }
//     The shop asked "is this the right address?" and the customer says yes.
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
// Stages where nothing has left the building yet. Past the promised ship
// date, the FTC rule gives the buyer an unconditional right to cancel for a
// refund — so "packing has started" stops being a reason to say no.
const LATE_CANCEL_STAGES = ['placed', 'paid', 'picking', 'packed', 'ready'];
const REASONS = ['damaged_in_transit', 'defective', 'wrong_item', 'changed_mind', 'other'];

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const action = String(body.action || '').trim();

  const client = requestForensics(req);

  if (!tenantId || !orderId || !qrToken || !['cancel', 'start_return', 'update_address', 'confirm_address', 'resend_receipt'].includes(action)) {
    return NextResponse.json({ error: 'Missing order details' }, { status: 400 });
  }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

  try {
    if (action === 'cancel') {
      const reason = String(body.reason || '').slice(0, 200);
      const tenantSnapC = await db.collection('tenants').doc(tenantId).get();
      const polC = ((tenantSnapC.exists ? (tenantSnapC.data() as any).retailSettings : {})?.policies) || {};
      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };

        const promiseLate = isPromiseLate(order) || delayNotified(order);
        /* POLICY GATES — but a LATE PROMISE overrides every one of them:
         * when the shop has blown its own ship promise, cancelling is the
         * customer's right, not a courtesy the policy can switch off. A delay
         * notice offered a full refund, so once one has gone out the same
         * right holds until the order ships. */
        if (!promiseLate) {
          if (polC.cancelAllowed === false) {
            return { status: 409, error: 'Cancellations for this shop are handled personally. Please send us a note below and we will be happy to help.' };
          }
          const windowHours = Math.max(0, Number(polC.cancelWindowHours) || 0);
          if (windowHours > 0 && order.paidAt) {
            const ageH = (Date.now() - new Date(order.paidAt).getTime()) / 3600000;
            if (Number.isFinite(ageH) && ageH > windowHours) {
              return { status: 409, error: `As outlined in our cancellation policy, orders can be cancelled online within ${windowHours} hours of payment. As that time has passed, packing may already be underway. Please send us a note below and we will be happy to help.` };
            }
          }
        }
        const cancellable = promiseLate
          ? LATE_CANCEL_STAGES.includes(order.stage)
          : CANCEL_STAGES.includes(order.stage);
        if (!cancellable) {
          if (['cancelled', 'refunded'].includes(order.stage)) {
            return { status: 409, error: 'This order is already cancelled.' };
          }
          return {
            status: 409,
            error: 'Packing has already started, so this order can no longer be cancelled online. Please send us a note below and we will be happy to help.',
          };
        }

        // Reads before writes: release the stock held for this order. It's held from payment until handoff or
        // shipping, so a late order cancelled while being packed releases it too.
        const releases = new Map<string, number>();
        if (['paid', 'picking', 'packed', 'ready', 'arrived'].includes(order.stage)) {
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

        // Whatever stage it was cancelled from, the card gets back what it paid (never more: credit and gift cards
        // lowered the charge).
        const pending = cardRefundableCents(order);

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
          meta: { reason: reason || 'self-serve', pendingRefundCents: pending, ...(client ? { client } : {}) },
        });
        return { status: 200, pending };
      });

      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      // A label already bought for it is voided now, so the postage comes back (lib/label-sweep); the morning check
      // catches it otherwise.
      try {
        const after: any = (await orderRef.get()).data() || {};
        if (after.shippoTransactionId) {
          const { voidIfUnused } = await import('@/lib/label-sweep');
          const { shippoKeyFor } = await import('@/lib/retail-secrets');
          await voidIfUnused(db, tenantId, orderRef, after, await shippoKeyFor(db, tenantId), 'the order was cancelled', { id: 'customer', name: after.customerName || 'Customer' });
        }
      } catch { /* the morning check voids it */ }
      // Gift card and store credit used on the order go back too (lib/cancel-restore).
      const restored = await restoreNonCardPayment(db, tenantId, orderId, 'Customer cancellation').catch(() => ({ giftCents: 0, creditCents: 0 }));
      const restoredLine = [restored.giftCents ? `$${(restored.giftCents / 100).toFixed(2)} is back on your gift card` : '', restored.creditCents ? `$${(restored.creditCents / 100).toFixed(2)} store credit is back on your account` : ''].filter(Boolean).join(' and ');

      /* AUTO-REFUND ON CANCEL. The returns desk already honors the shop's
       * "refund automatically below $X" policy; a self-serve cancellation is
       * the LESS ambiguous case — the shop has not even packed it — so it
       * would be strange for the customer to wait longer for a smaller
       * decision. Same route, same idempotency, same closure. A failure is
       * silent to the customer: the refund is still queued on the board, and
       * the message already told them it is coming. */
      let refundedNow = false;
      const autoBelowC = Math.max(0, Number(polC.refundAutoBelowCents) || 0);
      if (result.pending > 0 && autoBelowC > 0 && result.pending <= autoBelowC) {
        try {
          const rr = await fetch(`${req.nextUrl.origin}/api/retail/refund`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': String(process.env.CRON_SECRET || '') },
            body: JSON.stringify({ tenantId, orderId, qrToken, reason: 'customer_cancel' }),
          });
          refundedNow = rr.ok;
        } catch { /* stays queued on the board */ }
      }

      return NextResponse.json({
        ok: true,
        message: `${refundedNow
          ? 'Order cancelled and your refund is already on its way back to your card — most banks show it within 5–10 business days.'
          : result.pending > 0
            ? 'Order cancelled. Your refund has been queued and the shop will process it shortly.'
            : 'Order cancelled.'}${restoredLine ? ` ${restoredLine.charAt(0).toUpperCase()}${restoredLine.slice(1)}.` : ''}`,
      });
    }

    if (action === 'update_address') {
      const { cleanAddress, changeMode, oneLine, sameAddress } = await import('@/lib/address-flow');
      const clean = cleanAddress(body.address);
      if (!clean) return NextResponse.json({ error: 'Please fill in the full corrected address.' }, { status: 400 });

      const tSnap = await db.collection('tenants').doc(tenantId).get();
      const tenant: any = tSnap.exists ? tSnap.data() : {};
      const rs = tenant.retailSettings || {};
      // The order and its token first: a carrier check costs the shop, so only the order's own page can ask for one,
      // and only when a change is possible at all.
      const pre = await orderRef.get();
      if (!pre.exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
      const po: any = pre.data() || {};
      if (po.qrToken !== qrToken) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
      const early = changeMode(po, rs).mode;
      if (early === 'carrier') return NextResponse.json({ error: 'It\u2019s already with the carrier, so the address can\u2019t be changed here. Their tracking page shows what they can do, like holding it for pickup.' }, { status: 409 });
      if (early === 'none') return NextResponse.json({ error: po.method !== 'ship' ? 'This order isn\u2019t being shipped, so there\u2019s no address to change.' : 'This order can\u2019t be changed any more.' }, { status: 409 });
      // The carrier check the page already made for this address, or a fresh one (a few per order, then none).
      const { addressPolicy, validateAddress, shouldBlock, addressMessage } = await import('@/lib/address-validation');
      const { checkFromToken, checkAllowed } = await import('@/lib/address-flow-server');
      const policy = addressPolicy(rs);
      const signed = checkFromToken(tenantId, body.checkToken, clean);
      let check: any = signed ? { ...signed.check, choice: signed.picked } : null;
      if (!check && policy.enabled && await checkAllowed(db, tenantId, `order_${orderId}`)) {
        const { shippoKeyFor } = await import('@/lib/retail-secrets');
        check = await validateAddress({ address: clean, apiKey: await shippoKeyFor(db, tenantId, tenant), policy });
      }
      if (check && shouldBlock(check, policy)) return NextResponse.json({ error: addressMessage(check) }, { status: 422 });
      const unitAnswer = body.unitAnswer === 'added' || body.unitAnswer === 'none' ? body.unitAnswer : null;
      const kept = check && check.verdict !== 'skipped' ? { ...check, ...(unitAnswer ? { unitAnswer } : {}) } : null;

      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };
        if (order.method !== 'ship') {
          return { status: 409, error: 'This order isn\u2019t being shipped, so there\u2019s no address to change.' };
        }
        if (order.addressRequest?.status === 'approving') return { status: 409, error: 'The shop is updating your address right now. Check back in a minute.' };
        const { mode, why } = changeMode(order, rs);
        if (mode === 'carrier') return { status: 409, error: 'It\u2019s already with the carrier, so the address can\u2019t be changed here. Their tracking page shows what they can do, like holding it for pickup.' };
        if (mode === 'none') return { status: 409, error: 'This order can\u2019t be changed any more.' };
        const now = new Date().toISOString();
        if (sameAddress(order.shippingAddress, clean) && String(order.shippingAddress?.name || '').trim() === clean.name) {
          if (order.addressConfirm?.status === 'waiting') txn.set(orderRef, { addressConfirm: { ...order.addressConfirm, status: 'confirmed', answeredAt: now } }, { merge: true });
          return { status: 200, applied: true, message: 'That\u2019s already the address on your order.' };
        }
        // Asked to confirm (or confirmed the old one): a new address is their answer now.
        const answered = ['waiting', 'confirmed'].includes(String(order.addressConfirm?.status || '')) ? { addressConfirm: { ...order.addressConfirm, status: 'fixed', answeredAt: now } } : {};
        const evRef = orderRef.collection('events').doc();

        if (mode === 'direct') {
          txn.set(orderRef, {
            shippingAddress: clean,
            addressCheck: kept,
            // Packing already started: the packer sees "New address" when they ship it.
            addressChanged: { at: now, from: order.shippingAddress || null, by: 'customer', after: String(order.stage || '') },
            ...(order.addressRequest?.status === 'waiting' ? { addressRequest: { ...order.addressRequest, status: 'replaced', answeredAt: now } } : {}),
            ...answered,
          }, { merge: true });
          txn.set(evRef, {
            id: evRef.id, type: 'address_updated', at: now,
            actorId: 'customer', actorName: order.customerName || 'Customer',
            meta: { from: order.shippingAddress || null, to: clean, selfServe: true, verdict: kept?.verdict || null, ...(client ? { client } : {}) },
          });
          return { status: 200, applied: true, message: `Saved. Your order will ship to ${oneLine(clean)}.` };
        }

        // A request: after the label, after packing started (if that's the shop's point), every change (if the shop
        // asks for that), or a held order (never said to the customer).
        const reqId = evRef.id;
        txn.set(orderRef, {
          addressRequest: { id: reqId, kind: 'change', status: 'waiting', to: clean, from: order.shippingAddress || null, check: kept, at: now, why },
          ...answered,
        }, { merge: true });
        txn.set(evRef, {
          id: evRef.id, type: 'note', at: now,
          actorId: 'customer', actorName: order.customerName || 'Customer',
          meta: { kind: 'address_change_requested', text: `Asked to change the address to ${oneLine(clean)}`, to: clean, ...(client ? { client } : {}) },
        });
        return {
          status: 200, applied: false, requested: true,
          message: why === 'label'
            ? 'Your shipping label is already printed, so we\u2019ve sent the new address to the shop. You\u2019ll see their answer here.'
            : why === 'packing'
              ? 'Packing has started, so we\u2019ve sent the new address to the shop. You\u2019ll see their answer here.'
              : 'We\u2019ve sent the new address to the shop. You\u2019ll see their answer here.',
        };
      });

      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, applied: (result as any).applied === true, requested: (result as any).requested === true, message: (result as any).message });
    }

    if (action === 'confirm_address') {
      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };
        if (order.addressConfirm?.status !== 'waiting') return { status: 200 };
        const now = new Date().toISOString();
        txn.set(orderRef, { addressConfirm: { ...order.addressConfirm, status: 'confirmed', answeredAt: now } }, { merge: true });
        const evRef = orderRef.collection('events').doc();
        txn.set(evRef, { id: evRef.id, type: 'note', at: now, actorId: 'customer', actorName: order.customerName || 'Customer', meta: { kind: 'address_confirmed', text: 'Confirmed the address', ...(client ? { client } : {}) } });
        return { status: 200 };
      });
      if (result.status !== 200) return NextResponse.json({ error: (result as any).error }, { status: result.status });
      return NextResponse.json({ ok: true, message: 'Thanks. We\u2019ll ship it to this address.' });
    }

    if (action === 'resend_receipt') {
      const result = await db.runTransaction(async (txn: any) => {
        const snap = await txn.get(orderRef);
        if (!snap.exists) return { status: 404, error: 'Order not found.' };
        const order = snap.data() as any;
        if (order.qrToken !== qrToken) return { status: 403, error: 'Not authorized.' };
        if (order.stage === 'placed') {
          return { status: 409, error: 'We have not yet received payment for this order. Your receipt will be sent once payment is confirmed.' };
        }
        if (!String(order.customerEmail || '').trim()) {
          return { status: 409, error: 'There\u2019s no email address on this order.' };
        }
        const sends = Number(order.receiptResends) || 0;
        if (sends >= 5) {
          return { status: 429, error: 'This receipt has already been re-sent several times. Please check your spam folder, or send us a message below.' };
        }
        txn.update(orderRef, { receiptResends: sends + 1 });
        return { status: 200, order };
      });

      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      await sendOrderConfirmation(db, tenantId, orderId, result.order, null);
      return NextResponse.json({ ok: true, message: 'Your receipt has been re-sent and should arrive in your inbox shortly.' });
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
        error: 'Please note that this shop does not accept returns. If there is an issue with your order, please use \u201cReport a problem\u201d and our team will review it with your order\u2019s packing record.',
      }, { status: 409 });
    }
    const windowDays = Math.max(0, Math.floor(Number(rsR.returnWindowDays) || 0));
    if (windowDays > 0 && order.completedAt) {
      const ageDays = (Date.now() - new Date(order.completedAt).getTime()) / 86400000;
      if (Number.isFinite(ageDays) && ageDays > windowDays) {
        return NextResponse.json({
          error: `As outlined in our return policy, returns can be started within ${windowDays} days of receiving your order, and that window has now closed for this order. If there are exceptional circumstances, please send us a message below.`,
        }, { status: 409 });
      }
    }

    const lines: any[] = [];
    let openReturns: any[] | null = null;
    for (const sel of selections) {
      const qty = Math.floor(Number(sel.qty) || 0);
      if (qty <= 0) continue;
      const orig = (order.lines || []).find((l: any) => l.lineId === sel.lineId);
      if (!orig) return NextResponse.json({ error: 'Item not found on this order.' }, { status: 400 });
      // A download has no parcel to send back, and printing a return label
      // for one wastes the shop's money and the customer's afternoon. The
      // door isn't closed — it just goes to a person, who can refund and
      // withdraw access in one move.
      if (orig.digital === true) {
        return NextResponse.json({
          error: `${orig.name} is a digital item, so there is nothing to send back. Please use \u201cReport a problem\u201d and our team will arrange a refund with you directly.`,
        }, { status: 409 });
      }
      if (openReturns === null) { try { openReturns = (await db.collection(`tenants/${tenantId}/retailReturns`).where('orderId', '==', orderId).limit(50).get()).docs.map((d: any) => d.data()); } catch { openReturns = []; } }
      const returnable = Math.max(0, (orig.qtyOrdered || 0) - (orig.qtyShorted || 0) - (orig.qtyReturned || 0) - reservedByOpenReturns(openReturns || [], orig.lineId));
      if (qty > returnable) {
        return NextResponse.json({ error: `Only ${returnable} of ${orig.name} can still be returned.` }, { status: 400 });
      }
      // FINAL SALE, checked on the customer's own path. The refusal names the
      // item, gives the shop's own reason, and ends by pointing at what they
      // CAN still do — a bare "this cannot be returned" is the message that
      // produces a phone call, or a card dispute. Fault reasons are never
      // blocked, so "it arrived smashed" still goes straight through.
      const chosenReason = REASONS.includes(sel.reason) ? sel.reason : 'other';
      const eligible = canReturnLine(orig as any, chosenReason as any);
      if (!eligible.allowed) {
        return NextResponse.json({ error: eligible.message, finalSale: true }, { status: 409 });
      }
      lines.push({
        lineId: orig.lineId, sku: orig.sku || '', name: orig.name, qty,
        reason: chosenReason,
      });
    }
    if (lines.length === 0) return NextResponse.json({ error: 'Pick at least one item to return.' }, { status: 400 });

    const value = lines.reduce((sum, rl) => {
      const orig = (order.lines || []).find((l: any) => l.lineId === rl.lineId);
      return sum + rl.qty * (orig ? effectiveUnitCents(orig) : 0);
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
      meta: { returnId: retRef.id, units: lines.reduce((a, l) => a + l.qty, 0), selfServe: true, ...(client ? { client } : {}) },
    });
    await batch.commit();

    /* The label chain-link. The return-label route was fully built — policy-
     * aware, cost-recording, customer-emailing, billed only on carrier scan —
     * and nothing customer-side ever called it. Handing back the returnId
     * (plus whether this order shipped) lets the order page fire it the
     * moment the return opens, so a shipped order's return STARTS with a
     * label in hand instead of a shrug. */
    return NextResponse.json({
      ok: true,
      returnId: retRef.id,
      shipped: order.method === 'ship' && !!order.shippingAddress,
      message: order.method === 'ship' && order.shippingAddress
        ? 'Return started \u2014 your prepaid return label is on its way to this page and your email.'
        : 'Return started. Bring the items by and the shop will verify and finish it \u2014 you can watch progress right here.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || 'Request failed').slice(0, 200) }, { status: 500 });
  }
}
