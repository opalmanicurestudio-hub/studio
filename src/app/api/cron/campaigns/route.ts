// src/app/api/cron/campaigns/route.ts
//
// Sends campaigns whose scheduled time has come, and runs automations.
// On Vercel Hobby this is triggered ONCE A DAY (vercel.json, 14:00 UTC ≈
// 10am Eastern) — Hobby rejects any cron that runs more often, and a
// rejected cron blocks the whole deployment. It is safe to also trigger it
// hourly from an external scheduler (or after upgrading to Pro): scheduled
// sends are resume-safe and automations run at most once per local day.
//
// For each tenant, every campaign with status 'scheduled' and scheduledFor
// in the past is sent through the same engine as the Send button. A text
// campaign that comes due outside quiet hours waits for the window. A large
// list is sent in batches for up to ~50s; anything left is picked up next
// hour — the recipient record makes that resume-safe.

import { recordCronRun } from '@/lib/cron-heartbeat';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendCampaignBatch, runAutomation } from '@/lib/campaign-engine';
import { localHour } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  void recordCronRun('campaigns');   // HQ → System: "did it run?"
  const db = getAdminDb();
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const results: any[] = [];
  const tenants = await db.collection('tenants').get();
  for (const t of tenants.docs) {
    // Automations: once a day, at 10am in the business's own time zone.
    try {
      const tz = String((t.data() as any)?.timezone || 'America/New_York');
      if (localHour(tz) >= 10) {
        const autos = (await db.collection(`tenants/${t.id}/campaigns`).where('status', '==', 'automation').get()).docs;
        for (const a of autos) {
          if (Date.now() - started >= 50000) break;
          const r = await runAutomation(db, t.id, a.id);
          results.push({ tenantId: t.id, campaignId: a.id, automation: true, ...r });
        }
      }
    } catch (e: any) { results.push({ tenantId: t.id, automationError: String(e?.message || e).slice(0, 120) }); }
    let due: any[] = [];
    try {
      due = (await db.collection(`tenants/${t.id}/campaigns`).where('status', 'in', ['scheduled', 'sending']).get()).docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((c: any) => c.status === 'sending' || String(c.scheduledFor || '') <= nowIso);
    } catch { continue; }
    for (const c of due) {
      let last: any = null;
      while (Date.now() - started < 50000) {
        // A renter's scheduled campaign stays within what was paid for / allowed
        // when it was scheduled (reserved in segmentsBudget).
        last = await sendCampaignBatch(db, t.id, c.id, { actorName: 'Scheduler', ...(c.ownerRenterId && Number.isFinite(Number(c.segmentsBudget)) ? { maxSegments: Math.max(0, Number(c.segmentsBudget) - (Number(c.segmentsUsed) || 0)) } : {}) });
        if (!last.ok || last.done) break;
      }
      results.push({ tenantId: t.id, campaignId: c.id, ok: last?.ok, done: last?.done ?? false, note: last?.error || null });
      if (Date.now() - started >= 50000) break;
    }
    if (Date.now() - started >= 50000) break;
  }
  return NextResponse.json({ ok: true, results });
}
