// src/app/api/sms/inbound/route.ts
//
// TWO-WAY MESSAGING — the listener. Point the Twilio number's "A message
// comes in" webhook at POST {your-domain}/api/sms/inbound and every reply
// flows back into the system instead of dying in the Twilio console:
//
//   1. The sender is RECOGNIZED — matched by phone against maintenance
//      workers, renters, and contacts, so the owner sees "Reply from
//      Marcus (maintenance)" not "+18325550137".
//   2. If the sender is on an ACTIVE ticket (assignee, helper, or the
//      reporter), the reply lands on that ticket's THREAD — the same
//      one-job-one-record rule as everything else.
//   3. Every reply also lands in the owner's notification bell and in a
//      permanent smsInbox collection, so nothing is missable or lost.
//
// Multi-tenant routing: the To number is matched against each tenant's
// sms.fromNumber override; if none matches (the common single-number
// platform setup), the DEFAULT_SMS_TENANT_ID env var or the sole tenant
// wins. Security: Twilio's signature is verified when TWILIO_AUTH_TOKEN
// is set — forged posts are dropped with a 403.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';

const digits = (s: any) => String(s || '').replace(/\D+/g, '').replace(/^1(\d{10})$/, '$1');

function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true;           // SMS not configured — nothing to protect
  if (!signature) return false;
  try {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
    return expected === signature;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    // Twilio posts application/x-www-form-urlencoded
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });
    const url = `${(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(req.url).origin)}/api/sms/inbound`;
    if (!verifyTwilioSignature(url, params, req.headers.get('x-twilio-signature'))) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const from = String(params.From || '');
    const to = String(params.To || '');
    const body = String(params.Body || '').trim().slice(0, 1600);
    const mediaCount = Math.max(0, Number(params.NumMedia) || 0);
    if (!from || (!body && mediaCount === 0)) return twimlOk();

    const db = getAdminDb();

    // ── Which tenant does this number belong to? ─────────────────────
    const tenantsSnap = await db.collection('tenants').get();
    const toDigits = digits(to);
    let tenantId: string | null = null;
    for (const d of tenantsSnap.docs) {
      const num = (d.data() as any)?.sms?.fromNumber;
      if (num && digits(num) === toDigits) { tenantId = d.id; break; }
    }
    if (!tenantId) tenantId = process.env.DEFAULT_SMS_TENANT_ID || (tenantsSnap.size === 1 ? tenantsSnap.docs[0].id : null);
    if (!tenantId) return twimlOk();   // unroutable — logged nowhere is better than logged wrong

    // ── Who is texting us? ───────────────────────────────────────────
    const fromDigits = digits(from);
    let senderName = from;
    let senderType: 'tech' | 'renter' | 'contact' | 'unknown' = 'unknown';
    let senderWorkerId: string | null = null;
    try {
      const ws = await db.collection(`tenants/${tenantId}/maintenanceWorkers`).get();
      const w = ws.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).find((x: any) => digits(x.phone) === fromDigits);
      if (w) { senderName = w.name; senderType = 'tech'; senderWorkerId = w.id; }
    } catch { /* keep looking */ }
    if (senderType === 'unknown') {
      try {
        const rs = await db.collection(`tenants/${tenantId}/renters`).get();
        const r = rs.docs.map((d) => d.data() as any).find((x: any) => digits(x.phone) === fromDigits);
        if (r) { senderName = r.name || senderName; senderType = 'renter'; }
      } catch { /* keep looking */ }
    }
    if (senderType === 'unknown') {
      try {
        const cs = await db.collection(`tenants/${tenantId}/contacts`).get();
        const c = cs.docs.map((d) => d.data() as any).find((x: any) => digits(x.phone) === fromDigits);
        if (c) { senderName = c.name || senderName; senderType = 'contact'; }
      } catch { /* keep looking */ }
    }

    const nowIso = new Date().toISOString();
    const noteBody = `${body}${mediaCount > 0 ? `${body ? ' ' : ''}(${mediaCount} photo${mediaCount === 1 ? '' : 's'} sent by MMS — view in Twilio console until media forwarding is set up)` : ''}`;

    // ── Does this reply belong on an active ticket's thread? ─────────
    let threaded: string | null = null;
    try {
      const ts = await db.collection(`tenants/${tenantId}/tickets`).get();
      const active = ts.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((t: any) => ['open', 'in_progress'].includes(t.status))
        .filter((t: any) =>
          (senderWorkerId && (t.assigneeId === senderWorkerId || (t.helpers || []).some((h: any) => h.id === senderWorkerId)))
          || digits(t.reporter?.phone) === fromDigits)
        .sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
      if (active) {
        await db.doc(`tenants/${tenantId}/tickets/${active.id}`).set({
          updates: [...(active.updates || []), { at: nowIso, by: senderName, byType: senderType === 'tech' ? 'tech' : senderType === 'renter' ? 'renter' : 'system', note: `(SMS reply) ${noteBody}` }],
          updatedAt: nowIso,
        }, { merge: true });
        threaded = active.title;
      }
    } catch { /* the inbox record below still catches it */ }

    // ── Permanent inbox record + owner notification ──────────────────
    const iRef = db.collection(`tenants/${tenantId}/smsInbox`).doc();
    await iRef.set({
      id: iRef.id, tenantId, at: nowIso,
      from, fromName: senderName, senderType,
      body: body || null, mediaCount,
      threadedTicketTitle: threaded,
    });
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({
      id: nRef.id, type: 'sms', read: false, createdAt: nowIso, link: '/renters',
      message: `Text from ${senderName}${senderType !== 'unknown' ? ` (${senderType})` : ''}: "${(body || `${mediaCount} photo(s)`).slice(0, 140)}"${threaded ? ` — added to ticket "${threaded}"` : ''}`,
    });

    return twimlOk();
  } catch (err) {
    console.error('[sms/inbound] failed', err);
    return twimlOk();   // never make Twilio retry-spam a broken handler
  }
}

// Empty TwiML = "received, no auto-reply." Change this later to send an
// auto-acknowledgment if the studio wants one.
function twimlOk() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200, headers: { 'Content-Type': 'text/xml' },
  });
}
