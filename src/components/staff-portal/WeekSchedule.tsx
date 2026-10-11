'use client';
// src/components/staff-portal/WeekSchedule.tsx — SCHEDULE in the staff app is about your WEEKS (Today covers today):
// this week or next, hours and visits at a glance, then a row per day — the shift (or off / time off), how many visits,
// how much is still open, and anything waiting on you that day (a swap someone asked for, your own request). Tap a day to
// see it in full below.
import * as React from 'react';
import { bizNow, bizKey, biz } from '@/lib/biz-clock';


const DAY = 86400000;
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const t12 = (t: string) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`; };
const mins = (s: string, e: string, b = 0) => { if (!s || !e) return 0; const [a1, a2] = s.split(':').map(Number); const [b1, b2] = e.split(':').map(Number); return Math.max(0, b1 * 60 + b2 - a1 * 60 - a2 - b); };
const ms = (v: any) => (v?.toDate ? v.toDate().getTime() : typeof v?.seconds === 'number' ? v.seconds * 1000 : Date.parse(String(v || '')));

export function WeekSchedule({ shifts, apts, requests, swapsForMe, selected, onPick, onTimeOff, onRequests, accent, layout = 'rows', onOpen }: { shifts: any[]; apts: any[]; requests: any[]; swapsForMe: any[]; selected: Date; onPick: (d: Date) => void; onTimeOff: () => void; onRequests: () => void; accent: string; layout?: 'rows' | 'columns'; onOpen?: (apt: any) => void }) {
  const [week, setWeek] = React.useState(0);
  const today = bizNow(); today.setHours(0, 0, 0, 0);   // the business's today
  const start = new Date(today.getTime() + week * 7 * DAY);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const open = (requests || []).filter((r: any) => ['pending', 'pending_swap_consent', 'pending_manager'].includes(String(r.status))).length + (swapsForMe || []).length;
  const rows = days.map((d) => {
    const k = keyOf(d);
    const shift = (shifts || []).find((s: any) => s.date === k && !['cancelled', 'draft'].includes(String(s.status)));
    const off = (requests || []).find((r: any) => r.type === 'day_off' && String(r.date || '').slice(0, 10) === k && r.status === 'approved');
    const mine = (apts || []).filter((a: any) => { const t = ms(a.startTime); return Number.isFinite(t) && bizKey(new Date(t)) === k && !['cancelled', 'canceled', 'no_show', 'expired'].includes(String(a.status)); });
    const booked = mine.reduce((x: number, a: any) => x + Math.max(0, (ms(a.endTime) - ms(a.startTime)) / 60000 || Number(a.duration) || 0), 0);
    const work = shift ? mins(shift.startTime, shift.endTime, Number(shift.breakMinutes) || 0) : 0;
    const swap = (swapsForMe || []).find((r: any) => String(r.date || '').slice(0, 10) === k);
    const mineReq = (requests || []).find((r: any) => String(r.date || '').slice(0, 10) === k && String(r.status).startsWith('pending'));
    return { d, k, shift, off, visits: mine.length, list: mine.slice().sort((a: any, b: any) => ms(a.startTime) - ms(b.startTime)), openMin: Math.max(0, work - booked), work, swap, mineReq };
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
      {layout === 'columns' ? (
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
          {rows.map((r) => { const isToday = r.k === keyOf(today);
            return (
              <div key={r.k} className="w-[132px] shrink-0 snap-start space-y-1.5">
                <button onClick={() => onPick(r.d)} className="flex w-full flex-col items-center rounded-[14px] py-1.5" style={r.k === selKey ? { background: '#f1f1f3' } : undefined}>
                  <span className="text-[11px] font-semibold uppercase text-[#6d7075]">{r.d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-extrabold" style={isToday ? { background: accent, color: '#fff' } : undefined}>{r.d.getDate()}</span>
                  <span className="text-[10.5px] text-[#6d7075]">{r.off ? 'Time off' : r.shift ? `${t12(r.shift.startTime)}–${t12(r.shift.endTime)}` : 'Off'}</span>
                </button>
                {r.swap && <div className="rounded-[10px] bg-violet-100 px-2 py-1 text-center text-[11px] font-bold text-violet-700">Swap asked</div>}
                {r.list.map((a: any) => <MiniCard key={a.id} a={a} onOpen={onOpen} />)}
                {!r.list.length && !r.off && r.shift && <div className="rounded-[10px] border border-dashed border-[#e6e6e8] px-2 py-2 text-center text-[11px] text-[#9a9ca1]">Open all day</div>}
              </div>); })}
        </div>
      ) : (
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
      </div>)}
    </div>);
}

/** A visit as a small planner card: the left edge carries the state like the planner (booked, in the chair, money owed,
 *  ready to pay, finished, requested), plus the client's status and any running-behind or fix flag. */
export function MiniCard({ a, onOpen }: { a: any; onOpen?: (apt: any) => void }) {
  const st = String(a.status || ''); const ci = String(a.checkInStatus || '');
  const edge = st === 'ready_for_checkout' ? '#1f7a4d' : ['deposit_pending', 'pending_payment'].includes(st) ? '#b45309' : ['completed', 'cancelled', 'no_show'].includes(st) ? '#c7cad1' : st === 'requested' ? '#9a9ca1' : '#16171a';
  const late = Number.isFinite(ms(a.expectedStartAt)) && ms(a.expectedStartAt) - ms(a.startTime) >= 5 * 60000 ? Math.round((ms(a.expectedStartAt) - ms(a.startTime)) / 60000) : 0;
  const t = biz(new Date(ms(a.startTime))).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase();
  return (
    <button onClick={() => onOpen?.(a)} className="block w-full rounded-[10px] border border-[#ececee] bg-white py-1.5 pl-2 pr-1.5 text-left" style={{ borderLeft: `3px ${st === 'requested' ? 'dashed' : 'solid'} ${edge}`, opacity: ['cancelled', 'no_show'].includes(st) ? 0.55 : 1 }}>
      <span className="block text-[11.5px] font-bold leading-tight">{t} · {String(a.clientName || 'Guest').split(' ')[0]}</span>
      <span className="block truncate text-[10.5px] text-[#6d7075]">{a.serviceName || ''}</span>
      <span className="mt-0.5 flex flex-wrap gap-1">
        {st === 'servicing' && <span className="rounded bg-[#16171a] px-1 text-[9px] font-bold text-white">In the chair</span>}
        {ci === 'arrived' && st !== 'servicing' && <span className="rounded bg-emerald-600 px-1 text-[9px] font-bold text-white">Here</span>}
        {ci === 'running_late' && <span className="rounded bg-amber-500 px-1 text-[9px] font-bold text-white">Late</span>}
        {ci === 'on_my_way' && <span className="rounded bg-blue-500 px-1 text-[9px] font-bold text-white">En route</span>}
        {late > 0 && st !== 'servicing' && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800">+{late} min</span>}
        {(a.isRedo || a.fixBrief) && <span className="rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-800">Fix</span>}
        {a.isEscalated && <span className="rounded bg-red-100 px-1 text-[9px] font-bold text-red-700">Escalated</span>}
      </span>
    </button>);
}

/** MONTH, for planning: each day shaded by how full it is (booked time against the shift), time off hatched, days off
 *  blank, events ringed. Tap a day to open it. */
export function MonthPlanner({ shifts, apts, requests, events, staffId, selected, onPick, accent }: { shifts: any[]; apts: any[]; requests: any[]; events: any[]; staffId: string; selected: Date; onPick: (d: Date) => void; accent: string }) {
  const [off, setOff] = React.useState(0);
  const base = bizNow(); base.setDate(1); base.setHours(0, 0, 0, 0); const m0 = new Date(base.getFullYear(), base.getMonth() + off, 1);
  const days = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate(); const lead = m0.getDay(); const todayK = bizKey();
  const cells: (null | { d: Date; k: string; level: number; timeOff: boolean; dayOff: boolean; event: string | null; visits: number })[] = Array.from({ length: lead }, () => null);
  let total = 0;
  for (let i = 1; i <= days; i++) {
    const d = new Date(m0.getFullYear(), m0.getMonth(), i); const k = keyOf(d);
    const shift = (shifts || []).find((s: any) => s.date === k && !['cancelled', 'draft'].includes(String(s.status)));
    const timeOff = (requests || []).some((r: any) => r.type === 'day_off' && String(r.date || '').slice(0, 10) === k && r.status === 'approved');
    const mine = (apts || []).filter((a: any) => { const t = ms(a.startTime); return Number.isFinite(t) && bizKey(new Date(t)) === k && !['cancelled', 'canceled', 'no_show', 'expired'].includes(String(a.status)); });
    const booked = mine.reduce((x: number, a: any) => x + Math.max(0, (ms(a.endTime) - ms(a.startTime)) / 60000 || Number(a.duration) || 0), 0);
    const work = shift ? mins(shift.startTime, shift.endTime, Number(shift.breakMinutes) || 0) : 0;
    const ratio = work ? booked / work : mine.length ? 1 : 0;
    const ev = (events || []).find((e: any) => { const ids: string[] = e.staffIds || []; if (ids.length && !ids.includes(staffId)) return false; const t = ms(e.startTime || e.date || e.start); return Number.isFinite(t) && bizKey(new Date(t)) === k; });
    total += mine.length;
    cells.push({ d, k, level: ratio >= 0.85 ? 3 : ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0, timeOff, dayOff: !shift && !mine.length, event: ev ? String(ev.title || ev.name || 'Event') : null, visits: mine.length });
  }
  const sel = cells.find((c) => c && c.k === keyOf(selected));
  const shade = (l: number) => (l === 3 ? accent : l === 2 ? `${accent}80` : l === 1 ? `${accent}30` : '#f1f1f3');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-[20px] font-extrabold">{m0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
        <span className="flex items-center gap-1 text-[13px] text-[#6d7075]">{total} visits<button aria-label="Previous month" onClick={() => setOff(off - 1)} className="ml-2 h-8 w-8 rounded-full bg-[#f1f1f3]">‹</button><button aria-label="Next month" onClick={() => setOff(off + 1)} className="h-8 w-8 rounded-full bg-[#f1f1f3]">›</button></span></div>
      <div className="grid grid-cols-7 gap-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i} className="text-center text-[11px] font-bold text-[#9a9ca1]">{w}</span>)}
        {cells.map((c, i) => !c ? <span key={`e${i}`} /> : (
          <button key={c.k} onClick={() => onPick(c.d)} aria-label={`${c.d.toDateString()}: ${c.timeOff ? 'time off' : c.dayOff ? 'not working' : `${c.visits} visits`}${c.event ? `, ${c.event}` : ''}`}
            className="aspect-square rounded-[10px] text-[13px] font-semibold"
            style={{ background: c.timeOff ? 'repeating-linear-gradient(45deg,#f1f1f3,#f1f1f3 3px,#fff 3px,#fff 6px)' : c.dayOff ? 'transparent' : shade(c.level), color: c.level === 3 && !c.timeOff && !c.dayOff ? '#fff' : c.dayOff || c.timeOff ? '#9a9ca1' : '#16171a', boxShadow: c.event ? 'inset 0 0 0 2px #d49a3a' : undefined, outline: c.k === todayK ? '2px solid #16171a' : undefined, outlineOffset: 1 }}>{c.d.getDate()}</button>))}
      </div>
      <div className="flex flex-wrap gap-3 text-[12px] text-[#6d7075]">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: accent }} />Full</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: `${accent}30` }} />Open time</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: 'repeating-linear-gradient(45deg,#e6e6e8,#e6e6e8 2px,#fff 2px,#fff 4px)' }} />Time off</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ boxShadow: 'inset 0 0 0 2px #d49a3a' }} />Event</span>
      </div>
      {sel && <div className="rounded-[16px] border border-[#ececee] bg-white p-3 text-[14px]"><b>{sel.d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</b> · {sel.timeOff ? 'Time off' : sel.dayOff ? 'Not working' : `${sel.visits} visit${sel.visits === 1 ? '' : 's'}`}{sel.event ? ` · ${sel.event}` : ''}<p className="text-[12.5px] text-[#6d7075]">Tap the day again, or switch to Day, to see it hour by hour.</p></div>}
    </div>);
}
