import { NextRequest, NextResponse } from 'next/server';
import { sendTenantSms } from '@/lib/sms';

// ─── /api/retail/curbside-notify ─────────────────────────────────────────────
// The message that reaches a phone in a pocket.
//
// Everything built so far assumes the customer is looking at their order page.
// In a car park they are not: the screen is off, the phone is in a cupholder,
// and the person is watching the door. A banner nobody sees is not a
// notification — a text is.
//
// Two moments earn one, and only two:
//   ready  — "your order is ready" (they may still be at home)
//   out    — "someone is walking out to you now"
// Anything more is spam, and a shop that texts too much gets muted, which
// costs you the one message that mattered.
//
// Idempotent per moment: the order records which texts have gone, so a
// double-tap, a retry, or two staff hitting the same button send one message.
// SMS failure is never allowed to break the flow it describes — the board
// action already committed before this route is called.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Moment = 'ready' | 'out' | 'staff_escalation';

/**
 * Nobody at the board.
 *
 * The chime only helps if a screen is awake in the building. On a quiet
 * afternoon, in the back room, mid-service — nobody hears it, and the
 * customer waits. After a few minutes the alert has to leave the building and
 * find a person, which means a text to the shop's own number.
 *
 * Sent once per order, ever: the point is to get someone moving, not to
 * pester a staff member who is already walking.
 */
const ESCALATE_TO = (t: any): string =>
  String(t?.retailSettings?.curbsideAlertPhone || t?.sms?.fromNumber || t?.phone || '').trim();

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app = getApps().find((a: any) => a.name === 'retail-curbside-notify');
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    }, 'retail-curbside-notify');
  }
  return getFirestore(app);
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
    }
    const tenantId = String(body.tenantId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const raw = String(body.moment || '');
    const moment: Moment = raw === 'ready' ? 'ready'
      : raw === 'staff_escalation' ? 'staff_escalation' : 'out';
    if (!tenantId || !orderId) {
      return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
    }

    const db = getAdminDb();
    const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);

    // Claim the send inside a transaction, then text after it commits: a crash
    // loses one message rather than sending two.
    const claimed = await db.runTransaction(async (txn: any) => {
      const snap = await txn.get(orderRef);
      if (!snap.exists) return null;
      const o = snap.data() as any;
      if (o.method !== 'curbside') return null;
      const sentKey = moment === 'ready' ? 'smsReadyAt'
        : moment === 'staff_escalation' ? 'smsStaffAlertAt' : 'smsBringingOutAt';
      if (o.curbside?.[sentKey]) return null;
      // The escalation goes to the SHOP, not the customer.
      let phone = String(o.customerPhone || '').trim();
      if (moment === 'staff_escalation') {
        const tSnap = await txn.get(db.doc(`tenants/${tenantId}`));
        phone = ESCALATE_TO(tSnap.exists ? tSnap.data() : {});
        if (!phone) return null;
      }
      if (!phone) return null;
      txn.update(orderRef, {
        curbside: { ...(o.curbside || {}), [sentKey]: new Date().toISOString() },
      });
      return {
        phone,
        firstName: String(o.customerName || '').trim().split(/\s+/)[0] || '',
        orderNumber: o.orderNumber ?? null,
        spot: String(o.curbside?.spotOrVehicle || '').trim(),
        email: String(o.customerEmail || '').trim() || null,
        arrivedAt: String(o.curbside?.arrivedAt || ''),
      };
    });

    if (!claimed) return NextResponse.json({ ok: true, sent: false });

    const num = `#${String(claimed.orderNumber ?? '').padStart(4, '0')}`;
    const hi = claimed.firstName ? `${claimed.firstName}, ` : '';
    if (moment === 'staff_escalation') {
      const waited = Math.max(1, Math.floor((Date.now() - Date.parse(String(claimed.arrivedAt || ''))) / 60000) || 1);
      const res = await sendTenantSms(
        db, tenantId, claimed.phone,
        `${claimed.firstName || 'A customer'} has been waiting outside ${waited} min for order ${num}${claimed.spot ? ` (${claimed.spot})` : ''}. Nobody has taken it out.`,
      );
      return NextResponse.json({ ok: true, sent: res.ok === true });
    }

    const message = moment === 'ready'
      // Said plainly, because they may be reading it while driving.
      ? `${hi}order ${num} is ready. Park anywhere out front and tap "I'm here" on your order link, or scan the sign at your spot.`
      : `${hi}we're walking out with order ${num} now${claimed.spot ? ` — ${claimed.spot}` : ''}.`;

    const res = await sendTenantSms(
      db, tenantId, claimed.phone, message,
      { email: claimed.email, subject: moment === 'ready' ? `Order ${num} is ready` : `Order ${num} is on its way out` },
    );

    return NextResponse.json({ ok: true, sent: res.ok === true, why: res.ok ? undefined : res.error });
  } catch (err: any) {
    console.error('[curbside-notify] failed:', err?.message);
    // Never an error the board has to interpret: the action it describes has
    // already happened.
    return NextResponse.json({ ok: true, sent: false });
  }
}
