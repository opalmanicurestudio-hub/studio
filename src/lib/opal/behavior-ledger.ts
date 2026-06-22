/**
 * src/lib/opal/behavior-ledger.ts
 *
 * The ONE place behavioral events are recorded. Before this, the same facts
 * lived scattered across client docs (cancellationCount, rescheduleCount,
 * no-show flags) where they drifted and couldn't be replayed. Now every
 * disruption appends one immutable row here, and reliability is COMPUTED from
 * these rows at read time — never from a cached counter.
 *
 * db-agnostic (pass in a firebase-admin Firestore), same as recovery-engine.ts.
 * Integer cents, ISO strings.
 */

import { computeReliabilityBand } from './resolution-engine';
import type { BehaviorEvent, BehaviorEventType, ReliabilityResult } from './resolution-engine';

type ID = string;

export interface AppendBehaviorArgs {
  tenantId: ID;
  clientId: ID;
  eventType: BehaviorEventType;
  /**
   * Read-time leniency context (3.4). 'recovery_fill' = the client claimed a
   * last-minute recovered slot then failed to honor it — weighed leniently
   * because they were doing the business a favor. 'business_initiated' =
   * provider illness/closure, never the client's fault. 'cascaded_reschedule'
   * = a reschedule of a reschedule, counted once not twice.
   */
  weightContext?: BehaviorEvent['weightContext'];
  locationId?: ID | null;          // reporting only — never scopes the score
  resolutionTicketId?: ID | null;  // link back to the originating ticket
}

/**
 * Append one behavioral event. Returns the new row's id. NEVER updates or
 * deletes — this table is the replayable source of truth for reliability,
 * cadence, and dispute-evidence.
 */
export async function appendBehaviorEvent(db: any, args: AppendBehaviorArgs): Promise<ID> {
  const ref = db.collection(`tenants/${args.tenantId}/behaviorLedger`).doc();
  const event: BehaviorEvent = {
    id: ref.id,
    tenantId: args.tenantId,
    clientId: args.clientId,
    eventType: args.eventType,
    weightContext: args.weightContext || 'normal',
    locationId: args.locationId ?? null,
    resolutionTicketId: args.resolutionTicketId ?? null,
    timestamp: new Date().toISOString(),
  };
  await ref.set(event);
  return ref.id;
}

/**
 * Read-time reliability for a client: load their ledger, compute the band.
 * This is the single function every booking/cancel/reschedule path should call
 * to get a band, so the logic lives in exactly one place. defaultBand is the
 * tenant's cold-start posture for thin-history clients.
 */
export async function readClientReliability(
  db: any,
  tenantId: ID,
  clientId: ID,
  defaultBand: ReliabilityResult['band'] = 'standard',
): Promise<ReliabilityResult> {
  const snap = await db.collection(`tenants/${tenantId}/behaviorLedger`)
    .where('clientId', '==', clientId)
    .limit(300).get();
  const events = snap.docs.map((d: any) => d.data() as BehaviorEvent);
  return computeReliabilityBand(events, new Date().toISOString(), defaultBand);
}

/**
 * Map a disruption to its behavioral event type. Keeps the trigger → event
 * mapping in one place so every call site agrees (a >policy-window cancel is a
 * late_cancel; inside-window is a plain cancel-as-reschedule signal, etc.).
 */
export function eventTypeForDisruption(
  kind: 'cancel' | 'reschedule' | 'no_show' | 'late_arrival' | 'completed',
  isLate: boolean,
): BehaviorEventType {
  if (kind === 'cancel') return isLate ? 'late_cancel' : 'reschedule';
  if (kind === 'reschedule') return 'reschedule';
  if (kind === 'no_show') return 'no_show';
  if (kind === 'late_arrival') return 'late_arrival';
  return 'completed';
}
