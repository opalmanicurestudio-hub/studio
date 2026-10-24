// src/lib/variants.ts — A LISTING AND ITS VARIANTS (pure; browser and server). A product that comes in variants is a
// listing (its name, photos and words in the shop) whose choices each pick a product of their own, with its own codes
// and stock, and its own price when it has one. The shop, checkout, the desk, the order screens and the codes check
// all ask this, so they agree on what a listing sells:
//   • One group of a listing's choices holds its variants: the first group with a choice that picks a product. Other
//     groups only add to the price (gift wrap, engraving).
//   • A variant belongs to one listing, and a listing is never a variant itself.
//   • A variant costs its own price when it has one, otherwise the listing's. An extra cost on a variant's choice
//     doesn't apply: the variant's price is the price.
//   • A listing is in stock while any of its variants is, and a variant is never listed on its own.
// Choices saved before these rules (a choice in the variants group that picks no product sells the listing itself)
// still sell as they did.
import { isStorefrontVisible, listingPriceCents, onlineSellable, preorderState, type OptionChoice, type OptionGroup, type PriceTier } from './retail-orders';
import { discountedCents } from './retail-wholesale';

const groupsOf = (item: any): OptionGroup[] => (Array.isArray(item?.optionGroups) ? item.optionGroups : [])
  .filter((g: any) => g && Array.isArray(g.choices));
/** The product a choice picks ('' for none, or for the listing itself). */
export const pickedBy = (listing: any, c: any): string => {
  const id = c && c.variantProductId ? String(c.variantProductId) : '';
  return id && id !== String(listing?.id ?? '') ? id : '';
};

/** The group of a listing's choices that holds its variants: the first with a choice that picks a product. */
export function variantGroup(listing: any): OptionGroup | null {
  return groupsOf(listing).find((g) => g.choices.some((c) => pickedBy(listing, c))) || null;
}

/** The products a listing sells as its variants, in the order its choices show them. */
export function variantIdsOf(listing: any): string[] {
  const g = variantGroup(listing); if (!g) return [];
  const out: string[] = [];
  for (const c of g.choices) { const id = pickedBy(listing, c); if (id && !out.includes(id)) out.push(id); }
  return out;
}

/** The choice of a listing that picks this variant. */
export function choiceFor(listing: any, variantId: string): { group: OptionGroup; choice: OptionChoice } | null {
  const g = variantGroup(listing); if (!g) return null;
  const choice = g.choices.find((c) => pickedBy(listing, c) === String(variantId));
  return choice ? { group: g, choice } : null;
}

/** Which listing sells each variant (variant id → listing). A listing that isn't archived comes first, then by id, so
 *  every screen and the server agree; a listing is never a variant itself. */
export function listingsOf(items: any[]): Map<string, any> {
  const listings = (items || []).filter((i) => i && i.id != null && variantIdsOf(i).length)
    .sort((a, b) => (a.status === 'archived' ? 1 : 0) - (b.status === 'archived' ? 1 : 0) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const isListing = new Set(listings.map((l) => String(l.id)));
  const out = new Map<string, any>();
  for (const l of listings) for (const v of variantIdsOf(l)) if (!out.has(v) && !isListing.has(v)) out.set(v, l);
  return out;
}

/** Does the shop list this product on its own (its grid, its product page, its sitemap)? Not a variant: a variant is
 *  sold inside its listing. `listings`: listingsOf the shop's products. */
export function listedInShop(item: any, listings: Map<string, any>): boolean {
  return isStorefrontVisible(item) && !listings.has(String(item?.id ?? ''));
}

/** Whether a variant has a price of its own (otherwise it sells for the listing's). */
export const ownPrice = (variant: any, tier: PriceTier = 'retail') =>
  Number(variant?.msrp) > 0 || (tier === 'wholesale' && Number(variant?.wholesalePriceDollars) > 0);

/** A variant's price in cents: its own when it has one, otherwise the listing's. Wholesale: its own wholesale price,
 *  else its own price, else the listing's wholesale price. */
export function variantPriceCents(variant: any, listing: any, tier: PriceTier = 'retail'): number {
  if (tier === 'wholesale' && Number(variant?.wholesalePriceDollars) > 0) return Math.round(Number(variant.wholesalePriceDollars) * 100);
  if (Number(variant?.msrp) > 0) return Math.round(Number(variant.msrp) * 100);
  return listing ? listingPriceCents(listing, tier) : 0;
}

/** A product's price in cents wherever it's sold: a variant's by the rule above, anything else its own. */
export function priceCentsOf(item: any, listings: Map<string, any>, tier: PriceTier = 'retail'): number {
  const listing = listings.get(String(item?.id ?? ''));
  return listing ? variantPriceCents(item, listing, tier) : listingPriceCents(item, tier);
}

/** What a product sells for at the desk, in dollars: the shop's price for it (a variant's own, else its listing's). 0
 *  means it has no price yet, and it can't be sold until it has one. */
export function deskPrice(item: any, listings: Map<string, any>): number {
  return priceCentsOf(item, listings, 'retail') / 100;
}

/** A product's name on a receipt: a variant as its listing and the choice it's sold as ("Rose cuticle oil · Blush"). */
export function saleName(item: any, listings: Map<string, any>): string {
  const listing = listings.get(String(item?.id ?? ''));
  const c = listing ? choiceFor(listing, String(item.id)) : null;
  return listing && c ? `${listing.name || item.name || 'Item'} \u00b7 ${c.choice.label}` : String(item?.name || 'Item');
}

/** Every product as the shop sells it, for a list to choose from (a swap for a missing item): a listing's variants in
 *  its place (the listing holds no stock), each named as its listing and choice, priced by the rule, and shown and
 *  grouped as its listing is. */
export function soldAs(items: any[]): any[] {
  const listings = listingsOf(items || []);
  const out: any[] = [];
  for (const it of items || []) {
    if (!it || variantIdsOf(it).length) continue;
    const l = listings.get(String(it.id));
    if (!l) { out.push(it); continue; }
    out.push({ ...it, name: saleName(it, listings), listingId: String(l.id), msrp: variantPriceCents(it, l) / 100, showOnline: l.showOnline, category: l.category || it.category,
      status: l.status === 'archived' ? 'archived' : it.status, imageUrls: Array.isArray(it.imageUrls) && it.imageUrls.length ? it.imageUrls : l.imageUrls });
  }
  return out;
}

export type ChoiceSale = {
  /** The product sold: a variant's id, or '' for the listing itself. */
  variantId: string;
  /** The choice in the variants group (picked, else its first). */
  variantChoice: OptionChoice | null;
  /** What the choices that only change the price add, in cents. */
  extraCents: number;
  /** Every choice's words, "Blush · Gift wrap". */
  label: string;
  /** The choice taken in each group, by group id. */
  choices: Record<string, string>;
  /** The groups whose picked choice the listing doesn't offer any more (it was changed since). */
  unknown: string[];
};

/** What a set of choices on a listing sells. A group with nothing picked (or a choice the listing doesn't have) takes
 *  its first choice, as the shop shows it. */
export function choiceSale(listing: any, selections: Record<string, string> | undefined | null): ChoiceSale {
  const vg = variantGroup(listing);
  let variantId = ''; let variantChoice: OptionChoice | null = null; let extraCents = 0;
  const labels: string[] = []; const choices: Record<string, string> = {}; const unknown: string[] = [];
  for (const g of groupsOf(listing)) {
    const asked = selections?.[g.id];
    const choice = g.choices.find((c) => c && c.id === asked) || g.choices[0];
    if (asked && choice?.id !== asked) unknown.push(String(g.name || 'choice'));
    if (!choice) continue;
    choices[g.id] = choice.id; if (choice.label) labels.push(String(choice.label));
    if (g === vg) { variantChoice = choice; variantId = pickedBy(listing, choice); if (variantId) continue; }
    extraCents += Math.round(Number(choice.deltaCents) || 0);
  }
  return { variantId, variantChoice, extraCents, label: labels.join(' \u00b7 '), choices, unknown };
}

/** The price of one, in cents, for a listing and the product its choices sell (a variant, or the listing itself), with
 *  the extra cost of the choices that change the price. A wholesale account's own discount comes off the product's
 *  price, not the extras. */
export function saleUnitCents(listing: any, variant: any | null, sale: ChoiceSale, tier: PriceTier = 'retail', discountPct = 0): number {
  const base = variant ? variantPriceCents(variant, listing, tier) : listingPriceCents(listing, tier);
  return (tier === 'wholesale' ? discountedCents(base, discountPct) : base) + sale.extraCents;
}

/** Units of a product the online shop can sell now (never below 0). */
export const canSell = (item: any): number => Math.max(0, Math.floor(Number(onlineSellable(item)) || 0));

/** Can this product be bought online right now: on hand, nothing to ship, sold ahead of stock, or a pre-order run
 *  that's open. */
export function buyable(item: any, zone?: string | null): boolean {
  if (!item) return false;
  return item.digital === true || canSell(item) > 0 || item.allowBackorder === true || (item.preorder === true && preorderState(item, zone).open);
}

const live = (v: any) => !!v && v.status !== 'archived' && v.type === 'retail';

/** How many of a listing the online shop can sell: its variants' (and its own, when a choice in its variants group
 *  picks no product). `byId`: the shop's products. */
export function listingStock(listing: any, byId: Map<string, any>): number {
  const ids = variantIdsOf(listing);
  if (!ids.length) return canSell(listing);
  let n = 0;
  for (const id of ids) { const v = byId.get(id); if (live(v)) n += canSell(v); }
  if (variantGroup(listing)!.choices.some((c) => !pickedBy(listing, c))) n += canSell(listing);
  return n;
}

/** Can any of a listing's choices be bought right now? */
export function listingBuyable(listing: any, byId: Map<string, any>, zone?: string | null): boolean {
  const ids = variantIdsOf(listing);
  if (!ids.length) return buyable(listing, zone);
  if (ids.some((id) => { const v = byId.get(id); return live(v) && buyable(v, zone); })) return true;
  return variantGroup(listing)!.choices.some((c) => !pickedBy(listing, c)) && buyable(listing, zone);
}

/** A listing's choices as the shop shows them. Each choice of the variants group says what it sells for and whether it
 *  can be bought (product ids stay on the server); the other choices say what they add. */
export function shopOptionGroups(listing: any, byId: Map<string, any>, o: { wholesale?: boolean; discountPct?: number; zone?: string | null; maxShown?: number } = {}) {
  const vg = variantGroup(listing); const max = o.maxShown ?? 99;
  return groupsOf(listing).map((g) => {
    if (g !== vg) return { id: g.id, name: g.name, choices: g.choices.map((c) => ({ id: c.id, label: c.label, deltaCents: Math.round(Number(c.deltaCents) || 0) })) };
    return {
      id: g.id, name: g.name, variants: true,
      choices: g.choices.map((c) => {
        const vid = pickedBy(listing, c); const v = vid ? byId.get(vid) : listing; const ok = vid ? live(v) : true;
        const delta = vid ? 0 : Math.round(Number(c.deltaCents) || 0);
        const retail = (vid ? (ok ? variantPriceCents(v, listing, 'retail') : 0) : listingPriceCents(listing, 'retail')) + delta;
        const wholesale = o.wholesale ? discountedCents(vid ? (ok ? variantPriceCents(v, listing, 'wholesale') : 0) : listingPriceCents(listing, 'wholesale'), o.discountPct || 0) + delta : null;
        const n = ok ? canSell(v) : 0; const can = ok && buyable(v, o.zone);
        return {
          id: c.id, label: c.label, priceCents: retail, wholesalePriceCents: wholesale,
          inStock: can, qtyAvailable: can ? (v.allowBackorder === true || v.digital === true ? max : Math.min(Math.max(n, v.preorder === true ? max : 0), max)) : 0,
          lowStock: ok && n > 0 && n <= (Number(v.lowStockThreshold) || 0),
        };
      }),
    };
  });
}

/** The choices to show picked first: the first that can be bought in the variants group, the first in the others. */
export function firstChoices(groups: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups || []) {
    const cs = Array.isArray(g?.choices) ? g.choices : []; if (!cs.length) continue;
    out[g.id] = (g.variants ? cs.find((c: any) => c.inStock) || cs[0] : cs[0]).id;
  }
  return out;
}

/** In the shop (a product as the catalog sends it): what a set of choices sells for, which choice of the variants group
 *  that is, and how many can be added. The same sums checkout makes on the server (saleUnitCents). */
export function shopLine(product: any, selections: Record<string, string> | undefined | null, wholesale = false) {
  let unit = wholesale && product?.wholesalePriceCents != null ? Number(product.wholesalePriceCents) : Number(product?.priceCents) || 0;
  let variantChoice: any = null; let extra = 0; const labels: string[] = []; let stale = false;
  for (const g of Array.isArray(product?.optionGroups) ? product.optionGroups : []) {
    const cs = Array.isArray(g?.choices) ? g.choices : [];
    const asked = selections?.[g.id];
    const c = cs.find((x: any) => x.id === asked) || cs[0]; if (!c) continue;
    if (asked && c.id !== asked) stale = true;
    if (c.label) labels.push(String(c.label));
    if (g.variants) { variantChoice = c; unit = wholesale && c.wholesalePriceCents != null ? Number(c.wholesalePriceCents) : Number(c.priceCents) || 0; }
    else extra += Math.round(Number(c.deltaCents) || 0);
  }
  return {
    baseCents: unit, unitCents: unit + extra, label: labels.join(' \u00b7 '), variantChoice,
    // A choice picked before the shop changed its choices: checkout refuses it, so the cart says so first.
    stale,
    inStock: variantChoice ? variantChoice.inStock === true : product?.inStock === true,
    qtyAvailable: variantChoice ? Number(variantChoice.qtyAvailable) || 0 : Number(product?.qtyAvailable) || 0,
  };
}

/** A listing's choices as a screen sent them, kept to what a choice holds: ids kept (so a cart's picks still match),
 *  words trimmed, a variant's choice without an extra cost (its price is the variant's). `problem` when they can't be
 *  saved as sent. */
export function cleanChoices(input: any): { groups: OptionGroup[]; problem: string } {
  const out: OptionGroup[] = [];
  if (!Array.isArray(input)) return { groups: out, problem: 'Those choices couldn’t be read. Try again.' };
  const idOk = (s: string) => /^[A-Za-z0-9_-]{1,40}$/.test(s);
  const fresh = (base: string, taken: Set<string>) => { let k = base; let n = 1; while (taken.has(k)) k = `${base}-${n++}`; return k; };
  const gids = new Set<string>();
  for (const [gi, g] of input.slice(0, 6).entries()) {
    if (!g || typeof g !== 'object') continue;
    const raw = (Array.isArray(g.choices) ? g.choices : []).filter((c: any) => c && typeof c === 'object');
    const name = String(g.name ?? '').trim().slice(0, 60);
    if (!raw.length) continue;
    if (!name) return { groups: out, problem: 'Give each group of choices a name, like Size.' };
    const gid = idOk(String(g.id ?? '')) && !gids.has(String(g.id)) ? String(g.id) : fresh(`g${gi}`, gids); gids.add(gid);
    const cids = new Set<string>(); const choices: OptionChoice[] = [];
    for (const [ci, c] of raw.slice(0, 40).entries()) {
      const label = String(c.label ?? '').trim().slice(0, 80);
      if (!label) return { groups: out, problem: `Give every choice in “${name}” a name.` };
      const cid = idOk(String(c.id ?? '')) && !cids.has(String(c.id)) ? String(c.id) : fresh(`c${gi}-${ci}`, cids); cids.add(cid);
      const v = String(c.variantProductId ?? '').trim();
      if (v && v.length <= 160 && !v.includes('/')) choices.push({ id: cid, label, deltaCents: 0, variantProductId: v });
      else choices.push({ id: cid, label, deltaCents: Math.max(-100000, Math.min(100000, Math.round(Number(c.deltaCents) || 0))) });
    }
    out.push({ id: gid, name, choices });
  }
  return { groups: out, problem: '' };
}

/** Why a listing's choices can't be saved as they are, in words ('' when they can). `get`: a product by id; `sellerOf`:
 *  the listing that sells a product now, if any. */
export function choicesProblem(listing: any, groups: OptionGroup[], get: (id: string) => any, sellerOf: (id: string) => any | null): string {
  const me = String(listing?.id ?? '');
  const linked = (groups || []).filter((g) => (g.choices || []).some((c) => pickedBy(listing, c)));
  if (!linked.length) return '';
  if (linked.length > 1) return `Variants go in one group of choices. ${linked.slice(1).map((g) => `“${g.name || 'Another group'}”`).join(' and ')} can only change the price.`;
  if (listing?.type !== 'retail') return 'Only retail products have variants.';
  const seller = sellerOf(me);
  if (seller && String(seller.id) !== me) return `${listing.name || 'This product'} is a variant of ${seller.name || 'another listing'}, so it can’t have variants of its own.`;
  const g = linked[0]; const seen = new Set<string>();
  for (const c of g.choices) {
    const id = pickedBy(listing, c);
    if (!id) return `Every choice in “${g.name || 'this group'}” needs its own product, as the others have one. Pick one for “${c.label || 'this choice'}”, or put it in a group of its own.`;
    const v = get(id);
    if (seen.has(id)) return `${v?.name || 'A product'} is picked by two choices.`;
    seen.add(id);
    if (!v) return `The product picked for “${c.label || 'a choice'}” isn’t in Inventory any more. Pick another.`;
    if (v.status === 'archived') return `${v.name || 'That product'} is archived. Bring it back first, or pick another.`;
    if (v.type !== 'retail') return `${v.name || 'That item'} isn’t a retail product, so it can’t be a variant.`;
    if (variantIdsOf({ ...v, id }).length) return `${v.name || 'That product'} has variants of its own, so it can’t be a variant.`;
    const other = sellerOf(id);
    if (other && String(other.id) !== me) return `${v.name || 'That product'} is already a variant of ${other.name || 'another listing'}. A product can be a variant of one listing.`;
  }
  return '';
}
