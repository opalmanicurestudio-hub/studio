'use client';
// src/components/shop/RestockAlert.tsx — "TELL ME WHEN IT'S BACK". Shown on a sold-out product. One email field; we
// send one email when it's back online, and nothing else.
import * as React from 'react';

export function RestockAlert({ tenantId, productId, productName }: { tenantId: string; productId: string; productName: string }) {
  const [email, setEmail] = React.useState(''); const [state, setState] = React.useState<'idle' | 'busy' | 'done' | 'error'>('idle'); const [msg, setMsg] = React.useState('');
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setState('error'); setMsg('Enter an email address.'); return; }
    setState('busy');
    try {
      const r = await fetch('/api/retail/restock-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, productId, email: email.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setState('done'); setMsg(d.message || `We’ll email you once when ${productName} is back.`); } else { setState('error'); setMsg(d.error || 'That didn’t go through. Try again.'); }
    } catch { setState('error'); setMsg('That didn’t go through. Check your connection.'); }
  };
  if (state === 'done') return <p className="cf-anim-rise rounded-2xl bg-[#eaf6ef] px-4 py-3 text-[14px] font-semibold text-[#1f7a4d]">{msg}</p>;
  return (
    <div className="rounded-2xl border-2 p-4">
      <p className="m-0 text-[15px] font-semibold text-[#16171a]">Tell me when it’s back</p>
      <p className="m-0 mt-0.5 text-[13px] text-[#6d7075]">One email when it’s back in stock. Nothing else.</p>
      <div className="mt-3 flex gap-2">
        <input type="email" inputMode="email" autoComplete="email" aria-label="Your email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="you@example.com" className="h-12 min-w-0 flex-1 rounded-full border-2 px-4 text-[15px] outline-none" />
        <button type="button" onClick={() => void send()} disabled={state === 'busy'} className="cf-press h-12 shrink-0 rounded-full bg-[#16171a] px-5 text-[15px] font-semibold text-white disabled:opacity-50">{state === 'busy' ? 'Saving…' : 'Notify me'}</button>
      </div>
      {state === 'error' && <p role="alert" className="m-0 mt-2 text-[13px] text-[#b45309]">{msg}</p>}
    </div>);
}
