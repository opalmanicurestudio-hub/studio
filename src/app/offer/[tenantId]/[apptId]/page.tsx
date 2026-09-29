'use client';
// /offer/[tenantId]/[apptId]?k=… — a provider is asked to take a client (from the front desk). Accept or decline.
// Opened from their text / notification; the private key is the proof — no sign-in needed.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, brandOf } from '@/components/booking/VisitShell';

export default function ProviderOfferPage() {
  const { tenantId, apptId } = useParams() as { tenantId: string; apptId: string };
  const k = useSearchParams().get('k') || '';
  const [o, setO] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); const [done, setDone] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch(`/api/appointments/provider-offer?tenantId=${encodeURIComponent(tenantId)}&apptId=${encodeURIComponent(apptId)}&k=${encodeURIComponent(k)}`)
      .then((r) => r.json()).then((d) => (d.ok ? setO(d) : setErr(d.error || 'This offer isn’t open any more.'))).catch(() => setErr('We couldn’t load this offer — please try again.'));
  }, [tenantId, apptId, k]);
  const brand = brandOf({ name: o?.business, brandColor: o?.accent } as any);
  const reply = async (choice: 'accept' | 'decline') => {
    setBusy(choice); setErr(null);
    const r = await fetch('/api/appointments/provider-offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: apptId, action: 'provider_reply', k, choice }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through — please try again.'); return; }
    setDone(choice === 'accept' ? `Thanks — ${o.client} is being asked now. If they say yes, it’s in your book; if not, nothing changes.` : 'No problem — thanks for letting us know. It’s been passed on.');
  };
  if (!o) return <VisitShell brand={brand} title={err ? 'Offer closed' : 'Loading…'}>{err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}</VisitShell>;
  const tz = o.timezone || undefined;
  const when = o.startAt ? new Date(o.startAt).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  const by = o.answerBy ? new Date(o.answerBy).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  return (
    <VisitShell brand={brand} title={<>Can you take <b>{o.client}</b>?</>} subtitle={`${o.business} is asking.`}>
      <VisitCard>
        <p className="text-[17px] font-semibold">{o.service}</p>
        <p className="text-[15px]">{when}{o.minutes ? ` · ${o.minutes} min` : ''}{o.price ? ` · $${Number(o.price).toFixed(0)}` : ''}</p>
        {o.open && by && <VisitMuted>Please answer by {by}. If there’s no answer, it goes to someone else.</VisitMuted>}
      </VisitCard>
      {done ? <VisitCard tone="ok"><p className="text-[15px]">{done}</p></VisitCard>
        : !o.open ? <VisitCard tone="warn"><p className="text-[15px]">This offer isn’t open any more.</p></VisitCard>
        : <>
          {err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}
          <VisitButton onClick={() => reply('accept')} disabled={!!busy}>{busy === 'accept' ? 'Accepting…' : 'Accept'}</VisitButton>
          <VisitButton quiet onClick={() => reply('decline')} disabled={!!busy}>{busy === 'decline' ? 'Declining…' : 'Decline'}</VisitButton>
          <VisitMuted>Declining is never held against you. {o.client} only hears about the change if you accept — and they still choose.</VisitMuted>
        </>}
    </VisitShell>
  );
}
