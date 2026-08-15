import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendTenantSms } from '@/lib/sms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/host/notify — "your spot is ready", for HOST-OWNED parties.
 *
 * The walk-in queue already sends its own ready text through /api/walkins
 * (action=notify) with its fairness rotation, and the host screen's mirrored
 * queue rows deliberately hide their Notify button so that stays the queue's
 * job. This route covers everyone else on the host list: manual reservations,
 * parties typed in at the stand, and imported bookings that carry a phone.
 *
 * Discipline copied from the queue's notify, because it is the right
 * discipline: claim the notification in a transaction so a double-tap cannot
 * send twice, and when there is no phone say so plainly instead of reporting
 * a send that never had a destination. Marking the party notified happens
 * either way — walking over and telling someone IS notifying them, and the
 * board should show it.
 *
 * The message itself uses no niche nouns. "We're ready for you" is true at a
 * restaurant, a salon, a clinic and a workshop, so the vocabulary layer has
 * nothing to leak here.
 */

const str = (v: any, max: number): string => {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
};

async function rateLimit(db: any, tenantId: string, key: string, max: number): Promise<boolean> {
  const ref = db.doc(`tenants/${tenantId}/private/${key}`);
  const cur = ((await ref.get()).data() as any) || {};
  const stamps: number[] = (cur.at || []).filter((t: number) => Date.now() - t < 10 * 60 * 1000);
  if (stamps.length >= max) return false;
  await ref.set({ at: [...stamps, Date.now()].slice(-400) }, { merge: true });
  return true;
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const tenantId = str(body?.tenantId, 120);
    const partyId = str(body?.partyId, 200);
    const resend = body?.resend === true;
    if (!tenantId || !partyId) {
      return NextResponse.json({ ok: false, error: 'Missing tenant or party.' }, { status: 400 });
    }

    const db = getAdminDb();

    if (!(await rateLimit(db, tenantId, 'hostNotifyRate', 240))) {
      return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 });
    }

    const ref = db.doc(`tenants/${tenantId}/parties/${partyId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: 'That party could not be found.' }, { status: 404 });
    }
    const party = (snap.data() as any) || {};

    const status = String(party.status || '').toLowerCase();
    if (['seated', 'finished', 'cancelled', 'no_show'].includes(status)) {
      return NextResponse.json({ ok: false, error: 'That party is no longer waiting.' }, { status: 409 });
    }

    const nowIso = new Date().toISOString();

    let claimed = false;
    try {
      claimed = await db.runTransaction(async (tx: any) => {
        const s = await tx.get(ref);
        if (!s.exists) return false;
        const cur = (s.data() as any) || {};
        if (cur.notifiedAt && !resend) return false;
        tx.set(ref, {
          status: 'notified',
          notifiedAt: cur.notifiedAt || nowIso,
          ...(resend ? { notifyResentAt: nowIso } : {}),
        }, { merge: true });
        return true;
      });
    } catch { claimed = false; }

    if (!claimed) {
      return NextResponse.json({
        ok: true, alreadyNotified: true,
        message: 'This party has already been called forward.',
      });
    }

    const phone = str(party.phone || party.clientPhone, 40);
    const email = str(party.email || party.clientEmail, 160);
    if (!phone && !email) {
      return NextResponse.json({
        ok: true, sent: false, noContact: true,
        message: 'Marked as notified — no phone on file, so please call them forward in person.',
      });
    }

    const name = str(party.name, 80) || 'Hi';
    const text = `${name.split(' ')[0]}, we're ready for you — please come to the front and we'll get you settled.`;

    const r = await sendTenantSms(db, tenantId, phone, text,
      { email: email || null, subject: 'We\u2019re ready for you' },
      { kind: 'host_ready', recipientType: 'client', recipientId: partyId, recipientName: str(party.name, 80) || null },
    );

    if (!r.ok) {
      return NextResponse.json({
        ok: true, sent: false,
        message: 'Marked as notified, but the text could not be sent — please call them forward in person.',
      });
    }

    return NextResponse.json({ ok: true, sent: true, via: r.via || 'sms' });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'Notify failed.',
    }, { status: 500 });
  }
}
