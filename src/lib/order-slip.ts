// src/lib/order-slip.ts — THE SMART PACKING SLIP. One sheet per box that answers the questions customers would
// otherwise write in about: what's in the box, what isn't and why, what was swapped, how many boxes are coming,
// how to use it, when it expires, how to return it, and what to do if it arrived damaged. A section appears only
// when it applies to this order. Every promise (return window, damage window, photo rule) is read from the
// business's own settings, so the slip can never say something the shop's policy doesn't.
//
// Pure: give it the order, the shop's retail settings and the products on the order; it returns what to print.

export type SlipSize = '4x6' | 'half' | 'letter';

export interface SlipSettings {
  size: SlipSize;
  notInBox: boolean; swap: boolean; boxes: boolean; care: boolean; useBy: boolean; gift: boolean;
  damage: boolean; returns: boolean; prices: boolean;
}

export function slipSettingsOf(rs: any): SlipSettings {
  const s = (rs && typeof rs.slip === 'object' && rs.slip) || {};
  const on = (k: string, d = true) => (typeof s[k] === 'boolean' ? s[k] : d);
  const size = s.size === 'half' || s.size === 'letter' ? s.size : '4x6';
  return { size, notInBox: on('notInBox'), swap: on('swap'), boxes: on('boxes'), care: on('care'), useBy: on('useBy'), gift: on('gift'), damage: on('damage'), returns: on('returns'), prices: on('prices', false) };
}

export interface SlipLine { name: string; qty: number; priceCents: number | null; note?: string; swapFor?: string; imageUrl?: string }
export interface SlipModel {
  orderNo: string; firstName: string; customerName: string;
  gift: { to: string; message: string } | null;
  inBox: SlipLine[];
  notInBox: { name: string; qty: number; text: string; later: boolean }[];
  swaps: { from: string; to: string; text: string }[];
  boxes: number;
  care: { name: string; note: string }[];
  useBy: { name: string; text: string }[];
  returns: string | null;
  damage: string | null;
  showPrices: boolean;
  packedBy: string; packedOn: string;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0; };
const fmtDate = (iso: unknown) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
const fmtMonth = (iso: unknown) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''; };
const lineName = (l: any) => `${String(l?.name || 'Item')}${l?.optionsLabel ? ` · ${l.optionsLabel}` : ''}`;
const unitCents = (l: any) => { const q = n(l?.qtyOrdered); const disc = Math.max(0, Number(l?.lineDiscountCents) || 0); return Math.max(0, (Number(l?.unitPriceCents) || 0) - (q ? Math.round(disc / q) : 0)); };

export function returnsLine(rs: any): string | null {
  if (rs?.returnsEnabled === false) return null;
  const days = Math.max(1, Math.floor(Number(rs?.returnWindowDays) || 30));
  return `Returns within ${days} days of delivery. Start one from your order page, no email needed.`;
}

export function damageLine(rs: any): string {
  const days = Math.max(0, Math.floor(Number(rs?.deliveryIssueWindowDays) || 0));
  const photo = rs?.policies?.claimPhotosRequired === true;
  const when = days > 0 ? `Within ${days} day${days === 1 ? '' : 's'} of delivery, scan` : 'Scan';
  return `Keep the box. ${when} the code${photo ? ' and add a photo' : ''}. We’ll make it right.`;
}

/** Which batch a line's units come from: the batches already recorded on the order, or the next ones out (FIFO). */
export function nextLots(batches: any[] | undefined, qty: number): { lot: string; expirationDate: string }[] {
  const list = (Array.isArray(batches) ? batches : []).filter((b) => n(b?.stock) > 0)
    .sort((a, b) => String(a.receivedDate || '').localeCompare(String(b.receivedDate || '')));
  const out: { lot: string; expirationDate: string }[] = []; let left = qty;
  for (const b of list) { if (left <= 0) break; left -= n(b.stock); if (b.lot || b.expirationDate) out.push({ lot: String(b.lot || ''), expirationDate: String(b.expirationDate || '') }); }
  return out;
}

export function buildSlip(order: any, rs: any, products: Record<string, any> = {}, now = new Date()): SlipModel {
  const st = slipSettingsOf(rs);
  const lines: any[] = Array.isArray(order?.lines) ? order.lines : [];
  const gift = st.gift && order?.gift && (order.gift.message || order.gift.to) ? { to: String(order.gift.to || '').slice(0, 60), message: String(order.gift.message || '').slice(0, 300) } : null;
  const showPrices = !gift && st.prices;

  const inBox: SlipLine[] = []; const notInBox: SlipModel['notInBox'] = []; const swaps: SlipModel['swaps'] = [];
  for (const l of lines) {
    if (l?.digital === true) continue;
    const ordered = n(l.qtyOrdered); const short = Math.min(n(l.qtyShorted), ordered); const sent = ordered - short;
    if (sent > 0 && l.preorder !== true) inBox.push({ name: lineName(l), qty: sent, priceCents: showPrices ? unitCents(l) : null, ...(l.swapForName ? { swapFor: String(l.swapForName) } : {}), ...(products[l.productId]?.imageUrl ? { imageUrl: String(products[l.productId].imageUrl) } : l.imageUrl ? { imageUrl: String(l.imageUrl) } : {}) });
    if (l.preorder === true && sent > 0) notInBox.push({ name: lineName(l), qty: sent, text: `is a pre-order${l.preorderEtaAt ? `, expected around ${fmtDate(l.preorderEtaAt)}` : ''}. It ships on its own with its own tracking.`, later: true });
    if (short > 0 && l.shortReason !== 'Swapped' && !l.swappedToName) {
      const text = l.status === 'backordered'
        ? `is on back order. It ships on its own${l.backorderEtaAt ? ` by ${fmtDate(l.backorderEtaAt)}` : ''}, and you won’t be charged again.`
        : 'wasn’t available, so it isn’t in this box. It has been refunded.';
      notInBox.push({ name: lineName(l), qty: short, text, later: l.status === 'backordered' });
    }
    if (l.swapForName) {
      const from = lines.find((x) => x.lineId === l.swapForLineId);
      const diff = from ? Math.max(0, (Number(from.unitPriceCents) || 0) - (Number(l.unitPriceCents) || 0)) : 0;
      swaps.push({ from: String(l.swapForName), to: lineName(l), text: diff > 0 ? 'The difference has been refunded.' : 'Same price, nothing more to pay.' });
    }
  }

  const boxes = Math.max(1, Number(order?.packageCount) || (1 + (Array.isArray(order?.extraLabelUrls) ? order.extraLabelUrls.length : 0)));

  const care: SlipModel['care'] = []; const useBy: SlipModel['useBy'] = []; const seen = new Set<string>();
  for (const l of lines) {
    if (l?.digital === true || seen.has(l.productId)) continue; seen.add(l.productId);
    const p = products[l.productId] || {};
    const note = String(p.careNote || '').trim();
    if (st.care && note) care.push({ name: String(l.name || p.name || ''), note: note.slice(0, 240) });
    if (st.useBy) {
      const recorded = order?.saleLots?.[l.lineId];
      const lots = Array.isArray(recorded) && recorded.length ? recorded : nextLots(p.batches, Math.max(1, n(l.qtyOrdered) - n(l.qtyShorted)));
      const parts = lots.filter((x: any) => x.expirationDate || x.lot).slice(0, 2).map((x: any) => [x.lot ? `batch ${x.lot}` : '', x.expirationDate ? `use by ${fmtMonth(x.expirationDate)}` : ''].filter(Boolean).join(' · '));
      if (parts.length) useBy.push({ name: String(l.name || ''), text: parts.join('; ') });
    }
  }

  const first = String(order?.customerName || '').trim().split(/\s+/)[0] || '';
  return {
    orderNo: `#${String(order?.orderNumber ?? '').padStart(4, '0')}`,
    firstName: first, customerName: String(order?.customerName || ''),
    gift, inBox,
    notInBox: st.notInBox ? notInBox : [],
    swaps: st.swap ? swaps : [],
    boxes: st.boxes ? boxes : 1,
    care, useBy,
    returns: st.returns ? (gift ? giftReturnsLine(rs) : returnsLine(rs)) : null,
    damage: st.damage && !gift ? damageLine(rs) : null,
    showPrices,
    packedBy: String(order?.packedByName || order?.claimedByName || '').split(/\s+/)[0] || '',
    packedOn: fmtDate(order?.packedAt || now.toISOString()),
  };
}

export function giftReturnsLine(rs: any): string | null {
  if (rs?.returnsEnabled === false) return null;
  const days = Math.max(1, Math.floor(Number(rs?.returnWindowDays) || 30));
  return `Wrong size or shade? Scan to exchange it for shop credit within ${days} days of delivery. The person who sent it isn’t told.`;
}
