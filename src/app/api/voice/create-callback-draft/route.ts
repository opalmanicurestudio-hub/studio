/**
 * POST /api/voice/create-callback-draft — v1
 *
 * The AI receptionist's landing zone: instead of writing confirmed
 * appointments directly (v2 territory), every call that gets as far as a
 * name lands here as a draft in tenants/{tenantId}/callBackDrafts — the same
 * collection QuickBookForm's "Pending call-backs" panel subscribes to. Staff
 * see it at step 1, tap Resume, and the whole booking is pre-filled.
 *
 * The document written here matches the CallBackDraft type in QuickBookForm
 * field-for-field (id, tenantId, createdAt, updatedAt, createdByStaffId,
 * callerName, callerPhone, clientId, clientName, note, step, snapshot,
 * status), and the snapshot matches buildSnapshot()'s shape exactly so
 * applySnapshot() on Resume restores service, provider, date, time, and
 * new-client details without staff re-entering anything. Two extra fields —
 * source: 'ai_receptionist' and callSummary — are additive; the panel
 * ignores unknown fields, and source gives you a filter for measuring the
 * agent later (and a badge in the panel whenever you want one).
 *
 * step is inferred from how far the call got: service + agreed slot → 3
 * (review), service only → 2, neither → 1.
 *
 * Because this uses the Admin SDK it bypasses Firestore security rules — no
 * rules change needed for this route (the rules note in QuickBookForm's
 * header applies to the client-side staff subscription, which you already
 * have in place).
 *
 * Request:
 * {
 *   "tenantId": "...",
 *   "callerPhone": "+13365551234",
 *   "callerName": "Dana",                    // as stated on the call
 *   "clientId": "abc123" | null,             // from lookup-client, if matched
 *   "requestedService": "gel full set",      // name or id; fuzzy-resolved
 *   "requestedSlot": {                       // slot verbally agreed to, if any
 *     "startISO": "2026-07-07T18:30:00.000Z",
 *     "providerId": "prov_jessica"           // optional
 *   },
 *   "notes": "Prefers Jessica, asked about nail art pricing",
 *   "callSummary": "..."                     // platform transcript summary
 * }
 *
 * Response: { "created": true, "draftId": "..." } — or
 *           { "created": false, "error": "...", "spokenSummary": "..." }
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  verifyVoiceSecret,
  parseVoiceToolRequest,
  stripUndefined,
  localDateStr,
  localTimeHHmm,
} from '@/lib/voice/voice-utils';
import {
  loadTenantContext,
  resolveService,
} from '@/lib/voice/server-availability';

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
      created: false,
      error: 'invalid_json',
      spokenSummary: "I wasn't able to save that. Let me try once more.",
    });
  }

  const { args: body, retellCallId, callerNumber } = parseVoiceToolRequest(raw);

  const tenantId: string = body?.tenantId;
  const callerName: string = (body?.callerName || '').trim();
  const callerPhone: string = (body?.callerPhone || callerNumber || '').trim();
  if (!tenantId || (!callerName && !callerPhone)) {
    return NextResponse.json({
      created: false,
      error: 'missing_params',
      spokenSummary:
        'I need at least a name or a phone number to save this for the team.',
    });
  }

  try {
    const db = getAdminDb();
    const ctx = await loadTenantContext(db, tenantId);
    const tz = ctx.timezone;

    // Resolve the requested service to a real id where possible so Resume
    // pre-selects it; keep the raw text in the note if it didn't resolve.
    const requestedServiceRaw: string = (body.requestedService || '').trim();
    const service = requestedServiceRaw
      ? resolveService(ctx, {
          serviceId: requestedServiceRaw,
          serviceName: requestedServiceRaw,
        }) ||
        resolveService(ctx, { serviceName: requestedServiceRaw })
      : null;

    // Agreed slot → tenant-local aptDate/aptTime strings, because that's what
    // the snapshot (and the form's date/time state) stores.
    let aptDate: string | undefined;
    let aptTime: string | undefined;
    const startISO: string | undefined = body?.requestedSlot?.startISO;
    if (startISO) {
      const start = new Date(startISO);
      if (!Number.isNaN(start.getTime())) {
        aptDate = localDateStr(start, tz);
        aptTime = localTimeHHmm(start, tz);
      }
    }
    const requestedProviderId: string | undefined =
      body?.requestedSlot?.providerId || undefined;

    // Verify the clientId actually exists before pinning the draft to it —
    // Resume matches drafts to client docs by this id.
    let clientId: string | null = null;
    let clientName = '';
    if (body.clientId) {
      const clientSnap = await db
        .doc(`tenants/${tenantId}/clients/${body.clientId}`)
        .get();
      if (clientSnap.exists) {
        clientId = clientSnap.id;
        clientName = (clientSnap.data() as any)?.name || callerName;
      }
    }

    const step: 1 | 2 | 3 = service && aptDate && aptTime ? 3 : service ? 2 : 1;

    const noteParts: string[] = [];
    if (body.notes?.trim()) noteParts.push(String(body.notes).trim());
    if (requestedServiceRaw && !service) {
      noteParts.push(`Asked for: "${requestedServiceRaw}" (no service match — confirm)`);
    }
    noteParts.push('Taken by AI receptionist');

    const now = new Date().toISOString();
    const draftId = nanoid();

    // snapshot mirrors QuickBookForm.buildSnapshot() field-for-field so
    // applySnapshot() restores cleanly on Resume.
    const snapshot = {
      clientSearch: '',
      selectedService: service?.id || '',
      addOnIds: [] as string[],
      durationOffset: 0,
      selectedStaff: requestedProviderId || 'any',
      aptDate: aptDate || '',
      aptTime: aptTime || '',
      isGroup: false,
      groupGuests: [] as any[],
      isMultiProvider: false,
      providerLegs: [] as any[],
      sendLink: true,
      requestFiles: false,
      clientNotes: '',
      internalNotes: noteParts.join(' · '),
      redeemPackageId: null as string | null,
      chargeNow: true,
      promoCode: '',
      promoDiscount: null as any,
      reminderHours: '48',
      isNewClient: !clientId,
      newClientName: clientId ? '' : callerName,
      newClientPhone: clientId ? '' : callerPhone,
      newClientEmail: '',
    };

    await db.doc(`tenants/${tenantId}/callBackDrafts/${draftId}`).set(
      stripUndefined({
        id: draftId,
        tenantId,
        createdAt: now,
        updatedAt: now,
        createdByStaffId: null,
        callerName: callerName || clientName || 'Unknown caller',
        callerPhone,
        clientId,
        clientName: clientName || callerName || '',
        note: noteParts.join(' · '),
        step,
        snapshot,
        status: 'pending',
        // Additive fields — panel ignores them, analytics thank you later:
        source: 'ai_receptionist',
        retellCallId: retellCallId || undefined, // links draft → recording
        callSummary: (body.callSummary || '').trim() || undefined,
        requestedSlotISO: startISO || undefined,
        requestedServiceRaw: requestedServiceRaw || undefined,
      }),
    );

    return NextResponse.json({
      created: true,
      draftId,
      resolvedServiceId: service?.id ?? null,
      step,
    });
  } catch (e) {
    console.error('[voice/create-callback-draft]', e);
    return NextResponse.json({
      created: false,
      error: 'internal',
      spokenSummary:
        "I couldn't save that just now. Could you give me your number again so the team can reach you?",
    });
  }
}
