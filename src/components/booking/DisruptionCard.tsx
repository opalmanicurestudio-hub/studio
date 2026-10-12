'use client';
// src/components/booking/DisruptionCard.tsx — "About your appointment" on the client's visit link, when a provider
// callout or a business interruption means it can't go ahead as booked. They choose: a new time (no fee), or cancel
// with no fee (deposit refunded or kept as credit, their choice). A provider callout also offers (lib/callout-choices):
// the same time with a colleague who is free, one of the provider's next times kept for them, or first in line on the
// waitlist. Before the visit (kind 'prep'): their answers mean it needs more time than there is, so they can also keep
// their time (we do what fits and book the rest).
import React, { useEffect, useState } from 'react';

type Call = (deposit: 'refund' | 'credit' | 'keep' | null, extra?: any) => Promise<any>;

export function DisruptionCard({ disruption, hasDeposit, onReschedule, onCancel }: {
  disruption: { kind: string; reasonLabel?: string | null; status?: string; hasChoices?: boolean } | null | undefined;
  hasDeposit: boolean; onReschedule?: () => void;
  onCancel: Call;
}) {
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'waitlist'>(null); const [opts, setOpts] = useState<any>(null);
  const choices = disruption?.kind === 'callout' && disruption?.status === 'pending' && !!disruption?.hasChoices;
  useEffect(() => { if (!choices) return; let live = true;
    void onCancel(null, { action: 'disruption_options' }).then((r) => { if (live && r?.ok) setOpts(r); }).catch(() => {});
    return () => { live = false; }; }, [choices]); // eslint-disable-line react-hooks/exhaustive-deps
  if (msg) return <section className="pub-card p-5" aria-live="polite"><p className="text-[15px]">{msg}</p></section>;
  if (!disruption || disruption.status !== 'pending') return null;
  const btn = 'inline-flex min-h-12 w-full flex-col items-center justify-center rounded-full px-6 py-2 text-[15px] transition active:scale-[.98] disabled:opacity-60';
  const quiet = `${btn} bg-white shadow-sm`; const line = { border: '1px solid #e7e2dc' };
  const why = disruption.reasonLabel || (disruption.kind === 'callout' ? "your provider can't make it" : 'the studio has had to close unexpectedly');
  const whyLower = /^(Your|The|For|Because)\b/.test(why) ? why.charAt(0).toLowerCase() + why.slice(1) : why;   // never lowercase a name
  const run = async (key: string, f: () => Promise<any>, ok: (d: any) => string) => { setBusy(key); setErr(null); const d = await f().catch(() => null); setBusy(null);
    if (d?.ok) setMsg(ok(d)); else setErr(d?.error || "That didn't go through. Please try again, or give us a call."); };
  const depLine = (d: any) => (d.deposit === 'refund' ? " We'll refund your deposit to your card." : d.deposit === 'credit' ? " We've saved your deposit as credit for your next visit." : '');
  const go = (dep: 'refund' | 'credit' | 'keep' | null, lineUp = false) => run(lineUp ? 'waitlist' : dep || 'cancel', () => onCancel(dep, lineUp ? { choice: 'waitlist' } : undefined), (d) =>
    dep === 'keep' ? "Thank you. We'll keep your time, do everything that fits, and book the rest for you."
      : lineUp ? `Thank you. Your appointment has been cancelled with no fee, and you're now first in line for ${opts?.provider || 'your provider'}. We'll be in touch as soon as a suitable time opens up.${depLine(d)}`
        : `You're all cancelled, and there's no fee.${depLine(d)} We hope to see you again soon.`);
  const depositChoice = (lineUp: boolean) => hasDeposit ? <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={!!busy} className={quiet} style={line} onClick={() => go('refund', lineUp)}>{busy ? 'One moment…' : 'Refund my deposit'}</button>
      <button type="button" disabled={!!busy} className={quiet} style={line} onClick={() => go('credit', lineUp)}>{busy ? 'One moment…' : 'Keep it as credit'}</button></div>
    : <button type="button" disabled={!!busy} className={quiet} style={line} onClick={() => go(null, lineUp)}>{busy ? 'One moment…' : lineUp ? 'Yes, cancel and put me first in line' : 'Yes, cancel my appointment'}</button>;
  return (
    <section className="pub-card space-y-3 p-5" style={{ boxShadow: 'inset 0 0 0 2px var(--accent)' }} aria-live="polite">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>About your appointment</p>
      {disruption.kind === 'prep' ? <p className="text-[15px]">Thank you for your answers. As {whyLower}, we aren&apos;t able to fit everything into your appointment as booked. Please choose whichever option suits you best:</p>
        : <p className="text-[15px]">We&apos;re sorry to let you know that {whyLower}, so we can&apos;t go ahead with your appointment as booked. We know this is disappointing. Please choose whichever option suits you best. There&apos;s no fee for any of them.</p>}
      {opts?.chooseBy && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>It would be a great help if you could choose by {opts.chooseBy}. If we haven&apos;t heard from you by then, we&apos;ll give you a call.</p>}
      {(opts?.others || []).map((o: any) => <button key={o.staffId} type="button" disabled={!!busy} className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }}
        onClick={() => run(`s:${o.staffId}`, () => onCancel(null, { action: 'disruption_switch', staffId: o.staffId }), (d) => `Thank you. Your appointment on ${d.when} will now be with ${d.staffName}, at the price you booked. We're looking forward to seeing you.`)}>
        <span>{busy === `s:${o.staffId}` ? 'Booking…' : `Keep my time with ${o.name}`}</span><span className="text-[12.5px] font-normal opacity-90">Same time, same price</span></button>)}
      {(opts?.kept || []).length > 0 && <div className="space-y-2">
        <p className="text-[13px] font-semibold">Another time with {opts.provider}, kept for you</p>
        {opts.kept.map((k: any) => <button key={k.id} type="button" disabled={!!busy} className={quiet} style={line}
          onClick={() => run(`k:${k.id}`, () => onCancel(null, { action: 'disruption_take_time', keptId: k.id }), (d) => `Thank you. Your appointment is now booked for ${d.when}. We've sent you a confirmation, and we're looking forward to seeing you.`)}>
          {busy === `k:${k.id}` ? 'Booking…' : k.when}</button>)}
      </div>}
      {onReschedule && <button type="button" className={opts?.others?.length || opts?.kept?.length ? quiet : `${btn} font-semibold text-white`} style={opts?.others?.length || opts?.kept?.length ? line : { background: 'var(--accent)' }} onClick={onReschedule}>Choose a different time (no fee)</button>}
      {disruption.kind === 'prep' && !confirm && <button type="button" disabled={!!busy} className={quiet} style={line} onClick={() => go('keep')}>{busy === 'keep' ? 'Saving…' : 'Keep my time and do what fits'}</button>}
      {choices && confirm !== 'cancel' && (confirm === 'waitlist' ? <div className="space-y-2">
          <p className="text-[14px]">Your current appointment will be cancelled with no fee, and you&apos;ll be the first to hear when a suitable time with {opts?.provider || 'your provider'} opens up.</p>{depositChoice(true)}</div>
        : <button type="button" className="w-full text-center text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }} onClick={() => setConfirm('waitlist')}>Put me first in line for {opts?.provider || 'my provider'} instead</button>)}
      {confirm !== 'waitlist' && (confirm !== 'cancel'
        ? <button type="button" className="w-full text-center text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }} onClick={() => setConfirm('cancel')}>Cancel my appointment (no fee)</button>
        : depositChoice(false))}
      {err && <p className="text-[14px]" style={{ color: '#b45309' }}>{err}</p>}
    </section>
  );
}
