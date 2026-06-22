/**
 * src/app/api/opal/recovery-scan/route.ts
 *
 * The heartbeat that drives the recovery cascade. Hit on a schedule by GitHub
 * Actions cron (same approach as your automation checker — Vercel Hobby cron is
 * too limited). Loads every active recovery ticket across a tenant and calls
 * advanceRecoveryTier on each: tiers fall through on timebox expiry, dead slots
 * expire. Safe to run every minute — it's a no-op until a timebox actually
 * elapses.
 *
 * Secure with a shared secret so only your cron can call it:
 *   GET /api/opal/recovery-scan?tenantId=...&key=RECOVERY_SCAN_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { advanceRecoveryTier } from '@/lib/opal/recovery-engine';

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

const ACTIVE_STATUSES = ['tier1_active', 'tier2_active', 'tier3_active', 'tier4_active'];

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  const key      = req.nextUrl.searchParams.get('key');

  if (key !== process.env.RECOVERY_SCAN_SECRET) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 });
  }
  if (!tenantId) {
    return NextResponse.json({ ok: false, reason: 'Missing tenantId' }, { status: 400 });
  }

  try {
    const db = getAdminDb();

    const snap = await db
      .collection(`tenants/${tenantId}/tickets`)
      .where('kind', '==', 'recovery')
      .where('status', 'in', ACTIVE_STATUSES)
      .limit(200)
      .get();

    const results: Record<string, number> = {
      scanned: snap.size, advanced: 0, expired: 0, unchanged: 0,
    };

    for (const doc of snap.docs) {
      const ticket = doc.data() as any;
      const before = ticket.status;
      const after  = await advanceRecoveryTier(db, ticket);
      if (after === before) results.unchanged++;
      else if (after === 'expired') results.expired++;
      else results.advanced++;
    }

    return NextResponse.json({ ok: true, tenantId, scannedAt: new Date().toISOString(), ...results });
  } catch (err: any) {
    return NextResponse.json({ ok: false, reason: err?.message }, { status: 500 });
  }
}
