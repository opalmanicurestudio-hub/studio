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
  const post = (action: string) => fetch('/api/waitlist/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
  React.useEffect(() => { post('keep_view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard></VisitShell>;
  if (done === 'kept') return <VisitShell brand={brand} title={<>You’re still <b>on the list</b></>} subtitle="We’ll text you when a time fits."><VisitCard><VisitMuted>Tap the link in that text and it’s booked.</VisitMuted></VisitCard></VisitShell>;
  if (done === 'left' || v.status === 'closed') return <VisitShell brand={brand} title="You’re off the list" subtitle="No more texts about openings."><VisitCard><VisitMuted>Thanks for letting us know — we’d love to see you whenever suits.</VisitMuted></VisitCard>{brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;
  if (v.status === 'booked') return <VisitShell brand={brand} title={<>You’re <b>booked</b></>}><VisitCard><VisitMuted>You already have a time from the list — nothing to do here.</VisitMuted></VisitCard></VisitShell>;
  return (
    <VisitShell brand={brand} title={<>Still <b>hoping</b>?</>} subtitle={`For ${v.service ? `a ${v.service.toLowerCase()}` : 'a time'} — totally fine either way.`}>
      <VisitCard><VisitMuted>We’ve texted you a few times that opened up. If you still want one, keep your place and we’ll carry on. If not, we’ll stop.</VisitMuted></VisitCard>
      <VisitButton onClick={async () => { setBusy('keep'); const r = await post('keep'); setBusy(''); if (r.ok) setDone('kept'); }} disabled={!!busy}>{busy === 'keep' ? 'One moment…' : 'Yes — keep my place'}</VisitButton>
      <VisitButton quiet onClick={async () => { setBusy('leave'); const r = await post('leave'); setBusy(''); if (r.ok) setDone('left'); }} disabled={!!busy}>{busy === 'leave' ? 'One moment…' : 'No thanks — take me off'}</VisitButton>
    </VisitShell>);
}
