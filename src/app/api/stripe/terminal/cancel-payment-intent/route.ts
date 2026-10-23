// src/app/api/stripe/terminal/cancel-payment-intent/route.ts — CALL OFF A CARD READER PAYMENT THAT HASN'T GONE THROUGH
// (staff). The desk uses it when the screen couldn't confirm a payment and they want to take it another way: the payment
// is cancelled, so it can never complete later, and any hold on the card is released. One that already went through
// isn't touched: the answer says it was charged, and a sale's payment is marked on its ticket so the desk records the
// sale with it instead of charging again (lib/reader-sale).
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import { getAdminDb } from '@/lib/firebase-admin';
import { accountOf, markReaderSalePaid, readerStripe, releaseReaderPayment } from '@/lib/reader-sale';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); const paymentIntentId = String(b.paymentIntentId || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80);
    const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
    if (!tenantId || !paymentIntentId) return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    const db = getAdminDb();
    const tenant: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const acct = accountOf(tenant); const stripe = readerStripe();
    if (!acct || !stripe) return NextResponse.json({ ok: false, error: 'Card payments aren’t set up for this business.' }, { status: 400 });
    // Only a payment started on the card reader is ever called off here (never one on the client screen or a typed card).
    const r = await releaseReaderPayment(stripe, acct, paymentIntentId, tenantId, { readerOnly: true });
    if (r.status === 'unknown') return NextResponse.json({ ok: false, status: 'unknown', error: r.error }, { status: 503 });
    if (r.status === 'other') return NextResponse.json({ ok: false, status: 'other', error: r.error || 'That isn’t a card reader payment.' }, { status: 409 });
    const meta: any = r.pi?.metadata || {};
    const ticket = meta.kind === 'sale' && meta.pendingId ? String(meta.pendingId) : '';
    if (r.ok) {
      if (ticket) await db.doc(`tenants/${tenantId}/pendingCheckouts/${ticket}`).set({ readerPis: { [paymentIntentId]: { state: 'released', settledAt: new Date().toISOString(), releasedBy: g.actor?.name || null } }, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
      return NextResponse.json({ ok: true, released: true });
    }
    if (r.charged) {
      if (r.refunded) return NextResponse.json({ ok: false, charged: false, refunded: true, paymentIntentId, error: 'That card payment was refunded, so it can’t pay for this sale. Take the payment again.' }, { status: 409 });
      let sale: any = null;
      if (ticket) sale = (await markReaderSalePaid(db, tenantId, ticket, r.pi).catch(() => null))?.result || null;
      return NextResponse.json({ ok: false, charged: true, paymentIntentId, amountCents: Math.round(Number(r.pi?.amount_received || r.pi?.amount) || 0), sale, error: 'This card payment already went through.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, status: r.status, error: r.error || 'The payment couldn’t be cancelled.' }, { status: r.status === 'processing' ? 202 : 409 });
  } catch (err: any) {
    console.error('[terminal/cancel-payment-intent]', err);
    return NextResponse.json({ ok: false, error: 'The payment couldn’t be cancelled. Try again.' }, { status: 500 });
  }
}
