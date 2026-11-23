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

// ─── BAG TAGS ──────────────────────────────────────────────────────────────────
// Each bag of an order has its own code (lib/bag-tag), printed on its tag: "clarityflow://bag/<orderId>.<n>.<sig>".
// It's never the customer's pickup code, so scanning a bag can't hand an order over by itself: the bag is scanned, then
// the customer's code (lib/retail-fulfill). Signed here, for this business, order and bag, so a code can't be made up.
const bagSig = (tenantId: string, orderId: string, n: number) =>
  createHmac('sha256', qrSecret()).update(`bag|${tenantId}|${orderId}|${n}`).digest('hex').slice(0, 16);

export function makeBagCode(tenantId: string, orderId: string, n: number): string {
  return `clarityflow://bag/${orderId}.${n}.${bagSig(tenantId, orderId, n)}`;
}

/** The bag number this code is for, when it's an authentic tag of this order; null otherwise. */
export function checkBagCode(tenantId: string, orderId: string, raw: string): number | null {
  const m = /^clarityflow:\/\/bag\/([A-Za-z0-9_-]{1,160})\.(\d{1,2})\.([0-9a-f]{16})$/.exec(String(raw || '').trim());
  if (!m || m[1] !== orderId) return null;
  const n = Number(m[2]); const want = bagSig(tenantId, orderId, n);
  return n >= 1 && timingSafeEqual(Buffer.from(m[3]), Buffer.from(want)) ? n : null;
}

// ─── ITEM STICKERS ─────────────────────────────────────────────────────────────
// Each item of a food order made at a station that prints stickers has its own sticker (lib/item-stickers), with its
// own code: "clarityflow://item/<orderId>.<ticketId>.<unit>.<version>.<sig>". The version goes up when a sticker is
// printed again (a remake, a torn one), so the old one no longer scans. Signed here, for this business, order, item and
// version, so a code can't be made up.
const itemSig = (tenantId: string, orderId: string, k: string, v: number) =>
  createHmac('sha256', qrSecret()).update(`item|${tenantId}|${orderId}|${k}|${v}`).digest('hex').slice(0, 16);
const ITEM_CODE = /^clarityflow:\/\/item\/([A-Za-z0-9_-]{1,160})\.([A-Za-z0-9_-]{1,160}\.\d{1,2})\.(\d{1,3})\.([0-9a-f]{16})$/;

export function makeItemCode(tenantId: string, orderId: string, k: string, v: number): string {
  return `clarityflow://item/${orderId}.${k}.${v}.${itemSig(tenantId, orderId, k, v)}`;
}

/** The item and version this code is for, when it's an authentic sticker of this order; null otherwise. */
export function checkItemCode(tenantId: string, orderId: string, raw: string): { k: string; v: number } | null {
  const m = ITEM_CODE.exec(String(raw || '').trim());
  if (!m || m[1] !== orderId) return null;
  const v = Number(m[3]); const want = itemSig(tenantId, orderId, m[2], v);
  return v >= 1 && timingSafeEqual(Buffer.from(m[4]), Buffer.from(want)) ? { k: m[2], v } : null;
}
