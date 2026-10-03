/**
 * functions/src/index.ts
 *
 * Export all Firebase Functions.
 * Set your secrets before deploying:
 *
 *   firebase functions:secrets:set STRIPE_SECRET_KEY
 *   firebase functions:secrets:set TWILIO_ACCOUNT_SID
 *   firebase functions:secrets:set TWILIO_AUTH_TOKEN
 *   firebase functions:secrets:set TWILIO_PHONE_NUMBER
 *   firebase functions:secrets:set RESEND_API_KEY
 */

import * as admin from 'firebase-admin';

/* SCHEDULED WORK DOESN'T LIVE HERE. Everything that runs on a timer is a Vercel Cron job (vercel.json → /api/cron/*),
 * so it deploys with the app and shows on the Automations page if it stops. The old scheduled functions that used to
 * sit in this folder were never deployed and each had a replacement:
 *   autoCancel, autoFlagSuspectedNoShows → /api/cron/no-shows (asks the provider; never cancels on its own)
 *   appointmentReadinessCheck            → /api/cron/check-automations (deposit & form reminders)
 *   rentCollector                        → /api/cron/autopay-leases (renter autopay OR lease auto-collect)
 *   plaidSync                            → /api/cron/nightly (bank feed)
 *   cleanupEvidence                      → /api/cron/cleanup-evidence
 *   onCancellationEvent                  → lib/cancellation-events (run by the cancel / no-show routes; swept every 5 min)
 *   onNotificationCreate                 → lib/push (phones buzz; sent by the 5-minute no-shows job)
 * Change-driven jobs already moved into the app (screens call /api/comms/dispatch after saving):
 *   onApplicationCreate, onApplicantMessageCreate, onInterviewInviteUpdate, onDocumentPublish → /api/comms/dispatch
 * What remains below is still to be moved into the app: booth-guest and tour texts. */

if (!admin.apps.length) {
  admin.initializeApp();
}

/* boothAutomation is NOT a Cloud Function. functions/src/boothAutomation.ts
 * is a stray copy of the React component that really lives at
 * src/components/shared/BoothAutomationSettings.tsx — it opens with
 * 'use client' and is full of JSX, so exporting it here breaks the whole
 * functions build (and therefore every deploy of every other function in
 * this file). Removed from the export list; delete the stray file. */
export { conciergeMessenger, tourMessenger } from './conciergeMessenger';

/* ── Previously written but never exported ────────────────────────────────
 * Both of these existed in the codebase for some time without being
 * deployed, which meant two features looked missing when they were merely
 * unwired:
 *
 *   onNotificationCreate       every write to tenants/{t}/notifications
 *                              becomes a real push, with dead-token cleanup.
 *                              Nothing else in the platform sends push.
 *   appointmentReadinessCheck  the hourly engine behind Settings →
 *                              Automations. Without it, every rule on that
 *                              screen was configuration with nothing reading
 *                              it.
 *
 * onAppointmentCreate stays unexported deliberately: the booking route
 * already sends its own confirmation, so enabling it would double-send. */
