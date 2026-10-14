'use client';
// src/app/(app)/referrals/settings/page.tsx — REFERRALS → SETTINGS for managers (components/referrals/ReferralsSettings).
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { ReferralsSettings } from '@/components/referrals/ReferralsSettings';

export default function ReferralsSettingsPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  if (!manager) return <div className="p-8"><AppHeader title="Referrals" /><p className="mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>Only managers can change referral settings.</p></div>;
  return <div className="min-h-full p-4 md:p-8"><AppHeader title="Referrals" /><ReferralsSettings tenantId={tenantId} /></div>;
}
