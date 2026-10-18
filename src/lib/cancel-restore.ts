// src/lib/cancel-restore.ts — A CANCELLED ORDER GIVES BACK MORE THAN THE CARD PAYMENT. Whatever came off a gift card
// goes back onto that card, and whatever store credit was used comes back as new store credit. Once per order (the
// order is stamped), so a retry can never give it twice. Server only.

export async function restoreNonCardPayment(db: any, t: string, orderId: string, by: string): Promise<{ giftCents: number; creditCents: number }> {
  const ref = db.doc(`tenants/${t}/retailOrders/${orderId}`);
  const claim = await db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return null;
    const o: any = s.data() || {};
    if (o.stage !== 'cancelled' || o.nonCardRestoredAt) return null;
    const giftCents = o.giftSpentAt && o.giftCardId ? Math.max(0, Number(o.giftCardCents) || 0) : 0;
    const creditCents = Math.max(0, (Number(o.storeCreditRequestedCents) || 0) - (Number(o.creditShortfallCents) || 0));
    if (!giftCents && !creditCents) return null;
    tx.update(ref, { nonCardRestoredAt: new Date().toISOString(), nonCardRestored: { giftCents, creditCents } });
    return { o, giftCents, creditCents };
  });
  if (!claim) return { giftCents: 0, creditCents: 0 };
  const { o, giftCents, creditCents } = claim;
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const notes: string[] = [];
  if (giftCents > 0) {
    try { const { adjustGiftCard } = await import('./gift-cards'); const r: any = await adjustGiftCard(db, t, { id: String(o.giftCardId), kind: 'add', cents: giftCents, note: `Order ${num} cancelled`, by });
      notes.push(r?.ok ? `$${(giftCents / 100).toFixed(2)} back on gift card ${o.giftCardCode || ''}`.trim() : `Gift card $${(giftCents / 100).toFixed(2)} couldn’t be put back: ${r?.error || 'try again'}`); } catch { notes.push('Gift card couldn’t be put back. Needs a look.'); }
  }
  if (creditCents > 0) {
    const c = db.collection(`tenants/${t}/depositCredits`).doc();
    await c.set({ id: c.id, tenantId: t, clientId: o.clientId || null, clientEmail: String(o.customerEmail || '').toLowerCase().trim(), clientName: o.customerName || 'Guest',
      amountCents: creditCents, status: 'available', sourceRetailOrderId: orderId, sourceKind: 'order_cancelled', createdAt: new Date().toISOString() });
    notes.push(`$${(creditCents / 100).toFixed(2)} store credit given back`);
  }
  const ev = ref.collection('events').doc();
  await ev.set({ id: ev.id, type: 'note', at: new Date().toISOString(), actorId: 'system', actorName: by, meta: { kind: 'non_card_restored', text: notes.join(' · ') } });
  return { giftCents, creditCents };
}
