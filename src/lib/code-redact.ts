// src/lib/code-redact.ts — A ONE-TIME CODE NEVER SITS READABLE IN A LOG. Codes are sent to prove an email or a phone is
// someone's own (lib/client-verify, lib/order-contact); the message log the team can read keeps the message with the
// code hidden, so nobody else can read it there and use it. Pure.
export function hideCodes(kind: unknown, text: string): string {
  if (String(kind || '') !== 'verify_code') return text;
  return String(text || '').replace(/\b\d{4,8}\b/g, '••••••');
}
