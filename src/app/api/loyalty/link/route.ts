// src/app/api/loyalty/link/route.ts — a client's rewards at a glance, and the private link to their rewards page.
// POST { tenantId, clientId, k } — k is proof the client holds their own link (a visit's check-in token, or their portal
// key); the team can ask too. → { on, balance, unit, ready, url }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { checkPortalKey, portalKeysReady } from '@/lib/portal-key';
import { loyaltyOf, rewardsFor, unitOf } from '@/lib/loyalty';
import { balanceFor } from '@/lib/loyalty-server';
import { rewardsPath } from '@/lib/loyalty-link';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const clientId = String(b.clientId || '').slice(0, 80);
  if (!tenantId || !clientId) return NextResponse.json({ ok: false }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const k = typeof b.k === 'string' ? b.k.trim().slice(0, 200) : '';
  let allowed = false;
  if (req.headers.get('authorization')) { const s = await verifyStaffActor(req, tenantId).catch(() => null); if (s?.ok) allowed = true; }
  if (!allowed && k) { const v = await db.collection(`${T}/appointments`).where('checkInToken', '==', k).limit(1).get().catch(() => null); const a: any = v && !v.empty ? v.docs[0].data() : null; if (a && String(a.clientId || '') === clientId) allowed = true; }
  if (!allowed && k && portalKeysReady() && checkPortalKey(tenantId, clientId, k)) allowed = true;
  if (!allowed) return NextResponse.json({ ok: false }, { status: 403 });
  const S = loyaltyOf((await db.doc(T).get()).data() || {}); if (!S.on) return NextResponse.json({ ok: true, on: false });
  const balance = Math.max(0, await balanceFor(db, tenantId, clientId)); const r = rewardsFor(S, balance);
  return NextResponse.json({ ok: true, on: true, balance, unit: unitOf(S), ready: r.ready.map((x) => x.name), next: r.next ? { name: r.next.reward.name, toGo: r.next.toGo } : null, url: rewardsPath(tenantId, clientId) }, { headers: { 'Cache-Control': 'no-store' } });
}
