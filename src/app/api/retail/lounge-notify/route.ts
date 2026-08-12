import { NextRequest, NextResponse } from 'next/server';
import { sendTenantSms } from '@/lib/sms';

// ─── /api/retail/lounge-notify ───────────────────────────────────────────────
// The concierge twin of curbside-notify.
//
// The parity argument, plainly: a guest mid-service is in a chair with wet
// polish. They cannot walk to the desk to ask whether anyone saw their
// request, and they may be under a lamp with their phone face-down. A badge
// on a staff board and a status on a screen they aren't holding are both
// invisible to them — so the same two moments earn a message here, and the
// same escalation has to leave the building when nobody moves.
//
//   out               — "Kayla is bringing your latte over now"
//   staff_escalation  — texts the SHOP: a guest has waited N minutes
//
// Deliberately no "your order is ready" moment: unlike curbside, nobody is
// driving here, and a text saying "it's ready" to someone who then has to
// wait for it to be carried over is noise dressed as service.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Moment = 'out' | 'staff_escalation';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-lounge-notify');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-lounge-notify');
  }
  return getFirestore(app);
}

const ALERT_NUMBER = (t: any): string =>
  String(t?.retailSettings?.curbsideAlertPhone || t?.sms?.fromNumber || t?.phone || '').trim();

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
    }
    const tenantId = String(body.tenantId || '').trim();
    const requestId = String(body.requestId || '').trim();
    const moment: Moment = body.moment === 'staff_escalation' ? 'staff_escalation' : 'out';
    if (!tenantId || !requestId) {
      return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
    }

    const db = getAdminDb();
    const reqRef = db.collection(`tenants/${tenantId}/refreshmentRequests`).doc(requestId);

    // Claim the send inside the transaction, text after it commits — a crash
    // loses one message rather than sending two.
    const claimed = await db.runTransaction(async (txn: any) => {
      const snap = await txn.get(reqRef);
      if (!snap.exists) return null;
      const r = snap.data() as any;
      if (['delivered', 'cancelled'].includes(String(r.status || ''))) return null;
      const sentKey = moment === 'out' ? 'smsBringingAt' : 'smsStaffAlertAt';
      if (r[sentKey]) return null;
      txn.update(reqRef, { [sentKey]: new Date().toISOString() });
      return {
        clientId: String(r.clientId || ''),
        clientName: String(r.clientName || '').trim(),
        itemName: String(r.itemName || 'your order').trim(),
        bringingOutBy: String(r.bringingOutBy || '').trim(),
        stationName: String(r.stationName || '').trim(),
        requestedAt: String(r.requestedAt || ''),
      };
    });
    if (!claimed) return NextResponse.json({ ok: true, sent: false });

    const firstName = claimed.clientName.split(/\s+/)[0] || '';

    if (moment === 'staff_escalation') {
      const tSnap = await db.doc(`tenants/${tenantId}`).get();
      const to = ALERT_NUMBER(tSnap.exists ? tSnap.data() : {});
      if (!to) return NextResponse.json({ ok: true, sent: false });
      const waited = Math.max(1, Math.floor((Date.now() - Date.parse(claimed.requestedAt)) / 60000) || 1);
      const res = await sendTenantSms(
        db, tenantId, to,
        `${firstName || 'A guest'} has been waiting ${waited} min for ${claimed.itemName}${claimed.stationName ? ` at ${claimed.stationName}` : ''}. Nobody has picked it up.`,
      );
      return NextResponse.json({ ok: true, sent: res.ok === true });
    }

    // The guest's own number lives on their client record, not the request.
    let to = '';
    let email: string | null = null;
    if (claimed.clientId) {
      try {
        const cSnap = await db.doc(`tenants/${tenantId}/clients/${claimed.clientId}`).get();
        const c = cSnap.exists ? (cSnap.data() as any) : {};
        to = String(c.phone || c.phoneNumber || '').trim();
        email = String(c.email || '').trim() || null;
      } catch { /* no client record — nothing to send, and that is fine */ }
    }
    if (!to) return NextResponse.json({ ok: true, sent: false });

    const who = claimed.bringingOutBy || 'Someone';
    const res = await sendTenantSms(
      db, tenantId, to,
      `${firstName ? `${firstName}, ` : ''}${who} is bringing your ${claimed.itemName} over now.`,
      { email, subject: 'Your order is on its way over' },
    );
    return NextResponse.json({ ok: true, sent: res.ok === true });
  } catch (err: any) {
    console.error('[lounge-notify] failed:', err?.message);
    // Never an error the floor has to interpret: the action it describes has
    // already happened.
    return NextResponse.json({ ok: true, sent: false });
  }
}
