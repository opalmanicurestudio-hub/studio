// src/lib/restock-alerts.ts — BACK-IN-STOCK EMAILS. Customers who asked to be told about a sold-out product get one
// email when it can be bought online again (after the store's holdback), and the request is closed. A listing is back
// when any of its variants is; a variant someone asked about, when that variant is (lib/variants). Run every few
// minutes by the shop's regular job.
import { brandedEmailHtml } from './email-template';
import { isStorefrontVisible } from './retail-orders';
import { canSell, listingStock, variantIdsOf } from './variants';

export async function sendRestockAlerts(db: any, t: string, origin: string, o: { send?: (db: any, m: any) => Promise<any> } = {}): Promise<number> {
  const snap = await db.collection(`tenants/${t}/restockAlerts`).where('notifiedAt', '==', null).limit(300).get();
  if (snap.empty) return 0;
  const byProduct = new Map<string, any[]>();
  snap.docs.forEach((d: any) => { const a = d.data(); byProduct.set(a.productId, [...(byProduct.get(a.productId) || []), d]); });
  const tenant: any = (await db.doc(`tenants/${t}`).get()).data() || {};
  const shop = String(tenant.businessName || tenant.name || 'The shop');
  const sendNotification = o.send || (await import('./notify')).sendNotification;
  const read = async (id: string) => { const s = await db.doc(`tenants/${t}/inventory/${id}`).get(); return s.exists ? { id, ...(s.data() || {}) } : null; };
  let sent = 0;
  for (const [pid, docs] of byProduct) {
    const it: any = await read(pid);
    if (!it) continue;
    // What can be sold of it now: a listing's variants together, a variant on its own (inside its listing).
    const listingId = String(docs[0].data().listingId || '');
    const listing: any = listingId ? await read(listingId) : null;
    let left = 0;
    if (listing) { if (!isStorefrontVisible(listing) || it.status === 'archived' || !variantIdsOf(listing).includes(pid)) continue; left = canSell(it); }
    else {
      if (!isStorefrontVisible(it)) continue;
      const vs = variantIdsOf(it); const byId = new Map<string, any>();
      for (const v of vs) { const x = await read(v); if (x) byId.set(v, x); }
      left = listingStock(it, byId);
    }
    if (left <= 0) continue;
    const name = String(docs[0].data().productName || it.name || 'It');
    for (const d of docs.slice(0, Math.max(1, left * 5))) {
      const a = d.data();
      const url = origin ? `${origin}/shop/${t}/product/${a.listingId || pid}${a.choiceId ? `?choice=${encodeURIComponent(a.choiceId)}` : ''}` : '';
      try {
        const html = brandedEmailHtml({ studioName: shop, title: `${name} is back`, bodyLines: [`Good news: ${name} is back in stock at ${shop}.`, 'You asked us to let you know. This is the only email we’ll send about it.', `Kind regards, ${shop}`], cta: url ? { label: 'Shop it now', url } : null, footerNote: `You asked ${shop} to tell you when this item was back.` });
        const r = await sendNotification(db, { tenantId: t, channel: 'email', to: a.email, subject: `${name} is back at ${shop}`, html, kind: 'restock_alert', recipientType: 'client' } as any);
        await d.ref.set({ notifiedAt: new Date().toISOString(), sent: !!r?.ok }, { merge: true });
        if (r?.ok) sent++;
      } catch { /* next run */ }
    }
  }
  return sent;
}
