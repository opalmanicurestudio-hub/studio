'use client';
// src/app/(app)/opportunities/page.tsx — OPPORTUNITIES for managers (the board: components/opportunities/
// OpportunitiesBoard). The team works their own tasks in the staff app, on Today.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { OpportunitiesBoard } from '@/components/opportunities/OpportunitiesBoard';
import { INK, MUTED } from '@/components/opportunities/OppTask';

export default function OpportunitiesPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  if (!manager) return <div className="p-8"><AppHeader title="Opportunities" /><p className="mt-6" style={{ color: MUTED }}>Your tasks are in the staff app, on Today.</p></div>;
  return <div className="min-h-full p-4 md:p-8" style={{ color: INK }}><AppHeader title="Opportunities" /><OpportunitiesBoard tenantId={tenantId} /></div>;
}

