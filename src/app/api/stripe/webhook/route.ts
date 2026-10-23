// /api/stripe/webhook — the older address for Stripe's connected-account notices. It used to hold a stale copy of the
// handler that knew nothing about shop orders, gift cards or processing fees, so a business whose Stripe account was
// set to call this address had its online orders marked paid only by the five-minute check. It now runs the same
// handler as /api/stripe/connect-webhook (lib/connect-webhook), whichever address Stripe is set to.
import { NextRequest } from 'next/server';
import { handleConnectWebhook } from '@/lib/connect-webhook';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handleConnectWebhook(req);
}
