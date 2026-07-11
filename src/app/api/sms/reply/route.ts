/**
 * POST /api/sms/reply — v1
 *
 * Lets a staff member actually respond to an escalated SMS thread — sends
 * a real text from the tenant's own dedicated number (the same one their
 * clients already text), logged into the same thread the client's
 * original message landed in.
 *
 * Auth: staff Firebase ID token — this is a staff UI action, same pattern
 * as execute-cancel/execute-reschedule.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaff } from '@/lib/voice/staff-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { tenantId, threadId, message } = body;
  if (!tenantId || !threadId || !(message || '').trim()) {
    return NextResponse.json({ ok: false, error: 'missing_params' }, { status: 400 });
  }

  const auth = await verifyStaff(req, tenantId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    const threadRef = db.doc(`tenants/${tenantId}/smsThreads/${threadId}`);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      return NextResponse.json({ ok: false, error: 'thread_not_found' }, { status: 404 });
    }
    const thread = threadSnap.data() as any;

    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = tenantSnap.data() || {};
    const fromNumber = tenant.voiceAgent?.phoneNumber;
    if (!fromNumber) {
      return NextResponse.json({ ok: false, error: 'no_tenant_number_configured' }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const smsRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: thread.clientPhone, From: fromNumber, Body: message }),
    });
    if (!smsRes.ok) {
      return NextResponse.json({ ok: false, error: 'sms_send_failed' }, { status: 502 });
    }

    const now = new Date().toISOString();
    const msgRef = db.collection(`tenants/${tenantId}/smsThreads/${threadId}/messages`).doc();
    await msgRef.set({
      id: msgRef.id,
      direction: 'outbound',
      body: message,
      sentAt: now,
      sentBy: auth.uid,
      channel: 'sms',
    });
    await threadRef.set(
      { lastMessageAt: now, lastMessagePreview: message.slice(0, 140), status: 'handled' },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[sms/reply]', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
