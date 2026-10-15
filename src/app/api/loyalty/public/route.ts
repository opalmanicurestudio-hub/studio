// src/app/api/loyalty/public/route.ts — a client's points on the public booking page. Only with the private key from
// their own rewards link (lib/loyalty-link): typing a phone number never shows anyone's points.
//   POST { tenantId, clientId, k } → { on, first, balance, unit, ready, next }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { rewardsKey } from '@/lib/loyalty-link';
import { loyaltyOf, rewardsFor, unitOf } from '@/lib/loyalty';
import { balanceFor } from '@/lib/loyalty-server';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const clientId = String(b.clientId || '').slice(0, 80);
  if (!tenantId || !clientId || String(b.k || '') !== rewardsKey(tenantId, clientId)) return NextResponse.json({ ok: false }, { status: 403 });
  const db = getAdminDb(); const S = loyaltyOf((await db.doc(`tenants/${tenantId}`).get()).data() || {}); if (!S.on) return NextResponse.json({ ok: true, on: false });
  const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data(); if (!c) return NextResponse.json({ ok: false }, { status: 404 });
  const balance = Math.max(0, await balanceFor(db, tenantId, clientId)); const r = rewardsFor(S, balance);
  return NextResponse.json({ ok: true, on: true, first: String(c.firstName || c.name || '').trim().split(/\s+/)[0] || null, balance, unit: unitOf(S), ready: r.ready.map((x) => x.name), next: r.next ? { name: r.next.reward.name, toGo: r.next.toGo } : null }, { headers: { 'Cache-Control': 'no-store' } });
}
