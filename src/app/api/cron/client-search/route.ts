// src/app/api/cron/client-search/route.ts — KEEPS CLIENT SEARCH COMPLETE (Vercel Cron, hourly). Walks each business's
// clients a page at a time and writes searchKeys (lib/client-search) wherever they're missing or out of date — a client
// added by a path that doesn't write them, an edited name. Once a business has been walked end to end it rests for a
// day, so this costs about one read per client per day, not one per client every time someone opens the app.
// It also copies past redemptions into each business's redemption log, once (lib/client-search-server).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { recordCronRun } from '@/lib/cron-heartbeat';
import { forEachTenant } from '@/lib/cron-fanout';
import { walkClients, backfillRedemptionLog } from '@/lib/client-search-server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); let read = 0; let fixed = 0; const errors: string[] = [];
  await forEachTenant(db, 'client-search', async (t) => {
    try { const r = await walkClients(db, t.id); read += r.read; fixed += r.fixed; await backfillRedemptionLog(db, t.id); }
    catch (e: any) { errors.push(`${t.id}: ${String(e?.message || e).slice(0, 160)}`); }
  }, { concurrency: 6, budgetMs: 45_000 });
  await recordCronRun('client-search', { read, fixed, errors: errors.slice(0, 10) });
  return NextResponse.json({ ok: true, read, fixed });
}
