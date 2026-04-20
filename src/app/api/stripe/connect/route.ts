import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.STRIPE_CONNECT_CLIENT_ID!,
    scope:         'read_write',
    state:         tenantId,
    redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/callback`,
  });

  return NextResponse.redirect(
    `https://connect.stripe.com/oauth/authorize?${params.toString()}`
  );
}