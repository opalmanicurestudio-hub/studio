// src/app/api/sms/status/route.ts
//
// v16 — TEXT JOURNEY TRACKING. Twilio posts here as each text moves
// through queued → sent → delivered (or undelivered/failed, with an error
// code). We stamp the messageLog entry the send created, so the
// appointment Activity Timeline shows "Text delivered" — or "Text failed:
// 30034 (number not registered yet)" — instead of a shrug.
//
// No dashboard setup needed: sendSms() passes this URL as the
// StatusCallback on every outbound message automatically (it uses
// VERCEL_PROJECT_PRODUCTION_URL, so it starts working once deployed).
//
// Security: verified with Twilio's X-Twilio-Signature (HMAC-SHA1 of the
// exact URL + sorted POST params, keyed by the auth token) — same scheme
// as the inbound SMS webhook.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function verifyTwilio(req: NextRequest, url: string, params: Record<string, string>): boolean | null {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return null;
  try {
    const header = req.headers.get('x-twilio-signature') || '';
    if (!header) return false;
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
    } catch { return false; }
  } catch { return false; }
}

// Human translations for the Twilio error codes an owner will actually see.
const ERROR_HINTS: Record<string, string> = {
  '30034': 'Number not A2P-registered yet — texts unblock when the campaign is approved.',
  '30003': 'Phone unreachable or switched off.',
  '30005': 'Unknown or inactive number — check for a typo.',
  '30006': 'Landline or unreachable carrier — this number cannot receive texts.',
  '30007': 'Filtered by the carrier as spam.',
  '21211': 'Invalid phone number — check for a typo.',
  '21608': 'Twilio trial: recipient must be a verified number until you upgrade.',
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });

    const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : req.nextUrl.origin;
    const verified = verifyTwilio(req, `${base}/api/sms/status`, params);
    if (verified === false) return new NextResponse('Forbidden', { status: 403 });

    const sid = params.MessageSid || params.SmsSid || '';
    const status = (params.MessageStatus || params.SmsStatus || '').toLowerCase();
    if (!sid || !status) return new NextResponse('OK');

    const db = getAdminDb();
    const idxSnap = await db.doc(`msgIndex/${sid}`).get();
    if (!idxSnap.exists) return new NextResponse('OK'); // not one we track
    const { tenantId, logId } = idxSnap.data() as any;
    if (!tenantId || !logId) return new NextResponse('OK');

    const at = new Date().toISOString();
    const patch: any = { smsStatus: status, lastEventAt: at };
    if (status === 'delivered') patch.deliveredAt = at;
    if (status === 'undelivered' || status === 'failed') {
      patch.bouncedAt = at;
      const code = params.ErrorCode || '';
      patch.failureDetail = code
        ? `Error ${code}: ${ERROR_HINTS[code] || 'carrier rejected the message.'}`
        : 'Carrier could not deliver this text.';
    }
    await db.doc(`tenants/${tenantId}/messageLog/${logId}`).set(patch, { merge: true });

    // Failed text = bell, same as a bounced email.
    if (status === 'undelivered' || status === 'failed') {
      try {
        const log = ((await db.doc(`tenants/${tenantId}/messageLog/${logId}`).get()).data() as any) || {};
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await nRef.set({
          id: nRef.id, type: 'message', read: false, createdAt: at,
          link: '/planner',
          message: `Text to ${log.clientName || log.to || 'a client'} was NOT delivered (${log.kind || 'message'}) — ${patch.failureDetail}`,
        });
      } catch { /* bell is a bonus */ }
    }

    return new NextResponse('OK');
  } catch (err) {
    console.error('[sms/status] failed', err);
    return new NextResponse('OK'); // don't make Twilio retry forever
  }
}
