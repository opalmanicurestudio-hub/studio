// ─── /api/retail/changes-notify ─────────────────────────────────────────────────────────────────────────────────────────
// POST { tenantId, orderId } — WHAT CHANGED WHILE IT WAS PACKED, told once (lib/pack-changes): each item that was out
// (swapped for their backup or the best match, refunded, or coming on its own), and what comes back to their card in
// one refund. For an order that's shipped or delivered; an order collected hears it in its ready message instead
// (api/retail/ready-notify, api/retail/curbside-notify). Sent by the queue (lib/order-outbox) when packing is done.
// Accepts no recipient or words from the caller: it reads the order and writes to the customer on it, once (a marker
// on the order's timeline), and says nothing when nothing changed.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { staffOrServer } from '@/lib/route-guard';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';
import { sendNotification } from '@/lib/notify';
import { changesNote } from '@/lib/pack-changes';

export const dynamic = 'force-dynamic';

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,120}$/.test(orderId)) return NextResponse.json({ ok: false, reason: 'missing_ids' }, { status: 400 });
  if (!(await staffOrServer(req, tenantId))) return NextResponse.json({ ok: false, reason: 'not_allowed' }, { status: 401 });
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  const marker = ref.collection('events').doc('changes-notify');
  // Claimed before anything goes out, so a retry or a second call sends nothing more; given back if nothing went.
  const claimed = await db.runTransaction(async (tx: any) => { const m = await tx.get(marker); if (m.exists) return false; tx.set(marker, { id: 'changes-notify', type: 'note', at: new Date().toISOString(), actorId: 'system', actorName: 'Automatic', meta: { kind: 'changes_notified', text: 'Told the customer what changed while it was packed' } }); return true; });
  if (!claimed) return NextResponse.json({ ok: true, skipped: 'already_sent' });
  const release = () => marker.delete().catch(() => null);
  let texted = false; let emailed = false; let failed = false;
  try {
    const o: any = (await ref.get()).data() || {};
    const note = changesNote(o);
    if (!note.short) { await release(); return NextResponse.json({ ok: true, skipped: 'nothing_changed' }); }
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
    const first = String(o.customerName || '').trim().split(/\s+/)[0] || 'there';
    const shop = String(t.businessName || t.name || 'the shop');
    const base = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
    const link = `${base}/shop/${tenantId}/order/${orderId}`;
    if (o.customerPhone) {
      const r = await sendNotification(db, { tenantId, channel: 'sms', to: String(o.customerPhone), text: `Hi ${first}, your order ${num} from ${shop} is packed. ${note.short} Your order: ${link}`, kind: 'order_changes', recipientType: 'client', recipientId: orderId, orderId } as any);
      texted = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (o.customerEmail) {
      const brand = await getEmailBrand(db, tenantId);
      const html = brandedEmail(brand, `
        <p style="font-size:14px;color:#16171a;margin:0 0 8px">Hi ${esc(first)},</p>
        <p style="font-size:14px;color:#334155;line-height:1.6">Your order is packed. Here’s what we did for the items that were out, as you asked at checkout.</p>
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:12px 0">${note.lines.map((x) => esc(x)).join('<br>')}</p>
        ${emailButton(link, 'View my order', brand)}
        <p style="font-size:13px;color:#6d7075;line-height:1.6">Something not right once it arrives? Start a return from your order page.</p>`,
        { title: 'Your order is packed', tag: `Order ${num}`, preheader: `What changed in order ${num}.` });
      const r = await sendNotification(db, { tenantId, channel: 'email', to: String(o.customerEmail), subject: `Order ${num}: what changed`, html, kind: 'order_changes', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId } as any);
      emailed = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (!texted && !emailed && failed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text and email services didn’t take it.' }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: texted || emailed, texted });
  } catch (e: any) {
    console.error('[changes-notify]', String(e?.message || e).slice(0, 160));
    if (!texted && !emailed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: true, texted });
  }
}
