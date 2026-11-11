// src/lib/menu-server.ts — THE MENU, read and changed on the server (api/menu for the team, api/kitchen for the kitchen
// screen's one-tap "Sold out"). A menu item is an inventory item of the refreshment kind; what guests see of it is its
// name, section, words, price, picture and choices (lib/menu-choices), never its cost or supplier.
import { choiceGroups, itemSoldOut, startingPrice, type ChoiceGroup } from '@/lib/menu-choices';
import { makeSecondsOf, holdMinutesOf } from '@/lib/counter-orders';
import { batchSizeOf } from '@/lib/holding';
import { addDays, tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type MenuItem = { id: string; name: string; section: string; words: string | null; price: number; from: boolean; startPrice: number; imageUrl: string | null; choices: ChoiceGroup[];
  soldOut: boolean; onMenu: boolean; membersOnly: boolean; inStock: boolean;
  /** Kitchen timing (lib/counter-orders, lib/holding): how long it takes to make, and how long a batch may be held (0: not held). */
  makeSeconds: number; holdMinutes: number; batchSize: number };

/** Is it a menu item at all (a refreshment that isn't archived or switched off)? */
export const isMenuItem = (i: any) => !!i && i.type === 'refreshment' && i.archived !== true && i.isActive !== false;

/** What the team (and the kitchen screen) sees of one item. */
export function menuItemOf(id: string, i: any): MenuItem {
  const start = startingPrice(i);
  return {
    id, name: words(i.name, 80) || 'Item', section: words(i.category, 40) || 'Menu', words: words(i.description, 240) || null,
    price: Math.max(0, Math.round(num(i.price) * 100) / 100), from: start.from, startPrice: start.price, imageUrl: typeof i.imageUrl === 'string' && /^https:\/\//.test(i.imageUrl) ? i.imageUrl : null,
    choices: choiceGroups(i), soldOut: itemSoldOut(i), onMenu: i.showInConcierge !== false, membersOnly: i.isMembersOnly === true, inStock: num(i.totalStock) > 0,
    makeSeconds: makeSecondsOf(i), holdMinutes: holdMinutesOf(i), batchSize: batchSizeOf(i),
  };
}

/** The whole menu, by section then name. */
export async function readMenu(db: any, tenantId: string): Promise<MenuItem[]> {
  const snap = await db.collection(`tenants/${tenantId}/inventory`).where('type', '==', 'refreshment').limit(400).get();
  return snap.docs.map((d: any) => ({ id: d.id, i: d.data() || {} })).filter((x: any) => isMenuItem(x.i)).map((x: any) => menuItemOf(x.id, x.i))
    .sort((a: MenuItem, b: MenuItem) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
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
  return db.runTransaction(async (tx: any) => {
    const i: any = (await tx.get(ref)).data();
    if (!isMenuItem(i)) return { ok: false, error: 'That isn’t on the menu.', status: 404 };
    if (!groupId) {
      const patch = { soldOut: out, soldOutAt: out ? nowIso : null, soldOutBy: out ? words(by, 60) || null : null, soldOutUntil: until };
      tx.set(ref, patch, { merge: true });
      return { ok: true, item: menuItemOf(itemId, { ...i, ...patch }) };
    }
    const raw = Array.isArray(i.choices) ? i.choices : [];
    let found = false;
    const next = raw.map((g: any) => (String(g?.id) !== groupId ? g : { ...g, options: (Array.isArray(g?.options) ? g.options : []).map((o: any) => {
      if (String(o?.id) !== optionId) return o; found = true; return { ...o, soldOut: out, soldOutUntil: until };
    }) }));
    if (!found) return { ok: false, error: 'That choice isn’t on this item.', status: 404 };
    tx.set(ref, { choices: next }, { merge: true });
    return { ok: true, item: menuItemOf(itemId, { ...i, choices: next }) };
  });
}
