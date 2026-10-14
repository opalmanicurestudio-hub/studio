'use client';
// /ref/[tenantId]/terms — the referral program's terms, made from the business's own settings (lib/referrals termsLines).
import * as React from 'react';
import { useParams } from 'next/navigation';

export default function ReferralTerms() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'terms', tenantId }) }).then((r) => r.json()).then(setD).catch(() => setD({ ok: false })); }, [tenantId]);
  return (
    <main className="mx-auto min-h-screen max-w-[560px] px-5 py-10" style={{ color: '#16171a', background: '#fff', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      <h1 className="text-[26px] font-light tracking-[-0.02em]">{d?.business ? `${d.business}: share with a friend` : 'Share with a friend'}</h1>
      {!d ? <p className="mt-4" style={{ color: '#6d7075' }}>Loading…</p> : !d.on ? <p className="mt-4" style={{ color: '#6d7075' }}>This program isn’t running right now.</p>
        : <ul className="mt-5 space-y-3">{(d.lines || []).map((l: string, i: number) => <li key={i} className="flex gap-3 text-[15px] leading-[1.55]"><span style={{ color: '#6d7075' }}>•</span><span>{l}</span></li>)}</ul>}
    </main>);
}
