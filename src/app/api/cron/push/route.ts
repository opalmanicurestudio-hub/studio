// src/app/api/cron/push/route.ts — PHONES BUZZ WITHIN A MINUTE for every app notification (Vercel Cron, every minute).
// Urgent ones are already pushed the moment they're saved (lib/push pushNow); this catches everything else — including
// notifications created in the browser. Each is claimed once, so nothing ever buzzes twice.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminMessaging } from '@/lib/firebase-admin';
import { pushNewNotifications } from '@/lib/push';
import { linkOrigin } from '@/lib/app-origin';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { forEachTenant } from '@/lib/cron-fanout';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); let sent = 0; const errors: string[] = [];
  let messaging: any = null;
  try { messaging = getAdminMessaging(); } catch (e: any) { errors.push(`messaging: ${String(e?.message || e).slice(0, 200)}`); }
  // Several businesses at once, within the time limit, resuming where the last run stopped (lib/cron-fanout).
  if (messaging) await forEachTenant(db, 'push', async (t) => {
    try { sent += await pushNewNotifications(db, messaging, t.id, t.data, linkOrigin(t.data)); }
    catch (e: any) { errors.push(`${t.id}: ${String(e?.message || e).slice(0, 160)}`); }   // shown on the health record, not swallowed
  }, { concurrency: 8, budgetMs: 40_000 });
  await recordCronRun('push', { sent, errors: errors.slice(0, 10) });
  // Is the every-5-minutes job still running? (emails the platform admins if not)
  try { const { watchCrons } = await import('@/lib/cron-heartbeat'); await watchCrons(); } catch { /* never block pushes */ }
  return NextResponse.json({ ok: true, sent });
}
