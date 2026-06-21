/**
 * api/admin/pipeline-health/route.ts
 *
 * Browser-hittable diagnostic for the cancellation + fee pipeline.
 * Built because there's no local Firebase CLI in this workflow — this is
 * how you confirm, from a URL, whether the things that are SUPPOSED to be
 * running in the background actually are.
 *
 * Usage:
 *   GET /api/admin/pipeline-health?tenantId=YOUR_TENANT_ID
 *
 * What it answers:
 *
 *  1. "Is onCancellationEvent actually deployed and firing?"
 *     The Firestore trigger is supposed to flip every cancellationEvent from
 *     'pending' → 'processing' → 'complete' within seconds. If events are
 *     sitting at 'pending' for minutes, the function is NOT running (never
 *     deployed, crashed on cold start, or missing env vars) — which means
 *     every client-cancel / no-show since then silently never charged a card
 *     or sent a notification. Stuck pending events older than a few minutes
 *     are the smoking gun.
 *
 *  2. "Are processing fees being captured?"
 *     Scans recent income-type transactions and reports how many are missing
 *     stripeFeeCents. A charge with no recorded fee is a hidden cost — gross
 *     revenue booked with no offsetting processing expense. (Cash / manual
 *     transactions legitimately have no fee; those are reported separately so
 *     the number isn't alarming on its own, just visible.)
 *
 * This route only READS. It changes nothing.
 */

import { NextRequest, NextResponse } from 'next/server';

function getAdmin() {
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
  return { db: getFirestore(app) };
}

function minutesAgo(iso: string): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return -1;
  return Math.round((Date.now() - t) / 60000);
}

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ ok: false, reason: 'Missing tenantId query param' }, { status: 400 });
  }

  try {
    const { db } = getAdmin();

    // ── 1. Cancellation event pipeline health ───────────────────────────────
    const eventsSnap = await db
      .collection(`tenants/${tenantId}/cancellationEvents`)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const counts = { pending: 0, processing: 0, complete: 0, failed: 0, other: 0 };
    let oldestStuckPendingMins = 0;
    let oldestStuckId: string | null = null;
    const failedSamples: any[] = [];

    eventsSnap.docs.forEach((d: any) => {
      const e = d.data();
      const status = e.status || 'other';
      if (status in counts) (counts as any)[status]++;
      else counts.other++;

      if (status === 'pending' && e.createdAt) {
        const age = minutesAgo(e.createdAt);
        if (age > oldestStuckPendingMins) {
          oldestStuckPendingMins = age;
          oldestStuckId = d.id;
        }
      }
      if (status === 'failed' && failedSamples.length < 5) {
        failedSamples.push({
          id: d.id,
          clientName: e.clientName,
          chargeStatus: e.chargeStatus,
          stripeErrorCode: e.stripeErrorCode,
          errorMessage: e.errorMessage,
          createdAt: e.createdAt,
        });
      }
    });

    // A healthy pipeline clears pending in seconds. Anything pending for
    // more than ~5 minutes strongly implies the function isn't running.
    const pipelineLikelyDeployed = !(counts.pending > 0 && oldestStuckPendingMins > 5);

    // ── 2. Processing-fee capture health ────────────────────────────────────
    const txSnap = await db
      .collection(`tenants/${tenantId}/transactions`)
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();

    let incomeWithFee = 0;
    let incomeMissingFee = 0;
    let incomeNonCardMissingFee = 0;
    const missingFeeSamples: any[] = [];

    txSnap.docs.forEach((d: any) => {
      const t = d.data();
      const isIncome =
        t.type === 'income' ||
        t.type === 'cancellation_fee' ||
        t.type === 'sale' ||
        t.category === 'Cancellation Fee' ||
        t.category === 'No-Show Revenue' ||
        t.category === 'Cancellation Revenue';
      if (!isIncome) return;

      const hasStripe = !!t.stripePaymentIntentId;
      const hasFee = typeof t.stripeFeeCents === 'number' && t.stripeFeeCents > 0;

      if (hasFee) {
        incomeWithFee++;
      } else if (hasStripe) {
        // Card transaction with no fee recorded — this is the real leak.
        incomeMissingFee++;
        if (missingFeeSamples.length < 8) {
          missingFeeSamples.push({
            id: d.id,
            type: t.type,
            category: t.category,
            amount: t.amount,
            stripePaymentIntentId: t.stripePaymentIntentId,
            createdAt: t.createdAt,
          });
        }
      } else {
        // No Stripe intent — cash / manual / external. Legitimately feeless.
        incomeNonCardMissingFee++;
      }
    });

    return NextResponse.json({
      ok: true,
      tenantId,
      checkedAt: new Date().toISOString(),

      cancellationPipeline: {
        likelyDeployed: pipelineLikelyDeployed,
        verdict: pipelineLikelyDeployed
          ? 'Events are being processed — onCancellationEvent appears to be running.'
          : `WARNING: ${counts.pending} event(s) stuck at pending, oldest ${oldestStuckPendingMins} min. onCancellationEvent is very likely NOT deployed or not firing. Run: firebase deploy --only functions`,
        eventCountsLast200: counts,
        oldestStuckPendingMinutes: oldestStuckPendingMins,
        oldestStuckEventId: oldestStuckId,
        recentFailedSamples: failedSamples,
      },

      feeCapture: {
        cardIncomeWithFeeRecorded: incomeWithFee,
        cardIncomeMissingFee: incomeMissingFee,
        nonCardIncomeFeelessLegit: incomeNonCardMissingFee,
        verdict: incomeMissingFee === 0
          ? 'No card transactions are missing a processing fee in the last 300 records.'
          : `WARNING: ${incomeMissingFee} card transaction(s) have a Stripe payment intent but NO recorded processing fee. These are hidden costs — gross booked with no fee expense.`,
        missingFeeSamples,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, reason: err?.message || 'Diagnostic failed', stack: err?.stack },
      { status: 500 },
    );
  }
}
