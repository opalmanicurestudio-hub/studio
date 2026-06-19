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
