'use client';

/**
 * Booking confirmation & onboarding — /stay/[tenantId]/[reservationId]
 * (src/app/(booking)/stay/[tenantId]/[reservationId]/page.tsx)
 *
 * The appointments-style confirmation link, for renters. Sent in the
 * booking-confirmation SMS. The guest verifies with their phone's last
 * 4 digits (same gate as the kiosk), then gets:
 *   · full booking details + payment summary
 *   · house rules → "I acknowledge" (timestamped on the reservation —
 *     the day-guest equivalent of a signed lease)
 *   · emergency contact capture (owner protection requirement)
 *   · add-to-calendar (.ics) + arrival/check-in instructions
 *
 * Zero client Firebase — everything via /api/booths/kiosk. All info
 * lands on the reservation doc: retained forever, visible to the owner.
 */

import React, { useState } from 'react';
import { useParams } from 'next/navigation';

const t12 = (t?: string | null): string => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
};

export default function StayPage() {
  const params = useParams<{ tenantId: string; reservationId: string }>();
  const tenantId = params?.tenantId ?? '';
  const reservationId = params?.reservationId ?? '';

  const [last4, setLast4] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [ack, setAck] = useState(false);
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [saved, setSaved] = useState(false);
  const [stars, setStars] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewed, setReviewed] = useState(false);

  const load = async () => {
    if (busy || last4.length !== 4) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stay-view', tenantId, reservationId, phoneLast4: last4 }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'Booking not found.'); return; }
      setData(d);
      if (d.booking.rulesAcknowledgedAt) setSaved(true);
      if (d.booking.emergencyContact) { setEmName(d.booking.emergencyContact.name || ''); setEmPhone(d.booking.emergencyContact.phone || ''); }
      if (d.booking.rating) { setReviewed(true); setStars(d.booking.rating); }
    } catch { setError('Connection problem — try again.'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (busy || !ack) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stay-onboard', tenantId, reservationId, phoneLast4: last4, emergencyName: emName, emergencyPhone: emPhone }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'Could not save.'); return; }
      setSaved(true);
    } catch { setError('Connection problem — try again.'); }
    finally { setBusy(false); }
  };

  const submitReview = async () => {
    if (busy || stars < 1) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stay-review', tenantId, reservationId, phoneLast4: last4, rating: stars, reviewText }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'Could not save review.'); return; }
      setReviewed(true);
    } catch { setError('Connection problem — try again.'); }
    finally { setBusy(false); }
  };

  const b = data?.booking;
  const whenLine = b
    ? (b.bookingType === 'hourly' && b.startTime
        ? `${b.startDate} · ${t12(b.startTime)} – ${t12(b.endTime)}${b.slotLabel ? ` (${b.slotLabel})` : ''}`
        : b.startDate === b.endDate ? b.startDate : `${b.startDate} → ${b.endDate}`)
    : '';

  const icsHref = b ? (() => {
    const dt = (dateStr: string, timeStr: string | null, fallbackHour: string) =>
      `${dateStr.replace(/-/g, '')}T${(timeStr || fallbackHour).replace(':', '')}00`;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      `SUMMARY:${b.boothName} — ${data.studioName}`,
      `DTSTART:${dt(b.startDate, b.startTime, '09:00')}`,
      `DTEND:${dt(b.endDate, b.endTime, '18:00')}`,
      `DESCRIPTION:Your rental at ${data.studioName}. Check in at the front tablet with the last 4 of your phone number.`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\\r\\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  })() : '';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-5">
      <div className="w-full max-w-md space-y-4 py-6">

        {!data ? (
          <div className="rounded-3xl border-2 bg-white p-6 space-y-4">
            <div>
              <p className="text-xl font-black tracking-tight">Your booking ✨</p>
              <p className="text-xs font-bold text-slate-500 mt-0.5">Verify it's you to view details and complete check-in prep.</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Last 4 digits of your phone number</p>
              <input
                inputMode="numeric" maxLength={4} value={last4}
                onChange={e => { setError(''); setLast4(e.target.value.replace(/\D/g, '').slice(0, 4)); }}
                className="w-full h-14 rounded-2xl border-2 px-5 text-2xl font-black tracking-[0.5em] text-center"
                placeholder="••••"
              />
            </div>
            {error && <p className="text-xs font-bold text-amber-600">{error}</p>}
            <button onClick={load} disabled={last4.length !== 4 || busy}
              className="w-full h-13 py-3.5 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest disabled:opacity-30">
              {busy ? 'Loading…' : 'View my booking'}
            </button>
          </div>
        ) : (
          <>
            {/* ── Booking card ── */}
            <div className="rounded-3xl border-2 bg-white overflow-hidden">
              <div className="bg-slate-900 text-white px-5 py-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/50">{data.studioName}</p>
                <p className="text-xl font-black tracking-tight">You're booked, {b.firstName}! 🎉</p>
              </div>
              <div className="px-5 py-4 space-y-2">
                <p className="text-sm font-black">{b.boothName}</p>
                <p className="text-xs font-bold text-slate-600">{whenLine}</p>
                <p className="text-xs font-bold text-emerald-700">${(b.amountCents / 100).toFixed(2)} paid ✓</p>
                <div className="flex gap-2 pt-2">
                  <a href={icsHref} download={`booking-${b.startDate}.ics`}
                    className="flex-1 h-10 rounded-xl border-2 font-black uppercase text-[9px] tracking-widest text-slate-600 flex items-center justify-center">
                    📅 Add to calendar
                  </a>
                </div>
              </div>
            </div>

            {/* ── Arrival instructions ── */}
            <div className="rounded-2xl border-2 bg-white px-5 py-4 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">When you arrive</p>
              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                Check in at the front tablet — just tap in the last 4 digits of your phone number. Your space will be ready.
              </p>
            </div>

            {/* ── House rules + emergency contact ── */}
            <div className={`rounded-2xl border-2 bg-white px-5 py-4 space-y-3 ${saved ? 'border-emerald-200' : ''}`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Before your visit</p>
              <div className="rounded-xl border bg-slate-50 p-3.5 max-h-48 overflow-y-auto">
                <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {data.agreement || `House rules: treat the space and equipment with care, keep your station clean, respect other professionals and their clients, and report any issues to the front desk. Time runs per your booking — overages may be charged per studio policy.`}
                </p>
              </div>
              {saved ? (
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">✓ Rules acknowledged — you're all set</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2">
                    <input placeholder="Emergency contact name (optional)" value={emName} onChange={e => setEmName(e.target.value)}
                      className="h-11 rounded-xl border-2 px-4 text-sm font-medium" />
                    <input placeholder="Emergency contact phone (optional)" inputMode="tel" value={emPhone} onChange={e => setEmPhone(e.target.value)}
                      className="h-11 rounded-xl border-2 px-4 text-sm font-medium" />
                  </div>
                  <button onClick={() => setAck(a => !a)}
                    className={`w-full rounded-xl border-2 p-3 flex items-center gap-3 text-left transition-colors ${ack ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
                    <span className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center text-xs font-black shrink-0 ${ack ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>{ack ? '✓' : ''}</span>
                    <span className="text-xs font-bold">I've read and agree to the studio's rules</span>
                  </button>
                  {error && <p className="text-xs font-bold text-amber-600">{error}</p>}
                  <button onClick={submit} disabled={!ack || busy}
                    className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-30">
                    {busy ? 'Saving…' : 'Confirm & complete'}
                  </button>
                </>
              )}
            </div>
            {/* ── How was your stay? (after completion) ── */}
            {b.status === 'completed' && (
              <div className="rounded-2xl border-2 bg-white px-5 py-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">How was your stay?</p>
                {reviewed ? (
                  <p className="text-sm font-black text-emerald-700">{'⭐'.repeat(stars)} Thanks for the feedback — it means a lot! 💚</p>
                ) : (
                  <>
                    <div className="flex gap-2 justify-center py-1">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} onClick={() => setStars(n)} className={`text-3xl transition-transform active:scale-90 ${n <= stars ? '' : 'grayscale opacity-30'}`}>⭐</button>
                      ))}
                    </div>
                    <textarea rows={2} placeholder="Anything you'd tell us? (optional)" value={reviewText}
                      onChange={e => setReviewText(e.target.value)}
                      className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium" />
                    <button onClick={submitReview} disabled={stars < 1 || busy}
                      className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest disabled:opacity-30">
                      {busy ? 'Sending…' : 'Send feedback'}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
