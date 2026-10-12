// src/app/check-in/[token]/layout.tsx — the visit link's own Home Screen manifest, so "Add to Home Screen" opens the
// client's own visit page (where they can message us and turn on notifications).
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> | { token: string } }): Promise<Metadata> {
  const { token } = await (params as any);
  const id = String(token || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
  return {
    manifest: `/check-in/${id}/app.webmanifest`,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Appointment' },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
