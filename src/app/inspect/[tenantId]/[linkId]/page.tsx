// src/app/inspect/[tenantId]/[linkId]/page.tsx — INSPECTOR VIEW (approved design, canvas row 23). A read-only page the
// owner shares with an inspector: the business's current procedures (in the collections chosen when the link was made),
// how many of the team are trained on each, and — only when the owner added it — this month's sterilization log. Tap a procedure to read it. The link
// expires when the owner said, can be turned off early, and each visit is noted (lib/training-proof).
import { getAdminDb } from '@/lib/firebase-admin';
import { inspectorKeyOk, inspectorData } from '@/lib/training-proof';
import { InspectorView } from '@/components/documents/ProofViews';

export const dynamic = 'force-dynamic';
const INK = '#16171a', MUTED = '#6d7075';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;
const Gone = ({ why }: { why: string }) => <div style={{ ...font, padding: 48 }}><p style={{ fontSize: 20 }}>{why}</p><p style={{ color: MUTED }}>Ask the business for a new link.</p></div>;

export default async function InspectPage({ params, searchParams }: { params: Promise<{ tenantId: string; linkId: string }>; searchParams: Promise<{ k?: string; doc?: string }> }) {
  const { tenantId, linkId } = await params; const sp = await searchParams; const k = String(sp.k || '');
  if (!inspectorKeyOk(tenantId, linkId, k)) return <Gone why="This link isn’t valid." />;
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/inspectorLinks/${linkId}`); const snap = await ref.get(); const link: any = snap.exists ? snap.data() : null;
  if (!link || link.revokedAt) return <Gone why="This link has been turned off." />;
  if (Date.parse(link.expiresAt) < Date.now()) return <Gone why="This link has expired." />;
  try { const { FieldValue } = await import('firebase-admin/firestore'); await ref.update({ views: FieldValue.arrayUnion({ at: new Date().toISOString(), doc: sp.doc ? String(sp.doc).slice(0, 60) : null }) }); } catch { /* noting a view never blocks it */ }
  const data = await inspectorData(db, tenantId, link);
  const base = `/inspect/${encodeURIComponent(tenantId)}/${encodeURIComponent(linkId)}?k=${encodeURIComponent(k)}`;
  let open: { d: any; row: any } | null = null;
  if (sp.doc) {
    const dSnap = await db.doc(`tenants/${tenantId}/documents/${String(sp.doc)}`).get(); const d: any = dSnap.exists ? dSnap.data() : null; const row = data.rows.find((r: any) => r.id === sp.doc);
    if (!d || !row) return <Gone why="That document isn’t part of this link." />;
    open = { d, row };
  }
  return <InspectorView data={data} link={link} base={base} open={open} />;
}
