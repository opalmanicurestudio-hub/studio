'use client';
// src/app/(booking)/book/[tenantId]/error.tsx — if the booking page itself fails while a client is using it: an outdated
// copy after an update reloads itself once; anything else is reported and the client gets a calm screen with Reload and
// a way back to the start of booking.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { isStaleCopy, reloadOnce, reportCrash } from '@/lib/client-crash';

export default function BookingError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams() as { tenantId?: string } | null;
  const start = params?.tenantId ? `/book/${encodeURIComponent(String(params.tenantId))}` : '/';
  React.useEffect(() => { if (isStaleCopy(error) && reloadOnce()) return; reportCrash(error, 'booking-route', { digest: error?.digest }); }, [error]);
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-8 text-center" style={{ color: '#16171a' }}>
      <p className="text-[22px] font-extrabold">Booking didn’t load</p>
      <p className="max-w-xs text-[15px]" style={{ color: '#6d7075' }}>Reloading usually fixes it. If you were paying, check for a confirmation email or text before booking again.</p>
      <button type="button" onClick={() => window.location.reload()} className="h-12 rounded-full px-6 text-[15px] font-semibold text-white" style={{ background: '#16171a' }}>Reload</button>
      <a href={start} className="inline-flex h-11 items-center text-[14px] font-semibold" style={{ color: '#6d7075' }}>Start booking again</a>
      {error?.digest && <p className="text-[12px]" style={{ color: '#9a9ca1' }}>Reference {error.digest}</p>}
    </div>);
}
