// src/app/drive-thru/[tenantId]/layout.tsx — a paused or closed business (lib/tenant-access) has its drive-thru screens
// closed too, the same as the kitchen screen (components/auth/BusinessClosedGate).
import type { ReactNode } from 'react';
import { BusinessClosedGate } from '@/components/auth/BusinessClosedGate';

export const dynamic = 'force-dynamic';

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  const { tenantId } = await (params as any);
  return <BusinessClosedGate tenantId={String(tenantId)} fallbackTitle="Drive-thru" line="The drive-thru screen is closed for now. The business owner can tell you more.">{children}</BusinessClosedGate>;
}
