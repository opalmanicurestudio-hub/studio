import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { staffOrServer } from '@/lib/route-guard';
import { sendNotification } from '@/lib/notify';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';
import { tenantTimeZone } from '@/lib/tenant-time';

// ─── /api/retail/collected-notify ───────────────────────────────────────────
// "Alex collected your order" — when someone the customer named collected a pickup order for them (the handoff
// records who, lib/pickup-pass). Sent once per order: the order records collectedNotifiedAt in a transaction before
// anything goes out, and gives it back when neither the text nor the email went, answering retry: true so the queue
// that sent it (lib/order-outbox) tries later. Posted on the order page like every order message (lib/order-inbox).

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
      if (d.stage !== 'completed' || d.handoff?.collectedBy !== 'someone_else' || d.collectedNotifiedAt) return null;
      txn.update(ref, { collectedNotifiedAt: stamp });
      return d;
    });
    if (!o) return NextResponse.json({ ok: true, sent: false });
    release = async () => { await db.runTransaction(async (txn: any) => { const s = await txn.get(ref); if (s.exists && (s.data() as any)?.collectedNotifiedAt === stamp) txn.update(ref, { collectedNotifiedAt: null }); }).catch(() => {}); };

    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
    const first = String(o.customerName || '').trim().split(/\s+/)[0] || 'there';
    const who = String(o.handoff?.collectorName || 'Someone you named').trim();
    const shop = String(t.businessName || t.name || 'the shop');
    const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
    const link = `${origin}/shop/${tenantId}/order/${orderId}`;
    const when = (() => { try { return new Date(String(o.handoff?.at || o.completedAt || stamp)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenantTimeZone(t) }); } catch { return ''; } })();
    const line = `${who} collected your order ${num} from ${shop}${when ? ` at ${when}` : ''}.`;

    if (o.customerPhone && o.textsOff !== true) {
      const r = await sendNotification(db, { tenantId, channel: 'sms', to: String(o.customerPhone), text: `Hi ${first}, ${line} Not expected? Reply on your order page: ${link}`, kind: 'order_collected', recipientType: 'client', recipientId: orderId, orderId } as any);
      texted = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (o.customerEmail) {
      const brand = await getEmailBrand(db, tenantId);
      const html = brandedEmail(brand, `
        <p style="font-size:14px;color:#16171a;margin:0 0 8px">Hi ${esc(first)},</p>
        <p style="font-size:14px;color:#334155;line-height:1.6">${esc(line)}</p>
        <p style="font-size:13px;color:#6d7075;line-height:1.6">Weren’t expecting this? Send us a message on your order page and we’ll look into it straight away.</p>
        ${emailButton(link, 'View my order', brand)}`,
        { title: 'Your order was collected', tag: `Order ${num}`, preheader: esc(line) });
      const r = await sendNotification(db, { tenantId, channel: 'email', to: String(o.customerEmail), subject: `Your order ${num} was collected`, html, kind: 'order_collected', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null });
      emailed = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (!texted && !emailed && failed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text and email services didn’t take it.' }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: texted || emailed });
  } catch (e: any) {
    console.error('[collected-notify]', e?.message);
    if (!texted && !emailed) { if (release) await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: String(e?.message || 'failed').slice(0, 120) }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: true });
  }
}
