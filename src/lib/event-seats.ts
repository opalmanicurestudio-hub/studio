// src/lib/event-seats.ts — CHOOSING SEATS when buying tickets (design canvas "Event night"; lib/event-tickets, the
// event's page, api/public/event). An event's seating chart (seatingTables, components/events/SeatingChartTab) is the
// map: when the business turns seat choice on (seatPicking.on), a guest buying tickets picks their seats on it, or buys
// every seat at a table at once (seatPicking.wholeTables). A seat is taken by a guest on the list (tableNumber and
// seatNumber, as the manifest keeps them) or held by a checkout still open. Nothing about who sits where leaves the
// server: the map says only taken, held or open. Pure.
import { chartTables } from '@/lib/event-guest-link';

/** The most seats one whole table can sell at once, and the most one person can hold at a time. */
export const MAX_TABLE_SEATS = 20;
export type SeatPicking = { on: boolean; wholeTables: boolean };
export function seatPickingOf(ev: any): SeatPicking {
  const raw = ev?.seatPicking || {};
  return { on: raw.on === true && chartTables(ev).some((t) => t.seats.length), wholeTables: raw.on === true && raw.wholeTables === true };
}
export type SeatRef = { tableId: string; seatId: string; table: string; seat: string };
/** A seat by its table's name and its label, the way the team types them ("Table 5" and "5" are the same table). */
export const seatKey = (table: unknown, seat: unknown) => `${String(table ?? '').trim().toLowerCase().replace(/^table\s+/, '')}#${String(seat ?? '').trim().toLowerCase().replace(/^seat\s+/, '')}`;
const idKey = (tableId: unknown, seatId: unknown) => `id:${String(tableId)}|${String(seatId)}`;
type InUse = { taken: Set<string>; held: Set<string> };

/** Seats taken by guests on the list (by the chart's ids where the guest has them, and by name), and seats held by
 *  checkouts still open (an order's own hold left out). */
export function seatsInUse(guests: any[], orders: any[], now = Date.now(), except?: string): InUse {
  const taken = new Set<string>(); const held = new Set<string>();
  for (const g of guests || []) {
    if (['cancelled', 'removed'].includes(String(g?.status || ''))) continue;
    if (g?.tableNumber && g?.seatNumber) taken.add(seatKey(g.tableNumber, g.seatNumber));
    if (g?.tableId && g?.seatId) taken.add(idKey(g.tableId, g.seatId));
  }
  for (const o of orders || []) if (o?.id !== except && o?.status === 'pending' && Date.parse(String(o.holdUntil || '')) > now) for (const s of Array.isArray(o.seats) ? o.seats : []) {
    held.add(seatKey(s.table, s.seat)); if (s.tableId && s.seatId) held.add(idKey(s.tableId, s.seatId));
  }
  return { taken, held };
}
const stateOf = (use: InUse, t: { id: string; name: string }, s: { id: string; label: string }): 'open' | 'taken' | 'held' =>
  use.taken.has(seatKey(t.name, s.label)) || use.taken.has(idKey(t.id, s.id)) ? 'taken' : use.held.has(seatKey(t.name, s.label)) || use.held.has(idKey(t.id, s.id)) ? 'held' : 'open';
/** Is any of these seats in use (taken or held)? */
export const anyInUse = (use: InUse, seats: { tableId?: string; seatId?: string; table: string; seat: string }[]) =>
  seats.some((x) => use.taken.has(seatKey(x.table, x.seat)) || use.held.has(seatKey(x.table, x.seat)) || (!!x.tableId && !!x.seatId && (use.taken.has(idKey(x.tableId, x.seatId)) || use.held.has(idKey(x.tableId, x.seatId)))));

export type MapTable = { id: string; name: string; x: number | null; y: number | null; seats: { id: string; label: string; state: 'open' | 'taken' | 'held' }[]; wholeOpen: boolean };
/** The map a guest sees: each table and its seats, open, taken or held, and whether every seat at it is open. */
export function seatMap(ev: any, use: InUse): MapTable[] {
  const raw = new Map<string, any>((Array.isArray(ev?.seatingTables) ? ev.seatingTables : []).map((t: any) => [String(t?.id), t]));
  return chartTables(ev).filter((t) => t.seats.length).map((t) => {
    const r = raw.get(t.id) || {}; const num = (v: any) => (Number.isFinite(Number(v)) && v !== null ? Math.max(0, Math.min(100, Number(v))) : null);
    const seats = t.seats.map((s) => ({ id: s.id, label: s.label, state: stateOf(use, t, s) }));
    return { id: t.id, name: t.name, x: num(r.x), y: num(r.y), seats, wholeOpen: seats.length <= MAX_TABLE_SEATS && seats.every((s) => s.state === 'open') };
  });
}

/** The seats a guest asked for, checked against the chart and what's in use: each seat once, all open, no more than the
 *  most tickets at once; or, for a whole table, every seat at it open. */
export function pickSeats(ev: any, use: InUse, o: { picks?: unknown; wholeTable?: unknown; max: number }): { ok: true; seats: SeatRef[]; whole: string | null } | { ok: false; error: string } {
  const tables = chartTables(ev); const sp = seatPickingOf(ev);
  if (!sp.on) return { ok: false, error: 'Seats aren’t chosen online for this event.' };
  const free = (t: { id: string; name: string }, s: { id: string; label: string }) => stateOf(use, t, s) === 'open';
  if (o.wholeTable !== undefined && o.wholeTable !== null && o.wholeTable !== '') {
    if (!sp.wholeTables) return { ok: false, error: 'Whole tables aren’t sold online for this event.' };
    const t = tables.find((x) => x.id === String(o.wholeTable));
    if (!t || !t.seats.length) return { ok: false, error: 'That table isn’t on the map any more.' };
    if (t.seats.length > MAX_TABLE_SEATS) return { ok: false, error: `A table of more than ${MAX_TABLE_SEATS} can’t be bought online.` };
    if (!t.seats.every((s) => free(t, s))) return { ok: false, error: `Someone has just taken a seat at ${t.name}. Pick another table, or choose seats.` };
    return { ok: true, seats: t.seats.map((s) => ({ tableId: t.id, seatId: s.id, table: t.name, seat: s.label })), whole: t.id };
  }
  const picks = Array.isArray(o.picks) ? o.picks : [];
  if (!picks.length) return { ok: false, error: 'Choose your seats on the map.' };
  if (picks.length > o.max) return { ok: false, error: `Choose up to ${o.max} seats at once.` };
  const out: SeatRef[] = []; const seen = new Set<string>();
  for (const p of picks) {
    const t = tables.find((x) => x.id === String((p as any)?.tableId)); const s = t?.seats.find((x) => x.id === String((p as any)?.seatId));
    if (!t || !s) return { ok: false, error: 'A seat you chose isn’t on the map any more. Choose again.' };
    const k = seatKey(t.name, s.label); if (seen.has(k)) return { ok: false, error: 'Each seat once, please.' }; seen.add(k);
    if (!free(t, s)) return { ok: false, error: `${t.name}, seat ${s.label} has just been taken. Choose another.` };
    out.push({ tableId: t.id, seatId: s.id, table: t.name, seat: s.label });
  }
  return { ok: true, seats: out, whole: null };
}

/** "Table 5, seats 6 and 7"; across tables, each table in turn. */
export function seatWords(seats: { table: string; seat: string }[]): string {
  const by = new Map<string, string[]>(); for (const s of seats || []) { const l = by.get(s.table) || []; l.push(s.seat); by.set(s.table, l); }
  const and = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  return Array.from(by.entries()).map(([t, l]) => `${/^\d+$/.test(t) ? `Table ${t}` : t}, ${l.length === 1 ? 'seat' : 'seats'} ${and(l)}`).join('; ');
}
