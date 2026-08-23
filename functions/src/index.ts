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

if (!admin.apps.length) {
  admin.initializeApp();
}

export { onCancellationEvent } from './onCancellationEvent';
export { autoCancel } from './autoCancel';
/* boothAutomation is NOT a Cloud Function. functions/src/boothAutomation.ts
 * is a stray copy of the React component that really lives at
 * src/components/shared/BoothAutomationSettings.tsx — it opens with
 * 'use client' and is full of JSX, so exporting it here breaks the whole
 * functions build (and therefore every deploy of every other function in
 * this file). Removed from the export list; delete the stray file. */
export { conciergeMessenger, tourMessenger } from './conciergeMessenger';
export { rentCollector } from './rentCollector';
export { plaidSync } from './plaidSync';

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
export { onNotificationCreate } from './onNotificationCreate';
export { appointmentReadinessCheck } from './appointmentReadinessCheck';
export { onApplicantMessageCreate } from './onApplicantMessageCreate';
export { onApplicationCreate } from './onApplicationCreate';
export { onInterviewInviteUpdate } from './onInterviewInviteUpdate';
export { onDocumentPublish } from './onDocumentPublish';
