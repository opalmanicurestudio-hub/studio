// src/app/api/webhooks/resend/route.ts
//
// v16 — EMAIL JOURNEY TRACKING. Resend calls this endpoint every time one
// of our emails changes state: delivered, opened, clicked (a link/button),
// bounced, complained, delayed. We stamp those moments onto the SAME
// messageLog entry the send created, so the appointment Activity Timeline
// can show the full story: Sent → Delivered → Opened → Clicked — or
// "Bounced: mailbox does not exist", which is how the owner spots a typo
// in seconds and fixes-and-resends.
//
// SETUP (one time, in the Resend dashboard):
//   1. Webhooks → Add endpoint → https://YOUR-DOMAIN/api/webhooks/resend
//      (select all email.* events)
//   2. Copy the signing secret (whsec_...) → add to Vercel as
//      RESEND_WEBHOOK_SECRET → redeploy.
//   3. Opens/clicks also need tracking enabled on your sending domain:
//      Resend → Domains → your domain → turn on open + click tracking.
//
// Security: requests are verified with the svix signature scheme Resend
// uses (HMAC-SHA256 over `id.timestamp.body`). If RESEND_WEBHOOK_SECRET
// isn't set yet, events are accepted but flagged unverified in the log —
// set the secret to close that gap.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function verifySvix(req: NextRequest, rawBody: string): boolean | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return null; // no secret configured — can't verify
  try {
    const id = req.headers.get('svix-id') || '';
    const timestamp = req.headers.get('svix-timestamp') || '';
    const sigHeader = req.headers.get('svix-signature') || '';
    if (!id || !timestamp || !sigHeader) return false;
    // Replay guard: reject events older than 5 minutes.
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = crypto.createHmac('sha256', secretBytes)
      .update(`${id}.${timestamp}.${rawBody}`).digest('base64');
    // Header may carry several space-separated "v1,signature" entries.
    return sigHeader.split(' ').some((part) => {
      const sig = part.includes(',') ? part.split(',')[1] : part;
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch { return false; }
    });
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const verified = verifySvix(req, rawBody);
    if (verified === false) return NextResponse.json({ ok: false }, { status: 401 });

    const evt = JSON.parse(rawBody || '{}');
    const type = String(evt?.type || '');
    const emailId = String(evt?.data?.email_id || evt?.data?.id || '');
    if (!type.startsWith('email.') || !emailId) return NextResponse.json({ ok: true, ignored: true });

    const db = getAdminDb();
    const idxSnap = await db.doc(`msgIndex/${emailId}`).get();
    if (!idxSnap.exists) return NextResponse.json({ ok: true, unmatched: true });
    const { tenantId, logId } = idxSnap.data() as any;
    if (!tenantId || !logId) return NextResponse.json({ ok: true, unmatched: true });

    const at = evt?.created_at || new Date().toISOString();
    const patch: any = { lastEventAt: at, ...(verified === null ? { unverifiedEvents: true } : {}) };

    if (type === 'email.delivered') patch.deliveredAt = at;
    if (type === 'email.opened') {
      patch.openedAt = at;          // latest open — "they saw it"
      patch.opened = true;
    }
    if (type === 'email.clicked') {
      patch.clickedAt = at;
      patch.clicked = true;
      if (evt?.data?.click?.link) patch.clickedUrl = String(evt.data.click.link).slice(0, 300);
    }
    if (type === 'email.bounced') {
      patch.bouncedAt = at;
      patch.failureDetail = String(evt?.data?.bounce?.message || evt?.data?.bounce?.subType || 'Bounced — address may be wrong').slice(0, 300);
    }
    if (type === 'email.failed') {
      // Failed = Resend couldn't send it at all (vs. bounced = the
      // receiving server rejected it). Same red treatment either way.
      patch.bouncedAt = at;
      patch.failureDetail = String(evt?.data?.failed?.reason || evt?.data?.reason || 'Send failed at the provider').slice(0, 300);
    }
    if (type === 'email.complained') {
      patch.complainedAt = at;
      patch.failureDetail = 'Recipient marked the email as spam.';
    }
    if (type === 'email.delivery_delayed') patch.delayedAt = at;

    await db.doc(`tenants/${tenantId}/messageLog/${logId}`).set(patch, { merge: true });

    // A bounce/failure is worth a bell — the owner should fix the address
    // NOW, while the client is still expecting their confirmation.
    if (type === 'email.bounced' || type === 'email.complained' || type === 'email.failed') {
      try {
        const log = ((await db.doc(`tenants/${tenantId}/messageLog/${logId}`).get()).data() as any) || {};
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        await nRef.set({
          id: nRef.id, type: 'message', read: false, createdAt: new Date().toISOString(),
          link: '/planner',
          message: `Email to ${log.clientName || log.to || 'a client'} ${type === 'email.complained' ? 'was marked spam' : type === 'email.failed' ? 'FAILED to send' : 'BOUNCED'} (${log.kind || 'message'}) — check the address and resend from the appointment.`,
        });
      } catch { /* bell is a bonus */ }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[webhooks/resend] failed', err);
    // 200 so Resend doesn't retry forever on a malformed event.
    return NextResponse.json({ ok: false });
  }
}
