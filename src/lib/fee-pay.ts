// src/lib/fee-pay.ts — PAYING FEES WHEN THE CLIENT ISN'T AT THE COUNTER (server).
//   chargeFeesNow   — the front desk charges the card on file for chosen fees (approval rules checked by the route)
//   feePayLink      — a secure Stripe link for exactly those fees, texted / emailed to the client
//   settleFeesPaid  — what happens once they're paid (either way): each fee comes off their list and balance, is
//                     recorded in the books like any fee payment, and a full receipt is made — once only, however
//                     many times it's called (a link opened twice, a webhook retried).
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plain = (r: any) => String(r || 'Fee').replace(/\s*[—–-]\s*(auto-charge failed|card declined|no card on file|payments not connected).*$/i, '').slice(0, 120);

export async function settleFeesPaid(db: any, tenantId: string, x: { clientId: string; feeIds: string[]; how: 'card_on_file' | 'link'; paymentIntentId: string; by: string; brand?: string | null; last4?: string | null }) {
  const T = `tenants/${tenantId}`; const cRef = db.doc(`${T}/clients/${x.clientId}`); const now = new Date().toISOString();
  const receiptRef = db.doc(`${T}/receipts/fees_${x.paymentIntentId}`);   // one receipt per payment — a retry finds it
  let paid: any[] = []; let already = false;
  await db.runTransaction(async (tx: any) => {
    if ((await tx.get(receiptRef)).exists) { already = true; return; }
    const c: any = (await tx.get(cRef)).data(); if (!c) return;
    const list: any[] = Array.isArray(c.unpaidFees) ? c.unpaidFees : [];
    paid = list.filter((f) => x.feeIds.includes(f.feeId)); if (!paid.length) return;
    const total = Math.round(paid.reduce((n, f) => n + num(f.feeAmount), 0) * 100) / 100;
    tx.update(cRef, { unpaidFees: list.filter((f) => !x.feeIds.includes(f.feeId)), outstandingBalance: Math.max(0, Math.round((num(c.outstandingBalance) - total) * 100) / 100) });
    const method = x.how === 'link' ? 'Payment link (Stripe)' : 'Card on file (Stripe) — front desk';
    for (const f of paid) tx.set(db.doc(`${T}/transactions/feepay_${f.feeId}`), { id: `feepay_${f.feeId}`, date: now, description: `${plain(f.reason)} — paid`, clientOrVendor: c.name || 'Client', clientId: x.clientId,
      type: 'income', context: 'Business', category: 'Fees', taxBucket: 'revenue', amount: num(f.feeAmount), paymentMethod: method, stripePaymentIntentId: x.paymentIntentId, feeId: f.feeId, receiptId: receiptRef.id, createdAt: now });
    const rid = () => Math.random().toString(36).slice(2, 10);
    tx.set(receiptRef, { id: receiptRef.id, date: now, clientId: x.clientId, clientName: c.name || null, paidBy: c.name || null, cashierName: x.by, paymentMethod: 'card', subtotal: total, tax: 0, tip: 0, discount: 0, total,
      stripePaymentIntentId: x.paymentIntentId, viewKey: `${rid()}${rid()}`, lineItems: paid.map((f) => ({ label: plain(f.reason), amount: num(f.feeAmount) })),
      detail: { number: receiptRef.id.slice(-6).toUpperCase(), lines: [], fees: paid.map((f) => ({ label: plain(f.reason), amount: num(f.feeAmount), date: f.appointmentDate || null })), tipShares: [],
        payments: [{ method: x.how === 'link' ? 'card' : 'card_on_file', brand: x.brand || null, last4: x.last4 || null, amount: total, tip: 0 }], depositUsed: 0, storeCredit: 0, cardSurcharge: 0 },
      source: x.how === 'link' ? 'fee_pay_link' : 'fee_card_on_file' });
  });
  if (!already && paid.length && x.how === 'link') { try { const { recordCharge } = await import('@/lib/charge-records'); await recordCharge(db, tenantId, { kind: 'fees_pay_link', clientId: x.clientId, cents: Math.round(paid.reduce((n, f) => n + num(f.feeAmount), 0) * 100), reason: `Paid by link — ${paid.map((f) => plain(f.reason)).join(', ')}`, paymentIntentId: x.paymentIntentId, receiptId: receiptRef.id, by: x.by, needs: ['booking_policies'] }); } catch { /* fine */ } }
  return { already, paidCents: Math.round(paid.reduce((n, f) => n + num(f.feeAmount), 0) * 100), receiptId: receiptRef.id, fees: paid };
}

/** Charge the card on file for these fees, now. Locks them first so automatic collection can't take them at the same moment. */
export async function chargeFeesNow(db: any, stripe: any, tenantId: string, tenant: any, x: { clientId: string; feeIds: string[]; by: string; approvedBy?: string | null }) {
  const T = `tenants/${tenantId}`; const cRef = db.doc(`${T}/clients/${x.clientId}`); const nowIso = new Date().toISOString();
  let locked: any[] = []; let client: any = null;
  await db.runTransaction(async (tx: any) => {
    client = (await tx.get(cRef)).data(); if (!client) return; const list: any[] = Array.isArray(client.unpaidFees) ? client.unpaidFees : [];
    const fresh = (f: any) => !f.collectingAt || Date.now() - Date.parse(f.collectingAt) > 10 * 60000;
    locked = list.filter((f) => x.feeIds.includes(f.feeId) && fresh(f));
    if (locked.length) tx.update(cRef, { unpaidFees: list.map((f) => (locked.some((l) => l.feeId === f.feeId) ? { ...f, collectingAt: nowIso } : f)) });
  });
  if (!client) return { ok: false, error: 'Client not found.' };
  if (!locked.length) return { ok: false, error: 'Those fees are already paid, or being charged right now.' };
  const unlock = async () => db.runTransaction(async (tx: any) => { const c: any = (await tx.get(cRef)).data(); if (!c) return; tx.update(cRef, { unpaidFees: (c.unpaidFees || []).map((f: any) => (locked.some((l) => l.feeId === f.feeId) ? { ...f, collectingAt: null } : f)) }); });
  const card = client.cardOnFile || {};
  if (!card.customerId || !card.paymentMethodId) { await unlock(); return { ok: false, error: 'There’s no card on file for this client.' }; }
  const cents = Math.round(locked.reduce((n, f) => n + num(f.feeAmount), 0) * 100); const ids = locked.map((f) => f.feeId).sort();
  let intent: any = null;
  try {
    intent = await stripe.paymentIntents.create({ amount: cents, currency: 'usd', customer: card.customerId, payment_method: card.paymentMethodId, off_session: true, confirm: true,
      description: locked.map((f) => plain(f.reason)).join(', ').slice(0, 300), ...(client.email ? { receipt_email: client.email } : {}),
      metadata: { tenantId, clientId: x.clientId, feeIds: ids.join(','), kind: 'arrears_fee', source: 'front_desk_card_on_file' } },
      { stripeAccount: tenant.stripeAccountId, idempotencyKey: `desk-fees-${tenantId}-${x.clientId}-${ids.join('.')}` });
  } catch (e: any) {
    await unlock();
    const code = String(e?.code || e?.decline_code || ''); const msg = /authentication_required/.test(code) ? 'Their bank needs them to approve it — text them a pay link instead.'
      : /insufficient_funds/.test(code) ? 'Declined — not enough funds.' : /expired/.test(code) ? 'Their card on file has expired.' : 'The card was declined.';
    return { ok: false, error: msg };
  }
  if (intent?.status !== 'succeeded') { await unlock(); return { ok: false, error: 'The charge didn’t complete — nothing was taken.' }; }
  const s = await settleFeesPaid(db, tenantId, { clientId: x.clientId, feeIds: ids, how: 'card_on_file', paymentIntentId: intent.id, by: x.by, brand: card.brand || null, last4: card.last4 || null });
  try { const { recordCharge } = await import('@/lib/charge-records'); await recordCharge(db, tenantId, { kind: 'fees_card_on_file', clientId: x.clientId, cents, reason: `Charged at the front desk — ${locked.map((f) => plain(f.reason)).join(', ')}`, paymentIntentId: intent.id, receiptId: s.receiptId, by: x.by, approvedBy: (x as any).approvedBy || null, needs: ['booking_policies', 'card_on_file'] }); } catch { /* fine */ }
  try { const { tellClient } = await import('@/lib/fee-collection'); await tellClient(db, tenantId, tenant, x.clientId, client, cents / 100, locked.map((f) => plain(f.reason)).join(', ')); } catch { /* the charge stands */ }
  return { ok: true, paidCents: cents, receiptId: s.receiptId, card: card.last4 ? `${card.brand || 'Card'} ••${card.last4}` : 'their card on file' };
}

/** A secure link for exactly these fees (Stripe Checkout on the business's account). Paid → the webhook settles them. */
export async function feePayLink(db: any, stripe: any, tenantId: string, tenant: any, x: { clientId: string; feeIds: string[]; origin: string }) {
  const c: any = (await db.doc(`tenants/${tenantId}/clients/${x.clientId}`).get()).data(); if (!c) return { ok: false, error: 'Client not found.' };
  const fees = (Array.isArray(c.unpaidFees) ? c.unpaidFees : []).filter((f: any) => x.feeIds.includes(f.feeId));
  if (!fees.length) return { ok: false, error: 'Those fees are already paid.' };
  const session = await stripe.checkout.sessions.create({ mode: 'payment', ...(c.email ? { customer_email: c.email } : {}),
    line_items: fees.map((f: any) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(num(f.feeAmount) * 100), product_data: { name: plain(f.reason) } } })),
    metadata: { type: 'fee_payment', tenantId, clientId: x.clientId, feeIds: fees.map((f: any) => f.feeId).join(',') },
    payment_intent_data: { metadata: { type: 'fee_payment', tenantId, clientId: x.clientId } },
    success_url: `${x.origin}/pay/thanks?b=${encodeURIComponent(tenant?.name || '')}`, cancel_url: `${x.origin}/pay/thanks?b=${encodeURIComponent(tenant?.name || '')}&c=1`,
    expires_at: Math.floor(Date.now() / 1000) + 23 * 3600 }, { stripeAccount: tenant.stripeAccountId });
  return { ok: true, url: session.url as string, cents: Math.round(fees.reduce((n: number, f: any) => n + num(f.feeAmount), 0) * 100), client: c };
}

/** The business's rule for charging a saved card when the client isn't here (Settings → Fees & credit). */
export function cardChargeRule(tenant: any) {
  const r: any = tenant?.cardOnFileCharge || {}; const mode = ['off', 'manager', 'limit'].includes(r.mode) ? r.mode : 'manager';
  return { mode, limitCents: Math.max(0, Math.round(num(r.limitCents))) } as { mode: 'off' | 'manager' | 'limit'; limitCents: number };
}

