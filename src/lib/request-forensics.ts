import type { NextRequest } from 'next/server';

// ─── src/lib/request-forensics.ts ─────────────────────────────────────────────
// Captures WHO-FROM evidence for high-stakes customer self-serve actions:
// cancels, address changes, return opens, claims, appeals. The IP + browser
// string on the event record is exactly what wins a "someone else did this"
// dispute — Stripe's representment forms ask for it by name.
//
// Rules of use, deliberately narrow:
//   · High-stakes actions ONLY — never status polls or page views.
//   · Evidence, not decoration: it lands in event/claim meta and is shown to
//     STAFF on the evidence record. Customer-facing responses never carry it
//     (the claims GET whitelists fields; the order page never receives it).
//   · Size-capped and null-safe: absent headers record nothing rather than
//     an empty shell.

export type RequestForensics = { ip: string | null; ua: string | null };

export function requestForensics(req: NextRequest): RequestForensics | null {
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    // First hop of x-forwarded-for is the client on Vercel; x-real-ip is the
    // fallback some proxies set instead.
    const fwd = String(req.headers.get('x-forwarded-for') || '');
    ip = fwd.split(',')[0].trim() || String(req.headers.get('x-real-ip') || '').trim() || null;
    if (ip && ip.length > 45) ip = ip.slice(0, 45);
    ua = String(req.headers.get('user-agent') || '').trim().slice(0, 160) || null;
  } catch {
    return null;
  }
  return ip || ua ? { ip, ua } : null;
}
