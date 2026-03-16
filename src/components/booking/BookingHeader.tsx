
'use client';

import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Tenant } from '@/lib/data';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export const BookingHeader = ({ tenant }: { tenant: Tenant | null }) => {
  const logoUrl = tenant?.bookingPageSettings?.logoUrl;
  const wordmarkUrl = tenant?.bookingPageSettings?.wordmarkUrl;
  const showWordmark = tenant?.bookingPageSettings?.showWordmark !== false;

  const logoSize = showWordmark 
    ? "w-24 h-24 md:w-32 md:h-32" 
    : "w-40 h-40 md:w-56 md:h-56";
  
  const logoRadius = showWordmark 
    ? "rounded-[2rem]" 
    : "rounded-[2.5rem] md:rounded-[3.5rem]";

  return (
    <header className="mb-12 text-center flex flex-col items-center">
      <div className={cn(
          "relative overflow-hidden mb-8 transition-all duration-700",
          logoSize,
          logoRadius,
          logoUrl 
            ? "shadow-2xl border-4 border-white" 
            : "inline-block p-4 bg-white shadow-xl border-2 border-primary/10"
      )}>
        {logoUrl ? (
          <Image 
            src={logoUrl} 
            alt={tenant?.name || 'Business Logo'} 
            fill 
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ClarityFlowLogo className={cn(showWordmark ? "w-12 h-12 md:w-16 md:h-16" : "w-20 h-20 md:w-28 md:h-28")} />
          </div>
        )}
      </div>
      
      {showWordmark && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-1000">
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
        </div>
      )}
    </header>
  );
};
