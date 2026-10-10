// src/app/api/cases/pdf/route.ts — a case's records as PDFs (lib/case-pdf). ?tenantId&id&kind=record|incident
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { casePdf } from '@/lib/case-pdf';
import { brandAccent } from '@/lib/brand-accent';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = String(q.get('tenantId') || '').slice(0, 80); const id = String(q.get('id') || ''); const kind = q.get('kind') === 'incident' ? 'incident' : 'record';
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (!who.actor.isManager && !['front_desk'].includes(who.actor.role)) return NextResponse.json({ ok: false, error: 'Only the desk and managers can download case records.' }, { status: 403 });
  const s = await db.doc(`tenants/${tenantId}/cases/${id}`).get(); if (!s.exists) return NextResponse.json({ ok: false, error: 'Case not found.' }, { status: 404 });
  const c: any = s.data(); if (kind === 'incident' && !c.safety) return NextResponse.json({ ok: false, error: 'Only safety cases have an incident report.' }, { status: 400 });
  const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const bytes = await casePdf(c, { name: t.name || 'Your business', accent: brandAccent(t), address: t.address || t.businessAddress || '', timezone: t.timezone }, kind);
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${kind === 'incident' ? 'incident' : 'case'}-${c.number}.pdf"`, 'Cache-Control': 'no-store' } });
}
