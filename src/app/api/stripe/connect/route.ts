import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, '');

  // This is actually the user's UID, not the tenant doc ID
  const userId = url.searchParams.get('tenantId') || '';
  if (!userId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  const referer = req.headers.get('referer') || `${appUrl}/settings`;
  const ret = referer.split('?')[0];

  try {
    const stripe = getStripe();
    const db = getAdminDb();

    // ── Look up the tenant by userId instead of using the ID directly ──
    const tenantsSnap = await db.collection('tenants')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (tenantsSnap.empty) {
      console.error('[stripe/connect] No tenant found for userId:', userId);
      return NextResponse.redirect(`${ret}?stripe=error&reason=studio_not_found`);
    }

    const tenantRef  = tenantsSnap.docs[0].ref;
    const tenantData = tenantsSnap.docs[0].data();

    let accountId: string | undefined = tenantData?.stripeAccountId;

    if (!accountId) {
      // Create a new Express account
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
        business_profile: {
          name: tenantData?.name || undefined,
        },
        metadata: { 
          userId,
          tenantId: tenantsSnap.docs[0].id,  // store the real tenant doc ID too
        },
      });
      accountId = account.id;

      // Save to the correct tenant doc
      await tenantRef.set(
        {
          stripeAccountId:      accountId,
          stripeConnectedAt:    new Date().toISOString(),
          stripeChargesEnabled: false,
        },
        { merge: true }
      );
    } else {
      // Refresh onboarding/charge status
      try {
        const acct = await stripe.accounts.retrieve(accountId);
        await tenantRef.set(
          {
            stripeChargesEnabled:   !!acct.charges_enabled,
            stripeDetailsSubmitted: !!acct.details_submitted,
          },
          { merge: true }
        );
      } catch { /* non-fatal */ }
    }

    // Generate hosted onboarding link
    const link = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${appUrl}/api/stripe/connect?tenantId=${encodeURIComponent(userId)}`,
      return_url:  `${ret}?stripe=connected`,
      type:        'account_onboarding',
    });

    return NextResponse.redirect(link.url);
  } catch (e: any) {
    console.error('[stripe/connect] error:', e?.message, e);
    const reason = encodeURIComponent(e?.message || 'Unknown error');
    return NextResponse.redirect(`${ret}?stripe=error&reason=${reason}`);
  }
}