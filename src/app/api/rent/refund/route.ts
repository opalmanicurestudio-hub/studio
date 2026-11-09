// src/app/api/rent/refund/route.ts — REFUND A RENTER'S CARD PAYMENT from their account (lib/renter-refund).
// GET lists what they paid by card from their account (rent online, autopay, agreed charges from the card on file) with
// what can still go back from each. POST refunds part or all of one, to the same card, and records it once.
// Only someone allowed to give refunds at checkout can do it.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { renterCardPayments, refundRenterPayment, locatePayment } from '@/lib/renter-refund';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';

const clip = (v: any, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const stripeClient = () => new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: '2024-06-20' as any });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = clip(sp.get('tenantId'), 120);
  const g = await requireCan(req, tenantId, 'checkout.refund'); if (g.deny) return g.deny;
  const renterId = clip(sp.get('renterId'), 120).replace(/[^A-Za-z0-9_-]/g, '');
  if (!renterId) return NextResponse.json({ ok: false, error: 'Which renter?' }, { status: 400 });
  const db = getAdminDb();
  const payments = await renterCardPayments(db, tenantId, renterId);
  // The card each recent one was paid with, as Stripe has it (a few at a time; the list works without it).
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const stripe = stripeClient();
  await Promise.all(payments.filter((p) => p.refundableCents > 0 && !p.card).slice(0, 8).map(async (p) => {
    try {
      const t: any = (await db.doc(`tenants/${tenantId}/transactions/${p.id}`).get()).data() || {};
      const w = await locatePayment(stripe, tenant, t);
      if (w.ok) p.card = w.card;
    } catch { /* shown without the card */ }
  }));
  return NextResponse.json({ ok: true, payments: payments.slice(0, 40) });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = clip(b.tenantId, 120);
  const g = await requireCan(req, tenantId, 'checkout.refund'); if (g.deny) return g.deny;
  const renterId = clip(b.renterId, 120).replace(/[^A-Za-z0-9_-]/g, '');
  if (!renterId) return NextResponse.json({ ok: false, error: 'Which renter?' }, { status: 400 });
  const db = getAdminDb();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const r = await refundRenterPayment(db, stripeClient(), tenantId, tenant, {
    renterId, transactionId: clip(b.transactionId, 160), amountCents: Math.round(Number(b.amountCents) || 0),
    reason: clip(b.reason, 300), stillOwed: b.stillOwed === true, requestId: clip(b.requestId, 80),
    by: (g.actor as any)?.name || null, today: todayIn(tenantTimeZone(tenant)),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, ...(r.retry ? { retry: true } : {}) }, { status: r.status });
  return NextResponse.json(r);
}
