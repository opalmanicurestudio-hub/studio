// src/app/api/stats/history/route.ts — all-time numbers for the Clients, Services and Discounts screens (lib/history-stats).
// Team only; money only for people allowed to see it. Worked out at most every few hours unless asked to refresh.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { canSeeFinancials } from '@/lib/privacy';
import { historyFor, withoutMoney } from '@/lib/history-stats-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Please sign in to continue.' }, { status: auth.status || 401 });
  try {
    const h = await historyFor(getAdminDb(), tenantId, b.refresh === true && !!auth.actor.isManager);
    const money = auth.actor.isTenantOwner || canSeeFinancials(auth.tenant, auth.actor.role);
    return NextResponse.json({ ok: true, ...(money ? h : withoutMoney(h)), money });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'We couldn’t work out the totals just now.' }, { status: 500 });
  }
}
