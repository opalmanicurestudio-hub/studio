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

export interface SmsResult { ok: boolean; sid?: string; error?: string }

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
export async function sendTenantSms(db: any, tenantId: string, to: string, body: string): Promise<SmsResult> {
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
  const branded = studioName ? `${studioName}: ${body}` : body;
  const result = await sendSms(to, branded, { from, messagingServiceSid });
  try {
    const ref = db.collection(`tenants/${tenantId}/private`).doc('smsLog')
      .collection('messages').doc();
    await ref.set({
      id: ref.id, to: toE164(to) || String(to).slice(0, 30), body: branded.slice(0, 500),
      ok: result.ok, sid: result.sid || null, error: result.error || null,
      at: new Date().toISOString(),
    });
  } catch { /* the log never blocks the message */ }
  return result;
}
