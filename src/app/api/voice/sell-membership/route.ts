/**
 * POST /api/voice/sell-membership — v1
 *
 * Voice tool for enrolling a client in a membership during a call. Thin
 * wrapper around lib/memberships/enroll-membership.ts — the same shared
 * engine POS checkout should call too, so a membership sold by voice and
 * one sold at the front desk both get identical treatment (card charged
 * first, enrollment written only on success, same ledger shape).
 *
 * Gated by tenant.voiceAgent.autoSellOfferings — same setting sell-package
 * already uses. A membership is a bigger commitment than a package (an
 * ongoing charge, not a one-time purchase), but the trust decision an
 * owner is making — "can the agent close a sale and charge a card live" —
 * is the same one either way, so this deliberately reuses the same flag
 * rather than adding a third, narrower toggle.
 *
 * Same safety gates as every other auto-execute path: blocked client
 * check, poorHistory, outstandingBalance. Not overridable by the opt-in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, parseVoiceToolRequest } from '@/lib/voice/voice-utils';
import { loadTenantContext } from '@/lib/voice/server-availability';
import { enrollMembership } from '@/lib/memberships/enroll-membership';

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

  const { args: body } = parseVoiceToolRequest(raw);
  const tenantId: string = body?.tenantId;
  const clientId: string = body?.clientId;
  const membershipId: string = body?.membershipId;

  if (!tenantId || !clientId || !membershipId) {
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

    const poorHistory = (Number(client.noShowCount) || 0) + (Number(client.cancellationCount) || 0) > 2;
    const hasOutstandingBalance = (Number(client.outstandingBalance) || 0) > 0;
    const safeToConsider = !poorHistory && !hasOutstandingBalance;
    const canAutoSell = tenant.voiceAgent?.autoSellOfferings === true && safeToConsider;

    const now = new Date().toISOString();

    if (!canAutoSell) {
      const inboxId = `membership_interest_${Date.now()}`;
      await db.doc(`tenants/${tenantId}/voiceInbox/${inboxId}`).set({
        id: inboxId,
        tenantId,
        createdAt: now,
        intent: 'membership_interest',
        clientId,
        membershipId,
        status: 'open',
        source: 'ai_receptionist',
      });
      return NextResponse.json({
        ok: true,
        sold: false,
        logged: true,
        spoken: "I've noted your interest in that membership — the team will follow up to get you set up.",
      });
    }

    const result = await enrollMembership(db, {
      tenantId,
      clientId,
      membershipId,
      paymentMethod: 'card_on_file',
      source: 'ai_receptionist',
    });

    if (!result.ok) {
      // Enrollment engine already returns a safe, honest spoken line for
      // every failure case (no card, declined, already enrolled, etc.) —
      // relay it directly rather than re-deciding what to say.
      return NextResponse.json({ ok: true, sold: false, error: result.error, spoken: result.spoken });
    }

    return NextResponse.json({
      ok: true,
      sold: true,
      nextBillingDate: result.nextBillingDate,
      spoken: result.spoken,
    });
  } catch (e) {
    console.error('[voice/sell-membership]', e);
    return NextResponse.json({
      ok: false,
      error: 'internal',
      spoken: "I'm having trouble setting that up right now — let me take a message for the team.",
    });
  }
}
