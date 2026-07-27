// src/app/api/notify-test/route.ts
//
// NOTIFICATION SELF-TEST — one URL that answers "why didn't my email/text
// send?" with facts instead of guesses. Visit it in a browser:
//
//   /api/notify-test                          → config check only
//   /api/notify-test?to=you@gmail.com         → config check + real test email
//   /api/notify-test?phone=5551234567         → config check + real test text
//   /api/notify-test?to=...&phone=...         → both
//
// If CRON_SECRET is set in Vercel, add &key=THE_SECRET to the URL —
// otherwise anyone who finds the URL could make the studio send messages.
//
// The response is plain JSON showing: which env vars are present, the
// EXACT provider response for each send (Resend's error text, Twilio's
// error text), and plain-English hints for the common failure causes.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendNotification } from '@/lib/notify';
import { smsConfigured, sendTenantSms } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // Gate: when CRON_SECRET exists, require it. (Same secret the crons use.)
    const secret = process.env.CRON_SECRET;
    if (secret && url.searchParams.get('key') !== secret) {
      return NextResponse.json({
        ok: false,
        error: 'This test endpoint is locked. Add &key=YOUR_CRON_SECRET to the URL (the same value as the CRON_SECRET environment variable in Vercel).',
      }, { status: 401 });
    }

    const to = String(url.searchParams.get('to') || '').trim();
    const phone = String(url.searchParams.get('phone') || '').trim();

    // ── 1. Configuration facts ──
    const config = {
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      NOTIFY_FROM_EMAIL: process.env.NOTIFY_FROM_EMAIL || '(not set — using onboarding@resend.dev)',
      TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
      TWILIO_MESSAGING_SERVICE_SID: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
      TWILIO_FROM: process.env.TWILIO_FROM || '(not set)',
      smsConfigured: smsConfigured(),
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL || '(not set)',
    };

    // ── 2. Resolve the tenant (needed for branded sends + logs) ──
    const db = getAdminDb();
    let tenantId = String(url.searchParams.get('tenantId') || '').trim();
    if (!tenantId) {
      const ts = await db.collection('tenants').limit(2).get();
      if (ts.docs.length === 1) tenantId = ts.docs[0].id;
      else if (ts.docs.length > 1) {
        return NextResponse.json({
          ok: false, config,
          error: 'More than one tenant exists — add &tenantId=... to the URL.',
          tenants: ts.docs.map((d: any) => d.id),
        });
      } else {
        return NextResponse.json({ ok: false, config, error: 'No tenants found in the database.' });
      }
    }

    const hints: string[] = [];
    if (!config.RESEND_API_KEY) hints.push('Emails will NEVER send: RESEND_API_KEY is missing in Vercel → Settings → Environment Variables. Add it and redeploy.');
    if (!config.smsConfigured) hints.push('Texts will NEVER send: Twilio env vars are incomplete. Need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).');

    // ── 3. Real test sends, with the raw provider verdicts ──
    let emailResult: any = null;
    if (to && to.includes('@')) {
      const r = await sendNotification(db, {
        tenantId, channel: 'email', to,
        subject: 'ClarityFlow test — notifications are working',
        text: 'This is a test message from your notification self-test page. If you are reading this, email sending works.',
        kind: 'self_test',
      });
      emailResult = r;
      if (!r.ok && /verify a domain|testing emails|own email address|403/i.test(String(r.error || ''))) {
        hints.push(`Resend refused this address: until you verify a custom domain in Resend, it only delivers to the email you signed up with (your own). Test with that address, or verify a domain to email clients.`);
      }
      if (!r.ok && r.status === 'skipped_no_provider') hints.push('Email skipped: RESEND_API_KEY is not visible to this deployment — set it for the Production environment and redeploy.');
    }

    let smsResult: any = null;
    if (phone) {
      const r = await sendTenantSms(db, tenantId, phone, 'ClarityFlow test — if you got this, texting works.');
      smsResult = r;
      if (!r.ok && /30034|[Uu]nregistered/.test(String(r.error || ''))) {
        hints.push('Twilio accepted the text but carriers will block it: your A2P campaign is not approved yet (Error 30034). Nothing to fix in the app — wait for campaign approval.');
      }
      if (!r.ok && /21608|unverified/i.test(String(r.error || ''))) {
        hints.push('Twilio trial accounts can only text VERIFIED numbers: verify this phone in Twilio Console → Phone Numbers → Verified Caller IDs, or upgrade off trial.');
      }
    }

    if (!to && !phone) hints.push('Config check only. Add ?to=your@email.com and/or &phone=5551234567 to actually test sending.');

    return NextResponse.json({
      ok: true,
      tenantId,
      config,
      emailResult,
      smsResult,
      hints,
      note: 'Every attempt above is also written to the tenant messageLog (email) and private smsLog (text) — the same trails real bookings use.',
    });
  } catch (err: any) {
    console.error('[notify-test] failed', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
  }
}
