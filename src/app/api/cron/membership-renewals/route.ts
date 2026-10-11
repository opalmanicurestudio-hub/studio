// /api/cron/membership-renewals — daily. Charges every business's membership renewals that are due
// (lib/memberships/renewals) and sends add-your-card reminders 3 days and 1 day before a charge to members who still
// need to add one (lib/card-save). Before this ran, nothing called the renewal job, so memberships billed once and stopped.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { runRenewals } from '@/lib/memberships/renewals';
import { cardReminderSweep } from '@/lib/card-save';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  void recordCronRun('membership-renewals');
  const db = getAdminDb(); let charged = 0, waiting = 0, lapsed = 0, reminders = 0, tenants = 0;
  for (const d of (await db.collection('tenants').get()).docs) {
    try {
      const anyMember = await db.collection(`tenants/${d.id}/clients`).where('subscription.status', 'in', ['active', 'past_due']).limit(1).get(); if (anyMember.empty) continue;
      tenants++; const r = await runRenewals(db, d.id, { appUrl: req.nextUrl.origin }); charged += r.charged; waiting += r.waiting; lapsed += r.lapsed;
      reminders += await cardReminderSweep(db, d.id);
    } catch (e) { console.error('[cron membership-renewals]', d.id, e); }
  }
  return NextResponse.json({ ok: true, tenants, charged, waiting, lapsed, reminders });
}
