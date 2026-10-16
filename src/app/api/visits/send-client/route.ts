// src/app/api/visits/send-client/route.ts — SEND A CLIENT ONE OF THEIR VISIT LINKS from the visit's "Send to client"
// sheet: aftercare, "how was your visit?", book their next visit, or their visit link. (Requests before a visit —
// forms, photos, card, deposit — go through api/notifications/send-completion-link.) Staff only. The link is built
// here from the visit, by text when there's a mobile number, by email otherwise, and logged on the visit so the
// "Afterwards" checklist shows it.
//
// POST { tenantId, appointmentId, kind: 'aftercare' | 'review' | 'rebook' | 'visit_link' | 'confirm' } → { ok, via?, reason? }
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/route-guard';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
import { sendNotification } from '@/lib/notify';
import { brandedEmailHtml } from '@/lib/email-template';
import { smsConfigured } from '@/lib/sms';
import { aftercarePath, feedbackPath } from '@/lib/visit-feedback';
import { confirmLink, needsConfirm, nudgeText } from '@/lib/confirm-ask';

export const dynamic = 'force-dynamic';
const KINDS = ['aftercare', 'review', 'rebook', 'visit_link', 'confirm'] as const;
type Kind = typeof KINDS[number];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80); const id = String(b.appointmentId || '').slice(0, 80); const kind = String(b.kind || '') as Kind;
  if (!tenantId || !id || !KINDS.includes(kind)) return NextResponse.json({ ok: false, reason: 'Missing details.' }, { status: 400 });
  const g = await requireRole(req, tenantId, 'staff'); if ((g as any).deny) return (g as any).deny;
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/appointments/${id}`); const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, reason: 'We could not find this visit.' }, { status: 404 });
  const a: any = snap.data() || {}; const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const studio = t.name || t.businessName || 'Your studio'; const base = linkOrigin(t, req.nextUrl.origin); const first = String(a.clientName || '').split(' ')[0] || 'there';
  if ((kind === 'visit_link' || kind === 'rebook' || kind === 'confirm') && !a.checkInToken) return NextResponse.json({ ok: false, reason: 'This visit has no client link yet.' }, { status: 409 });
  const link = kind === 'confirm' ? confirmLink(base, a.checkInToken) : kind === 'aftercare' ? `${base}${aftercarePath(tenantId, id)}` : kind === 'review' ? `${base}${feedbackPath(tenantId, id)}` : `${base}/check-in/${a.checkInToken}`;
  const words: Record<Kind, { title: string; line: string; cta: string; text: string }> = {
    aftercare: { title: `Your aftercare from ${studio}`, line: 'Here is how to look after it over the next few days, with a note from your provider.', cta: 'Read my aftercare', text: `Hi ${first}, here is your aftercare from ${studio}: ${link}` },
    review: { title: `How was your visit with ${studio}?`, line: 'We would love to hear how it went. It takes a few seconds.', cta: 'Tell us', text: `Hi ${first}, thank you for coming in. How was your visit with ${studio}? ${link}` },
    rebook: { title: `Book your next visit with ${studio}`, line: 'Whenever you are ready, you can book your next visit here.', cta: 'Book my next visit', text: `Hi ${first}, whenever you are ready, you can book your next visit with ${studio} here: ${link}` },
    confirm: { title: `Are you still able to make it?`, line: 'Please let us know you’re coming. It takes one tap.', cta: 'Confirm I’m coming', text: '' },
    visit_link: { title: `Your visit with ${studio}`, line: 'Here is the link for your visit: check in, let us know if you are running late, or make a change.', cta: 'Open my visit', text: `Hi ${first}, here is the link for your visit with ${studio}: ${link}` },
  };
  const w = words[kind];
  if (kind === 'confirm') {
    if (!needsConfirm(a)) return NextResponse.json({ ok: false, reason: 'They’ve already confirmed.' }, { status: 409 });
    const tz = t.timezone || t.timeZone || undefined; const at0 = new Date(a.startTime);
    const when = `on ${at0.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })} at ${at0.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`;
    w.text = nudgeText({ first, service: a.serviceName || 'appointment', when, studio, link, tenant: t });
  }
  let phone = String(a.clientPhone || '').trim(), email = String(a.clientEmail || '').trim();
  if ((!phone || !email) && a.clientId) { try { const c: any = (await db.doc(`tenants/${tenantId}/clients/${a.clientId}`).get()).data() || {}; phone = phone || String(c.phone || ''); email = email || String(c.email || ''); } catch { /* use what we have */ } }
  if (!email.includes('@')) email = '';
  if (!phone && !email) return NextResponse.json({ ok: false, reason: 'No phone or email on file for this client.' });
  const common = { tenantId, kind: kind === 'confirm' ? 'confirm_nudge' : `visit_${kind}`, appointmentId: id, clientId: a.clientId || null, clientName: a.clientName || null } as any;
  let via: 'sms' | 'email' | null = null;
  if (phone && smsConfigured()) { const r = await sendNotification(db, { ...common, channel: 'sms', to: phone, text: w.text }); if (r?.ok) via = 'sms'; }
  if (!via && email) { const r = await sendNotification(db, { ...common, channel: 'email', to: email, subject: w.title, html: brandedEmailHtml({ studioName: studio, title: w.title, bodyLines: [`Hi ${first},`, w.line, `Kind regards, ${studio}`], cta: { label: w.cta, url: link }, secondaryCta: null, footerNote: `Sent by ${studio}.` } as any) }); if (r?.ok) via = 'email'; }
  if (!via) return NextResponse.json({ ok: false, reason: 'It could not be sent. The message log has the details.' });
  const at = new Date().toISOString();
  const patch: any = { [`sent.${kind}`]: { at, via } };
  if (kind === 'confirm') { patch.confirmNudgedAt = at; if (!a.confirmAskedAt) patch.confirmAskedAt = at; }
  if (kind === 'aftercare' && !a.aftercareSentAt) patch.aftercareSentAt = at;
  if (kind === 'review' && !a.followUpSentAt) patch.followUpSentAt = at;
  await ref.update(patch).catch(() => ref.set({ sent: { [kind]: { at, via } } }, { merge: true }));
  return NextResponse.json({ ok: true, via });
}
