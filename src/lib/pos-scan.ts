// src/lib/pos-scan.ts — ONE SCAN, ANYWHERE ON THE POS (pure). Camera, a USB / Bluetooth scanner, or typed into search.
// Works out what was scanned — PRODUCTS FIRST (a 12–13 digit barcode looks like a check-in token, which is why product
// scans used to fail at checkout), then appointment / walk-in tickets:
//   • your printed product labels (clarityflow://product/<id>) or a shop product link
//   • a barcode or SKU — tolerant of leading zeros and UPC-A vs EAN-13 (the retail matcher)
//   • a parent product whose sizes / shades hold the stock → "which one?"
//   • a ticket: short code, check-in token or visit-link URL (found here if it's in today's list; otherwise the
//     server lookup takes over)
import { codesMatch, hasStockVariants } from '@/lib/retail-orders';
import { parseScan } from '@/lib/scan-codes';

export type ScanHit =
  | { kind: 'product'; item: any }
  | { kind: 'choose'; parent: any; variants: any[] }
  | { kind: 'ticket'; record: any; walkIn: boolean }
  | { kind: 'lookup'; value: string }
  | { kind: 'empty' };

/** Can this inventory item be sold at the desk? (Retail stock — not professional supplies or equipment.) */
export const isSellable = (i: any) => !!i && i.status !== 'archived' && (i.type === 'retail' || Number(i.msrp) > 0);
/** On-shelf stock (reserved online orders excluded). */
export const onHand = (i: any) => Math.max(0, (Number(i?.totalStock) || 0) - (Number(i?.stockReserved) || 0));
export function variantsOf(parent: any, inventory: any[]) {
  const ids = new Set<string>(); for (const g of parent?.optionGroups || []) for (const c of g.choices || []) if (c.variantProductId) ids.add(c.variantProductId);
  return (inventory || []).filter((i) => ids.has(i.id));
}

export function identifyPosScan(raw: string, ctx: { inventory: any[]; appointments: any[]; walkIns: any[] }): ScanHit {
  const t = String(raw ?? '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
  if (!t) return { kind: 'empty' };
  const inv = (ctx.inventory || []).filter(isSellable);
  const asProduct = (item: any): ScanHit => (hasStockVariants(item.optionGroups) ? { kind: 'choose', parent: item, variants: variantsOf(item, ctx.inventory) } : { kind: 'product', item });
  // Your printed labels, or a shop product link
  const link = /clarityflow:\/\/product\/([A-Za-z0-9_-]+)/i.exec(t) || /\/product\/([A-Za-z0-9_-]{6,})/.exec(t);
  if (link) { const item = inv.find((i) => i.id === link[1]); if (item) return asProduct(item); }
  // A barcode or SKU (tolerant), or a bare product id
  const byCode = inv.find((i) => [i.barcode, i.sku, ...(Array.isArray(i.barcodes) ? i.barcodes : [])].some((c) => c && codesMatch(String(c), t))) || inv.find((i) => i.id === t);
  if (byCode) return asProduct(byCode);
  // A ticket in today's list
  const parsed = parseScan(t); const value = parsed.kind === 'empty' ? t : parsed.value; const needle = value.toUpperCase();
  const carries = (r: any) => { const code = String(r?.shortCode ?? '').trim().toUpperCase(); const token = String(r?.checkInToken ?? '').trim();
    return (!!code && code === needle) || (!!token && (token === value || token.toUpperCase() === needle)); };
  const apt = (ctx.appointments || []).find(carries); if (apt) return { kind: 'ticket', record: apt, walkIn: false };
  const row = (ctx.walkIns || []).find(carries); if (row) return { kind: 'ticket', record: row, walkIn: true };
  return { kind: 'lookup', value };
}
