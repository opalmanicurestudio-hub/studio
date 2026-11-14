// src/lib/menu-server.ts — THE MENU, read and changed on the server (api/menu for the team, api/kitchen for the kitchen
// screen's one-tap "Sold out"). A menu item is an inventory item of the refreshment kind; what guests see of it is its
// name, section, words, price, picture and choices (lib/menu-choices), never its cost or supplier. Whether it can be made
// now comes from its recipe's ingredients when it has one, else its own count (lib/menu-stock).
import { choiceGroups, itemSoldOut, startingPrice, type ChoiceGroup } from '@/lib/menu-choices';
import { makeSecondsOf, holdMinutesOf, photoOf } from '@/lib/counter-orders';
import { batchSizeOf } from '@/lib/holding';
import { addDays, tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';
import { stockOf, ingredientIds, recipeOf, type MenuStock } from '@/lib/menu-stock';
import { allergensKnown, itemAllergens, type AllergenKey } from '@/lib/allergens';
import { dailyCountOf } from '@/lib/dish-counts';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type MenuItem = { id: string; name: string; section: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; choices: ChoiceGroup[];
  soldOut: boolean; onMenu: boolean; membersOnly: boolean; inStock: boolean;
  /** Made from a recipe: the first ingredient that's run out (null when there's enough, or it isn't counted), and how
   *  many could be made from what's counted (null: nothing is counted). Without a recipe, `canMake` is its own count. */
  short: string | null; canMake: number | null; byRecipe: boolean;
  /** Kitchen timing (lib/counter-orders, lib/holding): how long it takes to make, and how long a batch may be held (0: not held). */
  makeSeconds: number; holdMinutes: number; batchSize: number;
  /** The menu board (api/counter 'menuBoard'): shown big up front, a New or Limited time tag, and its calories (optional). */
  featured: boolean; badge: 'new' | 'limited' | null; calories: number | null;
  /** Table service (lib/table-service): the station it's made at and its course, as set on it (null: worked out from
   *  its section; course 0: always right away). */
  station: string | null; course: number | null;
  /** What it contains of the major allergens (lib/allergens; allergensSet false: nobody has said yet, which isn't the
   *  same as none), and how many it starts each night with (lib/dish-counts; null: not counted). */
  allergens: AllergenKey[]; allergensSet: boolean; dailyCount: number | null };

/** Is it a menu item at all (a refreshment that isn't archived or switched off)? */
export const isMenuItem = (i: any) => !!i && i.type === 'refreshment' && i.archived !== true && i.isActive !== false;

/** What the team (and the kitchen screen) sees of one item. `parts`: its recipe's ingredients as read (an ingredient
 *  not given isn't counted, so it never holds the item back). */
export function menuItemOf(id: string, i: any, parts: Map<string, any> = new Map()): MenuItem {
  const start = startingPrice(i); const stock = stockOf(i, id, parts);
  return {
    id, name: words(i.name, 80) || 'Item', section: words(i.category, 40) || 'Menu', words: words(i.description, 240) || null,
    price: Math.max(0, Math.round(num(i.price) * 100) / 100), from: start.from, startPrice: start.price, imageUrl: photoOf(i),
    choices: choiceGroups(i), soldOut: itemSoldOut(i), onMenu: i.showInConcierge !== false, membersOnly: i.isMembersOnly === true, inStock: stock.inStock,
    short: stock.short, canMake: stock.canMake, byRecipe: stock.byRecipe,
    makeSeconds: makeSecondsOf(i), holdMinutes: holdMinutesOf(i), batchSize: batchSizeOf(i),
    featured: i.boardFeatured === true, badge: i.boardBadge === 'new' || i.boardBadge === 'limited' ? i.boardBadge : null,
    calories: Number.isFinite(Number(i.calories)) && i.calories !== null && i.calories !== '' && Number(i.calories) >= 0 && Number(i.calories) <= 5000 ? Math.round(Number(i.calories)) : null,
    station: words(i.station, 24) || null, course: Number.isInteger(Number(i.course)) && i.course !== null && i.course !== '' && Number(i.course) >= 0 && Number(i.course) <= 9 ? Number(i.course) : null,
    allergens: itemAllergens(i), allergensSet: allergensKnown(i), dailyCount: dailyCountOf(i),
  };
}

/** The whole menu, by section then name. */
export async function readMenu(db: any, tenantId: string): Promise<MenuItem[]> {
  const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400).get();
  const all = snap.docs.map((d: any) => ({ id: d.id, i: d.data() || {} }));
  const items = all.filter((x: any) => isMenuItem(x.i));
  const parts = await readIngredients(db, tenantId, ingredientIds(items), new Map(all.map((x: any) => [x.id, x.i])));
  return items.map((x: any) => menuItemOf(x.id, x.i, parts))
    .sort((a: MenuItem, b: MenuItem) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
}

/** Recipe ingredients by id (those already read are used as they are). */
async function readIngredients(db: any, tenantId: string, ids: string[], have: Map<string, any> = new Map()): Promise<Map<string, any>> {
  const out = new Map(have);
  const need = ids.filter((id) => !out.has(id) && ID.test(id));
  // One read for many (the lane asks every few seconds), a hundred at a time.
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const snaps: any[] = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/inventory/${id}`))).catch((e: any) => { console.error('[menu] ingredients not read', e?.message); return []; });
    chunk.forEach((id, k) => { const d = snaps[k]?.data?.(); if (d) out.set(id, d); });
  }
  return out;
}

/** Whether each item can be made now (lib/menu-stock), its recipe's ingredients read (those in `have` are used as
 *  they are): for the lounge's menus and orders, which read the items themselves. */
export async function stockNow(db: any, tenantId: string, items: { id: string; i: any }[], have: Map<string, any> = new Map()): Promise<Map<string, MenuStock>> {
  const parts = await readIngredients(db, tenantId, ingredientIds(items), have);
  return new Map(items.map((x) => [x.id, stockOf(x.i, x.id, parts)]));
}

/** One item as the team sees it now, its ingredients read fresh (after a save, or a sold-out tap). */
export async function menuItemNow(db: any, tenantId: string, id: string, i: any): Promise<MenuItem> {
  const parts = await readIngredients(db, tenantId, recipeOf(i, id).map((l) => l.id));
  return menuItemOf(id, i, parts);
}

/** When something marked sold out comes back on its own: 4 in the morning, the business's time, so "sold out tonight"
 *  is never still hiding it the next day. */
export function soldOutUntil(tenant: any, now = new Date()): string {
  const tz = tenantTimeZone(tenant);
  // 4:00 on the business's own clock (right on a day the clocks change, too).
  const today4 = wallToUtc(todayIn(tz, now), 4, 0, tz).getTime();
  if (now.getTime() < today4) return new Date(today4).toISOString();
  return wallToUtc(addDays(todayIn(tz, now), 1), 4, 0, tz).toISOString();
}

/** Sold out (or back), in one step: the whole item, or one of its choices ("no oat milk tonight"). Who did it and when
 *  are kept with it, and it comes back on its own in the morning. Returns the item as it now is, or an error. */
export async function setSoldOut(db: any, tenantId: string, input: { itemId: unknown; groupId?: unknown; optionId?: unknown; out: unknown }, by: string)
  : Promise<{ ok: true; item: MenuItem } | { ok: false; error: string; status: number }> {
  const itemId = String(input.itemId || ''); if (!ID.test(itemId)) return { ok: false, error: 'Which item?', status: 400 };
  if (typeof input.out !== 'boolean') return { ok: false, error: 'Sold out, or back?', status: 400 };
  const out = input.out;
  const groupId = input.groupId ? String(input.groupId) : ''; const optionId = input.optionId ? String(input.optionId) : '';
  const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
  const nowIso = new Date().toISOString();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const until = out ? soldOutUntil(tenant) : null;
  const r: any = await db.runTransaction(async (tx: any) => {
    const i: any = (await tx.get(ref)).data();
    if (!isMenuItem(i)) return { ok: false, error: 'That isn’t on the menu.', status: 404 };
    if (!groupId) {
      const patch = { soldOut: out, soldOutAt: out ? nowIso : null, soldOutBy: out ? words(by, 60) || null : null, soldOutUntil: until };
      tx.set(ref, patch, { merge: true });
      return { ok: true, item: menuItemOf(itemId, { ...i, ...patch }), raw: { ...i, ...patch } };
    }
    const raw = Array.isArray(i.choices) ? i.choices : [];
    let found = false;
    const next = raw.map((g: any) => (String(g?.id) !== groupId ? g : { ...g, options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => {
      if (String(o?.id) !== optionId) return o; found = true; return { ...o, soldOut: out, soldOutUntil: until };
    }) }));
    if (!found) return { ok: false, error: 'That choice isn’t on this item.', status: 404 };
    tx.set(ref, { choices: next }, { merge: true });
    return { ok: true, item: menuItemOf(itemId, { ...i, choices: next }), raw: { ...i, choices: next } };
  });
  if (!r.ok) return r;
  // With its recipe's ingredients counted, as every menu shows it.
  return { ok: true, item: await menuItemNow(db, tenantId, itemId, r.raw).catch(() => r.item) };
}
