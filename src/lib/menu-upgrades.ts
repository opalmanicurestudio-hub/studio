// src/lib/menu-upgrades.ts — OFFERED AT THE END (design canvas "Food numbers": Offered at the end). What a guest is
// offered right after they add an item: the next size up, and up to two other menu items to go with it (a croissant with
// the coffee). The business picks them on the item (components/menu/ItemBuilder, step 3; saved through api/menu 'save'
// as the inventory item's `upgrades: { size, items }`), and the guest is asked once, on the sheet they just used (order
// ahead, app/order). Nothing here sets a price: the size up is the item's own size choice, priced by priceChoices
// (lib/menu-choices) like every pick, and something to go with it is its own line at its own price. Pure.
import { choiceGroups, type Picks } from '@/lib/menu-choices';

export type Upgrades = { size: boolean; items: string[] };
export type SizeUp = { groupId: string; fromId: string; from: string; toId: string; to: string; adds: number };
export type OfferKind = 'size' | 'item';
export const MAX_UPGRADE_ITEMS = 2;
const ID = /^[A-Za-z0-9_-]{1,160}$/;

/** As kept on an item: the size up on or off, and up to two other items, each once (never the item itself). */
export function upgradesOf(v: any, ownId?: string): Upgrades {
  const ids = Array.isArray(v?.items) ? v.items.map((x: unknown) => String(x ?? '')).filter((x: string) => ID.test(x) && x !== ownId) : [];
  return { size: v?.size === true, items: (Array.from(new Set(ids)) as string[]).slice(0, MAX_UPGRADE_ITEMS) };
}

/** The sizes it comes in: a "pick one" choice called Size (or Sizes, or Cup size). */
export const isSizeGroup = (g: { name: string; pick: string }) => g.pick === 'one' && /^\s*(cup\s+)?sizes?\s*$/i.test(g.name);

/** The next size up from the one picked: the next size listed after it (sizes are listed smallest first) that isn't sold
 *  out, when it costs more. Null with no size choice, none picked, or nothing bigger to have. */
export function nextSize(item: any, picks: Picks): SizeUp | null {
  const g = choiceGroups(item).find(isSizeGroup); if (!g) return null;
  const i = g.options.findIndex((o) => o.id === (picks?.[g.id] || [])[0]); if (i < 0) return null;
  const from = g.options[i]; const to = g.options.slice(i + 1).find((o) => !o.soldOut); if (!to) return null;
  const adds = Math.round((to.price - from.price) * 100) / 100;
  return adds > 0 ? { groupId: g.id, fromId: from.id, from: from.name, toId: to.id, to: to.name, adds } : null;
}

/** The picks with the size changed to the next one up. */
export const sizedUp = (picks: Picks, up: SizeUp): Picks => ({ ...picks, [up.groupId]: [up.toId] });

/** What a guest is offered right after adding `item` as picked: the size up, when it's on, and the items to go with it
 *  that can be had right now (found on the guest's menu, not sold out, not this item, and not in the order already). */
export function offersFor<T extends { id: string; soldOut?: boolean }>(item: { id: string; upgrades?: unknown; choices?: unknown }, picks: Picks,
  find: (id: string) => T | undefined, have: (id: string) => boolean = () => false): { size: SizeUp | null; items: T[] } {
  const u = upgradesOf(item.upgrades, item.id);
  const size = u.size ? nextSize(item, picks) : null;
  const items = u.items.map(find).filter((x): x is T => !!x && x.soldOut !== true && x.id !== item.id && !have(x.id));
  return { size, items };
}

/** A line the guest's page says was taken as an offer, kept as one only where the menu could have offered it (so a stale
 *  or made-up claim isn't counted; the page is what knows it was tapped as an offer): something to go with it only when
 *  another line's item offers it; a size up only when its item offers one and a size past the first was picked. Null
 *  otherwise. Prices never depend on it. */
export function offerOf(kind: unknown, item: { id: string; upgrades?: unknown; choices?: unknown }, picks: Picks, others: { id: string; upgrades?: unknown }[]): OfferKind | null {
  if (kind === 'item') return others.some((o) => o.id !== item.id && upgradesOf(o.upgrades, o.id).items.includes(item.id)) ? 'item' : null;
  if (kind !== 'size' || !upgradesOf(item.upgrades, item.id).size) return null;
  const g = choiceGroups(item).find(isSizeGroup); if (!g) return null;
  return g.options.findIndex((o) => o.id === (picks?.[g.id] || [])[0]) > 0 ? 'size' : null;
}
