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
import { FieldValue } from 'firebase-admin/firestore';
import { EVERY_ITEM_OUT, changesKey, changesNote, packChanges } from '@/lib/pack-changes';

export const dynamic = 'force-dynamic';

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,120}$/.test(orderId)) return NextResponse.json({ ok: false, reason: 'missing_ids' }, { status: 400 });
  if (!(await staffOrServer(req, tenantId))) return NextResponse.json({ ok: false, reason: 'not_allowed' }, { status: 401 });
  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  // Which changes this message is about, read before anything is claimed: the ones the customer hasn't heard about yet;
  // or, for an order closed because every item was out, the whole order once.
  const o0: any = (await ref.get()).data() || {};
  const closed = o0.stage === 'cancelled' && o0.cancelReason === EVERY_ITEM_OUT;
  const cs = packChanges(o0, { all: closed });
  if (!cs.length) return NextResponse.json({ ok: true, skipped: 'nothing_changed' });
  const marker = ref.collection('events').doc(`changes-notify-${closed ? 'closed' : changesKey(cs)}`);
  // Claimed before anything goes out, so a retry or a second call about the same changes sends nothing more; given back
  // if nothing went.
  const claimed = await db.runTransaction(async (tx: any) => { const m = await tx.get(marker); if (m.exists) return false; tx.set(marker, { id: marker.id, type: 'note', at: new Date().toISOString(), actorId: 'system', actorName: 'Automatic', meta: { kind: 'changes_notified', text: closed ? 'Told the customer every item was out and the order is closed' : 'Told the customer what changed while it was packed' } }); return true; });
  if (!claimed) return NextResponse.json({ ok: true, skipped: 'already_sent' });
  const release = () => marker.delete().catch(() => null);
  let texted = false; let emailed = false; let failed = false;
  try {
    const o: any = (await ref.get()).data() || {};
    const note = changesNote(o, { all: closed });
    if (!note.short) { await release(); return NextResponse.json({ ok: true, skipped: 'nothing_changed' }); }
    // Every item out: everything they paid comes back, the delivery or shipping too (lib/retail-fulfill cancelOrder).
    const backCents = Math.max(0, Number(o.refundedCents) || 0) + Math.max(0, Number(o.pendingRefundCents) || 0);
    const closedMoney = !backCents ? '' : (Number(o.pendingRefundCents) || 0) > 0
      ? `$${(backCents / 100).toFixed(2)} comes back to your card once the shop sends it. You’ll get an email when it does.`
      : `$${(backCents / 100).toFixed(2)} is on its way back to your card. It shows in 5 to 10 business days.`;
    const packing = ['placed', 'paid', 'picking'].includes(String(o.stage));
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
    const first = String(o.customerName || '').trim().split(/\s+/)[0] || 'there';
    const shop = String(t.businessName || t.name || 'the shop');
    const base = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
    const link = `${base}/shop/${tenantId}/order/${orderId}`;
    if (o.customerPhone) {
      const text = closed ? `Hi ${first}, every item in your order ${num} from ${shop} was out, so we’ve closed it. ${closedMoney} Sorry about that. Your order: ${link}`
        : `Hi ${first}, ${packing ? `we’re getting your order ${num} from ${shop} ready.` : `your order ${num} from ${shop} is packed.`} ${note.short} Your order: ${link}`;
      const r = await sendNotification(db, { tenantId, channel: 'sms', to: String(o.customerPhone), text, kind: 'order_changes', recipientType: 'client', recipientId: orderId, orderId } as any);
      texted = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (o.customerEmail) {
      const brand = await getEmailBrand(db, tenantId);
      const html = brandedEmail(brand, `
        <p style="font-size:14px;color:#16171a;margin:0 0 8px">Hi ${esc(first)},</p>
        <p style="font-size:14px;color:#334155;line-height:1.6">${closed ? 'Every item in your order was out when we went to pack it, so we’ve closed the order. Sorry about that.' : packing ? 'We’re getting your order ready. Here’s what we did for the items that were out, as you asked at checkout.' : 'Your order is packed. Here’s what we did for the items that were out, as you asked at checkout.'}</p>
        <p style="font-size:14px;color:#334155;line-height:1.6;margin:12px 0">${(closed ? [...note.lines.filter((x) => !/^\$/.test(x)), ...(closedMoney ? [closedMoney] : [])] : note.lines).map((x) => esc(x)).join('<br>')}</p>
        ${emailButton(link, 'View my order', brand)}
        ${closed ? '' : '<p style="font-size:13px;color:#6d7075;line-height:1.6">Something not right once it arrives? Start a return from your order page.</p>'}`,
        { title: closed ? 'Your order is closed' : packing ? 'An update on your order' : 'Your order is packed', tag: `Order ${num}`, preheader: `What changed in order ${num}.` });
      const r = await sendNotification(db, { tenantId, channel: 'email', to: String(o.customerEmail), subject: `Order ${num}: what changed`, html, kind: 'order_changes', recipientType: 'client', recipientId: orderId, recipientName: o.customerName || null, orderId } as any);
      emailed = r.ok === true; if (r.status === 'failed') failed = true;
    }
    if (!texted && !emailed && failed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true, why: 'The text and email services didn’t take it.' }, { status: 503 }); }
    // Told: these changes aren't told again (in the ready message, or when the order is packed).
    if (texted || emailed) await ref.update({ changesToldLines: FieldValue.arrayUnion(...cs.map((c) => c.lineId).filter(Boolean)) }).catch(() => null);
    return NextResponse.json({ ok: true, sent: texted || emailed, texted });
  } catch (e: any) {
    console.error('[changes-notify]', String(e?.message || e).slice(0, 160));
    if (!texted && !emailed) { await release(); return NextResponse.json({ ok: false, sent: false, retry: true }, { status: 503 }); }
    return NextResponse.json({ ok: true, sent: true, texted });
  }
}
