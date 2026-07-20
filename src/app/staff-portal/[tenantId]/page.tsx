'use client';

import dynamic from 'next/dynamic';

const StaffPortalPage = dynamic(
  () => import('./StaffPortalPage'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-white/40 font-black uppercase text-[10px] tracking-widest animate-pulse">
          Loading...
        </p>
      </div>
    ),
  }
);

export default function StaffPortalRoute({
  params,
}: {
  params: { tenantId: string };
}) {
  return <StaffPortalPage params={params} />;
}
