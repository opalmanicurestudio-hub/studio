import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { PAST_DATE, TODAY_GONE, sendDelayNotice } from '@/lib/delay-notice';

// ─── /api/retail/delay-notice ────────────────────────────────────────────────
// The shop's half of the FTC Mail, Internet, or Telephone Order Rule: when an order can't ship by the promised date,
// the customer gets a notice with a revised date and a plain way to cancel for a full refund (lib/delay-notice, which
// the hourly check of late orders uses too).
//   · The revised date replaces the promise on the order, on the shop's clock, so the customer's late-order cancel
//     right re-arms against it, and the team's due time moves with it.
//   · One notice per revised date (notifiedForPromiseAt): a double tap sends nothing, a new date sends one.
//   · Every notice is on the order's timeline with both dates, for any dispute later.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const revisedDate = String(body.revisedDate || '').trim();   // YYYY-MM-DD
    const note = String(body.note || '').trim().slice(0, 400);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !/^\d{4}-\d{2}-\d{2}$/.test(revisedDate)) {
      return NextResponse.json({ error: 'Choose a new ship-by date as YYYY-MM-DD.' }, { status: 400 });
    }
    const auth = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = getAdminDb();
    const r = await sendDelayNotice(db, {
      tenantId, orderId, revisedDate, note, origin: req.nextUrl.origin,
      actor: { id: auth.actor.uid, name: auth.actor.name },
    });
    if (!r.sent && (r.why === PAST_DATE || r.why === TODAY_GONE || r.why === 'Choose a new ship-by date.')) return NextResponse.json({ error: r.why }, { status: 400 });
    return NextResponse.json({ ok: true, sent: r.sent, ...(r.why ? { why: r.why } : {}) });
  } catch (err: any) {
    console.error('[delay-notice] failed:', err?.message);
    return NextResponse.json({ error: 'Couldn’t send the notice.' }, { status: 500 });
  }
}
