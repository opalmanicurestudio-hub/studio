/**
 * enroll-membership — v1: THE membership enrollment engine.
 *
 * Mirrors lib/booking/create-booking.ts's architecture deliberately: one
 * server-side authority for turning "this client, this membership tier,
 * this payment" into a real, active subscription — built so every caller
 * (POS checkout, the voice agent, a future admin manual-add) shares one
 * proven implementation instead of each reinventing it slightly
 * differently.
 *
 * THIS DID NOT EXIST BEFORE. Prior to this file, nothing in the codebase
 * actually enrolled a client in a membership — BookingMemberships.tsx (the
 * public booking page's purchase carousel) was dead code with no wired
 * onPurchase handler, and the POS checkout flow only ever recorded a
 * ledger sale + redeemed an EXISTING membership's perks, never created a
 * new one. This is now the one real enrollment path.
 *
 * BILLING MODEL: custom recurring charges, not native Stripe Subscription
 * objects. Deliberate choice, not an oversight — see the header comment on
 * chargeMembershipRenewals.ts for the full reasoning and the tradeoff this
 * accepts (no automatic Stripe-managed retries/dunning; this codebase
 * handles that itself instead, consistent with MembershipLedgerPage's
 * existing "Projected Dues / Awaiting Collection" language, which already
 * assumed a self-managed model).
 *
 * Guarantees:
 *   1. Card is charged FIRST. Enrollment (client.activeMembershipId,
 *      client.subscription, the ledger revenue line) is written ONLY if
 *      the charge actually succeeds — never record a membership that
 *      wasn't paid for. Same principle as every other auto-charge path
 *      built in this system.
 *   2. nextBillingDate is set to exactly one interval (monthly/yearly)
 *      from the moment of enrollment — chargeMembershipRenewals.ts reads
 *      this field to know who's due.
 *   3. A client already on an active membership can't double-enroll —
 *      returns already_enrolled rather than silently overwriting.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

export type EnrollMembershipInput = {
  tenantId: string;
  clientId: string;
  membershipId: string;
  paymentMethod: 'card_on_file' | 'already_charged';
  existingPaymentIntentId?: string;
  source: string;
  appUrl?: string;
  // v17 — matches the exact skipLedger convention already used throughout
  // pos-page.tsx's handleCheckout. When called from POS checkout, the
  // ledger line for this sale is already written by that function's own
  // retailItems loop — this must only perform the enrollment WRITE in
  // that case, never a second, duplicate "Membership Sales" transaction.
  skipLedger?: boolean;
};

export type EnrollMembershipResult =
  | {
      ok: true;
      activeMembershipId: string;
      nextBillingDate: string;
      chargedAmount: number;
      stripePaymentIntentId?: string;
      spoken: string;
    }
  | { ok: false; error: string; spoken: string };

export async function enrollMembership(
  db: Firestore,
  input: EnrollMembershipInput,
): Promise<EnrollMembershipResult> {
  const { tenantId, clientId, membershipId } = input;

  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  if (!clientSnap.exists) {
    return { ok: false, error: 'client_not_found', spoken: "I couldn't find your file — let me get the team to help with that." };
  }
  const client = clientSnap.data() as any;

  if (client.activeMembershipId && client.subscription?.status === 'active') {
    return {
      ok: false,
      error: 'already_enrolled',
      spoken: "Looks like you're already on an active membership — no need to sign up again.",
    };
  }

  const membershipSnap = await db.doc(`tenants/${tenantId}/memberships/${membershipId}`).get();
  if (!membershipSnap.exists) {
    return { ok: false, error: 'membership_not_found', spoken: "I'm not finding that membership tier on my end." };
  }
  const membership = membershipSnap.data() as any;
  const price = Number(membership.price) || 0;

  let stripePaymentIntentId = input.existingPaymentIntentId;

  if (input.paymentMethod === 'card_on_file') {
    const cardExpDate = client.cardOnFile?.expMonth && client.cardOnFile?.expYear
      ? new Date(Number(client.cardOnFile.expYear), Number(client.cardOnFile.expMonth), 0)
      : null;
    const cardIsExpired = !!cardExpDate && cardExpDate < new Date();
    const hasUsableCard = !!(
      (client.cardOnFile?.paymentMethodId || client.cardOnFile?.token) &&
      (client.cardOnFile?.customerId || client.cardOnFile?.stripeCustomerId) &&
      !cardIsExpired
    );
    if (!hasUsableCard) {
      return { ok: false, error: 'no_usable_card', spoken: "I don't see a valid card on file to set that up with." };
    }
    if (price > 0) {
      const appUrl = input.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
      try {
        const chargeRes = await fetch(`${appUrl}/api/stripe/charge-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            clientId,
            amountCents: Math.round(price * 100),
            description: `Membership — ${membership.name}`,
            category: 'Membership Sales',
            reason: `${input.source} membership enrollment`,
            mode: 'auto',
            // Same reasoning as sell-package.ts: 'deposit' kind's failure
            // semantics are correct here — a declined enrollment attempt
            // should never park as an arrears debt, since nothing was
            // owed, someone just tried to buy something and it declined.
            kind: 'deposit',
          }),
        });
        const chargeData = await chargeRes.json().catch(() => ({ ok: false }));
        if (!chargeData.ok) {
          return { ok: false, error: 'charge_declined', spoken: "That charge didn't go through — want to try a different card, or have the team follow up?" };
        }
        stripePaymentIntentId = chargeData.paymentIntentId;
      } catch {
        return { ok: false, error: 'charge_failed', spoken: "I ran into an issue processing that — let me have the team follow up instead." };
      }
    }
  }
  // 'already_charged': trust the caller already collected payment
  // (CheckoutHub's own card flows) — this call is purely the enrollment
  // write, no charge attempted here.

  const now = new Date().toISOString();
  const intervalMonths = membership.interval === 'yearly' ? 12 : 1;
  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + intervalMonths);
  const nextBillingDate = nextBilling.toISOString();

  const batch = db.batch();
  batch.set(
    db.doc(`tenants/${tenantId}/clients/${clientId}`),
    {
      activeMembershipId: membershipId,
      subscription: {
        membershipId,
        status: 'active',
        startedAt: now,
        nextBillingDate,
        perkUsage: {},
        perkLastUsed: null,
      },
      lifetimeValue: (Number(client.lifetimeValue) || 0) + price,
    },
    { merge: true },
  );
  if (price > 0 && !input.skipLedger) {
    const txnRef = db.doc(`tenants/${tenantId}/transactions/${nanoid()}`);
    batch.set(txnRef, {
      id: txnRef.id,
      tenantId,
      date: now,
      description: `Membership: ${membership.name}`,
      clientOrVendor: client.name || 'Client',
      clientId,
      type: 'income',
      context: 'Business',
      category: 'Membership Sales',
      amount: price,
      paymentMethod: input.paymentMethod === 'card_on_file' ? 'Card on File (Stripe)' : 'Card (Stripe)',
      stripePaymentIntentId,
      hasReceipt: true,
    });
  }
  await batch.commit();

  return {
    ok: true,
    activeMembershipId: membershipId,
    nextBillingDate,
    chargedAmount: price,
    stripePaymentIntentId,
    spoken: `You're enrolled in ${membership.name}${price > 0 ? ` — $${price.toFixed(2)} charged today` : ''}. Your next billing date is ${nextBilling.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`,
  };
}

/**
 * enrollPackage — the same missing-write gap sell-package.ts's voice route
 * always wrote correctly, but pos-page.tsx's checkout never did for a
 * BRAND NEW package purchase (only ever decremented an EXISTING one during
 * redemption). This is the shared engine for that write, same
 * architecture as enrollMembership — card charged first (or already
 * charged, matching POS checkout's flow), activePackages entry written
 * only on confirmed payment.
 */
export type EnrollPackageInput = {
  tenantId: string;
  clientId: string;
  packageId: string;
  paymentMethod: 'card_on_file' | 'already_charged';
  existingPaymentIntentId?: string;
  source: string;
  appUrl?: string;
  skipLedger?: boolean;
};

export type EnrollPackageResult =
  | { ok: true; sessionsRemaining: number; chargedAmount: number; stripePaymentIntentId?: string; spoken: string }
  | { ok: false; error: string; spoken: string };

export async function enrollPackage(
  db: Firestore,
  input: EnrollPackageInput,
): Promise<EnrollPackageResult> {
  const { tenantId, clientId, packageId } = input;

  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
  if (!clientSnap.exists) {
    return { ok: false, error: 'client_not_found', spoken: "I couldn't find your file — let me get the team to help with that." };
  }
  const client = clientSnap.data() as any;

  const pkgSnap = await db.doc(`tenants/${tenantId}/packages/${packageId}`).get();
  if (!pkgSnap.exists) {
    return { ok: false, error: 'package_not_found', spoken: "I'm not finding that package on my end." };
  }
  const pkg = pkgSnap.data() as any;
  const price = Number(pkg.price) || 0;

  let stripePaymentIntentId = input.existingPaymentIntentId;

  if (input.paymentMethod === 'card_on_file') {
    const cardExpDate = client.cardOnFile?.expMonth && client.cardOnFile?.expYear
      ? new Date(Number(client.cardOnFile.expYear), Number(client.cardOnFile.expMonth), 0)
      : null;
    const cardIsExpired = !!cardExpDate && cardExpDate < new Date();
    const hasUsableCard = !!(
      (client.cardOnFile?.paymentMethodId || client.cardOnFile?.token) &&
      (client.cardOnFile?.customerId || client.cardOnFile?.stripeCustomerId) &&
      !cardIsExpired
    );
    if (!hasUsableCard) {
      return { ok: false, error: 'no_usable_card', spoken: "I don't see a valid card on file to set that up with." };
    }
    if (price > 0) {
      const appUrl = input.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
      try {
        const chargeRes = await fetch(`${appUrl}/api/stripe/charge-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            clientId,
            amountCents: Math.round(price * 100),
            description: `Package — ${pkg.name}`,
            category: 'Package Sales',
            reason: `${input.source} package enrollment`,
            mode: 'auto',
            kind: 'deposit',
          }),
        });
        const chargeData = await chargeRes.json().catch(() => ({ ok: false }));
        if (!chargeData.ok) {
          return { ok: false, error: 'charge_declined', spoken: "That charge didn't go through — want to try a different card, or have the team follow up?" };
        }
        stripePaymentIntentId = chargeData.paymentIntentId;
      } catch {
        return { ok: false, error: 'charge_failed', spoken: "I ran into an issue processing that — let me have the team follow up instead." };
      }
    }
  }

  const now = new Date().toISOString();
  const sessionsRemaining = Number(pkg.sessions) || 1;
  const batch = db.batch();
  const existingPackages: any[] = client.activePackages || [];
  batch.set(
    db.doc(`tenants/${tenantId}/clients/${clientId}`),
    {
      activePackages: [
        ...existingPackages,
        { packageId, sessionsRemaining, purchasedAt: now, source: input.source },
      ],
      lifetimeValue: (Number(client.lifetimeValue) || 0) + price,
    },
    { merge: true },
  );
  if (price > 0 && !input.skipLedger) {
    const txnRef = db.doc(`tenants/${tenantId}/transactions/${nanoid()}`);
    batch.set(txnRef, {
      id: txnRef.id,
      tenantId,
      date: now,
      description: `Package: ${pkg.name}`,
      clientOrVendor: client.name || 'Client',
      clientId,
      type: 'income',
      context: 'Business',
      category: 'Package Sales',
      amount: price,
      paymentMethod: input.paymentMethod === 'card_on_file' ? 'Card on File (Stripe)' : 'Card (Stripe)',
      stripePaymentIntentId,
      hasReceipt: true,
    });
  }
  await batch.commit();

  return {
    ok: true,
    sessionsRemaining,
    chargedAmount: price,
    stripePaymentIntentId,
    spoken: `You're all set — ${pkg.name} is active${price > 0 ? ` — $${price.toFixed(2)} charged today` : ''}. You've got ${sessionsRemaining} sessions to use.`,
  };
}
