'use client';
// src/app/(app)/referrals/campaigns/[id]/page.tsx — one creator campaign, for managers (components/referrals/CampaignEditor).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { CampaignEditor } from '@/components/referrals/CampaignEditor';

export default function CampaignPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || ''; const p = useParams() as any; const id = String(p?.id || 'new');
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  if (!manager) return <div className="p-8"><AppHeader title="Referrals" /><p className="mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>Only managers can see campaigns.</p></div>;
  return <div className="min-h-full p-4 md:p-8"><AppHeader title="Referrals" /><CampaignEditor key={id} tenantId={tenantId} id={id} /></div>;
}
