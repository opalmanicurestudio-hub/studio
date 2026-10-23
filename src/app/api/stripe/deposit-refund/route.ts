import { refundDepositCredit } from '@/lib/deposit-refund';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';

// ─── Lazy inits — must NOT be at module scope (build-time env vars unavailable) ─
function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    }, APP_NAME);
  }
  return getFirestore(app);
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Refunds an appointment deposit and records it as a return (lib/deposit-refund).
//
// Called only for the 'refund' outcome — rollover and forfeit never hit Stripe.
// Only a deposit still there to use can be refunded, claimed in one step first (a checkout using it at the same
// moment, or a second tap, finds it gone), refunded under one key, and recorded once.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { tenantId, creditId } = await req.json();
    const g = await requireRole(req, String(tenantId || ''), 'manager'); if (g.deny) return g.deny;
    if (!tenantId || !creditId) {
      return NextResponse.json({ error: 'Missing tenantId or creditId' }, { status: 400 });
    }
    // Claimed, refunded under one key for the deposit, and recorded once (lib/deposit-refund).
    const r = await refundDepositCredit(getAdminDb(), String(tenantId), String(creditId), getStripe(), { by: (g.actor as any)?.name || null });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, refundId: r.refundId, amount: r.amount, ...(r.already ? { already: true } : {}) });
  } catch (err: any) {
    console.error('[stripe/deposit-refund]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
