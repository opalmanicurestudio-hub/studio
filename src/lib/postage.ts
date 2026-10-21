// src/lib/postage.ts — POSTAGE IN THE BOOKS. Every label bought through Shippo is a real cost, so it's recorded as a
// Shipping expense against the order, once (keyed to the Shippo transaction). Voiding the label records the money
// coming back. Server only.
export async function recordPostage(db: any, t: string, order: { id: string; orderNumber?: number }, shippoTxnId: string, cents: number, carrier: string): Promise<void> {
  if (!shippoTxnId || !(cents > 0)) return;
  const ref = db.doc(`tenants/${t}/transactions/postage-${shippoTxnId.replace(/[^\w-]/g, '')}`);
  try {
    await ref.create({ id: ref.id, tenantId: t, date: new Date().toISOString(), type: 'expense', context: 'Business', category: 'Shipping', taxBucket: 'expense',
      amount: Math.round(cents) / 100, description: `Postage: order #${String(order.orderNumber ?? '').padStart(4, '0')}`, clientOrVendor: carrier || 'Carrier', paymentMethod: 'Shippo', hasReceipt: false,
      retailOrderId: order.id, shippoTransactionId: shippoTxnId });
  } catch { /* already recorded */ }
}

/** The postage coming back for a voided label, once. `share`: the part of it that came back when only some of a label's
 *  boxes were voided (by box count, since one rate covers every box). */
export async function reversePostage(db: any, t: string, shippoTxnId: string, share = 1): Promise<void> {
  const part = Math.max(0, Math.min(1, Number(share) || 0));
  if (!shippoTxnId || !part) return;
  const key = shippoTxnId.replace(/[^\w-]/g, '');
  const orig = await db.doc(`tenants/${t}/transactions/postage-${key}`).get(); if (!orig.exists) return;
  const o: any = orig.data() || {};
  const ref = db.doc(`tenants/${t}/transactions/postage-void-${key}`);
  try {
    await ref.create({ id: ref.id, tenantId: t, date: new Date().toISOString(), type: 'income', context: 'Business', category: 'Shipping', taxBucket: 'refund',
      amount: Math.round((Number(o.amount) || 0) * part * 100) / 100, description: `Postage refund (${part < 1 ? 'some box labels voided' : 'label voided'}): ${String(o.description || '').replace(/^Postage: /, '')}`, clientOrVendor: o.clientOrVendor || 'Carrier', paymentMethod: 'Shippo', hasReceipt: false,
      retailOrderId: o.retailOrderId || null, shippoTransactionId: shippoTxnId, voidOf: orig.id });
  } catch { /* already recorded */ }
}

/** The price of a Shippo rate, in cents. */
export async function rateCents(apiKey: string, rateId: string): Promise<number> {
  try {
    const r = await fetch(`https://api.goshippo.com/rates/${encodeURIComponent(rateId)}`, { headers: { Authorization: `ShippoToken ${apiKey}` } });
    const d = await r.json().catch(() => ({})); const c = Math.round(parseFloat(d.amount) * 100);
    return Number.isFinite(c) ? c : 0;
  } catch { return 0; }
}
