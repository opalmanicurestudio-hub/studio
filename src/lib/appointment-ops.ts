// src/lib/appointment-ops.ts — AN APPOINTMENT'S REAL-TIME STATUS, one definition.
//
// Every surface (front desk, planner, staff portal, the Operations view) asks
// this, so they all say the same thing. A client's ETA or shared location never
// changes the appointment time — it's shown alongside it.
// Pure: safe on the server and in the browser.

export type OpsStatus =
  | 'in_service' | 'checked_in' | 'arrived_payment_required' | 'decision_needed'
  | 'rescheduling_offered' | 'eta_overdue' | 'location_shared' | 'running_late'
  | 'provider_late' | 'provider_offered' | 'payment_required' | 'on_time' | 'finished';

export interface OpsView {
  status: OpsStatus;
  label: string;                       // short, for a chip
  detail: string | null;               // one line, for a card
  tone: 'ok' | 'info' | 'warn' | 'alert' | 'muted';
  etaAt: Date | null;                  // their latest estimated arrival (not the appointment time)
  needsDecision: boolean;              // staff should act
}

const toDate = (v: any): Date | null => { if (!v) return null; const d = v?.toDate ? v.toDate() : new Date(v); return isNaN(d.getTime()) ? null : d; };
const hm = (d: Date | null) => (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

/** Is a required deposit still unpaid? */
export function paymentOutstanding(a: any): boolean {
  const st = String(a?.status || '');
  if (a?.paymentException?.at) return false;                     // an authorised exception was recorded
  return st === 'pending_payment' || st === 'deposit_pending' || (a?.depositRequired === true && a?.depositPaid !== true && a?.depositStatus !== 'paid');
}

export function opsStatus(a: any, now: Date = new Date(), opts: { graceMinutes?: number } = {}): OpsView {
  const st = String(a?.status || ''), ci = String(a?.checkInStatus || '');
  const start = toDate(a?.startTime);
  const eta = toDate(a?.etaAt || a?.clientEtaAt) || (ci === 'running_late' && start && a?.lateTimeMinutes ? new Date(start.getTime() + Number(a.lateTimeMinutes) * 60000) : null);
  const tripFresh = !!a?.clientTrip?.at && now.getTime() - Date.parse(a.clientTrip.at) < 10 * 60000;
  const unpaid = paymentOutstanding(a);
  const v = (status: OpsStatus, label: string, detail: string | null, tone: OpsView['tone'], needsDecision = false): OpsView => ({ status, label, detail, tone, etaAt: eta, needsDecision });

  if (['completed', 'cancelled', 'no_show', 'ready_for_checkout'].includes(st)) return v('finished', st === 'ready_for_checkout' ? 'Ready to check out' : st.replace('_', ' '), null, 'muted');
  if (st === 'servicing' || st === 'in_service') return v('in_service', 'In service', null, 'ok');
  const arrived = ci === 'arrived' || st === 'waiting' || st === 'checked_in';
  if (arrived && a?.studioAskedToMove) return v('decision_needed', 'Arrived after reschedule offer', 'They’re here — decide with today’s schedule and your policy, and they’ll be updated.', 'alert', true);
  if (arrived && unpaid) return v('arrived_payment_required', 'Arrived — payment required', 'Collect the deposit or record an exception before starting.', 'warn', true);
  if (arrived) return v('checked_in', 'Checked in', null, 'ok');
  const po = a?.providerOffer;
  if (po?.status === 'pending') return v('provider_offered', `Offered ${String(po.toStaffName || 'another provider').split(' ')[0]} at ${hm(toDate(po.startAt))}`, 'Waiting for them to accept or decline.', 'info');
  if ((po?.status === 'declined' || po?.status === 'expired') && !a?.lateReply) return v('decision_needed', po.status === 'declined' ? 'Declined the provider change' : 'Provider offer no longer available', 'Decide what happens next — they’ll be told.', 'alert', true);
  if (a?.studioAskedToMove) return v('rescheduling_offered', 'Rescheduling offered', 'Waiting for them to choose a new time.', 'info');
  if (Number(a?.providerLateMinutes) > 0) return v('provider_late', `Provider running ${a.providerLateMinutes} min late`, 'Their guest may need an update.', 'warn', true);
  if (ci === 'running_late') {
    const grace = Number(opts.graceMinutes) || 0;
    if (eta && now.getTime() > eta.getTime() + 5 * 60000) return v('eta_overdue', `ETA overdue (was ${hm(eta)})`, 'Their stated arrival time has passed — reassess.', 'alert', true);
    const decided = !!a?.lateReply?.kind;
    const past = grace > 0 && Number(a?.lateTimeMinutes) > grace;
    return v('running_late', eta ? `Running late · ~${hm(eta)}` : 'Running late', decided ? `Decided: ${a.lateReply.kind}` : past ? `Past your ${grace}-minute grace — decide what happens.` : null, 'warn', !decided && past);
  }
  if (ci === 'on_my_way' && tripFresh) return v('location_shared', `En route · ~${a.clientTrip.etaMin || '?'} min`, `${a.clientTrip.distanceKm ?? '?'} km away (shared)`, 'info');
  if (ci === 'on_my_way') return v('on_time', 'On the way', null, 'info');
  if (unpaid) return v('payment_required', 'Payment required', 'Deposit not paid yet.', 'warn');
  return v('on_time', 'On time', null, 'muted');
}

/** Can a late start still fit? Compares their ETA with the service length, buffer and the provider's next booking. */
export function fitCheck(a: any, next: any | null, serviceMinutes: number, bufferMinutes = 0): { fits: boolean; overrunMinutes: number; finishAt: Date | null } {
  const start = toDate(a?.startTime); const eta = toDate(a?.etaAt || a?.clientEtaAt) || start;
  if (!start || !eta) return { fits: true, overrunMinutes: 0, finishAt: null };
  const finish = new Date(Math.max(eta.getTime(), start.getTime()) + serviceMinutes * 60000);
  const nextStart = toDate(next?.startTime);
  const limit = nextStart ? nextStart.getTime() - bufferMinutes * 60000 : Infinity;
  const over = Math.max(0, Math.round((finish.getTime() - limit) / 60000));
  return { fits: over === 0, overrunMinutes: over, finishAt: finish };
}

// ── WHO CAN DECIDE (per business: Booking policies → "Who can decide") ──────
// Owners, admins and managers decide everything. Staff, by the business's choice:
//   'decide_own' (default) — decide for their own clients; for others, send a reschedule offer
//   'recommend'            — send a reschedule offer (e.g. a receptionist); no other decisions
//   'view'                 — see the cases, no actions
export type OpsAction = 'keep' | 'move' | 'condense' | 'switch' | 'payment_exception' | 'provider_late';
export type StaffOpsLevel = 'decide_own' | 'recommend' | 'view';
export const MANAGER_ROLES = ['owner', 'admin', 'manager'];
export function opsCan(role: string | null | undefined, level: StaffOpsLevel | undefined, isOwnClient: boolean, action: OpsAction): boolean {
  const r = String(role || '').toLowerCase();
  if (MANAGER_ROLES.includes(r)) return true;
  if (action === 'payment_exception' || action === 'switch') return false;       // manager's call (fees, provider changes)
  const lv = level || 'decide_own';
  if (lv === 'view') return false;
  if (action === 'provider_late') return isOwnClient;                             // a provider can say THEY are running late
  if (action === 'move') return true;                                             // anyone who isn't view-only can offer a reschedule
  return lv === 'decide_own' && isOwnClient;
}
export const opsLevelOf = (tenant: any): StaffOpsLevel => (['decide_own', 'recommend', 'view'].includes(tenant?.bookingPolicies?.staffOpsLevel) ? tenant.bookingPolicies.staffOpsLevel : 'decide_own');

/** Provider running late: which of their next appointments move, and by how much (cascading). */
export function providerDelayImpact(appts: any[], freeAt: Date, durOf: (a: any) => number): { appt: any; delayMin: number; newStart: Date }[] {
  const out: { appt: any; delayMin: number; newStart: Date }[] = [];
  let free = freeAt.getTime();
  for (const a of [...appts].sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime))) {
    const s = Date.parse(a.startTime); if (!Number.isFinite(s)) continue;
    const ns = Math.max(s, free); const d = Math.round((ns - s) / 60000);
    if (d < 5) break;                                   // back on schedule — later guests unaffected
    out.push({ appt: a, delayMin: d, newStart: new Date(ns) });
    free = ns + Math.max(15, durOf(a)) * 60000;
  }
  return out;
}
