// src/lib/code-lookup.ts — ONE LOOKUP FOR EVERY SCANNER (pure; browser and server). The desk, the scan sheet, kits,
// picking, packing, returns, receiving, bins, Inventory and the staff app all ask this what a scan is, so a code that
// works in one place works everywhere:
//   • the shop's own product label (clarityflow://product/<id>) or a link to the product in the shop;
//   • any code a product carries, in its one form (lib/code-form): its SKU, its barcodes, its case or pallet code (worth
//     a case or a pallet of units), or a tag as its reader reports it;
//   • a product's id typed in.
// A listing whose variants hold the stock asks which variant (a scanner with an order or a delivery in front of it picks
// the one that's on it). A code two products share asks which one (the codes check settles it for good).
// A number written differently (leading zeros a spreadsheet dropped, dashes) still finds its product when exactly one
// product has that number; two codes with letters are never mixed up (NP-000123 and AB-000123 stay two codes).
import { codeForm, codesOf, holdsCodes, readCode, type CodeKind } from './code-form';
import { normTag } from './tags';

export type CodeHit = { item: any; kind: CodeKind; pack: number; raw: string };
export type CodeBook = { byCode: Map<string, CodeHit[]>; byId: Map<string, any>; byNumber: Map<string, CodeHit[]> };

/** A number's digits without separators or leading zeros, when it has 6 or more ('' for anything with letters): the
 *  ways a spreadsheet or a scanner may write the same numeric code. */
export function numberKey(raw: any): string {
  const s = String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[\s-]/g, '');
  return /^\d{6,}$/.test(s) ? s.replace(/^0+/, '') : '';
}
export type Found =
  | { kind: 'product'; item: any; pack: number; via: CodeKind | 'label' | 'id' }
  | { kind: 'choose'; listing: any; variants: any[] }
  | { kind: 'clash'; items: any[] }
  | { kind: 'none'; code: string };

/** Every product's codes, ready to look up (build it once per change to the inventory). Archived products hold no
 *  codes. `equipment`: equipment and overhead items' SKUs and barcodes too (kits are made of tools). */
export function codeBook(items: any[], o: { equipment?: boolean } = {}): CodeBook {
  const byCode = new Map<string, CodeHit[]>(); const byId = new Map<string, any>(); const byNumber = new Map<string, CodeHit[]>();
  const add = (map: Map<string, CodeHit[]>, key: string, hit: CodeHit) => { const list = map.get(key) || []; if (!list.some((h) => h.item.id === hit.item.id)) list.push(hit); map.set(key, list); };
  for (const it of items || []) {
    if (!it || it.id == null) continue;
    byId.set(String(it.id), it);
    if (it.status === 'archived') continue;
    const codes = holdsCodes(it) ? codesOf(it) : o.equipment ? codesOf({ ...it, type: 'retail' }) : [];
    for (const c of codes) {
      const hit = { item: it, kind: c.kind, pack: c.pack, raw: c.raw };
      add(byCode, c.code, hit);
      const n = numberKey(c.raw); if (n) add(byNumber, n, hit);
    }
  }
  return { byCode, byId, byNumber };
}

/** The variant products a listing's options hold its stock in (the ids). */
export function variantIdsOf(listing: any): string[] {
  const ids = new Set<string>();
  for (const g of Array.isArray(listing?.optionGroups) ? listing.optionGroups : []) for (const c of Array.isArray(g?.choices) ? g.choices : []) if (c?.variantProductId) ids.add(String(c.variantProductId));
  return [...ids];
}

/** A listing's variants that are in the book and not archived. */
export function variantsIn(book: CodeBook, listing: any): any[] {
  return variantIdsOf(listing).map((id) => book.byId.get(id)).filter((v) => !!v && v.status !== 'archived' && v.id !== listing?.id);
}

/** What a scan or a typed code is. `variants: false` gives a listing itself rather than asking which variant (a
 *  screen that opens the listing, which shows its variants). */
export function lookupCode(book: CodeBook, raw: any, o: { variants?: boolean } = {}): Found {
  const r = readCode(raw);
  if (r.kind === 'empty') return { kind: 'none', code: '' };
  const product = (item: any, pack: number, via: CodeKind | 'label' | 'id'): Found => {
    if (o.variants !== false && pack === 1) { const vs = variantsIn(book, item); if (vs.length) return { kind: 'choose', listing: item, variants: vs }; }
    return { kind: 'product', item, pack, via };
  };
  if (r.kind === 'product') {
    const it = book.byId.get(r.productId);
    return it && it.status !== 'archived' ? product(it, 1, 'label') : { kind: 'none', code: String(raw).trim() };
  }
  let hits = book.byCode.get(r.code) || [];
  // A tag read by a reader in keyboard mode may arrive with colons or dashes between its bytes.
  if (!hits.length) { const tag = codeForm(normTag(raw)); if (tag && tag !== r.code) hits = book.byCode.get(tag) || []; }
  if (hits.length > 1) return { kind: 'clash', items: hits.map((h) => h.item) };
  if (hits.length === 1) return product(hits[0].item, hits[0].pack, hits[0].kind);
  // The same number written another way, when only one product has it (never a guess between two).
  const n = numberKey(raw); const near = n ? book.byNumber.get(n) || [] : [];
  if (near.length === 1) return product(near[0].item, near[0].pack, near[0].kind);
  const byId = book.byId.get(String(raw ?? '').trim());
  if (byId && byId.status !== 'archived') return product(byId, 1, 'id');
  return { kind: 'none', code: r.code };
}

/** Which of these candidates (an order's lines, a delivery's lines…) a scan is for, by product id: the product found,
 *  or the one variant of a scanned listing that's among them. `idOf` gives a candidate's product id. */
export function pickFor<T>(found: Found, candidates: T[], idOf: (c: T) => string): { pick: T | null; many: T[] } {
  if (found.kind === 'product') { const list = candidates.filter((c) => idOf(c) === String(found.item.id)); return { pick: list[0] || null, many: list }; }
  if (found.kind === 'choose') {
    const ids = new Set(found.variants.map((v) => String(v.id)).concat(String(found.listing.id)));
    const list = candidates.filter((c) => ids.has(idOf(c)));
    const distinct = [...new Set(list.map(idOf))];
    return { pick: distinct.length === 1 ? list[0] : null, many: list };
  }
  if (found.kind === 'clash') {
    const ids = new Set(found.items.map((i) => String(i.id)));
    const list = candidates.filter((c) => ids.has(idOf(c)));
    const distinct = [...new Set(list.map(idOf))];
    return { pick: distinct.length === 1 ? list[0] : null, many: list };
  }
  return { pick: null, many: [] };
}

/** A case or pallet, in words: "a case of 12". */
export const packWords = (found: Found): string => (found.kind === 'product' && found.pack > 1 ? `${found.via === 'pallet' ? 'a pallet' : 'a case'} of ${found.pack}` : '');
