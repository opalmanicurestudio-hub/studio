'use client';
// src/components/shared/PortalScope.tsx — WHERE A TEAM APP SIGN-IN CAN GO in the app (design canvas "The floor's
// phones"). Someone signed in with their PIN in the team app, or a host stand tablet, uses the floor's pages here: My
// tables, Clear tables, the host stand, the bar's tabs, the counter, curbside and Drive-thru live. Anywhere else sends them back to the team app (a tablet, to the host stand),
// so a shared phone never shows the business's other pages.
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';

export const FLOOR_PAGES = ['/tables', '/clear', '/host', '/bar-tabs', '/counter', '/curbside', '/drive-live'];
export const onFloorPage = (path: string) => FLOOR_PAGES.some((p) => path === p || path.startsWith(`${p}/`));

export function PortalScope({ children }: { children: React.ReactNode }) {
  const { viaPortal, screen, selectedTenant } = useTenant();
  const pathname = usePathname() || '';
  const router = useRouter();
  const away = viaPortal && !onFloorPage(pathname);
  React.useEffect(() => {
    if (!away || !selectedTenant?.id) return;
    router.replace(screen ? '/host' : `/staff-portal/${selectedTenant.id}`);
  }, [away, screen, selectedTenant?.id, router]);
  if (away) return <p role="status" className="p-6 text-[15px]" style={{ color: '#6d7075' }}>Opening the floor…</p>;
  return <>{children}</>;
}
