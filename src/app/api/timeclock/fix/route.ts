// src/app/api/timeclock/fix/route.ts — forgotten clock-outs (lib/clock-fix): the person submits when they left; a
// manager approves, changes or declines.
//   { tenantId, action: 'submit', inId, outAt, note? }
//   { tenantId, action: 'decide', id, approve, outAt?, note? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { submitFix, decideFix } from '@/lib/clock-fix';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const r = b.action === 'submit' ? await submitFix(db, tenantId, who.actor, b)
    : b.action === 'decide' ? await decideFix(db, tenantId, who.actor, String(b.id || ''), b.approve === true, b)
    : { ok: false as const, error: 'Unknown action.' };
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
