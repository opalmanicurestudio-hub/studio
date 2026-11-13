// src/app/api/counter/ahead/route.ts — ORDERING AHEAD, the guest's side (public). lib/counter-ahead.
//   menu  { tenantId }                                  → on or off, how they can pick up, the times, the menu
//   place { tenantId, key, lines, name, way, at }       → the order (not paid yet) and the secure form's key for its payment
//   done  { tenantId, o, s }                            → after the form says it went through: asked of the card company
//   track { tenantId, o, s }                            → how it's going (paid, the pickup code, being made, ready)
//   here  { tenantId, o, s }                            → "I'm here": the kitchen starts now if it was waiting
// An order's link is signed for that order: it opens nothing else.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { aheadMenu, placeAhead, settleAhead, aheadView, aheadHere, aheadSigOk } from '@/lib/counter-ahead';
import { ensureWalletDomainsSoon } from '@/lib/wallet-domains';
import { closedReply } from '@/lib/tenant-open-server';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const BAD_LINK = 'This link doesn’t work. Check the link you were sent.';

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
    if (!ID.test(tenantId) || !['menu', 'place', 'done', 'track', 'here'].includes(action)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const orderId = String(b.o || '');
    // An order's own link: its signature first (it can't be guessed), so made-up links never use up the business's allowance.
    if (['done', 'track', 'here'].includes(action) && (!ID.test(orderId) || !aheadSigOk(tenantId, orderId, b.s))) return reply({ ok: false, error: BAD_LINK }, 404);
    // An order's own (signed) link is limited per address only, generously: its page asks every few seconds, and a busy
    // day's pages must never use up the business's allowance (nor keep a guest from hearing their payment went through).
    const slow = await limitPublic(req, action === 'place' ? 'order_ahead_place' : action === 'menu' ? 'order_ahead' : 'order_ahead_link', tenantId,
      action === 'place' ? { perHour: 60, perDay: 3000 } : action === 'menu' ? { perHour: 600, perDay: 50000 } : { perHour: 6000, perDay: 0 });
    if (slow) return slow;
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data();
    if (!tenant) return reply({ ok: false, error: 'This page isn’t here.' }, 404);
    // A paused or closed business takes no new orders (an order already paid can still be followed and picked up).
    if (action === 'menu' || action === 'place') { const closed = closedReply(tenant); if (closed) return closed; }
    if (action === 'menu') {
      const r = await aheadMenu(db, tenantId, tenant);
      // Apple Pay and Google Pay on this page: the business's address registered, if it isn't yet (never waits long).
      if (r.on) await ensureWalletDomainsSoon(db, tenantId, tenant, null, 1500);
      return reply(r);
    }
    if (action === 'place') { const r: any = await placeAhead(db, tenantId, tenant, b); return reply(r, r.ok ? 200 : r.status); }
    if (action === 'track') {
      // Still waiting on its payment: asked of the card company too (the page may have stopped asking before it went through).
      const o: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
      if (o?.channel === 'ahead' && !o.paidAt && o.ahead?.state === 'awaiting_pay' && o.ahead?.payId) await settleAhead(db, tenantId, tenant, orderId, String(o.ahead.payId)).catch(() => null);
      const r: any = await aheadView(db, tenantId, tenant, orderId); return reply(r, r.ok ? 200 : r.status);
    }
    if (action === 'here') { const r: any = await aheadHere(db, tenantId, orderId); return reply(r, r.ok ? 200 : r.status); }
    // done: whatever the page says, it's the card company that's asked.
    const o: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
    if (!o || o.channel !== 'ahead') return reply({ ok: false, error: BAD_LINK }, 404);
    if (o.paidAt && o.cardPaymentId === o.ahead?.payId) return reply({ ok: true, paid: true });
    if (!o.ahead?.payId) return reply({ ok: false, error: 'That payment didn’t start. Try again.' }, 409);
    const r: any = await settleAhead(db, tenantId, tenant, orderId, String(o.ahead.payId));
    if (!r.ok) return reply({ ok: false, error: r.error }, r.status);
    if (r.notKept) return reply({ ok: false, notKept: true, error: `${r.why} Your payment is going back to your card. It can take a few days to show.` }, 409);
    if (r.pending) return reply({ ok: false, pending: true, error: 'Your payment is still going through.' }, 202);
    if (!r.paid) return reply({ ok: false, error: 'That payment was called off. Start your order again.' }, 409);
    return reply({ ok: true, paid: true });
  } catch (e: any) {
    console.error('[counter/ahead] failed', e?.message);
    return reply({ ok: false, error: 'Something went wrong. Try again in a moment.' }, 500);
  }
}
