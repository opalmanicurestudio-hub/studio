// src/lib/pickup-pass.ts — THE PICKUP CODE A CUSTOMER SAYS AT THE COUNTER OR THE CAR, AND WHO COLLECTED IT (server).
// Every pickup order has a 4-digit code beside its QR code on the order page. It's worked out by the server from the
// order and the server's own secret, so it's never written anywhere: the database holds nothing a person could read it
// from, and only the order page (with the customer's pass) is given it. The team types the code the person says; the
// server checks it, and a few wrong tries in a row stop the code working for that order (the QR code, or a check of
// their name and phone, still does), so it can't be guessed.
//
// The customer can name someone else to collect it. The team's screens show who's coming, and the handoff records who
// handed it over, who collected it and how it was checked (lib/retail-fulfill).
import { createHmac, timingSafeEqual } from 'crypto';

const secret = () => String(process.env.ORDER_TRACK_SECRET || process.env.RETAIL_QR_SECRET || process.env.CRON_SECRET || '');

export { PIN_TRIES } from './pickup-limits';

/** What the code is worked out from: the order's QR code, so the parts of an order split for a back-ordered item
 *  (which share it) share one code too; the order's id for an order without one. */
export const pinKeyOf = (order: any, orderId: string): string => String(order?.qrToken || orderId || '');

/** The order's pickup code: 4 digits, the same every time for the same order. '' when the server has no secret. */
export function pickupPin(tenantId: string, key: string): string {
  const s = secret(); if (!s || !tenantId || !key) return '';
  const h = createHmac('sha256', s).update(`pin:${tenantId}:${key}`).digest();
  return String(h.readUInt32BE(0) % 10000).padStart(4, '0');
}

/** Whether a code someone said is the order's (spaces and dashes ignored). */
export function pinMatches(tenantId: string, key: string, said: string): boolean {
  const want = pickupPin(tenantId, key); const got = String(said || '').replace(/[\s-]/g, '');
  if (!want || !/^\d{4}$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

/** A name the customer gave for whoever's collecting: trimmed, one line, short. */
export function cleanCollector(v: any): string {
  return String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export type HandoffMethod = 'qr' | 'pin' | 'checked';
export const HANDOFF_WORDS: Record<HandoffMethod, string> = { qr: 'QR code scanned', pin: 'Pickup code checked', checked: 'Name and phone checked' };

/** The handoff as it's recorded on the order: who handed it over, who collected it, and how it was checked. */
export function handoffRecord(order: any, actor: { id: string; name: string }, method: HandoffMethod, check?: string) {
  const other = cleanCollector(order?.collector?.name);
  return {
    at: new Date().toISOString(), byId: actor.id, byName: actor.name, method,
    ...(check ? { check: String(check).slice(0, 140) } : {}),
    collectedBy: other ? 'someone_else' : 'customer',
    collectorName: other || String(order?.customerName || '').trim().split(/\s+/)[0] || null,
  };
}
