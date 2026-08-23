/**
 * functions/src/cleanupEvidence.ts
 *
 * Nightly retention sweep for checklist/task evidence photos.
 *
 * Evidence accumulates daily (photos × staff × checklists), and none of it
 * needs to live forever: the audit value of a station photo decays to zero
 * long before the storage bill notices it. This deletes evidence objects
 * older than RETENTION_DAYS across every tenant.
 *
 * Deliberate scope:
 * - Deletes ONLY under tenants/{tid}/evidence/** — signatures and every
 *   other folder are untouched.
 * - Run documents in Firestore are kept: the numbers (who, when, 12/12)
 *   remain auditable forever; only the expired photo behind an old run
 *   goes away. The audit UI simply shows no thumbnail for entries past
 *   retention.
 * - Batched with a per-run cap so a huge backlog can't blow the function
 *   timeout; the nightly cadence drains any remainder within days.
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const RETENTION_DAYS = 90;
const MAX_DELETES_PER_RUN = 2000;

export const cleanupEvidence = functions.scheduler.onSchedule(
  { schedule: 'every 24 hours', timeoutSeconds: 540, memory: '256MiB' },
  async () => {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const bucket = admin.storage().bucket();

    let deleted = 0;
    let scanned = 0;
    let pageToken: string | undefined = undefined;

    do {
      const [files, next] = await bucket.getFiles({
        prefix: 'tenants/',
        maxResults: 1000,
        pageToken,
        autoPaginate: false,
      } as any).then(([f, q]: any) => [f, q?.pageToken]);

      for (const file of files) {
        scanned++;
        if (!file.name.includes('/evidence/')) continue;
        const created = Date.parse(file.metadata?.timeCreated || '');
        if (!created || created >= cutoff) continue;
        try {
          await file.delete();
          deleted++;
        } catch (e) {
          console.error(`evidence delete failed: ${file.name}`, e);
        }
        if (deleted >= MAX_DELETES_PER_RUN) break;
      }

      pageToken = next;
    } while (pageToken && deleted < MAX_DELETES_PER_RUN);

    console.log(`cleanupEvidence: scanned ${scanned}, deleted ${deleted} (older than ${RETENTION_DAYS}d)`);
  },
);
