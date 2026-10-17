// src/lib/ground-only.ts — ITEMS THAT CAN ONLY GO BY GROUND. Nail polish, acetone, aerosols, perfume, lithium
// batteries and similar can't fly. A product marked "ships by ground only" makes the whole parcel ground only: the
// customer is only offered ground services at checkout, and staff are only offered ground rates for the label. Pure.

const GROUND_TOKENS = new Set([
  'usps_ground_advantage', 'usps_parcel_select', 'usps_retail_ground', 'usps_media_mail',
  'ups_ground', 'ups_ground_saver', 'ups_surepost', 'fedex_ground', 'fedex_home_delivery', 'fedex_ground_economy',
  'ontrac_ground', 'lasership_routed_delivery',
]);

export function isGroundRate(r: { servicelevel?: { token?: string; name?: string }; token?: string; service?: string; name?: string }): boolean {
  const token = String(r.servicelevel?.token || r.token || '').toLowerCase();
  if (token && GROUND_TOKENS.has(token)) return true;
  const name = String(r.servicelevel?.name || r.service || r.name || '').toLowerCase();
  return /\bground\b|parcel select|home delivery/.test(name) && !/air|express|priority|overnight|2nd day|next day/.test(name);
}

export const itemGroundOnly = (item: any) => item?.shipGroundOnly === true;

/** Keep only ground rates when the parcel needs it. */
export function groundFilter<T>(rates: T[], groundOnly: boolean, pick: (r: T) => any = (r) => r): T[] {
  return groundOnly ? rates.filter((r) => isGroundRate(pick(r))) : rates;
}

export const GROUND_NOTE = 'Some items in this order can only travel by ground, so only ground services are shown.';
