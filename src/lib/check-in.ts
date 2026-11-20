// src/lib/check-in.ts — ONE WAY TO SAY "THEY'RE HERE". Whoever checks a client in (the client from their link, the
// front desk, the planner, the kiosk, a provider), the visit gets the same fields, and their provider gets the same
// nudge, once, from the server (lib/arrival-nudge-server). The first arrival time is kept; later taps don't move it.

export type ArrivalVia = 'client link' | 'front desk' | 'planner' | 'kiosk' | 'provider';

/** The fields every check-in writes on the visit (and its public copy). */
export function arrivalFields(apt: any, via: ArrivalVia, at: string = new Date().toISOString()) {
  return {
    checkInStatus: 'arrived', checkInStatusTimestamp: at,
    checkedInAt: apt?.checkedInAt || at, arrivedAt: apt?.arrivedAt || at, checkedInVia: via,
  };
}
