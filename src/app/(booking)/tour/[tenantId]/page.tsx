'use client';

/**
 * Tour scheduling — /tour/[tenantId]
 * (src/app/(booking)/tour/[tenantId]/page.tsx)
 *
 * Appointment-grade tour booking, the way a major company does it: pick a
 * day, pick a real open time (owner-defined windows, lead time, and
 * already-booked slots all respected server-side), leave your details,
 * done. Auto-confirms or awaits approval per the owner's automation
 * rules. Zero client Firebase — all via /api/booths/kiosk. The tour flows
 * into the CRM as a 'Toured' contact automatically.
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const t12 = (t?: string) => {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || '';
  const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr} ${ap}` : `${hr}:${String(m).padStart(2, '0')} ${ap}`;
};

export default function TourPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId ?? '';

  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [toursOff, setToursOff] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ autoConfirmed: boolean } | null>(null);

  // Next 21 days as pickable date chips (server filters to tour days)
  const days = Array.from({ length: 21 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const dayLabel = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return { dow: d.toLocaleDateString('en-US', { weekday: 'short' }), num: d.getDate(), mon: d.toLocaleDateString('en-US', { month: 'short' }) };
  };

  useEffect(() => {
    if (!date) return;
    setLoadingSlots(true); setSlots(null); setTime('');
    fetch('/api/booths/kiosk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tour-slots', tenantId, date }),
    }).then(r => r.json()).then(d => {
      if (d.ok) { setSlots(d.slots || []); if (d.toursOff) setToursOff(true); }
      else setSlots([]);
    }).catch(() => setSlots([])).finally(() => setLoadingSlots(false));
  }, [date, tenantId]);

  const canBook = date && time && form.name.trim() && (form.phone.trim() || form.email.trim()) && !busy;

  const book = async () => {
    if (!canBook) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/booths/kiosk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tour-book', tenantId, date, time, ...form }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'Could not book the tour.'); if (res.status === 409) { setTime(''); /* refresh slots */ setDate(dd => dd); } return; }
      setDone({ autoConfirmed: !!d.autoConfirmed });
    } catch { setError('Connection problem — try again.'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-5">
        <div className="max-w-md w-full rounded-3xl border-2 bg-white p-8 text-center space-y-3">
          <p className="text-6xl">📅</p>
          <p className="text-2xl font-black tracking-tight">{done.autoConfirmed ? "You're on the calendar!" : 'Tour requested!'}</p>
          <p className="text-sm font-bold text-slate-600">
            {t12(time)} on {dayLabel(date).dow}, {dayLabel(date).mon} {dayLabel(date).num}.
            {done.autoConfirmed ? ' See you then — we\u2019ll text a reminder.' : ' We\u2019ll confirm shortly and text you back.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-5">
      <div className="w-full max-w-md space-y-4 py-6">
        <div>
          <p className="text-2xl font-black tracking-tight">Book a tour ✨</p>
          <p className="text-xs font-bold text-slate-500 mt-0.5">Come see the space — pick a time that works for you.</p>
        </div>

        {/* Day picker */}
        <div className="rounded-2xl border-2 bg-white p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pick a day</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map(iso => {
              const l = dayLabel(iso); const sel = iso === date;
              return (
                <button key={iso} onClick={() => setDate(iso)}
                  className={`shrink-0 w-14 py-2 rounded-xl border-2 text-center transition-colors ${sel ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200'}`}>
                  <p className={`text-[8px] font-black uppercase ${sel ? 'text-white/60' : 'text-slate-400'}`}>{l.dow}</p>
                  <p className="text-base font-black">{l.num}</p>
                  <p className={`text-[8px] font-bold ${sel ? 'text-white/60' : 'text-slate-400'}`}>{l.mon}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Time picker */}
        {date && (
          <div className="rounded-2xl border-2 bg-white p-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pick a time</p>
            {loadingSlots ? (
              <p className="text-xs text-slate-400 py-3 text-center">Loading times…</p>
            ) : toursOff ? (
              <p className="text-xs text-slate-400 py-3 text-center">Tours aren't available online right now — please call the studio.</p>
            ) : slots && slots.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {slots.map(s => (
                  <button key={s} onClick={() => setTime(s)}
                    className={`h-11 rounded-xl border-2 text-xs font-black transition-colors ${time === s ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200'}`}>
                    {t12(s)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-3 text-center">No open times that day — try another.</p>
            )}
          </div>
        )}

        {/* Details */}
        {time && (
          <div className="rounded-2xl border-2 bg-white p-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Your details</p>
            <input placeholder="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full h-11 rounded-xl border-2 px-4 text-sm font-medium" />
            <input placeholder="Phone" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full h-11 rounded-xl border-2 px-4 text-sm font-medium" />
            <input placeholder="Email (optional)" inputMode="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full h-11 rounded-xl border-2 px-4 text-sm font-medium" />
            <textarea rows={2} placeholder="Anything you'd like us to know? (optional)" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium" />
            {error && <p className="text-xs font-bold text-amber-600">{error}</p>}
            <button onClick={book} disabled={!canBook}
              className="w-full h-13 py-3.5 rounded-2xl bg-slate-900 text-white font-black uppercase text-[11px] tracking-widest disabled:opacity-30">
              {busy ? 'Booking…' : `Book tour · ${t12(time)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
