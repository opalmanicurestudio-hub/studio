// src/app/print/station/[tenantId]/[stationId]/page.tsx — A STATION'S QR SIGN. Printed from a document's "Shows up
// during work" links (DocLinksEditor) and stuck at the station. Scanning it opens the staff app on that station's
// documents (after the usual PIN). The sign itself shows only the business, the station and the titles linked to it.
import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { getAdminDb } from '@/lib/firebase-admin';
import { stationKeyOk } from '@/lib/training-proof';
import { docsForStation } from '@/lib/doc-links';
import { PrintButton } from '@/components/documents/PrintButton';

export const dynamic = 'force-dynamic';
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const font = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' } as const;

export default async function StationSign({ params, searchParams }: { params: Promise<{ tenantId: string; stationId: string }>; searchParams: Promise<{ k?: string }> }) {
  const { tenantId, stationId } = await params; const { k } = await searchParams;
  const gone = (why: string) => <div style={{ ...font, padding: 48 }}><p style={{ fontSize: 20 }}>{why}</p><p style={{ color: MUTED }}>Print a new one from the document’s links.</p></div>;
  if (!stationKeyOk(tenantId, stationId, String(k || ''))) return gone('This link isn’t valid.');
  const db = getAdminDb();
  const [tSnap, rSnap, dSnap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/resources/${stationId}`).get(), db.collection(`tenants/${tenantId}/documents`).where('status', '==', 'published').get()]);
  if (!rSnap.exists) return gone('That station isn’t there any more.');
  const tenant: any = tSnap.data() || {}; const station: any = rSnap.data() || {};
  const docs = docsForStation(dSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })), stationId).sort((a: any, b: any) => String(a.title).localeCompare(String(b.title)));
  const h = await headers(); const host = h.get('x-forwarded-host') || h.get('host') || ''; const proto = h.get('x-forwarded-proto') || 'https';
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || (host ? `${proto}://${host}` : '');
  const qr = await QRCode.toDataURL(`${origin}/staff-portal/${encodeURIComponent(tenantId)}?station=${encodeURIComponent(stationId)}`, { width: 700, margin: 0 });
  const business = String(tenant.name || tenant.businessName || 'The business');
  return (
    <div style={{ ...font, background: '#f7f7f8', minHeight: '100vh' }}>
      <style>{`@page { size: letter; margin: 0.5in; } @media print { .no-print { display: none !important; } body, .sheet-bg { background: #fff !important; } .sheet { box-shadow: none !important; border: none !important; } }`}</style>
      <div className="sheet-bg" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14 }}><span style={{ fontSize: 14, color: MUTED }}>Station sign · print and stick it where people work</span><PrintButton label="Print the sign" /></div>
        <div className="sheet" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '44px 48px', textAlign: 'center', boxShadow: '0 14px 34px -24px rgba(22,23,26,.35)' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{business}</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 28 }}>station</div>
          <h1 style={{ margin: '2px 0 0', fontSize: 52, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.05 }}>{station.name || 'Station'}</h1>
          <img src={qr} alt="QR code" style={{ width: 300, height: 300, margin: '30px auto 18px', display: 'block' }} />
          <div style={{ fontSize: 18 }}>Scan for how we do things at this station</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>Opens the staff app — sign in with your PIN.</div>
          {docs.length > 0 && <div style={{ marginTop: 30, borderTop: `1px solid ${LINE}`, paddingTop: 18, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
            {docs.map((d: any) => <span key={d.id} style={{ fontSize: 14, padding: '7px 14px', borderRadius: 999, background: '#f3f3f5' }}>{d.title || 'Document'}</span>)}</div>}
        </div>
      </div>
    </div>);
}
