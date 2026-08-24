import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createHash } from 'crypto';

// ─── /api/portal/renter-connect ───────────────────────────────────────────────
// A booth renter connecting THEIR OWN Stripe account.
//
// This mirrors /api/stripe/connect (which onboards the studio) but the account
// belongs to the renter, and the id is written to their renter doc — never to
// the tenant. That separation is the whole point: when charges eventually run
// for their services they are created ON their account, so funds, refunds,
// disputes and the 1099 are all theirs. The studio is the platform that
// introduced the client, not a party to the payment.
//
// GET  ?tenantId=&token=   → redirects into Stripe's hosted onboarding
// POST { action: 'status' } → refreshes and returns capability flags
//
// FAILS SOFT: a renter mid-onboarding (details submitted, charges not yet
// enabled) is a normal, expected state. Nothing here ever blocks a booking —
// their services simply stay pay-in-person until Stripe says charges are live.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-renter-connect';
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

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// Same session contract the renter portal uses — tokens are stored HASHED as
// keys inside tenants/{t}/private/renterSessions, never as plaintext docs. The
// token is the credential; it is re-checked here rather than trusted.
function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

async function resolveRenterSession(db: any, tenantId: string, token: string): Promise<{ renterId: string } | null> {
  if (!tenantId || !token) return null;
  try {
    const snap = await db.doc(`tenants/${tenantId}/private/renterSessions`).get();
    const all = ((snap.data() as any) || {});
    const s = all[sha256(token)];
    if (!s?.renterId) return null;
    if (s.expiresAt && Number(s.expiresAt) < Date.now()) return null;
    return { renterId: String(s.renterId) };
  } catch {
    return null;
  }
}

async function syncAccount(stripe: Stripe, db: any, tenantId: string, renterId: string, accountId: string) {
  try {
    const acct = await stripe.accounts.retrieve(accountId);
    await db.doc(`tenants/${tenantId}/renters/${renterId}`).set({
      stripeChargesEnabled:   !!acct.charges_enabled,
      stripePayoutsEnabled:   !!acct.payouts_enabled,
      stripeDetailsSubmitted: !!acct.details_submitted,
    }, { merge: true });
    return {
      chargesEnabled: !!acct.charges_enabled,
      payoutsEnabled: !!acct.payouts_enabled,
      detailsSubmitted: !!acct.details_submitted,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, '');
  const tenantId = url.searchParams.get('tenantId') || '';
  const token = url.searchParams.get('token') || '';
  const back = `${appUrl}/rent/${encodeURIComponent(tenantId)}`;

  if (!tenantId || !token) return NextResponse.redirect(`${back}?stripe=error&reason=missing_session`);

  try {
    const db = getAdminDb();
    const session = await resolveRenterSession(db, tenantId, token);
    if (!session) return NextResponse.redirect(`${back}?stripe=error&reason=session_expired`);

    const rRef = db.doc(`tenants/${tenantId}/renters/${session.renterId}`);
    const rSnap = await rRef.get();
    if (!rSnap.exists) return NextResponse.redirect(`${back}?stripe=error&reason=renter_not_found`);
    const renter = rSnap.data() as any;

    const stripe = getStripe();
    let accountId: string | undefined = renter?.stripeAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
        business_profile: {
          name: `${renter.firstName || ''} ${renter.lastName || ''}`.trim() || undefined,
        },
        // Marked as a renter account so it can never be confused with the
        // studio's own connected account in logs or webhooks.
        metadata: { tenantId, renterId: session.renterId, kind: 'renter' },
      });
      accountId = account.id;
      await rRef.set({
        stripeAccountId: accountId,
        stripeConnectedAt: new Date().toISOString(),
        stripeChargesEnabled: false,
        stripeDetailsSubmitted: false,
      }, { merge: true });
    } else {
      await syncAccount(stripe, db, tenantId, session.renterId, accountId);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/api/portal/renter-connect?tenantId=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}`,
      return_url:  `${back}?stripe=connected`,
      type: 'account_onboarding',
    });

    return NextResponse.redirect(link.url);
  } catch (e: any) {
    console.error('[portal/renter-connect] error:', e?.message);
    return NextResponse.redirect(`${back}?stripe=error&reason=${encodeURIComponent(String(e?.message || 'unknown'))}`);
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 }); }

  const tenantId = String(body?.tenantId || '');
  const token = String(body?.token || '');
  const action = String(body?.action || 'status');

  try {
    const db = getAdminDb();
    const session = await resolveRenterSession(db, tenantId, token);
    if (!session) return NextResponse.json({ ok: false, error: 'session_expired' }, { status: 401 });

    const rSnap = await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).get();
    const renter = rSnap.exists ? (rSnap.data() as any) : null;
    const accountId = renter?.stripeAccountId || '';

    if (action === 'disconnect') {
      // Forget the link on our side only. Their Stripe account keeps existing
      // and keeps its history — it is theirs, and we never delete it.
      await db.doc(`tenants/${tenantId}/renters/${session.renterId}`).set({
        stripeAccountId: '', stripeChargesEnabled: false,
        stripePayoutsEnabled: false, stripeDetailsSubmitted: false,
      }, { merge: true });
      return NextResponse.json({ ok: true, connected: false });
    }

    if (!accountId) return NextResponse.json({ ok: true, connected: false });

    const stripe = getStripe();
    const fresh = await syncAccount(stripe, db, tenantId, session.renterId, accountId);
    return NextResponse.json({
      ok: true,
      connected: true,
      chargesEnabled: fresh ? fresh.chargesEnabled : !!renter?.stripeChargesEnabled,
      payoutsEnabled: fresh ? fresh.payoutsEnabled : !!renter?.stripePayoutsEnabled,
      detailsSubmitted: fresh ? fresh.detailsSubmitted : !!renter?.stripeDetailsSubmitted,
    });
  } catch (e: any) {
    console.error('[portal/renter-connect] status error:', e?.message);
    return NextResponse.json({ ok: false, error: 'status_failed' });
  }
}
