'use client';
// src/app/(app)/cases/report/page.tsx — THE MONTHLY MAKING IT RIGHT REPORT, for managers. Loads the cases and the pay
// corrections they caused; the report itself is components/cases/MirReportView.
import * as React from 'react';
import { collection, query, where, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { MirReportView } from '@/components/cases/MirReportView';

export default function MirReportPage() {
  const { firestore } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase()); const tz = selectedTenant?.timezone || 'America/New_York';
  const cQ = useMemoFirebase(() => (firestore && tenantId && isManager ? collection(firestore as Firestore, `tenants/${tenantId}/cases`) : null), [firestore, tenantId, isManager]);
  const { data: cases, isLoading } = useCollection<any>(cQ);
  const aQ = useMemoFirebase(() => (firestore && tenantId && isManager ? query(collection(firestore as Firestore, `tenants/${tenantId}/payAdjustments`), where('by', '==', 'making_it_right')) : null), [firestore, tenantId, isManager]);
  const { data: adj } = useCollection<any>(aQ);
  if (!isManager) return <div className="p-6"><AppHeader title="Making it right report" /><p className="mt-6" style={{ color: '#6d7075' }}>The report is for managers.</p></div>;
  return <>
    <div className="no-print"><AppHeader title="Making it right report" /></div>
    <MirReportView cases={cases} adj={adj} isLoading={isLoading} tz={tz} tenantName={selectedTenant?.name || ''} />
  </>;
}
