'use client';
// src/components/planner/EventsDialog.tsx — NEW EVENT and EDIT EVENT, on the planner.
//
// One event, or many at once: a season of practices and games, a class twice a week, a run of school pickups.
//   Once          — one date and time.
//   Repeats       — the same time on chosen weekdays, every week or every other week, until a date.
//   Several dates — a list of dates, each with its own time, typed in, read from a pasted schedule, or from a calendar
//                   file (.ics) that most team and school apps can export (lib/event-schedule).
// Before anything is saved the person sees every event it will add, with any that overlap a booking marked, and can
// leave any of them out. Events added together share a series, so a later change or delete can cover the rest.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { X, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Event, type EventChecklistItem, type Staff, type Appointment } from '@/lib/data';
import { format, parseISO, areIntervalsOverlapping, addDays } from 'date-fns';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { collection } from 'firebase/firestore';
import { parseSchedule, parseIcs, repeatDates, occurrencesFrom, sortRows, MAX_AT_ONCE, type ScheduleRow, type Occurrence } from '@/lib/event-schedule';

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') { try { return parseISO(val); } catch { return new Date(val); } }
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};
const fmtSafe = (v: any, f: string, fallback: string): string => {
  try { const d = safeDate(v); return isNaN(d.getTime()) ? fallback : format(d, f); } catch { return fallback; }
};
const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const minutesBetween = (a: string, b: string) => {
  const [ah, am] = a.split(':').map(Number); const [bh, bm] = b.split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
};
const plusMinutes = (t: string, mins: number) => {
  const [h, m] = (t || '09:00').split(':').map(Number); const x = Math.min(23 * 60 + 59, h * 60 + m + mins);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const nice = (d: Date) => format(d, 'EEE, MMM d');
const clock = (d: Date) => format(d, 'h:mm a');

// ── Shared pieces, in the app's current look ─────────────────────────────────
const fieldCls = 'h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a] outline-none focus:border-[#16171a]';
const Field = ({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) => (
  <div className="space-y-1.5">
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-[#16171a]">{label}</label>
    {children}
    {hint && <p className="text-[12px] leading-snug text-[#6d7075]">{hint}</p>}
  </div>
);
function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-xl bg-[#f5f5f7] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('h-11 rounded-lg px-2 text-[14px] font-medium transition-colors', value === v ? 'bg-white text-[#16171a] shadow-sm' : 'text-[#6d7075] hover:text-[#16171a]')}>
          {l}
        </button>
      ))}
    </div>
  );
}
const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
  <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left">
    <span>
      <span className="block text-[14px] font-medium text-[#16171a]">{label}</span>
      {hint && <span className="block text-[12px] text-[#6d7075]">{hint}</span>}
    </span>
    <span className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-[#16171a]' : 'bg-[#d9d9de]')}>
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </span>
  </button>
);
const KIND_HINT: Record<string, string> = {
  business: 'On the business calendar. Whoever it’s for can’t be booked during it.',
  personal: 'Your own time, like a game or a pickup. You can’t be booked during it.',
  blocked: 'Nobody can book this time.',
};

function WhoPicker({ staff, value, onChange, canPickOthers, meId }: { staff: Staff[]; value: string[]; onChange: (v: string[]) => void; canPickOthers: boolean; meId?: string }) {
  // Someone who can't plan others' time adds events for themselves only (never one on everyone's calendar).
  if (!canPickOthers) {
    const me = staff.find((s) => s.id === meId);
    return me ? <Field label="Who it’s for"><p className="text-[14px] text-[#16171a]">{me.name || 'You'}</p></Field> : null;
  }
  const people = staff;
  if (!people.length) return null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Field label="Who it’s for" hint={value.length === 0 ? 'Nobody picked: it’s on everyone’s calendar.' : undefined}>
      <div className="flex flex-wrap gap-2">
        {people.map((s) => {
          const on = value.includes(s.id);
          return (
            <button key={s.id} type="button" aria-pressed={on} onClick={() => toggle(s.id)}
              className={cn('inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors',
                on ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] bg-white text-[#16171a] hover:bg-[#f5f5f7]')}>
              {on && <Check className="h-4 w-4" />}{s.name || 'Team member'}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function Checklist({ items, onChange, done, disabled }: { items: EventChecklistItem[]; onChange: (v: EventChecklistItem[]) => void; done?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (!t) return; onChange([...items, { id: `cl-${Date.now()}-${items.length}`, text: t.slice(0, 200), completed: false }]); setDraft(''); };
  return (
    <Field label="Checklist" hint={items.length ? undefined : 'Things to bring or do. Optional.'}>
      {items.length > 0 && (
        <ul className="divide-y divide-[#ececee] rounded-xl border border-[#ececee]">
          {items.map((it) => (
            <li key={it.id} className="flex min-h-[44px] items-center gap-3 px-3">
              {done && (
                <button type="button" role="checkbox" disabled={disabled} aria-checked={it.completed} aria-label={`Done: ${it.text}`} onClick={() => onChange(items.map((x) => (x.id === it.id ? { ...x, completed: !x.completed } : x)))}
                  className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', it.completed ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#c9c9cf]')}>
                  {it.completed && <Check className="h-3.5 w-3.5" />}
                </button>
              )}
              <span className={cn('flex-1 text-[14px] text-[#16171a]', it.completed && 'text-[#6d7075] line-through')}>{it.text}</span>
              {!disabled && <button type="button" aria-label={`Remove ${it.text}`} onClick={() => onChange(items.filter((x) => x.id !== it.id))} className="flex h-11 w-11 items-center justify-center text-[#6d7075] hover:text-[#16171a]"><X className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Add an item" className={fieldCls} />
        <button type="button" onClick={add} aria-label="Add item" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#ececee] text-[#16171a] hover:bg-[#f5f5f7]"><Plus className="h-4 w-4" /></button>
      </div>}
    </Field>
  );
}

// ── What a New event hands the planner ───────────────────────────────────────
export type NewEventsInput = {
  title: string;
  type: 'personal' | 'business' | 'blocked';
  staffIds: string[];
  notes: string;
  location: string;
  checklist: EventChecklistItem[];
  allDay: boolean;
  /** Every event to add: one for Once, many for Repeats and Several dates. */
  occurrences: Occurrence[];
  how: 'once' | 'repeat' | 'dates';
  /** The words each row added after the name ("vs Tigers"), by occurrence, so a later rename keeps them. */
  rowLabels: string[];
};

export type EventPreset = { type?: 'personal' | 'business' | 'blocked'; date?: Date; time?: string; duration?: number; staffIds?: string[]; allDay?: boolean };

const WEEKDAYS: [number, string, string][] = [[0, 'S', 'Sunday'], [1, 'M', 'Monday'], [2, 'T', 'Tuesday'], [3, 'W', 'Wednesday'], [4, 'T', 'Thursday'], [5, 'F', 'Friday'], [6, 'S', 'Saturday']];

const AddEventForm = ({ onConfirm, staff, preset, onSummary }: {
  onConfirm: (input: NewEventsInput) => void;
  staff: Staff[];
  preset?: EventPreset | null;
  onSummary?: (s: { count: number; ready: boolean }) => void;
}) => {
  const { user, selectedTenant, can } = useTenant();
  const { firestore } = useFirebase();
  const tenantId = selectedTenant?.id;
  const { data: appointmentsFromDB } = useCollection<Appointment>(useMemoFirebase(() => (tenantId && firestore ? collection(firestore, `tenants/${tenantId}/appointments`) : null), [firestore, tenantId]));
  const { data: eventsFromDB } = useCollection<Event>(useMemoFirebase(() => (tenantId && firestore ? collection(firestore, `tenants/${tenantId}/events`) : null), [firestore, tenantId]));
  const booked = useMemo(() => [
    ...(appointmentsFromDB || []).filter((a: any) => !['cancelled', 'canceled', 'no-show', 'noshow'].includes(String(a.status || '').toLowerCase()))
      .map((a: any) => ({ start: safeDate(a.startTime), end: safeDate(a.endTime), who: [String(a.staffId || '')], what: `${a.clientName || 'a client'}’s booking` })),
    ...(eventsFromDB || []).map((e: any) => ({ start: safeDate(e.startTime), end: safeDate(e.endTime), who: (e.staffIds || []) as string[], what: `“${e.title || 'an event'}”` })),
  ], [appointmentsFromDB, eventsFromDB]);

  const canPickOthers = can('schedule.manage');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'personal' | 'business' | 'blocked'>(preset?.type || 'business');
  const [staffIds, setStaffIds] = useState<string[]>(() => (preset?.staffIds?.length ? preset.staffIds : !canPickOthers && user ? [user.uid] : []));
  const [how, setHow] = useState<'once' | 'repeat' | 'dates'>('once');
  const [date, setDate] = useState(preset?.date ? format(preset.date, 'yyyy-MM-dd') : todayStr());
  const [start, setStart] = useState(preset?.time || '09:00');
  const [end, setEnd] = useState(plusMinutes(preset?.time || '09:00', preset?.duration || 60));
  const [allDay, setAllDay] = useState(!!preset?.allDay);
  const [weekdays, setWeekdays] = useState<number[]>(() => [(preset?.date || new Date()).getDay()]);
  const [everyWeeks, setEveryWeeks] = useState<'1' | '2'>('1');
  const [until, setUntil] = useState(format(addDays(preset?.date || new Date(), 7 * 8), 'yyyy-MM-dd'));
  // A first date moved past the last one carries the last one along, eight weeks on.
  const setFirstDate = (v: string) => { setDate(v); if (v && until && v > until) setUntil(format(addDays(parseISO(v), 7 * 8), 'yyyy-MM-dd')); };
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [readNote, setReadNote] = useState<string | null>(null);
  // Dates left out, by when and what they are (not their place in the list, which moves as dates are edited).
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<EventChecklistItem[]>([]);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // A new start keeps the length the same; an end before the start is pulled after it.
  const setStartKeep = (v: string) => { const len = Math.max(15, minutesBetween(start, end)); setStart(v); setEnd(plusMinutes(v, len)); };
  const minutes = Math.max(5, minutesBetween(start, end) > 0 ? minutesBetween(start, end) : 60);

  const repeatRows = useMemo<ScheduleRow[]>(() => (how === 'repeat' ? repeatDates({ from: date, until, weekdays, everyWeeks: Number(everyWeeks) }).map((d) => ({ date: d, start: null, end: null, label: '' })) : []), [how, date, until, weekdays, everyWeeks]);
  const sourceRows: ScheduleRow[] = how === 'once' ? [{ date, start: null, end: null, label: '' }] : how === 'repeat' ? repeatRows : rows;
  const all = useMemo(() => occurrencesFrom(sourceRows, { title, defaultStart: start, minutes, location, allDay }), [sourceRows, title, start, minutes, location, allDay]);
  const keyOf = (o: Occurrence) => `${o.startTime.getTime()}|${o.label}`;   // not the name, which may still be typed
  const clashOf = (o: Occurrence) => booked.find((b) => (staffIds.length === 0 || b.who.length === 0 || b.who.some((w) => staffIds.includes(w)))
    && areIntervalsOverlapping({ start: o.startTime, end: o.endTime }, { start: b.start, end: b.end }, { inclusive: false }));
  const chosen = all.map((o, i) => ({ o, i })).filter(({ o }) => !left.has(keyOf(o)));
  const pastCount = chosen.filter(({ o }) => o.endTime.getTime() < Date.now()).length;
  const badRow = how === 'dates' && rows.some((r) => !r.date || (!!r.start && !!r.end && minutesBetween(r.start, r.end) <= 0));
  const ready = !!title.trim() && chosen.length > 0 && !badRow && (allDay || minutesBetween(start, end) > 0 || (how === 'dates' && rows.every((r) => !!r.start)));

  useEffect(() => { setLeft(new Set()); }, [how]);
  useEffect(() => { onSummary?.({ count: chosen.length, ready }); }, [chosen.length, ready, onSummary]);

  const addRows = (more: ScheduleRow[]) => setRows((cur) => sortRows([...cur, ...more]).slice(0, MAX_AT_ONCE));
  const readPasted = () => {
    const r = parseSchedule(pasted, { today: todayStr() });
    addRows(r.rows);
    const bits = [`Read ${r.rows.length} date${r.rows.length === 1 ? '' : 's'}.`];
    if (r.skipped.length) bits.push(`${r.skipped.length} line${r.skipped.length === 1 ? '' : 's'} had no date and ${r.skipped.length === 1 ? 'was' : 'were'} left out.`);
    if (r.past) bits.push(`${r.past} date${r.past === 1 ? '' : 's'} already passed.`);
    if (r.over) bits.push(`Only the first ${MAX_AT_ONCE} were kept.`);
    if (r.rows.some((x) => x.guessed)) bits.push('Times without am or pm were read as afternoon from 1 to 6, so check them.');
    setReadNote(bits.join(' '));
    if (r.rows.length) { setPasted(''); setPasteOpen(false); }
  };
  const readFile = async (f: File | null | undefined) => {
    if (!f) return;
    const text = await f.text().catch(() => '');
    const ics = /BEGIN:VCALENDAR/i.test(text);
    const r: any = ics ? parseIcs(text, { today: todayStr() }) : parseSchedule(text, { today: todayStr() });
    addRows(r.rows);
    setReadNote([
      `Read ${r.rows.length} event${r.rows.length === 1 ? '' : 's'} from ${f.name}.`,
      r.past ? `${r.past} already passed.` : '',
      r.over ? `Only the first ${MAX_AT_ONCE} were kept.` : '',
      r.onceOnly ? `${r.onceOnly} that repeat monthly or yearly were read for their first date only.` : '',
      r.unknownZone ? `${r.unknownZone} had a time zone this device doesn’t know, so their times were read as written. Check them.` : '',
      !ics && r.skipped?.length ? `${r.skipped.length} line${r.skipped.length === 1 ? '' : 's'} had no date.` : '',
    ].filter(Boolean).join(' '));
    if (fileRef.current) fileRef.current.value = '';
  };
  const addOneRow = () => {
    const last = rows[rows.length - 1];
    const lastOk = !!last && /^\d{4}-\d{2}-\d{2}$/.test(last.date) && !isNaN(parseISO(last.date).getTime());
    const next = lastOk ? format(addDays(parseISO(last!.date), 7), 'yyyy-MM-dd') : date || todayStr();
    setRows((cur) => [...cur, { date: next, start: last?.start || start, end: last?.end || end, label: last?.label || '' }]);
  };
  const setRow = (i: number, patch: Partial<ScheduleRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch, guessed: patch.start || patch.end ? false : r.guessed } : r)));

  const submit = () => {
    setTried(true);
    if (!ready) return;
    onConfirm({
      title: title.trim().slice(0, 120), type, staffIds, notes: notes.slice(0, 2000), location: location.trim().slice(0, 200), checklist, allDay,
      occurrences: chosen.map(({ o }) => o), how, rowLabels: chosen.map(({ o }) => o.label || ''),
    });
  };

  return (
    <form id="add-event-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-6 text-left">
      <Field label="Name" htmlFor="add-title">
        <input id="add-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Soccer, staff meeting, school pickup" className={cn(fieldCls, tried && !title.trim() && 'border-[#b45309]')} />
        {tried && !title.trim() && <p className="text-[12px] text-[#b45309]">Give it a name.</p>}
      </Field>

      <Field label="Kind" hint={KIND_HINT[type]}>
        <Segmented label="Kind" value={type} onChange={setType} options={[['business', 'Business'], ['personal', 'Personal'], ['blocked', 'Blocked']]} />
      </Field>

      <WhoPicker staff={staff} value={staffIds} onChange={setStaffIds} canPickOthers={canPickOthers} meId={user?.uid} />

      <Field label="How often">
        <Segmented label="How often" value={how} onChange={setHow} options={[['once', 'Once'], ['repeat', 'Repeats'], ['dates', 'Several dates']]} />
      </Field>

      {how === 'repeat' && (
        <div className="space-y-4">
          <Field label="On">
            <div className="flex gap-1.5">
              {WEEKDAYS.map(([n, short, long]) => {
                const on = weekdays.includes(n);
                return (
                  <button key={n} type="button" aria-pressed={on} aria-label={long} onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== n) : [...weekdays, n].sort())}
                    className={cn('h-11 w-11 rounded-full border text-[14px] font-medium transition-colors', on ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] bg-white text-[#16171a] hover:bg-[#f5f5f7]')}>
                    {short}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Every">
            <Segmented label="Every" value={everyWeeks} onChange={setEveryWeeks} options={[['1', 'Week'], ['2', 'Other week']]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting" htmlFor="rep-from"><input id="rep-from" type="date" value={date} onChange={(e) => setFirstDate(e.target.value)} className={fieldCls} /></Field>
            <Field label="Last date" htmlFor="rep-until"><input id="rep-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} className={fieldCls} /></Field>
          </div>
        </div>
      )}

      {how === 'once' && (
        <Field label="Date" htmlFor="once-date"><input id="once-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldCls} /></Field>
      )}

      <div className="space-y-3">
        <Toggle checked={allDay} onChange={setAllDay} label="All day" hint={how === 'dates' && allDay ? 'Every date runs all day.' : undefined} />
        {(how !== 'dates' || rows.some((r) => !r.start) || rows.length === 0) && (
        <>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={how === 'dates' ? 'Starts, when a date has no time' : 'Starts'} htmlFor="ev-start"><input id="ev-start" type="time" value={start} onChange={(e) => setStartKeep(e.target.value)} className={fieldCls} /></Field>
              <Field label="Ends" htmlFor="ev-end"><input id="ev-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={cn(fieldCls, minutesBetween(start, end) <= 0 && 'border-[#b45309]')} /></Field>
            </div>
          )}
          {!allDay && minutesBetween(start, end) <= 0 && <p className="text-[12px] text-[#b45309]">The end is before the start.</p>}
        </>
        )}
      </div>

      {how === 'dates' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPasteOpen((v) => !v)} className={cn('inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-medium', pasteOpen ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] text-[#16171a] hover:bg-[#f5f5f7]')}>Paste a schedule</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-11 items-center rounded-full border border-[#ececee] px-4 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">Import a calendar file</button>
            <button type="button" onClick={addOneRow} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[#ececee] px-4 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]"><Plus className="h-4 w-4" />Add a date</button>
            <input ref={fileRef} type="file" accept=".ics,text/calendar,.txt,.csv,text/plain" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
          </div>
          {pasteOpen && (
            <div className="space-y-2">
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} aria-label="Pasted schedule"
                placeholder={'One event a line, copied from the team’s schedule, an email or a website:\nSat Nov 14  9:00 AM  vs Tigers, Field 3\nTue 11/17  5:30-7 pm  Practice'}
                className="w-full rounded-xl border border-[#ececee] bg-white px-3 py-2.5 text-[14px] text-[#16171a] outline-none focus:border-[#16171a]" />
              <button type="button" onClick={readPasted} disabled={!pasted.trim()} className="h-11 rounded-full bg-[#16171a] px-5 text-[14px] font-medium text-white disabled:opacity-40">Read the dates</button>
            </div>
          )}
          {readNote && <p className="text-[13px] leading-snug text-[#6d7075]">{readNote}</p>}
          {rows.length > 0 ? (
            <ul className="divide-y divide-[#ececee] rounded-xl border border-[#ececee]">
              {rows.map((r, i) => (
                <li key={i} className="grid grid-cols-[1fr_auto] gap-2 p-2.5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_132px_132px]">
                    <input type="date" aria-label="Date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} className={cn(fieldCls, 'col-span-2 sm:col-span-1')} />
                    <input type="time" aria-label="Starts" value={r.start || ''} onChange={(e) => setRow(i, { start: e.target.value || null, end: r.end && e.target.value && minutesBetween(e.target.value, r.end) <= 0 ? null : r.end })} className={cn(fieldCls, r.guessed && 'border-[#b45309]')} />
                    <input type="time" aria-label="Ends" value={r.end || ''} onChange={(e) => setRow(i, { end: e.target.value || null })} className={fieldCls} />
                    <input aria-label="What it is" value={r.label} onChange={(e) => setRow(i, { label: e.target.value.slice(0, 80) })} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="vs Tigers, at Field 3" className={cn(fieldCls, 'col-span-2 sm:col-span-3')} />
                    {!r.date && <p className="col-span-2 text-[12px] text-[#b45309] sm:col-span-3">Pick a date, or remove this one.</p>}
                    {!!r.start && !!r.end && minutesBetween(r.start, r.end) <= 0 && <p className="col-span-2 text-[12px] text-[#b45309] sm:col-span-3">It ends before it starts.</p>}
                    {r.guessed && <p className="col-span-2 text-[12px] text-[#b45309] sm:col-span-3">No am or pm in the schedule. Check this time.</p>}
                  </div>
                  <button type="button" aria-label="Remove this date" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} className="flex h-11 w-11 items-center justify-center self-start text-[#6d7075] hover:text-[#16171a]"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-[#f5f5f7] px-4 py-3 text-[13px] leading-relaxed text-[#6d7075]">Paste the dates from a team or school schedule, import the calendar file their app gives you, or add dates one at a time.</p>
          )}
        </div>
      )}

      <Field label="Place" htmlFor="ev-place"><input id="ev-place" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" className={fieldCls} /></Field>

      {how !== 'once' && all.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium text-[#16171a]">{chosen.length === all.length ? `${all.length} event${all.length === 1 ? '' : 's'} to add` : `${chosen.length} of ${all.length} events to add`}</p>
            {all.length >= MAX_AT_ONCE && <p className="text-[12px] text-[#6d7075]">{MAX_AT_ONCE} at most at once</p>}
          </div>
          <ul className="max-h-[260px] divide-y divide-[#ececee] overflow-y-auto rounded-xl border border-[#ececee]">
            {all.map((o, i) => {
              const out = left.has(keyOf(o)); const clash = clashOf(o);
              return (
                <li key={`${keyOf(o)}-${i}`} className={cn('flex min-h-[44px] items-center gap-3 px-3 py-2', out && 'opacity-50')}>
                  <button type="button" role="checkbox" aria-checked={!out} aria-label={`Add ${o.title} on ${nice(o.startTime)}`}
                    onClick={() => setLeft((cur) => { const n = new Set(cur); const k = keyOf(o); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                    className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', !out ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#c9c9cf] bg-white')}>
                    {!out && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-[#16171a]">{nice(o.startTime)} · {o.allDay ? 'All day' : `${clock(o.startTime)} to ${clock(o.endTime)}`}</span>
                    <span className="block truncate text-[12px] text-[#6d7075]">{o.title}{o.location ? ` · ${o.location}` : ''}</span>
                    {clash && !out && <span className="block truncate text-[12px] text-[#b45309]">Overlaps {clash.what}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {pastCount > 0 && <p className="text-[12px] text-[#b45309]">{pastCount} of these {pastCount === 1 ? 'is' : 'are'} already over.</p>}
        </div>
      )}
      {how === 'once' && all[0] && clashOf(all[0]) && (
        <p className="rounded-xl bg-[#fdf3e7] px-4 py-3 text-[13px] text-[#b45309]">This overlaps {clashOf(all[0])!.what}.</p>
      )}

      <Checklist items={checklist} onChange={setChecklist} />
      <Field label="Notes" htmlFor="ev-notes">
        <textarea id="ev-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="w-full rounded-xl border border-[#ececee] bg-white px-3 py-2.5 text-[15px] text-[#16171a] outline-none focus:border-[#16171a]" />
      </Field>
      {tried && !ready && title.trim() && <p className="text-[13px] text-[#b45309]">{badRow ? 'Check the dates and times marked above.' : chosen.length === 0 ? (how === 'dates' ? 'Add at least one date.' : how === 'repeat' ? 'Pick a weekday and a last date after the first.' : 'Pick a date.') : 'Check the times.'}</p>}
    </form>
  );
};

// ── Edit one event, or it and the ones after it ──────────────────────────────
export type EditEventResult = {
  event: Event;
  /** For an event added with others: also change the later ones (only what was changed here). */
  later: boolean;
  /** What changed, so the later ones get only that. */
  changed: { title?: string; type?: Event['type']; startClock?: string; endClock?: string; allDay?: boolean; staffIds?: string[]; location?: string; notes?: string };
};

const EditEventForm = ({ event, onConfirm, staff, laterCount, readOnly }: {
  event: Event; onConfirm: (r: EditEventResult) => void; staff: Staff[]; laterCount: number; readOnly?: string | null;
}) => {
  const { user, can } = useTenant();
  const ev: any = event;
  const canPickOthers = can('schedule.manage');
  const manager = can('bookings.manage');
  // A block answers to the block policy (lib/block-submit): a provider can't move or stretch one here. Someone else's
  // event is the planner's to say (readOnly).
  const locked = !!readOnly || (event.type === 'blocked' && !manager);
  const seriesBase = String(ev.seriesTitle || '');
  const rowLabel = String(ev.rowLabel || '');
  const [title, setTitle] = useState(seriesBase || event.title || '');
  const [type, setType] = useState(event.type);
  const [dateStr, setDateStr] = useState(fmtSafe(event.startTime, 'yyyy-MM-dd', todayStr()));
  const [start, setStart] = useState(fmtSafe(event.startTime, 'HH:mm', '09:00'));
  const [end, setEnd] = useState(fmtSafe(event.endTime, 'HH:mm', '10:00'));
  const [allDay, setAllDay] = useState(!!event.allDay);
  const [staffIds, setStaffIds] = useState<string[]>(event.staffIds || []);
  const [location, setLocation] = useState(event.location || '');
  const [notes, setNotes] = useState(event.notes || '');
  const [checklist, setChecklist] = useState<EventChecklistItem[]>(event.checklist || []);
  const [later, setLater] = useState(false);
  const origDate = fmtSafe(event.startTime, 'yyyy-MM-dd', todayStr());
  const origStart = fmtSafe(event.startTime, 'HH:mm', '09:00');
  const origEnd = fmtSafe(event.endTime, 'HH:mm', '10:00');
  // A new start keeps the length the same, as when it was added.
  const setStartKeep = (v: string) => { const len = minutesBetween(start, end); setStart(v); if (len > 0) setEnd(plusMinutes(v, len)); };
  const overnight = !allDay && minutesBetween(start, end) <= 0;

  const submit = () => {
    if (!title.trim() || !dateStr) return;
    const [y, mo, d] = dateStr.split('-').map(Number);
    if (!y || !mo || !d) return;
    const timeTouched = dateStr !== origDate || start !== origStart || end !== origEnd || allDay !== !!event.allDay;
    let s: Date; let e: Date;
    if (!timeTouched) { s = safeDate(event.startTime); e = safeDate(event.endTime); }   // a notes-only change leaves the times as they were
    else {
      const [sh, sm] = (allDay ? '00:00' : start).split(':').map(Number);
      const [eh, em] = (allDay ? '23:59' : end).split(':').map(Number);
      s = new Date(y, mo - 1, d, sh, sm); e = new Date(y, mo - 1, d, eh, em);
      if (e <= s) e = new Date(y, mo - 1, d + 1, eh, em);   // ends after midnight
    }
    const name = title.trim().slice(0, 120);
    const fullTitle = seriesBase ? (rowLabel ? `${name} · ${rowLabel}` : name) : name;
    const changed: EditEventResult['changed'] = {};
    if (name !== (seriesBase || event.title)) changed.title = name;
    if (type !== event.type) changed.type = type;
    if (!allDay && start !== fmtSafe(event.startTime, 'HH:mm', '09:00')) changed.startClock = start;
    if (!allDay && end !== fmtSafe(event.endTime, 'HH:mm', '10:00')) changed.endClock = end;
    if (allDay !== !!event.allDay) changed.allDay = allDay;
    if ([...staffIds].sort().join() !== [...(event.staffIds || [])].sort().join()) changed.staffIds = staffIds;
    if (location !== (event.location || '')) changed.location = location;
    if (notes !== (event.notes || '')) changed.notes = notes;
    onConfirm({
      event: { ...event, title: fullTitle, ...(seriesBase ? { seriesTitle: name } : {}), type, startTime: s, endTime: e, allDay, staffIds, location: location.trim(), notes, checklist } as any,
      later: later && laterCount > 0, changed,
    });
  };

  return (
    <form id="edit-event-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-6 text-left">
      {locked && <p className="rounded-xl bg-[#f5f5f7] px-4 py-3 text-[13px] text-[#6d7075]">{readOnly || 'Changing the time of a block goes through a manager. You can still add notes.'}</p>}
      <Field label="Name" htmlFor="edit-title">
        <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} className={fieldCls} />
        {rowLabel && <p className="text-[12px] text-[#6d7075]">Shown as “{title.trim() || '…'} · {rowLabel}”.</p>}
      </Field>
      {!locked && (
        <Field label="Kind" hint={KIND_HINT[type]}>
          <Segmented label="Kind" value={type} onChange={setType}
            options={(manager || event.type === 'blocked' ? [['business', 'Business'], ['personal', 'Personal'], ['blocked', 'Blocked']] : [['business', 'Business'], ['personal', 'Personal']]) as [Event['type'], string][]} />
        </Field>
      )}
      {!locked && <WhoPicker staff={staff} value={staffIds} onChange={setStaffIds} canPickOthers={canPickOthers} meId={user?.uid} />}
      {!locked && (
        <div className="space-y-3">
          <Field label="Date" htmlFor="edit-date"><input id="edit-date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className={fieldCls} /></Field>
          <Toggle checked={allDay} onChange={setAllDay} label="All day" />
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts" htmlFor="edit-start"><input id="edit-start" type="time" value={start} onChange={(e) => setStartKeep(e.target.value)} className={fieldCls} /></Field>
              <Field label="Ends" htmlFor="edit-end"><input id="edit-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={fieldCls} /></Field>
            </div>
          )}
          {overnight && <p className="text-[12px] text-[#6d7075]">Ends the next day.</p>}
        </div>
      )}
      <Field label="Place" htmlFor="edit-place"><input id="edit-place" value={location} onChange={(e) => setLocation(e.target.value)} disabled={locked} placeholder="Optional" className={fieldCls} /></Field>
      <Checklist items={checklist} onChange={setChecklist} done disabled={!!readOnly} />
      <Field label="Notes" htmlFor="edit-notes">
        <textarea id="edit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!!readOnly} className="w-full rounded-xl border border-[#ececee] bg-white px-3 py-2.5 text-[15px] text-[#16171a] outline-none focus:border-[#16171a]" />
      </Field>
      {laterCount > 0 && !locked && (
        <div className="rounded-xl border border-[#ececee] p-3">
          <Toggle checked={later} onChange={setLater} label={`Also change the ${laterCount} after this one`}
            hint="Each keeps its own date. Only what you changed here is changed on them." />
        </div>
      )}
    </form>
  );
};

// ── The dialogs ──────────────────────────────────────────────────────────────
function Shell({ open, onOpenChange, title, desc, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; desc: string; children: React.ReactNode; footer: React.ReactNode }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex h-[95vh] flex-col overflow-hidden rounded-t-[20px] border-none bg-background p-0">
          <SheetHeader className="flex-shrink-0 border-b border-[#ececee] px-5 py-4 text-left">
            <SheetTitle className="text-[20px] font-semibold tracking-tight text-[#16171a]">{title}</SheetTitle>
            <SheetDescription className="text-[13px] text-[#6d7075]">{desc}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          <SheetFooter className="flex-shrink-0 border-t border-[#ececee] bg-white px-5 py-3">{footer}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden rounded-2xl border border-[#ececee] bg-background p-0 sm:max-w-xl">
        <DialogHeader className="flex-shrink-0 border-b border-[#ececee] px-6 py-5 text-left">
          <DialogTitle className="text-[20px] font-semibold tracking-tight text-[#16171a]">{title}</DialogTitle>
          <DialogDescription className="text-[13px] text-[#6d7075]">{desc}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        <DialogFooter className="flex-shrink-0 border-t border-[#ececee] px-6 py-4">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const AddEventDialog = ({ open, onOpenChange, onConfirm, staff, preset }: {
  preset?: EventPreset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: NewEventsInput) => void | Promise<void>;
  staff: Staff[];
}) => {
  const [summary, setSummary] = useState({ count: 1, ready: false });
  const [saving, setSaving] = useState(false);
  const onSummary = React.useCallback((s: { count: number; ready: boolean }) => setSummary(s), []);
  const blocking = preset?.type === 'blocked';
  return (
    <Shell open={open} onOpenChange={onOpenChange}
      title={blocking ? 'Block time' : 'New event'}
      desc={blocking ? 'Nobody can book this time.' : 'One event, or a whole schedule at once.'}
      footer={(
        <div className="flex w-full gap-3">
          <button type="button" onClick={() => onOpenChange(false)} className="h-11 flex-1 rounded-full border border-[#ececee] px-5 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">Cancel</button>
          <button type="submit" form="add-event-form" disabled={saving} className="h-11 flex-[2] rounded-full bg-[#16171a] px-5 text-[14px] font-medium text-white disabled:opacity-40">
            {saving ? 'Adding…' : summary.count > 1 ? `Add ${summary.count} events` : 'Add event'}
          </button>
        </div>
      )}>
      {open && (
        <AddEventForm key={JSON.stringify(preset || {})} preset={preset} staff={staff} onSummary={onSummary}
          onConfirm={async (data) => { setSaving(true); try { await onConfirm(data); } finally { setSaving(false); } }} />
      )}
    </Shell>
  );
};

export const EditEventDialog = ({ open, onOpenChange, event, onConfirm, onDelete, staff, laterCount = 0, readOnly = null, deleteLaterCount }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event;
  onConfirm: (r: EditEventResult) => void | Promise<void>;
  /** 'one' deletes this event; 'later' deletes it and the ones after it in its series. */
  onDelete?: (which: 'one' | 'later') => void | Promise<void>;
  staff: Staff[];
  /** How many events come after this one in its series (that this person may change). */
  laterCount?: number;
  /** Why this person can only look at it (someone else's event), or null. */
  readOnly?: string | null;
  /** How many of the later ones this person may delete (defaults to laterCount). */
  deleteLaterCount?: number;
}) => {
  const delLater = deleteLaterCount ?? laterCount;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (r: EditEventResult) => { if (busy) return; setBusy(true); try { await onConfirm(r); } finally { setBusy(false); } };
  useEffect(() => { if (!open) setAsking(false); }, [open]);
  const del = async (which: 'one' | 'later') => { if (!onDelete) return; setBusy(true); try { await onDelete(which); } finally { setBusy(false); setAsking(false); } };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Edit event"
      desc={laterCount > 0 ? `One of a series, with ${laterCount} after it.` : 'Change this event.'}
      footer={asking ? (
        <div className="flex w-full flex-col gap-2">
          <button type="button" disabled={busy} onClick={() => void del('one')} className="h-11 w-full shrink-0 rounded-full bg-[#b42318] px-5 text-[14px] font-medium text-white disabled:opacity-40">{delLater > 0 ? 'Delete this one' : 'Delete it'}</button>
          {delLater > 0 && <button type="button" disabled={busy} onClick={() => void del('later')} className="h-11 w-full shrink-0 rounded-full border border-[#b42318] px-5 text-[14px] font-medium text-[#b42318] disabled:opacity-40">Delete this and the {delLater} after</button>}
          <button type="button" onClick={() => setAsking(false)} className="h-11 w-full shrink-0 rounded-full border border-[#ececee] px-5 text-[14px] font-medium text-[#16171a]">Keep it</button>
        </div>
      ) : (
        <div className="flex w-full gap-3">
          {onDelete && <button type="button" onClick={() => setAsking(true)} className="h-11 rounded-full border border-[#ececee] px-5 text-[14px] font-medium text-[#b42318] hover:bg-[#f5f5f7]">Delete</button>}
          <button type="button" onClick={() => onOpenChange(false)} className="ml-auto h-11 rounded-full border border-[#ececee] px-5 text-[14px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button type="submit" form="edit-event-form" disabled={busy} className="h-11 rounded-full bg-[#16171a] px-6 text-[14px] font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>}
        </div>
      )}>
      {open && <EditEventForm key={event.id} event={event} staff={staff} laterCount={laterCount} readOnly={readOnly} onConfirm={(r) => void save(r)} />}
    </Shell>
  );
};
