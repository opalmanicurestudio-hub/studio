'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { PortalBoot } from '@/components/staff-portal/PortalBoot';

/** The opening screen while the portal itself downloads — the business's mark, not a blank "Loading…". */
function Boot() { const p = useParams() as any; return <PortalBoot tenantId={String(p?.tenantId || '')} />; }

const StaffPortalPage = dynamic(
  () => import('./StaffPortalPage'),
  {
    ssr: false,
    loading: () => <Boot />,
  }
);

export default function StaffPortalRoute({
  params,
}: {
  params: { tenantId: string };
}) {
  return <StaffPortalPage params={params} />;
}
