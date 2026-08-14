'use client';

// src/app/(booking)/appt/[tenantId]/[apptId]/page.tsx
//
// "MANAGE MY APPOINTMENT" — where the buttons in confirmation and
// reminder messages land. Auth = the ?k= token in the client's own link.
// Cancel (inside the studio's window), pick a new time (conflict-checked
// live against the same staff member's calendar), tap "running late",
// or add it to their calendar. Styled to match the portals: dark
// masthead, clean card, thumb-size actions.

import React, { useEffect, useMemo, useState } from 'react';

function useIds() {
  return useMemo(() => {
    if (typeof window === 'undefined') return { tenantId: '', apptId: '', k: '' };
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('appt');
      const q = new URLSearchParams(window.location.search);
      return { tenantId: parts[i + 1] || '', apptId: parts[i + 2] || '', k: q.get('k') || '' };
    } catch { return { tenantId: '', apptId: '', k: '' }; }
  }, []);
}

export function ApptManagePage() {
  const { tenantId, apptId, k } = useIds();
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'done'>('loading');
  const [error, setError] = useState('');
  const [studioName, setStudioName] = useState('');
  const [appt, setAppt] = useState<any>(null);
  const [policy, setPolicy] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const [mode, setMode] = useState<'home' | 'reschedule' | 'confirmCancel'>('home');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');

  const api = async (payload: any) => {
    const res = await fetch('/api/appt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, apptId, k, ...payload }),
    });
    return res.json();
  };

  const load = async () => {
    if (!tenantId || !apptId || !k) { setState('denied'); setError('This link is incomplete — use the link from your confirmation message.'); return; }
    try {
      const d = await api({ action: 'view' });
      if (!d.ok) { setState('denied'); setError(d.error || 'Link expired.'); return; }
      setStudioName(d.studioName); setAppt(d.appt); setPolicy(d.policy || {});
      setState('ready');
    } catch { setState('denied'); setError('No connection — try again.'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId, apptId, k]);

  const act = async (payload: any, successMsg: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const d = await api(payload);
      if (d.ok) { setDoneMsg(d.whenLabel ? `${successMsg} ${d.whenLabel}.` : successMsg); setState('done'); }
      else setError(d.error || 'Could not save — try again.');
    } catch { setError('No connection — try again.'); }
    finally { setBusy(false); }
  };

  const Btn = ({ onClick, tone, children, disabled }: any) => (
    <button onClick={onClick} disabled={disabled || busy}
      className={`w-full h-14 rounded-2xl font-black uppercase text-[11px] tracking-widest disabled:opacity-40 transition-transform active:scale-[.98] ${
        tone === 'dark' ? 'bg-slate-900 text-white' : tone === 'red' ? 'bg-red-600 text-white' : tone === 'green' ? 'bg-emerald-600 text-white' : 'border-2 text-slate-700 bg-white'}`}>
      {children}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="max-w-md mx-auto space-y-4">
        <div className="rounded-3xl bg-slate-900 text-white p-6 shadow-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{studioName || 'Your appointment'}</p>
          <h1 className="text-2xl font-black tracking-tight mt-1">
            {state === 'ready' || state === 'done' ? (appt?.serviceName || 'Appointment') : 'Manage appointment'}
          </h1>
          {appt && (
            <p className="text-sm font-bold text-slate-300 mt-1.5">
              {appt.whenLabel}{appt.staffName ? ` · with ${appt.staffName}` : ''}
            </p>
          )}
        </div>

        {state === 'loading' && (
          <div className="rounded-3xl bg-white border-2 p-10 text-center">
            <div className="mx-auto h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
          </div>
        )}

        {state === 'denied' && (
          <div className="rounded-3xl bg-white border-2 p-6 text-center space-y-1.5">
            <p className="text-sm font-black text-slate-900">Can't open this appointment</p>
            <p className="text-xs font-bold text-slate-500">{error}</p>
          </div>
        )}

        {state === 'done' && (
          <div className="rounded-3xl bg-white border-2 border-emerald-200 p-8 text-center space-y-2">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="text-2xl font-black text-emerald-600">✓</span>
            </div>
            <p className="text-base font-black text-slate-900">{doneMsg}</p>
            <p className="text-xs font-bold text-slate-500">You're all set — the studio has been updated automatically.</p>
          </div>
        )}

        {state === 'ready' && mode === 'home' && (
          <div className="space-y-2.5">
            {!policy.canChange && (
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3.5">
                <p className="text-[11px] font-bold text-amber-700">
                  Online changes close {policy.cancelHours}h before your appointment — call the studio and we'll help.
                </p>
              </div>
            )}
            {policy.canChange && (
              <>
                <Btn tone="dark" onClick={() => setMode('reschedule')}>Reschedule</Btn>
                <Btn onClick={() => setMode('confirmCancel')}>Cancel appointment</Btn>
              </>
            )}
            <Btn onClick={() => act({ action: 'late' }, 'Told them you\'re running a little late —')}>I'm running late</Btn>
            <a href={`/api/appt?tenantId=${encodeURIComponent(tenantId)}&apptId=${encodeURIComponent(apptId)}&k=${encodeURIComponent(k)}`}
              className="block w-full h-14 rounded-2xl border-2 bg-white text-slate-700 font-black uppercase text-[11px] tracking-widest flex items-center justify-center">
              Add to calendar
            </a>
          </div>
        )}

        {state === 'ready' && mode === 'confirmCancel' && (
          <div className="rounded-3xl bg-white border-2 p-5 space-y-3">
            <p className="text-sm font-black text-slate-900">Cancel this appointment?</p>
            <p className="text-xs font-bold text-slate-500">Your spot opens up for someone else. If plans change, you can always book again.</p>
            <Btn tone="red" onClick={() => act({ action: 'cancel' }, 'Your appointment is cancelled.')}>Yes, cancel it</Btn>
            <Btn onClick={() => setMode('home')}>Keep my appointment</Btn>
          </div>
        )}

        {state === 'ready' && mode === 'reschedule' && (
          <div className="rounded-3xl bg-white border-2 p-5 space-y-3">
            <p className="text-sm font-black text-slate-900">Pick a new time</p>
            <p className="text-xs font-bold text-slate-500">Same service{appt?.staffName ? `, same person (${appt.staffName})` : ''} — we'll check the calendar instantly.</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Date</p>
                <input type="date" value={newDate} min={policy.earliestDate || ''}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 text-sm font-medium bg-white" />
              </div>
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Time</p>
                <input type="time" value={newTime} step={900}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="w-full h-12 rounded-xl border-2 px-3 text-sm font-medium bg-white" />
              </div>
            </div>
            <Btn tone="green" disabled={!newDate || !newTime}
              onClick={() => act({ action: 'reschedule', newDate, newTime }, 'Rescheduled to')}>
              Confirm new time
            </Btn>
            <Btn onClick={() => setMode('home')}>Back</Btn>
          </div>
        )}

        {error && state === 'ready' && (
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-3.5">
            <p className="text-[11px] font-bold text-red-700">{error}</p>
          </div>
        )}

        <p className="text-center text-[10px] font-medium text-slate-400">
          Need something else? Call or text the studio — we're happy to help.
        </p>
      </div>
    </div>
  );
}

export default ApptManagePage;
