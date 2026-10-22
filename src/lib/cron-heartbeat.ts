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
  { name: 'retail-nightly', label: 'Nightly shop checks: stock, returns, gift cards, parcels', everyHours: 24 },
  { name: 'autopay-leases', label: 'Rent autopay', everyHours: 24 },
  { name: 'campaigns', label: 'Scheduled campaigns & automations', everyHours: 24 },
  { name: 'hq', label: 'HQ onboarding nudges', everyHours: 24 },
  { name: 'collect-fees', label: 'Fee collection', everyHours: 24 },
  { name: 'push', label: 'Phone notifications', everyHours: 0.1 },
  // The every-5-minutes job: waitlist offers, unpaid-deposit releases, no-show checks, Tidy my day deadlines.
  { name: 'no-shows', label: 'Every 5 minutes: waitlist, deposits, no-shows, tidy', everyHours: 5 / 60 },
];

export async function recordCronRun(name: string, extra: Record<string, any> = {}) {
  try {
    await getAdminDb().doc(`platformHealth/cron_${name}`).set({ name, lastRunAt: new Date().toISOString(), version: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || null, ...extra }, { merge: true });
  } catch { /* never let the heartbeat break the job */ }
}

/** THE WATCHDOG (run every minute from the push job): if a frequent job hasn't run for 4× its interval (at least 20
 * minutes), the platform admins get an email — once an hour while it stays late, and once more when it recovers.
 * Today a stuck deploy meant nothing ran and nothing said so; this says so. */
export async function watchCrons(now = Date.now(), send?: (to: string, subject: string, text: string) => Promise<void>) {
  const db = getAdminDb(); const late: string[] = []; const back: string[] = [];
  for (const j of SCHEDULED_JOBS.filter((x) => x.everyHours < 1 && x.name !== 'push')) {
    const ref = db.doc(`platformHealth/cron_${j.name}`); const d: any = (await ref.get()).data() || {};
    const last = Date.parse(d.lastRunAt || ''); if (!Number.isFinite(last)) continue;
    const limit = Math.max(20 * 60000, j.everyHours * 4 * 3600e3); const isLate = now - last > limit;
    if (isLate && (!d.alertedAt || now - Date.parse(d.alertedAt) > 3600e3)) { late.push(`${j.label}: last ran ${Math.round((now - last) / 60000)} minutes ago`); await ref.set({ alertedAt: new Date(now).toISOString(), late: true }, { merge: true }); }
    if (!isLate && d.late) { back.push(j.label); await ref.set({ late: false, alertedAt: null }, { merge: true }); }
  }
  if (!late.length && !back.length) return { late, back };
  const { platformAdminEmails } = await import('@/lib/platform-admin'); const to = process.env.LEADS_NOTIFY_EMAIL || platformAdminEmails()[0] || '';
  const mail = send || (async (t: string, subject: string, text: string) => { if (!process.env.RESEND_API_KEY || !t) return; const { resolveFromAddress } = await import('@/lib/notify');
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: resolveFromAddress(), to: t, subject, text }) }).catch(() => {}); });
  if (late.length) await mail(to, 'Action needed: ClarityFlow background job has stopped', `The following scheduled jobs are running late:\n\n${late.join('\n')}\n\nWhile they are stopped, waitlist offers, unpaid deposit checks, missed appointment checks and Tidy my day deadlines will not run. Please check the latest deployment in Vercel, then review HQ → System.`);
  if (back.length) await mail(to, 'ClarityFlow: background jobs are running again', `The following scheduled jobs have resumed and are running normally:\n\n${back.join('\n')}`);
  return { late, back };
}
