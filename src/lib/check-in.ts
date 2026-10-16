// src/lib/check-in.ts — ONE WAY TO SAY "THEY'RE HERE". Whoever checks a client in (the client from their link, the
// front desk, the planner, the kiosk, a provider), the visit gets the same fields and the provider gets the same note:
// "Sam is here for their 3:00 full set". The first arrival time is kept; later taps don't move it.

export type ArrivalVia = 'client link' | 'front desk' | 'planner' | 'kiosk' | 'provider';

/** The fields every check-in writes on the visit (and its public copy). */
export function arrivalFields(apt: any, via: ArrivalVia, at: string = new Date().toISOString()) {
  return {
    checkInStatus: 'arrived', checkInStatusTimestamp: at,
    checkedInAt: apt?.checkedInAt || at, arrivedAt: apt?.arrivedAt || at, checkedInVia: via,
  };
}

const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || 'Your client';

/** The note for the provider, or null when they checked the client in themselves (or the visit is already under way). */
export function arrivalNotice(apt: any, opts: { byUserId?: string | null; timeZone?: string; serviceName?: string } = {}) {
  if (!apt?.staffId || (opts.byUserId && opts.byUserId === apt.staffId)) return null;
  if (['servicing', 'completed', 'cancelled', 'no_show', 'declined'].includes(String(apt?.status))) return null;
  if (apt?.checkInStatus === 'arrived') return null;   // already told
  let when = ''; try { when = apt.startTime ? new Date(typeof apt.startTime === 'string' ? apt.startTime : apt.startTime?.toDate ? apt.startTime.toDate() : apt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }) : ''; } catch { /* no time */ }
  const svc = String(opts.serviceName || apt.serviceName || '').toLowerCase();
  return {
    userId: apt.staffId, type: 'arrived', priority: 'normal', read: false, appointmentId: apt.id, link: `/planner?visit=${apt.id}`,
    message: `${first(apt.clientName)} is here${when ? ` for their ${when}` : ''}${svc ? ` ${svc}` : ''}.`,
  };
}
