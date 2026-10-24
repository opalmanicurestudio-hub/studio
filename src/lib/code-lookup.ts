// src/lib/code-lookup.ts — ONE LOOKUP FOR EVERY SCANNER (pure; browser and server). The desk, the scan sheet, kits,
// picking, packing, returns, receiving, bins, Inventory and the staff app all ask this what a scan is, so a code that
// works in one place works everywhere:
//   • the shop's own product label (clarityflow://product/<id>) or a link to the product in the shop;
//   • any code a product carries, in its one form (lib/code-form): its SKU, its barcodes, its case or pallet code (worth
//     a case or a pallet of units), or a tag as its reader reports it;
//   • a product's id typed in.
// A listing whose variants hold the stock asks which variant (a scanner with an order or a delivery in front of it picks
// the one that's on it). A code two products share asks which one (the codes check settles it for good).
// Each scanner takes some items and not others (the desk sells retail products; bins label the shop's products), so the
// book knows every item's codes: a code that's exactly an item the scanner doesn't take (archived, say, or not sold
// here) names that item rather than finding something else. A number written differently (leading zeros a
// spreadsheet dropped) still finds its product when nothing has that exact code and only one item has that number;
// two codes with letters are never mixed up (NP-000123 and AB-000123 stay two codes, and HC-50 is not HC50).
import { codeForm, codesOf, holdsCodes, readCode, type CodeKind } from './code-form';
import { looksLikeTag, normTag } from './tags';
import { variantIdsOf } from './variants';

export type CodeHit = { item: any; kind: CodeKind; pack: number; raw: string };
export type CodeBook = {
  /** The codes of the items this scanner takes. */
  byCode: Map<string, CodeHit[]>;
  /** The codes of every other item (archived, or not one this scanner takes): they're never found as something else. */
  others: Map<string, CodeHit[]>;
  /** Every item's numeric codes by their digits (for a number written another way). */
  byNumber: Map<string, CodeHit[]>;
  /** Every item, by id. */
  byId: Map<string, any>;
  /** The ids of the items this scanner takes. */
  takes: Set<string>;
};

/** A number's digits without separators or leading zeros, when it has 6 or more ('' for anything with letters): the
 *  ways a spreadsheet or a scanner may write the same numeric code. */
export function numberKey(raw: any): string {
  const s = String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[\s-]/g, '');
  return /^\d{6,}$/.test(s) ? s.replace(/^0+/, '') : '';
}
export type Found =
  | { kind: 'product'; item: any; pack: number; via: CodeKind | 'label' | 'id' }
  | { kind: 'choose'; listing: any; variants: any[] }
  | { kind: 'clash'; items: any[]; code: string }
  // `owner`: the item with exactly this code, which this scanner doesn't take (`why`: it's archived, it's not one this
  // scanner takes, or it's a listing none of whose variants it takes).
  | { kind: 'none'; code: string; owner?: any; why?: 'archived' | 'elsewhere' | 'no_variants' };

/** Every item's codes, ready to look up (build it once per change to the inventory). Give it every item, with `only`
 *  for the ones this scanner takes; archived items are never taken. `equipment`: equipment and overhead items' SKUs and
 *  barcodes are taken too (kits are made of tools). */
export function codeBook(items: any[], o: { equipment?: boolean; only?: (item: any) => boolean } = {}): CodeBook {
  const byCode = new Map<string, CodeHit[]>(); const others = new Map<string, CodeHit[]>(); const byNumber = new Map<string, CodeHit[]>();
  const byId = new Map<string, any>(); const takes = new Set<string>();
  const add = (map: Map<string, CodeHit[]>, key: string, hit: CodeHit) => { const list = map.get(key) || []; if (!list.some((h) => h.item.id === hit.item.id)) list.push(hit); map.set(key, list); };
  for (const it of items || []) {
    if (!it || it.id == null) continue;
    const id = String(it.id); byId.set(id, it);
    const mine = it.status !== 'archived' && (holdsCodes(it) || !!o.equipment) && (!o.only || !!o.only(it));
    if (mine) takes.add(id);
    for (const c of codesOf(holdsCodes(it) ? it : { ...it, type: 'retail' })) {
      const hit = { item: it, kind: c.kind, pack: c.pack, raw: c.raw };
      add(mine ? byCode : others, c.code, hit);
      const n = numberKey(c.raw); if (n) add(byNumber, n, hit);
    }
  }
  return { byCode, others, byNumber, byId, takes };
}

/** The products a listing sells as its variants (lib/variants, the one rule). */
export { variantIdsOf };

/** A listing's variants that this scanner takes. */
export function variantsIn(book: CodeBook, listing: any): any[] {
  return variantIdsOf(listing).filter((id) => book.takes.has(id)).map((id) => book.byId.get(id)).filter(Boolean);
}

/** What a scan or a typed code is. `variants: false` gives a listing itself rather than asking which variant (a
 *  screen that opens the listing, which shows its variants). */
export function lookupCode(book: CodeBook, raw: any, o: { variants?: boolean } = {}): Found {
  const r = readCode(raw);
  if (r.kind === 'empty') return { kind: 'none', code: '' };
  const text = String(raw ?? '').trim();
  const notHere = (code: string, item: any): Found => ({ kind: 'none', code, owner: item, why: item?.status === 'archived' ? 'archived' : 'elsewhere' });
  const product = (item: any, pack: number, via: CodeKind | 'label' | 'id', code: string): Found => {
    if (!book.takes.has(String(item.id))) return notHere(code, item);
    if (o.variants !== false && pack === 1 && variantIdsOf(item).length) {
      const vs = variantsIn(book, item);
      if (vs.length) return { kind: 'choose', listing: item, variants: vs };
      return { kind: 'none', code, owner: item, why: 'no_variants' };
    }
    return { kind: 'product', item, pack, via };
  };
  // An id, as it was given or (when only one item has it) in other capitals: a scanner set to capitals types them so.
  const idOf = (v: string) => { if (book.byId.has(v)) return book.byId.get(v);
    const lower = v.toLowerCase(); const same = [...book.byId.values()].filter((i) => String(i.id).toLowerCase() === lower);
    return same.length === 1 ? same[0] : null; };
  if (r.kind === 'product') {
    const it = idOf(r.productId);
    return it ? product(it, 1, 'label', text) : { kind: 'none', code: text };
  }
  let hits = book.byCode.get(r.code) || []; let code = r.code;
  if (!hits.length) {
    const other = book.others.get(r.code); if (other?.length) return notHere(r.code, other[0].item);
    // A tag read by a reader in keyboard mode may arrive with colons or dashes between its bytes (a tag only: HC-50 is
    // not HC50).
    if (looksLikeTag(raw)) {
      const tag = codeForm(normTag(raw));
      if (tag && tag !== r.code) {
        hits = (book.byCode.get(tag) || []).filter((h) => h.kind === 'tag'); if (hits.length) code = tag;
        const otherTag = (book.others.get(tag) || []).filter((h) => h.kind === 'tag');
        if (!hits.length && otherTag.length) return notHere(tag, otherTag[0].item);
      }
    }
  }
  if (hits.length > 1) return { kind: 'clash', items: hits.map((h) => h.item), code };
  if (hits.length === 1) return product(hits[0].item, hits[0].pack, hits[0].kind, code);
  // The same number written another way, when nothing has this exact code and only one item has that number (never a
  // guess between two, and never an item this scanner doesn't take).
  const n = numberKey(raw); const near = n ? book.byNumber.get(n) || [] : [];
  const nearIds = [...new Set(near.map((h) => String(h.item.id)))];
  if (nearIds.length === 1) return product(near[0].item, near[0].pack, near[0].kind, r.code);
  const byId = idOf(text);
  if (byId) return product(byId, 1, 'id', text);
  return { kind: 'none', code: r.code };
}

/** Which of these candidates (an order's lines, a delivery's lines…) a scan is for, by product id: the product found,
 *  or the one variant of a scanned listing that's among them. `idOf` gives a candidate's product id. `many` holds every
 *  candidate it could be, so a screen can ask which when there's more than one. */
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

/** When a scan could be more than one of the candidates in front of a screen (a listing's own code with two of its
 *  variants there, or a code two products share), the sentence that asks which; '' when it isn't. `here`: "this pick
 *  list". */
export function askWhich<T>(found: Found, picked: { pick: T | null; many: T[] }, idOf: (c: T) => string, nameOf: (c: T) => string, here: string): string {
  if (picked.pick) return '';
  const seen = new Set<string>(); const names: string[] = [];
  for (const c of picked.many) { const id = idOf(c); if (seen.has(id)) continue; seen.add(id); names.push(nameOf(c)); }
  if (names.length < 2) return '';
  const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(' and ');
  if (found.kind === 'choose') return `That’s ${found.listing.name || 'the listing'}’s own code, and ${here} has ${names.length} of its variants: ${list}. Scan the variant’s own code, or tap it.`;
  if (found.kind === 'clash') return `That code is on ${names.length} products in ${here}: ${list}. Scan another of their codes, or tap the right one.`;
  return '';
}

/** A case or pallet, in words: "a case of 12". */
export const packWords = (found: Found): string => (found.kind === 'product' && found.pack > 1 ? `${found.via === 'pallet' ? 'a pallet' : 'a case'} of ${found.pack}` : '');

/** Why a scan found nothing this scanner takes, in words ('' when no item has the code). `notUsed` says what this
 *  scanner doesn't do with it ("isn’t sold at the desk"); `verb` what it would ("sell"). */
export function notHereWords(found: Found, notUsed: string, verb: string): string {
  if (found.kind !== 'none' || !found.owner) return '';
  const name = String(found.owner.name || 'That item');
  if (found.why === 'archived') return `That’s ${name}, which is archived. Bring it back in Inventory to ${verb} it.`;
  if (found.why === 'no_variants') return `${name} has no variants to ${verb} yet. Add them on its page in Inventory.`;
  return `That’s ${name}, which ${notUsed}.`;
}
