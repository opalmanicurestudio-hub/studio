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
      const base = String((tDoc.data() as any)?.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');

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
          // v18 — ONE portal for clients: the master check-in link
          // (/check-in/{token}) — arrival, running-late, concierge,
          // forms/deposit, and the studio's real cancellation flow all
          // live there. The old /appt manage page is retired from links.
          const manage = a.checkInToken && base ? ` Details & check-in: ${base}/check-in/${a.checkInToken}` : '';
          const msg = daysBefore === 0
            ? `Reminder — your appointment is today, ${when}${withWho}.${manage}`
            : `Reminder — your appointment is ${when}${withWho}.${manage}`;

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
      // ── POST-VISIT FOLLOW-UP — thank-you + review + rebook, the day
      // after. Retention on autopilot; disable via clientNotify.followUp=false.
      let followUps = 0;
      if (cfg.followUp !== false) {
        const yest = new Date(localNow.getTime() - 86400000);
        const yestDay = `${yest.getUTCFullYear()}-${pad(yest.getUTCMonth() + 1)}-${pad(yest.getUTCDate())}`;
        for (const aDoc of apts.docs) {
          const a = aDoc.data() as any;
          try {
            if (!a.startTime || a.followUpSentAt) continue;
            if (['cancelled', 'canceled', 'no_show', 'pending_payment'].includes(String(a.status || ''))) continue;
            const aptLocal = new Date(new Date(a.startTime).getTime() + tzOffset * 60000);
            const aptDay = `${aptLocal.getUTCFullYear()}-${pad(aptLocal.getUTCMonth() + 1)}-${pad(aptLocal.getUTCDate())}`;
            if (aptDay !== yestDay) continue;
            let phone = a.clientPhone || a.phone || null;
            let email = a.clientEmail || a.email || null;
            if ((!phone || !email) && a.clientId) {
              try {
                const c = (await db.doc(`tenants/${tid}/clients/${a.clientId}`).get()).data() as any;
                phone = phone || c?.phone || null; email = email || c?.email || null;
              } catch { /* best-effort */ }
            }
            if (!phone && !email) continue;
            const bits = [
              `Thanks for coming in yesterday${a.staffName ? ` — ${a.staffName} loved having you` : ''}!`,
              cfg.bookingUrl ? `Book your next visit: ${cfg.bookingUrl}` : null,
              cfg.reviewUrl ? `Enjoyed it? A quick review means the world: ${cfg.reviewUrl}` : null,
            ].filter(Boolean).join(' ');
            let delivered = false;
            if (phone && smsConfigured()) delivered = (await sendTenantSms(db, tid, phone, bits, { email, subject: 'Thank you for visiting' })).ok;
            if (!delivered && email) delivered = (await sendNotification(db, { tenantId: tid, channel: 'email', to: email, subject: 'Thank you for visiting', text: bits, kind: 'post_visit_followup', appointmentId: aDoc.id, clientId: a.clientId || null, clientName: a.clientName || null })).ok;
            if (delivered) { await aDoc.ref.set({ followUpSentAt: new Date().toISOString() }, { merge: true }); followUps++; }
          } catch { /* next appt */ }
        }
      }

      // ── STAFF MORNING AGENDA — each staffer's day in one text.
      // Disable via clientNotify.staffAgenda = false.
      let agendas = 0;
      if (cfg.staffAgenda !== false && smsConfigured()) {
        const todayDay = `${localNow.getUTCFullYear()}-${pad(localNow.getUTCMonth() + 1)}-${pad(localNow.getUTCDate())}`;
        const byStaff = new Map<string, { count: number; firstLabel: string | null; firstMs: number }>();
        for (const aDoc of apts.docs) {
          const a = aDoc.data() as any;
          if (!a.startTime || !a.staffId) continue;
          if (['cancelled', 'canceled', 'pending_payment'].includes(String(a.status || ''))) continue;
          const aptLocal = new Date(new Date(a.startTime).getTime() + tzOffset * 60000);
          const aptDay = `${aptLocal.getUTCFullYear()}-${pad(aptLocal.getUTCMonth() + 1)}-${pad(aptLocal.getUTCDate())}`;
          if (aptDay !== todayDay) continue;
          const cur = byStaff.get(a.staffId) || { count: 0, firstLabel: null, firstMs: Infinity };
          cur.count++;
          const ms = aptLocal.getTime();
          if (ms < cur.firstMs) { cur.firstMs = ms; cur.firstLabel = aptLocal.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }); }
          byStaff.set(a.staffId, cur);
        }
        // Out-of-service context, once per tenant
        let downNote = '';
        try {
          const ts = await db.collection(`tenants/${tid}/tickets`).get();
          const blocking = ts.docs.map((d: any) => d.data() as any)
            .filter((t: any) => ['open', 'in_progress'].includes(t.status) && ['urgent', 'high'].includes(t.priority) && t.boothName);
          if (blocking.length) downNote = ` Note: ${blocking.map((t: any) => t.boothName).filter((v: any, i: number, arr: any[]) => arr.indexOf(v) === i).slice(0, 3).join(', ')} out of service.`;
        } catch { /* context is a bonus */ }
        if (byStaff.size > 0) {
          const staffSnap = await db.collection(`tenants/${tid}/staff`).get();
          for (const sDoc of staffSnap.docs) {
            const s = sDoc.data() as any;
            const agenda = byStaff.get(sDoc.id);
            if (!agenda || !s.phone || s.active === false || s.archived) continue;
            try {
              const r = await sendTenantSms(db, tid, s.phone,
                `Good morning! Today: ${agenda.count} appointment${agenda.count === 1 ? '' : 's'}, first at ${agenda.firstLabel}.${downNote}`);
              if (r.ok) agendas++;
            } catch { /* next staffer */ }
          }
        }
      }

      // ── OWNER MORNING BRIEF — the whole day in one message.
      // Set clientNotify.ownerPhone to receive it; ownerBrief=false to stop.
      let brief = false;
      if (cfg.ownerBrief !== false && cfg.ownerPhone) {
        try {
          const todayDay = `${localNow.getUTCFullYear()}-${pad(localNow.getUTCMonth() + 1)}-${pad(localNow.getUTCDate())}`;
          let apptsToday = 0; let firstLabel: string | null = null; let firstMs = Infinity;
          for (const aDoc of apts.docs) {
            const a = aDoc.data() as any;
            if (!a.startTime || ['cancelled', 'canceled', 'pending_payment'].includes(String(a.status || ''))) continue;
            const aptLocal = new Date(new Date(a.startTime).getTime() + tzOffset * 60000);
            const aptDay = `${aptLocal.getUTCFullYear()}-${pad(aptLocal.getUTCMonth() + 1)}-${pad(aptLocal.getUTCDate())}`;
            if (aptDay !== todayDay) continue;
            apptsToday++;
            if (aptLocal.getTime() < firstMs) { firstMs = aptLocal.getTime(); firstLabel = aptLocal.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }); }
          }
          let openTickets = 0, overdueTickets = 0;
          try {
            const ts = await db.collection(`tenants/${tid}/tickets`).get();
            for (const d of ts.docs) {
              const t = d.data() as any;
              if (!['open', 'in_progress'].includes(t.status)) continue;
              openTickets++;
              if (t.dueAt && t.dueAt < new Date().toISOString()) overdueTickets++;
            }
          } catch { /* skip */ }
          let revYesterday = 0;
          try {
            const yStart = new Date(Date.now() - 36 * 3600000).toISOString();
            const txns = await db.collection(`tenants/${tid}/transactions`).where('date', '>=', yStart).get();
            const yest = new Date(localNow.getTime() - 86400000);
            const yestDay = `${yest.getUTCFullYear()}-${pad(yest.getUTCMonth() + 1)}-${pad(yest.getUTCDate())}`;
            for (const d of txns.docs) {
              const x = d.data() as any;
              if (x.type !== 'income') continue;
              const xLocal = new Date(new Date(x.date).getTime() + tzOffset * 60000);
              const xDay = `${xLocal.getUTCFullYear()}-${pad(xLocal.getUTCMonth() + 1)}-${pad(xLocal.getUTCDate())}`;
              if (xDay === yestDay) revYesterday += Number(x.amount) || 0;
            }
          } catch { /* skip */ }
          const msg = `Morning brief: ${apptsToday} appointment${apptsToday === 1 ? '' : 's'} today${firstLabel ? ` (first ${firstLabel})` : ''} · ${openTickets} open maintenance${overdueTickets ? ` (${overdueTickets} overdue)` : ''} · $${revYesterday.toFixed(0)} collected yesterday.`;
          if (smsConfigured()) brief = (await sendTenantSms(db, tid, cfg.ownerPhone, msg)).ok;
        } catch { /* brief is a bonus */ }
      }

      results[tid] = { sent, skipped, targetDay, followUps, agendas, ownerBrief: brief };
    } catch (e: any) {
      results[tid] = { error: String(e?.message || e).slice(0, 120) };
    }
  }
  return NextResponse.json({ ok: true, results });
}
