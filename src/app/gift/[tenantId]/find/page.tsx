'use client';
// src/app/gift/[tenantId]/find/page.tsx — FIND MY GIFT CARD (lib/gift-shop findMyCards). Lost the email or text? Type the
// phone or email it went to; if there are cards for it, one message with a private link to all of them goes to that same
// phone or email. Nothing is shown here, so nobody can look up someone else's cards. In the visit link's look.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitButton, VisitCard, VisitMuted, VisitSaid, VisitCheck, brandFromLook, useLook } from '@/components/booking/VisitShell';

export default function FindGiftCardPage() {
  const tenantId = String(useParams<{ tenantId: string }>()?.tenantId || '');
  const { look, ready } = useLook(tenantId);
  const brand = brandFromLook(look, tenantId);
  const [v, setV] = React.useState(''); const [busy, setBusy] = React.useState(false); const [done, setDone] = React.useState(false); const [err, setErr] = React.useState('');
  const send = async () => { if (busy || v.trim().length < 6) return; setBusy(true); setErr('');
    const r = await fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'find', tenantId, contact: v }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
    setBusy(false); if (r.ok) setDone(true); else setErr(r.error || 'Please try again later.'); };
  if (!ready) return <div className="min-h-dvh" aria-busy="true" />;
  if (done) return (
    <VisitShell brand={brand} kicker={<span className="mb-2 inline-block"><VisitCheck /></span>} title={<>Check your <b>{v.includes('@') ? 'email' : 'messages'}</b></>}
      subtitle={`If there are gift cards for that ${v.includes('@') ? 'email' : 'number'}, we’ve just sent a link to them there.`}>
      <VisitCard><VisitMuted>Nothing came? Try the other one, since the card may have been sent to your {v.includes('@') ? 'phone' : 'email'}, or ask the person who gave it to you.</VisitMuted></VisitCard>
      <VisitButton quiet onClick={() => { setDone(false); setV(''); }}>Try another</VisitButton>
    </VisitShell>
  );
  return (
    <VisitShell brand={brand} title={<>Find my <b>gift card</b></>} subtitle="Lost the text or email? Enter the mobile number or email it was sent to, and we’ll send it again with every card you have here.">
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="gift-contact" className="block px-1 text-[14px] font-medium">Mobile number or email</label>
        <input id="gift-contact" value={v} onChange={(e) => { setV(e.target.value); setErr(''); }} autoComplete="email" aria-invalid={!!err} className="v-field h-12" />
        <VisitSaid text={err} />
        <button type="submit" disabled={busy || v.trim().length < 6} className="v-btn pub-press">{busy ? 'Sending…' : 'Send me my cards'}</button>
        <p className="text-center text-[13px]" style={{ color: 'var(--muted)' }}>Only someone with that phone or email can open them.</p>
      </form>
    </VisitShell>
  );
}
