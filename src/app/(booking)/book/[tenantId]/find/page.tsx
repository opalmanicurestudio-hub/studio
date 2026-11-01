'use client';
// src/app/(booking)/book/[tenantId]/find/page.tsx — FIND MY BOOKING (design canvas BookFind): the phone or email they
// booked with, and a link to each upcoming visit is sent there (/api/booking/find). The same answer whatever was typed,
// so nobody can learn who has a booking; only someone with that phone or email gets the links.

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { PublicFrame } from '@/components/public/kit';

export default function FindMyBooking() {
  const { tenantId } = useParams() as { tenantId: string };
  const [biz, setBiz] = React.useState<{ name: string; accent: string; logoUrl: string | null } | null>(null);
  const [contact, setContact] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [done, setDone] = React.useState<'email' | 'text' | null>(null);
  const doneRef = React.useRef<HTMLHeadingElement>(null); const shown = React.useRef(done);
  // After sending, focus moves to the answer (a screen reader reads it out there); after "Try another", to the field.
  // Only on a real change, so a second run of the same effect never moves focus on arrival.
  React.useEffect(() => { if (shown.current === done) return; shown.current = done; if (done) doneRef.current?.focus(); else document.getElementById('find-contact')?.focus(); }, [done]);
  React.useEffect(() => { if (!tenantId) return; fetch(`/api/booking/find?tenantId=${encodeURIComponent(tenantId)}`).then((r) => r.json()).then((d) => { if (d?.ok) setBiz({ name: d.name, accent: d.accent, logoUrl: d.logoUrl }); }).catch(() => {}); }, [tenantId]);
  const send = async () => {
    const v = contact.trim(); if (busy) return;
    const ok = v.includes('@') ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) : v.replace(/\D/g, '').length >= 10;
    if (!ok) { setErr('Enter the phone number or email you booked with.'); document.getElementById('find-contact')?.focus(); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/booking/find', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, contact: v }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) setDone(d.channel === 'email' ? 'email' : 'text');
      else setErr(d?.error || 'That didn’t go through. Try again in a moment.');
    } catch { setErr('That didn’t go through. Try again in a moment.'); } finally { setBusy(false); }
  };
  const name = biz?.name || '';
  return (
    <PublicFrame accent={biz?.accent || '#16171a'}>
      <header className="border-b border-stone-200/70 bg-[#faf8f5]/90" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex h-16 max-w-xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">{biz?.logoUrl && <img src={biz.logoUrl} alt="" className="h-9 w-9 rounded-xl object-contain" />}<span className="truncate text-[17px] font-semibold">{name}</span></div>
          <a href={`/book/${encodeURIComponent(tenantId)}`} className="inline-flex h-11 shrink-0 items-center rounded-full px-5 text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>Book</a>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-4xl leading-tight">Find my <b>booking</b></h1>
        <p className="mt-3 text-[16px] text-stone-600">Enter the phone number or email you booked with. We’ll send you a link to see, change or cancel it.</p>
        {!done ? <form className="mt-6 space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label htmlFor="find-contact" className="block text-[14px] font-medium">Phone or email</label>
          <input id="find-contact" value={contact} onChange={(e) => { setContact(e.target.value); setErr(''); }} autoComplete="username" aria-invalid={!!err} aria-describedby={err ? 'find-err' : 'find-help'}
            className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[16px]" />
          {err && <p id="find-err" role="alert" className="text-[14px] text-stone-700">{err}</p>}
          <button type="submit" disabled={busy} className="inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] font-medium text-white shadow-sm transition active:scale-[.98] disabled:opacity-60" style={{ background: 'var(--accent)' }}>{busy ? 'Sending…' : 'Send me my link'}</button>
          <p id="find-help" className="text-center text-[13px] text-stone-500">Only someone with that phone or email can open it.</p>
        </form> : <div className="pub-card mt-6 p-6 text-center">
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full" style={{ background: '#e9f3ed', color: '#1f7a4d' }} aria-hidden><Check className="h-5 w-5" /></span>
          <h2 ref={doneRef} tabIndex={-1} className="text-[17px]" style={{ fontWeight: 600, letterSpacing: 0, outline: 'none' }}>Check your {done === 'email' ? 'email' : 'messages'}</h2>
          <p className="mt-1 text-[15px] text-stone-600">If that {done === 'email' ? 'email' : 'number'} has a booking with us, a link to each visit is on its way by {done === 'email' ? 'email' : 'text'}.</p>
          <p className="mt-2 text-[14px] text-stone-500">Nothing in a few minutes? {done === 'email' ? 'Check your spam folder, or try' : 'Try'} the other {done === 'email' ? 'phone number' : 'email'} you might have booked with.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => { setDone(null); setContact(''); }} className="inline-flex h-11 items-center rounded-full border border-stone-200 bg-white px-5 text-[15px]">Try another</button>
            <a href={`/book/${encodeURIComponent(tenantId)}`} className="inline-flex h-11 items-center rounded-full px-5 text-[15px] font-medium text-white shadow-sm" style={{ background: 'var(--accent)' }}>Book a visit</a>
          </div>
        </div>}
      </main>
    </PublicFrame>
  );
}
