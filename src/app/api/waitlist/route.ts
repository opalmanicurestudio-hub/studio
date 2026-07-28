// src/app/api/waitlist/route.ts
//
// v1 — THE WAITLIST BACKEND.
//
// The collection tenants/{id}/waitlist has existed for a while and the front
// desk has been writing to it (QuickBookForm's "Add to waitlist" button, shown
// when a requested day has no opening). Two things were missing:
//
//   1. NOTHING EVER READ IT. Entries went in and were never seen again. The
//      toast even promised "will be notified when a slot opens" — a promise
//      with no machinery behind it. The planner's Waitlist panel is the reader;
//      this route is the part of it that can actually send the message.
//
//   2. NOTHING PUBLIC COULD WRITE TO IT. `waitlist` has no explicit rule in
//      firestore.rules and is not in the catch-all's exclusion list, so it
//      resolves to `read, write: if isStaff(tenantId)`. A guest standing at the
//      walk-in kiosk is not signed in, so their browser is refused. Same shape
//      of problem as the guest lounge, and the same solution: the write happens
//      here, with Admin privileges, behind a rate limit.
//
// POST { tenantId, action: 'join',   name, phone?, email?, serviceId?, note? }
//   -> public. Adds someone to the waitlist. Used by the walk-in kiosk when the
//      booking engine can't find them a chair.
//
// POST { tenantId, action: 'notify', entryId, message? }
//   -> staff. Texts/emails one waiting person that something has opened up.
//      Goes through the shared notify core so the send lands in messageLog and
//      "did we actually reach them?" always has an answer.
//
// POST { tenantId, action: 'close',  entryId, outcome? }
//   -> staff. Marks an entry handled. Staff CAN write this collection directly
//      from the browser, so the planner does it client-side; this exists so the
//      kiosk-side and any future server caller have one consistent path.
//
// Deliberately NOT here: reading the list. Staff already have read access under
// the rules, so the planner subscribes to it live rather than polling a route.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const str = (v: any, cap = 200): string => (typeof v === 'string' ? v.slice(0, cap) : '');

/** Same sliding ten-minute window the guest lounge uses. Kept local rather than
 *  shared so this route has no import that can break it at build time. */
async function rateLimit(db: any, tenantId: string, key: string, max: number) {
  const ref = db.doc(`tenants/${tenantId}/private/${key}`);
  const cur = ((await ref.get()).data() as any) || {};
  const stamps: number[] = (cur.at || []).filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  if (stamps.length >= max) return false;
  await ref.set({ at: [...stamps, Date.now()].slice(-400) }, { merge: true });
  return true;
}

/** Digits only, for comparing two phone numbers that were typed differently. */
const digits = (v: any): string => str(v, 40).replace(/\D/g, '');

const isEmail = (v: any): boolean => {
  const s = str(v, 160).trim();
  return s.length > 3 && s.includes('@') && !s.includes(' ') && s.indexOf('@') < s.lastIndexOf('.');
};

/**
 * An entry is "open" if nobody has dealt with it yet.
 *
 * Tolerant on purpose, and in the same direction as everywhere else in this
 * codebase: an unrecognised status counts as still waiting. The failure mode of
 * being too strict is that a real person silently drops off the list, which is
 * exactly the bug this whole route exists to fix.
 */
const isOpen = (status: any): boolean =>
  !['booked', 'closed', 'cancelled', 'expired', 'declined', 'converted', 'done'].includes(String(status || 'waiting'));

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const tenantId = str(body?.tenantId, 120);
    const action = str(body?.action, 20);

    if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing studio.' }, { status: 400 });
    if (!['join', 'notify', 'close'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    }

    const db = getAdminDb();

    // The studio has to exist before anything is written under it — otherwise a
    // typo'd tenantId in a URL quietly creates a phantom studio's private docs.
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) return NextResponse.json({ ok: false, error: 'Studio not found.' }, { status: 404 });
    const tenant = (tenantSnap.data() as any) || {};

    if (!(await rateLimit(db, tenantId, 'waitlistRate', 120))) {
      return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 });
    }

    // ── Join ────────────────────────────────────────────────────────────────
    // Public. The walk-in kiosk calls this when the booking engine has already
    // told the guest there is no chair — so the guest has typed their name and
    // number seconds ago and should not have to type them again.
    if (action === 'join') {
      const name = str(body?.name, 80).trim();
      const phone = str(body?.phone, 40).trim();
      const email = str(body?.email, 160).trim();
      const serviceId = str(body?.serviceId, 120);
      const note = str(body?.note, 200).trim();
      const source = str(body?.source, 40) || 'public';

      if (!name) return NextResponse.json({ ok: false, error: 'Please tell us your name.' }, { status: 400 });
      // One of the two, or there is no way to tell them a slot opened and the
      // entry is just a name on a list nobody can act on.
      if (!phone && !isEmail(email)) {
        return NextResponse.json({ ok: false, error: 'Please leave a phone number or an email so we can reach you.' }, { status: 400 });
      }

      // Don't stack duplicates. Someone who taps twice, or comes back an hour
      // later after another failed walk-in attempt, should stay ONE entry —
      // otherwise the front desk sees the same person three times and can't
      // tell whether that's three people or one impatient one.
      //
      // Filtered in memory after a single equality query so no composite index
      // has to be deployed for this to work.
      // Read the whole collection rather than filtering on status in the query:
      // an entry that has already been texted is `notified`, not `waiting`, and
      // it is still very much a duplicate.
      const existingSnap = await db.collection(`tenants/${tenantId}/waitlist`).get();
      const wantPhone = digits(phone);
      const wantEmail = email.toLowerCase();
      const dupe = existingSnap.docs
        .map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        .filter((r: any) => isOpen(r.status))
        .find((r: any) => {
          if (wantPhone && digits(r.phone || r.clientPhone) === wantPhone) return true;
          if (wantEmail && str(r.email || r.clientEmail, 160).trim().toLowerCase() === wantEmail) return true;
          return false;
        });
      if (dupe) {
        return NextResponse.json({ ok: true, entryId: String(dupe.id), alreadyOn: true });
      }

      let serviceName = '';
      if (serviceId) {
        try {
          const sSnap = await db.doc(`tenants/${tenantId}/services/${serviceId}`).get();
          if (sSnap.exists) serviceName = str((sSnap.data() as any)?.name, 80);
        } catch { /* a missing service must not stop someone joining the list */ }
      }

      const now = new Date().toISOString();
      const ref = db.collection(`tenants/${tenantId}/waitlist`).doc();
      const batch = db.batch();

      // Shaped to match what QuickBookForm already writes, so the planner's
      // panel reads one document type rather than two. `clientId` is null
      // because a walk-in who never got booked has no client record yet — the
      // panel falls back to `name`/`phone` for exactly this case.
      batch.set(ref, {
        id: ref.id,
        tenantId,
        clientId: null,
        clientName: name,
        name,
        phone,
        email,
        serviceId: serviceId || null,
        serviceName,
        staffId: null,
        requestedDate: str(body?.requestedDate, 40) || now.slice(0, 10),
        note,
        createdAt: now,
        status: 'waiting',
        source,
        notifyCount: 0,
      });

      // Addressed to real people. The staff portal's bell reads
      // where('userId','==',staffMember.id), so an unaddressed notification is
      // invisible to everyone — a lesson already learned on the lounge route.
      const recipients = new Set<string>();
      try {
        const mgrs = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['owner', 'admin']).get();
        mgrs.docs.forEach((d: any) => recipients.add(d.id));
      } catch { /* no managers resolved — the entry still lands on the panel */ }
      recipients.forEach(uid => {
        const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
        batch.set(nRef, {
          id: nRef.id,
          userId: uid,
          type: 'waitlist_join',
          read: false,
          createdAt: now,
          link: '/planner',
          message: `${name} joined the waitlist${serviceName ? ` for ${serviceName}` : ''}.`,
        });
      });

      await batch.commit();
      return NextResponse.json({ ok: true, entryId: ref.id, alreadyOn: false, notified: recipients.size });
    }

    const entryId = str(body?.entryId, 120);
    if (!entryId) return NextResponse.json({ ok: false, error: 'Missing entry.' }, { status: 400 });
    const entryRef = db.doc(`tenants/${tenantId}/waitlist/${entryId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) return NextResponse.json({ ok: false, error: 'That waitlist entry is gone.' }, { status: 404 });
    const entry = (entrySnap.data() as any) || {};

    // ── Close ───────────────────────────────────────────────────────────────
    if (action === 'close') {
      const outcome = str(body?.outcome, 20) || 'closed';
      await entryRef.set({
        status: ['booked', 'closed', 'expired'].includes(outcome) ? outcome : 'closed',
        closedAt: new Date().toISOString(),
      }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // ── Notify ──────────────────────────────────────────────────────────────
    // "A spot just opened." This is the message the front desk has been
    // promising since the day the Add-to-waitlist button shipped.
    if (!isOpen(entry.status)) {
      return NextResponse.json({ ok: false, error: 'That entry has already been handled.' }, { status: 409 });
    }

    // Contact details: the entry's own first (a kiosk walk-in has no client
    // record), then the linked client profile if there is one.
    let phone = str(entry.phone || entry.clientPhone, 40).trim();
    let email = str(entry.email || entry.clientEmail, 160).trim();
    if ((!phone || !isEmail(email)) && entry.clientId) {
      try {
        const c = ((await db.doc(`tenants/${tenantId}/clients/${entry.clientId}`).get()).data() as any) || {};
        if (!phone) phone = str(c.phone, 40).trim();
        if (!isEmail(email)) email = str(c.email, 160).trim();
      } catch { /* fall through with whatever we have */ }
    }
    if (!isEmail(email)) email = '';
    if (!phone && !email) {
      return NextResponse.json({ ok: false, error: 'No phone or email on file for this person.' }, { status: 400 });
    }

    const studioName = str(tenant.name || tenant.businessName, 80) || 'the studio';
    const who = str(entry.clientName || entry.name, 80) || 'there';
    const firstName = who.split(/\s+/)[0];
    const serviceName = str(entry.serviceName, 80);
    const custom = str(body?.message, 300).trim();
    const text = custom
      || `Hi ${firstName} — a spot just opened up${serviceName ? ` for your ${serviceName}` : ''} at ${studioName}. Reply or give us a call and we'll get you in.`;

    const results: { channel: string; ok: boolean; status: string }[] = [];
    if (phone) {
      const r = await sendNotification(db, {
        tenantId, channel: 'sms', to: phone, text, kind: 'waitlist_opening',
        clientId: entry.clientId || null, clientName: who,
        recipientType: 'client', recipientId: entry.clientId || null, recipientName: who,
      });
      results.push({ channel: 'sms', ok: !!r.ok, status: r.status });
    }
    if (email) {
      const r = await sendNotification(db, {
        tenantId, channel: 'email', to: email,
        subject: `${studioName} — a spot just opened up`,
        text, kind: 'waitlist_opening',
        clientId: entry.clientId || null, clientName: who,
        recipientType: 'client', recipientId: entry.clientId || null, recipientName: who,
      });
      results.push({ channel: 'email', ok: !!r.ok, status: r.status });
    }

    const anySent = results.some(r => r.ok);
    const now = new Date().toISOString();
    // The attempt is stamped whether or not it landed, so the panel can show
    // "told 10m ago" — or, when nothing is configured yet, say so honestly.
    // But the STATUS only moves to 'notified' when something actually went out;
    // otherwise the list would show a green "Told" badge next to a person who
    // was never contacted, which is exactly the lie this whole feature exists
    // to stop telling.
    await entryRef.set({
      notifiedAt: now,
      notifyCount: Number(entry.notifyCount || 0) + 1,
      lastNotifyOk: anySent,
      lastNotifyDetail: results.map(r => `${r.channel}:${r.status}`).join(' '),
      ...(anySent ? { status: 'notified' } : {}),
    }, { merge: true });

    if (!anySent) {
      const noProvider = results.every(r => r.status === 'skipped_no_provider');
      return NextResponse.json({
        ok: false,
        error: noProvider
          ? 'Texting and email are not set up yet, so nothing was sent. Give them a call instead.'
          : 'The message could not be delivered. Give them a call instead.',
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sent: results.filter(r => r.ok).map(r => r.channel) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
  }
}
