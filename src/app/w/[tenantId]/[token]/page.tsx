'use client';
// src/app/w/[tenantId]/[token]/page.tsx — THE LINK IN A WAITLIST TEXT (design canvas Op11). What's on offer, and one
// tap to take it: first tap wins, booked there and then (or their own visit moved up). "Not this one" keeps their
// place. If someone got there first, they hear it straight away — before any card is touched. /api/waitlist/offer.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, brandOf } from '@/components/booking/VisitShell';

export default function WaitlistOffer() {
  const { tenantId, token } = useParams() as { tenantId: string; token: string };
  const [v, setV] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [res, setRes] = React.useState<any>(null);
  const post = (action: string) => fetch('/api/waitlist/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
  React.useEffect(() => { post('view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  const left = v?.holdUntil ? Math.max(0, Math.round((Date.parse(v.holdUntil) - Date.now()) / 60000)) : null;
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard>{brand.bookHref && <VisitButton href={brand.bookHref} quiet>See open times</VisitButton>}</VisitShell>;
  const done = res?.ok || v.state === 'yours';
  if (done) return <VisitShell brand={brand} title={<>You’re <b>booked</b></>} subtitle={`${v.when} with ${v.staffName}`}>
    <VisitCard tone="ok"><p className="text-[18px] font-semibold">{v.service}</p><VisitMuted>{res?.sooner || v.sooner ? 'Your visit has moved to this earlier time — everything else stays the same.' : 'You’ll get a text to confirm.'}</VisitMuted></VisitCard>
    {(res?.payUrl || v.payUrl) && <VisitButton href={res?.payUrl || v.payUrl}>Pay the deposit to confirm</VisitButton>}</VisitShell>;
  const gone = (res && !res.ok && res.taken) || v.state === 'taken';
  if (gone) return <VisitShell brand={brand} title="Someone just took it" subtitle="Sorry! You’re still on the list.">
    <VisitCard><VisitMuted>You’ll hear about the next one that fits — first.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'gone') return <VisitShell brand={brand} title="This time has passed"><VisitCard><VisitMuted>You’re still on the list for the next one.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'passed' || res?.passed) return <VisitShell brand={brand} title="No problem" subtitle="You keep your place on the list."><VisitCard><VisitMuted>We’ll text you about the next time that fits.</VisitMuted></VisitCard></VisitShell>;
  return (
    <VisitShell brand={brand} title={v.sooner ? <>A <b>sooner</b> time opened</> : <>It’s <b>still open</b></>} subtitle={v.state === 'held_for_other' ? 'It’s being held for someone else right now — you’re still on the list.' : v.mode === 'one' && left !== null ? `Held for you for ${left} more minute${left === 1 ? '' : 's'}.` : 'Whoever taps first gets it.'}>
      <VisitCard>
        <p className="text-[22px] font-semibold leading-tight">{v.when}</p>
        <VisitMuted>{v.service} with {v.staffName} · {v.minutes} min{v.price ? ` · ${v.price}` : ''}</VisitMuted>
        {v.sooner && <VisitMuted>Your visit moves to this time. If you’d rather not, your time stays just as it is.</VisitMuted>}
      </VisitCard>
      {res && !res.ok && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{res.error}</p>}
      {v.state !== 'held_for_other' && <VisitButton onClick={async () => { setBusy('take'); const r = await post('take'); setBusy(''); setRes(r); }} disabled={!!busy}>{busy === 'take' ? 'Booking…' : v.sooner ? 'Move me to this time' : 'Take it'}</VisitButton>}
      <VisitButton quiet onClick={async () => { setBusy('pass'); const r = await post('pass'); setBusy(''); setRes(r.ok ? { passed: true } : r); }} disabled={!!busy}>Not this one — keep my place</VisitButton>
    </VisitShell>);
}
