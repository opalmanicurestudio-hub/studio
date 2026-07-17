/**
 * plaidSync.ts — daily bank-feed sync (functions/src/plaidSync.ts)
 * 6 AM ET: for every tenant with connected bank accounts, calls the
 * app's /api/plaid sync action so reconciliation happens without anyone
 * tapping Sync. Requires the APP_URL secret (same one the messengers use).
 * index.ts: export { plaidSync } from './plaidSync';
 * Deploy: firebase deploy --only functions:plaidSync
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();

export const plaidSync = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'America/New_York', region: 'us-central1' },
  async () => {
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    if (!appUrl) { console.warn('[plaidSync] APP_URL not set — skipping'); return; }
    const db = getFirestore();
    const tenantsSnap = await db.collection('tenants').get();
    for (const t of tenantsSnap.docs) {
      try {
        const items = await db.collection(`tenants/${t.id}/plaidItems`).limit(1).get();
        const legacy = await db.doc(`tenants/${t.id}/private/plaid`).get();
        if (items.empty && !legacy.exists) continue;
        const res = await fetch(`${appUrl}/api/plaid`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync', tenantId: t.id }),
        });
        const d = await res.json().catch(() => ({}));
        console.log(`[plaidSync] ${t.id}`, JSON.stringify(d).slice(0, 200));
      } catch (err) { console.warn(`[plaidSync] ${t.id} failed`, err); }
    }
  }
);
