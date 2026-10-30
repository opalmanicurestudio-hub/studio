// /api/retail/delivery-choice — WHAT THE CUSTOMER WANTS WHEN A DELIVERY COULDN'T BE MADE (mockup 7B; the rules are
// lib/delivery-retry, carried out by lib/delivery-retry-server). From their order page, with the order's link:
//   { action: 'windows' }                 the open windows another try can go in, and what it costs
//   { action: 'retry', key }              another try in that window: booked now when free, else { url } to pay
//   { action: 'retry_paid', sessionId }   back from paying: the try is booked (the paid Stripe page is its own proof)
//   { action: 'retry_cancel' }            they left the payment page: it closes and the place in the window goes back
//   { action: 'pickup' }                  they'll pick it up at the shop instead
//   { action: 'note', note }              their note for the driver, changed before or while it's on its way (mockup 1C;
//                                         the driver's app shows it as it changes)
// Cancelling is api/retail/self-serve's cancel, which knows a failed delivery. Booking a try, leaving its payment and
// switching to pickup take the customer's pass too (lib/order-pass), like any change to how they get their order.
import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkPass } from '@/lib/order-pass';
import { syncTracking } from '@/lib/order-tracking';
import { deliveryFrom } from '@/lib/delivery-plan';
import { canChoose, retryCents, retryPayOpen } from '@/lib/delivery-retry';
import { cancelRetryPay, chooseRetry, finishRetryPay, retryWindows, switchToPickup } from '@/lib/delivery-retry-server';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ACTIONS = ['windows', 'retry', 'retry_paid', 'retry_cancel', 'pickup', 'note'];
const NEEDS_PASS = ['retry', 'retry_cancel', 'pickup', 'note'];
const bad = (error: string, status = 400, extra: Record<string, any> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  const qrToken = String(b.qrToken || '').trim(); const action = String(b.action || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !qrToken || !ACTIONS.includes(action)) return bad('Missing order details.');
  const res = await handle(req, b, tenantId, orderId, qrToken, action);
  // The order page shows what this changed as it happens (lib/order-tracking).
  if (res.status < 400) { const job = async () => { await syncTracking(getAdminDb(), tenantId, orderId); }; try { after(job); } catch { void job(); } }
  return res;
}

async function handle(req: NextRequest, b: any, tenantId: string, orderId: string, qrToken: string, action: string): Promise<NextResponse> {
  const db = getAdminDb();
  const [oSnap, tSnap] = await Promise.all([db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const order: any = oSnap.exists ? oSnap.data() : null;
  if (!order || String(order.qrToken || '') !== qrToken) return bad('Not authorized.', 403);
  const tenant: any = tSnap.exists ? tSnap.data() : {};
  if (NEEDS_PASS.includes(action) && !checkPass(tenantId, qrToken, b.pass)) {
    return bad('To change how you get your order, first confirm it’s you. We’ll send a code to the email or mobile on your order.', 401, { code: 'pass_needed' });
  }
  try {
    if (action === 'windows') {
      if (!canChoose(order)) return NextResponse.json({ ok: true, windows: [], cents: 0, open: false });
      const cents = retryCents(order, deliveryFrom(tenant.retailSettings));
      const ws = await retryWindows(db, tenantId, tenant, Date.now(), { paid: cents > 0 });
      if (!ws.ok) return NextResponse.json({ ok: true, windows: [], cents, open: true, message: ws.message });
      return NextResponse.json({ ok: true, open: true, cents, windows: ws.windows.map((w) => ({ key: w.key, label: w.label, few: w.left !== null && w.left <= 2 })) });
    }
    if (action === 'retry') {
      const r = await chooseRetry(db, tenantId, tenant, orderId, String(b.key || '').slice(0, 24), linkOrigin(tenant, req.nextUrl.origin));
      if (!r.ok) return bad(r.error, r.status);
      return NextResponse.json(r);
    }
    if (action === 'retry_paid') {
      const r = await finishRetryPay(db, tenantId, orderId, String(b.sessionId || '').slice(0, 200), { tenant });
      return NextResponse.json(r, { status: r.result === 'not_found' ? 404 : 200 });
    }
    if (action === 'retry_cancel') return NextResponse.json(await cancelRetryPay(db, tenantId, orderId, { tenant }));
    if (action === 'note') {
      if (!deliveryFrom(tenant.retailSettings).dropoffNotes) return bad('This shop doesn’t take notes for the driver. Send the shop a message on this page instead.', 409);
      const note = String(b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
      const r = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(ref)).data() || {};
        if (cur.method !== 'delivery' || !['waiting', 'out'].includes(String(cur.delivery?.status || 'waiting')) || ['completed', 'cancelled', 'placed'].includes(String(cur.stage || ''))) return { ok: false };
        if (String(cur.delivery?.note || '') === note) return { ok: true, same: true };
        const now = new Date().toISOString();
        tx.update(ref, { 'delivery.note': note, 'delivery.noteChangedAt': now });
        const ev = ref.collection('events').doc();
        tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: 'customer', actorName: cur.customerName || 'Customer', meta: { kind: 'delivery_note', text: note ? `Changed the note for the driver: “${note}”` : 'Took off the note for the driver' } });
        return { ok: true };
      });
      if (!r.ok) return bad('The note can’t be changed now. Send the shop a message on this page instead.', 409);
      return NextResponse.json({ ok: true, note, message: note ? 'Your driver sees the new note.' : 'The note is off.' });
    }
    // Pick it up instead: a payment page left open for another try closes first (paid meanwhile, the try is booked).
    if (retryPayOpen(order)) {
      const f = await cancelRetryPay(db, tenantId, orderId, { tenant });
      if (f.result === 'applied' || f.result === 'pending') return bad(f.message, 409);
    }
    const r = await switchToPickup(db, tenantId, tenant, orderId);
    if (!r.ok) return bad(r.error, r.status);
    // The order's own delivery fee owed back (it failed on the shop's side) goes back now, as a shipping refund; if it
    // can't, it waits on the orders board for the team.
    let sent = r.sent;
    if (r.back && r.back.from === 'order') {
      try {
        const rr = await fetch(`${req.nextUrl.origin}/api/retail/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': String(process.env.CRON_SECRET || '') },
          body: JSON.stringify({ tenantId, orderId, qrToken, reason: 'delivery_fee_back' }) });
        sent = rr.ok;
      } catch { /* stays queued on the board */ }
    }
    const fee = r.back ? `$${(r.back.cents / 100).toFixed(2)}` : '';
    return NextResponse.json({ ok: true, message: `It’s ready for you at the shop. Bring your pickup code.${r.back ? ` Your ${fee} delivery fee ${sent ? 'was refunded' : 'will be refunded'} to your card.` : ''}` });
  } catch (e: any) {
    console.error('[delivery-choice]', action, String(e?.message || e).slice(0, 200));
    return bad('That didn’t go through. Try again in a moment.', 500);
  }
}
