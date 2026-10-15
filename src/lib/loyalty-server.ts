// src/lib/loyalty-server.ts — THE LOYALTY LEDGER (server only; lib/loyalty has the rules).
// A ledger, not a number on the client: every earn, redeem, reversal, adjustment and expiry is its own entry, tied to the
// sale, refund or person that made it, with the rules version it was made under.
//   tenants/{t}/loyaltyLedger/{id} = { clientId, type, points, at, by, saleId?, rewardId?, rewardName?, cents?, basisCents?,
//                                       version, why, note? }   — only the server writes it (database rules)
//   earn_{saleId} / redeem_{saleId} ids make a sale earn once and redeem once, however often checkout is retried.
//   clients/{id}.loyalty = { balance, lastVisitAt, updatedAt } — a copy for lists and the desk; the ledger decides.
import { loyaltyOf, pointsFor, pointsBack, balanceOf, expiresAt, tierFor, milestoneAt, quietBonus, type SaleForPoints, type Reward } from '@/lib/loyalty';

const L = (t: string) => `tenants/${t}/loyaltyLedger`;
const nowIso = (n = Date.now()) => new Date(n).toISOString();

export async function ledgerFor(db: any, t: string, clientId: string): Promise<any[]> {
  const s = await db.collection(L(t)).where('clientId', '==', clientId).get();
  return s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
}
export async function balanceFor(db: any, t: string, clientId: string) { return balanceOf(await ledgerFor(db, t, clientId)); }
async function syncClient(db: any, t: string, clientId: string, extra: any = {}) {
  const bal = await balanceFor(db, t, clientId);
  await db.doc(`tenants/${t}/clients/${clientId}`).set({ loyalty: { balance: bal, updatedAt: nowIso(), ...extra } }, { merge: true }).catch(() => {});
  return bal;
}

/** After a paid sale: the points it earns (once per sale), times their tier's multiplier, plus a milestone bonus when this
 *  visit reaches one and a quiet-time bonus for visits booked into the business's quiet windows. Returns what was added. */
export async function earnForSale(db: any, t: string, tenant: any, o: { clientId: string | null; saleId: string; sale: SaleForPoints; by: string; at?: string; quiet?: { day: number; min: number; serviceId: string | null }[] }) {
  const S = loyaltyOf(tenant); if (!S.on || !o.clientId || !o.saleId) return { ok: true, points: 0 };
  const cRef = db.doc(`tenants/${t}/clients/${o.clientId}`); const c: any = (await cRef.get()).data() || {};
  if (c.loyaltyOptOut === true || (S.join === 'opt_in' && c.loyaltyJoinedAt == null)) return { ok: true, points: 0, skipped: 'not a member' };
  const at = o.at || nowIso(); const atMs = Date.parse(at) || Date.now();
  const before = await ledgerFor(db, t, o.clientId);
  const earned12 = (L: any[]) => L.filter((e) => (e.type === 'earn' || e.type === 'bonus') && Date.parse(e.at) >= atMs - 365 * 864e5).reduce((a, e) => a + Math.max(0, Number(e.points) || 0), 0);
  const tierNow = tierFor(S, earned12(before), c.loyalty?.tier || null, atMs);
  const r = pointsFor(S, o.sale); const mult = tierNow.tier?.multiplier || 1; const points = Math.floor(r.points * mult);
  const ref = db.doc(`${L(t)}/earn_${o.saleId}`);
  const basisCents = o.sale.services.reduce((a, s) => a + Math.max(0, s.cents), 0) + o.sale.products.reduce((a, p) => a + Math.max(0, p.cents), 0);
  const made = await db.runTransaction(async (tx: any) => { if ((await tx.get(ref)).exists || points <= 0) return false;
    tx.set(ref, { clientId: o.clientId, type: 'earn', points, at, by: o.by, saleId: o.saleId, basisCents, visits: o.sale.visits || 0, version: S.version, why: `${r.why}${mult > 1 ? ` × ${mult} (${tierNow.tier!.name})` : ''}` }); return true; });
  if (!made) { if (o.sale.visits > 0) await cRef.set({ loyalty: { lastVisitAt: at } }, { merge: true }).catch(() => {}); return { ok: true, points: 0 }; }
  let extra = 0;
  // Milestone: this is their Nth paid visit with points.
  if (o.sale.visits > 0) { const n = before.filter((e) => e.type === 'earn' && (Number(e.visits) || 0) > 0).length + 1; const m = milestoneAt(S, n);
    if (m) { await db.doc(`${L(t)}/ms_${o.clientId}_${n}`).set({ clientId: o.clientId, type: 'bonus', points: m.points, at, by: 'system', saleId: o.saleId, version: S.version, why: `Milestone: visit number ${n}` }); extra += m.points; } }
  // Quiet-time bonus: once per sale, the best one that applies.
  const qb = (o.quiet || []).map((q) => quietBonus(S, q.day, q.min, q.serviceId)).filter(Boolean).sort((a: any, b: any) => b.points - a.points)[0];
  if (qb) { await db.doc(`${L(t)}/qb_${o.saleId}`).set({ clientId: o.clientId, type: 'bonus', points: qb.points, at, by: 'system', saleId: o.saleId, version: S.version, why: qb.label }); extra += qb.points; }
  // Their tier after this visit (kept until a year after they last qualified, plus the grace period).
  const after = [...before, { type: 'earn', points: points + extra, at }];
  const t2 = tierFor(S, earned12(after), c.loyalty?.tier || null, atMs);
  const tierRec = t2.tier ? { id: t2.tier.id, name: t2.tier.name, since: c.loyalty?.tier?.id === t2.tier.id ? c.loyalty.tier.since || at : at, until: new Date(atMs + (365 + S.graceMonths * 30) * 864e5).toISOString() } : null;
  await syncClient(db, t, o.clientId, { lastVisitAt: at, tier: tierRec });
  return { ok: true, points: points + extra, tier: tierRec?.name || null };
}

/** Using a reward on a sale (checked against the ledger itself, inside the same transaction). */
export async function redeemForSale(db: any, t: string, tenant: any, o: { clientId: string; saleId: string; reward: Reward; cents: number; by: string }) {
  const S = loyaltyOf(tenant); if (!S.on) return { ok: false as const, error: 'The rewards program is off.' };
  const ref = db.doc(`${L(t)}/redeem_${o.saleId}`); const q = db.collection(L(t)).where('clientId', '==', o.clientId);
  const r = await db.runTransaction(async (tx: any) => {
    if ((await tx.get(ref)).exists) return { ok: true as const, again: true };
    const bal = balanceOf((await tx.get(q)).docs.map((d: any) => d.data()));
    if (bal < o.reward.points) return { ok: false as const, error: `They have ${bal} points; ${o.reward.name} needs ${o.reward.points}.` };
    tx.set(ref, { clientId: o.clientId, type: 'redeem', points: -o.reward.points, at: nowIso(), by: o.by, saleId: o.saleId, rewardId: o.reward.id, rewardName: o.reward.name, cents: o.cents, costCents: o.reward.costCents ?? o.cents, version: S.version, why: `Used: ${o.reward.name}` });
    return { ok: true as const };
  });
  if (r.ok) await syncClient(db, t, o.clientId);
  return r;
}

/** A refund or void: takes back what the sale earned (in proportion for a partial refund) and, on a full undo, gives
 *  back what it redeemed. Each refund is its own entry; never more than the sale earned in total. */
export async function reverseSale(db: any, t: string, o: { saleId: string; refundCents?: number | null; full?: boolean; refundId?: string | null; by: string }) {
  const earn: any = (await db.doc(`${L(t)}/earn_${o.saleId}`).get()).data(); const red: any = (await db.doc(`${L(t)}/redeem_${o.saleId}`).get()).data();
  const clientId = earn?.clientId || red?.clientId; if (!clientId) return { ok: true, points: 0 };
  const prior = (await db.collection(L(t)).where('saleId', '==', o.saleId).get()).docs.map((d: any) => d.data());
  const takenBack = -prior.filter((e: any) => e.type === 'reverse' && e.of === 'earn').reduce((a: number, e: any) => a + (Number(e.points) || 0), 0);
  const givenBack = prior.filter((e: any) => e.type === 'reverse' && e.of === 'redeem').reduce((a: number, e: any) => a + (Number(e.points) || 0), 0);
  const at = nowIso(); const key = o.refundId ? String(o.refundId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) : o.full ? 'void' : `r${Date.now()}`;
  let moved = 0;
  if (earn && earn.points > takenBack) { const want = o.full ? earn.points - takenBack : Math.min(earn.points - takenBack, pointsBack(earn.points, Number(earn.basisCents) || 0, Math.max(0, Number(o.refundCents) || 0)));
    if (want > 0) { await db.doc(`${L(t)}/rev_${o.saleId}_${key}`).set({ clientId, type: 'reverse', of: 'earn', points: -want, at, by: o.by, saleId: o.saleId, version: earn.version || 1, why: o.full ? 'Sale undone' : 'Refund' }); moved -= want; } }
  if (o.full) { const bonus = prior.filter((e: any) => e.type === 'bonus').reduce((a: number, e: any) => a + (Number(e.points) || 0), 0); const bonusBack = -prior.filter((e: any) => e.type === 'reverse' && e.of === 'bonus').reduce((a: number, e: any) => a + (Number(e.points) || 0), 0);
    if (bonus > bonusBack) { await db.doc(`${L(t)}/revb_${o.saleId}_${key}`).set({ clientId, type: 'reverse', of: 'bonus', points: -(bonus - bonusBack), at, by: o.by, saleId: o.saleId, why: 'Sale undone: bonus taken back' }); moved -= bonus - bonusBack; } }
  if (o.full && red && -Number(red.points) > givenBack) { const back = -Number(red.points) - givenBack;
    await db.doc(`${L(t)}/back_${o.saleId}_${key}`).set({ clientId, type: 'reverse', of: 'redeem', points: back, at, by: o.by, saleId: o.saleId, version: red.version || 1, why: `Reward given back: ${red.rewardName || 'reward'}` }); moved += back; }
  if (moved) await syncClient(db, t, clientId);
  return { ok: true, points: moved };
}

/** A manager's adjustment (a reason is required). */
export async function adjustPoints(db: any, t: string, o: { clientId: string; points: number; note: string; by: string }) {
  const p = Math.round(Number(o.points) || 0); if (!p) return { ok: false as const, error: 'Enter how many points to add or take off.' };
  const note = String(o.note || '').trim().slice(0, 140); if (!note) return { ok: false as const, error: 'Say why.' };
  if (p < 0 && (await balanceFor(db, t, o.clientId)) + p < 0) return { ok: false as const, error: 'That would take them below zero.' };
  const ref = db.collection(L(t)).doc(); await ref.set({ clientId: o.clientId, type: 'adjust', points: p, at: nowIso(), by: o.by, note, why: `Adjusted by ${o.by.split(' ')[0]}: “${note}”` });
  return { ok: true as const, balance: await syncClient(db, t, o.clientId) };
}

/** Nightly: balances whose last visit is older than the program's expiry. One entry per client, told in plain words. */
export async function expirySweep(db: any, t: string, tenant: any, now = Date.now()) {
  const S = loyaltyOf(tenant); if (!S.on || !S.expiryMonths) return { expired: 0 };
  const s = await db.collection(`tenants/${t}/clients`).where('loyalty.balance', '>', 0).get().catch(() => ({ docs: [] }));
  let n = 0;
  for (const d of s.docs) { const c: any = d.data() || {}; const until = expiresAt(S, c.loyalty?.lastVisitAt || c.lastVisit || null); if (!until || Date.parse(until) > now) continue;
    const bal = await balanceFor(db, t, d.id); if (bal <= 0) continue;
    await db.doc(`${L(t)}/exp_${d.id}_${until.slice(0, 10)}`).set({ clientId: d.id, type: 'expire', points: -bal, at: nowIso(now), by: 'system', why: `Expired: no visit in ${S.expiryMonths} months` });
    await syncClient(db, t, d.id); n++; }
  return { expired: n };
}

/** An online shop order, once paid: its products earn like the counter (lib/loyalty), once per order. Shipping, tax and
 *  tips never count; gift card money follows the business's "when it's spent / bought" choice. */
export async function earnForShopOrder(db: any, t: string, tenant: any, orderId: string, order: any) {
  if (tenant?.loyalty?.on !== true || !order?.clientId) return { ok: true, points: 0 };
  const lines = (Array.isArray(order.lines) ? order.lines : []).map((l: any) => ({ productId: String(l.productId || l.id || ''), cents: Math.max(0, Math.round((Number(l.unitPriceCents) || 0) * (Number(l.qtyOrdered ?? l.qty) || 0))) }));
  const sub = lines.reduce((a: number, l: any) => a + l.cents, 0); const credit = Math.max(0, Number(order.creditAppliedCents) || 0);
  const share = sub > 0 ? Math.max(0, 1 - credit / sub) : 0;   // store credit isn't new money
  return earnForSale(db, t, tenant, { clientId: String(order.clientId), saleId: `order_${orderId}`, by: 'Online shop', sale: { services: [], products: lines.map((l: any) => ({ ...l, cents: Math.round(l.cents * share) })), giftSpentCents: Math.max(0, Number(order.giftCardCents) || 0), giftBoughtCents: 0, visits: 0, rebooked: false, renter: false } });
}

/** Nightly: the automatic messages the business switched on (each off by default). Marketing consent only; one loyalty
 *  text a month per client at most; inside the business's monthly budget and the shared daily text allowance; never
 *  between 8 pm and 9 am. Returns what was sent. */
export async function automationSweep(db: any, t: string, tenant: any, now = Date.now(), send?: (to: string, text: string) => Promise<boolean>) {
  const { AUTO_TEXTS, rewardsFor, unitOf } = await import('@/lib/loyalty'); const S = loyaltyOf(tenant);
  if (!S.on || !(S.auto.rewardReady || S.auto.tierUp || S.auto.unused || S.auto.comeBack)) return { sent: 0 };
  const { localHour } = await import('@/lib/campaigns'); const tz = tenant?.timezone || 'America/New_York'; const h = localHour(tz, new Date(now)); if (h < 10 || h >= 20) return { sent: 0, skipped: 'quiet hours' };
  const { dayKey } = await import('@/lib/tenant-time'); const today = dayKey(new Date(now), tz);
  const month = new Date(now).toISOString().slice(0, 7); const capRef = db.doc(`tenants/${t}/private/loyaltyTexts`); const cap: any = (await capRef.get()).data() || {}; let used = Number(cap[month]) || 0;
  if (!send && cap.lastDay === today) return { sent: 0, skipped: 'done today' }; await capRef.set({ lastDay: today }, { merge: true });
  const business = String(tenant.name || tenant.businessName || 'us'); const unit = unitOf(S);
  const doSend = send || (async (to: string, text: string) => { const { sendTenantSms } = await import('@/lib/sms'); return !!(await (sendTenantSms as any)(db, t, to, text, undefined, { kind: 'loyalty', recipientType: 'client' }))?.ok; });
  const { budgetLeft, spendBudget } = await import('@/lib/text-budget');
  const snap = await db.collection(`tenants/${t}/clients`).where('loyalty.balance', '>', 0).get().catch(() => ({ docs: [] }));
  let sent = 0;
  for (const d of snap.docs) { if (used >= S.auto.monthlyTexts) break;
    const c: any = d.data() || {}; const lo = c.loyalty || {}; const phone = String(c.phone || '').trim();
    if (!phone || c.smsOptOut || c.marketingOptOut || c.smsMarketingOptIn !== true || c.loyaltyOptOut === true) continue;
    if (lo.lastToldAt && now - Date.parse(lo.lastToldAt) < 30 * 864e5) continue;
    const bal = Number(lo.balance) || 0; const r = rewardsFor(S, bal); const first = String(c.firstName || c.name || '').trim().split(/\s+/)[0] || 'there';
    const sinceVisit = lo.lastVisitAt ? (now - Date.parse(lo.lastVisitAt)) / 864e5 : Infinity;
    let text = ''; let mark: any = {};
    if (S.auto.tierUp && lo.tier?.id && lo.toldTier !== lo.tier.id) { const tier = S.tiers.find((x) => x.id === lo.tier.id); if (tier) { text = AUTO_TEXTS.tierUp({ first, tier: tier.name, business, perks: tier.perks.join(', ') }); mark = { toldTier: tier.id }; } }
    if (!text && S.auto.rewardReady && r.ready.length && lo.toldReadyFor !== r.ready[r.ready.length - 1].id && sinceVisit < 60) { const best = r.ready[r.ready.length - 1]; text = AUTO_TEXTS.rewardReady({ first, reward: best.name.charAt(0).toLowerCase() + best.name.slice(1), business }); mark = { toldReadyFor: best.id }; }
    if (!text && S.auto.unused && r.ready.length && sinceVisit >= 60 && sinceVisit < 120 && (!lo.toldUnusedAt || now - Date.parse(lo.toldUnusedAt) > 90 * 864e5)) { text = AUTO_TEXTS.unused({ first, points: bal, unit, business, reward: r.ready[r.ready.length - 1].name.charAt(0).toLowerCase() + r.ready[r.ready.length - 1].name.slice(1) }); mark = { toldUnusedAt: new Date(now).toISOString() }; }
    if (!text && S.auto.comeBack && sinceVisit >= 120 && sinceVisit < 365 && (!lo.toldComeBackAt || now - Date.parse(lo.toldComeBackAt) > 180 * 864e5)) { text = AUTO_TEXTS.comeBack({ first, business, points: bal, unit }); mark = { toldComeBackAt: new Date(now).toISOString() }; }
    if (!text) continue;
    if ((await budgetLeft(db, t, phone, 'loyalty' as any, now)) <= 0) continue;
    if (!(await doSend(phone, text))) continue;
    await spendBudget(db, t, phone, 'loyalty' as any, now); used++; sent++;
    await d.ref.set({ loyalty: { ...mark, lastToldAt: new Date(now).toISOString() } }, { merge: true });
  }
  if (sent) await capRef.set({ [month]: used }, { merge: true });
  return { sent };
}
