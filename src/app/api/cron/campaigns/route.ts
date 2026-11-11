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
import { refuseCron } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendCampaignBatch, runAutomation } from '@/lib/campaign-engine';
import { localHour } from '@/lib/campaigns';
import { moduleEnabled } from '@/lib/modules';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Only the scheduler, holding the secret. No secret set: nobody.
  const refused = refuseCron(req); if (refused) return refused;
  void recordCronRun('campaigns');   // HQ → System: "did it run?"
  const db = getAdminDb();
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const results: any[] = [];
  const tenants = await db.collection('tenants').get();
  const { pausedNow } = await import('@/lib/outreach-pause');
  for (const t of tenants.docs) {
    // The evening text report (lib/text-report): from 7pm, once a day, only when something didn't go through or someone opted out.
    try { const { textReportSweep } = await import('@/lib/text-report'); await textReportSweep(db, t.id, t.data()); } catch (e) { console.error('[campaigns] text report', t.id, e); }
    // "Hold automatic offers today" (lib/outreach-pause): nothing goes out on its own until it ends.
    if (pausedNow(t.data())) { results.push({ tenantId: t.id, held: true }); continue; }
    // Loyalty messages (lib/loyalty-server): once a day from 10am, only what the business switched on.
    if ((t.data() as any)?.loyalty?.on === true) { try { const { automationSweep } = await import('@/lib/loyalty-server'); await automationSweep(db, t.id, t.data()); } catch (e) { console.error('[campaigns] loyalty', t.id, e); } }
    // The business's own campaigns and automations are Marketing & reputation: while it isn't part of the plan, none of
    // them goes out (and nothing is lost: they're all still there when it's turned back on) (lib/tool-lock). Renters'
    // own campaigns follow their own offer (lib/renter-offers), below.
    const marketingOn = moduleEnabled(t.data(), 'marketing');
    if (!marketingOn) results.push({ tenantId: t.id, marketingOff: true });
    // Automations: once a day, at 10am in the business's own time zone.
    try {
      const tz = String((t.data() as any)?.timezone || 'America/New_York');
      if (localHour(tz) >= 10) {
        const autos = (await db.collection(`tenants/${t.id}/campaigns`).where('status', '==', 'automation').get()).docs;
        for (const a of autos) {
          if (Date.now() - started >= 50000) break;
          if (!marketingOn && !(a.data() as any)?.ownerRenterId) continue;
          const r = await runAutomation(db, t.id, a.id);
          results.push({ tenantId: t.id, campaignId: a.id, automation: true, ...r });
        }
      }
    } catch (e: any) { results.push({ tenantId: t.id, automationError: String(e?.message || e).slice(0, 120) }); }
    let due: any[] = [];
    try {
      due = (await db.collection(`tenants/${t.id}/campaigns`).where('status', 'in', ['scheduled', 'sending']).get()).docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((c: any) => c.status === 'sending' || String(c.scheduledFor || '') <= nowIso)
        .filter((c: any) => marketingOn || !!c.ownerRenterId);
    } catch { continue; }
    const { resolveOffers, offerAllows } = await import('@/lib/renter-offers');
    const offersHere = resolveOffers(t.data());
    for (const c of due) {
      // A renter's campaign goes only while campaigns are theirs here (off, or an add-on that lapsed: lib/renter-offers).
      // It waits, scheduled, and goes if they're theirs again.
      if (c.ownerRenterId) {
        const r = (await db.doc(`tenants/${t.id}/renters/${String(c.ownerRenterId)}`).get().catch(() => null))?.data?.() || null;
        if (!offerAllows(offersHere, 'campaigns', r)) {
          if (!c.heldWhy) await db.doc(`tenants/${t.id}/campaigns/${c.id}`).set({ heldWhy: 'Win-back campaigns aren’t on for you right now, so this is waiting.', heldAt: nowIso }, { merge: true }).catch(() => {});
          results.push({ tenantId: t.id, campaignId: c.id, held: 'campaigns not on for this renter' });
          continue;
        }
        if (c.heldWhy) await db.doc(`tenants/${t.id}/campaigns/${c.id}`).set({ heldWhy: null, heldAt: null }, { merge: true }).catch(() => {});
      }
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
