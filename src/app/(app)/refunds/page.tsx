'use client';
// src/app/(app)/refunds/page.tsx — REFUNDS TO GIVE: the front desk's list for refunds on cash sales. The desk itself is
// components/refunds/RefundsDesk (the staff app shows the same one on phones).
import * as React from 'react';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { RefundsDesk } from '@/components/refunds/RefundsDesk';

const BG = { backgroundColor: '#f7f7f8', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%), radial-gradient(100% 70% at 100% 0%, #e8eaf0 0%, transparent 50%)' };

export default function RefundsPage() {
  const { firestore } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const allowed = ['owner', 'admin', 'manager', 'front_desk'].includes(String(role || '').toLowerCase());
  if (!allowed) return <div className="p-6"><AppHeader title="Refunds to give" /><p className="mt-6" style={{ color: '#6d7075' }}>Refunds are handled by the front desk and managers.</p></div>;
  return (
    <div className="flex min-h-screen flex-col" style={{ ...BG, color: '#16171a', letterSpacing: '-0.01em' }}>
      <AppHeader title="Refunds to give" />
      <RefundsDesk firestore={firestore} tenantId={tenantId} tenant={selectedTenant} />
    </div>);
}
