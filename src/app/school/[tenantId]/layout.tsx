// src/app/school/[tenantId]/layout.tsx — the school website's frame.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite } from './data';
import { Header, Footer, SITE_CSS } from '@/components/school/Site';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string }> }): Promise<Metadata> {
  const site = await getSite((await params).tenantId);
  if (!site) return { title: 'School not found', robots: { index: false } };
  const description = (site.settings.message || `${site.name} — programs, costs, admissions and tours.`).slice(0, 160);
  return { title: { default: site.name, template: `%s · ${site.name}` }, description, robots: site.settings.published ? undefined : { index: false, follow: false },
    openGraph: { title: site.name, description, images: site.logoUrl ? [site.logoUrl] : undefined } };
}

export default async function SchoolLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenantId: string }> }) {
  const site = await getSite((await params).tenantId);
  if (!site) notFound();
  return (
    <div className="sch min-h-dvh" style={{ ['--accent' as any]: site.color }}>
      <style>{SITE_CSS}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
      <Header site={site} />
      <main id="main">{children}</main>
      <Footer site={site} />
    </div>
  );
}
