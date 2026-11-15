// src/lib/sections.ts — TONIGHT'S SECTIONS (design canvas "Tonight's sections"). Who looks after which tables tonight:
// each table of the open service (lib/hosting-sessions) has the people on it (`staffIds`), copied from the floor plan's
// usual sections when the night opens. The host stand changes them for tonight only (the floor plan stays as it is):
//   - pick someone and tap their tables (a table is one person's; tapping one of theirs gives it back to nobody)
//   - hand a table to someone else (a break, a big party next door)
//   - a call-out: everything someone had goes to one person, or is shared out, a table at a time, to whoever has the
//     least then
// Who hears: anyone given a table that's seated right now (lib/floor-buzz). Pure.

export type Unit = { id: string; name: string; staffIds: string[] };
export type Person = { id: string; name: string };
export type Move = { unitId: string; from: string[]; to: string[] };

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

/** Each person's tables tonight, in floor order, and the tables nobody has. */
export function sectionsOf(units: Unit[], people: Person[]): { people: (Person & { unitIds: string[] })[]; nobody: string[] } {
  const by = new Map<string, string[]>();
  for (const u of units) for (const s of u.staffIds || []) by.set(s, [...(by.get(s) || []), u.id]);
  return { people: people.map((p) => ({ ...p, unitIds: by.get(p.id) || [] })), nobody: units.filter((u) => !(u.staffIds || []).length).map((u) => u.id) };
}

/** A tap on a table while someone is picked: theirs now (from whoever had it), or back to nobody if it was theirs. */
export function tapTable(units: Unit[], unitId: string, staffId: string): Move | null {
  const u = units.find((x) => x.id === unitId); if (!u || !staffId) return null;
  const was = uniq(u.staffIds || []);
  const to = was.length === 1 && was[0] === staffId ? [] : [staffId];
  return { unitId, from: was, to };
}

/** Tables handed to someone: theirs alone. A table already theirs alone isn't a move. */
export function handOver(units: Unit[], unitIds: string[], toId: string): Move[] {
  if (!toId) return [];
  return units.filter((u) => unitIds.includes(u.id)).map((u) => ({ unitId: u.id, from: uniq(u.staffIds || []), to: [toId] }))
    .filter((m) => !(m.from.length === 1 && m.from[0] === toId));
}

/** Someone called out: their tables go to `to` (one person), or with 'share', a table at a time to whoever has the
 *  fewest then (seated tables count double: they're working). A table they shared with someone else just loses them. */
export function callOut(units: Unit[], outId: string, others: Person[], to: string | 'share', seatedUnitIds: string[] = []): Move[] {
  const theirs = units.filter((u) => (u.staffIds || []).includes(outId));
  const pool = others.filter((p) => p.id !== outId);
  if (!theirs.length || (!pool.length && to === 'share')) return [];
  const load = new Map<string, number>(pool.map((p) => [p.id, 0]));
  for (const u of units) for (const s of u.staffIds || []) if (load.has(s) && !(u.staffIds || []).includes(outId)) load.set(s, (load.get(s) || 0) + (seatedUnitIds.includes(u.id) ? 2 : 1));
  const moves: Move[] = [];
  for (const u of theirs) {
    const keep = uniq((u.staffIds || []).filter((s) => s !== outId));
    if (keep.length) { moves.push({ unitId: u.id, from: uniq(u.staffIds), to: keep }); continue; }
    let pick = to === 'share' ? '' : to;
    if (to === 'share') { let best = Infinity; for (const p of pool) { const l = load.get(p.id) || 0; if (l < best) { best = l; pick = p.id; } } }
    if (!pick || pick === outId) continue;
    load.set(pick, (load.get(pick) || 0) + (seatedUnitIds.includes(u.id) ? 2 : 1));
    moves.push({ unitId: u.id, from: uniq(u.staffIds), to: [pick] });
  }
  return moves;
}

/** The units with the moves made. */
export function applyMoves<U extends Unit>(units: U[], moves: Move[]): U[] {
  const m = new Map(moves.map((x) => [x.unitId, x.to]));
  return units.map((u) => (m.has(u.id) ? { ...u, staffIds: m.get(u.id)! } : u));
}

/** Who a call-out sends where, in words: "Lee 4, Sam 5 and 23". */
export function movesWords(moves: Move[], units: Unit[], people: Person[]): string {
  const name = (id: string) => (people.find((p) => p.id === id)?.name || 'Someone').split(' ')[0];
  const label = (id: string) => units.find((u) => u.id === id)?.name || id;
  const by = new Map<string, string[]>();
  for (const m of moves) for (const s of m.to) by.set(s, [...(by.get(s) || []), label(m.unitId)]);
  const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  return Array.from(by.entries()).map(([s, ts]) => `${name(s)} ${list(ts)}`).join(', ');
}
