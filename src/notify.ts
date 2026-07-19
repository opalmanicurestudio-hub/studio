// src/lib/notify.ts
//
// v14 — THE notification core. One function every route uses to send a
// client-facing message, so every send (or failure, or "no provider set
// up yet") lands in ONE auditable place: tenants/{id}/messageLog.
// That log is what the appointment detail timeline reads to answer
// "did we actually text/email them, and when?" — no more guessing.
//
// Email provider: Resend (https://resend.com) — one env var to go live:
//   RESEND_API_KEY      — from the Resend dashboard
//   NOTIFY_FROM_EMAIL   — e.g. "Opal Manicure Studio <hello@yourdomain.com>"
//                         (domain must be verified in Resend)
// Without a key, sends are recorded as 'skipped_no_provider' — the
// timeline stays honest instead of silently pretending.
//
// SMS: logged as 'skipped_no_provider' until an SMS provider is wired.
// The call sites don't change when it is — only this file does.

import { logAuditAdmin } from './audit';

export type NotifyInput = {
  tenantId: string;
  channel: 'email' | 'sms';
  to: string;                    // email address or phone number
  subject?: string;              // email only
  html?: string;                 // email only
  text?: string;                 // sms body / email fallback
  kind: string;                  // 'booking_confirmation' | 'reminder' | 'image_share' | ...
  appointmentId?: string | null;
  clientId?: string | null;
  clientName?: string | null;
};

export type NotifyResult = {
  ok: boolean;
  status: 'sent' | 'failed' | 'skipped_no_provider';
  providerId?: string | null;
  error?: string;
};

const mask = (to: string) => {
  if (to.includes('@')) {
    const [u, d] = to.split('@');
    return `${u.slice(0, 1)}•••@${d}`;
  }
  const dg = to.replace(/\D/g, '');
  return dg.length >= 4 ? `•••-${dg.slice(-4)}` : '•••';
};

export async function sendNotification(db: any, input: NotifyInput): Promise<NotifyResult> {
  const { tenantId, channel, to, kind } = input;
  let result: NotifyResult;

  if (channel === 'email') {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      result = { ok: false, status: 'skipped_no_provider', error: 'RESEND_API_KEY not set' };
    } else {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from: process.env.NOTIFY_FROM_EMAIL || 'ClarityFlow <onboarding@resend.dev>',
            to: [to],
            subject: input.subject || 'A note from your studio',
            html: input.html || `<p>${input.text || ''}</p>`,
            ...(input.text ? { text: input.text } : {}),
          }),
        });
        const body: any = await res.json().catch(() => null);
        result = res.ok
          ? { ok: true, status: 'sent', providerId: body?.id || null }
          : { ok: false, status: 'failed', error: body?.message || `Provider error (${res.status})` };
      } catch (e: any) {
        result = { ok: false, status: 'failed', error: String(e?.message || e).slice(0, 200) };
      }
    }
  } else {
    // SMS — no provider wired yet; recorded honestly so timelines never lie.
    result = { ok: false, status: 'skipped_no_provider', error: 'SMS provider not configured' };
  }

  // ── The auditable trail: every attempt, whatever the outcome ──
  try {
    const logRef = db.collection(`tenants/${tenantId}/messageLog`).doc();
    await logRef.set({
      id: logRef.id,
      channel, kind,
      to: mask(to),
      subject: input.subject || null,
      status: result.status,
      error: result.error || null,
      providerId: result.providerId || null,
      appointmentId: input.appointmentId || null,
      clientId: input.clientId || null,
      clientName: input.clientName || null,
      sentAt: new Date().toISOString(),
    });
    await logAuditAdmin(db, tenantId, {
      action: `notify.${result.status}`,
      targetType: 'message', targetId: logRef.id,
      summary: `${kind.replace(/_/g, ' ')} ${channel} to ${input.clientName || mask(to)} — ${
        result.status === 'sent' ? 'sent' : result.status === 'failed' ? `FAILED (${result.error})` : 'skipped (no provider configured)'
      }`,
      actor: { type: 'system', name: 'notifications' },
    });
  } catch { /* logging must never break the send itself */ }

  return result;
}

// ── Shared email shell — simple, renders everywhere, studio name on top ──
export function emailShell(studioName: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;text-align:center;margin:0 0 16px;">${studioName}</p>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;color:#0f172a;font-size:15px;line-height:1.6;">
      ${bodyHtml}
    </div>
    <p style="font-size:11px;color:#cbd5e1;text-align:center;margin:16px 0 0;">Sent by ${studioName} via ClarityFlow</p>
  </div>
</body></html>`;
}
