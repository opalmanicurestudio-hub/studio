// src/lib/location-allowance.ts — HOW MANY LOCATIONS A BUSINESS MAY HAVE (server).
// Every business includes ONE location. More locations need an active ClarityFlow subscription — each extra one is
// billed monthly (Additional location, lib/billing-plans.ts) and added to the subscription automatically (prorated).
// HQ can grant extra locations without charge (tenants.billing.locationsGranted — a field businesses can't edit).
import { isBusinessLocation } from '@/lib/location-kind';
import { LOCATIONS_INCLUDED, EXTRA_LOCATION } from '@/lib/billing-plans';

export interface LocationAllowance { unitPrice: number; count: number; included: number; granted: number; subscribed: boolean; limit: number | null; canAdd: boolean; extraMonthly: number; reason: string }

export const isSubscribed = (t: any) => ['active', 'trialing'].includes(String(t?.subscriptionStatus || '')) && !!t?.billing?.subscriptionId && !t?.accessLocked && !t?.suspended;

export async function locationAllowance(db: any, tenantId: string): Promise<LocationAllowance> {
  const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const count = (await db.collection(`tenants/${tenantId}/locations`).get()).docs.filter((d: any) => isBusinessLocation({ id: d.id, ...(d.data() || {}) })).length;
  const granted = Math.max(0, Math.round(Number(t?.billing?.locationsGranted) || 0));
  const subscribed = isSubscribed(t);
  const free = LOCATIONS_INCLUDED + granted;
  // Not subscribed: the included location (plus anything HQ granted). Subscribed: no cap — each extra one is billed.
  const limit = subscribed ? null : free;
  const canAdd = limit === null || count < limit;
  const billedAfterAdd = subscribed ? Math.max(0, count + 1 - free) : 0;
  return { unitPrice: EXTRA_LOCATION.amount, count, included: LOCATIONS_INCLUDED, granted, subscribed, limit, canAdd, extraMonthly: billedAfterAdd ? EXTRA_LOCATION.amount : 0,
    reason: canAdd ? (billedAfterAdd ? `Adding a location adds $${EXTRA_LOCATION.amount}/month to your subscription.` : '')
      : `Your plan includes ${free} location${free === 1 ? '' : 's'}. Subscribe to add more — each extra location is $${EXTRA_LOCATION.amount}/month.` };
}
