// src/app/api/pay/plan-check/route.ts — the owner's "Pay plan check" (lib/pay-clarity-server planCheck). Managers only.
// Shows pay per hour, unbooked time, minimum-wage top-ups and overtime per person, and tries a plan on everyone it fits.
// Never includes anyone's private goal, costs or comparisons.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { planCheck } from '@/lib/pay-clarity-server';
export const dynamic = 'force-dynamic'; export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const days = [28, 56, 91].includes(Number(b.days)) ? Number(b.days) : 56;
  return NextResponse.json(await planCheck(getAdminDb(), tenantId, { days, simulate: b.simulate || null }), { headers: { 'Cache-Control': 'no-store' } });
}
