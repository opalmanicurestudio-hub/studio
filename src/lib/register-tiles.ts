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

/** Tile size, kept on the device. */
export type TileSize = 'big' | 'compact';
export const TILE_SIZE_KEY = 'cf.register.tileSize';
export const sizeOf = (v: unknown): TileSize => (v === 'compact' ? 'compact' : 'big');
