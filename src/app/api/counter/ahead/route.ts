// src/app/api/counter/ahead/route.ts — ORDERING AHEAD, the guest's side (public). lib/counter-ahead.
//   menu  { tenantId }                                  → on or off, how they can pick up, the times, the menu
//   place { tenantId, key, lines, name, way, at, phone?, join?, textMe?, address?, note?, deliveryToken? } → the order (not
//                                                         paid yet) and the secure form's key for its payment
//   deliveryCheck { tenantId, address, lines, token? }  → delivered by the business's drivers (lib/food-delivery): whether it
//                                                         goes there, the fee, the drive, and the arrival times
//   done  { tenantId, o, s }                            → after the form says it went through: asked of the card company
//   track { tenantId, o, s }                            → how it's going (paid, the pickup code, being made, ready)
//   here  { tenantId, o, s, where?, note?, source?, distanceM? } → "I'm here": the kitchen starts now if it was waiting;
//                                                         curbside says where (or 'geo': their phone found them in the lot)
//   onway { tenantId, o, s, eta?, where? }              → curbside: on their way, about how far, and what they're driving
//   textMe { tenantId, o, s, phone | null }             → one text when it's ready (lib/ready-text), or null: don't text
//   menu_ask { tenantId, question }                     → Klair answers a menu question from the business's recipes and
//                                                         allergen marks only (lib/klair-menu), when the business turns it on
// An order's link is signed for that order: it opens nothing else.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { aheadMenu, placeAhead, settleAhead, aheadView, aheadHere, aheadOnWay, aheadSigOk, linkAheadPoints, deliveryCheck } from '@/lib/counter-ahead';
import { askReadyText } from '@/lib/ready-text';
import { ensureWalletDomainsSoon } from '@/lib/wallet-domains';
import { closedReply } from '@/lib/tenant-open-server';
import { klairSettings } from '@/lib/klair';
import { MAX_QUESTION, menuAnswersOn } from '@/lib/klair-menu';
import { answerGuest } from '@/lib/klair-menu-server';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const BAD_LINK = 'This link doesn’t work. Check the link you were sent.';

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); const action = String(b.action || '');
    if (!ID.test(tenantId) || !['menu', 'place', 'deliveryCheck', 'done', 'track', 'here', 'onway', 'textMe', 'menu_ask'].includes(action)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const orderId = String(b.o || '');
    // An order's own link: its signature first (it can't be guessed), so made-up links never use up the business's allowance.
    if (['done', 'track', 'here', 'onway', 'textMe'].includes(action) && (!ID.test(orderId) || !aheadSigOk(tenantId, orderId, b.s))) return reply({ ok: false, error: BAD_LINK }, 404);
    // An order's own (signed) link is limited per address only, generously: its page asks every few seconds, and a busy
    // day's pages must never use up the business's allowance (nor keep a guest from hearing their payment went through).
    // (An address checked finds it on the map, so it's limited like placing an order.)
    const slow = await limitPublic(req, action === 'place' ? 'order_ahead_place' : action === 'deliveryCheck' ? 'order_ahead_address' : action === 'menu' ? 'order_ahead' : action === 'menu_ask' ? 'order_ahead_ask' : 'order_ahead_link', tenantId,
      action === 'place' || action === 'deliveryCheck' ? { perHour: 60, perDay: 3000 } : action === 'menu' ? { perHour: 600, perDay: 50000 } : action === 'menu_ask' ? { perHour: 120, perDay: 5000 } : { perHour: 6000, perDay: 0 });
    if (slow) return slow;
    const db = getAdminDb();
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data();
    if (!tenant) return reply({ ok: false, error: 'This page isn’t here.' }, 404);
    // A paused or closed business takes no new orders (an order already paid can still be followed and picked up).
    if (action === 'menu' || action === 'place' || action === 'deliveryCheck') { const closed = closedReply(tenant); if (closed) return closed; }
    if (action === 'menu') {
      const r = await aheadMenu(db, tenantId, tenant);
      // Apple Pay and Google Pay on this page: the business's address registered, if it isn't yet (never waits long).
      if (r.on) await ensureWalletDomainsSoon(db, tenantId, tenant, null, 1500);
      return reply(r);
    }
    if (action === 'menu_ask') {
      const K = klairSettings(tenant); if (!menuAnswersOn(tenant, K.on)) return reply({ ok: false, error: 'Ask the team about the menu.' }, 403);
      const question = String(b.question ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION); if (!question) return reply({ ok: false, error: 'Ask about a dish.' }, 400);
      return reply({ ok: true, answer: await answerGuest(db, tenantId, question, 'team'), name: K.name });
    }
    if (action === 'place') { const r: any = await placeAhead(db, tenantId, tenant, b); return reply(r, r.ok ? 200 : r.status); }
    if (action === 'deliveryCheck') { const r: any = await deliveryCheck(db, tenantId, tenant, b); return reply(r, r.ok ? 200 : r.status); }
    if (action === 'track') {
      // Still waiting on its payment: asked of the card company too (the page may have stopped asking before it went through).
      const o: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
      if (o?.channel === 'ahead' && !o.paidAt && o.ahead?.state === 'awaiting_pay' && o.ahead?.payId) await settleAhead(db, tenantId, tenant, orderId, String(o.ahead.payId)).catch(() => null);
      // Paid, with points that didn't go through at the time: tried again.
      if (o?.channel === 'ahead' && o.paidAt && o.ahead?.pointsPhone) await linkAheadPoints(db, tenantId, tenant, orderId, o);
      const r: any = await aheadView(db, tenantId, tenant, orderId); return reply(r, r.ok ? 200 : r.status);
    }
    if (action === 'here') { const r: any = await aheadHere(db, tenantId, orderId, { where: b.where, note: b.note, source: b.source, distanceM: b.distanceM }); return reply(r, r.ok ? 200 : r.status); }
    // A curbside guest on their way: about how far, and what they're driving (lib/counter-ahead aheadOnWay).
    if (action === 'textMe') {
      // Each text costs the business something: a few asks an hour from one place (shared wifi counts as one), and no
      // more a day than orders.
      const few = await limitPublic(req, 'order_ahead_text', tenantId, { perHour: 8, perDay: 3000 }); if (few) return few;
      const o: any = (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data();
      if (!o || o.channel !== 'ahead' || !o.paidAt) return reply({ ok: false, error: 'Once it’s paid, you can ask for a text.' }, 409);
      const r: any = await askReadyText(db, tenantId, tenant, orderId, b.phone === null ? null : b.phone, 'ahead'); return reply(r, r.ok ? 200 : r.status);
    }
    if (action === 'onway') { const r: any = await aheadOnWay(db, tenantId, orderId, { eta: b.eta, where: b.where }); return reply(r, r.ok ? 200 : r.status); }
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
