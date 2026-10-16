// src/lib/visit-clock.ts — THE LIVE TIMER, one way for every screen (the planner card, the visit, the side panel, Now,
// the list, the staff portal). Elapsed time since the visit started, and how long it should take: the service, plus
// its add-ons, plus this client's usual extra time, plus any "+5 min" added on a step. Past that, it's over.
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) : v?.toDate ? v.toDate().getTime() : v?.seconds ? v.seconds * 1000 : Number(v) || 0);

export function startedAt(a: any): number { return ms(a?.actualStartTime) || ms(a?.serviceStartedAt) || 0; }

/** Minutes this visit should take in the chair. */
export function expectedMinutes(a: any, service: any, allServices: any[] = []): number {
  const base = Number(a?.customLength) || Number(a?.durationMinutes) || Number(service?.duration) || 0;
  const addOnIds: string[] = Array.isArray(a?.checkoutState?.addOnServices) ? a.checkoutState.addOnServices.map((x: any) => x?.id).filter(Boolean) : (a?.addOnIds || []);
  const addOns = addOnIds.reduce((n, id) => n + (Number(allServices.find((x: any) => x?.id === id)?.duration) || Number(a?.checkoutState?.addOnServices?.find((x: any) => x?.id === id)?.duration) || 0), 0);
  const usual = Number(a?.checkoutState?.extraTimeMinutes) || Number(a?.clientExtraMinutes) || 0;
  const stepExtra = Object.values(a?.stepExtra || {}).reduce((n: number, v: any) => n + (Number(v) || 0), 0);
  return Math.max(0, base + addOns + usual + stepExtra);
}

export const clockLabel = (secs: number) => { const s = Math.max(0, Math.floor(secs)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

/** Where the visit's clock stands now. null when it isn't in the chair. */
export function visitClock(a: any, service: any, allServices: any[] = [], now = Date.now()) {
  if (!a || a.status !== 'servicing') return null; const s = startedAt(a); if (!s) return null;
  const secs = Math.max(0, (now - s) / 1000); const exp = expectedMinutes(a, service, allServices); const mins = secs / 60;
  return { secs, label: clockLabel(secs), expected: exp, overMinutes: exp > 0 ? Math.max(0, Math.floor(mins - exp)) : 0, over: exp > 0 && mins > exp,
    leftMinutes: exp > 0 ? Math.max(0, Math.ceil(exp - mins)) : null, endsAt: exp > 0 ? s + exp * 60000 : null };
}
