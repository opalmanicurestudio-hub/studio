// /api/stripe/connect/callback — RETIRED. This was the older "connect with Stripe" return address. It trusted the
// business id in the address, so anyone could have attached their own Stripe account to someone else's business.
// Payments are set up through /api/stripe/connect now (signed in, owner only); this address only sends people there.
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  return NextResponse.redirect(`${appUrl}/settings?tab=payments`);
}
