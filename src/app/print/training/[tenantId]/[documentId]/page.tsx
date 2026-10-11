// src/app/print/training/[tenantId]/[documentId]/page.tsx — PROOF OF TRAINING for one document (approved design, canvas
// row 22 "Proof of training — PDF"). Letter size: the business, the document and its version, who it's for, every
// sign-off (when, which version, quick-check score, signature), the version history and this month's checklist runs.
// Opened by a signed link that lasts a day (lib/training-proof), made from Documents → Training record.
import { getAdminDb } from '@/lib/firebase-admin';
import { proofOk, proofData } from '@/lib/training-proof';
import { ProofView } from '@/components/documents/ProofViews';

export const dynamic = 'force-dynamic';
const INK = '#16171a', MUTED = '#6d7075', LINE = '#e3e3e6', AMBER = '#b45309', RED = '#b42318';
const when = (iso?: string, tz?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '');

export default async function ProofPage({ params, searchParams }: { params: Promise<{ tenantId: string; documentId: string }>; searchParams: Promise<{ e?: string; k?: string }> }) {
  const { tenantId, documentId } = await params; const sp = await searchParams;
  const ok = proofOk(tenantId, documentId, String(sp.e || ''), String(sp.k || ''));
  const data = ok ? await proofData(getAdminDb(), tenantId, documentId) : null;
  if (!data) return <div style={{ fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif', padding: 48, color: INK }}><p style={{ fontSize: 18 }}>This link has expired or isn’t valid.</p><p style={{ color: MUTED }}>Make a new one from Documents → Training record.</p></div>;
  return <ProofView data={data} />;
}
