// src/lib/order-pass.ts — WHO IS LOOKING AT AN ORDER (server).
// An order's link (in its emails, on the card in the box) opens the order page while the order can still be helped
// with: until it's finished, and after that for the longest of 30 days, the return window and the window to report a
// delivery problem. Past then the link shows only that it has expired, and offers a code.
// Seeing the customer's full details and changing them (the address, the email or mobile, texts on or off, confirming
// the address, opening all their orders) takes a PASS: proof it's the customer, kept on their device for 30 days. A
// pass comes from the device that paid (the checkout session Stripe sends them back with, for two days after paying),
// from their signed-in account at the shop, or from a 6-digit code sent to the email or mobile on the order. A pass is
// tied to the order's pickup code, which its backorders and replacements share, so it works for the whole family.
import { createHmac, timingSafeEqual } from 'crypto';

export const PASS_DAYS = 30;
export const LINK_MIN_DAYS = 30;
const DAY = 864e5;
const FINISHED = ['shipped', 'handed_off', 'completed', 'cancelled', 'refunded'];

const secret = () => String(process.env.ORDER_PASS_SECRET || process.env.CRON_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'order-pass');
const sign = (tenantId: string, code: string, exp: number) => createHmac('sha256', secret()).update(`pass:${tenantId}:${code}:${exp}`).digest('base64url').slice(0, 32);

/** When the order's link stops opening the order: null while it's still going (or has no finish time). */
export function linkExpiresAt(o: any, rs: any): string | null {
  const stage = String(o?.stage || '');
  if (!FINISHED.includes(stage)) return null;
  // Something to download stays reachable for as long as it was sold for: for good when no limit was set.
  const digital = (o?.lines || []).filter((l: any) => l?.digital === true && !['refunded'].includes(String(l?.status || '')));
  if (digital.length && stage !== 'cancelled' && stage !== 'refunded') {
    if (digital.some((l: any) => !(Number(l.digitalAccessDays) > 0))) return null;
    const paid = Date.parse(String(o?.paidAt || ''));
    const until = Number.isFinite(paid) ? paid + Math.max(...digital.map((l: any) => Number(l.digitalAccessDays))) * DAY : NaN;
    const lb = linkBase(o, rs);
    if (Number.isFinite(until) && until > Date.now()) return new Date(Math.max(until, Number.isFinite(lb) ? lb : 0)).toISOString();
  }
  const base = linkBase(o, rs);
  return Number.isFinite(base) ? new Date(base).toISOString() : null;
}

/** When the finished order stops being helped with: when it was finished, plus the longest of its windows. */
function linkBase(o: any, rs: any): number {
  const done = Date.parse(String(o?.deliveredAt || o?.completedAt || o?.cancelledAt || o?.refundedAt || ''));
  if (!Number.isFinite(done)) return NaN;
  const days = Math.max(LINK_MIN_DAYS, Math.floor(Number(rs?.returnWindowDays) || 0), Math.floor(Number(rs?.deliveryIssueWindowDays) || 0));
  return done + days * DAY;
}

export function linkOpen(o: any, rs: any, now = Date.now()): boolean {
  const until = linkExpiresAt(o, rs);
  return !until || Date.parse(until) > now;
}

/** A pass for the order's family (by its pickup code), good for 30 days. */
export function makePass(tenantId: string, qrToken: string, now = Date.now()): string {
  const exp = now + PASS_DAYS * DAY;
  return `${exp}.${sign(tenantId, qrToken, exp)}`;
}

export function checkPass(tenantId: string, qrToken: string, pass: unknown, now = Date.now()): boolean {
  if (!qrToken) return false;
  const [x, k] = String(pass || '').split('.');
  const exp = Number(x);
  if (!Number.isFinite(exp) || exp < now || exp > now + (PASS_DAYS + 1) * DAY || !k) return false;
  const want = Buffer.from(sign(tenantId, qrToken, exp)); const got = Buffer.from(k);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const passUntil = (pass: string) => { const exp = Number(String(pass || '').split('.')[0]); return Number.isFinite(exp) ? new Date(exp).toISOString() : null; };

/** The device that paid: the checkout session Stripe sent them back with, for two days after they paid. */
export function paidHere(o: any, sessionId: unknown, now = Date.now()): boolean {
  const s = String(sessionId || '').trim();
  if (!s || !s.startsWith('cs_') || s !== String(o?.stripeCheckoutSessionId || '')) return false;
  const paid = Date.parse(String(o?.paidAt || o?.placedAt || ''));
  return Number.isFinite(paid) && now - paid < 2 * DAY;
}

/** What someone without a pass sees of the address: the town, never the street. */
export function maskAddress(a: any): any {
  if (!a || typeof a !== 'object') return null;
  return { city: String(a.city || ''), state: String(a.state || ''), country: String(a.country || ''), name: String(a.name || '').split(' ')[0] || '', masked: true };
}
