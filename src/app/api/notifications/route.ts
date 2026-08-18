import { NextRequest, NextResponse } from 'next/server';
import { brandedEmail, emailButton } from '@/lib/email-shell';

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
              html: (() => {
                const brand = { shopName: studio, brandColor: '#16171a' };
                return brandedEmail(brand, `
                  <p style="font-size:14px;color:#0f172a;line-height:1.7;margin:0">Hi ${name}, you&#39;re almost booked. Tap below to save your card on file, accept the policy, and complete any forms \u2014 it only takes a minute.</p>
                  ${emailButton(link, 'Finish my booking', brand)}
                  <p style="color:#64748b;font-size:12px;line-height:1.6;margin:0">Or paste this link into your browser:<br><span style="color:#0f172a;word-break:break-all">${link}</span></p>
                  <p style="color:#94a3b8;font-size:11px;margin:16px 0 0">This secure link expires in 7 days.</p>`,
                  { preheader: 'Save your card and accept the policy \u2014 one minute', title: 'Finish securing your appointment' });
              })(),
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
