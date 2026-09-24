// src/lib/offers.ts
//
// OFFERS — one set of rules, used everywhere an offer can be applied:
// online booking (/api/appointments/book), the offer check on the booking
// page (/api/offers/check), checkout (CompleteAppointmentDialog) and the
// client's offer wallet.
//
// Before this, checkout only asked "is the discount switched on and under
// its usage limit?" — an expired offer still applied, "once per client" was
// ignored, and service limits weren't checked.
//
// THE WALLET: every client who receives an offer in a campaign gets a record
// in tenants/{t}/clientOffers/{campaignId}__{clientId} —
//   { clientId, discountId, code, line, campaignId, campaignName, sentAt,
//     expiresAt, status: 'available' | 'redeemed', redeemedAt, appointmentId,
//     ownerRenterId (a renter's offer: words only, no code) }
// "Expired" is worked out on read from expiresAt, so nothing needs a job to
// flip it.
//
// Pure — no Firebase imports — so the browser and the server share it.

export interface OfferDiscount {
  id?: string; code?: string; type?: 'percentage' | 'fixed'; value?: number;
  isActive?: boolean; validFrom?: string; validUntil?: string;
  usageLimit?: number; usageCount?: number; limitOnePerCustomer?: boolean;
  usedByClientIds?: string[]; applicableServiceIds?: string[];
}

/** Why this offer can't be used right now — or null if it can. Plain words for staff and clients. */
export function offerProblem(d: OfferDiscount | null | undefined, ctx: { clientId?: string | null; serviceIds?: string[]; now?: number } = {}): string | null {
  if (!d) return 'That code isn’t recognised.';
  const now = ctx.now ?? Date.now();
  if (d.isActive === false) return 'That offer has been switched off.';
  if (d.validFrom && new Date(d.validFrom).getTime() > now) return `That offer starts ${fmt(d.validFrom)}.`;
  if (d.validUntil && new Date(d.validUntil).getTime() < now) return `That offer ended ${fmt(d.validUntil)}.`;
  if (Number(d.usageLimit) > 0 && Number(d.usageCount || 0) >= Number(d.usageLimit)) return 'That offer has been fully used.';
  if (d.limitOnePerCustomer && ctx.clientId && (d.usedByClientIds || []).includes(ctx.clientId)) return 'This client has already used that offer.';
  const only = (d.applicableServiceIds || []).filter(Boolean);
  if (only.length && ctx.serviceIds && ctx.serviceIds.length && !ctx.serviceIds.some((s) => only.includes(s))) return 'That offer doesn’t cover these services.';
  return null;
}

/** "15% off with code WELCOME15 — until Oct 31" */
export function offerLine(d: OfferDiscount): string {
  const amt = d.type === 'percentage' ? `${Number(d.value) || 0}% off` : `$${(Number(d.value) || 0).toFixed(0)} off`;
  return `${amt}${d.code ? ` with code ${d.code}` : ''}${d.validUntil ? ` — until ${fmt(d.validUntil)}` : ''}`;
}

/** Short form for chips: "15% off" / "$10 off". */
export function offerAmount(d: OfferDiscount): string {
  return d.type === 'percentage' ? `${Number(d.value) || 0}% off` : `$${(Number(d.value) || 0).toFixed(0)} off`;
}

export type WalletStatus = 'available' | 'redeemed' | 'expired';
export function walletStatus(w: { status?: string; expiresAt?: string | null }, now = Date.now()): WalletStatus {
  if (w.status === 'redeemed') return 'redeemed';
  if (w.expiresAt && new Date(w.expiresAt).getTime() < now) return 'expired';
  return 'available';
}

function fmt(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
