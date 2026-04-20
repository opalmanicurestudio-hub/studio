// FILE 3: src/app/api/stripe/connect/route.ts
// Handles Stripe Connect OAuth — studio owner connects their Stripe account
// ─────────────────────────────────────────────────────────────────────────────
 
// GET  /api/stripe/connect?tenantId=xxx  → redirects to Stripe Connect OAuth
// GET  /api/stripe/connect/callback      → handles OAuth return, saves accountId
//
// import { NextRequest, NextResponse } from 'next/server';
// import Stripe from 'stripe';
// import { getFirestore } from 'firebase-admin/firestore';
//
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
//
// // Start OAuth flow
// export async function GET(req: NextRequest) {
//   const tenantId = req.nextUrl.searchParams.get('tenantId');
//   if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
//
//   const url = `https://connect.stripe.com/oauth/authorize?` +
//     `response_type=code` +
//     `&client_id=${process.env.STRIPE_CONNECT_CLIENT_ID}` +
//     `&scope=read_write` +
//     `&state=${tenantId}` +
//     `&redirect_uri=${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/callback`;
//
//   return NextResponse.redirect(url);
// }
//
// // Callback — exchange code for account ID
// // src/app/api/stripe/connect/callback/route.ts
// export async function GETCallback(req: NextRequest) {
//   const code     = req.nextUrl.searchParams.get('code');
//   const tenantId = req.nextUrl.searchParams.get('state');
//
//   if (!code || !tenantId) return NextResponse.redirect('/settings?stripe=error');
//
//   try {
//     const response = await stripe.oauth.token({ grant_type: 'authorization_code', code });
//     const accountId = response.stripe_user_id!;
//
//     const db = getFirestore();
//     await db.doc(`tenants/${tenantId}`).update({ stripeAccountId: accountId });
//
//     return NextResponse.redirect(`/settings?stripe=connected`);
//   } catch (err: any) {
//     console.error('[stripe/connect/callback]', err);
//     return NextResponse.redirect('/settings?stripe=error');
//   }
// }
