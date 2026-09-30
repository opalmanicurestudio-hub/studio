// src/lib/visit.ts — THE VISIT TICKET (pure). One record — the booking — is the visit, whatever the business.
// Every screen, report and rule reads the visit's STAGE and PAYMENT STATUS from here, instead of each one guessing from
// the 17 different status words (and the separate checkInStatus) found across the app.
//
//   Stage (the same six underneath, worded for each kind of business and visit):
//     requested → booked → arrived → (waiting) → in_service → ready_to_pay → complete     · off-ramps: cancelled · no_show · declined · expired
//     Waiting is its own stage but can be skipped (service starts straight away). Businesses rename any stage for their niche.
//   Flags (not stages): running late · deposit due · needs a decision · balance due
//   Payment: nothing_due · deposit_due · deposit_paid · partly_paid · paid · refund_pending · refunded
//
// Old values keep working: stageOf() reads every legacy status, and stageWrite() writes the legacy fields too, so
// nothing already saved (or any screen not yet moved over) breaks.
export type Stage = 'requested' | 'booked' | 'arrived' | 'waiting' | 'in_service' | 'ready_to_pay' | 'complete' | 'cancelled' | 'no_show' | 'declined' | 'expired';
export type PaymentStatus = 'nothing_due' | 'deposit_due' | 'deposit_paid' | 'partly_paid' | 'paid' | 'refund_pending' | 'refunded';
export const ACTIVE: Stage[] = ['requested', 'booked', 'arrived', 'waiting', 'in_service', 'ready_to_pay'];
export const CLOSED: Stage[] = ['complete', 'cancelled', 'no_show', 'declined', 'expired'];

const S = (v: any) => String(v || '').toLowerCase().trim();
export function stageOf(a: any): Stage {
  if (!a) return 'booked';
  // The STATUS decides (every stage the ticket writes also writes its status). A saved `stage` field is only a copy —
  // trusting it would go stale whenever a screen not yet moved over changes the status alone (e.g. "Finished" → ready to pay).
  const st = S(a.status), ci = S(a.checkInStatus);
  if (['cancelled', 'canceled'].includes(st) || ci === 'auto_cancelled') return 'cancelled';
  if (st === 'no_show') return 'no_show';
  if (st === 'declined') return 'declined';
  if (st === 'expired') return 'expired';
  if (['completed', 'checked_out', 'paid', 'complete'].includes(st) || ci === 'completed') return 'complete';
  if (st === 'ready_for_checkout') return 'ready_to_pay';
  if (['servicing', 'in_service', 'in_progress', 'seated'].includes(st)) return 'in_service';
  if (st === 'waiting') return 'waiting';
  if (['checked_in', 'arrived'].includes(st) || ci === 'arrived') return 'arrived';
  if (st === 'requested') return 'requested';
  return 'booked';   // confirmed · pending_payment · deposit_pending · late · on_hold · rescheduled · (blank)
}

export interface VisitFlags { runningLate: boolean; depositDue: boolean; needsDecision: boolean; balanceDue: boolean }
export function flagsOf(a: any): VisitFlags {
  const st = S(a?.status);
  return {
    runningLate: S(a?.checkInStatus) === 'running_late' || st === 'late' || !!a?.runningLateAt,
    depositDue: st === 'pending_payment' || st === 'deposit_pending' || S(a?.depositStatus) === 'pending',
    needsDecision: S(a?.lateDecision?.status) === 'pending' || S(a?.providerOffer?.status) === 'pending' || st === 'requested',
    balanceDue: Number(a?.balanceDue || a?.balanceCollectCents || 0) > 0,
  };
}

export function paymentStatusOf(a: any): PaymentStatus {
  if (!a) return 'nothing_due';
  const dep = S(a.depositStatus), ps = S(a.paymentStatus);
  if (ps === 'refunded' || a.refundedAt) return 'refunded';
  if (ps === 'refund_pending' || a.pendingRefund) return 'refund_pending';
  if (stageOf(a) === 'complete' && (a.checkoutSessionId || ps === 'paid')) return 'paid';
  if (ps === 'partly_paid' || Number(a.balanceDue) > 0) return 'partly_paid';
  if (dep === 'paid' || dep === 'covered' || dep === 'applied') return 'deposit_paid';
  if (dep === 'pending' || S(a.status) === 'pending_payment') return 'deposit_due';
  if (dep === 'scheduled') return 'deposit_due';
  return 'nothing_due';
}

// ── Wording: the same stages, in each business's language ──
export type VisitKind = 'service' | 'table' | 'class' | 'event' | 'virtual';
export function kindOf(a: any): VisitKind {
  if (a?.tableId || a?.partySize && a?.hostingSessionId || S(a?.kind) === 'table') return 'table';
  if (a?.classId || a?.courseId || S(a?.kind) === 'class') return 'class';
  if (a?.eventId || S(a?.kind) === 'event') return 'event';
  if (['video', 'phone'].includes(S(a?.where)) || S(a?.kind) === 'virtual') return 'virtual';
  return 'service';
}
const WORDS: Record<VisitKind, Partial<Record<Stage, string>>> = {
  service: { requested: 'Requested', booked: 'Booked', arrived: 'Arrived', waiting: 'Waiting', in_service: 'In service', ready_to_pay: 'Ready to pay', complete: 'Complete' },
  table:   { requested: 'Requested', booked: 'Reserved', arrived: 'Arrived', waiting: 'Waiting for a table', in_service: 'Seated', ready_to_pay: 'Bill requested', complete: 'Closed' },
  class:   { requested: 'Waitlisted', booked: 'Enrolled', arrived: 'Checked in', waiting: 'Waiting to start', in_service: 'In class', ready_to_pay: 'To pay', complete: 'Attended' },
  event:   { requested: 'Requested', booked: 'Registered', arrived: 'Checked in', waiting: 'Waiting to start', in_service: 'Attending', ready_to_pay: 'To pay', complete: 'Attended' },
  virtual: { requested: 'Requested', booked: 'Booked', arrived: 'Joined', waiting: 'In the waiting room', in_service: 'In session', ready_to_pay: 'Ready to pay', complete: 'Complete' },
};
const BY_BUSINESS: Record<string, Partial<Record<Stage, string>>> = {
  medspa: { in_service: 'With practitioner' }, wellness: { in_service: 'In session' }, spa: { in_service: 'In treatment' }, tattoo: { in_service: 'In the chair' },
};
const CLOSED_WORDS: Record<string, string> = { cancelled: 'Cancelled', no_show: 'No-show', declined: 'Declined', expired: 'Expired' };
export function stageLabel(stage: Stage, a?: any, tenant?: any): string {
  if (CLOSED_WORDS[stage]) return CLOSED_WORDS[stage];
  const k = kindOf(a); const custom = tenant?.visitStageLabels?.[k]?.[stage];
  return String(custom || (k === 'service' ? BY_BUSINESS[S(tenant?.businessType)]?.[stage] : null) || WORDS[k][stage] || WORDS.service[stage] || stage);
}
export const PAYMENT_LABEL: Record<PaymentStatus, string> = { nothing_due: 'Nothing due', deposit_due: 'Deposit due', deposit_paid: 'Deposit paid', partly_paid: 'Partly paid', paid: 'Paid', refund_pending: 'Refund pending', refunded: 'Refunded' };

// ── Moving a visit on: which moves are allowed, and what the old fields become ──
const NEXT: Record<Stage, Stage[]> = {
  requested: ['booked', 'declined'], booked: ['arrived'], arrived: ['waiting', 'in_service', 'booked'], waiting: ['in_service', 'arrived'], in_service: ['ready_to_pay', 'waiting', 'arrived'],
  ready_to_pay: ['in_service'], complete: [], cancelled: [], no_show: [], declined: [], expired: [],
};
/** Stage moves the visit ticket does itself. Completing (via checkout), cancelling and no-shows keep their own flows
 *  (fees, deposits, refunds, messages) — those aren't shortcuts here. */
export const canMove = (from: Stage, to: Stage) => (NEXT[from] || []).includes(to);
export function stageWrite(to: Stage): Record<string, any> {
  switch (to) {
    case 'booked': return { stage: 'booked', status: 'confirmed', checkInStatus: 'pending' };
    case 'arrived': return { stage: 'arrived', status: 'checked_in', checkInStatus: 'arrived' };
    case 'waiting': return { stage: 'waiting', status: 'waiting', checkInStatus: 'arrived' };
    case 'in_service': return { stage: 'in_service', status: 'servicing', checkInStatus: 'arrived' };
    case 'ready_to_pay': return { stage: 'ready_to_pay', status: 'ready_for_checkout', checkInStatus: 'arrived' };
    case 'declined': return { stage: 'declined', status: 'declined' };
    default: return { stage: to };
  }
}

// ── The timeline ──
export interface TimelineEntry { at: string; kind: 'stage' | 'note' | 'payment' | 'change' | 'message'; stage?: Stage; text: string; by?: string | null; via?: string | null; forClient?: boolean }
export const MAX_TIMELINE = 60;
/** The client's simple version: only the stage moves (and anything marked for them), in plain words. */
export interface ClientTimelineSettings { on: boolean; showTimes: boolean; stages: Stage[]; notes: boolean }
/** What the business lets clients see on their visit link (Settings → Visit stages). */
export function clientTimelineSettingsOf(tenant: any): ClientTimelineSettings {
  const c = tenant?.visitTimeline || {}; const all: Stage[] = ['booked', 'arrived', 'waiting', 'in_service', 'ready_to_pay', 'complete'];
  return { on: c.on !== false && tenant?.visitTimelineForClients !== false, showTimes: c.showTimes !== false, stages: Array.isArray(c.stages) ? all.filter((s) => c.stages.includes(s)) : all, notes: c.notes !== false };
}
export function publicTimeline(entries: TimelineEntry[], a?: any, tenant?: any): { at: string; text: string }[] {
  const cs = clientTimelineSettingsOf(tenant); if (!cs.on) return [];
  return (entries || []).filter((e) => (e.kind === 'stage' && e.stage && cs.stages.includes(e.stage)) || (e.forClient && cs.notes))
    .map((e) => ({ at: e.at, text: e.kind === 'stage' && e.stage ? (e.stage === 'in_service' && a?.staffName ? `${stageLabel(e.stage, a, tenant)} — ${String(a.staffName).split(' ')[0]}` : stageLabel(e.stage, a, tenant)) : e.text }))
    .slice(-8);
}

/** What the client's copies of the visit carry (their visit link reads these) — kept in step with the visit. */
export function visitProjection(a: any, tenant?: any) {
  const stage = stageOf(a);
  return { stage, stageLabel: stageLabel(stage, a, tenant), flags: flagsOf(a), paymentStatus: paymentStatusOf(a), status: a?.status || null, checkInStatus: a?.checkInStatus || null,
    startTime: a?.startTime || null, endTime: a?.endTime || null, staffId: a?.staffId || null, depositStatus: a?.depositStatus || null,
    timelinePublic: publicTimeline(a?.timeline || [], a, tenant), timelineShowTimes: clientTimelineSettingsOf(tenant).showTimes, visitUpdatedAt: new Date().toISOString() };
}
