// src/app/api/usage/route.ts — ACTUAL USAGE & OPEN CONTAINERS (O8). Staff only.
//   get                { tenantId, visitId }            → what the visit used (expected / actual / any shortfall)
//   adjust             { tenantId, visitId, actual }    → the provider's actual amounts (the visit's provider or a manager)
//   container-finished { tenantId, productId }          → finished a bottle early → expected vs actual yield logged
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { adjustVisitUsage, containerFinished } from '@/lib/usage';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const me = auth.actor; const db = getAdminDb(); const T = `tenants/${tenantId}`; const visitId = String(b.visitId || '').slice(0, 80);
  try {
    if (b.action === 'get') { const u: any = (await db.doc(`${T}/usage/${visitId}`).get()).data() || null; return NextResponse.json({ ok: true, usage: u }); }
    if (b.action === 'adjust') {
      const a: any = (await db.doc(`${T}/appointments/${visitId}`).get()).data();
      if (!a) return NextResponse.json({ ok: false, error: 'Visit not found.' }, { status: 404 });
      if (!me.isManager && a.staffId && a.staffId !== me.uid) return NextResponse.json({ ok: false, error: 'Only the provider who did this visit (or a manager) can change what was used.' }, { status: 403 });
      const actual: Record<string, number> = {}; for (const [k, v] of Object.entries(b.actual || {})) if (Number.isFinite(Number(v)) && Number(v) >= 0) actual[String(k).slice(0, 80)] = Number(v);
      return NextResponse.json(await adjustVisitUsage(db, tenantId, visitId, actual, { id: me.uid, name: me.name }));
    }
    if (b.action === 'container-finished') return NextResponse.json(await containerFinished(db, tenantId, String(b.productId || '').slice(0, 80), { id: me.uid, name: me.name }));
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || 'That didn’t work.') }, { status: 409 }); }
}
