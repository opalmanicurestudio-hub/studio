// src/lib/barback.ts — THE BARBACK, the rules (design canvas "Dish and barback"; lib/barback-server, api/back, the screen
// at /barback). Pure.
// - What the bar pours from: the ingredients of the drinks the bar makes (lib/table-service stationOfItem, lib/menu-stock
//   recipeOf) that are counted by the bottle or the keg (Inventory's "by amount" or "by uses"). For each: what's left in
//   the one that's open (Inventory's open container), how many full ones are in stock, a usual pour (the middle of the
//   amounts its recipes use), and what went in the last hour.
// - Running low: the open one has a few pours left, or will run out within 20 minutes at the last hour's pace. With full
//   ones in stock, "get the next one ready"; with none, it's the last of it (the managers hear, once a day). Nothing
//   left at all, by the count: out.
// - Changed it: the barback says the keg or bottle was changed. What the count still had in the old one, when it's a
//   little (a quarter of one or less), was lost along the way (foam, spills, a heavy hand) and is logged as such, so the
//   next count and food cost agree. When the count still had a lot, it's left alone: the count likely already moved on
//   to the next one, and a stock count settles it either way.
//   A change tapped by mistake can be undone for a few minutes (lib/barback-server undoChange).

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = (s: unknown) => String(s || '').trim().toLowerCase();

export const LOW_POURS = 4;
export const SOON_MIN = 20;
export const LOSS_SHARE = 0.25;

export type BarPart = { id: string; name: string; kind: 'keg' | 'bottle' | 'other'; unit: string; size: number; open: number; full: number; pour: number; usedLastHour: number };
export type Low = BarPart & { state: 'out' | 'last' | 'change'; poursLeft: number; minutesLeft: number | null };

/** How much one container holds, by how Inventory counts it (null: not counted by the bottle or keg). */
function containerOf(it: any): { size: number; open: number; unit: string } | null {
  if (it?.costingMethod === 'size' && num(it.size) > 0) return { size: num(it.size), open: Math.max(0, num(it.partialContainerSize)), unit: clip(it.unit, 10) || 'ml' };
  if (it?.costingMethod === 'uses' && num(it.estimatedUses) > 0) return { size: num(it.estimatedUses), open: Math.max(0, num(it.partialContainerUses)), unit: clip(it.useUnit, 10) || 'uses' };
  return null;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** A keg by its name, or by holding a keg's worth (a sixth barrel and up). */
export function kindOf(name: string, c: { size: number; unit: string }, uses: boolean): BarPart['kind'] {
  if (/\bkegs?\b|\bbarrel\b|\bon tap\b|\bdraft\b|\bdraught\b/i.test(name)) return 'keg';
  if (uses) return 'other';
  const u = key(c.unit);
  if ((u === 'oz' || u === 'fl oz') && c.size >= 600) return 'keg';
  if (u === 'ml' && c.size >= 18000) return 'keg';
  if (u === 'l' && c.size >= 18) return 'keg';
  return 'bottle';
}

/** What the bar pours from. `menu`: the menu's items as stored; `parts`: their ingredients by id; `stationOf`: where
 *  an item is made; `bar`: the bar's station. */
export function barParts(menu: { id: string; data: any }[], parts: Map<string, any>, stationOf: (item: any) => string, bar: string, recipeOf: (item: any, id: string) => { id: string; quantityUsed: number }[]): BarPart[] {
  const pours = new Map<string, number[]>();
  for (const m of menu) {
    if (key(stationOf(m.data)) !== key(bar)) continue;
    for (const l of recipeOf(m.data, m.id)) { const a = pours.get(l.id) || []; a.push(l.quantityUsed); pours.set(l.id, a); }
  }
  const out: BarPart[] = [];
  for (const [id, qs] of Array.from(pours)) {
    const it = parts.get(id); if (!it || it.archived === true || it.status === 'archived' || it.countStock === false) continue;
    const c = containerOf(it); if (!c) continue;
    const name = clip(it.name, 60) || 'Ingredient';
    out.push({ id, name, kind: kindOf(name, c, it.costingMethod === 'uses'), unit: c.unit, size: c.size, open: c.open, full: Math.max(0, Math.floor(num(it.totalStock))), pour: median(qs.filter((q) => q > 0)) || 1, usedLastHour: 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The ones running low, the most urgent first: out, then the last of it, then the ones to change soon. */
export function runningLow(parts: BarPart[]): Low[] {
  const out: Low[] = [];
  for (const p of parts) {
    const all = p.open + p.full * p.size;
    const poursLeft = Math.floor((p.open + 1e-9) / p.pour);
    const minutesLeft = p.usedLastHour > 0 ? Math.floor((p.open / p.usedLastHour) * 60) : null;
    const state: Low['state'] | null = all < p.pour ? 'out'
      : p.full === 0 && (poursLeft <= LOW_POURS || (minutesLeft !== null && minutesLeft <= SOON_MIN)) ? 'last'
      : poursLeft <= LOW_POURS || (minutesLeft !== null && minutesLeft <= SOON_MIN) ? 'change' : null;
    if (state) out.push({ ...p, state, poursLeft, minutesLeft });
  }
  const rank = { out: 0, last: 1, change: 2 } as const;
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.minutesLeft ?? 1e9) - (b.minutesLeft ?? 1e9) || a.poursLeft - b.poursLeft);
}

/** "pints" for a keg poured by the pint, else "pours" ("drinks’ worth" for something counted by uses). */
export function pourWord(p: Pick<BarPart, 'kind' | 'unit' | 'pour'>, n: number): string {
  const u = key(p.unit);
  if (p.kind === 'keg' && (u === 'oz' || u === 'fl oz') && p.pour >= 14 && p.pour <= 20) return n === 1 ? 'pint' : 'pints';
  if (p.kind === 'other') return n === 1 ? 'drink’s worth' : 'drinks’ worth';
  return n === 1 ? 'pour' : 'pours';
}
/** The line under a running-low part: what's left in the open one, the pace, and what's in stock. */
export function lowWords(p: Low): string {
  if (p.state === 'out') return 'None left, by the count.';
  const where = p.kind === 'keg' ? 'in the one on tap' : p.kind === 'bottle' ? 'in the open bottle' : 'left';
  const left = p.poursLeft < 1 ? `Less than a ${pourWord(p, 1)} ${where}.` : `About ${p.poursLeft} ${pourWord(p, p.poursLeft)} ${where}.`;
  const pace = p.minutesLeft !== null && p.minutesLeft <= 90 ? ` At tonight’s pace, ${p.minutesLeft < 1 ? 'any moment' : `${p.minutesLeft} minutes`}.` : '';
  const stock = p.full > 0 ? ` ${p.full} full in stock.` : ' None in stock.';
  return `${left}${pace}${stock}`;
}

/** Changing a keg or bottle: how much of what the count still had in the old one is logged as lost (a little), and
 *  what to say. Nothing is logged when the count had a lot left, or none. */
export function changeOutcome(p: Pick<BarPart, 'kind' | 'unit' | 'size' | 'open' | 'pour' | 'name'>): { loss: number; words: string } {
  const what = p.kind === 'keg' ? 'keg' : p.kind === 'bottle' ? 'bottle' : 'one';
  if (p.open <= 0) return { loss: 0, words: `${p.name} changed. The count had already finished the last ${what}.` };
  const n = Math.round(p.open / p.pour);
  const amount = n >= 1 ? `about ${n} ${pourWord(p as any, n)}` : `a little`;
  if (p.open <= p.size * LOSS_SHARE) return { loss: Math.round(p.open * 1000) / 1000, words: `${p.name} changed. By the count it still had ${amount}: that’s logged as pour loss, so food cost and the next count agree.` };
  return { loss: 0, words: `${p.name} changed. By the count it still had ${amount}, too much to be pour loss, so nothing was logged. The next stock count will settle it.` };
}
