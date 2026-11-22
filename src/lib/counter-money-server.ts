// src/lib/counter-money-server.ts — A TIP AND A DISCOUNT ON A COUNTER ORDER (server; design board "Money at the counter";
// lib/counter-money). Both only on an order that's been sent and isn't paid yet, and never while the card reader or a
// scan-to-pay code is asking for the old total (as with a reward: lib/counter-points useReward).
// - setTip: the tip the guest picked (or none), into the order's total.
// - setDiscount: one of the business's discounts, or another amount a manager okays (the route checks the manager), or
//   none. It comes off before tax, beside a reward, and the tip stays as it was.
import { totalsOf } from '@/lib/counter-orders';
import { cardBusy } from '@/lib/counter-server';
import { cleanTip, discountsOf, discountCents, discountWords, itemsCentsOf, rewardCentsOf, tipCentsOf, type Discount } from '@/lib/counter-money';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const nowIso = () => new Date().toISOString();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Why the money on it can't change now (null: it can). */
function notNow(o: any, what: 'tip' | 'discount'): Fail | null {
  if (!o) return fail('That order is gone.', 404);
  if (o.paidAt) return fail('It’s paid already.', 409, 'paid');
  if (o.status !== 'sent') return fail(o.status === 'building' ? `Send the order first, then add ${what === 'tip' ? 'the tip' : 'the discount'}.` : 'That order can’t change now.', 409, 'not_sent');
  if (o.staffMeal) return fail('A staff meal takes no money.', 409, 'staff');
  if (o.app?.code) return fail('A delivery app’s order is paid on the app.', 409, 'app');
  if (o.channel === 'kiosk') return fail('A kiosk order is paid at the kiosk.', 409, 'kiosk');
  if (cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
  if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
  return null;
}

/** The order's money with a discount of `markdownCents` beside its reward, keeping its tip. */
export function moneyWith(tenant: any, o: any, markdownCents: number) {
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const off = rewardCentsOf(o) + Math.max(0, Math.round(markdownCents));
  const t = totalsOf(tenant, lines, off / 100);
  return { ...t, total: r2(t.total + tipCentsOf(o) / 100), discount: t.discount ?? 0, itemsTotal: t.itemsTotal ?? null };
}

/** The guest's tip (whole cents; 0 takes it off). The total is the order's before any tip, plus this one. */
export async function setTip(db: any, tenantId: string, orderId: string, cents: unknown, who: { id: string | null; name: string }) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o, 'tip'); if (no) return no;
    if (o.ahead?.way === 'delivery') return fail('A delivery’s tip is the driver’s, chosen when it was ordered.', 409, 'delivery');
    const base = Math.round(Number(o.total || 0) * 100) - tipCentsOf(o);
    const tip = cleanTip(cents, base); if (tip === null) return fail('How much is the tip?', 400);
    const total = r2((base + tip) / 100);
    tx.set(ref, { tipCents: tip, total, tipBy: tip ? { id: who.id || null, name: who.name } : null, tipAt: tip ? nowIso() : null, updatedAt: nowIso() }, { merge: true });
    return { ok: true as const, tipCents: tip, total, number: String(o.number || '') };
  });
}

export type DiscountAsk = { id?: string | null; custom?: { kind?: unknown; value?: unknown; reason?: unknown } | null };

/** One of the business's discounts (`id`), another amount okayed by `approver` (`custom`), or none (neither). */
export async function setDiscount(db: any, tenantId: string, tenant: any, orderId: string, ask: DiscountAsk, who: { id: string | null; name: string }, approver: { id: string; name: string } | null) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  let d: (Discount & { custom?: boolean; reason?: string | null }) | null = null;
  if (ask.custom) {
    const kind = ask.custom.kind === 'off' ? 'off' : ask.custom.kind === 'pct' ? 'pct' : null;
    const value = Math.round(Number(ask.custom.value));
    const reason = String(ask.custom.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!kind || !Number.isFinite(value) || (kind === 'pct' ? value < 1 || value > 100 : value < 1 || value > 50000)) return fail(kind === 'pct' ? 'A percent from 1 to 100.' : 'How much off?', 400);
    if (!reason) return fail('Say why, for the record.', 400, 'reason');
    if (!approver) return fail('Another amount takes a manager. Their PIN, or ask one to.', 403, 'needs_manager');
    // (Shown to the guest as just "Discount": the reason is for the record, the report and whoever okayed it.)
    d = { id: 'other', label: 'Discount', kind, value, custom: true, reason };
  } else if (ask.id) {
    d = discountsOf(tenant).find((x) => x.id === String(ask.id)) || null;
    if (!d) return fail('That discount isn’t on the list any more.', 409, 'gone');
  }
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o, 'discount'); if (no) return no;
    if (!d) {
      tx.set(ref, { markdown: null, ...moneyWith(tenant, o, 0), updatedAt: nowIso() }, { merge: true });
      return { ok: true as const, off: true, total: moneyWith(tenant, o, 0).total, number: String(o.number || '') };
    }
    const cents = discountCents(d, itemsCentsOf(o), rewardCentsOf(o));
    if (!cents) return fail('There’s nothing left on this order to take it off.', 409, 'nothing');
    const money = moneyWith(tenant, o, cents);
    const markdown = { id: d.id, label: d.label, kind: d.kind, value: d.value, words: discountWords(d), cents, by: who.name, byId: who.id || null,
      ...(d.custom ? { custom: true, reason: d.reason || null, okBy: approver!.name, okById: approver!.id } : {}), at: nowIso() };
    tx.set(ref, { markdown, ...money, updatedAt: nowIso() }, { merge: true });
    return { ok: true as const, cents, total: money.total, label: d.label, reason: d.reason || null, number: String(o.number || ''), custom: !!d.custom };
  });
}
