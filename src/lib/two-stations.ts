// src/lib/two-stations.ts — ONE ITEM, MADE AT TWO STATIONS (design canvas "One item, two stations"). An item can say it's
// also made somewhere else: Steak frites at the grill, and its fries at the fryer. Ordered, it goes to its own station as
// itself and to each other station as its part ("Steak frites: the fries"), each a kitchen ticket of its own, joined to
// the same line. The pass sends them out together: the plate is ready once every part is, and taking it off the check
// or moving the guest moves every part. Nothing here takes stock (the item does, once). Pure.

export type AlsoAt = { station: string; part: string };
export const MAX_ALSO = 2;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = (s: string) => s.trim().toLowerCase();

/** The other stations an item is made at, kept clean: one of the business's own stations (never its own one, never
 *  twice), each with a few words for its part ("the fries"). */
export function cleanAlsoAt(raw: unknown, stations: string[], own: string | null): AlsoAt[] {
  const out: AlsoAt[] = []; const seen = new Set<string>(own ? [key(own)] : []);
  for (const x of Array.isArray(raw) ? raw.slice(0, MAX_ALSO) : []) {
    const want = words((x as any)?.station, 24); const station = stations.find((s) => key(s) === key(want));
    const part = words((x as any)?.part, 40);
    if (!station || !part || seen.has(key(station))) continue;
    seen.add(key(station)); out.push({ station, part });
  }
  return out;
}
/** An item's other stations as it was saved (when `stations` is given, only those still the business's own). */
export const alsoAtOf = (item: any, stations?: string[]): AlsoAt[] =>
  cleanAlsoAt(item?.alsoAt, stations || (Array.isArray(item?.alsoAt) ? item.alsoAt.map((x: any) => words(x?.station, 24)) : []), words(item?.station, 24) || null);

/** A part's name on its ticket: "Steak frites: the fries". */
export const partName = (itemName: string, part: string) => `${words(itemName, 60)}: ${words(part, 40)}`.slice(0, 80);
/** A part's ticket id, from the item's own ("tab_v1_ab12" → "tab_v1_ab12_s1"). */
export const partTicketId = (mainId: string, i: number) => `${mainId}_s${i + 1}`;
/** Every ticket of a table's line: its own and its parts'. */
export const lineTicketIds = (l: any): string[] => [l?.kdsId, ...(Array.isArray(l?.alsoKdsIds) ? l.alsoKdsIds : [])].map((x) => String(x || '')).filter((x) => /^[A-Za-z0-9_-]{1,200}$/.test(x));

// How far along a ticket is, slowest first.
const ORDER = ['unfired', 'pending', 'in_progress', 'ready', 'delivered'];
/** Where a dish made at two stations is, from each part: as far as its slowest part (a part cancelled on its own doesn't
 *  hold it back; every part cancelled is cancelled). */
export function combinedStatus(list: string[]): string {
  const live = list.map((s) => String(s || 'pending')).filter((s) => s !== 'cancelled');
  if (!live.length) return list.length ? 'cancelled' : 'pending';
  return live.reduce((a, b) => (ORDER.indexOf(b) >= 0 && (ORDER.indexOf(a) < 0 || ORDER.indexOf(b) < ORDER.indexOf(a)) ? b : a));
}
/** Tickets by id, with each part folded into its dish's (the parts' own ids stay too): the dish is ready only once its
 *  parts are, and ready or out at the latest of them. */
export function foldParts<T extends { status?: string; readyAt?: string | null; deliveredAt?: string | null; partOf?: string | null }>(byId: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...byId };
  const parts = new Map<string, T[]>();
  for (const t of Object.values(byId)) { const main = String(t?.partOf || ''); if (main && byId[main]) parts.set(main, [...(parts.get(main) || []), t]); }
  for (const [main, ps] of parts) {
    const all = [byId[main], ...ps]; const status = combinedStatus(all.map((t) => String(t.status || '')));
    const latest = (f: 'readyAt' | 'deliveredAt') => all.map((t) => String(t[f] || '')).filter(Boolean).sort().pop() || null;
    out[main] = { ...byId[main], status, readyAt: status === 'ready' || status === 'delivered' ? latest('readyAt') : null, deliveredAt: status === 'delivered' ? latest('deliveredAt') : null };
  }
  return out;
}
