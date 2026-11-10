/**
 * /api/booths/w9 — v1
 *
 * POST — renter submits their W-9 data from the portal.
 *         TIN is encrypted immediately on the server before Firestore write.
 *         The plaintext TIN never hits a log, never touches Firestore.
 *
 * GET  — owner fetches a renter's W-9 status (masked TIN + metadata only).
 *         Full TIN decryption is available only via a separate
 *         owner-authenticated endpoint (not built yet — add when 1099
 *         generation is built, behind an additional auth check).
 *
 * SECURITY NOTES:
 *  - POST body contains plaintext TIN in transit — HTTPS only (enforced
 *    by Vercel; never serve over HTTP in production).
 *  - The plaintext TIN is encrypted and immediately discarded.
 *  - Only tinLast4 and encryptedTin are persisted.
 *  - The route validates TIN format before encrypting.
 *  - Both POST and GET need a signed-in manager, or the renter themself signed in through the staff portal
 *    (mayTouchW9). The renter portal saves a W-9 through its own session instead: /api/portal/renter, actions
 *    w9-status and w9-save, with the same checks and sealing (lib/w9-record).
 */

import { requireRole } from '@/lib/route-guard';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sealW9, w9Problem, w9View } from '@/lib/w9-record';
import { readW9, writeW9 } from '@/lib/w9-store';

// POST — W-9 submission from the portal
/** A W-9 is read or saved only by a manager, or by the renter it belongs to (signed in through the staff portal). */
async function mayTouchW9(req: NextRequest, tenantId: string, renterId: string) {
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  const a = g.actor; if (a.isManager || a.uid === renterId) return null;
  const db = getAdminDb();
  const [me, renter] = await Promise.all([db.doc(`tenants/${tenantId}/staff/${a.uid}`).get(), db.doc(`tenants/${tenantId}/renters/${renterId}`).get()]);
  const m: any = me.data() || {}, r: any = renter.data() || {};
  if (m.renterId === renterId || r.userId === a.uid || r.staffId === a.uid || r.uid === a.uid) return null;
  return NextResponse.json({ ok: false, error: 'Only a manager or the renter can see or change these tax details.' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, renterId } = body || {};
    if (!tenantId || !renterId) return NextResponse.json({ ok: false, error: 'Missing tenantId or renterId.' }, { status: 400 });
    { const deny = await mayTouchW9(req, String(tenantId), String(renterId)); if (deny) return deny; }
    const problem = w9Problem(body || {});
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

    const db = getAdminDb();
    // Verify the renter exists before writing
    const renterSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!renterSnap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });

    // ── ENCRYPT immediately (lib/w9-record): plaintext TIN never goes anywhere else ──
    const now = new Date().toISOString();
    const w9 = sealW9(body, now);
    await writeW9(db, String(tenantId), String(renterId), w9);   // lib/w9-store: the record in private, a flag on the renter

    // Return only masked data — never echo the TIN back
    return NextResponse.json({ ok: true, tinMasked: w9View(w9)?.tinMasked || '', collectedAt: now });
  } catch (err: any) {
    // Never log body content — could contain TIN
    console.error('[w9] POST failed', err?.message || 'unknown');
    return NextResponse.json({ ok: false, error: 'Could not save W-9 data.' }, { status: 500 });
  }
}

// GET — owner fetches W-9 status for a renter (masked only)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    const renterId = searchParams.get('renterId');
    if (!tenantId || !renterId) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    { const deny = await mayTouchW9(req, String(tenantId), String(renterId)); if (deny) return deny; }

    const db = getAdminDb();
    const snap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    // This read can also write: a W-9 still on the renter document is moved into private (lib/w9-store). Don't cache it.
    const stored = await readW9(db, String(tenantId), String(renterId));

    // Status only: the masked number and what was given, never the encrypted number (lib/w9-record)
    return NextResponse.json({ ok: true, w9: w9View(stored) });

  } catch (err) {
    console.error('[w9] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not fetch W-9 status.' }, { status: 500 });
  }
}
