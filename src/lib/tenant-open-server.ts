// src/lib/tenant-open-server.ts — ROUTES THAT START A BOOKING OR TAKE MONEY FOR A BUSINESS ASK THIS FIRST. A locked
// business (lib/tenant-access: paused by HQ, subscription ended, grace period over) takes no new bookings, orders,
// deposits, gift cards or enrollments. Clients are told it isn't taking them right now, never why.
import { NextResponse } from 'next/server';
import { accessLockOf, CLOSED_FOR_CLIENTS } from '@/lib/tenant-access';

/** The reply to send when this business is locked, or null when it's open. */
export function closedReply(tenant: any): NextResponse | null {
  if (!accessLockOf(tenant).locked) return null;
  return NextResponse.json({ ok: false, error: CLOSED_FOR_CLIENTS, closed: true }, { status: 403 });
}

/** The same, reading the business first (for routes that haven't read it yet). An unreadable business is left to the
 *  route's own checks, so a hiccup here never blocks a booking by itself. */
export async function closedReplyFor(db: any, tenantId: string): Promise<NextResponse | null> {
  if (!tenantId) return null;
  const t = (await db.doc(`tenants/${tenantId}`).get().catch(() => null))?.data?.();
  return closedReply(t);
}
