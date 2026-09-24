// src/app/api/offers/check/route.ts
//
// PUBLIC: is this offer code good right now? Used by the booking page to
// show "Your offer: 15% off…" and by the "Have an offer code?" box.
// Answers yes/no with the offer line — nothing else about the discount.
// The booking itself re-checks everything server-side.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { offerProblem, offerLine } from '@/lib/offers';

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
    const snap = await getAdminDb().collection(`tenants/${tenantId}/discounts`).where('code', '==', code).limit(1).get();
    const d: any = snap.docs[0]?.data() || null;
    const problem = offerProblem(d);
    if (problem) return NextResponse.json({ ok: false, error: problem });
    return NextResponse.json({ ok: true, code, line: offerLine(d) });
  } catch {
    return NextResponse.json({ ok: false, error: 'Couldn’t check that code right now.' }, { status: 500 });
  }
}
