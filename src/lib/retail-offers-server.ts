// src/lib/retail-offers-server.ts — reading the shop's offers and "often bought together" pairs on the server
// (lib/retail-offers has the rules). Used by the catalog, the product page's data, the promo preview and checkout.

import { pairsFromOrders, readOffer, type Offer } from '@/lib/retail-offers';

/** The shop's live offers, each made safe to use; broken ones are left out. A read failure means no offers, never an error. */
export async function liveOffers(db: any, tenantId: string): Promise<Offer[]> {
  try {
    const snap = await db.collection(`tenants/${tenantId}/retailOffers`).where('status', '==', 'live').limit(200).get();
    return snap.docs.map((d: any) => readOffer(d.data() || {}, d.id)).filter(Boolean) as Offer[];
  } catch (e: any) {
    console.error('[offers] could not read offers for', tenantId, e?.message);
    return [];
  }
}

const DAY = 24 * 3600_000;

/** What customers buy together, from the last few hundred paid orders, worked out at most once a day and kept. */
export async function boughtTogether(db: any, tenantId: string, now = Date.now()): Promise<Record<string, string[]>> {
  const ref = db.doc(`tenants/${tenantId}/shopCache/pairs`);
  try {
    const cur = await ref.get();
    const c: any = cur.exists ? cur.data() || {} : null;
    if (c && Date.parse(String(c.computedAt || '')) > now - DAY && c.pairs && typeof c.pairs === 'object') return c.pairs;
    const snap = await db.collection(`tenants/${tenantId}/retailOrders`).orderBy('placedAt', 'desc').limit(400).get();
    const paid = snap.docs.map((d: any) => d.data() || {}).filter((o: any) => o.paidAt && o.isDraft !== true && o.stage !== 'placed' && o.stage !== 'cancelled');
    const pairs = pairsFromOrders(paid);
    await ref.set({ computedAt: new Date(now).toISOString(), orders: paid.length, pairs }).catch(() => {});
    return pairs;
  } catch (e: any) {
    console.error('[offers] could not work out bought-together for', tenantId, e?.message);
    return {};
  }
}
