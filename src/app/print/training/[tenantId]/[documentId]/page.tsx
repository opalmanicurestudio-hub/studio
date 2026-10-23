// src/app/print/training/[tenantId]/[documentId]/page.tsx — PROOF OF TRAINING for one document (approved design, canvas
// row 22 "Proof of training — PDF"). Letter size: the business, the document and its version, who it's for, every
// sign-off (when, which version, quick-check score, signature), the version history and this month's checklist runs.
// Opened by a signed link that lasts a day (lib/training-proof), made from Documents → Training record.
import { getAdminDb } from '@/lib/firebase-admin';
import { proofOk, proofData } from '@/lib/training-proof';
import { ProofView } from '@/components/documents/ProofViews';
import { PRINT, PRINT_FONT_STACK } from '@/lib/print-style';

export const dynamic = 'force-dynamic';
const INK = PRINT.ink, MUTED = PRINT.muted, LINE = PRINT.line, AMBER = PRINT.amber, RED = PRINT.red;
const when = (iso?: string, tz?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '');

export default async function ProofPage({ params, searchParams }: { params: Promise<{ tenantId: string; documentId: string }>; searchParams: Promise<{ e?: string; k?: string }> }) {
  const { tenantId, documentId } = await params; const sp = await searchParams;
  const ok = proofOk(tenantId, documentId, String(sp.e || ''), String(sp.k || ''));
  const data = ok ? await proofData(getAdminDb(), tenantId, documentId) : null;
  if (!data) return <div style={{ fontFamily: PRINT_FONT_STACK, padding: 48, color: INK }}><p style={{ fontSize: 20, fontWeight: 300, letterSpacing: '-0.01em', margin: '0 0 6px' }}>This link has expired or isn’t valid.</p><p style={{ color: MUTED, margin: 0 }}>Make a new one from Documents → Training record.</p></div>;
  return <ProofView data={data} />;
}
