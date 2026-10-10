'use client';
// src/components/staff-portal/WeekSchedule.tsx — SCHEDULE in the staff app is about your WEEKS (Today covers today):
// this week or next, hours and visits at a glance, then a row per day — the shift (or off / time off), how many visits,
// how much is still open, and anything waiting on you that day (a swap someone asked for, your own request). Tap a day to
// see it in full below.
import * as React from 'react';

const DAY = 86400000;
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const t12 = (t: string) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`; };
const mins = (s: string, e: string, b = 0) => { if (!s || !e) return 0; const [a1, a2] = s.split(':').map(Number); const [b1, b2] = e.split(':').map(Number); return Math.max(0, b1 * 60 + b2 - a1 * 60 - a2 - b); };
const ms = (v: any) => (v?.toDate ? v.toDate().getTime() : typeof v?.seconds === 'number' ? v.seconds * 1000 : Date.parse(String(v || '')));

export function WeekSchedule({ shifts, apts, requests, swapsForMe, selected, onPick, onTimeOff, onRequests, accent }: { shifts: any[]; apts: any[]; requests: any[]; swapsForMe: any[]; selected: Date; onPick: (d: Date) => void; onTimeOff: () => void; onRequests: () => void; accent: string }) {
  const [week, setWeek] = React.useState(0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() + week * 7 * DAY);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const open = (requests || []).filter((r: any) => ['pending', 'pending_swap_consent', 'pending_manager'].includes(String(r.status))).length + (swapsForMe || []).length;
  const rows = days.map((d) => {
    const k = keyOf(d);
    const shift = (shifts || []).find((s: any) => s.date === k && !['cancelled', 'draft'].includes(String(s.status)));
    const off = (requests || []).find((r: any) => r.type === 'day_off' && String(r.date || '').slice(0, 10) === k && r.status === 'approved');
    const mine = (apts || []).filter((a: any) => { const t = ms(a.startTime); return Number.isFinite(t) && keyOf(new Date(t)) === k && !['cancelled', 'canceled', 'no_show', 'expired'].includes(String(a.status)); });
    const booked = mine.reduce((x: number, a: any) => x + Math.max(0, (ms(a.endTime) - ms(a.startTime)) / 60000 || Number(a.duration) || 0), 0);
    const work = shift ? mins(shift.startTime, shift.endTime, Number(shift.breakMinutes) || 0) : 0;
    const swap = (swapsForMe || []).find((r: any) => String(r.date || '').slice(0, 10) === k);
    const mineReq = (requests || []).find((r: any) => String(r.date || '').slice(0, 10) === k && String(r.status).startsWith('pending'));
    return { d, k, shift, off, visits: mine.length, openMin: Math.max(0, work - booked), work, swap, mineReq };
  });
  const hours = rows.reduce((x, r) => x + r.work, 0) / 60; const visits = rows.reduce((x, r) => x + r.visits, 0);
  const selKey = keyOf(selected);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-[#f1f1f3] p-1">{['This week', 'Next week'].map((l, i) => <button key={l} onClick={() => setWeek(i)} className="h-9 rounded-full px-4 text-[14px] font-semibold" style={week === i ? { background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: '#6d7075' }}>{l}</button>)}</div>
        <button onClick={onRequests} className="h-9 rounded-full border border-[#e6e6e8] px-3.5 text-[13px] font-semibold">Requests{open ? ` · ${open}` : ''}</button>
      </div>
      <div className="flex items-end justify-between gap-3 rounded-[22px] p-4 text-white" style={{ background: accent }}>
        <div><p className="text-[30px] font-extrabold leading-none">{hours % 1 ? hours.toFixed(1) : hours} h</p><p className="mt-1 text-[13px] opacity-85">scheduled · {visits} visit{visits === 1 ? '' : 's'} booked</p></div>
        <button onClick={onTimeOff} className="h-10 shrink-0 rounded-full bg-white/20 px-4 text-[13.5px] font-semibold">Ask for time off</button>
      </div>
      <div className="overflow-hidden rounded-[22px] border border-[#ececee] bg-white divide-y divide-[#f0f0f2]">
        {rows.map((r) => { const isToday = r.k === keyOf(today); const on = r.k === selKey;
          const sub = r.off ? 'Time off · approved' : !r.shift ? (r.visits ? `${r.visits} visit${r.visits === 1 ? '' : 's'} · no shift set` : 'Not working') : `${r.visits} visit${r.visits === 1 ? '' : 's'}${r.openMin >= 30 ? ` · ${r.openMin >= 90 ? `${Math.round(r.openMin / 60)} h` : `${r.openMin} min`} open` : ' · full'}`;
          return (
            <button key={r.k} onClick={() => onPick(r.d)} className="flex w-full items-center gap-3 px-4 py-3 text-left" style={on ? { background: '#f7f7f8' } : undefined}>
              <span className="flex w-11 shrink-0 flex-col items-center"><span className="text-[11px] font-semibold uppercase text-[#6d7075]">{r.d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-[16px] font-extrabold" style={isToday ? { background: accent, color: '#fff' } : undefined}>{r.d.getDate()}</span></span>
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{r.off ? 'Time off' : r.shift ? `${t12(r.shift.startTime)} – ${t12(r.shift.endTime)}` : 'Off'}</span>
                <span className="block truncate text-[13px] text-[#6d7075]">{sub}</span></span>
              {r.swap && <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-[11.5px] font-bold text-violet-700">Swap?</span>}
              {!r.swap && r.mineReq && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-bold text-amber-800">Asked</span>}
              {isToday && !r.swap && !r.mineReq && <span className="shrink-0 text-[12px] font-bold" style={{ color: accent }}>Today</span>}
            </button>); })}
      </div>
    </div>);
}
