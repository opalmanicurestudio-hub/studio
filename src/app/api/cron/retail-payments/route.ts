// src/app/api/cron/retail-payments/route.ts — EVERY 5 MIN (Vercel Cron + CRON_SECRET): every shop order still 'placed'
// (older than 90 s, so Stripe's own notification gets first go) is checked with Stripe — paid ones complete and appear
// on the orders board; abandoned ones close. Unanswered swap questions past their time become refunds; pickup reminders and back-in-stock emails go out. Nothing depends on the customer keeping their page open.
import { getRetailSecrets } from '@/lib/retail-secrets';
import { heartbeat } from '@/lib/account-health';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { confirmRetailPayment } from '@/lib/retail-payment-check';
import { expireSwapOffers } from '@/lib/retail-swap-server';
import { sendRestockAlerts } from '@/lib/restock-alerts';
import { sweepUncollected } from '@/lib/retail-uncollected';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const counts: Record<string, number> = { paid: 0, expired: 0, waiting: 0, skipped: 0, failed: 0, swapsRefunded: 0, restockEmails: 0, pickupReminders: 0 };
  // Several businesses at once, within the time limit, resuming where the last run stopped (lib/cron-fanout).
  const run = await forEachTenant(db, 'retail-payments', async (t) => {
    const tenant: any = t.data;
    // Shippo key and wholesale code off the public business record (lib/retail-secrets; a no-op once moved).
    try { const rsx = tenant.retailSettings || {}; if ('shippoApiKey' in rsx || 'wholesaleAccessCode' in rsx) await getRetailSecrets(db, t.id, tenant); } catch { /* next run */ }
    if (!tenant.stripeAccountId && !tenant.stripeConnectAccountId) return;
    // Swap questions nobody answered in time become refunds, so the order isn't held up.
    try { counts.swapsRefunded += await expireSwapOffers(db, t.id); } catch { /* next run */ }
    // Pickup reminders for ready orders nobody has collected (each sent once).
    try { counts.pickupReminders += await sweepUncollected(db, t.id, String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')); } catch { /* next run */ }
    // Back-in-stock emails for anything that can be bought online again.
    try { counts.restockEmails += await sendRestockAlerts(db, t.id, String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')); } catch { /* next run */ }
    const orders = (await db.collection(`tenants/${t.id}/retailOrders`).where('stage', '==', 'placed').limit(100).get().catch(() => ({ docs: [] as any[] }))).docs;
    for (const d of orders) {
      const o: any = d.data() || {}; const placed = Date.parse(o.placedAt || o.createdAt || '') || 0;
      if (!o.stripeCheckoutSessionId || Date.now() - placed < 90000) continue;
      try { counts[await confirmRetailPayment(db, t.id, tenant, d.ref, o)]++; } catch (e: any) { counts.failed++; console.error('[cron/retail-payments]', t.id, d.id, String(e?.message || e).slice(0, 160)); }
    }
  });
  await heartbeat(db, 'retail-payments');   // HQ's account check uses this to spot a stopped task
  return NextResponse.json({ ok: true, ...counts, businesses: run.done, of: run.total, resumesAt: run.ranOut ? run.nextStart : null });
}
