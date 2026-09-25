// src/app/api/stripe/pay-later/route.ts
//
// A business's "Offer pay-later" switch (owners only).
//   status { tenantId }                        → setting + what Stripe has approved
//   save   { tenantId, enabled, minAmount }    → saves; turning on asks Stripe to
//          approve Klarna, Afterpay and Affirm for the business's account
//          (usually instant; some businesses need a moment or aren't eligible)

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { PAY_LATER_CAPABILITIES, PAY_LATER_DEFAULT_MIN } from '@/lib/pay-later';

export const dynamic = 'force-dynamic';
const LABEL: Record<string, string> = { klarna_payments: 'Klarna', afterpay_clearpay_payments: 'Afterpay', affirm_payments: 'Affirm' };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only the owner can change payment options.' }, { status: 403 });
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}`);
  const t = ((await ref.get()).data() as any) || {};
  const acct = t.stripeAccountId as string | undefined;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });

  const statuses = async () => {
    if (!acct || !process.env.STRIPE_SECRET_KEY) return [];
    try {
      const a = await stripe.accounts.retrieve(acct);
      return PAY_LATER_CAPABILITIES.map((c) => ({ key: c, label: LABEL[c], status: String((a.capabilities as any)?.[c] || 'not requested') }));
    } catch { return []; }
  };

  if (b.action === 'save') {
    if (!acct) return NextResponse.json({ ok: false, error: 'Connect Stripe first.' }, { status: 400 });
    const enabled = !!b.enabled;
    const minAmount = Math.max(0, Math.min(100000, Math.round(Number(b.minAmount ?? PAY_LATER_DEFAULT_MIN))));
    if (enabled) {
      try { await stripe.accounts.update(acct, { capabilities: Object.fromEntries(PAY_LATER_CAPABILITIES.map((c) => [c, { requested: true }])) as any }); }
      catch (e: any) { return NextResponse.json({ ok: false, error: `Stripe: ${String(e?.message || e).slice(0, 200)}` }, { status: 400 }); }
    }
    await ref.set({ payLater: { enabled, minAmount, updatedAt: new Date().toISOString() } }, { merge: true });
    return NextResponse.json({ ok: true, setting: { enabled, minAmount }, capabilities: await statuses() });
  }
  return NextResponse.json({ ok: true, setting: { enabled: !!t.payLater?.enabled, minAmount: t.payLater?.minAmount ?? PAY_LATER_DEFAULT_MIN }, capabilities: await statuses(), connected: !!acct });
}
