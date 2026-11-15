// src/lib/prep-list.ts — TOMORROW'S PREP LIST (design canvas PrepList), worked out from the bookings and a usual night.
// Always an estimate, and said to be one. Pure: the server (lib/prep-list-server) reads the nights.
// - A usual night: the same day of the week, the last six weeks (fewer than two of those with anything sold: the last
//   week's nights instead).
// - Guests: a usual night's guests, plus however many more are booked than usual (never fewer than are booked). With no
//   guests counted on the floor (a counter café, say), a usual night as it was.
// - Each dish: what a usual night sold of it, scaled to the guests expected, rounded up; and the range a usual night
//   sold. A dish new to the menu (in the last three weeks) and not sold yet is listed as new.
// - What it takes: each dish's recipe (lib/menu-stock) times how many, against what's in stock now.
import { ingredientLeft, ingredientUnit, recipeOf } from '@/lib/menu-stock';

export type Night = { day: string; guests: number | null; booked: number; used: Record<string, number>; truncated?: boolean;
  /** Guests seated in each hour of the day, by the business's clock (lib/briefing reads the usual night's shape). */
  byHour?: number[] };
export type PrepItem = { id: string; name: string; station: string; x: any };
export type PrepRow = { id: string; name: string; station: string; make: number | null; low: number; high: number; isNew: boolean };
export type PrepNeed = { id: string; name: string; unit: string; need: number; have: number | null };
export type PrepPlan = {
  day: string; basis: 'weekday' | 'recent' | 'none'; booked: number; bookings: number;
  /** The same day of the week, the last six weeks, with anything sold (0 with sales on other days: likely closed). */
  sameDay: number;
  /** A night had more tickets than are read: its counts are low. */
  truncated: boolean;
  usualGuests: number | null; walkIns: number | null; guests: number | null;
  nights: { day: string; guests: number | null }[]; rows: PrepRow[]; needs: PrepNeed[];
  /** A usual night's guests seated in each hour (24, the business's clock), from the same nights; null: not known. */
  hours?: number[] | null;
};

export const PREP_WEEKS = 6;
export const NEW_DAYS = 21;
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const sold = (n: Night) => Object.values(n.used || {}).some((q) => Number(q) > 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The nights a usual one is worked out from, and how they were picked. */
export function usualNights(day: string, nights: Night[]): { basis: PrepPlan['basis']; picked: Night[] } {
  const before = nights.filter((n) => n.day < day).sort((a, b) => b.day.localeCompare(a.day));
  const same = before.filter((n) => weekday(n.day) === weekday(day) && sold(n)).slice(0, PREP_WEEKS);
  if (same.length >= 2) return { basis: 'weekday', picked: same };
  const recent = before.filter(sold).slice(0, 7);
  if (recent.length) return { basis: 'recent', picked: recent };
  return { basis: 'none', picked: [] };
}

export function planPrep(o: { day: string; nights: Night[]; items: PrepItem[]; booked: number; bookings: number; stations: string[]; parts: Map<string, any>; now?: number }): PrepPlan {
  const { day, items, booked, bookings } = o; const now = o.now ?? Date.now();
  const { basis, picked } = usualNights(day, o.nights);
  const counted = picked.filter((n) => n.guests !== null && n.guests > 0);
  const usualGuests = counted.length ? Math.round(avg(counted.map((n) => Number(n.guests)))) : null;
  const usualBooked = counted.length ? avg(counted.map((n) => n.booked)) : 0;
  // More booked than usual adds guests only once a usual night had bookings to compare with (a business new to online
  // bookings: those guests were already walking in).
  const withBookings = counted.filter((n) => n.booked > 0).length >= 2;
  const guests = usualGuests === null ? null : Math.max(booked, Math.round(usualGuests + (withBookings ? Math.max(0, booked - usualBooked) : 0)));
  // Sales and guests from the same nights.
  const basisNights = usualGuests !== null ? counted : picked;
  const walkIns = guests === null ? null : Math.max(0, guests - booked);
  const scale = usualGuests && guests ? guests / usualGuests : 1;
  const rows: PrepRow[] = [];
  for (const it of items) {
    const qs = basisNights.map((n) => Math.max(0, Number(n.used?.[it.id]) || 0));
    const any = qs.some((q) => q > 0);
    if (!any) {
      const made = Date.parse(String(it.x?.createdAt || ''));
      const everSold = o.nights.some((n) => Number(n.used?.[it.id]) > 0);
      if (!everSold && Number.isFinite(made) && now - made < NEW_DAYS * 864e5) rows.push({ id: it.id, name: it.name, station: it.station, make: null, low: 0, high: 0, isNew: true });
      continue;
    }
    rows.push({ id: it.id, name: it.name, station: it.station, make: Math.ceil(avg(qs) * scale - 1e-9), low: Math.min(...qs), high: Math.max(...qs), isNew: false });
  }
  const order = (s: string) => { const i = o.stations.indexOf(s); return i < 0 ? 99 : i; };
  rows.sort((a, b) => order(a.station) - order(b.station) || Number(a.isNew) - Number(b.isNew) || (b.make || 0) - (a.make || 0) || a.name.localeCompare(b.name));
  // What it takes, from each dish's recipe.
  const need = new Map<string, PrepNeed>();
  for (const r of rows) {
    if (!r.make) continue;
    const it = items.find((x) => x.id === r.id); if (!it) continue;
    for (const l of recipeOf(it.x, it.id)) {
      const part = o.parts.get(l.id);
      const cur = need.get(l.id) || { id: l.id, name: String(part?.name || l.name).replace(/\s+/g, ' ').trim().slice(0, 60), unit: part ? ingredientUnit(part) : l.unit, need: 0, have: part ? ingredientLeft(part) : null };
      cur.need = r3(cur.need + r.make * l.quantityUsed); need.set(l.id, cur);
    }
  }
  const needs = Array.from(need.values()).sort((a, b) => Number(b.have !== null && b.have < b.need) - Number(a.have !== null && a.have < a.need) || a.name.localeCompare(b.name));
  const sameDay = o.nights.filter((n) => n.day < day && weekday(n.day) === weekday(day) && sold(n)).length;
  // A usual night's shape through the evening: guests seated each hour, from the nights that counted them.
  const shaped = counted.filter((n) => Array.isArray(n.byHour) && n.byHour.some((x) => Number(x) > 0));
  const hours = shaped.length ? Array.from({ length: 24 }, (_, h) => r3(avg(shaped.map((n) => Math.max(0, Number(n.byHour![h]) || 0))))) : null;
  return { day, basis, booked, bookings, sameDay, truncated: picked.some((n) => !!n.truncated), usualGuests, walkIns, guests, nights: picked.map((n) => ({ day: n.day, guests: n.guests })).reverse(), rows, needs, hours };
}

/** "Sat" for a day. */
export const weekdayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
/** How a need reads: "24", "1.5 kg". */
export function needWords(n: number, unit: string): string {
  const v = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return !unit || unit === 'each' ? v : `${v} ${unit}`;
}
