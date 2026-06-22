/**
 * src/lib/opal/recovery-engine.ts
 *
 * The Vacated-Slot Recovery engine — the highest-leverage system in the
 * product. Every disruption workflow (confirmed reschedule, confirmed cancel,
 * expired no-show) eventually produces an empty slot; this is the single
 * pipeline that decides what happens to it, automatically and immediately.
 *
 * Two responsibilities:
 *   1. spawnRecoveryTicket() — called the INSTANT a slot is vacated. No gap
 *      between confirmation and the recovery attempt starting; that gap is
 *      where most systems leak revenue.
 *   2. advanceRecoveryTier() — the time-boxed cascade. Driven by the scan
 *      route (GitHub Actions cron, same pattern as your automation checker),
 *      since Vercel Hobby cron is too limited.
 *
 * Server-side (firebase-admin). Pass in a Firestore `db` so this is agnostic
 * to how admin was initialized. Money is integer cents; dates are ISO strings.
 */

import type {
  RecoveryTicket,
  RecoveryStatus,
  RecoveryTier,
  RecoveryOutreach,
} from './resolution-engine';

type ISODate = string;
type ID = string;

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERABILITY SCORING — determines STRATEGY, not just odds
// ─────────────────────────────────────────────────────────────────────────────

export type Recoverability = 'low' | 'medium' | 'high';

export interface RecoveryStrategy {
  recoverability: Recoverability;
  /** Tiers to actually run, in order. Weeks-out slots skip the cascade. */
  tiers: RecoveryTier[];
  /** Timebox per tier in minutes; 0 = no timebox (terminal/public). */
  timeboxMinutes: Record<RecoveryTier, number>;
  /** Weeks-out slots just reopen public booking — no outreach noise. */
  publicBookingOnly: boolean;
}

export function scoreRecoverability(slotStart: ISODate, now: ISODate): RecoveryStrategy {
  const hoursUntil = (new Date(slotStart).getTime() - new Date(now).getTime()) / 3600000;

  // Under 4 hours: low odds, narrow audience, short timeboxes.
  if (hoursUntil < 4) {
    return {
      recoverability: 'low',
      tiers: [1, 2],
      timeboxMinutes: { 1: 20, 2: 20, 3: 0, 4: 0 },
      publicBookingOnly: false,
    };
  }
  // Same week: moderate odds, full cascade incl. push.
  if (hoursUntil < 24 * 7) {
    return {
      recoverability: 'medium',
      tiers: [1, 2, 3, 4],
      timeboxMinutes: { 1: 120, 2: 240, 3: 480, 4: 0 },
      publicBookingOnly: false,
    };
  }
  // Weeks out: high odds, cascade is unnecessary — just reopen public booking.
  return {
    recoverability: 'high',
    tiers: [4],
    timeboxMinutes: { 1: 0, 2: 0, 3: 0, 4: 0 },
    publicBookingOnly: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN — create-on-confirm. Idempotent on sourceResolutionTicketId.
// ─────────────────────────────────────────────────────────────────────────────

export interface VacatedSlot {
  tenantId: ID;
  resolutionTicketId: ID;
  locationId: ID | null;
  providerId: ID;
  resourceIds: ID[];
  serviceId: ID;
  durationMinutes: number;
  slotStart: ISODate;
  slotEnd: ISODate;
  originalAppointmentValueCents: number;
}

/**
 * Called by the confirmed-reschedule / confirmed-cancel paths and by the
 * no-show grace-expiry job. Creates exactly one RecoveryTicket per vacating
 * event and links it back onto the Resolution ticket. Returns the ticket id,
 * or the existing one if already spawned (idempotent under webhook/retry).
 */
export async function spawnRecoveryTicket(db: any, slot: VacatedSlot): Promise<ID> {
  const now = new Date().toISOString();

  // Idempotency — one recovery per resolution ticket.
  const existing = await db
    .collection(`tenants/${slot.tenantId}/tickets`)
    .where('kind', '==', 'recovery')
    .where('sourceResolutionTicketId', '==', slot.resolutionTicketId)
    .limit(1)
    .get();
  if (!existing.empty) return existing.docs[0].id;

  const strategy = scoreRecoverability(slot.slotStart, now);
  const firstTier = strategy.tiers[0];
  const firstTimebox = strategy.timeboxMinutes[firstTier] || null;

  // Weeks-out slots open straight onto public booking (tier4_active, no timebox).
  const initialStatus: RecoveryStatus = (`tier${firstTier}_active`) as RecoveryStatus;

  const ref = db.collection(`tenants/${slot.tenantId}/tickets`).doc();
  const ticket: RecoveryTicket = {
    id: ref.id,
    tenantId: slot.tenantId,
    kind: 'recovery',
    locationId: slot.locationId,
    clientId: null,
    recommendation: strategy.publicBookingOnly
      ? 'Slot is weeks out — reopened on public booking, no outreach needed.'
      : `Vacated slot — running tier ${firstTier} recovery (${strategy.recoverability} recoverability).`,
    resolvedBy: 'engine',
    policySnapshot: {},
    createdAt: now,
    resolvedAt: null,

    sourceResolutionTicketId: slot.resolutionTicketId,
    providerId: slot.providerId,
    resourceIds: slot.resourceIds,
    originalServiceId: slot.serviceId,
    originalDurationMinutes: slot.durationMinutes,
    vacatedAt: now,
    slotStart: slot.slotStart,
    slotEnd: slot.slotEnd,
    recoverability: strategy.recoverability,
    status: initialStatus,
    currentTier: firstTier,
    tierStartedAt: now,
    tierTimeboxMinutes: firstTimebox,
    claimantClientId: null,
    fillType: null,
    outcomeValueCents: null,
    linkedNewAppointmentId: null,
    bulkBatchId: null,
  };

  const batch = db.batch();
  batch.set(ref, ticket);
  // Link back onto the resolution ticket so the OCC can show cause → effect.
  batch.set(
    db.collection(`tenants/${slot.tenantId}/tickets`).doc(slot.resolutionTicketId),
    { recoveryTicketId: ref.id },
    { merge: true },
  );
  await batch.commit();

  // Fire the first tier's outreach immediately — no gap.
  await dispatchTierOutreach(db, ticket, firstTier);

  return ref.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER PROGRESSION — called repeatedly by the scan route
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL: RecoveryStatus[] = ['filled', 'partial_filled', 'expired'];

/**
 * Advances ONE recovery ticket if its current tier's timebox has elapsed with
 * no claim. Falls through to the next tier in the strategy, or expires when the
 * cascade is exhausted. Safe to call every minute; it's a no-op until a timebox
 * actually expires.
 */
export async function advanceRecoveryTier(db: any, ticket: RecoveryTicket): Promise<RecoveryStatus> {
  if (TERMINAL.includes(ticket.status)) return ticket.status;

  const now = Date.now();
  const ref = db.collection(`tenants/${ticket.tenantId}/tickets`).doc(ticket.id);

  // If the slot's start time has passed and it's still unfilled, it's dead.
  if (new Date(ticket.slotStart).getTime() <= now) {
    await ref.set({ status: 'expired', resolvedAt: new Date().toISOString() }, { merge: true });
    return 'expired';
  }

  const strategy = scoreRecoverability(ticket.slotStart, new Date().toISOString());

  // Tier 4 (public booking) has no timebox — it simply stays open until filled
  // or the slot time passes (handled above). Nothing to advance.
  if (ticket.currentTier === 4 || ticket.tierTimeboxMinutes === null || ticket.tierTimeboxMinutes === 0) {
    return ticket.status;
  }

  const tierStartedMs = ticket.tierStartedAt ? new Date(ticket.tierStartedAt).getTime() : now;
  const elapsedMin = (now - tierStartedMs) / 60000;
  if (elapsedMin < ticket.tierTimeboxMinutes) return ticket.status; // still active

  // Timebox expired — find the next tier in this strategy.
  const idx = strategy.tiers.indexOf(ticket.currentTier as RecoveryTier);
  const nextTier = strategy.tiers[idx + 1];

  if (nextTier === undefined) {
    // Cascade exhausted with no fill.
    await ref.set({ status: 'expired', resolvedAt: new Date().toISOString() }, { merge: true });
    return 'expired';
  }

  const nowIso = new Date().toISOString();
  const nextTimebox = strategy.timeboxMinutes[nextTier] || null;
  const nextStatus = (`tier${nextTier}_active`) as RecoveryStatus;
  await ref.set({
    status: nextStatus,
    currentTier: nextTier,
    tierStartedAt: nowIso,
    tierTimeboxMinutes: nextTimebox,
    recommendation: `Advanced to tier ${nextTier} recovery.`,
  }, { merge: true });

  await dispatchTierOutreach(db, { ...ticket, currentTier: nextTier, status: nextStatus }, nextTier);
  return nextStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH — recipient selection per tier + append-only outreach record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tier 1: waitlist matching this exact provider/service/window, ranked by
 *         priority_signal (strong band + currently 'due' beats a cold entry).
 * Tier 2: provider's favorite/preferred clients opted into last-minute openings.
 * Tier 3: broader push to nearby app users (optionally discounted).
 * Tier 4: public online booking — no targeted recipients.
 *
 * This writes the RecoveryOutreach record and returns recipient ids. The
 * ACTUAL send (SMS/push/email) reuses your existing notification infra — wire
 * `sendRecoveryNotification` to the same Twilio/Resend path onCancellationEvent
 * uses. Recipient selection + the append-only record are real here.
 */
export async function dispatchTierOutreach(db: any, ticket: RecoveryTicket, tier: RecoveryTier): Promise<number> {
  const now = new Date().toISOString();
  let channel: RecoveryOutreach['channel'] = 'public_booking';
  let recipientIds: ID[] = [];

  if (tier === 1) {
    channel = 'waitlist';
    recipientIds = await selectWaitlistRecipients(db, ticket);
  } else if (tier === 2) {
    channel = 'favorites';
    recipientIds = await selectFavoriteRecipients(db, ticket);
  } else if (tier === 3) {
    channel = 'push';
    // Broad push to nearby opted-in app users — selection is a marketing query
    // best run by the push provider; we record intent and recipient count only.
    recipientIds = [];
  } else {
    channel = 'public_booking';
    recipientIds = [];
  }

  const outreachRef = db.collection(`tenants/${ticket.tenantId}/recoveryOutreach`).doc();
  const record: RecoveryOutreach = {
    id: outreachRef.id,
    recoveryTicketId: ticket.id,
    tier,
    channel,
    sentAt: now,
    recipientCount: recipientIds.length,
    responseCount: 0,
    claimed: false,
  };
  await outreachRef.set(record);

  // Integration point — reuse onCancellationEvent's Twilio/Resend clients here.
  // await sendRecoveryNotification(ticket, recipientIds, channel);

  return recipientIds.length;
}

async function selectWaitlistRecipients(db: any, ticket: RecoveryTicket): Promise<ID[]> {
  // Active waitlist entries for this provider (or any) + service, whose window
  // covers the slot. Cross-location entries respect the 9.5 opt-in upstream.
  const snap = await db
    .collection(`tenants/${ticket.tenantId}/waitlist`)
    .where('status', '==', 'active')
    .where('desiredServiceId', '==', ticket.originalServiceId)
    .limit(50)
    .get();

  const slotStartMs = new Date(ticket.slotStart).getTime();
  const matches = snap.docs
    .map((d: any) => d.data())
    .filter((w: any) => {
      const providerOk = !w.desiredProviderId || w.desiredProviderId === ticket.providerId;
      const windowOk = !w.windowStart || !w.windowEnd ||
        (slotStartMs >= new Date(w.windowStart).getTime() && slotStartMs <= new Date(w.windowEnd).getTime());
      return providerOk && windowOk;
    })
    // priority_signal: higher first (strong band + 'due' computed upstream)
    .sort((a: any, b: any) => (b.prioritySignal || 0) - (a.prioritySignal || 0));

  return matches.map((w: any) => w.clientId);
}

async function selectFavoriteRecipients(db: any, ticket: RecoveryTicket): Promise<ID[]> {
  // Provider's preferred clients opted into last-minute openings.
  const snap = await db
    .collection(`tenants/${ticket.tenantId}/clients`)
    .where('preferredProviderId', '==', ticket.providerId)
    .where('lastMinuteOptIn', '==', true)
    .limit(50)
    .get();
  return snap.docs.map((d: any) => d.id);
}
