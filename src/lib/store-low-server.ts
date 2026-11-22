// src/lib/store-low-server.ts — RUNNING LOW AT EACH STORE (design board "Running low at each store"; lib/store-stock
// reorderAtOf, lowStores). Every hour (api/cron/store-low): an item counted at a store, at or under that store's own
// number to order more at, is told to the managers who work at that store (and those at every store, and the owner)
// once, in one note for the store with what the other stores have; back above its number, it can be told again.
import { FieldValue } from 'firebase-admin/firestore';
import { storesOf } from '@/lib/store-stock-server';
import { lowStores, reorderAtOf, stockAtOf, type Store } from '@/lib/store-stock';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const nowIso = () => new Date().toISOString();
const CLAIM_MAX = 150;

export type LowLine = { itemId: string; name: string; count: number; point: number; others: { name: string; count: number }[] };

/** The note for one store: its items at or under their number, with what the other stores have. */
export function lowNote(store: Store, lines: LowLine[]): string {
  const one = (l: LowLine) => `${l.name}: ${l.count} left, you order more at ${l.point}${l.others.filter((o) => o.count > l.point).length ? `. ${l.others.filter((o) => o.count > l.point).map((o) => `${o.name} has ${o.count}`).join(', ')}` : ''}`;
  const shown = lines.slice(0, 4).map(one).join('; ');
  return `Running low at ${store.name}: ${shown}${lines.length > 4 ? `; and ${lines.length - 4} more` : ''}.`;
}

// (Someone not working here any more, or renting space: never told.)
const off = (x: any) => !x || x.isActive === false || x.status === 'archived' || x.archived === true || x.isRenter === true || x.role === 'renter';

/** Who's told at each store: the owner, and each manager who works there or at every store. Read once a run. */
async function managersByStore(db: any, tenantId: string, tenant: any, stores: Store[]): Promise<Map<string, string[]>> {
  const st = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get();
  const out = new Map<string, Set<string>>(stores.map((s) => [s.id, new Set<string>()]));
  for (const d of st.docs) {
    const x: any = d.data() || {}; if (off(x)) continue;
    const at: string[] = Array.isArray(x.locationIds) ? x.locationIds.filter(Boolean) : [];
    for (const s of stores) if (!at.length || at.includes(s.id)) out.get(s.id)!.add(d.id);
  }
  const owner = String(tenant?.userId || tenant?.ownerId || '');
  if (ID.test(owner)) for (const s of out.values()) s.add(owner);
  return new Map(Array.from(out.entries()).map(([k, v]) => [k, Array.from(v)]));
}

/** What changes on an item's marks now: the stores newly low (with someone to tell there), and the marks to take off
 *  (back above its number, no number there now, not counted there now, or the item put away). */
function marksFor(x: any, stores: Store[], people: Map<string, string[]>) {
  const sent: Record<string, string> = x?.lowSentAt && typeof x.lowSentAt === 'object' ? x.lowSentAt : {};
  const gone = x?.archived === true || x?.status === 'archived';
  const low = gone ? [] : lowStores(x, stores);
  const at = stockAtOf(x); const pts = reorderAtOf(x);
  const tell = low.filter((l) => !sent[l.id] && (people.get(l.id) || []).length);
  const clear = Object.keys(sent).filter((k) => gone || (!low.some((l) => l.id === k) && (!(k in pts) || !(k in at) || at[k] > pts[k])));
  return { tell, clear, at };
}

/** One business's check: what's newly low at each store is told once, and what's back above its number can be told
 *  again. Each item is marked in a transaction against the item as it is now (a number changed a moment ago, or another
 *  run at the same time, wins), and only once there's someone to tell; a note that couldn't be written takes its marks
 *  back off, so the next run tells it. */
export async function checkStoreLow(db: any, tenantId: string, tenant: any): Promise<{ stores: number; items: number; notes: number }> {
  const out = { stores: 0, items: 0, notes: 0 };
  const stores = await storesOf(db, tenantId); if (stores.length < 2) return out;
  const T = `tenants/${tenantId}`;
  const snap = await db.collection(`${T}/inventory`).where('reorderAtOn', '==', true).limit(1000).get();
  if (!snap.docs.length) return out;
  const people = await managersByStore(db, tenantId, tenant, stores);
  const stamp = nowIso();
  const byStore = new Map<string, { ref: any; line: LowLine }[]>();
  // (A run marks at most so many, and stops marking well inside the time a run gets, so what it marks is always told;
  // the rest waits for the next hour.)
  let claimed = 0; const began = Date.now();
  for (const d of snap.docs) {
    if (claimed >= CLAIM_MAX || Date.now() - began > 30000) break;
    // (Nothing to change by what was read: no transaction.)
    const seen = marksFor(d.data() || {}, stores, people); if (!seen.tell.length && !seen.clear.length) continue;
    const told: LowLine[] | null = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(d.ref)).data(); if (!x) return [];
      const m = marksFor(x, stores, people); const patch: Record<string, any> = {};
      for (const l of m.tell) patch[`lowSentAt.${l.id}`] = stamp;
      for (const k of m.clear) patch[`lowSentAt.${k}`] = FieldValue.delete();
      if (Object.keys(patch).length) tx.update(d.ref, patch);
      const name = String(x.name || 'An item').slice(0, 60);
      return m.tell.map((l) => ({ itemId: d.id, store: l.id, name, count: l.count, point: l.point,
        others: stores.filter((s) => s.id !== l.id && s.id in m.at).map((s) => ({ name: s.name, count: m.at[s.id] })) } as LowLine & { store: string }));
    }).catch((e: any) => { console.warn('[store-low] mark', d.id, String(e?.message || e).slice(0, 120)); return null; });
    claimed += (told || []).length;
    for (const l of (told || []) as (LowLine & { store: string })[]) {
      const { store, ...line } = l; (byStore.get(store) || byStore.set(store, []).get(store)!).push({ ref: d.ref, line });
    }
  }
  for (const [storeId, rows] of byStore) {
    const store = stores.find((s) => s.id === storeId)!; const to = people.get(storeId) || [];
    const message = lowNote(store, rows.map((r) => r.line)); const link = `/inventory/ordering?at=${encodeURIComponent(storeId)}`;
    try {
      const b = db.batch();
      for (const u of to) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: u, type: 'store_low', message, link, locationId: storeId, createdAt: nowIso(), read: false }); }
      await b.commit(); out.stores++; out.items += rows.length; out.notes += to.length;
    } catch (e: any) {
      // Not told: the marks come back off (only this run's), so the next run tells it.
      console.warn('[store-low] notes', storeId, String(e?.message || e).slice(0, 120));
      for (const r of rows) await db.runTransaction(async (tx: any) => {
        const x: any = (await tx.get(r.ref)).data();
        if (x?.lowSentAt?.[storeId] === stamp) tx.update(r.ref, { [`lowSentAt.${storeId}`]: FieldValue.delete() });
      }).catch(() => null);
    }
  }
  return out;
}
