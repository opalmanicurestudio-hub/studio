'use client';
// app/(app)/rentals — THE RENTALS HOME: how full the spaces are, the money, one list of what needs you, leases ending
// soon and today at the spaces (components/renters/RentalsHome).
import React from 'react';
import { useTenant } from '@/context/TenantContext';
import { useLocation } from '@/context/LocationContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { LocationSwitcher } from '@/components/shared/LocationSwitcher';
import { RentalsHome } from '@/components/renters/RentalsHome';

export default function RentalsPage() {
  const { selectedTenant } = useTenant();
  const { selectedLocationId } = useLocation();
  const tenantId = selectedTenant?.id ?? null;
  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f7] text-[#16171a]">
      <AppHeader title="Rentals" />
      <main className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 sm:px-6">
        {tenantId
          ? <RentalsHome tenantId={tenantId} locationId={selectedLocationId} businessName={selectedTenant?.name || ''} locationSwitcher={<LocationSwitcher />} />
          : <p className="text-[15px] text-[#6d7075]">Choose a business first.</p>}
      </main>
    </div>
  );
}
