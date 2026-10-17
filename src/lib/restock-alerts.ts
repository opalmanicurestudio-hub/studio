// src/lib/restock-alerts.ts — BACK-IN-STOCK EMAILS. Customers who asked to be told about a sold-out product get one
// email when it can be bought online again (after the store's holdback), and the request is closed. Run every few
// minutes by the shop's regular job.
import { brandedEmailHtml } from './email-template';
import { isStorefrontVisible, onlineSellable } from './retail-orders';

export async function sendRestockAlerts(db: any, t: string, origin: string): Promise<number> {
  const snap = await db.collection(`tenants/${t}/restockAlerts`).where('notifiedAt', '==', null).limit(300).get();
  if (snap.empty) return 0;
  const byProduct = new Map<string, any[]>();
  snap.docs.forEach((d: any) => { const a = d.data(); byProduct.set(a.productId, [...(byProduct.get(a.productId) || []), d]); });
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const shop = String(tenant.businessName || tenant.name || 'The shop');
  const { sendNotification } = await import('./notify');
  let sent = 0;
  for (const [pid, docs] of byProduct) {
    const it: any = (await db.doc(`tenants/${t}/inventory/${pid}`).get()).data();
    if (!it || !isStorefrontVisible(it) || onlineSellable(it) <= 0) continue;
    const url = origin ? `${origin}/shop/${t}/product/${pid}` : '';
    for (const d of docs.slice(0, Math.max(1, onlineSellable(it) * 5))) {
      const a = d.data();
      try {
        const html = brandedEmailHtml({ studioName: shop, title: `${it.name} is back`, bodyLines: [`Good news: ${it.name} is back in stock at ${shop}.`, 'You asked us to let you know. This is the only email we’ll send about it.', `Kind regards, ${shop}`], cta: url ? { label: 'Shop it now', url } : null, footerNote: `You asked ${shop} to tell you when this item was back.` });
        const r = await sendNotification(db, { tenantId: t, channel: 'email', to: a.email, subject: `${it.name} is back at ${shop}`, html, kind: 'restock_alert', recipientType: 'client' } as any);
        await d.ref.set({ notifiedAt: new Date().toISOString(), sent: !!r?.ok }, { merge: true });
        if (r?.ok) sent++;
      } catch { /* next run */ }
    }
  }
  return sent;
}
