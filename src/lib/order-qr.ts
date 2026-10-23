// src/lib/order-qr.ts — THE ORDER'S OWN CODE (server). An HMAC-signed token for one order: printed as the pickup code,
// scanned at handover, and carried by the team's links to the order's packing slip and bag label. A raw order id is
// never scannable. (lib/order-access decides what a customer holding the order page link may do.)
import { createHmac, timingSafeEqual } from 'crypto';

function qrSecret(): string {
  return process.env.RETAIL_QR_SECRET || process.env.STRIPE_SECRET_KEY || 'dev-secret';
}

export function makeQrToken(orderId: string): string {
  const sig = createHmac('sha256', qrSecret()).update(orderId).digest('hex').slice(0, 24);
  return `${orderId}.${sig}`;
}

/** Returns the orderId if the token is authentic, null otherwise. */
export function verifyQrToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const orderId = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = createHmac('sha256', qrSecret()).update(orderId).digest('hex').slice(0, 24);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? orderId : null;
}
