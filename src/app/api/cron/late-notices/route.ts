// src/app/api/cron/late-notices/route.ts — EVERY HOUR (Vercel Cron + CRON_SECRET): each shop's shipped orders that
// missed the ship-by day their customer was shown tell the customer the next date, with their right to cancel
// (lib/late-notices). At most twice by itself; after that, and for orders held for review, it goes under Needs you.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { heartbeat } from '@/lib/account-health';
import { sweepLateOrders } from '@/lib/late-notices';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb();
  const started = Date.now();
  const counts = { checked: 0, notified: 0, handed: 0 };
  const run = await forEachTenant(db, 'late-notices', async (t) => {
    if (!t.data?.retailSettings?.shipSchedule?.savedAt) return;
    const r = await sweepLateOrders(db, t.id, t.data, { deadline: started + 45000 });
    counts.checked += r.checked; counts.notified += r.notified; counts.handed += r.handed;
    if (r.cutOff) return { again: true };
  }, { concurrency: 4, startedAt: started, budgetMs: 20000 });
  await heartbeat(db, 'late-notices');
  return NextResponse.json({ ok: true, ...counts, businesses: run.done, of: run.total });
}
