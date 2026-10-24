import { NextRequest, NextResponse } from 'next/server';
import { staffOrServer } from '@/lib/route-guard';
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

/** A text that can't go however often it's tried (no service set up, not a number, they replied STOP). */
const FINAL = /not configured|not a sendable|replied STOP|unsubscribed|landline|not a valid|invalid .*number|cannot receive|21211|21610|21612|21614/i;

export async function POST(req: NextRequest) {
  let release: (() => Promise<void>) | null = null;
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
    }
    const tenantId = String(body.tenantId || '').trim();
    if (!(await staffOrServer(req, String(tenantId || '')))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });   // staff, or our own server — never the public
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
    const stamp = new Date().toISOString();
    const claimed = await db.runTransaction(async (txn: any) => {
      const snap = await txn.get(orderRef);
      if (!snap.exists) return null;
      const o = snap.data() as any;
      if (o.method !== 'curbside') return null;
      // Only while it still means something: "it's ready" before they've arrived, "on the way out" before it's handed
      // over (a message tried again later never arrives after the moment it's about).
      if (moment === 'ready' && String(o.stage) !== 'ready') return null;
      if (moment === 'out' && !['ready', 'arrived'].includes(String(o.stage))) return null;
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
        curbside: { ...(o.curbside || {}), [sentKey]: stamp },
      });
      return {
        sentKey,
        phone,
        firstName: String(o.customerName || '').trim().split(/\s+/)[0] || '',
        orderNumber: o.orderNumber ?? null,
        spot: String(o.curbside?.spotOrVehicle || '').trim(),
        email: String(o.customerEmail || '').trim() || null,
        arrivedAt: String(o.curbside?.arrivedAt || ''),
      };
    });

    if (!claimed) return NextResponse.json({ ok: true, sent: false });
    // Gives the claim back (only our own), so a later try can send it.
    release = async () => {
      await db.runTransaction(async (txn: any) => {
        const s = await txn.get(orderRef); const c = (s.data() as any)?.curbside || {};
        if (s.exists && c[claimed.sentKey] === stamp) txn.update(orderRef, { curbside: { ...c, [claimed.sentKey]: null } });
      }).catch(() => {});
    };

    const num = `#${String(claimed.orderNumber ?? '').padStart(4, '0')}`;
    const hi = `Hi ${claimed.firstName || 'there'}, `;
    if (moment === 'staff_escalation') {
      const waited = Math.max(1, Math.floor((Date.now() - Date.parse(String(claimed.arrivedAt || ''))) / 60000) || 1);
      const res = await sendTenantSms(
        db, tenantId, claimed.phone,
        `Action needed: ${claimed.firstName || 'A customer'} has been waiting outside for ${waited} minutes for order ${num}${claimed.spot ? ` (${claimed.spot})` : ''}. The order has not yet been brought out.`,
      );
      return NextResponse.json({ ok: true, sent: res.ok === true });
    }

    const message = moment === 'ready'
      // Said plainly, because they may be reading it while driving.
      ? `${hi}your order ${num} is ready. Please park out front and tap "I'm here" on your order link, or scan the sign at your parking spot.`
      : `${hi}we are bringing order ${num} out to you now${claimed.spot ? ` (${claimed.spot})` : ''}.`;

    const res = await sendTenantSms(
      db, tenantId, claimed.phone, message,
      { email: claimed.email, subject: moment === 'ready' ? `Order ${num} is ready` : `Order ${num} is on its way out to you` },
    );

    // The text service didn't take it (and no email did instead): try again later (lib/order-outbox).
    if (!res.ok && !FINAL.test(String(res.error || ''))) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: String(res.error || 'not sent').slice(0, 160) }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: res.ok === true, why: res.ok ? undefined : res.error });
  } catch (err: any) {
    console.error('[curbside-notify] failed:', err?.message);
    // Not sent (the claim given back if it was made): try again later. The board's own alert ignores the answer; the
    // action it describes has already happened.
    if (release) await release();
    return NextResponse.json({ ok: false, sent: false, retry: true, why: String(err?.message || 'failed').slice(0, 120) }, { status: 503 });
  }
}
