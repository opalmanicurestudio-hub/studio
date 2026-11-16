// src/lib/prep-recipes.ts — PREP RECIPES: MADE IN BATCHES, USED BY THE PORTION (design canvas "Food numbers": Prep
// recipes). A sauce, a soup, a dough or a dressing the kitchen makes ahead: what goes into a batch, what a batch makes
// (2 L of aioli, 24 bowls of soup, 30 dough balls), how long it keeps and how long it takes. Pure: the same on the server
// and every screen.
//   It's kept in Inventory like any ingredient, counted in what a batch makes (one batch is one "container": its
//   size, or its uses, is what a batch makes), so a menu recipe uses it by the portion (30 ml of aioli in a burger) and
//   each burger sold takes 30 ml off the aioli on the shelf. Its eggs and oil come off when a batch is made
//   (lib/prep-recipes-server), never again as it's served.
//   What a batch costs is worked out from its recipe at today's ingredient costs (lib/food-cost); one portion carries
//   its share. A prep recipe can go into another (chicken stock into the soup), one level deep.
import { recipeOf } from '@/lib/menu-stock';
import { canonUnit } from '@/lib/kitchen-units';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export type PrepInfo = { makes: number; unit: string; keepsDays: number | null; minutes: number | null; lastMadeAt: string | null; lastMadeBy: string | null };
export const MAX_KEEPS_DAYS = 60, MAX_MINUTES = 600, MAX_MAKES = 100000;
/** Words a batch can be counted in when it isn't a weight or a volume. */
export const PREP_COUNTS = ['portions', 'bowls', 'balls', 'pieces', 'loaves', 'trays', 'each'];

/** A prep recipe's batch: what it makes and how long it keeps, or null when the item isn't one. */
export function prepOf(x: any): PrepInfo | null {
  const p = x?.prep; if (!p || typeof p !== 'object') return null;
  const makes = num(p.makes); if (!(makes > 0)) return null;
  const keeps = Math.floor(num(p.keepsDays)); const mins = Math.floor(num(p.minutes));
  return { makes: Math.round(makes * 1000) / 1000, unit: words(p.unit, 20) || 'portions', keepsDays: keeps > 0 ? Math.min(MAX_KEEPS_DAYS, keeps) : null, minutes: mins > 0 ? Math.min(MAX_MINUTES, mins) : null,
    lastMadeAt: typeof p.lastMadeAt === 'string' ? p.lastMadeAt : null, lastMadeBy: typeof p.lastMadeBy === 'string' ? words(p.lastMadeBy, 60) : null };
}
/** A prep recipe in use: one with a batch and a recipe, not put away. */
export const isPrep = (x: any, id?: string) => !!prepOf(x) && recipeOf(x, id).length > 0 && x?.archived !== true && x?.status !== 'archived';

/** How it's counted in Inventory: by amount (ml, g, L...) when a batch is a weight or volume, else by uses (portions). */
export function prepStockFields(makes: number, unit: string): Record<string, any> {
  const c = canonUnit(unit);
  return c ? { costingMethod: 'size', size: makes, unit: c, useUnit: null, estimatedUses: null } : { costingMethod: 'uses', estimatedUses: makes, useUnit: words(unit, 20) || 'portions', size: null, unit: null };
}

/** How many batches to make: enough for what's needed, less what's on the shelf (never a part batch). */
export function batchesFor(need: number, have: number | null, makes: number): number {
  if (!(makes > 0) || !(need > 0)) return 0;
  return Math.max(0, Math.ceil((need - Math.max(0, have || 0)) / makes - 1e-9));
}

/** The day what was made last is good until (its keeping days from when it was made), as a time; null when not known. */
export function goodUntil(p: PrepInfo | null): number | null {
  if (!p?.lastMadeAt || !p.keepsDays) return null;
  const at = Date.parse(p.lastMadeAt); return Number.isFinite(at) ? at + p.keepsDays * 864e5 : null;
}
/** Past its keeping days: what's left was made too long ago to serve. */
export const pastKeeping = (p: PrepInfo | null, now = Date.now()) => { const u = goodUntil(p); return u !== null && u < now; };

/** A batch in words: "Makes 2 L", "Makes 24 bowls". */
export function makesWords(p: Pick<PrepInfo, 'makes' | 'unit'>): string {
  const v = (Math.round(p.makes * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `Makes ${v} ${p.unit}`;
}
