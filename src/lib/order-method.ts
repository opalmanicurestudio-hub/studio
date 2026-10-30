// src/lib/order-method.ts — HOW AN ORDER REACHES THE CUSTOMER, in words (pure). One place for the names, so the list,
// the order, the slips and the pick sheet all say the same thing. Curbside is called drive-through when the shop runs
// it as a lane (Orders settings: curbside, "drive-through").
export type MethodWords = { short: string; long: string };

export function methodWords(method: any, rs?: any): MethodWords {
  const m = String(method || '');
  if (m === 'ship') return { short: 'Ship', long: 'Shipping' };
  if (m === 'delivery') return { short: 'Delivery', long: 'Local delivery' };
  if (m === 'curbside') return rs?.curbsideMode === 'drive_thru' ? { short: 'Drive-through', long: 'Drive-through pickup' } : { short: 'Curbside', long: 'Curbside pickup' };
  if (m === 'in_store') return { short: 'Pickup', long: 'In-store pickup' };
  if (m === 'digital') return { short: 'Download', long: 'Download' };
  return { short: 'Pickup', long: 'Counter pickup' };
}
