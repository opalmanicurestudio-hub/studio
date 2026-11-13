// src/lib/register-scan.ts — THE REGISTER SCANS WHAT HAS A BARCODE (pure; the same on every screen). At the register,
// a product with a barcode on it (the maker's, or the shop's own label printed from the app) is added by scanning it,
// the way a supermarket checkout works: tapping its tile asks for the scan instead, so the product in the customer's hand
// is the one that's sold, in the right color. Scanning a different product than the one tapped adds the one scanned. The
// number under the barcode can be typed instead, and an item that won't scan is added on a manager's PIN with a reason
// (checked on the server, api/approvals, and kept in the audit log). Services, memberships, packages, gift cards and
// products with nothing to scan stay a tap. On unless the shop turns it off in Setup (`scanAtRegister: false`).
import { lookupCode, type CodeBook } from './code-lookup';
import { variantIdsOf } from './variants';

export const registerScanOn = (rs: any): boolean => rs?.scanAtRegister !== false;

const filled = (v: any) => v != null && String(v).trim() !== '';

/** A barcode on the product itself: the maker's (UPC, EAN, GTIN or another unit barcode), or the shop's own label,
 *  printed from the app (lib/product-labels), which carries its SKU or its QR code. A SKU alone isn't one: nothing may
 *  be printed on the product yet. */
export function hasBarcode(item: any): boolean {
  if (!item) return false;
  if ([item.barcode, item.upc, item.gtin, item.ean].some(filled)) return true;
  if (Array.isArray(item.barcodes) && item.barcodes.some(filled)) return true;
  return filled(item.labelPrintedAt);
}

/** A product added at the register by its scan, while the shop scans there: one that's sold and has a barcode. A listing
 *  whose variants are sold is chosen as a variant first (each variant asks for its own scan); a download has nothing
 *  to scan. */
export function mustScanAtRegister(item: any, rs: any): boolean {
  if (!registerScanOn(rs) || !item || item.digital === true || item.giftCard === true || item.type === 'gift_card') return false;
  if (variantIdsOf(item).length) return false;
  return hasBarcode(item);
}

export type RegisterMatch =
  | { kind: 'same'; item: any }
  | { kind: 'other'; item: any }
  | { kind: 'none'; message: string };

/** What a code scanned or typed for a tapped product means: that product; another one the register sells (the one in
 *  their hand is what's sold); or nothing it can add. A typed product id doesn't count as a scan. */
export function registerMatch(book: CodeBook, raw: string, tapped: any, o: { typed?: boolean } = {}): RegisterMatch {
  const found = lookupCode(book, raw);
  const tappedId = String(tapped?.id ?? '');
  if (found.kind === 'product') {
    if (o.typed && (found.via === 'id' || found.via === 'label')) return { kind: 'none', message: 'Type the number printed under the barcode.' };
    // A case's or pallet's code adds a whole case where the register hears scans; here it's one item that's asked for.
    if (found.pack > 1) return { kind: 'none', message: 'That’s the code on a case. Scan the barcode on one item.' };
    return String(found.item?.id) === tappedId ? { kind: 'same', item: found.item } : { kind: 'other', item: found.item };
  }
  // A listing's own code is on every color, so it can't say which one is in their hand.
  if (found.kind === 'choose') return { kind: 'none', message: `That’s the code for ${found.listing?.name || 'a listing'}, not one color. Scan the barcode on the item itself.` };
  if (found.kind === 'clash') {
    const v = found.items.find((x: any) => String(x?.id) === tappedId);
    return v ? { kind: 'same', item: v } : { kind: 'none', message: 'That code is on more than one product. Fix it in Codes and listings.' };
  }
  if (found.kind === 'none' && found.owner) return { kind: 'none', message: `That’s ${found.owner?.name || 'a product'}, which isn’t sold at the register.` };
  return { kind: 'none', message: o.typed ? 'That number isn’t on a product here. Check it and try again.' : 'That code isn’t on a product here.' };
}

/** Sold at the register, with nothing on it to scan yet: each of them gets a label to print (lib/product-labels). A
 *  listing counts as its variants; downloads have nothing to scan. */
export function noBarcodeYet(items: any[], sellable: (i: any) => boolean): any[] {
  return (items || []).filter((i) => sellable(i) && i.digital !== true && !variantIdsOf(i).length && !hasBarcode(i));
}
