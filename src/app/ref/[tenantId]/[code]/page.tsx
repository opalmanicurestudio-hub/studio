'use client';
// /ref/[tenantId]/[code] — A FRIEND'S WELCOME (design canvas RF3). "Hannah recommended you to Opal": the welcome offer,
// already applied when they book, and Hannah's favorite service as a one-tap start. First name only; nothing else
// about the person who referred them is shown. /api/referrals/public.
import * as React from 'react';
import { useParams } from 'next/navigation';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const money = (n: number | null) => (n == null ? '' : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);

export default function ReferralWelcome() {
  const p = useParams() as any; const tenantId = String(p?.tenantId || ''); const code = String(p?.code || '');
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'info', tenantId, code }) }).then((r) => r.json()).then(setD).catch(() => setD({ ok: false, error: 'This page couldn’t load. Please try again.' })); }, [tenantId, code]);
  const book = (serviceId?: string) => `/book/${encodeURIComponent(tenantId)}?ref=${encodeURIComponent(code)}${serviceId ? `&service=${encodeURIComponent(serviceId)}` : ''}&src=referral`;
  return (
    <main className="mx-auto min-h-screen max-w-[480px] px-5 py-10" style={{ color: INK, background: '#fff', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}>
      {!d ? <p style={{ color: MUTED }}>Loading…</p> : !d.ok ? <div className="space-y-3"><h1 className="text-[26px] font-light">This offer isn’t available</h1><p style={{ color: MUTED }}>{d.error}</p><a href={`/book/${encodeURIComponent(tenantId)}`} className="inline-block rounded-full px-5 py-3 font-semibold text-white" style={{ background: INK }}>See services</a></div> : (
        <div className="space-y-5">
          {d.logo ? <img src={d.logo} alt={d.business} className="h-12 w-auto" /> : <p className="text-[14px] font-semibold">{d.business}</p>}
          <div className="h-28 rounded-[20px]" style={{ background: 'linear-gradient(135deg,#efe8e1,#e4e7ef)' }} aria-hidden="true" />
          <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em]">{d.firstName} recommended you to {d.business}</h1>
          <p className="text-[15px] leading-[1.55]">Welcome! Your first visit is <b>{money(d.offerCents / 100)} off</b>, already applied when you book.</p>
          {d.favorite && <div className="space-y-2 rounded-[18px] border p-4" style={{ borderColor: LINE }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: MUTED }}>{d.firstName}’s favorite</p>
            <p className="text-[15px]"><b>{d.favorite.name}</b>{d.favorite.minutes ? ` · ${d.favorite.minutes} min` : ''}{d.favorite.price ? ` · ${money(d.favorite.price)}` : ''}</p>
            <a href={book(d.favorite.id)} className="block rounded-full py-3 text-center text-[15px] font-semibold text-white" style={{ background: INK }}>Book {d.favorite.name.toLowerCase()}</a></div>}
          <a href={book()} className={`block rounded-full border py-3 text-center text-[15px] font-semibold ${d.favorite ? '' : 'text-white'}`} style={d.favorite ? { borderColor: LINE } : { background: INK }}>See all services</a>
          <p className="text-[12.5px]" style={{ color: MUTED }}>New clients only · one welcome offer per person · <a className="underline" href={`/ref/${encodeURIComponent(tenantId)}/terms`}>terms</a></p>
        </div>)}
    </main>);
}
