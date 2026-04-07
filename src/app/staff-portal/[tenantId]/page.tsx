// app/[tenantId]/staff-portal/page.tsx
//
// THIS IS THE ONLY CHANGE NEEDED TO FIX THE CRASH.
//
// Why: The full StaffPortalPage component calls createPortal(…, document.body)
// during render. Next.js App Router SSRs every page — even ones with ‘use client’
// — which means document is undefined on the server, causing the crash.
//
// dynamic() with ssr:false tells Next.js to skip server rendering entirely for
// this route and only render it in the browser where document exists.
//
// Steps:
//   1. Save your current page.tsx content as StaffPortalPage.tsx in the same folder
//   2. Replace page.tsx with this file
//   3. Deploy

import dynamic from ‘next/dynamic’;

const StaffPortalPage = dynamic(
() => import(’./StaffPortalPage’),
{
ssr: false,
loading: () => (
<div className="min-h-screen bg-slate-900 flex items-center justify-center">
<p className="text-white/40 font-black uppercase text-[10px] tracking-widest animate-pulse">
Loading…
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