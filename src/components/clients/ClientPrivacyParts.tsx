'use client';
// src/components/clients/ClientPrivacyParts.tsx — CONTACT CONFIRMATION AND HEALTH-INFORMATION VIEWS ON THE CLIENT PROFILE.
//   ContactStatus   — a pill beside the phone: Confirmed (the client entered a code sent to it), Not confirmed, or
//                     Reported wrong number (someone who got their messages said "Not you?"). "Confirm number" opens a
//                     small sheet: send a code, the client reads it back, done. Managers mark a wrong number as fixed.
//   HealthViewLog   — managers only: who opened this client's health or consent answers, and when (last 50).
import * as React from 'react';
import { format } from 'date-fns';
import { staffAuthHeader } from '@/lib/staff-fetch';

const muted = { color: 'hsl(var(--muted-foreground))' } as React.CSSProperties;
const pill = 'inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold';
const btn = 'h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50';
const ink = { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } as React.CSSProperties;
const soft = { background: 'hsl(var(--secondary))' } as React.CSSProperties;

async function call(body: any) {
  return fetch('/api/clients/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server. Please try again.' }));
}

export function ContactStatus({ tenantId, client, isManager }: { tenantId: string; client: any; isManager: boolean }) {
  const [open, setOpen] = React.useState(false); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<string | null>(null);
  if (!client?.phone && !client?.email) return null;
  const wrong = !!client.phoneReportedWrongAt; const confirmed = !wrong && !!client.phoneVerifiedAt;
  const fix = async () => {
    setBusy(true); setMsg(null); const r: any = await call({ tenantId, clientId: client.id, action: 'clear_wrong' }); setBusy(false);
    setMsg(r?.ok ? 'Marked as fixed. Please send the client a new link for any upcoming visit.' : r?.error || 'That didn’t work. Please try again.');
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {wrong ? <span className={pill} style={{ background: 'color-mix(in srgb, var(--bad, #b91c1c) 12%, transparent)', color: 'var(--bad, #b91c1c)' }} title={`Reported ${client.phoneReportedWrongVia === 'text' ? 'by text' : 'from a visit link'}`}>Reported wrong number</span>
        : confirmed ? <span className={pill} style={{ background: 'color-mix(in srgb, var(--ok, #15803d) 12%, transparent)', color: 'var(--ok, #15803d)' }} title={`Confirmed ${format(new Date(client.phoneVerifiedAt), 'MMM d, yyyy')}`}>Confirmed</span>
        : <span className={pill} style={{ ...soft, ...muted }}>Not confirmed</span>}
      {wrong && isManager && <button type="button" disabled={busy} onClick={fix} className="h-6 rounded-full border px-2.5 text-[12px] font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Number fixed'}</button>}
      {!wrong && !confirmed && client.phone && <button type="button" onClick={() => setOpen(true)} className="h-6 rounded-full border px-2.5 text-[12px] font-semibold">Confirm number</button>}
      {wrong && <span className="text-[12px]" style={muted}>Texts are paused. Check the number with the client{isManager ? ', update it, then mark it fixed' : ' and ask a manager to mark it fixed'}, and send a new link.</span>}
      {msg && <span className="text-[12px] font-semibold">{msg}</span>}
      {open && <ConfirmSheet tenantId={tenantId} client={client} onClose={() => setOpen(false)} />}
    </span>);
}

function ConfirmSheet({ tenantId, client, onClose }: { tenantId: string; client: any; onClose: () => void }) {
  const [step, setStep] = React.useState<'send' | 'code' | 'done'>('send'); const [vid, setVid] = React.useState(''); const [sentTo, setSentTo] = React.useState('');
  const [code, setCode] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  const first = String(client.name || 'the client').split(' ')[0];
  const send = async () => {
    setBusy(true); setErr(null); const r: any = await call({ tenantId, clientId: client.id, action: 'start', channel: 'sms' }); setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'We couldn’t send the code.'); return; }
    setVid(r.verificationId); setSentTo(r.sentTo || 'their phone'); setCode(''); setStep('code');
  };
  const check = async () => {
    setBusy(true); setErr(null); const r: any = await call({ tenantId, clientId: client.id, action: 'check', verificationId: vid, code }); setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That code doesn’t match.'); return; } setStep('done');
  };
  return (
    <div role="dialog" aria-label="Confirm number" className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(28,25,23,.38)' }} onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md space-y-3 rounded-t-[28px] p-5 sm:rounded-[26px]" style={{ background: 'hsl(var(--card))' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[20px] font-light">Confirm {first}’s number</h2>
        {step === 'send' && <>
          <p className="text-[14px]" style={muted}>We’ll text a 6-digit code to the number on their record. It expires in 10 minutes.</p>
          <div className="flex gap-2"><button type="button" disabled={busy} onClick={send} className={btn} style={ink}>{busy ? 'Sending…' : 'Send code'}</button><button type="button" disabled={busy} onClick={onClose} className={btn} style={soft}>Cancel</button></div>
        </>}
        {step === 'code' && <>
          <p className="text-[14px]">We sent a code to {sentTo}. Ask {first} to read you the code.</p>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" aria-label="6-digit code" placeholder="123456" autoFocus
            className="h-12 w-full rounded-2xl border px-4 text-center text-[22px] tracking-[0.4em]" style={{ borderColor: 'hsl(var(--border))' }} onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void check(); }} />
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || code.length !== 6} onClick={check} className={btn} style={ink}>{busy ? 'Checking…' : 'Confirm'}</button>
            <button type="button" disabled={busy} onClick={send} className={btn} style={soft}>Send a new code</button></div>
        </>}
        {step === 'done' && <>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--ok, #15803d)' }}>Confirmed. {first}’s number is on record as theirs.</p>
          <button type="button" onClick={onClose} className={btn} style={ink}>Done</button>
        </>}
        {err && <p className="text-[13px] font-semibold" style={{ color: 'var(--bad, #b91c1c)' }}>{err}</p>}
      </div>
    </div>);
}

export function HealthViewLog({ tenantId, clientId }: { tenantId: string; clientId: string }) {
  const [rows, setRows] = React.useState<any[] | null>(null); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { let off = false;
    (async () => { const r: any = await fetch(`/api/privacy/view-log?tenantId=${encodeURIComponent(tenantId)}&clientId=${encodeURIComponent(clientId)}`, { headers: await staffAuthHeader() }).then((x) => x.json()).catch(() => null);
      if (off) return; if (r?.ok) setRows(r.rows || []); else setErr(r?.error || 'We couldn’t load this.'); })();
    return () => { off = true; }; }, [tenantId, clientId]);
  return (
    <section className="space-y-2 rounded-[2rem] border-2 bg-card p-5 text-left">
      <h3 className="text-[15px] font-semibold">Who viewed health information</h3>
      <p className="text-[12px]" style={muted}>Each time someone opens this client’s health or consent answers, it’s recorded here. Only managers can see this list.</p>
      {err ? <p className="text-[13px]" style={muted}>{err}</p> : rows === null ? <p className="text-[13px]" style={muted}>Loading…</p>
        : rows.length === 0 ? <p className="text-[13px]" style={muted}>No views recorded yet.</p>
        : <ul className="divide-y text-[13px]">{rows.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{r.name}</b> · {r.what}</span><span style={muted}>{r.at ? format(new Date(r.at), 'MMM d, yyyy · h:mm a') : ''}</span></li>)}</ul>}
    </section>);
}
