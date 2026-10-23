/**
 * app/api/stripe/apply-store-credit/route.ts
 *
 * RETIRED. This used to take store credit off a client's account as soon as
 * staff asked, before the sale was paid, and marked the visit on a field that
 * nothing reads — so the credit left the client's account without coming off
 * their bill, and asking twice took it twice.
 *
 * Store credit is used in one place now: checkout (/api/checkout/complete,
 * through lib/store-credit useCredit), once the sale is recorded, in the same
 * step that reads the client's credit — so an abandoned or failed sale never
 * costs the client anything, and nothing is taken twice. Nothing in the app
 * calls this route any more; it answers every request with 410 and changes
 * nothing.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ ok: false, appliedAmount: 0, creditIdsUsed: [], error: 'Store credit is used at checkout now. Add it to the sale there.' }, { status: 410 });
}
