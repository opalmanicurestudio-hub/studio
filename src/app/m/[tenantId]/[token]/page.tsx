'use client';
// src/app/m/[tenantId]/[token]/page.tsx — "COULD YOU COME EARLIER?" (design canvas TD1). A provider is tidying their
// day and asked this client to move up (or, for a light day, to another day). One tap yes, or keep their time. Their
// time stays theirs until everyone asked has said yes — then it's confirmed by text. Never names anyone else.
// /api/tidy/answer, lib/tidy-server.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, brandOf } from '@/components/booking/VisitShell';

export default function ComeEarlier() {
  const { tenantId, token } = useParams() as { tenantId: string; token: string };
  const [v, setV] = React.useState<any>(null); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const post = (action: string) => fetch('/api/tidy/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We could not connect. Please check your connection and try again.' }));
  React.useEffect(() => { post('view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard></VisitShell>;
  const toWhen = v.sameDay ? `${v.day === 'today' ? 'Today' : v.day} at ${v.to}` : v.to; const fromWhen = v.sameDay ? v.from : v.from;
  const answer = async (a: 'yes' | 'keep') => { setBusy(a); setErr(''); const r = await post(a); setBusy(''); if (r.ok) setV({ ...v, state: r.state }); else setErr(r.error || 'Something went wrong. Please try again.'); };
  if (v.state === 'moved') return <VisitShell brand={brand} title={<>Your appointment is <b>confirmed</b></>} subtitle={`We look forward to seeing you ${v.sameDay ? `at ${v.to}` : v.to}.`}><VisitCard tone="ok"><p className="text-[18px] font-semibold">{v.service}</p><VisitMuted>Everything else stays the same. Thank you for being so flexible.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'yes') return <VisitShell brand={brand} title={<>Thank <b>you</b></>} subtitle="We will confirm by text in a few minutes."><VisitCard><VisitMuted>Until then, your {fromWhen} appointment remains yours. We will only move it once everything is confirmed.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'kept' || v.state === 'no') return <VisitShell brand={brand} title="Thank you for letting us know" subtitle={`Your ${fromWhen} appointment will stay exactly as it is.`}><VisitCard><VisitMuted>We look forward to seeing you then.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'nochange' || v.state === 'done') return <VisitShell brand={brand} title="No change is needed" subtitle={`Your ${fromWhen} appointment will stay exactly as it is.`}><VisitCard><VisitMuted>Thank you for your response. We look forward to seeing you then.</VisitMuted></VisitCard></VisitShell>;
  return (
    <VisitShell brand={brand} title={v.sameDay ? <>Could you come <b>earlier</b>?</> : <>Could you <b>switch days</b>?</>} subtitle={v.provider ? `${v.provider} has an opening that may suit you. Please accept only if it works for you.` : 'Please accept only if it works for you.'}>
      <VisitCard>
        <p className="text-[22px] font-semibold leading-tight">{toWhen}</p>
        <VisitMuted>instead of {fromWhen} · {v.service || 'your visit'}{v.minutes ? ` · ${v.minutes} min` : ''}</VisitMuted>
        <VisitMuted>The price and everything else will stay the same.</VisitMuted>
      </VisitCard>
      {err && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
      <VisitButton onClick={() => answer('yes')} disabled={!!busy}>{busy === 'yes' ? 'One moment…' : `Yes, ${v.sameDay ? v.to : 'that time'} works for me`}</VisitButton>
      <VisitButton quiet onClick={() => answer('keep')} disabled={!!busy}>{busy === 'keep' ? 'One moment…' : `Keep my ${fromWhen}`}</VisitButton>
      <VisitMuted>Your {fromWhen} appointment remains yours until we confirm the change.</VisitMuted>
    </VisitShell>);
}
