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
