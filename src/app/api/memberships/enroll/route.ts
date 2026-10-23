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
 * Who may call: the business's own team (signed in) or our own server
 * (api/checkout/complete sends the internal header). Anyone else is turned
 * away before anything is granted: by default this route trusts that the
 * sale was already paid ('already_charged'), so an open door here handed out
 * free packages and memberships, and with 'card_on_file' it charges the
 * client's saved card.
 *
 * A double tap: the grant itself is written by lib/memberships/enroll-membership,
 * and its one caller (checkout) records each sale once before it calls here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { enrollMembership, enrollPackage } from '@/lib/memberships/enroll-membership';
import { staffOrServer } from '@/lib/route-guard';

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
  if (!(await staffOrServer(req, String(tenantId)).catch(() => false))) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
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
