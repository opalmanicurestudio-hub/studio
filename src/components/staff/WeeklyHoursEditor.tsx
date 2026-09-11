'use client';

// src/components/staff/WeeklyHoursEditor.tsx
//
// THE HOURS AN EMPLOYEE NEVER HAD.
//
// `availability.week` is read by five booking surfaces — the planner's add and
// edit dialogs, the guest reschedule, the membership capacity audit and the
// availability engine itself — and until now exactly one thing in the whole
// app WROTE it: the renter portal's My Hours. So a booth renter could set
// their bookable week and an employee could not, by any route. Adding someone
// to Pro Team and wondering why clients can't book them had no answer,
// because there was no field.
//
// This is that field, shaped exactly like the one renters already use, so a
// week means the same thing whoever set it.

import React from 'react';

export type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export interface DayHours { enabled: boolean; start: string; end: string }
export type WeekHours = Record<DayKey, DayHours>;

export const DAY_KEYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHORT: Record<DayKey, string> = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

/** A week nobody has touched: closed every day, sensible hours ready behind it. */
export function emptyWeek(): WeekHours {
  return DAY_KEYS.reduce((acc, k) => { acc[k] = { enabled: false, start: '09:00', end: '17:00' }; return acc; }, {} as WeekHours);
}

/** Read whatever is on the record into a complete week — old records are partial. */
export function weekFrom(staffDoc: any): WeekHours {
  const src = staffDoc?.availability?.week || {};
  return DAY_KEYS.reduce((acc, k) => {
    const d = src[k] || {};
    acc[k] = { enabled: d.enabled === true, start: String(d.start || '09:00'), end: String(d.end || '17:00') };
    return acc;
  }, {} as WeekHours);
}

export function anyDayOpen(week: WeekHours): boolean {
  return DAY_KEYS.some((k) => week[k]?.enabled && week[k]?.start && week[k]?.end);
}

export function WeeklyHoursEditor({ week, onChange, note }: {
  week: WeekHours;
  onChange: (w: WeekHours) => void;
  note?: string;
}) {
  const set = (k: DayKey, patch: Partial<DayHours>) => onChange({ ...week, [k]: { ...week[k], ...patch } });
  const open = DAY_KEYS.filter((k) => week[k]?.enabled);
  // Copying Monday down is the difference between six taps and thirty.
  const copyFirstOpen = () => {
    const first = open[0];
    if (!first) return;
    const src = week[first];
    onChange(DAY_KEYS.reduce((acc, k) => { acc[k] = week[k].enabled ? { ...week[k], start: src.start, end: src.end } : week[k]; return acc; }, {} as WeekHours));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase font-black text-muted-foreground tracking-widest ml-1">Bookable hours</span>
        {open.length > 1 && (
          <button type="button" onClick={copyFirstOpen}
            className="h-7 rounded-lg border-2 bg-white px-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
            Same times all week
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {DAY_KEYS.map((k) => {
          const d = week[k];
          return (
            <div key={k} className="flex items-center gap-2">
              <button type="button" aria-pressed={d.enabled} aria-label={`${SHORT[k]} — ${d.enabled ? 'open' : 'closed'}`}
                onClick={() => set(k, { enabled: !d.enabled })}
                className={`h-10 w-14 shrink-0 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest ${d.enabled ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400'}`}>
                {SHORT[k]}
              </button>
              {d.enabled ? (
                <>
                  <input type="time" value={d.start} onChange={(e) => set(k, { start: e.target.value })}
                    aria-label={`${SHORT[k]} start`} className="h-10 flex-1 min-w-0 rounded-xl border-2 bg-white px-2 text-sm font-bold" />
                  <span className="text-[10px] font-black text-muted-foreground">to</span>
                  <input type="time" value={d.end} onChange={(e) => set(k, { end: e.target.value })}
                    aria-label={`${SHORT[k]} end`} className="h-10 flex-1 min-w-0 rounded-xl border-2 bg-white px-2 text-sm font-bold" />
                </>
              ) : (
                <span className="flex-1 text-[11px] font-bold text-muted-foreground">Not working</span>
              )}
            </div>
          );
        })}
      </div>
      {!anyDayOpen(week) && (
        <p className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
          No days open — clients will have no times to pick, so they won&apos;t appear on your booking site.
        </p>
      )}
      {note && <p className="text-[10px] font-bold text-muted-foreground">{note}</p>}
    </div>
  );
}
