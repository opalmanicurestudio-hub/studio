'use client';
// /msg/[tenantId]/[id]?k=… — a message or call passed on by the front desk. Got it · Reply · Hand back.
// Opened from the recipient's text / notification; the private key is the proof — no sign-in needed.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VisitShell, VisitCard, VisitButton, VisitMuted, VisitLabel, brandOf } from '@/components/booking/VisitShell';

export default function DeskMessagePage() {
  const { tenantId, id } = useParams() as { tenantId: string; id: string };
  const k = useSearchParams().get('k') || '';
  const [m, setM] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'none' | 'reply' | 'handback'>('none'); const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [done, setDone] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch(`/api/calls?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`)
      .then((r) => r.json()).then((d) => (d.ok ? setM(d) : setErr(d.error || 'This message isn’t available.'))).catch(() => setErr('We couldn’t load this — please try again.'));
  }, [tenantId, id, k]);
  const brand = brandOf({ name: m?.business, brandColor: m?.accent } as any);
  const send = async (action: 'ack' | 'reply' | 'handback') => {
    setBusy(true); setErr(null);
    const r = await fetch('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, id, k, action, text }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through — please try again.'); return; }
    setDone(action === 'ack' ? 'Thanks — the front desk can see you’ve got it.' : action === 'reply' ? 'Sent — the front desk has your reply.' : 'Handed back — the front desk will pick it up.'); setMode('none'); setText('');
  };
  if (!m) return <VisitShell brand={brand} title={err ? 'Not available' : 'Loading…'}>{err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}</VisitShell>;
  const tz = m.timezone || undefined;
  const due = m.dueAt ? new Date(m.dueAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }) : null;
  return (
    <VisitShell brand={brand} title={m.urgent ? <><b>Urgent</b> — from the front desk</> : <>A message from the <b>front desk</b></>} subtitle={m.loggedBy ? `Passed on by ${m.loggedBy}` : undefined}>
      <VisitCard tone={m.urgent ? 'warn' : undefined}>
        <VisitLabel>{m.callerName}{m.reason ? ` · ${m.reason}` : ''}</VisitLabel>
        <p className="whitespace-pre-wrap text-[16px]">{m.summary}</p>
        {m.ask && <p className="text-[15px]"><b>Please:</b> {m.ask}{due ? ` — by ${due}` : ''}</p>}
        {m.callerPhone && <VisitMuted>Their number: <a className="underline" href={`tel:${String(m.callerPhone).replace(/[^\d+]/g, '')}`}>{m.callerPhone}</a></VisitMuted>}
      </VisitCard>
      {done ? <VisitCard tone="ok"><p className="text-[15px]">{done}</p></VisitCard>
        : !m.open ? <VisitCard><p className="text-[15px]">This has already been dealt with.</p></VisitCard>
        : <>
          {err && <VisitCard tone="warn"><p className="text-[15px]">{err}</p></VisitCard>}
          {mode === 'none' ? <>
            <VisitButton onClick={() => send('ack')} disabled={busy}>{m.ackedAt ? 'Got it (again)' : 'Got it'}</VisitButton>
            <VisitButton quiet onClick={() => setMode('reply')}>Reply to the front desk</VisitButton>
            <VisitButton quiet onClick={() => setMode('handback')}>Hand it back</VisitButton>
          </> : <VisitCard>
            <VisitLabel>{mode === 'reply' ? 'Your reply' : 'Why are you handing it back?'}</VisitLabel>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={500} className="w-full resize-none rounded-2xl px-4 py-3 text-[16px] outline-none" style={{ background: '#fff', border: '1px solid #e7e2dc' }}
              placeholder={mode === 'reply' ? 'e.g. Yes, I can start 15 minutes later.' : 'e.g. I’m off today — can someone else call them?'} />
            <VisitButton onClick={() => send(mode)} disabled={busy || !text.trim()}>{busy ? 'Sending…' : mode === 'reply' ? 'Send reply' : 'Hand it back'}</VisitButton>
            <VisitButton quiet onClick={() => { setMode('none'); setText(''); }}>Back</VisitButton>
          </VisitCard>}
        </>}
    </VisitShell>
  );
}
