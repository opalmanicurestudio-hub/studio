'use client';
// /hello/[tenantId]/[clientId]?k=… — "SAME STUDIO, NEW WAY TO BOOK" (lib/welcome): where the switch-over text lands.
// Their history came with them, their next visit is still booked, their gift card is here — and one tap books their usual.
import * as React from 'react';
import { useParams } from 'next/navigation';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d';

export default function WelcomeBackPage() {
  const p = useParams() as { tenantId: string; clientId: string }; const tenantId = String(p?.tenantId || ''), clientId = String(p?.clientId || '');
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { const k = new URLSearchParams(window.location.search).get('k') || '';
    fetch(`/api/import/hello?tenantId=${encodeURIComponent(tenantId)}&clientId=${encodeURIComponent(clientId)}&k=${encodeURIComponent(k)}`).then((r) => r.json())
      .then((x) => (x.ok ? setD(x) : setErr(x.error || 'This link isn’t valid.'))).catch(() => setErr('We couldn’t load this — check your connection.')); }, [tenantId, clientId]);
  const A = d?.brand?.accent || INK;
  const checks: string[] = d ? [
    d.history ? 'Your visit history came with you' : null,
    d.next ? `Your ${new Date(d.next.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} appointment is still booked` : null,
    d.giftCents ? `Your gift card: $${(d.giftCents / 100).toFixed(d.giftCents % 100 ? 2 : 0)} left` : null,
    d.membership ? `Your ${d.membership} membership carries on` : null,
  ].filter(Boolean) as string[] : [];
  return (
    <div className="flex min-h-dvh flex-col px-5 pb-8 pt-6" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: '#f7f7f8' }}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
        {err ? <p className="pt-16 text-center text-[16px] font-semibold">{err}</p> : !d ? <p className="pt-16 text-center" style={{ color: MUTED }}>Loading…</p> : <>
          <div className="flex items-center gap-3">{d.brand.logo ? <img src={d.brand.logo} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-xl text-[16px] font-bold text-white" style={{ background: A }}>{String(d.brand.name).slice(0, 1)}</span>}
            <span className="text-[16px] font-semibold">{d.brand.name}</span></div>
          <div className="rounded-[22px] p-6 text-white" style={{ background: A }}><p className="text-[14px] opacity-85">{d.firstName ? `Welcome back, ${d.firstName}` : 'Welcome back'}</p>
            <h1 className="mt-1 text-[28px] font-normal leading-tight tracking-[-0.02em]">Same studio, new way to book.</h1></div>
          {checks.length > 0 && <ul className="space-y-3 rounded-[18px] bg-white p-4" style={{ border: `1px solid ${LINE}` }}>{checks.map((c) => <li key={c} className="flex items-center gap-3 text-[15px]">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: GREEN }}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-4.9" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></span>{c}</li>)}</ul>}
          {d.again && <a href={d.again.href} className="flex min-h-[52px] items-center justify-center rounded-full px-5 py-3 text-center text-[15.5px] font-semibold text-white" style={{ background: INK }}>{d.again.label}</a>}
          <a href={d.bookUrl} className="flex h-[52px] items-center justify-center rounded-full border bg-white text-[15.5px] font-semibold" style={{ borderColor: LINE, ...(d.again ? {} : { background: INK, color: '#fff', borderColor: INK }) }}>{d.again ? 'See all services' : 'Book a visit'}</a>
          <p className="mt-auto pt-6 text-center text-[13px]" style={{ color: MUTED }}>Save this page to your home screen for one-tap booking.</p>
        </>}
      </div>
    </div>);
}
