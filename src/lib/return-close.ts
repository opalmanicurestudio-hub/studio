// src/lib/return-close.ts — A RETURN THAT NEVER COMES BACK IS CLOSED, NOT LEFT OPEN FOREVER. The team closes one from
// Problems (it isn't coming, or it was sorted another way), and the nightly check closes one nobody has sent after the
// shop's limit (Policies, "Close returns not sent back after", 30 days unless set): only when nothing on it has been
// checked in and the carrier has never scanned its label. Closing frees its items to be returned again, and the
// customer is told on their order page, with the team's note when there is one (a gift's recipient by email). Server
// only.

const MOVING = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];
const DAY = 86400e3;

/** Days after a return is started that the nightly check closes it when it was never sent (0: never). */
export function returnCloseDays(tenant: any): number {
  const v = tenant?.retailSettings?.policies?.returnCloseAfterDays;
  return v == null ? 30 : Math.max(0, Math.floor(Number(v) || 0));
}

/** Nothing on it has been checked in: it can still be closed. */
export const nothingCheckedIn = (r: any): boolean => !(Array.isArray(r?.lines) ? r.lines : []).some((l: any) => !!l?.disposition);

/** The carrier has scanned its label: it's on its way, or here. */
export const carrierHasIt = (r: any): boolean => MOVING.includes(String(r?.labelTrackingStatus || '').toUpperCase());

export type CloseWhy = 'team' | 'never_sent';

export async function closeReturn(db: any, t: string, returnId: string, o: { by: { id: string; name: string }; why: CloseWhy; note?: string; days?: number; now?: number }): Promise<{ ok: boolean; message: string }> {
  const rRef = db.doc(`tenants/${t}/retailReturns/${returnId}`);
  const now = new Date(o.now || Date.now()).toISOString();
  const note = String(o.note || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  let ret: any = null;
  try {
    const res = await db.runTransaction(async (tx: any) => {
      const s = await tx.get(rRef); if (!s.exists) return { ok: false, message: 'Return not found.' };
      const r: any = { ...(s.data() || {}), id: returnId };
      if (!['open', 'received'].includes(String(r.status))) return { ok: false, message: 'This return is already closed.' };
      if (!nothingCheckedIn(r)) return { ok: false, message: 'Something on this return has been checked in already. Finish checking it in instead.' };
      if (o.why === 'never_sent' && carrierHasIt(r)) return { ok: false, message: 'The carrier has it, so it stays open.' };
      tx.update(rRef, { status: 'cancelled', closedAt: now, closedBy: o.by.name, closedWhy: o.why, closedNote: note || null });
      if (r.orderId) {
        const ev = db.collection(`tenants/${t}/retailOrders/${r.orderId}/events`).doc();
        const items = (r.lines || []).map((l: any) => `${l.name || 'item'}${(Number(l.qty) || 1) > 1 ? ` × ${l.qty}` : ''}`).join(', ');
        tx.set(ev, { id: ev.id, type: 'note', at: now, actorId: o.by.id, actorName: o.by.name, meta: { kind: 'return_closed', returnId,
          text: `Return closed${o.why === 'never_sent' ? `: not sent back after ${o.days || 30} days` : ` by ${o.by.name}`} (${items})${note ? ` · ${note}` : ''}` } });
      }
      ret = r;
      return { ok: true, message: 'Return closed. They’ve been told on their order page.' };
    });
    if (res.ok && ret) await tell(db, t, ret, o, note).catch(() => {});
    return res;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Couldn’t close the return.' };
  }
}

async function tell(db: any, t: string, r: any, o: { why: CloseWhy; days?: number }, note: string) {
  const oSnap = r.orderId ? await db.doc(`tenants/${t}/retailOrders/${r.orderId}`).get() : null;
  const order: any = oSnap?.exists ? oSnap.data() || {} : {};
  const gr = r.giftRecipient && typeof r.giftRecipient === 'object' ? r.giftRecipient : null;
  const to = String(gr ? gr.email : order.customerEmail || order.customerPhone || '').trim();
  if (!to) return;
  const num = `#${String(r.orderNumber ?? order.orderNumber ?? '').padStart(4, '0')}`;
  const items = (r.lines || []).map((l: any) => String(l.name || 'item')).join(' and ') || 'your items';
  const text = [
    o.why === 'never_sent'
      ? `We’ve closed the return for ${items} on order ${num}, because it hasn’t been sent back ${o.days || 30} days after it was started.`
      : `We’ve closed the return for ${items} on order ${num}.`,
    note,
    'If you still want to send it back, reply here and we’ll help.',
  ].filter(Boolean).join(' ');
  const { brandedEmail, emailButton, getEmailBrand } = await import('./email-shell');
  const brand = await getEmailBrand(db, t);
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const link = origin && !gr ? `${origin}/shop/${t}/order/${r.orderId}` : '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = brandedEmail(brand, `<p style="font-size:14px;color:#334155;line-height:1.6">${esc(text)}</p>${link ? emailButton(link, 'Open my order', brand) : ''}`, { title: `Your return for order ${num}`, preheader: text.slice(0, 90) });
  const { sendNotification } = await import('./notify');
  const email = /@/.test(to);
  // On the buyer's order page, like every message about an order; a gift's recipient gets an email of their own.
  await sendNotification(db, gr
    ? { tenantId: t, channel: 'email', to, subject: `${brand.shopName}: your return was closed`, html, kind: 'return_closed', recipientType: 'client', recipientName: gr.name || null } as any
    : { tenantId: t, channel: email ? 'email' : 'sms', to, subject: `Your return for order ${num}`, html, text: `${text}${link ? ` ${link}` : ''}`, kind: 'shop_message', recipientType: 'client', recipientId: r.orderId, recipientName: order.customerName || null, orderId: r.orderId, cardKey: `return-closed-${r.id}`, nudgeLine: `An update about your return on order ${num}` } as any);
}

/** Nightly: returns started more than the shop's limit ago that were never sent (nothing checked in, no carrier scan). */
export async function closeStaleReturns(db: any, t: string, tenant: any, now = Date.now()): Promise<number> {
  const days = returnCloseDays(tenant);
  if (!days) return 0;
  const snap = await db.collection(`tenants/${t}/retailReturns`).where('status', '==', 'open').limit(300).get();
  let n = 0;
  for (const d of snap.docs) {
    const r: any = d.data() || {};
    const at = Date.parse(r.labelPurchasedAt || r.openedAt || '');
    if (!Number.isFinite(at) || now - at < days * DAY || carrierHasIt(r) || !nothingCheckedIn(r)) continue;
    const res = await closeReturn(db, t, d.id, { by: { id: 'system', name: 'Nightly check' }, why: 'never_sent', days, now });
    if (res.ok) n++;
  }
  return n;
}
