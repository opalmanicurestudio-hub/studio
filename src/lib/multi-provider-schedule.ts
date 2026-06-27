import { addMinutes } from 'date-fns';

export type ProviderLeg = {
  id: string;
  serviceId: string;
  staffId: string; // 'any' allowed, same convention as the primary leg
};

/** A leg's price, using that leg's own staff for tiered pricing if set. */
export function legPrice(leg: ProviderLeg, services: any[], staff: any[], getServicePrice: (svc: any, staffMember: any) => number): number {
  const svc = services.find((s: any) => s.id === leg.serviceId);
  const staffMember = staff.find((s: any) => s.id === leg.staffId);
  return svc ? getServicePrice(svc, staffMember) : 0;
}

/**
 * Computes each leg's derived start/end by chaining off the leg before it.
 * Leg 0 uses primaryStartTime/primaryServiceId (the parent form's existing
 * fields) as the anchor; legs 1..n chain off the previous leg's end + that
 * previous service's processingGapMinutes (defaults to 0 — back-to-back).
 */
export function computeLegSchedule(
  legs: ProviderLeg[],
  services: any[],
  primaryStartTime: Date,
  primaryServiceId: string,
) {
  const primarySvc = services.find((s: any) => s.id === primaryServiceId);
  const primaryDuration = primarySvc?.duration || 60;
  let cursor = addMinutes(primaryStartTime, primaryDuration);

  return legs.map((leg) => {
    const svc = services.find((s: any) => s.id === leg.serviceId);
    const duration = svc?.duration || 60;
    const start = cursor;
    const end = addMinutes(start, duration);
    cursor = addMinutes(end, svc?.processingGapMinutes || 0);
    return { ...leg, startTime: start, endTime: end };
  });
}

export function isMultiProviderValid(legs: ProviderLeg[]): boolean {
  return legs.every((l) => !!l.serviceId && !!l.staffId);
}
