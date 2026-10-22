// src/app/api/cron/order-alerts/route.ts — EVERY TEN MINUTES (Vercel Cron + CRON_SECRET): each shop with a shipping
// schedule is checked for the day's order alerts (lib/order-alerts): a big day, orders coming in fast, the cutoff in an
// hour with orders not packed, and orders that missed the pickup. Each goes out at most once a day, to the people who
// get it; phones buzz through the usual alert sender (lib/push). A shop that asked for it also gets one more day for new
// orders while a coming day is over capacity (lib/capacity-check).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { heartbeat } from '@/lib/account-health';
import { checkOrderAlerts } from '@/lib/order-alerts';
import { checkCapacity } from '@/lib/capacity-check';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb();
  const started = Date.now();
  const counts = { alerts: 0, people: 0, moreTime: 0 };
  const run = await forEachTenant(db, 'order-alerts', async (t) => {
    if (!t.data?.retailSettings?.shipSchedule?.savedAt) return;
    try {
      const r = await checkOrderAlerts(db, t.id, t.data);
      counts.alerts += r.sent; counts.people += r.people;
    } catch (e: any) { console.error('[cron/order-alerts]', t.id, String(e?.message || e).slice(0, 200)); }
    // A shop that turned on "Give new orders more time by itself" (lib/capacity-check).
    try { if ((await checkCapacity(db, t.id, t.data)).added) counts.moreTime++; }
    catch (e: any) { console.error('[cron/order-alerts] capacity', t.id, String(e?.message || e).slice(0, 200)); }
  }, { concurrency: 6, startedAt: started, budgetMs: 40000 });
  await heartbeat(db, 'order-alerts');
  return NextResponse.json({ ok: true, ...counts, businesses: run.done, of: run.total });
}
