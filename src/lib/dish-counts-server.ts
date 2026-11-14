// src/lib/dish-counts-server.ts — LIVE COUNTS PER DISH on the server (lib/dish-counts has the rules): tonight's counts
// read for the kitchen screen (api/kitchen), the table tab and the menu (api/menu); tonight's number changed; and an item
// sold out on every menu when its count reaches zero (back again if the count is raised), under the count's name so a
// sold-out the kitchen set by hand is never undone here. Read again at most every few seconds for a business (every
// kitchen screen asks every few seconds); a server about to ring in a counted dish asks for it fresh.
import { FieldValue } from 'firebase-admin/firestore';
import { itemSoldOut } from '@/lib/menu-choices';
import { isMenuItem, setSoldOut } from '@/lib/menu-server';
import { nightBounds, tonight } from '@/lib/night-close-server';
import { COUNT_BY, MAX_COUNT, countRows, usedByItem, type CountRow } from '@/lib/dish-counts';

const ID = /^[A-Za-z0-9_-]{1,160}$/;

/** Tonight's counted items, what each has left, and the night they're for. `items` saves reading the menu again when the
 *  caller already has it (the kitchen screen reads it every few seconds). Nothing counted: no tickets are read. */
export async function readCounts(db: any, tenantId: string, tenant: any, items?: { id: string; x: any }[]): Promise<{ day: string; rows: CountRow[]; items: { id: string; x: any }[] }> {
  const T = `tenants/${tenantId}`; const day = tonight(tenant);
  const [doc, list] = await Promise.all([
    db.doc(`${T}/dishCounts/${day}`).get().then((s: any) => s.data() || {}).catch(() => ({})),
    items ? Promise.resolve(items) : db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(400).get()
      .then((s: any) => s.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter((r: any) => isMenuItem(r.x))),
  ]);
  const counts = doc.counts && typeof doc.counts === 'object' ? doc.counts : {};
  const counted = countRows(list, counts, new Map(), () => false);
  if (!counted.length) return { day, rows: [], items: list };
  // Tonight's tickets, from the night's start (the business's own cutover, as the night's report counts it).
  const b = nightBounds(tenant, day);
  const ids = new Set(counted.map((r) => r.id));
  const [k, l] = await Promise.all([
    db.collection(`${T}/kdsTickets`).where('createdAt', '>=', b.start).limit(4000).get().catch(() => ({ docs: [] as any[] })),
    db.collection(`${T}/refreshmentRequests`).where('requestedAt', '>=', b.start).limit(2000).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const tickets = [...k.docs.map((d: any) => d.data() || {}).filter((t: any) => String(t.createdAt || '') < b.end),
    ...l.docs.map((d: any) => d.data() || {}).filter((t: any) => String(t.requestedAt || '') < b.end)]
    .filter((t: any) => ids.has(String(t.menuItemId || t.itemId || '')));
  return { day, rows: countRows(list, counts, usedByItem(tickets), itemSoldOut), items: list };
}

/** Sold out at zero, and back when there's more again (only what the count sold out). Returns the ids changed. */
export async function soldOutByCount(db: any, tenantId: string, rows: CountRow[], items: { id: string; x: any }[]): Promise<string[]> {
  const byId = new Map(items.map((i) => [i.id, i.x]));
  const changed: string[] = [];
  for (const r of rows) {
    const x = byId.get(r.id) || {};
    const out = itemSoldOut(x);
    if (r.left <= 0 && !out) { const s = await setSoldOut(db, tenantId, { itemId: r.id, out: true }, COUNT_BY).catch(() => null); if (s?.ok) { changed.push(r.id); r.soldOut = true; } }
    else if (r.left > 0 && out && String(x.soldOutBy || '') === COUNT_BY) { const s = await setSoldOut(db, tenantId, { itemId: r.id, out: false }, COUNT_BY).catch(() => null); if (s?.ok) { changed.push(r.id); r.soldOut = false; } }
  }
  return changed;
}

const CACHE_MS = 8000;
const cache = new Map<string, { at: number; day: string; rows: CountRow[]; soldOut: string[] }>();
/** Forget what was read for a business (after its counts change). */
export const forgetCounts = (tenantId: string) => { for (const k of Array.from(cache.keys())) if (k.startsWith(`${tenantId}|`)) cache.delete(k); };

/** Counts read, and any item at zero sold out (or back): what every screen calls. Also which menu items are sold out
 *  right now, so a screen that read the menu earlier stops offering one sold out since. */
export async function liveCounts(db: any, tenantId: string, tenant: any, items?: { id: string; x: any }[], o: { fresh?: boolean } = {}): Promise<{ day: string; rows: CountRow[]; soldOut: string[] }> {
  const key = `${tenantId}|${tonight(tenant)}`; const hit = cache.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < CACHE_MS) return { day: hit.day, rows: hit.rows.map((r) => ({ ...r })), soldOut: hit.soldOut };
  const r = await readCounts(db, tenantId, tenant, items);
  const changed = r.rows.length ? await soldOutByCount(db, tenantId, r.rows, r.items).catch(() => [] as string[]) : [];
  const nowOut = new Set(r.items.filter((i) => itemSoldOut(i.x)).map((i) => i.id));
  for (const row of r.rows) if (changed.includes(row.id)) { if (row.soldOut) nowOut.add(row.id); else nowOut.delete(row.id); }
  const out = { day: r.day, rows: r.rows, soldOut: Array.from(nowOut) };
  cache.set(key, { at: Date.now(), ...out, rows: r.rows.map((x) => ({ ...x })) });
  return out;
}

/** Tonight's number for one item: a number (0 to 999), 'off' (not counted tonight), or 'menu' (back to the menu's own). */
export async function setTonightCount(db: any, tenantId: string, tenant: any, itemId: unknown, value: unknown, by: string): Promise<{ ok: true; day: string } | { ok: false; error: string; status: number }> {
  const id = String(itemId || ''); if (!ID.test(id)) return { ok: false, error: 'Which item?', status: 400 };
  const T = `tenants/${tenantId}`;
  const x: any = (await db.doc(`${T}/inventory/${id}`).get()).data();
  if (!isMenuItem(x)) return { ok: false, error: 'That isn’t on the menu.', status: 404 };
  let v: any;
  if (value === 'off') v = null;
  else if (value === 'menu') v = FieldValue.delete();
  else { const n = Math.floor(Number(value)); if (!Number.isFinite(n) || n < 0 || n > MAX_COUNT || String(value).trim() === '') return { ok: false, error: `Enter a count from 0 to ${MAX_COUNT}.`, status: 400 }; v = n; }
  const day = tonight(tenant);
  forgetCounts(tenantId);
  await db.doc(`${T}/dishCounts/${day}`).set({ day, counts: { [id]: v }, changedBy: { [id]: value === 'menu' ? FieldValue.delete() : String(by || 'The team').slice(0, 60) }, updatedAt: new Date().toISOString() }, { merge: true });
  return { ok: true, day };
}
