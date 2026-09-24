// src/app/api/cron/campaigns/route.ts
//
// HOURLY: send campaigns whose scheduled time has come.
//
// For each tenant, every campaign with status 'scheduled' and scheduledFor
// in the past is sent through the same engine as the Send button. A text
// campaign that comes due outside quiet hours waits for the window. A large
// list is sent in batches for up to ~50s; anything left is picked up next
// hour — the recipient record makes that resume-safe.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendCampaignBatch } from '@/lib/campaign-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const db = getAdminDb();
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const results: any[] = [];
  const tenants = await db.collection('tenants').get();
  for (const t of tenants.docs) {
    let due: any[] = [];
    try {
      due = (await db.collection(`tenants/${t.id}/campaigns`).where('status', 'in', ['scheduled', 'sending']).get()).docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((c: any) => c.status === 'sending' || String(c.scheduledFor || '') <= nowIso);
    } catch { continue; }
    for (const c of due) {
      let last: any = null;
      while (Date.now() - started < 50000) {
        last = await sendCampaignBatch(db, t.id, c.id, { actorName: 'Scheduler' });
        if (!last.ok || last.done) break;
      }
      results.push({ tenantId: t.id, campaignId: c.id, ok: last?.ok, done: last?.done ?? false, note: last?.error || null });
      if (Date.now() - started >= 50000) break;
    }
    if (Date.now() - started >= 50000) break;
  }
  return NextResponse.json({ ok: true, results });
}
