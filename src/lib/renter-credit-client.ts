'use client';
// src/lib/renter-credit-client.ts — ASK THE SERVER TO BRING RENTERS' SHOP CREDITS UP TO DATE FOR AN ORDER
// (/api/retail/renter-credit). Called from every screen that hands over, ships or checks in a return, and only for
// orders that have a renter's product on them. Best effort: the nightly job catches anything missed.
import { staffAuthHeader } from './staff-fetch';

export function syncRenterCredits(t: string, o: any, force = false): void {
  if (!o?.id || (!force && !(o?.lines || []).some((l: any) => l?.soldFor?.renterId))) return;
  void (async () => { try { await fetch('/api/retail/renter-credit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId: t, orderId: o.id }) }); } catch { /* the nightly job catches up */ } })();
}
