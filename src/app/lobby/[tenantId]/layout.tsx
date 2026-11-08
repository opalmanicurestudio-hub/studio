// src/app/lobby/[tenantId]/layout.tsx — a paused or closed business (lib/tenant-access) has this screen closed too, the
// same as the owner's app and the team app (components/auth/BusinessClosedGate).
import type { ReactNode } from 'react';
import { BusinessClosedGate } from '@/components/auth/BusinessClosedGate';

export const dynamic = 'force-dynamic';

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  const { tenantId } = await (params as any);
  return <BusinessClosedGate tenantId={String(tenantId)} fallbackTitle="Welcome" line="This screen isn’t showing anything right now.">{children}</BusinessClosedGate>;
}
