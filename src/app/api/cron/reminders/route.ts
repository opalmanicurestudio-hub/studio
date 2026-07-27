// src/app/api/cron/reminders/route.ts
//
// CLIENT APPOINTMENT REMINDERS — runs HOURLY (add to vercel.json:
//   { "path": "/api/cron/reminders", "schedule": "0 * * * *" }
// ) and each tenant's reminders go out at THE HOUR THE OWNER CHOSE,
// in their own timezone. Not another 3am-text machine.
//
// Per-tenant settings, on tenants/{id}.clientNotify (all optional):
//   enabled          — default true (set false to silence entirely)
//   sendHour         — local hour 0-23 to send at (default 9 = 9am)
//   daysBefore       — remind this many days ahead (default 1 = tomorrow)
//   tzOffsetMinutes  — minutes from UTC, e.g. -300 EST / -360 CST
//                      (default -300; set yours once)
//
// Idempotent: each appointment is stamped (reminderSentAt) after its
// reminder goes out — reruns and overlapping windows can't double-text.
// Delivery: SMS first, branded-email fallback, per the messaging layer.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { smsConfigured, sendTenantSms } from '@/lib/sms';
import { sendNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const pad = (n: number) => String(n).padStart(2, '0');

export async function GET(req: NextRequest) {
  // Same guard style as the nightly cron: Vercel Cron sends the secret.
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const db = getAdminDb();
  const results: Record<string, any> = {};
  const tenants = await db.collection('tenants').get();

  for (const tDoc of tenants.docs) {
    const tid = tDoc.id;
    try {
      const cfg = ((tDoc.data() as any)?.clientNotify) || {};
      if (cfg.enabled === false) { results[tid] = 'disabled'; continue; }
      const sendHour = Number.isFinite(Number(cfg.sendHour)) ? Math.min(23, Math.max(0, Math.round(Number(cfg.sendHour)))) : 9;
      const daysBefore = Number.isFinite(Number(cfg.daysBefore)) ? Math.min(7, Math.max(0, Math.round(Number(cfg.daysBefore)))) : 1;
      const tzOffset = Number.isFinite(Number(cfg.tzOffsetMinutes)) ? Number(cfg.tzOffsetMinutes) : -300;

      // Only act on the tenant's chosen local hour — hourly cron, per-
      // tenant clock. (The hour we're IN, so a few minutes' cron jitter
      // never skips a tenant.)
      const localNow = new Date(Date.now() + tzOffset * 60000);
      if (localNow.getUTCHours() !== sendHour) { results[tid] = `waiting (their ${pad(sendHour)}:00)`; continue; }

      // Target LOCAL day: today + daysBefore.
      const target = new Date(localNow.getTime() + daysBefore * 86400000);
      const targetDay = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;

      const apts = await db.collection(`tenants/${tid}/appointments`).get();
      let sent = 0, skipped = 0;
      for (const aDoc of apts.docs) {
        const a = aDoc.data() as any;
        try {
          if (!a.startTime || a.reminderSentAt) continue;
          if (['cancelled', 'canceled', 'no_show', 'completed'].includes(String(a.status || ''))) continue;
          // The appointment's LOCAL day must match the target day.
          const aptLocal = new Date(new Date(a.startTime).getTime() + tzOffset * 60000);
          const aptDay = `${aptLocal.getUTCFullYear()}-${pad(aptLocal.getUTCMonth() + 1)}-${pad(aptLocal.getUTCDate())}`;
          if (aptDay !== targetDay) continue;

          // Reach the client: phone/email on the appointment, else the doc.
          let phone = a.clientPhone || a.phone || null;
          let email = a.clientEmail || a.email || null;
          if ((!phone || !email) && a.clientId) {
            try {
              const c = (await db.doc(`tenants/${tid}/clients/${a.clientId}`).get()).data() as any;
              phone = phone || c?.phone || null;
              email = email || c?.email || null;
            } catch { /* client lookup is best-effort */ }
          }
          if (!phone && !email) { skipped++; continue; }

          const when = `${aptLocal.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${aptLocal.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`;
          const withWho = a.staffName ? ` with ${a.staffName}` : '';
          const msg = daysBefore === 0
            ? `Reminder — your appointment is today, ${when}${withWho}. Need to reschedule? Just reply or call us.`
            : `Reminder — your appointment is ${when}${withWho}. Need to reschedule? Just reply or call us.`;

          let delivered = false;
          if (phone && smsConfigured()) {
            const r = await sendTenantSms(db, tid, phone, msg, { email, subject: 'Appointment reminder' });
            delivered = r.ok;
          }
          if (!delivered && email) {
            const r = await sendNotification(db, {
              tenantId: tid, channel: 'email', to: email,
              subject: 'Appointment reminder',
              text: msg, kind: 'appointment_reminder',
              appointmentId: aDoc.id, clientId: a.clientId || null, clientName: a.clientName || null,
            });
            delivered = r.ok;
          }
          if (delivered) {
            await aDoc.ref.set({ reminderSentAt: new Date().toISOString() }, { merge: true });
            sent++;
          } else skipped++;
        } catch { skipped++; }
      }
      results[tid] = { sent, skipped, targetDay };
    } catch (e: any) {
      results[tid] = { error: String(e?.message || e).slice(0, 120) };
    }
  }
  return NextResponse.json({ ok: true, results });
}
