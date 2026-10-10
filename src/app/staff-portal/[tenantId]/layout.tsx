// src/app/staff-portal/[tenantId]/layout.tsx — THE STAFF PORTAL AS ITS OWN HOME SCREEN APP. Its own manifest (opens
// straight into this business's portal, white background) and a white status bar, so "Add to Home Screen" from the
// portal gives a team app that opens on the portal's opening screen — not the owner app.
import type { Metadata, Viewport } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string }> | { tenantId: string } }): Promise<Metadata> {
  const { tenantId } = await (params as any);
  return {
    manifest: `/staff-portal/${tenantId}/app.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Team' },
  };
}
export const viewport: Viewport = { themeColor: '#ffffff' };

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
