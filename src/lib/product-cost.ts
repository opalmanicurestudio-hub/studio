// src/lib/product-cost.ts — pure helpers about an inventory item's cost per use (safe on screens and the server).
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** How many uses / ml / g a container holds, by its costing method (1 = priced per item). */
export const containerSize = (it: any) => (it?.costingMethod === 'uses' ? n(it.estimatedUses) : it?.costingMethod === 'size' ? n(it.size) : 1) || 1;
/** Can this item's cost be counted per use? null when fine, else a short reason — shared by the item page, the service
 *  recipe and the restocking fund so they always agree. */
export function costGap(it: any): string | null {
  if (!it) return 'not found';
  if (!(n(it.costPerUnit) > 0)) return 'no cost';
  if (it.costingMethod === 'size' && !(n(it.size) > 0)) return 'no container size';
  if (it.costingMethod === 'uses' && !(n(it.estimatedUses) > 0)) return 'no number of uses';
  if (!it.costingMethod && /ml|g|oz/i.test(String(it.useUnit || ''))) return 'no container size or uses';
  return null;
}

// ── ONE RULE FOR WHAT A PRODUCT COSTS EACH TIME IT'S USED ──
// Every screen and every server step that prices product use calls these, so a service's margin, a visit's profit, the
// restocking fund, a membership's cost and the product's own page always agree. A product whose cost can't be spread
// yet (no cost, or counted by uses or by amount with no uses or size set) has no cost per use (null), never the whole
// container's cost for each use: screens say why (costGap) instead of showing a number that's wildly wrong.

/** How many uses, ml or g one container holds; null when it's counted that way but the number isn't set. 1 = per item. */
export function perContainer(it: any): number | null {
  if (it?.costingMethod === 'uses') return n(it.estimatedUses) > 0 ? n(it.estimatedUses) : null;
  if (it?.costingMethod === 'size') return n(it.size) > 0 ? n(it.size) : null;
  return 1;
}
/** What one use is measured in: uses, ml / g (its unit), or each. */
export function unitLabel(it: any): string {
  if (it?.costingMethod === 'uses') return String(it.useUnit || 'uses');
  if (it?.costingMethod === 'size') return String(it.unit || 'ml');
  return 'each';
}
/** Cost of one use (one use, one ml / g, or one item); null when it can't be counted (see costGap). */
export function unitCost(it: any): number | null {
  if (costGap(it)) return null;
  const per = perContainer(it); return per ? n(it.costPerUnit) / per : null;
}
/** Cost of using `qty` (in unitLabel units); null when it can't be counted. */
export function lineCost(it: any, qty: number): number | null {
  const u = unitCost(it); return u === null ? null : u * Math.max(0, n(qty));
}
/** How much is left to use, in unitLabel units (full containers plus the open one). */
export function usesLeft(it: any): number | null {
  const per = perContainer(it); if (per === null) return null;
  if (per === 1 && !it?.costingMethod) return Math.max(0, n(it?.totalStock));
  const open = it?.costingMethod === 'uses' ? n(it.partialContainerUses) : n(it.partialContainerSize);
  return Math.max(0, n(it?.totalStock) * per + open);
}
/** The business's restocking markup: what it set (0 means none), else 40%. */
export function shopMarkupPct(tenant: any): number {
  const v = tenant?.restocking?.markupPct;
  return v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 40;
}
/** The restocking markup for a product: its own when it has one (above 0), else the business's. */
export function restockMarkupPct(it: any, tenant: any): number {
  const own = n(it?.restockingMarkup);
  return own > 0 ? own : shopMarkupPct(tenant);
}
/** A recipe's product lines: its product id (saved as `id`; older recipes may say `productId`) and how much it uses
 *  (a line with no amount counts as one use, as the recipe editor shows it). */
export function recipeLines(products: any[]): { productId: string; qty: number }[] {
  return (Array.isArray(products) ? products : []).map((p: any) => ({ productId: String(p?.id ?? p?.productId ?? ''), qty: n(p?.quantityUsed) > 0 ? n(p.quantityUsed) : 1 }))
    .filter((l) => l.productId);
}
/** What a recipe's products cost, and which of them can't be counted yet (left out of the total, named with the reason). */
export function recipeCost(products: any[], inventory: any[]): { total: number; gaps: { id: string; name: string; gap: string }[] } {
  const byId = new Map((inventory || []).map((i: any) => [String(i.id), i]));
  let total = 0; const gaps: { id: string; name: string; gap: string }[] = [];
  for (const l of recipeLines(products)) {
    const it: any = byId.get(l.productId);
    if (!it) { gaps.push({ id: l.productId, name: 'A product', gap: 'not found' }); continue; }
    const c = lineCost(it, l.qty);
    if (c === null) gaps.push({ id: l.productId, name: String(it.name || 'Product'), gap: costGap(it) || 'no cost' }); else total += c;
  }
  return { total, gaps };
}

// ── WHAT A SERVICE COSTS TO RUN: ITS PRODUCTS, ITS DISPOSABLES, AND THE STATION'S TIME ──
// One answer for every screen that plans a price, a deposit, a fee, a floor or a margin.

/** What a service's products and its disposables (gloves, files, foils linked to stock on its blueprint) cost for one
 *  visit; what can't be counted yet is named. A disposable is used once per client, so it's always one each. */
export function planCost(service: any, inventory: any[]): { total: number; gaps: { id: string; name: string; gap: string }[] } {
  const rc = recipeCost(service?.products || [], inventory);
  const byId = new Map((inventory || []).map((i: any) => [String(i.id), i]));
  let total = rc.total; const gaps = [...rc.gaps];
  for (const r of (service?.blueprint?.requirements || []) as any[]) {
    if (r?.kind !== 'disposable' || r.mode === 'optional' || !r.inventoryItemId) continue;
    const it: any = byId.get(String(r.inventoryItemId)); if (!it) continue;
    const c = lineCost(it, Math.max(1, Math.round(n(r.qty) || 1)));
    if (c === null) gaps.push({ id: String(it.id), name: String(it.name || r.name || 'A disposable'), gap: costGap(it) || 'no cost' }); else total += c;
  }
  return { total, gaps };
}
/** How long a service ties up the station: its booked time (or, for a finished visit, the real time) plus its set-up and
 *  clean-up. Add-ons add their booked time. A service with no length saved at all counts as an hour (0 stays 0). */
export function stationMinutes(service: any, opts: { addOns?: any[]; actualMin?: number | null } = {}): number {
  const d = service?.duration; const booked = d === undefined || d === null || d === '' ? 60 : Math.max(0, n(d));
  const extra = (opts.addOns || []).reduce((a, s) => a + Math.max(0, n(s?.duration)), 0);
  const worked = opts.actualMin && opts.actualMin > 0 ? n(opts.actualMin) : booked + extra;
  return worked + Math.max(0, n(service?.padBefore)) + Math.max(0, n(service?.padAfter));
}
/** The business's hourly running cost (what an hour of the station costs to keep open): what it set (0 is allowed),
 *  else $50 until it's worked out. */
export function hourlyRate(tenant: any): number {
  const v = tenant?.tmhr;
  return v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 50;
}
/** Running cost for the time a service ties up the station. */
export function timeCost(service: any, tenant: any, opts: { addOns?: any[]; actualMin?: number | null } = {}): number {
  return (stationMinutes(service, opts) / 60) * hourlyRate(tenant);
}

/** What running-cost items (foils, towels, cleaning supplies, used in the last 30 days) and equipment wear (its price
 *  spread over its expected life) would add to the hourly running cost. Shown beside the rate so the owner decides
 *  whether to include them; nothing here changes the rate on its own. */
export function rateAddOns(inventory: any[], usedLast30: any[], billableHoursPerMonth: number) {
  const byId = new Map((inventory || []).map((i: any) => [String(i.id), i]));
  // Net use per item (a "used less than the recipe" correction puts some back), floored at nothing. Uses that belong to a
  // visit are left out: a running-cost item linked to a service is already in that service's cost (planCost), and
  // counting it in the hourly rate too would charge it twice.
  const net = new Map<string, number>();
  for (const e of usedLast30 || []) {
    if (e?.type !== 'used') continue; if ((e.refKind || e.ref?.kind) === 'appointment') continue;
    const it: any = byId.get(String(e.productId)); if (!it || it.type !== 'overhead') continue;
    net.set(String(it.id), (net.get(String(it.id)) || 0) - n(e.change));
  }
  let running = 0; const runningItems = new Map<string, number>();
  for (const [id, q] of net) { const it: any = byId.get(id); const u = unitCost(it); if (u === null || q <= 0) continue;
    const c = q * u; running += c; runningItems.set(String(it.name || 'Item'), (runningItems.get(String(it.name || 'Item')) || 0) + c); }
  let wear = 0; const wearItems: { name: string; perMonth: number }[] = [];
  for (const it of inventory || []) {
    if (it?.type !== 'equipment' || it.status === 'archived') continue;
    const years = n(it.lifespanYears); const price = n(it.costPerUnit) * Math.max(1, n(it.totalStock) || 1);
    if (!(years > 0) || !(price > 0)) continue;
    const m = price / (years * 12); wear += m; wearItems.push({ name: String(it.name || 'Equipment'), perMonth: m });
  }
  const h = n(billableHoursPerMonth);
  return {
    runningPerMonth: running, runningPerHour: h > 0 ? running / h : 0, runningItems: [...runningItems.entries()].map(([name, perMonth]) => ({ name, perMonth })).sort((a, b) => b.perMonth - a.perMonth),
    wearPerMonth: wear, wearPerHour: h > 0 ? wear / h : 0, wearItems: wearItems.sort((a, b) => b.perMonth - a.perMonth),
  };
}
