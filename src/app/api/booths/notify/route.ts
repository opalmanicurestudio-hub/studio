/**
 * /api/booths/notify — the rental funnel's outbound mail
 *
 * Four moments in the lease funnel had no message attached to them: a
 * prospect submitting an application, the owner needing to know it arrived,
 * the owner offering tour times, and the owner's decision on a tour that was
 * only requested. This route is where those sends live.
 *
 * Admin SDK, because none of these callers can be trusted with the owner's
 * address and because a public page cannot write the notification log. Every
 * send goes through sendNotification(), so each one is:
 *   • governed by the shop's message policy (a kind can be switched off, or
 *     its wording replaced, in message settings),
 *   • held back inside quiet hours if it is ever routed to SMS,
 *   • written to tenants/{t}/notificationLog with its status, and
 *   • tracked to delivered / opened / clicked / bounced by the Resend webhook
 *     via msgIndex.
 *
 * POST { action: 'tour-invite',           tenantId, inviteId }
 * POST { action: 'tour-invite-answered',  tenantId, inviteId }
 * POST { action: 'tour-decision',         tenantId, tourId, decision }
 * POST { action: 'application-received',  tenantId, applicationId }
 */

import { NextRequest, NextResponse } from 'next/server';
import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';
import { getAdminDb } from '@/lib/firebase-admin';

const firstNameOf = (full: any) => String(full || '').trim().split(' ')[0] || 'there';

const whenLabel = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const { action, tenantId } = body || {};
  if (!action || !tenantId) {
    return NextResponse.json({ ok: false, error: 'Missing action or tenant.' }, { status: 400 });
  }

  const db = getAdminDb();
  const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const studioName = tenant.name || tenant.businessName || 'The studio';
  const ownerEmail = String(tenant.notificationEmail || tenant.email || tenant.contactEmail || '').trim();
  const origin = req.nextUrl?.origin || '';

  try {
    /* ── The tour invitation ────────────────────────────────────────────────
     * The prospect gets the link they are meant to act on. Sent under the
     * studio's name to the address they gave us, so it needs no separate
     * opt-in: they asked us about a space and this is our answer. */
    if (action === 'tour-invite') {
      const { inviteId } = body;
      const invSnap = await db.doc(`tenants/${tenantId}/tourInvites/${inviteId}`).get();
      if (!invSnap.exists) {
        return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 });
      }
      const inv = invSnap.data() as any;

      let to = String(inv.email || '').trim();
      if (!to && inv.applicationId) {
        const appSnap = await db.doc(`tenants/${tenantId}/boothApplications/${inv.applicationId}`).get();
        to = String((appSnap.data() as any)?.email || '').trim();
      }
      if (!to.includes('@')) {
        return NextResponse.json({ ok: false, error: 'No email on file for this lead.' }, { status: 422 });
      }

      const link = `${origin}/tour-invite/${tenantId}/${inviteId}`;
      const slots: string[] = Array.isArray(inv.slots) ? inv.slots : [];
      const html = brandedEmailHtml({
        studioName,
        title: 'Come and see the space',
        bodyLines: [
          `Hi ${firstNameOf(inv.firstName)} — we'd love to show you around${inv.spaceName ? ` ${inv.spaceName}` : ''}.`,
          slots.length
            ? `Times we have open: ${slots.map(whenLabel).join(' · ')}.`
            : 'Tell us when you are free and we will make it work.',
          'Pick whichever suits you, or send back times that work better for you.',
        ],
        cta: { label: 'Choose a time', url: link },
        footerNote: `Sent by ${studioName}. You're receiving this because you enquired about a space with us.`,
      });

      const result = await sendNotification(db, {
        tenantId, channel: 'email', to,
        subject: `Pick a time to visit${inv.spaceName ? ` — ${inv.spaceName}` : ''}`,
        html, kind: 'tour_invite',
        recipientType: 'contact',
        recipientId: inv.applicationId || inviteId,
        recipientName: inv.firstName || null,
        tokens: {
          client_first: firstNameOf(inv.firstName),
          space: inv.spaceName || 'the space',
          when: slots.map(whenLabel).join(' · '),
          link, studio: studioName,
        },
      });

      await db.doc(`tenants/${tenantId}/tourInvites/${inviteId}`).set({
        sentAt: new Date().toISOString(),
        sentTo: to,
        sendStatus: result.status,
      }, { merge: true });

      return NextResponse.json({ ok: result.ok, status: result.status, error: result.error || null });
    }

    /* ── An application landed ──────────────────────────────────────────────
     * Two messages, deliberately separate kinds so either can be switched off
     * alone: the owner's alert (this is the one that was missing entirely —
     * applications only ever raised an in-app notification, which is no use
     * when you are not looking at the app) and the prospect's acknowledgement
     * so they know it arrived and what happens next. */
    if (action === 'application-received') {
      const { applicationId } = body;
      const appSnap = await db.doc(`tenants/${tenantId}/boothApplications/${applicationId}`).get();
      if (!appSnap.exists) {
        return NextResponse.json({ ok: false, error: 'Application not found.' }, { status: 404 });
      }
      const app = appSnap.data() as any;
      const kindLabel = app.kind === 'tour' ? 'Tour request'
        : app.kind === 'waitlist' ? 'Waitlist signup'
        : app.kind === 'question' ? 'Question'
        : 'Rental application';
      const out: any = {};

      if (ownerEmail.includes('@')) {
        const ownerHtml = brandedEmailHtml({
          studioName,
          title: `${kindLabel}: ${app.name || 'Someone'}`,
          bodyLines: [
            `${app.name || 'Someone'} just came through your booking page${app.boothName ? ` about ${app.boothName}` : ''}.`,
            [app.phone, app.email].filter(Boolean).join(' · ') || 'They left no contact details.',
            app.message ? `“${String(app.message).slice(0, 400)}”` : 'They left no message.',
          ],
          cta: { label: 'Open the pipeline', url: `${origin}/pipeline` },
          footerNote: `Sent to you because you own ${studioName}.`,
        });
        const r = await sendNotification(db, {
          tenantId, channel: 'email', to: ownerEmail,
          subject: `${kindLabel} — ${app.name || 'new lead'}`,
          html: ownerHtml, kind: 'booth_application_owner',
          recipientType: 'other', recipientId: applicationId, recipientName: 'Owner',
          tokens: { client_first: app.name || 'Someone', space: app.boothName || 'a space', link: `${origin}/pipeline` },
        });
        out.owner = r.status;
      } else {
        out.owner = 'skipped_no_owner_email';
      }

      const prospectEmail = String(app.email || '').trim();
      if (prospectEmail.includes('@')) {
        const html = brandedEmailHtml({
          studioName,
          title: 'We have your enquiry',
          bodyLines: [
            `Hi ${firstNameOf(app.name)} — thanks for getting in touch${app.boothName ? ` about ${app.boothName}` : ''}.`,
            'A real person is reading this, not a robot. We will come back to you with next steps, usually within a day or two.',
            'If anything changes in the meantime, just reply to this email.',
          ],
          footerNote: `Sent by ${studioName}. You're receiving this because you contacted us about a space.`,
        });
        const r = await sendNotification(db, {
          tenantId, channel: 'email', to: prospectEmail,
          subject: `Thanks — we have your ${kindLabel.toLowerCase()}`,
          html, kind: 'booth_application_ack',
          recipientType: 'contact', recipientId: applicationId, recipientName: app.name || null,
          tokens: { client_first: firstNameOf(app.name), space: app.boothName || 'the space', studio: studioName },
        });
        out.prospect = r.status;
      } else {
        out.prospect = 'skipped_no_email';
      }

      return NextResponse.json({ ok: true, ...out });
    }

    /* ── They answered the invitation ───────────────────────────────────────
     * The owner is the one who has to act next — confirm the pick, or offer
     * new times against what they countered with. Without this the answer sits
     * in the pipeline until someone happens to look. */
    if (action === 'tour-invite-answered') {
      const { inviteId } = body;
      if (!ownerEmail.includes('@')) {
        return NextResponse.json({ ok: false, error: 'No owner email on the tenant.' }, { status: 422 });
      }
      const invSnap = await db.doc(`tenants/${tenantId}/tourInvites/${inviteId}`).get();
      if (!invSnap.exists) {
        return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 });
      }
      const inv = invSnap.data() as any;
      const accepted = inv.status === 'accepted';
      const theirs: string[] = Array.isArray(inv.proposedSlots) ? inv.proposedSlots : [];
      const html = brandedEmailHtml({
        studioName,
        title: accepted ? `${inv.firstName || 'A prospect'} picked a tour time` : `${inv.firstName || 'A prospect'} needs different times`,
        bodyLines: [
          accepted
            ? `They chose ${whenLabel(inv.chosenSlot || '')}. Confirm it in the pipeline and it goes on the tour schedule.`
            : (theirs.length
              ? `None of your times worked. They are free at ${theirs.map(whenLabel).join(' · ')}.`
              : 'None of your times worked and they did not suggest any — worth a call.'),
          inv.prospectNote ? `“${String(inv.prospectNote).slice(0, 400)}”` : '',
        ].filter(Boolean),
        cta: { label: 'Open the pipeline', url: `${origin}/pipeline` },
        footerNote: `Sent to you because you own ${studioName}.`,
      });
      const r = await sendNotification(db, {
        tenantId, channel: 'email', to: ownerEmail,
        subject: accepted ? `Tour time picked — ${inv.firstName || 'prospect'}` : `New times needed — ${inv.firstName || 'prospect'}`,
        html, kind: 'tour_invite_answered',
        recipientType: 'other', recipientId: inviteId, recipientName: 'Owner',
        tokens: { client_first: inv.firstName || 'A prospect', when: whenLabel(inv.chosenSlot || ''), link: `${origin}/pipeline` },
      });
      return NextResponse.json({ ok: r.ok, status: r.status, error: r.error || null });
    }

    /* ── A requested tour was approved or declined ──────────────────────────
     * With auto-confirm off, a prospect leaves the booking page holding a
     * request, not a time. The owner's decision is the moment that resolves
     * it — and it has to reach them, or the shop has simply gone quiet on
     * somebody who asked to visit. A decline is deliberately warm and offers
     * the door back: most declines are a clash, not a no.
     *
     * The address token resolves against THIS tour — approved and dated — so
     * an address held until "shortly before" releases on schedule, and a
     * declined visit never carries it at all. */
    if (action === 'tour-decision') {
      const { tourId, decision } = body;
      const tourSnap = await db.doc(`tenants/${tenantId}/tours/${tourId}`).get();
      if (!tourSnap.exists) {
        return NextResponse.json({ ok: false, error: 'Tour not found.' }, { status: 404 });
      }
      const tour = tourSnap.data() as any;
      const to = String(tour.email || '').trim();
      if (!to.includes('@')) {
        return NextResponse.json({ ok: true, status: 'skipped_no_email' });
      }
      const approved = decision === 'approve';
      const startIso = tour.date && tour.time ? `${tour.date}T${tour.time}:00` : '';
      const whenText = startIso ? whenLabel(startIso) : 'your requested time';
      const html = brandedEmailHtml({
        studioName,
        title: approved ? 'Your tour is confirmed' : 'That time did not work out',
        bodyLines: approved
          ? [
            `Hi ${firstNameOf(tour.name)} — you're set for ${whenText}.`,
            'There is nothing to bring or prepare. If the time stops working, just reply to this email.',
          ]
          : [
            `Hi ${firstNameOf(tour.name)} — sorry, we can't make ${whenText} work.`,
            'It is almost always a clash rather than a no. Pick another time that suits you and we will see you then.',
          ],
        ...(approved ? {} : { cta: { label: 'Choose another time', url: `${origin}/tour/${tenantId}` } }),
        footerNote: `Sent by ${studioName}. You're receiving this because you asked to visit us.`,
      });
      const r = await sendNotification(db, {
        tenantId, channel: 'email', to,
        subject: approved ? `Tour confirmed — ${whenText}` : `About ${whenText}`,
        html, kind: approved ? 'tour_confirmation' : 'tour_declined',
        recipientType: 'contact', recipientId: tourId, recipientName: tour.name || null,
        eventConfirmed: approved,
        eventStartIso: startIso || null,
        tokens: { client_first: firstNameOf(tour.name), when: whenText, studio: studioName },
      });
      return NextResponse.json({ ok: r.ok, status: r.status, error: r.error || null });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err: any) {
    console.error('[booths/notify]', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 200) }, { status: 500 });
  }
}
