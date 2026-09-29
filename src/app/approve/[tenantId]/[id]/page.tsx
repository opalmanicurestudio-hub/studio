'use client';
// /approve/[tenantId]/[id]?k=… — a manager approves or declines a request from the desk (on their phone).
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitLabel, brandOf } from '@/components/booking/VisitShell';

export default function ApprovePage() {
  const { tenantId, id } = useParams() as { tenantId: string; id: string };
  const k = useSearchParams().get('k') || '';
  const [a, setA] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false); const [done, setDone] = React.useState<string | null>(null); const [pin, setPin] = React.useState('');
  React.useEffect(() => {
    fetch(`/api/approvals?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`).then((r) => r.json())
      .then((d) => (d.ok ? setA(d) : setErr(d.error || 'This request isn’t available.'))).catch(() => setErr('We couldn’t load this — please try again.'));
  }, [tenantId, id, k]);
  const decide = async (choice: 'approve' | 'decline') => {
    setBusy(true); setErr(null);
    const r = await fetch('/api/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'decide', id, k, choice, pin }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through.'); return; }
    setDone(choice === 'approve' ? `Approved${r.by ? ` by ${r.by}` : ''} — the desk can go ahead.` : 'Declined — the desk has been told.'); setPin('');
  };
  const brand = brandOf({ name: a?.business, brandColor: a?.accent } as any);
  if (!a) return <VisitShell brand={brand} title={err ? 'Not available' : 'Loading…'}>{err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}</VisitShell>;
  return (
    <VisitShell brand={brand} title={<>Approve a request?</>} subtitle={`${a.business} · from ${a.requestedBy}`}>
      <VisitCard>
        <VisitLabel>{a.requestedBy} asks to</VisitLabel>
        <p className="text-[18px] font-semibold">{a.kind}{a.amount ? ` — $${Number(a.amount).toFixed(2)}` : ''}</p>
        {a.summary && <p className="text-[15px]">{a.summary}</p>}
        {a.reason && <p className="text-[15px]"><b>Reason:</b> {a.reason}</p>}
      </VisitCard>
      {done ? <VisitCard tone="ok"><p className="text-[15px]">{done}</p></VisitCard>
        : !a.open ? <VisitCard tone="warn"><p className="text-[15px]">This request has already been dealt with or has expired.</p></VisitCard>
        : <>{err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}
          <VisitCard><VisitLabel>Your manager PIN</VisitLabel>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" autoComplete="off" placeholder="••••" className="h-12 w-full rounded-2xl px-4 text-[20px] tracking-[0.4em] outline-none" style={{ background: '#fff', border: '1px solid #e7e2dc' }} /></VisitCard>
          <VisitButton onClick={() => decide('approve')} disabled={busy || pin.length < 4}>Approve</VisitButton>
          <VisitButton quiet onClick={() => decide('decline')} disabled={busy || pin.length < 4}>Decline</VisitButton>
          <VisitMuted>Your PIN proves it’s you. The approval is recorded in your name with the reason, and can be used once.</VisitMuted></>}
    </VisitShell>
  );
}
