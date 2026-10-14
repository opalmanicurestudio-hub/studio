'use client';
// /wallet/[tenantId]?p=… — A CLIENT'S WALLET, AS THEY SEE IT, for a manager trying it out (Referrals → Try it yourself).
// The link is private and lasts 2 hours. It shows exactly what the client sees on their visit link: their credit, gift
// cards, packages, membership, friends, and Share / Gift a friend (a gift made here is real, so use your own number).
import * as React from 'react';
import { useParams } from 'next/navigation';
import { ReferralCard } from '@/components/visit/ReferralCard';

export default function WalletPreview() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const [preview, setPreview] = React.useState<string | null>(null);
  React.useEffect(() => { try { setPreview(new URLSearchParams(window.location.search).get('p') || ''); } catch { setPreview(''); } }, []);
  return (
    <main className="mx-auto min-h-screen max-w-[480px] space-y-4 px-4 py-6" style={{ color: '#16171a', background: '#fff', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <p className="rounded-2xl px-4 py-3 text-[13px]" style={{ background: '#fdf6ec', color: '#b45309' }}>Preview: this is what the client sees on their visit link. Gifts sent from here are real.</p>
      {preview === null ? null : preview ? <ReferralCard token="" preview={preview} tenantId={tenantId} /> : <p style={{ color: '#6d7075' }}>This preview link isn’t valid. Open it again from Referrals.</p>}
    </main>);
}
