/**
 * POST /api/memberships/charge-renewals — recurring membership billing for ONE business, on demand (header
 * x-billing-secret = BILLING_CRON_SECRET; body { tenantId, dryRun? }). dryRun reports what WOULD happen — who'd be
 * charged, who'd wait for a card, who'd go past due or lapse — without calling the card processor or writing anything.
 * The work itself lives in lib/memberships/renewals; the daily run (/api/cron/membership-renewals) calls it for every
 * business.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { runRenewals } from '@/lib/memberships/renewals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!process.env.BILLING_CRON_SECRET || req.headers.get('x-billing-secret') !== process.env.BILLING_CRON_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body: any = await req.json().catch(() => ({}));
  const tenantId = String(body?.tenantId || ''); if (!tenantId) return NextResponse.json({ charged: 0, error: 'missing_tenant' }, { status: 400 });
  try { return NextResponse.json(await runRenewals(getAdminDb(), tenantId, { dryRun: body?.dryRun === true, appUrl: req.nextUrl.origin })); }
  catch (e) { console.error('[memberships/charge-renewals]', e); return NextResponse.json({ charged: 0, error: 'internal' }, { status: 500 }); }
}
