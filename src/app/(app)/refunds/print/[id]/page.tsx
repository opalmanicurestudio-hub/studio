'use client';
// src/app/(app)/refunds/print/[id]/page.tsx — prints the envelope slip and note card for a cash refund pickup
// (components/refunds/RefundSheets). Opens the print dialog by itself; printing ticks "printed" on the desk's checklist.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { doc, type Firestore } from 'firebase/firestore';
import { useDoc, useFirebase, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { payPost } from '@/components/pay/pay-client';
import { RefundSheets } from '@/components/refunds/RefundSheets';

export default function PrintRefund() {
  const { id } = useParams() as { id: string }; const { firestore } = useFirebase() as any; const { selectedTenant } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const ref = useMemoFirebase(() => (firestore && tenantId ? doc(firestore as Firestore, `tenants/${tenantId}/refundPayouts/${id}`) : null), [firestore, tenantId, id]);
  const { data: p } = useDoc<any>(ref); const printed = React.useRef(false);
  React.useEffect(() => {
    if (!p || printed.current) return; printed.current = true;
    const after = () => { payPost('/api/refund-payouts', { tenantId, id, action: 'printed' }); window.removeEventListener('afterprint', after); };
    window.addEventListener('afterprint', after); setTimeout(() => window.print(), 600);
  }, [p, tenantId, id]);
  if (!p || !selectedTenant) return <p className="p-8" style={{ color: 'hsl(var(--muted-foreground))' }}>Loading…</p>;
  return <RefundSheets p={p} tenant={selectedTenant} />;
}
