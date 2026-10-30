// src/lib/pickup-slots.ts — WHEN AN ONLINE ORDER CAN BE COLLECTED (pure). Phase C of pickup and delivery: checkout
// never offers a time the shop can't meet. From the shop's pickup plan (retailSettings.pickupPlan):
//   · opening hours for each day of the week, one or two stretches a day, in the shop's time zone;
//   · closures (a day or a run of days, with a note), when nothing is offered;
//   · pickup windows of a set length inside the hours, each taking a set number of orders, or a number for each person
//     on shift in it (the team's shifts), whichever is smaller;
//   · prep time: a window is offered only if the order can be ready before it starts;
//   · a same-day cutoff: orders after it are for the next open day;
//   · a pause: no times at all until the shop resumes, or until the time it chose.
// The same answers drive the checkout's choices and the server's check when the order is placed (api/retail/checkout,
// which counts the orders already in a window in the same step it adds one).
import { dayKey, wallParts, wallToUtc } from '@/lib/tenant-time';

export type Stretch = { open: string; close: string };
export type PickupPlan = {
  /** Day of the week ('0' Sunday … '6' Saturday): its open stretches, or none when closed. */
  hours: Record<string, Stretch[]>;
  closures: { from: string; to: string; note?: string }[];
  windowMinutes: number;
  /** Orders a window can take; null = no limit. */
  perWindow: number | null;
  /** Orders each person on shift can get ready in a window; null = shifts aren't used. */
  perPerson: number | null;
  prepMinutes: number;
  /** 'HH:MM' on the shop's clock: orders after it go to the next open day. null = no cutoff. */
  sameDayCutoff: string | null;
  daysAhead: number;
  /** ISO time online pickup resumes; 'manual' = until the shop resumes it. null = not paused. */
  pausedUntil: string | null;
  pauseNote: string;
};

export type PickupWindow = { key: string; start: string; end: string; day: string; label: string; left: number | null; full: boolean };

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
// A stretch may close at midnight ('24:00'); nothing else past 23:59.
const CLOSE = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const mins = (hm: string) => { if (hm === '24:00') return 1440; const m = HM.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const int = (v: any, lo: number, hi: number, dflt: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

/** A saved plan, cleaned: anything malformed is dropped rather than trusted. A plan with no hours offers no windows. */
export function cleanPlan(raw: any): PickupPlan {
  const hours: Record<string, Stretch[]> = {};
  for (let d = 0; d < 7; d++) {
    const list = Array.isArray(raw?.hours?.[String(d)]) ? raw.hours[String(d)] : [];
    hours[String(d)] = list
      .map((s: any) => ({ open: String(s?.open || ''), close: String(s?.close || '') }))
      .filter((s: Stretch) => HM.test(s.open) && CLOSE.test(s.close) && mins(s.close) > mins(s.open))
      .sort((a: Stretch, b: Stretch) => mins(a.open) - mins(b.open))
      .slice(0, 3);
  }
  const closures = (Array.isArray(raw?.closures) ? raw.closures : [])
    .map((c: any) => ({ from: String(c?.from || ''), to: String(c?.to || c?.from || ''), note: String(c?.note || '').replace(/\s+/g, ' ').trim().slice(0, 80) }))
    .filter((c: any) => DAY_KEY.test(c.from) && DAY_KEY.test(c.to) && c.to >= c.from)
    .slice(0, 60);
  const per = (v: any) => (v === null || v === undefined || v === '' ? null : int(v, 1, 500, 1));
  const cut = String(raw?.sameDayCutoff || '');
  const paused = raw?.pausedUntil === 'manual' ? 'manual' : Number.isFinite(Date.parse(String(raw?.pausedUntil || ''))) ? new Date(Date.parse(String(raw.pausedUntil))).toISOString() : null;
  return {
    hours, closures,
    windowMinutes: [30, 60, 90, 120, 180, 240].includes(Number(raw?.windowMinutes)) ? Number(raw.windowMinutes) : 60,
    perWindow: per(raw?.perWindow), perPerson: per(raw?.perPerson),
    prepMinutes: int(raw?.prepMinutes, 0, 7 * 24 * 60, 60),
    sameDayCutoff: HM.test(cut) ? cut : null,
    daysAhead: int(raw?.daysAhead, 1, 30, 7),
    pausedUntil: paused, pauseNote: String(raw?.pauseNote || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

/**
 * The shop's plan as checkout, the Pickup times screen and its route all read it. Prep time is the shop's one "ready
 * in" setting (retailSettings.prepMinutes, also on Shop settings and the team's due clock); unset or 0 there means the
 * same 30 minutes the due clock uses. An older plan's own prep time is read only when the shared one was never set.
 */
export function planFrom(rs: any): PickupPlan {
  const shared = Math.floor(Number(rs?.prepMinutes));
  const legacy = Math.floor(Number(rs?.pickupPlan?.prepMinutes));
  const prep = shared > 0 ? shared : legacy > 0 ? legacy : 30;
  return cleanPlan({ ...(rs?.pickupPlan || {}), prepMinutes: prep });
}

/** Whether the shop has set its hours yet (until it has, checkout offers no times, only "ready in about" as before). */
export const hasHours = (p: PickupPlan) => Object.values(p.hours).some((s) => s.length > 0);

/** Paused right now (online pickup only; the shop itself may be open). */
export function isPaused(p: PickupPlan, now: number): boolean {
  if (!p.pausedUntil) return false;
  return p.pausedUntil === 'manual' || Date.parse(p.pausedUntil) > now;
}

export const closureOn = (p: PickupPlan, day: string) => p.closures.find((c) => c.from <= day && day <= c.to) || null;

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T12:00:00Z`) + n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

function fmtTime(ms: number, tz: string): string {
  const p = wallParts(new Date(ms), tz);
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return p.minute ? `${h}:${String(p.minute).padStart(2, '0')}` : String(h);
}
const ampm = (ms: number, tz: string) => (wallParts(new Date(ms), tz).hour < 12 ? 'am' : 'pm');

/** "Today", "Tomorrow" or "Sat Nov 1" for a day, from the shop's today. */
export function dayWord(day: string, today: string): string {
  if (today && day === today) return 'Today';
  if (today && day === addDays(today, 1)) return 'Tomorrow';
  const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(`${day}T12:00:00Z`));
  const v = (t: string) => parts.find((x) => x.type === t)?.value || '';
  return `${v('weekday')} ${v('month')} ${v('day')}`;
}

/** "today 4:30 pm", "tomorrow 10 am", "Sat Nov 1 9 am". */
export function whenLabel(ms: number, tz: string, today: string): string {
  const w = dayWord(dayKey(new Date(ms), tz), today);
  return `${w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : w} ${fmtTime(ms, tz)} ${ampm(ms, tz)}`;
}

/** When a pause ends, in words: "tomorrow" for midnight (the rest of today), otherwise "today 3:30 pm". */
export function pauseEndWords(iso: string, tz: string, today: string): string {
  const ms = Date.parse(iso);
  const p = wallParts(new Date(ms), tz);
  if (p.hour === 0 && p.minute === 0) { const w = dayWord(dayKey(new Date(ms), tz), today); return w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : w; }
  return whenLabel(ms, tz, today);
}

/** "Today 2–4 pm", "Tomorrow 11 am–1 pm". */
export function windowLabel(startMs: number, endMs: number, tz: string, today: string): string {
  const day = dayKey(new Date(startMs), tz);
  const a = ampm(startMs, tz), b = ampm(endMs, tz);
  return `${dayWord(day, today)} ${fmtTime(startMs, tz)}${a === b ? '' : ` ${a}`}–${fmtTime(endMs, tz)} ${b}`;
}

/** "Thu Oct 29, 2–4 pm": the same window named by its date, for anything read later (the order, emails, the team). */
export function windowLabelOn(startMs: number, endMs: number, tz: string): string {
  const day = dayKey(new Date(startMs), tz);
  const a = ampm(startMs, tz), b = ampm(endMs, tz);
  return `${dayWord(day, '')}, ${fmtTime(startMs, tz)}${a === b ? '' : ` ${a}`}–${fmtTime(endMs, tz)} ${b}`;
}

/** The window's key: its start on the shop's clock, which is what orders in it are counted by. */
export const windowKey = (startMs: number, tz: string) => { const p = wallParts(new Date(startMs), tz); return `${dayKey(new Date(startMs), tz)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };

/** The open stretches from a day on, as instants, skipping closed days and (when `skipToday`) today. */
function stretchesFrom(p: PickupPlan, today: string, tz: string, skipToday: boolean): { day: string; open: number; close: number; s: Stretch }[] {
  const out: { day: string; open: number; close: number; s: Stretch }[] = [];
  for (let i = 0; i < p.daysAhead; i++) {
    const day = addDays(today, i);
    if ((i === 0 && skipToday) || closureOn(p, day)) continue;
    for (const s of p.hours[String(weekday(day))] || []) {
      const o = mins(s.open), c = mins(s.close);
      out.push({ day, s, open: wallToUtc(day, Math.floor(o / 60), o % 60, tz).getTime(), close: wallToUtc(day, Math.floor(c / 60), c % 60, tz).getTime() });
    }
  }
  return out;
}

const pastCutoffNow = (p: PickupPlan, now: number, tz: string) => { const n = wallParts(new Date(now), tz); return p.sameDayCutoff !== null && n.hour * 60 + n.minute >= mins(p.sameDayCutoff); };

/**
 * The earliest an order placed now can be ready. Prep runs only while the shop is open: what's left at closing carries
 * on at the next opening, past closed days. After the same-day cutoff it starts on the next open day. null when nothing
 * is open long enough in the days offered (or the shop is paused, or has no hours).
 */
export function readyAt(p: PickupPlan, now: number, tz: string): number | null {
  if (!hasHours(p) || isPaused(p, now)) return null;
  let need = p.prepMinutes * 60e3;
  for (const st of stretchesFrom(p, dayKey(new Date(now), tz), tz, pastCutoffNow(p, now, tz))) {
    if (st.close <= now) continue;
    const from = Math.max(st.open, now);
    if (from + need <= st.close) return from + need;
    need -= st.close - from;
  }
  return null;
}

/**
 * The windows to offer, in order. `booked` is how many orders each window already has (by key); `onShift` says how
 * many people are on shift across a window (only asked when the plan counts people). A full window is listed, marked
 * full, so the customer sees why it isn't there; a closed day, a paused shop, a window that starts before the order
 * could be ready (the same answer as readyAt), or a day past the cutoff are never offered.
 */
export function pickupWindows(p: PickupPlan, now: number, tz: string, booked: Record<string, number> = {}, onShift?: (startMs: number, endMs: number) => number | null): PickupWindow[] {
  const ready = readyAt(p, now, tz);
  if (ready === null) return [];
  const today = dayKey(new Date(now), tz);
  const out: PickupWindow[] = []; const seen = new Set<string>();
  for (const st of stretchesFrom(p, today, tz, pastCutoffNow(p, now, tz))) {
    for (let m = mins(st.s.open); m + p.windowMinutes <= mins(st.s.close); m += p.windowMinutes) {
      const start = wallToUtc(st.day, Math.floor(m / 60), m % 60, tz).getTime();
      const end = wallToUtc(st.day, Math.floor((m + p.windowMinutes) / 60), (m + p.windowMinutes) % 60, tz).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < ready) continue;
      // A clock change can make two wall times the same instant (or skip one): each window once, by its key.
      const key = windowKey(start, tz);
      if (seen.has(key) || key !== `${st.day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`) continue;
      seen.add(key);
      let cap: number | null = p.perWindow;
      if (p.perPerson !== null && onShift) {
        const people = onShift(start, end);
        if (people !== null) cap = Math.min(cap ?? Infinity, people * p.perPerson);
      }
      const left = cap === null ? null : Math.max(0, cap - (booked[key] || 0));
      out.push({ key, start: new Date(start).toISOString(), end: new Date(end).toISOString(), day: st.day, label: windowLabel(start, end, tz, today), left, full: left === 0 });
    }
  }
  return out;
}

/**
 * "Ready today by 4:30 pm": when the order can be collected. The earliest it can be ready, or, when the windows that
 * early are full, the start of the first window with room, so it never names a time that can't be had. null when
 * there's nothing to offer.
 */
export function readyBy(p: PickupPlan, now: number, tz: string, windows?: PickupWindow[]): { at: string; label: string } | null {
  const r = readyAt(p, now, tz);
  if (r === null) return null;
  const firstOpen = windows ? windows.find((w) => !w.full) : null;
  if (windows && !firstOpen) return null;
  const at = firstOpen ? Math.max(r, Date.parse(firstOpen.start)) : r;
  const w = whenLabel(at, tz, dayKey(new Date(now), tz)).split(' '); const t = w.splice(-2).join(' ');
  return { at: new Date(at).toISOString(), label: `Ready ${w.join(' ')} by ${t}` };
}

/**
 * People on shift through a window: the fewest working at any moment of it, so staggered cover (one until 1, another
 * from 1) still counts as one person. A day with no shifts published at all isn't sized by people (null): the
 * shop's own limit applies, rather than every window looking full.
 */
export function peopleThrough(shifts: { staffId: string; start: number; end: number }[], ws: number, we: number): number | null {
  if (!shifts.length) return null;
  const points = [ws, ...shifts.flatMap((s) => [s.start, s.end]).filter((x) => x > ws && x < we)];
  let least = Infinity;
  for (const pt of points) least = Math.min(least, new Set(shifts.filter((s) => s.start <= pt && s.end > pt).map((s) => s.staffId)).size);
  return least === Infinity ? 0 : least;
}

export type ShiftSpan = { date: string; staffId: string; start: number; end: number };

/** Work shifts as spans of minutes on the shop's clock, from shift records (cancelled, draft and non-work ones left out). */
export function shiftSpans(rows: any[]): ShiftSpan[] {
  const hm = (v: any) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  return rows.flatMap((s: any) => {
    if (['cancelled', 'draft'].includes(String(s?.status || '')) || (s?.kind && s.kind !== 'work')) return [];
    const start = hm(s?.startTime), end = hm(s?.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !/^\d{4}-\d{2}-\d{2}$/.test(String(s?.date || ''))) return [];
    return [{ date: String(s.date), staffId: String(s.staffId || ''), start, end }];
  });
}

/** How many people are on through a window, from the shift spans (null for a day with none published). */
export function shiftLookup(spans: ShiftSpan[], tz: string): (startMs: number, endMs: number) => number | null {
  const byDay = new Map<string, ShiftSpan[]>();
  for (const s of spans) { const l = byDay.get(s.date) || []; l.push(s); byDay.set(s.date, l); }
  return (startMs: number, endMs: number) => {
    const a = wallParts(new Date(startMs), tz), b = wallParts(new Date(endMs), tz);
    const ws = a.hour * 60 + a.minute, we = b.hour * 60 + b.minute || 24 * 60;
    return peopleThrough(byDay.get(dayKey(new Date(startMs), tz)) || [], ws, we);
  };
}

/** Why there's nothing to offer, in the customer's words. */
export function noPickupReason(p: PickupPlan, now: number, tz: string): string {
  if (isPaused(p, now)) {
    const until = p.pausedUntil && p.pausedUntil !== 'manual' ? ` until ${pauseEndWords(p.pausedUntil, tz, dayKey(new Date(now), tz))}` : '';
    return `Online pickup is paused${until}.${p.pauseNote ? ` ${p.pauseNote}` : ''}`;
  }
  return 'There are no pickup times in the next few days. Choose another way to get it, or check back soon.';
}
