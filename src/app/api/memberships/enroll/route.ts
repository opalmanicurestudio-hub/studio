/**
 * POST /api/memberships/enroll — v1
 *
 * Client-callable wrapper around lib/memberships/enroll-membership.ts's
 * two engine functions (enrollMembership, enrollPackage). Built so
 * pos-page.tsx's handleCheckout can call this AFTER its own batch commits
 * — the ledger line for the sale is already written there; this call uses
 * paymentMethod: 'already_charged' + skipLedger: true so it performs ONLY
 * the enrollment write (activeMembershipId/subscription, or a fresh
 * activePackages entry), never a duplicate charge or a duplicate ledger
 * line for the same sale.
 *
 * Also reachable for a future admin "manually add a membership/package"
 * action, or anywhere else in the app that collects payment through
 * CheckoutHub's existing card flows and needs the enrollment write to
 * follow.
 *
 * Auth: none beyond normal app session — this is called from inside the
 * authenticated POS UI, not a public-facing route. If this route is ever
 * exposed to a context without that guarantee, add a staff-auth check
 * (see lib/voice/staff-auth.ts's verifyStaff for the existing pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { enrollMembership, enrollPackage } from '@/lib/memberships/enroll-membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const {
    tenantId, clientId, offeringType, offeringId,
    paymentMethod, existingPaymentIntentId, source, skipLedger,
  } = body;

  if (!tenantId || !clientId || !offeringId || (offeringType !== 'membership' && offeringType !== 'package')) {
    return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const input = {
      tenantId,
      clientId,
      paymentMethod: paymentMethod || 'already_charged',
      existingPaymentIntentId,
      source: source || 'pos_checkout',
      skipLedger: skipLedger !== false, // default true — the primary caller (POS checkout) always wants this
    };

    const result = offeringType === 'membership'
      ? await enrollMembership(db, { ...input, membershipId: offeringId })
      : await enrollPackage(db, { ...input, packageId: offeringId });

    return NextResponse.json(result);
  } catch (e) {
    console.error('[memberships/enroll]', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
