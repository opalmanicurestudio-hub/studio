'use client';
// src/lib/lounge-delivery.ts — "I'M BRINGING IT" for a lounge order on the desk. Handing an order over (stock, a member
// perk, the visit, money collected at a station) is one server step for every screen now: api/kitchen 'act' (the
// kitchen screen with its key; the desk and the dashboard with their sign-in, lib/kitchen-client), so it happens once.

/** "I'm bringing it over" — the guest sees someone is on the way (and gets a text). */
export function bringingRefreshmentPatch(user: any) { return { bringingOutAt: new Date().toISOString(), bringingOutBy: user?.displayName || 'Someone' }; }
