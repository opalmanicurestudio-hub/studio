import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { staffOrServer } from '@/lib/route-guard';
import { sendNotification } from '@/lib/notify';
import { linkOrigin } from '@/lib/app-origin';
import { deliveryFrom } from '@/lib/delivery-plan';
import { doorWords, failReason, streetLines, tryKey } from '@/lib/delivery-run';
import { formatTime, tenantTimeZone } from '@/lib/tenant-time';

// ─── /api/retail/delivery-notify ─────────────────────────────────────────────
// What the customer hears about a local delivery by the shop's own team (lib/delivery-run), four moments:
//   out     — who's bringing it, and when it should arrive
//   door    — the driver is at the door and couldn't reach them: answer on the order page in the next few minutes
//   done    — delivered (left where they asked, with the photo on the order page)
//   failed  — brought back to the shop, and why; on the order page they choose another try, pickup or cancelling
//             (lib/delivery-retry)
// Like every order message it lands on the order page in full (lib/order-inbox), and the phone gets a short nudge with
// the link (the door message keeps its own words, as it asks for an answer). Each moment goes once per try: the order
// records it in a transaction before anything is sent, and gives the mark back when nothing reached them, so the
// queue that sent it (lib/order-outbox) tries again. A moment that's no longer true (it was delivered before the "out"
// message was tried again) isn't sent.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Moment = 'out' | 'door' | 'done' | 'failed';
const KIND: Record<Moment, string> = { out: 'delivery_out', door: 'delivery_door', done: 'delivery_done', failed: 'delivery_failed' };

export async function POST(req: NextRequest) {
  let release: (() => Promise<void>) | null = null;
  let sent = false;
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
    const moment = (['out', 'door', 'done', 'failed'].includes(String(b.moment)) ? String(b.moment) : '') as Moment | '';
    const tryId = /^t\d{1,3}$/.test(String(b.try || '')) ? String(b.try) : 't1';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId) || !moment) return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
    if (!(await staffOrServer(req, tenantId))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
    const db = getAdminDb();
    const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
    // Delivered happens once, whatever try it was on.
    const mark = moment === 'done' ? 'done' : `${moment}_${tryId}`;
    const stamp = new Date().toISOString();
    const o: any = await db.runTransaction(async (txn: any) => {
      const s = await txn.get(ref); if (!s.exists) return null;
      const d: any = s.data() || {};
      const del = d.delivery || {};
      if (d.method !== 'delivery' || del.sent?.[mark]) return null;
      // Still true now: the same try, and the step it's about.
      const still = moment === 'done' ? del.status === 'delivered'
        : tryKey(d) !== tryId ? false
        : moment === 'out' ? del.status === 'out'
        : moment === 'door' ? del.status === 'out' && !!del.doorAt
        : del.status === 'failed';
      if (!still) return null;
      txn.update(ref, { [`delivery.sent.${mark}`]: stamp });
      return d;
    });
    if (!o) return NextResponse.json({ ok: true, sent: false });
    release = async () => { await db.runTransaction(async (txn: any) => { const s = await txn.get(ref); if (s.exists && (s.data() as any)?.delivery?.sent?.[mark] === stamp) txn.update(ref, { [`delivery.sent.${mark}`]: null }); }).catch(() => {}); };

    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const tz = tenantTimeZone(t);
    const d: any = o.delivery || {};
    const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
    const first = String(o.customerName || '').trim().split(/\s+/)[0] || 'there';
    const shop = String(t.businessName || t.name || 'the shop');
    const link = `${linkOrigin(t, req.nextUrl.origin)}/shop/${tenantId}/order/${orderId}`;
    const driver = String(d.driverName || '').trim().split(/\s+/)[0] || 'Our driver';
    const vehicle = deliveryFrom(t.retailSettings).vehicles[String(d.driverId || '')] || '';
    const when = d.window?.label ? `, arriving ${String(d.window.label).replace(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, /, '')}` : d.asap?.by ? `, arriving by ${formatTime(d.asap.by, tz)}` : '';
    const street = streetLines(o.shippingAddress)[0] || 'your address';
    const why = (failReason(d.failCode)?.label || String(d.failReason || '')).replace(/[.!?]$/, '').toLowerCase();
    // The words never carry the customer's own note (a gate code, say): the order page shows that only to them.
    const text = moment === 'out' ? `Hi ${first}, ${driver} is bringing your order ${num} from ${shop} now${vehicle ? ` (${vehicle})` : ''}${when}. Follow it here: ${link}`
      : moment === 'door' ? `Hi ${first}, your driver is at ${street} with order ${num} and ${doorWords(d.doorCode)}. Answer on your order page in the next few minutes: ${link}`
      : moment === 'done' ? `Hi ${first}, your order ${num} from ${shop} was delivered${d.handedTo === 'left' ? ' and left where you asked' : ''}.${d.photoUrl ? ' There’s a photo on your order page' : ' Your order page has the details'}: ${link}`
      : `Hi ${first}, we couldn’t deliver your order ${num} today${why ? ` (${why})` : ''}. It’s back at ${shop}. Choose another time, pick it up or cancel on your order page: ${link}`;
    const subject = moment === 'out' ? `Your order ${num} is on its way` : moment === 'door' ? `Your driver is at the door with order ${num}` : moment === 'done' ? `Your order ${num} was delivered` : `We couldn’t deliver your order ${num}`;

    let failed = false;
    const to = String(o.customerPhone || '').trim();
    if (to) {
      // On its way and at the door are about right now: never held for the shop's quiet hours.
      const r = await sendNotification(db, { tenantId, channel: 'sms', to, text, kind: KIND[moment], recipientType: 'client', recipientId: orderId, orderId, essential: moment === 'out' || moment === 'door' } as any);
      sent = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (!sent && o.customerEmail) {
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<p style="font-size:14px;color:#16171a;line-height:1.6">${esc(text.replace(/: https?:\/\/\S+$/, '.'))}</p><p><a href="${esc(link)}" style="color:#16171a;font-weight:600">Open your order</a></p>`;
      const r = await sendNotification(db, { tenantId, channel: 'email', to: String(o.customerEmail), subject, html, kind: KIND[moment], recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null } as any);
      sent = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (!sent && failed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text and email services didn’t take it.' }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent });
  } catch (e: any) {
    console.error('[delivery-notify]', String(e?.message || e).slice(0, 200));
    // Something failed before it reached them: the mark is given back for a later try. Once sent, never again.
    if (sent) return NextResponse.json({ ok: true, sent: true });
    if (release) await release();
    return NextResponse.json({ ok: false, sent: false, retry: true, why: String(e?.message || 'failed').slice(0, 120) }, { status: 503 });
  }
}
