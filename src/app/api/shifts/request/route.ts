// src/app/api/shifts/request/route.ts — shift requests from the staff portal (and the app): submit, a colleague's
// consent to a swap, and a manager's decision. See lib/shift-requests.
//   { tenantId, action: 'submit', type, date, reason, myShiftId?, swapShiftId?, shiftId? }
//   { tenantId, action: 'consent', requestId, agree }
//   { tenantId, action: 'decide', requestId, approve, note? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { submitRequest, consentToSwap, decideRequest } from '@/lib/shift-requests';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (who.actor.role === 'renter') return NextResponse.json({ ok: false, error: 'Renters don’t have studio shifts.' }, { status: 403 });
  const r = b.action === 'submit' ? await submitRequest(db, tenantId, who.actor, b)
    : b.action === 'consent' ? await consentToSwap(db, tenantId, who.actor, String(b.requestId || ''), b.agree === true)
    : b.action === 'decide' ? await decideRequest(db, tenantId, who.actor, String(b.requestId || ''), b.approve === true, String(b.note || ''))
    : { ok: false as const, error: 'Unknown action.' };
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
