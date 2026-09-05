'use client';

/**
 * Move or cancel my visit
 * Route: src/app/tour-manage/[tenantId]/[tourId]/[token]/page.tsx
 *
 * The link in a visitor's confirmation and reminder lands here. No login: the
 * token in the URL is the key, checked server-side against the tour document.
 * Everything goes through /api/booths/kiosk tour-manage-* actions, so the
 * cutoff (the shop's lead time) and the clash check are enforced where they
 * cannot be bypassed, and the owner is told in the pipeline either way.
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader, CheckCircle2, AlertTriangle, CalendarClock, XCircle } from 'lucide-react';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const t12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h)) return hhmm;
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ap}`;
};
const whenText = (date: string, time: string) => {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return `${date} ${time}`;
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()} · ${t12(time)}`;
};

type Summary = { name: string; date: string; time: string; status: string; changeable: boolean; cutoffHours: number; studioName: string };

export default function TourManagePage() {
  const params = useParams();
  const tenantId = params?.tenantId as string;
  const tourId = params?.tourId as string;
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [tour, setTour] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'view' | 'move' | 'cancelled' | 'moved'>('view');
  const [openDays, setOpenDays] = useState<Record<string, number> | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [armCancel, setArmCancel] = useState(false);

  const call = async (action: string, extra: any = {}) => {
    const res = await fetch('/api/booths/kiosk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, tenantId, tourId, token, ...extra }),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  useEffect(() => {
    if (!tenantId || !tourId || !token) return;
    (async () => {
      const { data } = await call('tour-manage-get');
      if (data?.ok) setTour(data.tour);
      else setError(data?.error || 'This link is not valid.');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, tourId, token]);

  useEffect(() => {
    if (!armCancel) return;
    const t = setTimeout(() => setArmCancel(false), 5000);
    return () => clearTimeout(t);
  }, [armCancel]);

  const startMove = async () => {
    setMode('move'); setError(''); setDate(''); setSlots(null); setTime('');
    const pad = (n: number) => String(n).padStart(2, '0');
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 21);
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const res = await fetch('/api/booths/kiosk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tour-days', tenantId, from: iso(from), to: iso(to) }),
    });
    const d = await res.json().catch(() => ({}));
    setOpenDays(d?.ok && d.days ? d.days : {});
  };

  const pickDay = async (diso: string) => {
    setDate(diso); setTime(''); setSlots(null);
    const res = await fetch('/api/booths/kiosk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tour-slots', tenantId, date: diso }),
    });
    const d = await res.json().catch(() => ({}));
    setSlots(d?.ok && Array.isArray(d.slots) ? d.slots : []);
  };

  const confirmMove = async () => {
    if (!date || !time) return;
    setBusy(true); setError('');
    const { data } = await call('tour-manage-move', { date, time });
    if (data?.ok) { setTour(data.tour); setMode('moved'); }
    else { setError(data?.error || 'Could not move it.'); if (data?.error?.includes('taken')) { setTime(''); void pickDay(date); } }
    setBusy(false);
  };

  const doCancel = async () => {
    if (!armCancel) { setArmCancel(true); return; }
    setBusy(true); setError('');
    const { data } = await call('tour-manage-cancel');
    if (data?.ok) { setTour(data.tour); setMode('cancelled'); }
    else setError(data?.error || 'Could not cancel it.');
    setBusy(false);
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="max-w-md mx-auto space-y-6">{children}</div>
    </div>
  );

  if (loading) return shell(<Loader className="h-5 w-5 animate-spin text-slate-400" />);

  if (!tour) return shell(
    <div className="space-y-2">
      <AlertTriangle className="h-6 w-6 text-amber-500" />
      <h1 className="text-lg font-black tracking-tight">This link is not valid</h1>
      <p className="text-sm text-slate-500">{error || 'It may have been replaced. Reply to your confirmation and we will send a fresh one.'}</p>
    </div>
  );

  if (mode === 'cancelled') return shell(
    <div className="space-y-2">
      <XCircle className="h-7 w-7 text-slate-400" />
      <h1 className="text-lg font-black tracking-tight">Your visit is cancelled</h1>
      <p className="text-sm text-slate-500">Thanks for letting us know. Whenever you'd like to see the space, you're welcome to book again.</p>
      <a href={`/tour/${tenantId}`} className="inline-flex h-12 items-center rounded-2xl bg-slate-900 px-5 text-xs font-black uppercase tracking-widest text-white">Book a new time</a>
    </div>
  );

  if (mode === 'moved') return shell(
    <div className="space-y-2">
      <CheckCircle2 className="h-7 w-7 text-emerald-500" />
      <h1 className="text-lg font-black tracking-tight">Moved — see you then</h1>
      <p className="text-sm font-bold text-slate-700">{whenText(tour.date, tour.time)}</p>
      <p className="text-sm text-slate-500">{tour.studioName} has been told. You'll get a reminder the day before.</p>
    </div>
  );

  const already = tour.status === 'cancelled' || tour.status === 'declined' || tour.status === 'expired';

  return shell(
    <>
      <div className="space-y-1.5">
        <CalendarClock className="h-6 w-6 text-slate-400" />
        <h1 className="text-2xl font-black tracking-tight">{tour.name ? `${tour.name.split(' ')[0]}, your visit` : 'Your visit'}</h1>
        <p className="text-sm font-bold text-slate-700">{whenText(tour.date, tour.time)}</p>
        <p className="text-sm text-slate-500">
          {already ? 'This visit is no longer on the calendar.'
            : tour.status === 'requested' ? `${tour.studioName} hasn't confirmed this yet — you can still change it.`
            : tour.changeable ? `Changes are open until ${tour.cutoffHours} hours before.`
            : `Changes closed ${tour.cutoffHours} hours before the visit. If something has come up, reply to your confirmation or call — we will sort it out.`}
        </p>
      </div>

      {error && <p className="text-xs font-bold text-red-600">{error}</p>}

      {!already && tour.changeable && mode === 'view' && (
        <div className="space-y-2">
          <button type="button" onClick={startMove}
            className="w-full h-12 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest">
            Pick a different time
          </button>
          <button type="button" disabled={busy} onClick={doCancel}
            className={`w-full h-12 rounded-2xl border-2 text-xs font-black uppercase tracking-widest ${armCancel ? 'bg-red-600 border-red-600 text-white' : 'border-slate-200 text-slate-600'}`}>
            {busy ? 'Cancelling…' : armCancel ? 'Tap again to cancel my visit' : 'Cancel my visit'}
          </button>
        </div>
      )}

      {mode === 'move' && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Pick a day</p>
            {openDays === null ? (
              <p className="text-sm text-slate-500">Checking what's open…</p>
            ) : Object.keys(openDays).length === 0 ? (
              <p className="text-sm text-slate-500">Nothing open in the next three weeks — reply to your confirmation and we'll find a time.</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {Object.keys(openDays).sort().map((diso) => {
                  const d = new Date(diso + 'T00:00:00'); const sel = date === diso;
                  return (
                    <button key={diso} type="button" onClick={() => pickDay(diso)}
                      className={`h-14 rounded-2xl border-2 flex flex-col items-center justify-center ${sel ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700'}`}>
                      <span className="text-[9px] font-black uppercase tracking-widest opacity-70">{DOW[d.getDay()]}</span>
                      <span className="text-sm font-black leading-none">{MON[d.getMonth()]} {d.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {date && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Pick a time</p>
              {slots === null ? <p className="text-sm text-slate-500">Checking…</p>
                : slots.length === 0 ? <p className="text-sm text-slate-500">Nothing open that day — try another.</p>
                : (
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map((hhmm) => (
                      <button key={hhmm} type="button" onClick={() => setTime(hhmm)}
                        className={`h-10 px-3.5 rounded-full border-2 text-[10px] font-black uppercase ${time === hhmm ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600'}`}>
                        {t12(hhmm)}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )}
          <div className="space-y-2">
            <button type="button" disabled={!date || !time || busy} onClick={confirmMove}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest disabled:opacity-40">
              {busy ? 'Moving…' : 'Move my visit'}
            </button>
            <button type="button" onClick={() => { setMode('view'); setError(''); }}
              className="w-full h-12 rounded-2xl border-2 border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest">
              Keep my current time
            </button>
          </div>
        </div>
      )}
    </>
  );
}
