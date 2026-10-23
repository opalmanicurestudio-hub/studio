// src/lib/gift-orders.ts — GIFT ORDERS. A gift carries who it's for and a message; the slip shows no prices, and
// the recipient gets a gift code (separate from the buyer's order code) that opens only the gift exchange page.
import { randomBytes } from 'crypto';
import { windowOpen } from './order-windows';

export function cleanGift(raw: any): { to: string; message: string } | null {
  if (!raw || raw.isGift !== true) return null;
  const to = String(raw.to || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const message = String(raw.message || '').replace(/\s+\n/g, '\n').trim().slice(0, 300);
  return { to, message };
}

export function giftToken(): string {
  return randomBytes(12).toString('base64url');
}

/** Whether the recipient can still exchange: the shop's returns switch and window, counted from delivery. */
export function giftWindow(order: any, rs: any, now = Date.now()): { open: boolean; days: number; reason: string } {
  if (rs?.returnsEnabled === false) return { open: false, days: 0, reason: 'This shop doesn’t take returns or exchanges.' };
  const days = Math.max(1, Math.floor(Number(rs?.returnWindowDays) || 30));
  if (!['shipped', 'handed_off', 'completed'].includes(String(order?.stage || ''))) return { open: false, days, reason: 'Exchanges open once the gift has arrived.' };
  // From delivery, or the ship date when the carrier never confirmed it (lib/order-windows).
  if (!windowOpen(order?.completedAt || order?.deliveredAt ? order : { ...order, completedAt: order?.shippedAt }, days, now)) return { open: false, days, reason: `Exchanges are open for ${days} days after delivery, and that time has passed for this gift.` };
  return { open: true, days, reason: '' };
}
