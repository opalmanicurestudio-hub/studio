/**
 * POST /api/voice/provision-number — v1
 *
 * The hands-off onboarding button: a business owner taps "Get my assistant
 * number" and this route does everything you were doing manually —
 *
 *   1. Buys a phone number from Retell (their create-phone-number API),
 *      preferring the business's own area code (inferred from the tenant's
 *      phone on file, overridable in the request).
 *   2. Attaches it to the correct shared agent — the variant matching the
 *      tenant's chosen voiceStyle when RETELL_AGENT_IDS is configured,
 *      else the default RETELL_AGENT_ID.
 *   3. Saves it straight onto the tenant doc (voiceAgent.phoneNumber), so
 *      the inbound webhook can route calls immediately. No paste step.
 *
 * Idempotent: a tenant that already has a number just gets it back —
 * double-taps can never buy twice. Owner-only (numbers cost money
 * monthly): tenant owner by userId, or a staff doc with role 'owner'.
 *
 * Env:
 *   RETELL_API_KEY   — required (already configured for outbound)
 *   RETELL_AGENT_ID  — the default shared agent's id
 *   RETELL_AGENT_IDS — optional JSON map of voiceStyle → agent id, e.g.
 *     {"warm_female":"agent_abc","calm_male":"agent_def"} — five voice
 *     variants, five ids; missing styles fall back to RETELL_AGENT_ID.
 *
 * NOTE: verify the create-phone-number request/response field names
 * against Retell's current API docs on first use (read tolerantly here).
 * Configure the inbound webhook at the AGENT level in Retell so every
 * number this route creates inherits it automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaff } from '@/lib/voice/staff-auth';
import { normalizePhone } from '@/lib/voice/voice-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RETELL_CREATE_NUMBER_URL = 'https://api.retellai.com/create-phone-number';

function resolveAgentId(voiceStyle: string | undefined): string | null {
  const fallback = process.env.RETELL_AGENT_ID || null;
  if (!process.env.RETELL_AGENT_IDS) return fallback;
  try {
    const map = JSON.parse(process.env.RETELL_AGENT_IDS);
    return (voiceStyle && map[voiceStyle]) || fallback;
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch { /* tolerated */ }

  const tenantId: string = body?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'missing_tenant' }, { status: 400 });
  }

  const auth = await verifyStaff(req, tenantId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ ok: false, error: 'tenant_not_found' }, { status: 404 });
    }
    const tenant = tenantSnap.data() as any;

    // Owner-only — provisioning has a monthly cost.
    let isOwner = tenant.userId === auth.uid;
    if (!isOwner) {
      const staffSnap = await db.doc(`tenants/${tenantId}/staff/${auth.uid}`).get();
      isOwner = staffSnap.exists && (staffSnap.data() as any)?.role === 'owner';
    }
    if (!isOwner) {
      return NextResponse.json(
        { ok: false, error: 'owner_only', reason: 'Only the owner can provision a number.' },
        { status: 403 },
      );
    }

    // Idempotent: already provisioned → return it, never buy twice.
    const existing = (tenant?.voiceAgent?.phoneNumber || '').trim();
    if (existing) {
      return NextResponse.json({ ok: true, phoneNumber: existing, alreadyProvisioned: true });
    }

    if (!process.env.RETELL_API_KEY) {
      return NextResponse.json(
        { ok: false, error: 'retell_not_configured', reason: 'RETELL_API_KEY is not set.' },
        { status: 500 },
      );
    }
    const agentId = resolveAgentId(tenant?.voiceAgent?.voiceStyle);
    if (!agentId) {
      return NextResponse.json(
        { ok: false, error: 'agent_not_configured', reason: 'RETELL_AGENT_ID is not set.' },
        { status: 500 },
      );
    }

    // Area code: explicit request → tenant's own phone → let Retell choose.
    const requested = String(body?.areaCode || '').replace(/\D/g, '').slice(0, 3);
    const inferred = normalizePhone(tenant.phone).slice(0, 3);
    const areaCode = requested.length === 3 ? requested : inferred.length === 3 ? inferred : '';

    const retellRes = await fetch(RETELL_CREATE_NUMBER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inbound_agent_id: agentId,
        // v22 — FIX: this route previously only ever enabled VOICE on a
        // newly provisioned number. Given the later decision to run SMS
        // on the SAME per-tenant number as voice (not a second number),
        // every tenant onboarded through this route was silently
        // voice-only, needing a manual extra step to get texting working
        // — exactly the gap flagged a few turns back, now confirmed by
        // reading this file directly.
        //
        // sms_agent_id is INFERRED from the inbound_agent_id naming
        // pattern, not confirmed against Retell's current docs — verify
        // this exact field name (and whether enabling SMS on a number
        // even happens at creation time vs. a separate follow-up call)
        // before relying on it. Same "read tolerantly, verify on first
        // use" caution this file's own header already gives for the
        // voice fields.
        sms_agent_id: agentId,
        ...(areaCode ? { area_code: Number(areaCode) } : {}),
        nickname: tenant.name || tenantId,
      }),
    });
    const data: any = await retellRes.json().catch(() => ({}));
    if (!retellRes.ok) {
      console.error('[voice/provision-number] retell error', retellRes.status, data);
      // Area-code inventory misses are common — retry once without it.
      if (areaCode) {
        const retry = await fetch(RETELL_CREATE_NUMBER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inbound_agent_id: agentId, sms_agent_id: agentId, nickname: tenant.name || tenantId }),
        });
        const retryData: any = await retry.json().catch(() => ({}));
        if (retry.ok && (retryData.phone_number || retryData.phoneNumber)) {
          const num = retryData.phone_number || retryData.phoneNumber;
          await db.doc(`tenants/${tenantId}`).set(
            {
              voiceAgent: {
                phoneNumber: num,
                provisionedAt: new Date().toISOString(),
                retellAgentId: agentId,
                smsAgentId: agentId,
                areaCodeFallback: true,
              },
            },
            { merge: true },
          );
          return NextResponse.json({ ok: true, phoneNumber: num, areaCodeFallback: true });
        }
      }
      return NextResponse.json({
        ok: false,
        error: 'retell_error',
        reason: data?.message || `Retell responded ${retellRes.status}`,
      });
    }

    const phoneNumber: string = data.phone_number || data.phoneNumber || '';
    if (!phoneNumber) {
      return NextResponse.json({ ok: false, error: 'no_number_returned' });
    }

    await db.doc(`tenants/${tenantId}`).set(
      {
        voiceAgent: {
          phoneNumber,
          provisionedAt: new Date().toISOString(),
          retellAgentId: agentId,
                smsAgentId: agentId,
        },
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, phoneNumber });
  } catch (e) {
    console.error('[voice/provision-number]', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
