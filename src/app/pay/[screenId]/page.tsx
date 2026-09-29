'use client';
// /pay/[screenId]?r=… — the client pays on THEIR OWN PHONE (they scanned the QR on the front-desk iPad).
// Apple Pay / Google Pay show up where the phone supports them. Nothing here is shown to anyone else.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ClientPayForm } from '@/components/pay/ClientPayForm';

export default function PayOnPhonePage() {
  const { screenId } = useParams() as { screenId: string };
  const r = useSearchParams().get('r') || '';
  const [done, setDone] = React.useState(false);
  return (
    <main className="min-h-[100dvh] p-5" style={{ background: '#faf8f5', color: '#1c1917', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      <div className="mx-auto max-w-md space-y-5">
        <p className="text-[24px] font-semibold">{done ? 'Paid — thank you!' : 'Pay for your visit'}</p>
        {done ? <p className="text-[16px]" style={{ color: '#57534e' }}>You can close this page. Your receipt is at the front desk screen.</p>
          : r ? <ClientPayForm screenId={screenId} requestId={r} onPaid={() => setDone(true)} /> : <p>This link isn’t complete — scan the code again.</p>}
      </div>
    </main>
  );
}
