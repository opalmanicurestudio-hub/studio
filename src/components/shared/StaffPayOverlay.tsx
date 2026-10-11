'use client';
// src/components/shared/StaffPayOverlay.tsx — for managers only: listen to tenants/{t}/staffPay so pay screens get rates
// back on staff records (firebase/firestore/pay-overlay). Renders nothing.
import * as React from 'react';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { setPayOverlay } from '@/firebase/firestore/pay-overlay';

export function StaffPayOverlay() {
  const { firestore } = useFirebase() as any; const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const manager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  React.useEffect(() => {
    if (!firestore || !tenantId || !manager) { setPayOverlay(null, {}); return; }
    const un = onSnapshot(collection(firestore as Firestore, `tenants/${tenantId}/staffPay`), (s) => { const by: Record<string, any> = {}; s.docs.forEach((d) => { by[d.id] = d.data(); }); setPayOverlay(tenantId, by); }, () => setPayOverlay(null, {}));
    return () => { un(); setPayOverlay(null, {}); };
  }, [firestore, tenantId, manager]);
  return null;
}
