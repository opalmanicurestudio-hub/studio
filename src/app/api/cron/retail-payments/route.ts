// src/app/api/cron/retail-payments/route.ts — EVERY 5 MIN (Vercel Cron + CRON_SECRET): every shop order still 'placed'
// (older than 90 s, so Stripe's own notification gets first go) is checked with Stripe — paid ones complete and appear
// on the orders board; abandoned ones close. Nothing depends on the customer keeping their page open.
import { heartbeat } from '@/lib/account-health';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { confirmRetailPayment } from '@/lib/retail-payment-check';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const counts: Record<string, number> = { paid: 0, expired: 0, waiting: 0, skipped: 0, failed: 0 };
  for (const t of (await db.collection('tenants').get()).docs) {
    const tenant: any = t.data() || {}; if (!tenant.stripeAccountId && !tenant.stripeConnectAccountId) continue;
    const orders = (await db.collection(`tenants/${t.id}/retailOrders`).where('stage', '==', 'placed').limit(100).get().catch(() => ({ docs: [] as any[] }))).docs;
    for (const d of orders) {
      const o: any = d.data() || {}; const placed = Date.parse(o.placedAt || o.createdAt || '') || 0;
      if (!o.stripeCheckoutSessionId || Date.now() - placed < 90000) continue;
      try { counts[await confirmRetailPayment(db, t.id, tenant, d.ref, o)]++; } catch (e: any) { counts.failed++; console.error('[cron/retail-payments]', t.id, d.id, String(e?.message || e).slice(0, 160)); }
    }
  }
  await heartbeat(db, 'retail-payments');   // HQ's account check uses this to spot a stopped task
  return NextResponse.json({ ok: true, ...counts });
}
