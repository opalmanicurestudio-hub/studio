// src/app/api/cron/push/route.ts — PHONES BUZZ WITHIN A MINUTE for every app notification (Vercel Cron, every minute).
// Urgent ones are already pushed the moment they're saved (lib/push pushNow); this catches everything else — including
// notifications created in the browser. Each is claimed once, so nothing ever buzzes twice.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminMessaging } from '@/lib/firebase-admin';
import { pushNewNotifications } from '@/lib/push';
import { linkOrigin } from '@/lib/app-origin';
import { recordCronRun } from '@/lib/cron-heartbeat';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); let sent = 0; const errors: string[] = [];
  let messaging: any = null;
  try { messaging = getAdminMessaging(); } catch (e: any) { errors.push(`messaging: ${String(e?.message || e).slice(0, 200)}`); }
  if (messaging) for (const t of (await db.collection('tenants').get()).docs) {
    try { sent += await pushNewNotifications(db, messaging, t.id, t.data() || {}, linkOrigin(t.data() || {})); }
    catch (e: any) { errors.push(`${t.id}: ${String(e?.message || e).slice(0, 160)}`); }   // shown on the health record, not swallowed
  }
  await recordCronRun('push', { sent, errors: errors.slice(0, 10) });
  return NextResponse.json({ ok: true, sent });
}
