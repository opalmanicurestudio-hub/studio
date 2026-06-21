import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Sends the self-service cancellation link (Rule 2 — /cancel/[tenantId]/[appointmentId])
// to the client by email (Resend) and/or SMS (Twilio). Mirrors
// api/notifications/send-completion-link's structure exactly — plain HTTPS
// calls, no SDKs, same env vars, same "skip + report" behavior when a
// channel isn't configured.
//
//   Email (Resend):  RESEND_API_KEY, RESEND_FROM   (e.g. "Opal Studio <hi@opal.com>")
//   SMS  (Twilio):   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//
// NOTE ON WIRING THIS IN: this route exists and works, but nothing calls it
// yet. The natural call sites are wherever appointment confirmations and/or
// reminders are sent — neither of which has been shared as part of this
// codebase, so nothing there has been modified. Call this with
// { link, clientName, clientEmail, clientPhone, studioName } from whichever
// of those flows should include a cancel link.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { link, clientName, clientEmail, clientPhone, studioName } = await req.json();
    if (!link) {
      return NextResponse.json({ error: 'Missing link' }, { status: 400 });
    }

    const studio = studioName || 'your studio';
    const name   = clientName || 'there';
    const result = {
      emailConfigured: false, emailSent: false,
      smsConfigured:   false, smsSent:   false,
      errors: [] as string[],
    };

    // ── Email via Resend ──────────────────────────────────────────────────────
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM    = process.env.RESEND_FROM;
    if (RESEND_API_KEY && RESEND_FROM) {
      result.emailConfigured = true;
      if (clientEmail) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [clientEmail],
              subject: `Need to cancel or reschedule? — ${studio}`,
              html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:8px">
                <p style="font-size:15px;color:#0f172a">Hi ${name},</p>
                <p style="font-size:15px;color:#0f172a;line-height:1.6">If something's come up and you need to cancel your upcoming appointment at <strong>${studio}</strong>, you can do that here — it only takes a moment.</p>
                <p style="text-align:center;margin:28px 0">
                  <a href="${link}" style="background:#111827;color:#ffffff;padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">Cancel my appointment</a>
                </p>
                <p style="color:#64748b;font-size:13px;line-height:1.5">Or paste this link into your browser:<br><span style="color:#0f172a">${link}</span></p>
                <p style="color:#94a3b8;font-size:12px;margin-top:20px">Cancelling close to your appointment time may include a cancellation fee, shown before you confirm.</p>
              </div>`,
            }),
          });
          if (r.ok) result.emailSent = true;
          else result.errors.push(`email:${r.status}`);
        } catch (e: any) { result.errors.push(`email:${e.message}`); }
      }
    }

    // ── SMS via Twilio ─────────────────────────────────────────────────────────
    const SID  = process.env.TWILIO_ACCOUNT_SID;
    const AUTH = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_FROM;
    if (SID && AUTH && FROM) {
      result.smsConfigured = true;
      if (clientPhone) {
        try {
          const form = new URLSearchParams({
            To: clientPhone,
            From: FROM,
            Body: `Hi ${name}, need to cancel your appointment at ${studio}? Tap here: ${link}`,
          });
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
            method: 'POST',
            headers: {
              Authorization: 'Basic ' + Buffer.from(`${SID}:${AUTH}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
          });
          if (r.ok) result.smsSent = true;
          else result.errors.push(`sms:${r.status}`);
        } catch (e: any) { result.errors.push(`sms:${e.message}`); }
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[notifications/send-cancellation-link]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}