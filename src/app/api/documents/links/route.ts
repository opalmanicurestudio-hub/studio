// src/app/api/documents/links/route.ts — LINKS FOR PROOF OF TRAINING (lib/training-proof). For people allowed to manage
// documents.
//   proof            { documentId }                      → a day-long link to that document's proof-of-training page
//   inspector-create { hours, collections[], note? }     → a read-only inspector link that expires
//   inspector-list                                       → links made (newest first) with their views
//   inspector-revoke { id }                              → turns a link off now
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { proofPath, createInspectorLink, inspectorPath } from '@/lib/training-proof';
export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const g = await requireCan(req, tenantId, 'documents.manage'); if (g.deny) return g.deny;
  const db = getAdminDb(); const who = String(g.actor?.name || 'A manager'); const action = String(b.action || '');
  if (action === 'proof') {
    const id = String(b.documentId || '').slice(0, 120); const d = await db.doc(`tenants/${tenantId}/documents/${id}`).get();
    if (!d.exists || (d.data() as any)?.status !== 'published') return j({ ok: false, error: 'Publish the document first.' }, 400);
    return j({ ok: true, path: proofPath(tenantId, id) });
  }
  if (action === 'inspector-create') {
    const hours = Number(b.hours) || 8; const cols = Array.isArray(b.collections) ? b.collections.map((x: any) => String(x).slice(0, 60)) : [];
    const link = await createInspectorLink(db, tenantId, { hours, collections: cols, by: who, note: b.note });
    return j({ ok: true, link });
  }
  if (action === 'inspector-list') {
    const snap = await db.collection(`tenants/${tenantId}/inspectorLinks`).orderBy('createdAt', 'desc').limit(20).get();
    return j({ ok: true, links: snap.docs.map((d: any) => { const x = d.data() || {}; return { ...x, path: inspectorPath(tenantId, d.id), views: (x.views || []).slice(-10) }; }) });
  }
  if (action === 'inspector-revoke') {
    const id = String(b.id || '').slice(0, 60); await db.doc(`tenants/${tenantId}/inspectorLinks/${id}`).set({ revokedAt: new Date().toISOString(), revokedBy: who }, { merge: true });
    return j({ ok: true });
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
