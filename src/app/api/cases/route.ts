// src/app/api/cases/route.ts — Making it right cases (lib/cases). { tenantId, action: 'open', ... } or { tenantId, id, action, ... }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { openCase, actOnCase } from '@/lib/cases';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const r = b.action === 'open' ? await openCase(db, tenantId, who.actor, b) : await actOnCase(db, tenantId, who.actor, b);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
