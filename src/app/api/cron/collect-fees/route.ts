// src/app/api/cron/collect-fees/route.ts — COLLECT FEES OWED (daily, Vercel Cron + CRON_SECRET).
// Runs lib/fee-collection for every business that switched it on in Automations. Off by default.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { collectFees } from '@/lib/fee-collection';
import { automationOn } from '@/lib/automation-switches';
import { recordCronRun } from '@/lib/cron-heartbeat';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ ok: false }, { status: 401 });
  const db = getAdminDb(); const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });
  const results: Record<string, any> = {};
  for (const t of (await db.collection('tenants').get()).docs) {
    const tenant: any = t.data() || {};
    if (!automationOn(tenant, 'fee-collection') || !tenant.stripeAccountId) continue;
    try { results[t.id] = await collectFees(db, stripe, t.id, tenant); } catch (e: any) { results[t.id] = { error: String(e?.message || e).slice(0, 120) }; }
  }
  await recordCronRun('collect-fees', { businesses: Object.keys(results).length });
  return NextResponse.json({ ok: true, results });
}
