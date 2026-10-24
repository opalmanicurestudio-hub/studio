// src/lib/pos-scan.ts — ONE SCAN, ANYWHERE ON THE POS (pure). Camera, a USB / Bluetooth scanner, or typed into search.
// Works out what was scanned — PRODUCTS FIRST (a 12–13 digit barcode looks like a check-in token, which is why product
// scans used to fail at checkout), then appointment / walk-in tickets:
//   • your printed product labels (clarityflow://product/<id>) or a shop product link
//   • a barcode, SKU or any other code the product carries, compared in the one form (lib/code-form)
//   • a listing whose variants hold the stock → "which one?"
//   • a ticket: short code, check-in token or visit-link URL (found here if it's in today's list; otherwise the
//     server lookup takes over)
import { parseOrderQr } from '@/lib/retail-orders';
import { parseScan } from '@/lib/scan-codes';
import { codeBook, lookupCode, notHereWords, type CodeBook } from '@/lib/code-lookup';
import { variantIdsOf } from '@/lib/variants';

export type ScanHit =
  | { kind: 'product'; item: any; pack: number; packKind?: 'case' | 'pallet' }   // pack > 1: a case's or pallet's code
  | { kind: 'choose'; parent: any; variants: any[] }
  | { kind: 'clash'; items: any[] }   // a code two products share: which one?
  | { kind: 'unsold'; text: string }   // exactly the code of an item the desk doesn't sell (archived, or not retail): why
  | { kind: 'ticket'; record: any; walkIn: boolean }
  | { kind: 'order'; value: string }   // an online order's pickup QR
  | { kind: 'lookup'; value: string }
  | { kind: 'empty' };

/** Can this inventory item be sold at the desk? (Retail stock — not professional supplies or equipment.) */
export const isSellable = (i: any) => !!i && i.status !== 'archived' && (i.type === 'retail' || Number(i.msrp) > 0);
/** On-shelf stock (reserved online orders excluded). */
export const onHand = (i: any) => Math.max(0, (Number(i?.totalStock) || 0) - (Number(i?.stockReserved) || 0));
/** A listing's variants that the desk can sell, in the order its choices show them (lib/variants). */
export function variantsOf(parent: any, inventory: any[]) {
  const byId = new Map((inventory || []).map((i: any) => [String(i.id), i]));
  return variantIdsOf(parent).map((id) => byId.get(id)).filter((v: any) => !!v && isSellable(v));
}

/** The desk's products, ready to look up (lib/code-lookup): what it can sell, knowing every other item's codes too. */
export const deskBook = (inventory: any[]): CodeBook => codeBook(inventory || [], { equipment: true, only: isSellable });

export function identifyPosScan(raw: string, ctx: { inventory: any[]; appointments: any[]; walkIns: any[]; book?: CodeBook }): ScanHit {
  const t = String(raw ?? '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
  if (!t) return { kind: 'empty' };
  if (parseOrderQr(t)) return { kind: 'order', value: t };   // an online order's pickup code → order pickup
  // A product: its label or link, any code it carries (the one lookup every scanner uses), or its id.
  const found = lookupCode(ctx.book || deskBook(ctx.inventory), t);
  if (found.kind === 'product') return { kind: 'product', item: found.item, pack: found.pack, ...(found.pack > 1 ? { packKind: found.via === 'pallet' ? 'pallet' as const : 'case' as const } : {}) };
  if (found.kind === 'choose') return { kind: 'choose', parent: found.listing, variants: found.variants };
  if (found.kind === 'clash') return { kind: 'clash', items: found.items };
  if (found.kind === 'none' && found.owner) return { kind: 'unsold', text: notHereWords(found, 'isn’t sold at the desk', 'sell') };
  // A ticket in today's list
  const parsed = parseScan(t); const value = parsed.kind === 'empty' ? t : parsed.value; const needle = value.toUpperCase();
  const carries = (r: any) => { const code = String(r?.shortCode ?? '').trim().toUpperCase(); const token = String(r?.checkInToken ?? '').trim();
    return (!!code && code === needle) || (!!token && (token === value || token.toUpperCase() === needle)); };
  const apt = (ctx.appointments || []).find(carries); if (apt) return { kind: 'ticket', record: apt, walkIn: false };
  const row = (ctx.walkIns || []).find(carries); if (row) return { kind: 'ticket', record: row, walkIn: true };
  return { kind: 'lookup', value };
}
