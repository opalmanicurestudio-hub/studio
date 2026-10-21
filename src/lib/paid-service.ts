// src/lib/paid-service.ts — THE SHIPPING THE CUSTOMER PAID FOR. At checkout they pick a carrier service from live
// rates (api/retail/shipping-quote), and it's kept on the order. When the label is bought, that's the service to buy:
// someone who paid for Priority Mail shouldn't get Ground Advantage because it was cheaper on the day. The plain
// "Standard shipping" (a flat or free rate) means any service will do, so the cheapest is right.

export type RateLike = { provider?: string; service?: string; amountCents: number };

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STANDARD = /^(standard|standard shipping|shipping|free shipping|flat rate|flat rate shipping)$/;

export const cheapestOf = <T extends RateLike>(rates: T[]): T | null => (rates.length ? rates.reduce((a, b) => (b.amountCents < a.amountCents ? b : a)) : null);

/** True when the customer chose a particular service, not just "shipping". */
export const choseService = (paidService: unknown) => { const w = norm(paidService); return !!w && !STANDARD.test(w); };

/**
 * The rate to buy for what they paid for:
 *   matched  their service is offered (cheapest of it, same carrier when known)
 *   missing  they chose a service and it isn't offered today: someone should choose
 *   any      they chose plain shipping: the cheapest rate
 */
export function paidServiceRate<T extends RateLike>(rates: T[], paidService: unknown, paidCarrier?: unknown): { rate: T | null; how: 'matched' | 'missing' | 'any' } {
  if (!choseService(paidService)) return { rate: cheapestOf(rates), how: 'any' };
  const want = norm(paidService); const carrier = norm(paidCarrier);
  const same = rates.filter((r) => norm(r.service) === want);
  const sameCarrier = carrier ? same.filter((r) => norm(r.provider) === carrier) : same;
  const pool = sameCarrier.length ? sameCarrier : same;
  return pool.length ? { rate: cheapestOf(pool), how: 'matched' } : { rate: null, how: 'missing' };
}
