// src/app/api/disputes/pack/route.ts — the card dispute pack PDF for a visit (lib/dispute-pack). Managers only.
// GET ?tenantId&appointmentId  or  ?tenantId&caseId
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { disputePack } from '@/lib/dispute-pack';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = String(q.get('tenantId') || '').slice(0, 80);
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (!who.actor.isManager && !who.actor.isOwner) return NextResponse.json({ ok: false, error: 'Only managers can download a dispute pack.' }, { status: 403 });
  const r = await disputePack(db, tenantId, { appointmentId: q.get('appointmentId') || undefined, caseId: q.get('caseId') || undefined });
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  return new NextResponse(Buffer.from(r.bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${r.name}"`, 'Cache-Control': 'no-store' } });
}
