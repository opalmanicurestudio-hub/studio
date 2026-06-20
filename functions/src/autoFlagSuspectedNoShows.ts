/**
 * functions/src/autoFlagSuspectedNoShows.ts
 *
 * Runs every 5 minutes. NEVER cancels an appointment automatically.
 *
 * What it does instead:
 *   1. Finds appointments that LOOK like no-shows (past start, not started)
 *   2. Checks multiple signals to reduce false positives (forgot Start button)
 *   3. Creates a `suspectedNoShow` flag on the appointment
 *   4. Notifies the assigned staff member IN-APP with a one-tap confirm/dismiss
 *   5. If staff doesn't respond within `noShowConfirmWindowMinutes`, escalates
 *      to manager — still does NOT auto-cancel
 *
 * The actual cancellation only happens when:
 *   - Staff taps "Confirm No-Show" in their notification
 *   - Manager taps "Confirm No-Show" after escalation
 *   - Studio manually cancels via CancelAppointmentDialog with actor=no_show
 *
 * This makes the system zero-false-positive by design.
 * Staff forgetting to tap "Start Service" can never trigger a cancellation.
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ── How we decide something LOOKS like a no-show ──────────────────────────────
// ALL conditions must be true before we even flag it.
interface NoShowSignals {
  pastStartWindowMinutes: boolean; // startTime > N minutes ago
  noActualStart: boolean;          // actualStartTime is null
  noCheckIn: boolean;              // no kiosk check-in record
  noRecentActivity: boolean;       // appointment hasn't been touched recently
  notAlreadyFlagged: boolean;      // prevent duplicate flags
  notCancelled: boolean;           // not already cancelled
  notCompleted: boolean;           // not already completed
}

function allSignalsPresent(signals: NoShowSignals): boolean {
  return Object.values(signals).every(Boolean);
}

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

export const autoFlagSuspectedNoShows = functions.scheduler.onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();

    await Promise.allSettled(
      tenantsSnap.docs.map(async tenantDoc => {
        const tenant = tenantDoc.data();
        const tenantId = tenantDoc.id;

        // Per-tenant kill-switch
        if (tenant.autoCancelEnabled === false) return;

        const windowMinutes = tenant.noShowWindowMinutes ?? 15;
        const confirmWindowMinutes = tenant.noShowConfirmWindowMinutes ?? 10;

        const now = new Date();
        const cutoff = new Date(now.getTime() - windowMinutes * 60 * 1000);

        // Find appointments past their start window, still confirmed
        const apptSnap = await db
          .collection(`tenants/${tenantId}/appointments`)
          .where('status', '==', 'confirmed')
          .where('startTime', '<=', cutoff.toISOString())
          .get();

        if (apptSnap.empty) return;

        await Promise.allSettled(
          apptSnap.docs.map(async apptDoc => {
            const appt = { id: apptDoc.id, ...apptDoc.data() } as any;
            const nowISO = now.toISOString();

            // ── Signal check — all must pass ─────────────────────────────────
            const signals: NoShowSignals = {
              pastStartWindowMinutes: true, // already filtered by query
              noActualStart:          !appt.actualStartTime,
              noCheckIn:              !appt.checkedInAt,
              noRecentActivity:       !appt.lastTouchedAt || 
                                      (now.getTime() - safeDate(appt.lastTouchedAt).getTime()) > windowMinutes * 60 * 1000,
              notAlreadyFlagged:      !appt.suspectedNoShow,
              notCancelled:           appt.status !== 'cancelled',
              notCompleted:           appt.status !== 'completed',
            };

            if (!allSignalsPresent(signals)) return;

            // ── Flag the appointment ──────────────────────────────────────────
            const escalateAt = new Date(
              now.getTime() + confirmWindowMinutes * 60 * 1000,
            ).toISOString();

            const batch = db.batch();

            batch.update(apptDoc.ref, {
              suspectedNoShow:        true,
              suspectedNoShowAt:      nowISO,
              suspectedNoShowSignals: signals,
              noShowConfirmDeadline:  escalateAt,
              noShowConfirmedBy:      null,
            });

            // ── Notify assigned staff ─────────────────────────────────────────
            // The notification has two action buttons: "Confirm No-Show" and
            // "Client Is Here (dismiss)" — handled in the notification UI.
            const staffNotifRef = db
              .collection(`tenants/${tenantId}/notifications`)
              .doc();

            batch.set(staffNotifRef, {
              id:            staffNotifRef.id,
              userId:        appt.staffId,
              type:          'suspected_no_show',
              priority:      'high',
              message:       `${appt.clientName || 'Guest'} may be a no-show — appointment started ${windowMinutes}m ago with no check-in`,
              appointmentId: appt.id,
              clientId:      appt.clientId,
              link:          `/pos?checkout_id=${appt.id}`,
              actions: [
                {
                  label:  'Confirm No-Show',
                  action: 'confirm_no_show',
                  style:  'destructive',
                },
                {
                  label:  'Client Is Here',
                  action: 'dismiss_no_show',
                  style:  'primary',
                },
              ],
              expiresAt:   escalateAt,
              createdAt:   nowISO,
              read:        false,
              resolved:    false,
            });

            await batch.commit();

            // ── Schedule escalation check ─────────────────────────────────────
            // The escalation function runs on the same 5-min schedule and
            // checks noShowConfirmDeadline to decide if it needs to escalate.
            console.log(
              `Suspected no-show flagged: tenant=${tenantId} appt=${appt.id} ` +
              `staff=${appt.staffId} escalates=${escalateAt}`,
            );
          }),
        );
      }),
    );
  },
);

// ── Escalation: runs on same schedule, checks deadlines ──────────────────────
// If staff didn't respond within the confirm window, escalate to manager.
// Still does NOT cancel. Manager must also confirm manually.
export const escalateUnconfirmedNoShows = functions.scheduler.onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();

    await Promise.allSettled(
      tenantsSnap.docs.map(async tenantDoc => {
        const tenantId = tenantDoc.id;
        const now = new Date().toISOString();

        // Find flagged appointments whose confirm deadline has passed
        // and haven't been escalated yet
        const apptSnap = await db
          .collection(`tenants/${tenantId}/appointments`)
          .where('suspectedNoShow', '==', true)
          .where('noShowConfirmDeadline', '<=', now)
          .where('noShowEscalated', '==', false)
          .get();

        if (apptSnap.empty) return;

        const adminsSnap = await db
          .collection(`tenants/${tenantId}/staff`)
          .where('role', 'in', ['admin', 'owner'])
          .get();

        await Promise.allSettled(
          apptSnap.docs.map(async apptDoc => {
            const appt = { id: apptDoc.id, ...apptDoc.data() } as any;

            // Skip if staff already resolved it
            if (appt.noShowConfirmedBy || appt.status !== 'confirmed') {
              await apptDoc.ref.update({ noShowEscalated: true });
              return;
            }

            const batch = db.batch();

            batch.update(apptDoc.ref, { noShowEscalated: true, noShowEscalatedAt: now });

            // Notify all admins/owners — same confirm/dismiss actions
            adminsSnap.docs.forEach(adminDoc => {
              const notifRef = db
                .collection(`tenants/${tenantId}/notifications`)
                .doc();
              batch.set(notifRef, {
                id:            notifRef.id,
                userId:        adminDoc.id,
                type:          'no_show_escalation',
                priority:      'urgent',
                message:       `ESCALATED: ${appt.clientName || 'Guest'} unconfirmed no-show — staff did not respond`,
                appointmentId: appt.id,
                clientId:      appt.clientId,
                link:          `/pos?checkout_id=${appt.id}`,
                actions: [
                  {
                    label:  'Confirm No-Show',
                    action: 'confirm_no_show',
                    style:  'destructive',
                  },
                  {
                    label:  'Client Is Here',
                    action: 'dismiss_no_show',
                    style:  'primary',
                  },
                ],
                createdAt: now,
                read:      false,
                resolved:  false,
              });
            });

            await batch.commit();
            console.log(`No-show escalated to managers: tenant=${tenantId} appt=${appt.id}`);
          }),
        );
      }),
    );
  },
);
