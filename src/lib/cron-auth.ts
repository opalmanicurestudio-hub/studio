// src/lib/cron-auth.ts — ONLY THE SCHEDULER MAY START A BACKGROUND JOB.
//
// Vercel Cron calls each job with "Authorization: Bearer <CRON_SECRET>". A job runs only when that header matches the
// secret exactly. When the secret isn't set on a deployment, every call is turned away: a missing setting must never
// leave the nightly run (which charges fees and rent) open to anyone who finds its address.
//   const refused = refuseCron(req); if (refused) return refused;
import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

export function cronAllowed(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = String(process.env.CRON_SECRET || '');
  if (!secret.trim() || secret === 'undefined' || secret === 'null') return false;
  const got = Buffer.from(String(req?.headers?.get('authorization') || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** null when the scheduler may go ahead; otherwise the answer to send back. */
export function refuseCron(req: { headers: { get(name: string): string | null } }): NextResponse | null {
  return cronAllowed(req) ? null : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}
