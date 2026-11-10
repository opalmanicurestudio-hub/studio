// src/lib/event-schedule.ts — MANY EVENTS AT ONCE, for the planner's New event (components/planner/EventsDialog).
//
// A season of practices and games, a class that meets twice a week, a run of school pickups: three ways in.
//   Repeats       — the same time on chosen weekdays, every week or every other week, until a date.
//   Several dates — a list of dates, each with its own time, typed in or read from a pasted schedule.
//   A calendar file (.ics) — the export most team and school apps offer, read as a list of dates.
// Everything here is pure: text in, rows out. Rows carry wall-clock times on the device's own clock (what the planner
// shows), and nothing is saved until the person has seen the list.

export type ScheduleRow = {
  /** yyyy-MM-dd */
  date: string;
  /** HH:mm (24-hour), or null when the line had no time. */
  start: string | null;
  end: string | null;
  /** What's left of the line once the date and time are read: "vs Tigers", "Practice", "Field 3". */
  label: string;
  location?: string;
  allDay?: boolean;
  /** A time read without am or pm, so it was guessed (5:30 is read as 5:30 pm). */
  guessed?: boolean;
};

export type ReadResult = {
  rows: ScheduleRow[];
  /** Lines with no date in them (a header row, say), left out. */
  skipped: string[];
  /** Dates already gone by, left out. */
  past: number;
  /** More than the most we add at once; the rest were left out. */
  over: number;
};

/** The most events one save adds. */
export const MAX_AT_ONCE = 200;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y: number, m: number, d: number) => {
  if (!(y > 1999 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const dayNum = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 86400000);
const fromDayNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_RE = /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b\.?/gi;

/** A year for a date written without one: this year, unless that's more than four months gone, then next year (a
 *  season pasted in November that runs into January), or more than ten and a half months off, then last year (December's games
 *  pasted in January). A date a few weeks back is a game already played. */
function yearFor(m: number, d: number, today: string): number {
  const y = Number(today.slice(0, 4));
  const n = dayNum(ymd(y, m, d)); const t = dayNum(today);
  return n < t - 120 ? y + 1 : n > t + 320 ? y - 1 : y;
}
const fullYear = (s: string | undefined, m: number, d: number, today: string) => {
  if (!s) return yearFor(m, d, today);
  const n = Number(s);
  return n < 100 ? 2000 + n : n;
};

type Found = { date: string; at: number; len: number };
function findDate(line: string, today: string): Found | null {
  const tries: { re: RegExp; read: (m: RegExpExecArray) => [number, number, number] | null }[] = [
    { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
    { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'),
      read: (m) => { const mo = MONTHS[m[1].toLowerCase()]; const d = Number(m[2]); return [fullYear(m[3], mo, d, today), mo, d]; } },
    { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'i'),
      read: (m) => { const mo = MONTHS[m[2].toLowerCase()]; const d = Number(m[1]); return [fullYear(m[3], mo, d, today), mo, d]; } },
    { re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/, read: (m) => { const mo = Number(m[1]); const d = Number(m[2]); return [fullYear(m[3], mo, d, today), mo, d]; } },
    { re: /\b(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})\b/, read: (m) => { const mo = Number(m[1]); const d = Number(m[2]); return [fullYear(m[3], mo, d, today), mo, d]; } },
  ];
  // The first date in the line wins ("Sat 11/14 9am, makeup for Oct 31" is the 14th), whichever way it's written.
  let best: Found | null = null;
  for (const t of tries) {
    const re = new RegExp(t.re.source, t.re.flags.includes('g') ? t.re.flags : `${t.re.flags}g`);
    for (const m of line.matchAll(re)) {
      if (best && (m.index ?? 0) >= best.at) break;
      const v = t.read(m as RegExpExecArray);
      if (v && validDate(v[0], v[1], v[2])) { best = { date: ymd(v[0], v[1], v[2]), at: m.index ?? 0, len: m[0].length }; break; }
    }
  }
  return best;
}

const MER = '(a\\.?m\\.?|p\\.?m\\.?|a|p)';
function to24(h: number, min: number, mer: string | undefined): number | null {
  if (h > 23 || min > 59) return null;
  const x = String(mer || '').toLowerCase().replace(/\./g, '');
  if (x.startsWith('p')) { if (h > 12) return null; return ((h % 12) + 12) * 60 + min; }
  if (x.startsWith('a')) { if (h > 12) return null; return (h % 12) * 60 + min; }
  return h * 60 + min;
}
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
/** A time written without am or pm: 1 to 6 reads as afternoon (practice at 5:30), 7 to 11 as morning, 12 as noon. */
const guess = (h: number) => (h >= 13 || h === 0 ? null : h <= 6 || h === 12 ? 'p' : 'a');

type Times = { start: string | null; end: string | null; guessed: boolean; at: number; len: number };
function findTimes(line: string): Times | null {
  // Every candidate range, in order: "Field 3-4 6:00-7:30 pm" is the second one.
  for (const range of line.matchAll(new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*${MER}?\\s*(?:-|–|—|to|until)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MER}?(?![\\w/])`, 'gi'))) {
    if (!(range[2] || range[3] || range[5] || range[6])) continue;
    const sh = Number(range[1]); const sm = Number(range[2] || 0); const eh = Number(range[4]); const em = Number(range[5] || 0);
    let sMer: string | undefined = range[3]; let eMer: string | undefined = range[6]; let guessed = false;
    if (!sMer && eMer) {
      // "5:30-7 pm": the start shares the end's half of the day, unless that would put it after the end.
      const asEnd = to24(sh, sm, eMer); const end = to24(eh, em, eMer);
      sMer = asEnd != null && end != null && asEnd <= end ? eMer : (String(eMer).toLowerCase().startsWith('p') ? 'a' : 'p');
    }
    if (!sMer && !eMer && sh <= 12 && eh <= 12) { sMer = guess(sh) || undefined; eMer = guess(eh) || undefined; guessed = true; }
    if (sMer && !eMer) eMer = sMer;
    const s = to24(sh, sm, sMer); let e = to24(eh, em, eMer);
    if (s != null && e != null) {
      if (e <= s && !range[6] && e + 12 * 60 > s && e + 12 * 60 < 24 * 60) e += 12 * 60;   // "11-1" is 11 am to 1 pm
      if (e > s) return { start: hhmm(s), end: hhmm(e), guessed, at: range.index ?? 0, len: range[0].length };
    }
  }
  const noon = /\bnoon\b/i.exec(line);
  const single = new RegExp(`\\b(\\d{1,2}):(\\d{2})\\s*${MER}?(?![\\w/])|\\b(\\d{1,2})\\s*${MER}(?![\\w/])`, 'i').exec(line);
  if (single) {
    const h = Number(single[1] ?? single[4]); const m = Number(single[2] || 0); let mer: string | undefined = single[3] ?? single[5];
    let guessed = false;
    // 09:00 or 18:30 is a 24-hour time; 5:30 without am or pm is a guess.
    if (!mer && h <= 12 && !String(single[1] ?? '').startsWith('0')) { mer = guess(h) || undefined; guessed = !!mer; }
    const s = to24(h, m, mer);
    if (s != null) return { start: hhmm(s), end: null, guessed, at: single.index, len: single[0].length };
  }
  if (noon) return { start: '12:00', end: null, guessed: false, at: noon.index, len: noon[0].length };
  return null;
}

function cleanLabel(s: string): string {
  return s
    .split('\t').map((c) => c.trim()).filter(Boolean).join(' · ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s,;:|·•\-–—]+|[\s,;:|·•\-–—]+$/g, '')
    .replace(/^(?:at|@)\s+|\s+(?:at|@)$/i, '')
    .trim();
}
/** A weekday written next to the date ("Sat, Nov 14", "Tuesday 11/17") is part of the date, not what the event is. A
 *  weekday anywhere else stays ("vs Sun Devils"). */
function dropWeekdayBeside(text: string, at: number, len: number): string {
  let out = text;
  for (const m of text.matchAll(WEEKDAY_RE)) {
    const s = m.index ?? 0; const e = s + m[0].length;
    const before = e <= at && /^[\s,.\t)]*$/.test(text.slice(e, at));
    // After the date only when it's set off ("Nov 14 (Sat)", "Nov 14, Sat 9am"), so "Nov 14 Sun Devils" keeps its name.
    const after = s >= at + len && /^[\s,.\t(]*$/.test(text.slice(at + len, s)) && /^\s*([),:\t]|$|\d)/.test(text.slice(e));
    if (before || after) out = `${out.slice(0, s)}${' '.repeat(m[0].length)}${out.slice(e)}`;
  }
  return out;
}

/** Reads a pasted schedule, one event per line: a date in any common form (Nov 14, 11/14, 2026-11-14, Saturday 14
 *  November), a time or a time range if there is one (9 am, 5:30-7 pm, 18:30), and the rest as what it is. */
export function parseSchedule(text: string, opts: { today: string }): ReadResult {
  const rows: ScheduleRow[] = []; const skipped: string[] = []; let past = 0; let over = 0;
  const today = dayNum(opts.today);
  for (const raw of String(text || '').split(/\r?\n/)) {
    // "5.30pm" is 5:30 pm.
    const line = raw.replace(/\u00a0/g, ' ').replace(/\b(\d{1,2})\.(\d{2})\s*([ap]\.?m\b\.?)/gi, '$1:$2$3').trimEnd();
    if (!line.trim()) continue;
    const d = findDate(line, opts.today);
    if (!d) { skipped.push(line.trim().slice(0, 120)); continue; }
    if (dayNum(d.date) < today) { past++; continue; }
    // Read the time from what's left once the date is out of the way, so "11/14" is never read as a time.
    const rest = dropWeekdayBeside(`${line.slice(0, d.at)}${' '.repeat(d.len)}${line.slice(d.at + d.len)}`, d.at, d.len);
    const t = findTimes(rest);
    const label = t ? `${rest.slice(0, t.at)} ${rest.slice(t.at + t.len)}` : rest;
    if (rows.length >= MAX_AT_ONCE) { over++; continue; }
    rows.push({ date: d.date, start: t?.start || null, end: t?.end || null, label: cleanLabel(label), ...(t?.guessed ? { guessed: true } : {}) });
  }
  return { rows: sortRows(rows), skipped, past, over };
}

export function sortRows(rows: ScheduleRow[]): ScheduleRow[] {
  return [...rows].sort((a, b) => (a.date + (a.start || '00:00')).localeCompare(b.date + (b.start || '00:00')));
}

/** The weekdays and dates of a repeating event: every week (or every other week) on the chosen days, from the first
 *  date through the last. 0 is Sunday. */
export function repeatDates(o: { from: string; until: string; weekdays: number[]; everyWeeks?: number }): string[] {
  const out: string[] = [];
  const start = dayNum(o.from); const end = dayNum(o.until);
  if (!(end >= start) || !o.weekdays.length) return out;
  const every = Math.max(1, Math.min(4, Math.round(o.everyWeeks || 1)));
  const firstSunday = start - new Date(start * 86400000).getUTCDay();
  for (let n = start; n <= end && out.length < MAX_AT_ONCE; n++) {
    const wd = new Date(n * 86400000).getUTCDay();
    const week = Math.floor((n - firstSunday) / 7);
    if (week % every === 0 && o.weekdays.includes(wd)) out.push(fromDayNum(n));
  }
  return out;
}

// ── Calendar files (.ics) ────────────────────────────────────────────────────
// Most team, league and school apps can export a calendar file. Each event in it becomes a row; a daily or weekly
// repeat in the file is spread into its dates (at the event's own clock time in its own time zone), a weekend
// tournament becomes one all-day row a day, and anything the reader can't follow is said, not guessed.

/** The offset of a time zone from UTC at an instant, in minutes. Throws for a zone the device doesn't know. */
function zoneOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - utcMs) / 60000);
}
/** A wall-clock time in a named zone, as an instant (null when the zone isn't one the device knows). */
export function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date | null {
  const guessMs = Date.UTC(y, mo - 1, d, h, mi);
  try {
    let off = zoneOffset(guessMs, tz);
    off = zoneOffset(guessMs - off * 60000, tz);
    return new Date(guessMs - off * 60000);
  } catch { return null; }
}
// Calendars from Outlook name zones their own way ("Eastern Standard Time", "(UTC-05:00) Eastern Time (US & Canada)").
// The specific names come first; a name that isn't here is read as written and said (never guessed into a region).
const WINDOWS_ZONES: [RegExp, string][] = [
  [/^us mountain|^arizona/, 'America/Phoenix'], [/^us eastern/, 'America/Indiana/Indianapolis'],
  [/^aus eastern/, 'Australia/Sydney'], [/^e\. australia/, 'Australia/Brisbane'], [/^aus central/, 'Australia/Darwin'],
  [/^cen\. australia/, 'Australia/Adelaide'], [/^w\. australia/, 'Australia/Perth'],
  [/^pacific sa/, 'America/Santiago'], [/^central pacific/, 'Pacific/Guadalcanal'], [/^central america/, 'America/Guatemala'],
  [/^central europe|^w\. europe|^romance/, 'Europe/Paris'], [/^e\. europe/, 'Europe/Bucharest'],
  [/^gmt standard|^greenwich|^london/, 'Europe/London'],
  [/^central (standard )?time \(mexico\)$|^central standard time \(mexico\)$/, 'America/Mexico_City'],
  [/^mountain (standard )?time \(mexico\)$/, 'America/Mazatlan'], [/^pacific (standard )?time \(mexico\)$/, 'America/Tijuana'],
  [/^eastern (standard )?time( \(us (&|and) canada\))?$/, 'America/New_York'], [/^central (standard )?time( \(us (&|and) canada\))?$/, 'America/Chicago'],
  [/^mountain (standard )?time( \(us (&|and) canada\))?$/, 'America/Denver'], [/^pacific (standard )?time( \(us (&|and) canada\))?$/, 'America/Los_Angeles'],
  [/^alaska/, 'America/Anchorage'], [/^hawaii/, 'Pacific/Honolulu'], [/^atlantic (standard )?time/, 'America/Halifax'],
  [/^utc$|^coordinated universal/, 'UTC'],
];
function zoneName(tz: string): string | null {
  const t = tz.trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t; } catch { /* not an IANA name */ }
  const bare = t.toLowerCase().replace(/^\(utc[^)]*\)\s*/, '').trim();
  const hit = WINDOWS_ZONES.find(([re]) => re.test(bare));
  return hit ? hit[1] : null;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number };
type IcsTime = { allDay: boolean; at: Date; date: string; wall: Wall; zone: 'utc' | 'floating' | string; unknownZone?: boolean };
function readIcsTime(params: string, value: string): IcsTime | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || /VALUE=DATE(?!-)/i.test(params)) {
    const m = dateOnly || /^(\d{4})(\d{2})(\d{2})/.exec(v); if (!m) return null;
    const wall = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: 0, mi: 0 };
    return { allDay: true, at: new Date(wall.y, wall.mo - 1, wall.d), date: `${m[1]}-${m[2]}-${m[3]}`, wall, zone: 'floating' };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const wall = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]) };
  const tzRaw = /TZID=("[^"]*"|[^;:]+)/i.exec(params)?.[1]?.replace(/^"|"$/g, '');
  if (m[7]) { const at = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi)); return { allDay: false, at, date: localYmd(at), wall, zone: 'utc' }; }
  if (tzRaw) {
    const tz = zoneName(tzRaw);
    const at = tz ? zonedInstant(wall.y, wall.mo, wall.d, wall.h, wall.mi, tz) : null;
    // A zone the device doesn't know: read as the same clock time here, and say so.
    if (at && tz) return { allDay: false, at, date: localYmd(at), wall, zone: tz };
    const local = new Date(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi);
    return { allDay: false, at: local, date: localYmd(local), wall, zone: 'floating', unknownZone: true };
  }
  const at = new Date(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi);   // "floating": the same clock time wherever you are
  return { allDay: false, at, date: localYmd(at), wall, zone: 'floating' };
}
/** The same clock time as `t`, on another date (in the event's own zone). */
function sameClockOn(t: IcsTime, y: number, mo: number, d: number): Date {
  if (t.allDay) return new Date(y, mo - 1, d);
  if (t.zone === 'utc') return new Date(Date.UTC(y, mo - 1, d, t.wall.h, t.wall.mi));
  if (t.zone === 'floating') return new Date(y, mo - 1, d, t.wall.h, t.wall.mi);
  return zonedInstant(y, mo, d, t.wall.h, t.wall.mi, t.zone) || new Date(y, mo - 1, d, t.wall.h, t.wall.mi);
}
const localYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const unescapeIcs = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
/** NAME;PARAMS:VALUE, where a quoted parameter may itself hold a colon. */
function splitLine(line: string): { key: string; params: string; value: string } | null {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) {
      const head = line.slice(0, i); const semi = head.indexOf(';');
      const key = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
      if (!/^[A-Z][A-Z0-9-]*$/.test(key)) return null;
      return { key, params: semi < 0 ? '' : head.slice(semi), value: line.slice(i + 1) };
    }
  }
  return null;
}

export type IcsReadResult = ReadResult & {
  /** Repeats the reader doesn't spread (monthly, yearly): read as their first date only. */
  onceOnly: number;
  /** Times in a time zone this device doesn't know: read as the same clock time here. */
  unknownZone: number;
};

/** Reads a calendar file: every event from today on, with its name, time and place. */
export function parseIcs(text: string, opts: { today: string }): IcsReadResult {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const rows: ScheduleRow[] = []; let past = 0; let over = 0; let onceOnly = 0; let unknownZone = 0;
  let depth = 0; let inEvent = false;
  let ev: Record<string, { params: string; value: string }[]> = {};
  const today = dayNum(opts.today);
  const push = (start: IcsTime, end: IcsTime | null, label: string, location: string) => {
    if (dayNum(start.date) < today) { past++; return; }
    if (rows.length >= MAX_AT_ONCE) { over++; return; }
    const sameDay = end && !end.allDay && localYmd(end.at) === start.date;
    rows.push({
      date: start.date, start: start.allDay ? null : localHm(start.at), end: start.allDay || !end ? null : sameDay ? localHm(end.at) : '23:59',
      label, ...(location ? { location } : {}), ...(start.allDay ? { allDay: true } : {}),
    });
  };
  /** One occurrence, with a weekend tournament (all day, ending days later) as a row a day. */
  const pushSpan = (start: IcsTime, end: IcsTime | null, label: string, location: string) => {
    if (start.allDay && end?.allDay) {
      const days = Math.max(1, Math.min(31, dayNum(end.date) - dayNum(start.date)));   // the end date is the day after
      for (let k = 0; k < days; k++) {
        const date = fromDayNum(dayNum(start.date) + k); const [y, mo, d] = date.split('-').map(Number);
        push({ ...start, at: new Date(y, mo - 1, d), date }, null, label, location);
      }
      return;
    }
    push(start, end, label, location);
  };
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { inEvent = true; depth = 0; ev = {}; continue; }
    if (inEvent && /^BEGIN:/i.test(line)) { depth++; continue; }      // an alarm inside the event isn't the event
    if (inEvent && depth > 0 && /^END:/i.test(line)) { depth--; continue; }
    if (/^END:VEVENT/i.test(line)) {
      inEvent = false;
      const get = (k: string) => ev[k]?.[0];
      if (/CANCELLED/i.test(get('STATUS')?.value || '')) continue;
      const ds = get('DTSTART'); if (!ds) continue;
      const start = readIcsTime(ds.params, ds.value); if (!start) continue;
      if (start.unknownZone) unknownZone++;
      const de = get('DTEND');
      let end = de ? readIcsTime(de.params, de.value) : null;
      const dur = get('DURATION')?.value;
      if (!end && dur && !start.allDay) {
        const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i.exec(dur);
        if (m) { const mins = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0); const at = new Date(start.at.getTime() + mins * 60000); end = { ...start, at, date: localYmd(at) }; }
      }
      const label = unescapeIcs(get('SUMMARY')?.value || '');
      const location = unescapeIcs(get('LOCATION')?.value || '');
      const rule = get('RRULE')?.value;
      if (!rule) { pushSpan(start, end, label, location); continue; }
      const r: Record<string, string> = Object.fromEntries(rule.split(';').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
      const freq = String(r.FREQ || '').toUpperCase();
      if (freq !== 'WEEKLY' && freq !== 'DAILY') { onceOnly++; pushSpan(start, end, label, location); continue; }
      // Spread a daily or weekly repeat over the event's own calendar (its own zone's dates and clock time).
      const every = Math.max(1, Number(r.INTERVAL || 1));
      const count = r.COUNT ? Number(r.COUNT) : Infinity;
      const untilT = r.UNTIL ? readIcsTime(/T/.test(r.UNTIL) ? '' : 'VALUE=DATE', r.UNTIL) : null;
      const first = dayNum(ymd(start.wall.y, start.wall.mo, start.wall.d));
      // The loop walks the event's own dates; the last one is checked against UNTIL as an instant (it's in UTC), or
      // as a date when UNTIL is a date.
      const until = untilT ? (untilT.allDay ? dayNum(untilT.date) : dayNum(untilT.date) + 1) : today + 366;
      const untilMs = untilT && !untilT.allDay ? untilT.at.getTime() : Infinity;
      const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const days = freq === 'WEEKLY' ? (r.BYDAY ? r.BYDAY.split(',').map((x) => codes.indexOf(x.slice(-2).toUpperCase())).filter((x) => x >= 0) : [new Date(first * 86400000).getUTCDay()]) : [0, 1, 2, 3, 4, 5, 6];
      const skip = new Set((ev.EXDATE || []).flatMap((x) => x.value.split(',').map((v) => readIcsTime(x.params, v)).filter(Boolean).map((t) => (t!.allDay ? t!.date : String(Math.round(t!.at.getTime() / 60000))))));
      const firstSunday = first - new Date(first * 86400000).getUTCDay();
      const length = end ? end.at.getTime() - start.at.getTime() : 0;
      let made = 0;
      for (let n = first; n <= until && made < count && n - first < 3700; n++) {
        const wd = new Date(n * 86400000).getUTCDay();
        const ok = freq === 'DAILY' ? (n - first) % every === 0 : Math.floor((n - firstSunday) / 7) % every === 0 && days.includes(wd);
        if (!ok) continue;
        made++;
        // Dates well before today only count toward COUNT: no time-zone work for them.
        if (n < today - 1) { past++; continue; }
        const [y, mo, d] = fromDayNum(n).split('-').map(Number);
        const at = sameClockOn(start, y, mo, d);
        if (at.getTime() > untilMs) break;
        if (skip.has(start.allDay ? fromDayNum(n) : String(Math.round(at.getTime() / 60000)))) continue;
        const s: IcsTime = { ...start, at, date: start.allDay ? fromDayNum(n) : localYmd(at) };
        const e: IcsTime | null = end ? { ...end, at: new Date(at.getTime() + length), date: localYmd(new Date(at.getTime() + length)) } : null;
        pushSpan(s, e, label, location);
      }
      continue;
    }
    if (!inEvent || depth > 0) continue;
    const m = splitLine(line);
    if (!m) continue;
    (ev[m.key] = ev[m.key] || []).push({ params: m.params, value: m.value });
  }
  return { rows: sortRows(rows), skipped: [], past, over, onceOnly, unknownZone };
}

// ── From rows to events ─────────────────────────────────────────────────────

export type Occurrence = { startTime: Date; endTime: Date; title: string; location: string; allDay: boolean;
  /** The date's own words ("vs Tigers"), kept apart from the name so a later rename keeps them. */
  label: string;
  /** The row ended before it started, so the default length was used instead. */
  endFixed?: boolean };

/** The events a list of rows makes: each row's own time, or the default time and length when it has none; the
 *  name is the event's name with the row's own words after it ("Soccer · vs Tigers"). */
export function occurrencesFrom(rows: ScheduleRow[], o: { title: string; defaultStart: string; minutes: number; location?: string; allDay?: boolean }): Occurrence[] {
  const base = String(o.title || '').trim();
  return sortRows(rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) && !isNaN(Date.parse(`${r.date}T00:00:00Z`)))).slice(0, MAX_AT_ONCE).map((r) => {
    const [y, mo, d] = r.date.split('-').map(Number);
    const allDay = !!(o.allDay || r.allDay);
    const [sh, sm] = (allDay ? '00:00' : r.start || o.defaultStart || '09:00').split(':').map(Number);
    const startTime = new Date(y, mo - 1, d, sh, sm);
    let endTime: Date;
    if (allDay) endTime = new Date(y, mo - 1, d, 23, 59);
    else if (r.end && r.start) { const [eh, em] = r.end.split(':').map(Number); endTime = new Date(y, mo - 1, d, eh, em); }
    else endTime = new Date(startTime.getTime() + Math.max(5, o.minutes || 60) * 60000);
    const endFixed = endTime <= startTime;
    if (endFixed) endTime = new Date(startTime.getTime() + Math.max(5, o.minutes || 60) * 60000);
    const label = String(r.label || '').trim();
    const title = base && label && label.toLowerCase() !== base.toLowerCase() ? `${base} · ${label}` : base || label || 'Event';
    return { startTime, endTime, title: title.slice(0, 120), location: String(r.location || o.location || '').trim(), allDay, label, ...(endFixed ? { endFixed: true } : {}) };
  });
}
