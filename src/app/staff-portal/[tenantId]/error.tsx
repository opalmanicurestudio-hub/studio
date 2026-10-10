'use client';
// src/app/staff-portal/[tenantId]/error.tsx — if the staff portal itself fails to open: an outdated copy after an
// update reloads itself once; anything else is reported and shows a plain "Reload" screen.
import * as React from 'react';
import { isStaleCopy, reloadOnce, reportCrash } from '@/lib/client-crash';

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => { if (isStaleCopy(error) && reloadOnce()) return; reportCrash(error, 'portal-route', { digest: error?.digest }); }, [error]);
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-8 text-center" style={{ color: '#16171a' }}>
      <p className="text-[22px] font-extrabold">The portal didn’t open</p>
      <p className="max-w-xs text-[15px]" style={{ color: '#6d7075' }}>This is usually fixed by reloading. If it keeps happening, tell your manager — we’ve been sent the details.</p>
      <button type="button" onClick={() => window.location.reload()} className="h-12 rounded-[16px] px-6 text-[16px] font-bold text-white" style={{ background: '#16171a' }}>Reload</button>
      <button type="button" onClick={reset} className="text-[14px] font-semibold" style={{ color: '#6d7075' }}>Try again without reloading</button>
      {error?.digest && <p className="text-[12px]" style={{ color: '#9a9ca1' }}>Reference {error.digest}</p>}
    </div>);
}
