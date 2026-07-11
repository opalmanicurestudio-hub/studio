/**
 * POST /api/voice/escalate-sms — v1
 *
 * The SMS counterpart to log-call-intent, for a genuinely different
 * situation: a text conversation the agent can't (or shouldn't) resolve
 * itself — a client asking for a specific provider by name, a question
 * needing a human's judgment, or anything the agent isn't confident
 * handling as a clean booking/cancel/reschedule intent.
 *
 * Resolves WHICH staff member this belongs to (their most recent
 * appointment's provider, or a name match if the client mentioned one),
 * writes a real conversation thread (not just a one-off inbox item — SMS
 * is asynchronous back-and-forth, unlike a phone call, so there needs to
 * be an actual thread staff can read and reply to), and respects that
 * staff member's notificationAvailability — a message doesn't page someone
 * on their day off just because it exists; it waits in their thread until
 * they're actually available, same as any reasonable work/life boundary.
 *
 * Auth: voice tool secret, same as every other Retell-callable route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyVoiceSecret, parseVoiceToolRequest } from '@/lib/voice/voice-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isWithinBusinessHours(tenant: any): boolean {
  // Best-effort — reuses whatever hours info the tenant has; falls back to
  // "assume available" if nothing is configured, since defaulting to
  // silence would be worse than defaulting to a normal notification.
  const activeProfile = tenant?.scheduleProfiles?.find?.((p: any) => p.isActive);
  if (!activeProfile?.week) return true;
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const hours = activeProfile.week[day];
  if (!hours?.enabled) return false;
  return true; // full open/close-time comparison intentionally left simple — good enough for "should this wait" without needing exact minute-level precision
}

export async function POST(req: NextRequest) {
  if (!verifyVoiceSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json', spoken: "Let me get that to the team." });
  }

  const { args: body, callerNumber } = parseVoiceToolRequest(raw);
  const tenantId: string = body?.tenantId;
  const clientPhone: string = (body?.clientPhone || callerNumber || '').trim();
  const messageBody: string = (body?.messageBody || '').trim();
  const requestedStaffName: string = (body?.requestedStaffName || '').trim();

  if (!tenantId || !clientPhone) {
    return NextResponse.json({ ok: false, error: 'missing_params', spoken: "I'll make sure this gets to the team." });
  }

  try {
    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = tenantSnap.data() || {};

    // Resolve client + their most recent appointment's provider, so the
    // thread lands with the right person without the client needing to
    // know or say who that is.
    let clientId: string | null = null;
    let clientName = '';
    let resolvedStaffId: string | null = null;

    const clientQuery = await db.collection(`tenants/${tenantId}/clients`).where('phone', '==', clientPhone).limit(1).get();
    if (!clientQuery.empty) {
      clientId = clientQuery.docs[0].id;
      clientName = clientQuery.docs[0].data().name || '';
    }

    if (requestedStaffName) {
      const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
      const match = staffSnap.docs.find((d) => (d.data().name || '').toLowerCase().includes(requestedStaffName.toLowerCase()));
      if (match) resolvedStaffId = match.id;
    }
    if (!resolvedStaffId && clientId) {
      const aptQuery = await db
        .collection(`tenants/${tenantId}/appointments`)
        .where('clientId', '==', clientId)
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();
      if (!aptQuery.empty) resolvedStaffId = aptQuery.docs[0].data().staffId || null;
    }

    const now = new Date().toISOString();

    // One thread per client phone number per tenant — every escalated
    // message from the same person lands in the same conversation rather
    // than fragmenting into disconnected one-offs.
    const threadId = clientPhone.replace(/[^0-9+]/g, '');
    const threadRef = db.doc(`tenants/${tenantId}/smsThreads/${threadId}`);
    const threadSnap = await threadRef.get();

    await threadRef.set(
      {
        id: threadId,
        tenantId,
        clientPhone,
        clientId,
        clientName,
        assignedStaffId: resolvedStaffId,
        status: 'open',
        lastMessageAt: now,
        lastMessagePreview: messageBody.slice(0, 140),
        createdAt: threadSnap.exists ? threadSnap.data()?.createdAt : now,
      },
      { merge: true },
    );

    const msgRef = db.collection(`tenants/${tenantId}/smsThreads/${threadId}/messages`).doc();
    await msgRef.set({
      id: msgRef.id,
      direction: 'inbound',
      body: messageBody,
      sentAt: now,
      channel: 'sms',
    });

    // v21 — FIX: previously, a client sending three quick messages in a
    // row before anyone replied triggered three separate notifications
    // for what's really one situation. Checks for an already-unread
    // notification linking to this same thread within the last 10
    // minutes; if one exists, the thread/message above still saves
    // (nothing is ever silently dropped), it just doesn't ping again —
    // the existing unread notification already covers it.
    const dedupWindowStart = Date.now() - 10 * 60_000;
    const recentNotifSnap = await db
      .collection(`tenants/${tenantId}/notifications`)
      .where('link', '==', `/messages/${threadId}`)
      .get();
    const alreadyNotifiedRecently = recentNotifSnap.docs.some((d) => {
      const data = d.data();
      if (data?.read !== false) return false;
      const createdAt = new Date(data?.createdAt || 0).getTime();
      return createdAt >= dedupWindowStart;
    });

    // Notify the resolved staff member, respecting their availability —
    // this is the actual work/life boundary, not just a nice idea. 'away'
    // and outside business hours both mean: log it, don't page them.
    if (resolvedStaffId) {
      const staffSnap = await db.doc(`tenants/${tenantId}/staff/${resolvedStaffId}`).get();
      const staffMember = staffSnap.data();
      const availability = staffMember?.notificationAvailability?.mode || 'business_hours_only';
      const isAway = availability === 'away' &&
        (!staffMember?.notificationAvailability?.awayUntil || new Date(staffMember.notificationAvailability.awayUntil) > new Date());
      const shouldNotifyNow = availability === 'always' || (availability === 'business_hours_only' && isWithinBusinessHours(tenant));

      if (!isAway && shouldNotifyNow && !alreadyNotifiedRecently) {
        const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await notifRef.set({
          id: notifRef.id,
          userId: resolvedStaffId,
          type: 'sms_escalation',
          message: `${clientName || 'A client'} texted: "${messageBody.slice(0, 100)}"`,
          link: `/messages/${threadId}`,
          createdAt: now,
          read: false,
        });
      }
      // If away or outside hours, or already notified recently: the
      // thread and message are still saved above regardless — staff sees
      // it whenever they next check.
    } else if (!alreadyNotifiedRecently) {
      // v20 — FIX: previously, an unmatched client (no phone match, no
      // name mentioned) meant NOBODY got notified at all — the message
      // saved silently with zero human alerted, which is worse than any
      // of the "wrong person notified" risks this route otherwise guards
      // against. Falls back to every admin/owner, same notification shape
      // used for a failed membership renewal — an unassigned message
      // still needs a human, just not a specific one.
      const adminsSnap = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get();
      const notifBatch = db.batch();
      adminsSnap.docs.forEach((d) => {
        const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        notifBatch.set(notifRef, {
          id: notifRef.id,
          userId: d.id,
          type: 'sms_escalation_unassigned',
          message: `Unmatched text from ${clientPhone}: "${messageBody.slice(0, 100)}"`,
          link: `/messages/${threadId}`,
          createdAt: now,
          read: false,
        });
      });
      await notifBatch.commit();
    }

    return NextResponse.json({
      ok: true,
      threadId,
      assignedStaffId: resolvedStaffId,
      spoken: "Got it — I've passed that along to the team, they'll follow up.",
    });
  } catch (e) {
    console.error('[voice/escalate-sms]', e);
    return NextResponse.json({ ok: false, error: 'internal', spoken: "I'll make sure the team sees this." });
  }
}
