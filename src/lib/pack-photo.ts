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
  const boxes = new Set((Array.isArray(order?.packPhotos) ? order.packPhotos : []).map((p: any) => Math.max(1, Math.floor(Number(p?.box) || 1)))).size;
  return `The contents of this parcel were photographed at the packing bench before it was sealed${at ? ` on ${at.slice(0, 10)}` : ''}. ${urls.length} image${urls.length === 1 ? '' : 's'}${boxes > 1 ? ` of ${boxes} boxes` : ''} on file, available on request.`;
}

/* ════════════════════════════════════════════════════════════════════════════
 * THE PHOTO RECORD. Each photo is kept with the order it was taken for, the box it shows (box 1, box 2, … as packing
 * numbers them, which is also the order of the boxes' labels), what it shows, and who took it when. Saved by the server
 * (api/retail/pack-photo), so it works whatever the photo storage's own rules say. The plain list of photo links
 * (packPhotoUrls) is kept beside it for everything that reads photos that way (claims, evidence, the dispute pack).
 * ════════════════════════════════════════════════════════════════════════════ */

export const PACK_PHOTO_KINDS = ['contents', 'sealed', 'label', 'damage', 'other'] as const;
export type PackPhotoKind = typeof PACK_PHOTO_KINDS[number];
export const PACK_PHOTO_KIND_LABEL: Record<PackPhotoKind, string> = {
  contents: 'Open, with what’s inside',
  sealed: 'Sealed',
  label: 'Label on the box',
  damage: 'Damage',
  other: 'Other',
};

export type PackPhoto = { url: string; box: number; kind: PackPhotoKind; at: string; by: string; byId?: string | null; note?: string | null };

/** The order's photos, oldest first: as recorded, and any taken before photos were recorded box by box (box 1). */
export function packPhotosOf(order: any): PackPhoto[] {
  const recs: PackPhoto[] = (Array.isArray(order?.packPhotos) ? order.packPhotos : [])
    .filter((p: any) => p && typeof p.url === 'string' && p.url)
    .map((p: any) => ({ url: String(p.url), box: Math.max(1, Math.floor(Number(p.box) || 1)), kind: (PACK_PHOTO_KINDS as readonly string[]).includes(p.kind) ? p.kind : 'other',
      at: String(p.at || ''), by: String(p.by || ''), byId: p.byId || null, note: p.note || null }));
  const known = new Set(recs.map((p) => p.url));
  const legacy: PackPhoto[] = (Array.isArray(order?.packPhotoUrls) ? order.packPhotoUrls : [])
    .filter((u: any) => typeof u === 'string' && u && !known.has(u))
    .map((url: string) => ({ url, box: 1, kind: 'contents' as const, at: String(order?.packPhotoAt || ''), by: String(order?.packPhotoBy || ''), byId: null, note: null }));
  return [...legacy, ...recs];
}

/** How many photos an order may keep: the shop's limit for each box. */
export function packPhotoLimit(order: any, policy: PackPhotoPolicy): number {
  const boxes = Math.max(1, Array.isArray(order?.packBoxes) ? order.packBoxes.length : 1);
  return Math.min(30, policy.maxPhotos * boxes);
}

/** Does each box have a photo of it open (what an insurer and a "missing item" claim ask for)? Boxes numbered 1…n. */
export function boxesMissingPhoto(order: any, boxes: number): number[] {
  const photos = packPhotosOf(order);
  const out: number[] = [];
  for (let b = 1; b <= Math.max(1, boxes); b++) if (!photos.some((p) => p.box === b && (p.kind === 'contents' || p.kind === 'other'))) out.push(b);
  return out;
}
