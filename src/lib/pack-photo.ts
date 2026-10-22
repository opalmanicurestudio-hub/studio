// ─── src/lib/pack-photo.ts ────────────────────────────────────────────────────
// One photo of the open box, taken at the bench before it is sealed.
//
// It is the fastest end to a "the box was missing an item" claim. The weight
// check answers the same question with arithmetic; a photo answers it in a way
// a customer can see for themselves, which usually ends the conversation before
// it becomes a chargeback. It costs about four seconds per parcel.
//
// EVERY NUMBER HERE COMES FROM THE TENANT. This platform is multi-tenant and
// not tied to one trade: a shop selling one small item per order and a shop
// selling large kits want opposite answers, and neither should inherit the
// other's. So there is no built-in dollar figure, no assumed item count, and
// nothing about what is being sold. The defaults below only decide what happens
// before anyone has opened the settings screen, and the safe default is OFF —
// a shop should never discover it is storing customer photographs because a
// framework decided that for it.

import { protectionFor, protectionPolicy } from './shipment-protection';

export interface PackPhotoPolicy {
  enabled: boolean;
  /** Photo required at or above this order value. 0 = every order. */
  requiredOverCents: number;
  /** Required when the parcel holds at least this many units. 0 = ignore. */
  requiredOverUnits: number;
  /** Longest edge in px. Small enough to be cheap, large enough to read a label. */
  maxDimension: number;
  /** Hard stop, so one order cannot fill a shop's storage quota. */
  maxPhotos: number;
}

const int = (v: unknown, fallback: number, min = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};

export function packPhotoPolicy(retailSettings: any): PackPhotoPolicy {
  const rs = retailSettings || {};
  return {
    enabled: rs.packPhotoEnabled === true,
    requiredOverCents: int(rs.packPhotoOverCents, 0),
    requiredOverUnits: int(rs.packPhotoOverUnits, 0),
    maxDimension: Math.min(2048, int(rs.packPhotoMaxDimension, 1280, 320)),
    maxPhotos: Math.min(10, int(rs.packPhotoMaxPhotos, 3, 1)),
  };
}

/** Units actually going in the box — ordered minus anything shorted. */
export function unitsInParcel(order: any): number {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  return lines.reduce((a: number, l: any) => {
    const ordered = Math.max(0, Number(l?.qtyOrdered) || 0);
    const shorted = Math.min(Math.max(0, Number(l?.qtyShorted) || 0), ordered);
    return a + (ordered - shorted);
  }, 0);
}

/** Merchandise value of what is being shipped, ignoring tax, tip and shipping. */
export function parcelValueCents(order: any): number {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  if (lines.length === 0) return Math.max(0, Number(order?.subtotalCents) || 0);
  return lines.reduce((a: number, l: any) => {
    const ordered = Math.max(0, Number(l?.qtyOrdered) || 0);
    const shorted = Math.min(Math.max(0, Number(l?.qtyShorted) || 0), ordered);
    return a + (Math.max(0, Number(l?.unitPriceCents) || 0)) * (ordered - shorted);
  }, 0);
}

/**
 * Should the packer be stopped until a photo exists?
 *
 * Either threshold can trigger it, because the two catch different risks: value
 * catches the expensive single item, unit count catches the crowded box where a
 * missing item is easiest to miss and hardest to disprove.
 */
export function packPhotoRequired(order: any, policy: PackPhotoPolicy): boolean {
  if (!policy.enabled) return false;

  // Both thresholds left at zero means "photograph everything" — the shop turned
  // the feature on and set no exemption.
  if (policy.requiredOverCents === 0 && policy.requiredOverUnits === 0) return true;

  if (policy.requiredOverCents > 0 && parcelValueCents(order) >= policy.requiredOverCents) return true;
  if (policy.requiredOverUnits > 0 && unitsInParcel(order) >= policy.requiredOverUnits) return true;
  return false;
}

/**
 * An insured parcel is packed the way its insurer asks and photographed open before it is sealed, so a damage claim
 * holds up. The one exception to the photos being off by default above: insurance is something the shop turns on, and
 * this is shown and switchable beside it (Policies → Protection), because an insurer can turn a damage claim down
 * without proof of how the box was packed. Shippo's insurance asks for a corrugated box, at least 2 inches of padding between the goods and all six
 * sides, and a double-walled box over 10 lb. On for every insured ship order unless the shop turns it off (Policies →
 * Protection: retailSettings.policies.insuredPackCheck). Insured: its label was bought insured, or, before there is a
 * label, the shop's insurance rule will insure it (lib/shipment-protection).
 */
export function insuredPackCheck(order: any, retailSettings: any): boolean {
  const rs = retailSettings || {};
  if (rs.policies?.insuredPackCheck === false || order?.method !== 'ship' || order.shippedWithOrderId) return false;
  if (order.shipmentProtection) return (Number(order.shipmentProtection.insuranceCents) || 0) > 0;
  return protectionFor(order, protectionPolicy(rs)).insuranceCents > 0;
}

/** What the packer checks on an insured box, in the order it's packed. */
export const INSURED_PACK_RULES = [
  'A sturdy corrugated box, double-walled if it’s over 10 lb',
  'At least 2 inches of padding on every side, so nothing moves',
  'Taped along every seam',
  'Old labels taken off or covered',
  'A photo of it open, before you seal it',
];

/** Storage path. Tenant-scoped so one shop's rules can never expose another's. */
export function packPhotoPath(tenantId: string, orderId: string, index: number): string {
  const stamp = Date.now().toString(36);
  return `tenants/${tenantId}/packPhotos/${orderId}/${stamp}-${index}.jpg`;
}

/** One line for the audit event and the dispute narrative. */
export function packPhotoEvidenceLine(order: any): string {
  const urls: string[] = Array.isArray(order?.packPhotoUrls) ? order.packPhotoUrls : [];
  if (urls.length === 0) return '';
  const at = String(order?.packPhotoAt || '');
  return `The contents of this parcel were photographed at the packing bench before it was sealed${at ? ` on ${at.slice(0, 10)}` : ''}. ${urls.length} image${urls.length === 1 ? '' : 's'} on file, available on request.`;
}
