// src/lib/store-credit.ts — STORE CREDIT, used when a sale is paid (never before). The client's credits live on their
// record (client.storeCredits + totalStoreCredit). Checkout (/api/checkout/complete) uses credit only once the sale is
// recorded, so an abandoned or failed sale never costs the client anything. Soonest-ending first; a credit bigger than
// what's needed is used for that much and the rest stays available with the same end date.
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function availableCredits(client: any, now = Date.now()): any[] {
  const list = Array.isArray(client?.storeCredits) ? client.storeCredits : [];
  return list.filter((c: any) => (!c.status || c.status === 'available') && !c.usedAt && !(c.expiresAt && ms(c.expiresAt) < now) && Number(c.amount) > 0)
    .sort((a: any, b: any) => (ms(a.expiresAt) || Infinity) - (ms(b.expiresAt) || Infinity) || ms(a.createdAt) - ms(b.createdAt));
}
export const creditBalance = (client: any, now = Date.now()) => r2(availableCredits(client, now).reduce((n: number, c: any) => n + (Number(c.amount) || 0), 0));

/** Use up to `amount` dollars of the client's credit for this sale. Returns what was actually used. */
export async function useCredit(db: any, tenantId: string, clientId: string, amount: number, o: { appointmentId?: string | null; checkoutSessionId?: string | null; by?: string | null }, now = Date.now()): Promise<{ applied: number; ids: string[] }> {
  const want = r2(Math.max(0, Number(amount) || 0)); if (!want || !clientId) return { applied: 0, ids: [] };
  const ref = db.doc(`tenants/${tenantId}/clients/${clientId}`); const at = new Date(now).toISOString();
  const run = async (tx: any) => {
    const snap = await tx.get(ref); const c: any = snap.data() || {}; const all = Array.isArray(c.storeCredits) ? c.storeCredits : [];
    const order = availableCredits(c, now); let left = want; const ids: string[] = []; const extra: any[] = [];
    const byId = new Map<string, any>();
    for (const x of order) { if (left <= 0.0001) break; const amt = Number(x.amount) || 0; const take = r2(Math.min(amt, left)); left = r2(left - take); ids.push(x.id);
      const rest = r2(amt - take);
      byId.set(x.id, { ...x, status: 'used', usedAt: at, usedOnAppointmentId: o.appointmentId || null, usedOnCheckout: o.checkoutSessionId || null, ...(rest > 0 ? { amount: take, amountCents: Math.round(take * 100), originalAmount: amt } : {}) });
      if (rest > 0) extra.push({ ...x, id: `${x.id}_r${now.toString(36)}`, amount: rest, amountCents: Math.round(rest * 100), status: 'available', usedAt: null, usedOnAppointmentId: null, splitFrom: x.id }); }
    const applied = r2(want - left); if (!applied) return { applied: 0, ids: [] };
    await tx.set(ref, { storeCredits: [...all.map((x: any) => byId.get(x.id) || x), ...extra], totalStoreCredit: Math.max(0, r2((Number(c.totalStoreCredit) || 0) - applied)) }, { merge: true });
    return { applied, ids };
  };
  const res = db.runTransaction ? await db.runTransaction(run) : await run({ get: (r: any) => r.get(), set: (r: any, v: any, opt: any) => r.set(v, opt) });
  if (res.applied > 0) {
    const tx = db.collection(`tenants/${tenantId}/transactions`).doc();
    await tx.set({ id: tx.id, tenantId, appointmentId: o.appointmentId || null, checkoutSessionId: o.checkoutSessionId || null, clientId, type: 'store_credit_redemption', category: 'Store Credit Applied', amount: -res.applied, amountCents: -Math.round(res.applied * 100), status: 'applied', creditIdsUsed: res.ids, appliedBy: o.by || 'checkout', createdAt: at }).catch(() => {});
  }
  return res;
}
