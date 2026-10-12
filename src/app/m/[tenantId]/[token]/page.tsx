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
  const post = (action: string) => fetch('/api/tidy/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, token, action }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' }));
  React.useEffect(() => { post('view').then(setV); }, [tenantId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = brandOf(v?.business ? { name: v.business } : null, tenantId);
  if (!v) return <VisitShell brand={brand} title="One moment…" />;
  if (!v.ok) return <VisitShell brand={brand} title="This link has expired"><VisitCard><VisitMuted>{v.error}</VisitMuted></VisitCard></VisitShell>;
  const toWhen = v.sameDay ? `${v.day === 'today' ? 'Today' : v.day} at ${v.to}` : v.to; const fromWhen = v.sameDay ? v.from : v.from;
  const answer = async (a: 'yes' | 'keep') => { setBusy(a); setErr(''); const r = await post(a); setBusy(''); if (r.ok) setV({ ...v, state: r.state }); else setErr(r.error || 'That didn’t work — try again.'); };
  if (v.state === 'moved') return <VisitShell brand={brand} title={<>You’re <b>all set</b></>} subtitle={`See you ${v.sameDay ? `at ${v.to}` : v.to}.`}><VisitCard tone="ok"><p className="text-[18px] font-semibold">{v.service}</p><VisitMuted>Everything else stays the same. Thank you!</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'yes') return <VisitShell brand={brand} title={<>Thank <b>you</b>!</>} subtitle="We’ll confirm by text in a few minutes."><VisitCard><VisitMuted>Until then your {fromWhen} stays yours — we’ll only move you once it’s all confirmed.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'kept' || v.state === 'no') return <VisitShell brand={brand} title="No problem" subtitle={`Your ${fromWhen} stays just as it is.`}><VisitCard><VisitMuted>Thanks for letting us know — see you then.</VisitMuted></VisitCard></VisitShell>;
  if (v.state === 'nochange' || v.state === 'done') return <VisitShell brand={brand} title="Nothing to change" subtitle={`Your ${fromWhen} stays just as it is.`}><VisitCard><VisitMuted>Thanks anyway — see you then.</VisitMuted></VisitCard></VisitShell>;
  return (
    <VisitShell brand={brand} title={v.sameDay ? <>Could you come <b>earlier</b>?</> : <>Could you <b>switch days</b>?</>} subtitle={v.provider ? `${v.provider} has a spot that suits you — only if it works for you.` : 'Only if it works for you.'}>
      <VisitCard>
        <p className="text-[22px] font-semibold leading-tight">{toWhen}</p>
        <VisitMuted>instead of {fromWhen} · {v.service || 'your visit'}{v.minutes ? ` · ${v.minutes} min` : ''}</VisitMuted>
        <VisitMuted>Same price, same everything else.</VisitMuted>
      </VisitCard>
      {err && <p className="px-1 text-[14px] font-semibold" style={{ color: '#b42318' }}>{err}</p>}
      <VisitButton onClick={() => answer('yes')} disabled={!!busy}>{busy === 'yes' ? 'One moment…' : `Yes — ${v.sameDay ? v.to : 'that'} works`}</VisitButton>
      <VisitButton quiet onClick={() => answer('keep')} disabled={!!busy}>{busy === 'keep' ? 'One moment…' : `Keep my ${fromWhen}`}</VisitButton>
      <VisitMuted>Your {fromWhen} stays yours until we confirm.</VisitMuted>
    </VisitShell>);
}
