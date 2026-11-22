// src/lib/scoreboard.ts — THE DRIVE-THRU SCOREBOARD (pure; design board "The hour at a glance, on the live view",
// layout A: a strip above the lane; lib/scoreboard-server; Drive-thru live). The hour at a glance, as drive-thru timer
// screens show it:
// - Cars this hour (handed over), with last hour, the best hour in the last 30 days, the pace (where this hour is
//   heading) and the business's goal for an hour.
// - Menu, pay, service and lane total: this hour's average for each, against its own goal. Menu runs from pulling up to
//   the speaker until the order is sent, pay from then until it's paid, service from then until it's handed over; lane
//   total the whole wait.
// - Drive-offs today: cars that left the lane without being served.
// - The ranking: this location against the business's others today, by lane total (with more than one).
// Goals: tenants/{t}.driveThru.goals = { menu, pay, service } in seconds, and perHour (cars, or none); lane total is the
// drive-thru target the kitchen already uses (lib/counter-orders targetsOf).

export type Goals = { menu: number; pay: number; service: number; total: number; perHour: number | null };
export const GOAL_CHOICES: Record<'menu' | 'pay' | 'service', number[]> = { menu: [20, 30, 45, 60, 90], pay: [30, 45, 60, 90, 120], service: [20, 30, 45, 60, 90, 120] };
export const PER_HOUR_CHOICES = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
const DEFAULTS = { menu: 30, pay: 60, service: 30 };

/** The business's goals (each part's own, until it sets them; the lane total is its drive-thru target). */
export function goalsOf(tenant: any, total: number): Goals {
  const g = tenant?.driveThru?.goals || {};
  const pick = (k: 'menu' | 'pay' | 'service') => (GOAL_CHOICES[k].includes(Number(g[k])) ? Number(g[k]) : DEFAULTS[k]);
  const ph = Math.round(Number(g.perHour));
  return { menu: pick('menu'), pay: pick('pay'), service: pick('service'), total, perHour: Number.isFinite(ph) && ph >= 1 && ph <= 500 ? ph : null };
}
/** A change to the goals, from a manager: only the choices offered (perHour: a number of cars, or null for none). */
export function cleanGoals(b: any): { menu?: number; pay?: number; service?: number; perHour?: number | null } | { error: string } {
  const out: any = {};
  for (const k of ['menu', 'pay', 'service'] as const) if (b?.[k] !== undefined) { const n = Number(b[k]); if (!GOAL_CHOICES[k].includes(n)) return { error: 'Pick one of the times offered.' }; out[k] = n; }
  if (b?.perHour !== undefined) { if (b.perHour === null || b.perHour === '' || b.perHour === 0) out.perHour = null; else { const n = Math.round(Number(b.perHour)); if (!Number.isFinite(n) || n < 1 || n > 500) return { error: 'Cars an hour: a number from 1 to 500, or none.' }; out.perHour = n; } }
  return out;
}

/** A car left open this long before it was handed over was forgotten, not served slowly: never in the averages or the
 *  ranking (it's still a car served this hour). */
export const FORGOTTEN_SEC = 3600;
/** A car handed over, as the scoreboard counts it: its whole wait, and its menu, pay and service times (those it had:
 *  one taken in line, or come for an order placed ahead, has no menu or pay time). Null for one that left, or one left
 *  open for an hour (FORGOTTEN_SEC). */
export function boardCar(c: any): { total: number; menu: number | null; pay: number | null; service: number | null } | null {
  if (!c || c.left === true || c.voided === true) return null;
  const t = (v: unknown) => { const x = Date.parse(String(v || '')); return Number.isFinite(x) ? x : null; };
  const start = t(c.stageAt?.speaker) ?? t(c.arrivedAt), sent = t(c.stageAt?.pay), paid = t(c.stageAt?.pickup), gone = t(c.goneAt);
  // (Pay: from reaching the pay window, when its sensor saw it, else from the order sent.)
  const atPay = t(c.stageAt?.payWindow); const payFrom = atPay !== null && sent !== null && atPay >= sent ? atPay : sent;
  if (start === null || gone === null || gone < start) return null;
  const span = (a: number | null, z: number | null) => (a !== null && z !== null && z >= a ? Math.round((z - a) / 1000) : null);
  const viaSpeaker = c.inLine !== true && c.wasInLine !== true;
  const total = Math.round((gone - (t(c.arrivedAt) ?? start)) / 1000); if (total > FORGOTTEN_SEC) return null;
  return { total, menu: viaSpeaker ? span(start, sent) : null, pay: viaSpeaker ? span(payFrom, paid) : null, service: span(paid, gone) };
}

export type Board = {
  hour: { n: number; prev: number; best: number | null; pace: number | null };
  avg: { total: number | null; menu: number | null; pay: number | null; service: number | null };
  driveOffs: number; rank: { place: number; of: number } | null; goals: Goals; daypart: string | null;
};

/** The scoreboard from today's cars (those handed over or gone today, any location: `here` picks this one's), the
 *  hour now began at `hourStart`, `nowMs`. `best`: the best hour lately. */
export function boardOf(o: { gone: any[]; here: string | null; hourStart: number; nowMs: number; best: number | null; goals: Goals; daypart: string | null; several: boolean }): Board {
  const at = (c: any) => !o.here || !c.locationId || String(c.locationId) === o.here;
  const goneMs = (c: any) => Date.parse(String(c.goneAt || ''));
  const mine = o.gone.filter(at);
  const served = mine.filter((c) => !c.left && !c.voided);
  const inHour = served.filter((c) => goneMs(c) >= o.hourStart && goneMs(c) <= o.nowMs);
  const prev = served.filter((c) => goneMs(c) >= o.hourStart - 3600000 && goneMs(c) < o.hourStart).length;
  const mins = (o.nowMs - o.hourStart) / 60000;
  // (Pace: where the hour is heading, once a quarter of it is in, or ten minutes with a few cars served.)
  const pace = mins >= 15 || (mins >= 10 && inHour.length >= 3) ? Math.round((inHour.length * 60) / Math.min(60, mins)) : null;
  const cars = inHour.map(boardCar).filter((x): x is NonNullable<ReturnType<typeof boardCar>> => !!x);
  const avg = (k: 'total' | 'menu' | 'pay' | 'service') => { const v = cars.map((x) => x[k]).filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
  // The ranking: by today's lane total, among locations with a few cars served (lower is better).
  let rank: Board['rank'] = null;
  if (o.several && o.here) {
    const by = new Map<string, number[]>();
    for (const c of o.gone) { if (c.left || c.voided || !c.locationId) continue; const x = boardCar(c); if (!x) continue; by.set(String(c.locationId), [...(by.get(String(c.locationId)) || []), x.total]); }
    const avgs = Array.from(by.entries()).filter(([, v]) => v.length >= 3).map(([k, v]) => [k, v.reduce((s, x) => s + x, 0) / v.length] as [string, number]).sort((a, b) => a[1] - b[1]);
    const i = avgs.findIndex(([k]) => k === o.here);
    if (i >= 0 && avgs.length > 1) rank = { place: i + 1, of: avgs.length };
  }
  return {
    hour: { n: inHour.length, prev, best: o.best === null ? null : Math.max(o.best, inHour.length, prev), pace },
    avg: { total: avg('total'), menu: avg('menu'), pay: avg('pay'), service: avg('service') },
    driveOffs: mine.filter((c) => c.left === true || c.voided === true).length, rank, goals: o.goals, daypart: o.daypart,
  };
}

/** "1st", "2nd", "3rd", "4th". */
export const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
