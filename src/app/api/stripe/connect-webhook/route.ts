// /api/stripe/connect-webhook — Stripe's notices for the businesses' connected accounts. The handler itself lives in
// lib/connect-webhook, so this address and the older /api/stripe/webhook run exactly the same code.
import { NextRequest } from 'next/server';
import { handleConnectWebhook } from '@/lib/connect-webhook';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handleConnectWebhook(req);
}
