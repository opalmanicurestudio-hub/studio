// POST /api/events/tickets — THE BUSINESS REFUNDS TICKETS FOR ONE OF ITS EVENTS (lib/event-tickets). Managers only.
//   { tenantId, action: 'refund', orderId }      → one order: back to the card, its guests off the list, in the books
//   { tenantId, action: 'refund-all', eventId }  → every paid order for the event (when it's canceled)
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { refundTicketOrder } from '@/lib/event-tickets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b?.tenantId || '');
  if (!ID.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Card payments aren’t set up here.' }, { status: 503 });
  const db = getAdminDb(); const by = String(g.actor?.name || '') || null;
  try {
    if (b.action === 'refund') {
      const r = await refundTicketOrder(db, stripe(), tenantId, String(b.orderId || ''), by);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: r.status });
    }
    if (b.action === 'refund-all') {
      const eventId = String(b.eventId || ''); if (!ID.test(eventId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
      const orders = (await db.collection(`tenants/${tenantId}/eventTicketOrders`).where('eventId', '==', eventId).get()).docs.filter((d: any) => d.data()?.status === 'paid');
      let refunded = 0, cents = 0; const failed: string[] = [];
      for (const d of orders) {
        const r = await refundTicketOrder(db, stripe(), tenantId, d.id, by);
        if (r.ok) { refunded++; cents += r.refundedCents; } else failed.push(String(d.data()?.name || d.id));
      }
      return NextResponse.json({ ok: failed.length === 0, refunded, refundedCents: cents, failed, ...(failed.length ? { error: `${failed.length} ${failed.length === 1 ? 'order wasn’t' : 'orders weren’t'} refunded. Try again in a moment.` } : {}) });
    }
    return NextResponse.json({ ok: false, error: 'Unknown request.' }, { status: 400 });
  } catch (e: any) {
    console.error('[events/tickets]', e?.message || e);
    return NextResponse.json({ ok: false, error: 'Something went wrong. Try again in a moment.' }, { status: 500 });
  }
}
