"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader, AlertTriangle, CheckCircle2, Armchair, Clock, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Desk availability ───────────────────────────────────────────────────────
// One question, one screen: what's free, when, and how much.
//
// Every number here comes from the SERVER, computed by the same functions the
// public booking page uses. Nothing about availability or price is worked out
// in this component — the moment it were, the desk's answer and the customer's
// screen could disagree about the same chair, and the desk would be wrong in
// front of someone standing at the counter.
//
// Unpaid holds are shown, not hidden. Someone mid-checkout on the public page
// has a real claim for a few more minutes; a desk that cannot see that will
// sell the chair out from under them and find out at the worst moment.

type Busy = { start: string; end: string; kind: 'booked' | 'hold' | 'lease'; who: string; wholeDay: boolean; expiresInMin: number | null };
type Booth = {
  id: string; name: string; openTime: string; closeTime: string;
  hourlyCents: number | null; dailyCents: number | null; minHours: number;
  closedToday: boolean; dayTaken: boolean; busy: Busy[];
  outOfService?: boolean; maintenanceNote?: string | null;
};

const money = (c: number | null) => (c === null || c === undefined ? '—' : `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`);
const toMin = (t: string) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const fmt12 = (t: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return t || '';
  const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]}${h < 12 ? 'a' : 'p'}`;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()], num: d.getUTCDate() };
};

export function DeskAvailabilityPanel({ tenantId, staffId, staffName, onAddToTicket }: {
  tenantId: string;
  staffId?: string | null;
  staffName?: string | null;
  onAddToTicket?: (line: { label: string; amountCents: number; reservationId: string }) => void;
}) {
  const { toast } = useToast();
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const [date, setDate] = useState(today);
  const [booths, setBooths] = useState<Booth[] | null>(null);
  const [tourSlots, setTourSlots] = useState<string[] | null>(null);
  const [tourMins, setTourMins] = useState(30);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState<any>(null);
  const [busySaving, setBusySaving] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true); setErr('');
    try {
      const [a, t] = await Promise.all([
        fetch('/api/booths/reserve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'desk-availability', tenantId, date: d }),
        }).then((r) => r.json()),
        fetch('/api/booths/kiosk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tour-slots', tenantId, date: d }),
        }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (!a.ok) { setErr(a.error || 'Could not load availability.'); setBooths([]); }
      else setBooths(a.booths || []);
      setTourSlots(t?.ok ? (t.slots || []) : []);
      if (t?.durationMins) setTourMins(t.durationMins);
    } catch { setErr('Could not reach the server.'); setBooths([]); }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { if (tenantId) load(date); }, [tenantId, date, load]);

  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);

  const submit = async () => {
    if (!form?.name?.trim()) { setErr('Give a name for the booking.'); return; }
    setBusySaving(true); setErr('');
    try {
      const res = await fetch('/api/booths/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'desk-book', tenantId, date, boothId: form.boothId,
          bookingType: form.bookingType, startTime: form.startTime, endTime: form.endTime,
          name: form.name.trim(), phone: form.phone || '', email: form.email || '',
          paid: form.paid !== false, staffId: staffId || null, staffName: staffName || null,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setErr(d.error || 'That did not go through.'); setBusySaving(false); load(date); return; }
      toast({
        title: 'Booked',
        description: `${form.name.trim()} — ${d.boothName}, ${d.unitsLabel}. ${d.bookable ? 'They are bookable for that window.' : ''}`.trim(),
      });
      if (form.paid === false && onAddToTicket) {
        onAddToTicket({ label: `${d.boothName} — ${d.unitsLabel}`, amountCents: d.amountCents, reservationId: d.reservationId });
      }
      setForm(null); load(date);
    } catch { setErr('Could not reach the server.'); }
    setBusySaving(false);
  };

  const openBook = (b: Booth, type: 'hourly' | 'daily', start?: string, end?: string) => {
    setErr('');
    setForm({
      boothId: b.id, boothName: b.name, bookingType: type,
      startTime: start || b.openTime, endTime: end || b.closeTime,
      name: '', phone: '', email: '', paid: true,
    });
  };

  const sellable = (booths || []).filter((b) => !b.closedToday);

  return (
    <Card className="rounded-[2rem] border-2">
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-5 pb-3">
        <div>
          <CardTitle className="text-[11px] font-black uppercase tracking-widest">What&apos;s free</CardTitle>
          <p className="text-[11px] font-bold text-muted-foreground mt-0.5">Tours, hourly and day rentals — bookable from here.</p>
        </div>
        <button onClick={() => load(date)} aria-label="Refresh availability"
          className="shrink-0 w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 active:scale-95 transition-all">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </CardHeader>

      <CardContent className="space-y-5 p-5 pt-0">
        <div className="grid grid-cols-7 gap-1.5">
          {dates.map((d) => {
            const l = dayLabel(d);
            const on = d === date;
            return (
              <button key={d} onClick={() => { setDate(d); setForm(null); }}
                className={cn('rounded-2xl py-2 text-center transition-all active:scale-95',
                  on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}>
                <span className="block text-[9px] font-black uppercase tracking-widest opacity-70">{l.dow}</span>
                <span className="block text-sm font-black">{l.num}</span>
              </button>
            );
          })}
        </div>

        {loading && !booths ? (
          <div className="flex items-center gap-2 py-6 text-slate-400">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="text-[11px] font-black uppercase tracking-widest">Checking the floor…</span>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Tour slots{tourSlots && tourSlots.length > 0 ? ` · ${tourMins} min` : ''}
              </p>
              {!tourSlots || tourSlots.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-500">No tour times open that day.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tourSlots.map((t) => (
                    <span key={t} className="px-3 py-2 rounded-xl border-2 border-slate-200 text-[11px] font-black text-slate-700">
                      {fmt12(t)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Spaces</p>
              {sellable.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-500">
                  Nothing rentable that day. Spaces appear here once day use is on and a rate is set.
                </p>
              ) : sellable.map((b) => {
                const openM = toMin(b.openTime); const closeM = toMin(b.closeTime);
                const span = Math.max(1, closeM - openM);
                if (b.outOfService) {
                  return (
                    <div key={b.id} className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-[12px] font-black text-rose-900 truncate">
                          <Armchair className="w-3.5 h-3.5 shrink-0" />{b.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-rose-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-rose-900">
                          Out of service
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-bold text-rose-800">
                        {b.maintenanceNote || 'A blocking maintenance ticket is open.'} Not bookable until it&apos;s resolved.
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={b.id} className="rounded-2xl border-2 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-[12px] font-black text-slate-900 truncate">
                        <Armchair className="w-3.5 h-3.5 text-slate-400 shrink-0" />{b.name}
                      </span>
                      <span className="text-[11px] font-bold text-slate-500 shrink-0">
                        {b.hourlyCents !== null ? `${money(b.hourlyCents)}/hr` : ''}
                        {b.hourlyCents !== null && b.dailyCents !== null ? ' · ' : ''}
                        {b.dailyCents !== null ? `${money(b.dailyCents)}/day` : ''}
                      </span>
                    </div>

                    <div className="relative h-7 rounded-xl overflow-hidden border-2 border-slate-100 bg-emerald-50">
                      {b.busy.map((x, i) => {
                        const s = Math.max(openM, toMin(x.start)); const e = Math.min(closeM, toMin(x.end));
                        if (e <= s) return null;
                        return (
                          <span key={i} title={`${x.who} · ${fmt12(x.start)}–${fmt12(x.end)}`}
                            className={cn('absolute top-0 bottom-0',
                              x.kind === 'hold' ? 'bg-amber-200' : x.kind === 'lease' ? 'bg-slate-200' : 'bg-slate-300')}
                            style={{ left: `${((s - openM) / span) * 100}%`, width: `${((e - s) / span) * 100}%` }} />
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-slate-400">
                        {fmt12(b.openTime)}–{fmt12(b.closeTime)}
                        {b.busy.some((x) => x.kind === 'hold')
                          ? ` · hold expires in ${b.busy.find((x) => x.kind === 'hold')?.expiresInMin}m` : ''}
                      </span>
                      <span className="flex gap-1.5 shrink-0">
                        {b.hourlyCents !== null && (
                          <button onClick={() => openBook(b, 'hourly')}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all">
                            Hourly
                          </button>
                        )}
                        {b.dailyCents !== null && (
                          <button onClick={() => openBook(b, 'daily')} disabled={b.dayTaken}
                            className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all',
                              b.dayTaken ? 'bg-slate-100 text-slate-400' : 'bg-slate-900 text-white active:scale-95')}>
                            {b.dayTaken ? 'Day taken' : 'Full day'}
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3 text-[10px] font-bold text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-100" />free</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300" />booked</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200" />unpaid hold</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />resident renter</span>
            </div>
          </>
        )}

        {form && (
          <div className="rounded-2xl border-2 p-4 space-y-3">
            <p className="text-[12px] font-black text-slate-900">
              {form.boothName} · {form.bookingType === 'hourly' ? 'hourly' : 'full day'}
            </p>
            {form.bookingType === 'hourly' && (
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <label htmlFor="dk-start" className="sr-only">Start time</label>
                <input id="dk-start" type="time" value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="px-2 py-2 rounded-xl border-2 text-sm font-bold" />
                <span className="text-[11px] font-bold text-slate-400">to</span>
                <label htmlFor="dk-end" className="sr-only">End time</label>
                <input id="dk-end" type="time" value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="px-2 py-2 rounded-xl border-2 text-sm font-bold" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              <label htmlFor="dk-name" className="sr-only">Guest name</label>
              <input id="dk-name" value={form.name} placeholder="Name"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border-2 text-sm font-bold" />
              <label htmlFor="dk-phone" className="sr-only">Phone</label>
              <input id="dk-phone" value={form.phone} placeholder="Phone (optional)"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border-2 text-sm font-bold" />
            </div>
            <button onClick={() => setForm({ ...form, paid: form.paid === false })}
              className="w-full flex items-center justify-between gap-3 rounded-xl border-2 p-3 text-left">
              <span className="text-[12px] font-black text-slate-900">
                {form.paid === false ? 'Add to the ticket' : 'Paid now'}
              </span>
              <span className={cn('rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                form.paid === false ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                {form.paid === false ? 'Unpaid' : 'Paid'}
              </span>
            </button>
            {err && (
              <div className="flex items-start gap-2 text-red-600">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-[11px] font-bold">{err}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busySaving}
                className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
                {busySaving ? 'Booking…' : 'Book it'}
              </button>
              <button onClick={() => { setForm(null); setErr(''); }}
                className="px-5 py-3 rounded-2xl bg-slate-100 text-slate-600 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all">
                Cancel
              </button>
            </div>
            <p className="text-[10px] font-bold text-slate-400 flex items-start gap-1.5">
              <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
              Checked against live bookings and resident leases when you tap Book it, not when this loaded.
            </p>
          </div>
        )}

        {err && !form && (
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-[11px] font-bold">{err}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
