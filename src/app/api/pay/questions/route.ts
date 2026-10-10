// src/app/api/pay/questions/route.ts — "Something's off" on a pay stub (lib/pay-questions).
//   { tenantId, action: 'ask', periodFrom, periodTo, line, reason, note?, visitHint? }
//   { tenantId, action: 'reply' | 'seen' | 'adjust' | 'fixed' | 'explain', id, note?, amount? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { askPayQuestion, actOnPayQuestion } from '@/lib/pay-questions';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const r = b.action === 'ask' ? await askPayQuestion(db, tenantId, who.actor, b) : await actOnPayQuestion(db, tenantId, who.actor, b);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
