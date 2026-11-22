// src/lib/store-stock-server.ts — STOCK AT EACH STORE, on the server (rules in lib/store-stock). Counts at a store,
// moves between stores, and "Not at a store yet" taken off the total, each in one step with the item and a line on its
// stock history (tenants/{t}/stockCorrections) as the person who did it. Only with more than one location.
import { bizLocationsOf } from '@/lib/here-server';
import { buildEntry } from '@/lib/stock-ledger';
import { applyCount } from '@/lib/stock-count';
import { variantIdsOf } from '@/lib/variants';
import { afterCount, afterMove, storeView, type Store, type StoreStockView } from '@/lib/store-stock';

type Who = { id: string; name: string };
export type StoreStockReply = ({ ok: true } & StoreStockView) | { ok: false; error: string; status?: number };

/** The business's stores, with more than one location (none with one). */
export async function storesOf(db: any, tenantId: string): Promise<Store[]> {
  const locs = await bizLocationsOf(db, tenantId);
  return locs.length > 1 ? locs.map((l) => ({ id: l.id, name: l.name })) : [];
}

const fail = (error: string, status = 400) => ({ ok: false as const, error, status });

/** An item's stock at each store. */
export async function storeStockView(db: any, tenantId: string, itemId: string): Promise<StoreStockReply> {
  const stores = await storesOf(db, tenantId); if (!stores.length) return fail('Stock is counted at each store once there’s more than one location.', 409);
  const item = (await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get()).data();
  if (!item) return fail('That item isn’t there any more.', 404);
  return { ok: true, ...storeView(item, stores) };
}

/** Run one change to an item's stores, in one step with its stock history. */
async function change(db: any, tenantId: string, itemId: string, fn: (item: any, stores: Store[]) => { patch: Record<string, any>; entry: Record<string, any> | null } | { error: string; status?: number }): Promise<StoreStockReply> {
  const stores = await storesOf(db, tenantId); if (!stores.length) return fail('Stock is counted at each store once there’s more than one location.', 409);
  const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const item: any = s.data();
    if (!item) return fail('That item isn’t there any more.', 404);
    if (String(item.type) === 'equipment') return fail('Equipment isn’t counted here.');
    if (variantIdsOf(item).length) return fail('This one is counted by its variants. Count each variant instead.');
    // (Counted by the dose, with an open container: counted on its own page, where the open one is counted too.)
    if (item.costingMethod === 'uses' || item.costingMethod === 'size') return fail('This one is counted by the dose. Use Count it on its page, where the open one is counted too.');
    const r = fn(item, stores); if ('error' in r) return fail(r.error, r.status || 400);
    if (Object.keys(r.patch).length) tx.update(ref, JSON.parse(JSON.stringify(r.patch)));
    if (r.entry) tx.set(db.collection(`tenants/${tenantId}/stockCorrections`).doc(), r.entry);
    return { ok: true as const, ...storeView({ ...item, ...r.patch }, stores) };
  });
}

/** A count at a store: that store's number, and the total brought along (lib/store-stock afterCount). Units held for
 *  paid orders are never counted away. */
export async function countAtStore(db: any, tenantId: string, itemId: string, at: unknown, counted: unknown, who: Who): Promise<StoreStockReply> {
  const n = typeof counted === 'number' || (typeof counted === 'string' && /^\d+$/.test(counted)) ? Math.floor(Number(counted)) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return fail('Type the number you counted.');
  return change(db, tenantId, itemId, (item, stores) => {
    const store = stores.find((x) => x.id === String(at || '')); if (!store) return { error: 'Pick the store you counted at.' };
    const next = afterCount(item, stores, store.id, n);
    const held = Math.max(0, Number(item.stockReserved) || 0);
    if (next.totalStock < held) return { error: `${held} ${held === 1 ? 'is' : 'are'} held for paid orders, so the total can’t go below that. Mark the missing ones on those orders first.`, status: 409 };
    // (The total changed: its batches brought to it too, as any count does: lib/stock-count applyCount.)
    const counted = next.delta ? applyCount(item, next.totalStock) : null;
    const now = new Date().toISOString();
    return {
      patch: { stockAt: next.stockAt, ...(counted ? { totalStock: counted.totalStock, ...(counted.batches ? { batches: counted.batches } : {}) } : {}), lastCountedAt: now, lastCountedBy: who.name,
        ...(item.countStock === false ? { countStock: true } : {}) },
      // (Its first count ever, for one not counted until now, is where it starts, not a difference found: lib/stock-count.)
      entry: { ...buildEntry({ productId: itemId, type: 'counted', delta: next.delta, reason: `Counted at ${store.name}: ${n}`, actorId: who.id, actorName: who.name, ref: { kind: 'count', id: store.id }, balanceAfter: next.totalStock }),
        storeId: store.id, ...(item.countStock === false ? { baseline: true } : {}) },
    };
  });
}

/** A move between stores, or from or to "Not at a store yet" (`none`). The total stays. */
export async function moveStock(db: any, tenantId: string, itemId: string, from: unknown, to: unknown, qty: unknown, who: Who): Promise<StoreStockReply> {
  return change(db, tenantId, itemId, (item, stores) => {
    const f = String(from || ''), t = String(to || '');
    const r = afterMove(item, stores, f, t, Number(qty)); if ('error' in r) return r;
    const name = (id: string) => (id === 'none' ? 'Not at a store yet' : stores.find((s) => s.id === id)?.name || 'A store');
    const n = Math.floor(Number(qty));
    return { patch: { stockAt: r.stockAt },
      entry: { ...buildEntry({ productId: itemId, type: 'transferred', delta: 0, reason: `Moved ${n} from ${name(f)} to ${name(t)}`, actorId: who.id, actorName: who.name }), from: f, to: t, moved: n } };
  });
}

/** Every store counted, and "Not at a store yet" still shows some: they weren't found, so they come off the total. */
export async function clearUnplaced(db: any, tenantId: string, itemId: string, who: Who): Promise<StoreStockReply> {
  return change(db, tenantId, itemId, (item, stores) => {
    const v = storeView(item, stores);
    if (v.stores.some((s) => s.count === null)) return { error: 'Count every store first.' };
    if (!v.unplaced) return { patch: {}, entry: null };
    const total = v.total - v.unplaced; const held = Math.max(0, Number(item.stockReserved) || 0);
    if (total < held) return { error: `${held} ${held === 1 ? 'is' : 'are'} held for paid orders, so the total can’t go below that.`, status: 409 };
    const counted = applyCount(item, total);
    return { patch: { totalStock: counted.totalStock, ...(counted.batches ? { batches: counted.batches } : {}) },
      entry: buildEntry({ productId: itemId, type: 'counted', delta: -v.unplaced, reason: `Not found at any store: ${v.unplaced} taken off`, actorId: who.id, actorName: who.name, balanceAfter: total }) };
  });
}
