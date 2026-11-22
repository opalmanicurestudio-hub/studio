// src/lib/register-tiles.ts — THE REGISTER'S MENU TILES (pure; design board "Tiles at the register", look B: photos;
// components/pos/RegisterTiles, on the counter and the drive-thru lane screen). Every tile, whichever look:
// - Most sold now opens first: what sells at this hour, from the business's own sales (menuSales/{day}, counted by hour
//   as orders are sent: lib/counter-server soldCounts), so the morning rush sees coffee and lunch sees sandwiches. Every
//   location's sales together (each in its own local hour): one menu, and a busy hour is much the same at each.
// - Tap to add, tap again for one more; the count shows on the tile. Press and hold for every choice and a note.
// - Find: a few letters, or the number guests order by, from any section (a scanner still scans).
// - Sold out, and "3 left" once few can be made (lib/menu-stock canMake), so nobody rings in what isn't there.
// - Big or compact: bigger tiles for a phone or a busy rush, more per screen on a large tablet (kept on the device).

/** What a tile needs of a menu item (lib/menu-server MenuItem, with its price now and when it's off: api/counter 'lane'). */
export type TileItem = {
  id: string; name: string; section: string; imageUrl: string | null; price: number; from: boolean; startPrice: number;
  priceNow?: number; happy?: boolean; off?: string | null; soldOut: boolean; inStock: boolean; short?: string | null;
  canMake: number | null; byWeight?: string | null; combo?: boolean; choices: unknown[]; number?: number | null;
};

/** What an item costs right now ("from" its cheapest choices), happy hour included. */
export const priceOf = (m: Pick<TileItem, 'price' | 'from' | 'startPrice' | 'priceNow' | 'happy'>) => { const base = m.happy && typeof m.priceNow === 'number' ? m.priceNow : m.price; return Math.max(0, base + (m.from ? m.startPrice - m.price : 0)); };
/** Its price before happy hour. */
export const fullOf = (m: Pick<TileItem, 'price' | 'from' | 'startPrice'>) => (m.from ? m.startPrice : m.price);

/** "3 left": shown on a tile once this few or fewer can be made. */
export const LEFT_AT = 5;
/** How many can still be made, when that's few (null: plenty, not counted, or none at all, which is sold out). */
export const leftOf = (m: Pick<TileItem, 'canMake'>): number | null => (typeof m.canMake === 'number' && m.canMake > 0 && m.canMake <= LEFT_AT ? Math.floor(m.canMake) : null);

/** The first tab, and how it's told apart from a section of the menu that happens to have the same name. */
export const MOST_TAB = 'Most sold now';
export const MOST_ID = '__most_sold_now__';
/** Shown once this many items on the menu now have sold at this hour. */
export const MOST_MIN = 3;
/** Up to this many: a screen of tiles. */
export const MOST_MAX = 9;
/** Days of sales it's worked out from. */
export const MOST_DAYS = 21;
/** The count of an item sold in an hour of the business's day, kept on that day's menuSales (`hour`: 0 to 23). */
export const hourKey = (hour: number, id: string) => `h${String(((Math.floor(hour) % 24) + 24) % 24).padStart(2, '0')}_${id}`;

/** What sells at this hour (`hour`, in the business's time), from the days' menuSales counts: this hour and the next,
 *  added up over the days, among items on the menu (`onMenu`), each sold at least twice. Until there's enough counted by
 *  hour (a few dozen sold), the days' best sellers whatever the hour. Most sold first. */
export function mostSoldOf(days: Record<string, unknown>[], hour: number, onMenu: Set<string>, max = MOST_MAX): string[] {
  const sum = (keep: (k: string) => string | null) => {
    const by = new Map<string, number>();
    for (const d of days) for (const [k, v] of Object.entries(d || {})) { const id = keep(k); const n = Number(v); if (id && onMenu.has(id) && Number.isFinite(n) && n > 0) by.set(id, (by.get(id) || 0) + n); }
    return by;
  };
  const hours = [hourKey(hour, ''), hourKey(hour + 1, '')];
  let by = sum((k) => { const p = hours.find((h) => k.startsWith(h)); return p ? k.slice(p.length) : null; });
  if (Array.from(by.values()).reduce((s, n) => s + n, 0) < 24) by = sum((k) => (k.startsWith('n_') ? k.slice(2) : null));
  return Array.from(by.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(([id]) => id);
}

/** The words of a name or of what was typed: lowercased, accents typed or not, in any script. */
const wordsOf = (v: string) => v.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Find: items whose name has a word starting with each word typed ("oat la" finds Oat latte), or the number guests
 *  order by ("3"), from every section, in the menu's order. */
export function findTiles<T extends Pick<TileItem, 'name' | 'number'>>(items: T[], q: string): T[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  return items.filter((m) => {
    if (words.length === 1 && /^\d+$/.test(words[0]) && m.number != null && String(m.number) === words[0]) return true;
    const own = wordsOf(m.name);
    return words.every((w) => own.some((x) => x.startsWith(w)));
  });
}

/** Pressed this long, a tile opens its choices and a note instead of adding it. */
export const HOLD_MS = 450;

/** How the business arranges its tiles (tenants/{t}.registerTiles; design board "Arrange tiles", A: a list on the Menu
 *  page; components/menu/TilesCard): photo tiles or names only; the order the crew reaches for them (item ids; any not
 *  in it follow in the menu's order); favorites pinned to lead Most sold now and their section; and items hidden from
 *  the tiles (still on the menu, the kiosk and online, and still found by Find or a scan). The same on every screen. */
export type TileSetup = { look: 'photos' | 'names'; order: string[]; pinned: string[]; hidden: string[] };
export const PIN_MAX = 6;
const IDS = (v: unknown, max: number) => (Array.isArray(v) ? Array.from(new Set(v.map(String).filter((x) => /^[A-Za-z0-9_-]{1,128}$/.test(x)))).slice(0, max) : []);
/** The business's, as kept (nothing set: photos when there are some, the menu's order, nothing pinned or hidden). */
export function tileSetupOf(tenant: any): TileSetup {
  const t = tenant?.registerTiles || {};
  return { look: t.look === 'names' ? 'names' : 'photos', order: IDS(t.order, 1000), pinned: IDS(t.pinned, PIN_MAX), hidden: IDS(t.hidden, 1000) };
}
/** A change from a manager, among the menu's items (`ids`): kept to those items, at most PIN_MAX pinned, and an item
 *  pinned or hidden, never both (the later word wins: pinning shows it, hiding unpins it). */
export function cleanTileSetup(b: any, ids: Set<string>, was: TileSetup): TileSetup | { error: string } {
  if (!b || typeof b !== 'object') return { error: 'Nothing to save.' };
  if (b.look !== undefined && b.look !== 'photos' && b.look !== 'names') return { error: 'Photo tiles, or names only.' };
  const keep = (v: unknown, max: number) => IDS(v, max).filter((x) => ids.has(x));
  const out: TileSetup = { look: b.look ?? was.look, order: b.order !== undefined ? keep(b.order, 1000) : was.order.filter((x) => ids.has(x)),
    pinned: b.pinned !== undefined ? keep(b.pinned, 1000) : was.pinned.filter((x) => ids.has(x)), hidden: b.hidden !== undefined ? keep(b.hidden, 1000) : was.hidden.filter((x) => ids.has(x)) };
  if (out.pinned.length > PIN_MAX) return { error: `Up to ${PIN_MAX} pinned. Unpin one first.` };
  if (b.pinned !== undefined) out.hidden = out.hidden.filter((x) => !out.pinned.includes(x));
  else out.pinned = out.pinned.filter((x) => !out.hidden.includes(x));
  return out;
}
/** The tiles in the business's order: hidden ones left out, pinned ones first, then the order set, then the rest as on
 *  the menu. */
export function arranged<T extends { id: string }>(items: T[], setup: TileSetup | null | undefined): T[] {
  if (!setup) return items;
  const hid = new Set(setup.hidden); const pin = new Map(setup.pinned.map((id, i) => [id, i])); const at = new Map(setup.order.map((id, i) => [id, i]));
  const rank = (m: T, i: number) => [pin.has(m.id) ? 0 : 1, pin.get(m.id) ?? at.get(m.id) ?? 1e6, i] as const;
  return items.map((m, i) => ({ m, k: rank(m, i) })).filter((x) => !hid.has(x.m.id)).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]).map((x) => x.m);
}
/** Most sold now with the favorites: those pinned first, then what sells at this hour, a screen of them at most. */
export const mostWithPinned = (most: string[] | null | undefined, setup: TileSetup | null | undefined): string[] => {
  const pinned = setup?.pinned || []; const hid = new Set(setup?.hidden || []);
  return Array.from(new Set([...pinned, ...(most || []).filter((id) => !hid.has(id))])).slice(0, MOST_MAX);
};

// Arranging (the Register tiles card on the Menu page, and Arrange tiles on the register itself): one set of rules.
/** A section's items as they'll show: pinned first (in pin order), then the order set, then as on the menu; hidden ones
 *  too, in their place, to bring back. */
export function sectionRows<T extends { id: string; section: string }>(items: T[], s: TileSetup, section: string): T[] {
  const pin = new Map(s.pinned.map((id, i) => [id, i])); const at = new Map(s.order.map((id, i) => [id, i]));
  return items.map((m, i) => ({ m, i })).filter((x) => x.m.section === section)
    .sort((a, b) => (pin.has(a.m.id) ? 0 : 1) - (pin.has(b.m.id) ? 0 : 1) || (pin.get(a.m.id) ?? at.get(a.m.id) ?? 1e6) - (pin.get(b.m.id) ?? at.get(b.m.id) ?? 1e6) || a.i - b.i).map((x) => x.m);
}
/** The ids a tile moves among: pinned ones among the section's pins, the rest among the rest. */
export const groupOf = (rows: { id: string }[], s: TileSetup, id: string): string[] => { const pinned = new Set(s.pinned); return rows.filter((m) => pinned.has(m.id) === pinned.has(id)).map((m) => m.id); };
/** One tile moved to place `to` in its group (`rows`: the section as it shows): the change to save, or null for none.
 *  A pinned one keeps its place among every section's pins (just before the pin now after it, or after the one now
 *  before it); the rest go in the order, the section's together. */
export function moveChange(s: TileSetup, rows: { id: string }[], id: string, to: number): Partial<TileSetup> | null {
  const group = groupOf(rows, s, id); const from = group.indexOf(id); const j = Math.max(0, Math.min(group.length - 1, to));
  if (from < 0 || from === j) return null;
  const next = [...group]; next.splice(from, 1); next.splice(j, 0, id);
  if (s.pinned.includes(id)) {
    const all = s.pinned.filter((x) => x !== id); const after = next[j + 1], before = next[j - 1];
    const at = after !== undefined && all.includes(after) ? all.indexOf(after) : before !== undefined && all.includes(before) ? all.indexOf(before) + 1 : all.length;
    all.splice(at, 0, id); return { pinned: all };
  }
  const rest = new Set(next); return { order: [...s.order.filter((x) => !rest.has(x)), ...next] };
}
/** Pinned, or unpinned: the change to save (pinning shows a hidden one), or why it can't. */
export function pinChange(s: TileSetup, id: string): Partial<TileSetup> | { error: string } {
  if (s.pinned.includes(id)) return { pinned: s.pinned.filter((x) => x !== id) };
  if (s.pinned.length >= PIN_MAX) return { error: `Up to ${PIN_MAX} pinned. Unpin one first.` };
  return { pinned: [...s.pinned, id], hidden: s.hidden.filter((x) => x !== id) };
}
/** Hidden from the tiles, or back on them: the change to save (hiding unpins it). */
export const hideChange = (s: TileSetup, id: string): Partial<TileSetup> => (s.hidden.includes(id) ? { hidden: s.hidden.filter((x) => x !== id) } : { hidden: [...s.hidden, id], pinned: s.pinned.filter((x) => x !== id) });

/** Tile size, kept on the device. */
export type TileSize = 'big' | 'compact';
export const TILE_SIZE_KEY = 'cf.register.tileSize';
export const sizeOf = (v: unknown): TileSize => (v === 'compact' ? 'compact' : 'big');
