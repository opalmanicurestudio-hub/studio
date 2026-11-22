// src/lib/store-stock.ts — STOCK AT EACH STORE (pure; design board "Stock at each store, and tonight's counts at each
// location"). With more than one location, an item can be counted at each one: `stockAt` keeps each location's own
// number. `totalStock` stays the business's total, the one number every report and every older screen uses; what isn't
// counted at a store yet is "Not at a store yet" (the total less the stores'). Until an item is counted at a store,
// everything is there and the shop works as before.
// - A count at a store: that store's number is what was counted. The first count takes what it found from "Not at a
//   store yet" (and adds to the total only past it); a later one changes the total by the difference, except what was
//   already taken off the total by a sale that didn't say where it was (`short`).
// - A move: from one store to another, or from or to "Not at a store yet"; the total stays.
// - Sold or used without a store (an older screen): the total goes down and the stores don't, so the stores can add up to
//   more than the total for a while (`short`), until they're counted again.

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const whole = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000_000) : 0; };

export type Store = { id: string; name: string };
export type StoreRowView = { id: string; name: string; count: number | null };
export type StoreStockView = { total: number; stores: StoreRowView[]; unplaced: number; short: number; tracked: boolean };

/** Each location's own number, as kept (only well-formed ids and whole numbers). */
export function stockAtOf(item: any): Record<string, number> {
  const out: Record<string, number> = {};
  const x = item?.stockAt;
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (ID.test(k) && v !== null && v !== undefined && Number.isFinite(Number(v))) out[k] = whole(v);
  return out;
}

/** What each of the business's stores has (only its current ones: a closed store's units are "Not at a store yet"). */
export function storeView(item: any, stores: Store[]): StoreStockView {
  const total = whole(item?.totalStock);
  const at = stockAtOf(item);
  const rows = stores.map((s) => ({ id: s.id, name: s.name, count: s.id in at ? at[s.id] : null }));
  const counted = rows.reduce((n, r) => n + (r.count ?? 0), 0);
  return { total, stores: rows, unplaced: Math.max(0, total - counted), short: Math.max(0, counted - total), tracked: rows.some((r) => r.count !== null) };
}

/** After a count of `n` at store `at`: the new total and each store's number. */
/** Each current store's own number (a closed store's left out: its units are "Not at a store yet"). */
const keptAt = (item: any, stores: Store[]) => Object.fromEntries(Object.entries(stockAtOf(item)).filter(([k]) => stores.some((s) => s.id === k)));

export function afterCount(item: any, stores: Store[], at: string, n: number): { totalStock: number; stockAt: Record<string, number>; delta: number } {
  const v = storeView(item, stores); const keep = keptAt(item, stores);
  const old = v.stores.find((s) => s.id === at)?.count ?? null;
  const count = whole(n);
  let total = v.total;
  if (old === null) total += Math.max(0, count - v.unplaced);
  else { const d = count - old; total += d < 0 && v.short > 0 ? d + Math.min(v.short, -d) : d; }
  return { totalStock: total, stockAt: { ...keep, [at]: count }, delta: total - v.total };
}

/** A move between stores (`none`: "Not at a store yet"). The total stays. */
export function afterMove(item: any, stores: Store[], from: string, to: string, qty: number): { stockAt: Record<string, number> } | { error: string } {
  const v = storeView(item, stores); const keep = keptAt(item, stores); const n = whole(qty);
  if (!n) return { error: 'How many to move?' };
  if (from === to) return { error: 'Pick two different places.' };
  const known = (id: string) => id === 'none' || stores.some((s) => s.id === id);
  if (!known(from) || !known(to)) return { error: 'Pick the stores again.' };
  const has = from === 'none' ? v.unplaced : v.stores.find((s) => s.id === from)?.count ?? 0;
  const where = from === 'none' ? 'Not at a store yet' : stores.find((s) => s.id === from)?.name || 'That store';
  if (n > has) return { error: has ? `${where} has ${has}. Move ${has} or fewer.` : `${where} has none to move.` };
  const next = { ...keep };
  if (from !== 'none') next[from] = (next[from] ?? 0) - n;
  if (to !== 'none') next[to] = (next[to] ?? 0) + n;
  return { stockAt: next };
}

/** How many a store can sell now: its own number (never more than the business has), or with no number of its own yet,
 *  the business's (as before stores were counted). `free`: what the business can sell (held and kept back taken off). */
export function sellableAt(item: any, stores: Store[], at: string | null, free: number): number {
  if (!at) return free;
  const v = storeView(item, stores); if (!v.tracked) return free;
  const mine = v.stores.find((s) => s.id === at)?.count;
  return mine === null || mine === undefined ? 0 : Math.max(0, Math.min(mine, free));
}

/** Each location's units held for paid online orders (picked up there, or going out from there), as kept. */
export function heldAtOf(item: any): Record<string, number> {
  const out: Record<string, number> = {};
  const x = item?.heldAt;
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (ID.test(k) && Number.isFinite(Number(v))) out[k] = whole(v);
  return out;
}

/** A sale or a hold at a store, as the fields to write with the rest of the item's change (dotted paths, in a step that
 *  read the item): only for an item counted at that store (one never counted there gets no number from a sale), never
 *  below zero. `stock`: units on its shelf (negative: taken); `held`: units held for paid online orders there. */
export function storeMove(item: any, at: unknown, m: { stock?: number; held?: number }): Record<string, number> {
  const id = String(at || ''); if (!ID.test(id)) return {};
  const at0 = stockAtOf(item); if (!(id in at0)) return {};
  const out: Record<string, number> = {};
  if (m.stock) out[`stockAt.${id}`] = Math.max(0, at0[id] + Math.round(m.stock));
  if (m.held) out[`heldAt.${id}`] = Math.max(0, (heldAtOf(item)[id] ?? 0) + Math.round(m.held));
  return out;
}

/** A change worked out as the item's new total (lib/usage moveStock's patch): the store's number moves by the same
 *  amount, for an item counted there. */
export function storeFollow(item: any, at: unknown, nextTotal: unknown): Record<string, number> {
  const next = Number(nextTotal); if (!Number.isFinite(next)) return {};
  return storeMove(item, at, { stock: Math.round(next) - whole(item?.totalStock) });
}

/** The same, for a write that merges maps (a set with merge): `{ stockAt: { [at]: n } }` rather than a dotted path. */
export function storeMoveNested(item: any, at: unknown, m: { stock?: number; held?: number }): Record<string, Record<string, number>> {
  const flat = storeMove(item, at, m); const out: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(flat)) { const [f, id] = k.split('.'); (out[f] ||= {})[id] = v; }
  return out;
}

/** storeFollow, for a write that merges maps (a set with merge). */
export function storeFollowNested(item: any, at: unknown, nextTotal: unknown): Record<string, Record<string, number>> {
  const next = Number(nextTotal); if (!Number.isFinite(next)) return {};
  return storeMoveNested(item, at, { stock: Math.round(next) - whole(item?.totalStock) });
}

/** A change to a store's number as an increment (a dotted field, for an update), for a write that doesn't read the item
 *  in the same step (a batch): only for an item counted there (as read), and never more off than it had then. */
export function storeStep(item: any, at: unknown, stock: number, inc: (n: number) => unknown): Record<string, unknown> {
  const id = String(at || ''); if (!ID.test(id)) return {};
  const have = stockAtOf(item)[id]; if (have === undefined) return {};
  const n = stock < 0 ? -Math.min(have, Math.round(-stock)) : Math.round(stock);
  return n ? { [`stockAt.${id}`]: inc(n) } : {};
}

/** storeStep, for a write that merges maps (a set with merge). */
export function storeStepNested(item: any, at: unknown, stock: number, inc: (n: number) => unknown): Record<string, Record<string, unknown>> {
  const flat = storeStep(item, at, stock, inc); const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(flat)) { const [f, id] = k.split('.'); (out[f] ||= {})[id] = v; }
  return out;
}

/** Where a delivery received at store `at` goes: its shelf there (counted there), "Not at a store yet" (counted at other
 *  stores but not this one yet: the total goes up, the stores don't), or `everywhere` (not counted at any store: every
 *  store sells from the total, as before). */
export function receivedTo(item: any, stores: Store[], at: string | null | undefined): 'shelf' | 'unplaced' | 'everywhere' {
  if (!at || !stores.length) return 'everywhere';
  const v = storeView(item, stores); if (!v.tracked) return 'everywhere';
  const mine = v.stores.find((s) => s.id === at);
  return mine && mine.count !== null ? 'shelf' : 'unplaced';
}

/** What a store can sell online now: its own number less what's held there, never more than the business can (`free`). */
export function onlineAt(item: any, stores: Store[], at: string | null, free: number): number {
  if (!at) return free;
  const v = storeView(item, stores); if (!v.tracked) return free;
  const mine = v.stores.find((s) => s.id === at)?.count;
  if (mine === null || mine === undefined) return 0;
  // (What's held there is never more than the business holds: a hold let go without its store can't keep it down.)
  const held = Math.min(heldAtOf(item)[at] ?? 0, Math.max(0, Math.floor(Number(item?.stockReserved) || 0)));
  return Math.max(0, Math.min(mine - held, free));
}

/** For the shop: what each store can sell online now (shown no higher than `cap`), for an item counted at a store; null
 *  for one that isn't (every store sells it from the business's stock, as before). */
/** `counted`: false for a store it hasn't been counted at yet (not offered there until it is). */
export type AtStore = { id: string; name: string; qty: number; counted: boolean };
export function atStoresOf(item: any, stores: Store[], free: number, cap: number): AtStore[] | null {
  if (!stores.length) return null;
  const v = storeView(item, stores); if (!v.tracked) return null;
  return stores.map((s) => ({ id: s.id, name: s.name, qty: Math.min(cap, onlineAt(item, stores, s.id, free)), counted: v.stores.find((x) => x.id === s.id)?.count !== null }));
}

/** What the product page says about the store picked (and where else it is). */
export function storeLine(at: AtStore[] | null | undefined, picked: string): { here: AtStore | null; elsewhere: AtStore[] } | null {
  if (!at || !at.length) return null;
  return { here: at.find((s) => s.id === picked) || null, elsewhere: at.filter((s) => s.id !== picked && s.qty > 0) };
}
