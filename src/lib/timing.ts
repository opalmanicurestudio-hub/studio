// src/lib/timing.ts — HOW LONG A VISIT REALLY TOOK, one way for every screen (pure — the server and screens share it).
// Different screens record the start / finish under different names (desk & staff portal: actualStartTime /
// actualEndTime; the visit ticket & staff board: serviceStartedAt / serviceEndedAt) — this reads whichever is there.
//   booked  = the service + its add-ons (their set lengths; the booking's own length if they have none)
//   actual  = start → finish, in minutes
//   over    = actual − booked, past the business's grace minutes
// Every visit is graded so the numbers stay honest: only 'ok' visits count toward anyone's typical times.
//   no_start / no_end — a tap was missed · auto_closed — finished by the system, not a person · late_tap — "done"
//   tapped well after they'd paid · outlier — under half or over twice the booked time (a mistake, not a pace).
export type TimingQuality = 'ok' | 'no_start' | 'no_end' | 'auto_closed' | 'late_tap' | 'outlier';
export const OVER_REASONS: { code: string; label: string; clientCaused: boolean }[] = [
  { code: 'client_extra', label: 'They asked for extra work', clientCaused: true },
  { code: 'extra_repair', label: 'An extra repair was needed', clientCaused: true },
  { code: 'client_late', label: 'They arrived late', clientCaused: true },
  { code: 'ran_behind', label: 'I ran behind', clientCaused: false },
  { code: 'other', label: 'Something else', clientCaused: false },
];
const ms = (v: any): number | null => { if (!v) return null; const t = typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate().getTime() : typeof v === 'object' && v.seconds ? v.seconds * 1000 : Date.parse(String(v)); return Number.isFinite(t) ? t : null; };
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function graceMinutes(tenant: any): number { const g = tenant?.timingPolicy?.graceMinutes; return g === undefined || g === null || g === '' ? 15 : Math.max(0, num(g)); }

/** The key a visit's numbers are grouped by: the service, plus its add-ons (a gel set with art isn't a plain gel set). */
export function serviceKey(a: any): string { const add = (Array.isArray(a?.addOnIds) ? a.addOnIds : []).map(String).sort(); return [String(a?.serviceId || 'service'), ...add].join('+'); }

export function visitTiming(a: any, services: any[] = [], tenant?: any) {
  const svc = (id: string) => services.find((s: any) => s.id === id);
  const addOns: string[] = Array.isArray(a?.addOnIds) ? a.addOnIds : [];
  const setLen = num(svc(a?.serviceId)?.duration) + addOns.reduce((n, id) => n + num(svc(id)?.duration), 0);
  const bookedLen = (() => { const s = ms(a?.startTime), e = ms(a?.endTime); return s && e && e > s ? Math.round((e - s) / 60000) : 0; })();
  const bookedMinutes = setLen > 0 ? setLen : bookedLen || 60;
  const start = ms(a?.serviceStartedAt) ?? ms(a?.actualStartTime); const end = ms(a?.serviceEndedAt) ?? ms(a?.actualEndTime);
  const paid = ms(a?.paidAt) ?? ms(a?.completedAt) ?? ms(a?.checkedOutAt);
  const actualMinutes = start && end && end > start ? Math.round((end - start) / 60000) : null;
  let quality: TimingQuality = 'ok';
  if (!start) quality = 'no_start'; else if (!end) quality = 'no_end';
  else if (a?.serviceEndAuto || (Array.isArray(a?.timeline) && a.timeline.some((t: any) => /ran long with no finish recorded/i.test(String(t?.text || ''))))) quality = 'auto_closed';
  else if (paid && end - paid > 10 * 60000) quality = 'late_tap';
  else if (actualMinutes !== null && (actualMinutes < bookedMinutes * 0.5 || actualMinutes > bookedMinutes * 2)) quality = 'outlier';
  const grace = graceMinutes(tenant);
  const overMinutes = actualMinutes !== null ? Math.max(0, actualMinutes - bookedMinutes) : 0;
  const overPastGrace = actualMinutes !== null ? Math.max(0, actualMinutes - bookedMinutes - grace) : 0;
  const ov = a?.checkoutState?.serviceStaffOverrides || {};
  return { bookedMinutes, actualMinutes, overMinutes, overPastGrace, grace, quality, startedAt: start ? new Date(start).toISOString() : null, endedAt: end ? new Date(end).toISOString() : null,
    staffId: String(ov[a?.serviceId] || a?.staffId || ''), serviceKey: serviceKey(a), overReason: a?.overReason || null,
    needsReason: quality === 'ok' && overPastGrace > 0 && !a?.overReason };
}

/** Median and the middle half (25th–75th) of a list of minutes. */
export function spread(xs: number[]) { const v = [...xs].sort((a, b) => a - b); const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))] : 0);
  return { median: q(0.5), low: q(0.25), high: q(0.75) }; }
