'use client';
// /callback/[tenantId]/[id]?k=… — "Add details before we call you back" (from the call-back confirmation).
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitLabel, brandOf } from '@/components/booking/VisitShell';

export default function CallbackDetailsPage() {
  const { tenantId, id } = useParams() as { tenantId: string; id: string };
  const k = useSearchParams().get('k') || '';
  const [info, setInfo] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [text, setText] = React.useState(''); const [busy, setBusy] = React.useState(false); const [sent, setSent] = React.useState(false);
  React.useEffect(() => {
    fetch(`/api/callbacks/details?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`)
      .then((r) => r.json()).then((d) => (d.ok ? setInfo(d) : setErr(d.error || 'This link isn’t valid any more.'))).catch(() => setErr('We couldn’t load this page — please try again.'));
  }, [tenantId, id, k]);
  const brand = brandOf({ name: info?.business, brandColor: info?.accent, logoUrl: info?.logoUrl } as any);
  const send = async () => {
    setBusy(true); setErr(null);
    const r = await fetch('/api/callbacks/details', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, id, k, text }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(false); if (r?.ok) { setSent(true); setText(''); } else setErr(r?.error || 'That didn’t send — please try again.');
  };
  if (!info) return <VisitShell brand={brand} title={err ? 'Link not found' : 'Loading…'}>{err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}</VisitShell>;
  return (
    <VisitShell brand={brand} title={<>Before we <b>get back to you</b></>} subtitle={`${info.owner || info.business} will get back to you${info.about ? ` about ${info.about}` : ''}.`}>
      {!info.open ? <VisitCard tone="ok"><p className="text-[15px]">We’ve already got back to you about this. If you need anything else, please call us.</p></VisitCard>
        : sent ? <>
          <VisitCard tone="ok"><p className="text-[15px]">Thanks{info.first ? `, ${info.first}` : ''} — we’ve added that to your request.</p></VisitCard>
          <VisitButton quiet onClick={() => setSent(false)}>Add something else</VisitButton>
        </> : <>
          <VisitCard>
            <VisitLabel>Anything that would help? (optional)</VisitLabel>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={1000}
              placeholder="e.g. the dates that suit you, how many people, or what you’d like done"
              className="w-full resize-none rounded-2xl px-4 py-3 text-[16px] outline-none" style={{ background: '#fff', border: '1px solid #e7e2dc' }} />
            <VisitMuted>Only the team helping you sees this.</VisitMuted>
          </VisitCard>
          {err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}
          <VisitButton onClick={send} disabled={busy || text.trim().length < 2}>{busy ? 'Sending…' : 'Add to my request'}</VisitButton>
        </>}
    </VisitShell>
  );
}
