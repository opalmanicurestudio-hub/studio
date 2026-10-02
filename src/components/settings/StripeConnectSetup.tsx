'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  CreditCard, Check, ExternalLink, AlertTriangle, Loader,
  ShieldCheck, Zap, DollarSign, ArrowRight, X,
} from 'lucide-react';

// ─── TYPES ────────────────────────────────────────────────────────────────────
type ConnectStatus = 'loading' | 'not_connected' | 'connected' | 'error';

type Props = {
  tenantId:        string;
  stripeAccountId?: string | null;
  onDisconnect?:   () => Promise<void>;
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export function StripeConnectSetup({ tenantId, stripeAccountId, onDisconnect }: Props) {
  const [status,      setStatus]      = useState<ConnectStatus>('loading');
  const [connecting,  setConnecting]  = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  useEffect(() => {
    // Check URL params for connect callback result
    const params = new URLSearchParams(window.location.search);
    const stripeParam = params.get('stripe');
    if (stripeParam === 'connected') {
      setStatus('connected');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (stripeParam === 'error') {
      const reason = params.get('reason');
      if (reason) {
        try { setErrorMsg(decodeURIComponent(reason)); } catch { setErrorMsg(reason); }
      }
      setStatus('error');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (stripeAccountId) {
      setStatus('connected');
      setAccountInfo({ id: stripeAccountId });
    } else {
      setStatus('not_connected');
    }
  }, [stripeAccountId]);

  const handleConnect = () => {
    setConnecting(true);
    // Redirect to the Stripe Connect onboarding flow (Express + Account Links)
    window.location.href = `/api/stripe/connect?tenantId=${tenantId}`;
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;
    setDisconnecting(true);
    try { await onDisconnect(); setStatus('not_connected'); setAccountInfo(null); }
    finally { setDisconnecting(false); }
  };

  // ── What owners see (Studio look) — plain words, one obvious action, and nothing that can be undone by accident ──
  const confirmDisconnect = () => { if (window.confirm('Disconnect Stripe?\n\nClients won’t be able to pay deposits or bills by card, and payouts stop, until you connect again.')) void handleDisconnect(); };
  if (status === 'loading') return <p className="flex items-center gap-2 text-[14px] cf-muted"><Loader className="h-4 w-4 animate-spin" /> Checking your payments…</p>;
  if (status === 'connected') return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, #16a34a 14%, transparent)' }}><Check className="h-4 w-4" style={{ color: '#15803d' }} /></span>
        <div><p className="text-[15px] font-medium">Connected to Stripe</p><p className="text-[13.5px] cf-muted">Card payments and payouts are on. Money goes straight to your bank.</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium" style={{ background: 'var(--soft)', color: 'var(--ink)' }}>Open your Stripe dashboard <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
        {onDisconnect && <button type="button" onClick={confirmDisconnect} disabled={disconnecting} className="text-[13.5px] underline underline-offset-4 cf-muted disabled:opacity-50">{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      {status === 'error' && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: 'color-mix(in srgb, #dc2626 9%, var(--card))', color: '#991b1b' }}>That didn’t connect{errorMsg ? ` — ${errorMsg}` : ''}. Try again; if it keeps happening, contact support from the Help button.</p>}
      <p className="text-[15px]">Take deposits and card payments, with the money paid straight to your bank. Stripe handles the card details securely. It takes about 5 minutes.</p>
      <button type="button" onClick={handleConnect} disabled={connecting} className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}>
        {connecting ? <Loader className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" aria-hidden />}{status === 'error' ? 'Try again' : 'Connect payments'}
      </button>
      <p className="text-[13px] cf-muted">No Stripe account yet? You’ll create one as part of connecting — it’s free.</p>
    </div>
  );
}
