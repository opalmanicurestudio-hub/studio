'use client';
// /pay/thanks — where a payment link lands. The receipt follows by email / text once the payment is confirmed.
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
export default function Page() { return <Suspense fallback={null}><PayThanks /></Suspense>; }
function PayThanks() {
  const sp = useSearchParams(); const b = sp.get('b') || ''; const cancelled = sp.get('c') === '1';
  return (<main style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f7f5f2', padding: 24 }}>
    <div style={{ maxWidth: 380, textAlign: 'center', background: '#fff', borderRadius: 20, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
      <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{cancelled ? 'Payment not made' : 'Thank you — you’re paid'}</p>
      <p style={{ color: '#57534e', marginTop: 8 }}>{cancelled ? 'Nothing was charged. You can use the same link again any time today.' : `${b ? `${b} has your payment. ` : ''}A receipt is on its way.`}</p>
    </div></main>);
}
