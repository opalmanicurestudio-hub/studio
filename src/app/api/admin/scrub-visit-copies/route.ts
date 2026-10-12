// src/app/api/admin/scrub-visit-copies/route.ts — one-time clean-up of the visit copies for one business.
//
// The visit link's copies (appointmentCheckIns/{token} and tenants/{t}/appointmentCheckIns/{token}) can be read with
// the visit token. Older writers stored the whole appointment there — signed form answers, staff notes, inspiration
// photos, contact details, prices. New writes go through publicVisitCopy; this removes what the old ones left behind.
//
// POST { tenantId } — managers only. Pages through the business's scoped copies (and each one's top-level twin by
// token), then the top-level copies stamped with this business, deleting every key outside the whitelist and cutting
// signed forms down to { formId, signedAt }. Returns counts.
import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { scrubVisitPatch } from '@/lib/public-visit-copy';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PAGE = 300;
const MANAGERS = ['owner', 'admin', 'manager'];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body?.tenantId || '').slice(0, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  if (!auth.actor.isTenantOwner && !MANAGERS.includes(String(auth.actor.role || ''))) return NextResponse.json({ ok: false, error: 'Only a manager can run this.' }, { status: 403 });

  const db = getAdminDb();
  const del = () => FieldValue.delete();
  const counts = { scopedChecked: 0, scopedCleaned: 0, rootChecked: 0, rootCleaned: 0 };
  const seenRoot = new Set<string>();

  const cleanRoot = async (token: string, data?: any) => {
    if (seenRoot.has(token)) return; seenRoot.add(token);
    const ref = db.doc(`appointmentCheckIns/${token}`);
    const d: any = data !== undefined ? data : (await ref.get()).data();
    if (!d) return;
    if (d.tenantId && d.tenantId !== tenantId) return;   // never touch another business's copy
    counts.rootChecked++;
    const patch = scrubVisitPatch(d, del);
    if (patch) { await ref.update(patch); counts.rootCleaned++; }
  };

  // 1. The business's own copies, and each one's top-level twin.
  let last: any = null;
  for (;;) {
    let q: any = db.collection(`tenants/${tenantId}/appointmentCheckIns`).orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      counts.scopedChecked++;
      const patch = scrubVisitPatch(doc.data(), del);
      if (patch) { await doc.ref.update(patch); counts.scopedCleaned++; }
      await cleanRoot(String(doc.id));
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  // 2. Top-level copies with no scoped twin (the payment and phone-booking writers only wrote these).
  last = null;
  for (;;) {
    let q: any = db.collection('appointmentCheckIns').where('tenantId', '==', tenantId).orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) await cleanRoot(String(doc.id), doc.data());
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  return NextResponse.json({ ok: true, ...counts });
}
