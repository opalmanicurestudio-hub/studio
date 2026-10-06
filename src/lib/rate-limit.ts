// src/lib/rate-limit.ts — HOW OFTEN THE PUBLIC MAY CALL A ROUTE THAT SENDS TEXTS OR EMAILS.
// Two limits, both counted in the database so they hold across every server instance:
//   per visitor (IP address) per hour  — stops one script hammering a form
//   per business per day               — a ceiling no amount of addresses can push past (text-pumping fraud runs up
//                                         a business's texting bill with fake numbers)
//   const limited = await limitPublic(req, 'book', tenantId, { perHour: 20, perDay: 500 }); if (limited) return limited;
// Counters live in rateLimits/{id}; old buckets are harmless (set a TTL policy on `expiresAt` to tidy them).
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';

export function visitorIp(req: NextRequest): string {
  return String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0, 64);
}
async function bump(id: string, max: number, ttlMs: number): Promise<boolean> {
  const db = getAdminDb(); const ref = db.collection('rateLimits').doc(id);
  return db.runTransaction(async (tx: any) => { const snap = await tx.get(ref); const n = Number(snap.exists ? (snap.data() || {}).count : 0) || 0;
    if (n >= max) return false; tx.set(ref, { count: n + 1, expiresAt: new Date(Date.now() + ttlMs) }, { merge: true }); return true; });
}
export async function limitPublic(req: NextRequest, scope: string, tenantId: string, opts: { perHour: number; perDay: number }): Promise<NextResponse | null> {
  try {
    const now = Date.now(); const hour = Math.floor(now / 3600000), day = Math.floor(now / 86400000);
    const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
    const okIp = await bump(`${scope}_ip_${h(`${tenantId}|${visitorIp(req)}`)}_${hour}`, opts.perHour, 2 * 3600000);
    if (!okIp) return NextResponse.json({ ok: false, error: 'Too many tries from here — please wait a little while and try again.' }, { status: 429 });
    const okDay = await bump(`${scope}_biz_${h(tenantId)}_${day}`, opts.perDay, 2 * 86400000);
    if (!okDay) return NextResponse.json({ ok: false, error: 'This is very busy right now — please call the business instead.' }, { status: 429 });
    return null;
  } catch { return null; }   // a counting hiccup never blocks a real customer
}
