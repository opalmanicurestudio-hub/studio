'use client';

// src/app/(booking)/reservation/[tenantId]/[resId]/page.tsx
//
// A GUEST'S OWN BOOKING — where the button in a day or hourly booking's confirmation, and in a receipt for a charge or
// refund on it, lands. Opened with the ?k= key in the guest's own link (api/reservation). They see what they booked,
// their receipt (every charge, refund and what they've paid, lib/stay-receipt), can add it to a calendar, or ask to
// cancel (the business confirms, since money has already moved).

import React, { useEffect, useMemo, useState } from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';

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

const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ReservationManagePage() {
  const { tenantId, resId, k } = useIds();
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'done'>('loading');
  const [error, setError] = useState('');
  const [bizName, setBizName] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const api = async (payload: any) => {
    let r: Response;
    try {
      r = await fetch('/api/reservation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, resId, k, ...payload }),
      });
    } catch {
      throw new Error('No connection. Check your signal and try again.');
    }
    try { return await r.json(); } catch { throw new Error('Your booking couldn’t load just now. Try again in a moment.'); }
  };

  const load = async () => {
    if (!tenantId || !resId || !k) { setState('denied'); setError('This link is missing part of itself. Open the link from your confirmation message.'); return; }
    try {
      const d = await api({ action: 'view' });
      if (!d.ok) { setState('denied'); setError(d.error || 'This link no longer works.'); return; }
      setBizName(d.studioName || ''); setRes(d.reservation);
      setState('ready');
    } catch (e: any) { setState('denied'); setError(e?.message || 'No connection. Try again.'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId, resId, k]);

  const requestCancel = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const d = await api({ action: 'cancel-request' });
      if (d.ok) setState('done');
      else setError(d.error || 'Your request didn’t go through. Try again.');
    } catch (e: any) { setError(e?.message || 'No connection. Try again.'); }
    finally { setBusy(false); }
  };

  const calUrl = `/api/reservation?tenantId=${encodeURIComponent(tenantId)}&resId=${encodeURIComponent(resId)}&k=${encodeURIComponent(k)}`;
  const status = String(res?.status || '');
  const finished = ['completed', 'cancelled', 'refunded'].includes(status);
  const rc = res?.receipt || null;
  const statusLine = status === 'refunded' || status === 'cancelled' ? 'This booking is cancelled.'
    : status === 'completed' ? 'This stay is over. Thank you.'
    : res?.cancelRequested ? 'You asked to cancel. The business will confirm it with you, and sort any refund.'
    : '';

  const btn = 'w-full min-h-[48px] rounded-full text-[15px] font-semibold transition active:scale-[.99] disabled:opacity-40 flex items-center justify-center px-5';

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: SOFT, color: INK, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="max-w-md mx-auto space-y-3">
        <div className="px-1 pb-2">
          <p className="text-[13px]" style={{ color: MUTED }}>{bizName || 'Your booking'}</p>
          <h1 className="text-[26px] font-semibold tracking-tight leading-tight mt-0.5">
            {state === 'ready' || state === 'done' ? (res?.boothName || 'Your booking') : 'Your booking'}
          </h1>
          {res && <p className="text-[15px] mt-1" style={{ color: MUTED }}>{res.whenLabel}</p>}
        </div>

        {state === 'loading' && (
          <div className="rounded-2xl p-10 flex justify-center" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="h-7 w-7 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading your booking" />
          </div>
        )}

        {state === 'denied' && (
          <div className="rounded-2xl p-5 space-y-1" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <p className="text-[16px] font-semibold">This link doesn’t open a booking</p>
            <p className="text-[14px]" style={{ color: MUTED }}>{error}</p>
          </div>
        )}

        {state === 'done' && (
          <div className="rounded-2xl p-5 space-y-1" style={{ background: '#ecf6f0', border: `1px solid ${LINE}` }}>
            <p className="text-[16px] font-semibold" style={{ color: GREEN }}>You’ve asked to cancel</p>
            <p className="text-[14px]" style={{ color: INK }}>{bizName || 'The business'} has been told, and will confirm it with you and sort any refund.</p>
          </div>
        )}

        {state === 'ready' && res && (
          <>
            {statusLine && (
              <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: res.cancelRequested && !finished ? '#fff7ed' : 'white', color: res.cancelRequested && !finished ? AMBER : INK, border: `1px solid ${LINE}` }}>
                {statusLine}
              </div>
            )}

            <div className="rounded-2xl p-5" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
              <p className="text-[13px] font-medium" style={{ color: MUTED }}>Your receipt</p>
              {rc && Array.isArray(rc.lines) && rc.lines.length > 0 ? (
                <div className="mt-2">
                  {rc.lines.map((l: any, i: number) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 py-2 text-[15px]" style={{ borderTop: i ? `1px solid ${LINE}` : undefined }}>
                      <span className="min-w-0">{l.description}</span>
                      <span className="tabular-nums shrink-0" style={{ color: l.amountCents < 0 ? MUTED : INK }}>{money(l.amountCents)}</span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 text-[16px] font-semibold" style={{ borderTop: `1px solid ${INK}` }}>
                    <span>Paid</span><span className="tabular-nums">{money(rc.paidCents || 0)}</span>
                  </div>
                  {rc.stillDueCents > 0 && (
                    <div className="flex items-baseline justify-between gap-3 pt-1.5 text-[15px] font-medium" style={{ color: AMBER }}>
                      <span>Still to pay{res.balanceMode === 'at_checkin' ? ', at check-in' : res.balanceMode === 'in_person' ? ', in person' : ''}</span>
                      <span className="tabular-nums">{money(rc.stillDueCents)}</span>
                    </div>
                  )}
                  {rc.note && <p className="text-[13.5px] mt-3" style={{ color: MUTED }}>{rc.note}</p>}
                </div>
              ) : (
                <p className="text-[15px] mt-2">{res.paidWithPass ? 'Paid with prepaid days.' : `Paid ${money(res.paidCents || 0)}.`}</p>
              )}
            </div>

            {!confirmCancel && !finished && (
              <div className="space-y-2.5 pt-1">
                <a href={calUrl} className={btn} style={{ background: INK, color: 'white' }}>Add to calendar</a>
                {!res.cancelRequested && (
                  <button type="button" onClick={() => setConfirmCancel(true)} disabled={busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Ask to cancel</button>
                )}
              </div>
            )}

            {confirmCancel && (
              <div className="rounded-2xl p-5 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
                <p className="text-[16px] font-semibold">Ask to cancel this booking?</p>
                <p className="text-[14px]" style={{ color: MUTED }}>Your payment has already gone through, so {bizName || 'the business'} confirms a cancellation with you and sorts any refund.</p>
                <button type="button" onClick={requestCancel} disabled={busy} className={btn} style={{ background: RED, color: 'white' }}>{busy ? 'Sending…' : 'Yes, ask to cancel'}</button>
                <button type="button" onClick={() => setConfirmCancel(false)} disabled={busy} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Keep my booking</button>
              </div>
            )}

            {error && (
              <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fff7ed', color: AMBER, border: `1px solid ${LINE}` }} role="alert">{error}</div>
            )}
          </>
        )}

        <p className="text-center text-[13px] pt-2" style={{ color: MUTED }}>
          Something else to change? Reply to the message your booking came in.
        </p>
      </div>
    </div>
  );
}

export default ReservationManagePage;
