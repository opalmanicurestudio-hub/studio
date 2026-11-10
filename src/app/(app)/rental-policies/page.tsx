'use client';
// app/(app)/rental-policies — every rule a business's leases are written from, in one place (components/renters/RentalPolicies).
import React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { RentalPolicies } from '@/components/renters/RentalPolicies';

export default function RentalPoliciesPage() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? null;
  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f7] text-[#16171a]">
      <AppHeader title="Rental policies" />
      <main className="mx-auto w-full max-w-[880px] min-w-0 space-y-5 px-4 py-6 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-[28px] font-bold leading-9">Rental policies</h1>
          <p className="text-[15px] leading-relaxed text-[#6d7075]">The rules your leases are written from. A change here applies to leases you send from now on. A renter’s signed lease keeps its own terms, or the kinder of the two.</p>
        </header>
        {tenantId ? <RentalPolicies tenantId={tenantId} /> : <p className="text-[15px] text-[#6d7075]">Choose a business first.</p>}
      </main>
    </div>
  );
}
