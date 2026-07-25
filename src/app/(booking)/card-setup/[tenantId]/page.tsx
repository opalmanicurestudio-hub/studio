'use client';

// src/app/(booking)/card-setup/[tenantId]/page.tsx
//
// PUBLIC confirmation screen for renter card setup. Renters open the
// Stripe hosted card page from a link the owner texts/emails them; when
// Stripe finishes it redirects HERE — never to the admin dashboard. This
// page confirms the setup server-side (via /api/booths/setup-card GET,
// which stores the card on the renter doc and notifies the owner) and
// shows a clean, branded "you're all set" screen.
//
// No auth, no app chrome, no admin data — the only thing this page can
// display is the card brand + last 4 for a successfully completed Stripe
// session it was redirected from.

import React, { useEffect, useMemo, useState } from 'react';

interface CardSetupPageProps {
  tenantId?: string;
}

// tenantId from props (App Router param) or from the URL path/query.
function useTenantId(props: CardSetupPageProps): string {
  return useMemo(() => {
    if (props.tenantId) return props.tenantId;
    if (typeof window === 'undefined') return '';
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('tenantId')) return q.get('tenantId') || '';
      const parts = window.location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('card-setup');
      return i >= 0 ? (parts[i + 1] || '') : '';
    } catch { return ''; }
  }, [props.tenantId]);
}

export function CardSetupPage(props: CardSetupPageProps = {}) {
  const tenantId = useTenantId(props);
  const [state, setState] = useState<'working' | 'done' | 'cancelled' | 'error'>('working');
  const [error, setError] = useState('');
  const [studioName, setStudioName] = useState('The studio');
  const [firstName, setFirstName] = useState('');
  const [card, setCard] = useState<{ brand: string; last4: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !tenantId) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('cfSetupSession');
    const renterId = params.get('cfRenterId');
    if (!sessionId || !renterId) {
      // No Stripe params — they cancelled out of the card page.
      setState('cancelled');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/booths/setup-card?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(renterId)}&session=${encodeURIComponent(sessionId)}`);
        const d = await res.json();
        if (d.ok) {
          setCard({ brand: d.cardBrand || 'Card', last4: d.cardLast4 || '' });
          setStudioName(d.studioName || 'The studio');
          setFirstName(d.renterFirstName || '');
          setState('done');
        } else {
          setError(d.error || "We couldn't confirm your card — please try the link again.");
          setState('error');
        }
      } catch {
        setError('Network hiccup — refresh this page to try again.');
        setState('error');
      }
      try { window.history.replaceState({}, '', window.location.pathname); } catch { /* cosmetic */ }
    })();
  }, [tenantId]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <p className="text-center text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground mb-4">{studioName}</p>
        <div className="rounded-3xl bg-white border-2 shadow-sm p-6 sm:p-8 text-center space-y-4">
          {state === 'working' && (
            <>
              <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
              <p className="text-sm font-bold text-slate-600">Confirming your card…</p>
            </>
          )}

          {state === 'done' && (
            <>
              <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-900">{firstName ? `You're all set, ${firstName}!` : "You're all set!"}</h1>
                <p className="text-sm font-bold text-slate-500 mt-1">Your card is safely on file.</p>
              </div>
              {card && (
                <div className="rounded-2xl border-2 bg-slate-50 px-4 py-3 inline-flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-700">{card.brand}</span>
                  <span className="text-sm font-black text-slate-900">···· {card.last4}</span>
                </div>
              )}
              <p className="text-[12px] font-semibold text-slate-500 leading-snug">
                Rent autopay and any agreed charges will use this card. Only {studioName} can charge it, per your signed agreement — you can update it any time from your renter portal.
              </p>
              <p className="text-[11px] font-bold text-slate-400">You can close this page.</p>
            </>
          )}

          {state === 'cancelled' && (
            <>
              <h1 className="text-xl font-black tracking-tight text-slate-900">No card added</h1>
              <p className="text-sm font-bold text-slate-500">
                Looks like the card page was closed before finishing. No problem — use the same link from {studioName} whenever you're ready.
              </p>
            </>
          )}

          {state === 'error' && (
            <>
              <h1 className="text-xl font-black tracking-tight text-slate-900">Almost there</h1>
              <p className="text-sm font-bold text-slate-500">{error}</p>
              <p className="text-[11px] font-bold text-slate-400">If this keeps happening, let {studioName} know and they'll send a fresh link.</p>
            </>
          )}
        </div>
        <p className="text-center text-[10px] font-medium text-slate-400 mt-4">Card details are handled by Stripe — {studioName} never sees the full number.</p>
      </div>
    </div>
  );
}

export default CardSetupPage;
