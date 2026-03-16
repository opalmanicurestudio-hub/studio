
'use client';

import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Tenant } from '@/lib/data';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export const BookingHeader = ({ tenant }: { tenant: Tenant | null }) => {
  const logoUrl = tenant?.bookingPageSettings?.logoUrl;
  const wordmarkUrl = tenant?.bookingPageSettings?.wordmarkUrl;

  return (
    <header className="mb-12 text-center flex flex-col items-center">
      <div className={cn(
          "relative overflow-hidden mb-8 transition-all duration-700",
          logoUrl 
            ? "w-24 h-24 md:w-32 md:h-32 rounded-[2rem] shadow-2xl border-4 border-white" 
            : "inline-block p-4 bg-white rounded-full shadow-xl border-2 border-primary/10"
      )}>
        {logoUrl ? (
          <Image 
            src={logoUrl} 
            alt={tenant?.name || 'Business Logo'} 
            fill 
            className="object-cover"
          />
        ) : (
          <ClarityFlowLogo className="w-12 h-12 md:w-16 md:h-16" />
        )}
      </div>
      
      {wordmarkUrl ? (
          <div className="relative h-12 md:h-20 w-full max-w-[320px] transition-all duration-500">
              <Image 
                src={wordmarkUrl} 
                alt={tenant?.name || 'Wordmark'} 
                fill 
                className="object-contain"
              />
          </div>
      ) : (
          <h1 className="text-3xl md:text-5xl font-extrabold uppercase tracking-[0.1em] text-slate-900 leading-tight">
            {tenant?.name || 'ClarityFlow Salon'}
          </h1>
      )}
    </header>
  );
};
