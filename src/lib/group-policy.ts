// src/lib/group-policy.ts — the business's rules for online group bookings and "another service" (Settings → Group bookings).
export function groupPolicy(tenant: any) { const g = tenant?.groupBooking || {};
  return { enabled: g.enabled === true, maxGuests: Math.max(1, Math.min(12, Number(g.maxGuests) || 4)), deposits: g.deposits === 'each' ? 'each' as const : 'organizer' as const, sideBySide: g.sideBySide !== false, after: g.after !== false }; }
