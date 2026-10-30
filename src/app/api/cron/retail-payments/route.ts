// src/app/api/cron/retail-payments/route.ts — EVERY 5 MIN (Vercel Cron + CRON_SECRET): every shop order still 'placed'
// (older than 90 s, so Stripe's own notification gets first go) is checked with Stripe — paid ones complete and appear
// on the orders board; abandoned ones close. Unanswered swap questions past their time become refunds; pickup reminders, back-in-stock emails and review emails go out. Nothing depends on the customer keeping their page open.
// Card reader payments at the desk that never got their answer are settled too (lib/reader-sale), and so is every other
// payment or refund whose answer from Stripe was lost: recorded when it went through, let go when it didn't
// (lib/money-sweep).
import { getRetailSecrets } from '@/lib/retail-secrets';
import { heartbeat } from '@/lib/account-health';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { confirmRetailPayment } from '@/lib/retail-payment-check';
import { expireSwapOffers } from '@/lib/retail-swap-server';
import { sendRestockAlerts } from '@/lib/restock-alerts';
import { sweepUncollected } from '@/lib/retail-uncollected';
import { sweepReaderPayments } from '@/lib/reader-sale';
import { sweepAddressPays } from '@/lib/address-pay';
import { sweepRetryPays } from '@/lib/delivery-retry-server';
import { sweepDriverLocations } from '@/lib/delivery-live-server';
import { sweepReviewAsks } from '@/lib/reviews-server';
import { finishPaidOrder } from '@/lib/retail-webhook';
import { shareOrderTip } from '@/lib/order-tips';
import { sweepMoneyOnTheWay } from '@/lib/money-sweep';
import { sweepDueGifts } from '@/lib/digital-gift-server';
import { drainOutbox } from '@/lib/order-outbox';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const counts: Record<string, number> = { paid: 0, expired: 0, waiting: 0, skipped: 0, failed: 0, swapsRefunded: 0, restockEmails: 0, pickupReminders: 0, readerChecked: 0, readerCaptured: 0, readerReleased: 0, addressPays: 0, finished: 0, tipsShared: 0,
    moneyChecked: 0, moneyRecorded: 0, moneyReleased: 0, moneyWaiting: 0, moneyFailed: 0 };
  // Order messages that didn't go the first time, tried again (lib/order-outbox): first, so a long run of shops can't
  // hold them up.
  const startedAt = Date.now(); let messages: Record<string, number> = {};
  try { messages = await drainOutbox(db, String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin, { budgetMs: 10e3 }); } catch (e: any) { console.error('[cron/retail-payments] messages', String(e?.message || e).slice(0, 160)); }
  // Several businesses at once, within the time limit, resuming where the last run stopped (lib/cron-fanout).
  const run = await forEachTenant(db, 'retail-payments', async (t) => {
    const tenant: any = t.data;
    // Shippo key and wholesale code off the public business record (lib/retail-secrets; a no-op once moved).
    try { const rsx = tenant.retailSettings || {}; if ('shippoApiKey' in rsx || 'wholesaleAccessCode' in rsx) await getRetailSecrets(db, t.id, tenant); } catch { /* next run */ }
    // Payments and refunds whose answer was lost: after the shop's own work below, and for a business without its own
    // payments account too (booth rent and extras go through the platform's).
    const money = async () => { try { const m = await sweepMoneyOnTheWay(db, t.id, tenant); counts.moneyChecked += m.checked; counts.moneyRecorded += m.recorded; counts.moneyReleased += m.released; counts.moneyWaiting += m.waiting; counts.moneyFailed += m.failed.length; } catch { /* next run */ } };
    // Drivers who stopped sending mid-route (lib/delivery-live-server): where they were isn't kept.
    try { counts.driversCleared = (counts.driversCleared || 0) + await sweepDriverLocations(db, t.id); } catch { /* next run */ }
    if (!tenant.stripeAccountId && !tenant.stripeConnectAccountId) { await money(); return; }
    // Payments for a new address nobody came back from: the change goes on, or the payment page closes (lib/address-pay).
    try { counts.addressPays = (counts.addressPays || 0) + await sweepAddressPays(db, t.id, tenant); } catch { /* next run */ }
    // Payments for another delivery try nobody came back from, and their refunds (lib/delivery-retry-server).
    try { counts.retryPays = (counts.retryPays || 0) + await sweepRetryPays(db, t.id, tenant); } catch { /* next run */ }
    // Card reader payments the desk never heard back about: captured, recorded or released (lib/reader-sale).
    try { const r = await sweepReaderPayments(db, t.id, tenant); counts.readerChecked += r.checked; counts.readerCaptured += r.captured; counts.readerReleased += r.released; } catch { /* next run */ }
    // Swap questions nobody answered in time become refunds, so the order isn't held up.
    try { counts.swapsRefunded += await expireSwapOffers(db, t.id); } catch { /* next run */ }
    // Pickup reminders for ready orders nobody has collected (each sent once).
    try { counts.pickupReminders += await sweepUncollected(db, t.id, String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')); } catch { /* next run */ }
    // Downloads bought as gifts whose day has come (each sent once).
    try { counts.giftsSent = (counts.giftsSent || 0) + await sweepDueGifts(db, t.id); } catch { /* next run */ }
    // Back-in-stock emails for anything that can be bought online again.
    try { counts.restockEmails += await sendRestockAlerts(db, t.id, String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')); } catch { /* next run */ }
    const orders = (await db.collection(`tenants/${t.id}/retailOrders`).where('stage', '==', 'placed').limit(100).get().catch(() => ({ docs: [] as any[] }))).docs;
    for (const d of orders) {
      const o: any = d.data() || {}; const placed = Date.parse(o.placedAt || o.createdAt || '') || 0;
      if (!o.stripeCheckoutSessionId || Date.now() - placed < 90000) continue;
      try { counts[await confirmRetailPayment(db, t.id, tenant, d.ref, o)]++; } catch (e: any) { counts.failed++; console.error('[cron/retail-payments]', t.id, d.id, String(e?.message || e).slice(0, 160)); }
    }
    // Orders paid in the last two days whose follow-up (the receipt, points, the promo count) didn't finish, because the
    // request that paid them was cut off: finished now, each part once (lib/retail-webhook finishPaidOrder). Only
    // orders paid in one step (booksAt) are looked at, so orders paid before then are never sent a second receipt.
    try {
      const since = new Date(Date.now() - 2 * 864e5).toISOString();
      const recent = (await db.collection(`tenants/${t.id}/retailOrders`).where('paidAt', '>=', since).limit(200).get().catch(() => ({ docs: [] as any[] }))).docs;
      for (const d of recent) {
        const o: any = d.data() || {};
        if (!o.booksAt || o.afterPaidAt || Date.now() - (Date.parse(String(o.paidAt || '')) || 0) < 120000) continue;
        try { await finishPaidOrder(db, t.id, d.id); counts.finished++; } catch (e: any) { console.error('[cron/retail-payments] finish', t.id, d.id, String(e?.message || e).slice(0, 160)); }
      }
    } catch { /* next run */ }
    // Tips on orders that went out in the last two weeks and weren't shared yet (the screen's ask didn't arrive): shared
    // with the people who fulfilled them now, once each (lib/order-tips).
    try {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const gone = (await db.collection(`tenants/${t.id}/retailOrders`).where('completedAt', '>=', since).limit(300).get().catch(() => ({ docs: [] as any[] }))).docs;
      for (const d of gone) {
        const o: any = d.data() || {};
        if (!((Number(o.tipCents) || 0) > 0) || o.tipSharedAt || Date.now() - (Date.parse(String(o.completedAt || '')) || 0) < 120000) continue;
        try { const r = await shareOrderTip(db, t.id, d.id); if (r === 'shared' || r === 'unassigned') counts.tipsShared++; } catch (e: any) { console.error('[cron/retail-payments] tip', t.id, d.id, String(e?.message || e).slice(0, 160)); }
      }
    } catch { /* next run */ }
    // Review emails after pickup or delivery, for a shop that turned them on (lib/reviews-server, once an hour): after
    // the payment work, and given only a few seconds, so they never hold up a payment.
    try { counts.reviewAsks = (counts.reviewAsks || 0) + await sweepReviewAsks(db, t.id, tenant, String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin, { budgetMs: 8e3 }); } catch (e: any) { console.error('[cron/retail-payments] review asks', t.id, String(e?.message || e).slice(0, 160)); }
    await money();
  }, { startedAt });   // the shops share the run's time with the messages above
  await heartbeat(db, 'retail-payments');   // HQ's account check uses this to spot a stopped task
  return NextResponse.json({ ok: true, ...counts, messages, businesses: run.done, of: run.total, resumesAt: run.ranOut ? run.nextStart : null });
}
