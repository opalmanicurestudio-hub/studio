// src/lib/renter-sales.ts — RENTERS' PRODUCTS IN THE ONLINE SHOP. The owner marks a product as sold for a renter and
// sets the shop's share. When an order with that product is handed over or shipped, the renter's share of what the
// customer actually paid for it (never tax or shipping) is credited to their rent account, and comes off their next
// rent like any other credit. Returns take it back. Pure.
import { effectiveUnitCents } from './retail-swap';

export interface SoldFor { renterId: string; renterName: string; shopCutPct: number }

export const soldForOf = (item: any): SoldFor | null => {
  const s = item?.soldFor; if (!s || !s.renterId) return null;
  return { renterId: String(s.renterId), renterName: String(s.renterName || 'Renter'), shopCutPct: Math.min(100, Math.max(0, Number(s.shopCutPct) || 0)) };
};

export const FINAL_STAGES = ['shipped', 'handed_off', 'completed'];

/** What the renter is owed for one order line right now: the units that reached the customer and weren't returned. */
export function renterShareCents(line: any): number {
  const s = line?.soldFor; if (!s?.renterId) return 0;
  const units = Math.max(0, (Number(line.qtyOrdered) || 0) - (Number(line.qtyShorted) || 0) - (Number(line.qtyReturned) || 0));
  const paid = units * effectiveUnitCents(line);
  return Math.round(paid * (100 - Math.min(100, Math.max(0, Number(s.shopCutPct) || 0))) / 100);
}

/** One credit per order line. `existing` is what's already on their account for that line (negative cents, applied). */
export function creditChange(desiredCents: number, existing: { amountCents?: number; appliedCents?: number; status?: string } | null): { amountCents: number; appliedCents: number; status: string; clawbackCents: number } | null {
  const applied = Math.max(0, Number(existing?.appliedCents) || 0);
  const current = existing && existing.status !== 'voided' ? Math.abs(Number(existing.amountCents) || 0) : 0;
  if (desiredCents === current && existing) return null;
  if (desiredCents <= 0 && !existing) return null;
  if (desiredCents <= 0) return { amountCents: applied ? -applied : 0, appliedCents: applied, status: applied ? 'paid' : 'voided', clawbackCents: applied };
  if (applied > desiredCents) return { amountCents: -applied, appliedCents: applied, status: 'paid', clawbackCents: applied - desiredCents };
  return { amountCents: -desiredCents, appliedCents: applied, status: 'paid', clawbackCents: 0 };
}
