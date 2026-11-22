// src/lib/menu-server.ts — THE MENU, read and changed on the server (api/menu for the team, api/kitchen for the kitchen
// screen's one-tap "Sold out"). A menu item is an inventory item of the refreshment kind; what guests see of it is its
// name, section, words, price, picture and choices (lib/menu-choices), never its cost or supplier. Whether it can be made
// now comes from its recipe's ingredients when it has one, else its own count (lib/menu-stock).
import { happyPriceOf } from '@/lib/menu-time';
import { choiceGroups, outPatch, outWhere, startingPrice, type ChoiceGroup } from '@/lib/menu-choices';
import { makeSecondsOf, holdMinutesOf, photoOf } from '@/lib/counter-orders';
import { batchSizeOf } from '@/lib/holding';
import { addDays, tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';
import { offeredOnMenu, stockOf, ingredientIds, recipeOf, type MenuStock } from '@/lib/menu-stock';
import { allergensKnown, cleanKeys, itemAllergens, type AllergenKey } from '@/lib/allergens';
import { dailyCountOf } from '@/lib/dish-counts';
import { alsoAtOf, type AlsoAt } from '@/lib/two-stations';
import { upgradesOf, type Upgrades } from '@/lib/menu-upgrades';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

import { byWeightOf, type WeightUnit } from '@/lib/menu-weight';
export type MenuItem = { id: string; name: string; section: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; choices: ChoiceGroup[];
  soldOut: boolean; onMenu: boolean; membersOnly: boolean; inStock: boolean;
  /** With more than one location, read for one (`here`): sold out at this location only, or everywhere. */
  outWhere?: 'here' | 'everywhere';
  /** The delivery apps the counter has marked it sold out on (lib/app-orders appSoldOutTodo), and when. */
  appOut?: Record<string, string>;
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
  allergens: AllergenKey[]; allergensSet: boolean; dailyCount: number | null;
  /** From a starter menu (lib/food-starters): what it likely contains, until someone says (never used as what it does
   *  contain), ingredients the business has that its recipe couldn't use as they're measured, and whether it still
   *  needs its first price. */
  allergensLikely: AllergenKey[]; recipeGaps: string[]; starter: boolean;
  /** Its recipe's ingredients by name, in the recipe's order (empty: no recipe), for "what's in it?" (lib/klair-menu). */
  recipe: string[] 
  dayparts: string[]; happyPrice: number | null; combo: boolean; comboParts: string[];
  /** Also made at another station, as a part of its own (lib/two-stations): "the fries" at the fryer. */
  alsoAt: AlsoAt[];
  /** Offered at the end (lib/menu-upgrades): the next size up, and up to two items to go with it. */
  upgrades: Upgrades;
  /** Sold by weight (lib/menu-weight): the unit its price is per, or null. Weighed at the counter or the window only. */
  byWeight: WeightUnit | null;
};

/** Is it a menu item at all (a refreshment that isn't archived or switched off)? */
export const isMenuItem = (i: any) => !!i && i.type === 'refreshment' && i.archived !== true && i.isActive !== false;

/** What the team (and the kitchen screen) sees of one item. `parts`: its recipe's ingredients as read (an ingredient
 *  not given isn't counted, so it never holds the item back). */
export function menuItemOf(id: string, i: any, parts: Map<string, any> = new Map(), here: string | null = null): MenuItem {
  const start = startingPrice(i); const stock = stockOf(i, id, parts); const w = outWhere(i, here);
  return {
    id, name: words(i.name, 80) || 'Item', section: words(i.category, 40) || 'Menu', words: words(i.description, 240) || null,
    price: Math.max(0, Math.round(num(i.price) * 100) / 100), from: start.from, startPrice: start.price, imageUrl: photoOf(i),
    choices: choiceGroups(i, true, here), soldOut: w !== null, ...(w && here ? { outWhere: w } : {}), onMenu: offeredOnMenu(i), membersOnly: i.isMembersOnly === true, inStock: stock.inStock,
    appOut: Object.fromEntries(Object.entries(i.appOut && typeof i.appOut === 'object' ? i.appOut : {}).filter(([k, v]) => /^[a-z]{2,12}$/.test(k) && typeof v === 'string' && v)) as Record<string, string>,
    short: stock.short, canMake: stock.canMake, byRecipe: stock.byRecipe,
    makeSeconds: makeSecondsOf(i), holdMinutes: holdMinutesOf(i), batchSize: batchSizeOf(i),
    featured: i.boardFeatured === true, badge: i.boardBadge === 'new' || i.boardBadge === 'limited' ? i.boardBadge : null,
    calories: Number.isFinite(Number(i.calories)) && i.calories !== null && i.calories !== '' && Number(i.calories) >= 0 && Number(i.calories) <= 5000 ? Math.round(Number(i.calories)) : null,
    station: words(i.station, 24) || null, course: Number.isInteger(Number(i.course)) && i.course !== null && i.course !== '' && Number(i.course) >= 0 && Number(i.course) <= 9 ? Number(i.course) : null,
    allergens: itemAllergens(i), allergensSet: allergensKnown(i), dailyCount: dailyCountOf(i),
    allergensLikely: allergensKnown(i) ? [] : cleanKeys(Array.isArray(i.allergensLikely) ? i.allergensLikely : []),
    recipeGaps: (Array.isArray(i.recipeGaps) ? i.recipeGaps : []).map((g: unknown) => words(g, 60)).filter(Boolean).slice(0, 10), starter: i.createdVia === 'food-starter',
    recipe: Array.from(new Set((Array.isArray(i.formula) ? i.formula : []).map((f: any) => words(f?.name, 40)).filter(Boolean))).slice(0, 12) as string[],
    // Its menus by time of day, happy-hour price, and as a combo the parts it always has (lib/menu-time, lib/counter-orders).
    dayparts: Array.isArray(i.dayparts) ? i.dayparts.map(String).slice(0, 6) : [], happyPrice: happyPriceOf(i),
    combo: i.combo === true, comboParts: i.combo === true && Array.isArray(i.comboParts) ? i.comboParts.map((p: any) => String(p?.itemId || '')).filter(Boolean).slice(0, 6) : [],
    alsoAt: i.combo === true ? [] : alsoAtOf(i), upgrades: upgradesOf(i.upgrades, id), byWeight: i.combo === true ? null : byWeightOf(i),
  };
}

/** The whole menu, by section then name. */
/** `here` (with more than one location): as that location sees it, its own sold out too (lib/menu-choices outWhere). */
export async function readMenu(db: any, tenantId: string, here: string | null = null): Promise<MenuItem[]> {
  const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400).get();
  const all = snap.docs.map((d: any) => ({ id: d.id, i: d.data() || {} }));
  const items = all.filter((x: any) => isMenuItem(x.i));
  const parts = await readIngredients(db, tenantId, ingredientIds(items), new Map(all.map((x: any) => [x.id, x.i])));
  const menu: MenuItem[] = items.map((x: any) => menuItemOf(x.id, x.i, parts, here));
  // A combo can be made while each part it always has can (on the menu, not sold out, in stock); a choice of an item
  // that can't be made right now shows as sold out.
  const byId = new Map(menu.map((m) => [m.id, m]));
  const out = (id: string) => { const p = byId.get(id); return !p || p.soldOut || !p.inStock; };
  for (const m of menu) {
    if (!m.combo) continue;
    const gone = m.comboParts.find(out);
    if (gone) { m.inStock = false; m.short = byId.get(gone)?.name || 'one of its parts'; }
    m.choices = m.choices.map((g) => ({ ...g, options: g.options.map((o) => (o.itemId && out(o.itemId) ? { ...o, soldOut: true } : o)) }));
  }
  return menu.sort((a: MenuItem, b: MenuItem) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
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
export async function menuItemNow(db: any, tenantId: string, id: string, i: any, here: string | null = null): Promise<MenuItem> {
  const parts = await readIngredients(db, tenantId, recipeOf(i, id).map((l) => l.id));
  return menuItemOf(id, i, parts, here);
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
export async function setSoldOut(db: any, tenantId: string, input: { itemId: unknown; groupId?: unknown; optionId?: unknown; out: unknown; where?: unknown }, by: string, here: string | null = null)
  : Promise<{ ok: true; item: MenuItem } | { ok: false; error: string; status: number }> {
  const itemId = String(input.itemId || ''); if (!ID.test(itemId)) return { ok: false, error: 'Which item?', status: 400 };
  if (typeof input.out !== 'boolean') return { ok: false, error: 'Sold out, or back?', status: 400 };
  const out = input.out;
  const groupId = input.groupId ? String(input.groupId) : ''; const optionId = input.optionId ? String(input.optionId) : '';
  const ref = db.doc(`tenants/${tenantId}/inventory/${itemId}`);
  const nowIso = new Date().toISOString();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  // With more than one location (`here`, a screen's own, lib/here-server): at that location only unless it's for every
  // location (`where: 'everywhere'`); it comes back the next morning on that location's own clock.
  const { bizLocationsOf, zonedFor } = await import('@/lib/here-server');
  const locs = here ? await bizLocationsOf(db, tenantId) : [];
  const loc = here ? locs.find((l) => l.id === here) || null : null;
  const everywhere = !loc || input.where === 'everywhere';
  const until = out ? soldOutUntil(everywhere ? tenant : zonedFor(tenant, loc)) : null;
  const sw = { out, here: loc ? loc.id : null, everywhere, until, by: out ? words(by, 60) || null : null, others: locs.map((l) => l.id) };
  const r: any = await db.runTransaction(async (tx: any) => {
    const i: any = (await tx.get(ref)).data();
    if (!isMenuItem(i)) return { ok: false, error: 'That isn’t on the menu.', status: 404 };
    if (!groupId) {
      const p0 = outPatch(i, sw);
      const patch = { ...p0, ...(out && everywhere ? { soldOutAt: nowIso } : !out && everywhere ? { soldOutAt: null } : {}) };
      // (Each location's own, `outAt`, replaced whole: one switched back is gone, not kept by a merge.)
      tx.update(ref, patch);
      return { ok: true, raw: { ...i, ...patch } };
    }
    const raw = Array.isArray(i.choices) ? i.choices : [];
    let found = false;
    const next = raw.map((g: any) => (String(g?.id) !== groupId ? g : { ...g, options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => {
      if (String(o?.id) !== optionId) return o; found = true; const { soldOutBy: _by, ...p1 } = outPatch(o, sw); return { ...o, ...p1 };
    }) }));
    if (!found) return { ok: false, error: 'That choice isn’t on this item.', status: 404 };
    tx.set(ref, { choices: next }, { merge: true });
    return { ok: true, raw: { ...i, choices: next } };
  });
  if (!r.ok) return r;
  r.item = menuItemOf(itemId, r.raw, new Map(), sw.here);
  // A choice from a set (lib/choice-sets): sold out on every item with that set, not this one alone.
  const linked = groupId ? (Array.isArray(r.raw.choices) ? r.raw.choices : []).find((g: any) => String(g?.id) === groupId && g?.setId) : null;
  if (linked) {
    // The set's own id for this option (the item may keep its own id for it: lib/choice-sets groupOfSet).
    const opt = (Array.isArray(linked.options) ? linked.options : []).find((o: any) => String(o?.id) === optionId);
    const { setOptionSoldOut } = await import('@/lib/choice-sets-server');
    await setOptionSoldOut(db, tenantId, String(linked.setId), String(opt?.setOption || optionId), out, by, sw).catch((e: any) => console.error('[menu] set sold out', e?.message || e));
    r.raw = (await ref.get()).data() || r.raw;
  }
  // With its recipe's ingredients counted, as every menu shows it.
  return { ok: true, item: await menuItemNow(db, tenantId, itemId, r.raw, sw.here).catch(() => r.item) };
}
