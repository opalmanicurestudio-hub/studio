/**
 * src/app/api/opal/recovery-claim/route.ts
 *
 * A client claims a recovered opening (from a waitlist text, a favorites push,
 * or public booking). Delegates to claimRecoverySlot, which does the first-wins
 * lock and the fresh policy check against the claimant. Thin by design — all
 * logic lives in the engine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { claimRecoverySlot } from '@/lib/opal/recovery-engine';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const { tenantId, recoveryTicketId, claimantClientId, claimantType = 'known', channel = 'public_booking', isDiscountedSlot = false } = body;
  if (!tenantId || !recoveryTicketId || !claimantClientId) {
    return NextResponse.json({ error: 'Missing tenantId, recoveryTicketId, or claimantClientId' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const result = await claimRecoverySlot(db, { tenantId, recoveryTicketId, claimantClientId, claimantType, channel, isDiscountedSlot });
    if (!result.won) {
      return NextResponse.json({ ok: false, reason: result.reason || 'just_missed_it', message: 'That opening was just taken. Showing similar times.' });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[recovery-claim]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Claim failed' }, { status: 500 });
  }
}
