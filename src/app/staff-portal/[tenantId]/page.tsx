'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { PortalBoot } from '@/components/staff-portal/PortalBoot';
import { isStaleCopy, reloadOnce } from '@/lib/client-crash';

/** The opening screen while the portal itself downloads — the business's mark, not a blank "Loading…". */
function Boot() { const p = useParams() as any; return <PortalBoot tenantId={String(p?.tenantId || '')} />; }

const StaffPortalPage = dynamic(
  // A phone holding an old copy after an update can't find the portal's files — reload once instead of crashing.
  () => import('./StaffPortalPage').catch((e) => { if (typeof window !== 'undefined' && isStaleCopy(e) && reloadOnce()) return new Promise<never>(() => {}); throw e; }),
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
