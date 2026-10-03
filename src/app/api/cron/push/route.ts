// src/app/api/cron/push/route.ts — PHONES BUZZ WITHIN A MINUTE for every app notification (Vercel Cron, every minute).
// Urgent ones are already pushed the moment they're saved (lib/push pushNow); this catches everything else — including
// notifications created in the browser. Each is claimed once, so nothing ever buzzes twice.
import { NextRequest, NextResponse } from 'next/server';
import { getMessaging } from 'firebase-admin/messaging';
import { getAdminDb } from '@/lib/firebase-admin';
import { pushNewNotifications } from '@/lib/push';
import { linkOrigin } from '@/lib/app-origin';
import { recordCronRun } from '@/lib/cron-heartbeat';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const messaging = getMessaging(); let sent = 0;
  for (const t of (await db.collection('tenants').get()).docs) {
    try { sent += await pushNewNotifications(db, messaging, t.id, t.data() || {}, linkOrigin(t.data() || {})); } catch { /* next business */ }
  }
  await recordCronRun('push', { sent });
  return NextResponse.json({ ok: true, sent });
}
