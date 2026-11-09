// src/lib/code-redact.ts — A ONE-TIME CODE NEVER SITS READABLE IN A LOG. Codes are sent to prove an email or a phone is
// someone's own (lib/client-verify, lib/order-contact); the message log the team can read keeps the message with the
// code hidden, so nobody else can read it there and use it. Pure.
export function hideCodes(kind: unknown, text: string): string {
  // A renter's personal portal link signs them in for days (lib/renter-link ?rt=…): kept with its token hidden, whatever
  // the message, so nobody can open their portal from the log or a printed notice record.
  text = String(text ?? '').replace(/([?&](?:amp;)?rt=)[A-Za-z0-9_-]{16,}/g, '$1••••');
  // A wholesale buyer's code is money off, and only managers see codes (api/retail/wholesale emails it to them); its
  // link and the sign-in link carry a sign-in for 30 days. Neither is readable in the log.
  const k = String(kind || '');
  if (k === 'wholesale_code' || k === 'account_signin_link') return String(text || '').replace(/\bWS-[A-Z0-9]{4}-[A-Z0-9]{4}\b/gi, 'WS-••••-••••').replace(/([?&](?:amp;)?s=)[0-9a-f]{64}/gi, '$1••••');
  // A renter's portal sign-in code (api/portal/renter) is a one-time code too.
  if (k !== 'verify_code' && k !== 'renter_signin_code') return text;
  return String(text || '').replace(/\b\d{4,8}\b/g, '••••••');
}
