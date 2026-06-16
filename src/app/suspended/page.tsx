'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

// ─── /app/suspended/page.tsx ───────────────────────────────────────────────────
// Shown when middleware locks a tenant out due to subscription issues.

const REASON_COPY: Record<string, { title: string; body: string; cta: string }> = {
  cancelled: {
    title: 'Subscription Cancelled',
    body:  'Your ClarityFlow subscription has ended. Reactivate anytime to restore full access — your data is preserved.',
    cta:   'Reactivate Subscription',
  },
  grace_expired: {
    title: 'Payment Past Due',
    body:  'Your grace period has ended. Please update your payment method to restore access to your studio.',
    cta:   'Update Payment Method',
  },
  past_due: {
    title: 'Payment Required',
    body:  'We were unable to process your last payment. Update your billing info to continue.',
    cta:   'Update Payment Method',
  },
  locked: {
    title: 'Account Suspended',
    body:  'Your account has been suspended. Please contact support or update your billing information.',
    cta:   'Go to Billing',
  },
};

function SuspendedContent() {
  const params = useSearchParams();
  const reason = params.get('reason') || 'locked';
  const copy   = REASON_COPY[reason] || REASON_COPY.locked;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '2rem' }}>
      <div style={{ maxWidth: '420px', width: '100%', background: '#fff', border: '2px solid #e2e8f0', borderRadius: '24px', padding: '3rem 2.5rem', textAlign: 'center', boxShadow: '0 4px 32px rgba(0,0,0,0.06)' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="#dc2626" strokeWidth="2" strokeLinecap="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
        </div>

        <div style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#94a3b8', marginBottom: '0.5rem' }}>
          ClarityFlow
        </div>

        <h1 style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
          {copy.title}
        </h1>

        <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, margin: '0 0 2rem' }}>
          {copy.body}
        </p>

        <Link href="/settings/billing"
          style={{ display: 'block', width: '100%', padding: '14px', background: '#0f172a', color: '#fff', borderRadius: '12px', fontWeight: 900, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em', textDecoration: 'none', marginBottom: '0.75rem' }}>
          {copy.cta}
        </Link>

        <a href="mailto:support@clarityflow.app"
          style={{ display: 'block', fontSize: '12px', color: '#94a3b8', textDecoration: 'none', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Contact Support
        </a>
      </div>
    </div>
  );
}

export default function SuspendedPage() {
  return (
    <Suspense>
      <SuspendedContent />
    </Suspense>
  );
}
