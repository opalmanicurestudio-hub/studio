
'use client';

import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Tenant } from '@/lib/data';

export const BookingHeader = ({ tenant }: { tenant: Tenant | null }) => {
  return (
    <header className="mb-12 text-center">
      <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4">
        <ClarityFlowLogo />
      </div>
      <h1 className="text-4xl font-extrabold tracking-tight">{tenant?.name || 'ClarityFlow Salon'}</h1>
    </header>
  );
};
