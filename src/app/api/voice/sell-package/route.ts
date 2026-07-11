/**
 * POST /api/voice/sell-package — v1
 *
 * Voice tool for selling a package (a one-time bundle of prepaid sessions —
 * e.g. "10 gel manicures") during a call. Memberships are deliberately NOT
 * handled here yet — that requires seeing the actual enrollment write
 * (client.subscription creation, nextBillingDate, whatever recurring-billing
 * mechanism exists) which hasn't been reviewed. Building that blind risks a
 * parallel, incorrect implementation of real subscription billing — the
 * exact class of mistake this whole voice system has been built to avoid.
 *
 * Two modes, governed by tenant.voiceAgent.autoSellOfferings (default
 * false — a package purchase is a new revenue commitment, not a fee for
 * something that already happened, so it gets its own opt-in separate from
 * autoChargeFeeBearingActions):
 *
 *   Not opted in, or any safety gate fails, or no usable card:
 *     LOG ONLY. Writes a voiceInbox item (intent: 'package_interest') for
 *     staff to close the sale in person or via a payment link. Never
 *     charges, never enrolls.
 *
 *   Opted in AND client matched AND safe AND usable card on file:
 *     Charges the full package price via /api/stripe/charge-card
 *     (mode:'auto'). Enrollment (activePackages entry + ledger revenue
 *     line) ONLY happens if the charge actually succeeds — same principle
 *     as every other auto-charge path in this system: never record a sale
 *     that didn't genuinely happen. A decline falls through to the same
 *     staff-logged inbox item as the not-opted-in case.
 *
 * Safety gates, same as booking/cancel/reschedule:
 *   - client must be blocked-checked
 *   - poorHistory (2+ combined no-shows/cancellations) blocks auto-sell
 *   - an outstanding balance blocks auto-sell
 * These are NOT overridable by the opt-in — a risky client always falls to
 * staff regardless of the tenant setting, same as everywhere else.
 *
 * Auth: voice tool secret, same as create-booking/log-call-intent — this
 * fires mid-call, not staff-triggered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, parseVoiceToolRequest } from '@/lib/voice/voice-utils';
import { loadTenantContext } from '@/lib/voice/server-availability';
import { hasUsableCard as hasUsableCardCheck } from '@/lib/payments/has-usable-card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({
      ok: false,
      error: 'invalid_json',
      spoken: "I wasn't able to save that — let me try once more.",
    });
  }

  const { args: body, retellCallId, callerNumber } = parseVoiceToolRequest(raw);
  const tenantId: string = body?.tenantId;
  const clientId: string = body?.clientId;
  const packageId: string = body?.packageId;
  const callerName: string = (body?.callerName || '').trim();
  const callerPhone: string = (body?.callerPhone || callerNumber || '').trim();

  if (!tenantId || !clientId || !packageId) {
    return NextResponse.json({
      ok: false,
      error: 'missing_params',
      spoken: "I need a bit more information to set that up — let me get someone to help with that.",
    });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);
    const tenant = ctx.tenant || {};

    const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
    if (!clientSnap.exists) {
      return NextResponse.json({
        ok: false,
        error: 'client_not_found',
        spoken: "I couldn't find your file to set that up — let me take a message for the team instead.",
      });
    }
    const client = clientSnap.data() as any;

    if (client.status === 'blocked' || client.status === 'banned') {
      return NextResponse.json({
        ok: true,
        sold: false,
        logged: true,
        spoken: "I ran into an account note I need the team to look at first — let me take your details and have them call you back.",
      });
    }

    const pkgSnap = await db.doc(`tenants/${tenantId}/packages/${packageId}`).get();
    if (!pkgSnap.exists) {
      return NextResponse.json({
        ok: false,
        error: 'package_not_found',
        spoken: "I'm not finding that package on my end — let me have the team confirm the details with you.",
      });
    }
    const pkg = pkgSnap.data() as any;

    const poorHistory = (Number(client.noShowCount) || 0) + (Number(client.cancellationCount) || 0) > 2;
    const hasOutstandingBalance = (Number(client.outstandingBalance) || 0) > 0;
    const safeToConsider = !poorHistory && !hasOutstandingBalance;

    // v21 — consolidated into the shared has-usable-card helper.
    const hasUsableCard = hasUsableCardCheck(client);

    const canAutoSell = tenant.voiceAgent?.autoSellOfferings === true && safeToConsider && hasUsableCard;
    const price = Number(pkg.price) || 0;

    let sold = false;
    let stripePaymentIntentId: string | undefined;

    if (canAutoSell && price > 0) {
      try {
        // v1 — kind:'deposit' is a deliberate reuse, not a mismatch: its
        // FAILURE semantics are exactly what a package purchase needs — a
        // decline should never create an arrears/outstandingBalance record
        // (nothing was owed; they just tried to buy something and it
        // didn't go through), which is precisely how 'deposit' already
        // behaves on failure in this route. 'arrears_fee' would
        // incorrectly park a declined purchase attempt as a debt.
        const chargeRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com'}/api/stripe/charge-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            clientId,
            amountCents: Math.round(price * 100),
            description: `Package — ${pkg.name}`,
            category: 'Package Sales',
            reason: 'Voice-sold package, tenant opted into auto-sell',
            mode: 'auto',
            kind: 'deposit',
          }),
        });
        const chargeData = await chargeRes.json().catch(() => ({ ok: false }));
        if (chargeData.ok) {
          sold = true;
          stripePaymentIntentId = chargeData.paymentIntentId;
        }
      } catch {
        /* charge failed — falls through to the logged-interest path below */
      }
    }

    const now = new Date().toISOString();

    if (sold) {
      const batch = db.batch();
      const existingPackages: any[] = client.activePackages || [];
      batch.set(
        db.doc(`tenants/${tenantId}/clients/${clientId}`),
        {
          activePackages: [
            ...existingPackages,
            {
              packageId,
              sessionsRemaining: Number(pkg.sessions) || 1,
              purchasedAt: now,
              source: 'voice_verified_auto',
            },
          ],
          lifetimeValue: (Number(client.lifetimeValue) || 0) + price,
        },
        { merge: true },
      );
      const txnRef = db.doc(`tenants/${tenantId}/transactions/${nanoid()}`);
      batch.set(txnRef, {
        id: txnRef.id,
        tenantId,
        date: now,
        description: `Package: ${pkg.name}`,
        clientOrVendor: client.name || callerName || 'Client',
        clientId,
        type: 'income',
        context: 'Business',
        category: 'Package Sales',
        amount: price,
        paymentMethod: 'Card on File (Stripe)',
        stripePaymentIntentId,
        hasReceipt: true,
      });
      await batch.commit();

      return NextResponse.json({
        ok: true,
        sold: true,
        spoken: `You're all set — I've charged ${price.toFixed(2)} dollars and your ${pkg.name} package is active. You've got ${pkg.sessions} sessions to use.`,
      });
    }

    // Not sold — log the interest for staff to close, same inbox pattern
    // as log-call-intent's other intents.
    const inboxId = nanoid();
    await db.doc(`tenants/${tenantId}/voiceInbox/${inboxId}`).set({
      id: inboxId,
      tenantId,
      createdAt: now,
      intent: 'package_interest',
      callerName: callerName || client.name || 'Unknown caller',
      callerPhone,
      clientId,
      packageId,
      packageName: pkg.name,
      packagePrice: price,
      status: 'open',
      source: 'ai_receptionist',
      retellCallId: retellCallId || undefined,
    });

    return NextResponse.json({
      ok: true,
      sold: false,
      logged: true,
      spoken: `I've noted your interest in the ${pkg.name} package — the team will follow up to get you set up.`,
    });
  } catch (e) {
    console.error('[voice/sell-package]', e);
    return NextResponse.json({
      ok: false,
      error: 'internal',
      spoken: "I'm having trouble setting that up right now — let me take a message for the team.",
    });
  }
}
