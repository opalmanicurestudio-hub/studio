// src/lib/postage.ts — POSTAGE IN THE BOOKS. Every label bought through Shippo is a real cost, so it's recorded as a
// Shipping expense against the order, once (keyed to the Shippo transaction). Money coming back is recorded when Shippo
// confirms it, box by box (lib/label-records follows each refund), and a carrier's later adjustment is recorded when it
// shows up on Shippo's invoice. Server only.
const ref = (db: any, t: string, id: string) => db.doc(`tenants/${t}/transactions/${id.replace(/[^\w-]/g, '')}`);
const num = (o: { orderNumber?: number | null }) => `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
/** The entry was there already (written once, by an earlier run): that's success, not a failure. */
const already = (e: any) => e?.code === 6 || /already.exists/i.test(String(e?.message || e?.details || ''));

export async function recordPostage(db: any, t: string, order: { id: string; orderNumber?: number }, shippoTxnId: string, cents: number, carrier: string): Promise<void> {
  if (!shippoTxnId || !(cents > 0)) return;
  const r = ref(db, t, `postage-${shippoTxnId}`);
  try {
    await r.create({ id: r.id, tenantId: t, date: new Date().toISOString(), type: 'expense', context: 'Business', category: 'Shipping', taxBucket: 'expense',
      amount: Math.round(cents) / 100, description: `Postage: order ${num(order)}`, clientOrVendor: carrier || 'Carrier', paymentMethod: 'Shippo', hasReceipt: false,
      retailOrderId: order.id, shippoTransactionId: shippoTxnId });
  } catch (e) { if (!already(e)) console.error('[postage] not recorded', t, shippoTxnId, String((e as any)?.message || e).slice(0, 200)); }
}

/** A box's postage back, once Shippo has confirmed the refund. `box`: which box, when the label covered several. True
 *  once it's in the books (now or before); false if it couldn't be written, so the caller tries again later. */
export async function recordPostageRefund(db: any, t: string, order: { id: string; orderNumber?: number | null }, boxTxnId: string, cents: number, carrier: string, box = ''): Promise<boolean> {
  if (!boxTxnId || !(cents > 0)) return true;
  const r = ref(db, t, `postage-refund-${boxTxnId}`);
  try {
    await r.create({ id: r.id, tenantId: t, date: new Date().toISOString(), type: 'income', context: 'Business', category: 'Shipping', taxBucket: 'refund',
      amount: Math.round(cents) / 100, description: `Postage refund: order ${num(order)}${box ? ` (${box})` : ''}`, clientOrVendor: carrier || 'Carrier', paymentMethod: 'Shippo', hasReceipt: false,
      retailOrderId: order.id || null, shippoTransactionId: boxTxnId });
    return true;
  } catch (e) { return already(e); }
}

/** A carrier's adjustment to a label, from Shippo's invoice: more postage owed (positive) or some back (negative). True
 *  once it's in the books (now or before). */
export async function recordCarrierCharge(db: any, t: string, order: { id: string; orderNumber?: number | null }, key: string, boxTxnId: string, cents: number, carrier: string, why = ''): Promise<boolean> {
  if (!key || !cents) return true;
  const r = ref(db, t, `postage-adj-${key}`);
  try {
    await r.create({ id: r.id, tenantId: t, date: new Date().toISOString(), type: cents > 0 ? 'expense' : 'income', context: 'Business', category: 'Shipping', taxBucket: cents > 0 ? 'expense' : 'refund',
      amount: Math.round(Math.abs(cents)) / 100, description: `Carrier adjustment: order ${num(order)}${why ? ` (${why.slice(0, 120)})` : ''}`, clientOrVendor: carrier || 'Carrier', paymentMethod: 'Shippo', hasReceipt: false,
      retailOrderId: order.id || null, shippoTransactionId: boxTxnId });
    return true;
  } catch (e) { return already(e); }
}

/** Earlier way of recording a void: the postage back the moment a label was voided. Kept for labels voided that way;
 *  new voids wait for Shippo's confirmation (recordPostageRefund). */
export async function reversePostage(db: any, t: string, shippoTxnId: string, share = 1): Promise<void> {
  const part = Math.max(0, Math.min(1, Number(share) || 0));
  if (!shippoTxnId || !part) return;
  const key = shippoTxnId.replace(/[^\w-]/g, '');
  const orig = await db.doc(`tenants/${t}/transactions/postage-${key}`).get(); if (!orig.exists) return;
  const o: any = orig.data() || {};
  const r = db.doc(`tenants/${t}/transactions/postage-void-${key}`);
  try {
    await r.create({ id: r.id, tenantId: t, date: new Date().toISOString(), type: 'income', context: 'Business', category: 'Shipping', taxBucket: 'refund',
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
