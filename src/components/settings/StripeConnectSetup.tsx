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

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 p-4">
        <Loader className="w-4 h-4 animate-spin text-slate-400" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Checking payment status…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={cn('flex items-center gap-3 p-4 rounded-2xl border-2',
        status === 'connected' ? 'border-emerald-200 bg-emerald-50' :
        status === 'error'     ? 'border-red-200 bg-red-50' :
        'border-slate-200 bg-slate-50')}>
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          status === 'connected' ? 'bg-emerald-100' :
          status === 'error'     ? 'bg-red-100' : 'bg-slate-100')}>
          {status === 'connected' ? <Check className="w-4 h-4 text-emerald-600" /> :
           status === 'error'     ? <AlertTriangle className="w-4 h-4 text-red-500" /> :
           <CreditCard className="w-4 h-4 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-[10px] font-black uppercase tracking-widest',
            status === 'connected' ? 'text-emerald-700' :
            status === 'error'     ? 'text-red-600' : 'text-slate-600')}>
            {status === 'connected' ? 'Stripe Connected' :
             status === 'error'     ? 'Connection Failed' : 'Not Connected'}
          </p>
          <p className={cn('text-[9px] font-bold mt-0.5 break-words',
            status === 'connected' ? 'text-emerald-600' :
            status === 'error'     ? 'text-red-500' : 'text-slate-400')}>
            {status === 'connected'
              ? `Account ${accountInfo?.id?.slice(-8) || ''} · Payments enabled`
              : status === 'error'
              ? (errorMsg || 'Something went wrong — try connecting again')
              : 'Connect your Stripe account to accept ticket payments'}
          </p>
        </div>
      </div>

      {/* Not connected */}
      {status === 'not_connected' || status === 'error' ? (
        <div className="space-y-4">
          {/* Benefits */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: DollarSign,  title: 'Direct Deposits',  sub: 'Money goes straight to your bank' },
              { icon: ShieldCheck, title: 'Stripe Security',  sub: 'PCI compliant checkout' },
              { icon: Zap,         title: 'Instant Setup',    sub: 'Connect in under 2 minutes' },
            ].map(b => (
              <div key={b.title} className="text-center p-3 rounded-2xl bg-slate-50 border-2 border-slate-100 space-y-1.5">
                <b.icon className="w-5 h-5 text-slate-500 mx-auto" />
                <p className="text-[9px] font-black uppercase tracking-tight text-slate-700">{b.title}</p>
                <p className="text-[8px] font-bold text-slate-400 leading-tight">{b.sub}</p>
              </div>
            ))}
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleConnect}
            disabled={connecting}
            className="w-full h-12 rounded-2xl bg-[#635bff] text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#5851e5] disabled:opacity-60 transition-all">
            {connecting
              ? <Loader className="w-4 h-4 animate-spin" />
              : <><CreditCard className="w-4 h-4" /> Connect with Stripe <ArrowRight className="w-4 h-4" /></>}
          </motion.button>

          <div className="space-y-2 p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Before connecting</p>
            <div className="space-y-1.5">
              {[
                'You need a Stripe account (free to create at stripe.com)',
                'Enable Stripe Connect in your Stripe dashboard',
                'Add STRIPE_SECRET_KEY to your Vercel environment variables',
                'Add NEXT_PUBLIC_APP_URL to your Vercel environment variables',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] font-black text-slate-400 mt-0.5 shrink-0">{i+1}.</span>
                  <p className="text-[9px] font-bold text-slate-500">{step}</p>
                </div>
              ))}
            </div>
            <a href="https://stripe.com" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#635bff] hover:underline mt-1">
              Create Stripe account <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      ) : (
        // Connected state
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border-2 border-slate-100 space-y-3">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Connected Account</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-slate-800 font-mono">{accountInfo?.id}</p>
                <p className="text-[9px] font-bold text-slate-400 mt-0.5">Payments routed directly to your Stripe account</p>
              </div>
              <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#635bff] hover:underline shrink-0">
                Dashboard <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>

          <button onClick={handleDisconnect} disabled={disconnecting}
            className="w-full h-10 rounded-xl border-2 border-red-100 text-red-400 text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
            {disconnecting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <><X className="w-3.5 h-3.5" /> Disconnect Stripe</>}
          </button>
        </div>
      )}
    </div>
  );
}