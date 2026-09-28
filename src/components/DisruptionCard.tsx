'use client';
// src/components/booking/DisruptionCard.tsx — "About your appointment" on the
// client's visit link, when a provider callout or a business interruption means
// it can't go ahead as booked. They choose: a new time (no fee), or cancel with
// no fee — deposit refunded or kept as credit, their choice.
import React, { useState } from 'react';

export function DisruptionCard({ disruption, hasDeposit, onReschedule, onCancel }: {
  disruption: { kind: string; reasonLabel?: string | null; status?: string } | null | undefined;
  hasDeposit: boolean; onReschedule?: () => void;
  onCancel: (deposit: 'refund' | 'credit' | null) => Promise<any>;
}) {
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [confirm, setConfirm] = useState(false);
  // Their answer shows straight away (the live booking update follows a moment later).
  if (msg) return <section className="pub-card p-5" aria-live="polite"><p className="text-[15px]">{msg}</p></section>;
  if (!disruption || disruption.status !== 'pending') return null;
  const btn = 'inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] transition active:scale-[.98] disabled:opacity-60';
  const why = disruption.reasonLabel || (disruption.kind === 'callout' ? 'Your provider is unexpectedly unavailable' : 'the studio has had to close unexpectedly');
  const go = async (dep: 'refund' | 'credit' | null) => { setBusy(dep || 'cancel'); const d = await onCancel(dep); setBusy(null);
    setMsg(d?.ok ? `Cancelled — no fee.${d.deposit === 'refund' ? ' Your deposit will be refunded.' : d.deposit === 'credit' ? ' Your deposit is saved as credit for next time.' : ''}` : d?.error || 'That didn’t go through — please try again.'); };
  return (
    <section className="pub-card space-y-3 p-5" style={{ boxShadow: 'inset 0 0 0 2px var(--accent)' }} aria-live="polite">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>About your appointment</p>
      <p className="text-[15px]">We’re sorry — {disruption.kind === 'callout' ? `${why}, so` : `${why},`} we can’t go ahead as booked. Choose what works for you:</p>
      {onReschedule && <button type="button" className={`${btn} font-semibold text-white`} style={{ background: 'var(--accent)' }} onClick={onReschedule}>Pick a new time — no fee</button>}
      {!confirm ? <button type="button" className="w-full text-center text-[14px] underline underline-offset-2" style={{ color: 'var(--muted)' }} onClick={() => setConfirm(true)}>Cancel instead — no fee</button>
        : hasDeposit ? <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!!busy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={() => go('refund')}>{busy === 'refund' ? 'Cancelling…' : 'Refund my deposit'}</button>
            <button type="button" disabled={!!busy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={() => go('credit')}>{busy === 'credit' ? 'Cancelling…' : 'Keep it as credit'}</button></div>
        : <button type="button" disabled={!!busy} className={`${btn} bg-white shadow-sm`} style={{ border: '1px solid #e7e2dc' }} onClick={() => go(null)}>{busy ? 'Cancelling…' : 'Yes, cancel it (no fee)'}</button>}
    </section>
  );
}
