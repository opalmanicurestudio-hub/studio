'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Check, ExternalLink, Loader, CreditCard } from 'lucide-react';
import { staffAuthHeader } from '@/lib/staff-fetch';

// Settings › Payments: the business connects its own Stripe account. What the card says follows what Stripe says:
// "on" only once Stripe has switched card payments on, and "finish setting up" when the owner left part way through.
type Status = 'loading' | 'not_connected' | 'incomplete' | 'connected';

type Props = {
  tenantId: string;
  stripeAccountId?: string | null;
  chargesEnabled?: boolean | null;
  detailsSubmitted?: boolean | null;
  onDisconnect?: () => Promise<void>;
};

// Unfinished only when Stripe has said card payments are off. A business connected before this was recorded (no flag
// yet) counts as connected until Stripe says otherwise; the card asks Stripe once to make sure.
const statusOf = (hasAccount: boolean, charges: boolean | null | undefined): Status => !hasAccount ? 'not_connected' : charges === false ? 'incomplete' : 'connected';
// Opened from Set up your business (?setup=payments): Stripe sends the owner back with it, so the setup bar is still there.
const setupStep = () => { try { const v = new URLSearchParams(window.location.search).get('setup') || ''; return /^[a-z]{1,20}$/.test(v) ? v : ''; } catch { return ''; } };

export function StripeConnectSetup({ tenantId, stripeAccountId, chargesEnabled, detailsSubmitted, onDisconnect }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<boolean | null>(null);
  const asked = useRef('');
  const pendingRefresh = useRef(false);

  const call = async (action: 'start' | 'refresh') => {
    const r = await fetch('/api/stripe/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, action, setup: setupStep() }) });
    return (await r.json().catch(() => null)) || { ok: false, error: 'Stripe didn’t answer. Please try again in a minute.' };
  };

  // Ask Stripe once how setup stands: on the way back from Stripe, and whenever setup looks unfinished (so the card is
  // right even before Stripe's own notice arrives).
  const refresh = async (sayIfFails: boolean) => {
    const d = await call('refresh');
    if (d?.ok) { setStatus(statusOf(!!d.hasAccount, d.chargesEnabled)); setSent(!!d.detailsSubmitted); }
    else { setStatus(statusOf(!!stripeAccountId, chargesEnabled)); if (sayIfFails && d?.error) setErr(d.error); }
  };

  const start = async () => {
    setBusy(true); setErr('');
    const d = await call('start');
    if (d?.ok && d.url) { window.location.href = d.url; return; }
    setErr(d?.error || 'Stripe didn’t answer. Please try again in a minute.'); setBusy(false);
  };

  useEffect(() => {
    if (!tenantId) return;
    const params = new URLSearchParams(window.location.search);
    const back = params.get('stripe');
    if (back) {
      params.delete('stripe'); params.delete('reason');
      const rest = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    }
    if (back === 'error') setErr('That didn’t connect. Please try again.');
    // Stripe's setup link expired part way through: carry straight on for the signed-in owner, once the business has
    // loaded and only if its setup really is unfinished.
    if (back === 'refresh') pendingRefresh.current = true;
    if (pendingRefresh.current && stripeAccountId) {
      pendingRefresh.current = false;
      if (chargesEnabled !== true) { asked.current = `${tenantId}:refresh`; setStatus(statusOf(true, chargesEnabled)); void start(); return; }
    }
    const key = `${tenantId}:${stripeAccountId || ''}:${back || ''}:${String(chargesEnabled)}`;
    if (asked.current === key) return;
    asked.current = key;
    if (back === 'connected' || (stripeAccountId && chargesEnabled !== true)) { void refresh(back === 'connected'); return; }
    setStatus(statusOf(!!stripeAccountId, chargesEnabled));
    setSent(detailsSubmitted ?? null);
  }, [tenantId, stripeAccountId, chargesEnabled]); // eslint-disable-line react-hooks/exhaustive-deps


  const confirmDisconnect = async () => {
    if (!onDisconnect) return;
    if (!window.confirm('Disconnect Stripe?\n\nClients won’t be able to pay deposits or bills by card, and payouts stop, until you connect again.')) return;
    setDisconnecting(true);
    try { await onDisconnect(); setStatus('not_connected'); } catch { setErr('That didn’t disconnect. Please try again.'); }
    finally { setDisconnecting(false); }
  };

  const errorLine = err ? <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: 'color-mix(in srgb, #b45309 10%, var(--card))', color: 'var(--warn-ink)' }}>{err}</p> : null;

  if (status === 'loading') return <p className="flex items-center gap-2 text-[14px] cf-muted"><Loader className="h-4 w-4 animate-spin" aria-hidden /> Checking your payments…</p>;

  if (status === 'connected') return (
    <div className="space-y-4">
      {errorLine}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, #16a34a 14%, transparent)' }}><Check className="h-4 w-4" style={{ color: 'var(--ok-ink)' }} aria-hidden /></span>
        <div><p className="text-[15px] font-medium">Connected to Stripe</p><p className="text-[13.5px] cf-muted">Card payments are on. Money goes straight to your bank.</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium" style={{ background: 'var(--soft)', color: 'var(--ink)' }}>Open your Stripe dashboard <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
        {onDisconnect && <button type="button" onClick={confirmDisconnect} disabled={disconnecting} className="min-h-[44px] text-[13.5px] underline underline-offset-4 cf-muted disabled:opacity-50">{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>}
      </div>
    </div>
  );

  if (status === 'incomplete') return (
    <div className="space-y-4">
      {errorLine}
      <div className="rounded-xl px-4 py-3" style={{ background: 'color-mix(in srgb, #b45309 10%, var(--card))' }}>
        <p className="text-[15px] font-medium" style={{ color: 'var(--warn-ink)' }}>Stripe setup isn’t finished</p>
        <p className="mt-1 text-[13.5px]" style={{ color: 'var(--warn-ink)' }}>{sent ? 'Stripe is checking your details. Card payments switch on as soon as it’s done, and this updates by itself.' : 'Stripe still needs a few details before clients can pay you by card.'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={start} disabled={busy} className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}>
          {busy ? <Loader className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}{sent ? 'Open Stripe setup' : 'Finish setting up'}
        </button>
        <button type="button" onClick={() => { setStatus('loading'); void refresh(true); }} className="min-h-[44px] text-[13.5px] underline underline-offset-4 cf-muted">Check again</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {errorLine}
      <p className="text-[15px]">Take deposits and card payments, with the money paid straight to your bank. Stripe handles the card details securely. It takes about 5 minutes.</p>
      <button type="button" onClick={start} disabled={busy} className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}>
        {busy ? <Loader className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}Connect payments
      </button>
      <p className="text-[13px] cf-muted">No Stripe account yet? You’ll create one as part of connecting. It’s free.</p>
    </div>
  );
}
