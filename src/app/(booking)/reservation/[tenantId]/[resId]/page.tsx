'use client';

// src/app/(booking)/reservation/[tenantId]/[resId]/page.tsx
//
// "MANAGE MY RESERVATION" — where the button in day/hourly booking
// confirmations lands. Auth = the ?k= token in the guest's own link.
// See the details, add it to a calendar, or request a cancellation
// (owner-approved — money already moved through Stripe). Styled to match
// the appointment manage page: dark masthead, clean card, thumb-size
// actions, status-aware error messages.

import React, { useEffect, useMemo, useState } from 'react';

function useIds() {
  return useMemo(() => {
    if (typeof window === 'undefined') return { tenantId: '', resId: '', k: '' };
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('reservation');
      const q = new URLSearchParams(window.location.search);
      return { tenantId: parts[i + 1] || '', resId: parts[i + 2] || '', k: q.get('k') || '' };
    } catch { return { tenantId: '', resId: '', k: '' }; }
  }, []);
}

export function ReservationManagePage() {
  const { tenantId, resId, k } = useIds();
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'done'>('loading');
  const [error, setError] = useState('');
  const [studioName, setStudioName] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');

  const api = async (payload: any) => {
    let r: Response;
    try {
      r = await fetch('/api/reservation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, resId, k, ...payload }),
      });
    } catch {
      throw new Error('No connection — check your signal and try again.');
    }
    try {
      return await r.json();
    } catch {
      throw new Error(r.status === 404
        ? 'The reservation service is not available (404) — the studio\'s app is missing its /api/reservation endpoint.'
        : `Server error (${r.status}) — try again in a moment.`);
    }
  };

  const load = async () => {
    if (!tenantId || !resId || !k) { setState('denied'); setError('This link is incomplete — use the link from your confirmation message.'); return; }
    try {
      const d = await api({ action: 'view' });
      if (!d.ok) { setState('denied'); setError(d.error || 'Link expired.'); return; }
      setStudioName(d.studioName); setRes(d.reservation);
      setState('ready');
    } catch (e: any) { setState('denied'); setError(e?.message || 'No connection — try again.'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId, resId, k]);

  const requestCancel = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const d = await api({ action: 'cancel-request' });
      if (d.ok) { setDoneMsg('Cancellation requested — the studio will confirm and sort any refund with you.'); setState('done'); }
      else setError(d.error || 'Could not send the request — try again.');
    } catch (e: any) { setError(e?.message || 'No connection — try again.'); }
    finally { setBusy(false); }
  };

  const calUrl = `/api/reservation?tenantId=${encodeURIComponent(tenantId)}&resId=${encodeURIComponent(resId)}&k=${encodeURIComponent(k)}`;

  const Btn = ({ onClick, tone, children, disabled }: any) => (
    <button onClick={onClick} disabled={disabled || busy}
      className={`w-full h-14 rounded-2xl font-black uppercase text-[11px] tracking-widest disabled:opacity-40 transition-transform active:scale-[.98] ${
        tone === 'dark' ? 'bg-slate-900 text-white' : tone === 'red' ? 'bg-red-600 text-white' : 'border-2 text-slate-700 bg-white'}`}>
      {children}
    </button>
  );

  const balance = res && res.balanceDueCents > 0 ? (res.balanceDueCents / 100).toFixed(2) : null;

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="max-w-md mx-auto space-y-4">
        <div className="rounded-3xl bg-slate-900 text-white p-6 shadow-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{studioName || 'Your reservation'}</p>
          <h1 className="text-2xl font-black tracking-tight mt-1">
            {state === 'ready' || state === 'done' ? (res?.boothName || 'Reservation') : 'Manage reservation'}
          </h1>
          {res && <p className="text-sm font-bold text-slate-300 mt-1.5">{res.whenLabel}</p>}
        </div>

        {state === 'loading' && (
          <div className="rounded-3xl bg-white border-2 p-10 text-center">
            <div className="mx-auto h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
          </div>
        )}

        {state === 'denied' && (
          <div className="rounded-3xl bg-white border-2 p-6 text-center space-y-1.5">
            <p className="text-sm font-black text-slate-900">Can't open this reservation</p>
            <p className="text-xs font-bold text-slate-500">{error}</p>
          </div>
        )}

        {state === 'done' && (
          <div className="rounded-3xl bg-white border-2 border-emerald-200 p-8 text-center space-y-2">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="text-2xl font-black text-emerald-600">✓</span>
            </div>
            <p className="text-base font-black text-slate-900">{doneMsg}</p>
            <p className="text-xs font-bold text-slate-500">The studio has been notified automatically.</p>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className="rounded-3xl bg-white border-2 p-5 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Details</p>
              <div className="flex justify-between text-sm"><span className="font-bold text-slate-500">Space</span><span className="font-black text-slate-900">{res.boothName}</span></div>
              <div className="flex justify-between text-sm"><span className="font-bold text-slate-500">When</span><span className="font-black text-slate-900 text-right">{res.whenLabel}</span></div>
              <div className="flex justify-between text-sm">
                <span className="font-bold text-slate-500">Paid</span>
                <span className="font-black text-emerald-600">{res.paidWithPass ? 'Day pass' : `$${(res.paidCents / 100).toFixed(2)}`}</span>
              </div>
              {balance && (
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-500">Balance due</span>
                  <span className="font-black text-amber-600">${balance} {res.balanceMode === 'at_checkin' ? 'at check-in' : 'in person'}</span>
                </div>
              )}
              {res.cancelRequested && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 mt-1">
                  <p className="text-[11px] font-bold text-amber-700">Cancellation requested — the studio will be in touch.</p>
                </div>
              )}
            </div>

            {!confirmCancel && (
              <div className="space-y-2.5">
                <a href={calUrl}
                  className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest flex items-center justify-center">
                  Add to calendar
                </a>
                {!res.cancelRequested && !['completed', 'cancelled'].includes(String(res.status || '')) && (
                  <Btn onClick={() => setConfirmCancel(true)}>Request cancellation</Btn>
                )}
              </div>
            )}

            {confirmCancel && (
              <div className="rounded-3xl bg-white border-2 p-5 space-y-3">
                <p className="text-sm font-black text-slate-900">Request to cancel this reservation?</p>
                <p className="text-xs font-bold text-slate-500">Because payment already went through, the studio confirms cancellations personally and sorts any refund with you directly.</p>
                <Btn tone="red" onClick={requestCancel}>Yes, request cancellation</Btn>
                <Btn onClick={() => setConfirmCancel(false)}>Keep my reservation</Btn>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-3.5">
                <p className="text-[11px] font-bold text-red-700">{error}</p>
              </div>
            )}
          </>
        )}

        <p className="text-center text-[10px] font-medium text-slate-400">
          Need something else? Call or text the studio — we're happy to help.
        </p>
      </div>
    </div>
  );
}

export default ReservationManagePage;
