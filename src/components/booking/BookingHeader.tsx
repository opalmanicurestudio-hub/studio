
'use client';

import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Tenant } from '@/lib/data';
import Image from 'next/image';

export const BookingHeader = ({ tenant }: { tenant: Tenant | null }) => {
  const logoUrl = tenant?.bookingPageSettings?.logoUrl;

  return (
    <header className="mb-12 text-center">
      <div className="inline-block p-3 bg-card rounded-full shadow-md mb-4 overflow-hidden border-2 border-primary/10">
        {logoUrl ? (
          <div className="relative w-12 h-12 md:w-16 md:h-16">
            <Image 
              src={logoUrl} 
              alt={tenant?.name || 'Business Logo'} 
              fill 
              className="object-contain"
            />
          </div>
        ) : (
          <ClarityFlowLogo className="w-12 h-12 md:w-16 md:h-16" />
        )}
      </div>
      <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">
        {tenant?.name || 'ClarityFlow Salon'}
      </h1>
    </header>
  );
};
