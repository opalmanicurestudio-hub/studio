'use client';
// src/app/(app)/loyalty/page.tsx — LOYALTY for managers (components/loyalty/LoyaltySetup; lib/loyalty).
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { LoyaltySetup } from '@/components/loyalty/LoyaltySetup';

export default function LoyaltyPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  if (!manager) return <div className="p-8"><AppHeader title="Loyalty" /><p className="mt-6" style={{ color: 'hsl(var(--muted-foreground))' }}>Only managers can set up loyalty.</p></div>;
  return <div className="min-h-full bg-background"><AppHeader title="Loyalty" />{tenantId ? <LoyaltySetup tenantId={tenantId} /> : null}</div>;
}
