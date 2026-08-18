/**
 * POST /api/notifications/send-reminders — v1
 *
 * Text/email appointment reminders — the counterpart to
 * /api/voice/send-reminders. That route reminds by PHONE CALL; this one
 * reminds by SMS/EMAIL. They deliberately never overlap: this route only
 * ever processes appointments whose client has explicitly set
 * notificationPreferences.reminderChannel to 'sms', 'email', or 'both'.
 * An UNSET preference defaults to 'voice' (see the Client type's own
 * comment) — meaning every existing client's reminder behavior is
 * completely unchanged by this route's existence. Nobody gets reminded
 * twice; nobody's reminders silently switch channel without them asking.
 *
 * Selection: confirmed appointments whose start is within the
 * appointment's own reminderHours window (same field QuickBookForm and the
 * voice booking engine both already write) and at least 1 hour away, not
 * yet reminded. Marks reminderSent BEFORE sending so a cron overlap can
 * never double-send.
 *
 * Cron (same pattern as /api/voice/send-reminders — hourly, per tenant):
 *   curl -s -X POST "$APP_URL/api/notifications/send-reminders" \
 *     -H "Content-Type: application/json" \
 *     -H "x-notifications-secret: $NOTIFICATIONS_CRON_SECRET" \
 *     -d '{"tenantId":"YOUR_TENANT_ID"}'
 *
 * NOTE ON ENV: expects NOTIFICATIONS_CRON_SECRET (separate from
 * VOICE_AGENT_SECRET — this route has nothing to do with the voice system
 * and shouldn't share its auth), plus the same TWILIO and RESEND_API_KEY
 * vars send-completion-link already uses.
 */

import { NextRequest, NextResponse } from 'next/server';
import { brandedEmail, brandFromTenant, emailButton } from '@/lib/email-shell';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_RUN = 50;

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const formatWhen = (iso: string): string => {
  try {
    return safeDate(iso).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

async function sendReminderEmail(opts: {
  to: string; clientName: string; serviceName: string; whenText: string;
  studioName: string; checkInUrl: string; tenant?: any;
}): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${opts.studioName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
      to: opts.to,
      subject: `Reminder: ${opts.serviceName} on ${opts.whenText}`,
      html: (() => {
        /* The appointment reminder now matches every other email the
         * business sends \u2014 same card, same brand color, same button. */
        const brand = opts.tenant ? brandFromTenant(opts.tenant) : { shopName: opts.studioName, brandColor: '#16171a' };
        return brandedEmail(brand, `
          <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">Just a reminder \u2014 we have you down for <strong>${opts.serviceName}</strong> on <strong>${opts.whenText}</strong>.</p>
          ${emailButton(opts.checkInUrl, 'Check in or manage', brand)}
          <p style="font-size:11px;color:#94a3b8;margin:0">Need to change something? The link above handles it \u2014 no phone tag.</p>`,
          { preheader: `${opts.serviceName} on ${opts.whenText}`, title: `See you soon, ${opts.clientName.split(' ')[0]}!` });
      })(),
    }),
  });
  return res.ok;
}

async function sendReminderSms(opts: {
  to: string; serviceName: string; whenText: string; studioName: string; checkInUrl: string; fromNumber?: string; replyKeywordHint?: string;
}): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: opts.to,
      From: opts.fromNumber || process.env.TWILIO_PHONE_NUMBER || '',
      Body: `${opts.studioName}: Reminder — ${opts.serviceName} on ${opts.whenText}.${opts.replyKeywordHint || ''} Check in or manage: ${opts.checkInUrl}`,
    }),
  });
  return res.ok;
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-notifications-secret') !== process.env.NOTIFICATIONS_CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* tenantId check below */
  }
  const tenantId: string = body?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ sent: 0, error: 'missing_tenant' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = tenantSnap.data();
    if (!tenant) return NextResponse.json({ sent: 0, error: 'tenant_not_found' }, { status: 404 });

    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const horizonISO = new Date(now + 72 * 3600 * 1000).toISOString();
    const snap = await db
      .collection(`tenants/${tenantId}/appointments`)
      .where('startTime', '>=', nowISO)
      .where('startTime', '<=', horizonISO)
      .get();

    const candidates = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a) => {
        if (a.status !== 'confirmed') return false;
        if (a.reminderSent === true) return false;
        if (typeof a.startTime !== 'string') return false;
        const startMs = new Date(a.startTime).getTime();
        if (Number.isNaN(startMs)) return false;
        const hoursUntil = (startMs - now) / 3_600_000;
        const windowHours = Number(a.reminderHours) || 48;
        return hoursUntil >= 1 && hoursUntil <= windowHours;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    let sent = 0;
    const results: any[] = [];

    for (const apt of candidates) {
      if (sent >= MAX_PER_RUN) break;
      if (!apt.clientId) continue;

      const cSnap = await db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get();
      const client = cSnap.exists ? cSnap.data() as any : null;

      // The whole point of this route: only handle clients who've
      // explicitly chosen text/email. An unset preference means 'voice'
      // (the existing route already owns them) — never assumed to mean
      // "this route should also try."
      //
      // v2 — unless the tenant has disabled client override
      // (notificationDefaults.allowClientOverride === false), in which
      // case the tenant's own reminderChannel default decides for
      // everyone instead of each client's individual preference.
      const allowOverride = tenant.notificationDefaults?.allowClientOverride !== false;
      const tenantReminderDefault = tenant.notificationDefaults?.reminderChannel;
      const channel = allowOverride
        ? client?.notificationPreferences?.reminderChannel
        : (tenantReminderDefault || 'voice');
      if (channel !== 'sms' && channel !== 'email' && channel !== 'both') continue;

      const clientEmail = (client?.email || '').trim();
      const clientPhone = (client?.phone || '').trim();
      const clientName = client?.name || apt.clientName || 'there';

      // Mark BEFORE sending — a cron overlap must never double-send.
      await db.doc(`tenants/${tenantId}/appointments/${apt.id}`).set(
        { reminderSent: true, reminderSentAt: new Date().toISOString(), reminderChannel: channel },
        { merge: true },
      );

      const svcSnap = apt.serviceId ? await db.doc(`tenants/${tenantId}/services/${apt.serviceId}`).get() : null;
      const serviceName = svcSnap?.exists ? (svcSnap.data() as any)?.name : 'your appointment';
      const whenText = formatWhen(apt.startTime);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
      const checkInUrl = apt.checkInToken ? `${appUrl}/check-in/${apt.checkInToken}` : appUrl;
      // v22 — explicit reply keywords, so the highest-volume text
      // interaction (confirming or cancelling off a reminder) never
      // depends on AI interpreting free text — a simple, deterministic
      // keyword check (see inbound-sms-webhook's keyword short-circuit)
      // handles this before anything ambiguous would reach the chat agent.
      const replyKeywordHint = ' Reply C to confirm, X to cancel.';

      let emailOk = false;
      let smsOk = false;

      if ((channel === 'email' || channel === 'both') && clientEmail) {
        try {
          emailOk = await sendReminderEmail({ to: clientEmail, clientName, serviceName, whenText, studioName: tenant.name || 'the studio', checkInUrl, tenant });
        } catch (e) {
          console.error('[notifications/send-reminders] email failed', e);
        }
      }
      if ((channel === 'sms' || channel === 'both') && clientPhone) {
        try {
          smsOk = await sendReminderSms({ to: clientPhone, serviceName, whenText, studioName: tenant.name || 'the studio', checkInUrl, fromNumber: tenant.voiceAgent?.phoneNumber, replyKeywordHint });
        } catch (e) {
          console.error('[notifications/send-reminders] sms failed', e);
        }
      }

      if (emailOk || smsOk) sent += 1;
      results.push({ appointmentId: apt.id, emailOk, smsOk });
    }

    return NextResponse.json({ sent, considered: candidates.length, results });
  } catch (e) {
    console.error('[notifications/send-reminders]', e);
    return NextResponse.json({ sent: 0, error: 'internal' }, { status: 500 });
  }
}
