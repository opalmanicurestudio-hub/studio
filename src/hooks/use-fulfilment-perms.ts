'use client';
// The signed-in person's fulfilment permissions: their own fulfilment role when the owner set one on their staff
// record, otherwise their role at the business (lib/fulfilment-access).
import { useMemo } from 'react';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { permissionsFor } from '@/lib/fulfilment-access';

export function useFulfilmentPerms() {
  const { role, staffId, user } = useTenant() as any;
  const { staff } = useInventory() as any;
  return useMemo(() => {
    const me = (staff || []).find((m: any) => m.id === staffId || (user?.uid && m.id === user.uid));
    return permissionsFor({ role: (role || 'staff') as any, fulfilmentRole: me?.fulfilmentRole });
  }, [role, staffId, user?.uid, staff]);
}
