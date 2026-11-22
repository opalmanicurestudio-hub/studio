// src/lib/dish-counts-server.ts — LIVE COUNTS PER DISH on the server (lib/dish-counts has the rules): tonight's counts
// read for the kitchen screen (api/kitchen), the table tab and the menu (api/menu); tonight's number changed; and an item
// sold out on every menu when its count reaches zero (back again if the count is raised), under the count's name so a
// sold-out the kitchen set by hand is never undone here. Read again at most every few seconds for a business (every
// kitchen screen asks every few seconds); a server about to ring in a counted dish asks for it fresh.
// - With more than one location (design board "Stock at each store, and tonight's counts at each location"), each
//   location counts its own (`at`): its own number tonight (dishCounts/{day}_{locationId}, on its own clock), its own
//   tickets counted down, and at zero it's sold out there only (lib/menu-choices outWhere), back there when it's raised.
//   Without a location, the business's count, as before.
import { FieldValue } from 'firebase-admin/firestore';
import { itemSoldOut, outWhere } from '@/lib/menu-choices';
import { isMenuItem, setSoldOut } from '@/lib/menu-server';
import { nightBounds, tonight } from '@/lib/night-close-server';
import { COUNT_BY, MAX_COUNT, countRows, usedByItem, type CountRow } from '@/lib/dish-counts';

const ID = /^[A-Za-z0-9_-]{1,160}$/;

/** Tonight's counted items, what each has left, and the night they're for. `items` saves reading the menu again when the
 *  caller already has it (the kitchen screen reads it every few seconds). Nothing counted: no tickets are read. */
const visitCache = new Map<string, string>();
/** Tonight's counts for the business, or for one location (`at`). */
export const countsId = (day: string, at?: string | null) => (at ? `${day}_${at}` : day);

export async function readCounts(db: any, tenantId: string, tenant: any, items?: { id: string; x: any }[], at: string | null = null): Promise<{ day: string; rows: CountRow[]; items: { id: string; x: any }[]; countOut: Record<string, boolean> }> {
  const T = `tenants/${tenantId}`; const day = tonight(tenant);
  const [doc, list] = await Promise.all([
    db.doc(`${T}/dishCounts/${countsId(day, at)}`).get().then((s: any) => s.data() || {}).catch(() => ({})),
    items ? Promise.resolve(items) : db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(400).get()
      .then((s: any) => s.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter((r: any) => isMenuItem(r.x))),
  ]);
  const counts = doc.counts && typeof doc.counts === 'object' ? doc.counts : {};
  const counted = countRows(list, counts, new Map(), () => false);
  // (Which a location's count sold out there, so only those come back on their own when it's raised.)
  const countOut: Record<string, boolean> = doc.countOut && typeof doc.countOut === 'object' ? doc.countOut : {};
  if (!counted.length) return { day, rows: [], items: list, countOut };
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
  // (A location's own tickets: those made there. A table's, which don't say, are where its table is.)
  let mine = tickets;
  if (at) {
    // (Each table's location read once on this server: a table doesn't move between locations.)
    const visits = Array.from(new Set(tickets.filter((t: any) => !t.locationId && ID.test(String(t.visitId || '')) && !visitCache.has(`${tenantId}/${t.visitId}`)).map((t: any) => String(t.visitId)))) as string[];
    for (let i = 0; i < visits.length; i += 100) {
      const snaps: any[] = await db.getAll(...visits.slice(i, i + 100).map((v) => db.doc(`${T}/appointments/${v}`))).catch(() => []);
      snaps.forEach((s: any, k: number) => { if (s?.exists) visitCache.set(`${tenantId}/${visits[i + k]}`, String(s?.data?.()?.locationId || '')); });
    }
    if (visitCache.size > 20000) visitCache.clear();
    const visitAt = { get: (v: string) => visitCache.get(`${tenantId}/${v}`) };
    mine = tickets.filter((t: any) => String(t.locationId || visitAt.get(String(t.visitId || '')) || '') === at);
  }
  return { day, rows: countRows(list, counts, usedByItem(mine), (x: any) => itemSoldOut(x, at)), items: list, countOut };
}

/** Sold out at zero, and back when there's more again (only what the count sold out). Returns the ids changed. `at`
 *  (a location's count): sold out there only, and back there only. */
export async function soldOutByCount(db: any, tenantId: string, rows: CountRow[], items: { id: string; x: any }[], at: string | null = null, day = '', countOut: Record<string, boolean> = {}): Promise<string[]> {
  const byId = new Map(items.map((i) => [i.id, i.x]));
  const changed: string[] = [];
  if (at) {
    const ref = db.doc(`tenants/${tenantId}/dishCounts/${countsId(day, at)}`);
    for (const r of rows) {
      const x = byId.get(r.id) || {}; const w = outWhere(x, at);
      if (r.left <= 0 && !w) {
        // (Marked first: one the count sold out is always known as the count's, to bring back when it's raised.)
        if (!(await ref.set({ countOut: { [r.id]: true } }, { merge: true }).then(() => true).catch(() => false))) continue;
        const s = await setSoldOut(db, tenantId, { itemId: r.id, out: true, where: 'here' }, COUNT_BY, at).catch(() => null);
        if (s?.ok) { changed.push(r.id); r.soldOut = true; }
      } else if (r.left > 0 && !w && countOut[r.id]) {
        // (Back on already, by hand: the count's mark goes, so it never brings back a later sold out by hand.)
        await ref.set({ countOut: { [r.id]: FieldValue.delete() } }, { merge: true }).catch(() => null);
      } else if (r.left > 0 && w === 'here' && countOut[r.id]) {
        const s = await setSoldOut(db, tenantId, { itemId: r.id, out: false, where: 'here' }, COUNT_BY, at).catch(() => null);
        if (s?.ok) { changed.push(r.id); r.soldOut = false; await ref.set({ countOut: { [r.id]: FieldValue.delete() } }, { merge: true }).catch(() => null); }
      }
    }
    return changed;
  }
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
/** `at` (with more than one location): that location's own counts, on its own clock (the tenant given on it). */
export async function liveCounts(db: any, tenantId: string, tenant: any, items?: { id: string; x: any }[], o: { fresh?: boolean; at?: string | null } = {}): Promise<{ day: string; rows: CountRow[]; soldOut: string[] }> {
  const at = o.at || null;
  const key = `${tenantId}|${at || ''}|${tonight(tenant)}`; const hit = cache.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < CACHE_MS) return { day: hit.day, rows: hit.rows.map((r) => ({ ...r })), soldOut: hit.soldOut };
  const r = await readCounts(db, tenantId, tenant, items, at);
  // (With more than one location, each location's count sells out there; the whole business's adds every location up,
  // so it's only read, never what sells something out everywhere.)
  const { severalLocations } = await import('@/lib/here-server');
  const readOnly = !at && await severalLocations(db, tenantId).catch(() => true);
  const changed = r.rows.length && !readOnly ? await soldOutByCount(db, tenantId, r.rows, r.items, at, r.day, r.countOut).catch(() => [] as string[]) : [];
  const nowOut = new Set(r.items.filter((i) => itemSoldOut(i.x, at)).map((i) => i.id));
  for (const row of r.rows) if (changed.includes(row.id)) { if (row.soldOut) nowOut.add(row.id); else nowOut.delete(row.id); }
  const out = { day: r.day, rows: r.rows, soldOut: Array.from(nowOut) };
  cache.set(key, { at: Date.now(), ...out, rows: r.rows.map((x) => ({ ...x })) });
  return out;
}

/** Tonight's number for one item: a number (0 to 999), 'off' (not counted tonight), or 'menu' (back to the menu's own). */
export async function setTonightCount(db: any, tenantId: string, tenant: any, itemId: unknown, value: unknown, by: string, at: string | null = null): Promise<{ ok: true; day: string } | { ok: false; error: string; status: number }> {
  const id = String(itemId || ''); if (!ID.test(id)) return { ok: false, error: 'Which item?', status: 400 };
  // (With more than one location, each counts its own: a count needs its location.)
  if (!at) { const { severalLocations } = await import('@/lib/here-server'); if (await severalLocations(db, tenantId).catch(() => true)) return { ok: false, error: 'Each location counts its own. Set this screen to a location, or pick one in the app, to count here.', status: 409 }; }
  const T = `tenants/${tenantId}`;
  const x: any = (await db.doc(`${T}/inventory/${id}`).get()).data();
  if (!isMenuItem(x)) return { ok: false, error: 'That isn’t on the menu.', status: 404 };
  let v: any;
  if (value === 'off') v = null;
  else if (value === 'menu') v = FieldValue.delete();
  else { const n = Math.floor(Number(value)); if (!Number.isFinite(n) || n < 0 || n > MAX_COUNT || String(value).trim() === '') return { ok: false, error: `Enter a count from 0 to ${MAX_COUNT}.`, status: 400 }; v = n; }
  const day = tonight(tenant);
  forgetCounts(tenantId);
  // (Not counted there any more: one its count sold out comes back there now, not at 4.)
  if (at && (value === 'off' || value === 'menu')) {
    const cur: any = (await db.doc(`${T}/dishCounts/${countsId(day, at)}`).get().catch(() => null))?.data?.() || {};
    if (cur.countOut?.[id] && outWhere(x, at) === 'here') { await setSoldOut(db, tenantId, { itemId: id, out: false, where: 'here' }, COUNT_BY, at).catch(() => null); }
    if (cur.countOut?.[id]) await db.doc(`${T}/dishCounts/${countsId(day, at)}`).set({ countOut: { [id]: FieldValue.delete() } }, { merge: true }).catch(() => null);
  }
  await db.doc(`${T}/dishCounts/${countsId(day, at)}`).set({ day, ...(at ? { locationId: at } : {}), counts: { [id]: v }, changedBy: { [id]: value === 'menu' ? FieldValue.delete() : String(by || 'The team').slice(0, 60) }, updatedAt: new Date().toISOString() }, { merge: true });
  return { ok: true, day };
}
