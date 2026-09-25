'use client';
// src/components/marketing/RequestAccess.tsx
//
// EARLY ACCESS, BY REQUEST. A short form — who you are, your business, what
// you use now — saved to platformLeads and emailed to the founder, who sets
// each business up personally. No card, no trial clock.

import { useState } from 'react';
import Link from 'next/link';
import { NICHES, NICHE_ORDER } from './niches';

export function RequestAccess({ initialType }: { initialType: string }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', business: '', type: initialType || '', size: '', currently: '', note: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, source: 'request-access' }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) setSent(true); else setErr(d?.error || 'Something went wrong — try again.');
    } catch { setErr('Couldn’t reach us — check your connection.'); }
    finally { setBusy(false); }
  };

  const input = 'h-12 w-full rounded-2xl border border-white/80 bg-white/70 px-4 text-[15px] outline-none focus:ring-2 focus:ring-stone-300';
  return (
    <div className="cf-page relative min-h-dvh bg-[#f7f5f2] text-stone-900">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-amber-200/50 via-rose-200/40 to-transparent blur-3xl" />
        <div className="absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-gradient-to-bl from-violet-200/40 via-sky-200/30 to-transparent blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto max-w-lg px-5 pb-20 pt-6">
        <Link href="/" className="text-lg font-light tracking-tight">Clarity<span className="font-semibold">Flow</span></Link>

        {sent ? (
          <div className="glass mt-16 rounded-[2rem] p-8 text-center">
            <p className="text-4xl">✨</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight">You’re on the list.</h1>
            <p className="mt-3 text-stone-600">We’ll be in touch personally to set up {f.business || 'your business'} — usually within a day or two.</p>
            <Link href={`/demo${f.type ? `?type=${f.type}` : ''}`} className="mt-6 inline-block rounded-full bg-stone-900 px-6 py-3 text-sm font-medium text-white">Keep exploring the demo</Link>
          </div>
        ) : (
          <>
            <h1 className="mt-10 text-4xl font-light leading-tight tracking-tight">Request <span className="font-semibold">early access</span></h1>
            <p className="mt-3 text-stone-600">We’re opening ClarityFlow a few businesses at a time, and setting each one up personally — your services, your team, your clients moved over.</p>

            <div className="glass mt-8 space-y-3 rounded-[2rem] p-5 sm:p-6">
              <div>
                <p className="mb-2 text-sm text-stone-600">I run a…</p>
                <div className="flex flex-wrap gap-2">
                  {[...NICHE_ORDER.map((k) => [k, NICHES[k].label] as const), ['other', 'Something else'] as const].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => set('type', k)} aria-pressed={f.type === k}
                      className={`rounded-full px-4 py-2 text-sm ${f.type === k ? 'bg-stone-900 text-white' : 'bg-white/70 text-stone-700'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <input className={input} placeholder="Your name" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              <input className={input} placeholder="Email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
              <input className={input} placeholder="Phone (optional)" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
              <input className={input} placeholder="Business name" value={f.business} onChange={(e) => set('business', e.target.value)} autoComplete="organization" />
              <div>
                <p className="mb-2 text-sm text-stone-600">How many people work there, including you?</p>
                <div className="flex flex-wrap gap-2">
                  {['Just me', '2–5', '6–15', '16+'].map((s) => <button key={s} type="button" onClick={() => set('size', s)} aria-pressed={f.size === s} className={`rounded-full px-4 py-2 text-sm ${f.size === s ? 'bg-stone-900 text-white' : 'bg-white/70 text-stone-700'}`}>{s}</button>)}
                </div>
              </div>
              <input className={input} placeholder="What do you use now? (optional)" value={f.currently} onChange={(e) => set('currently', e.target.value)} />
              <textarea className={input + ' h-24 py-3'} placeholder="Anything we should know? (optional)" value={f.note} onChange={(e) => set('note', e.target.value)} />
              {/* Bots fill this; people never see it. */}
              <input tabIndex={-1} aria-hidden className="hidden" value={f.website} onChange={(e) => set('website', e.target.value)} autoComplete="off" />
              {err && <p className="text-sm text-red-700">{err}</p>}
              <button type="button" disabled={busy} onClick={submit} className="h-12 w-full rounded-full bg-stone-900 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Sending…' : 'Request access'}</button>
              <p className="text-center text-[12px] text-stone-500">No card. We’ll reach out personally.</p>
            </div>
            <p className="mt-6 text-center text-sm text-stone-600">Not sure yet? <Link href={`/demo${f.type && f.type !== 'other' ? `?type=${f.type}` : ''}`} className="underline">Try the live demo</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
