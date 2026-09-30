// src/app/api/cron/cleanup-evidence/route.ts — EVIDENCE RETENTION (daily, Vercel Cron + CRON_SECRET).
// Moved from the Cloud Function cleanupEvidence (never deployed). Deletes checklist/task evidence PHOTOS older than
// 90 days — only under tenants/{tid}/…/evidence/…; signatures and every other folder are untouched. The run records
// (who, when, 12/12) stay forever; only the expired photo goes. Capped per run; the daily cadence drains any backlog.
import { NextRequest, NextResponse } from 'next/server';
import { privateBucket } from '@/lib/private-storage';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const RETENTION_DAYS = 90; const MAX_DELETES = 1500;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const cutoff = Date.now() - RETENTION_DAYS * 86400000; const bucket: any = await privateBucket();
  let deleted = 0, scanned = 0; let pageToken: string | undefined;
  do {
    const [files, , res]: any = await bucket.getFiles({ prefix: 'tenants/', maxResults: 1000, pageToken, autoPaginate: false });
    for (const f of files || []) {
      scanned++; if (!String(f.name).includes('/evidence/')) continue;
      const created = Date.parse(f.metadata?.timeCreated || ''); if (!created || created >= cutoff) continue;
      try { await f.delete(); deleted++; } catch (e) { console.error('[cron/cleanup-evidence]', f.name, e); }
      if (deleted >= MAX_DELETES) break;
    }
    pageToken = res?.nextPageToken;
  } while (pageToken && deleted < MAX_DELETES);
  return NextResponse.json({ ok: true, scanned, deleted, retentionDays: RETENTION_DAYS });
}
