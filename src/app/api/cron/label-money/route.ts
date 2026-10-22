// src/app/api/cron/label-money/route.ts — EVERY MORNING (Vercel Cron + CRON_SECRET): the money side of each shop's
// shipping labels (lib/label-records). Refunds asked for when labels were voided are checked with Shippo: confirmed
// ones go into the books, turned-down ones go under Needs you, and ones Shippo never registered are asked for again.
// Then Shippo's recent invoices are read for carrier adjustments to labels bought here. First, any purchase that was
// cut off or got no answer from Shippo is settled: a label made on it and never saved is voided (lib/label-void
// settleDoubts), so it doesn't wait for someone to buy that order another label.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { forEachTenant } from '@/lib/cron-fanout';
import { heartbeat } from '@/lib/account-health';
import { getRetailSecrets } from '@/lib/retail-secrets';
import { followRefunds, importCarrierCharges } from '@/lib/label-records';
import { settleDoubts } from '@/lib/label-void';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb();
  const started = Date.now();
  const deadline = started + 45000;
  const counts = { checked: 0, refunded: 0, denied: 0, asked: 0, charges: 0, settled: 0 };
  const run = await forEachTenant(db, 'label-money', async (t) => {
    const rs = t.data?.retailSettings || {};
    if (!rs.shippoConnected && !process.env.SHIPPO_API_KEY) return;
    const s = await getRetailSecrets(db, t.id, t.data).catch(() => null);
    const apiKey = String(s?.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim();
    if (!apiKey) return;
    let again = false;
    try { counts.settled += await settleDoubts(db, t.id, apiKey, deadline); }
    catch (e: any) { console.error('[cron/label-money] doubts', t.id, String(e?.message || e).slice(0, 200)); }
    try {
      const r = await followRefunds(db, t.id, apiKey, { deadline });
      counts.checked += r.checked; counts.refunded += r.refunded; counts.denied += r.denied; counts.asked += r.asked;
      again = r.cutOff;
    } catch (e: any) { console.error('[cron/label-money] refunds', t.id, String(e?.message || e).slice(0, 200)); }
    try {
      if (Date.now() < deadline - 15000) {
        const c = await importCarrierCharges(db, t.id, apiKey, { deadline });
        counts.charges += c.charges; again = again || c.cutOff;
      } else again = true;
    } catch (e: any) { console.error('[cron/label-money] charges', t.id, String(e?.message || e).slice(0, 200)); }
    if (again) return { again: true };
  }, { concurrency: 3, startedAt: started, budgetMs: 15000 });
  await heartbeat(db, 'label-money');
  return NextResponse.json({ ok: true, ...counts, businesses: run.done, of: run.total, resumesAt: run.ranOut ? run.nextStart : null });
}
