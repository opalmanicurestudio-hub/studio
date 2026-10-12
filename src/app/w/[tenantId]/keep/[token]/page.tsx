'use client';
// src/app/w/[tenantId]/keep/[token]/page.tsx — "STILL HOPING?" After a few offers in a row they never opened, the
// waitlist asks once instead of texting forever: keep their place (offers start again) or come off the list.
// No answer in 48 hours → paused. /api/waitlist/offer (keep_view / keep / leave), lib/waitlist-server keepEntry.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, brandOf } from '@/components/booking/VisitShell';

export default function StillHoping() {
  const { tenantId, token } = useParams() as { tenantId: string; token: string };
  const [v, setV] = React.useState<any>(null); const [done, setDone] = React.useState<'' | 'kept' | 'left'>(''); const [busy, setBusy] = React.useState('');
  const post = (action: string) => fetch('/api/waitlist/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We could not connect. Please check your connection and try again.' }));
  React.useEffect(() => { post('keep_view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard></VisitShell>;
  if (done === 'kept') return <VisitShell brand={brand} title={<>You are still <b>on our waitlist</b></>} subtitle="We will text you when a suitable time becomes available."><VisitCard><VisitMuted>Simply confirm using the link in that text and the time will be booked for you.</VisitMuted></VisitCard></VisitShell>;
  if (done === 'left' || v.status === 'closed') return <VisitShell brand={brand} title="You have been removed from our waitlist" subtitle="You will not receive any more texts about openings."><VisitCard><VisitMuted>Thank you for letting us know. We would be delighted to see you whenever it suits you.</VisitMuted></VisitCard>{brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;
  if (v.status === 'booked') return <VisitShell brand={brand} title={<>Your appointment is <b>booked</b></>}><VisitCard><VisitMuted>You already have an appointment from our waitlist, so there is nothing more you need to do.</VisitMuted></VisitCard></VisitShell>;
  return (
    <VisitShell brand={brand} title={<>Would you like to <b>stay on our waitlist</b>?</>} subtitle={`For ${v.service ? `a ${v.service.toLowerCase()}` : 'an appointment'}. Either choice is perfectly fine.`}>
      <VisitCard><VisitMuted>We have recently texted you about a few times that became available. If you would still like an appointment, please keep your place and we will continue to let you know. If not, we will stop sending these texts.</VisitMuted></VisitCard>
      <VisitButton onClick={async () => { setBusy('keep'); const r = await post('keep'); setBusy(''); if (r.ok) setDone('kept'); }} disabled={!!busy}>{busy === 'keep' ? 'One moment…' : 'Yes, keep my place'}</VisitButton>
      <VisitButton quiet onClick={async () => { setBusy('leave'); const r = await post('leave'); setBusy(''); if (r.ok) setDone('left'); }} disabled={!!busy}>{busy === 'leave' ? 'One moment…' : 'No, thank you. Please remove me'}</VisitButton>
    </VisitShell>);
}
