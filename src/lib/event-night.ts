// src/lib/event-night.ts — EVENT NIGHT (design canvas "Event night"; lib/event-night-server, api/event-night, the
// panel on the event's manifest page). Three things the team runs a ticketed dinner by:
//   The run of show — the night's moments in order (doors, seated, each course, a speech, close), each at a time on the
//     business's clock. A moment for a course is when that course fires. On the night it shows what's done, what's next
//     and how long until it; "Push" moves everything still to come later.
//   Course pacing — from the kitchen's tickets for the event: how much of the course that's out has reached the tables,
//     and whether the next one should fire now, hold, or is on time. When the kitchen is behind on everyone else's
//     orders (lib/kitchen-pace, Table service's busy setting), the next course fires that much early once the one before
//     is mostly out, so it still lands near its time; while that one is still going out, it says to move the night.
//   The prep — portions of each dish from the guests' course choices, and the allergies and diets in the room.
// Always plain words; nothing fires by itself. Pure.

export const MAX_MOMENTS = 20;
export const PUSH_MIN = 5, PUSH_MAX = 60;
/** Most of a course is out once this share of its plates has reached the tables. */
export const MOSTLY_OUT = 0.75;
/** How long a course takes the kitchen when this event hasn't fired one yet. */
export const DEFAULT_COURSE_MIN = 12;
/** A busy kitchen fires a course at most this much early. */
export const EARLY_MAX = 20;
/** The push offered for a busy kitchen: its delay, within what Push takes. */
export const pushFor = (behindMin: number) => Math.max(PUSH_MIN, Math.min(PUSH_MAX, Math.round(behindMin)));

export type Moment = { id: string; at: string; what: string; course: number | null; note: string | null };
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ID = /^[a-z0-9]{1,12}$/;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const toMin = (hm: string) => { const m = HM.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
/** A clock time; past midnight it carries on from 00:00 (a late night). */
export const toHM = (min: number) => { const x = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
/** A moment's minutes counted from the start of the event's day: on an evening event (starting 6 pm or later), a time
 *  before 6 am is after midnight, so 00:30 on a night that starts at 10 pm is 24:30. */
export const relMin = (hm: string, startMin: number) => { const m = toMin(hm); return m < 360 && startMin >= 18 * 60 ? m + 1440 : m; };
const byTime = (start: number) => (a: Moment, b: Moment) => relMin(a.at, start) - relMin(b.at, start) || (a.course ?? 99) - (b.course ?? 99);

/** A run of show as saved: each moment with a time and what happens; a course number only once. Null when it can't be.
 *  Read back (`kept`), a moment whose course is no longer on the menu stays, as a moment that isn't a course, so a
 *  manager's plan never disappears because the menu changed. */
export function cleanShow(raw: unknown, courses: number[], o: { start?: number | null; kept?: boolean } = {}): Moment[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_MOMENTS) return null;
  const out: Moment[] = []; const seen = new Set<number>(); const ids = new Set<string>();
  for (const [i, r] of raw.entries()) {
    const x: any = r || {}; const at = String(x.at || ''); const what = clip(x.what, 80);
    if (!HM.test(at) || !what) return null;
    let course = x.course === null || x.course === undefined || x.course === '' ? null : Number(x.course);
    if (course !== null && (!courses.includes(course) || seen.has(course))) { if (!o.kept) return null; course = null; }
    if (course !== null) seen.add(course);
    let id = ID.test(String(x.id || '')) ? String(x.id) : `m${i + 1}`; while (ids.has(id)) id = `${id}x`.slice(-12); ids.add(id);
    out.push({ id, at, what, course, note: clip(x.note, 80) || null });
  }
  return out.sort(byTime(o.start ?? guessStart(out)));
}
/** With no start time: the earliest evening moment (6 pm on), so a moment after midnight isn't read as the start; or
 *  the earliest moment of a daytime event. */
const guessStart = (show: Moment[]) => { const t = show.map((m) => toMin(m.at)); const eve = t.filter((x) => x >= 18 * 60); return eve.length ? Math.min(...eve) : t.length ? Math.min(...t) : 0; };
/** Where a night starts, for reading its times: the event's start, or a guess from its moments. */
export const startOfShow = (start: string | null, show: Moment[]) => (start && HM.test(start) ? toMin(start) : guessStart(show));

/** A first run of show from the event's start and its courses: doors half an hour before, seated at the start, a course
 *  every 35 minutes from a quarter past, and a close 45 minutes after the last. The team changes it as they like. */
export function suggestShow(start: string | null, courses: { n: number; name: string }[]): Moment[] {
  const s = HM.test(String(start || '')) ? toMin(String(start)) : 19 * 60;
  const out: Moment[] = [{ id: 'doors', at: toHM(s - 30), what: 'Doors open', course: null, note: null }, { id: 'seated', at: toHM(s), what: 'Guests seated', course: null, note: null }];
  const list = courses.slice().sort((a, b) => a.n - b.n);
  list.forEach((c, i) => out.push({ id: `c${c.n}`, at: toHM(s + 15 + i * 35), what: c.name, course: c.n, note: null }));
  out.push({ id: 'close', at: toHM(s + 15 + Math.max(0, list.length - 1) * 35 + 45), what: 'Thank you, close', course: null, note: null });
  return out;
}

/** Everything still to come (a course still to fire, or a moment not yet reached), later: the next moment to `minutes`
 *  from now if it's overdue, otherwise `minutes` later, and the rest by the same, so the spacing stays. `nowMin` is on
 *  the night's own count (past midnight, over 24 hours). */
export function pushLater(show: Moment[], nowMin: number, fired: Set<number>, minutes: number, start: number): Moment[] {
  const left = (m: Moment) => (m.course !== null ? !fired.has(m.course) : relMin(m.at, start) >= nowMin);
  const rest = show.filter(left); if (!rest.length) return show;
  const first = Math.min(...rest.map((m) => relMin(m.at, start)));
  const by = Math.max(first, nowMin) + minutes - first;
  return show.map((m) => (left(m) ? { ...m, at: toHM(relMin(m.at, start) + by) } : m)).sort(byTime(start));
}

export type MomentState = 'done' | 'next' | 'later';
/** Where the night is: a course moment is done once it's fired; any other once its time has come. The first one not done
 *  is next, with the minutes until it (negative when it's late). */
export function nightState(show: Moment[], fired: Map<number, string>, nowMin: number, start: number): { states: Record<string, MomentState>; next: Moment | null; inMin: number | null } {
  const states: Record<string, MomentState> = {}; let next: Moment | null = null;
  for (const m of show) {
    const done = m.course !== null ? fired.has(m.course) : relMin(m.at, start) <= nowMin;
    if (done) states[m.id] = 'done'; else if (!next) { next = m; states[m.id] = 'next'; } else states[m.id] = 'later';
  }
  return { states, next, inMin: next ? relMin(next.at, start) - nowMin : null };
}

export type CourseTicket = { courseNumber: number; status: string; createdAt?: string | null; readyAt?: string | null; deliveredAt?: string | null; carriedAt?: string | null };
export type Pacing = { state: 'waiting' | 'on_pace' | 'fire_now' | 'hold' | 'ready' | 'done'; course: number | null; out: number; atPass: number; total: number; next: number | null; fireAt: string | null; kitchenMin: number; words: string;
  /** Minutes the next course fires early for a busy kitchen (0 when it isn't), and the time it fires at then. */
  early: number; fireBy: string | null;
  /** A push to offer (minutes) when the kitchen is behind and the course before is still going out. */
  pushMin: number | null };
/** A plate is out once it's on its way to the table (someone took it from the pass) or there. */
const isOut = (t: CourseTicket) => t.status === 'delivered' || t.status === 'served' || !!t.carriedAt;
const nameOf = (names: Record<number, string>, n: number) => names[n] || `Course ${n}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const mins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

/** How the courses are going: the last one fired, how many of its plates are out, and what to do about the next. */
export function coursePacing(o: { courses: number[]; names: Record<number, string>; fires: { courseNumber: number; firedAt: string }[]; tickets: CourseTicket[]; show: Moment[]; nowMin: number; start: number; clock: (hm: string) => string;
  /** How far behind the kitchen is on everyone else's orders (0 when it isn't, or the setting is off). */
  behindMin?: number }): Pacing {
  const behind = Math.max(0, Math.round(Number(o.behindMin) || 0));
  const courses = Array.from(new Set(o.courses)).sort((a, b) => a - b);
  const firedAt = new Map<number, string>(); for (const f of o.fires) { const t = String(f.firedAt || ''); if (!firedAt.has(f.courseNumber) || t < firedAt.get(f.courseNumber)!) firedAt.set(f.courseNumber, t); }
  // How long a course has taken the kitchen tonight: from its fire to its last plate ready.
  const took: number[] = [];
  for (const [n, at] of firedAt) { const t = o.tickets.filter((x) => x.courseNumber === n && x.status !== 'cancelled'); const ready = t.map((x) => Date.parse(String(x.readyAt || x.deliveredAt || ''))).filter(Number.isFinite);
    if (t.length && ready.length === t.length) took.push(Math.max(1, Math.round((Math.max(...ready) - Date.parse(at)) / 60000))); }
  const kitchenMin = took.length ? Math.round(took.reduce((a, b) => a + b, 0) / took.length) : DEFAULT_COURSE_MIN;
  const firedList = courses.filter((n) => firedAt.has(n)); const last = firedList.length ? firedList[firedList.length - 1] : null;
  const next = courses.find((n) => !firedAt.has(n)) ?? null;
  const planned = next !== null ? o.show.find((m) => m.course === next)?.at || null : null;
  const due = planned ? relMin(planned, o.start) - o.nowMin : null;
  // A busy kitchen: the next course fires early by its delay (only while there's time to), so it lands near its time.
  const early = planned && next !== null && due !== null && due > 1 ? Math.min(behind, EARLY_MAX, Math.max(0, due - 1)) : 0;
  const fireBy = planned ? (early ? toHM(relMin(planned, o.start) - early) : planned) : null;
  const fireIn = due !== null ? due - early : null;
  const busy = behind > 0 ? `The kitchen is about ${mins(behind)} behind` : '';
  const base = { next, fireAt: planned, kitchenMin, early, fireBy, pushMin: null as number | null };
  // Fired now with the kitchen behind, a course lands that much later than now (or on its time, fired early enough).
  const lands = behind > 0 && planned ? (early >= behind ? planned : toHM(o.nowMin + behind)) : null;
  if (last === null) {
    const first = next !== null ? nameOf(o.names, next) : '';
    if (next !== null && fireIn !== null && fireIn <= 1) return { ...base, state: 'fire_now', course: null, out: 0, atPass: 0, total: 0,
      words: behind > 0 ? `${busy}, so fire ${lower(first)} when the room is ready, to reach the tables near ${o.clock(lands!)}.${due! < -1 ? ` It was due at ${o.clock(planned!)}.` : ''}` : `Fire ${lower(first)} when the room is ready.${due! < -1 ? ` It was due at ${o.clock(planned!)}.` : ''}` };
    return { ...base, state: 'waiting', course: null, out: 0, atPass: 0, total: 0, words: next !== null && planned ? (early ? `${first} fires at ${o.clock(fireBy!)}, ${mins(early)} early: ${lower(busy)}.` : `${first} fires at ${o.clock(planned)}.`) : '' };
  }
  const t = o.tickets.filter((x) => x.courseNumber === last && x.status !== 'cancelled'); const total = t.length; const out = t.filter(isOut).length;
  const atPass = t.filter((x) => x.status === 'ready' && !x.carriedAt).length;
  const mostly = total > 0 && out / total >= MOSTLY_OUT;
  const lastName = nameOf(o.names, last); const outText = `${out} of ${total} plates out`;
  if (next === null) return { ...base, state: 'done', course: last, out, atPass, total, words: mostly ? 'Every course has fired, and the last is mostly out.' : `Every course has fired. ${lastName}: ${outText}.` };
  const nextName = nameOf(o.names, next);
  if (due !== null && fireIn !== null && fireIn <= 1) {
    const late = due < -1 ? ` It was due at ${o.clock(planned!)}.` : '';
    if (mostly) return { ...base, state: 'fire_now', course: last, out, atPass, total, words: behind > 0
      ? `${busy}. Most of ${lower(lastName)} is out (${outText}), so fire ${lower(nextName)} now to reach the tables near ${o.clock(lands!)}.${late}`
      : `Most of ${lower(lastName)} is out (${outText}). Fire ${lower(nextName)} now.${late}` };
    // Still going out: firing early would crowd the tables. Once its time has come, the night is moved instead (offered,
    // never by itself); before then, only said, since the course before may still clear in time.
    const pushMin = behind > 0 && due <= 1 ? pushFor(behind) : null;
    return { ...base, early: 0, fireBy: planned, pushMin, state: 'hold', course: last, out, atPass, total, words: pushMin !== null
      ? `${lastName} is still going out (${outText}), and ${lower(busy)}. Hold ${lower(nextName)}, and push the rest of the night by about ${mins(pushMin)}.${late}`
      : behind > 0 ? `${lastName} is still going out (${outText}). Hold ${lower(nextName)} until most of it is out. ${busy}, so if it’s still going out at ${o.clock(planned!)}, push the rest of the night.`
      : `${lastName} is still going out (${outText}). Hold ${lower(nextName)} until most of it is out.${late}` };
  }
  if (due === null) return { ...base, state: mostly ? 'ready' : 'on_pace', course: last, out, atPass, total, words: mostly ? `Most of ${lower(lastName)} is out. ${nextName} can fire when the room is ready.` : `${lastName}: ${outText}.` };
  return { ...base, state: 'on_pace', course: last, out, atPass, total, words: early
    ? `${lastName}: ${outText}. ${busy}, so ${lower(nextName)} fires at ${o.clock(fireBy!)}, in ${mins(fireIn!)}.`
    : `${lastName}: ${outText}. ${nextName} fires at ${o.clock(planned!)}, in ${mins(due)}.` };
}

/** The night's prep: portions of each dish from the guests' choices (a guest who's cancelled isn't counted), and the
 *  allergies and diets in the room. */
export function eventPrep(guests: any[], menu: { id: string; name: string; courseNumber: number }[]): { guests: number; dishes: { id: string; name: string; course: number; portions: number }[]; unchosen: number; allergies: { name: string; count: number }[]; diets: { name: string; count: number }[] } {
  const live = guests.filter((g) => !['cancelled', 'left', 'removed'].includes(String(g?.status || '')));
  const byId = new Map(menu.map((m) => [m.id, m])); const count = new Map<string, number>(); let unchosen = 0;
  const courses = Array.from(new Set(menu.map((m) => m.courseNumber)));
  for (const g of live) for (const n of courses) {
    // As the manifest reads it: the course's choice, or (course 1) the one meal choice an older invitation asked for.
    const id = g?.courseSelections?.[n] || g?.courseSelections?.[String(n)] || (n === 1 ? g?.mealChoiceId : null);
    if (id && byId.has(id) && byId.get(id)!.courseNumber === n) count.set(id, (count.get(id) || 0) + 1); else unchosen++;
  }
  const tally = (key: 'allergies' | 'dietaryRestrictions') => { const m = new Map<string, number>(); for (const g of live) for (const a of (Array.isArray(g?.[key]) ? g[key] : [])) { const k = clip(a, 40).toLowerCase(); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return Array.from(m.entries()).map(([name, c]) => ({ name, count: c })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 12); };
  return {
    guests: live.length,
    dishes: menu.map((m) => ({ id: m.id, name: clip(m.name, 60), course: m.courseNumber, portions: count.get(m.id) || 0 })).sort((a, b) => a.course - b.course || b.portions - a.portions || a.name.localeCompare(b.name)),
    unchosen, allergies: tally('allergies'), diets: tally('dietaryRestrictions'),
  };
}
