// src/app/api/retail/return-close/route.ts — CLOSE A RETURN THAT ISN'T COMING BACK. Team only.
// POST { tenantId, returnId, note? }. Only while nothing on it has been checked in (lib/return-close). Its items can be
// returned again, and the customer is told on their order page, with the note when there is one.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { closeReturn } from '@/lib/return-close';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const returnId = String(b.returnId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,160}$/.test(returnId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  const r = await closeReturn(getAdminDb(), tenantId, returnId, { by: { id: String(auth.actor.uid || ''), name: String(auth.actor.name || 'The shop') }, why: 'team', note: String(b.note || '') });
  return NextResponse.json(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message }, { status: r.ok ? 200 : 409 });
}
