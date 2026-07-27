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

      // ── WORKS ON A DAILY CRON TOO ───────────────────────────────────────
      // Vercel's Hobby plan only fires a cron once a day. On an hourly cron
      // the chosen-hour check is exact and this never triggers; on a daily
      // cron the chosen hour almost never matches the one hour the cron runs,
      // and reminders would silently never go out. So: also run when a full
      // day has passed since this tenant's last run — but only during
      // daytime, because a cron that happens to fire at 03:00 UTC must never
      // turn into a 3am text.
      const stateRef = db.doc(`tenants/${tid}/cronState/reminders`);
      let lastRunMs = 0;
      try {
        const s = await stateRef.get();
        const v = s.exists ? (s.data() as any)?.lastRunAt : null;
        if (v) lastRunMs = new Date(v).getTime() || 0;
      } catch { /* treat as never run */ }
      const localHour = localNow.getUTCHours();
      const atChosenHour = localHour === sendHour;
      const aDayStale = (Date.now() - lastRunMs) >= 20 * 3600000;
      const civilHour = localHour >= 8 && localHour <= 20;
      if (!atChosenHour && !(aDayStale && civilHour)) {
        results[tid] = `waiting (their ${pad(sendHour)}:00)`;
        continue;
      }
      // Stamped BEFORE the work, not after: if the send loop dies halfway the
      // catch-up must not re-fire on the very next hour and re-text everyone
      // the stamping loop had already covered.
      try { await stateRef.set({ lastRunAt: new Date().toISOString(), localHour }, { merge: true }); } catch { /* best effort */ }
      const base = String((tDoc.data() as any)?.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');

      // Target LOCAL day: today + daysBefore.
      const target = new Date(localNow.getTime() + daysBefore * 86400000);
      const targetDay = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;

      const apts = await db.collection(`tenants/${tid}/appointments`).get();

      // Service names, read once, so a multi-appointment reminder can say
      // "10:00 Manicure, 11:15 Pedicure" instead of listing bare times.
      const svcNames = new Map<string, string>();
      try {
        const svcSnap = await db.collection(`tenants/${tid}/services`).get();
        for (const d of svcSnap.docs) svcNames.set(d.id, String((d.data() as any)?.name || ''));
      } catch { /* names are a nicety, not a requirement */ }

      /**
       * Reach the client: phone/email on the appointment, else the client doc.
       * Cached per client — a party of five sharing one profile used to cost
       * five identical reads.
       */
      const contactCache = new Map<string, { phone: string | null; email: string | null }>();
      const contactFor = async (a: any): Promise<{ phone: string | null; email: string | null }> => {
        let phone: string | null = a.clientPhone || a.phone || null;
        let email: string | null = a.clientEmail || a.email || null;
        if ((!phone || !email) && a.clientId) {
          let rec = contactCache.get(a.clientId);
          if (!rec) {
            try {
              const c = (await db.doc(`tenants/${tid}/clients/${a.clientId}`).get()).data() as any;
              rec = { phone: c?.phone || null, email: c?.email || null };
            } catch {
              rec = { phone: null, email: null };
            }
            contactCache.set(a.clientId, rec);
          }
          phone = phone || rec.phone;
          email = email || rec.email;
        }
        return { phone, email };
      };

      const timeOf = (d: Date) =>
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
      const dayOf = (d: Date) =>
        d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      const localDayKey = (d: Date) =>
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const firstNameOf = (v: any) => String(v || '').trim().split(/\s+/)[0] || 'Guest';

      // ── ONE MESSAGE PER PERSON PER VISIT ────────────────────────────────────
      // A three-provider visit is one appointment DOCUMENT per leg, and a party
      // is one per guest. Reminding per document meant a client booked for
      // colour then cut then style got three separate texts for what she thinks
      // of as one appointment — and a party whose guests were added without
      // phones of their own sent the organizer five texts in a row.
      //
      // So: bucket by visit (groupBookingId, else multiProviderGroupId, else the
      // document itself), then by the contact that would actually receive it.
      // One message per bucket, listing everything in it. Guests who DID give
      // their own number still get their own text, because they are their own
      // bucket — which is right, they are different people.
      //
      // Every appointment in a bucket is stamped, so a rerun cannot repeat it.
      type Bucket = {
        phone: string | null;
        email: string | null;
        items: Array<{ ref: any; a: any; id: string; local: Date }>;
      };
      let sent = 0, skipped = 0;
      const buckets = new Map<string, Bucket>();
      for (const aDoc of apts.docs) {
        const a = aDoc.data() as any;
        try {
          if (!a.startTime || a.reminderSentAt) continue;
          if (['cancelled', 'canceled', 'no_show', 'completed'].includes(String(a.status || ''))) continue;
          // The appointment's LOCAL day must match the target day.
          const aptLocal = new Date(new Date(a.startTime).getTime() + tzOffset * 60000);
          if (localDayKey(aptLocal) !== targetDay) continue;

          const { phone, email } = await contactFor(a);
          if (!phone && !email) { skipped++; continue; }

          const visitKey = a.groupBookingId || a.multiProviderGroupId || aDoc.id;
          const key = `${visitKey}::${String(phone || '').trim()}::${String(email || '').trim().toLowerCase()}`;
          const b = buckets.get(key) || { phone, email, items: [] };
          b.items.push({ ref: aDoc.ref, a, id: aDoc.id, local: aptLocal });
          buckets.set(key, b);
        } catch { skipped++; }
      }

      for (const b of buckets.values()) {
        try {
          b.items.sort((x, y) => x.local.getTime() - y.local.getTime());
          const first = b.items[0];
          const when = `${dayOf(first.local)} at ${timeOf(first.local)}`;
          // v18 — ONE portal for clients: the master check-in link
          // (/check-in/{token}) — arrival, running-late, concierge,
          // forms/deposit, and the studio's real cancellation flow all
          // live there. The old /appt manage page is retired from links.
          const token = b.items.find((i) => i.a.checkInToken)?.a.checkInToken || null;
          const manage = token && base ? ` Details & check-in: ${base}/check-in/${token}` : '';

          let msg: string;
          if (b.items.length === 1) {
            const withWho = first.a.staffName ? ` with ${first.a.staffName}` : '';
            msg = daysBefore === 0
              ? `Reminder — your appointment is today, ${when}${withWho}.${manage}`
              : `Reminder — your appointment is ${when}${withWho}.${manage}`;
          } else {
            // More than one name in the bucket means this phone is covering
            // other people, so lead each line with who it is for.
            const names = new Set(b.items.map((i) => String(i.a.clientName || '').trim().toLowerCase()));
            const lines = b.items.map((i) => {
              const svcName = svcNames.get(String(i.a.serviceId || '')) || 'appointment';
              const who = i.a.staffName ? ` with ${i.a.staffName}` : '';
              return names.size > 1
                ? `${firstNameOf(i.a.clientName)} ${timeOf(i.local)} ${svcName}${who}`
                : `${timeOf(i.local)} ${svcName}${who}`;
            }).join(', ');
            const dayPart = daysBefore === 0 ? 'today' : dayOf(first.local);
            msg = names.size > 1
              ? `Reminder — your group is booked ${dayPart}: ${lines}.${manage}`
              : `Reminder — you have ${b.items.length} appointments ${dayPart}: ${lines}.${manage}`;
          }

          let delivered = false;
          if (b.phone && smsConfigured()) {
            const r = await sendTenantSms(db, tid, b.phone, msg, { email: b.email, subject: 'Appointment reminder' });
            delivered = r.ok;
          }
          if (!delivered && b.email) {
            const r = await sendNotification(db, {
              tenantId: tid, channel: 'email', to: b.email,
              subject: 'Appointment reminder',
              text: msg, kind: 'appointment_reminder',
              appointmentId: first.id, clientId: first.a.clientId || null, clientName: first.a.clientName || null,
            });
            delivered = r.ok;
          }
          if (delivered) {
            const stampedAt = new Date().toISOString();
            // Stamp EVERY appointment the message covered, not just the one it
            // was addressed from — otherwise the next hourly run finds the
            // siblings unstamped and texts the same person again.
            for (const i of b.items) {
              try { await i.ref.set({ reminderSentAt: stampedAt }, { merge: true }); } catch { /* next */ }
            }
            sent += b.items.length;
          } else skipped += b.items.length;
        } catch { skipped += b.items.length; }
      }
      // ── POST-VISIT FOLLOW-UP — thank-you + review + rebook, the day
      // after. Retention on autopilot; disable via clientNotify.followUp=false.
      let followUps = 0;
      if (cfg.followUp !== false) {
        const yest = new Date(localNow.getTime() - 86400000);
        const yestDay = localDayKey(yest);
        // One thank-you per PERSON, not per document. A client who had colour
        // then cut then style yesterday had one visit, and the organizer of a
        // party of five was reachable on one phone — sending per document
        // meant three texts and five texts respectively. Bucket by the
        // contact that would actually receive it; guests who gave their own
        // number are their own bucket and still hear from the studio.
        type FollowBucket = {
          phone: string | null;
          email: string | null;
          items: Array<{ ref: any; a: any; id: string; local: Date }>;
        };
        const followBuckets = new Map<string, FollowBucket>();
        for (const aDoc of apts.docs) {
          const a = aDoc.data() as any;
          try {
            if (!a.startTime || a.followUpSentAt) continue;
            if (['cancelled', 'canceled', 'no_show', 'pending_payment'].includes(String(a.status || ''))) continue;
            const aptLocal = new Date(new Date(a.startTime).getTime() + tzOffset * 60000);
            if (localDayKey(aptLocal) !== yestDay) continue;
            const { phone, email } = await contactFor(a);
            if (!phone && !email) continue;
            const key = `${String(phone || '').trim()}::${String(email || '').trim().toLowerCase()}`;
            const b = followBuckets.get(key) || { phone, email, items: [] };
            b.items.push({ ref: aDoc.ref, a, id: aDoc.id, local: aptLocal });
            followBuckets.set(key, b);
          } catch { /* next appt */ }
        }

        for (const b of followBuckets.values()) {
          try {
            b.items.sort((x, y) => x.local.getTime() - y.local.getTime());
            const first = b.items[0];
            // Thank the whole team that touched the visit, deduped and in the
            // order they were seen — "Ana and Bea" reads like a studio, three
            // separate texts read like a mailing list.
            const who = Array.from(
              new Set(b.items.map((i) => String(i.a.staffName || '').trim()).filter(Boolean)),
            );
            const whoLabel = who.length === 0
              ? ''
              : who.length === 1
                ? who[0]
                : who.length === 2
                  ? `${who[0]} and ${who[1]}`
                  : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`;
            const bits = [
              `Thanks for coming in yesterday${whoLabel ? ` — ${whoLabel} loved having you` : ''}!`,
              cfg.bookingUrl ? `Book your next visit: ${cfg.bookingUrl}` : null,
              cfg.reviewUrl ? `Enjoyed it? A quick review means the world: ${cfg.reviewUrl}` : null,
            ].filter(Boolean).join(' ');
            let delivered = false;
            if (b.phone && smsConfigured()) {
              delivered = (await sendTenantSms(db, tid, b.phone, bits, { email: b.email, subject: 'Thank you for visiting' })).ok;
            }
            if (!delivered && b.email) {
              delivered = (await sendNotification(db, {
                tenantId: tid, channel: 'email', to: b.email,
                subject: 'Thank you for visiting', text: bits, kind: 'post_visit_followup',
                appointmentId: first.id, clientId: first.a.clientId || null, clientName: first.a.clientName || null,
              })).ok;
            }
            if (delivered) {
              const stampedAt = new Date().toISOString();
              // Stamp every document the one message covered, or tomorrow's
              // run finds the siblings unstamped and thanks her again.
              for (const i of b.items) {
                try { await i.ref.set({ followUpSentAt: stampedAt }, { merge: true }); } catch { /* next */ }
              }
              followUps += b.items.length;
            }
          } catch { /* next bucket */ }
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
