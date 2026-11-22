// src/lib/ordering-store.ts — ORDERING FOR ONE STORE (pure; design board "Running low at each store", parts 3 and 4;
// lib/ordering does the math, api/ordering plan, order and par with `at`). With more than one location, Ordering can
// work out what one store needs: from its own shelf (what's counted there, less what paid orders hold there), its own
// pace (what was sold, used and thrown away there over the last two weeks; what went without a store, such as before
// stores were kept apart, shared evenly between the stores that have it), a set number kept there, and what's on its
// way to it. When another store has more than it needs, the line says so, so it can be moved before more is bought.
import { perOf, suggestFor, usedPerDay, type Movement, type Suggestion } from '@/lib/ordering';
import { heldAtOf, reorderAtOf, stockAtOf, type Store } from '@/lib/store-stock';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** What went a day at each store (keyed by store, then item), and what went without a store. */
export type StoreRates = { by: Map<string, Map<string, number>>; shared: Map<string, number> };
export function storeRates(moves: Movement[], since: string, days: number, perFor?: (productId: string) => number): StoreRates {
  const groups = new Map<string, Movement[]>(); const none: Movement[] = [];
  for (const m of moves) { const s = String(m.storeId || ''); if (s && ID.test(s)) (groups.get(s) || groups.set(s, []).get(s)!).push(m); else none.push(m); }
  return { by: new Map(Array.from(groups.entries()).map(([k, v]) => [k, usedPerDay(v, since, days, perFor)])), shared: usedPerDay(none, since, days, perFor) };
}

/** The stores an item is counted at. */
export const countedAt = (x: any, stores: Store[]) => { const at = stockAtOf(x); return stores.filter((s) => s.id in at); };

/** What went of an item a day at a store: its own, and an even share of what went without a store between the `n`
 *  stores it's counted at. `shared`: some of it is that share. */
export function perDayAt(r: StoreRates, id: string, storeId: string, n: number): { perDay: number; shared: boolean } {
  const own = r.by.get(storeId)?.get(id) || 0; const none = r.shared.get(id) || 0;
  return { perDay: own + none / Math.max(1, n), shared: none > 0 };
}

/** A set number kept at each store, in containers (`parAt`). */
export function parAtOf(x: any): Record<string, number> {
  const out: Record<string, number> = {}; const p = x?.parAt;
  if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) if (ID.test(k) && num(v) > 0) out[k] = Math.round(num(v) * 100) / 100;
  return out;
}

/** On the shelf at a store, in what its history measures: counted there, less what paid orders hold there. */
export function onHandAt(x: any, storeId: string): number {
  const c = stockAtOf(x)[storeId]; if (c === undefined) return 0;
  const held = Math.min(heldAtOf(x)[storeId] ?? 0, Math.max(0, Math.floor(num(x?.stockReserved))));
  return Math.max(0, c - held) * (perOf(x) || 1);
}

/** What a store has of an item beyond what it needs, in whole containers: past its set number (or what it goes through
 *  until the next order), and never below its number to order more at. */
export function spareAt(x: any, storeId: string, perDay: number, cover: number): number {
  const per = perOf(x) || 1; const have = onHandAt(x, storeId);
  const lead = Math.max(0, Math.min(60, Math.round(num(x?.leadTimeDays))));
  const par = parAtOf(x)[storeId]; const point = reorderAtOf(x)[storeId];
  const need = Math.max(par !== undefined ? par * per : perDay * (lead + cover), point !== undefined ? point * per : 0);
  return Math.max(0, Math.floor((have - need) / per + 1e-6));
}

export type StoreSuggestion = Suggestion & { spare: { storeId: string; name: string; qty: number } | null; shared: boolean };

/** What to order of one thing for one store. `onOrderHere`: still to come on orders for this store, `onOrderAll`: on
 *  orders for every store together (said, not taken off: where it goes is picked when it comes). Both in what its
 *  history measures. */
export function suggestAt(id: string, x: any, store: Store, stores: Store[], r: StoreRates, onOrderHere: number, onOrderAll: number, cover: number): StoreSuggestion {
  const counted = countedAt(x, stores); const n = counted.length;
  const mine = perDayAt(r, id, store.id, n);
  const s = suggestFor(id, x, mine.perDay, onOrderHere, cover, { onHand: onHandAt(x, store.id), par: parAtOf(x)[store.id] ?? null });
  const per = perOf(x) || 1; const dose = x?.costingMethod === 'uses' || x?.costingMethod === 'size';
  const words: string[] = [];
  if (onOrderAll > 0) words.push(`${dose ? Math.round((onOrderAll / per) * 10) / 10 : Math.round(onOrderAll * 10) / 10} more on an order for every store.`);
  // Another store with more than it needs, the most first.
  let spare: StoreSuggestion['spare'] = null;
  if (s.suggest > 0) {
    for (const o of counted) {
      if (o.id === store.id) continue;
      const q = spareAt(x, o.id, perDayAt(r, id, o.id, n).perDay, cover);
      if (q > 0 && (!spare || q > spare.qty)) spare = { storeId: o.id, name: o.name, qty: q };
    }
    if (spare) words.push(`${spare.name} has ${spare.qty} more than it needs.`);
  }
  return { ...s, why: [s.why, ...words].join(' '), spare, shared: mine.shared };
}
