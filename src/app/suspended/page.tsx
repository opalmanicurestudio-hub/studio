'use client';
// src/app/suspended/page.tsx — WHERE A LOCKED BUSINESS'S TEAM LANDS (components/auth/AccessGate, lib/tenant-access).
// Plain words for each reason, one way forward: billing problems go to Your ClarityFlow to fix them; a pause by
// ClarityFlow says where to write. Sign out is always here, so someone else can use this device.
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAuth, signOut } from 'firebase/auth';

const SUPPORT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';

const COPY: Record<string, { title: string; body: string; fix?: { href: string; label: string } }> = {
  cancelled: {
    title: 'Your subscription has ended',
    body: 'Your business’s information is kept safe. Start a plan again to open the app and take bookings.',
    fix: { href: '/subscriptions', label: 'Choose a plan' },
  },
  grace_expired: {
    title: 'Your payment didn’t go through',
    body: 'The app is closed until the card on file is updated. Your business’s information is kept safe.',
    fix: { href: '/subscriptions', label: 'Update billing' },
  },
  paused: {
    title: 'This account is paused',
    body: 'ClarityFlow has paused access to this business for now. Its information is kept safe, and online booking and the shop are closed while it’s paused.',
  },
};

function Suspended() {
  const reason = useSearchParams().get('reason') || 'paused';
  const copy = COPY[reason] || COPY.paused;
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const leave = async () => { setLeaving(true); await signOut(getAuth()).catch(() => {}); router.replace('/login'); };
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7', padding: 20, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#16171a' }}>
      <div style={{ width: '100%', maxWidth: 440, background: '#ffffff', border: '1px solid #ececee', borderRadius: 24, padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ fontSize: 14, color: '#6d7075' }}>ClarityFlow</span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{copy.title}</h1>
        <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, color: '#4a4c52' }}>{copy.body}</p>
        {copy.fix && <Link href={copy.fix.href} style={{ minHeight: 48, borderRadius: 14, background: '#16171a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, textDecoration: 'none', marginTop: 6 }}>{copy.fix.label}</Link>}
        {SUPPORT && <p style={{ margin: 0, fontSize: 14, color: '#4a4c52' }}>Questions? Email <a href={`mailto:${SUPPORT}`} style={{ color: '#16171a', fontWeight: 600 }}>{SUPPORT}</a></p>}
        <button type="button" onClick={leave} disabled={leaving} style={{ minHeight: 44, border: 0, background: 'transparent', color: '#6d7075', fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 4, cursor: 'pointer', alignSelf: 'flex-start', padding: 0 }}>{leaving ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </main>
  );
}

export default function SuspendedPage() {
  return <Suspense><Suspended /></Suspense>;
}
