'use client';
// src/components/staff/TimesheetsScreen.tsx — HOURS, WHAT NEEDS YOU FIRST (Team › Time and /timesheets; design board
// "Timesheets and Gusto", A). What waits for a manager before payday (forgotten clock-outs, ones the person has asked to
// fix, shifts waiting for approval, overtime coming), then each person's week: hours against the schedule, the days,
// and each shift with what it needs. The page (app/(app)/timesheets/page.tsx) works everything out from the time clock
// (lib/timeclock) and hands it in; this screen lays it out and hands the taps back.
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#eaf6ef', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`;
const solid = { background: INK, color: '#fff' }; const plain = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
const card = 'rounded-3xl bg-[#fff] px-5 pb-3 pt-4';
const field = `h-11 rounded-xl bg-[#fff] px-3 text-[15px] ${RING}`;

export type Shift = {
  key: string; dayKey: string; inAt: Date; outAt: Date | null; breakMinutes: number; paidBreakMinutes: number; workedMinutes: number;
  hourlyMinutes: number; splitTime: boolean; status: 'pending' | 'approved' | 'rejected' | 'active'; missingOut: boolean; outOfZone: boolean;
  notes: string[]; managerNote: string; approvedBy: string; canReview: boolean;
};
export type Day = { dayKey: string; workedMinutes: number; scheduledMinutes: number; noShow: boolean; later: boolean };
export type PersonWeek = {
  id: string; name: string; contractor: boolean; days: Day[]; shifts: Shift[];
  workedMinutes: number; scheduledMinutes: number; overtimeMinutes: number; projectedOvertime: number; waiting: number; missing: number; noShows: number;
};
/** A forgotten clock-out the person has said when they left (lib/clock-fix). */
export type ClockFix = { id: string; staffId?: string; staffName: string; inAt: string; outAt: string; note?: string; dayKey?: string };
export type Needs = {
  missing: { staffId: string; name: string; shift: Shift }[];
  waiting: { staffId: string; name: string; shifts: Shift[] }[];
  overtime: { staffId: string; name: string; projected: number; worked: number; scheduled: number }[];
};

/** "8h 42m", "10h", "45m". */
export const hm = (min: number) => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`; };
/** "38 hours", "37.5 hours". */
export const hoursWords = (min: number) => { const h = Math.round((min / 60) * 10) / 10; return `${h.toLocaleString('en-US')} hour${h === 1 ? '' : 's'}`; };
const dayDate = (k: string) => new Date(`${k}T12:00:00`);
const weekday = (k: string) => dayDate(k).toLocaleDateString('en-US', { weekday: 'long' });
const dayShort = (k: string) => `${dayDate(k).toLocaleDateString('en-US', { weekday: 'short' })} ${dayDate(k).getDate()}`;
const dayLong = (k: string) => dayDate(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
/** "November 16 to 22", "November 30 to December 6". */
export function weekWords(fromKey: string, toKey: string, now = new Date()): string {
  const a = dayDate(fromKey), b = dayDate(toKey); const M = (d: Date) => d.toLocaleDateString('en-US', { month: 'long' });
  const yr = b.getFullYear() !== now.getFullYear() ? `, ${b.getFullYear()}` : '';
  return a.getMonth() === b.getMonth() ? `${M(a)} ${a.getDate()} to ${b.getDate()}${yr}` : `${M(a)} ${a.getDate()} to ${M(b)} ${b.getDate()}${yr}`;
}
/** A shift in words: "Monday, 8:00 AM to 5:12 PM, a 30 minute break". */
export function shiftWords(s: Shift, time: (d: Date) => string): string {
  const out = s.outAt ? time(s.outAt) : s.missingOut ? 'no clock-out' : 'still on the clock';
  const br = s.breakMinutes > 0 ? `, a ${s.breakMinutes} minute break${s.paidBreakMinutes > 0 ? ` (${s.paidBreakMinutes} paid)` : ''}` : '';
  return `${weekday(s.dayKey)}, ${time(s.inAt)} to ${out}${br}`;
}
const STATUS: Record<Shift['status'], string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Not approved', active: 'On the clock' };

export type TimesheetsScreenProps = {
  weekFrom: string; weekTo: string; isThisWeek: boolean; onWeek: (step: -1 | 1) => void; onThisWeek: () => void;
  /** The pay period the week is in, and its payday. */
  period: { from: string; to: string; payday: string } | null;
  people: PersonWeek[]; needs: Needs; fixes: ClockFix[];
  time: (d: Date) => string; busy: boolean;
  onApprove: (staffId: string, shifts: Shift[]) => void;
  onDecideFix: (fix: ClockFix, approve: boolean, outTime: string, note: string) => void;
  /** Opens a shift: to look at it and approve it, or to change its times (a forgotten clock-out). */
  onOpen: (staffId: string, name: string, shift: Shift, change: boolean) => void;
  onDownload: () => void;
  now?: Date;
};

export function TimesheetsScreen(p: TimesheetsScreenProps) {
  const now = p.now || new Date();
  const [open, setOpen] = React.useState<string | null>(null);
  const [fixTimes, setFixTimes] = React.useState<Record<string, string>>({});
  const [declining, setDeclining] = React.useState<string | null>(null); const [why, setWhy] = React.useState('');
  const total = p.people.reduce((n, x) => n + x.workedMinutes, 0), ot = p.people.reduce((n, x) => n + x.overtimeMinutes, 0);
  const count = p.fixes.length + p.needs.missing.length + p.needs.waiting.length + p.needs.overtime.length;
  const paydayWords = p.period ? dayDate(p.period.payday).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
  const hhmm = (iso: string) => { const x = new Date(iso); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
  const t = (iso: string) => p.time(new Date(iso));

  const Item = ({ title, sub, warn, children }: { title: React.ReactNode; sub: React.ReactNode; warn?: boolean; children?: React.ReactNode }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
      <span className="min-w-[220px] flex-1"><span className="block text-[15px]">{title}</span><span className="block text-[13px]" style={{ color: warn ? AMBER : MUTED }}>{sub}</span></span>
      {children && <span className="flex flex-wrap gap-2">{children}</span>}
    </div>
  );

  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight">Hours</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>Approved hours are paid on payday. Fix and approve them here.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => p.onWeek(-1)} aria-label="The week before" className={`flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={plain}><ChevronLeft className="h-5 w-5" /></button>
          <span className="px-1 text-[15px] font-semibold">{weekWords(p.weekFrom, p.weekTo, now)}</span>
          <button type="button" onClick={() => p.onWeek(1)} aria-label="The week after" className={`flex h-11 w-11 items-center justify-center rounded-full ${RING}`} style={plain}><ChevronRight className="h-5 w-5" /></button>
          {!p.isThisWeek && <button type="button" onClick={p.onThisWeek} className={btn} style={plain}>This week</button>}
          <button type="button" onClick={p.onDownload} disabled={!p.people.some((x) => x.shifts.length)} className={btn} style={plain}>Download the hours</button>
        </div>
      </div>

      <section aria-label="Before payday" className={card} style={{ border: `1px solid ${LINE}` }}>
        <h2 className="text-[17px] font-semibold">Before payday</h2>
        <p className="pb-1 text-[14px]" style={{ color: MUTED }}>
          {p.period ? `The pay period is ${weekWords(p.period.from, p.period.to, now)}, paid ${paydayWords}. ` : ''}
          {count ? `${count === 1 ? 'One thing waits' : `${count} things wait`} for you.` : 'Nothing waits for you: every shift is approved.'}
        </p>
        {p.fixes.map((f) => (
          <Item key={`fix-${f.id}`} title={`${f.staffName} forgot to clock out on ${dayLong(f.dayKey || f.inAt.slice(0, 10))}`} sub={`Clocked in at ${t(f.inAt)}, and says they left at ${t(f.outAt)}${f.note ? `: “${f.note}”` : '.'}`}>
            {declining === f.id ? <>
              <label className="flex min-w-[220px] flex-1 flex-col text-[13px]" style={{ color: MUTED }}>Why not (they’ll see this)
                <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} className={field} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
              <button type="button" disabled={p.busy || !why.trim()} onClick={() => { p.onDecideFix(f, false, '', why.trim()); setDeclining(null); setWhy(''); }} className={btn} style={solid}>Send it back</button>
              <button type="button" onClick={() => { setDeclining(null); setWhy(''); }} className={btn} style={plain}>Keep it</button>
            </> : <>
              <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>Left at
                <input type="time" value={fixTimes[f.id] ?? hhmm(f.outAt)} onChange={(e) => setFixTimes((x) => ({ ...x, [f.id]: e.target.value }))} aria-label={`When ${f.staffName} left`} className={field} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
              <button type="button" disabled={p.busy} onClick={() => { setDeclining(f.id); setWhy(''); }} className={btn} style={plain}>Don’t approve</button>
              <button type="button" disabled={p.busy} onClick={() => p.onDecideFix(f, true, fixTimes[f.id] ?? hhmm(f.outAt), '')} className={btn} style={solid}>Approve</button>
            </>}
          </Item>
        ))}
        {p.needs.missing.map((m) => (
          <Item key={`miss-${m.shift.key}`} title={`${m.name} forgot to clock out on ${weekday(m.shift.dayKey)}`} sub={`Clocked in at ${p.time(m.shift.inAt)}. Not paid until the clock-out is added.`} warn>
            <button type="button" disabled={p.busy} onClick={() => p.onOpen(m.staffId, m.name, m.shift, true)} className={btn} style={solid}>Add the clock-out</button>
          </Item>
        ))}
        {p.needs.waiting.map((w) => (
          <Item key={`wait-${w.staffId}`} title={`${w.name} has ${w.shifts.length === 1 ? 'a shift' : `${w.shifts.length} shifts`} waiting for approval`} sub={w.shifts.slice(0, 3).map((s) => `${weekday(s.dayKey)} ${p.time(s.inAt)} to ${s.outAt ? p.time(s.outAt) : ''}`).join(', ') + (w.shifts.length > 3 ? `, and ${w.shifts.length - 3} more` : '')}>
            <button type="button" onClick={() => { setOpen(w.staffId); document.getElementById(`ts-${w.staffId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={btn} style={plain}>Look at {w.shifts.length === 1 ? 'it' : 'them'}</button>
            <button type="button" disabled={p.busy} onClick={() => p.onApprove(w.staffId, w.shifts)} className={btn} style={solid}>{w.shifts.length === 1 ? 'Approve' : w.shifts.length === 2 ? 'Approve both' : `Approve all ${w.shifts.length}`}</button>
          </Item>
        ))}
        {p.needs.overtime.map((o) => (
          <Item key={`ot-${o.staffId}`} title={`${o.name} is on track for ${hoursWords(o.projected)} of overtime`} sub={`${hoursWords(o.worked)} so far and ${hoursWords(o.scheduled)} more on the schedule this week. Overtime is paid at time and a half.`} />
        ))}
      </section>

      <section aria-label="Your team this week" className={card} style={{ border: `1px solid ${LINE}` }}>
        <h2 className="text-[17px] font-semibold">Your team this week</h2>
        <p className="pb-1 text-[14px]" style={{ color: MUTED }}>{p.people.length ? `${hoursWords(total)} worked${ot > 0 ? `, ${hoursWords(ot)} of them overtime` : ''}.` : 'Nobody is on the team yet.'}</p>
        {p.people.map((x) => {
          const isOpen = open === x.id;
          const pill = x.missing ? { text: `${x.missing} to fix`, bg: AMBER_TINT, fg: AMBER } : x.waiting ? { text: `${x.waiting} waiting`, bg: AMBER_TINT, fg: AMBER }
            : x.shifts.length ? { text: 'All approved', bg: GREEN_TINT, fg: GREEN } : null;
          const sub = x.scheduledMinutes > 0 ? `${hoursWords(x.workedMinutes)} of ${hoursWords(x.scheduledMinutes)} scheduled` : x.shifts.length ? `${hoursWords(x.workedMinutes)} worked` : 'No shifts this week';
          return (
            <div key={x.id} id={`ts-${x.id}`} className="scroll-mt-24" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex min-h-[64px] items-center gap-3 py-2">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px]" style={{ background: SOFT, color: MUTED }}>{(x.name || '?').charAt(0)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold">{x.name}{x.contractor && <span className="rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: SOFT, color: MUTED }}>Contractor</span>}
                    {pill && <span className="rounded-full px-2.5 py-0.5 text-[12px] font-medium sm:hidden" style={{ background: pill.bg, color: pill.fg }}>{pill.text}</span>}</span>
                  <span className="block text-[13px]" style={{ color: MUTED }}>{sub}{x.overtimeMinutes > 0 ? `, ${hoursWords(x.overtimeMinutes)} overtime` : ''}{x.noShows > 0 ? `, ${x.noShows} scheduled ${x.noShows === 1 ? 'shift' : 'shifts'} with no clock-in` : ''}{x.contractor && x.shifts.length ? '. Paid what they worked, with no overtime' : ''}</span>
                </span>
                {pill && <span className="hidden shrink-0 rounded-full px-3 py-1.5 text-[13px] sm:inline" style={{ background: pill.bg, color: pill.fg }}>{pill.text}</span>}
                {x.shifts.length > 0 && <button type="button" onClick={() => setOpen(isOpen ? null : x.id)} aria-expanded={isOpen} className={`${btn} shrink-0`} style={plain}>{isOpen ? 'Hide' : 'Shifts'}<span className="sr-only"> for {x.name}</span></button>}
              </div>
              {isOpen && (
                <div className="pb-3 sm:pl-[52px]">
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {x.days.map((d) => { const noOut = x.shifts.some((s) => s.dayKey === d.dayKey && s.missingOut); return (
                      <div key={d.dayKey} className="rounded-2xl px-2.5 py-2" style={d.workedMinutes > 0 ? { background: SOFT } : noOut ? { background: AMBER_TINT } : { border: `1px ${d.later && d.scheduledMinutes > 0 ? 'dashed' : 'solid'} ${LINE}` }}>
                        <span className="block text-[12px]" style={{ color: MUTED }}>{dayShort(d.dayKey)}</span>
                        <span className="block text-[14px] tabular-nums" style={{ color: d.noShow || (noOut && !d.workedMinutes) ? AMBER : d.workedMinutes > 0 ? INK : MUTED, fontWeight: d.workedMinutes > 0 ? 600 : 400 }}>
                          {d.workedMinutes > 0 ? hm(d.workedMinutes) : noOut ? 'No clock-out' : d.noShow ? 'No clock-in' : d.scheduledMinutes > 0 ? `${hm(d.scheduledMinutes)} planned` : 'Off'}</span>
                      </div>
                    ); })}
                  </div>
                  <div className="mt-2">
                    {x.shifts.map((s) => (
                      <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-2" style={{ borderTop: `1px solid ${LINE}` }}>
                        <span className="min-w-[220px] flex-1">
                          <span className="block text-[14px]">{shiftWords(s, p.time)}</span>
                          {s.splitTime && s.workedMinutes > 0 && <span className="block text-[13px]" style={{ color: MUTED }}>Hourly work {hm(s.hourlyMinutes)}, services {hm(s.workedMinutes - s.hourlyMinutes)}</span>}
                          {s.notes.length > 0 && <span className="block text-[13px]" style={{ color: AMBER }}>{s.notes.join('. ')}</span>}
                          {s.outOfZone && <span className="block text-[13px]" style={{ color: AMBER }}>Clocked in away from the business</span>}
                          {s.managerNote && <span className="block text-[13px]" style={{ color: MUTED }}>Note: {s.managerNote}</span>}
                          {s.status === 'approved' && s.approvedBy && <span className="block text-[13px]" style={{ color: MUTED }}>Approved by {s.approvedBy}</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-[14px] tabular-nums">{s.workedMinutes > 0 ? hm(s.workedMinutes) : ''}</span>
                          <span className="rounded-full px-2.5 py-1 text-[12px]" style={s.missingOut || s.status === 'pending' ? { background: AMBER_TINT, color: AMBER } : s.status === 'approved' ? { background: GREEN_TINT, color: GREEN } : { background: SOFT, color: MUTED }}>{s.missingOut ? 'No clock-out' : STATUS[s.status]}</span>
                          {s.missingOut && s.canReview
                            ? <button type="button" disabled={p.busy} onClick={() => p.onOpen(x.id, x.name, s, true)} className={btn} style={solid}>Add the clock-out</button>
                            : s.canReview && <button type="button" onClick={() => p.onOpen(x.id, x.name, s, false)} className={btn} style={plain}>{s.status === 'pending' ? 'Look at it' : 'Change'}</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {x.waiting > 0 && <div className="pt-2"><button type="button" disabled={p.busy} onClick={() => p.onApprove(x.id, x.shifts.filter((s) => s.status === 'pending' && !!s.outAt && s.canReview))} className={btn} style={solid}>Approve {x.waiting === 1 ? 'the waiting shift' : `the ${x.waiting} waiting shifts`}</button></div>}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** One shift, opened: look at it and approve it, or not; change its times (adding a forgotten clock-out). */
export function ShiftDialog({ open, onOpenChange, name, shift, changing, onChanging, inTime, outTime, onInTime, onOutTime, note, onNote, busy, time, onApprove, onReject, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; shift: Shift | null; changing: boolean; onChanging: (on: boolean) => void;
  inTime: string; outTime: string; onInTime: (v: string) => void; onOutTime: (v: string) => void; note: string; onNote: (v: string) => void; busy: boolean;
  time: (d: Date) => string; onApprove: () => void; onReject: () => void; onSave: () => void;
}) {
  if (!shift) return null;
  const Row = ({ a, b }: { a: string; b: React.ReactNode }) => <div className="flex items-center justify-between gap-3 py-2 text-[14px]" style={{ borderTop: `1px solid ${LINE}` }}><span style={{ color: MUTED }}>{a}</span><span className="tabular-nums">{b}</span></div>;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-hidden rounded-3xl border-0 bg-[#fff] p-0 sm:max-w-md">
        <div className="flex max-h-[90dvh] flex-col" style={{ color: INK }}>
          <div className="shrink-0 px-6 pb-2 pt-6 text-left">
            <DialogTitle className="pr-8 text-[20px] font-semibold leading-tight" style={{ color: INK }}>{name}, {dayLong(shift.dayKey)}</DialogTitle>
            <DialogDescription className="text-[14px]" style={{ color: MUTED }}>{changing ? (shift.missingOut ? 'Add when they left. It waits for approval after.' : 'Change the times. It waits for approval after.') : shift.missingOut ? 'There’s no clock-out yet: add when they left first.' : 'Look over the shift, then approve it.'}</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            {changing ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Clocked in
                  <input type="time" value={inTime} onChange={(e) => onInTime(e.target.value)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
                <label className="flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>Clocked out
                  <input type="time" value={outTime} onChange={(e) => onOutTime(e.target.value)} className={field} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
                <p className="col-span-2 text-[13px]" style={{ color: MUTED }}>A clock-out before the clock-in is the next morning.</p>
              </div>
            ) : (
              <div>
                <Row a="Clocked in and out" b={`${time(shift.inAt)} to ${shift.outAt ? time(shift.outAt) : 'no clock-out'}`} />
                <Row a="Worked" b={hm(shift.workedMinutes)} />
                <Row a="Break" b={shift.breakMinutes > 0 ? `${shift.breakMinutes} minutes${shift.paidBreakMinutes > 0 ? `, ${shift.paidBreakMinutes} paid` : ''}` : 'None'} />
                <Row a="Where" b={shift.outOfZone ? <span style={{ color: AMBER }}>Away from the business</span> : 'At the business'} />
                <button type="button" onClick={() => onChanging(true)} className={`${btn} mt-2`} style={shift.missingOut ? solid : plain}>{shift.missingOut ? 'Add the clock-out' : 'Change the times'}</button>
              </div>
            )}
            <label className="mt-3 flex flex-col gap-1 text-[14px]" style={{ color: MUTED }}>{changing ? 'Why it changed (they’ll see this)' : 'A note (needed if you don’t approve it)'}
              <textarea value={note} onChange={(e) => onNote(e.target.value)} rows={2} maxLength={300} className={`rounded-xl bg-[#fff] px-3 py-2 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK }} /></label>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 px-6 py-4" style={{ borderTop: `1px solid ${LINE}` }}>
            {changing ? <>
              <button type="button" onClick={onSave} disabled={busy || !inTime || !outTime} className={btn} style={solid}>{busy ? 'Saving' : 'Save the times'}</button>
              <button type="button" onClick={() => (shift.missingOut ? onOpenChange(false) : onChanging(false))} disabled={busy} className={btn} style={plain}>{shift.missingOut ? 'Cancel' : 'Back'}</button>
            </> : <>
              {shift.status !== 'approved' && !shift.missingOut && <button type="button" onClick={onApprove} disabled={busy} className={btn} style={solid}>{busy ? 'Saving' : 'Approve'}</button>}
              {shift.status !== 'rejected' && !shift.missingOut && <button type="button" onClick={onReject} disabled={busy || !note.trim()} className={btn} style={plain}>Don’t approve</button>}
              <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className={btn} style={plain}>Close</button>
            </>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
