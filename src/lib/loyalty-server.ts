// src/lib/loyalty-server.ts — THE LOYALTY LEDGER (server only; lib/loyalty has the rules).
// A ledger, not a number on the client: every earn, redeem, reversal, adjustment and expiry is its own entry, tied to the
// sale, refund or person that made it, with the rules version it was made under.
//   tenants/{t}/loyaltyLedger/{id} = { clientId, type, points, at, by, saleId?, rewardId?, rewardName?, cents?, basisCents?,
//                                       version, why, note? }   — only the server writes it (database rules)
//   earn_{saleId} / redeem_{saleId} ids make a sale earn once and redeem once, however often checkout is retried.
//   clients/{id}.loyalty = { balance, lastVisitAt, updatedAt } — a copy for lists and the desk; the ledger decides.
import { loyaltyOf, pointsFor, pointsBack, balanceOf, expiresAt, tierFor, milestoneAt, quietBonus, rhythmBonus, boostBonus, type SaleForPoints, type Reward } from '@/lib/loyalty';

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
  // A head start for a brand-new member: once, with their first points.
  if (S.headStart > 0 && !before.length) { const hRef = db.doc(`${L(t)}/head_${o.clientId}`); if (!(await hRef.get()).exists) { await hRef.set({ clientId: o.clientId, type: 'bonus', points: S.headStart, at, by: 'system', version: S.version, why: 'Welcome: a head start' }); extra += S.headStart; } }
  // Kept their rhythm: back within their usual gap.
  if (o.sale.visits > 0) { const prior = before.filter((e) => e.type === 'earn' && (Number(e.visits) || 0) > 0).map((e) => String(e.at)); const rb = rhythmBonus(S, prior, atMs);
    if (rb) { await db.doc(`${L(t)}/rh_${o.saleId}`).set({ clientId: o.clientId, type: 'bonus', points: rb.points, at, by: 'system', saleId: o.saleId, version: S.version, why: rb.label }); extra += rb.points; } }
  // A point boost running today (the business's calendar).
  { const { dayKey, tenantTimeZone } = await import('@/lib/tenant-time'); const bb = boostBonus(S, o.sale, dayKey(new Date(atMs), tenantTimeZone(tenant)));
    if (bb) { await db.doc(`${L(t)}/bo_${o.saleId}`).set({ clientId: o.clientId, type: 'bonus', points: bb.points, at, by: 'system', saleId: o.saleId, version: S.version, why: bb.label }); extra += bb.points; } }
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
  { const { pausedNow } = await import('@/lib/outreach-pause'); if (!send && pausedNow(tenant, now)) return { sent: 0, skipped: 'held today' }; }
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
    // The left-alone group (lib/loyalty heldOut): recorded as if sent, so the dashboard can compare who came back.
    const kind = Object.keys(mark)[0] === 'toldTier' ? 'tierUp' : Object.keys(mark)[0] === 'toldReadyFor' ? 'rewardReady' : Object.keys(mark)[0] === 'toldUnusedAt' ? 'unused' : 'comeBack';
    const { heldOut } = await import('@/lib/loyalty');
    if (heldOut(d.id, kind, month, S.auto.holdoutPct)) { await db.collection(`tenants/${t}/loyaltyMessages`).doc().set({ clientId: d.id, kind, at: new Date(now).toISOString(), held: true });
      await d.ref.set({ loyalty: { ...mark, lastToldAt: new Date(now).toISOString() } }, { merge: true }); continue; }
    if ((await budgetLeft(db, t, phone, 'loyalty' as any, now)) <= 0) continue;
    if (!(await doSend(phone, text))) continue;
    await spendBudget(db, t, phone, 'loyalty' as any, now); used++; sent++;
    await db.collection(`tenants/${t}/loyaltyMessages`).doc().set({ clientId: d.id, kind, at: new Date(now).toISOString(), held: false });
    await d.ref.set({ loyalty: { ...mark, lastToldAt: new Date(now).toISOString() } }, { merge: true });
  }
  if (sent) await capRef.set({ [month]: used }, { merge: true });
  return { sent };
}

/** Phase 5: the loyalty dashboard. Measured results and estimates are labelled apart: "members visit more often" is not
 *  "loyalty made them visit more often" — only the left-alone comparison speaks to what the messages changed. */
export async function loyaltyDashboard(db: any, t: string, tenant: any, now = Date.now()) {
  const { liftOf, worthCents } = await import('@/lib/loyalty'); const S = loyaltyOf(tenant); const T = `tenants/${t}`;
  const since = (d: number) => new Date(now - d * 864e5).toISOString();
  const ledger = (await db.collection(`${T}/loyaltyLedger`).where('at', '>=', since(365)).get().catch(() => ({ docs: [] }))).docs.map((d: any) => d.data() || {});
  const clients = (await db.collection(`${T}/clients`).get().catch(() => ({ docs: [] }))).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((c: any) => !c.ownerRenterId && !c.archived);
  const appts = (await db.collection(`${T}/appointments`).where('startTime', '>=', since(365)).get().catch(() => ({ docs: [] }))).docs.map((d: any) => d.data() || {}).filter((a: any) => a.status === 'completed' && a.clientId);
  const members = new Set(ledger.filter((e: any) => e.type === 'earn').map((e: any) => String(e.clientId)));
  const active90 = new Set(appts.filter((a: any) => a.startTime >= since(90)).map((a: any) => String(a.clientId)));
  const memberActive = [...members].filter((c) => active90.has(c)).length;
  // Visits per client over the year, members vs everyone else who came in (an association, not a cause).
  const vc = new Map<string, number>(); for (const a of appts) vc.set(String(a.clientId), (vc.get(String(a.clientId)) || 0) + 1);
  const avg = (ids: string[]) => (ids.length ? Math.round((ids.reduce((s, id) => s + (vc.get(id) || 0), 0) / ids.length) * 10) / 10 : null);
  const visitors = [...vc.keys()]; const mem = visitors.filter((c) => members.has(c)); const non = visitors.filter((c) => !members.has(c));
  const redeem = ledger.filter((e: any) => e.type === 'redeem' && e.at >= since(90));
  const byReward = new Map<string, { name: string; used: number; costCents: number }>(); for (const e of redeem) { const k = String(e.rewardId || e.rewardName); const r = byReward.get(k) || { name: String(e.rewardName || 'Reward'), used: 0, costCents: 0 }; r.used++; r.costCents += Number(e.costCents) || 0; byReward.set(k, r); }
  const owed = clients.reduce((s: number, c: any) => s + Math.max(0, Number(c.loyalty?.balance) || 0), 0);
  const tiers = S.tiers.map((tr) => ({ name: tr.name, members: clients.filter((c: any) => c.loyalty?.tier?.id === tr.id).length }));
  // Messages: who came back within 30 days of the message (or of when it would have gone), sent vs left alone.
  const msgs = (await db.collection(`${T}/loyaltyMessages`).where('at', '>=', since(150)).get().catch(() => ({ docs: [] }))).docs.map((d: any) => d.data() || {}).filter((m: any) => Date.parse(m.at) <= now - 30 * 864e5);
  const back = (m: any) => appts.some((a: any) => String(a.clientId) === String(m.clientId) && Date.parse(a.startTime) > Date.parse(m.at) && Date.parse(a.startTime) <= Date.parse(m.at) + 30 * 864e5);
  const kinds = ['rewardReady', 'tierUp', 'unused', 'comeBack'].map((k) => ({ kind: k, ...liftOf(msgs.filter((m: any) => m.kind === k).map((m: any) => ({ held: !!m.held, cameBack: back(m) }))) }));
  return { ok: true, measured: { members: members.size, memberActive90: memberActive, rewardsUsed90: redeem.length, rewardCost90Cents: redeem.reduce((s: number, e: any) => s + (Number(e.costCents) || 0), 0), owedPoints: owed, owedCents: worthCents(S, owed), byReward: [...byReward.values()].sort((a, b) => b.used - a.used), tiers, messages: kinds },
    association: { memberVisits: avg(mem), otherVisits: avg(non), note: 'Members already tend to be your regulars, so this shows a difference, not what loyalty caused.' } };
}

// ── What makes it feel special: the desk's view of one client, and what checkout records ───────────────────────────────
const rowsOf = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
/** A head start the moment someone joins (for programs where clients say yes). Once per client. */
export async function grantHeadStart(db: any, t: string, tenant: any, clientId: string) {
  const S = loyaltyOf(tenant); if (!S.on || S.headStart <= 0) return 0; const ref = db.doc(`${L(t)}/head_${clientId}`);
  const made = await db.runTransaction(async (tx: any) => { if ((await tx.get(ref)).exists) return false; tx.set(ref, { clientId, type: 'bonus', points: S.headStart, at: nowIso(), by: 'system', version: S.version, why: 'Welcome: a head start' }); return true; });
  if (made) await syncClient(db, t, clientId); return made ? S.headStart : 0;
}
/** Surprises given this month (the business's calendar), for the monthly budget. */
export async function surprisesThisMonth(db: any, t: string, tenant: any, now = Date.now()) {
  const { tenantTimeZone, dayKey, startOfDay } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant); const first = startOfDay(`${dayKey(new Date(now), tz).slice(0, 7)}-01`, tz).toISOString();
  return rowsOf(await db.collection(L(t)).where('at', '>=', first).get().catch(() => ({ docs: [] }))).filter((e: any) => e.type === 'surprise').length;
}
/** Everything the desk and the provider need about one client today: goal, cues, a surprise, the tier's upgrade. */
export async function clientExtras(db: any, t: string, tenant: any, clientId: string, now = Date.now()) {
  const { goalOf, visitCues, surpriseFor, teamSurprises, activeBoosts } = await import('@/lib/loyalty');
  const S = loyaltyOf(tenant); const c: any = (await db.doc(`tenants/${t}/clients/${clientId}`).get()).data() || {};
  const ledger = await ledgerFor(db, t, clientId); const balance = Math.max(0, balanceOf(ledger));
  const appts = rowsOf(await db.collection(`tenants/${t}/appointments`).where('clientId', '==', clientId).get().catch(() => ({ docs: [] })));
  const done = appts.filter((a: any) => a.status === 'completed' || a.checkoutStatus === 'paid' || a.paymentStatus === 'paid').map((a: any) => String(a.startTime || '')).filter(Boolean).sort();
  const firstVisitAt = c.firstVisitAt || done[0] || null;
  const e12 = ledger.filter((e: any) => (e.type === 'earn' || e.type === 'bonus') && Date.parse(e.at) >= now - 365 * 864e5).reduce((a: number, e: any) => a + Math.max(0, Number(e.points) || 0), 0);
  const tier = tierFor(S, e12, c.loyalty?.tier || null, now).tier;
  const cases = rowsOf(await db.collection(`tenants/${t}/cases`).where('clientId', '==', clientId).get().catch(() => ({ docs: [] })));
  const madeRightAt = cases.filter((x: any) => x.kind !== 'incident' && x.locked && x.closedAt).map((x: any) => String(x.closedAt)).sort().pop() || null;
  const lastSurpriseAt = ledger.filter((e: any) => e.type === 'surprise').map((e: any) => String(e.at)).sort().pop() || null;
  const used = await surprisesThisMonth(db, t, tenant, now);
  const sur = surpriseFor(S, { firstVisitAt, lastSurpriseAt, madeRightAt, usedThisMonth: used, now });
  let upgrade: any = null;
  if (tier?.upgrade) { const [a, b] = await Promise.all([db.doc(`tenants/${t}/services/${tier.upgrade.fromServiceId}`).get(), db.doc(`tenants/${t}/services/${tier.upgrade.toServiceId}`).get()]);
    const fa: any = a.data() || {}, fb: any = b.data() || {}; const diff = Math.max(0, Math.round((Number(fb.price) || 0) * 100) - Math.round((Number(fa.price) || 0) * 100));
    if (diff > 0) upgrade = { fromServiceId: tier.upgrade.fromServiceId, toServiceId: tier.upgrade.toServiceId, fromName: fa.name || 'their service', toName: fb.name || 'the upgrade', cents: diff }; }
  const goal = goalOf(S, c.loyalty?.goalRewardId || null, balance);
  const { dayKey, tenantTimeZone } = await import('@/lib/tenant-time'); const boosts = activeBoosts(S, dayKey(new Date(now), tenantTimeZone(tenant))).map((b) => b.label);
  return { firstVisitAt, visitNumber: done.length + 1, boosts, cues: visitCues({ visitNumber: done.length + 1, firstVisitAt, birthday: c.birthday || c.dateOfBirth || c.dob || null, at: now }),
    goal: goal ? { rewardId: goal.reward.id, name: goal.reward.name, toGo: goal.toGo, pct: goal.pct, chosen: goal.chosen } : null,
    surprise: sur ? { ...sur.item, why: sur.why } : null, teamSurprises: sur ? [] : teamSurprises(S, used), surpriseBudgetLeft: Math.max(0, S.surprises.perMonth - used),
    tierPerks: tier ? { name: tier.name, waitlistFirst: !!tier.waitlistFirst, earlyDays: tier.earlyDays || 0, upgrade } : null };
}
/** At checkout: a surprise given, or a tier's free upgrade. Kept in the ledger at no points, with what it cost — once per sale. */
export async function recordGift(db: any, t: string, o: { kind: 'surprise' | 'perk'; clientId: string; saleId: string; name: string; cents: number; costCents: number; by: string; surpriseId?: string | null }) {
  const ref = db.doc(`${L(t)}/${o.kind === 'surprise' ? 'sur' : 'perk'}_${o.saleId}`);
  await ref.set({ clientId: o.clientId, type: o.kind, points: 0, at: nowIso(), by: o.by, saleId: o.saleId, cents: o.cents, costCents: o.costCents, rewardName: o.name, ...(o.surpriseId ? { surpriseId: o.surpriseId } : {}), why: o.kind === 'surprise' ? `A surprise: ${o.name}` : `Tier perk: ${o.name}` });
}
