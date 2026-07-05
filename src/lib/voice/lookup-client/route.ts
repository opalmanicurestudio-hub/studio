/**
 * POST /api/voice/lookup-client — v1
 *
 * Called by the voice platform at call start (with the caller-ID number) so
 * the agent can greet returning clients by name, answer "when's my
 * appointment?", and know about outstanding balances or missing forms before
 * the caller even asks.
 *
 * Phone matching: caller ID arrives E.164 (+13365551234) but client docs may
 * hold anything staff typed over the years, so matching is on the last 10
 * digits. Strategy: exact-match queries first (cheap), then a bounded
 * collection scan as fallback. All reads use the Admin SDK.
 *
 * Deliberately avoids composite indexes: the upcoming-appointments query is
 * a single equality on clientId with status/time filtering in memory (a
 * single client's appointment history is small) — no repeat of the
 * ClientStatsBar index requirement.
 *
 * Request:  { "tenantId": "...", "phone": "+13365551234" }
 *
 * Response (match):
 * {
 *   "found": true,
 *   "blocked": false,
 *   "clientId": "abc123",
 *   "firstName": "Dana",
 *   "fullName": "Dana Smith",
 *   "upcomingAppointments": [{
 *      "appointmentId": "...",
 *      "spoken": "Gel manicure with Jessica on Tuesday, July 7 at 2:30 PM",
 *      "date": "2026-07-07",
 *      "readiness": "ready" | "needs_attention",
 *      "needs": ["forms", "deposit"]
 *   }],
 *   "hasOutstandingBalance": true,
 *   "outstandingBalanceSpoken": "There's an outstanding balance of $15 on the account" | null,
 *   "lastServiceName": "Gel Full Set" | null
 * }
 *
 * Response (no match): { "found": false }
 *
 * NOTE for the agent prompt: if blocked === true, the agent must not offer to
 * book — take a message (create-callback-draft) and let staff handle it.
 * checkInTokens are intentionally never returned over this channel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  verifyVoiceSecret,
  normalizePhone,
  speakDateTime,
} from '@/lib/voice/voice-utils';
import { loadTenantContext } from '@/lib/voice/server-availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLIENT_SCAN_CAP = 3000; // fallback scan bound; salon tenants are well under this
const FORM_SIGNATURE_VALIDITY_MONTHS = 18; // matches QuickBookForm's expiry rule

const monthsBetween = (a: Date, b: Date): number =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

async function findClientByPhone(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  rawPhone: string,
): Promise<any | null> {
  const clientsRef = db.collection(`tenants/${tenantId}/clients`);
  const last10 = normalizePhone(rawPhone);
  if (!last10) return null;

  // 1. Exact match on the E.164 string the platform sent (PhoneInput writes
  //    E.164, so most records created through QuickBookForm match here).
  const exact = await clientsRef.where('phone', '==', rawPhone).limit(1).get();
  if (!exact.empty) return { id: exact.docs[0].id, ...(exact.docs[0].data() as any) };

  // 2. Exact match on canonical +1 form (covers callers whose ID arrived
  //    without country code or with formatting).
  if (last10.length === 10) {
    const canonical = await clientsRef
      .where('phone', '==', `+1${last10}`)
      .limit(1)
      .get();
    if (!canonical.empty) {
      return { id: canonical.docs[0].id, ...(canonical.docs[0].data() as any) };
    }
  }

  // 3. Bounded scan comparing normalized digits — catches '(336) 555-1234'
  //    style records that predate the E.164 input.
  const all = await clientsRef.limit(CLIENT_SCAN_CAP).get();
  for (const doc of all.docs) {
    const data = doc.data() as any;
    if (normalizePhone(data.phone) === last10) return { id: doc.id, ...data };
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ found: false, error: 'invalid_json' });
  }

  const tenantId: string = body?.tenantId;
  const phone: string = body?.phone;
  if (!tenantId || !phone) {
    return NextResponse.json({ found: false, error: 'missing_params' });
  }

  try {
    const db = getAdminDb();
    const [ctx, client] = await Promise.all([
      loadTenantContext(db, tenantId),
      findClientByPhone(db, tenantId, phone),
    ]);

    if (!client) return NextResponse.json({ found: false });

    const tz = ctx.timezone;
    const firstName = (client.name || '').split(' ')[0] || 'there';
    const blocked = client.status === 'blocked';

    // Upcoming appointments: single-equality query, filter/sort in memory.
    const aptsSnap = await db
      .collection(`tenants/${tenantId}/appointments`)
      .where('clientId', '==', client.id)
      .get();

    const now = Date.now();
    const upcoming = aptsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a) => {
        if (a.status === 'cancelled') return false;
        if (typeof a.startTime !== 'string') return false;
        const t = new Date(a.startTime).getTime();
        return !Number.isNaN(t) && t >= now;
      })
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      )
      .slice(0, 3);

    const nowDate = new Date();
    const upcomingAppointments = upcoming.map((a) => {
      const svc = ctx.services.find((s: any) => s.id === a.serviceId);
      const staffMember = ctx.staff.find((s: any) => s.id === a.staffId);
      const start = new Date(a.startTime);

      // Readiness — same rules the booking form applies: required forms with
      // an 18-month signature validity window, plus unpaid deposits.
      const needs: string[] = [];
      const requiredFormIds: string[] = svc?.requiredFormIds || [];
      const unsigned = requiredFormIds.some((fid) => {
        const sig = client.signedForms?.[fid];
        if (!sig?.signedAt) return true;
        const signedAt = new Date(sig.signedAt);
        if (Number.isNaN(signedAt.getTime())) return true;
        return monthsBetween(signedAt, nowDate) >= FORM_SIGNATURE_VALIDITY_MONTHS;
      });
      if (unsigned) needs.push('forms');
      if (a.depositStatus === 'pending') needs.push('deposit');

      const providerFirst = staffMember?.name?.split(' ')[0];
      return {
        appointmentId: a.id,
        spoken: `${svc?.name || 'an appointment'}${
          providerFirst ? ` with ${providerFirst}` : ''
        } on ${speakDateTime(start, tz)}`,
        date: a.startTime.slice(0, 10),
        readiness: needs.length > 0 ? 'needs_attention' : 'ready',
        needs,
      };
    });

    const balance = Number(client.outstandingBalance) || 0;
    const lastService = client.lastServiceId
      ? ctx.services.find((s: any) => s.id === client.lastServiceId)
      : null;

    return NextResponse.json({
      found: true,
      blocked,
      clientId: client.id,
      firstName,
      fullName: client.name || '',
      upcomingAppointments,
      hasOutstandingBalance: balance > 0,
      outstandingBalanceSpoken:
        balance > 0
          ? `There's an outstanding balance of $${balance.toFixed(2)} on the account`
          : null,
      lastServiceName: lastService?.name || null,
    });
  } catch (e) {
    console.error('[voice/lookup-client]', e);
    // "Not found" is safer for the agent than an error state — it proceeds
    // as a new-caller flow instead of telling the caller something broke.
    return NextResponse.json({ found: false, error: 'internal' });
  }
}
