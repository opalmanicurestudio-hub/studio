// src/app/api/rent/deposit/route.ts — A RENTER'S SECURITY DEPOSIT, RECORDED BY HAND (lib/rent-deposit): received,
// part kept, returned, or applied to what they owe. Checked against the deposit as it stands, written once per request,
// and the renter is told in writing.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import Stripe from 'stripe';
import { recordDepositAction, refundDepositToCard, DEPOSIT_ACTIONS, type DepositAction } from '@/lib/rent-deposit';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 120);
  const g = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  const action = String(b.action || '') as DepositAction;
  if (!DEPOSIT_ACTIONS.includes(action)) return NextResponse.json({ ok: false, error: 'What should happen to the deposit?' }, { status: 400 });
  const cents = Math.round(Number(b.cents) || 0);
  if (cents < 0 || cents > 100_000_00) return NextResponse.json({ ok: false, error: 'Enter an amount between $0.01 and $100,000.' }, { status: 400 });
  const db = getAdminDb();
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  // A deposit paid by card goes back to that card.
  if (action === 'refund' && b.toCard === true) {
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ ok: false, error: 'Card payments aren’t set up here yet.' }, { status: 400 });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: '2024-06-20' as any });
    const r = await refundDepositToCard(db, stripe, tenantId, tenant, { leaseId: String(b.leaseId || ''), cents, requestId: String(b.requestId || ''), by: (g.actor as any)?.name || null, today: todayIn(tenantTimeZone(tenant)) });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, ...(r.retry ? { retry: true } : {}) }, { status: r.status });
    return NextResponse.json(r);
  }
  const r = await recordDepositAction(db, tenantId, tenant, {
    action, leaseId: String(b.leaseId || ''), cents, methodLabel: b.methodLabel, note: b.note, reason: b.reason,
    evidenceUrls: Array.isArray(b.evidenceUrls) ? b.evidenceUrls : [], requestId: String(b.requestId || ''),
    by: (g.actor as any)?.name || null, today: todayIn(tenantTimeZone(tenant)),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
