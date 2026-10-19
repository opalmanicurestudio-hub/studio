// src/lib/retail-uncollected.ts — PICKUPS NOBODY COLLECTED. A ready order that's still on the shelf gets a friendly
// reminder, then a second one that says how long it's held, then a last-day notice. After that it shows in Problems
// for the team to put back on the shelf (refund or store credit, as the shop's policy says) or keep holding. Every
// message goes once: the order remembers how many it has had.
import { brandedEmailHtml } from './email-template';

import { holdUntil, noticeDue, noticeText, uncollectedPolicy } from './retail-uncollected-policy';
export { holdUntil, noticeDue, noticeText, uncollectedPolicy };
export type { UncollectedPolicy } from './retail-uncollected-policy';

/** Send whatever reminders are due for this shop. */
export async function sweepUncollected(db: any, t: string, origin: string): Promise<number> {
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const pol = uncollectedPolicy(tenant.retailSettings || {});
  const shop = String(tenant.businessName || tenant.name || 'The shop');
  const snap = await db.collection(`tenants/${t}/retailOrders`).where('stage', '==', 'ready').limit(200).get();
  const { sendNotification } = await import('./notify');
  let n = 0;
  for (const d of snap.docs) {
    const o = { ...(d.data() as any), id: d.id };
    const step = noticeDue(o, pol); if (!step) continue;
    // Claim the notice first, so two runs can't both send it.
    const claimed = await db.runTransaction(async (tx: any) => { const cur = (await tx.get(d.ref)).data() || {}; if ((Number(cur.uncollectedNotices) || 0) >= step || cur.stage !== 'ready') return false; tx.update(d.ref, { uncollectedNotices: step, uncollectedNoticeAt: new Date().toISOString() }); return true; });
    if (!claimed) continue;
    const m = noticeText(step, o, pol, shop);
    const link = origin ? `${origin}/shop/${t}/order/${o.id}` : '';
    if (o.customerPhone) { try { await sendNotification(db, { tenantId: t, channel: 'sms', to: o.customerPhone, text: `${shop}: ${m.sms}${link ? ` ${link}` : ''}`, kind: 'order_uncollected', orderId: o.id, recipientType: 'client', recipientId: o.clientId || null } as any); } catch { /* email still goes */ } }
    if (o.customerEmail) { try { await sendNotification(db, { tenantId: t, channel: 'email', to: o.customerEmail, subject: m.subject, kind: 'order_uncollected', orderId: o.id, recipientType: 'client', html: brandedEmailHtml({ studioName: shop, title: m.title, bodyLines: [...m.body, `Kind regards, ${shop}`], cta: link ? { label: 'View my order', url: link } : null, footerNote: `You are receiving this because your order with ${shop} is ready to collect.` }) } as any); } catch { /* best effort */ } }
    const ev = d.ref.collection('events').doc();
    await ev.set({ id: ev.id, type: 'note', at: new Date().toISOString(), actorId: 'system', actorName: 'Automatic', meta: { kind: 'uncollected_notice', text: step === 3 ? 'Sent the last-day notice' : `Sent pickup reminder ${step}` } });
    n++;
  }
  return n;
}
