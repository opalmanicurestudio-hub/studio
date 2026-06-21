/**
 * functions/src/autoCancel.ts
 *
 * Scheduled function that runs every 5 minutes and enforces the studio's
 * no-show detection rules. As of this revision, this function NEVER cancels
 * an appointment directly — it only flags and escalates. The actual
 * cancellation (fee charge, deposit forfeiture, cancellationEvent creation)
 * happens exclusively in api/notifications/handle-no-show-action's
 * `confirm_no_show` action, once a staff member confirms. This keeps a
 * single source of truth for "what actually cancels a no-show" instead of
 * two competing code paths racing each other.
 *
 *   Rule 1 — No-Show Detection (flag only)
 *     If an appointment is still 'confirmed' X minutes after its start time
 *     and the client never checked in, flag it as a suspected no-show and
 *     notify the assigned staff member (or admins/owners if unassigned).
 *     Default window: 15 minutes. Configurable: tenant.noShowWindowMinutes
 *
 *   Rule 1b — Escalation
 *     If a suspected no-show goes unresolved for tenant.noShowConfirmWindowMinutes
 *     (default 10), escalate by notifying admins/owners directly. Each
 *     appointment escalates at most once.
 *
 *   Rule 2 — Late Cancellation Window
 *     Implemented in api/appointments/self-cancel/route.ts, NOT here — that
 *     route owns the entire self-service cancellation flow (the client-facing
 *     link), so it's the natural place for the window check: if the
 *     self-service link is used inside tenant.cancellationWindowHours, the
 *     fee is flagged rather than waived, and routes through the same
 *     cancellationEvent pipeline as every other cancellation path.
 *
 *   Rule 3 — Deposit Forfeiture on No-Show
 *     Handled in api/notifications/handle-no-show-action's confirm_no_show
 *     action, NOT here — keeping it in one place since this function no
 *     longer owns the cancellation moment.
 *
 *   Rule 4 — Repeat No-Show Flag
 *     If a client has ≥ N confirmed no-shows in the past 90 days,
 *     automatically add a flag to their profile (requireDeposit,
 *     requireCardOnFile). Configurable: tenant.repeatNoShowThreshold
 *     (default: 2). Keys off `cancellationAudit.actorType === 'no_show'`
 *     on cancelled appointments — NOT `autoCancelledNoShow`, which nothing
 *     in the current pipeline sets anymore (see note on that field).
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantConfig {
  id: string;
  name: string;
  noShowWindowMinutes?: number;        // minutes after start before flagging suspected no-show (default 15)
  noShowConfirmWindowMinutes?: number; // minutes staff have to respond before escalation (default 10)
  repeatNoShowThreshold?: number;      // no-shows before flagging client (default 2)
  autoCancelEnabled?: boolean;         // master kill-switch (default true)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ── Main scheduled function ───────────────────────────────────────────────────
export const autoCancel = functions.scheduler.onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();

    await Promise.allSettled(
      tenantsSnap.docs.map(async tenantDoc => {
        const tenant = { id: tenantDoc.id, ...tenantDoc.data() } as TenantConfig;

        // Per-tenant kill-switch
        if (tenant.autoCancelEnabled === false) return;

        await Promise.allSettled([
          processNoShows(tenant),
          processRepeatNoShowFlags(tenant),
        ]);
      }),
    );
  },
);

// ── Rule 1 + 1b: No-Show Flagging & Escalation ────────────────────────────────
async function processNoShows(tenant: TenantConfig) {
  const windowMinutes = tenant.noShowWindowMinutes ?? 15;
  const confirmWindowMinutes = tenant.noShowConfirmWindowMinutes ?? 10;
  const cutoff = minutesAgo(windowMinutes);

  // Deliberately NOT filtering on a third equality clause here (e.g.
  // `autoCancelledNoShow == false` / `suspectedNoShow == false`). Firestore
  // equality filters never match a document where the field is missing
  // entirely, so any appointment created without that field pre-initialized
  // would be permanently invisible to this query. Instead we do the
  // "already handled" checks in code below, against whatever appointments
  // are still sitting in 'confirmed' status past the cutoff.
  const apptSnap = await db
    .collection(`tenants/${tenant.id}/appointments`)
    .where('status', '==', 'confirmed')
    .where('startTime', '<=', cutoff.toISOString())
    .get();

  if (apptSnap.empty) return;

  await Promise.allSettled(
    apptSnap.docs.map(async apptDoc => {
      const appt = { id: apptDoc.id, ...apptDoc.data() } as any;

      // Checked in — not a no-show candidate.
      if (appt.actualStartTime) return;

      // Legacy/defensive: some older doc somehow has this set directly. Skip.
      if (appt.autoCancelledNoShow) return;

      // Staff already said "client is here" — trust that and stop flagging
      // this appointment. If it's still stuck in 'confirmed' afterward,
      // that's a separate manual-workflow issue, not something to keep
      // re-flagging every 5 minutes.
      if (appt.suspectedNoShowCleared) return;

      const now = new Date().toISOString();

      if (!appt.suspectedNoShow) {
        // ── First time crossing the window — flag and notify, never cancel ──
        const staffIds = new Set<string>();
        if (appt.staffId) staffIds.add(appt.staffId);

        // No assigned staff — fall back to notifying admins/owners directly
        // so the flag doesn't go unseen.
        if (staffIds.size === 0) {
          const adminsSnap = await db
            .collection(`tenants/${tenant.id}/staff`)
            .where('role', 'in', ['admin', 'owner'])
            .get();
          adminsSnap.docs.forEach(d => staffIds.add(d.id));
        }

        const batch = db.batch();
        batch.update(apptDoc.ref, {
          suspectedNoShow: true,
          suspectedNoShowAt: now,
        });

        staffIds.forEach(staffId => {
          const notifRef = db.collection(`tenants/${tenant.id}/notifications`).doc();
          batch.set(notifRef, {
            id: notifRef.id,
            userId: staffId,
            type: 'suspected_no_show',
            appointmentId: appt.id,
            resolved: false,
            message: `${appt.clientName || 'A client'}'s appointment hasn't checked in (${windowMinutes}m past start) — confirm no-show or dismiss`,
            link: `/pos?appointment=${appt.id}`,
            createdAt: now,
            read: false,
          });
        });

        await batch.commit();
        console.log(`Flagged suspected no-show: tenant=${tenant.id} appt=${appt.id}`);
        return;
      }

      // ── Already flagged — check whether it's time to escalate ───────────────
      if (appt.noShowEscalatedAt) return; // escalates at most once per appointment

      const flaggedAt = new Date(appt.suspectedNoShowAt || now).getTime();
      const minutesSinceFlagged = (Date.now() - flaggedAt) / (60 * 1000);
      if (minutesSinceFlagged < confirmWindowMinutes) return;

      const adminsSnap = await db
        .collection(`tenants/${tenant.id}/staff`)
        .where('role', 'in', ['admin', 'owner'])
        .get();

      const batch = db.batch();
      batch.update(apptDoc.ref, { noShowEscalatedAt: now });

      adminsSnap.docs.forEach(d => {
        const notifRef = db.collection(`tenants/${tenant.id}/notifications`).doc();
        batch.set(notifRef, {
          id: notifRef.id,
          userId: d.id,
          type: 'no_show_escalation',
          appointmentId: appt.id,
          resolved: false,
          message: `Unresolved no-show: ${appt.clientName || 'a client'} — staff hasn't responded in ${confirmWindowMinutes}m`,
          link: `/pos?appointment=${appt.id}`,
          createdAt: now,
          read: false,
        });
      });

      await batch.commit();
      console.log(`Escalated no-show: tenant=${tenant.id} appt=${appt.id}`);
    }),
  );
}

// ── Rule 4: Repeat No-Show Flagging ──────────────────────────────────────────
async function processRepeatNoShowFlags(tenant: TenantConfig) {
  const threshold = tenant.repeatNoShowThreshold ?? 2;
  const since = daysAgo(90).toISOString();

  // Keys off cancellationAudit.actorType — the field actually written by
  // handle-no-show-action's confirm_no_show path. autoCancelledNoShow is
  // never set by anything in the current pipeline (this function no longer
  // auto-cancels), so querying on it here would silently match nothing.
  const noShowSnap = await db
    .collection(`tenants/${tenant.id}/appointments`)
    .where('status', '==', 'cancelled')
    .where('cancellationAudit.actorType', '==', 'no_show')
    .where('cancelledAt', '>=', since)
    .get();

  // Group by clientId
  const countsByClient = new Map<string, number>();
  noShowSnap.docs.forEach(d => {
    const clientId = d.data().clientId;
    if (clientId) countsByClient.set(clientId, (countsByClient.get(clientId) || 0) + 1);
  });

  await Promise.allSettled(
    Array.from(countsByClient.entries()).map(async ([clientId, count]) => {
      if (count < threshold) return;

      const clientRef = db.doc(`tenants/${tenant.id}/clients/${clientId}`);
      const snap = await clientRef.get();
      if (!snap.exists) return;

      const client = snap.data()!;
      // Only update if not already flagged
      if (client.repeatNoShowFlagged) return;

      await clientRef.update({
        repeatNoShowFlagged: true,
        repeatNoShowCount: count,
        repeatNoShowFlaggedAt: new Date().toISOString(),
        // Enforce stricter requirements going forward
        requiresDepositOnBooking: true,
        requiresCardOnFile: true,
      });

      // Notify admins
      const adminsSnap = await db
        .collection(`tenants/${tenant.id}/staff`)
        .where('role', 'in', ['admin', 'owner'])
        .get();

      const batch = db.batch();
      adminsSnap.docs.forEach(d => {
        const notifRef = db.collection(`tenants/${tenant.id}/notifications`).doc();
        batch.set(notifRef, {
          id: notifRef.id,
          userId: d.id,
          type: 'repeat_no_show',
          message: `${client.name || 'A client'} has ${count} no-shows in 90 days — deposit + card now required`,
          link: `/clients/${clientId}`,
          createdAt: new Date().toISOString(),
          read: false,
        });
      });
      await batch.commit();

      console.log(`Repeat no-show flag: tenant=${tenant.id} client=${clientId} count=${count}`);
    }),
  );
}
