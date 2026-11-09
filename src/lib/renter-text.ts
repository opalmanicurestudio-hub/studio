// src/lib/renter-text.ts — A TEXT TO A RENTER, THROUGH MESSAGE SETTINGS LIKE EVERY OTHER MESSAGE.
//
// Texts to renters (a reminder that rent is due, a past-due notice, paperwork that's missing or expiring, a repair, a
// day swap, a sign-in code) go through lib/notify, so each one obeys the business's message settings and quiet hours,
// respects a STOP, and lands on the renter's notice record word for word, sent or not and why (lib/notice-record).
// When the text can't go and the caller wants it, the same words go by email instead, through the same door.
import { sendNotification, type NotifyResult } from './notify';

export type RenterTextResult = {
  ok: boolean;
  /** How it went, or is going: a text held for quiet hours counts as on its way. */
  via: 'sms' | 'email' | null;
  held?: boolean;
  /** Not sent, and asking again won't change that: switched off in message settings, or they replied STOP. */
  final?: boolean;
  status: NotifyResult['status'];
  error?: string;
};

export async function textRenter(db: any, o: {
  tenantId: string;
  renterId: string | null;
  renter: any;
  kind: string;
  text: string;
  /** Subject for the email, when it goes by email instead. */
  subject?: string;
  /** Merge values for the business's own wording of this message (lib/message-policy). */
  tokens?: Record<string, string | number | null | undefined>;
  /** Sent at any hour: a code the person just asked for. */
  essential?: boolean;
  /** Email the same words when the text can't go (no number, texting not set up, failed, or they replied STOP). */
  emailFallback?: boolean;
  /** The phone to text, when it isn't the renter record's own (a sign-in code goes to the number they typed). */
  phone?: string | null;
  email?: string | null;
}): Promise<RenterTextResult> {
  const r = o.renter || {};
  const name = `${String(r.firstName || '').trim()} ${String(r.lastName || '').trim()}`.trim() || String(r.name || '').trim() || null;
  // To the renter: recipientType and recipientId say so. (Never renterId, which marks a text sent on a renter's behalf
  // to their own clients, so a reply goes back to them: lib/renter-inbox.)
  const who = { recipientType: 'renter' as const, recipientId: o.renterId || null, recipientName: name };
  const phone = String(o.phone ?? r.phone ?? '').trim();
  const email = String(o.email ?? r.email ?? '').trim();
  let last: NotifyResult | null = null;
  let smsReady = false;
  try { const { smsConfigured } = await import('./sms'); smsReady = smsConfigured(); } catch { smsReady = false; }
  if (phone.replace(/\D/g, '').length >= 10 && smsReady) {
    last = await sendNotification(db, {
      tenantId: o.tenantId, channel: 'sms', to: phone, text: o.text, kind: o.kind,
      ...(o.tokens ? { tokens: o.tokens } : {}), ...(o.essential ? { essential: true } : {}), ...who,
    } as any).catch((e: any) => ({ ok: false, status: 'failed', error: String(e?.message || e).slice(0, 200) }) as NotifyResult);
    if (last.ok) return { ok: true, via: 'sms', status: last.status };
    if (last.held) return { ok: true, via: 'sms', held: true, status: last.status, error: last.error };
    // Switched off in message settings: the business chose not to send it, so it doesn't go another way either.
    if (last.status === 'skipped_by_policy' && /message settings/.test(String(last.error || ''))) return { ok: false, via: null, final: true, status: last.status, error: last.error };
  }
  const stopped = !!last && last.status === 'skipped_by_policy' && /STOP/.test(String(last.error || ''));
  if (o.emailFallback && /@/.test(email)) {
    const e = await sendNotification(db, {
      tenantId: o.tenantId, channel: 'email', to: email, text: o.text, kind: o.kind,
      ...(o.subject ? { subject: o.subject } : {}), ...(o.tokens ? { tokens: o.tokens } : {}), ...who,
    } as any).catch((err: any) => ({ ok: false, status: 'failed', error: String(err?.message || err).slice(0, 200) }) as NotifyResult);
    if (e.ok) return { ok: true, via: 'email', status: e.status };
    last = e;
  }
  return { ok: false, via: null, ...(stopped && !(o.emailFallback && /@/.test(email)) ? { final: true } : {}), status: last?.status || 'failed', error: last?.error || 'No phone or email to reach them' };
}
