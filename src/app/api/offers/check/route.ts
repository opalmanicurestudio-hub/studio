// src/app/api/offers/check/route.ts
//
// PUBLIC: is this offer code good right now? Used by the booking page to
// show "Your offer: 15% off…" and by the "Have an offer code?" box.
// Answers yes/no with the offer line — nothing else about the discount.
// The booking itself re-checks everything server-side.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { offerProblem, offerLine, offerAmount } from '@/lib/offers';

export const dynamic = 'force-dynamic';

// A light brake on guessing codes: 20 checks per address per 10 minutes.
const hits = new Map<string, { n: number; at: number }>();

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  const h = hits.get(ip); const now = Date.now();
  if (h && now - h.at < 600000 && h.n >= 20) return NextResponse.json({ ok: false, error: 'Too many tries — wait a few minutes.' }, { status: 429 });
  hits.set(ip, h && now - h.at < 600000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });

  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
  if (!tenantId || code.length < 3) return NextResponse.json({ ok: false, error: 'Enter the code from your message.' }, { status: 400 });
  try {
    const db = getAdminDb();
    let d: any = null;
    const provider = String(body.provider || '').trim();
    if (provider) {
      // On a renter's page, codes are the RENTER's offers.
      const st = ((await db.doc(`tenants/${tenantId}/staff/${provider}`).get()).data() as any) || null;
      const renterId = st?.renterId ? String(st.renterId) : null;
      if (renterId) {
        const hit = await db.collection(`tenants/${tenantId}/renterOffers`).where('ownerRenterId', '==', renterId).get();
        d = hit.docs.map((x: any) => x.data() as any).find((o: any) => String(o.code || '').toUpperCase() === code) || null;
      }
    } else {
      const snap = await db.collection(`tenants/${tenantId}/discounts`).where('code', '==', code).limit(1).get();
      d = snap.docs[0]?.data() || null;
    }
    const problem = offerProblem(d);
    if (problem) return NextResponse.json({ ok: false, error: problem });
    const until = d.validUntil ? new Date(d.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    return NextResponse.json({ ok: true, code, line: offerLine(d), amount: offerAmount(d), until, oncePer: d.limitOnePerCustomer === true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Couldn’t check that code right now.' }, { status: 500 });
  }
}
