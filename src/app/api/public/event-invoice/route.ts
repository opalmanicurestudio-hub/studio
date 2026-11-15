// src/app/api/public/event-invoice/route.ts — THE CLIENT'S FINAL INVOICE (lib/event-invoice-server; the page at
// /event-invoice/[tenantId]/[token]). Opened by its link's key; no sign-in.
//   view { tenantId, token }             → the business, the event, the lines and what's left to pay.
//   pay { tenantId, token, expectCents } → a card checkout for what's left, on the business's own account (refused, to be
//                                          read again, when it isn't what the client saw).
//   paid { tenantId, token, sessionId }  → back from paying: the payment recorded (once).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { finishInvoice, payInvoice, publicInvoice, TOKEN } from '@/lib/event-invoice-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });
const LIMITS: Record<string, { perHour: number; perDay: number }> = { view: { perHour: 120, perDay: 600 }, pay: { perHour: 20, perDay: 60 }, paid: { perHour: 60, perDay: 300 } };
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const token = String(b.token || ''); const action = String(b.action || 'view');
  if (!ID.test(tenantId) || !TOKEN.test(token)) return bad('This invoice link isn’t right. Check it against the email.', 404);
  if (!LIMITS[action]) return bad('Unknown action.');
  const limited = await limitPublic(req, `event-invoice-${action}`, tenantId, LIMITS[action]); if (limited) return limited;
  const db = getAdminDb();
  try {
    if (action === 'pay') {
      const r = await payInvoice(db, stripe(), tenantId, token, req.nextUrl.origin, Number.isInteger(b.expectCents) ? Number(b.expectCents) : undefined);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status });
      return NextResponse.json({ ok: true, url: r.url });
    }
    if (action === 'paid') {
      const sessionId = String(b.sessionId || '');
      const r = await finishInvoice(db, stripe(), tenantId, sessionId);
      if (!r.ok && r.error === 'retry') return bad('We’re still confirming your payment. This page will update in a moment.', 503);
    }
    const inv = await publicInvoice(db, tenantId, token);
    if (!inv) return bad('This invoice isn’t here any more.', 404);
    return NextResponse.json({ ok: true, invoice: inv }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[public/event-invoice]', e);
    return bad('This didn’t load just now. Try again in a moment.', 500);
  }
}
