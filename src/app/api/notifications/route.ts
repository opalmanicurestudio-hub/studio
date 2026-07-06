import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Sends the booking-completion link to the client by email (Resend) and/or
// SMS (Twilio). Uses plain HTTPS calls — no SDKs to install in the web editor.
//
// Reads credentials from env. If a channel isn't configured, it's skipped and
// reported back, so the front desk can still copy the link manually.
//
//   Email (Resend):  RESEND_API_KEY, RESEND_FROM   (e.g. "Opal Studio <hi@opal.com>")
//   SMS  (Twilio):   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
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
              subject: `Finish securing your appointment at ${studio}`,
              html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:8px">
                <p style="font-size:15px;color:#0f172a">Hi ${name},</p>
                <p style="font-size:15px;color:#0f172a;line-height:1.6">You're almost booked at <strong>${studio}</strong>. Tap below to save your card on file, accept the policy, and complete any forms — it only takes a minute.</p>
                <p style="text-align:center;margin:28px 0">
                  <a href="${link}" style="background:#111827;color:#ffffff;padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">Finish my booking</a>
                </p>
                <p style="color:#64748b;font-size:13px;line-height:1.5">Or paste this link into your browser:<br><span style="color:#0f172a">${link}</span></p>
                <p style="color:#94a3b8;font-size:12px;margin-top:20px">This secure link expires in 7 days.</p>
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
            Body: `Hi ${name}, finish securing your appointment at ${studio}: ${link}`,
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
    console.error('[notifications/send-completion-link]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
