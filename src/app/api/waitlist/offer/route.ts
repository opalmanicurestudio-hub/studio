// src/app/api/waitlist/offer/route.ts — the link in a waitlist text (/w/{tenant}/{token}). Public: the token is the
// proof. view → what's on offer and whether it's still theirs; take → first tap wins, booked through the booking engine
// (or their own visit moved up); pass → "not this one", they stay on the list. lib/waitlist-server.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { viewOffer, takeOffer, passOffer } from '@/lib/waitlist-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 120); const token = String(b.token || '').slice(0, 200); const action = String(b.action || 'view');
  if (!tenantId || !token) return NextResponse.json({ ok: false, error: 'This link isn’t complete.' }, { status: 400 });
  const db = getAdminDb();
  try {
    if (action === 'take') return NextResponse.json(await takeOffer(db, tenantId, token));
    if (action === 'pass') return NextResponse.json(await passOffer(db, tenantId, token));
    return NextResponse.json(await viewOffer(db, tenantId, token));
  } catch (e) { console.error('[waitlist/offer]', e); return NextResponse.json({ ok: false, error: 'Something went wrong — try again.' }, { status: 500 }); }
}
