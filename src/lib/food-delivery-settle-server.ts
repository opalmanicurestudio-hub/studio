// src/lib/food-delivery-settle-server.ts — WHEN HOT FOOD COULDN'T BE DELIVERED (server; lib/food-delivery has the rules;
// design board "When hot food can't be delivered"). Read by lib/food-delivery-server (the driver or the counter taps
// Couldn't deliver), api/counter/ahead 'deliveryChoice' (the guest's page) and api/counter (the counter).
// - Told at once: a text to the guest's number with their order page, which asks what they'd like.
// - Refunded (the guest on their page, or a manager at the counter): every line of the sale back to the card together
//   (lib/money-refund, each line once however often it's asked): the food, its tax and the driver's tip, and the
//   delivery fee unless it failed on the guest's side and the business's second-try rule keeps it (a manager can give it
//   back anyway). The books show each line refunded.
// - Picked up instead (the guest): it waits at the counter with their pickup code. The tip comes back, and the fee by the
//   same rule; the counter taps Handed over. A pickup never collected can still be refunded at the counter.
// - Settled once: a refund or a pickup closes it, and the managers' night note stops counting it.
import { backLines, failReasonOf, failedWords, keepsFee, lineCents } from '@/lib/food-delivery';
import { deliveryFrom } from '@/lib/delivery-plan';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
/** A refund or a pickup being carried out holds the order this long (a second tap is told to wait). */
const BUSY_MS = 2 * 60000;

async function forget(tenantId: string) {
  const { forgetDeliveries } = await import('@/lib/food-delivery-server'); forgetDeliveries(tenantId);
}

async function text(db: any, tenantId: string, to: string, words: string, logWords: string, kind: string) {
  const { sendTenantSms } = await import('@/lib/sms');
  const r: any = await sendTenantSms(db, tenantId, to, words, undefined, { kind, recipientType: 'other', skipMessageLog: true, forget: true, logBody: logWords } as any).catch(() => ({ ok: false }));
  return !!r?.ok;
}

/** Their order page, signed (lib/counter-ahead aheadSig), for a text. */
async function pageLink(db: any, tenantId: string, orderId: string): Promise<string | null> {
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const { aheadSig } = await import('@/lib/counter-ahead'); const { linkOrigin } = await import('@/lib/app-origin');
  const s = aheadSig(tenantId, orderId); const base = linkOrigin(tenant, null);
  return s && base ? `${base}/order/${encodeURIComponent(tenantId)}?o=${encodeURIComponent(orderId)}&s=${encodeURIComponent(s)}` : null;
}

/** Couldn't be delivered: the guest's one text, with their page to pick it up or get a refund (once for each time it
 *  comes back). The text log keeps the words without the link. */
export async function tellGuestFailed(db: any, tenantId: string, orderId: string): Promise<boolean> {
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const d = o?.ahead?.delivery;
    if (!d || d.state !== 'failed' || (d.failText?.at && d.failText.for === d.failedAt)) return null;
    const to = /^\d{10}$/.test(String(d.phone || '')) ? String(d.phone) : null;
    if (!to) return null;
    tx.set(ref, { ahead: { delivery: { failText: { at: new Date().toISOString(), for: d.failedAt || null, ok: null } } } }, { merge: true });
    return { to, number: String(o.number || ''), why: d.why };
  }).catch(() => null);
  if (!claim) return false;
  const link = await pageLink(db, tenantId, orderId).catch(() => null);
  const ok = await text(db, tenantId, claim.to, failedWords(claim.number, claim.why, link), failedWords(claim.number, claim.why, null), 'delivery_failed');
  await ref.set({ ahead: { delivery: { failText: { ok } } } }, { merge: true }).catch(() => null);
  return ok;
}

/** Lines of the sale back to the card, each once (one already refunded was counted when it went). What didn't go is left. */
async function giveBack(db: any, tenantId: string, tenant: any, ids: string[], by: string, notes: string): Promise<{ cents: number; left: string[]; error: string | null }> {
  const { refundSaleToCard } = await import('@/lib/money-refund');
  const T = `tenants/${tenantId}`; let cents = 0; const left: string[] = []; let error: string | null = null;
  for (const id of ids) {
    const x: any = (await db.doc(`${T}/transactions/${id}`).get()).data();
    // (No such line: nothing was charged for that part.)
    if (!x) continue;
    const want = Math.round(num(x.amount) * 100); if (want <= 0) continue;
    if (x.refundedAt) continue;
    const r: any = await refundSaleToCard(db, tenantId, tenant, id, want, by, { notes });
    if (!r.ok) { left.push(id); error = error || r.error || 'The card refund didn’t go through.'; continue; }
    if (!r.card) { left.push(id); error = error || 'This order wasn’t paid by card, so it can’t go back to one. Refund it from Money.'; continue; }
    cents += Math.round(num(r.refundedCents));
  }
  return { cents, left, error };
}

export type Settled = { ok: true; already?: boolean; cents: number; number: string; code?: string | null; owed?: number; error?: string | null };

/**
 * Settle one that couldn't be delivered. `how`: 'refund' or 'pickup'. `who.guest`: from their page (the fee by the rule;
 * a pickup or a refund only while it's back at the business). From the counter (a manager), `who.fee` says whether the
 * delivery fee goes back too (left out: by the rule), and a pickup never collected can be refunded.
 */
export async function settleFailed(db: any, tenantId: string, tenant: any, orderId: string, how: 'refund' | 'pickup', who: { by: string; guest: boolean; fee?: boolean }, nowIso = new Date().toISOString()): Promise<Settled | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const plan = deliveryFrom(tenant?.retailSettings);
  const by = String(who.by || 'Someone').slice(0, 60);
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    if (!o || o.ahead?.way !== 'delivery' || !o.ahead?.delivery) return fail('That delivery isn’t here.', 404);
    if (!o.paidAt || o.status === 'voided') return fail('That order isn’t paid.', 409);
    const d = o.ahead.delivery; const st = String(d.state || 'waiting'); const number = String(o.number || '');
    const code = String(o.ahead.code || '') || null;
    // Asked again (an answer lost, a second tap): as it was.
    if (how === 'refund' && st === 'refunded') return { already: true, cents: Math.round(num(d.backCents)), number };
    if (how === 'pickup' && (st === 'pickup' || st === 'picked_up')) return { already: true, cents: Math.round(num(d.backCents)), number, code };
    const fromPickup = how === 'refund' && !who.guest && st === 'pickup';
    if (st !== 'failed' && !fromPickup) {
      return fail(st === 'refunded' ? 'It was refunded.' : st === 'pickup' ? 'They’re picking it up at the counter.' : st === 'picked_up' ? 'They picked it up.' : st === 'delivered' ? 'It was delivered.' : 'It hasn’t come back from the driver.', 409);
    }
    const s = d.settle || null;
    const busy = (at: unknown) => !!at && Date.parse(nowIso) - (Date.parse(String(at)) || 0) < BUSY_MS;
    // (One step at a time on its money: a refund, or a pickup's tip and fee still going back.)
    if (busy(s?.at) || (fromPickup && busy(d.owedAt))) return fail('That’s being done now. Give it a moment.', 409);
    // (A refund that didn't finish goes on as a refund: never a pickup on top of money already going back.)
    if (s?.how && s.how !== how) return fail('A refund for it was started. Refund it again to finish.', 409);
    // The fee as first decided, for a refund asked again from where it stopped; otherwise the manager's say, or the rule.
    const fee = s?.how === how && typeof s.fee === 'boolean' ? s.fee : who.guest || typeof who.fee !== 'boolean' ? !keepsFee(d.why, plan) : who.fee;
    const lines = backLines(orderId, how, fee);
    if (how === 'pickup') {
      // A pickup now, with their code: waiting at the counter. What comes back (the tip, the fee by the rule) goes after.
      tx.set(ref, { ahead: { delivery: { state: 'pickup', pickupAt: nowIso, pickupBy: by, settle: null, owed: lines, owedAt: nowIso } } }, { merge: true });
    } else tx.set(ref, { ahead: { delivery: { settle: { how, at: nowIso, by, fee } } } }, { merge: true });
    return { lines, fee, number, code, phone: /^\d{10}$/.test(String(d.phone || '')) ? String(d.phone) : null, prior: Math.round(num(d.backCents)), o };
  });
  if (claim.ok === false) return claim;
  if (claim.already) return { ok: true, already: true, cents: claim.cents, number: claim.number, ...(claim.code !== undefined ? { code: claim.code } : {}) };
  const notes = `Couldn’t be delivered, order ${claim.number}${how === 'pickup' ? ' (picked up instead)' : ''}`;
  const back = await giveBack(db, tenantId, tenant, claim.lines, by, notes);
  if (how === 'pickup') {
    const owed = back.left.reduce((n, l) => n + lineCents(orderId, l, claim.o), 0);
    const feeBack = claim.fee && !back.left.includes(`counter_${orderId}_delivery`);
    await ref.set({ ahead: { delivery: { owed: back.left, owedAt: null, owedError: back.left.length ? String(back.error || '').slice(0, 200) : null, backCents: claim.prior + back.cents, ...(feeBack ? { feeBack: true } : {}) } } }, { merge: true });
    await forget(tenantId);
    return { ok: true, cents: claim.prior + back.cents, number: claim.number, code: claim.code, owed, error: back.error };
  }
  if (back.left.length) {
    // Not all of it went back: the rest is asked again (each line is sent once), from where it stopped.
    await ref.set({ ahead: { delivery: { settle: { at: null, left: back.left, error: String(back.error || '').slice(0, 200) }, backCents: claim.prior + back.cents } } }, { merge: true });
    await forget(tenantId);
    return fail(`${back.cents ? `${money(back.cents)} went back, but not all of it. ` : ''}${back.error || 'The card refund didn’t go through.'}`, 502);
  }
  const cents = claim.prior + back.cents;
  // (The delivery fee given back with it: the night report counts the fees kept. lib/night-close-server)
  await ref.set({ refundedAt: nowIso, refundedCents: cents, ahead: { delivery: { state: 'refunded', refundedAt: nowIso, refundedBy: by, settle: null, owed: [], backCents: cents, ...(claim.fee ? { feeBack: true } : {}) } } }, { merge: true });
  await forget(tenantId);
  // Refunded at the counter: the guest hears (on their page they see it at once).
  if (!who.guest && claim.phone) {
    const words = `${claim.number ? `Order ${claim.number}` : 'Your order'}: ${money(cents)} is on its way back to your card. It can take a few days to show.`;
    await text(db, tenantId, claim.phone, words, words, 'delivery_refunded');
  }
  return { ok: true, cents, number: claim.number };
}

/** A pickup's money that didn't go back the first time (the tip, the fee): sent again. */
export async function sendOwed(db: any, tenantId: string, tenant: any, orderId: string, by: string, nowIso = new Date().toISOString()): Promise<Settled | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const claim: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const d = o?.ahead?.delivery;
    if (!d || !['pickup', 'picked_up'].includes(String(d.state))) return fail('That isn’t a pickup.', 409);
    const owed = Array.isArray(d.owed) ? d.owed.filter((x: any) => typeof x === 'string' && ID.test(x)) : [];
    if (!owed.length) return { done: true, number: String(o.number || ''), cents: Math.round(num(d.backCents)) };
    const busy = (at: unknown) => !!at && Date.parse(nowIso) - (Date.parse(String(at)) || 0) < BUSY_MS;
    if (busy(d.owedAt) || busy(d.settle?.at)) return fail('That’s being done now. Give it a moment.', 409);
    tx.set(ref, { ahead: { delivery: { owedAt: nowIso } } }, { merge: true });
    return { owed, number: String(o.number || ''), prior: Math.round(num(d.backCents)), o };
  });
  if (claim.ok === false) return claim;
  if (claim.done) return { ok: true, already: true, cents: claim.cents, number: claim.number, owed: 0 };
  const back = await giveBack(db, tenantId, tenant, claim.owed, String(by || 'Someone').slice(0, 60), `Couldn’t be delivered, order ${claim.number} (picked up instead)`);
  const cents = claim.prior + back.cents;
  const feeBack = claim.owed.includes(`counter_${orderId}_delivery`) && !back.left.includes(`counter_${orderId}_delivery`);
  await ref.set({ ahead: { delivery: { owed: back.left, owedAt: null, owedError: back.left.length ? String(back.error || '').slice(0, 200) : null, backCents: cents, ...(feeBack ? { feeBack: true } : {}) } } }, { merge: true });
  await forget(tenantId);
  const owed = back.left.reduce((n, l) => n + lineCents(orderId, l, claim.o), 0);
  return back.left.length ? fail(back.error || 'The card refund didn’t go through.', 502) : { ok: true, cents, number: claim.number, owed };
}

/** Picked up at the counter: done. */
export async function pickupHanded(db: any, tenantId: string, orderId: string, by: string, nowIso = new Date().toISOString()): Promise<{ ok: true; already?: boolean; number: string } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const d = o?.ahead?.delivery;
    if (!d) return fail('That delivery isn’t here.', 404);
    if (d.state === 'picked_up') return { ok: true, already: true, number: String(o.number || '') };
    if (d.state !== 'pickup') return fail('It isn’t waiting to be picked up.', 409);
    // (A refund of it started at the counter and not finished: finished first, while it can still be.)
    if (d.settle) return fail('A refund for it was started. Refund it again to finish.', 409);
    tx.set(ref, { ahead: { delivery: { state: 'picked_up', pickedUpAt: nowIso, pickedUpBy: String(by || '').slice(0, 60) } } }, { merge: true });
    return { ok: true, number: String(o.number || '') };
  });
  if (r.ok && !r.already) await forget(tenantId);
  return r;
}

/** What the counter and the guest's page show about one that couldn't be delivered, in dollars: what a refund gives back
 *  (the food, the tax, the tip, and the fee, which the rule may keep), and why. */
export function failedView(o: any, tenant: any) {
  const d = o?.ahead?.delivery || {}; const plan = deliveryFrom(tenant?.retailSettings);
  const keep = keepsFee(d.why, plan); const c = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 100)) / 100;
  // (The fee's own sales tax, where it's charged, goes with the fee.)
  const ft = c(o?.deliveryFeeTax);
  return { why: failReasonOf(d.why)?.label || 'Couldn’t deliver', keepWhen: keep ? failReasonOf(d.why)?.when || '' : '', keepFee: keep,
    food: c(o?.subtotal), tax: Math.max(0, Math.round((c(o?.tax) - ft) * 100) / 100), tip: Math.max(0, Math.round(num(o?.tipCents))) / 100, fee: Math.round((c(o?.deliveryFee) + ft) * 100) / 100,
    // (A refund that didn't finish: asked again from where it stopped.)
    stuck: !!d.settle && !d.settle.at && Array.isArray(d.settle.left) && d.settle.left.length > 0,
    /** Why the last try didn't finish (a refund, or a pickup's money), said at the counter. */
    stuckWhy: String((d.settle && !d.settle.at ? d.settle.error : d.owedError) || '').slice(0, 200) || null,
    /** The text telling them it couldn't be delivered didn't go: the counter phones them. */
    textFailed: d.state === 'failed' && d.failText?.ok === false };
}
