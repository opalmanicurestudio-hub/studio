// src/app/api/upload/appointment-photos/route.ts — photos on a visit (after photos, marked-up inspiration photos), from
// the planner and the staff app. FormData { tenantId, appointmentId, files[] } → { urls }. Team only; stored server-side
// under the visit, readable only through each photo's own link.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null); if (!form) return NextResponse.json({ ok: false, error: 'Nothing uploaded.' }, { status: 400 });
  const tenantId = String(form.get('tenantId') || '').slice(0, 80); const aid = String(form.get('appointmentId') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!tenantId || !aid) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const urls: string[] = []; let error = '';
  for (const f of form.getAll('files').slice(0, 8)) {
    if (typeof f === 'string') continue; const file = f as File;
    const dataUrl = `data:${file.type || 'image/jpeg'};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
    const r = await uploadClaimPhotoFromDataUrl(tenantId, aid, dataUrl, 'visit-photos'); if (r.url) urls.push(r.url); else error = r.error || 'A photo didn’t upload.';
  }
  return NextResponse.json({ ok: urls.length > 0, urls, error: error || undefined }, { status: urls.length ? 200 : 400 });
}
