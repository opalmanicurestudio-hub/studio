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
 *  - No auth check on POST (renters are not signed in to their portal via
 *    Firebase auth — they use the PIN system). The tenantId + renterId
 *    pair acts as the access control; a valid submission requires knowing
 *    both. This is the same trust model as the public booking flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { encryptTin, tinLast4, maskTin } from '@/lib/tin-crypto';

const SSN_RE = /^\d{3}-?\d{2}-?\d{4}$/;
const EIN_RE = /^\d{2}-?\d{7}$/;

function validateTin(tin: string, type: 'ssn' | 'ein'): boolean {
  const clean = tin.replace(/\D/g, '');
  if (type === 'ssn') return SSN_RE.test(tin) || clean.length === 9;
  if (type === 'ein') return EIN_RE.test(tin) || clean.length === 9;
  return false;
}

// POST — W-9 submission from the portal
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tenantId, renterId,
      tin, tinType,
      legalName, businessName,
      address, entityType,
      certifiedUnderPenalty,
    } = body || {};

    if (!tenantId || !renterId) return NextResponse.json({ ok: false, error: 'Missing tenantId or renterId.' }, { status: 400 });
    if (!tin || !tinType) return NextResponse.json({ ok: false, error: 'TIN and TIN type are required.' }, { status: 400 });
    if (!['ssn','ein'].includes(tinType)) return NextResponse.json({ ok: false, error: 'Invalid TIN type.' }, { status: 400 });
    if (!validateTin(tin, tinType)) return NextResponse.json({ ok: false, error: `Invalid ${tinType.toUpperCase()} format.` }, { status: 400 });
    if (!legalName?.trim()) return NextResponse.json({ ok: false, error: 'Legal name is required.' }, { status: 400 });
    if (!certifiedUnderPenalty) return NextResponse.json({ ok: false, error: 'Certification is required.' }, { status: 400 });

    const db = getAdminDb();

    // Verify the renter exists before writing
    const renterSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!renterSnap.exists) return NextResponse.json({ ok: false, error: 'Renter not found.' }, { status: 404 });

    // ── ENCRYPT immediately — plaintext TIN never goes anywhere else ──
    const encryptedTin = encryptTin(tin.replace(/\D/g, '')); // store digits only
    const last4        = tinLast4(tin);
    const now          = new Date().toISOString();

    await db.doc(`tenants/${tenantId}/renters/${renterId}`).set({
      w9: {
        encryptedTin,
        tinType,
        tinLast4: last4,
        legalName:    String(legalName).trim().slice(0, 120),
        businessName: String(businessName || '').trim().slice(0, 120),
        address: {
          street: String(address?.street || '').trim().slice(0, 200),
          city:   String(address?.city   || '').trim().slice(0, 100),
          state:  String(address?.state  || '').trim().slice(0, 50),
          zip:    String(address?.zip    || '').trim().slice(0, 20),
        },
        entityType:          String(entityType || '').trim(),
        certifiedUnderPenalty: true,
        certifiedAt:         now,
        collectedAt:         now,
      },
    }, { merge: true });

    // Return only masked data — never echo the TIN back
    return NextResponse.json({
      ok: true,
      tinMasked: maskTin(last4, tinType),
      collectedAt: now,
    });

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

    const db = getAdminDb();
    const snap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

    const w9 = (snap.data() as any)?.w9;
    if (!w9) return NextResponse.json({ ok: true, w9: null });

    // Return status info only — no encrypted TIN, no last4 exposed to client
    return NextResponse.json({
      ok: true,
      w9: {
        tinMasked:    maskTin(w9.tinLast4, w9.tinType),
        tinType:      w9.tinType,
        legalName:    w9.legalName,
        businessName: w9.businessName,
        address:      w9.address,
        entityType:   w9.entityType,
        certifiedAt:  w9.certifiedAt,
        collectedAt:  w9.collectedAt,
      },
    });

  } catch (err) {
    console.error('[w9] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not fetch W-9 status.' }, { status: 500 });
  }
}
