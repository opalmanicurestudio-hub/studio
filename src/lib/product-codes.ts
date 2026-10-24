// src/lib/product-codes.ts — ONE PRODUCT, ONE SET OF CODES, EVERYWHERE (pure). Inventory, the shop, the register,
// packing and receiving all ask this file what a product answers to when it's scanned, so a code that works at the
// register works at the packing bench too:
//   • the shop's own product label (clarityflow://product/<id>)
//   • its barcode and SKU, and any other codes it carries (UPC, GTIN, EAN, extra barcodes kept on the product)
//   • a sealed case's or pallet's own code, worth a case or a pallet of units
// Codes are compared in the one form (lib/code-form, through codesMatch). A variant sold as its own product
// is found by its own codes, or by its parent's when the order has just one of that product's options.
import { codesMatch, codeVariants, parseProductQr } from './retail-orders';

export type CodeTier = 'unit' | 'case' | 'pallet';

const str = (v: any) => String(v ?? '').trim();
const uniq = (xs: string[]) => [...new Set(xs.map(str).filter(Boolean))];

/** The codes that count one unit of this product: barcode, SKU, UPC/GTIN/EAN, and its extra barcodes. */
export function unitCodes(item: any): string[] {
  if (!item) return [];
  const extra = Array.isArray(item.barcodes) ? item.barcodes : [];
  return uniq([item.barcode, item.sku, item.upc, item.gtin, item.ean, ...extra]);
}

/** Every code this product answers to, with what one scan of it is worth. */
export function productCodes(item: any): { code: string; tier: CodeTier }[] {
  const out: { code: string; tier: CodeTier }[] = unitCodes(item).map((code) => ({ code, tier: 'unit' as const }));
  if (str(item?.caseBarcode)) out.push({ code: str(item.caseBarcode), tier: 'case' });
  if (str(item?.palletBarcode)) out.push({ code: str(item.palletBarcode), tier: 'pallet' });
  return out;
}

/** What a scan of `raw` is worth for this product (null when it isn't this product). The shop's own label and the
 *  product's id count one unit. */
export function productMatch(item: any, raw: string, id?: string): CodeTier | null {
  const t = str(raw);
  if (!item || !t) return null;
  const pid = str(id ?? item.id);
  const qr = parseProductQr(t);
  if (qr !== null) return pid && qr === pid ? 'unit' : null;
  if (pid && (t === pid || t.toLowerCase() === pid.toLowerCase())) return 'unit';
  // A pallet or case code first: the same number is never worth less than it says on the carton.
  if (str(item.palletBarcode) && codesMatch(item.palletBarcode, t)) return 'pallet';
  if (str(item.caseBarcode) && codesMatch(item.caseBarcode, t)) return 'case';
  return unitCodes(item).some((c) => codesMatch(c, t)) ? 'unit' : null;
}

/** The product a scan is for, among `items` (inventory as loaded): the label first, then any code, then a bare id. */
export function findByCode<T extends { id: string }>(items: T[], raw: string): { item: T; tier: CodeTier } | null {
  const t = str(raw);
  if (!t) return null;
  const qr = parseProductQr(t);
  if (qr !== null) { const item = items.find((i) => i.id === qr); return item ? { item, tier: 'unit' } : null; }
  for (const item of items) { const tier = productMatch(item, t); if (tier) return { item, tier }; }
  return null;
}

/** Every other product already using one of these codes (so a code isn't given to two products). */
export function codeOwners<T extends { id: string; name?: string }>(items: T[], codes: string[], exceptId?: string): { code: string; item: T }[] {
  const out: { code: string; item: T }[] = [];
  for (const code of uniq(codes)) {
    const owner = items.find((i) => i.id !== exceptId && (i as any).status !== 'archived' && productCodes(i).some((c) => codesMatch(c.code, code)));
    if (owner) out.push({ code, item: owner });
  }
  return out;
}

/** The ways a code may be written in a record, for a database lookup that only matches exactly: as typed, upper case,
 *  in the one form, and a retail barcode's other renderings. At most 10, as one database query takes. */
export function lookupForms(raw: string): string[] {
  return [...codeVariants(str(raw))].slice(0, 10);
}

/** The inventory product an order line is for. A test order's lines point at no real product (so no stock moves) but
 *  stand for one ('test-' and its id), so its codes still scan. */
export const lineProductId = (line: any): string => {
  const own = str(line?.testOfProductId);
  if (own) return own;
  const pid = str(line?.productId);
  return pid.startsWith('test-') ? pid.slice(5) : pid;
};

/** The variant products a parent's options hold their stock in. */
export function variantIdsOf(parent: any): string[] {
  const ids = new Set<string>();
  for (const g of parent?.optionGroups || []) for (const c of g?.choices || []) if (c?.variantProductId) ids.add(String(c.variantProductId));
  return [...ids];
}
