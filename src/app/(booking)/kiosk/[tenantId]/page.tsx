'use client';

/**
 * Check-in kiosk — /kiosk/[tenantId]  (src/app/(booking)/kiosk/[tenantId]/page.tsx)
 *
 * A front-desk tablet page. Four steps, big touch targets, auto-reset:
 *   1. IDENTIFY — last 4 digits of the booking phone number
 *   2. CONFIRM  — pick/verify today's booking
 *   3. POLICIES — review + agree (studio agreement if configured,
 *                 reconfirmation of booking-time consent otherwise)
 *   4. WELCOME  — checked in; resets for the next guest
 *
 * Zero client Firebase — everything goes through /api/booths/kiosk, so
 * no rules changes and no anonymous-write risk. Writes the same fields
 * as the owner's Check In button: Operations updates live, the time
 * clock runs, overage/credit settlement works unchanged.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

type Booking = {
  id: string; firstName: string; boothName: string;
  startDate: string; endDate: string; bookingType: string;
  startTime: string | null; endTime: string | null; slotLabel: string | null;
  alreadyCheckedIn: boolean;
};

const t12 = (t?: string | null): string => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
};

export default function KioskPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId ?? '';

  const [step, setStep] = useState<'identify' | 'confirm' | 'policies' | 'done'>('identify');
  const [last4, setLast4] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [picked, setPicked] = useState<Booking | null>(null);
  const [agreement, setAgreement] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [welcome, setWelcome] = useState<{ firstName: string; boothName: string; endTime: string | null } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    setStep('identify'); setLast4(''); setError(''); setBookings([]);
    setPicked(null); setAgreed(false); setWelcome(null);
    if (resetTimer.current) clearTimeout(resetTimer.current);
  };

  // Welcome screen auto-resets for the next guest
  useEffect(() => {
    if (step === 'done') {
      resetTimer.current = setTimeout(reset, 8000);
      return () => { if (resetTimer.current) clearTimeout(resetTimer.current); };
    }
  }, [step]);

  const lookup = async () => {
    if (busy || last4.length !== 4) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', tenantId, phoneLast4: last4 }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'No booking found.'); return; }
      setAgreement(d.agreement || '');
      setBookings(d.bookings);
      if (d.bookings.length === 1) { setPicked(d.bookings[0]); setStep(d.bookings[0].alreadyCheckedIn ? 'confirm' : 'confirm'); }
      else setStep('confirm');
    } catch { setError('Connection problem — see the front desk.'); }
    finally { setBusy(false); }
  };

  const checkin = async () => {
    if (busy || !picked) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkin', tenantId, reservationId: picked.id, phoneLast4: last4 }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'Could not check in — see the front desk.'); return; }
      setWelcome({ firstName: d.firstName, boothName: d.boothName, endTime: d.endTime });
      setStep('done');
    } catch { setError('Connection problem — see the front desk.'); }
    finally { setBusy(false); }
  };

  const keypad = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  const whenLine = (b: Booking) =>
    b.bookingType === 'hourly' && b.startTime
      ? `${b.slotLabel ? b.slotLabel + ' · ' : ''}${t12(b.startTime)} – ${t12(b.endTime)}`
      : b.startDate === b.endDate ? 'Today' : `${b.startDate} → ${b.endDate}`;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-md space-y-6">

        {step === 'identify' && (
          <>
            <div className="text-center space-y-1">
              <p className="text-3xl font-black tracking-tight">Welcome ✨</p>
              <p className="text-sm font-bold text-white/50">Check in for your booking</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Last 4 digits of your phone number</p>
              <div className="flex justify-center gap-3 mb-5">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`w-14 h-16 rounded-2xl border-2 flex items-center justify-center text-3xl font-black ${last4[i] ? 'border-white bg-white/10' : 'border-white/20'}`}>
                    {last4[i] || ''}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                {keypad.map((k, i) => k === '' ? <div key={i} /> : (
                  <button key={i}
                    onClick={() => {
                      setError('');
                      if (k === '⌫') setLast4(v => v.slice(0, -1));
                      else if (last4.length < 4) setLast4(v => v + k);
                    }}
                    className="h-16 rounded-2xl bg-white/5 border border-white/10 text-2xl font-black active:bg-white/20 transition-colors">
                    {k}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-center text-sm font-bold text-amber-400">{error}</p>}
            <button onClick={lookup} disabled={last4.length !== 4 || busy}
              className="w-full h-16 rounded-2xl bg-white text-slate-950 text-lg font-black uppercase tracking-widest disabled:opacity-30 transition-opacity">
              {busy ? 'Finding you…' : 'Find my booking'}
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="text-center space-y-1">
              <p className="text-2xl font-black tracking-tight">{bookings.length > 1 ? 'Which one is you?' : 'This you?'}</p>
            </div>
            <div className="space-y-3">
              {bookings.map(b => (
                <button key={b.id}
                  onClick={() => setPicked(b)}
                  disabled={b.alreadyCheckedIn}
                  className={`w-full rounded-3xl border-2 p-5 text-left transition-colors ${b.alreadyCheckedIn ? 'border-white/10 opacity-40' : picked?.id === b.id ? 'border-white bg-white/10' : 'border-white/20 active:bg-white/5'}`}>
                  <p className="text-xl font-black">{b.firstName}</p>
                  <p className="text-sm font-bold text-white/60">{b.boothName} · {whenLine(b)}</p>
                  {b.alreadyCheckedIn && <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mt-1">✓ Already checked in</p>}
                </button>
              ))}
            </div>
            {error && <p className="text-center text-sm font-bold text-amber-400">{error}</p>}
            <div className="flex gap-3">
              <button onClick={reset} className="h-14 px-6 rounded-2xl border-2 border-white/20 font-black uppercase text-[11px] tracking-widest text-white/60">Back</button>
              <button onClick={() => picked && !picked.alreadyCheckedIn && setStep('policies')} disabled={!picked || picked.alreadyCheckedIn}
                className="flex-1 h-14 rounded-2xl bg-white text-slate-950 font-black uppercase text-[12px] tracking-widest disabled:opacity-30">
                That's me →
              </button>
            </div>
          </>
        )}

        {step === 'policies' && picked && (
          <>
            <div className="text-center space-y-1">
              <p className="text-2xl font-black tracking-tight">One quick thing</p>
              <p className="text-sm font-bold text-white/50">{picked.boothName} · {whenLine(picked)}</p>
            </div>
            <div className="rounded-3xl border-2 border-white/20 bg-white/5 p-5 max-h-64 overflow-y-auto">
              {agreement ? (
                <p className="text-sm leading-relaxed text-white/80 whitespace-pre-wrap">{agreement}</p>
              ) : (
                <p className="text-sm leading-relaxed text-white/80">
                  By checking in, I confirm the booking details above are correct and reconfirm my agreement to the studio's rental policies I accepted when booking — including care of the space and equipment, and the studio's time and conduct policies.
                </p>
              )}
            </div>
            <button onClick={() => setAgreed(a => !a)}
              className={`w-full rounded-2xl border-2 p-4 flex items-center gap-3 text-left transition-colors ${agreed ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/20'}`}>
              <span className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center text-sm font-black shrink-0 ${agreed ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-white/40'}`}>{agreed ? '✓' : ''}</span>
              <span className="text-sm font-bold">I've reviewed and agree to the studio policies</span>
            </button>
            {error && <p className="text-center text-sm font-bold text-amber-400">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setStep('confirm'); setAgreed(false); }} className="h-16 px-6 rounded-2xl border-2 border-white/20 font-black uppercase text-[11px] tracking-widest text-white/60">Back</button>
              <button onClick={checkin} disabled={!agreed || busy}
                className="flex-1 h-16 rounded-2xl bg-emerald-400 text-slate-950 text-lg font-black uppercase tracking-widest disabled:opacity-30">
                {busy ? 'Checking in…' : 'Check In'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && welcome && (
          <div className="text-center space-y-4 py-8">
            <p className="text-6xl">🎉</p>
            <p className="text-3xl font-black tracking-tight">You're in, {welcome.firstName}!</p>
            <p className="text-lg font-bold text-white/70">
              {welcome.boothName} is yours{welcome.endTime ? ` until ${t12(welcome.endTime)}` : ' — enjoy your day'}.
            </p>
            <p className="text-[10px] font-black uppercase tracking-widest text-white/30 pt-6">This screen resets in a few seconds</p>
            <button onClick={reset} className="text-[11px] font-black uppercase tracking-widest text-white/50 underline underline-offset-4">Done — next guest</button>
          </div>
        )}
      </div>
    </div>
  );
}
