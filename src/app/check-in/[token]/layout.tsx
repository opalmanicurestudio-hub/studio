// src/app/check-in/[token]/layout.tsx — the visit link's own Home Screen manifest, so "Add to Home Screen" opens the
// client's own visit page (where they can message us and turn on notifications), and the card the link shows when it's
// sent (lib/visit-preview): "Your visit · {business}" and nothing about the visit itself.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { visitPreviewOf, previewTitle, PREVIEW_DESCRIPTION } from '@/lib/visit-preview';
import { linkOrigin } from '@/lib/app-origin';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> | { token: string } }): Promise<Metadata> {
  const { token } = await (params as any);
  const id = String(token || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  const p = await visitPreviewOf(id);
  const title = previewTitle(p);
  // The card's picture is fetched from the business's own link address (the address its messages use).
  let base: URL | undefined;
  try {
    const h = await headers(); const host = h.get('x-forwarded-host') || h.get('host') || '';
    const origin = p?.origin || linkOrigin(null, host ? `${h.get('x-forwarded-proto') || 'https'}://${host}` : '');
    base = origin ? new URL(origin) : undefined;
  } catch { base = undefined; }
  return {
    ...(base ? { metadataBase: base } : {}),
    title,
    description: PREVIEW_DESCRIPTION,
    openGraph: { title, description: PREVIEW_DESCRIPTION, type: 'website', ...(p?.name ? { siteName: p.name } : {}) },
    twitter: { card: 'summary_large_image', title, description: PREVIEW_DESCRIPTION },
    robots: { index: false, follow: false },
    manifest: `/check-in/${id}/app.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Appointment' },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
