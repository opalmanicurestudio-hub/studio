// src/lib/sms.ts
//
// Multi-tenant SMS via Twilio — ONE platform Twilio account, per-tenant
// sender identity. Server-side ONLY (the auth token must never reach a
// browser): import this from API routes and crons, never from 'use client'
// files.
//
// ── Multi-tenancy model ──────────────────────────────────────────────
// The PLATFORM owns the Twilio account and the default phone number /
// messaging service (env vars below). Every outbound message is branded
// per tenant by prefixing the studio's name ("Opal Manicure Studio:
// your code is…"), so one number can serve every tenant honestly.
// When a tenant later wants their own dedicated number, set
// tenants/{id}.sms.fromNumber (or .messagingServiceSid) and their
// messages switch senders automatically — no code changes.
//
// ── ENV (Vercel → Settings → Environment Variables) ─────────────────
//   TWILIO_ACCOUNT_SID           ACxxxxxxxx… (Console home page)
//   TWILIO_AUTH_TOKEN            (Console home page)
//   TWILIO_MESSAGING_SERVICE_SID MGxxxxxxxx… (preferred; created with your
//                                A2P campaign) — OR —
//   TWILIO_FROM                  +15551234567 (a number you bought)
//
// Fail-soft by design: every send returns { ok } instead of throwing, so
// SMS being down/unconfigured NEVER breaks a booking, login, or reminder —
// callers fall back to the owner-inbox notification path.

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM));
}

// Normalize a US-ish phone to E.164. Returns null when it can't be a
// real mobile number — callers then use their fallback path.
export function toE164(raw: any): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw || '').trim().startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

export interface SmsResult { ok: boolean; sid?: string; error?: string; via?: 'sms' | 'email' }

// ── EMAIL FALLBACK — the secondary delivery method ─────────────────────
// When a text can't go out (Twilio down, unconfigured, number rejected,
// trial limits) and we have an email address, the SAME message goes by
// email via Resend instead of dying. Needs RESEND_API_KEY (and ideally
// NOTIFY_FROM_EMAIL) in the environment; without them this quietly
// declines and callers keep their owner-inbox fallback as the last net.
async function sendFallbackEmail(toEmail: string, subject: string, body: string, studioName: string): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || !toEmail || !/@/.test(toEmail)) return false;
    const { brandedEmailHtml } = await import('./email-template');
    // Lift a link out of the message body into a proper CTA button.
    const linkMatch = body.match(/https?:\/\/\S+/);
    const textOnly = linkMatch ? body.replace(linkMatch[0], '').replace(/\s{2,}/g, ' ').trim() : body;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM_EMAIL || 'ClarityFlow <onboarding@resend.dev>',
        to: [toEmail],
        subject: subject || `${studioName || 'Studio'} — notification`,
        text: `${body}\n\n— ${studioName || 'The studio'} (sent by email because your phone couldn't receive our text)`,
        html: brandedEmailHtml({
          studioName: studioName || 'Studio',
          title: subject || 'Notification',
          bodyLines: [textOnly],
          cta: linkMatch ? { label: 'Open', url: linkMatch[0] } : null,
          footerNote: `Sent by email because your phone couldn't receive our text. You're receiving this because you have an account or booking with ${studioName || 'the studio'}.`,
        }),
      }),
    });
    return res.ok;
  } catch { return false; }
}

// Low-level send using the platform account. Prefer sendTenantSms().
export async function sendSms(to: string, body: string, opts?: { from?: string; messagingServiceSid?: string }): Promise<SmsResult> {
  try {
    if (!smsConfigured()) return { ok: false, error: 'SMS not configured (missing Twilio env vars).' };
    const e164 = toE164(to);
    if (!e164) return { ok: false, error: `Not a sendable phone number: ${String(to).slice(0, 20)}` };
    const sid = process.env.TWILIO_ACCOUNT_SID as string;
    const params = new URLSearchParams();
    params.set('To', e164);
    params.set('Body', body.slice(0, 1600));
    const msid = opts?.messagingServiceSid || process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = opts?.from || process.env.TWILIO_FROM;
    if (msid) params.set('MessagingServiceSid', msid);
    else params.set('From', from as string);
    const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      },
      body: params.toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `Twilio error ${res.status}` };
    return { ok: true, sid: data?.sid };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'SMS send failed.' };
  }
}

// Tenant-branded send: prefixes the studio name and honors a tenant's own
// number/messaging service if they've been given one. Also logs the send
// to the tenant's smsLog for an auditable communication trail.
//
// PRODUCTION COMPLIANCE, automatic: the FIRST message this tenant ever
// sends to a given number carries "Reply STOP to opt out." — exactly what
// the A2P registration promises carriers. Later messages in the ongoing
// relationship stay clean (the disclosure requirement is first-contact,
// and Twilio enforces STOP at the carrier level regardless).
export async function sendTenantSms(
  db: any, tenantId: string, to: string, body: string,
  // Secondary method: pass an email and the message survives SMS failure.
  fallback?: { email?: string | null; subject?: string },
): Promise<SmsResult> {
  let studioName = '';
  let from: string | undefined;
  let messagingServiceSid: string | undefined;
  try {
    const t = await db.doc(`tenants/${tenantId}`).get();
    const data = (t.data() as any) || {};
    studioName = data.name || data.businessName || '';
    from = data?.sms?.fromNumber || undefined;
    messagingServiceSid = data?.sms?.messagingServiceSid || undefined;
  } catch { /* branding is best-effort */ }
  const e164 = toE164(to);
  let firstContact = false;
  if (e164) {
    try {
      const rRef = db.doc(`tenants/${tenantId}/private/smsRecipients`);
      const seen = ((await rRef.get()).data() as any) || {};
      const key = e164.replace(/[^\d]/g, '');
      if (!seen[key]) {
        firstContact = true;
        await rRef.set({ [key]: new Date().toISOString() }, { merge: true });
      }
    } catch { /* opt-out line is best-effort; carrier STOP still protects */ }
  }
  const branded = `${studioName ? `${studioName}: ` : ''}${body}${firstContact ? ' Reply STOP to opt out.' : ''}`;
  let result: SmsResult = await sendSms(to, branded, { from, messagingServiceSid });
  if (result.ok) result.via = 'sms';

  // SMS failed → try the secondary method before giving up.
  if (!result.ok && fallback?.email) {
    const emailed = await sendFallbackEmail(fallback.email, fallback.subject || (studioName ? `${studioName} — notification` : 'Notification'), body, studioName);
    if (emailed) result = { ok: true, via: 'email', error: `sms failed (${result.error}) — delivered by email` };
  }

  try {
    const ref = db.collection(`tenants/${tenantId}/private`).doc('smsLog')
      .collection('messages').doc();
    await ref.set({
      id: ref.id, to: toE164(to) || String(to).slice(0, 30), body: branded.slice(0, 500),
      ok: result.ok, via: result.via || 'sms', sid: result.sid || null, error: result.error || null,
      fallbackEmail: (!result.ok || result.via === 'email') ? (fallback?.email || null) : null,
      at: new Date().toISOString(),
    });
  } catch { /* the log never blocks the message */ }
  return result;
}
