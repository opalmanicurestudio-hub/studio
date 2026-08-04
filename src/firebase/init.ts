'use client';
import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/*
 * Initialization must never THROW. During `next build`, every page is
 * pre-rendered on a machine that may not carry the NEXT_PUBLIC_FIREBASE_*
 * values (preview deployments, CI). A throw there kills the whole build
 * ("Export encountered an error on /_not-found"). So: attempt App Hosting
 * auto-init, fall back to the config object, and if neither yields a usable
 * app, return nulls — the provider already understands "services
 * unavailable" and the real browser session initializes normally.
 */

export type FirebaseSdks = {
  firebaseApp: FirebaseApp | null;
  auth: ReturnType<typeof getAuth> | null;
  firestore: ReturnType<typeof getFirestore> | null;
};

const EMPTY: FirebaseSdks = { firebaseApp: null, auth: null, firestore: null };

export function initializeFirebase(): FirebaseSdks {
  try {
    if (getApps().length) return getSdks(getApp());

    let firebaseApp: FirebaseApp | undefined;
    try {
      // Firebase App Hosting injects options here; this is the preferred path.
      firebaseApp = initializeApp();
    } catch (e) {
      if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      if (!firebaseConfig?.apiKey) return EMPTY;
      firebaseApp = initializeApp(firebaseConfig);
    }

    return firebaseApp ? getSdks(firebaseApp) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function getSdks(firebaseApp: FirebaseApp): FirebaseSdks {
  try {
    return {
      firebaseApp,
      auth: getAuth(firebaseApp),
      firestore: getFirestore(firebaseApp),
    };
  } catch {
    return { firebaseApp, auth: null, firestore: null };
  }
}
