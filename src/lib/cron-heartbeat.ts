// src/lib/cron-heartbeat.ts
//
// "DID THE DAILY JOBS RUN?" — each scheduled job records that it started.
// HQ → System shows the last run of each and flags any that are late.
// (A job that never starts — blocked deploy, wrong plan, missing secret —
// is exactly what nobody notices until clients complain.)

import { getAdminDb } from '@/lib/firebase-admin';

export const SCHEDULED_JOBS: { name: string; label: string; everyHours: number }[] = [
  { name: 'reminders', label: 'Reminders & reconnect', everyHours: 24 },
  { name: 'nightly', label: 'Nightly books, rent & bills', everyHours: 24 },
  { name: 'autopay-leases', label: 'Rent autopay', everyHours: 24 },
  { name: 'campaigns', label: 'Scheduled campaigns & automations', everyHours: 24 },
  { name: 'hq', label: 'HQ onboarding nudges', everyHours: 24 },
];

export async function recordCronRun(name: string, extra: Record<string, any> = {}) {
  try {
    await getAdminDb().doc(`platformHealth/cron_${name}`).set({ name, lastRunAt: new Date().toISOString(), version: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || null, ...extra }, { merge: true });
  } catch { /* never let the heartbeat break the job */ }
}
