// src/lib/dish.ts — THE DISH PIT, the rules (design canvas "Dish and barback"; lib/dish-server, api/back, the screen at
// /dish). Pure.
// - Heading your way: the plates and glasses that went out, every 15 minutes over the last hour, from the kitchen's own
//   tickets (a dish marked ready or handed over is a plate on a table; a drink from the bar is a glass). Food for the
//   drive-thru or picked up later doesn't come back, so it isn't counted.
// - The rush: tonight's busiest hours, from the guests expected in the house each hour (lib/briefing).
// - The machine check: a high-temperature machine's final rinse (180°F or hotter, the usual US rule) or a chemical
//   machine's sanitizer strength (50 to 100 ppm of chlorine, the usual), logged at the start and then every few hours as
//   the business sets. A reading outside the business's limits asks what was done about it and tells the managers.
// - Breakage: what was broken, logged with who and when, so the business sees it and can reorder.

export type Machine = 'hot' | 'chemical';
export type DishSettings = { on: boolean; machine: Machine; minF: number; ppmMin: number; ppmMax: number; everyHours: number };
export const DEFAULT_DISH: DishSettings = { on: true, machine: 'hot', minF: 180, ppmMin: 50, ppmMax: 100, everyHours: 4 };
export const EVERY_CHOICES = [0, 2, 3, 4, 6];

const num = (v: unknown) => { if (v === null || v === undefined || v === '') return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

/** The business's machine settings: its own, each part checked, else the usual. */
export function dishSettingsOf(tenant: any): DishSettings {
  const d = tenant?.dishSettings || {};
  const minF = num(d.minF), lo = num(d.ppmMin), hi = num(d.ppmMax), every = num(d.everyHours);
  const out: DishSettings = {
    on: d.on !== false,
    machine: d.machine === 'chemical' ? 'chemical' : 'hot',
    minF: inRange(minF, 120, 200) ? Math.round(minF) : DEFAULT_DISH.minF,
    ppmMin: inRange(lo, 1, 1000) ? Math.round(lo) : DEFAULT_DISH.ppmMin,
    ppmMax: inRange(hi, 1, 1000) ? Math.round(hi) : DEFAULT_DISH.ppmMax,
    everyHours: EVERY_CHOICES.includes(every) ? every : DEFAULT_DISH.everyHours,
  };
  if (out.ppmMax < out.ppmMin) { out.ppmMin = DEFAULT_DISH.ppmMin; out.ppmMax = DEFAULT_DISH.ppmMax; }
  return out;
}

/** Settings as a manager sent them: refused (null) when a number makes no sense. */
export function cleanDishSettings(raw: any): DishSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const minF = num(raw.minF), lo = num(raw.ppmMin), hi = num(raw.ppmMax), every = num(raw.everyHours);
  if (!inRange(minF, 120, 200) || !inRange(lo, 1, 1000) || !inRange(hi, 1, 1000) || hi < lo || !EVERY_CHOICES.includes(every)) return null;
  return { on: raw.on !== false, machine: raw.machine === 'chemical' ? 'chemical' : 'hot', minF: Math.round(minF), ppmMin: Math.round(lo), ppmMax: Math.round(hi), everyHours: every };
}

/** What the check measures, in words: "Final rinse, °F" or "Sanitizer, ppm". */
export const readingWord = (s: DishSettings) => (s.machine === 'hot' ? 'Final rinse' : 'Sanitizer');
export const readingUnit = (s: DishSettings) => (s.machine === 'hot' ? '°F' : 'ppm');
/** The limit in words: "180°F or hotter", "50 to 100 ppm". */
export const limitWords = (s: DishSettings) => (s.machine === 'hot' ? `${s.minF}°F or hotter` : `${s.ppmMin} to ${s.ppmMax} ppm`);

/** A reading as typed: a number a thermometer or a test strip could give, or null. */
export function cleanReading(s: DishSettings, v: unknown): number | null {
  const n = num(v); if (!Number.isFinite(n)) return null;
  if (s.machine === 'hot') return inRange(n, 32, 230) ? Math.round(n * 10) / 10 : null;
  return inRange(n, 0, 2000) ? Math.round(n) : null;
}
/** Is the reading inside the business's limits? */
export const readingOk = (s: DishSettings, value: number) => (s.machine === 'hot' ? value >= s.minF : value >= s.ppmMin && value <= s.ppmMax);

export type MachineCheck = { id: string; at: string; value: number; unit: string; ok: boolean; note: string | null; by: string };

/** Whether a check is due now, and when the next one is. Off: never. None yet today: now. Once a day: done after the
 *  first. Otherwise every few hours after the last one. */
export function checkDue(s: DishSettings, today: MachineCheck[], now = Date.now()): { due: boolean; nextAt: string | null; last: MachineCheck | null } {
  if (!s.on) return { due: false, nextAt: null, last: null };
  const last = [...today].sort((a, b) => a.at.localeCompare(b.at)).pop() || null;
  if (!last) return { due: true, nextAt: null, last: null };
  // A reading outside the limits is checked again once it's put right, whatever the timing.
  if (!last.ok) return { due: true, nextAt: null, last };
  if (s.everyHours === 0) return { due: false, nextAt: null, last };
  const next = (Date.parse(last.at) || now) + s.everyHours * 3600000;
  return { due: now >= next, nextAt: new Date(next).toISOString(), last };
}

// ── Heading your way ──
export type FlowTicket = { status: string; madeAt: string | null; readyAt: string | null; deliveredAt: string | null; quantity: number; channel: string | null; source?: string };
export type FlowBucket = { start: string; plates: number; glasses: number };
const GONE = new Set(['cancelled', 'canceled', 'voided', 'refunded']);
const AWAY = new Set(['drive-thru', 'ahead']);
const key = (s: unknown) => String(s || '').trim().toLowerCase();

/** The plates and glasses that went out, in 15-minute blocks over the last hour (oldest first), and in the last half
 *  hour. `bar`: the business's bar station (lib/table-service), whose drinks are glasses. */
export function plateFlow(tickets: FlowTicket[], bar: string | null, now = Date.now(), blocks = 4, blockMin = 15): { blocks: FlowBucket[]; lastHalf: { plates: number; glasses: number } } {
  const size = blockMin * 60000; const end = Math.floor(now / size) * size + size; const start = end - blocks * size;
  const out: FlowBucket[] = Array.from({ length: blocks }, (_, i) => ({ start: new Date(start + i * size).toISOString(), plates: 0, glasses: 0 }));
  const half = { plates: 0, glasses: 0 };
  for (const t of tickets || []) {
    if (!t || GONE.has(key(t.status)) || (t.channel && AWAY.has(t.channel))) continue;
    const at = Date.parse(String(t.readyAt || t.deliveredAt || '')); if (!Number.isFinite(at) || at > now || at < start) continue;
    const q = Math.max(1, Math.round(Number(t.quantity) || 1));
    const glass = !!bar && key(t.madeAt) === key(bar);
    const b = out[Math.min(blocks - 1, Math.floor((at - start) / size))];
    if (glass) b.glasses += q; else b.plates += q;
    if (now - at <= 30 * 60000) { if (glass) half.glasses += q; else half.plates += q; }
  }
  return { blocks: out, lastHalf: half };
}

/** Tonight's rush in words ("7 to 9 pm"): the hours with at least three quarters of the busiest hour's guests, around
 *  the busiest. Nothing when no guests are expected. */
export function rushWords(byHour: { hour: number; guests: number }[]): string | null {
  const rows = (byHour || []).filter((r) => Number.isFinite(r.hour) && r.guests > 0).sort((a, b) => a.hour - b.hour);
  if (!rows.length) return null;
  const peak = rows.reduce((a, b) => (b.guests > a.guests ? b : a));
  const bar = peak.guests * 0.75; let from = peak.hour, to = peak.hour;
  const at = (h: number) => rows.find((r) => r.hour === h);
  while (at(from - 1) && at(from - 1)!.guests >= bar) from--;
  while (at(to + 1) && at(to + 1)!.guests >= bar) to++;
  const clock = (h: number) => { const x = ((h % 24) + 24) % 24; return x === 0 ? 'midnight' : x === 12 ? 'noon' : `${x % 12} ${x < 12 ? 'am' : 'pm'}`; };
  const end = to + 1; const a = clock(from), b = clock(end);
  // "7 to 9 pm" when both are in the same half of the day; "11 am to 1 pm" (or "10 pm to midnight") when not.
  const same = /\d (am|pm)$/.test(a) && /\d (am|pm)$/.test(b) && a.slice(-2) === b.slice(-2);
  return same ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
}

// ── Breakage ──
export const BREAK_KINDS: { id: string; label: string }[] = [
  { id: 'plate', label: 'Plate' }, { id: 'bowl', label: 'Bowl' }, { id: 'glass', label: 'Glass' }, { id: 'wine', label: 'Wine glass' },
  { id: 'mug', label: 'Mug or cup' }, { id: 'other', label: 'Something else' },
];
export const MAX_BROKEN = 50;
export function cleanBreak(raw: any): { kind: string; count: number; note: string | null } | { error: string } {
  const kind = BREAK_KINDS.find((k) => k.id === raw?.kind); if (!kind) return { error: 'What broke?' };
  const count = Number(raw?.count); if (!Number.isInteger(count) || count < 1 || count > MAX_BROKEN) return { error: `How many, 1 to ${MAX_BROKEN}?` };
  const note = String(raw?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  if (kind.id === 'other' && !note) return { error: 'Say what it was.' };
  return { kind: kind.id, count, note };
}
/** Today's breakage in words: "3 glasses and a plate". */
export function brokenWords(list: { kind: string; count: number; note?: string | null }[]): string {
  const by = new Map<string, number>();
  for (const b of list || []) { const k = b.kind === 'other' ? String(b.note || 'other') : b.kind; by.set(k, (by.get(k) || 0) + Math.max(0, Number(b.count) || 0)); }
  const name = (k: string, n: number) => { const label = BREAK_KINDS.find((x) => x.id === k)?.label.toLowerCase() || k; const one = label === 'mug or cup' ? 'mug or cup' : label;
    return n === 1 ? `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}` : `${n} ${one === 'glass' ? 'glasses' : one === 'wine glass' ? 'wine glasses' : one === 'mug or cup' ? 'mugs or cups' : `${one}s`}`; };
  const parts = Array.from(by.entries()).filter(([, n]) => n > 0).map(([k, n]) => name(k, n));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
