'use client';
// src/app/(app)/referrals/page.tsx — REFERRALS for managers (components/referrals/ReferralsBoard; lib/referrals-server).
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { ReferralsBoard } from '@/components/referrals/ReferralsBoard';

export default function ReferralsPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  if (!manager) return <div className="p-8"><AppHeader title="Referrals" /><p className="mt-6" style={{ color: '#6d7075' }}>Only managers can see referrals.</p></div>;
  return <div className="min-h-full p-4 md:p-8"><AppHeader title="Referrals" /><ReferralsBoard tenantId={tenantId} /></div>;
}
