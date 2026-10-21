// src/lib/promo-codes-server.ts — finding a shop promo code, checking it (lib/promo-codes), and counting its use once an
// order is paid. Wrong guesses share the gift card guess limit, so codes can't be found by trying many.
import { evaluatePromo, normalizeCode, type PromoLine, type PromoResult } from '@/lib/promo-codes';

export async function findPromo(db: any, tenantId: string, code: string): Promise<any | null> {
  const c = normalizeCode(code); if (!c) return null;
  const snap = await db.collection(`tenants/${tenantId}/discounts`).where('code', '==', c).limit(3).get();
  const docs = snap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }));
  return docs.find((d: any) => d.appliesTo === 'shop' || d.appliesTo === 'both') || null;
}

/** Look up and check a code for this cart; counts a miss toward the guess limit. */
export async function checkPromo(db: any, tenantId: string, code: string, lines: PromoLine[], o: { email?: string; who: string }): Promise<PromoResult> {
  const { codeTries } = await import('@/lib/gift-cards');
  const none: PromoResult = { ok: false, cents: 0, freeShipping: false, byLine: {} };
  if ((await codeTries(db, tenantId, `promo_${o.who}`, false)).blocked) return { ...none, error: 'Too many codes have been tried. Please try again in 15 minutes.' };
  const d = await findPromo(db, tenantId, code);
  if (!d) { await codeTries(db, tenantId, `promo_${o.who}`, true); return { ...none, error: 'We couldn’t find that code.' }; }
  return evaluatePromo(d, lines, { email: o.email });
}

/**
 * Count a paid order's code: one more use, who used it (for once-per-customer codes), and what it brought in and gave
 * away. Runs once per order (the order is marked), so a repeated payment notice can't count twice.
 */
export async function countPromoUse(db: any, tenantId: string, orderId: string): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  const orderRef = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
  await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(orderRef)).data();
    const p = o?.promo; if (!p?.discountId || o.promoCountedAt) return;
    const dRef = db.doc(`tenants/${tenantId}/discounts/${String(p.discountId)}`);
    const d = await tx.get(dRef); if (!d.exists) return;
    const email = String(o.customerEmail || '').trim().toLowerCase();
    tx.set(dRef, {
      usageCount: FieldValue.increment(1),
      shopUses: FieldValue.increment(1),
      shopRevenueCents: FieldValue.increment(Math.max(0, Number(o.totalCents) || 0)),
      shopDiscountCents: FieldValue.increment(Math.max(0, Number(p.cents) || 0) + Math.max(0, Number(p.shippingSavedCents) || 0)),
      ...(email ? { usedByEmails: FieldValue.arrayUnion(email) } : {}),
      lastUsedAt: new Date().toISOString(),
    }, { merge: true });
    tx.set(orderRef, { promoCountedAt: new Date().toISOString() }, { merge: true });
  });
}
