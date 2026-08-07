'use client';
import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';

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

/*
 * OFFLINE FIRST.
 *
 * A stockroom is the worst signal in the building, which is exactly where
 * picking happens. With a persistent local cache, Firestore serves reads from
 * disk and queues writes until the connection returns — so scanning, claiming,
 * shorting and packing keep working through a dead zone and sync themselves
 * afterwards. What still needs a network is anything that talks to somebody
 * else: buying a label, sending an email, taking a payment.
 *
 * persistentMultipleTabManager matters because a bench tablet often has the
 * board open in one tab and the pack bench in another; without it the second
 * tab silently loses persistence.
 *
 * initializeFirestore must run BEFORE any getFirestore call on the same app,
 * and only in a browser — on the server there is no IndexedDB, so we fall
 * straight through to the plain instance.
 */
function firestoreFor(firebaseApp: FirebaseApp) {
  if (typeof window === 'undefined') return getFirestore(firebaseApp);
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialized elsewhere, or the browser blocks storage (private
    // mode, disabled cookies) — the online-only instance still works.
    return getFirestore(firebaseApp);
  }
}

export function getSdks(firebaseApp: FirebaseApp): FirebaseSdks {
  try {
    return {
      firebaseApp,
      auth: getAuth(firebaseApp),
      firestore: firestoreFor(firebaseApp),
    };
  } catch {
    return { firebaseApp, auth: null, firestore: null };
  }
}
