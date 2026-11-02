'use client';
// src/app/(booking)/book/[tenantId]/find/page.tsx — FIND MY BOOKING (design canvas BookFind, ClientManage "Find"): the
// phone or email they booked with, and a link to each upcoming visit is sent there (/api/booking/find). The same answer
// whatever was typed, so nobody can learn who has a booking; only someone with that phone or email gets the links. In
// the visit link's look (components/booking/VisitShell): the business's header, color and mood.

import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitButton, VisitCard, VisitMuted, VisitSaid, VisitCheck, brandFromLook, useLook } from '@/components/booking/VisitShell';

export default function FindMyBooking() {
  const { tenantId } = useParams() as { tenantId: string };
  const { look, ready } = useLook(tenantId);
  const brand = brandFromLook(look, tenantId);
  const [contact, setContact] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [done, setDone] = React.useState<'email' | 'text' | null>(null);
  const doneRef = React.useRef<HTMLHeadingElement>(null); const shown = React.useRef(done);
  // After sending, focus moves to the answer (a screen reader reads it out there); after "Try another", to the field.
  // Only on a real change, so a second run of the same effect never moves focus on arrival.
  React.useEffect(() => { if (shown.current === done) return; shown.current = done; if (done) doneRef.current?.focus(); else document.getElementById('find-contact')?.focus(); }, [done]);
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
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (done) return (
    <VisitShell brand={brand} kicker={<span className="mb-2 inline-block"><VisitCheck /></span>}
      title={<span ref={doneRef} tabIndex={-1} style={{ outline: 'none' }}>Check your <b>{done === 'email' ? 'email' : 'messages'}</b></span>}
      subtitle={`If that ${done === 'email' ? 'email' : 'number'} has a booking with us, a link to each visit is on its way by ${done === 'email' ? 'email' : 'text'}.`}>
      <VisitCard><VisitMuted>Nothing in a few minutes? {done === 'email' ? 'Check your spam folder, or try' : 'Try'} the other {done === 'email' ? 'phone number' : 'email'} you might have booked with.</VisitMuted></VisitCard>
      <VisitButton quiet onClick={() => { setDone(null); setContact(''); }}>Try another</VisitButton>
      <VisitButton href={brand.bookHref}>Book a visit</VisitButton>
    </VisitShell>
  );
  return (
    <VisitShell brand={brand} title={<>Find <b>your booking</b></>} subtitle="Enter the phone number or email you booked with. We’ll send you a link to see, change or cancel it.">
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="find-contact" className="block px-1 text-[14px] font-medium">Phone or email</label>
        <input id="find-contact" value={contact} onChange={(e) => { setContact(e.target.value); setErr(''); }} autoComplete="username"
          aria-invalid={!!err} aria-describedby={err ? 'find-err' : 'find-help'} className="v-field h-12" />
        {err && <div id="find-err"><VisitSaid text={err} /></div>}
        <button type="submit" disabled={busy} className="v-btn pub-press">{busy ? 'Sending…' : 'Send me my link'}</button>
        <p id="find-help" className="text-center text-[13px]" style={{ color: 'var(--muted)' }}>Only someone with that phone or email can open it.</p>
      </form>
      <VisitButton quiet href={brand.bookHref}>Book a visit</VisitButton>
    </VisitShell>
  );
}
