// src/lib/retail-offers.ts — BUNDLES, KITS, BUILD-YOUR-OWN BOXES, SHOP THE LOOK AND OFTEN BOUGHT TOGETHER.
//
// One rule runs everywhere (the shop's pages, the bag, checkout on the server, the setup screen's preview), so what a
// shopper is shown is what they are charged:
//
//   • Item prices never change. Every product in a bundle is sold at its own price, as its own line, and takes its own
//     stock. What the bundle saves comes off as its own line ("Bundle savings"), shared across the items it covers to
//     the cent, and written on each line, so a refund of one item gives back what was actually paid for it.
//   • Savings are worked out from what is in the bag, never from a flag the browser sends. Add the three things in a
//     kit, in any order, from any page, and the kit's saving applies; take one out and it stops.
//   • A unit of a product counts toward one offer only. Offers that save the most are matched first.
//   • Promo codes don't stack on items an offer already covers.
//
// Kinds:
//   set       a fixed group of products (a bundle, or a kit with its own name and photo), saving a percent, an amount,
//             or sold at a set price.
//   box       build your own: pick any products from a list; the more you pick, the bigger the percent off (tiers).
//   look      a photo with tappable dots on the products in it; optionally a saving when the whole look is bought.
//   together  "often bought together" picks for one product; optionally a saving when bought with it. Products with no
//             picks are paired from what customers actually buy together (pairsFromOrders).

export type OfferKind = 'set' | 'box' | 'look' | 'together';
export type SaveType = 'pct' | 'off' | 'price';

export interface OfferItem { productId: string; qty: number }
export interface OfferSave { type: SaveType; value: number }   // pct: 1–90 · off: cents · price: cents for the whole set
export interface OfferTier { count: number; pct: number }
export interface Hotspot { productId: string; x: number; y: number }   // percent of the photo, 0–100

export interface Offer {
  id: string;
  kind: OfferKind;
  name: string;
  blurb: string;
  status: 'live' | 'draft';
  kit: boolean;               // a set shown as its own product (its name, photo and price), not just on product pages
  photoUrl: string;
  items: OfferItem[];         // set, look, together (the anchor is not listed here)
  anchorId: string;           // together: the product the picks are for
  pool: string[];             // box: the products it can be built from
  tiers: OfferTier[];         // box: ascending by count
  save: OfferSave | null;     // set, look, together; null = no saving (a look or picks shown only to help shopping)
  hotspots: Hotspot[];        // look
  order: number;              // how the shop lists offers
}

export const MAX_ITEMS = 12;
export const MAX_POOL = 60;
export const MAX_TIERS = 4;
export const MAX_PCT = 90;
export const MIN_SET_PRICE_CENTS = 100;

const cents = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
const str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const pid = (v: unknown) => { const s = str(v, 120); return s && !s.includes('/') ? s : ''; };

/** A saved offer made safe to use: anything malformed is dropped or clamped, and an offer that can't work is null. */
export function readOffer(raw: any, id?: string): Offer | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind: OfferKind = (['set', 'box', 'look', 'together'] as const).includes(raw.kind) ? raw.kind : 'set';
  const seen = new Set<string>();
  const items: OfferItem[] = (Array.isArray(raw.items) ? raw.items : []).map((it: any) => ({ productId: pid(it?.productId), qty: Math.max(1, Math.min(10, Math.floor(Number(it?.qty) || 1))) }))
    .filter((it: OfferItem) => it.productId && !seen.has(it.productId) && seen.add(it.productId)).slice(0, MAX_ITEMS);
  const pool = [...new Set((Array.isArray(raw.pool) ? raw.pool : []).map(pid).filter(Boolean))].slice(0, MAX_POOL) as string[];
  const tiers: OfferTier[] = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .map((t: any) => ({ count: Math.max(2, Math.min(24, Math.floor(Number(t?.count) || 0))), pct: Math.max(1, Math.min(MAX_PCT, Math.round(Number(t?.pct) || 0))) }))
    .filter((t: OfferTier) => Number.isFinite(t.count) && t.pct > 0)
    .sort((a: OfferTier, b: OfferTier) => a.count - b.count)
    .filter((t: OfferTier, i: number, a: OfferTier[]) => i === 0 || (t.count > a[i - 1].count && t.pct > a[i - 1].pct))
    .slice(0, MAX_TIERS);
  let save: OfferSave | null = null;
  const st = raw.save?.type; const sv = Number(raw.save?.value);
  if (st === 'pct' && sv > 0) save = { type: 'pct', value: Math.max(1, Math.min(MAX_PCT, Math.round(sv))) };
  else if (st === 'off' && sv > 0) save = { type: 'off', value: cents(sv) };
  else if (st === 'price' && kind === 'set' && sv > 0) save = { type: 'price', value: Math.max(MIN_SET_PRICE_CENTS, cents(sv)) };
  const hotspots: Hotspot[] = (Array.isArray(raw.hotspots) ? raw.hotspots : []).map((h: any) => ({ productId: pid(h?.productId), x: Math.max(0, Math.min(100, Number(h?.x) || 0)), y: Math.max(0, Math.min(100, Number(h?.y) || 0)) }))
    .filter((h: Hotspot) => h.productId).slice(0, MAX_ITEMS);
  const o: Offer = {
    id: str(id ?? raw.id, 80), kind, name: str(raw.name, 80), blurb: str(raw.blurb, 400),
    status: raw.status === 'live' ? 'live' : 'draft', kit: kind === 'set' && raw.kit === true,
    photoUrl: /^https:\/\//i.test(String(raw.photoUrl || '')) ? str(raw.photoUrl, 600) : '',
    items: kind === 'box' ? [] : items, anchorId: kind === 'together' ? pid(raw.anchorId) : '',
    pool: kind === 'box' ? pool : [], tiers: kind === 'box' ? tiers : [],
    save: kind === 'box' ? null : save, hotspots: kind === 'look' ? hotspots.filter((h) => items.some((it) => it.productId === h.productId)) : [],
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
  };
  if (o.kind === 'together') o.items = o.items.filter((it) => it.productId !== o.anchorId).map((it) => ({ ...it, qty: 1 }));
  if (o.kind === 'look') o.items = o.items.map((it) => ({ ...it, qty: 1 }));
  return problemsOf(o).length ? null : o;
}

/** What stops an offer from working, in plain words (the setup screen shows these; a broken offer is never used). */
export function problemsOf(o: Offer): string[] {
  const p: string[] = [];
  if (!o.name && o.kind !== 'together') p.push('Give it a name.');
  if (o.kind === 'set' && o.items.reduce((n, it) => n + it.qty, 0) < 2) p.push('A bundle needs at least two items.');
  if (o.kind === 'set' && !o.save) p.push('Choose what the bundle saves.');
  if (o.kind === 'look' && o.items.length < 1) p.push('Add the products in the photo.');
  if (o.kind === 'look' && !o.photoUrl) p.push('Add the photo.');
  if (o.kind === 'together' && !o.anchorId) p.push('Choose the product these go with.');
  if (o.kind === 'together' && o.items.length < 1) p.push('Pick at least one product to go with it.');
  if (o.kind === 'box' && !o.tiers.length) p.push('Add at least one “pick this many, save this much” step.');
  if (o.kind === 'box' && o.pool.length < (o.tiers[0]?.count || 2)) p.push('Add enough products to fill the smallest box.');
  return p;
}

/**
 * What's wrong with an offer as it is being edited, before it is cleaned up: steps and savings that would otherwise be
 * quietly changed or dropped when it is read (readOffer). The setup screen shows these with problemsOf.
 */
export function draftProblems(raw: any): string[] {
  const p: string[] = [];
  if (raw?.kind === 'box') {
    const t = Array.isArray(raw.tiers) ? raw.tiers : [];
    if (t.some((x: any) => !(Number(x?.count) >= 2))) p.push('Each step needs at least 2 items.');
    if (t.some((x: any) => !(Number(x?.pct) >= 1))) p.push('Each step needs a percent off of at least 1.');
    const ok = [...t].sort((a: any, b: any) => Number(a?.count) - Number(b?.count)).every((x: any, i: number, a: any[]) => i === 0 || (Number(x.count) > Number(a[i - 1].count) && Number(x.pct) > Number(a[i - 1].pct)));
    if (!ok) p.push('Each step needs more items and a bigger percent than the one before.');
  } else if (raw?.save && !(Number(raw.save.value) > 0)) p.push('Enter what it saves.');
  return p;
}

/** The products an offer uses. */
export function productsOf(o: Offer): string[] {
  if (o.kind === 'box') return [...o.pool];
  return [...(o.anchorId ? [o.anchorId] : []), ...o.items.map((it) => it.productId)];
}

/** The fixed group a set, look or "together" offer saves on (the anchor counts as one of the group). */
export function groupOf(o: Offer): OfferItem[] {
  if (o.kind === 'box') return [];
  return o.kind === 'together' ? [{ productId: o.anchorId, qty: 1 }, ...o.items] : o.items;
}

/** What one complete group saves at these prices (cents for the whole group). */
export function groupSaving(save: OfferSave | null, groupCents: number): number {
  if (!save || groupCents <= 0) return 0;
  // Never more than MAX_PCT off, however it is set: a typo in "amount off" or "set price" can't make a kit free.
  const most = Math.round(groupCents * MAX_PCT / 100);
  if (save.type === 'pct') return Math.min(most, Math.round(groupCents * save.value / 100));
  if (save.type === 'off') return Math.min(most, save.value);
  return Math.min(most, Math.max(0, groupCents - save.value));
}

/** The percent a box of `n` items saves (0 below the smallest step). */
export function boxPct(o: Offer, n: number): number {
  let pct = 0;
  for (const t of o.tiers) if (n >= t.count) pct = t.pct;
  return pct;
}

/** The next step up for a box: how many more to add and what it saves then (null at the top step). */
export function boxNext(o: Offer, n: number): { more: number; pct: number } | null {
  const t = o.tiers.find((x) => x.count > n);
  return t ? { more: t.count - n, pct: t.pct } : null;
}

/** How many complete groups the shelf can make (stock per product id; a product with no number counts as none). */
export function groupsAvailable(o: Offer, stockOf: (productId: string) => number): number {
  const g = groupOf(o);
  if (!g.length) return 0;
  return Math.max(0, Math.min(...g.map((it) => Math.floor((Number(stockOf(it.productId)) || 0) / it.qty))));
}

// ─── Matching the bag ───────────────────────────────────────────────────────────────────────────────────────────────

/** A line as the matcher sees it: the product it sells (a variant's own id), the listing it was chosen on, its price. */
export interface MatchLine { id: string; productId: string; listingId?: string; unitPriceCents: number; qty: number }
export interface AppliedOffer { offerId: string; name: string; kind: OfferKind; cents: number; groups: number; pct?: number }
export interface MatchResult { applied: AppliedOffer[]; byLine: Record<string, number>; cents: number; offersByLine: Record<string, string[]>; unitsByLine: Record<string, number> }

const lineIs = (l: MatchLine, productId: string) => l.productId === productId || (!!l.listingId && l.listingId === productId);

/** Shares `total` across parts by their value, to the exact cent (largest remainder). */
function share(parts: { id: string; value: number }[], total: number): Record<string, number> {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const out: Record<string, number> = {};
  if (!sum || total <= 0) return out;
  const xs = parts.map((p) => { const exact = (total * p.value) / sum; return { id: p.id, floor: Math.floor(exact), rem: exact - Math.floor(exact) }; });
  let left = total - xs.reduce((s, x) => s + x.floor, 0);
  for (const x of [...xs].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; x.floor++; left--; }
  for (const x of xs) if (x.floor > 0) out[x.id] = (out[x.id] || 0) + x.floor;
  return out;
}

/**
 * What the offers save on these lines. Only live offers are used. Each unit counts toward one offer; fixed groups that
 * save the most per group are matched first, then boxes. Units are taken from the dearest line first, so a cheaper
 * variant is never what a group is priced on when a dearer one is in the bag too.
 */
export function matchOffers(lines: MatchLine[], offers: Offer[]): MatchResult {
  // Fixed groups and boxes can want the same units. Both orders are tried and the one that saves the shopper more is
  // used (ties go to groups first), so adding a box's worth of products never ends up saving less than the box.
  const a = matchIn(lines, offers, 'groups');
  if (!offers.some((o) => o && o.status === 'live' && o.kind === 'box')) return a;
  const b = matchIn(lines, offers, 'boxes');
  return b.cents > a.cents ? b : a;
}

function matchIn(lines: MatchLine[], offers: Offer[], first: 'groups' | 'boxes'): MatchResult {
  const left = new Map(lines.map((l) => [l.id, Math.max(0, Math.floor(l.qty))]));
  const byLine: Record<string, number> = {}; const offersByLine: Record<string, string[]> = {};
  const unitsByLine: Record<string, number> = {};   // how many units of each line an offer covers
  const applied: AppliedOffer[] = [];
  const live = offers.filter((o) => o && o.status === 'live');
  const dearFirst = [...lines].sort((a, b) => b.unitPriceCents - a.unitPriceCents);
  const note = (lineId: string, offerId: string) => { const xs = offersByLine[lineId] || (offersByLine[lineId] = []); if (!xs.includes(offerId)) xs.push(offerId); };

  // Fixed groups: rank by what one group saves at the bag's prices (dearest units).
  const unitPrice = (productId: string) => dearFirst.find((l) => lineIs(l, productId))?.unitPriceCents || 0;
  const fixed = live.filter((o) => o.kind !== 'box' && o.save && groupOf(o).length)
    .map((o) => ({ o, est: groupSaving(o.save, groupOf(o).reduce((s, it) => s + unitPrice(it.productId) * it.qty, 0)) }))
    .filter((x) => x.est > 0)
    .sort((a, b) => b.est - a.est || a.o.order - b.o.order || a.o.id.localeCompare(b.o.id));
  const runGroups = () => { for (const { o } of fixed) {
    const g = groupOf(o);
    let groups = 0; let saved = 0; const taken: Record<string, number> = {}; const units: Record<string, number> = {};
    for (;;) {
      // Can one more complete group be made from what is left?
      const ok = g.every((it) => dearFirst.filter((l) => lineIs(l, it.productId)).reduce((n, l) => n + (left.get(l.id) || 0), 0) >= it.qty);
      if (!ok) break;
      const parts: { id: string; value: number; units: number }[] = [];
      for (const it of g) {
        let need = it.qty;
        for (const l of dearFirst) {
          if (!need) break;
          if (!lineIs(l, it.productId)) continue;
          const can = Math.min(need, left.get(l.id) || 0); if (!can) continue;
          left.set(l.id, (left.get(l.id) || 0) - can); need -= can;
          parts.push({ id: l.id, value: can * l.unitPriceCents, units: can });
        }
      }
      const groupCents = parts.reduce((s, p) => s + p.value, 0);
      const off = groupSaving(o.save, groupCents);
      // A group that saves nothing (a set price above these units' prices) gives its units back for other offers.
      if (off <= 0) { for (const p of parts) left.set(p.id, (left.get(p.id) || 0) + p.units); break; }
      for (const [id, c] of Object.entries(share(parts, off))) { taken[id] = (taken[id] || 0) + c; }
      for (const p of parts) units[p.id] = (units[p.id] || 0) + p.units;
      groups++; saved += off;
    }
    if (groups && saved > 0) {
      for (const [id, c] of Object.entries(taken)) { byLine[id] = (byLine[id] || 0) + c; note(id, o.id); }
      for (const [id, n] of Object.entries(units)) unitsByLine[id] = (unitsByLine[id] || 0) + n;
      applied.push({ offerId: o.id, name: o.name || 'Bought together', kind: o.kind, cents: saved, groups });
    }
  } };

  // Boxes: every unit left from the box's list counts; the step reached sets the percent for all of them.
  const runBoxes = () => { const boxes = live.filter((o) => o.kind === 'box' && o.tiers.length)
    .map((o) => { const n = lines.filter((l) => o.pool.some((p) => lineIs(l, p))).reduce((s, l) => s + (left.get(l.id) || 0), 0); return { o, pct: boxPct(o, n) }; })
    .filter((x) => x.pct > 0)
    .sort((a, b) => b.pct - a.pct || a.o.order - b.o.order || a.o.id.localeCompare(b.o.id));
  for (const { o } of boxes) {
    // One box holds at most its top step's number of items (dearest first); more of the list makes another box.
    const top = o.tiers[o.tiers.length - 1].count;
    let boxesMade = 0; let saved = 0; let bestPct = 0; const taken: Record<string, number> = {}; const units: Record<string, number> = {};
    for (;;) {
      const mine = dearFirst.filter((l) => o.pool.some((p) => lineIs(l, p)) && (left.get(l.id) || 0) > 0);
      const n = Math.min(top, mine.reduce((s, l) => s + (left.get(l.id) || 0), 0));
      const pct = boxPct(o, n); if (!pct) break;
      let need = n; const parts: { id: string; value: number; units: number }[] = [];
      for (const l of mine) { if (!need) break; const can = Math.min(need, left.get(l.id) || 0); left.set(l.id, (left.get(l.id) || 0) - can); need -= can; parts.push({ id: l.id, value: can * l.unitPriceCents, units: can }); }
      const off = Math.round(parts.reduce((s, p) => s + p.value, 0) * pct / 100);
      if (off <= 0) { for (const p of parts) left.set(p.id, (left.get(p.id) || 0) + p.units); break; }
      for (const [id, c] of Object.entries(share(parts, off))) taken[id] = (taken[id] || 0) + c;
      for (const p of parts) units[p.id] = (units[p.id] || 0) + p.units;
      boxesMade++; saved += off; bestPct = Math.max(bestPct, pct);
    }
    if (!boxesMade) continue;
    for (const [id, c] of Object.entries(taken)) { byLine[id] = (byLine[id] || 0) + c; note(id, o.id); }
    for (const [id, n] of Object.entries(units)) unitsByLine[id] = (unitsByLine[id] || 0) + n;
    applied.push({ offerId: o.id, name: o.name || 'Your box', kind: 'box', cents: saved, groups: boxesMade, pct: bestPct });
  } };
  if (first === 'groups') { runGroups(); runBoxes(); } else { runBoxes(); runGroups(); }

  const total = applied.reduce((s, a) => s + a.cents, 0);
  return { applied, byLine, cents: total, offersByLine, unitsByLine };
}

/**
 * Lowers the savings so the card still has `roomCents` (the processor's 50¢ floor above what else is charged), sharing
 * the cut across lines the same way. Returns the result unchanged when it already fits.
 */
export function capSavings(m: MatchResult, roomCents: number): MatchResult {
  const room = Math.max(0, Math.floor(roomCents));
  if (m.cents <= room) return m;
  if (room <= 0) return { applied: [], byLine: {}, cents: 0, offersByLine: {}, unitsByLine: {} };
  const byLine = share(Object.entries(m.byLine).map(([id, c]) => ({ id, value: c })), room);
  const scale = room / m.cents; let given = 0;
  const applied = m.applied.map((a, i) => { const c = i === m.applied.length - 1 ? room - given : Math.floor(a.cents * scale); given += c; return { ...a, cents: c }; }).filter((a) => a.cents > 0);
  // Lines name only the offers still applied; a line keeps its units and its (lowered) share.
  const keep = new Set(applied.map((a) => a.offerId));
  const offersByLine = Object.fromEntries(Object.entries(m.offersByLine).map(([id, xs]) => [id, xs.filter((x) => keep.has(x))]).filter(([id, xs]) => (xs as string[]).length && byLine[id as string]));
  const unitsByLine = Object.fromEntries(Object.entries(m.unitsByLine).filter(([id]) => byLine[id]));
  return { applied, byLine, cents: room, offersByLine, unitsByLine };
}

/** One label for the savings line: "Bundle savings", or the offer's own name when there is one offer. */
export function savingsLabel(applied: AppliedOffer[]): string {
  if (!applied.length) return '';
  if (applied.length === 1) return applied[0].kind === 'box' ? `${applied[0].name} (${applied[0].pct}% off)` : applied[0].name;
  return 'Bundle savings';
}

// ─── What the shop is sent ──────────────────────────────────────────────────────────────────────────────────────────

/** An offer as the public shop sees it, or null when one of its products can't be bought online right now. */
export function publicOffer(o: Offer, shown: Map<string, { inStock?: boolean; qtyAvailable?: number }>): (Offer & { groupsLeft: number | null }) | null {
  if (o.status !== 'live') return null;
  if (o.kind === 'box') {
    const pool = o.pool.filter((p) => shown.has(p));
    if (pool.length < (o.tiers[0]?.count || 2)) return null;
    return { ...o, pool, groupsLeft: null };
  }
  const all = productsOf(o);
  if (!all.every((p) => shown.has(p))) return null;
  const left = groupsAvailable(o, (p) => (shown.get(p)?.inStock ? Number(shown.get(p)?.qtyAvailable) || 0 : 0));
  return { ...o, groupsLeft: left };
}

/**
 * "Often bought together", from paid orders: for each product, the others most often in the same order (at least
 * twice), best first, up to `top`. A line sold as a variant counts as its listing.
 */
export function pairsFromOrders(orders: { lines?: any[] }[], top = 4): Record<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const o of orders) {
    const ids = [...new Set((Array.isArray(o?.lines) ? o.lines : []).map((l: any) => pid(l?.listingId || l?.productId)).filter(Boolean))] as string[];
    if (ids.length < 2 || ids.length > 30) continue;
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const m = counts.get(a) || new Map<string, number>(); counts.set(a, m);
      m.set(b, (m.get(b) || 0) + 1);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [a, m] of counts) {
    const best = [...m.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, top).map(([b]) => b);
    if (best.length) out[a] = best;
  }
  return out;
}

/** The picks shown with a product: the shop's own first, then what customers buy with it, only products on sale now. */
export function picksFor(productId: string, offers: Offer[], pairs: Record<string, string[]>, shown: Set<string>, top = 3): { ids: string[]; offer: Offer | null } {
  const mine = offers.find((o) => o.kind === 'together' && o.status === 'live' && o.anchorId === productId) || null;
  const ids = [...(mine ? mine.items.map((it) => it.productId) : []), ...(pairs[productId] || [])]
    .filter((id, i, a) => id !== productId && shown.has(id) && a.indexOf(id) === i).slice(0, top);
  return { ids, offer: mine };
}
