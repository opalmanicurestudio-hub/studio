// src/lib/briefing.ts — THE PRE-SHIFT BRIEFING (design canvas "Pre-shift briefing and staffing"; lib/briefing-server,
// api/briefing, the page at /briefing). It writes itself from what the business already has: the guests expected (the
// bookings, an event's guests, and walk-ins like a usual night, lib/prep-list), when in the evening they'll come, the
// bookings worth knowing (a big party, a birthday, a regular and their usual, an allergy), the prep still to do, what's
// sold out, who's working, and a note from the manager. Staffing is worked out hour by hour from the same guests
// against the schedule: how many servers, cooks, bartenders and a host the night needs, by the business's own numbers,
// and where it's short. Always an estimate, and said to be one. Pure.

export type StaffingSettings = { perServer: number; perCook: number; perBartender: number; hostAt: number };
export const DEFAULT_STAFFING: StaffingSettings = { perServer: 16, perCook: 30, perBartender: 40, hostAt: 20 };
const LIMITS: Record<keyof StaffingSettings, [number, number]> = { perServer: [4, 60], perCook: [5, 120], perBartender: [5, 150], hostAt: [5, 200] };
export function staffingOf(tenant: any): StaffingSettings {
  const raw = tenant?.kitchenSettings?.staffing || {}; const out = { ...DEFAULT_STAFFING };
  for (const k of Object.keys(LIMITS) as (keyof StaffingSettings)[]) { const n = Math.round(Number(raw[k])); if (raw[k] !== undefined && Number.isFinite(n) && n >= LIMITS[k][0] && n <= LIMITS[k][1]) out[k] = n; }
  return out;
}
export function cleanStaffing(raw: any): StaffingSettings | null {
  if (!raw || typeof raw !== 'object') return null; const out = { ...DEFAULT_STAFFING };
  for (const k of Object.keys(LIMITS) as (keyof StaffingSettings)[]) {
    if (raw[k] === undefined) continue; const n = Number(raw[k]);
    if (!Number.isInteger(n) || n < LIMITS[k][0] || n > LIMITS[k][1]) return null; out[k] = n;
  }
  return out;
}

/** What someone does on a shift, from their job title (Servers, cooks, bartenders and hosts are counted against the
 *  night's need; anyone else is listed). */
export type Job = 'server' | 'kitchen' | 'bar' | 'host' | 'support' | 'manager' | 'other';
export type CountedJob = 'server' | 'kitchen' | 'bar' | 'host';
export const COUNTED: CountedJob[] = ['server', 'kitchen', 'bar', 'host'];
export const JOB_WORD: Record<Job, string> = { server: 'server', kitchen: 'cook', bar: 'bartender', host: 'host', support: 'support', manager: 'manager', other: 'team' };
export const JOB_COLUMN: Record<'server' | 'kitchen' | 'bar' | 'host', string> = { server: 'Servers', kitchen: 'Kitchen', bar: 'Bar', host: 'Host' };
export function jobOf(staff: any): Job {
  const t = `${staff?.jobTitle || ''} ${staff?.title || ''} ${staff?.tipRole || ''}`.toLowerCase();
  if (/\b(server|waiter|waitress|wait ?staff)\b/.test(t)) return 'server';
  if (/\b(host|hostess|ma[iî]tre)/.test(t)) return 'host';
  if (/\bbar ?-?backs?\b/.test(t)) return 'support';
  if (/\b(bartender|barista|mixologist|bar)\b/.test(t)) return 'bar';
  if (/\b(cook|chef|kitchen|line|prep|sous|grill|pastry|baker)\b/.test(t)) return 'kitchen';
  if (/\b(busser|bus|runner|expo|food runner|dish(washer)?|porter|steward)\b/.test(t)) return 'support';
  if (['owner', 'admin', 'manager', 'supervisor'].includes(String(staff?.role || '').toLowerCase())) return 'manager';
  return 'other';
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const hourOf = (time: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(time || '')); return m ? Math.min(23, Number(m[1])) : null; };

export type BookingIn = { time: string; size: number };
export type EventIn = { startHour: number; endHour: number; guests: number };
/** Guests arriving each hour (24): those booked at that time, an event's guests at its start, and walk-ins spread the
 *  way a usual night's guests came; with no usual night's hours to go by, around the bookings (an hour either side);
 *  with neither, not placed by the hour at all (`placed` false), though they're still counted in the night's guests. */
export function arrivals(o: { bookings: BookingIn[]; events: EventIn[]; hours: number[] | null | undefined; walkIns: number | null }): { booked: number[]; walkIn: number[]; event: number[]; all: number[]; placed: boolean } {
  const booked = Array.from({ length: 24 }, () => 0); const walkIn = Array.from({ length: 24 }, () => 0); const event = Array.from({ length: 24 }, () => 0);
  for (const b of o.bookings) { const h = hourOf(b.time); if (h !== null) booked[h] += Math.max(1, Math.round(Number(b.size) || 1)); }
  for (const e of o.events) if (e.startHour >= 0 && e.startHour < 24) event[e.startHour] += Math.max(0, Math.round(e.guests));
  let shape = Array.isArray(o.hours) && o.hours.length === 24 ? o.hours.map((x) => Math.max(0, Number(x) || 0)) : null;
  if (!shape || sum(shape) <= 0) { shape = Array.from({ length: 24 }, () => 0); for (let h = 0; h < 24; h++) if (booked[h]) { shape[h] += booked[h] * 0.5; if (h > 0) shape[h - 1] += booked[h] * 0.25; if (h < 23) shape[h + 1] += booked[h] * 0.25; } }
  const total = sum(shape);
  if (total > 0 && o.walkIns) for (let h = 0; h < 24; h++) walkIn[h] = (shape[h] / total) * o.walkIns;
  return { booked, walkIn, event, all: Array.from({ length: 24 }, (_, h) => booked[h] + walkIn[h] + event[h]), placed: !o.walkIns || total > 0 };
}

/** Guests in the house each hour: those who arrived this hour, and those from earlier hours still at the table (a usual
 *  stay of `stayMin` minutes); an event's guests for every hour it runs, the hour they arrive included. */
export function inHouse(arr: number[], stayMin: number, events: EventIn[] = []): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (let h = 0; h < 24; h++) for (let k = 0; k <= 4; k++) { if (h - k < 0) break; const f = k === 0 ? 1 : Math.max(0, Math.min(1, (stayMin - 60 * k) / 60)); out[h] += arr[h - k] * f; }
  for (const e of events) for (let h = Math.max(0, e.startHour); h < Math.min(24, Math.max(e.endHour, e.startHour + 1)); h++) out[h] += e.guests;
  return out;
}

export type ShiftIn = { staffId: string; name: string; job: Job; start: number; end: number };
export type HourRow = { hour: number; guests: number; need: Record<'server' | 'kitchen' | 'bar' | 'host', number>; have: Record<'server' | 'kitchen' | 'bar' | 'host', number>; others: number };
/** Each hour of the night: the guests in the house, and for each job what the night needs (by the business's numbers)
 *  against who's on (half an hour or more of that hour). A bar or a host is only counted where someone does that job. */
export function staffingRows(o: { arrive: number[]; house: number[]; kitchenLoad: number[]; shifts: ShiftIn[]; s: StaffingSettings; dayStart: number; hasJob: Set<Job> }): HourRow[] {
  const rows: HourRow[] = [];
  for (let h = 0; h < 24; h++) {
    const from = o.dayStart + h * 3600000; const to = from + 3600000;
    const on = o.shifts.filter((x) => Math.min(x.end, to) - Math.max(x.start, from) >= 30 * 60000);
    const guests = Math.round(o.house[h]);
    if (guests < 1 && !on.length) continue;
    const have = { server: 0, kitchen: 0, bar: 0, host: 0 }; let others = 0;
    for (const x of on) { if (x.job === 'server' || x.job === 'kitchen' || x.job === 'bar' || x.job === 'host') have[x.job]++; else others++; }
    const need = {
      server: guests > 0 ? Math.max(1, Math.ceil(o.house[h] / o.s.perServer - 1e-9)) : 0,
      kitchen: o.kitchenLoad[h] >= 0.5 ? Math.max(1, Math.ceil(o.kitchenLoad[h] / o.s.perCook - 1e-9)) : 0,
      bar: o.hasJob.has('bar') && guests > 0 ? Math.max(1, Math.ceil(o.house[h] / o.s.perBartender - 1e-9)) : 0,
      host: o.hasJob.has('host') && o.arrive[h] >= o.s.hostAt ? 1 : 0,
    };
    rows.push({ hour: h, guests, need, have, others });
  }
  return rows;
}

/** "7 pm", "noon", "midnight" (the end of the day, 24, too). */
export const hourWords = (n: number) => { const h = ((n % 24) + 24) % 24; return h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} am` : `${h - 12} pm`; };
const count = (n: number, job: string) => (n === 1 ? `a ${job}` : `${n === 2 ? 'two' : n === 3 ? 'three' : n} ${job}s`);

/** Where the night is short, and where it has more servers or bartenders than its guests need (kitchen time before the
 *  doors open is prep, never one to spare), said plainly: "a server 7 pm to 9 pm (two at 8 pm)". */
export function staffingGaps(rows: HourRow[]): { short: string[]; over: string[]; shortHours: number } {
  const short: string[] = []; const over: string[] = []; const shortHours = new Set<number>();
  const runs = (d: (r: HourRow) => number) => {
    const out: { from: number; to: number; least: number; most: number; mostAt: number }[] = [];
    for (const r of rows) { const x = d(r); const last = out[out.length - 1];
      if (x > 0 && last && last.to === r.hour) { last.to = r.hour + 1; last.least = Math.min(last.least, x); if (x > last.most) { last.most = x; last.mostAt = r.hour; } }
      else if (x > 0) out.push({ from: r.hour, to: r.hour + 1, least: x, most: x, mostAt: r.hour }); }
    return out;
  };
  const say = (g: { from: number; to: number; least: number; most: number; mostAt: number }, word: string) =>
    `${count(g.least, word)} ${hourWords(g.from)} to ${hourWords(g.to)}${g.most > g.least ? ` (${g.most === 2 ? 'two' : g.most === 3 ? 'three' : g.most} at ${hourWords(g.mostAt)})` : ''}`;
  for (const job of COUNTED) {
    for (const g of runs((r) => r.need[job] - r.have[job])) { for (let h = g.from; h < g.to; h++) shortHours.add(h); short.push(say(g, JOB_WORD[job])); }
    if (job === 'server' || job === 'bar') for (const g of runs((r) => (r.guests > 0 && r.need[job] > 0 ? r.have[job] - r.need[job] : 0))) over.push(say(g, JOB_WORD[job]));
  }
  return { short, over, shortHours: shortHours.size };
}

/** A booking worth knowing before the doors open: a big party, something they told us (a birthday, a stroller), a
 *  regular and their usual, an allergy, the team's note; and the name on file when it isn't quite the booking's (the
 *  same number, another first name), so the team checks it's them. */
export type ToKnow = { time: string; name: string; size: number; tags: { text: string; warn: boolean }[]; detail: string | null };
export function bookingsToKnow(list: { time: string; name: string; size: number; asks?: string[]; note?: string | null; visits?: number; usual?: string[]; allergy?: string | null; teamNote?: string | null; onFile?: string | null }[], bigAt = 6): ToKnow[] {
  const out: ToKnow[] = [];
  for (const b of list) {
    const tags: { text: string; warn: boolean }[] = [];
    if (b.allergy) tags.push({ text: b.allergy, warn: true });
    for (const a of (b.asks || []).slice(0, 3)) tags.push({ text: a, warn: /birthday|anniversary|celebrat|proposal|engage/i.test(a) });
    if ((b.visits || 0) >= 3) tags.push({ text: `Regular, ${b.visits} visits`, warn: false });
    if (b.size >= bigAt) tags.push({ text: `Party of ${b.size}`, warn: false });
    const bits = [b.onFile ? `On file as ${String(b.onFile).slice(0, 60)}.` : '', (b.usual || []).length ? `Usually ${b.usual!.slice(0, 2).join(' and ').toLowerCase()}.` : '', b.teamNote ? String(b.teamNote).slice(0, 140) : '', b.note ? `They said: ${String(b.note).slice(0, 140)}` : ''].filter(Boolean);
    if (!tags.length && !bits.length) continue;
    out.push({ time: b.time, name: b.name, size: b.size, tags, detail: bits.join(' ') || null });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}
