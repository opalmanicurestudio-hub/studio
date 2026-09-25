// src/app/api/campaigns/send/route.ts
//
// POST { tenantId, campaignId, mode }
//   preview    → who it would reach, who's skipped and why. Sends nothing.
//   send       → the next batch now (the page calls until `done`).
//   schedule   → { scheduledFor } — the hourly scheduler sends it then.
//   unschedule → back to a draft.
//   test       → { to } — one real [TEST] send to that address or number.
// The sending itself lives in src/lib/campaign-engine.ts, shared with the
// scheduler. Owner / manager only.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { personalise } from '@/lib/campaigns';
import { previewCampaign, sendCampaignBatch, senderFor, composeText, loadOffer, peopleOf } from '@/lib/campaign-engine';
import { fillTokens } from '@/lib/campaign-templates';
import { sendNotification, resolveFromAddress } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';
import { smsConfigured } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const campaignId = String(body.campaignId || '').trim();
  const mode = ['send', 'test', 'schedule', 'unschedule', 'automate', 'pause'].includes(body.mode) ? body.mode : 'preview';
  if (!tenantId || !campaignId) return NextResponse.json({ ok: false, error: 'tenantId and campaignId are required.' }, { status: 400 });

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only an owner or manager can send campaigns.' }, { status: 403 });

  const db = getAdminDb();
  const cRef = db.doc(`tenants/${tenantId}/campaigns/${campaignId}`);
  const c = ((await cRef.get()).data() as any) || null;
  if (!c) return NextResponse.json({ ok: false, error: 'Campaign not found — save it first.' }, { status: 404 });
  if (c.ownerRenterId) return NextResponse.json({ ok: false, error: 'That’s a renter’s campaign — it’s managed from their portal.' }, { status: 403 });
  if (c.type === 'sms' && !smsConfigured() && mode !== 'unschedule') return NextResponse.json({ ok: false, error: 'Texting is not set up yet — send it as an email, or add the SMS provider keys.' }, { status: 409 });

  if (mode === 'test') {
    // A real send to one address or number — and a plain answer about what
    // happened, because "I didn't get it" has five different causes.
    const raw = String(body.to || '').trim();
    const isSms = c.type === 'sms';
    const digits = raw.replace(/\D/g, '');
    const to = isSms ? (digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : raw) : raw;
    if (isSms && !/^\+\d{10,15}$/.test(to)) return NextResponse.json({ ok: false, error: 'This is a text campaign — enter a mobile number, not an email address.' }, { status: 400 });
    if (!isSms && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ ok: false, error: 'This is an email campaign — enter an email address.' }, { status: 400 });
    const from = resolveFromAddress();
    const sandboxFrom = /resend\.dev/i.test(from);
    const studio = (await senderFor(db, tenantId, c, req.nextUrl.origin)).name;
    const sample = { id: 'test', name: 'Test Client', first: 'Jane', email: to, phone: to };
    const who = await senderFor(db, tenantId, c, req.nextUrl.origin);
    const off = await loadOffer(db, tenantId, c);
    const text = composeText(c, sample, studio, off?.line || null, who.bookBase);
    const r: any = isSms
      ? await sendNotification(db, { tenantId, channel: 'sms', to, text: `[TEST] ${studio}: ${text}\nReply STOP to opt out.`, kind: 'campaign_test', recipientType: 'staff' } as any)
      : await sendNotification(db, { tenantId, channel: 'email', to, subject: `[TEST] ${fillTokens(c.subject || c.name || 'Campaign', { first: sample.first, business: studio, offer: off?.line || null, link: null })}`,
          html: brandedEmailHtml({ studioName: studio, title: fillTokens(c.subject || c.name || 'Campaign', { first: sample.first, business: studio, offer: off?.line || null, link: null }), bodyLines: text.split(/\n+/).filter(Boolean),
            ...(off?.code ? { bigCode: off.code } : {}), cta: { label: 'Book now', url: who.bookBase }, footerNote: 'Test send — only you received this.' } as any), kind: 'campaign_test', recipientType: 'staff' } as any);
    const err = String(r.error || '');
    let why: string | null = null;
    if (!r.ok) {
      if (r.status === 'skipped_no_provider') why = isSms ? 'Texting isn’t connected: the Twilio keys (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender) aren’t set in Vercel.' : 'Email isn’t connected: RESEND_API_KEY isn’t set in Vercel.';
      else if (/quiet hours/i.test(err)) why = 'Held back: your message settings pause texts during quiet hours. Try again in the daytime.';
      else if (/switched off/i.test(err)) why = 'Held back: this kind of message is switched off in Settings → Messages.';
      else if (/own email|testing emails|verify a domain|domain is not verified/i.test(err)) why = `The email service refused it: the sender (${from}) is Resend’s test address, which can only deliver to the Resend account owner. Verify your domain in Resend, then set NOTIFY_FROM_EMAIL in Vercel (e.g. "Your Business <hello@yourdomain.com>").`;
      else if (/21608|unverified|trial/i.test(err)) why = 'Twilio refused it: the account is on a trial, which can only text numbers you’ve verified in the Twilio console.';
      else if (/21610|unsubscribed|STOP/i.test(err)) why = 'That number has replied STOP to your texting number, so carriers block further texts to it.';
      else if (/30034|10DLC|unregistered/i.test(err)) why = 'Carriers blocked it: the texting number isn’t registered (A2P 10DLC) for this kind of message. Finish registration in the Twilio console.';
      else why = err || 'Not sent.';
    }
    return NextResponse.json({ ok: !!r.ok, error: r.ok ? null : why, to, status: r.status || null, providerId: r.providerId || null,
      notes: r.ok ? [
        isSms ? 'Twilio accepted it. It usually arrives within a minute.' : 'The email service accepted it. It usually arrives within a minute or two — check spam or promotions if not.',
        !isSms && sandboxFrom ? `Heads up: the sender is Resend’s test address (${from}). It only reaches the Resend account owner; real clients won’t get these until you verify your domain and set NOTIFY_FROM_EMAIL.` : '',
      ].filter(Boolean) : [] });
  }

  // ── Automations: turn a campaign into one that repeats on its own ──
  if (mode === 'automate') {
    const trigger = body.trigger === 'birthday' ? 'birthday' : body.trigger === 'first_visit_followup' ? 'first_visit_followup' : null;
    if (!trigger) return NextResponse.json({ ok: false, error: 'Pick when it should go out.' }, { status: 400 });
    const daysAfter = Math.max(1, Math.min(90, Math.round(Number(body.daysAfter) || 7)));
    await cRef.set({ status: 'automation', automation: { trigger, daysAfter, active: true, startedAt: new Date().toISOString(), startedBy: auth.actor.name || auth.actor.uid } }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (mode === 'pause') {
    if (c.status !== 'automation') return NextResponse.json({ ok: false, error: 'It isn’t an automation.' }, { status: 400 });
    const active = body.active === true;
    await cRef.set({ automation: { ...(c.automation || {}), active } }, { merge: true });
    return NextResponse.json({ ok: true, active });
  }

  if (mode === 'unschedule') {
    if (c.status !== 'scheduled') return NextResponse.json({ ok: false, error: 'It isn’t scheduled.' }, { status: 400 });
    await cRef.set({ status: 'draft', scheduledFor: null, scheduledBy: null }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  const pv = await previewCampaign(db, tenantId, c, req.nextUrl.origin);
  const costPerSegment = Number(pv.who.tenant?.smsCostCentsPerSegment) || 1.3;

  if (mode === 'schedule') {
    const at = new Date(String(body.scheduledFor || ''));
    if (isNaN(at.getTime()) || at.getTime() < Date.now() + 5 * 60000) return NextResponse.json({ ok: false, error: 'Pick a time at least a few minutes from now.' }, { status: 400 });
    if (at.getTime() > Date.now() + 180 * 86400000) return NextResponse.json({ ok: false, error: 'Pick a time within the next six months.' }, { status: 400 });
    await cRef.set({ status: 'scheduled', scheduledFor: at.toISOString(), scheduledBy: auth.actor.name || auth.actor.uid }, { merge: true });
    return NextResponse.json({ ok: true, summary: pv.summary, scheduledFor: at.toISOString() });
  }

  if (mode === 'preview') {
    return NextResponse.json({ ok: true, summary: pv.summary, sample: pv.aud.members.slice(0, 8).map((m) => m.first), offer: pv.offer?.line || null, abTest: !!c.subjectB, segments: pv.segments,
      estCostCents: c.type === 'sms' ? Math.round(pv.segments * pv.summary.willReceive * costPerSegment) : 0,
      sampleText: pv.sampleText, sampleSubject: pv.sampleSubject, senderName: pv.who.name, ...peopleOf(pv.aud, pv.channel) });
  }

  const r = await sendCampaignBatch(db, tenantId, campaignId, { actorName: auth.actor.name || auth.actor.uid, fallbackOrigin: req.nextUrl.origin });
  if (!r.ok) return NextResponse.json(r, { status: (r as any).quietHours ? 409 : 400 });
  return NextResponse.json(r);
}
