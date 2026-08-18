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

// ── Appointment ACTION-TOKEN — the key inside every Cancel/Reschedule
// button. Minted lazily on the appointment doc; senders call this to
// build manage links, /api/appt validates against it.
export async function ensureApptToken(db: any, tenantId: string, apptId: string): Promise<string | null> {
  try {
    const ref = db.doc(`tenants/${tenantId}/appointments/${apptId}`);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const cur = (snap.data() as any)?.manageToken;
    if (cur && String(cur).length >= 16) return cur;
    const token = Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 10)).join('') + Date.now().toString(36);
    await ref.set({ manageToken: token }, { merge: true });
    return token;
  } catch { return null; }
}

export type NotifyInput = {
  /** Merge values for owner-customized copy. Ignored when the shop has not
   *  written its own version of this message kind. */
  tokens?: Record<string, string | number | null | undefined>;
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
  // v17 — who is this for? Enables the Message Log screen to group sends
  // by audience (clients / staff / renters / maintenance). When omitted,
  // clientId implies 'client'; texts are auto-matched by phone number.
  recipientType?: 'client' | 'staff' | 'renter' | 'maintenance' | 'contact' | 'other';
  recipientId?: string | null;
  recipientName?: string | null;
};

export type NotifyResult = {
  ok: boolean;
  status: 'sent' | 'failed' | 'skipped_no_provider' | 'skipped_by_policy';
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

  /* ═══ MESSAGE POLICY ══════════════════════════════════════════════════════
   * Every client-facing send passes through here carrying its `kind`, which
   * makes this the one honest place to ask two questions: does this shop want
   * this message at all, and have they written their own words for it?
   *
   * Enforced HERE rather than at each call site so a kind can never be
   * switched off in settings and still go out from some route nobody
   * remembered. Messages a client has a right to (money moved, request
   * declined, deposit needed) are refused disablement inside the resolver, so
   * this block cannot suppress them however the database is edited.
   *
   * A suppressed message is logged as 'skipped_by_policy' rather than
   * silently dropped — an owner asking "why didn't they get that?" deserves
   * the answer in the timeline. */
  let policy: { enabled: boolean; subject: string; body: string; custom: boolean; overrideRejected?: string } = {
    enabled: true, subject: '', body: '', custom: false,
  };
  let tenantDoc: any = null;
  if (kind) {
    try {
      const { resolveMessagePolicy } = await import('./message-policy');
      tenantDoc = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      policy = resolveMessagePolicy(tenantDoc, String(kind), channel === 'sms' ? 'sms' : 'email');
    } catch {
      // A policy lookup failure must never stop a message — fail OPEN.
    }
  }
  // Suppression falls through to the SAME logging path every other outcome
  // uses, so a message the shop switched off still appears in the timeline
  // with its reason — an owner asking "why didn't they get that?" gets an
  // answer instead of a silence.
  const suppressed = !policy.enabled;

  /* Owner copy wins over the caller's default wording. The caller still
   * supplies the TOKENS; the owner supplies the sentence. */
  if (policy.custom && policy.body) {
    const { renderMessage } = await import('./message-policy');
    const tokens = (input as any).tokens || {};
    const rendered = renderMessage(policy.body, tokens);
    if (rendered) {
      input = {
        ...input,
        text: rendered,
        // Custom copy replaces the BODY; the branded shell is rebuilt around
        // it below, so a shop writing its own words still gets its own look.
        html: undefined,
        ...(policy.subject ? { subject: renderMessage(policy.subject, tokens) } : {}),
      };
    }
  }

  /* QUIET HOURS — texts only. An email at 3am waits in an inbox; a text at
   * 3am wakes someone up. Deferred rather than dropped: the log records why,
   * and nothing that must reach a person tonight is a text anyway. */
  let quietDeferred = false;
  if (!suppressed && channel === 'sms' && tenantDoc) {
    try {
      const { resolveQuietHours, inQuietHours } = await import('./message-policy');
      quietDeferred = inQuietHours(resolveQuietHours(tenantDoc), new Date());
    } catch { /* fail open */ }
  }

  if (suppressed) {
    result = { ok: false, status: 'skipped_by_policy', error: `${kind} is switched off in message settings` };
  } else if (quietDeferred) {
    result = { ok: false, status: 'skipped_by_policy', error: 'held back — inside your quiet hours' };
  } else if (channel === 'email') {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      result = { ok: false, status: 'skipped_no_provider', error: 'RESEND_API_KEY not set' };
    } else {
      try {
        // EVERY email wears the brand. Callers that pass no custom html get
        // the branded template automatically — masthead, card, CTA button —
        // so a booking confirmation and a sign-in code look like siblings.
        let html = input.html;
        if (!html) {
          let studioName = 'Your studio';
          try { studioName = ((await db.doc(`tenants/${tenantId}`).get()).data() as any)?.name || studioName; } catch { /* cosmetic */ }
          const { brandedEmailHtml } = await import('./email-template');
          const text = input.text || '';
          const linkMatch = text.match(/https?:\/\/\S+/);
          html = brandedEmailHtml({
            studioName,
            title: input.subject || 'A note from your studio',
            bodyLines: [linkMatch ? text.replace(linkMatch[0], '').replace(/\s{2,}/g, ' ').trim() : text],
            cta: linkMatch ? { label: 'Open', url: linkMatch[0] } : null,
          });
        }
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from: process.env.NOTIFY_FROM_EMAIL || 'ClarityFlow <onboarding@resend.dev>',
            to: [to],
            subject: input.subject || 'A note from your studio',
            html,
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
    // SMS — wired through the tenant-branded Twilio layer (with its
    // built-in first-contact opt-out and private smsLog). sendTenantSms
    // writes the messageLog entry itself (with recipient linkage and the
    // msgIndex mapping for delivery tracking), so this branch skips the
    // duplicate write below.
    try {
      const { smsConfigured, sendTenantSms } = await import('./sms');
      if (!smsConfigured()) {
        result = { ok: false, status: 'skipped_no_provider', error: 'SMS provider not configured' };
      } else {
        const r = await sendTenantSms(db, tenantId, to, input.text || '', undefined, {
          kind,
          appointmentId: input.appointmentId || null,
          recipientType: input.recipientType || (input.clientId ? 'client' : undefined),
          recipientId: input.recipientId || input.clientId || null,
          recipientName: input.recipientName || input.clientName || null,
        });
        result = r.ok
          ? { ok: true, status: 'sent', providerId: r.sid || null }
          : { ok: false, status: 'failed', error: r.error || 'SMS failed' };
      }
    } catch (e: any) {
      result = { ok: false, status: 'failed', error: String(e?.message || e).slice(0, 200) };
    }
  }

  // ── The auditable trail: every attempt, whatever the outcome ──
  // (SMS sends are logged inside sendTenantSms with recipient linkage —
  // only email logs here, to avoid duplicate entries.)
  try {
    if (channel === 'email') {
    const logRef = db.collection(`tenants/${tenantId}/messageLog`).doc();
    await logRef.set({
      id: logRef.id,
      channel, kind,
      // v16 — the REAL address/number, not masked. The owner reads this
      // log to spot typos ("client swears they got nothing" → the log
      // shows gmial.com) and fix-and-resend. Masking stays in the audit
      // summary below, which is the broader-audience surface.
      to,
      subject: input.subject || null,
      preview: input.text ? String(input.text).slice(0, 140) : null,
      status: result.status,
      error: result.error || null,
      providerId: result.providerId || null,
      appointmentId: input.appointmentId || null,
      clientId: input.clientId || null,
      clientName: input.clientName || null,
      // v17 — audience linkage for the Message Log screen
      recipientType: input.recipientType || (input.clientId ? 'client' : 'other'),
      recipientId: input.recipientId || input.clientId || null,
      recipientName: input.recipientName || input.clientName || null,
      sentAt: new Date().toISOString(),
      // Journey fields — filled in later by the provider webhooks
      // (/api/webhooks/resend for email, /api/sms/status for texts).
      deliveredAt: null, openedAt: null, clickedAt: null,
      bouncedAt: null, failureDetail: null,
    });
    // v16 — O(1) webhook lookup: providerId → {tenantId, logId}. Resend and
    // Twilio callbacks only know their own message id, not our tenant.
    if (result.providerId) {
      try {
        await db.doc(`msgIndex/${result.providerId}`).set({
          tenantId, logId: logRef.id, channel, at: new Date().toISOString(),
        });
      } catch { /* tracking is best-effort */ }
    }
    }
    await logAuditAdmin(db, tenantId, {
      action: `notify.${result.status}`,
      targetType: 'message', targetId: result.providerId || 'message',
      summary: `${kind.replace(/_/g, ' ')} ${channel} to ${input.recipientName || input.clientName || mask(to)} — ${
        result.status === 'sent' ? 'sent'
          : result.status === 'failed' ? `FAILED (${result.error})`
            : result.status === 'skipped_by_policy' ? 'skipped (switched off in message settings)'
              : 'skipped (no provider configured)'
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
