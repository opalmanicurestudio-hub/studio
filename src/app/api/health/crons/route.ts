// src/app/api/health/crons/route.ts — for an outside uptime monitor: 200 while the every-5-minutes job is running,
// 503 when it's more than 20 minutes late. The in-app watchdog (lib/cron-heartbeat watchCrons) can't notice if ALL
// scheduled jobs stop at once — an outside monitor pinging this every few minutes can. Says nothing private.
import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const d: any = (await getAdminDb().doc('platformHealth/cron_no-shows').get()).data() || {};
    const last = Date.parse(d.lastRunAt || ''); const ageMin = Number.isFinite(last) ? Math.round((Date.now() - last) / 60000) : null;
    const ok = ageMin !== null && ageMin <= 20;
    return NextResponse.json({ ok, lastRunMinutesAgo: ageMin }, { status: ok ? 200 : 503 });
  } catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
