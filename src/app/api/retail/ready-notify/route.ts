import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { staffOrServer } from '@/lib/route-guard';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';
import { sendNotification } from '@/lib/notify';

// ─── /api/retail/ready-notify ────────────────────────────────────────────────
// "Your order is ready" for counter pickup (curbside has its own text in curbside-notify). One text, falling back to
// email, plus an email with the pickup details. Sent once per order: the order records readyNotifiedAt in a
// transaction before anything goes out, so a double tap or a retry sends one message. When neither went (the text and
// email services both failed), the mark is given back and the answer says to try again (retry: true), so the queue
// that sent it (lib/order-outbox) tries later.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function POST(req: NextRequest) {
  let release: (() => Promise<void>) | null = null;
  let texted = false; let emailed = false; let failed = false;
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ ok: false, error: 'Missing details' }, { status: 400 });
    if (!(await staffOrServer(req, tenantId))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
    const db = getAdminDb();
    const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
    const stamp = new Date().toISOString();
    const o: any = await db.runTransaction(async (txn: any) => {
      const s = await txn.get(ref); if (!s.exists) return null;
      const d = s.data() as any;
      if (d.method === 'curbside' || d.method === 'ship' || d.method === 'delivery' || d.readyNotifiedAt || !['ready', 'arrived'].includes(String(d.stage))) return null;
      txn.update(ref, { readyNotifiedAt: stamp });
      return d;
    });
    if (!o) return NextResponse.json({ ok: true, sent: false });
    // Gives the mark back (only our own), so a later try can send it.
    release = async () => { await db.runTransaction(async (txn: any) => { const s = await txn.get(ref); if (s.exists && (s.data() as any)?.readyNotifiedAt === stamp) txn.update(ref, { readyNotifiedAt: null }); }).catch(() => {}); };
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
    const first = String(o.customerName || '').trim().split(/\s+/)[0] || 'there';
    const shop = String(t.businessName || t.name || 'the shop');
    const link = `${req.nextUrl.origin}/shop/${tenantId}/order/${orderId}`;
    const address = String(t.studioAddress || (typeof t.address === 'string' ? t.address : [t.address?.street, t.address?.city].filter(Boolean).join(', ')) || '').trim();
    const holdDays = Math.max(0, Number(t.retailSettings?.pickupHoldDays) || 0);
    if (o.customerPhone) {
      // Through lib/notify, so it becomes the one nudge to the order page (lib/order-inbox) like every order message.
      const r = await sendNotification(db, { tenantId, channel: 'sms', to: String(o.customerPhone), text: `Hi ${first}, your order ${num} from ${shop} is ready for pickup${address ? ` at ${address}` : ''}. Show the code on your order page at the counter: ${link}`, kind: 'order_ready', recipientType: 'client', recipientId: orderId, orderId } as any);
      texted = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (o.customerEmail) {
      const brand = await getEmailBrand(db, tenantId);
      const html = brandedEmail(brand, `
        <p style="font-size:14px;color:#16171a;margin:0 0 8px">Hi ${esc(first)},</p>
        <p style="font-size:14px;color:#334155;line-height:1.6">Your order is ready and waiting for you${o.shelfSlot ? ` on shelf ${esc(String(o.shelfSlot))}` : ''}. Show the pickup code on your order page at the counter.</p>
        ${address ? `<p style="font-size:14px;color:#334155;line-height:1.6;margin:12px 0"><strong>Where:</strong> ${esc(address)}</p>` : ''}
        ${holdDays ? `<p style="font-size:13px;color:#6d7075;line-height:1.6">We’ll hold it for ${holdDays} days.</p>` : ''}
        ${emailButton(link, 'Show my pickup code', brand)}
        <p style="font-size:13px;color:#6d7075;line-height:1.6">Someone else collecting it? Forward them this email.</p>`,
        { title: 'Your order is ready', tag: `Order ${num}`, preheader: `Order ${num} is ready for pickup.` });
      const r = await sendNotification(db, { tenantId, channel: 'email', to: String(o.customerEmail), subject: `Your order ${num} is ready for pickup`, html, kind: 'order_ready', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null });
      emailed = r.ok === true; if (r.status === 'failed') failed = true;
    }
    // Neither reached them because a service failed (not because the shop switched it off or it's waiting for quiet
    // hours to end): try again later.
    if (!texted && !emailed && failed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text and email services didn’t take it.' }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: texted || emailed, texted });
  } catch (e: any) {
    console.error('[ready-notify]', e?.message);
    // Something failed before anything reached them (the claim given back if it was made): try again later.
    if (!texted && !emailed) { if (release) await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: String(e?.message || 'failed').slice(0, 120) }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: true, texted });
  }
}
