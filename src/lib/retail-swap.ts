// src/lib/retail-swap.ts — WHEN SOMETHING ISN'T THERE: SWAP OR REFUND. At checkout the customer says, for each item,
// what they want if it turns out to be out: the best match the packer finds, a backup they pick themselves, or a
// refund. An item they leave as it is follows the shop's choice (Setup), and a product the shop never swaps is always
// refunded. Everything is decided at checkout, so nobody waits on an answer while packing. A swap never costs more
// than what was paid: only items at the same price or less are offered (unless the shop chose to cover a little more
// itself), and when one costs less, the difference (with its tax) goes back to them. At packing, a swap closes the
// missing line and adds the replacement as its own line, scanned in like any other. Pure, so the client and the
// server apply a swap identically. (Orders placed before this could say "ask me first": those are still asked.)
import { effectiveUnitCents, taxShareCents } from './restocking';

export { effectiveUnitCents };

export type IfUnavailable = 'refund' | 'similar' | 'ask';
export const IF_UNAVAILABLE: { id: IfUnavailable; label: string; note: string }[] = [
  { id: 'refund', label: 'Refund it', note: 'You get your money back for that item.' },
  { id: 'similar', label: 'Best match', note: 'We pick a close match. Never more than you paid.' },
  { id: 'ask', label: 'Ask me first', note: 'We text you a suggestion. No answer means a refund.' },
];
export const normaliseIfUnavailable = (v: unknown): IfUnavailable => (v === 'similar' || v === 'ask' ? v : 'refund');

// ── EACH ITEM'S OWN CHOICE ────────────────────────────────────────────────────────────────────────────────────────
export type SwapHow = 'match' | 'backup' | 'refund';
export const SWAP_HOWS: { id: SwapHow; label: string; note: string }[] = [
  { id: 'match', label: 'Best match', note: 'We pick one at the same price or less, another color of it first.' },
  { id: 'backup', label: 'This one instead', note: 'You pick it now.' },
  { id: 'refund', label: 'Refund it', note: 'Your money back for that item.' },
];
/** How much more a swap may cost when the shop covers the difference itself (Setup), as a percentage of the price. */
export const COVER_MORE_PCT = 15;

/** What an item the customer left as it is gets: the shop's choice in Setup, a best match unless it chose refunds. */
export const swapDefault = (rs: any): 'match' | 'refund' => (rs?.swapDefault === 'refund' ? 'refund' : 'match');
/** Customers pick for each item (on unless the shop turned it off; off, one choice covers the whole order). */
export const perItemOn = (rs: any): boolean => rs?.swapPerItem !== false;
/** The shop lets a swap cost a little more and covers the difference itself (off unless it turned it on). */
export const coverMore = (rs: any): boolean => rs?.swapCoverMore === true;
/** The most a replacement may cost for an item paid at `unitCents`: the same, or up to COVER_MORE_PCT more when the
 *  shop covers it. */
export const swapCapCents = (unitCents: number, rs?: any): number => {
  const u = Math.max(0, Math.round(Number(unitCents) || 0));
  return coverMore(rs) ? Math.floor((u * (100 + COVER_MORE_PCT)) / 100) : u;
};

export interface IfOut { how: SwapHow; backupId?: string; backupName?: string; backupPriceCents?: number; backupImage?: string; backupListingId?: string }

/** A choice as checkout received it: a known way, and a backup's id only for "this one instead". */
export function normaliseIfOut(v: any): { how: SwapHow; backupId?: string } | null {
  if (!v || typeof v !== 'object') return null;
  const how = v.how === 'match' || v.how === 'backup' || v.how === 'refund' ? v.how : null;
  if (!how) return null;
  const id = String(v.backupId || '').trim().slice(0, 120);
  if (how === 'backup') return /^[A-Za-z0-9_-]{1,120}$/.test(id) ? { how, backupId: id } : null;
  return { how };
}

/** What the customer asked for this item if it's out. Its own choice from checkout; else the order's one choice (an
 *  order from before, or a shop that asks once per order); a product the shop never swaps is refunded. 'ask' only
 *  for an order placed when customers could ask to be asked. */
export function lineIfOut(order: any, line: any): { how: SwapHow | 'ask'; backup?: SwapItem } {
  if (line?.noSwap === true) return { how: 'refund' };
  const io = line?.ifOut;
  if (io && (io.how === 'match' || io.how === 'refund')) return { how: io.how };
  if (io && io.how === 'backup') {
    if (!io.backupId) return { how: 'refund' };
    return { how: 'backup', backup: { productId: String(io.backupId), name: String(io.backupName || 'Their backup'), unitPriceCents: Math.max(0, Math.round(Number(io.backupPriceCents) || 0)), imageUrl: io.backupImage || '', ...(io.backupListingId ? { listingId: String(io.backupListingId) } : {}) } };
  }
  const pref = normaliseIfUnavailable(order?.ifUnavailable);
  return { how: pref === 'similar' ? 'match' : pref };
}

/** The words a choice is shown in, to the customer and the packer. */
export function ifOutWords(c: { how: SwapHow | 'ask'; backup?: { name?: string } }): string {
  if (c.how === 'backup') return `${c.backup?.name || 'Their backup'} instead`;
  if (c.how === 'match') return 'Best match';
  if (c.how === 'ask') return 'Ask me first';
  return 'Refund it';
}

/** How long a customer has to answer before it falls back to a refund. */
export const SWAP_ANSWER_HOURS = 2;

export interface SwapItem { productId: string; name: string; unitPriceCents: number; sku?: string; barcode?: string; optionsLabel?: string; imageUrl?: string; listingId?: string }

export function swapLines(order: { lines: any[]; subtotalCents?: number; taxCents?: number }, lineId: string, sub: SwapItem, newLineId: string): { lines: any[]; qty: number; refundCents: number; newLine: any } {
  const idx = order.lines.findIndex((l) => l.lineId === lineId);
  if (idx === -1) throw new Error('That item isn’t on this order.');
  const line = order.lines[idx];
  const qty = (Number(line.qtyOrdered) || 0) - (Number(line.qtyScanned) || 0) - (Number(line.qtyShorted) || 0);
  if (qty <= 0) throw new Error('Nothing left to swap on that item.');
  // What each unit was paid, after any promo code: never more back than that, and never more charged.
  const orig = effectiveUnitCents(line); const price = Math.max(0, Math.round(Number(sub.unitPriceCents) || 0));
  const closed = { ...line, qtyShorted: (Number(line.qtyShorted) || 0) + qty, status: 'refunded', shortReason: 'Swapped', swappedToLineId: newLineId, swappedToName: sub.name };
  const newLine = {
    lineId: newLineId, productId: sub.productId, sku: sub.sku || '', barcode: sub.barcode || '', name: sub.name, optionsLabel: sub.optionsLabel || '', ...(sub.listingId ? { listingId: sub.listingId } : {}),
    unitPriceCents: price, qtyOrdered: qty, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending',
    swapForLineId: lineId, swapForName: line.name, lineDiscountCents: Math.max(0, price - orig) * qty,
    // If the replacement turns out to be missing too: a backup they picked is refunded (they wanted that one); a best
    // match may be matched again. Never swapped again against what they chose.
    ...(line.noSwap === true || line.ifOut?.how === 'backup' || line.ifOut?.how === 'refund' ? { ifOut: { how: 'refund' } } : line.ifOut?.how === 'match' ? { ifOut: { how: 'match' } } : {}),
  };
  const diff = Math.max(0, orig - price) * qty;
  const lines = [...order.lines.slice(0, idx), closed, ...order.lines.slice(idx + 1), newLine];
  return { lines, qty, refundCents: diff + taxShareCents(order, diff), newLine };
}


/** Close matches for a missing item, best first: the same product's other colors (its listing's other variants), then
 *  the same category if it has one, nearest price first. In stock, sold online, never a product the shop never swaps,
 *  and never dearer than what was paid (up to COVER_MORE_PCT more when the shop covers it, `rs`). `inventory` as the
 *  shop sells it (lib/variants soldAs): a listing's variants in its place. */
export function similarItems(inventory: any[], line: { productId: string; unitPriceCents?: number; listingId?: string }, max = 6, rs?: any): SwapItem[] {
  const me = inventory.find((i) => i.id === line.productId) || {};
  const price = Number(line.unitPriceCents) || 0;
  const cap = price ? swapCapCents(price, rs) : 0;
  const family = String(line.listingId || me.listingId || '');
  const priceOf = (i: any) => Math.round((Number(i.msrp) || 0) * 100);
  const free = (i: any) => (Number(i.totalStock) || 0) - (Number(i.stockReserved) || 0);
  const kin = (i: any) => !!family && String(i.listingId || '') === family;
  return inventory
    .filter((i) => i && i.id !== line.productId && i.showOnline === true && i.status !== 'archived' && i.noSwap !== true && free(i) > 0 && priceOf(i) > 0)
    .filter((i) => kin(i) || !me.category || i.category === me.category)
    .filter((i) => !cap || priceOf(i) <= cap)
    .sort((a, b) => (Number(kin(b)) - Number(kin(a))) || (Math.abs(priceOf(a) - price) - Math.abs(priceOf(b) - price)))
    .slice(0, max)
    .map((i) => ({ productId: i.id, name: String(i.name || 'Item'), unitPriceCents: priceOf(i), sku: i.sku || '', barcode: i.barcode || '', imageUrl: (Array.isArray(i.imageUrls) && i.imageUrls[0]) || i.imageUrl || '', ...(i.listingId ? { listingId: String(i.listingId) } : {}) }));
}

/** A YES/NO text reply about a swap. */
export function swapReply(body: string): 'yes' | 'no' | null {
  const t = String(body || '').trim().toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (/^(y|yes|yeah|yep|ok|okay|sure|swap|yes please)$/.test(t)) return 'yes';
  if (/^(n|no|nope|refund|no thanks|no thank you)$/.test(t)) return 'no';
  return null;
}
