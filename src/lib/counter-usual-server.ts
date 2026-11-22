// src/lib/counter-usual-server.ts — THEIR USUAL, KEPT (server; design board "Their usual"; lib/counter-usual). A paid
// order with a regular's rewards code (their code, never a number someone only said) adds what was on it to the small
// tally on their record, once: lib/counter-points earnForOrder calls this as it earns (and lib/counter-server payOrder
// again when a payment is asked for twice, in case the first answer was lost). What's shown is checked against the menu
// as it is now: a choice taken off, or a new one it has to have, and it isn't offered.
import { usualAdd, usualTop, type UsualEntry } from '@/lib/counter-usual';
import { priceChoices } from '@/lib/menu-choices';
import { offeredOnMenu } from '@/lib/menu-stock';
import { byWeightOf } from '@/lib/menu-weight';

const ID = /^[A-Za-z0-9_-]{1,160}$/;

/** What a paid order had, added to its member's usual (once an order). */
export async function noteUsual(db: any, tenantId: string, orderId: string): Promise<boolean> {
  if (!ID.test(orderId)) return false;
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    if (!o?.paidAt || o.usualNoted || o.status === 'voided' || o.staffMeal || o.payMethod === 'staff' || o.payMethod === 'app' || o.points?.verified !== true || !ID.test(String(o.clientId || ''))) return false;
    const cRef = db.doc(`${T}/clients/${String(o.clientId)}`); const c: any = (await tx.get(cRef)).data();
    if (!c) return false;
    tx.set(cRef, { counterUsual: usualAdd(c.counterUsual, o.lines, String(o.paidAt)) }, { merge: true });
    tx.set(ref, { usualNoted: true }, { merge: true });
    return true;
  }).catch((e: any) => { console.error('[counter-usual] not noted', orderId, e?.message); return false; });
}

/** Their usual as the menu has it now (the most ordered few): each still on the menu, sold as it was (not by weight), its
 *  choices still ones it can have, in today's words. Sold out or not on right now is for the screen to say. */
export async function usualNow(db: any, tenantId: string, tally: unknown): Promise<UsualEntry[]> {
  const top = usualTop(tally as any, 5); if (!top.length) return [];
  const items = await Promise.all(top.map((e) => db.doc(`tenants/${tenantId}/inventory/${e.itemId}`).get().then((d: any) => d.data() || null).catch(() => null)));
  const out: UsualEntry[] = [];
  top.forEach((e, i) => {
    const item: any = items[i];
    if (!item || item.type !== 'refreshment' || item.archived === true || item.isActive === false || !offeredOnMenu(item) || byWeightOf(item)) return;
    const c = priceChoices(item, e.picks);
    if (!c.ok) return;
    out.push({ ...e, name: String(item.name || e.name).slice(0, 80), choicesText: c.text || null });
  });
  return out;
}
