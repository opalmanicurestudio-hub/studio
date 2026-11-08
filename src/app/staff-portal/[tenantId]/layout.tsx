// src/app/staff-portal/[tenantId]/layout.tsx — THE STAFF PORTAL AS ITS OWN HOME SCREEN APP. Its own manifest (opens
// straight into this business's portal, white background) and a white status bar, so "Add to Home Screen" from the
// portal gives a team app that opens on the portal's opening screen — not the owner app. A paused or closed business
// (lib/tenant-access) has its team app closed too, the same as the owner's app.
import type { Metadata, Viewport } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';
import { accessLockOf } from '@/lib/tenant-access';

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string }> | { tenantId: string } }): Promise<Metadata> {
  const { tenantId } = await (params as any);
  return {
    manifest: `/staff-portal/${tenantId}/app.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Team' },
  };
}
export const viewport: Viewport = { themeColor: '#ffffff' };
// Read on every request: a business locked (or unlocked) is seen right away, never a copy from an earlier visit.
export const dynamic = 'force-dynamic';

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  const { tenantId } = await (params as any);
  let t: any = null;
  try { t = (await getAdminDb().doc(`tenants/${String(tenantId)}`).get()).data() || null; } catch { t = null; }
  if (!accessLockOf(t).locked) return children;
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7', padding: 20, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#16171a' }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#ffffff', border: '1px solid #ececee', borderRadius: 24, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{String(t?.name || 'The team app')}</h1>
        <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, color: '#4a4c52' }}>The team app is closed for now. The business owner can tell you more.</p>
      </div>
    </main>
  );
}
