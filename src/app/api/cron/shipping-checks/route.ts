// src/app/api/cron/shipping-checks/route.ts — EVERY MORNING (Vercel Cron + CRON_SECRET): each shop's shipping labels
// from the last 90 days are checked (lib/label-sweep). Labels on cancelled orders, and labels the carrier never scanned
// in 28 days, are voided so the postage comes back; labels not scanned for a few days go under Needs you.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { heartbeat } from '@/lib/account-health';
import { getRetailSecrets } from '@/lib/retail-secrets';
import { sweepLabels } from '@/lib/label-sweep';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb();
  const started = Date.now();
  const counts = { voided: 0, flagged: 0, checked: 0 };
  const run = await forEachTenant(db, 'shipping-checks', async (t) => {
    const rs = t.data?.retailSettings || {};
    if (!rs.shippoConnected && !process.env.SHIPPO_API_KEY) return;
    const s = await getRetailSecrets(db, t.id, t.data).catch(() => null);
    const apiKey = String(s?.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
    if (!apiKey) return;
    try {
      // Every shop shares one deadline, well inside the 60-second limit: a shop stops starting work 25 seconds in, and
      // no shop is started after 15, so each one gets time to work. A shop cut off is the first one next morning.
      const r = await sweepLabels(db, t.id, apiKey, { deadline: started + 45000 });
      counts.voided += r.voided; counts.flagged += r.flagged; counts.checked += r.checked;
      if (r.cutOff) return { again: true };
    } catch (e: any) { console.error('[cron/shipping-checks]', t.id, String(e?.message || e).slice(0, 200)); }
  }, { concurrency: 3, startedAt: started, budgetMs: 15000 });
  await heartbeat(db, 'shipping-checks');
  return NextResponse.json({ ok: true, ...counts, businesses: run.done, of: run.total, resumesAt: run.ranOut ? run.nextStart : null });
}
