// src/lib/health-privacy.ts — HEALTH PRIVACY MODE AND DISCREET MESSAGES.
//
// For businesses that hold health information (med spas, clinics, therapy, injectables), or any business that turns it on:
//   • Discreet messages: texts and emails say only that there's an update, with the link. No service, no treatment, no
//     health details in a lock-screen preview. (On by default in health mode; any business can turn it on.)
//   • Auto sign-out: staff screens sign out after a few idle minutes.
//   • The language model is off for anything client-related until the business confirms a signed agreement covering it.
//   • Opening a client's health or consent answers is logged (who, when, which client).
// Settings live on the tenant at `privacy` (Settings → Booking policies → Privacy).
const HEALTH = /med|clinic|aesthetic|inject|therap|chiro|physio|dental|derm|counsel|wellness|iv\b|infusion/;

export function isHealthBusiness(t: any): boolean {
  const k = String(t?.businessType || t?.category || t?.makingItRight?.preset || '').toLowerCase();
  return HEALTH.test(k);
}

export type PrivacySettings = { healthMode: boolean; discreet: boolean; autoSignOutMin: number; modelAllowed: boolean; retentionYears: number; detected: boolean };
export function privacyOf(t: any): PrivacySettings {
  const p = t?.privacy || {}; const detected = isHealthBusiness(t);
  const healthMode = typeof p.healthMode === 'boolean' ? p.healthMode : detected;
  return {
    healthMode, detected,
    discreet: typeof p.discreet === 'boolean' ? p.discreet : healthMode,
    autoSignOutMin: healthMode ? Math.min(60, Math.max(5, Number(p.autoSignOutMin) || 15)) : 0,
    modelAllowed: !healthMode || p.modelAgreementSigned === true,
    retentionYears: Math.max(1, Number(p.retentionYears) || (healthMode ? 7 : 3)),
  };
}

/** Messages that are never rewritten: the code itself, and replies to "Not you?". */
const KEEP = new Set(['verify_code', 'wrong_number_ack', 'staff_message']);
/** The discreet version of a message: that there is an update, and the link. */
export function discreetVersion(msg: { kind?: string | null; text?: string; subject?: string; channel: string }, studio: string): { text: string; subject?: string } | null {
  if (msg.kind && KEEP.has(String(msg.kind))) return null;
  const text = String(msg.text || ''); const link = (text.match(/https?:\/\/\S+/) || [])[0];
  const line = link ? `You have an update about your appointment. Please open your secure link for details: ${link}` : 'You have an update about your appointment. Please contact us for details.';
  return msg.channel === 'email' ? { text: line, subject: `An update from ${studio}` } : { text: line };
}

/** Log that a person opened a client's health or consent answers. */
export async function logHealthView(db: any, t: string, v: { clientId: string; uid: string; name?: string | null; what: string; appointmentId?: string | null }) {
  try { const r = db.collection(`tenants/${t}/healthViewLog`).doc();
    await r.set({ id: r.id, clientId: v.clientId, uid: v.uid, name: v.name || null, what: String(v.what).slice(0, 60), appointmentId: v.appointmentId || null, at: new Date().toISOString() }); } catch { /* never blocks */ }
}

/** The steps to follow if health information may have reached the wrong person. */
export const BREACH_STEPS = [
  'Stop it continuing: turn off the link or the number (the client’s “Not you?” does this), and change any shared passwords.',
  'Write down what happened: what information, about whom, who saw it, when, and how you found out.',
  'Work out the risk: was it actually seen, was it health information, and has it been returned or deleted?',
  'Tell the client without unreasonable delay, and no later than 60 days after you found out.',
  'If 500 or more people are affected, also tell the regulator and the media within 60 days; fewer than 500, log it and report it within 60 days of the end of the year.',
  'Keep the record for at least six years.',
];
