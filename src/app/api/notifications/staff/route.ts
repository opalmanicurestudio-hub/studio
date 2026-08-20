/**
 * POST /api/notifications/staff
 *
 * WHY THIS EXISTS
 * notifyStaff() runs on the client SDK, so it can write an in-app row and
 * nothing else. Nothing in this codebase has ever texted or emailed a staff
 * member — the only staff-SMS path was voice escalation, and that just writes
 * a thread record. So an issue raised at 4pm sat in a bell nobody was looking
 * at.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not text people about every new booking. A channel that pings on
 * routine events is a channel muted in week one, and then the one message that
 * mattered is muted too. Only kinds the shop has agreed are worth interrupting
 * someone for get through — see ESCALATING_KINDS.
 *
 * It also respects notificationAvailability, which already existed on Staff
 * for escalations: 'away' means away, 'business_hours_only' means it waits.
 * The in-app row is always written by the caller regardless — this route only
 * decides whether to also interrupt someone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';

/** The only things worth a buzz in someone's pocket. */
export const ESCALATING_KINDS = ['appointment_issue_raised', 'appointment_overdue'] as const;

function isWithinBusinessHours(tenant: any): boolean {
  /* Mirrors the voice escalation route's rule so a shop cannot be "open" for
   * one kind of notification and closed for another. Falls back to available
   * when nothing is configured — defaulting to silence would be worse. */
  const activeProfile = tenant?.scheduleProfiles?.find?.((p: any) => p.isActive);
  if (!activeProfile?.week) return true;
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  return !!activeProfile.week[day]?.enabled;
}

function shouldInterrupt(staff: any, tenant: any): boolean {
  const mode = staff?.notificationAvailability?.mode || 'business_hours_only';
  if (mode === 'away') {
    const until = staff?.notificationAvailability?.awayUntil;
    if (!until || new Date(until) > new Date()) return false;
  }
  if (mode === 'always') return true;
  return isWithinBusinessHours(tenant);
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = String(body.tenantId || '').trim();
  const kind = String(body.kind || '').trim();
  const message = String(body.message || '').trim().slice(0, 240);
  const link = String(body.link || '/planner').slice(0, 200);
  const userIds: string[] = Array.isArray(body.userIds)
    ? body.userIds.map((u: any) => String(u)).filter(Boolean).slice(0, 25)
    : [];

  if (!tenantId || !kind || !message || userIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'tenantId, kind, message and userIds are required.' }, { status: 400 });
  }
  if (!(ESCALATING_KINDS as readonly string[]).includes(kind)) {
    /* Not an error — the in-app row already exists and that is the whole
     * intent for every other kind. */
    return NextResponse.json({ ok: true, skipped: 'kind_does_not_escalate', sent: 0 });
  }

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const db = getAdminDb();
  const tenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const studioName = tenant.name || tenant.businessName || 'Your studio';
  const base = String(
    tenant.publicOrigin
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || req.nextUrl.origin,
  ).replace(/\/$/, '');

  const results: Array<{ userId: string; sms: boolean; email: boolean; heldBack?: string }> = [];

  for (const uid of userIds) {
    /* Never buzz the person who caused the event. The caller already filters
     * for this; doing it again here means a future caller cannot get it
     * wrong. */
    if (uid === auth.actor.uid) {
      results.push({ userId: uid, sms: false, email: false, heldBack: 'is_the_actor' });
      continue;
    }

    const snap = await db.doc(`tenants/${tenantId}/staff/${uid}`).get();
    const staff = snap.exists ? (snap.data() as any) : null;
    if (!staff) {
      results.push({ userId: uid, sms: false, email: false, heldBack: 'no_staff_record' });
      continue;
    }
    if (!shouldInterrupt(staff, tenant)) {
      results.push({ userId: uid, sms: false, email: false, heldBack: 'availability' });
      continue;
    }

    const phone = String(staff.phone || '').trim();
    const email = String(staff.email || '').trim();
    let sms = false;
    let mail = false;

    try {
      const { sendNotification } = await import('@/lib/notify');
      const { brandedEmailHtml } = await import('@/lib/email-template');
      const body = `${message}\n\n${base}${link}`;

      if (phone) {
        const r = await sendNotification(db, { tenantId, channel: 'sms', to: phone, text: body, kind });
        sms = !!r.ok;
      }
      /* Email only when there is no phone. Two copies of the same sentence is
       * how a person learns to ignore both. */
      if (!sms && email.includes('@')) {
        const html = brandedEmailHtml({
          studioName,
          title: studioName,
          bodyLines: [message],
          cta: { label: 'Open', url: `${base}${link}` },
        });
        const r = await sendNotification(db, {
          tenantId, channel: 'email', to: email, subject: `${studioName} — action needed`, html, kind,
        });
        mail = !!r.ok;
      }
    } catch (e) {
      console.error('[notifications/staff] send failed', uid, e);
    }

    results.push({ userId: uid, sms, email: mail });
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter(r => r.sms || r.email).length,
    results,
  });
}
