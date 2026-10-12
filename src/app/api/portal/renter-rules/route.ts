// src/app/api/portal/renter-rules/route.ts — PART 6: the renter's side of building rules (lib/renter-rules).
// Signed in with the renter portal's session token.
//   list                                  → the building rules for them, with signed / sign / sign again
//   sign { documentId, signature?, quiz? } → their sign-off for the current version
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession } from '@/lib/renter-session';
import { rulesFor, signRule } from '@/lib/renter-rules';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
  if (!s) return j({ ok: false, error: 'Please sign in again.' }, 401);
  const action = String(b.action || 'list');
  if (action === 'list') return j(await rulesFor(db, tenantId, s.renterId));
  if (action === 'sign') { const r: any = await signRule(db, tenantId, s.renterId, String(b.documentId || '').slice(0, 120), { signature: b.signature || null, quiz: b.quiz || null }); return j(r, r.ok ? 200 : 409); }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
