/**
 * firebase-admin — shared server-side Firestore for API routes.
 *
 * Replicates the EXACT working pattern from the existing Stripe routes'
 * inline getAdmin() helpers: a NAMED app ('admin') initialized from the
 * FIREBASE_ADMIN_* env vars already configured in Vercel. Because the app
 * is looked up by name before initializing, this file and the inline
 * getAdmin() helpers in charge-card / connect-webhook coexist safely —
 * whichever runs first creates the app, everyone else reuses it.
 *
 * No new env vars required: FIREBASE_ADMIN_PROJECT_ID,
 * FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY (with \n escapes),
 * and FIREBASE_STORAGE_BUCKET are the same ones the webhook routes use.
 *
 * (Longer term, the inline getAdmin() blocks in the Stripe routes could be
 * replaced with imports from here — optional cleanup, zero urgency.)
 */

import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const APP_NAME = 'admin'; // must match the named app in the Stripe routes

let cachedDb: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;

  let app: App | undefined = getApps().find((a) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp(
      {
        credential: cert({
          projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
          clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      },
      APP_NAME,
    );
  }

  cachedDb = getFirestore(app);
  return cachedDb;
}
