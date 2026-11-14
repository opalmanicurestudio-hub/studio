// src/lib/seat-next.ts — WHO TO SEAT NEXT, and where. Pure: the host stand works it out from the floor (each table's
// stage and likely free time, lib/table-stage) and the waiting list, and shows it with its reasons.
// - The floor as the host sees it: every table, how soon it's ready to seat (now, being cleared, or where its meal is),
//   and whether it's held (for a booking arriving soon, or for a waiting party who's been texted).
// - Who goes where: a party told about 20 minutes who's waited 25 comes first, then whoever was told their table is
//   ready, then the business's own rule: whoever has waited longest, or the party that fits the table best. When two
//   tables fit, the one in the section with the fewest guests (the business can turn that off).
// - A table that's nearly ready (being cleared, paying) can be held now and the party texted, so they're walking back
//   as it's reset. The reasons are the facts the choice came from, in a few words each.

import { heldUnits, type HostedParty } from '@/lib/hosting-sessions';
import { clearingStage, turnFor, type FloorSettings, type Stage } from '@/lib/table-stage';

export type SeatTable = {
  id: string; name: string; capacity: number; tags: string[]; staffIds: string[];
  /** Minutes until it's likely ready to seat: 0 is free now. Null when nobody knows. */
  freeIn: number | null;
  /** Someone's at it right now (seated, or just left and it's being cleared). */
  occupied: boolean; clearing: boolean;
  /** Where its meal is, when someone's at it ("Paid, leaving soon"). */
  words?: string | null;
  /** Held for this party (a booking arriving soon, or a waiting party who's been texted). */
  heldFor: string | null;
};
export type SeatParty = {
  id: string; name: string; size: number; needs: string[]; status: string; joinedAt: string | null;
  quotedMinutes: number | null; notifiedAt: string | null;
  /** Asked for more time from their phone: not ready before then. */
  laterUntil?: string | null;
  /** A mirrored row from the walk-in queue, which texts its own guests. */
  mirrored?: boolean;
};
export type Suggestion = {
  tableId: string; tableName: string; partyId: string; partyName: string; size: number;
  freeIn: number; waited: number | null; reasons: string[]; alts: string[];
  /** 'seat': the table's free. 'hold': hold the table now and text them it's almost ready. 'soon': nearly ready (the
   *  walk-in queue texts its own guests). */
  action: 'seat' | 'hold' | 'soon';
};
export type Later = { partyId: string; partyName: string; size: number; tables: string[]; freeIn: number | null };
export type StaffLoad = Record<string, { name: string; guests: number }>;

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const minsSince = (v: unknown, now: number) => { const t = ms(v); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : null; };

/** A waiting party's hold on a table, from when they were texted it's nearly ready. */
export type WaitHold = { partyId: string; unitId: string; releasesAt: string };
export function waitHolds(parties: any[], now: number): Record<string, WaitHold> {
  const out: Record<string, WaitHold> = {};
  for (const p of Array.isArray(parties) ? parties : []) {
    if (!p || !['waiting', 'notified'].includes(String(p.status)) || !p.holdUnitId) continue;
    const until = ms(p.holdUntil); if (!Number.isFinite(until) || until <= now) continue;
    const prev = out[p.holdUnitId];
    if (!prev || Date.parse(prev.releasesAt) > until) out[p.holdUnitId] = { partyId: p.id, unitId: String(p.holdUnitId), releasesAt: new Date(until).toISOString() };
  }
  return out;
}

/** Every table on tonight's floor, as the host stand and the guest's link both see it: who's at it, how soon it's ready,
 *  and who it's held for. `stages` are the seated tables' stages by table (lib/floor-server). */
export function floorTables(units: any[], parties: HostedParty[] | any[], stages: Record<string, Stage | undefined>, s: FloorSettings, now: number,
  holdOpts: { holdBeforeMinutes?: number; holdGraceMinutes?: number } = {}): SeatTable[] {
  const list = (Array.isArray(parties) ? parties : []).filter(Boolean) as any[];
  const booked = heldUnits(list as HostedParty[], new Date(now), holdOpts);
  const waitHeld = waitHolds(list, now);
  return (Array.isArray(units) ? units : []).filter((u) => u && u.id).map((u: any) => {
    const id = String(u.id);
    const at = list.find((p) => p.status === 'seated' && (p.unitIds || []).includes(id));
    let freeIn: number | null = 0; let clearing = false; let occupied = false; let words: string | null = null;
    if (at) {
      occupied = true;
      const st = stages[id];
      if (st) words = st.words;
      if (st && st.freeIn !== null) freeIn = st.freeIn;
      else { const sat = ms(at.seatedAt); freeIn = Number.isFinite(sat) ? Math.max(0, Math.ceil((sat + turnFor(at.size, s) * 60000 - now) / 60000)) + s.clearMin : null; }
    } else {
      // Just left: being cleared (the latest party to leave it, unless someone said it's ready).
      const left = list.filter((p) => p.status === 'finished' && !p.clearedAt && (p.unitIds || []).includes(id)).sort((a, b) => ms(b.finishedAt) - ms(a.finishedAt))[0];
      const c = left ? clearingStage(left.finishedAt, s, now) : null;
      if (c) { clearing = true; occupied = true; freeIn = c.freeIn; }
    }
    const heldFor = booked[id]?.partyId || waitHeld[id]?.partyId || null;
    return { id, name: String(u.name || id), capacity: Math.max(0, Math.floor(Number(u.seatCount ?? u.capacity) || 0)), tags: (Array.isArray(u.tags) ? u.tags : []).map(String),
      staffIds: (Array.isArray(u.staffIds) ? u.staffIds : []).map(String), freeIn, occupied, clearing, heldFor, words };
  });
}

/** Guests at each server's tables right now (a table with more than one server counts for each). */
export function staffLoads(units: any[], parties: any[], names: Record<string, string>): StaffLoad {
  const out: StaffLoad = {};
  for (const u of Array.isArray(units) ? units : []) for (const id of (Array.isArray(u?.staffIds) ? u.staffIds : []).map(String)) out[id] = out[id] || { name: names[id] || 'A server', guests: 0 };
  for (const p of Array.isArray(parties) ? parties : []) {
    if (p?.status !== 'seated') continue;
    const ids = new Set<string>();
    for (const u of Array.isArray(units) ? units : []) if ((p.unitIds || []).includes(String(u.id))) for (const id of (u.staffIds || []).map(String)) ids.add(id);
    for (const id of ids) if (out[id]) out[id].guests += Math.max(1, Number(p.size) || 1);
  }
  return out;
}

const fits = (t: SeatTable, p: SeatParty) => t.capacity >= p.size && (p.needs || []).every((n) => t.tags.includes(n));
const loadOf = (t: SeatTable, loads: StaffLoad) => (t.staffIds.length ? Math.min(...t.staffIds.map((id) => loads[id]?.guests ?? 0)) : null);
const serverOf = (t: SeatTable, loads: StaffLoad) => { const id = t.staffIds.slice().sort((a, b) => (loads[a]?.guests ?? 0) - (loads[b]?.guests ?? 0))[0]; return id ? loads[id] : null; };
const first = (name: string) => String(name || '').split(' ')[0] || name;

/** Who to seat next, at which table, and why: tables free now or within the business's "text ahead" time, paired with
 *  the waiting list. `later`: the rest of the list, with the tables that will likely suit them next. */
export function seatNext(tables: SeatTable[], parties: SeatParty[], loads: StaffLoad, s: FloorSettings, now: number): { now: Suggestion[]; later: Later[]; freeSoon: number } {
  const waiting = (Array.isArray(parties) ? parties : []).filter((p) => p && ['waiting', 'notified'].includes(p.status));
  const ready = waiting.filter((p) => !(ms(p.laterUntil) > now));
  const window = Math.max(0, s.textAheadMin);
  const open = tables.filter((t) => t.capacity > 0 && t.freeIn !== null && t.freeIn <= window);
  const usable = (t: SeatTable, p: SeatParty) => fits(t, p) && (!t.heldFor || t.heldFor === p.id);
  const waitedOf = (p: SeatParty) => minsSince(p.joinedAt, now);
  const overdue = (p: SeatParty) => p.quotedMinutes !== null && p.quotedMinutes !== undefined && (waitedOf(p) ?? 0) > p.quotedMinutes;
  const score = (t: SeatTable, p: SeatParty) => {
    const w = waitedOf(p) ?? 0; const empty = t.capacity - p.size; const load = s.balance ? (loadOf(t, loads) ?? 0) : 0;
    // A much bigger table than they need costs more than waiting a few minutes for a closer fit (big tables are kept
    // for big parties).
    const waste = empty * 3 + Math.max(0, empty - 2) * 6;
    return (t.heldFor === p.id ? 100000 : 0) + (overdue(p) ? 10000 : 0) + (p.status === 'notified' ? 5000 : 0)
      + (s.seatOrder === 'fit' ? -empty * 40 + w * 2 : w * 10 - waste) - (t.freeIn || 0) * 8 - load * 0.5;
  };
  const out: Suggestion[] = []; const usedT = new Set<string>(); const usedP = new Set<string>();
  for (;;) {
    let best: { t: SeatTable; p: SeatParty; v: number } | null = null;
    for (const t of open) { if (usedT.has(t.id)) continue;
      for (const p of ready) { if (usedP.has(p.id) || !usable(t, p)) continue;
        const v = score(t, p); if (!best || v > best.v) best = { t, p, v }; } }
    if (!best) break;
    const { t, p } = best; usedT.add(t.id); usedP.add(p.id);
    const others = open.filter((x) => x.id !== t.id && !usedT.has(x.id) && usable(x, p));
    // The reasons, most telling first: why them (held, overdue, already told), the table's timing, the section, what
    // they asked for, the fit, and the longest wait.
    const reasons: string[] = []; const w = waitedOf(p);
    if (t.heldFor === p.id) reasons.push(`${t.name} is held for them`);
    else if (overdue(p)) reasons.push(`Told about ${p.quotedMinutes} min, it’s been ${w}`);
    else if (p.status === 'notified') { const m = minsSince(p.notifiedAt, now); reasons.push(m !== null ? `Told it’s ready ${m} min ago` : 'Told it’s ready'); }
    // (When it's ready is said beside the table; this is why.)
    if (t.clearing) reasons.push(`${t.name} is being cleared`);
    else if (t.occupied) reasons.push(t.words ? `${t.name}: ${t.words}` : `${t.name} is nearly done`);
    if (s.balance && t.staffIds.length) {
      const fitAll = [t, ...open.filter((x) => x.id !== t.id && usable(x, p) && x.staffIds.length)];
      const mine = loadOf(t, loads); const loadsAll = fitAll.map((x) => loadOf(x, loads) ?? 0);
      const sv = serverOf(t, loads);
      if (sv && mine !== null && fitAll.length > 1 && mine === Math.min(...loadsAll) && mine < Math.max(...loadsAll)) reasons.push(`${first(sv.name)} has the fewest guests, and ${t.name} is theirs`);
    }
    if ((p.needs || []).length) reasons.push(`${p.needs.join(' and ')}, as they asked`);
    const empty = t.capacity - p.size;
    if (s.seatOrder === 'fit' || empty === 0) reasons.push(empty === 0 ? `${p.size} at a table for ${t.capacity}, no empty seats` : `Seats ${t.capacity}, the closest fit`);
    if (!reasons.length && w !== null && ready.some((x) => x.id !== p.id && usable(t, x)) && ready.filter((x) => x.id !== p.id && usable(t, x)).every((x) => (waitedOf(x) ?? 0) <= w)) reasons.push(`Waited ${w} min, the longest of those who fit`);
    out.push({ tableId: t.id, tableName: t.name, partyId: p.id, partyName: p.name, size: p.size, freeIn: t.freeIn || 0, waited: w, reasons: reasons.slice(0, 3),
      alts: others.slice(0, 2).map((x) => x.name), action: !t.occupied ? 'seat' : p.mirrored ? 'soon' : 'hold' });
  }
  out.sort((a, b) => a.freeIn - b.freeIn);
  // The rest of the list: the soonest tables that suit them.
  const later: Later[] = [];
  for (const p of waiting) {
    if (usedP.has(p.id)) continue;
    const suit = tables.filter((t) => usable(t, p) && t.freeIn !== null && !usedT.has(t.id)).sort((a, b) => (a.freeIn as number) - (b.freeIn as number) || a.capacity - b.capacity);
    later.push({ partyId: p.id, partyName: p.name, size: p.size, tables: suit.slice(0, 2).map((t) => t.name), freeIn: suit.length ? suit[0].freeIn : null });
  }
  const freeSoon = tables.filter((t) => t.freeIn !== null && t.freeIn <= 10 && t.capacity > 0 && !t.heldFor).length;
  return { now: out, later, freeSoon };
}
