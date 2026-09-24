// src/app/api/campaigns/send/route.ts
//
// POST { tenantId, campaignId, mode: 'preview' | 'send' }
//   preview → who would receive it, and who's skipped and why. Sends nothing.
//   send    → sends the next batch (up to 60) and returns progress. The page
//             calls again until `done`. Each recipient is recorded before the
//             next batch, so re-running never double-sends.
// Owner / manager only — a signed-in staff token is required.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { resolveAudience, personalise, unsubSig, type Audience } from '@/lib/campaigns';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';
import { smsConfigured } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const BATCH = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const campaignId = String(body.campaignId || '').trim();
  const mode = body.mode === 'send' ? 'send' : body.mode === 'test' ? 'test' : 'preview';
  if (!tenantId || !campaignId) return NextResponse.json({ ok: false, error: 'tenantId and campaignId are required.' }, { status: 400 });

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only an owner or manager can send campaigns.' }, { status: 403 });

  const db = getAdminDb();
  const cRef = db.doc(`tenants/${tenantId}/campaigns/${campaignId}`);
  const c = ((await cRef.get()).data() as any) || null;
  if (!c) return NextResponse.json({ ok: false, error: 'Campaign not found — save it first.' }, { status: 404 });
  const channel: 'email' | 'sms' = c.type === 'sms' ? 'sms' : 'email';
  if (channel === 'sms' && !smsConfigured()) return NextResponse.json({ ok: false, error: 'Texting is not set up for this studio yet — send it as an email, or add the SMS provider keys.' }, { status: 409 });

  const aud = await resolveAudience(db, tenantId, c.targetAudience as Audience, channel, Array.isArray(c.targetClientIds) ? c.targetClientIds : []);
  const summary = { matched: aud.matched, willReceive: aud.members.length, skippedNoConsent: aud.skippedNoConsent, skippedNoContact: aud.skippedNoContact, skippedUnsubscribed: aud.skippedUnsubscribed, skippedMonthlyCap: aud.skippedMonthlyCap };

  // ── What goes IN the message, beyond the text ─────────────────────────
  // Every field on the form now does something: the incentive is written
  // into the message (code in big type in emails), the image heads the
  // email, subject B goes to half the list, and every email has a Book
  // button that says which campaign it came from.
  let offer: { code: string; line: string } | null = null;
  if (c.discountId) {
    try {
      const dz = ((await db.doc(`tenants/${tenantId}/discounts/${String(c.discountId)}`).get()).data() as any) || null;
      if (dz && dz.isActive !== false && dz.code) {
        const amt = dz.type === 'percentage' ? `${Number(dz.value) || 0}% off` : `$${(Number(dz.value) || 0).toFixed(0)} off`;
        const until = dz.validUntil ? ` — until ${new Date(dz.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
        offer = { code: String(dz.code), line: `${amt} with code ${dz.code}${until}` };
      }
    } catch { /* no offer */ }
  }
  const variantOf = (clientId: string): 'A' | 'B' => {
    if (!c.subjectB) return 'A';
    let h = 0; for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) >>>0;
    return h % 2 === 0 ? 'A' : 'B';
  };

  if (mode === 'test') {
    // A real send, to the address given — marked [TEST], recorded nowhere.
    const to = String(body.to || '').trim();
    const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const studio = String(t.name || 'the studio');
    const sample = { id: 'test', name: 'Test Client', first: 'Jane', email: to, phone: to };
    const text = personalise(c.body, sample);
    const r = channel === 'sms'
      ? await sendNotification(db, { tenantId, channel: 'sms', to, text: `[TEST] ${studio}: ${text}`, kind: 'campaign_test', recipientType: 'staff' } as any)
      : await sendNotification(db, { tenantId, channel: 'email', to, subject: `[TEST] ${personalise(c.subject || c.name || 'Campaign', sample)}`,
          html: brandedEmailHtml({ studioName: studio, title: personalise(c.subject || c.name || 'Campaign', sample), bodyLines: text.split(/\n+/).filter(Boolean), footerNote: 'Test send — only you received this.' }), kind: 'campaign_test', recipientType: 'staff' } as any);
    return NextResponse.json({ ok: !!r.ok, error: r.ok ? null : String((r as any).error || (r as any).status || 'not sent') });
  }

  if (mode === 'preview') {
    const smsChars = channel === 'sms' ? (`${c.body || ''}${offer ? ` ${offer.line}` : ''}`.length + 40) : 0; // + studio prefix & STOP line
    const segments = channel === 'sms' ? Math.max(1, Math.ceil(smsChars / 153)) : 0;
    return NextResponse.json({ ok: true, summary, sample: aud.members.slice(0, 8).map((m) => m.first), offer: offer?.line || null, abTest: !!c.subjectB, segments });
  }

  // Who already has it (resume-safe).
  const doneSnap = await cRef.collection('recipients').get();
  const already = new Set(doneSnap.docs.map((d: any) => d.id));
  const todo = aud.members.filter((m) => !already.has(m.id));
  const batch = todo.slice(0, BATCH);

  const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const studio = String(t.name || 'the studio');
  const origin = String(t.publicOrigin || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : req.nextUrl.origin)).replace(/\/+$/, '');
  const nowIso = new Date().toISOString();
  if (!c.sendStartedAt) await cRef.set({ status: 'sending', sendStartedAt: nowIso, sentBy: auth.actor.name || auth.actor.uid }, { merge: true });

  let sent = 0, failed = 0;
  for (const m of batch) {
    const text = personalise(c.body, m) + (offer && channel === 'sms' ? ` ${offer.line}.` : '');
    const variant = variantOf(m.id);
    let ok = false; let err: string | null = null;
    try {
      if (channel === 'sms') {
        const r = await sendNotification(db, { tenantId, channel: 'sms', to: m.phone!, text: `${studio}: ${text}\nReply STOP to opt out.`, kind: 'campaign', clientId: m.id, clientName: m.name, recipientType: 'client' } as any);
        ok = !!r.ok; if (!ok) err = String((r as any).error || (r as any).status || 'not sent');
      } else {
        const unsub = `${origin}/api/campaigns/unsubscribe?t=${encodeURIComponent(tenantId)}&c=${encodeURIComponent(m.id)}&s=${await unsubSig(tenantId, m.id)}`;
        const subject = personalise((variant === 'B' ? c.subjectB : c.subject) || c.name || `News from ${studio}`, m);
        const bookUrl = `${origin}/book/${encodeURIComponent(tenantId)}?c=${encodeURIComponent(campaignId)}`;
        const esc = (x: string) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch]);
        const imgHtml = c.imageUrl && /^https:\/\//.test(String(c.imageUrl)) ? `<img src="${esc(c.imageUrl)}" alt="" style="display:block;width:100%;max-width:560px;border-radius:12px;margin:0 0 16px" />` : '';
        const r = await sendNotification(db, { tenantId, channel: 'email', to: m.email!, subject,
          html: brandedEmailHtml({ studioName: studio, title: subject, bodyLines: [...text.split(/\n+/).filter(Boolean), ...(offer ? [offer.line] : [])],
            ...(imgHtml ? { bodyHtml: imgHtml } : {}), ...(offer ? { bigCode: offer.code } : {}),
            cta: { label: 'Book now', url: bookUrl },
            footerNote: `You're receiving this as a client of ${studio}. Unsubscribe: ${unsub}` } as any),
          kind: 'campaign', clientId: m.id, clientName: m.name, recipientType: 'client' } as any);
        ok = !!r.ok; if (!ok) err = String((r as any).error || (r as any).status || 'not sent');
      }
    } catch (e: any) { err = String(e?.message || e).slice(0, 160); }
    await cRef.collection('recipients').doc(m.id).set({ clientId: m.id, name: m.name, channel, variant: channel === 'email' ? variant : null, status: ok ? 'sent' : 'failed', error: err, at: new Date().toISOString(), converted: false });
    if (ok) await db.doc(`tenants/${tenantId}/campaignSends/${campaignId}_${m.id}`).set({ campaignId, clientId: m.id, channel, variant: channel === 'email' ? variant : null, at: new Date().toISOString(), converted: false });
    if (ok) sent++; else failed++;
  }

  const remaining = Math.max(0, todo.length - batch.length);
  const allSnap = await cRef.collection('recipients').get();
  const totals = allSnap.docs.reduce((acc: any, d: any) => { const x = d.data() as any; acc[x.status === 'sent' ? 'sent' : 'failed']++; return acc; }, { sent: 0, failed: 0 });
  await cRef.set({ recipientCount: totals.sent, failedCount: totals.failed, ...(remaining === 0 ? { status: 'sent', sentAt: nowIso } : {}) }, { merge: true });
  return NextResponse.json({ ok: true, summary, batch: { sent, failed }, totals, remaining, done: remaining === 0 });
}
