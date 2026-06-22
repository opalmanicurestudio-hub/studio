import { NextRequest, NextResponse } from 'next/server';
import {
  RECOVERY_TIER_TIMEBOX_MINUTES,
  computeReliabilityBand,
  resolvePolicy,
} from '@/lib/opal/resolution-engine';
import type {
  RecoveryTicket,
  RecoveryStatus,
  RecoveryTier,
  BehaviorEvent,
  PolicyRule,
} from '@/lib/opal/resolution-engine';

// ─── /api/recovery/route.ts ───────────────────────────────────────────────────
// The Recovery Ticket lifecycle engine. One route, three actions:
//
//   POST { action: 'open',  ... }   Fired on a confirmed reschedule, confirmed
//                                    cancel, or no-show grace expiry. Creates the
//                                    Recovery Ticket and starts the right tier.
//   POST { action: 'tick',  tenantId }
//                                    Called by the scheduled GitHub Action every
//                                    few minutes. Advances tiers whose timebox
//                                    expired, fires the next tier's outreach, and
//                                    expires tickets whose slot has passed unfilled.
//   POST { action: 'claim', ... }   A client claims an opening. Transactional
//                                    first-claim-wins lock + a FRESH policy check
//                                    against the CLAIMANT (not the original client).
//
// Depends on src/lib/opal/resolution-engine.ts.

function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

const nowIso = () => new Date().toISOString();
const minutesBetween = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 60000;

// time-until-slot drives the whole strategy (recoverability scoring, 7.2)
function bucketFor(minutesUntilSlot: number): 'under4h' | 'sameWeek' | 'weeksOut' {
  if (minutesUntilSlot < 240) return 'under4h';
  if (minutesUntilSlot < 7 * 1440) return 'sameWeek';
  return 'weeksOut';
}
const recoverabilityFor = (bucket: string): 'low' | 'medium' | 'high' =>
  bucket === 'under4h' ? 'low' : bucket === 'sameWeek' ? 'medium' : 'high';

const tierTimebox = (bucket: 'under4h' | 'sameWeek' | 'weeksOut', tier: RecoveryTier): number =>
  (RECOVERY_TIER_TIMEBOX_MINUTES[bucket] as any)[`tier${tier}`] ?? 0;

type OutreachChannel = 'waitlist' | 'favorites' | 'push' | 'public_booking';
const tierChannel = (tier: RecoveryTier): OutreachChannel =>
  tier === 1 ? 'waitlist' : tier === 2 ? 'favorites' : tier === 3 ? 'push' : 'public_booking';

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const action = body.action;
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  try {
    const db = getAdmin();
    if (action === 'open')  return await openRecovery(db, body);
    if (action === 'tick')  return await tickRecovery(db, body);
    if (action === 'claim') return await claimRecovery(db, body);
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('[recovery]', action, err);
    return NextResponse.json({ ok: false, error: err?.message || 'Recovery engine error' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPEN — create the Recovery Ticket the instant a slot is vacated
// ─────────────────────────────────────────────────────────────────────────────
async function openRecovery(db: any, body: any) {
  const {
    tenantId, sourceResolutionTicketId, providerId, resourceIds = [],
    originalServiceId, originalDurationMinutes, slotStart, slotEnd,
    locationId = null, originalClientId = null,
  } = body;

  if (!tenantId || !sourceResolutionTicketId || !providerId || !slotStart || !slotEnd) {
    return NextResponse.json({ error: 'Missing required fields for open' }, { status: 400 });
  }

  // Idempotency — one recovery per source resolution ticket. A retried confirm
  // (or a webhook firing twice) must not spawn two recoveries for one slot.
  const existing = await db.collection(`tenants/${tenantId}/tickets`)
    .where('kind', '==', 'recovery')
    .where('sourceResolutionTicketId', '==', sourceResolutionTicketId)
    .limit(1).get();
  if (!existing.empty) {
    return NextResponse.json({ ok: true, recoveryTicketId: existing.docs[0].id, deduped: true });
  }

  const now = nowIso();
  const minutesUntil = minutesBetween(slotStart, now);
  const bucket = bucketFor(minutesUntil);
  const recoverability = recoverabilityFor(bucket);

  // Weeks out: don't run the cascade at all — just reopen on public booking.
  // Near-term: start at tier 1 (waitlist) with the bucket's timebox.
  const startTier: RecoveryTier = bucket === 'weeksOut' ? 4 : 1;
  const status: RecoveryStatus = bucket === 'weeksOut' ? 'tier4_active' : 'tier1_active';
  const timebox = tierTimebox(bucket, startTier);

  const ref = db.collection(`tenants/${tenantId}/tickets`).doc();
  const ticket: RecoveryTicket = {
    id: ref.id,
    tenantId,
    kind: 'recovery',
    locationId,
    clientId: originalClientId,   // reporting only — never scopes the new claimant
    recommendation: bucket === 'weeksOut'
      ? 'Slot reopened on public booking — no cascade needed'
      : 'Offer to waitlist first, then favorites, then push',
    resolvedBy: 'engine',
    policySnapshot: {},
    createdAt: now,
    resolvedAt: null,
    sourceResolutionTicketId,
    providerId,
    resourceIds,
    originalServiceId,
    originalDurationMinutes,
    vacatedAt: now,
    slotStart,
    slotEnd,
    recoverability,
    status,
    currentTier: startTier,
    tierStartedAt: now,
    tierTimeboxMinutes: timebox,
    claimantClientId: null,
    fillType: null,
    outcomeValueCents: null,
    linkedNewAppointmentId: null,
    bulkBatchId: null,
  };
  await ref.set(ticket);

  // Link the recovery back onto the resolution ticket that caused it.
  await db.doc(`tenants/${tenantId}/tickets/${sourceResolutionTicketId}`)
    .set({ recoveryTicketId: ref.id }, { merge: true }).catch(() => {});

  // Fire the first tier's outreach immediately — zero gap is the whole point.
  const outreach = await fireOutreach(db, tenantId, ticket, startTier);

  return NextResponse.json({ ok: true, recoveryTicketId: ref.id, recoverability, startTier, ...outreach });
}

// ─────────────────────────────────────────────────────────────────────────────
// TICK — scheduler advances expired tiers and expires dead slots
// ─────────────────────────────────────────────────────────────────────────────
async function tickRecovery(db: any, body: any) {
  const { tenantId } = body;
  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });

  const activeStatuses = ['tier1_active', 'tier2_active', 'tier3_active', 'tier4_active'];
  const snap = await db.collection(`tenants/${tenantId}/tickets`)
    .where('kind', '==', 'recovery')
    .where('status', 'in', activeStatuses)
    .limit(200).get();

  const now = nowIso();
  let advanced = 0, expired = 0, firedTier = 0;

  for (const doc of snap.docs) {
    const t = doc.data() as RecoveryTicket;

    // Slot has passed unfilled → expire.
    if (new Date(t.slotStart).getTime() <= Date.now()) {
      await doc.ref.set({ status: 'expired', resolvedAt: now }, { merge: true });
      expired++;
      continue;
    }

    // tier4 public booking with a 0 timebox waits for the slot or a claim — never auto-advances.
    if (!t.tierTimeboxMinutes || t.tierTimeboxMinutes <= 0) continue;

    const elapsed = minutesBetween(now, t.tierStartedAt || t.vacatedAt);
    if (elapsed < t.tierTimeboxMinutes) continue;   // current tier still has time

    // Timebox elapsed → advance to next tier (or expire after tier 4).
    const bucket = t.recoverability === 'low' ? 'under4h' : t.recoverability === 'medium' ? 'sameWeek' : 'weeksOut';
    const next = ((t.currentTier || 1) + 1) as RecoveryTier;

    if (next > 4) {
      await doc.ref.set({ status: 'expired', resolvedAt: now }, { merge: true });
      expired++;
      continue;
    }

    const nextTimebox = tierTimebox(bucket as any, next);
    await doc.ref.set({
      status: (`tier${next}_active`) as RecoveryStatus,
      currentTier: next,
      tierStartedAt: now,
      tierTimeboxMinutes: nextTimebox,
    }, { merge: true });
    advanced++;

    const fresh = { ...t, currentTier: next };
    await fireOutreach(db, tenantId, fresh, next);
    firedTier++;
  }

  return NextResponse.json({ ok: true, scanned: snap.size, advanced, expired, firedTier });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAIM — transactional first-wins lock + fresh policy check against claimant
// ─────────────────────────────────────────────────────────────────────────────
async function claimRecovery(db: any, body: any) {
  const {
    tenantId, recoveryTicketId, claimantClientId,
    claimantType = 'unknown',   // 'waitlist_favorite' | 'new_unknown' | 'known' | 'discounted'
    channel = 'public_booking',
    isDiscountedSlot = false,
  } = body;

  if (!tenantId || !recoveryTicketId || !claimantClientId) {
    return NextResponse.json({ error: 'Missing tenantId, recoveryTicketId, or claimantClientId' }, { status: 400 });
  }

  const ticketRef = db.doc(`tenants/${tenantId}/tickets/${recoveryTicketId}`);

  // ── First-claim-wins: the lock lives inside a Firestore transaction so two
  //    simultaneous claims can't both succeed. The loser gets a graceful
  //    "just missed it", never a partial write or an error.
  let lockResult: { won: boolean; ticket?: RecoveryTicket } = { won: false };
  await db.runTransaction(async (txn: any) => {
    const cur = await txn.get(ticketRef);
    if (!cur.exists) throw new Error('Recovery ticket not found');
    const t = cur.data() as RecoveryTicket;
    if (t.claimantClientId || t.status === 'filled' || t.status === 'expired') {
      lockResult = { won: false };
      return;
    }
    txn.update(ticketRef, {
      claimantClientId,
      status: 'filled',
      resolvedAt: nowIso(),
    });
    lockResult = { won: true, ticket: t };
  });

  if (!lockResult.won) {
    return NextResponse.json({ ok: false, reason: 'just_missed_it', message: 'That opening was just taken. Showing similar times.' });
  }

  const t = lockResult.ticket as RecoveryTicket;
  const now = nowIso();

  // ── Fresh policy check against the CLAIMANT (7.5). Recovery is NOT a blanket
  //    deposit exemption — the standard engine runs, against the new claimant's
  //    identity and history, never the original client's.
  const ledgerSnap = await db.collection(`tenants/${tenantId}/behaviorLedger`)
    .where('clientId', '==', claimantClientId).limit(200).get();
  const events = ledgerSnap.docs.map((d: any) => d.data() as BehaviorEvent);
  const reliability = computeReliabilityBand(events, now);

  const policySnap = await db.collection(`tenants/${tenantId}/policyRules`).limit(100).get();
  const rules = policySnap.docs.map((d: any) => d.data() as PolicyRule);
  const standardDepositCents = resolvePolicy(rules, 'deposit_requirement_cents', t.locationId, 0);

  // Deposit behavior by claimant type — friction kills favor-driven conversions,
  // but a poor-history claimant pays regardless of channel.
  let depositRequiredCents = 0;
  let discountForfeitOnNoShow = false;
  if (reliability.band === 'requires_deposit' || reliability.band === 'requires_approval') {
    depositRequiredCents = standardDepositCents;   // their band governs, any channel
  } else if (claimantType === 'new_unknown') {
    depositRequiredCents = standardDepositCents;    // standard new-client rule
  } else if (claimantType === 'discounted' || isDiscountedSlot) {
    depositRequiredCents = 0;                        // no friction, but...
    discountForfeitOnNoShow = true;                  // discount forfeited (full price) on no-show
  } else {
    depositRequiredCents = 0;                        // waitlist/favorite near-term claim
  }

  // ── Create the new appointment for this same slot. fillType notes whether the
  //    claimant's service matches the original duration (7.4 mismatch case).
  const aptRef = db.collection(`tenants/${tenantId}/appointments`).doc();
  const fillType: RecoveryTicket['fillType'] = 'exact_match'; // refine when claimant picks a different service
  await aptRef.set({
    id: aptRef.id,
    tenantId,
    clientId: claimantClientId,
    staffId: t.providerId,
    serviceId: t.originalServiceId,
    startTime: t.slotStart,
    endTime: t.slotEnd,
    status: 'confirmed',
    source: 'recovery',
    isWalkIn: false,
    recoveredFromTicketId: t.id,
    depositRequiredCents,
    depositStatus: depositRequiredCents > 0 ? 'pending' : 'none',
    discountForfeitOnNoShow,
    createdAt: now,
  });

  await ticketRef.set({
    fillType,
    linkedNewAppointmentId: aptRef.id,
    claimChannel: channel,
  }, { merge: true });

  // Mark the most recent open outreach row for this ticket as claimed.
  const orSnap = await db.collection(`tenants/${tenantId}/recoveryOutreach`)
    .where('recoveryTicketId', '==', t.id)
    .orderBy('sentAt', 'desc').limit(1).get();
  if (!orSnap.empty) await orSnap.docs[0].ref.set({ claimed: true }, { merge: true });

  return NextResponse.json({
    ok: true,
    appointmentId: aptRef.id,
    claimantBand: reliability.band,
    depositRequiredCents,
    discountForfeitOnNoShow,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH — writes the append-only attempt row and selects recipients.
// Tier 1 (waitlist) recipient selection is implemented against the waitlist
// collection; tiers 2-4 record the attempt and expose a clear dispatch hook
// where the actual Twilio/push send plugs in (same transport onCancellationEvent
// already uses). This deliberately does NOT invent the notification transport.
// ─────────────────────────────────────────────────────────────────────────────
async function fireOutreach(db: any, tenantId: string, t: RecoveryTicket, tier: RecoveryTier) {
  const channel = tierChannel(tier);
  let recipientCount = 0;

  if (tier === 1) {
    // Tier 1 = waitlist clients matching this exact provider / service / window,
    // ranked by priority_signal. Capped query keeps the tier timebox honest.
    const wlSnap = await db.collection(`tenants/${tenantId}/waitlistEntries`)
      .where('status', '==', 'active')
      .where('desiredServiceId', '==', t.originalServiceId)
      .limit(50).get();
    const matches = wlSnap.docs.filter((d: any) => {
      const w = d.data();
      const providerOk = !w.desiredProviderId || w.desiredProviderId === t.providerId;
      const locOk = !w.desiredLocationIds || w.desiredLocationIds.length === 0 || w.desiredLocationIds.includes(t.locationId);
      return providerOk && locOk;
    });
    recipientCount = matches.length;
    // DISPATCH HOOK: notify matches[] here (Twilio/push), first response wins.
  } else if (tier === 2) {
    const favSnap = await db.collection(`tenants/${tenantId}/clients`)
      .where('preferredProviderId', '==', t.providerId)
      .where('lastMinuteOptIn', '==', true)
      .limit(50).get();
    recipientCount = favSnap.size;
    // DISPATCH HOOK
  } else if (tier === 3) {
    // Broad push to nearby app users, optional last-minute discount flag.
    recipientCount = 0; // DISPATCH HOOK: push provider returns audience size
  } else {
    // Tier 4: just reopen on public booking — no targeted outreach.
    recipientCount = 0;
  }

  const orRef = db.collection(`tenants/${tenantId}/recoveryOutreach`).doc();
  await orRef.set({
    id: orRef.id,
    recoveryTicketId: t.id,
    tier,
    channel,
    sentAt: nowIso(),
    recipientCount,
    responseCount: 0,
    claimed: false,
  });

  return { tier, channel, recipientCount };
}
