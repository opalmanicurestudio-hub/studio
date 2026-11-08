// /api/stripe/connect — A BUSINESS CONNECTS ITS OWN STRIPE ACCOUNT (Express onboarding).
// POST, signed in as the owner (or an admin of the business), with { tenantId, action }:
//   'start'   — makes the business's Stripe account if it has none, and returns Stripe's onboarding link to open.
//   'refresh' — asks Stripe how setup stands and saves it on the business (card payments on, details sent, payouts on).
// GET is only Stripe's "start again" address for an expired onboarding link. It carries nothing about the business: it
// sends the owner back to Settings › Payments, which starts again for them once they're signed in (POST 'start').
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
export const dynamic = 'force-dynamic';

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
const appUrlOf = (req: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '');
// The setup step it was opened from (Set up your business), carried there and back so the setup bar is still there.
const stepOf = (v: any) => (typeof v === 'string' && /^[a-z]{1,20}$/.test(v) ? v : '');
const paymentsPage = (appUrl: string, q: string, setup = '') => `${appUrl}/settings?tab=payments&${q}${setup ? `&setup=${setup}` : ''}`;

type Flags = { chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean };
const flagsOf = (a: Stripe.Account): Flags => ({ chargesEnabled: !!a.charges_enabled, detailsSubmitted: !!a.details_submitted, payoutsEnabled: !!a.payouts_enabled });
const saveFlags = (ref: any, f: Flags) => ref.set({ stripeChargesEnabled: f.chargesEnabled, stripeDetailsSubmitted: f.detailsSubmitted, stripePayoutsEnabled: f.payoutsEnabled, stripeStatusAt: new Date().toISOString() }, { merge: true });

/** The business's Stripe account, made the first time. */
async function accountFor(db: any, tenantId: string): Promise<{ ref: any; accountId: string }> {
  const ref = db.doc(`tenants/${tenantId}`);
  const t: any = (await ref.get()).data() || {};
  if (t.stripeAccountId) return { ref, accountId: String(t.stripeAccountId) };
  const account = await stripe().accounts.create({
    type: 'express',
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { name: t.name || undefined },
    metadata: { tenantId, userId: String(t.userId || ''), kind: 'business' },
  }, { idempotencyKey: `connect-acct-${tenantId}-${String(t.stripeDisconnectedAt || 'first')}` });   // one account for two taps at once; a new one after a disconnect
  await ref.set({ stripeAccountId: account.id, stripeConnectedAt: new Date().toISOString(), stripeChargesEnabled: false, stripeDetailsSubmitted: false, stripePayoutsEnabled: false }, { merge: true });
  return { ref, accountId: account.id };
}

async function onboardingLink(req: NextRequest, accountId: string, setup = ''): Promise<string> {
  const appUrl = appUrlOf(req);
  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/api/stripe/connect${setup ? `?setup=${setup}` : ''}`,
    return_url: paymentsPage(appUrl, 'stripe=connected', setup),
    type: 'account_onboarding',
  });
  return link.url;
}

const said = (e: any) => {
  const m = String(e?.message || '');
  if (/STRIPE_SECRET_KEY|api key|apiKey/i.test(m) || !process.env.STRIPE_SECRET_KEY) return 'Card payments aren’t available yet. Please try again later.';
  return 'Stripe didn’t answer. Please try again in a minute.';
};

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const tenantId = String(body?.tenantId || '').trim();
  const action = String(body?.action || 'start');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Choose a business first.' }, { status: 400 });
  const db = getAdminDb();
  const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  // Where the business's money goes is the owner's call (or an admin they've trusted with it).
  if (!who.actor.isOwner && who.actor.role !== 'admin') return NextResponse.json({ ok: false, error: 'Only the owner can set up payments.' }, { status: 403 });
  try {
    if (action === 'refresh') {
      const ref = db.doc(`tenants/${tenantId}`);
      const t: any = (await ref.get()).data() || {};
      if (!t.stripeAccountId) return NextResponse.json({ ok: true, hasAccount: false, chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false });
      const f = flagsOf(await stripe().accounts.retrieve(String(t.stripeAccountId)));
      await saveFlags(ref, f);
      return NextResponse.json({ ok: true, hasAccount: true, ...f });
    }
    const { accountId } = await accountFor(db, tenantId);
    return NextResponse.json({ ok: true, url: await onboardingLink(req, accountId, stepOf(body?.setup)) });
  } catch (e: any) {
    console.error('[stripe/connect]', action, e?.message);
    return NextResponse.json({ ok: false, error: said(e) }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.redirect(paymentsPage(appUrlOf(req), 'stripe=refresh', stepOf(new URL(req.url).searchParams.get('setup'))));
}
